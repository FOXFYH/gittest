# -*- coding: utf-8 -*-
"""
总管面板 · 采集器
------------------------------------------------------------
1 秒一轮，只观测、只写 使用痕迹\总管面板\状态.json（.tmp + os.replace 原子写）。
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

def 采员工(配置, trae块=None, 卡表=None):
    """数据源：TRAE 聊天账本.db 的 msgs 表，按 title 取 max(tm)。
    灯：<180s 绿干活中 / 180~900 灰待命 / >900 黄失联；TRAE 崩 → 全红。
    """
    账本 = 配置.get("账本路径") or ""
    if not 账本 or not os.path.isfile(账本):
        raise RuntimeError("未找到账本（配置.账本路径 为空或文件不存在）")
    import sqlite3
    连接 = sqlite3.connect("file:%s?mode=ro" % 账本.replace("\\", "/"), uri=True, timeout=3)
    try:
        名表 = {}
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
    聚合 = {}
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

    只取号 = 配置.get("员工只取终身号", True)
    卡表 = 卡表 if 卡表 is not None else 任务卡库.读().get("卡", [])
    trae崩 = bool(trae块 and trae块.get("判定") == "红")

    员工们 = []
    for 标题, 项 in 聚合.items():
        是号 = bool(标题.isdigit() and len(标题) == 4)
        if 只取号 and not 是号:
            continue
        距 = None
        if 项["末值"] is not None:
            距 = max(0, int((time.time() - 项["末值"].timestamp())))
        if trae崩:
            灯 = "红"
        elif 距 is None:
            灯 = "灰"
        elif 距 < 180:
            灯 = "绿"
        elif 距 <= 900:
            灯 = "灰"
        else:
            灯 = "黄"
        手上 = [卡.get("id") for 卡 in 卡表
              if 卡.get("负责人") == 标题 and 卡.get("状态") in ("未做", "在做", "卡住")]
        员工们.append({
            "终身号": 标题 if 是号 else "",
            "会话名": 名表.get(标题) or 标题,
            "标题": 标题,
            "灯": 灯,
            "最后活动": (项["末"].split(" ")[-1] if 项["末"] else ""),
            "最后活动原文": 项["末"],
            "距今秒": 距 if 距 is not None else -1,
            "今日消息数": 项["今日"],
            "手上任务": 手上,
            "来源": "账本",
        })
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
            "证据": 卡.get("证据", []),
            "创建": 卡.get("创建", ""),
            "更新": 卡.get("更新", ""),
        })
    卡们.sort(key=lambda c: c["id"])
    return {"统计": 统计, "卡": 卡们}


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

    for 人 in 结果.get("员工", []):
        灯们.append(人.get("灯", "灰"))

    失联 = [人 for 人 in 结果.get("员工", []) if 人.get("灯") == "黄" and 人.get("距今秒", 0) > 900]
    失联.sort(key=lambda e: e.get("距今秒", 0))
    for 人 in 失联[:3]:
        横幅.append("%s 已失联 %s" % (人.get("终身号") or 人.get("会话名", "?"),
                                    公共.格式化秒(人.get("距今秒"))))
    if len(失联) > 3:
        横幅.append("另有 %d 人失联" % (len(失联) - 3))
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
