# -*- coding: utf-8 -*-
"""
AI工作台 · 核心（命令表 = 唯一真源）
------------------------------------------------------------
三统一规矩：功能只写这一遍，三个壳（CLI / Tk / 网页）都只调 执行()。

  CLI  AI工作台CLI.py 任务.建卡 标题="x" 负责人=0043 --json
  Tk   每个按钮的 tooltip/灰字就是命令名，点了走 核心.执行()
  网页 POST /api/cmd {"命令":"任务.建卡","参数":{…}}

统一返回：{"ok": bool, "数据": …, "说明": "…", "耗时ms": N}
写命令一律往 动作队列.jsonl + 动作结果.jsonl 各落一行，来源记 CLI|Tk|网页。
新增功能＝先往 命令表 加一行，再让三个壳都能叫到它。
"""
import datetime
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import threading
import time

import 公共
import 采集器
import 任务卡库
import 原话解析
import 手册
import 标签库

版本 = "0.5.21"
构建 = "2026-10-25"


# ---------------------------------------------------------------- 工具

def _成功(数据=None, 说明="", 耗时ms=0):
    return {"ok": True, "数据": 数据, "说明": 说明, "耗时ms": int(耗时ms)}


def _失败(说明, 数据=None, 耗时ms=0):
    return {"ok": False, "数据": 数据, "说明": 说明, "耗时ms": int(耗时ms)}


def _取参数(参数, 名, 默认=""):
    值 = (参数 or {}).get(名, 默认)
    if 值 is None:
        return 默认
    return str(值).strip() if not isinstance(值, (list, dict, bool, int, float)) else 值


def _当前状态(强制=False):
    状态 = 采集器.读状态()
    if 强制 or not 状态 or not 状态.get("trae"):
        状态 = 采集器.采一轮并写(公共.准备配置(), 状态.get("网页端口", 0) if 状态 else 0)
    return 状态


def _记一笔(命令, 参数, 来源, 结果, 说明, 耗时ms):
    """写命令落两本账：动作队列（谁点了什么）+ 动作结果（成没成）。"""
    时间 = 公共.现在全()
    aid = "a_%d_%03d" % (int(time.time()), int((time.time() * 1000) % 1000))
    记录 = {
        "id": aid, "ts": 时间, "来源": 来源, "动作": 命令,
        "参数": 参数 or {}, "state": "已完成",
    }
    try:
        公共.追加jsonl(公共.动作队列文件, 记录)
    except Exception as 错:
        公共.日志("写动作队列失败: %s" % 错, "警告")
    try:
        公共.追加jsonl(公共.动作结果文件, {
            "id": aid, "ts": 时间, "来源": 来源, "命令": 命令,
            "参数": 参数 or {}, "结果": "ok" if 结果 else "fail",
            "说明": 说明, "耗时ms": int(耗时ms),
        })
    except Exception as 错:
        公共.日志("写动作结果失败: %s" % 错, "警告")
    return aid


# ---------------------------------------------------------------- 各命令实现

# ---------------------------------------------------------------- 身份与凭证（R3·2026-10-31）
# 病根：以前「来源」是参数，谁都能填 Tk 自称人类。R3 起身份只由【进程入口 + 进程内对象】决定，
# 参数里的 来源/人工确认/录入人 一律当冒充：忽略、按 AI 处理、落告警。

class 人类入口凭证:
    """进程内身份对象：界面入口（Tk／网页后端／公网桥）持有它并传给 核心.执行；
    CLI 虽能 import 核心 拿到它，但过不了「界面进程」这一关，所以单靠它也不够。"""
    __slots__ = ("通道",)

    def __init__(self, 通道):
        self.通道 = str(通道)

    def __repr__(self):
        return "人类入口凭证(%s)" % self.通道


本机Tk = 人类入口凭证("Tk")
本机网页 = 人类入口凭证("网页")
远程网页 = 人类入口凭证("网页·远程")

def 令牌文件路径():
    """当前生效空间的 原话令牌.json（P1-B-1：不再 import 期定死）。"""
    return os.path.join(公共.取路径("数据目录"), "原话令牌.json")


令牌有效期 = 300      # 秒（5 分钟）


# R4·2026-10-31：钥匙不落盘——界面会话密钥只存内存，令牌用 HMAC 当场重算，文件里那一份只当审计。

_界面会话 = {}          # sid -> {"通道": str, "密钥": bytes, "建": float, "已用": set}
_待注册 = {}            # 口令 sha256 -> {"到期": float}（内存，5 分钟）


def 是界面主程序():
    """过渡锚（严格）：主文件必须正好是 程序根\\AI工作台.pyw（或 公网桥.py），
    任何子目录里的同名夹具都不算。"""
    try:
        import sys as _sys
        主 = getattr(_sys.modules.get("__main__"), "__file__", "") or ""
        if not 主:
            return ""
        根 = os.path.abspath(公共.程序根)
        主 = os.path.abspath(主)
        if 主 == os.path.join(根, "AI工作台.pyw"):
            return "界面"
        if 主 == os.path.join(根, "公网桥.py"):
            return "网页·远程"
    except Exception:
        pass
    return ""


def 发注册口令():
    """界面启动时调：给人类一个一次性 6 位口令（只存哈希在内存，不落盘、不入参数）。"""
    import hashlib
    import secrets
    码 = "%06d" % secrets.randbelow(1000000)
    _待注册[hashlib.sha256(码.encode("utf-8")).hexdigest()] = {"到期": time.time() + 300}
    return 码


_登记开闸 = [False]   # 只有走 界面注册()（标准输入）时才开闸，防「一行命令把口令塞进 argv」


def 界面注册(通道="Tk"):
    """界面启动时调：屏幕上先 发注册口令()，再调本函数从【标准输入】读口令（阻塞读）。
    R5：口令不许走 argv/参数——本函数只认 stdin。"""
    import sys
    try:
        sys.stderr.write("请在界面里输入屏幕上的 6 位一次性口令：")
        sys.stderr.flush()
        码 = sys.stdin.readline().strip()
    except Exception as 错:
        return False, "读标准输入失败：%s" % 错, ""
    _登记开闸[0] = True
    try:
        return 登记界面会话(码, 通道)
    finally:
        _登记开闸[0] = False


def 登记界面会话(口令, 通道="Tk"):
    """内部：只在 界面注册() 开闸后可用（R5：拒绝任何「参数/argv 传口令」的调用）。"""
    import hashlib
    import secrets
    if not _登记开闸[0]:
        return False, "口令不许从参数/argv 传入（R5）：请走 界面注册()（标准输入阻塞读）", ""
    h = hashlib.sha256(str(口令 or "").strip().encode("utf-8")).hexdigest()
    项 = _待注册.pop(h, None)
    if not 项 or float(项.get("到期") or 0) <= time.time():
        return False, "口令不对或已过期（一次性，5 分钟）", ""
    sid = secrets.token_urlsafe(8)
    _界面会话[sid] = {"通道": str(通道 or "Tk"), "密钥": secrets.token_bytes(32),
                     "建": time.time(), "已用": set()}
    公共.日志("界面会话注册：sid=%s 通道=%s（密钥仅存内存，重启即废）" % (sid, 通道), "放行")
    return True, "已注册界面会话 %s（仅存内存，重启即失效）" % sid, sid


def _人路(凭证, 会话号, 声称来源):
    """人路＝身份：只认内存里的界面会话（sid 不在文件里、不在环境变量里）。
    过渡：真界面主程序但还没注册会话时放行并告警；CLI/夹具一律 AI。"""
    项 = _界面会话.get(str(会话号 or ""))
    if 项:
        return 项["通道"]
    主 = 是界面主程序()
    if 主:
        公共.日志("过渡口：真界面主程序尚未注册会话（建议启动时调 发注册口令/登记界面会话）", "警告")
        s = str(声称来源 or "").strip()
        return s if s in ("Tk", "网页", "网页·远程") else 主
    return ""


def _读令牌():
    d = 公共.读json(令牌文件路径(), {}) or {}
    if not isinstance(d.get("令牌"), list):
        d["令牌"] = []
    return d


def _写令牌(d):
    公共.原子写json(令牌文件路径(), d)


def _签(密钥, 串):
    import hashlib
    import hmac
    return hmac.new(密钥, str(串).encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def _审计令牌(记):
    """只当审计：谁发/谁用/几点。这份文件不参与任何放行判定，被人改了也不影响安全。"""
    try:
        with 公共.文件锁(令牌文件路径() + ".lock"):
            d = _读令牌()
            d["令牌"].append(记)
            d["令牌"] = d["令牌"][-200:]
            _写令牌(d)
    except Exception:
        公共.日志("令牌审计写失败：%s" % 记.get("号"), "警告")


def 发令牌(条文, 录入人, 凭证=None, 会话号=None):
    """【界面专用】发一次性令牌：HMAC(内存密钥, 通道|正文指纹|nonce|时刻)。
    文件里不存密钥、不存可放行的令牌；界面重启密钥即变，旧令牌全废。"""
    项 = _界面会话.get(str(会话号 or ""))
    if not 项:
        return False, "只有已注册的界面会话能发令牌（CLI/AI 一律拒）", ""
    文 = str(条文 or "").strip()
    if not 文:
        return False, "令牌必须绑定一句原话正文", ""
    import hashlib
    import secrets
    sid = str(会话号)
    指纹 = hashlib.sha1(文.encode("utf-8")).hexdigest()
    nonce = secrets.token_hex(6)
    ts = str(int(time.time()))
    头 = "%s|%s|%s|%s" % (项["通道"], 指纹, nonce, ts)
    号 = "T-%s.%s.%s.%s" % (sid, nonce, ts, _签(项["密钥"], 头))
    _审计令牌({"号": 号, "动作": "发", "录入人": str(录入人 or "老板"), "通道": 项["通道"],
              "时刻": 公共.现在全(), "正文": 文})
    公共.日志("发令牌：号=%s 录入人=%s 通道=%s 正文=%d字" % (号, 录入人 or "老板", 项["通道"], len(文)), "放行")
    return True, "已发一次性令牌 %s（5 分钟内有效，用一次作废）" % 号, 号


def 核销令牌(号, 条文):
    """核销：按 sid 找【内存】密钥，重算 HMAC 比对；用过的记在内存里。
    CLI 进程没有界面会话 → 必然核销不过（这也是设计：令牌不能跨进程自证）。"""
    号 = str(号 or "").strip()
    段 = 号.split(".")
    if len(段) != 4 or not 段[0].startswith("T-"):
        return False, "令牌格式不对"
    sid = 段[0][2:]
    项 = _界面会话.get(sid)
    if not 项:
        return False, "本进程没有该界面会话（界面未开/已重启：令牌全废，需界面在线核销）"
    import hashlib
    import hmac
    文 = str(条文 or "").strip()
    指纹 = hashlib.sha1(文.encode("utf-8")).hexdigest()
    头 = "%s|%s|%s|%s" % (项["通道"], 指纹, 段[1], 段[2])
    if not hmac.compare_digest(_签(项["密钥"], 头), 段[3]):
        return False, "签名不对（伪造令牌）"
    if abs(time.time() - int(段[2])) > 令牌有效期:
        return False, "该令牌已过期（有效期 5 分钟）"
    if 号 in 项["已用"]:
        return False, "该令牌已用过（一次性，用完即废）"
    项["已用"].add(号)
    _审计令牌({"号": 号, "动作": "用", "通道": 项["通道"], "时刻": 公共.现在全(), "正文": 文})
    公共.日志("核销令牌：号=%s 通道=%s" % (号, 项["通道"]), "放行")
    return True, "令牌 %s 已核销（用一次作废）" % 号


# ---------------------------------------------------------------- 账号与数据空间（P1-A·2026-10-31）
# 账号维度＝终身号；设备维度＝端点。业务数据落 数据根\空间\<终身号>\<端点>\，跨账号/跨端点不可互访。
数据根 = 公共.数据目录                      # 固定基座（切空间时不动它）
账号表文件 = os.path.join(数据根, "账号", "账号表.json")
业务json = ("任务卡.json", "派工单.json", "手动原话.json", "原话备注.json",
            "原话令牌.json", "异常.json", "员工.json", "标签.json")
当前空间 = {"账号": "", "端点": "", "目录": ""}


def _读账号表():
    d = 公共.读json(账号表文件, {}) or {}
    if not isinstance(d.get("账号"), list):
        d["账号"] = []
    return d


def _写账号表(d):
    公共.原子写json(账号表文件, d)


def _找账号(号):
    号 = str(号 or "").strip()
    return next((x for x in _读账号表().get("账号", [])
                 if str(x.get("终身号") or "") == 号), None)


def 端点名():
    """端点名单一真源：配置.json 的「端点名」；没有就取计算机名并写回配置（只此一处）。"""
    配置 = 公共.读json(公共.配置文件路径, {}) or {}
    if not isinstance(配置, dict):
        配置 = {}
    名 = str(配置.get("端点名") or "").strip()
    if not 名:
        try:
            import socket
            名 = socket.gethostname()
        except Exception:
            名 = "端点"
        配置["端点名"] = 名
        try:
            公共.原子写json(公共.配置文件路径, 配置)
        except Exception:
            公共.日志("端点名写配置失败：%s" % 名, "警告")
    return 名


_迁移锁 = threading.Lock()
_空间深度 = threading.local()


def _迁存量(目):
    """首次进入空间时把根目录的老业务 json 复制过来（不移动、不删库）；只锁 copy 段。"""
    迁了 = 0
    import shutil
    with _迁移锁:
        for 名 in 业务json:
            老 = os.path.join(数据根, 名)
            新 = os.path.join(目, 名)
            if os.path.isfile(老) and not os.path.isfile(新):
                try:
                    shutil.copy2(老, 新)
                    迁了 += 1
                except Exception as 错:
                    公共.日志("空间迁移失败 %s：%s" % (名, 错), "警告")
    return 迁了


def 设置空间(账号, 端点):
    """切到 <账号>\<端点> 数据空间；首次进入自动把老的业务 json 复制过来（不移动、不删库）。"""
    号 = str(账号 or "").strip()
    端 = str(端点 or "").strip() or 端点名()
    if not 号:
        return False, "缺少账号（终身号）"
    目 = os.path.join(数据根, "空间", 号, 端)
    os.makedirs(目, exist_ok=True)
    迁了 = _迁存量(目)
    公共.数据目录 = 目
    公共.任务卡文件 = os.path.join(目, "任务卡.json")
    当前空间.update({"账号": 号, "端点": 端, "目录": 目})
    # P1-B-1：_默认路径 ＝【当前生效空间】，切换后必须同步，否则 CLI/采集/自检回落死库
    公共.记默认路径("数据目录", 目)
    公共.记默认路径("任务卡文件", 公共.任务卡文件)
    公共.记默认路径("备份目录", os.path.join(目, "备份"))
    公共.记默认路径("账号", 号)
    公共.记默认路径("端点", 端)
    公共.日志("空间切换：%s / %s（迁移存量 %d 份）" % (号, 端, 迁了), "放行")
    return True, "空间=%s（迁移 %d 份）" % (目, 迁了)


def 进入线程空间(账号, 端点=""):
    """P1-B-1：只给【本线程】切空间（HTTP/WS 每请求一线程），进程全局一个字节都不动。"""
    号 = str(账号 or "").strip()
    if not 号:
        return False, "缺少账号"
    端 = str(端点 or "").strip() or 端点名()
    目 = os.path.join(数据根, "空间", 号, 端)
    os.makedirs(目, exist_ok=True)
    迁 = _迁存量(目)
    公共.设线程路径("数据目录", 目)
    公共.设线程路径("任务卡文件", os.path.join(目, "任务卡.json"))
    公共.设线程路径("备份目录", os.path.join(目, "备份"))
    公共.设线程路径("账号", 号)
    公共.设线程路径("端点", 端)
    _空间深度.n = int(getattr(_空间深度, "n", 0)) + 1
    return True, "线程空间=%s（迁移 %d 份）" % (目, 迁)


def 退出线程空间():
    """按层退出：外层进入过、内层命令又进入一次时，内层退出不许把外层空间清掉。"""
    层 = int(getattr(_空间深度, "n", 0))
    if 层 > 1:
        _空间深度.n = 层 - 1
        return
    _空间深度.n = 0
    公共.清线程路径()


def _cmd_账号注册(参数, 来源):
    号 = str(_取参数(参数, "终身号") or _取参数(参数, "账号") or "").strip()
    密 = str((参数 or {}).get("密码") or "").strip()
    if not 号:
        return _失败("缺参数：终身号（中深号码）")
    if len(号) < 4:
        return _失败("终身号太短：%s（至少 4 位）" % 号)
    表 = _读账号表()
    if any(str(x.get("终身号") or "") == 号 for x in 表["账号"]):
        return _失败("账号已存在：%s（改密码用 账号.改密）" % 号)
    表["账号"].append({"终身号": 号, "密码": 密, "注册": 公共.现在全()})
    _写账号表(表)
    return _成功({"终身号": 号, "免密": not 密},
                "已注册账号 %s%s" % (号, "（免密模式）" if not 密 else "（已设密码）"))


def _cmd_账号列表(参数, 来源):
    出 = [{"终身号": x.get("终身号"), "免密": not str(x.get("密码") or ""),
           "注册": x.get("注册", "")} for x in _读账号表().get("账号", [])]
    return _成功({"账号": 出, "条数": len(出)}, "共 %d 个已注册账号" % len(出))


def _cmd_账号改密(参数, 来源):
    号 = str(_取参数(参数, "终身号") or _取参数(参数, "账号") or "").strip()
    旧 = str((参数 or {}).get("旧密码") or "").strip()
    新 = str((参数 or {}).get("密码") or (参数 or {}).get("新密码") or "").strip()
    if not 号:
        return _失败("缺参数：终身号")
    表 = _读账号表()
    项 = next((x for x in 表["账号"] if str(x.get("终身号") or "") == 号), None)
    if 项 is None:
        return _失败("账号不存在：%s" % 号)
    if str(项.get("密码") or "") and 旧 != str(项.get("密码") or ""):
        return _失败("旧密码不对")
    项["密码"] = 新
    项["改密"] = 公共.现在全()
    _写账号表(表)
    return _成功({"终身号": 号, "免密": not 新},
                "已改密 %s%s" % (号, "（已清空=免密）" if not 新 else ""))


def _cmd_账号登录(参数, 来源):
    号 = str(_取参数(参数, "终身号") or _取参数(参数, "账号") or "").strip()
    密 = str((参数 or {}).get("密码") or "").strip()
    端 = str(_取参数(参数, "端点") or "").strip() or 端点名()
    if not 号:
        return _失败("缺参数：终身号（CLI 不许匿名）")
    项 = _找账号(号)
    if 项 is None:
        return _失败("账号未注册：%s（先 账号.注册 终身号=%s）" % (号, 号))
    设密 = str(项.get("密码") or "")
    if 设密 and 密 != 设密:
        return _失败("密码不对（该账号设了密码）")
    好, 说 = 设置空间(号, 端)
    if not 好:
        return _失败(说)
    return _成功({"账号": 号, "端点": 端, "空间": 当前空间["目录"]},
                "已登录 账号=%s 端点=%s（%s）" % (号, 端, 说))


def 校验账号准入(命令, 账号, 端点):
    """P1-A【可测入口】：CLI 准入判定（CLI 壳与验收脚本共用，不弹窗、可 import 直调）。"""
    要 = str(命令 or "").startswith(("任务.", "原话.", "派工单.", "派工.", "分组.", "标签.", "异常.", "提醒.", "员工.我的"))
    if not 要:
        return True, ""
    if not str(账号 or "").strip():
        return False, ("CLI 不许匿名：请带 --账号=<终身号> --端点=<设备>"
                       "（先 账号.注册 或 账号.登录）")
    if not str(端点 or "").strip():
        # P1-A 收尾：CLI 端点默认值也取自 端点名()（单一真源），不再要求手写「本机」
        return True, ""
    if _找账号(账号) is None:
        return False, "账号未注册：%s（先 账号.注册 终身号=%s）" % (账号, 账号)
    return True, ""


def 需要空间(命令):
    """P1-A【可测入口】：这条命令是否要账号空间（业务命令）。"""
    return str(命令 or "").startswith(("任务.", "原话.", "派工单.", "派工.", "分组.", "标签.", "异常.", "提醒.", "员工.我的"))


def _cmd_账号删除(参数, 来源):
    号 = str(_取参数(参数, "终身号") or _取参数(参数, "账号") or "").strip()
    if not 号:
        return _失败("缺参数：终身号")
    表 = _读账号表()
    项 = next((x for x in 表["账号"] if str(x.get("终身号") or "") == 号), None)
    if 项 is None:
        return _失败("账号不存在：%s" % 号)
    清 = str(_取参数(参数, "清数据") or "是").strip().lower() not in ("否", "不", "0", "false", "no")
    删了 = 0
    if 清:
        import shutil
        根 = os.path.join(数据根, "空间", 号)
        if os.path.isdir(根):
            删了 = sum(len(文件) for _, _, 文件 in os.walk(根))
            shutil.rmtree(根, ignore_errors=True)
    表["账号"] = [x for x in 表["账号"] if str(x.get("终身号") or "") != 号]
    _写账号表(表)
    公共.日志("删账号：%s 清数据=%s 删文件=%d" % (号, 清, 删了), "放行")
    return _成功({"终身号": 号, "清数据": 清, "删文件": 删了},
                "已删账号 %s%s" % (号, ("（清空间 %d 份文件）" % 删了) if 清 else "（保留数据）"))


def _cmd_trae状态(参数, 来源):
    状态 = _当前状态()
    数据 = dict(状态.get("trae", {}))
    for 键 in ("积分", "积分时刻", "积分账号"):
        数据.setdefault(键, "")     # 采集器没写/文件缺失时留空，不写 0
    return _成功(数据, "取自 状态.json")


def _cmd_trae重采集(参数, 来源):
    起点 = time.time()
    状态 = 采集器.采一轮并写(公共.准备配置(), 采集器.读状态().get("网页端口", 0))
    return _成功({"状态": 状态.get("trae", {}), "总状态": 状态.get("总状态"),
                "采集耗时ms": 状态.get("采集耗时ms")},
                "已重采：总状态 %s" % 状态.get("总状态"), (time.time() - 起点) * 1000)


def _卡日(卡):
    """卡的时间：更新/创建可为 `YYYY-MM-DD HH:MM:SS` 或老 `HH:MM:SS`（按今天算）。"""
    import datetime as _dt
    for 键 in ("更新", "创建"):
        s = str((卡 or {}).get(键) or "").strip()
        if not s:
            continue
        for 格式 in ("%Y-%m-%d %H:%M:%S", "%H:%M:%S"):
            try:
                t = _dt.datetime.strptime(s, 格式)
                if 格式 == "%H:%M:%S":
                    t = t.replace(year=_dt.date.today().year, month=_dt.date.today().month,
                                  day=_dt.date.today().day)
                return t
            except Exception:
                pass
    return None


def _近7天(物们):
    import datetime as _dt
    线 = _dt.datetime.now() - _dt.timedelta(days=7)
    出 = []
    for x in (物们 or []):
        t = _卡日(x)
        if t and t >= 线:
            出.append(x)
    return 出


def _cmd_员工列表(参数, 来源):
    状态 = _当前状态()
    员工 = 状态.get("员工", [])
    错 = str(状态.get("员工错误") or "")
    # P4-18a：软件类型取「我的员工」白名单登记值；未登记一律「未登记」（不猜、不默认 TRAE）
    我的表 = _读我的员工().get("员工") or []
    白名 = {str(x.get("会话名") or ""): x for x in 我的表 if str(x.get("会话名") or "").strip()}
    白号 = {str(x.get("终身号") or ""): x for x in 我的表 if str(x.get("终身号") or "").strip()}
    端 = 端点名()
    # 任务履历以卡库为唯一真源（不依赖采集器是否已加该字段）
    卡们 = 任务卡库.读().get("卡", [])
    for i, e in enumerate(员工):
        号i = str(e.get("终身号") or "")
        明细 = [{"id": c.get("id"), "标题": c.get("标题", ""), "状态": c.get("状态", ""),
                 "更新": c.get("更新", "")} for c in 卡们 if str(c.get("负责人") or "") == 号i]
        记 = 白号.get(号i) or 白名.get(str(e.get("会话名") or "")) or {}
        员工[i] = dict(e, 任务明细=明细,
                      软件类型=str(记.get("软件类型") or "未登记"),
                      所属设备=端,
                      在线状态=(str(e.get("灯") or "") + "·" + str(e.get("时长") or "")))
    号 = _取参数(参数, "号")
    近期 = _取参数(参数, "近期")
    if 号:
        员工 = [e for e in 员工 if str(e.get("终身号") or "") == str(号).strip()]
    if 近期 in ("7天", "近7天"):
        员工 = [dict(e, 任务明细=_近7天(e.get("任务明细") or [])) for e in 员工]
    源 = "会话档案（CDP 采集存在）+账本活动"
    if 员工 and str(员工[0].get("来源") or "").find("名册缺失") >= 0:
        源 = "账本现推（名册缺失）"
    return _成功({"员工": 员工, "条数": len(员工), "员工错误": 错},
                "共 %d 人（来源：%s）%s" % (len(员工), 源, ("；" + 错) if 错 else ""))


# ---------------------------------------------------------------- P4 我的员工（白名单，随账号+端点）

def _我的员工路径():
    return os.path.join(公共.取路径("数据目录"), "我的员工.json")


def _读我的员工():
    d = 公共.读json(_我的员工路径(), None)
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 1)
    d.setdefault("账号", 公共.取路径("账号"))
    d.setdefault("端点", 公共.取路径("端点"))
    d.setdefault("更新", 公共.现在全())
    if not isinstance(d.get("员工"), list):
        d["员工"] = []
    return d


