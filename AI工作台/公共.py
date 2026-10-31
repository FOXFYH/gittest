# -*- coding: utf-8 -*-
"""
AI工作台 · 公共工具
------------------------------------------------------------
职责：路径寻址、配置读写、原子写、JSONL 追加、文件锁、日志、时间格式。
铁律：
  1. 不许写死盘符做跨盘跳转 —— 路径一律从本文件位置往上推 + 逐盘探测。
  2. 同一份代码要能在 D: 和 F: 盘两台机上跑。
  3. 所有对外时间字段一律 "HH:MM:SS"（需要日期时才带 "YYYY-MM-DD "）。
"""
import contextlib
import json
import os
import string
import sys
import threading
import time
import datetime

try:
    import msvcrt  # Windows 文件锁
except Exception:  # pragma: no cover
    msvcrt = None

程序根 = os.path.dirname(os.path.abspath(__file__))
网页源目录 = os.path.join(程序根, "网页端源文件")
网页首页 = os.path.join(网页源目录, "AI工作台.html")   # 唯一网页源（名字只有这一处）
配置文件路径 = os.path.join(程序根, "配置.json")
# 总管文件夹 = 程序根的上一层（不许写死盘符，盘符由 __file__ 推）
总管文件夹 = os.path.dirname(程序根)
原话目录 = os.path.join(总管文件夹, "02_原话流水账")
版本号 = "0.5.22"

# ---------------------------------------------------------------- 外连频道（唯一真源）
# 全项目只有这一处写死频道/凭据；网页端那份常量由 系统.自检 比对，漂了就报错。
# api_key 是基础设施凭据（与 TTS/任务面板同一把），界面上永不出现"令牌"输入框。
# 2026-10-31 C5 脱敏：凭据/频道真值不落代码，只活在 配置.json 的「公网桥」段；
# 下面全是占位默认，模块初始化时由 _载外连真值() 用配置真值覆盖。
外连 = {
    "api_key": "",
    "主机": "wss://free.blr2.piesocket.com/v3/",
    # 线路B（账号B，同频道）：A 配额用尽时自动切这条（2026-10-26 总裁 1.03 双线路口径）
    "api_key2": "",
    "主机2": "wss://s20307.nyc1.piesocket.com/v3/",
    "前缀": "你的频道前缀",
    "尾": "你的频道尾@",
    "名": "AI工作台",
}


def _载外连真值():
    """把 配置.json「公网桥」里的真值盖上 外连（配置优先→占位兜底）。"""
    try:
        段 = (读配置() or {}).get("公网桥") or {}
    except Exception:
        段 = {}
    if not isinstance(段, dict):
        return
    for 键 in ("api_key", "api_key2", "主机", "主机2", "前缀", "尾"):
        值 = str(段.get(键) or "").strip()
        if 值:
            外连[键] = 值


def 拼频道(尾=None):
    """用户只输半截（如 xxxx@），前缀由这里补。三端共用，不许各写一套。"""
    左 = (尾 or "").strip()
    return 外连["前缀"] + 左


def 频道全(尾=None):
    """完整频道号；尾为空时用默认尾。"""
    return 拼频道((尾 or "").strip() or 外连["尾"])


def 规范化口令(值):
    """口令归一（2026-10-26 P59）：用户只输尾 `xxxx@` → 自动补前缀；
    输完整串原样放行；老板笔误（尾里 29 写成 26）容错成 26。
    返回补好前缀的完整串（不做对错判定）。"""
    s = str(值 or "").strip()
    if not s:
        return ""
    全 = s if s.startswith(外连["前缀"]) else 拼频道(s)
    默认全 = 拼频道(外连["尾"])
    if 全 != 默认全 and 全.replace("29fF@", "26fF@") == 默认全:
        return 默认全
    return 全


def 口令对(值, 期望=""):
    """口令校验：输入可只尾巴 / 完整串 / 29 笔误；与期望（默认 频道全()）比对。"""
    期望 = str(期望 or "").strip() or 频道全()
    全 = 规范化口令(值)
    if 全 == 期望:
        return True
    # 期望本身可能是测试频道尾；再按「期望的尾」做一次补前缀比对
    return 全 == 拼频道(期望)

