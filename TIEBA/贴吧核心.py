# -*- coding: utf-8 -*-
"""贴吧型派单系统 · 数据核心

一把钥匙理解本项目：
  · 吧 = 一个项目文件夹（吧的「网址」就是该文件夹的绝对路径，吧名 = 文件夹名）
  · 帖 = 一张工单（帖名 = 工作内容简介；类型：TRae内部记录 / 会话内部交流预留）
  · 楼 = 帖下的楼层：奇数楼 = 总管（派活/留言），偶数楼 = 子代理（交稿/占锁）

铁律（由本模块按楼层号强制，调用方不得指定「名义发言人」）：
  · 奇数楼 → 名义发言人 = 总管；偶数楼 → 名义发言人 = 子代理
  · 楼层另记「实际发帖者」：子代理被叫停来不及回帖时，总管可「代发叫停」补偶数楼
  · 总管想补充/修改派活内容时，不占新楼，用「改楼」就地改自己最后一楼
    （只要子代理还没回帖就能改；子代理一回复即锁住不许回头改）

本模块只负责数据（校验/落盘/检索），不负责网络。
「贴吧服务端.py」与「贴吧MCP服务.py」都调本模块。
"""

import os
import json
import time
import random
import string
import threading

模块版本 = '0.1.0'

# ---------------- 常量 ----------------
帖类型们 = ['TRae内部记录', '会话内部交流预留']

状态_活跃 = '活跃'
状态_锁定 = '锁定'
状态_已终结 = '已终结'

# 终结原因（给总管做下拉参考，服务端不强制限定）
终结原因们 = ['任务已完成', '放弃任务', '待命', '转其他帖', '其他']

名义_总管 = '总管'
名义_子代理 = '子代理'

_痕迹前缀 = '贴吧型派单系统使用痕迹'


class 贴吧错误(Exception):
    """业务错误：调用方（MCP/CLI/web）应把 message 原样展示给 AI 或人。"""


# ---------------- 时间 / 落盘 小工具 ----------------
def _now():
    return time.strftime('%Y-%m-%d %H:%M:%S')


def _原子写(path, obj):
    """先写临时文件再替换：避免写到一半断电/被杀造成 JSON 半截。"""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


# ---------------- 使用痕迹目录（智能定位，不写死盘符） ----------------
def _本机盘列表():
    """动态探测本机全部存在的盘（A~Z），D/E 优先返回（仅优先次序，不限范围）"""
    import string as _s
    盘们 = []
    for 字母 in _s.ascii_uppercase:
        p = 字母 + ':\\'
        try:
            if os.path.isdir(p):
                盘们.append(p)
        except Exception:
            pass
    return sorted(盘们, key=lambda x: 0 if x[0] == 'D' else (1 if x[0] == 'E' else 2))


def _随机尾缀(n=4):
    return ''.join(random.choice(string.ascii_lowercase + string.digits)
                   for _ in range(n))


def 智能定位痕迹根(自动创建=True):
    """痕迹根：① 环境变量 TIEBA_TRACE_DIR → ② 各盘「使用痕迹」下的既有痕迹目录
    → ③ 各盘根目录（兼容旧样式）→ ④ 本文件同目录/上级 →
    找不到且允许创建时，在 D 盘「使用痕迹」下新建一个带随机尾缀的痕迹目录。"""
    env = (os.environ.get('TIEBA_TRACE_DIR') or '').strip()
    if env and os.path.isdir(env):
        return env
    here = os.path.dirname(os.path.abspath(__file__))
    roots = [os.path.join(盘, '使用痕迹') for 盘 in _本机盘列表()]
    roots += _本机盘列表()
    roots += [here, os.path.dirname(here)]
    for root in roots:
        try:
            hits = sorted(d for d in os.listdir(root)
                          if d.startswith(_痕迹前缀)
                          and os.path.isdir(os.path.join(root, d)))
            if hits:
                return os.path.join(root, hits[0])
        except Exception:
            pass
    if not 自动创建:
        return None
    for 盘 in _本机盘列表():
        base = os.path.join(盘, '使用痕迹')
        try:
            os.makedirs(base, exist_ok=True)
            p = os.path.join(base, _痕迹前缀 + _随机尾缀())
            os.makedirs(p, exist_ok=True)
            return p
        except Exception:
            continue
    p = os.path.join(here, _痕迹前缀 + _随机尾缀())
    os.makedirs(p, exist_ok=True)
    return p