def _写我的员工(d):
    d["版本"] = 1
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {"版本": d["版本"], "账号": d["账号"], "端点": d["端点"], "更新": d["更新"]}
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_我的员工路径(), d)


def _cmd_员工我的列表(参数, 来源):
    端 = 端点名()
    人 = [x for x in (_读我的员工().get("员工") or [])
         if str(x.get("所属电脑") or 端).strip() == 端]
    return _成功({"员工": 人, "条数": len(人), "端点": 端},
                "我的员工 %d 人（端点 %s）" % (len(人), 端))


def _cmd_员工我的新增(参数, 来源):
    名 = str(_取参数(参数, "会话名") or _取参数(参数, "会话") or "").strip()
    端 = 端点名()
    电脑 = str(_取参数(参数, "电脑") or "").strip() or 端
    软件 = str(_取参数(参数, "软件") or _取参数(参数, "软件类型") or "").strip()
    规范 = {"workbuddy": "WorkBuddy", "wb": "WorkBuddy", "trie": "TRIE", "trae": "TRIE"}
    软件 = 规范.get(软件.lower(), 软件)
    if not 名:
        return _失败("缺参数：会话名", {"原因码": "bad_param"})
    if 电脑 != 端:
        return _失败("该员工在另一台电脑，本期不支持跨端点派工", {"原因码": "cross_endpoint",
                                                "电脑": 电脑, "端点": 端})
    if 软件 not in ("WorkBuddy", "TRIE"):
        return _失败("软件类型只能是 WorkBuddy / TRIE", {"原因码": "bad_param", "实际收到": 软件})
    表 = _读我的员工()
    旧 = next((x for x in 表["员工"] if str(x.get("会话名") or "").strip() == 名), None)
    if 旧 is not None:
        return _成功({"员工": 旧, "已存在": True}, "已在「我的员工」里：%s" % 名)
    条 = {"会话名": 名, "终身号": "", "所属电脑": 端, "软件类型": 软件,
          "创建": 公共.现在全(), "谁": 来源}
    表["员工"].append(条)
    _写我的员工(表)
    return _成功({"员工": 条, "已存在": False},
                "已加入我的员工：%s（%s / %s）" % (名, 软件, 端))


def _cmd_员工我的删除(参数, 来源):
    名 = str(_取参数(参数, "会话名") or _取参数(参数, "会话") or "").strip()
    if not 名:
        return _失败("缺参数：会话名", {"原因码": "bad_param"})
    表 = _读我的员工()
    旧 = next((x for x in 表["员工"] if str(x.get("会话名") or "").strip() == 名), None)
    if 旧 is None:
        return _失败("「我的员工」里没有 %s" % 名, {"原因码": "not_found"})
    表["员工"] = [x for x in 表["员工"] if str(x.get("会话名") or "").strip() != 名]
    _写我的员工(表)
    return _成功({"会话名": 名, "剩余": len(表["员工"])}, "已从我的员工删除：%s" % 名)


def _cmd_员工排队(参数, 来源):
    """读会话档案「系统排队条情况」列（TRae）：条数 / 时刻 / 排队条原文。"""
    号 = str(_取参数(参数, "号") or "").strip()
    if not 号:
        return _失败("缺参数：号（4 位终身号，如 0001）")
    库 = 采集器._档案库路径()
    if not 库:
        return _失败("找不到云档案库.db")
    值 = ""
    try:
        import sqlite3
        连接 = sqlite3.connect("file:%s?mode=ro" % 库.replace("\\", "/"), uri=True, timeout=3)
        try:
            for 行键, 原文 in 连接.execute(
                    "select 行键,值 from 值 where 库='TRae' and 字段='系统排队条情况'"):
                if str(行键 or "").rsplit("|", 1)[-1] == 号:
                    值 = 原文
                    break
        finally:
            连接.close()
    except Exception as e:
        return _失败("读云档案库失败：%s" % e)
    条数, 时刻, 条们 = 0, "", []
    if 值:
        try:
            值 = json.loads(值)
            if isinstance(值, str) and 值.strip():
                值 = json.loads(值)
            if isinstance(值, dict):
                条数 = int(值.get("条数") or 0)
                时刻 = str(值.get("时刻") or "")
                条们 = [str(x) for x in (值.get("条") or [])]
        except Exception:
            pass
    return _成功({"号": 号, "条数": 条数, "时刻": 时刻, "条": 条们},
                "%s 系统排队条 %d 条%s" % (号, 条数, ("（更新 %s）" % 时刻) if 时刻 else ""))


def _cmd_员工催办(参数, 来源):
    """v0.1：登记催办请求（面板还没有发信通道，绝不假装已发）。"""
    号 = _取参数(参数, "号")
    话 = _取参数(参数, "话", "") or "请立刻回复当前进度"
    if not 号:
        return _失败("缺参数：号（例 号=0043）")
    状态 = 采集器.读状态()
    名 = ""
    for 人 in 状态.get("员工", []):
        if 人.get("终身号") == 号:
            名 = 人.get("会话名", "")
            break
    记录 = {"ts": 公共.现在全(), "号": 号, "会话名": 名, "话": 话,
            "来源": 来源, "已发信": False}
    try:
        公共.追加jsonl(公共.催办记录文件, 记录)
    except Exception as 错:
        return _失败("写催办记录失败: %s" % 错)
    return _成功(记录, "已登记催办（%s %s）。说明：面板尚无发信通道，本条只登记未发出" % (号, 名))


def _cmd_任务列表(参数, 来源):
    数据 = 任务卡库.读()
    筛 = _取参数(参数, "状态")
    词 = _取参数(参数, "词").lower()
    组 = _取参数(参数, "分组")
    卡们 = 数据.get("卡", [])
    if 筛:
        筛 = str(筛).strip()
        if 筛 in ("未完成", "待办"):
            卡们 = [c for c in 卡们 if c.get("状态") in ("未做", "在做", "卡住")]
        elif 筛 == "已完成":
            卡们 = [c for c in 卡们 if c.get("状态") == "已完成"]
        else:
            卡们 = [c for c in 卡们 if c.get("状态") == 筛]
    if 组:
        卡们 = [c for c in 卡们 if (c.get("分组") or "未分类") == 组]
    近期 = _取参数(参数, "近期")
    if 近期 in ("7天", "近7天"):
        卡们 = _近7天(卡们)
    if 词:
        卡们 = [c for c in 卡们 if 词 in str(c.get("标题") or "").lower()
                or 词 in str(c.get("详情") or "").lower()
                or 词 in str(c.get("来源") or "").lower()
                or 词 in str(c.get("负责人") or "").lower()]
    出卡 = []
    for c in 卡们:
        齐, 齐说 = 标签库.标签齐(c)
        出卡.append(dict(c, **{"标签齐": 齐, "标签齐说明": 齐说}))
    return _成功({"卡": 出卡, "条数": len(出卡), "统计": 任务卡库.统计(数据),
                "分组": list(数据.get("分组") or ["未分类"]),
                "未完成": 任务卡库.未完成数(任务卡库.统计(数据))},
                "共 %d 张卡" % len(出卡))


def _最近人类原话():
    """最近一条人类原话的键：优先当日流水账最后一条，其次手动表最后一条；都没有则空串。"""
    try:
        条们 = (原话解析.合并(公共.今天前缀()) or {}).get("条") or []
        if 条们:
            return str(条们[-1].get("键") or "")
    except Exception:
        pass
    try:
        手动 = _手动条们()
        if 手动:
            return str(手动[-1].get("键") or "")
    except Exception:
        pass
    return ""


def _留痕原话(键, 录入人, 来源):
    """远程／CLI补录的痕：写进原话备注库（who／来源／时刻），不新建原话本身。"""
    try:
        原话解析.写备注(键, "录入口径：%s｜来源：%s｜时刻：%s"
                       % (录入人 or "未填", 来源 or "未标注", 公共.现在全()),
                       "总裁助理1号")
        return True
    except Exception:
        公共.日志("原话留痕失败：%s" % 键, "警告")
        return False


def _界面自动原话(标题, 来源, 录入人):
    """界面建卡若一条原话都没有：把人在界面敲的标题记成一条手动原话（人类输入，非 AI 造）。"""
    表 = _读手动()
    表["序号"] = int(表.get("序号") or 0) + 1
    序 = "%03d" % 表["序号"]
    键 = "手动#%s" % 序
    文 = "界面建卡：%s" % (标题 or "（无标题）")
    表.setdefault("条", []).append({
        "键": 键, "序号": 序, "时刻": 公共.现在全(), "摘要": 文[:120],
        "全文": 文, "备注": "界面自动记入（来源：%s｜录入人：%s）" % (来源, 录入人 or "界面"),
        "关联卡": [], "来源": "界面"})
    _写手动(表)
    _留痕原话(键, 录入人 or "界面", 来源)
    return 键


def _校验原话们(原话们, 人路=""):
    """原话必须真在库里；手动原话只认界面进程（签名只在内存里，AI 写文件改 来源 也没用）。
    返回 ""＝全通过，否则返回错误说明。"""
    for 条 in 原话们:
        if "#" not in 条:
            return "原话ID应为 日期#序号 或 手动#序号，收到 %s" % 条
        if 条.startswith("手动#"):
            if not 人路:
                return ("手动原话 %s 只能在界面里用（签名在界面内存，CLI 无法验证；"
                        "文件里的 来源 字段不算数）——AI 请用流水账 日期#序号 原话，或由界面建卡" % 条)
            if next((x for x in _手动条们() if x.get("键") == 条), None) is None:
                return "查不到这条手动原话 %s" % 条
        else:
            日, 序号 = 条.split("#", 1)
            表, 错误 = 原话解析.读表(日)
            if 错误:
                return "查不到原话 %s（%s）" % (条, 错误)
            if not any(str(行.get("序号") or "") == 序号.zfill(3) for 行 in 表):
                return "查不到这条原话 %s（当日流水账/手动表里没有）" % 条
    return ""


def _原话都存在(原话们):
    """R5：只查真伪（这条原话是否真的在账本里），不看谁写的——用于卡上 来源原话 的复核。
    返回 ""＝全存在，否则返回错误说明。"""
    for 条 in 原话们:
        条 = str(条 or "").strip()
        if "#" not in 条:
            return "原话ID格式不对：%s" % 条
        if 条.startswith("手动#"):
            if not any(x.get("键") == 条 for x in _手动条们()):
                return "查不到这条手动原话 %s（账本里没有，疑似手写冒充）" % 条
        else:
            日, 序号 = 条.split("#", 1)
            表, 错误 = 原话解析.读表(日)
            if 错误:
                return "查不到原话 %s（%s）" % (条, 错误)
            if not any(str(行.get("序号") or "") == 序号.zfill(3) for 行 in 表):
                return "查不到这条流水账原话 %s（疑似手写冒充）" % 条
    return ""


def _原话侧关联(键):
    """取某条原话自己记的 关联卡（手动表 / 备注库），用于双向对账。"""
    for 条 in _手动条们():
        if str(条.get("键") or "") == 键:
            return [str(x).upper() for x in (条.get("关联卡") or [])]
    try:
        备 = _备注表()
        项 = 备.get(键) if isinstance(备, dict) else None
        if isinstance(项, dict):
            return [str(x).upper() for x in (项.get("关联卡") or [])]
    except Exception:
        pass
    return []


def _反向原话(卡id):
    """原话侧（手动表＋备注库）里指认了这张卡的键列表（R6 反向对账用）。"""
    卡id = str(卡id or "").upper()
    出 = []
    for 条 in _手动条们():
        键 = str(条.get("键") or "")
        if 键 and 卡id in [str(x).upper() for x in (条.get("关联卡") or [])] and 键 not in 出:
            出.append(键)
    try:
        for 键, 项 in ((_备注表() or {}).items()):
            if isinstance(项, dict) and 卡id in [str(x).upper() for x in (项.get("关联卡") or [])]:
                if str(键) not in 出:
                    出.append(str(键))
    except Exception:
        pass
    return 出


def _双向对账(卡id, 原话们):
    """R6：卡侧 来源原话 与原话侧 关联卡 必须互相指认（只对账，不加新机制）。
    返回 ""＝对得上，否则返回「绑定不一致（疑似手写冒充）」类的说明。"""
    卡id = str(卡id or "").upper()
    原话们 = [str(x).strip() for x in (原话们 or []) if str(x).strip()]
    for 条 in 原话们:
        if 卡id not in _原话侧关联(条):
            return ("绑定不一致（疑似手写冒充）：卡 %s 的 来源原话 %s，在原话侧没关联这张卡"
                    % (卡id, 条))
    # 反向：原话侧指认了这张卡，卡侧 来源原话 里就必须有它
    for 条 in _手动条们():
        if 卡id in [str(x).upper() for x in (条.get("关联卡") or [])]:
            键 = str(条.get("键") or "")
            if 键 and 键 not in 原话们:
                return ("绑定不一致（疑似手写冒充）：原话 %s 关联了卡 %s，但卡侧 来源原话 里没有这条"
                        % (键, 卡id))
    try:
        for 键, 项 in ((_备注表() or {}).items()):
            if not isinstance(项, dict):
                continue
            if 卡id in [str(x).upper() for x in (项.get("关联卡") or [])]:
                if str(键) not in 原话们:
                    return ("绑定不一致（疑似手写冒充）：原话 %s 关联了卡 %s，但卡侧 来源原话 里没有这条"
                            % (键, 卡id))
    except Exception:
        pass
    return ""


def _cmd_任务建卡(参数, 来源):
    标题 = _取参数(参数, "标题")
    if not 标题:
        return _失败("缺参数：标题")
    # 【原话锁R3·2026-10-31】先有老板原话才许建卡。身份来自执行层（界面进程/凭证），不看参数：
    # 界面入口允许自动绑「最近一条人类原话」（库空时把界面输入记成一条原话）；
    # CLI/AI 一律必须自带真原话，且手动原话必须是人类来路（界面/令牌）。
    原话们 = _拆原话们((参数 or {}).get("原话"))
    人路 = "" if str(来源 or "").strip() == "CLI" else str(来源 or "")
    怎么补 = ("——先由界面补录原话（界面里点「确认这句是原话」当场生效），"
              "再由 原话.建卡 或本命令带 原话=… 建卡")
    if not 原话们 and 人路:
        键 = _最近人类原话() or _界面自动原话(标题, 来源, "")
        原话们 = [键] if 键 else []
    if not 原话们:
        return _失败("缺少人类原话：建任务卡必须先给一句老板原话"
                     "（原话=2026-10-31#012 或 原话=手动#003，多条用、或,分隔）" + 怎么补)
    错 = _校验原话们(原话们, 人路)
    if 错:
        return _失败("缺少人类原话：%s%s" % (错, 怎么补))
    if 人路 == "网页·远程":
        for 条 in 原话们:
            _留痕原话(条, "", 来源)
        公共.日志("远程放行：建卡 标题=%s 原话=%s 通道=%s 时刻=%s"
                  % (标题, "、".join(原话们), 来源, 公共.现在全()), "放行")
    卡id, 卡 = 任务卡库.建卡(
        标题,
        详情=_取参数(参数, "详情", ""),
        负责人=_取参数(参数, "负责人", ""),
        优先级=_取参数(参数, "优先级", ""),
        截止=_取参数(参数, "截止", ""),
        来源=_取参数(参数, "来源", ""),
        谁=来源,
        分组=_取参数(参数, "分组", "未分类"),
        验收标准=_取参数(参数, "验收标准", ""),
        来源原话=原话们,
    )
    关联失败 = []
    for 条 in 原话们:
        try:
            好, 说 = 原话解析.关联卡(条, 卡id, 来源)
            if not 好:
                关联失败.append("%s：%s" % (条, 说))
        except Exception as 错:
            关联失败.append("%s：%s" % (条, 错))
    if 关联失败:
        return _失败("卡已建（%s）但原话侧关联失败：%s" % (卡id, "；".join(关联失败)),
                     {"卡": 卡, "原话": 原话们})
    return _成功({"卡": 卡, "原话": 原话们},
                "已建卡 %s 并关联人类原话 %d 条" % (卡id, len(原话们)))


