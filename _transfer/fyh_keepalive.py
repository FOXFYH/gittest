# -*- coding: utf-8 -*-
"""
FYH 自动保活引擎（自身模块，打进 EXE）
======================================
定期巡检被标记 keep_alive 的应用，发现没在运行就自动拉起一份（绝不多开）；
频繁掉线、或连拉几次都起不来 → 通过「钉钉97」通道通知管理员。

设计要点（与用户确认）：
1. 每个应用各自一轮（默认 600 秒），首轮把各应用按 i*(间隔/N) 均匀错峰，
   避免所有应用同一时刻集中检查（精确到每一个，不爆发）。
2. 调度器 5 秒 tick 一次，单线程串行；任何时刻最多 1 个应用在检测。
3. 防多开三道闸：
   ① 先查（_app_running）再拉；
   ② 拉起后设「启动宽限期」，宽限期内不再重复拉；
   ③ 每个应用一把「在飞锁」（_inflight）。
4. 告警（走钉钉97，后台线程，不阻塞巡检）：
   - 频繁掉线：flap_window_sec 内被判定掉线 ≥ flap_times 次（默认 1 小时 3 次）；
   - 连续失败：连续 fail_rounds 轮拉起后仍不在运行（默认 3 轮）。
   每个应用告警冷却 alert_cooldown_sec（默认 1 小时），避免轰炸。
5. 应用清单来自共享清单 应用清单.py、keep_alive 开关来自本机独立状态，
   二者都经远程控制模块 _load_apps() 读取（本引擎不自己读清单文件）；
   巡检参数放在本机配置夹 保活配置.json（缺省用内置默认，首次自动生成）。

本模块由 FYH 主程序在启动统一WS 之后实例化并 start() 一次；
不要放进 FYH远程控制模块.py（该文件每次收到指令都会被重新 exec）。
"""
# v1.01（2026-10-02）：跟随远程控制模块 v1.10 清单共享化——不再引用已移除的
#   APPS_FILE；保活配置目录改用 _rc._CTRL_DIR_（本机配置夹，位置与原来一致）。
APP_VERSION = "1.01"

import os
import sys
import json
import time
import string
import threading
import subprocess

# ---- 复用远程控制模块的 应用清单/检测/启动 能力（模块级函数，无状态冲突） ----
try:
    import importlib.machinery as _imach
    import importlib.util as _ilu
    _RC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "FYH远程控制模块.py")
    _rc_loader = _imach.SourceFileLoader("fyh_rc_for_ka", _RC_PATH)
    _rc_spec = _ilu.spec_from_file_location("fyh_rc_for_ka", _RC_PATH, loader=_rc_loader)
    _rc = _ilu.module_from_spec(_rc_spec)
    _rc_loader.exec_module(_rc)
except Exception as _e:
    _rc = None
    _RC_ERR = str(_e)

_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# 默认巡检参数（写入 保活配置.json，可手工调）
_ENGINE_DEFAULTS = {
    "interval_sec": 600,        # 每个应用一轮的间隔（秒）
    "start_grace_sec": 30,      # 拉起后的启动宽限期（秒），期内不重复拉
    "flap_window_sec": 3600,    # 频繁掉线统计窗口（秒）
    "flap_times": 3,            # 窗口内掉线达此次数 → 告警
    "fail_rounds": 3,           # 连续拉起失败达此轮数 → 告警
    "alert_cooldown_sec": 3600, # 同一应用告警冷却（秒）
}


def _load_engine_conf():
    """读取（不存在则生成）巡检参数：本机配置夹 FYH远程控制 下的 保活配置.json"""
    conf = dict(_ENGINE_DEFAULTS)
    try:
        base = _rc._CTRL_DIR_ if _rc else os.path.dirname(os.path.abspath(__file__))
        path = os.path.join(base, "保活配置.json")
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                conf.update({k: v for k, v in data.items() if k in conf})
        else:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(conf, f, ensure_ascii=False, indent=2)
    except Exception:
        pass
    return conf


# ==================== 钉钉97 通知（智能寻找发送器，不写死路径） ====================
_跳过目录 = {"__pycache__", ".git", "node_modules", "历史版本", "备份", "旧版"}
_发送器入口缓存 = None


def _锚定工作台():
    """从本模块上溯到名为「工作台」的主文件夹（永不改名的锚点）"""
    cur = os.path.dirname(os.path.abspath(__file__))
    while True:
        if os.path.basename(cur) == "工作台":
            return cur
        up = os.path.dirname(cur)
        if up == cur:
            return None
        cur = up


def _找发送器入口():
    global _发送器入口缓存
    if _发送器入口缓存 and os.path.isfile(_发送器入口缓存):
        return _发送器入口缓存
    root = _锚定工作台()
    if not root:
        return None
    name = "webhook发送器含CLI.py"
    try:
        for cur, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _跳过目录]
            if name in files:
                _发送器入口缓存 = os.path.join(cur, name)
                return _发送器入口缓存
    except Exception:
        pass
    return None


def _取解释器():
    """真 Python 解释器：候选 → 各盘根浅扫 → 冻结适配 → 主程序解释器"""
    for p in (r"D:\Python310\python.exe", r"D:\PY\python.exe"):
        if os.path.isfile(p):
            return p
    for c in string.ascii_uppercase:
        try:
            for e in os.scandir(c + ":\\"):
                exe = os.path.join(e.path, "python.exe")
                if e.is_dir() and os.path.isfile(exe):
                    return exe
        except Exception:
            continue
    try:
        from 冻结环境 import 取解释器 as _取
        return _取()
    except ImportError:
        return sys.executable


