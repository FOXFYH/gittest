# -*- coding: utf-8 -*-
"""
AI工作台 · 采集器
------------------------------------------------------------
1 秒一轮，只观测、只写 使用痕迹\AI工作台\状态.json（.tmp + os.replace 原子写）。
红线：
  1. 不杀、不重启任何真进程，本模块只读。
  2. 单区块出错只把该区块写成 {"判定":"灰","判定原因":"采集异常: …"}，整份不许崩。
  3. 界面模式读不到就写"未知"判灰 —— 绝不猜。
"""
import json
import os
import socket
import subprocess
import time

import 公共
import 任务卡库
import 原话解析

try:
    import psutil  # 进程启动时刻；没有就降级（起 留空，不编）
except Exception:
    公共.日志("未装 psutil，进程启动时刻将留空", "警告")
    psutil = None

try:
    import requests
    import websocket  # websocket-client
except Exception:
    requests = None
    websocket = None

_空白员工 = []


# ---------------------------------------------------------------- 进程 / 端口

def _跑命令(命令, 超时=4):
    try:
        结果 = subprocess.run(命令, capture_output=True, text=True,
                             encoding="gbk", errors="replace", timeout=超时,
                             creationflags=0x08000000)  # CREATE_NO_WINDOW
        return (结果.stdout or "") + (结果.stderr or "")
    except Exception as 错:
        return ""


def 采进程(进程名):
    """tasklist 过滤，注意过滤器名字必须带 .exe。返回 [{pid, 起}]"""
    输出 = _跑命令(["tasklist", "/FI", "IMAGENAME eq %s" % 进程名, "/FO", "CSV", "/NH"])
    明细 = []
    for 行 in 输出.splitlines():
        行 = 行.strip()
        if not 行.startswith('"'):
            continue
        格 = [c.strip('"') for c in 行.split('","')]
        if len(格) < 2:
            continue
        try:
            pid = int(格[1])
        except Exception:
            continue
        起 = ""
        if psutil is not None:
            try:
                起 = time.strftime("%H:%M:%S", time.localtime(psutil.Process(pid).create_time()))
            except Exception:
                起 = ""
        明细.append({"pid": pid, "起": 起})
    明细.sort(key=lambda x: x["pid"])
    return 明细


def _监听表():
    """一次 netstat，返回 {端口: pid}（只认 LISTENING）"""
    表 = {}
    输出 = _跑命令(["netstat", "-ano"])
    for 行 in 输出.splitlines():
        行 = 行.strip()
        if "LISTEN" not in 行.upper():
            continue
        块 = 行.split()
        if len(块) < 5:
            continue
        本地 = 块[1]
        if ":" not in 本地:
            continue
        try:
            端口 = int(本地.rsplit(":", 1)[1])
            pid = int(块[-1])
        except Exception:
            continue
        表.setdefault(端口, pid)
    return 表


def 端口在(端口):
    s = socket.socket()
    s.settimeout(0.25)
    try:
        return s.connect_ex(("127.0.0.1", int(端口))) == 0
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


# ---------------------------------------------------------------- 界面模式（CDP）