_锁 = threading.RLock()
_日志锁 = threading.RLock()

# ---------------------------------------------------------------- 基础时间

def 现在秒():
    """HH:MM:SS"""
    return datetime.datetime.now().strftime("%H:%M:%S")


def 现在全():
    """YYYY-MM-DD HH:MM:SS"""
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def 现在毫秒():
    return int(time.time() * 1000)


def 今天前缀():
    return datetime.datetime.now().strftime("%Y-%m-%d")


def 解析时间(文本):
    """把账本里乱格式的时间解析成 datetime；失败返回 None。
    支持：'2026-10-25 21:02:16' / '21:02' / '2026-10-25'
    """
    if not 文本:
        return None
    文本 = str(文本).strip()
    for 格式 in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M"):
        try:
            值 = datetime.datetime.strptime(文本, 格式)
            if 格式 in ("%H:%M:%S", "%H:%M"):
                今天 = datetime.date.today()
                值 = 值.replace(year=今天.year, month=今天.month, day=今天.day)
            return 值
        except Exception:
            continue
    return None


# ---------------------------------------------------------------- 路径寻址

def _候选盘符():
    """所有存在的盘根，本盘优先。"""
    本盘 = os.path.splitdrive(程序根)[0] + "\\"
    结果 = [本盘]
    for 字母 in string.ascii_uppercase:
        盘 = 字母 + ":\\"
        if 盘.upper() == 本盘.upper():
            continue
        if os.path.exists(盘):
            结果.append(盘)
    return 结果


def 找工作台根():
    """从程序根往上找「脚本备份\\工作台」这一层。"""
    路径 = 程序根
    for _ in range(8):
        父 = os.path.dirname(路径)
        if not 父 or 父 == 路径:
            break
        if os.path.basename(路径) == "工作台":
            return 路径
        路径 = 父
    return os.path.dirname(程序根)


def 找痕迹根():
    """使用痕迹根：跨盘自适应，不写死盘符。
    顺序：配置固定值 → 环境变量 → 本盘 使用痕迹 → 逐盘扫。
    """
    配置值 = 读配置().get("痕迹根", "")
    if 配置值 and os.path.isdir(配置值):
        return 配置值
    环境值 = os.environ.get("使用痕迹根", "")
    if 环境值 and os.path.isdir(环境值):
        return 环境值
    for 盘 in _候选盘符():
        候选 = os.path.join(盘, "使用痕迹")
        if os.path.isdir(候选):
            return 候选
    # 实在找不到就退回本盘根下（首次运行会建）
    return os.path.join(os.path.splitdrive(程序根)[0] + "\\", "使用痕迹")


# ---------------------------------------------------------------- 配置

默认配置 = {
    "进程名": "TRAE SOLO CN.exe",
    "端口9599": 9599,
    "端口19876": 19876,
    "端口19877": 19877,
    "网页端口": 19900,
    "账本路径": "",          # 首次运行自动探测后写回
    "服务端启动json": "",     # 首次运行自动探测后写回
    "痕迹根": "",            # 首次运行自动探测后写回
    "模式缓存秒": 0,          # 0=每轮都走 CDP，不读缓存（只认真实）
    "员工只取终身号": True,
}


def 读配置():
    """读配置；文件坏了不抛，返回默认值。"""
    try:
        with open(配置文件路径, "r", encoding="utf-8") as f:
            数据 = json.load(f)
        if not isinstance(数据, dict):
            return dict(默认配置)
        合并 = dict(默认配置)
        合并.update(数据)
        return 合并
    except Exception:
        return dict(默认配置)


def 写配置(数据):
    原子写json(配置文件路径, 数据)
    return 数据


def 探测账本路径():
    """扫描痕迹根下的 聊天账本.db，优先 TRAE 那份，取最新修改的一份。"""
    候选 = []
    for 根, 目录们, 文件们 in os.walk(痕迹根):
        # 不深挖太久：超过 4 层就剪掉
        if 根.count(os.sep) - 痕迹根.count(os.sep) > 4:
            目录们[:] = []
            continue
        if "聊天账本.db" in 文件们:
            完整 = os.path.join(根, "聊天账本.db")
            try:
                修改 = os.path.getmtime(完整)
                大小 = os.path.getsize(完整)
            except Exception:
                continue
            候选.append((("TRAE" in 完整.upper()) * 10 ** 12 + 修改, 大小, 完整))
        if len(候选) > 40:
            break
    if not 候选:
        return ""
    候选.sort(reverse=True)
    return 候选[0][2]