def _cmd_任务改状态(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    # 2026-10-26 老板口径：`到` 与 `状态` 两个键都收（总管用 状态=在做 也该成功）
    到 = _取参数(参数, "到") or _取参数(参数, "状态")
    if not 卡id:
        return _失败("缺参数：卡（例 卡=T0042）")
    if not 到:
        return _失败("缺参数：到/状态（两个键名都认；实际收到：%r）"
                     "（例 卡=T0042 到=已完成 或 状态=在做）" % (参数 or {}))
    好, 说明 = 任务卡库.改状态(卡id, 到, 来源)
    return (_成功({"卡": 卡id, "到": 到}, 说明) if 好 else _失败(说明))


def _cmd_任务换负责人(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    号 = _取参数(参数, "号")
    if not 卡id:
        return _失败("缺参数：卡")
    名表 = {人.get("终身号"): 人.get("会话名", "") for 人 in 采集器.读状态().get("员工", [])}
    if 号 and 号 not in 名表:
        return _失败("负责人候选里没有 %s（只允许选员工表里的人）" % 号)
    好, 说明 = 任务卡库.换负责人(卡id, 号, 名表.get(号, ""), 来源)
    return (_成功({"卡": 卡id, "号": 号}, 说明) if 好 else _失败(说明))


def _cmd_任务加备注(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    话 = _取参数(参数, "话")
    if not 卡id or not 话:
        return _失败("缺参数：卡 / 话")
    好, 说明 = 任务卡库.加备注(卡id, 话, 来源)
    return (_成功({"卡": 卡id}, 说明) if 好 else _失败(说明))


def _cmd_任务删卡(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    if not 卡id:
        return _失败("缺参数：卡")
    好, 说明 = 任务卡库.删卡(卡id, 来源)
    return (_成功({"卡": 卡id}, 说明) if 好 else _失败(说明))


def _cmd_任务归档(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    if not 卡id:
        return _失败("缺参数：卡")
    好, 说明 = 任务卡库.归档(卡id, 来源)
    return (_成功({"卡": 卡id}, 说明) if 好 else _失败(说明))


def _手动路径():
    """手动原话文件路径（每次现算：切沙盒后不会写错地方）。"""
    return os.path.join(公共.取路径("数据目录"), "手动原话.json")


def _读手动():
    d = 公共.读json(_手动路径(), {}) or {}
    if not isinstance(d, dict):
        d = {}
    d.setdefault("序号", 0)
    if not isinstance(d.get("条"), list):
        d["条"] = []
    return d


def _写手动(d):
    公共.原子写json(_手动路径(), d)


def _备注表():
    """原话备注库（原话.备注 / 原话.关联卡 都写在这里），手动原话也叠加它。"""
    路径 = 原话解析.备注路径()
    原 = 公共.读json(路径, {}) or {}
    if isinstance(原, dict) and isinstance(原.get("条"), dict):
        return 原["条"]
    return 原 if isinstance(原, dict) else {}


def _手动条们():
    表 = _读手动()
    备 = _备注表()
    出 = []
    for x in (表.get("条") or []):
        键 = str(x.get("键") or "")
        叠 = 备.get(键) if isinstance(备.get(键), dict) else {}
        关联 = x.get("关联卡") or (叠.get("关联卡") if isinstance(叠, dict) else []) or []
        出.append({
            "键": 键, "序号": str(x.get("序号") or ""), "时刻": x.get("时刻", ""),
            "摘要": x.get("摘要", ""), "全文": x.get("全文", "") or x.get("摘要", ""),
            "备注": (叠.get("备注") if isinstance(叠, dict) else "") or x.get("备注", ""),
            "关联卡": list(关联 or []), "落实": "已落实" if 关联 else "未落实",
            "灯": "红" if not 关联 else "绿", "模式": "手动",
            "来源": str(x.get("来源") or ""),
        })
    return 出


def 原话第二渠道():
    """【接入点·未开发】老板确认后再接「第二个查询渠道」。
    预期返回与 _手动条们()/原话解析.合并() 同形：条列表（键/序号/时刻/摘要/全文/备注/关联卡）。
    现在恒返回 []，且开关在配置 `第二个查询渠道.启用`。"""
    return []


def _cmd_原话列表(参数, 来源):
    日 = _取参数(参数, "日", 公共.今天前缀())
    自动 = bool((公共.读配置() or {}).get("原话自动渠道", True))
    if not 自动:
        条们 = _手动条们()
        已派 = len([x for x in 条们 if x.get("关联卡")])
        统计 = {"日": "手动", "总数": len(条们), "已派": 已派, "未派": len(条们) - 已派,
                "待派": len(条们) - 已派, "闲聊": 0, "已关联卡": 已派, "已验收": 0,
                "覆盖率": round(已派 * 100.0 / len(条们), 1) if 条们 else 0.0,
                "落实率": 0.0, "灯": "红" if len(条们) - 已派 else "绿",
                "口径": "手动录入模式：原话来自网页/Tk 输入；自动渠道已暂停"}
        return _成功({"条": 条们, "统计": 统计, "模式": "手动", "表文件": _手动路径()},
                    "手动原话 %d 条（自动渠道已暂停）" % len(条们))
    结果 = 原话解析.合并(日)
    if 结果.get("错误"):
        return _失败(结果["错误"], 结果)
    # N7 双向互查：把「卡片.来源原话」里挂到本条的原话也算进 关联卡（含旧卡迁移值）
    卡们 = 任务卡库.读().get("卡", [])
    for 条 in (结果.get("条") or []):
        键 = str(条.get("键") or "")
        已有 = set(str(x) for x in (条.get("关联卡") or []))
        增 = []
        for 卡 in 卡们:
            if 键 and 键 in (卡.get("来源原话") or []) and 卡.get("id") not in 已有:
                增.append(卡.get("id"))
        if 增:
            条["关联卡"] = list(条.get("关联卡") or []) + 增
            条["卡"] = list(条.get("卡") or []) + [
                {"id": i, "状态": next((c.get("状态") for c in 卡们 if c.get("id") == i), "")}
                for i in 增]
            条["已落实"] = True
    return _成功(结果, "共 %d 条（表文件 %s）" % (len(结果["条"]), os.path.basename(结果["表文件"])))


def _cmd_原话备注(参数, 来源):
    条 = _取参数(参数, "条")
    话 = _取参数(参数, "话")
    if not 条 or not 话:
        return _失败("缺参数：条 / 话")
    if "#" not in 条:
        return _失败("条格式应为 日期#序号，如 2026-10-25#042")
    好, 说明 = 原话解析.写备注(条, 话, 来源)
    return (_成功({"条": 条}, 说明) if 好 else _失败(说明))


def _cmd_原话关联卡(参数, 来源):
    条 = _取参数(参数, "条")
    卡id = _取参数(参数, "卡").upper()
    if not 条 or not 卡id:
        return _失败("缺参数：条 / 卡")
    好, 说明 = 原话解析.关联卡(条, 卡id, 来源)
    return (_成功({"条": 条, "卡": 卡id}, 说明) if 好 else _失败(说明))


def _cmd_原话建卡(参数, 来源):
    """从一句原话一键建卡：标题取摘要，来源写 原话#NNN，建完自动关联。"""
    条 = _取参数(参数, "条")
    if not 条 or "#" not in 条:
        return _失败("缺参数：条（形如 2026-10-25#042 或 手动#001）")
    人路 = "" if str(来源 or "").strip() == "CLI" else str(来源 or "")
    if str(条).startswith("手动#") and not 人路:
        return _失败("手动原话只能在界面里建卡（签名在界面内存，CLI 无法验证；文件里的 来源 不算数）；"
                     "AI 请用流水账 日期#序号 原话，或走 任务.建卡 带 原话=…")
    if str(条).startswith("手动#"):
        项 = next((x for x in _手动条们() if x.get("键") == 条), None)
        if 项 is None:
            return _失败("没有这条手动原话：%s" % 条)
        摘要 = 项["摘要"].rstrip("…").strip()
        标题 = _取参数(参数, "标题", "") or (摘要 if len(摘要) <= 60 else 摘要[:60] + "…")
        详情 = _取参数(参数, "详情", "") or (项.get("全文") or 项["摘要"])
        卡id, 卡 = 任务卡库.建卡(标题, 详情=详情, 来源="手动原话#%s" % 项["序号"],
                            负责人=_取参数(参数, "负责人", ""), 谁=来源, 来源原话=[条])
        好, 关联说明 = 原话解析.关联卡(条, 卡id, 来源)
        if not 好:
            return _失败("卡已建（%s）但关联失败：%s" % (卡id, 关联说明), {"卡": 卡})
        return _成功({"卡": 卡, "条": 条}, "已建卡 %s 并关联到 %s" % (卡id, 条))
    日, 序号 = 条.split("#", 1)
    表, 错误 = 原话解析.读表(日)
    if 错误:
        return _失败(错误)
    目标 = None
    for 行 in 表:
        if 行["序号"] == 序号.zfill(3):
            目标 = 行
            break
    if 目标 is None:
        return _失败("流水账里没有第 %s 条（%s）" % (序号, 日))
    摘要 = 目标["摘要"].rstrip("…").strip()
    标题 = _取参数(参数, "标题", "") or (摘要 if len(摘要) <= 60 else 摘要[:60] + "…")
    详情 = _取参数(参数, "详情", "") or (原话解析.取全文(日, 序号) or 目标["摘要"])
    卡id, 卡 = 任务卡库.建卡(
        标题, 详情=详情, 来源="原话#%s" % 序号.zfill(3),
        负责人=_取参数(参数, "负责人", ""), 谁=来源,
        来源原话=[条])
    好, 关联说明 = 原话解析.关联卡(条, 卡id, 来源)
    if not 好:
        return _失败("卡已建（%s）但关联失败：%s" % (卡id, 关联说明), {"卡": 卡})
    return _成功({"卡": 卡, "条": 条}, "已建卡 %s 并关联到 %s" % (卡id, 条))


def _拆原话们(值):
    """把「日#序号、日#序号」拆成列表（也收 list）。"""
    if isinstance(值, (list, tuple)):
        原 = 值
    else:
        s = str(值 or "")
        for 分隔 in ("，", "；", ";", "|", "、", " "):
            s = s.replace(分隔, ",")
        原 = s.split(",")
    return [str(x).strip() for x in 原 if str(x).strip()]


def _cmd_任务关联原话(参数, 来源):
    """把一张卡关联到若干条原话（可多张）；双向：卡.来源原话 + 原话.关联卡 都写。"""
    卡id = _取参数(参数, "卡").upper()
    条们 = _拆原话们((参数 or {}).get("条们") or (参数 or {}).get("条"))
    if not 卡id:
        return _失败("缺参数：卡")
    if not 条们:
        return _失败("缺参数：条们（形如 2026-10-25#042、2026-10-25#043）")
    for 条 in 条们:
        if "#" not in 条:
            return _失败("原话ID格式应为 日期#序号：%s" % 条)
    if str(来源 or "").strip() == "CLI" and any(str(x).startswith("手动#") for x in 条们):
        return _失败("手动原话只能在界面里关联（签名在界面内存，CLI 无法验证）——"
                     "AI 请用流水账 日期#序号 原话")
    好, 说明 = 任务卡库.设来源原话(卡id, 条们, 来源)
    if not 好:
        return _失败(说明)
    关联失败 = []
    for 条 in 条们:
        try:
            好2, 说2 = 原话解析.关联卡(条, 卡id, 来源)
            if not 好2:
                关联失败.append("%s：%s" % (条, 说2))
        except Exception as 错:
            关联失败.append("%s：%s" % (条, 错))
    数据 = {"卡": 卡id, "条们": 条们, "关联失败": 关联失败}
    if 关联失败:
        return _失败(说明 + "；原话侧关联失败：" + "；".join(关联失败), 数据)
    return _成功(数据, 说明)


def _日期们():
    import re as _re
    出 = []
    try:
        目录 = 原话解析.原话目录()
        for 名 in os.listdir(目录):
            m = _re.match(r"^(?:老板原话流水账|原话流水账|原话台账)_(\d{4}-\d{2}-\d{2})\.md$", 名)
            if m:
                出.append(m.group(1))
    except Exception:
        pass
    return sorted(set(出))


def _cmd_任务补来源原话(参数, 来源):
    """存量旧卡批量补来源原话：能从「来源」里的 原话#NNN 对上就补成 日#NNN，
    对不上（或没有来源）一律写「无对应原话」。"""
    卡们 = 任务卡库.读().get("卡", [])
    日期们 = _日期们()
    改了, 无对应 = 0, 0
    for 卡 in 卡们:
        if 卡.get("来源原话"):
            continue
        s = str(卡.get("来源") or "")
        键 = ""
        序 = ""
        if "原话#" in s:
            序 = s.split("原话#", 1)[1].strip().split()[0][:3]
            if 序.isdigit():
                命中 = []
                for 日 in 日期们:
                    表, 错 = 原话解析.读表(日)
                    if 错:
                        continue
                    if any(str(行.get("序号") or "") == 序.zfill(3) for 行 in 表):
                        命中.append(日)
                if len(命中) == 1:
                    键 = "%s#%s" % (命中[0], 序.zfill(3))
        新值 = [键] if 键 else ["无对应原话"]
        任务卡库.设来源原话(卡.get("id"), 新值, 来源)
        改了 += 1
        if not 键:
            无对应 += 1
    return _成功({"改了": 改了, "无对应原话": 无对应}, 
                "补来源原话：改动 %d 张（其中标「无对应原话」%d 张）" % (改了, 无对应))


def _cmd_原话新建手动(参数, 来源):
    文 = str((参数 or {}).get("文") or (参数 or {}).get("正文") or "").strip()
    if not 文:
        return _失败("缺参数：文（原话正文不能为空）")
    # 【原话锁R4·2026-10-31 老板令】CLI 永远没有人身份：不管带什么令牌/参数，一律不认。
    # 人这条路只能从界面进程内部走（界面里点「确认这句是原话」当场生效）。
    人路 = "" if str(来源 or "").strip() == "CLI" else str(来源 or "")
    if not 人路:
        公共.日志("冒充告警：命令=原话.新建手动 从 CLI 栏截人类原话（参数=%s）→ 拒绝"
                  % "、".join(sorted(参数.keys())), "警告")
        return _失败("AI 不能自造人类原话：CLI 没有人身份，令牌一律不认（R4 收口："
                     "本进程没有界面会话＝正确拦截）。补录历史原话请到界面里点"
                     "「确认这句是原话」当场录入。")
    来路 = "界面"
    录入人 = 人路
    表 = _读手动()
    表["序号"] = int(表.get("序号") or 0) + 1
    序 = "%03d" % 表["序号"]
    键 = "手动#%s" % 序
    条 = {"键": 键, "序号": 序, "时刻": 公共.现在全(),
          "摘要": (文.splitlines()[0] if 文.splitlines() else 文)[:120],
          "全文": 文, "备注": "", "关联卡": [], "来源": 来路}
    表.setdefault("条", []).append(条)
    _写手动(表)
    if 人路 == "网页·远程":
        _留痕原话(键, 录入人, 来源 or "")
    公共.日志("原话放行：条=%s 来路=%s 通道=%s 正文=%d字"
              % (键, 来路, 来源, len(文)), "放行")
    return _成功({"条": 条}, "已新建手动原话 %s（%d 字，来路=%s）" % (键, len(文), 来路))


def _cmd_原话统计(参数, 来源):
    日 = _取参数(参数, "日", 公共.今天前缀())
    统计 = 原话解析.统计(日)
    return _成功(统计, "今日原话 %d 条 · 已派 %d · 未派 %d · 已验收 %d"
                % (统计["总数"], 统计["已派"], 统计["未派"], 统计["已验收"]))


def _cmd_分组列表(参数, 来源):
    组们 = 任务卡库.分组们()
    卡们 = 任务卡库.读().get("卡", [])
    计数 = {g: 0 for g in 组们}
    for c in 卡们:
        g = c.get("分组") or "未分类"
        计数[g] = 计数.get(g, 0) + 1
    行 = [{"分组": g, "卡数": 计数.get(g, 0)} for g in 组们]
    return _成功({"分组": 行, "总数": len(卡们)}, "共 %d 个分组" % len(行))


def _cmd_分组新建(参数, 来源):
    名 = _取参数(参数, "名")
    if not 名:
        return _失败("缺参数：名")
    好, 说明 = 任务卡库.新建分组(名, 来源)
    return (_成功({"名": 名}, 说明) if 好 else _失败(说明))


def _cmd_分组改名(参数, 来源):
    旧, 新 = _取参数(参数, "旧"), _取参数(参数, "新")
    if not 旧 or not 新:
        return _失败("缺参数：旧 / 新")
    好, 说明 = 任务卡库.改名分组(旧, 新, 来源)
    return (_成功({"旧": 旧, "新": 新}, 说明) if 好 else _失败(说明))


def _cmd_分组删除(参数, 来源):
    名 = _取参数(参数, "名")
    if not 名:
        return _失败("缺参数：名")
    好, 说明 = 任务卡库.删分组(名, 来源)
    return (_成功({"名": 名}, 说明) if 好 else _失败(说明))


def _cmd_任务换分组(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    组 = _取参数(参数, "分组")
    if not 卡id:
        return _失败("缺参数：卡")
    好, 说明 = 任务卡库.设分组(卡id, 组, 来源)
    return (_成功({"卡": 卡id, "分组": 组 or "未分类"}, 说明) if 好 else _失败(说明))


# ---------------------------------------------------------------- P62 派工单（三级：原话→任务卡→派工单）

def _派工单路径():
    return os.path.join(公共.取路径("数据目录"), "派工单.json")


单状态们 = ("待发", "已派", "已受理", "已回复", "已完成", "已退回")
单类型们 = ("派工", "返工")
验收态们 = ("待验收", "合格", "不合格", "不满意", "退回整改")
完成程度们 = ("已完成", "部分完成", "申请延期", "无法执行", "需求待确认")
叮嘱库 = [
    "先读 AI 编程通用提示词（清单系统 1.0 S27；网页版开发规范 S35）再开工",
    "记得要抢文件锁，改完立刻释放",
    "写完必回读校验，别只看写入回显",
    "改动要版本 +0.01 并写维护记录",
    "复制/移动前先备份真源，别留 BAK 残留",
    "测试数据用完只按卡号单删，不整库遍历",
    "交付必须附证据（截图 + 命令原文）",
    "遇到协议/契约不许猜，先查架构书或发邮件问",
]
单状态们 = ("待发", "已派", "已受理", "已回复", "已完成", "已退回")
单流转 = {
    "待发": ("已派", "已退回"),
    "已派": ("已受理", "已回复", "已完成", "已退回"),
    "已受理": ("已回复", "已完成", "已退回"),
    "已回复": ("已完成", "已退回"),
    "已完成": (),
    "已退回": ("待发",),
}


def _读派工单():
    d = 公共.读json(_派工单路径(), {}) or {}
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 1)
    # P1-B-1（2-1b）：老文件没 账号/端点 也要读得进
    d.setdefault("账号", "")
    d.setdefault("端点", "")
    d.setdefault("序号", 0)
    if not isinstance(d.get("单"), list):
        d["单"] = []
    for 单 in d["单"]:
        if isinstance(单, dict):
            补单结构(单)
    return d


def _写派工单(d):
    d["版本"] = 1
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {"版本": d["版本"], "账号": d["账号"], "端点": d["端点"], "更新": d["更新"]}
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_派工单路径(), d)


# ---------------------------------------------------------------- P4 派工单新模型（子态 + 令牌）

def 补单结构(单):
    """老单补齐新子结构（读容忍；已有的值一律不覆盖）。旧 `状态` 六值只在首次补结构时映射成子态。"""
    首次 = "投递" not in 单
    单.setdefault("批次", "")
    单.setdefault("来源卡", "")
    单.setdefault("类型", "派工")
    单.setdefault("引用单", "")
    单.setdefault("正文", "")
    单.setdefault("验收标准", "")
    单.setdefault("叮嘱", [])
    单.setdefault("交付文件夹", 单.get("交付夹") or "")
    单.setdefault("预估完成", 单.get("预估") or "")
    单.setdefault("发单方", {})
    if not isinstance(单.get("收件人"), list):
        单["收件人"] = [str(单.get("收件人"))] if 单.get("收件人") else []
    if not isinstance(单.get("派工对象"), dict):
        单["派工对象"] = {}
    if not 单["派工对象"].get("会话名") and 单.get("收件人"):
        单["派工对象"].update({"会话名": 单["收件人"][0], "终身号": "",
                            "所属电脑": "", "软件类型": ""})
    单.setdefault("投递", {"状态": "未投递", "尝试": 0, "时刻": "", "方式": "",
                        "错误": "", "历史": []})
    单.setdefault("接单", {"状态": "未接单", "时刻": "", "方式": ""})
    单.setdefault("回复", {"状态": "未回复", "时刻": "", "次数": 0, "完成程度": "",
                        "备注": "", "异常备注": "", "提交人": "", "附件": [], "历史": []})
    单.setdefault("阅读", {"状态": "—", "时刻": "", "阅读人": "", "端点": ""})
    单.setdefault("闭环", {"状态": "未闭环", "时刻": "", "确认人": ""})
    单.setdefault("作废", {"状态": "未作废", "时刻": "", "原因": "", "作废人": ""})
    单.setdefault("时间戳", {})
    for 键 in ("创建", "投递", "接单", "回复", "阅读", "闭环", "作废", "最近操作"):
        单["时间戳"].setdefault(键, 单.get("创建", "") if 键 == "创建" else "")
    单.setdefault("事件", [])
    单.setdefault("备注", [])
    单.setdefault("催办", [])
    单.setdefault("异常备注", [])
    单.setdefault("提醒记录", [])
    if 首次:
        旧 = str(单.get("状态") or "待发")
        if 旧 in ("已派", "已受理", "已回复", "已完成"):
            单["投递"].update({"状态": "成功", "时刻": 单.get("发出", "")})
        if 旧 == "已受理":
            单["接单"].update({"状态": "已接单", "时刻": 单.get("创建", "")})
        if 旧 in ("已回复", "已完成"):
            单["回复"]["状态"] = "已回复"
        if 旧 == "已完成":
            单["阅读"].update({"状态": "已阅读", "时刻": 单.get("创建", "")})
            单["闭环"].update({"状态": "已闭环", "时刻": 单.get("创建", "")})
        if 旧 == "已退回":
            单["作废"].update({"状态": "作废", "时刻": 单.get("创建", ""),
                            "原因": "迁移自旧「已退回」"})
    单["状态"] = _整体状态(单)[0]
    return 单


def _找单(表, 单号):
    号 = str(单号 or "").strip().upper()
    return next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 号), None)


def _留事件(单, 谁, 动作):
    单.setdefault("事件", []).append({"ts": 公共.现在全(), "谁": 谁 or "系统", "动作": 动作})
    单.setdefault("时间戳", {})["最近操作"] = 公共.现在全()


def _整体状态(单):
    """(存值, 展示词)。展示词只此一处算（V2 §4.2）；`单状态们` 六值不加不改。"""
    if str((单.get("作废") or {}).get("状态")) == "作废":
        return "已退回", "退回"
    if str((单.get("闭环") or {}).get("状态")) == "已闭环":
        return "已完成", "已闭环"
    if str((单.get("回复") or {}).get("状态")) == "已回复":
        if str((单.get("阅读") or {}).get("状态")) == "已阅读":
            return "已回复", "已阅读"
        return "已回复", "已回复"
    if str((单.get("接单") or {}).get("状态")) == "已接单":
        return "已受理", "已接单"
    if str((单.get("投递") or {}).get("状态")) == "成功":
        return "已派", "待接单"
    return "待发", "待接单"


def _派工令牌路径():
    return os.path.join(公共.取路径("数据目录"), "派工单令牌.json")


def _读令牌表():
    d = 公共.读json(_派工令牌路径(), None)
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 1)
    d.setdefault("账号", 公共.取路径("账号"))
    d.setdefault("端点", 公共.取路径("端点"))
    d.setdefault("更新", 公共.现在全())
    if not isinstance(d.get("令牌"), list):
        d["令牌"] = []
    return d


def _写令牌表(d):
    d["版本"] = 1
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {"版本": d["版本"], "账号": d["账号"], "端点": d["端点"], "更新": d["更新"]}
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_派工令牌路径(), d)


def _令牌哈希(明文, 单号):
    return hashlib.sha256((str(明文) + str(单号)).encode("utf-8")).hexdigest()


def _令牌过期(天=7):
    return (datetime.datetime.now() + datetime.timedelta(days=天)).strftime("%Y-%m-%d %H:%M:%S")


def _原话参考(卡):
    """把任务卡的 来源原话 取回原文（手动#NNN / 日期#序号），供派工单参考。"""
    出 = []
    for 键 in (卡 or {}).get("来源原话") or []:
        键 = str(键 or "").strip()
        if not 键:
            continue
        文 = ""
        时 = ""
        if 键.startswith("手动#"):
            for x in _手动条们():
                if x.get("键") == 键:
                    文 = x.get("全文") or x.get("摘要") or ""
                    时 = x.get("时刻") or ""
                    break
        elif "#" in 键:
            日, 序 = 键.rsplit("#", 1)
            try:
                文 = 原话解析.取全文(日, 序) or ""
            except Exception:
                文 = ""
        出.append({"键": 键, "文": 文, "时": 时})
    return 出


def _单全文(单, 卡):
    """派工单发给对方的全文：老板原话 / 总管拆解的任务卡 / 你负责的派工单，三段标清楚。"""
    收 = 单.get("收件人") or []
    卡 = 卡 or {}
    段 = ["【派工单 %s】" % 单.get("单号"),
          "收件人：%s" % "、".join(收),
          "类型：%s%s" % (单.get("类型") or "派工",
                         ("（引用原单 %s）" % 单.get("引用单")) if 单.get("引用单") else ""),
          "时间：%s" % 公共.现在全(),
          "",
          "【一、老板的原话】（原样照录，只作参考依据；与任务卡冲突时以任务卡为准）"]
    原话们 = _原话参考(卡)
    if 原话们:
        for 项 in 原话们:
            段.append("· %s%s" % (项["键"], ("（%s）" % 项["时"]) if 项["时"] else ""))
            段.append(项["文"] if 项["文"] else "（原文库找不到这条，只有编号）")
    else:
        段.append("（本卡未关联原话，直接看任务卡）")
    段 += ["",
          "【二、总管拆解的任务卡】（%s；状态：%s%s）" % (
              单.get("来源卡"), 卡.get("状态", "未知"),
              ("；验收标准：" + str(卡.get("验收标准"))) if str(卡.get("验收标准") or "").strip() else ""),
          "标题：%s" % (卡.get("标题", "") or "（无）"),
          "详情：", str(卡.get("详情", "") or "（无）"),
          "",
          "【三、你负责的派工单】（下面这段才是要你干的活）",
          str(单.get("正文", "") or "")]
    验收文 = str(单.get("验收标准") or "").strip()
    if 验收文:
        段 += ["", "【验收标准】（完成到什么程度才算合格）", 验收文]
    if 单.get("叮嘱"):
        段 += ["", "【叮嘱】"] + ["- " + str(x) for x in (单.get("叮嘱") or [])]
    段 += ["", "【回单说明】",
          "1. 先读 AI 编程通用提示词（清单系统 1.0 S27；网页版开发规范 S35）再开工",
          "2. 本系统 CLI 入口：AI工作台CLI.py（参数格式 键=值，如 卡=T0001）",
          "3. 凭本单号 %s 操作：交稿 / 验收 / 留言" % 单.get("单号"),
          "4. 命令模板：",
          "   派工单.交稿 单=%s 证据=… 谁=<你的终身号>" % 单.get("单号"),
          "   派工单.验收 单=%s 结论=合格 话=… 谁=<验收人>" % 单.get("单号"),
          "   派工单.留言 单=%s 话=… 谁=<你的终身号>" % 单.get("单号")]
    return "\n".join(段)