def 读界面模式(端口=9599):
    """返回 (模式, 读取方式)。只认 Code/Work；读到别的（如 Design）判未知，原因另写。"""
    if requests is None or websocket is None:
        return "未知", "失败"
    try:
        目标们 = requests.get("http://127.0.0.1:%d/json/list" % int(端口), timeout=2).json()
    except Exception:
        return "未知", "失败"
    页 = [t for t in 目标们 if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    if not 页:
        return "未知", "失败"
    # 优先 solo 页面（TRAE 的模式切换器在这上面）
    页.sort(key=lambda t: 0 if "solo" in (t.get("url") or "") else 1)
    js = ("(function(){var els=document.querySelectorAll('.mode-switcher-btn [role=\"tab\"],"
          ".mode-switcher-btn');var out=[];for(var i=0;i<els.length;i++){out.push({"
          "t:(els[i].innerText||'').trim(),s:els[i].getAttribute('aria-selected')});}"
          "return {n:els.length,list:out};})()")
    连 = None
    try:
        连 = websocket.create_connection(页[0]["webSocketDebuggerUrl"], timeout=2,
                                       suppress_origin=True)
        连.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                           "params": {"expression": js, "returnByValue": True}}))
        截止 = time.time() + 2.5
        while time.time() < 截止:
            报文 = json.loads(连.recv())
            if 报文.get("id") != 1:
                continue
            值 = (((报文.get("result") or {}).get("result") or {}).get("value") or {})
            for 项 in 值.get("list", []):
                文案 = (项.get("t") or "").strip()
                if 项.get("s") == "true":
                    if 文案 in ("Code", "Work"):
                        return 文案, "CDP"
                    return "未知", "CDP"  # 读到了但不是 Code/Work，老实说未知
            return "未知", "CDP"
    except Exception:
        return "未知", "失败"
    finally:
        if 连 is not None:
            try:
                连.close()
            except Exception:
                pass
    return "未知", "失败"


# ---------------------------------------------------------------- TRAE 区块

# TRAE 侧（抓取轮询 0.67 起）主动推来的积分文件；缓存判据＝stat 快照
# （mtime_ns + size 都没变就不 open；与相隔几秒无关，1 秒节拍不再撞阈值）
_积分缓存 = {"签名": None, "值": {}}


def _读积分(路径=None):
    """读 <数据目录>\\TRAE积分.json，返回 {积分 / 积分时刻 / 积分账号}。

    文件不在 / 坏了 → 返回空 dict（字段留空，不报错、不猜）；
    (st_mtime_ns, st_size) 与上次相同 → 直接返回上次解析好的字典，
    不 open、不 json.loads（跟隔了几秒无关，只看文件变没变）。
    """
    路径 = 路径 or os.path.join(公共.数据目录, "TRAE积分.json")
    try:
        st = os.stat(路径)
        签名 = (st.st_mtime_ns, st.st_size)
    except OSError:
        return {}
    if 签名 == _积分缓存["签名"]:
        return _积分缓存["值"]
    数据 = 公共.读json(路径, {}) or {}
    值 = {}
    if isinstance(数据, dict):
        积分 = 数据.get("points")
        if not (isinstance(积分, (int, float)) or
                (isinstance(积分, str) and 积分.strip())):
            积分 = ""
        值 = {
            "积分": 积分,
            "积分时刻": str(数据.get("时刻") or ""),
            "积分账号": str(数据.get("name") or ""),
        }
    _积分缓存.update({"签名": 签名, "值": 值})
    return 值