def 探测服务端启动json():
    for 根, 目录们, 文件们 in os.walk(痕迹根):
        if 根.count(os.sep) - 痕迹根.count(os.sep) > 4:
            目录们[:] = []
            continue
        if "服务端启动.json" in 文件们:
            return os.path.join(根, "服务端启动.json")
    return ""


def 准备配置(命令行覆盖=None):
    """补齐配置里的空项（账本路径/启动json/痕迹根），写回文件。"""
    配置 = 读配置()
    改动 = False
    if not 配置.get("痕迹根"):
        配置["痕迹根"] = 痕迹根
        改动 = True
    if not 配置.get("账本路径") or not os.path.isfile(配置.get("账本路径", "")):
        找到 = 探测账本路径()
        if 找到:
            配置["账本路径"] = 找到
            改动 = True
    if not 配置.get("服务端启动json") or not os.path.isfile(配置.get("服务端启动json", "")):
        找到 = 探测服务端启动json()
        if 找到:
            配置["服务端启动json"] = 找到
            改动 = True
    if 改动:
        try:
            写配置(配置)
        except Exception:
            pass
    # 命令行覆盖只在本次内存里生效，绝不写回 配置.json（否则自测的假进程名会留在真配置里）
    if 命令行覆盖:
        配置.update(命令行覆盖)
    return 配置


# ---------------------------------------------------------------- 读写原子性