def _cmd_派工单新建(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    收 = _派工收件人(参数)
    文 = _派工正文(参数)
    验收 = str((参数 or {}).get("验收标准") or "").strip()
    类型 = str((参数 or {}).get("类型") or "派工").strip() or "派工"
    引用 = str((参数 or {}).get("引用单") or "").strip().upper()
    if 类型 not in 单类型们:
        return _失败("单类型非法：%s（只允许 派工/返工）" % 类型)
    if 类型 == "返工" and not 引用:
        return _失败("返工单必须引用原单号（引用单=G0001）")
    叮嘱们 = []
    原叮嘱 = (参数 or {}).get("叮嘱")
    if isinstance(原叮嘱, list):
        叮嘱们 = [str(x).strip() for x in 原叮嘱 if str(x).strip()]
    elif 原叮嘱:
        缓 = str(原叮嘱)
        for 分隔 in ("|", "；", ";"):
            缓 = 缓.replace(分隔, "\n")
        叮嘱们 = [x.strip() for x in 缓.splitlines() if x.strip()]
    if not 卡id:
        return _失败("缺少任务卡片：缺参数：卡（先建任务卡，再开派工单；例 卡=T0001）")
    if not 收:
        return _失败("缺参数：收件人（可多个，用、或,分隔）")
    if not 文:
        return _失败("缺参数：文（派工单正文）")
    if not 验收:
        return _失败("缺参数：验收标准（必填）")
    # P4-1：预估完成时间必填，且必须晚于当前时刻
    预估 = str((参数 or {}).get("预估") or (参数 or {}).get("预估完成") or "").strip()
    交付夹 = str((参数 or {}).get("交付夹") or (参数 or {}).get("交付文件夹") or "").strip()
    if not 预估:
        return _失败("缺参数：预估时间（必须晚于当前时刻，例 预估=2026-10-31 18:00:00）",
                     {"原因码": "bad_param"})
    预估时 = 公共.解析时间(预估)
    if 预估时 is None:
        return _失败("预估时间格式不对：%s（用 YYYY-MM-DD HH:MM:SS）" % 预估,
                     {"原因码": "bad_param", "实际收到": 预估})
    if 预估时 <= datetime.datetime.now():
        return _失败("预估时间必须晚于当前时刻（收到 %s）" % 预估,
                     {"原因码": "bad_param", "实际收到": 预估})
    # P4-3：派工对象若在本端白名单里登记了别的电脑 → cross_endpoint
    白 = {str(x.get("会话名") or "").strip(): x for x in (_读我的员工().get("员工") or [])}
    对象 = 白.get(收[0]) if 收 else None
    if 对象 and str(对象.get("所属电脑") or "").strip() != 端点名():
        return _失败("该员工在另一台电脑，本期不支持跨端点派工",
                     {"原因码": "cross_endpoint", "会话名": 收[0]})
    卡 = next((c for c in 任务卡库.读().get("卡", []) if c.get("id") == 卡id), None)
    if 卡 is None:
        return _失败("缺少任务卡片：卡号 %s 不存在（先建任务卡，再开派工单）" % 卡id)
    # P2（施工单 L286）：标签不齐 → 禁开派工单
    齐, 齐说 = 标签库.标签齐(卡)
    if not 齐:
        return _失败("该卡标签不全，补齐后才能开派工单：%s" % 齐说,
                     {"原因码": "tag_incomplete", "卡": 卡id})
    # 【制度锁·2026-10-27 老板令】一句老板原话→一张任务卡→一张派工单，缺一环开不出单：
    # 开单的卡必须已关联至少一句老板原话（卡.来源原话 或 原话侧「关联卡」反向查到，任一有即算）。
    原话们 = [str(x).strip() for x in (卡.get("来源原话") or []) if str(x).strip()]
    if not 原话们:
        # R6：卡侧没有、原话侧却有 → 属「绑定不一致」，不再自动补全（默认拒绝）
        反 = _反向原话(卡id)
        if 反:
            return _失败("制度锁：绑定不一致（疑似手写冒充）——原话 %s 关联了卡 %s，"
                         "但卡侧 来源原话 里没有这条（存量修复：由人在界面里用 "
                         "原话.关联卡 / 任务.关联原话 逐条重新绑定）" % ("、".join(反), 卡id))
        return _失败(
            "制度锁：来源卡 %s 未关联任何老板原话，开不出派工单——"
            "先补一句原话并关联（原话.新建手动 文=… → 原话.关联卡 条=… 卡=%s）再开单" % (卡id, 卡id))
    # R5：卡上的 来源原话 必须回账本核真（挡住手写 手动#999 这类冒充）
    验错 = _原话都存在(原话们)
    if 验错:
        return _失败("制度锁：来源卡 %s 的 来源原话 验不过——%s" % (卡id, 验错))
    # R6：再核双向一致性（挡住「原话存在但没绑这张卡」这类冒充）
    账错 = _双向对账(卡id, 原话们)
    if 账错:
        return _失败("制度锁：来源卡 %s ——%s" % (卡id, 账错))
    表 = _读派工单()
    表["序号"] = int(表.get("序号") or 0) + 1
    单号 = "G%04d" % 表["序号"]
    单 = {"单号": 单号, "来源卡": 卡id, "收件人": 收, "正文": 文, "验收标准": 验收, "叮嘱": 叮嘱们,
          "类型": 类型, "引用单": 引用,
          "预估完成": 预估, "交付文件夹": 交付夹,
          "批次": "B%s-%04d" % (time.strftime("%Y%m%d"), 表["序号"]),
          "发单方": {"终身号": 公共.取路径("账号"), "端点": 端点名(),
                   "软件类型": ""},
          "派工对象": {"会话名": 收[0] if 收 else "",
                    "终身号": str((对象 or {}).get("终身号") or ""),
                    "所属电脑": 端点名(),
                    "软件类型": str((对象 or {}).get("软件类型") or "")},
          "状态": "待发", "工作态": "待交稿", "验收态": "待验收",
          "创建": 公共.现在全(), "发出": "", "结果": [], "留言": [], "提醒记录": []}
    补单结构(单)
    表["单"].append(单)
    _写派工单(表)
    return _成功({"单": 单, "整体状态_展示": _整体状态(单)[1]},
                "已建派工单 %s（来源 %s，收件人 %d 个，预估 %s）"
                % (单号, 卡id, len(收), 预估))


def _cmd_派工单列表(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    单号 = _取参数(参数, "单").upper()
    状态筛 = _取参数(参数, "状态")
    角色 = str(_取参数(参数, "角色") or "").strip()          # 发出 / 收到
    阅读筛 = str(_取参数(参数, "阅读状态") or "").strip()      # 待查看 / 已阅读
    页 = _取参数(参数, "页")                                  # 只在给了 页 时才分页（老调用拿全量）
    表 = _读派工单()
    单们 = 表.get("单") or []
    if 状态筛:
        单们 = [x for x in 单们 if str(x.get("状态") or "") == str(状态筛).strip()]
    if 角色 == "收到":
        我 = 公共.取路径("账号")
        单们 = [x for x in 单们
              if str((x.get("派工对象") or {}).get("终身号") or "") == 我]
    elif 角色 == "发出":
        单们 = [x for x in 单们
              if not str((x.get("发单方") or {}).get("终身号") or "")
              or str((x.get("发单方") or {}).get("终身号")) == 公共.取路径("账号")]
    if 阅读筛:
        单们 = [x for x in 单们
              if str((x.get("阅读") or {}).get("状态") or "") == 阅读筛]
    卡库 = {c.get("id"): c for c in 任务卡库.读().get("卡", [])}
    if 卡id:
        单们 = [x for x in 单们 if str(x.get("来源卡") or "").upper() == 卡id]
    if 单号:
        单们 = [x for x in 单们 if str(x.get("单号") or "").upper() == 单号]
    单们 = sorted(单们, key=lambda x: str(x.get("单号") or ""))
    总数 = len(单们)
    每页 = 20
    总页 = max(1, (总数 + 每页 - 1) // 每页)
    页码 = 1
    if str(页 or "").strip():
        try:
            页码 = max(1, int(页))
        except Exception:
            页码 = 1
        页码 = min(页码, 总页)
        单们 = 单们[(页码 - 1) * 每页: 页码 * 每页]
    出 = []
    for x in 单们:
        卡 = 卡库.get(x.get("来源卡")) or {}
        存值, 展示 = _整体状态(x)
        出.append(dict(x, 回复=list(x.get("回复") or []),
                       工作态=str(x.get("工作态") or "待交稿"),
                       验收态=str(x.get("验收态") or "待验收"),
                       留言=list(x.get("留言") or []),
                       来源卡标题=卡.get("标题", ""),
                       验收标准=x.get("验收标准") or "",
                       来源原话=list(卡.get("来源原话") or []),
                       整体状态=存值, 整体状态_展示=展示,
                       投递状态=str((x.get("投递") or {}).get("状态") or "未投递"),
                       接单状态=str((x.get("接单") or {}).get("状态") or "未接单"),
                       回复状态=str((x.get("回复") or {}).get("状态") or "未回复"),
                       阅读状态=str((x.get("阅读") or {}).get("状态") or "—"),
                       预估完成=x.get("预估完成") or "",
                       派工对象名=str((x.get("派工对象") or {}).get("会话名") or "")))
    return _成功({"单": 出, "条数": len(出), "总数": 总数, "页": 页码, "总页": 总页,
                "每页": 每页, "角色": 角色, "状态集": list(单状态们)},
                "共 %d 张派工单%s%s%s" % (总数,
                                     ("（来源 %s）" % 卡id) if 卡id else "",
                                     ("（状态=%s）" % 状态筛) if 状态筛 else "",
                                     ("（第 %d/%d 页）" % (页码, 总页)) if str(页 or "").strip() else ""))


def _cmd_派工单发送(参数, 来源):
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单（如 P0001）")
    表 = _读派工单()
    单 = next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 单号), None)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号)
    卡 = next((c for c in 任务卡库.读().get("卡", []) if c.get("id") == 单.get("来源卡")), {})
    # P2（施工单 L286）：投递前同样校验 标签齐
    if 卡:
        齐, 齐说 = 标签库.标签齐(卡)
        if not 齐:
            return _失败("该单来源卡标签不全，补齐后才能投递：%s" % 齐说,
                         {"原因码": "tag_incomplete", "单": 单号, "卡": 卡.get("id")})
    # 【原话锁R3·2026-10-31】发送这环也要有原话：来源卡没原话就不许发。
    # 存量脏单（卡缺失/卡无原话）默认拦；唯一放行路＝界面发的一次性令牌（令牌绑定「存量放行：单号」），
    # 自填的 人工确认/录入人 一律不认（执行层已当冒充剥掉并告警）。
    卡id = str(单.get("来源卡") or "").upper()
    原话们 = [str(x).strip() for x in ((卡 or {}).get("来源原话") or []) if str(x).strip()]
    if not 原话们 and 卡 and 卡id:
        # R6：卡侧空、原话侧却有 → 绑定不一致，默认拒绝（不再自动补全）
        反 = _反向原话(卡id)
        if 反:
            return _失败("制度锁：绑定不一致（疑似手写冒充）——原话 %s 关联了卡 %s，"
                         "但卡侧 来源原话 里没有这条（存量修复：由人在界面里用 "
                         "原话.关联卡 / 任务.关联原话 逐条重新绑定）" % ("、".join(反), 卡id))
    # R5：发送这环同样回账本核真（手写 手动#999 一律拦）
    if 原话们:
        验错 = _原话都存在(原话们)
        if 验错:
            return _失败("制度锁：派工单 %s 的来源原话验不过——%s" % (单号, 验错))
        # R6：发送前再核一次双向一致性
        账错 = _双向对账(卡id, 原话们)
        if 账错:
            return _失败("制度锁：派工单 %s ——%s" % (单号, 账错))
    if not 原话们:
        原因 = ("缺少任务卡片：派工单 %s 的来源卡 %s 不存在（发不出去）" % (单号, 卡id)
                if not 卡 else
                "制度锁：来源卡 %s 未关联任何老板原话，派工单 %s 发不出去——先补原话并关联再发"
                % (卡id, 单号))
        # R4 收口：CLI 没有任何逃生口（原来那条「人工确认/令牌」都砍掉），存量单也一律拦。
        return _失败(原因 + "（存量单：在界面里补一句原话并关联该卡，再由界面发起）")
    员工们 = 采集器.读状态().get("员工", []) or []
    名表 = {str(人.get("会话名") or ""): 人 for 人 in 员工们}
    结果们, 成功 = [], 0
    全文 = _单全文(单, 卡)
    for 名 in (单.get("收件人") or []):
        号 = str((名表.get(名) or {}).get("终身号") or "")
        好, 说明 = _发到会话(名, 全文, 号)
        if 好:
            成功 += 1
        结果们.append({"收件人": 名, "终身号": 号, "ok": bool(好), "说明": (说明 or "")[:200]})
    单["结果"] = 结果们
    if 成功 == len(单.get("收件人") or []) and 成功:
        单["状态"] = "已派"
        单["发出"] = 公共.现在全()
    _写派工单(表)
    说明 = "派工单 %s：成功 %d / %d%s" % (
        单号, 成功, len(单.get("收件人") or []), ("，状态=已派" if 单["状态"] == "已派" else "，仍待派"))
    数据 = {"单": 单, "结果": 结果们, "成功": 成功}
    # 老板：发送后立刻采样每个收件人的排队条并写回共享库（TRAE 可能滞后，往后再以主动查询为准）
    采样 = []
    if 成功:
        号们 = [(str((名表.get(名) or {}).get("终身号") or ""), 名) for 名 in (单.get("收件人") or [])]
        try:
            采样 = _采样排队(号们, [])
        except Exception:
            采样 = []
        数据["采样排队"] = 采样
        说明 += "；发送后已采样排队条"
    return (_成功(数据, 说明) if 单["状态"] == "已派" else _失败(说明, 数据))


def _cmd_派工单回复(参数, 来源):
    """把工作结论写回一张派工单；状态 → 已回复，并同步把结论记到来源任务卡边上。"""
    单号 = _取参数(参数, "单").upper()
    话 = str((参数 or {}).get("话") or (参数 or {}).get("正文") or "").strip()
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    if not 单号:
        return _失败("缺参数：单")
    if not 话:
        return _失败("缺参数：话（回复正文不能为空）")
    表 = _读派工单()
    单 = next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 单号), None)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号)
    条 = {"时间": 公共.现在全(), "谁": 谁, "正文": 话}
    旧态 = str(单.get("状态") or "待发")
    新态 = str((参数 or {}).get("新状态") or (参数 or {}).get("状态") or "").strip() or "已回复"
    if 新态 not in 单状态们:
        return _失败("单状态非法：%s（只允许 %s）" % (新态, "/".join(单状态们)))
    # 2026-10-26 P64 老板口径：AI 回复时可直接把单置为任一合法状态（如 待发→已完成）
    单.setdefault("回复", []).append(条)
    单["状态"] = 新态
    _写派工单(表)
    卡id = str(单.get("来源卡") or "")
    # P64：AI 回复只写派工单，不改任务卡状态、也不往卡上写备注
    数据 = {"单": dict(单, 回复=list(单.get("回复") or [])),
            "回复数": len(单["回复"]), "卡": 卡id, "旧状态": 旧态, "新状态": 新态}
    return _成功(数据, "派工单 %s：%s→%s（回复 %d 条，%s）" % (
        单号, 旧态, 新态, len(单["回复"]), 谁))


def _留话(单, 谁, 身份, 话):
    单.setdefault("留言", []).append({"时间": 公共.现在全(), "谁": 谁, "身份": 身份, "正文": 话})


def _cmd_派工单交稿(参数, 来源):
    """接单方交稿：已受理→已回复；完成程度五选一必填；普通/异常备注分开落（P4-6/7/8a）。"""
    单号 = _取参数(参数, "单").upper()
    证据 = str((参数 or {}).get("证据") or (参数 or {}).get("话") or "").strip()
    完成 = str((参数 or {}).get("完成程度") or "").strip()
    普通 = str((参数 or {}).get("备注") or (参数 or {}).get("普通备注") or "").strip()
    异常 = str((参数 or {}).get("异常备注") or "").strip()
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    if not 单号:
        return _失败("缺参数：单", {"原因码": "bad_param"})
    if not 证据:
        return _失败("缺参数：证据（交稿要留工作证据）", {"原因码": "bad_param"})
    if 完成 not in 完成程度们:
        return _失败("完成程度必填：%s" % "/".join(完成程度们),
                     {"原因码": "bad_param", "实际收到": 完成})
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废，无法恢复。请重新开单。", {"原因码": "void_immutable"})
    if str(单["闭环"].get("状态")) == "已闭环":
        return _失败("这张单已闭环，不能再交稿。", {"原因码": "closed_immutable"})
    if str(单["投递"].get("状态")) != "成功":
        return _失败("这张单没投出去，对方还没收到。请先重投成功，再往下走。",
                     {"原因码": "deliver_failed"})
    if str(单["接单"].get("状态")) != "已接单":
        return _失败("还没点「已接单」，不能交稿（jump_step）。", {"原因码": "jump_step"})
    现在 = 公共.现在全()
    复 = 单["回复"]
    复["次数"] = int(复.get("次数") or 0) + 1
    复.update({"状态": "已回复", "时刻": 现在, "完成程度": 完成,
              "备注": 普通, "异常备注": 异常, "提交人": 谁})
    复.setdefault("历史", []).append({"ts": 现在, "完成程度": 完成, "备注": 普通,
                                  "异常备注": 异常, "证据": 证据})
    单["工作态"] = "已交稿"
    单["时间戳"]["回复"] = 现在
    if 异常:
        单.setdefault("异常备注", []).append({"ts": 现在, "单号": 单号,
                                         "类型": "异常", "内容": 异常, "提交人": 谁})
    _留话(单, 谁, "工作者", "【交稿·%s】%s" % (完成, 证据))
    _留事件(单, 谁, "提交交付：" + 完成)
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    return _成功({"单号": 单号, "完成程度": 完成, "回复": 复,
                "整体状态": _整体状态(单)[1], "异常备注条数": len(单.get("异常备注") or [])},
                "%s 已交稿（%s，留言 %d 条）" % (单号, 完成, len(单.get("留言") or [])))


def _cmd_派工单验收(参数, 来源):
    """验收者给结论：合格 / 不合格 / 退回整改，并追加验收留言。"""
    单号 = _取参数(参数, "单").upper()
    结论 = str((参数 or {}).get("结论") or "").strip()
    话 = str((参数 or {}).get("话") or "").strip() or 结论
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    if not 单号:
        return _失败("缺参数：单")
    if 结论 not in ("合格", "不合格", "不满意", "退回整改"):
        return _失败("验收结论非法：%s（只允许 合格/不合格/不满意/退回整改）" % (结论 or "（空）"))
    表 = _读派工单()
    单 = next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 单号), None)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号)
    单["验收态"] = 结论
    _留话(单, 谁, "验收者", "【验收·%s】%s" % (结论, 话))
    _写派工单(表)
    return _成功({"单号": 单号, "验收态": 结论, "留言数": len(单.get("留言") or [])},
                "%s 验收=%s（留言 %d 条）" % (单号, 结论, len(单["留言"])))


def _cmd_派工单提醒(参数, 来源):
    """一键提醒：把「请查看派工单 Gxxxx」插入每个收件人的会话。"""
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单")
    表 = _读派工单()
    单 = next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 单号), None)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号)
    收 = 单.get("收件人") or []
    if not 收:
        return _失败("这张单没有收件人")
    员工们 = 采集器.读状态().get("员工", []) or []
    名表 = {str(人.get("会话名") or ""): 人 for 人 in 员工们}
    卡 = next((c for c in 任务卡库.读().get("卡", []) if c.get("id") == 单.get("来源卡")), {})
    记录 = 单.setdefault("提醒记录", [])
    已有 = {str(x.get("收件人") or "") for x in 记录}
    结果们, 成功 = [], 0
    for 名 in 收:
        号 = str((名表.get(名) or {}).get("终身号") or "")
        # P65-A 判定：该单对该收件人「已有往来」→ 追加短提醒；否则首发全文
        有往来 = (名 in 已有) or bool(单.get("留言")) or bool(单.get("发出"))
        if 有往来:
            文本 = "请查看派工单 %s" % 单号
            类型 = "追加"
        else:
            文本 = _单全文(单, 卡) + "\n状态：%s　工作态：%s　验收态：%s" % (
                单.get("状态"), 单.get("工作态") or "待交稿", 单.get("验收态") or "待验收")
            类型 = "首发"
        好, 说明 = _发到会话(名, 文本, 号)
        if 好:
            成功 += 1
            记录.append({"收件人": 名, "时间": 公共.现在全(), "类型": 类型})
        结果们.append({"收件人": 名, "终身号": 号, "ok": bool(好), "类型": 类型,
                       "字数": len(文本), "说明": (说明 or "")[:200]})
    _写派工单(表)
    说明 = "提醒 %s：成功 %d / %d（%s）" % (
        单号, 成功, len(收), "、".join("%s=%s" % (x["收件人"], x["类型"]) for x in 结果们))
    数据 = {"单号": 单号, "结果": 结果们, "成功": 成功}
    return (_成功(数据, 说明) if 成功 == len(收) else _失败(说明, 数据))


def _cmd_叮嘱列表(参数, 来源):
    return _成功({"叮嘱": list(叮嘱库), "总数": len(叮嘱库)}, "叮嘱库 %d 张" % len(叮嘱库))


def _cmd_任务改详情(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    if not 卡id:
        return _失败("缺参数：卡")
    改 = {}
    for 键 in ("标题", "详情", "验收标准"):
        值 = (参数 or {}).get(键)
        if 值 is not None:
            改[键] = str(值)
    if not 改:
        return _失败("至少给 标题 / 详情 / 验收标准 之一")
    好, 说明 = 任务卡库.改内容(卡id, 改, 来源)
    return (_成功({"卡": 卡id, "改": list(改.keys())}, 说明) if 好 else _失败(说明))


def _cmd_派工单留言(参数, 来源):
    单号 = _取参数(参数, "单").upper()
    话 = str((参数 or {}).get("话") or "").strip()
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    if not 单号 or not 话:
        return _失败("缺参数：单 / 话")
    表 = _读派工单()
    单 = next((x for x in (表.get("单") or []) if str(x.get("单号") or "").upper() == 单号), None)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号)
    _留话(单, 谁, "留言", 话)
    _写派工单(表)
    return _成功({"单号": 单号, "留言数": len(单.get("留言") or [])}, "%s 已留言" % 单号)


# ---------------------------------------------------------------- P4 派工六命令

def _cmd_派工单投递(参数, 来源):
    """投递＝投递到会话；成功→状态=已派，失败→状态不动并记原文（V2 §3.1）。"""
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单（如 G0001）")
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废，无法恢复。请重新开单。", {"原因码": "void_immutable", "单": 单号})
    if str(单["闭环"].get("状态")) == "已闭环":
        return _失败("这张单已闭环，不能再投递。", {"原因码": "closed_immutable", "单": 单号})
    结果 = _cmd_派工单发送({"单": 单号}, 来源)
    表 = _读派工单()
    单 = _找单(表, 单号)
    投 = 单["投递"]
    投["尝试"] = int(投.get("尝试") or 0) + 1
    现在 = 公共.现在全()
    if 结果.get("ok"):
        投.update({"状态": "成功", "时刻": 现在, "方式": "总管命令", "错误": ""})
        投.setdefault("历史", []).append({"ts": 现在, "结果": "成功", "错误": ""})
        单["时间戳"]["投递"] = 现在
        _留事件(单, 来源, "投递成功")
    else:
        错 = str(结果.get("说明") or "")[:300]
        投.update({"状态": "失败", "错误": 错})
        投.setdefault("历史", []).append({"ts": 现在, "结果": "失败", "错误": 错})
        _留事件(单, 来源, "投递失败：" + 错)
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    回 = dict(结果 or {})
    数据 = dict(回.get("数据") or {})
    数据.update({"投递": 单["投递"], "整体状态": _整体状态(单)[1], "单号": 单号})
    回["数据"] = 数据
    return 回