def 采trae(配置, 监听表=None):
    进程名 = 配置.get("进程名") or "TRAE SOLO CN.exe"
    端口CDP = int(配置.get("端口9599") or 9599)
    端口服务 = int(配置.get("端口19876") or 19876)
    监听表 = 监听表 if 监听表 is not None else _监听表()

    明细 = 采进程(进程名)
    端口9599 = 端口在(端口CDP)
    端口19876 = 端口在(端口服务)
    模式, 读法 = (读界面模式(端口CDP) if 端口9599 else ("未知", "失败"))

    启动信息 = 公共.读json(配置.get("服务端启动json") or "", {}) or {}
    启动时刻 = 启动信息.get("启动时间", "")
    if 启动时刻 and len(启动时刻) > 8:
        启动时刻 = 启动时刻.split(" ")[-1]

    重启次数 = _记重启(启动信息.get("启动时间", ""))

    原因 = []
    if not 明细:
        判定 = "红"
        原因.append("进程 0 个")
    elif not 端口9599:
        判定 = "红"
        原因.append("CDP %d 未监听" % 端口CDP)
    elif 模式 != "Code":
        判定 = "黄"
        原因.append("当前模式 %s" % (模式 if 模式 != "未知" else "未知（读不到）"))
    else:
        判定 = "绿"
        原因.append("进程在、两端口在、Code 模式")
    if not 端口19876:
        原因.append("控制服务 %d 不在" % 端口服务)
    if 重启次数 >= 2:
        判定 = 公共.最坏([判定, "黄"])
        原因.append("10 分钟内重启 %d 次，疑似崩溃循环" % 重启次数)

    积分信息 = _读积分()

    return {
        "进程数": len(明细),
        "进程名": 进程名,
        "进程明细": 明细[:40],
        "端口9599": 端口9599,
        "端口19876": 端口19876,
        "服务端pid": 监听表.get(端口服务, 0),
        "界面模式": 模式,
        "模式读取方式": 读法,
        "服务端启动时刻": 启动时刻,
        "服务端版本": 启动信息.get("版本", ""),
        "服务端重启次数_10分钟": 重启次数,
        "判定": 判定,
        "判定原因": "；".join(原因),
        "积分": 积分信息.get("积分", ""),
        "积分时刻": 积分信息.get("积分时刻", ""),
        "积分账号": 积分信息.get("积分账号", ""),
    }


def _记重启(当前启动时间):
    """维护内部事件表，返回 10 分钟内观测到的重启次数。"""
    内部 = 公共.读json(公共.内部状态文件, {}) or {}
    事件 = [e for e in 内部.get("重启事件", []) if isinstance(e, list) and len(e) == 2]
    现在 = time.time()
    上次 = 内部.get("上次启动时间", "")
    if 当前启动时间 and 上次 and 当前启动时间 != 上次:
        事件.append([int(现在), 当前启动时间])
    if 当前启动时间:
        内部["上次启动时间"] = 当前启动时间
    事件 = [e for e in 事件 if 现在 - e[0] <= 1800]  # 留半小时，够算 10 分钟
    内部["重启事件"] = 事件
    try:
        公共.原子写json(公共.内部状态文件, 内部)
    except Exception:
        pass
    return len([e for e in 事件 if 现在 - e[0] <= 600])


# ---------------------------------------------------------------- 员工区块

最后员工错误 = ""


def _读名册():
    """读 <数据目录>\员工名册.json（A 方案：名册＝人员全集）。返回 (名册dict|None, 路径)。"""
    路径 = os.path.join(公共.数据目录, "员工名册.json")
    if not os.path.isfile(路径):
        return None, 路径
    数据 = 公共.读json(路径, None)
    if not isinstance(数据, dict) or not isinstance(数据.get("员工"), list):
        return None, 路径
    return 数据, 路径


_档案缓存 = {"时刻": 0.0, "人": [], "来源": "", "错": "", "读于": ""}


def _档案库路径():
    """云档案库.db 路径（使用痕迹下「共享数据库使用痕迹*」取最新；可用 配置.会话档案库 指定）。"""
    配置 = 公共.读配置() or {}
    指定 = str(配置.get("会话档案库") or "").strip()
    if 指定 and os.path.isfile(指定):
        return 指定
    根 = str(配置.get("痕迹根") or "").strip() or os.path.dirname(公共.数据目录)
    候选 = []
    try:
        for 名 in os.listdir(根):
            if 名.startswith("共享数据库使用痕迹"):
                候 = os.path.join(根, 名, "云档案库.db")
                if os.path.isfile(候):
                    候选.append(候)
    except Exception:
        return ""
    if not 候选:
        return ""
    候选.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return 候选[0]