def 读json(路径, 默认值=None):
    try:
        with open(路径, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return 默认值


def 原子写文本(路径, 文本):
    """同目录 .tmp + os.replace，杜绝读半个文件。
    临时文件名带 pid+线程号：采集器与 Tk/网页/CLI 多进程同写一份时不会互相抢 .tmp。
    """
    目录 = os.path.dirname(路径)
    if 目录:
        os.makedirs(目录, exist_ok=True)
    唯一 = "%s.%d_%d.tmp" % (路径, os.getpid(), threading.get_ident())
    for 次数 in range(6):
        with open(唯一, "w", encoding="utf-8", newline="\n") as f:
            f.write(文本)
            f.flush()
            try:
                os.fsync(f.fileno())
            except Exception:
                pass
        try:
            os.replace(唯一, 路径)
            return True
        except Exception:
            if 次数 == 5:
                try:
                    os.remove(唯一)
                except Exception:
                    pass
                raise
            time.sleep(0.05)
    return True


def 原子写json(路径, 数据):
    文本 = json.dumps(数据, ensure_ascii=False, indent=2)
    原子写文本(路径, 文本)


def 追加jsonl(路径, 记录):
    """一条一行；保证换行结尾，绝不把两行粘成一行。"""
    行 = json.dumps(记录, ensure_ascii=False)
    with _锁:
        os.makedirs(os.path.dirname(路径), exist_ok=True)
        需要补行 = False
        try:
            if os.path.getsize(路径) > 0:
                with open(路径, "rb") as f:
                    f.seek(-1, os.SEEK_END)
                    需要补行 = f.read(1) not in (b"\n", b"\r")
        except Exception:
            需要补行 = False
        with open(路径, "a", encoding="utf-8", newline="\n") as f:
            if 需要补行:
                f.write("\n")
            f.write(行 + "\n")
    return True


def 读jsonl(路径):
    """读 JSONL，坏行跳过，不抛。"""
    结果 = []
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            for 行 in f:
                行 = 行.strip()
                if not 行:
                    continue
                try:
                    结果.append(json.loads(行))
                except Exception:
                    continue
    except Exception:
        return []
    return 结果


@contextlib.contextmanager
def 文件锁(路径, 超时=6.0):
    """跨进程互斥（Tk / 网页 / 执行器 / 采集器 四处都可能写同一份文件）。"""
    if msvcrt is None:
        yield
        return
    目录 = os.path.dirname(路径)
    if 目录:
        os.makedirs(目录, exist_ok=True)
    fp = None
    起点 = time.time()
    while True:
        try:
            fp = open(路径, "a+b")
            msvcrt.locking(fp.fileno(), msvcrt.LK_NBLCK, 1)
            break
        except Exception:
            if fp is not None:
                try:
                    fp.close()
                except Exception:
                    pass
                fp = None
            if time.time() - 起点 > 超时:
                raise TimeoutError("文件锁等待超时: %s" % 路径)
            time.sleep(0.02)
    try:
        yield
    finally:
        try:
            msvcrt.locking(fp.fileno(), msvcrt.LK_UNLCK, 1)
        except Exception:
            pass
        try:
            fp.close()
        except Exception:
            pass


# ---------------------------------------------------------------- 日志

def 日志(内容, 级别="信息"):
    """写 日志\\AI工作台_YYYYMMDD.log，同时尽量打到控制台。"""
    行 = "[%s][%s] %s" % (现在秒(), 级别, 内容)
    try:
        文件名 = os.path.join(日志目录, "AI工作台_%s.log" % datetime.datetime.now().strftime("%Y%m%d"))
        with _日志锁:
            with open(文件名, "a", encoding="utf-8", newline="\n") as f:
                f.write(行 + "\n")
    except Exception:
        pass
    try:
        if sys.stdout and not sys.stdout.closed:
            print(行, flush=True)
    except Exception:
        pass


# ---------------------------------------------------------------- 杂项

状态等级 = {"绿": 0, "灰": 1, "黄": 2, "红": 3}


def 最坏(灯们):
    等级 = 0
    结果 = "绿"
    for 灯 in 灯们:
        值 = 状态等级.get(灯, 1)
        if 值 > 等级:
            等级 = 值
            结果 = 灯 if 灯 in 状态等级 else "灰"
    return 结果


def 距今秒(时间文本):
    """给一个账本时间文本，返回整数秒；解析不了返回 None。"""
    值 = 解析时间(时间文本)
    if 值 is None:
        return None
    差 = (datetime.datetime.now() - 值).total_seconds()
    if 差 < 0:
        return 0
    return int(差)


def 格式化秒(秒):
    """把秒数变成"18 分钟"这类人类说法（只用在横幅，不用在字段里）。"""
    if 秒 is None:
        return "未知"
    if 秒 < 60:
        return "%d 秒" % 秒
    if 秒 < 3600:
        return "%d 分钟" % (秒 // 60)
    return "%d 小时 %d 分钟" % (秒 // 3600, (秒 % 3600) // 60)


# ---------------------------------------------------------------- 空间路径（线程局部）
# 网页是 ThreadingHTTPServer：每请求一线程。只改进程全局必串（P1-B-1 治 1-3）。
# 口径：取路径(名) 先看本线程设没设值；没设过 → 回落 _默认路径（＝当前生效空间）。
# 采集器/任务执行器/自检线程永不设线程值 → 永远走默认空间，不被网页请求带偏。
_线程空间 = threading.local()
_默认路径 = {}


def 记默认路径(名, 值):
    """登记【当前生效空间】的路径；设置空间 / 设沙盒 每次切换后必须调它同步。"""
    _默认路径[名] = 值


def 取路径(名):
    值 = getattr(_线程空间, 名, None)
    return 值 if 值 is not None else _默认路径.get(名, "")


def 设线程路径(名, 值):
    setattr(_线程空间, 名, 值)


def 清线程路径():
    _线程空间.__dict__.clear()


# ---------------------------------------------------------------- 模块初始化
# 放在文件末尾：因为 找痕迹根() 会调 读配置()，必须先让函数都定义完。
痕迹根 = 找痕迹根()
数据目录 = os.path.join(痕迹根, "AI工作台")
# 配置跟着数据走：不再留在项目目录（=WPS 云盘），两台机不会互相覆盖路径
_正式配置 = os.path.join(数据目录, "配置.json")
if os.path.isfile(_正式配置) or not os.path.isfile(配置文件路径):
    配置文件路径 = _正式配置
_载外连真值()   # C5：外连真值只从 配置.json 取，代码里只留占位
状态文件 = os.path.join(数据目录, "状态.json")
任务卡文件 = os.path.join(数据目录, "任务卡.json")
动作队列文件 = os.path.join(数据目录, "动作队列.jsonl")
动作结果文件 = os.path.join(数据目录, "动作结果.jsonl")
催办记录文件 = os.path.join(数据目录, "催办记录.jsonl")
内部状态文件 = os.path.join(数据目录, "_采集内部.json")
重采集标志 = os.path.join(数据目录, "_重采集.flag")
原话备注文件 = os.path.join(数据目录, "原话备注.json")
备份目录 = os.path.join(数据目录, "备份")
日志目录 = os.path.join(数据目录, "日志")
手册目录 = os.path.join(程序根, "手册")          # P5 唯一真源（只读目录）
手册备份目录 = os.path.join(数据目录, "备份", "手册")
沙盒根 = ""

# P1-B-1：登记「当前生效空间」（启动时=数据目录；随后由 设置空间/设沙盒 持续改写）
记默认路径("数据目录", 数据目录)
记默认路径("任务卡文件", 任务卡文件)
记默认路径("备份目录", 备份目录)
记默认路径("账号", "")
记默认路径("端点", "")


def 确保目录():
    for 目录 in (数据目录, 备份目录, 日志目录, 手册备份目录):
        try:
            os.makedirs(目录, exist_ok=True)
        except Exception:
            pass


确保目录()


def 设沙盒(根目录=""):
    """把【所有写入根】整体搬到沙盒目录，用于自测 —— 真 状态.json 一个字节都不动。

    只改可写的落点（状态/卡库/队列/结果/备注/备份/日志/配置/手册备份）；
    手册正文目录与 02_原话流水账 保持只读真源（沙盒不复制业务数据）。
    手册编辑类写操作在沙盒里改为写 沙盒\\手册\\ 副本，绝不改真手册。
    """
    global 沙盒根, 数据目录, 配置文件路径, 状态文件, 任务卡文件
    global 动作队列文件, 动作结果文件, 催办记录文件, 内部状态文件
    global 重采集标志, 原话备注文件, 备份目录, 日志目录, 手册目录, 手册备份目录
    根目录 = (根目录 or "").strip() or os.path.join(
        os.environ.get("TEMP") or os.path.join(os.path.splitdrive(程序根)[0] + "\\", "Temp"),
        "_面板沙盒")
    根目录 = os.path.abspath(根目录)
    os.makedirs(根目录, exist_ok=True)
    沙盒根 = 根目录
    数据目录 = 根目录
    配置文件路径 = os.path.join(根目录, "配置.json")
    状态文件 = os.path.join(根目录, "状态.json")
    任务卡文件 = os.path.join(根目录, "任务卡.json")
    动作队列文件 = os.path.join(根目录, "动作队列.jsonl")
    动作结果文件 = os.path.join(根目录, "动作结果.jsonl")
    催办记录文件 = os.path.join(根目录, "催办记录.jsonl")
    内部状态文件 = os.path.join(根目录, "_采集内部.json")
    重采集标志 = os.path.join(根目录, "_重采集.flag")
    原话备注文件 = os.path.join(根目录, "原话备注.json")
    备份目录 = os.path.join(根目录, "备份")
    日志目录 = os.path.join(根目录, "日志")
    手册目录 = os.path.join(根目录, "手册")
    手册备份目录 = os.path.join(根目录, "备份", "手册")
    # 沙盒里的手册：拷一份真手册当只读底稿，写操作只落在副本上
    try:
        真手册 = os.path.join(程序根, "手册")
        if os.path.isdir(真手册) and not os.path.isdir(手册目录):
            import shutil
            shutil.copytree(真手册, 手册目录)
    except Exception:
        pass
    确保目录()
    # P1-B-1：沙盒也是「当前生效空间」，必须同步默认路径，否则 CLI/采集/自检回落死库
    记默认路径("数据目录", 数据目录)
    记默认路径("任务卡文件", 任务卡文件)
    记默认路径("备份目录", 备份目录)
    日志("已切沙盒模式：写入根 = %s（真状态文件不动）" % 根目录)
    return 根目录