def _cmd_派工单接单(参数, 来源):
    """接单：已派→已受理（未投递成功一律拒）。"""
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单")
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废，无法恢复。请重新开单。", {"原因码": "void_immutable"})
    if str(单["闭环"].get("状态")) == "已闭环":
        return _失败("这张单已闭环，不能再接单。", {"原因码": "closed_immutable"})
    if str(单["投递"].get("状态")) != "成功":
        return _失败("这张单没投出去，对方还没收到。请先重投成功，再往下走。",
                     {"原因码": "deliver_failed", "投递状态": 单["投递"].get("状态")})
    接 = 单["接单"]
    if str(接.get("状态")) == "已接单":
        return _成功({"单号": 单号, "接单": 接, "整体状态": _整体状态(单)[1]}, "已接过单")
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    现在 = 公共.现在全()
    接.update({"状态": "已接单", "时刻": 现在,
              "方式": str((参数 or {}).get("方式") or "登录态").strip() or "登录态"})
    单["时间戳"]["接单"] = 现在
    _留事件(单, 谁, "接单")
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    return _成功({"单号": 单号, "接单": 接, "整体状态": _整体状态(单)[1]},
                "%s 已接单" % 单号)


def _cmd_派工单已读(参数, 来源):
    """发单方标记已阅读（未回复一律拒；留痕 谁/何时/端点）。"""
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单")
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废。", {"原因码": "void_immutable"})
    if str(单["回复"].get("状态")) != "已回复":
        return _失败("对方还没提交交付，不能标记已阅读。", {"原因码": "not_replied"})
    阅 = 单["阅读"]
    if str(阅.get("状态")) == "已阅读":
        return _成功({"单号": 单号, "阅读": 阅, "整体状态": _整体状态(单)[1]}, "已标记过已阅读")
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    现在 = 公共.现在全()
    阅.update({"状态": "已阅读", "时刻": 现在, "阅读人": 谁, "端点": 端点名()})
    单["时间戳"]["阅读"] = 现在
    _留事件(单, 谁, "已阅读")
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    return _成功({"单号": 单号, "阅读": 阅, "整体状态": _整体状态(单)[1]},
                "%s 已标记已阅读" % 单号)


def _cmd_派工单闭环(参数, 来源):
    """闭环：已阅读→已完成（未读/投递失败一律拒）。"""
    单号 = _取参数(参数, "单").upper()
    if not 单号:
        return _失败("缺参数：单")
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废，无法恢复。请重新开单。", {"原因码": "void_immutable"})
    if str(单["投递"].get("状态")) != "成功":
        return _失败("这张单还没投递成功，不能闭环。请先重投，或直接作废。",
                     {"原因码": "deliver_failed"})
    闭 = 单["闭环"]
    if str(闭.get("状态")) == "已闭环":
        return _成功({"单号": 单号, "闭环": 闭, "整体状态": _整体状态(单)[1]}, "已闭环")
    if str(单["阅读"].get("状态")) != "已阅读":
        return _失败("还没标记已阅读，不能闭环。", {"原因码": "not_read"})
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    现在 = 公共.现在全()
    闭.update({"状态": "已闭环", "时刻": 现在, "确认人": 谁})
    单["验收态"] = "合格"
    单["时间戳"]["闭环"] = 现在
    _留事件(单, 谁, "闭环")
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    return _成功({"单号": 单号, "闭环": 闭, "整体状态": _整体状态(单)[1]},
                "%s 已闭环" % 单号)


def _cmd_派工单作废(参数, 来源):
    """作废＝终态；必须填原因；令牌立即失效。"""
    单号 = _取参数(参数, "单").upper()
    原因 = str((参数 or {}).get("原因") or "").strip()
    if not 单号:
        return _失败("缺参数：单")
    if not 原因:
        return _失败("作废必须填原因（原因=为什么作废）", {"原因码": "bad_param"})
    表 = _读派工单()
    单 = _找单(表, 单号)
    if 单 is None:
        return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
    if str(单["作废"].get("状态")) == "作废":
        return _失败("这张单已作废，无法恢复。请重新开单。", {"原因码": "void_immutable"})
    if str(单["闭环"].get("状态")) == "已闭环":
        return _失败("这张单已闭环，不能再作废。", {"原因码": "closed_immutable"})
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    现在 = 公共.现在全()
    单["作废"].update({"状态": "作废", "时刻": 现在, "原因": 原因, "作废人": 谁})
    单["时间戳"]["作废"] = 现在
    _留事件(单, 谁, "作废：" + 原因)
    单["状态"] = _整体状态(单)[0]
    _写派工单(表)
    # 令牌立即失效
    令牌表 = _读令牌表()
    for 记 in 令牌表.get("令牌") or []:
        if str(记.get("单号") or "").upper() == 单号:
            记.update({"作废": True, "作废时刻": 现在, "作废人": 谁})
    _写令牌表(令牌表)
    return _成功({"单号": 单号, "状态": "已退回", "作废": 单["作废"]},
                "%s 已作废（%s）" % (单号, 原因))


def _cmd_派工单令牌(参数, 来源):
    """令牌：生成／作废／校验。只存 sha256(明文+单号)，7 天，明文只在生成时回一次。"""
    动作 = str((参数 or {}).get("动作") or "生成").strip()
    单号 = _取参数(参数, "单").upper()
    if 动作 not in ("生成", "作废", "校验"):
        return _失败("动作只能是 生成/作废/校验", {"原因码": "bad_param"})
    表 = _读令牌表()
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    现在 = 公共.现在全()
    if 动作 == "生成":
        if not 单号:
            return _失败("缺参数：单", {"原因码": "bad_param"})
        单据 = _找单(_读派工单(), 单号)
        if 单据 is None:
            return _失败("派工单不存在：%s" % 单号, {"原因码": "not_found"})
        if str(单据["作废"].get("状态")) == "作废":
            return _失败("这张单已作废。", {"原因码": "void_immutable"})
        明文 = secrets.token_hex(16)
        记 = {"单号": 单号, "哈希": _令牌哈希(明文, 单号), "创建": 现在,
              "过期": _令牌过期(), "作废": False, "作废时刻": "", "作废人": "",
              "一次性": bool((参数 or {}).get("一次性")), "已用": False}
        表["令牌"] = [x for x in (表.get("令牌") or [])
                    if str(x.get("单号") or "").upper() != 单号] + [记]
        _写令牌表(表)
        return _成功({"单号": 单号, "令牌": 明文, "过期": 记["过期"], "链接": "/?t=" + 明文},
                    "已生成令牌（明文只显示这一次）")
    if 动作 == "作废":
        if not 单号:
            return _失败("缺参数：单", {"原因码": "bad_param"})
        记 = next((x for x in (表.get("令牌") or [])
                  if str(x.get("单号") or "").upper() == 单号), None)
        if 记 is None:
            return _失败("该单还没有令牌", {"原因码": "not_found"})
        记.update({"作废": True, "作废时刻": 现在, "作废人": 谁})
        _写令牌表(表)
        return _成功({"单号": 单号, "作废": True}, "%s 的令牌已作废" % 单号)
    # 校验（参数不叫「令牌」：执行层会把「令牌」当冒充参数剥掉）
    明文 = str((参数 or {}).get("链接令牌") or (参数 or {}).get("t") or "").strip()
    if not 明文:
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    命中 = None
    for 记 in 表.get("令牌") or []:
        if hmac.compare_digest(str(记.get("哈希") or ""),
                               _令牌哈希(明文, 记.get("单号"))):
            命中 = 记
            break
    if 命中 is None:
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    if bool(命中.get("作废")):
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    if str(命中.get("过期") or "") and str(命中.get("过期")) < 现在:
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    if bool(命中.get("一次性")) and bool(命中.get("已用")):
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    单据 = _找单(_读派工单(), str(命中.get("单号") or ""))
    if 单据 is None or str(单据["作废"].get("状态")) == "作废":
        return _失败("链接已失效，请联系发单方重新发送。", {"原因码": "token_invalid"})
    只读 = str(单据["闭环"].get("状态")) == "已闭环"
    return _成功({"单号": 单据.get("单号"), "只读": 只读, "单": 单据,
                "整体状态": _整体状态(单据)[1]},
                "令牌有效%s" % ("（本单已闭环，仅供查看）" if 只读 else ""))


# ---------------------------------------------------------------- P5 异常（实时推导 + 只存已处理）

异常类型名 = {
    1: "任务卡未完成", 2: "超预估未接单", 3: "超预估未回复", 4: "回复后超时未阅读",
    5: "卡片异常备注", 6: "派工单投递失败", 7: "回复中异常备注", 8: "端点连接异常",
}
异常优先级 = {6: "P0", 8: "P0", 2: "P1", 3: "P1", 4: "P1", 1: "P2", 5: "P2", 7: "P2"}
未读阈值分 = 30
异常处理版本 = "1.0"


def _异常处理路径():
    return os.path.join(公共.取路径("数据目录"), "异常处理.json")


def _读异常处理():
    d = 公共.读json(_异常处理路径(), None)
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 异常处理版本)
    d.setdefault("账号", 公共.取路径("账号"))
    d.setdefault("端点", 公共.取路径("端点"))
    d.setdefault("更新", 公共.现在全())
    if not isinstance(d.get("已处理"), list):
        d["已处理"] = []
    return d


def _写异常处理(d):
    d["版本"] = 异常处理版本
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {"版本": d["版本"], "账号": d["账号"], "端点": d["端点"], "更新": d["更新"]}
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_异常处理路径(), d)


def _异常指纹(类型, 对象ID, 时刻):
    return "%d#%s|%s" % (int(类型), str(对象ID or ""), str(时刻 or ""))


def _时加(时, 分钟):
    t = 公共.解析时间(时) if 时 else None
    if t is None:
        return ""
    return (t + datetime.timedelta(minutes=int(分钟))).strftime("%Y-%m-%d %H:%M:%S")


def _卡状态时刻(卡):
    for 记 in reversed(卡.get("历史") or []):
        if isinstance(记, dict) and "状态" in str(记.get("动作") or ""):
            return str(记.get("ts") or "")
    return str(卡.get("更新") or 卡.get("创建") or "")


def _异常们():
    """8 类实时推导。返回 [{类型,类型名,来源,对象ID,标题,优先级,稳定触发时刻,指纹,触发规则,是否已处理}]"""
    出 = []
    现在 = datetime.datetime.now()
    卡们 = 任务卡库.读().get("卡", []) or []
    单们 = _读派工单().get("单", []) or []
    状态 = 采集器.读状态() or {}

    def 加(类型, 来源, 对象ID, 标题, 时, 规则):
        if not str(时 or "").strip():
            return
        出.append({"类型": int(类型), "类型名": 异常类型名[int(类型)], "来源": 来源,
                  "对象ID": str(对象ID or ""), "标题": str(标题 or ""),
                  "优先级": 异常优先级.get(int(类型), "P2"), "稳定触发时刻": str(时),
                  "指纹": _异常指纹(类型, 对象ID, 时), "触发规则": str(规则 or "")})

    for 卡 in 卡们:
        卡id = str(卡.get("id") or "")
        态 = str(卡.get("状态") or "")
        截止 = 公共.解析时间(卡.get("截止")) if 卡.get("截止") else None
        触发 = False
        规则 = ""
        if 态 == "卡住":
            触发, 规则 = True, "状态=卡住"
        elif 截止 is not None and 截止 <= 现在 and 态 not in ("已完成", "作废"):
            触发, 规则 = True, "截止已过（%s）且未完成" % 卡.get("截止")
        if 触发:
            加(1, "卡片", 卡id, "任务卡未完成 · " + str(卡.get("标题") or ""),
               _卡状态时刻(卡), 规则)
        异常注 = 卡.get("异常备注") or []
        if isinstance(异常注, list) and 异常注:
            末 = 异常注[-1] if isinstance(异常注[-1], dict) else {}
            加(5, "卡片", 卡id, "卡片异常备注 · " + str(卡.get("标题") or ""),
               str(末.get("ts") or 卡.get("更新") or ""), str(末.get("内容") or "有异常备注"))

    for 单 in 单们:
        if str((单.get("作废") or {}).get("状态")) == "作废":
            continue   # P5-C4：作废即死，六类单异常全部不再推导/入队
        单号 = str(单.get("单号") or "")
        卡id = str(单.get("来源卡") or "")
        卡 = next((x for x in 卡们 if str(x.get("id") or "") == 卡id), {})
        标题 = "%s · %s" % (单号, str(卡.get("标题") or ""))
        预估 = 公共.解析时间(单.get("预估完成")) if 单.get("预估完成") else None
        投 = 单.get("投递") or {}
        接 = 单.get("接单") or {}
        复 = 单.get("回复") or {}
        阅 = 单.get("阅读") or {}
        if 投.get("状态") == "失败":
            末 = (投.get("历史") or [{}])[-1]
            加(6, "派工单", 单号, "投递失败 · " + 标题,
               str(末.get("ts") or 单.get("创建") or ""), "投递.状态=失败：" + str(投.get("错误") or "")[:80])
        if 预估 is not None and 现在 > 预估 and 投.get("状态") == "成功":
            if 接.get("状态") == "未接单":
                加(2, "派工单", 单号, "超预估未接单 · " + 标题, 单.get("预估完成"),
                   "现在 > 预估完成（%s）且未接单" % 单.get("预估完成"))
            elif 接.get("状态") == "已接单" and 复.get("状态") == "未回复":
                加(3, "派工单", 单号, "超预估未回复 · " + 标题, 单.get("预估完成"),
                   "现在 > 预估完成（%s）且未回复" % 单.get("预估完成"))
        if 复.get("状态") == "已回复" and 阅.get("状态") != "已阅读" and 复.get("时刻"):
            超时 = _时加(复.get("时刻"), 未读阈值分)
            超时t = 公共.解析时间(超时) if 超时 else None
            if 超时t is not None and 现在 > 超时t:
                加(4, "派工单", 单号, "回复后超时未阅读 · " + 标题, 超时,
                   "回复后超过 %d 分钟未标记已阅读" % 未读阈值分)
        if 复.get("异常备注") or (单.get("异常备注") or []):
            时 = str(复.get("时刻") or "")
            注们 = 单.get("异常备注") or []
            if 注们 and isinstance(注们[-1], dict):
                时 = str(注们[-1].get("ts") or 时)
            加(7, "派工单", 单号, "回复中异常备注 · " + 标题, 时,
               str(复.get("异常备注") or (注们[-1].get("内容") if 注们 else ""))[:80])

    trae = 状态.get("trae") or {}
    if str(状态.get("总状态") or "") == "红" or str(trae.get("判定") or "") == "红":
        时 = str(trae.get("服务端启动时刻") or 状态.get("ts") or "")
        加(8, "端点", 端点名(), "端点连接异常 · " + 端点名(), 时,
           "总状态=红（TRAE 进程/端口异常）")

    处理表 = {str(x.get("指纹") or ""): x for x in (_读异常处理().get("已处理") or [])
            if isinstance(x, dict)}
    序 = {"P0": 0, "P1": 1, "P2": 2}
    for 条 in 出:
        条["是否已处理"] = 条["指纹"] in 处理表
        条["处理时刻"] = str((处理表.get(条["指纹"]) or {}).get("处理时刻") or "")
    出.sort(key=lambda x: (序.get(x["优先级"], 3), str(x["稳定触发时刻"]), int(x["类型"])))
    return 出


def _异常筛(条们, 参数):
    类型 = (参数 or {}).get("类型")
    类号 = []
    if isinstance(类型, (list, tuple)):
        类号 = [int(x) for x in 类型 if str(x).strip().isdigit()]
    elif str(类型 or "").strip():
        for x in str(类型).replace("，", ",").replace("、", ",").split(","):
            if x.strip().isdigit():
                类号.append(int(x.strip()))
    状态筛 = str((参数 or {}).get("状态") or "未处理").strip()
    来源 = str((参数 or {}).get("来源筛") or (参数 or {}).get("来源") or "").strip()
    起 = 公共.解析时间((参数 or {}).get("起")) if (参数 or {}).get("起") else None
    止 = 公共.解析时间((参数 or {}).get("止")) if (参数 or {}).get("止") else None
    词 = str((参数 or {}).get("关键字") or "").strip()
    出 = []
    for 条 in 条们:
        if 类号 and 条["类型"] not in 类号:
            continue
        if 状态筛 == "未处理" and 条["是否已处理"]:
            continue
        if 状态筛 == "已处理" and not 条["是否已处理"]:
            continue
        if 来源 and 条["来源"] != 来源:
            continue
        t = 公共.解析时间(条["稳定触发时刻"])
        if 起 is not None and t is not None and t < 起:
            continue
        if 止 is not None and t is not None and t > 止:
            continue
        if 词 and 词 not in (条["标题"] + 条["对象ID"] + 条["触发规则"]):
            continue
        出.append(条)
    return 出


def _cmd_异常列表(参数, 来源):
    全部 = _异常们()
    筛后 = _异常筛(全部, 参数)
    页 = 1
    try:
        页 = max(1, int((参数 or {}).get("页") or 1))
    except Exception:
        页 = 1
    每页 = 20
    页数 = max(1, (len(筛后) + 每页 - 1) // 每页)
    本页 = 筛后[(页 - 1) * 每页: 页 * 每页] if 页 <= 页数 else []
    行 = [{"类型": x["类型"], "类型名": x["类型名"], "来源": x["来源"],
          "关联编号": x["对象ID"], "标题": x["标题"], "优先级": x["优先级"],
          "稳定触发时刻": x["稳定触发时刻"], "触发规则": x["触发规则"],
          "是否已处理": x["是否已处理"], "指纹": x["指纹"]} for x in 本页]
    return _成功({"异常": 行, "条数": len(行), "总数": len(筛后), "页": 页,
                "页数": 页数, "每页": 每页}, "异常 %d 条（本页 %d）" % (len(筛后), len(行)))


def _cmd_异常统计(参数, 来源):
    全部 = _异常们()
    未 = [x for x in 全部 if not x["是否已处理"]]
    已 = [x for x in 全部 if x["是否已处理"]]
    表 = _读异常处理()
    历史 = len([x for x in (表.get("已处理") or [])
              if str(x.get("指纹") or "") not in {y["指纹"] for y in 全部}])
    按类 = {}
    for i in range(1, 9):
        按类[str(i) + "·" + 异常类型名[i]] = len([x for x in 未 if x["类型"] == i])
    return _成功({"未处理": len(未), "已处理": len(已), "历史已处理": 历史, "按类型": 按类},
                "未处理 %d / 已处理 %d / 历史 %d" % (len(未), len(已), 历史))


def _cmd_异常标已处理(参数, 来源):
    指纹 = str((参数 or {}).get("指纹") or "").strip()
    说明 = str((参数 or {}).get("说明") or "").strip()
    谁 = str((参数 or {}).get("谁") or "").strip() or 来源
    if not 指纹 or "|" not in 指纹 or "#" not in 指纹:
        return _失败("缺参数：指纹（格式 类型#对象ID|稳定触发时刻）", {"原因码": "bad_param"})
    表 = _读异常处理()
    已有 = next((x for x in (表.get("已处理") or [])
               if str(x.get("指纹") or "") == 指纹), None)
    if 已有 is not None:
        return _成功({"指纹": 指纹, "处理人": 已有.get("处理人"),
                    "处理时刻": 已有.get("处理时刻"), "重复": True}, "这条已标过已处理（幂等）")
    当前 = _异常们()
    命中 = next((x for x in 当前 if x["指纹"] == 指纹), None)
    if 命中 is None:
        return _失败("该异常已不存在（指纹不在当前推导结果里）：%s" % 指纹,
                     {"原因码": "not_found", "指纹": 指纹})
    段 = 指纹.split("#", 1)
    类型 = int(段[0]) if 段[0].isdigit() else 0
    对象ID, 时刻 = (段[1].split("|", 1) + [""])[:2]
    记 = {"指纹": 指纹, "类型": 类型, "对象ID": 对象ID, "稳定触发时刻": 时刻,
          "处理人": 谁, "处理时刻": 公共.现在全(), "说明": 说明, "可撤销": False}
    表["已处理"].append(记)
    _写异常处理(表)
    return _成功({"指纹": 指纹, "处理人": 谁, "处理时刻": 记["处理时刻"], "重复": False},
                "已标已处理：%s" % 指纹)


# ---------------------------------------------------------------- P5 提醒（队列/留痕/扫描/取出）

提醒队列版本 = "1.0"
提醒冷却秒 = 1800
提醒队列上限 = 100
提醒单轮上限 = 5
提醒留痕上限 = 200
提醒人工回落后秒 = 7200


def _提醒队列路径():
    return os.path.join(公共.取路径("数据目录"), "提醒队列.json")


def _提醒留痕路径():
    return os.path.join(公共.取路径("数据目录"), "提醒留痕.json")


def _读提醒队列():
    d = 公共.读json(_提醒队列路径(), None)
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 提醒队列版本)
    d.setdefault("账号", 公共.取路径("账号"))
    d.setdefault("端点", 公共.取路径("端点"))
    d.setdefault("更新", 公共.现在全())
    d.setdefault("人工忙闲", "无")
    d.setdefault("设置时刻", "")
    d.setdefault("到期", "")
    d.setdefault("设置人", "")
    if not isinstance(d.get("队列"), list):
        d["队列"] = []
    return d


def _写提醒队列(d):
    d["版本"] = 提醒队列版本
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {}
    for 键 in ("版本", "账号", "端点", "更新", "人工忙闲", "设置时刻", "到期", "设置人"):
        头[键] = d.get(键, "")
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_提醒队列路径(), d)


def _读提醒留痕():
    d = 公共.读json(_提醒留痕路径(), None)
    if not isinstance(d, dict):
        d = {}
    d.setdefault("版本", 提醒队列版本)
    d.setdefault("账号", 公共.取路径("账号"))
    d.setdefault("端点", 公共.取路径("端点"))
    d.setdefault("更新", 公共.现在全())
    d.setdefault("下一个号", 1)
    if not isinstance(d.get("留痕"), list):
        d["留痕"] = []
    return d


def _写提醒留痕(d):
    d["留痕"] = d["留痕"][-提醒留痕上限:]
    d["版本"] = 提醒队列版本
    d["账号"] = 公共.取路径("账号")
    d["端点"] = 公共.取路径("端点")
    d["更新"] = 公共.现在全()
    头 = {"版本": d["版本"], "账号": d["账号"], "端点": d["端点"],
          "更新": d["更新"], "下一个号": d.get("下一个号", 1)}
    for 键, 值 in list(d.items()):
        if 键 not in 头:
            头[键] = 值
    d.clear()
    d.update(头)
    公共.原子写json(_提醒留痕路径(), d)