# ---------------- 核心 ----------------
class 贴吧核心(object):
    """吧 / 帖 / 楼的唯一数据入口（含写锁，供多线程服务端调用）。"""

    def __init__(self, 痕迹根=None):
        self.根 = 痕迹根 or 智能定位痕迹根()
        self.吧目录 = os.path.join(self.根, '吧')
        self.配置文件目录 = os.path.join(self.根, '配置文件')
        self.日志目录 = os.path.join(self.根, '日志')
        self.索引路径 = os.path.join(self.根, '吧索引.json')
        self.配置路径 = os.path.join(self.配置文件目录, '配置.json')
        for d in (self.根, self.吧目录, self.配置文件目录, self.日志目录):
            os.makedirs(d, exist_ok=True)
        self._锁 = threading.RLock()
        self._索引 = self._读索引()
        self._写默认配置()

    # ---------- 索引 ----------
    def _读索引(self):
        try:
            with open(self.索引路径, 'r', encoding='utf-8') as f:
                d = json.load(f)
            if isinstance(d, dict) and isinstance(d.get('吧'), dict):
                d.setdefault('next_bid', 1)
                d.setdefault('next_tid', 1)
                d.setdefault('帖', {})
                return d
        except Exception:
            pass
        return {'版本': 模块版本, 'next_bid': 1, 'next_tid': 1, '吧': {}, '帖': {}}

    def _存索引(self):
        self._索引['版本'] = 模块版本
        _原子写(self.索引路径, self._索引)

    def _写默认配置(self):
        if not os.path.isfile(self.配置路径):
            try:
                _原子写(self.配置路径, {'版本': 模块版本, '痕迹根': self.根,
                                      '端口': 19885})
            except Exception:
                pass

    def _写日志(self, 动作, 详情):
        try:
            p = os.path.join(self.日志目录,
                             '日志_%s.txt' % time.strftime('%Y%m%d'))
            with open(p, 'a', encoding='utf-8') as f:
                f.write('[%s] %s | %s\n' % (_now(), 动作, 详情))
        except Exception:
            pass

    # ---------- 吧 ----------
    @staticmethod
    def _规范化(路径):
        return os.path.normcase(os.path.abspath(路径))

    def 找吧(self, 关键词):
        """按 bid / 绝对路径 / 吧名 找吧"""
        k = str(关键词 or '').strip()
        if not k:
            raise 贴吧错误('未提供吧（可填 bid、文件夹绝对路径或吧名）')
        if k in self._索引['吧']:
            return self._索引['吧'][k]
        np = self._规范化(k)
        for b in self._索引['吧'].values():
            if self._规范化(b['路径']) == np:
                return b
        for b in self._索引['吧'].values():
            if b['名称'] == k:
                return b
        raise 贴吧错误('找不到吧：%s（先用「吧_新建」把项目文件夹建成一个吧）' % k)

    def 建吧(self, 路径, 名称=None):
        if not 路径:
            raise 贴吧错误('参数 路径 不能为空（填项目文件夹的绝对路径）')
        with self._锁:
            p = os.path.abspath(str(路径))
            if not os.path.isdir(p):
                raise 贴吧错误('文件夹不存在：%s（吧的网址必须是一个已存在的项目文件夹）' % p)
            np = self._规范化(p)
            for b in self._索引['吧'].values():
                if self._规范化(b['路径']) == np:
                    return {'新建': False, '吧': b,
                            '说明': '该文件夹已经是一个吧了，直接用它发帖即可'}
            bid = 'b%03d' % self._索引['next_bid']
            self._索引['next_bid'] += 1
            b = {'bid': bid, '名称': (名称 or os.path.basename(p) or p),
                 '路径': p, '创建时间': _now()}
            self._索引['吧'][bid] = b
            os.makedirs(os.path.join(self.吧目录, bid, '帖'), exist_ok=True)
            self._存索引()
            self._写日志('吧_新建', '%s ← %s' % (bid, p))
            return {'新建': True, '吧': b}

    def 列吧(self):
        with self._锁:
            out = []
            for b in self._索引['吧'].values():
                帖们 = self._该吧帖们(b['bid'])
                out.append(dict(b, 帖数=len(帖们)))
            out.sort(key=lambda x: x['bid'])
            return {'数量': len(out), '吧': out}

    # ---------- 帖 ----------
    def _帖文件(self, tid):
        bid = self._索引['帖'].get(tid)
        if not bid:
            raise 贴吧错误('找不到帖：%s' % tid)
        return os.path.join(self.吧目录, bid, '帖', tid + '.json')

    def _该吧帖们(self, bid):
        d = os.path.join(self.吧目录, bid, '帖')
        out = []
        try:
            for fn in os.listdir(d):
                if fn.endswith('.json'):
                    try:
                        with open(os.path.join(d, fn), 'r', encoding='utf-8') as f:
                            out.append(json.load(f))
                    except Exception:
                        pass
        except Exception:
            pass
        return out

    def _读帖(self, tid):
        p = self._帖文件(tid)
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            raise 贴吧错误('读取帖 %s 失败：%s' % (tid, e))

    def _写帖(self, 帖):
        帖['更新时间'] = _now()
        _原子写(os.path.join(self.吧目录, 帖['bid'], '帖', 帖['tid'] + '.json'), 帖)

    @staticmethod
    def _造楼(号, 内容, 实际发帖者, 类别):
        return {'楼层': 号,
                '名义发言人': 名义_总管 if 号 % 2 == 1 else 名义_子代理,
                '实际发帖者': 实际发帖者,
                '类别': 类别,
                '内容': 内容,
                '时间': _now()}

    @staticmethod
    def _总管最后一楼(帖):
        return max([x['楼层'] for x in 帖['楼层']
                    if x['名义发言人'] == 名义_总管] or [0])

    def _须可改(self, 帖, 允许占者=None):
        if 帖['状态'] == 状态_已终结:
            raise 贴吧错误('该帖已终结封存，不能再改。如需续接，请新开一帖并在标题/一楼'
                          '引用 帖%s 的结论。' % 帖['tid'])
        if 帖['状态'] == 状态_锁定:
            锁 = 帖.get('锁定') or {}
            if 允许占者 is None or 锁.get('占者') != 允许占者:
                raise 贴吧错误('该帖已被「%s」占锁冻结（整帖冻结，任何人不能再改内容）。'
                              '如需应急，请总管用「帖_解锁」。'
                              % (锁.get('占者') or '?'))

    def 发帖(self, 吧, 标题, 内容, 类型='TRae内部记录'):
        if not 标题:
            raise 贴吧错误('参数 标题 不能为空（帖名 = 工作内容的一个简介）')
        if not 内容:
            raise 贴吧错误('参数 内容 不能为空（一楼要写清楚工作内容）')
        if 类型 not in 帖类型们:
            raise 贴吧错误('未知帖类型：%s（可选：%s）' % (类型, '、'.join(帖类型们)))
        with self._锁:
            b = self.找吧(吧)
            tid = 'T%03d' % self._索引['next_tid']
            self._索引['next_tid'] += 1
            帖 = {'tid': tid, 'bid': b['bid'], '吧名': b['名称'], '标题': 标题,
                  '类型': 类型, '状态': 状态_活跃,
                  '创建时间': _now(), '更新时间': _now(),
                  '锁定': None, '终结': None,
                  '楼层': [self._造楼(1, 内容, 名义_总管, '派活')]}
            self._索引['帖'][tid] = b['bid']
            self._存索引()
            self._写帖(帖)
            self._写日志('帖_发布', '%s @%s %s' % (tid, b['名称'], 标题))
            return {'帖': self._帖视图(帖)}

    def 留言(self, tid, 内容):
        """总管追加一楼（强制落在奇数楼）"""
        if not 内容:
            raise 贴吧错误('参数 内容 不能为空')
        with self._锁:
            帖 = self._读帖(tid)
            self._须可改(帖)
            下一 = len(帖['楼层']) + 1
            if 下一 % 2 == 0:
                raise 贴吧错误(
                    '第%d楼是子代理的楼层，总管不能占用。'
                    '（奇偶铁律：奇数楼=总管，偶数楼=子代理）'
                    '· 只是想补充/修改派活内容 → 用「帖_改楼」改自己那一楼'
                    '（子代理还没回帖时可以改，不占新楼层）；'
                    '· 子代理已被叫停来不及回帖 → 用「帖_代发叫停」补位。' % 下一)
            帖['楼层'].append(self._造楼(下一, 内容, 名义_总管, '留言'))
            self._写帖(帖)
            self._写日志('帖_留言', '%s 第%d楼' % (tid, 下一))
            return {'帖': self._帖视图(帖), '落在楼层': 下一}

    def 改楼(self, tid, 内容=None, 标题=None, 楼层=None):
        """总管就地修改自己那一楼（= 改原帖），不占新楼层、奇偶不变。

        铁律：只能改「最后一楼」，且它必须是总管楼 —— 也就是
        「只要子代理还没回帖，总管可以随便改原帖」；子代理一回复就锁住不许再回头改。
        改动能留痕（每层记「修改记录」，人类查看窗口里能看到改过几次）。"""
        with self._锁:
            帖 = self._读帖(tid)
            self._须可改(帖)          # 已终结 / 已被占锁冻结 → 都不许改
            if 内容 is None and 标题 is None:
                raise 贴吧错误('参数 内容 与 标题 至少要给一个')
            楼们 = 帖['楼层']
            if not 楼们:
                raise 贴吧错误('帖 %s 还没有楼' % tid)
            给了楼层 = bool(str(楼层 or '').strip())
            if not 给了楼层 and 楼们[-1]['名义发言人'] != 名义_总管:
                raise 贴吧错误(
                    '子代理已经回帖（第%d楼），原帖就锁住了、不能再改。'
                    '如需继续，请用「帖_留言」发新的奇数楼。' % 楼们[-1]['楼层'])
            目标号 = int(楼层) if 给了楼层 else 楼们[-1]['楼层']
            目标 = None
            for x in 楼们:
                if x['楼层'] == 目标号:
                    目标 = x
                    break
            if 目标 is None:
                raise 贴吧错误('帖 %s 没有第%s楼' % (tid, 目标号))
            if 目标['名义发言人'] != 名义_总管:
                raise 贴吧错误('第%d楼是子代理的楼层，总管不能改。' % 目标号)
            if 目标号 != 楼们[-1]['楼层']:
                后面 = [str(x['楼层']) for x in 楼们 if x['楼层'] > 目标号]
                raise 贴吧错误('第%d楼后面已经有新楼（第%s楼），'
                              '说明子代理已经回帖、帖往下走了，不能再回头改。'
                              '总管只能改「自己最后一楼」。'
                              % (目标号, '、'.join(后面)))
            改了 = []
            if 内容 is not None and 内容 != 目标.get('内容'):
                目标.setdefault('修改记录', []).append(
                    {'时间': _now(), '旧内容': 目标.get('内容')})
                目标['内容'] = 内容
                目标['最后修改'] = _now()
                改了.append('内容')
            if 标题 is not None and 标题 != 帖.get('标题'):
                帖.setdefault('标题修改记录', []).append(
                    {'时间': _now(), '旧标题': 帖.get('标题')})
                帖['标题'] = 标题
                改了.append('标题')
            if not 改了:
                raise 贴吧错误('内容和原来一样，没改到东西')
            self._写帖(帖)
            self._写日志('帖_改楼', '%s 第%d楼 改 %s' % (tid, 目标号, '、'.join(改了)))
            return {'帖': self._帖视图(帖), '改的楼层': 目标号, '改了': 改了,
                    '说明': '第%d楼已就地修改（没占新楼层，奇偶未变）。' % 目标号}

    def 代发叫停(self, tid, 原因):
        """总管替被子代理补一个偶数楼：维持奇偶不断，写明叫停的简单原因"""
        if not 原因:
            raise 贴吧错误('参数 原因 不能为空（代发叫停必须写明简单原因）')
        with self._锁:
            帖 = self._读帖(tid)
            self._须可改(帖)
            下一 = len(帖['楼层']) + 1
            if 下一 % 2 == 1:
                raise 贴吧错误('第%d楼是总管自己的楼层，无需代发；请用「帖_留言」。' % 下一)
            帖['楼层'].append(self._造楼(下一, 原因, 名义_总管, '代发叫停'))
            self._写帖(帖)
            self._写日志('帖_代发叫停', '%s 第%d楼 %s' % (tid, 下一, 原因))
            return {'帖': self._帖视图(帖), '落在楼层': 下一,
                    '说明': '已替子代理补上第%d楼，奇偶未断。' % 下一}

    def 交稿(self, tid, 内容, 已处理至=0, 占者=名义_子代理):
        """子代理交稿（强制落在偶数楼）。
        未占锁时先做「留言前置校验」：总管有新留言 → 拒绝，要求先处理完再回来交稿。"""
        if not 内容:
            raise 贴吧错误('参数 内容 不能为空（交稿要总结自己做了什么）')
        try:
            已处理至 = int(已处理至 or 0)
        except Exception:
            已处理至 = 0
        with self._锁:
            帖 = self._读帖(tid)
            self._须可改(帖, 允许占者=占者)   # 锁定态：只有持锁者能写
            锁定中 = (帖['状态'] == 状态_锁定)
            下一 = len(帖['楼层']) + 1
            if 下一 % 2 == 1:
                raise 贴吧错误('第%d楼是总管楼层，子代理不能占用。'
                              '请等总管在第%d楼派活后再交稿。' % (下一, 下一))
            if not 锁定中:
                最后总管楼 = self._总管最后一楼(帖)
                if 最后总管楼 > 已处理至:
                    raise 贴吧错误(
                        '总管有新留言（第%d楼），你不能直接交稿：'
                        '请先读帖、处理完最新留言，再带 已处理至=%d 回来交稿。'
                        % (最后总管楼, 最后总管楼))
            帖['楼层'].append(self._造楼(下一, 内容, 占者, '交稿'))
            self._写帖(帖)
            self._写日志('帖_交稿', '%s 第%d楼 by %s' % (tid, 下一, 占者))
            return {'帖': self._帖视图(帖), '落在楼层': 下一}

    def 占锁(self, tid, 占者=名义_子代理):
        """子代理交最终稿前先占锁 → 整帖冻结（任何人不能再改内容，含总管）"""
        with self._锁:
            帖 = self._读帖(tid)
            self._须可改(帖)
            帖['状态'] = 状态_锁定
            帖['锁定'] = {'占者': 占者, '时间': _now()}
            self._写帖(帖)
            self._写日志('帖_占锁', '%s by %s' % (tid, 占者))
            return {'帖': self._帖视图(帖),
                    '说明': '整帖已冻结，只有「%s」可以发最终交稿楼。' % 占者}

    def 解锁(self, tid, 操作者=名义_总管):
        with self._锁:
            帖 = self._读帖(tid)
            if 帖['状态'] != 状态_锁定:
                raise 贴吧错误('该帖当前不是锁定态（状态=%s），无需解锁。' % 帖['状态'])
            旧 = (帖.get('锁定') or {}).get('占者')
            帖['状态'] = 状态_活跃
            帖['锁定'] = None
            self._写帖(帖)
            self._写日志('帖_解锁', '%s 由 %s 解锁（原占者 %s）' % (tid, 操作者, 旧))
            return {'帖': self._帖视图(帖), '原占者': 旧}

    def 终结(self, tid, 原因, 操作者=名义_总管):
        if not 原因:
            raise 贴吧错误('参数 原因 不能为空（建议：%s）' % '、'.join(终结原因们))
        with self._锁:
            帖 = self._读帖(tid)
            if 帖['状态'] == 状态_已终结:
                raise 贴吧错误('该帖已经是终结态了（原因：%s）'
                              % (帖.get('终结') or {}).get('原因'))
            帖['状态'] = 状态_已终结
            帖['锁定'] = None
            帖['终结'] = {'原因': 原因, '时间': _now(), '操作者': 操作者}
            self._写帖(帖)
            self._写日志('帖_终结', '%s %s' % (tid, 原因))
            return {'帖': self._帖视图(帖),
                    '下一步': '请重新唤醒子代理读一次本帖（帖_读 tid=%s），'
                             '告知其已被终结。' % tid}

    # ---------- 读 / 列 / 检索 ----------
    @staticmethod
    def _帖视图(帖):
        d = dict(帖)
        n = len(帖['楼层'])
        d['楼数'] = n
        d['下一楼'] = n + 1
        d['下一楼名义发言人'] = 名义_总管 if (n + 1) % 2 == 1 else 名义_子代理
        d['总管最后一楼'] = 贴吧核心._总管最后一楼(帖)
        d['等子代理回帖'] = (n + 1) % 2 == 0
        return d

    def 读帖(self, tid):
        with self._锁:
            return {'帖': self._帖视图(self._读帖(tid)),
                    '帖类型们': 帖类型们, '终结原因们': 终结原因们}

    def 列帖(self, 吧=None, 状态=None):
        with self._锁:
            源 = None
            if 吧:
                b = self.找吧(吧)
                源 = self._该吧帖们(b['bid'])
            else:
                源 = []
                for b in self._索引['吧'].values():
                    源.extend(self._该吧帖们(b['bid']))
            状态 = (状态 or '').strip()
            if 状态 and 状态 != '全部':
                源 = [t for t in 源 if t.get('状态') == 状态]
            源.sort(key=lambda t: t.get('更新时间', ''), reverse=True)
            out = []
            for t in 源:
                out.append({'tid': t['tid'], '标题': t['标题'], '类型': t['类型'],
                            '状态': t['状态'], '吧名': t.get('吧名'),
                            '楼数': len(t['楼层']), '更新时间': t.get('更新时间'),
                            '下一楼': len(t['楼层']) + 1})
            return {'数量': len(out), '状态筛选': 状态 or '全部', '帖': out}

    def 检索帖(self, 关键词, 吧=None):
        """总管派活前的复用检索：本吧已有帖里找相似且有延续性的，命中就复用不新开。"""
        k = str(关键词 or '').strip()
        if not k:
            raise 贴吧错误('参数 关键词 不能为空（拿工作内容里的关键词来搜）')
        词们 = [w for w in k.replace('，', ' ').replace(',', ' ').split() if w]
        with self._锁:
            源 = None
            if 吧:
                b = self.找吧(吧)
                源 = self._该吧帖们(b['bid'])
            else:
                源 = []
                for b in self._索引['吧'].values():
                    源.extend(self._该吧帖们(b['bid']))
            命中 = []
            for t in 源:
                全文 = t['标题'] + '\n' + '\n'.join(
                    (x.get('内容') or '') for x in t['楼层'])
                if all(w in 全文 for w in 词们):
                    命中.append({'tid': t['tid'], '标题': t['标题'], '类型': t['类型'],
                                 '状态': t['状态'], '吧名': t.get('吧名'),
                                 '楼数': len(t['楼层']), '更新时间': t.get('更新时间'),
                                 '下一楼': len(t['楼层']) + 1,
                                 '可复用': (t['状态'] == 状态_活跃)})
            命中.sort(key=lambda x: x['更新时间'], reverse=True)
            return {'关键词': k, '命中数': len(命中), '帖': 命中,
                    '提示': '「可复用」为真的帖说明还活跃，可直接用「帖_留言」追加奇数楼'
                           '（不新开）；目标已达成的请改用「帖_终结」。'}

    # ---------- 状态 ----------
    def 系统状态(self):
        with self._锁:
            总帖 = 0
            for b in self._索引['吧'].values():
                总帖 += len(self._该吧帖们(b['bid']))
            return {'模块版本': 模块版本, '痕迹根': self.根, '吧数': len(self._索引['吧']),
                    '帖数': 总帖, '帖类型们': 帖类型们, '终结原因们': 终结原因们,
                    '状态们': [状态_活跃, 状态_锁定, 状态_已终结]}