def 读会话档案名册(强制=False, 刷新秒=60):
    """（老板 2026-10-27 口径）员工＝共享数据库「会话档案」库 TRae 里
    `终身号状态=采集存在` 的会话，锚定 4 位终生号；CDP 实时维护，本端 60 秒刷新一次。
    返回 (人, 来源, 错, 读于)。DB 读不到就返回空并给出原因，由 采员工 退回 员工名册.json。"""
    现在 = time.time()
    if not 强制 and _档案缓存["人"] and (现在 - _档案缓存["时刻"] < 刷新秒):
        return _档案缓存["人"], _档案缓存["来源"], _档案缓存["错"], _档案缓存["读于"]
    库 = _档案库路径()
    人 = []
    错 = ""
    来源 = ""
    if not 库:
        错 = "找不到云档案库.db"
    else:
        try:
            import sqlite3
            连接 = sqlite3.connect("file:%s?mode=ro" % 库.replace("\\", "/"), uri=True, timeout=3)
            try:
                行 = {}
                for 键, 字段, 值 in 连接.execute("select 行键,字段,值 from 值 where 库='TRae'"):
                    try:
                        值 = json.loads(值)
                    except Exception:
                        pass
                    行.setdefault(键, {})[字段] = 值
            finally:
                连接.close()
            for _键, 档 in 行.items():
                if str(档.get("终身号状态") or "").strip() != "采集存在":
                    continue
                号 = str(档.get("终生号") or "").strip()
                if not (号.isdigit() and len(号) == 4):
                    continue
                名 = str(档.get("会话名") or "").strip()
                排 = 档.get("系统排队条情况")
                排数, 排时, 排条 = 0, "", []
                if isinstance(排, str) and 排.strip():
                    try:
                        q = json.loads(排)
                        if isinstance(q, dict):
                            排数 = int(q.get("条数") or 0)
                            排时 = str(q.get("时刻") or "")
                            排条 = [str(x) for x in (q.get("条") or [])]
                    except Exception:
                        pass
                人.append({"号": 号, "题": 号, "会话名": 名 or 号, "册距今": None,
                          "sid": str(档.get("SID") or "").strip(),
                          "排队条数": 排数, "排队时刻": 排时, "排队条": 排条})
            人.sort(key=lambda x: x["号"])
            来源 = "会话档案·采集存在（CDP 实时）"
        except Exception as e:
            错 = "云档案库读不到：%s" % e
            来源 = ""
    _档案缓存.update({"时刻": 现在, "人": 人, "来源": 来源, "错": 错,
                      "读于": time.strftime("%H:%M:%S")})
    return 人, 来源, 错, _档案缓存["读于"]