def _提醒留痕追加(类型, 来源, 关联编号, 首次, 末次, 结果, 主人状态):
    d = _读提醒留痕()
    号 = int(d.get("下一个号") or 1)
    d["留痕"].append({"编号": "L%04d" % 号, "类型": int(类型), "来源": 来源,
                    "关联编号": 关联编号, "首次入队": 首次, "末次判定": 末次,
                    "推送时刻": 公共.现在全(), "结果": 结果, "主人状态": 主人状态})
    d["下一个号"] = 号 + 1
    _写提醒留痕(d)


def _去重键(类型, 对象ID):
    return "%d#%s" % (int(类型), str(对象ID or ""))


def _主人忙闲():
    """返回 (忙否, 来源文字, 人工到期)。人工覆盖优先；无人档案＝闲并记主人不在线。"""
    队 = _读提醒队列()
    人工 = str(队.get("人工忙闲") or "无")
    到期 = str(队.get("到期") or "")
    秒 = 公共.解析时间(到期) if 到期 else None
    if 人工 in ("忙", "闲") and 秒 is not None and datetime.datetime.now() < 秒:
        return (人工 == "忙", "人工忙" if 人工 == "忙" else "人工闲", 到期)
    号 = 公共.取路径("账号")
    员工们 = (采集器.读状态() or {}).get("员工") or []
    人 = next((x for x in 员工们 if str(x.get("终身号") or "") == 号), None) if 号 else None
    if 人 is None:
        return (False, "自动（主人不在线）", "")
    距 = int(人.get("距今秒") if isinstance(人.get("距今秒"), (int, float)) else -1)
    if 距 < 0:
        return (False, "自动（主人不在线）", "")
    return (距 < 180, "自动（判为忙）" if 距 < 180 else "自动（判为闲）", "")


def 提醒主人会话名():
    号 = 公共.取路径("账号")
    for 人 in ((采集器.读状态() or {}).get("员工") or []):
        if str(人.get("终身号") or "") == 号:
            return str(人.get("会话名") or "")
    return ""


def 提醒扫描():
    """推导 → 入队/合并/出队/上限；不发消息。返回统计。"""
    队 = _读提醒队列()
    当前 = _异常们()
    键集 = {}
    for 条 in 当前:
        键 = _去重键(条["类型"], 条["对象ID"])
        键集[键] = 条
    入队 = 合并 = 出队 = 0
    新队 = []
    已有键 = set()
    for 条 in 队.get("队列") or []:
        键 = str(条.get("键") or "")
        if 键 not in 键集:
            出队 += 1
            continue
        if 键 in 已有键:
            合并 += 1
            continue
        已有键.add(键)
        源 = 键集[键]
        旧指纹 = str(条.get("异常指纹") or "")
        复发 = bool(旧指纹) and (旧指纹 != 源["指纹"])
        条.update({"类型": 源["类型"], "对象ID": 源["对象ID"], "来源": 源["来源"],
                 "关联编号": 源["对象ID"], "标题": 源["标题"], "优先级": 源["优先级"],
                 "异常指纹": 源["指纹"], "末次判定": 公共.现在全(),
                 "合并数": int(条.get("合并数") or 1) + 1})
        if 复发:
            # P5-13b：复发（稳定触发时刻变了）→ 冷却清空、立即可推（V3 L323）
            条["状态"] = "待推"
            条["冷却到"] = ""
            条["上次推送"] = ""
        elif str(条.get("状态") or "") == "已推" and 条.get("冷却到"):
            冷 = 公共.解析时间(条.get("冷却到"))
            if 冷 is not None and 冷 <= datetime.datetime.now():
                # P5-13c：冷却到期、异常仍在 → 置回待推（再推一次；上次推送保留作历史）
                条["状态"] = "待推"
                条["冷却到"] = ""
        新队.append(条)
    for 键, 源 in 键集.items():
        if 键 in 已有键:
            continue
        新队.append({"键": 键, "类型": 源["类型"], "对象ID": 源["对象ID"],
                   "来源": 源["来源"], "关联编号": 源["对象ID"], "标题": 源["标题"],
                   "优先级": 源["优先级"], "触发时刻": 源["稳定触发时刻"],
                   "异常指纹": 源["指纹"], "首次入队": 公共.现在全(),
                   "末次判定": 公共.现在全(), "合并数": 1,
                   "上次推送": "", "冷却到": "", "状态": "待推"})
        入队 += 1
    丢弃 = 0
    序 = {"P0": 0, "P1": 1, "P2": 2}
    while len(新队) > 提醒队列上限:
        # 先按最低优先级组，再取该组里「最旧」（首次入队最早）的一条；P0 只在全员 P0 时才会被丢
        最低序 = max(序.get(x.get("优先级"), 3) for x in 新队)
        候选 = [x for x in 新队 if 序.get(x.get("优先级"), 3) == 最低序]
        最旧 = min(候选, key=lambda x: str(x.get("首次入队") or ""))
        新队.remove(最旧)
        丢弃 += 1
        公共.日志("提醒队列超限丢弃：%s" % 最旧.get("键"), "警告")
    队["队列"] = 新队
    _写提醒队列(队)
    return {"入队": 入队, "合并": 合并, "出队": 出队, "丢弃": 丢弃, "总长": len(新队)}


def 提醒取出():
    """取冷却已过、状态待推的前 5 条（不删队列）。"""
    队 = _读提醒队列()
    现在 = datetime.datetime.now()
    可推 = []
    for 条 in 队.get("队列") or []:
        if str(条.get("状态") or "") != "待推":
            continue
        冷 = 公共.解析时间(条.get("冷却到")) if 条.get("冷却到") else None
        if 冷 is not None and 现在 < 冷:
            continue
        可推.append(条)
    序 = {"P0": 0, "P1": 1, "P2": 2}
    可推.sort(key=lambda x: (序.get(x.get("优先级"), 3), str(x.get("触发时刻") or "")))
    条数 = min(提醒单轮上限, len(可推))
    return {"条": 可推[:条数], "另有": max(0, len(可推) - 条数)}


def _提醒计数(队):
    现在 = datetime.datetime.now()
    待推 = 暂缓 = 冷却 = 0
    for 条 in 队.get("队列") or []:
        冷 = 公共.解析时间(条.get("冷却到")) if 条.get("冷却到") else None
        if 冷 is not None and 现在 < 冷:
            冷却 += 1
            continue
        if str(条.get("状态") or "") == "待推":
            待推 += 1
        else:
            暂缓 += 1
    return 待推, 暂缓, 冷却


def _cmd_提醒状态(参数, 来源):
    队 = _读提醒队列()
    忙, 来源文, 到期 = _主人忙闲()
    待推, 暂缓, 冷却 = _提醒计数(队)
    return _成功({"主人忙闲": 来源文, "忙否": 忙, "人工到期": 到期,
                "待推": 0 if 忙 else 待推, "暂缓": 待推 if 忙 else 暂缓,
                "冷却中": 冷却, "队列长度": len(队.get("队列") or []),
                "人工忙闲": 队.get("人工忙闲", "无")},
                "主人%s · 待推 %d / 暂缓 %d / 冷却中 %d / 队列 %d"
                % (来源文, 0 if 忙 else 待推, 待推 if 忙 else 暂缓, 冷却,
                   len(队.get("队列") or [])))


def _cmd_提醒设忙闲(参数, 来源):
    值 = str((参数 or {}).get("值") or "").strip()
    if 值 not in ("自动", "忙", "闲"):
        return _失败("值只能是 自动/忙/闲", {"原因码": "bad_param"})
    队 = _读提醒队列()
    现在 = datetime.datetime.now()
    if 值 == "自动":
        队.update({"人工忙闲": "无", "设置时刻": "", "到期": "", "设置人": ""})
        到期 = ""
    else:
        到期 = (现在 + datetime.timedelta(seconds=提醒人工回落后秒)).strftime("%Y-%m-%d %H:%M:%S")
        队.update({"人工忙闲": 值, "设置时刻": 公共.现在全(), "到期": 到期,
                 "设置人": str((参数 or {}).get("谁") or "").strip() or 来源})
    _写提醒队列(队)
    try:
        _提醒留痕追加(0, "忙闲", "主人", 公共.现在全(), 公共.现在全(),
                    "已推", "人工" + (值 if 值 != "自动" else "空闲"))
    except Exception:
        pass
    return _成功({"人工忙闲": 队["人工忙闲"], "设置时刻": 队["设置时刻"],
                "到期": 到期, "回落": "2小时"}, "人工忙闲=%s%s"
                % (队["人工忙闲"], ("（到期 %s）" % 到期) if 到期 else ""))


def _cmd_提醒标已推(参数, 来源):
    键们 = (参数 or {}).get("键")
    if isinstance(键们, str):
        键们 = [x.strip() for x in 键们.replace("，", ",").split(",") if x.strip()]
    if not isinstance(键们, list) or not 键们:
        return _失败("缺参数：键（可多个）", {"原因码": "bad_param"})
    结果 = str((参数 or {}).get("结果") or "已推").strip()
    if 结果 not in ("已推", "已点掉"):
        return _失败("结果只能是 已推/已点掉", {"原因码": "bad_param"})
    队 = _读提醒队列()
    现在 = time.time()
    冷却到 = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(现在 + 提醒冷却秒))
    改 = 0
    新队 = []
    找到 = set()
    for 条 in 队.get("队列") or []:
        键 = str(条.get("键") or "")
        if 键 not in 键们:
            新队.append(条)
            continue
        找到.add(键)
        if 结果 == "已点掉":
            try:
                _提醒留痕追加(条.get("类型"), 条.get("来源"), 条.get("关联编号"),
                            条.get("首次入队"), 公共.现在全(), "已点掉", "自动（点掉）")
            except Exception:
                pass
            continue
        条.update({"状态": "已推", "上次推送": 公共.现在全(), "冷却到": 冷却到})
        改 += 1
        新队.append(条)
        try:
            _提醒留痕追加(条.get("类型"), 条.get("来源"), 条.get("关联编号"),
                        条.get("首次入队"), 公共.现在全(), "已推", "自动（空闲）")
        except Exception:
            pass
    未找到 = [k for k in 键们 if k not in 找到]
    队["队列"] = 新队
    _写提醒队列(队)
    return _成功({"更新": 改, "冷却到": 冷却到, "未找到": 未找到},
                "已更新 %d 条，冷却到 %s%s" % (改, 冷却到,
                ("；未找到：%s" % "、".join(未找到)) if 未找到 else ""))


def _cmd_系统版本(参数, 来源):
    return _成功({"版本": 版本, "构建": 构建, "程序根": 公共.程序根,
                "数据目录": 公共.取路径("数据目录")}, "%s v%s" % (公共.外连["名"], 版本))


def _cmd_系统状态(参数, 来源):
    """整份 状态.json（网页·远程 靠它拿数据；与 /api/state 同一份真值）。
    P1-A：端点名只从 核心.端点名() 取，并把同一个值写回 状态.json（全系统唯一真源）。"""
    状态 = _当前状态()
    状态["端点名"] = 端点名()
    try:
        公共.原子写json(公共.状态文件, 状态)
    except Exception:
        公共.日志("状态.json 写端点名失败", "警告")
    return _成功(状态, "取自 状态.json（ts_ms=%s，端点=%s）"
                % (状态.get("ts_ms"), 状态["端点名"]))


def _cmd_系统日志(参数, 来源):
    行数 = int(_取参数(参数, "行数", 50) or 50)
    行数 = max(1, min(行数, 500))
    今天 = __import__("datetime").datetime.now().strftime("%Y%m%d")
    路径 = os.path.join(公共.日志目录, "AI工作台_%s.log" % 今天)
    if not os.path.isfile(路径):
        return _成功({"行": [], "文件": ""}, "今天还没有日志")
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            全部 = f.read().splitlines()
    except Exception as 错:
        return _失败("读日志失败: %s" % 错)
    return _成功({"行": 全部[-行数:], "文件": 路径}, "最近 %d 行" % min(行数, len(全部)))


def _cmd_系统自检(参数, 来源):
    检查项 = []

    def 记(名, 好, 说明):
        检查项.append({"项": 名, "ok": bool(好), "说明": 说明})

    # 1 采集
    状态 = 采集器.读状态()
    新鲜 = 0
    if 状态.get("ts_ms"):
        新鲜 = int(time.time() * 1000) - int(状态["ts_ms"])
    记("状态.json", bool(状态), "ts=%s，距今 %d ms" % (状态.get("ts", "无"), 新鲜))
    记("采集新鲜度", 状态 and 新鲜 < 15000, "%d ms（阈值 15000）" % 新鲜)

    # 2 端口
    trae = 状态.get("trae", {})
    记("TRAE 进程", trae.get("进程数", 0) > 0, "%d 个" % trae.get("进程数", 0))
    记("端口 9599", 采集器.端口在(9599), "CDP")
    记("端口 19876", 采集器.端口在(19876), "TRAE 控制服务")

    # 3 库
    卡库 = 任务卡库.读()
    记("任务卡库", isinstance(卡库, dict), "%d 张卡" % len(卡库.get("卡", [])))
    原话 = 原话解析.合并()
    记("原话表", len(原话.get("条", [])) > 0, "%d 条" % len(原话.get("条", [])))

    # 4 网页
    端口 = 状态.get("网页端口", 0)
    记("网页服务", bool(端口) and 采集器.端口在(端口), "端口 %s" % (端口 or "未起"))

    全通 = all(项["ok"] for 项 in 检查项)
    return _成功({"项": 检查项, "RESULT": "PASS" if 全通 else "FAIL"},
                "RESULT=%s" % ("PASS" if 全通 else "FAIL"))


def _扫描Tk注册表():
    """真扫 Tk 壳源码里的 界面注册表（不是自己声明）。"""
    路径 = os.path.join(公共.程序根, "AI工作台.pyw")
    if not os.path.isfile(路径):
        return [], "找不到 AI工作台.pyw"
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            文本 = f.read()
    except Exception as 错:
        return [], "读 Tk 壳失败: %s" % 错
    位置 = 文本.find("界面注册表")
    if 位置 < 0:
        return [], "Tk 壳里没有 界面注册表 清单"
    段 = 文本[位置:]
    起 = 段.find("[")
    止 = 段.find("]", 起)
    if 起 < 0 or 止 < 0:
        return [], "界面注册表 不是列表字面量"
    import re
    return re.findall(r'"([^"]+)"', 段[起:止]), ""


def _取网页命令列表():
    """优先 HTTP 真探测 GET /api/cmd列表；服务没起就解析 HTML 里那份唯一数组。"""
    import re
    状态 = 采集器.读状态()
    端口 = 状态.get("网页端口", 0)
    if 端口:
        try:
            import urllib.parse
            import urllib.request
            网址 = "http://127.0.0.1:%d%s" % (int(端口),
                                            urllib.parse.quote("/api/cmd列表"))
            with urllib.request.urlopen(网址, timeout=2) as r:
                数据 = json.loads(r.read().decode("utf-8"))
            return 数据.get("命令", []), "HTTP"
        except Exception:
            pass
    路径 = 公共.网页首页
    if not os.path.isfile(路径):
        return [], "缺少 网页端源文件\\AI工作台.html"
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            文本 = f.read()
    except Exception:
        return [], "读网页源码失败"
    位置 = 文本.find("const 命令列表")
    if 位置 < 0:
        return [], "网页源码里没有 命令列表 数组"
    起 = 文本.find("[", 位置)
    止 = 文本.find("]", 起)
    return re.findall(r'"([^"]+)"', 文本[起:止]), "HTML（网页服务未起，读的是唯一源文件）"


def _远程探测(命令="系统.版本", 超时=8.0):
    """第 4 列「网页·远程」的真探测：开一条独立 WS 进频道，发一条请求，
    收到 ack + 结果（ok=true）算过；超时/无 ack/ok=false 算不过。
    只探 1 条（系统.版本），四列里全部行共用这次结果——避免 25 条命令各等 8 秒。"""
    try:
        import websocket
    except Exception as 错:
        return False, "缺 websocket-client：%s" % 错
    try:
        import 公网桥
        频道 = 公共.频道全(公共.外连["尾"])
        址 = 公网桥.频道地址(频道, 公共.外连["api_key"], 公共.外连["主机"])
    except Exception as 错:
        return False, "拼频道地址失败：%s" % 错
    import json as _json
    import threading as _th
    import uuid as _uuid
    aid = "al_" + _uuid.uuid4().hex[:8]
    盒 = {"ack": False, "结果": None}
    完 = _th.Event()

    def _收(ws, 文本):
        try:
            m = _json.loads(文本)
        except Exception:
            return
        if not isinstance(m, dict):
            return
        if m.get("类型") == "ack" and m.get("id") == aid:
            盒["ack"] = True
        if m.get("类型") == "结果" and m.get("id") == aid:
            盒["结果"] = m
            完.set()

    def _开(ws):
        ws.send(_json.dumps({"类型": "请求", "id": aid, "命令": 命令, "参数": {},
                             "口令": 频道}, ensure_ascii=False))

    app = websocket.WebSocketApp(址, on_open=_开, on_message=_收)
    # 免 ping（老板 2026-10-25 口径：本 WS 免 ping，纯保活 ping 一律不要；
    # 非 ping 不可最多 30 分钟一条）。一次性命令通道原超时/重试逻辑全不动。
    _th.Thread(target=lambda: app.run_forever(ping_interval=0),
               daemon=True).start()
    完.wait(超时)
    try:
        app.close()
    except Exception:
        pass
    if 盒["结果"] is None:
        return False, "远程超时（%d 秒内没收到 结果 帧）" % int(超时)
    if not 盒["ack"]:
        return False, "收到结果但没有 ack（违反四步曲）"
    if not 盒["结果"].get("ok"):
        return False, "结果 ok=false：%s" % (盒["结果"].get("说明") or "无说明")
    return True, "频道真发 %s：ack + 结果 均到（id=%s）" % (命令, aid)