def _发钉钉97(消息, 日志):
    """后台线程发送，不阻塞巡检；失败仅记日志"""
    def 发送():
        try:
            entry = _找发送器入口()
            if not entry:
                日志("保活: 未找到 webhook发送器，钉钉97未送达")
                return
            r = subprocess.run([_取解释器(), entry, "钉钉", "97", 消息],
                               capture_output=True, text=True, timeout=60,
                               encoding="utf-8", errors="replace",
                               creationflags=_CREATE_NO_WINDOW)
            if r.returncode == 0:
                日志("保活: 已同步钉钉97")
            else:
                日志("保活: 钉钉97同步失败 " +
                     ((r.stdout or "") + (r.stderr or "")).strip()[-120:])
        except Exception as e:
            日志(f"保活: 钉钉97同步异常 {e}")
    threading.Thread(target=发送, daemon=True).start()


class KeepAliveEngine:
    """自动保活调度器（单实例，由主程序持有并 start 一次）"""

    def __init__(self, ws_app, log=None):
        self.ws = ws_app
        self._log = log or (lambda m: None)
        self._stop = threading.Event()
        self._thread = None
        self._inflight = {}       # key -> 拉起时间戳（在飞锁 + 启动宽限期）
        self._down_history = {}   # key -> [掉线时间戳, ...]
        self._fail_count = {}     # key -> 连续拉起失败轮数
        self._last_alert = {}     # key -> 上次告警时间戳
        self._next_check = {}     # key -> 下次检查时间戳
        self._first_round = True
        c = _load_engine_conf()
        self._interval = max(60, int(c.get("interval_sec") or 600))
        self._grace = max(5, int(c.get("start_grace_sec") or 30))
        self._flap_window = max(60, int(c.get("flap_window_sec") or 3600))
        self._flap_times = max(2, int(c.get("flap_times") or 3))
        self._fail_rounds = max(2, int(c.get("fail_rounds") or 3))
        self._alert_cool = max(60, int(c.get("alert_cooldown_sec") or 3600))

    # ---------- 生命周期 ----------
    def start(self):
        if _rc is None:
            self._log(f"保活引擎未启动：远程控制模块加载失败")
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self._log(f"自动保活引擎已启动（每应用 {self._interval} 秒一轮，首轮错峰）")

    def stop(self):
        self._stop.set()

    # ---------- 主循环：5 秒 tick，单线程串行 ----------
    def _loop(self):
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as e:
                self._log(f"保活: 巡检异常 {e}")
            self._stop.wait(5)

    def _tick(self):
        apps = [a for a in _rc._load_apps() if a.get("keep_alive")]
        now = time.time()
        # 首轮：各应用按 i*(interval/N) 均匀错峰，避免集中爆发检查
        if self._first_round:
            n = max(1, len(apps))
            for i, a in enumerate(apps):
                self._next_check[a.get("key")] = now + i * (self._interval / n)
            self._first_round = False
        # 清理已取消保活的应用状态
        keys = set(a.get("key") for a in apps)
        for k in list(self._next_check):
            if k not in keys:
                self._next_check.pop(k, None)
        for a in apps:
            k = a.get("key")
            if not k:
                continue
            if now >= self._next_check.get(k, 0):
                self._check_one(a)
                self._next_check[k] = time.time() + self._interval

    # ---------- 单个应用巡检 ----------
    def _check_one(self, app):
        k = app.get("key")
        name = app.get("name") or k
        inflight_ts = self._inflight.get(k, 0)
        # 闸②：启动宽限期内不重复拉
        if inflight_ts and (time.time() - inflight_ts) < self._grace:
            return
        # 闸①：先查——在跑就什么都不做
        if _rc._app_running(app):
            if inflight_ts:
                self._inflight.pop(k, None)
                self._fail_count[k] = 0
                self._log(f"保活: {name} 已恢复运行")
            return
        if not _rc._app_installed(app):
            self._inflight.pop(k, None)
            return
        # 上一轮已拉过、宽限期已过仍没起来 → 记一次失败
        if inflight_ts:
            self._inflight.pop(k, None)
            self._fail_count[k] = self._fail_count.get(k, 0) + 1
            if self._fail_count[k] >= self._fail_rounds:
                self._alert(k, app, f"连续 {self._fail_count[k]} 轮自动拉起后仍不在运行")
                self._fail_count[k] = 0
                return
        # 频繁掉线判定
        if self._record_down(k):
            self._alert(k, app, f"{self._flap_window // 60} 分钟内掉线达 {self._flap_times} 次，疑似反复掉线")
        # 拉起（闸①已确认未运行 → 不会多开；闸③在飞锁标记，防重复）
        ok = _rc._app_open(app, self.ws)
        self._inflight[k] = time.time()
        self._log(f"保活: {name} 未运行 → 已自动拉起({'成功' if ok else '失败'})")

    def _record_down(self, k):
        """记一次掉线；窗口内次数达阈值返回 True（并清零重新计数）"""
        now = time.time()
        hist = self._down_history.setdefault(k, [])
        hist.append(now)
        hist[:] = [t for t in hist if now - t <= self._flap_window]
        if len(hist) >= self._flap_times:
            hist.clear()
            return True
        return False

    def _alert(self, k, app, reason):
        now = time.time()
        if now - self._last_alert.get(k, 0) < self._alert_cool:
            return
        self._last_alert[k] = now
        dev = ""
        try:
            dev = self.ws.get_device_name() if self.ws else ""
        except Exception:
            pass
        name = app.get("name") or app.get("key") or "?"
        msg = f"【FYH自动保活】{dev} 上的「{name}」：{reason}，请检查。"
        self._log("保活告警: " + msg)
        _发钉钉97(msg, self._log)