def _时长文本(距):
    """距上次活动 → 人话：忙碌 X 分 / 闲置 Y 分（或 小时 分）。取不到给 —。"""
    if 距 is None or 距 < 0:
        return "—"
    if 距 < 60:
        return "忙碌 <1 分"
    if 距 < 180:
        return "忙碌 %d 分" % (距 // 60)
    if 距 < 3600:
        return "闲置 %d 分" % (距 // 60)
    return "闲置 %d 小时 %d 分" % (距 // 3600, (距 % 3600) // 60)


def 采员工(配置, trae块=None, 卡表=None):
    """人员全集＝员工名册.json（A 方案，含「未开」）；账本只补 最后活动/距今秒/今日消息数。
    名册缺失 → 退化为「账本现推」并写明来源（不静默）；
    账本读不到 → 名册照列，原因写进 最后员工错误（上屏横幅）。
    灯：<180s 绿干活中 / 180~900 灰待命 / >900 黄失联；TRAE 崩 → 全红。"""
    global 最后员工错误
    最后员工错误 = ""
    账本 = 配置.get("账本路径") or ""
    名表 = {}
    聚合 = {}
    账本错 = ""
    if not 账本 or not os.path.isfile(账本):
        账本错 = "账本读不到：%s" % (账本 or "（配置.账本路径 为空，或文件不存在）")
        最后员工错误 = 账本错
    else:
        try:
            import sqlite3
            连接 = sqlite3.connect("file:%s?mode=ro" % 账本.replace("\\", "/"), uri=True, timeout=3)
            try:
                try:
                    for 标题, 名 in 连接.execute("select title, name from conv_meta"):
                        名表[标题] = (名 or "").strip()
                except Exception:
                    pass
                行们 = list(连接.execute(
                    "select title, tm from msgs order by rowid desc limit 20000"))
            finally:
                连接.close()
            今天 = 公共.今天前缀()
            for 标题, tm in 行们:
                if not 标题:
                    continue
                项 = 聚合.setdefault(标题, {"末": "", "末值": None, "今日": 0})
                值 = 公共.解析时间(tm)
                if 值 is not None:
                    if 项["末值"] is None or 值 > 项["末值"]:
                        项["末值"] = 值
                        项["末"] = tm
                    if 值.strftime("%Y-%m-%d") == 今天:
                        项["今日"] += 1
                elif tm:
                    if not 项["末"]:
                        项["末"] = tm
        except Exception as 错:
            账本错 = "账本读不到：%s" % 错
            最后员工错误 = 账本错
            聚合 = {}
            名表 = {}

    只取号 = 配置.get("员工只取终身号", True)
    卡表 = 卡表 if 卡表 is not None else 任务卡库.读().get("卡", [])
    trae崩 = bool(trae块 and trae块.get("判定") == "红")
    档案人, 档案来源, 档案错, 档案读于 = 读会话档案名册()
    名册, _名册路径 = _读名册()
    名册人 = []
    if 档案人:
        # 唯一真源＝CDP 维护的会话档案（终身号状态=采集存在），锚定 4 位终生号
        名册人 = list(档案人)
        来源前缀 = "会话档案(采集存在)+账本"
        if 账本错:
            来源前缀 = "会话档案(采集存在)（账本读不到）"
    elif isinstance(名册, dict):
        for 人 in (名册.get("员工") or []):
            人 = 人 if isinstance(人, dict) else {}
            号 = str(人.get("终身号") or "").strip()
            题 = str(人.get("账本title") or 号).strip()
            if not 题:
                continue
            if 只取号 and not (题.isdigit() and len(题) == 4):
                continue
            名册人.append({"号": 号, "题": 题,
                          "会话名": str(人.get("会话名") or 题),
                          "册距今": 人.get("距今秒")})
        来源前缀 = "名册+账本"
    if not 名册人:
        名册人 = [{"号": 题 if (题.isdigit() and len(题) == 4) else "",
                  "题": 题, "会话名": (名表.get(题) or 题), "册距今": None}
                 for 题 in 聚合.keys()]
        来源前缀 = "账本（名册缺失）"
        if not 名册人 and 账本错:
            raise RuntimeError(账本错)
    if 档案错 and not 账本错:
        最后员工错误 = 档案错 + ("（已退回 员工名册.json）" if 名册人 else "（名册也缺，已退回账本）")
    if 名册人 and 账本错 and 档案人:
        来源前缀 = "会话档案(采集存在)（账本读不到）"

    员工们 = []
    for 项 in 名册人:
        聚合项 = 聚合.get(项["题"]) or {}
        距 = None
        if 聚合项.get("末值") is not None:
            距 = max(0, int((time.time() - 聚合项["末值"].timestamp())))
        elif isinstance(项.get("册距今"), (int, float)):
            距 = int(项["册距今"])
        手上 = [卡.get("id") for 卡 in 卡表
              if 卡.get("负责人") == 项["题"] and 卡.get("状态") in ("未做", "在做", "卡住")]
        # 灯分档（2026-10-26 老板口径：别再 35/37 全黄）：
        #   绿＝3 分钟内有动静；黄＝有任务却闲置超 30 分钟（才需要管）；灰＝其余正常待命；红＝TRAE 崩
        if trae崩:
            灯 = "红"
        elif 距 is None:
            灯 = "灰"
        elif 距 < 180:
            灯 = "绿"
        elif 手上 and 距 > 1800:
            灯 = "黄"
        else:
            灯 = "灰"
        员 = {
            "终身号": 项["号"],
            "会话名": 项["会话名"] or 名表.get(项["题"]) or 项["题"],
            "标题": 项["题"],
            "灯": 灯,
            "最后活动": (聚合项["末值"].strftime("%H:%M:%S")
                        if 聚合项.get("末值") is not None
                        else (聚合项.get("末") or "").split(" ")[-1]),
            "最后活动原文": 聚合项.get("末") or "",
            "距今秒": 距 if 距 is not None else -1,
            "时长": _时长文本(距),
            "今日消息数": 聚合项.get("今日", 0),
            "手上任务": 手上,
            "任务明细": [{"id": c.get("id"), "标题": c.get("标题", ""),
                         "状态": c.get("状态", ""), "更新": c.get("更新", "")}
                        for c in 卡表 if c.get("负责人") == 项["题"]],
            "来源": 来源前缀 if 聚合项 else ("名册（账本无此 title）" if 名册人 else "账本（名册缺失）"),
            "名册来源": 来源前缀,
            "档案刷新": 档案读于,
            "排队条数": 项.get("排队条数", 0),
            "排队时刻": 项.get("排队时刻", ""),
        }
        员工们.append(员)
    员工们.sort(key=lambda e: (e["距今秒"] if e["距今秒"] >= 0 else 10 ** 9))
    return 员工们


# ---------------------------------------------------------------- 任务区块

def 采任务(员工们=None):
    数据 = 任务卡库.读()
    统计 = 任务卡库.统计(数据)
    名表 = {}
    for 人 in (员工们 or []):
        if 人.get("终身号"):
            名表[人["终身号"]] = 人.get("会话名", "")
    卡们 = []
    for 卡 in 数据.get("卡", []):
        卡们.append({
            "id": 卡.get("id", ""),
            "标题": 卡.get("标题", ""),
            "状态": 卡.get("状态", "未做"),
            "负责人": 卡.get("负责人", ""),
            "负责人名": 名表.get(卡.get("负责人", ""), ""),
            "优先级": 卡.get("优先级", ""),
            "截止": 卡.get("截止", ""),
            "来源": 卡.get("来源", ""),
            "来源原话": 卡.get("来源原话", []) or [],
            "分组": 卡.get("分组", "未分类") or "未分类",
            "证据": 卡.get("证据", []),
            "创建": 卡.get("创建", ""),
            "更新": 卡.get("更新", ""),
        })
    卡们.sort(key=lambda c: c["id"])
    return {"统计": 统计, "卡": 卡们, "分组": list(数据.get("分组") or ["未分类"])}


# ---------------------------------------------------------------- 服务区块

def 采服务(配置, 监听表=None):
    监听表 = 监听表 if 监听表 is not None else _监听表()
    端口 = int(配置.get("端口19876") or 19876)
    在 = 端口在(端口)
    心跳 = None
    路径 = 配置.get("服务端启动json") or ""
    if 路径 and os.path.isfile(路径):
        心跳 = int(max(0, time.time() - os.path.getmtime(路径)))
    return [{
        "名": "TRAE控制服务",
        "端口": 端口,
        "在": 在,
        "pid": 监听表.get(端口, 0) if 在 else 0,
        "心跳秒": 心跳 if 心跳 is not None else -1,
        "灯": "绿" if 在 else "红",
    }]


# ---------------------------------------------------------------- 原话区块

def 采原话(日=None):
    日 = 日 or 公共.今天前缀()
    统计 = 原话解析.统计(日)
    统计["灯"] = "红" if 统计.get("未派", 0) > 0 else "绿"
    return {"统计": 统计}


# ---------------------------------------------------------------- 一轮

def 采集一轮(配置, 网页端口=0):
    起点 = time.time()
    结果 = {"ts": 公共.现在全(), "ts_ms": 公共.现在毫秒(), "网页端口": 网页端口}
    监听表 = {}
    try:
        监听表 = _监听表()
    except Exception:
        pass

    # P1
    try:
        结果["trae"] = 采trae(配置, 监听表)
    except Exception as 错:
        结果["trae"] = {"判定": "灰", "判定原因": "采集异常: %s" % 错}

    # P3 先采（员工要用手上任务）
    try:
        员工们 = 采员工(配置, 结果.get("trae"), None)
        结果["员工"] = 员工们
        if 最后员工错误:
            结果["员工错误"] = 最后员工错误
    except Exception as 错:
        结果["员工"] = []
        结果["员工错误"] = "采集异常: %s" % 错

    try:
        结果["任务"] = 采任务(结果.get("员工"))
    except Exception as 错:
        结果["任务"] = {"判定": "灰", "判定原因": "采集异常: %s" % 错,
                      "统计": {"未做": 0, "在做": 0, "已完成": 0, "卡住": 0, "作废": 0}, "卡": []}

    try:
        结果["服务"] = 采服务(配置, 监听表)
    except Exception as 错:
        结果["服务"] = [{"名": "TRAE控制服务", "端口": 0, "在": False, "pid": 0,
                      "心跳秒": -1, "灯": "灰", "判定原因": "采集异常: %s" % 错}]

    try:
        结果["原话"] = 采原话()
    except Exception as 错:
        结果["原话"] = {"统计": {"判定": "灰", "判定原因": "采集异常: %s" % 错}}

    # ---- 汇总
    trae块 = 结果.get("trae") or {}
    横幅 = []
    灯们 = [trae块.get("判定", "灰")]
    if trae块.get("进程数") == 0:
        横幅.append("TRAE 进程 0 个")
    if trae块.get("端口9599") is False:
        横幅.append("TRAE CDP 9599 未监听")
    if trae块.get("端口19876") is False:
        横幅.append("TRAE 控制服务 19876 不在")
    if trae块.get("界面模式") not in ("Code", None):
        横幅.append("当前模式 %s" % trae块.get("界面模式"))

    if 结果.get("员工错误"):
        横幅.append(结果["员工错误"])
    for 人 in 结果.get("员工", []):
        灯们.append(人.get("灯", "灰"))

    失联 = [人 for 人 in 结果.get("员工", []) if 人.get("灯") == "黄" and 人.get("距今秒", 0) > 1800]
    失联.sort(key=lambda e: e.get("距今秒", 0))
    # 顶部只报「真正需要处理」的：有任务却失联；其余只给一个总数，避免整屏刷黄
    需处理 = [人 for 人 in 失联 if (人.get("手上任务") or [])]
    for 人 in 需处理[:3]:
        横幅.append("%s 有任务却失联 %s（%s）" % (
            人.get("终身号") or 人.get("会话名", "?"),
            公共.格式化秒(人.get("距今秒")), ",".join(人.get("手上任务") or [])))
    if len(需处理) > 3:
        横幅.append("另有 %d 人有任务且失联" % (len(需处理) - 3))
    if 失联 and not 需处理:
        横幅.append("失联 %d 人（均无在手任务，仅作提示）" % len(失联))
    for 服务 in 结果.get("服务", []):
        灯们.append(服务.get("灯", "灰"))
    for 卡 in (结果.get("任务") or {}).get("卡", []):
        pass

    结果["横幅"] = 横幅
    结果["总状态"] = 公共.最坏(灯们)
    结果["采集耗时ms"] = int((time.time() - 起点) * 1000)
    return 结果


def 写状态(状态):
    公共.原子写json(公共.状态文件, 状态)
    return 状态


def 采一轮并写(配置, 网页端口=0):
    return 写状态(采集一轮(配置, 网页端口))


def 读状态():
    return 公共.读json(公共.状态文件, {}) or {}