def _cmd_系统对齐自检(参数, 来源):
    起点 = time.time()
    tk命令, tk错误 = _扫描Tk注册表()
    网页命令, 网页方式 = _取网页命令列表()
    缺 = []
    表 = []
    cli脚本 = os.path.join(公共.程序根, "AI工作台CLI.py")

    for 项 in 命令表:
        名 = 项["命令"]
        # CLI：真跑子进程 --dry
        cli好 = False
        cli说明 = ""
        try:
            结果 = subprocess.run(
                [sys.executable, cli脚本, 名, "--dry", "--json"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=25, creationflags=0x08000000, cwd=公共.程序根)
            出口 = 结果.returncode
            cli好 = (出口 == 0) and ('"ok": true' in (结果.stdout or "")
                                     or '"ok":true' in (结果.stdout or ""))
            cli说明 = "退出码 %d" % 出口
        except Exception as 错:
            cli说明 = "调用失败: %s" % 错
        tk好 = 名 in tk命令
        网页好 = 名 in 网页命令
        表.append({
            "命令": 名, "实现": True, "CLI": cli好, "Tk": tk好, "网页": 网页好,
            "读写": 项["读写"], "页": 项["页"], "说明": cli说明,
        })
        if not cli好:
            缺.append("%s：CLI 壳没调通（%s）→ 在 AI工作台CLI.py 里放行该命令名" % (名, cli说明))
        if not tk好:
            缺.append("%s：Tk 壳未注册 → 往 AI工作台.pyw 的 界面注册表 加一行" % 名)
        if not 网页好:
            缺.append("%s：网页端未声明 → 往 AI工作台.html 的 const 命令列表 加一行" % 名)

    远程好, 远程说明 = _远程探测()
    for 行 in 表:
        行["网页·远程"] = 远程好
    if not 远程好:
        缺.append("网页·远程：频道真发「系统.版本」未过（%s）" % 远程说明)
    全绿 = not 缺
    return _成功({
        "表": 表,
        "缺": 缺,
        "RESULT": "PASS" if 全绿 else "FAIL",
        "Tk清单条数": len(tk命令),
        "网页清单条数": len(网页命令),
        "网页探测方式": 网页方式,
        "远程探测": 远程说明,
    }, "RESULT=%s（CLI/Tk/网页/网页·远程 四列真探测）" % ("PASS" if 全绿 else "FAIL"),
        (time.time() - 起点) * 1000)


# ---------------------------------------------------------------- P5 总管手册

# ---------------- P5 工作手册：锚定清单系统 S36《总管工作手册》（2026-10-27 老板口径）

工作手册标题 = "总管工作手册"
_手册缓存 = {"键": "", "卡": None}


def _清单系统目录():
    """清单系统 1.0 软件根（优先 配置.清单系统目录；否则从本文件向上找「开发资源包」下的 清单系统 1.0）。"""
    配置 = 公共.读配置() or {}
    指定 = str(配置.get("清单系统目录") or "").strip()
    if 指定 and os.path.isdir(指定):
        return 指定
    p = os.path.dirname(os.path.abspath(__file__))
    for _ in range(6):
        p = os.path.dirname(p) or p
        try:
            名们 = os.listdir(p)
        except Exception:
            break
        for 名 in 名们:
            if "开发资源包" not in 名:
                continue
            包 = os.path.join(p, 名)
            try:
                分类们 = os.listdir(包)
            except Exception:
                continue
            for 分 in 分类们:
                q = os.path.join(包, 分, "清单系统 1.0")
                if os.path.isdir(q):
                    return q
    return ""


def _节点化(原):
    if not isinstance(原, dict):
        return None
    题 = str(原.get("标题") or 原.get("题") or 原.get("小标题") or "").strip()
    文 = str(原.get("正文") or 原.get("文") or 原.get("小正文") or "")
    子源 = 原.get("子") or 原.get("下级") or 原.get("children") or []
    子 = []
    if isinstance(子源, list):
        for x in 子源:
            n = _节点化(x)
            if n:
                子.append(n)
    if not 题 and not 文.strip() and not 子:
        return None
    return {"题": 题, "文": 文, "子": 子}


def _平铺转树(文):
    """兜底：`- [ ] N. 小标题` ＋ 2 空格缩进 → 层级树（清单系统平铺写法）。"""
    import re as _re
    根, 栈 = [], []
    当前 = None
    项正则 = _re.compile(r"^([ \t]*)-[ \t]+\[[^\]]*\][ \t]*(.*)$")
    for 行 in str(文 or "").splitlines():
        m = 项正则.match(行)
        if m:
            宽 = len(m.group(1).replace("\t", "  "))
            节 = {"题": m.group(2).strip(), "文": "", "子": []}
            while 栈 and 栈[-1][0] >= 宽:
                栈.pop()
            if 栈:
                栈[-1][1]["子"].append(节)
            else:
                根.append(节)
            栈.append((宽, 节))
            当前 = 节
        elif 当前 is not None and 行.strip():
            当前["文"] += ("\n" if 当前["文"] else "") + 行.strip()
    return 根


def _工作手册卡():
    """清单系统「系统清单」共享库里 标题=总管工作手册 的最新版本卡（直接读源文件，不调 CLI）。"""
    根 = _清单系统目录()
    if not 根:
        return None
    卡库 = os.path.join(根, "产出文档", "系统清单", "卡片库")
    if not os.path.isdir(卡库):
        return None
    try:
        夹们 = sorted([d for d in os.listdir(卡库)
                       if d.startswith("S") and os.path.isdir(os.path.join(卡库, d))], reverse=True)
    except Exception:
        return None
    for 夹 in 夹们:
        目录 = os.path.join(卡库, 夹)
        try:
            文名们 = os.listdir(目录)
        except Exception:
            continue
        for 文名 in 文名们:
            if not 文名.lower().endswith(".json") or 文名.startswith("_"):
                continue
            路径 = os.path.join(目录, 文名)
            try:
                键 = "%s|%s" % (路径, os.path.getmtime(路径))
                if _手册缓存["键"] == 键 and _手册缓存.get("卡"):
                    return _手册缓存["卡"]
                d = 公共.读json(路径, None) or {}
                版们 = d.get("版本")
                最新 = 版们[-1] if (isinstance(版们, list) and 版们 and isinstance(版们[-1], dict)) else {}
                if 最新:
                    标题 = str(最新.get("标题") or "").strip()
                    原文 = str(最新.get("正文") or "")
                    版本号 = 最新.get("版本号") or 0
                    更新时间 = 最新.get("时间") or ""
                else:
                    # 0.22 新结构：名称 / 详情 / 版本号 / 创建（版本＝结构版本号，不是历史数组）
                    标题 = str(d.get("名称") or "").strip()
                    原文 = str(d.get("详情") or "")
                    版本号 = d.get("版本号") or 0
                    更新时间 = d.get("创建") or ""
                if 标题 != 工作手册标题:
                    continue
                节点 = []
                s = 原文.strip()
                if s.startswith("["):
                    try:
                        组 = json.loads(s)
                    except Exception:
                        组 = None
                    if isinstance(组, list):
                        for x in 组:
                            n = _节点化(x)
                            if n:
                                节点.append(n)
                if not 节点:
                    节点 = _平铺转树(原文)
                卡 = {"编号": str(d.get("编号") or 夹.split("-")[0]),
                      "标题": 工作手册标题,
                      "版本号": 版本号,
                      "更新时间": 更新时间,
                      "原文": 原文, "节点": 节点, "路径": 路径}
                _手册缓存.update({"键": 键, "卡": 卡})
                return 卡
            except Exception:
                continue
    return None


def _cmd_手册一文(参数, 来源):
    卡 = _工作手册卡()
    if not 卡:
        return _失败("找不到清单系统《%s》（系统清单共享库）" % 工作手册标题)
    return _成功({"编号": 卡["编号"], "标题": 卡["标题"], "版本号": 卡["版本号"],
                  "更新时间": 卡["更新时间"], "节点": 卡["节点"], "字数": len(卡["原文"])},
                 "《%s》%s（v%s，%d 个顶层节点）" % (卡["标题"], 卡["编号"], 卡["版本号"], len(卡["节点"])))


def _cmd_手册目录(参数, 来源):
    数据 = 手册.目录()
    if 数据.get("错误"):
        return _失败(数据["错误"], 数据)
    return _成功(数据, "共 %d 页（%s）" % (数据["总"], 数据["目录"]))


def _cmd_手册读(参数, 来源):
    页 = _取参数(参数, "页")
    数据, 错误 = 手册.读(页)
    if 错误:
        return _失败(错误)
    return _成功(数据, "%s（%d 行）" % (数据["文件名"], 数据["行数"]))


def _cmd_手册搜(参数, 来源):
    词 = _取参数(参数, "词")
    命中, 错误 = 手册.搜(词)
    if 错误:
        return _失败(错误)
    return _成功({"词": 词, "命中": 命中, "条数": len(命中)},
                "「%s」命中 %d 条" % (词, len(命中)))


def _cmd_手册追加(参数, 来源):
    页 = _取参数(参数, "页")
    话 = _取参数(参数, "话")
    if not 页 or not 话:
        return _失败("缺参数：页 / 话")
    好, 说明 = 手册.追加(页, 话, 来源)
    return (_成功({"页": 页}, 说明) if 好 else _失败(说明))


def _cmd_手册新建(参数, 来源):
    标题 = _取参数(参数, "标题")
    if not 标题:
        return _失败("缺参数：标题")
    好, 说明 = 手册.新建(标题, 来源)
    return (_成功({"标题": 标题}, 说明) if 好 else _失败(说明))


# ---------------------------------------------------------------- P9 快速派工单

def _派工收件人(参数):
    """收件人参数：list 或「名1,名2/、/；」字符串，统一成名字列表（去空）。"""
    值 = (参数 or {}).get("收件人")
    if 值 is None:
        值 = (参数 or {}).get("收件") or (参数 or {}).get("人") or ""
    if isinstance(值, (list, tuple)):
        return [str(x).strip() for x in 值 if str(x).strip()]
    s = str(值 or "")
    for 分隔 in ("，", "、", "；", ";", "|"):
        s = s.replace(分隔, ",")
    return [x.strip() for x in s.split(",") if x.strip()]


def _派工正文(参数):
    return str((参数 or {}).get("文") or (参数 or {}).get("正文") or "").strip()


def _拼派工单(收件人们, 正文):
    """派工单全文唯一拼法（复制预览 / 实际发送 / 建卡详情三处共用）。"""
    return "【快速派工单】\n收件人：%s\n时间：%s\n\n%s" % (
        "、".join(收件人们) or "（未选）", 公共.现在全(), 正文)


def _MCP脚本():
    """TRAE_MCP服务.py 的智能寻址（不写死盘符）：程序根往上找 下级模块。"""
    本 = 公共.程序根
    候选 = [
        os.path.abspath(os.path.join(本, "..", "..", "下级模块", "TRAE_MCP服务.py")),
        os.path.abspath(os.path.join(本, "..", "下级模块", "TRAE_MCP服务.py")),
        os.path.abspath(os.path.join(本, "下级模块", "TRAE_MCP服务.py")),
    ]
    for p in 候选:
        if os.path.isfile(p):
            return p
    return ""


def _py控制台():
    """优先用同目录的 python.exe（pythonw 跑 GUI 时也能拉起带输出的 CLI）。"""
    exe = sys.executable or "python"
    同 = os.path.join(os.path.dirname(exe), "python.exe")
    return 同 if os.path.isfile(同) else exe


def _发到会话(会话名, 全文, 想终身号=""):
    """调 TRAE_MCP服务.py cli send_to_conversation；返回 (ok, 说明)。失败如实回原因。"""
    脚本 = _MCP脚本()
    if not 脚本:
        return False, "找不到 TRAE_MCP服务.py（智能寻址失败）"
    目标们 = [会话名]
    if 想终身号 and 想终身号 != 会话名:
        目标们.append(想终身号)
    最后 = ""
    for 目标 in 目标们:
        命令 = [_py控制台(), 脚本, "cli", "send_to_conversation",
               "--target=" + 目标, "--text=" + 全文]
        try:
            结果 = subprocess.run(命令, capture_output=True, text=True, encoding="utf-8",
                                errors="replace", timeout=120, cwd=os.path.dirname(脚本),
                                creationflags=0x08000000)
        except Exception as 错:
            return False, "调用异常：%s" % 错
        输出 = ((结果.stdout or "") + (结果.stderr or "")).strip()
        最后 = " | ".join(输出.splitlines()[-2:]) if 输出 else "（无输出）"
        if "RESULT=OK" in 输出:
            return True, 最后
    return False, 最后 or "未拿到 RESULT=OK"


def _MCP走(动词, 参数们=None):
    """调 TRAE_MCP服务.py cli <动词> --键=值… → (ok, dict)。把输出里的 JSON 行解析成 dict。"""
    脚本 = _MCP脚本()
    if not 脚本:
        return False, {}
    命令 = [_py控制台(), 脚本, "cli", str(动词 or "")]
    for 键, 值 in (参数们 or {}).items():
        命令.append("--%s=%s" % (键, 值))
    try:
        结果 = subprocess.run(命令, capture_output=True, text=True, encoding="utf-8",
                            errors="replace", timeout=180, cwd=os.path.dirname(脚本),
                            creationflags=0x08000000)
    except Exception as 错:
        return False, {"错误": str(错)}
    输出 = ((结果.stdout or "") + (结果.stderr or "")).strip()
    数据 = {}
    for 行 in 输出.splitlines():
        行 = 行.strip()
        if 行.startswith("{") and 行.endswith("}"):
            try:
                数据 = json.loads(行)
            except Exception:
                pass
            break
    return "RESULT=OK" in 输出, (数据 or {"原文": 输出[-400:]})


def _云CLI():
    各 = [
        os.path.abspath(os.path.join(公共.程序根, "..", "..", "..", "..", "----------开发资源包---------", "==公共服务==", "共享数据库", "CLI工具", "云档案CLI.py")),
        os.path.abspath(os.path.join(公共.程序根, "..", "..", "..", "..", "开发资源包", "==公共服务==", "共享数据库", "CLI工具", "云档案CLI.py")),
    ]
    for x in 各:
        if x and os.path.isfile(x):
            return x
    return ""


def _云实例号():
    """共享库调用方实例号（C5 脱敏：真值只在 配置.json「云档案实例号」，代码里不落）。"""
    try:
        return str((公共.读配置() or {}).get("云档案实例号") or "").strip()
    except Exception:
        return ""


def _写排队库(号, 条们):
    """把某员工的排队条写回共享库 TRae 行（别人消费的就是这列）。"""
    cli = _云CLI()
    if not cli:
        return False, "找不到 云档案CLI.py"
    实例号 = _云实例号()
    if not 实例号:
        return False, "配置缺 云档案实例号（共享库写不进去）"
    值 = json.dumps({"条数": len(条们), "时刻": 公共.现在全(), "条": [str(x) for x in 条们]}, ensure_ascii=False)
    命令 = [_py控制台(), cli, "arch_set", "--库", "TRae",
             "--实例号", 实例号, "--操作者", 实例号,
             "--终身号", 号, "--字段", "系统排队条情况", "--值", 值]
    try:
        r = subprocess.run(命令, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=60, creationflags=0x08000000)
    except Exception as e:
        return False, "写库异常：%s" % e
    输出 = ((r.stdout or "") + (r.stderr or "")).strip()
    return ("RESULT=OK" in 输出), (输出.splitlines()[-1] if 输出 else "（无输出）")


def _采样排队(号们, 会话名们):
    """发送后立刻对每个收件人采样一次排队条并写回共享库（老板：发送后立刻记录）。
    失败不抛，逐个记录结果。返回 [(号, ok, 条数)]。"""
    出 = []
    for 号, 名 in 号们:
        if not 号:
            # 无业余号：按会话名直接读
            try:
                r = _MCP走("get_snapshot", {})
            except Exception:
                continue
            条们 = []
            if r and r[0] and r[1].get("current_conversation") == 名:
                条们 = [str(x) for x in (r[1].get("pending_queue") or []) if str(x).strip()]
            try:
                写ok, 写说 = _写排队库(名, 条们)
            except Exception:
                写ok, 写说 = False, "写库异常"
            出.append((名, 写ok, 条们, 写ok and len(条们)))
            continue
        try:
            r = _cmd_员工排队查询({"号": 号}, "发送采样")
            d = (r or {}).get("数据") or {}
            出.append((号, bool((r or {}).get("ok")), d.get("条数", 0), bool(d.get("写库"))))
        except Exception:
            continue
    return 出


def _cmd_员工排队查询(参数, 来源):
    """主动查一个 TRAE 员工的当前系统排队条：临时切到该会话 → 读 pend → 写回共享库 TRae 列 → 切回。"""
    号 = str(_取参数(参数, "号") or "").strip()
    if not 号:
        return _失败("缺参数：号（4 位终身号，如 0001）")
    名 = ""
    try:
        人 = 采集器.读会话档案名册()
        for x in 人:
            if str(x.get("号") or "").strip() == 号:
                名 = str(x.get("会话名") or "").strip()
                break
    except Exception:
        名 = ""
    目标 = 名 or 号
    原地 = 号
    现 = {}
    try:
        ok, 现 = _MCP走("get_snapshot")
        if ok and 现:
            原地 = str(现.get("current_conversation") or 现.get("界面焦点") or 号) or 号
    except Exception:
        pass
    是否相同 = str(现.get("current_conversation") or "").strip() == 目标
    if not 是否相同:
        ok, 切 = _MCP走("switch_conversation", {"target": 目标})
        if not ok:
            return _失败("切到 %s 失败：%s" % (目标, (切 or {}).get("原文", "未知")))
        time.sleep(1.6)
    ok, 快照 = _MCP走("get_snapshot")
    条们 = []
    if ok and 快照:
        条们 = [str(x) for x in (快照.get("pending_queue") or []) if str(x).strip()]
    写ok, 写说 = False, "（未写）"
    try:
        写ok, 写说 = _写排队库(号, 条们)
    except Exception as e:
        写说 = "写库异常：%s" % e
    if not 是否相同:
        try:
            _MCP走("switch_conversation", {"target": 原地 or 目标})
        except Exception:
            pass
    return _成功({"号": 号, "会话名": 名 or 号, "条数": len(条们), "条": 条们,
                "写库": 写ok, "写说": 写说,
                "当前": "（已切回 %s）" % 原地 if not 是否相同 else "（本来就是）"},
                ("%s 系统排队条 %d 条，已写回共享库" % (号, len(条们)))
                if 写ok else ("%s 排队条 %d 条（%s）" % (号, len(条们), 写说)))


def _cmd_派工复制预览(参数, 来源):
    收 = _派工收件人(参数)
    文 = _派工正文(参数)
    if not 文:
        return _失败("缺参数：文（派工正文不能为空）")
    全文 = _拼派工单(收, 文)
    return _成功({"收件人": 收, "全文": 全文, "字数": len(全文)},
                "已拼好 %d 字（收件人 %d 个）" % (len(全文), len(收)))


def _cmd_派工发送(参数, 来源):
    """逐个投递 + 成功的自动在 P3 建卡（标题=正文首行，负责人=该会话终身号）。"""
    收 = _派工收件人(参数)
    文 = _派工正文(参数)
    if not 收:
        return _失败("缺参数：收件人（按会话名选，多个用、或,分隔）")
    if not 文:
        return _失败("缺参数：文（派工正文不能为空）")
    # 【原话锁R3·2026-10-31】P9 快速派工也要过闸：身份来自执行层，不看参数。
    # 界面入口可自动绑最近一条人类原话；CLI/AI 必须自带真原话（且手动原话要是界面/令牌来路）。
    原话们 = _拆原话们((参数 or {}).get("原话"))
    人路 = "" if str(来源 or "").strip() == "CLI" else str(来源 or "")
    if not 原话们 and 人路:
        首行0 = (文.splitlines()[0] if 文.splitlines() else 文)[:60]
        键 = _最近人类原话() or _界面自动原话(首行0, 来源, "")
        原话们 = [键] if 键 else []
    if not 原话们:
        return _失败("缺少人类原话：P9 快速派工也必须先有一句老板原话（原话=2026-10-31#012）——"
                     "先由界面确认原话，或走 任务.建卡 → 派工单.新建 再发")
    错 = _校验原话们(原话们, 人路)
    if 错:
        return _失败("缺少人类原话：%s" % 错)
    if 人路 == "网页·远程":
        for 条 in 原话们:
            _留痕原话(条, "", 来源)
        公共.日志("远程放行：P9派工 收件人=%s 原话=%s 时刻=%s"
                  % ("、".join(收), "、".join(原话们), 公共.现在全()), "放行")
    员工们 = 采集器.读状态().get("员工", []) or []
    名表 = {}
    for 人 in 员工们:
        名表[str(人.get("会话名") or "")] = 人
    结果们, 卡们, 成功数 = [], [], 0
    for 名 in 收:
        人 = 名表.get(名) or {}
        号 = str(人.get("终身号") or "")
        全文 = _拼派工单([名], 文)
        好, 说明 = _发到会话(名, 全文, 号)
        if 好:
            成功数 += 1
            首行 = (文.splitlines()[0] if 文.splitlines() else 文)[:60].strip() or "（无标题）"
            卡id, _卡 = 任务卡库.建卡(首行, 详情=全文, 负责人=号, 来源="快速派工单", 谁=来源,
                                    来源原话=原话们)
            卡们.append(卡id)
            for 条 in 原话们:
                try:
                    原话解析.关联卡(条, 卡id, 来源)
                except Exception:
                    pass
        结果们.append({"收件人": 名, "终身号": 号, "ok": bool(好),
                       "说明": (说明 or "")[:300]})
    说明 = "逐个发送：成功 %d / %d%s" % (
        成功数, len(收), ("；已建卡 " + "、".join(卡们)) if 卡们 else "")
    数据 = {"结果": 结果们, "卡": 卡们, "成功": 成功数, "总数": len(收)}
    return (_成功(数据, 说明) if 成功数 == len(收) else _失败(说明, 数据))


# ---------------------------------------------------------------- P2 标签薄壳（只搬参数，业务在 标签库.py）
def _标签回(结果):
    ok, 说, 数据, 码 = 结果
    数据 = dict(数据 or {})
    if ok:
        return _成功(数据, 说)
    if 码:
        数据["原因码"] = 码
    return _失败(说, 数据)


def _标签卡数(卡们, 层级, id):
    return len([c for c in 卡们
                if str(((c.get("标签") or {}).get(层级)) or "") == str(id)])


def _cmd_标签项目列表(参数, 来源):
    数据 = 标签库.读()
    卡们 = 任务卡库.读().get("卡", []) or []
    词 = str(_取参数(参数, "关键词") or "").strip()
    含删 = str(_取参数(参数, "含已删") or "").lower() in ("1", "true", "是", "yes")
    出 = []
    for p in 数据["项目"]:
        if p.get("删") and not 含删:
            continue
        if 词 and 词 not in str(p.get("名") or ""):
            continue
        out = dict(p)
        out["模块数"] = len([m for m in 数据["模块"]
                           if str(m.get("项目")) == p.get("id") and not m.get("删")])
        out["动作数"] = len([a for a in 数据["动作"]
                           if str(a.get("项目")) == p.get("id") and not a.get("删")])
        out["卡数"] = _标签卡数(卡们, "项目", p.get("id"))
        出.append(out)
    return _成功({"项目": 出, "条数": len(出)}, "共 %d 个项目" % len(出))


def _cmd_标签模块列表(参数, 来源):
    名 = _取参数(参数, "项目")
    p = 标签库.解析("项目", 名)
    if not p:
        return _失败("项目不存在：%s" % 名, {"原因码": "not_found"})
    数据 = 标签库.读()
    卡们 = 任务卡库.读().get("卡", []) or []
    含删 = str(_取参数(参数, "含已删") or "").lower() in ("1", "true", "是", "yes")
    出 = [dict(m, 卡数=_标签卡数(卡们, "模块", m.get("id")))
          for m in 数据["模块"]
          if str(m.get("项目")) == p.get("id") and (含删 or not m.get("删"))]
    return _成功({"项目": p.get("id"), "模块": 出, "条数": len(出)},
                "%s 共 %d 个模块" % (p.get("名"), len(出)))


def _cmd_标签动作列表(参数, 来源):
    名 = _取参数(参数, "项目")
    p = 标签库.解析("项目", 名)
    if not p:
        return _失败("项目不存在：%s" % 名, {"原因码": "not_found"})
    数据 = 标签库.读()
    卡们 = 任务卡库.读().get("卡", []) or []
    含删 = str(_取参数(参数, "含已删") or "").lower() in ("1", "true", "是", "yes")
    出 = [dict(a, 卡数=_标签卡数(卡们, "动作", a.get("id")))
          for a in 数据["动作"]
          if str(a.get("项目")) == p.get("id") and (含删 or not a.get("删"))]
    出.sort(key=lambda x: (not x.get("预设"), x.get("排序") or 0))
    return _成功({"项目": p.get("id"), "动作": 出, "条数": len(出)},
                "%s 共 %d 个动作（预设 %d）"
                % (p.get("名"), len(出), len([x for x in 出 if x.get("预设")])))


def _cmd_标签新增(参数, 来源):
    return _标签回(标签库.新增(
        _取参数(参数, "层级"), _取参数(参数, "名"), 项目=_取参数(参数, "项目"),
        路径=_取参数(参数, "路径"),
        同步预设=str(_取参数(参数, "同步预设") or "true").lower() in ("1", "true", "是", "yes"),
        谁=来源))


def _cmd_标签改名(参数, 来源):
    return _标签回(标签库.改名(
        _取参数(参数, "层级"), _取参数(参数, "id") or _取参数(参数, "旧名"),
        _取参数(参数, "新名"), 项目=_取参数(参数, "项目"),
        模式=_取参数(参数, "模式") or "文件夹",
        确认=str(_取参数(参数, "确认") or "").lower() in ("1", "true", "是", "yes"),
        允许脱钩=str(_取参数(参数, "允许脱钩") or "").lower() in ("1", "true", "是", "yes"),
        谁=来源))


def _cmd_标签删除(参数, 来源):
    return _标签回(标签库.删除(
        _取参数(参数, "层级"), _取参数(参数, "id") or _取参数(参数, "名"),
        项目=_取参数(参数, "项目"), 方式=_取参数(参数, "方式") or "软删",
        改绑到=_取参数(参数, "改绑到"),
        恢复=str(_取参数(参数, "恢复") or "").lower() in ("1", "true", "是", "yes"),
        谁=来源))


def _cmd_标签同步预设(参数, 来源):
    return _标签回(标签库.同步预设(_取参数(参数, "项目")))


def _cmd_标签引用(参数, 来源):
    层级 = _取参数(参数, "层级")
    p = 标签库.解析("项目", _取参数(参数, "项目")) if 层级 in ("模块", "动作") else None
    卡号们, 错, 码 = 标签库.引用(层级, _取参数(参数, "id") or _取参数(参数, "名"),
                              项目=p.get("id") if p else None)
    if 卡号们 is None:
        return _失败(错, {"原因码": 码})
    n = 20
    try:
        n = max(1, int(_取参数(参数, "前N") or 20))
    except Exception:
        pass
    return _成功({"引用卡": len(卡号们), "卡": 卡号们[:n],
                "还有": max(0, len(卡号们) - n)}, "被 %d 张卡引用" % len(卡号们))


def _cmd_标签数据位置(参数, 来源):
    库路径 = 标签库.路径()
    返回 = {"数据目录": 公共.取路径("数据目录"), "标签库": 库路径,
            "任务卡": 公共.取路径("任务卡文件"),
            "原话备注": 原话解析.备注路径(),
            "账号": 公共.取路径("账号"), "端点": 公共.取路径("端点"),
            "沙盒": bool(getattr(公共, "沙盒根", "")),
            "标签库存在": os.path.isfile(库路径)}
    return _成功(返回, "标签库=%s（存在=%s）" % (库路径, 返回["标签库存在"]))


def _cmd_标签同步路径(参数, 来源):
    只报错 = str(_取参数(参数, "只报错") or "").lower() in ("1", "true", "是", "yes")
    return _标签回(标签库.同步路径(只报错=只报错))


def _cmd_任务换标签(参数, 来源):
    卡id = _取参数(参数, "卡").upper()
    if not 卡id:
        return _失败("缺参数：卡", {"原因码": "bad_param"})
    数据 = 任务卡库.读()
    import copy
    旧数据 = copy.deepcopy(数据)
    卡 = next((c for c in 数据.get("卡", []) if c.get("id") == 卡id), None)
    if 卡 is None:
        return _失败("任务卡不存在：%s" % 卡id, {"原因码": "not_found"})
    给 = {"项目": _取参数(参数, "项目"), "模块": _取参数(参数, "模块"),
          "动作": _取参数(参数, "动作")}
    新标 = dict(卡.get("标签") or {})
    解析项 = {}
    for 层, 值 in 给.items():
        if not str(值 or "").strip():
            continue
        项目id = 新标.get("项目")
        if 层 == "项目":
            p = 标签库.解析("项目", 值)
        else:
            p = 标签库.解析("项目", 项目id) if 项目id else None
            if 层 == "模块":
                t = 标签库.解析("模块", 值, p.get("id") if p else None)
            else:
                t = 标签库.解析("动作", 值, p.get("id") if p else None)
            if not t:
                return _失败("标签解析不到（%s=%s）" % (层, 值), {"原因码": "bad_tag"})
            解析项[层] = t.get("id")
            continue
        if not p:
            return _失败("项目标签解析不到：%s" % 值, {"原因码": "bad_tag"})
        解析项["项目"] = p.get("id")
    if 解析项:
        新标.update(解析项)
    # 三键齐时必须同项目
    项 = 新标.get("项目")
    if 项 and (新标.get("模块") or 新标.get("动作")):
        好, 说 = 标签库.标签齐({"标签": 新标})
        if not 好:
            return _失败(说, {"原因码": "project_mismatch"})
    卡["标签"] = 新标
    卡.setdefault("历史", []).append({"ts": 公共.现在秒(), "谁": 来源, "动作": "标签改绑"})
    任务卡库._写(旧数据, 数据)
    齐, 说 = 标签库.标签齐(卡)
    return _成功({"卡": 卡id, "标签": 新标, "标签齐": 齐},
                "已换标签 %s（标签齐=%s%s）" % (卡id, 齐, "" if 齐 else "：" + 说))


# ---------------------------------------------------------------- 命令表

命令表 = [
    {"命令": "账号.注册", "参数": {"终身号": "1111", "密码": ""}, "读写": "写", "页": "P1",
     "说明": "注册账号（终身号必填、密码可空＝免密）", "实现": _cmd_账号注册},
    {"命令": "账号.登录", "参数": {"终身号": "1111", "密码": "", "端点": "本机"}, "读写": "写", "页": "P1",
     "说明": "登录并切到 <账号>\\<端点> 数据空间（CLI 不许匿名）", "实现": _cmd_账号登录},
    {"命令": "账号.列表", "参数": {}, "读写": "读", "页": "P1",
     "说明": "已注册账号列表（供手机端下拉框用）", "实现": _cmd_账号列表},
    {"命令": "账号.改密", "参数": {"终身号": "1111", "旧密码": "", "密码": "新密"}, "读写": "写", "页": "P1",
     "说明": "改密码（密码传空＝改回免密）", "实现": _cmd_账号改密},
    {"命令": "账号.删除", "参数": {"终身号": "1111", "清数据": "是"}, "读写": "写", "页": "P1",
     "说明": "删账号；默认连该账号全部端点空间一起清（测试收尾用）", "实现": _cmd_账号删除},
    {"命令": "标签.项目列表", "参数": {"关键词": "", "含已删": ""}, "读写": "读", "页": "P2",
     "说明": "项目（一级标签）列表 + 模块/动作/卡数", "实现": _cmd_标签项目列表},
    {"命令": "标签.模块列表", "参数": {"项目": "PJ0001"}, "读写": "读", "页": "P2",
     "说明": "某项目下的模块（二级标签）", "实现": _cmd_标签模块列表},
    {"命令": "标签.动作列表", "参数": {"项目": "PJ0001"}, "读写": "读", "页": "P2",
     "说明": "某项目下的动作（三级标签，含预设标记）", "实现": _cmd_标签动作列表},
    {"命令": "标签.新增", "参数": {"层级": "项目", "名": "", "路径": "", "项目": "", "同步预设": "true"}, "读写": "写", "页": "P2",
     "说明": "新建标签（项目层须真实文件夹；自动补 9 个预设动作）", "实现": _cmd_标签新增},
    {"命令": "标签.改名", "参数": {"层级": "模块", "id": "MD0001", "新名": "…", "项目": "PJ0001"}, "读写": "写", "页": "P2",
     "说明": "改名（项目层默认同时改真实文件夹，须 确认=是）", "实现": _cmd_标签改名},
    {"命令": "标签.删除", "参数": {"层级": "模块", "id": "MD0001", "项目": "PJ0001", "方式": "软删"}, "读写": "写", "页": "P2",
     "说明": "删标签（软删/硬删；有引用须给替代，失败全回滚）", "实现": _cmd_标签删除},
    {"命令": "标签.同步预设", "参数": {"项目": "PJ0001"}, "读写": "写", "页": "P2",
     "说明": "幂等补齐 9 个预设动作（第二次插入=0）", "实现": _cmd_标签同步预设},
    {"命令": "标签.引用", "参数": {"层级": "模块", "id": "MD0001", "前N": "20"}, "读写": "读", "页": "P2",
     "说明": "查这个标签被哪些卡引用", "实现": _cmd_标签引用},
    {"命令": "任务.换标签", "参数": {"卡": "T0001", "项目": "PJ0001", "模块": "MD0001", "动作": "AC0001"}, "读写": "写", "页": "P2",
     "说明": "给卡改绑三层标签（可只给要改的层）", "实现": _cmd_任务换标签},
    {"命令": "标签.数据位置", "参数": {}, "读写": "读", "页": "P2",
     "说明": "只读：当前空间各数据文件真实绝对路径（排查用）", "实现": _cmd_标签数据位置},
    {"命令": "标签.同步路径", "参数": {"只报错": ""}, "读写": "写", "页": "P2",
     "说明": "只读扫描项目文件夹：纠正名/标丢失，绝不 rename 目录、不删标签", "实现": _cmd_标签同步路径},
    {"命令": "trae.状态", "参数": {}, "读写": "读", "页": "P1",
     "说明": "TRAE 健康块（进程/端口/模式/判定）", "实现": _cmd_trae状态},
    {"命令": "trae.重采集", "参数": {}, "读写": "写", "页": "P1",
     "说明": "立即重采一轮并写状态.json", "实现": _cmd_trae重采集},
    {"命令": "员工.列表", "参数": {}, "读写": "读", "页": "P2",
     "说明": "会话档案采集存在（终身号锚定/会话名/灯/距今秒/今日消息数，60秒刷新）", "实现": _cmd_员工列表},
    {"命令": "员工.排队", "参数": {"号": "0001"}, "读写": "读", "页": "P2",
     "说明": "读会话档案「系统排队条情况」（TRAE 可能滞后，以 员工.排队查询 为准）", "实现": _cmd_员工排队},
    {"命令": "员工.排队查询", "参数": {"号": "0001"}, "读写": "写", "页": "P2",
     "说明": "主动切到该 TRAE 会话读系统排队条，写回共享库 TRae 列，再切回", "实现": _cmd_员工排队查询},
    {"命令": "员工.催办", "参数": {"号": "0043", "话": "请回进度"}, "读写": "写", "页": "P2",
     "说明": "给该员工登记一条催办（v0.1 只登记，未接发信）", "实现": _cmd_员工催办},
    {"命令": "员工.我的列表", "参数": {}, "读写": "读", "页": "P4",
     "说明": "当前账号+当前端点的派工白名单", "实现": _cmd_员工我的列表},
    {"命令": "员工.我的新增", "参数": {"电脑": "家里电脑", "软件": "WorkBuddy", "会话名": "助理2号"}, "读写": "写", "页": "P4",
     "说明": "加白名单（允许建不存在的会话；电脑必须=当前端点）", "实现": _cmd_员工我的新增},
    {"命令": "员工.我的删除", "参数": {"会话名": "助理2号"}, "读写": "写", "页": "P4",
     "说明": "从白名单删除（只删白名单，不动会话）", "实现": _cmd_员工我的删除},
    {"命令": "任务.列表", "参数": {"状态": "在做"}, "读写": "读", "页": "P3",
     "说明": "任务卡列表 + 统计", "实现": _cmd_任务列表},
    {"命令": "任务.改详情", "参数": {"卡": "T0001", "详情": "…", "验收标准": "…"}, "读写": "写", "页": "P3",
     "说明": "改卡标题/详情/验收标准", "实现": _cmd_任务改详情},
    {"命令": "任务.建卡", "参数": {"标题": "…", "原话": "2026-10-31#012", "负责人": "0043", "优先级": "高", "来源": ""},
     "读写": "写", "页": "P3", "说明": "建一张任务卡", "实现": _cmd_任务建卡},
    {"命令": "任务.改状态", "参数": {"卡": "T0042", "到/状态": "已完成"}, "读写": "写", "页": "P3",
     "说明": "改状态并写历史（到 / 状态 两个键都收）", "实现": _cmd_任务改状态},
    {"命令": "任务.换负责人", "参数": {"卡": "T0042", "号": "0043"}, "读写": "写", "页": "P3",
     "说明": "换负责人并写历史", "实现": _cmd_任务换负责人},
    {"命令": "任务.加备注", "参数": {"卡": "T0042", "话": "…"}, "读写": "写", "页": "P3",
     "说明": "往详情追加一条备注", "实现": _cmd_任务加备注},
    {"命令": "分组.列表", "参数": {}, "读写": "读", "页": "P3",
     "说明": "全部分组 + 每张卡的计数", "实现": _cmd_分组列表},
    {"命令": "分组.新建", "参数": {"名": "TRAE 修改"}, "读写": "写", "页": "P3",
     "说明": "新建自定义分组", "实现": _cmd_分组新建},
    {"命令": "分组.改名", "参数": {"旧": "TRAE 修改", "新": "TRAE 调整"}, "读写": "写", "页": "P3",
     "说明": "分组改名（卡一起改）", "实现": _cmd_分组改名},
    {"命令": "分组.删除", "参数": {"名": "TRAE 修改"}, "读写": "写", "页": "P3",
     "说明": "删分组（卡落回未分类）", "实现": _cmd_分组删除},
    {"命令": "任务.换分组", "参数": {"卡": "T0042", "分组": "TRAE 修改"}, "读写": "写", "页": "P3",
     "说明": "把卡归到一个分组（一张卡只属一组）", "实现": _cmd_任务换分组},
    {"命令": "任务.关联原话", "参数": {"卡": "T0042", "条们": "2026-10-25#042"}, "读写": "写", "页": "P3",
     "说明": "改卡片关联的原话（可多张，双向写）", "实现": _cmd_任务关联原话},
    {"命令": "任务.补来源原话", "参数": {}, "读写": "写", "页": "P3",
     "说明": "存量旧卡批量补来源原话（对不上标无对应原话）", "实现": _cmd_任务补来源原话},
    {"命令": "任务.删卡", "参数": {"卡": "T0042"}, "读写": "写", "页": "P3",
     "说明": "删一张任务卡（不做回收站，日志留痕）", "实现": _cmd_任务删卡},
    {"命令": "任务.归档", "参数": {"卡": "T0042"}, "读写": "写", "页": "P3",
     "说明": "状态改作废（归档）", "实现": _cmd_任务归档},
    {"命令": "原话.列表", "参数": {"日": "2026-10-25"}, "读写": "读", "页": "P4",
     "说明": "全部原话 + 备注 + 关联卡", "实现": _cmd_原话列表},
    {"命令": "原话.备注", "参数": {"条": "2026-10-25#042", "话": "…"}, "读写": "写", "页": "P4",
     "说明": "给一条原话留备注", "实现": _cmd_原话备注},
    {"命令": "原话.关联卡", "参数": {"条": "2026-10-25#042", "卡": "T0042"}, "读写": "写", "页": "P4",
     "说明": "标记这句原话落实成了哪张卡（双向）", "实现": _cmd_原话关联卡},
    {"命令": "原话.建卡", "参数": {"条": "2026-10-25#042"}, "读写": "写", "页": "P4",
     "说明": "从这句原话一键建卡并自动关联", "实现": _cmd_原话建卡},
    {"命令": "原话.新建手动", "参数": {"文": "…"}, "读写": "写", "页": "P4",
     "说明": "手动新建一条原话（只限界面进程；CLI 一律拒，R4 收口）", "实现": _cmd_原话新建手动},
    {"命令": "原话.统计", "参数": {"日": "2026-10-25"}, "读写": "读", "页": "P4",
     "说明": "原话 N / 已派 M / 已验收 K / 未派 Z", "实现": _cmd_原话统计},
    {"命令": "系统.版本", "参数": {}, "读写": "读", "页": "全局",
     "说明": "版本号", "实现": _cmd_系统版本},
    {"命令": "系统.状态", "参数": {}, "读写": "读", "页": "全局",
     "说明": "整份 状态.json（网页·远程 取数用）", "实现": _cmd_系统状态},
    {"命令": "系统.自检", "参数": {}, "读写": "读", "页": "全局",
     "说明": "采集/端口/库/网页自检，返回 RESULT", "实现": _cmd_系统自检},
    {"命令": "系统.对齐自检", "参数": {}, "读写": "读", "页": "全局",
     "说明": "三端对照表（CLI/Tk/网页逐条真探测）", "实现": _cmd_系统对齐自检},
    {"命令": "叮嘱.列表", "参数": {}, "读写": "读", "页": "P9",
     "说明": "常用叮嘱小卡片库（8 张）", "实现": _cmd_叮嘱列表},
    {"命令": "派工单.新建", "参数": {"卡": "T0001", "收件人": "闲杂事务 1", "文": "…", "验收标准": "…"}, "读写": "写", "页": "P3",
     "说明": "给任务卡建一张派工单（可多收件人；正文与验收标准必填）", "实现": _cmd_派工单新建},
    {"命令": "派工单.列表", "参数": {"卡": "T0001"}, "读写": "读", "页": "P3",
     "说明": "按卡/单号查派工单（带来源卡与来源原话）", "实现": _cmd_派工单列表},
    {"命令": "派工单.留言", "参数": {"单": "G0001", "话": "…", "谁": "0043"}, "读写": "写", "页": "P3",
     "说明": "在单的留言板追加一条（不问答）", "实现": _cmd_派工单留言},
    {"命令": "派工单.交稿", "参数": {"单": "G0001", "证据": "…", "完成程度": "已完成",
                                "备注": "…", "异常备注": "…", "谁": "0001"}, "读写": "写", "页": "P3",
     "说明": "接单方交稿：已受理→已回复；完成程度五选一；普通/异常备注分开落", "实现": _cmd_派工单交稿},
    {"命令": "派工单.验收", "参数": {"单": "G0001", "结论": "合格", "话": "…", "谁": "0043"}, "读写": "写", "页": "P3",
     "说明": "验收者结论（合格/不合格/退回整改，留言板记结论）", "实现": _cmd_派工单验收},
    {"命令": "派工单.提醒", "参数": {"单": "G0001"}, "读写": "写", "页": "P3",
     "说明": "一键提醒收件人查看该单", "实现": _cmd_派工单提醒},
    {"命令": "派工单.发送", "参数": {"单": "P0001"}, "读写": "写", "页": "P3",
     "说明": "把派工单发给全部收件人，成功回写状态=已派", "实现": _cmd_派工单发送},
    {"命令": "派工单.投递", "参数": {"单": "G0001"}, "读写": "写", "页": "P4",
     "说明": "按单投递到收件人会话；成功→已派，失败记原文（发送保留别名）", "实现": _cmd_派工单投递},
    {"命令": "派工单.接单", "参数": {"单": "G0001", "谁": "0002"}, "读写": "写", "页": "P4",
     "说明": "接单方确认：已派→已受理（未投递成功拒）", "实现": _cmd_派工单接单},
    {"命令": "派工单.已读", "参数": {"单": "G0001", "谁": "111"}, "读写": "写", "页": "P4",
     "说明": "发单方标记已阅读（未回复拒；留痕谁/何时/端点）", "实现": _cmd_派工单已读},
    {"命令": "派工单.闭环", "参数": {"单": "G0001", "谁": "111"}, "读写": "写", "页": "P4",
     "说明": "已阅读→已完成（未读/投递失败拒）", "实现": _cmd_派工单闭环},
    {"命令": "派工单.作废", "参数": {"单": "G0001", "原因": "…", "谁": "111"}, "读写": "写", "页": "P4",
     "说明": "终态作废；必须填原因；令牌立即失效", "实现": _cmd_派工单作废},
    {"命令": "派工单.令牌", "参数": {"单": "G0001", "动作": "生成/作废/校验", "链接令牌": "…"}, "读写": "写", "页": "P4",
     "说明": "令牌生成/作废/校验；只存 sha256(明文+单号)，7 天", "实现": _cmd_派工单令牌},
    {"命令": "派工.复制预览", "参数": {"收件人": "0043,0019", "文": "…"}, "读写": "读", "页": "P9",
     "说明": "拼好派工单全文（供复制/预览）", "实现": _cmd_派工复制预览},
    {"命令": "派工.发送", "参数": {"收件人": "0043", "文": "…", "原话": "2026-10-31#012"}, "读写": "写", "页": "P9",
     "说明": "按收件人逐个投到 TRAE 会话，成功自动建卡", "实现": _cmd_派工发送},
    {"命令": "异常.列表", "参数": {"类型": "1,2", "状态": "未处理", "页": "1"}, "读写": "读", "页": "P5",
     "说明": "8 类实时推导列表（20 条/页，P0→P1→P2→时刻→类型）", "实现": _cmd_异常列表},
    {"命令": "异常.统计", "参数": {}, "读写": "读", "页": "P5",
     "说明": "未处理/已处理/历史已处理/按类型 8 项计数", "实现": _cmd_异常统计},
    {"命令": "异常.标已处理", "参数": {"指纹": "2#G0001|2026-10-31 18:00:00", "说明": "…"}, "读写": "写", "页": "P5",
     "说明": "按指纹标已处理（幂等、不可撤销；复发新指纹不继承）", "实现": _cmd_异常标已处理},
    {"命令": "提醒.状态", "参数": {}, "读写": "读", "页": "P5",
     "说明": "主人忙闲四态＋待推/暂缓/冷却中/队列长度", "实现": _cmd_提醒状态},
    {"命令": "提醒.设忙闲", "参数": {"值": "自动/忙/闲"}, "读写": "写", "页": "P5",
     "说明": "人工忙闲（2 小时回落自动），写留痕", "实现": _cmd_提醒设忙闲},
    {"命令": "提醒.标已推", "参数": {"键": "2#G0001", "结果": "已推/已点掉"}, "读写": "写", "页": "P5",
     "说明": "已推→冷却 1800 秒；已点掉→出队＋留痕", "实现": _cmd_提醒标已推},
    {"命令": "系统.日志", "参数": {"行数": "50"}, "读写": "读", "页": "全局",
     "说明": "动作日志尾巴", "实现": _cmd_系统日志},
    {"命令": "手册.目录", "参数": {}, "读写": "读", "页": "P5",
     "说明": "手册页列表（文件名/标题/条目数/字节/mtime）", "实现": _cmd_手册目录},
    {"命令": "手册.一文", "参数": {}, "读写": "读", "页": "P5",
     "说明": "工作手册＝清单系统 S36《总管工作手册》JSON 层级树（直接读源文件）", "实现": _cmd_手册一文},
    {"命令": "手册.读", "参数": {"页": "04_故障速查"}, "读写": "读", "页": "P5",
     "说明": "返回该页 Markdown 原文", "实现": _cmd_手册读},
    {"命令": "手册.搜", "参数": {"词": "假成功"}, "读写": "读", "页": "P5",
     "说明": "全文搜，最多 50 条命中", "实现": _cmd_手册搜},
    {"命令": "手册.追加", "参数": {"页": "04_故障速查", "话": "…"}, "读写": "写", "页": "P5",
     "说明": "页末追加一条（自动时间前缀）", "实现": _cmd_手册追加},
    {"命令": "手册.新建", "参数": {"标题": "…"}, "读写": "写", "页": "P5",
     "说明": "新建 NN_标题.md，套三段模板", "实现": _cmd_手册新建},
]

命令映射 = {项["命令"]: 项 for 项 in 命令表}
命令名列表 = [项["命令"] for 项 in 命令表]


def 有命令(命令):
    return 命令 in 命令映射


def 命令清单():
    """给三个壳用的清单（含参数说明），只读。"""
    return [{"命令": 项["命令"], "参数": 项["参数"], "读写": 项["读写"],
             "页": 项["页"], "说明": 项["说明"]} for 项 in 命令表]


def 执行(命令, 参数=None, 来源="CLI", 记账=True, 凭证=None, 会话号=None):
    """三端唯一入口。身份＝内存里的界面会话（R4）；参数自称一律当冒充剥掉并告警。"""
    起点 = time.time()
    参数 = dict(参数 or {})
    入口来源 = str(来源 or "").strip()      # 归一前的入口来源：WS=网页·远程，HTTP=网页
    项 = 命令映射.get(命令)
    人 = _人路(凭证, 会话号, 来源)
    自称 = [k for k in ("来源", "人工确认", "录入人", "令牌") if k in 参数]
    if not 人:
        if 自称 or str(来源 or "").strip() not in ("", "CLI"):
            公共.日志("冒充告警：命令=%s 声称来源=%s 冒充参数=%s 无界面会话 → 按 AI 处理并忽略"
                      % (命令, 来源, "、".join(自称) or "无"), "警告")
            for k in 自称:
                参数.pop(k, None)
        来源 = "CLI"
    else:
        来源 = 人
    if 项 is None:
        结果 = _失败("未知命令：%s（只允许命令表里的 %d 条）" % (命令, len(命令表)))
        公共.日志("拒绝未知命令 %s（来源 %s）" % (命令, 来源), "警告")
        return 结果
    切了 = False
    if 需要空间(命令) or 命令 == "系统.版本":
        号 = str(参数.get("账号") or 参数.get("终身号") or "").strip()
        if 号:
            好, _说 = 进入线程空间(号, str(参数.get("端点") or "").strip())
            切了 = bool(好)
        公共.日志("执行入口：命令=%s 账号=%s 端点=%s 入口来源=%s 归一来源=%s 线程切空间=%s 数据目录=%s"
                  % (命令, 号 or "（空=默认空间）",
                     str(参数.get("端点") or "").strip() or "（默认）",
                     入口来源 or "（空）", 来源, "是" if 切了 else "否", 公共.取路径("数据目录")), "放行")
    try:
        结果 = 项["实现"](参数, 来源)
    except Exception as 错:
        import traceback
        公共.日志("命令 %s 异常: %s\n%s" % (命令, 错, traceback.format_exc()), "错误")
        结果 = _失败("执行异常: %s" % 错)
    finally:
        if 切了:
            退出线程空间()
    结果["耗时ms"] = int((time.time() - 起点) * 1000)
    结果.setdefault("数据", None)
    结果.setdefault("说明", "")
    if 项["读写"] == "写" and 记账:
        结果["aid"] = _记一笔(命令, 参数, 来源, 结果.get("ok"), 结果.get("说明", ""),
                            结果["耗时ms"])
    结果["命令"] = 命令
    结果["来源"] = 来源
    return 结果


def 预检(命令, 参数=None):
    """--dry：只校验命令在命令表里（不落地任何写）。
    对齐自检就是靠这条证明"CLI 壳能叫到这条命令"，因此无参数也必须通过。
    """
    项 = 命令映射.get(命令)
    if 项 is None:
        return _失败("未知命令：%s（不在命令表里）" % 命令)
    参数 = 参数 or {}
    已知 = set((项.get("参数") or {}).keys())
    多余 = [键 for 键 in 参数.keys() if 键 not in 已知]
    return _成功({"命令": 命令, "参数": 参数, "读写": 项["读写"], "页": 项["页"],
                "dry": True, "未知参数": 多余}, "dry 通过（未落任何写）")
