# -*- coding: utf-8 -*-
"""
FYH远程控制模块 —— FYH 统一WS 的远程控制执行器（独立下级模块）
==============================================================
设计要点：
1. 应用清单：共享清单「应用清单.py」（放在 WPS 网盘工作台内，改一次全机同步）。
   由本模块直接 import 读取；找不到时回落本模块内置的默认清单。
   保活 keep_alive 属本机"使用痕迹"，单独存本机配置夹，不随清单同步。
2. 支持指令（网页面板经【FYHRC】...【/FYHRC】发送，JSON 格式）：
   - {"cmd":"app_list"}                      → 回本机应用清单+运行状态
   - {"cmd":"app_open","key":..}             → 打开应用
   - {"cmd":"app_close","key":..}            → 关闭应用
   - {"cmd":"app_restart","key":..}          → 重启应用
   - {"cmd":"app_status","key":..}           → 查询单个应用状态
   - {"cmd":"keep_alive_set","key":..,"on":true/false} → 开关该应用自动保活
3. 操作后回执：ws_app.send_remote_msg({...}) 统一【FYHRC】格式回状态。
4. 由 FYH 主程序收到远程控制消息后调用 handle_remote_cmd(body, sender, ws_app)。
   本模块不依赖 sys.path，全部通过参数 ws_app 与统一 WS 模块通信。
v1.14（2026-10-02）：修操作后回执状态"报反"
   - 进程快照在一条指令内缓存；打开/关闭/重启后回执里的 running 仍取自操作前的
     旧快照 → 刚启动的应用回执报 running=False（面板卡片一度显示"未运行"），
     需手动刷新才转正确。改为回执前清快照重取，操作后状态即时准确。
   - 抽出 _snapshot_reset() 统一清缓存（_app_open 也改用它）。
v1.13（2026-10-02）：修"重启"假成功（脚本类应用重启后起不来）
   - 进程快照在本条指令内被缓存复用；重启=先关后开，关掉后旧的快照仍把该应用
     标成"运行中"，_app_open 据此跳过拉起并返回成功 → 面板显示"操作成功"但进程
     实际已死。改为 _app_open 开头清快照缓存，重新探测真实运行状态再决定是否拉起。
v1.12（2026-10-02）：修脚本类应用"运行状态恒显示未运行"
   - 进程快照用 PowerShell 取命令行，输出编码与 Python 解码不一致 → 中文路径乱码
     （"FYH快速访问2.0"→"fyhٷ2.0"）→ 按命令行匹配全部失败，脚本类应用一律误报
     "未运行"。改为把命令行 Base64(UTF-8) 传输（输出纯 ASCII），彻底免疫编码问题。
     影响：fyh/trae_server/workbuddy_cli_server/tts_server 等脚本类应用的状态显示。
v1.11（2026-10-02）：兼容旧版 WS 模块（修 H 端"清单取不到"）
   - 旧版「FYH统一WS模块.py」没有 get_device_id()，本模块一执行就抛 AttributeError、
     回包发不出去 → 面板永远收不到该机清单。改为经 _dev_id() 取值：有持久 device_id
     就用它，没有则退化为设备昵称（旧端仍能被面板按名识别），不再崩溃。
v1.10（2026-10-02）：清单共享化 + 保活本地化
   - 应用清单改由 WPS 网盘工作台内的共享「应用清单.py」导入读取（改一次全机同步），
     不再读写本机 D 盘 apps.json；共享清单找不到时回落本模块内置默认清单；
   - keep_alive 与"自动找到的安装路径"改存本机独立文件「本机状态.json」（使用痕迹，
     各机独立），不再写回共享清单，避免各机互相覆盖路径/保活状态。
v1.09（2026-10-02）：修 app_list 应答慢（实测 9~11 秒）
   - 每个 cmdline 类应用原各跑一次 PowerShell 查进程，5 个脚本类应用 ≈ 10 次串行；
     改为"一条指令内只做一次全量进程快照（python/pythonw 的 PID+命令行）、内存匹配"；
   - 顺带修正 _cmdline_procs("") 会匹配到全部 python 进程的隐患（空标记现返回空）。
v1.08（2026-10-02）：修"幽灵应用卡"闪烁 + 支持控制 FYH 自身
   - app_list 回应回带 req_id/device_id：网页面板据此只认自己本轮请求的回应，
     杜绝别的设备/旧版端串台回应导致的按钮闪烁（如幽灵"记事本"）；
   - 新增"控制 FYH 自身"：_self_target 识别目标是否本进程，关/重启改由分离助手
     延时执行（先回包再自杀，避免自杀后回包/拉起丢失）；脚本类应用已在运行则
     不再重复拉起（防止多开产生幽灵设备）。
v1.07（2026-10-01）：保活默认全关
   - 取消任何预置的默认保活应用（此前 4 个服务型默认开），一律默认 False；
   - 哪个应用需要保活，完全由用户在网页面板上人工指定。
v1.06（2026-10-01）：多电脑管理
   - 目标过滤优先按设备ID（device_id 主键，昵称退为辅助；兼容旧的按名 target）；
   - 应用清单回包新增 keep_alive 字段；新增 keep_alive_set 指令（写回 apps.json）。
"""
APP_VERSION = "1.14"

import os
import sys
import json
import time
import base64
import subprocess

try:                                # 冻结适配：数据根=EXE 旁（冻结）/项目根（未冻结）
    from 冻结环境 import 数据根 as _数据根
    _ROOT_ = _数据根()
except ImportError:                 # 本文件被单独拷出去运行时的兜底
    _ROOT_ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_CONFIG_BASE_ = os.path.join("D:\\", "配置文件", "FYH配置文件夹") if os.path.isdir("D:\\") else \
    os.path.join(_ROOT_, "配置文件")
_CTRL_DIR_ = os.path.join(_CONFIG_BASE_, "FYH远程控制")
os.makedirs(_CTRL_DIR_, exist_ok=True)
# v1.10：清单走 WPS 网盘工作台内的共享「应用清单.py」；apps.json 不再作为清单源。
# 本机独立"使用痕迹"（保活开关 + 自动找到的安装路径）存本机配置夹，各机独立不同步。
LOCAL_STATE_FILE = os.path.join(_CTRL_DIR_, "本机状态.json")

# 用户手填根目录：FYH远程控制目录下「手填根目录.txt」，每行一个候选根
# （允许用户提供可能的根目录，如 F:\网络硬盘，并入自动搜索范围）
_EXTRA_ROOTS_FILE = os.path.join(_CTRL_DIR_, "手填根目录.txt")

def _user_extra_roots():
    roots = []
    try:
        if os.path.isfile(_EXTRA_ROOTS_FILE):
            with open(_EXTRA_ROOTS_FILE, "r", encoding="utf-8") as f:
                for ln in f:
                    root = ln.strip().strip('"').rstrip("\\")
                    if root and os.path.isdir(root) and root not in roots:
                        roots.append(root)
    except Exception:
        pass
    return roots

# 内置兜底默认清单（仅在找不到共享「应用清单.py」时使用）。
# 正常情况请改工作台内的共享清单 应用清单.py 增删应用；本清单退化为保底。
DEFAULT_APPS = [
    {"key": "sunlogin", "name": "向日葵远程", "exe": "SunloginClient.exe",
     "exes": ["SunloginClient.exe", "AweSun.exe"],
     "path": "", "args": "",
     "install_paths": [
         r"C:\Program Files\Oray\SunLogin\SunloginClient\SunloginClient.exe",
         r"C:\Program Files (x86)\Oray\SunLogin\SunloginClient\SunloginClient.exe",
         r"D:\Program Files\Oray\SunLogin\SunloginClient\SunloginClient.exe",
         r"C:\Program Files\Oray\AweSun\AweSun.exe",
         r"C:\Program Files (x86)\Oray\AweSun\AweSun.exe",
         r"D:\Program Files\Oray\AweSun\AweSun.exe",
     ],
     "install_keywords": ["sunlogin", "向日葵"]},
    {"key": "todesk", "name": "ToDesk", "exe": "ToDesk.exe",
     "exes": ["ToDesk.exe"],
     "path": "", "args": "",
     "install_paths": [
         r"C:\Program Files\ToDesk\ToDesk.exe",
         r"C:\Program Files (x86)\ToDesk\ToDesk.exe",
         r"D:\Program Files\ToDesk\ToDesk.exe",
     ],
     "install_keywords": ["todesk"]},
    {"key": "trae_server", "name": "TRAE同步服务端", "exe": "", "path": "", "args": "",
     # 脚本类应用：pythonw 运行 .pyw，进程名通用，改用命令行匹配检测
     "run_detect": "cmdline",
     "cmdline_mark": "TRAE同步显示与控制工具_服务端.pyw",
     "install_paths": [
         r"D:\WPS云盘\脚本备份\工作台\AI大模型工具\TRAE同步显示与控制工具\TRAE同步显示与控制工具_服务端.pyw",
     ],
     "install_keywords": []},
    {"key": "workbuddy_server", "name": "WorkBuddy同步服务端", "exe": "", "path": "", "args": "",
     # 脚本类应用：pythonw 运行 .pyw，进程名通用，改用命令行匹配检测
     "run_detect": "cmdline",
     "cmdline_mark": "WorkBuddy同步显示与控制工具_服务端.pyw",
     "install_paths": [
         r"D:\WPS云盘\脚本备份\工作台\AI大模型工具\WorkBuddy同步显示与控制工具\WorkBuddy同步显示与控制工具_服务端.pyw",
     ],
     "install_keywords": []},
    {"key": "workbuddy_cli_server", "name": "WorkBuddyCLI服务端", "exe": "", "path": "", "args": "",
     # 远程控制 CLI 版服务端：pythonw 运行 .pyw，进程名通用，改用命令行匹配检测
     "run_detect": "cmdline",
     "cmdline_mark": "WorkBuddy 清爽版.pyw",
     "install_paths": [
         r"D:\WPS云盘\脚本备份\工作台\AI大模型工具\WorkBuddy远程控制CLI版\WorkBuddy 清爽版.pyw",
     ],
     "install_keywords": []},
    {"key": "tts_server", "name": "网页版文字转语音服务", "exe": "", "path": "", "args": "",
     # 手机版 TTS 本地服务：pythonw 运行 .py（HTTP 8650 + WS 监听），命令行匹配检测
     "run_detect": "cmdline",
     "cmdline_mark": "本地TTS服务.py",
     "install_paths": [
         r"D:\WPS云盘\脚本备份\工作台\网页版文字转语音\本地TTS服务.py",
     ],
     "install_keywords": []},
]

# v1.07：保活一律默认关闭，需不需要保活由用户人工指定（不再有任何预置默认开启的应用）

# 安装检测缓存（搜索结果复用，5 分钟内不重复全盘搜索）
_SEARCH_CACHE = {}          # key -> (bool, 时间戳)
_SEARCH_CACHE_TTL = 300
_manual_dialog_open = False   # 人工指定弹窗互斥：同时只弹一个

# 动态探测本机存在的盘符（与具体盘号无关，D 盘优先，能适配任意电脑/盘符迁移）
def _detect_drives():
    drv = []
    import string as _s
    for c in _s.ascii_uppercase:
        p = c + ":"
        if os.path.isdir(p + "\\"):
            drv.append(p)
    drv.sort(key=lambda d: 0 if d == "D:" else 1)   # D 盘优先
    return drv

# 智能寻址核心关键词：用户指定的重点词（与盘符无关，全盘搜索找这些名字）
#   · "云盘" / "网盘"           → 真正的同步盘根（如 WPS云盘 / D:\WPS云盘）
#   · "工作台"                  → 项目/脚本总入口，也并入搜索根
#   · "网络"/"硬盘"/"共享"/"挂载" → 引导目录（本身不是云盘，但多套了一层，
#                                  真正的盘根藏在它的子级里，如 网络硬盘\WPS云盘）
def _looks_like_syncroot(name):
    lw = name.lower()
    return "云盘" in name or "网盘" in name or "工作台" in name or "workspace" in lw

def _looks_like_guide(name):
    return "网络" in name or "硬盘" in name or "网盘" in name \
           or "共享" in name or "挂载" in name

# 自动寻找安装位置（脚本类应用/常见安装目录），全盘搜索、不依赖固定盘符
_SEARCH_ROOTS = []
for _drive in _detect_drives():
    for _sub in (r"\Program Files", r"\Program Files (x86)", r"\ProgramData"):
        _p = _drive + "\\" + _sub
        if os.path.isdir(_p):
            _SEARCH_ROOTS.append(_p)
    # 智能寻址：并入本盘下所有「云盘/网盘/工作台」同步目录根，供 .pyw/.exe
    # 按文件名自动定位；两级跨挂载（网络硬盘\WPS云盘）也会深挖一层并入。
    try:
        with os.scandir(_drive + "\\") as _it:
            for _e in _it:
                if not _e.is_dir():
                    continue
                _n = _e.name
                if _looks_like_syncroot(_n) and os.path.isdir(_e.path):
                    _SEARCH_ROOTS.append(_e.path)
                elif _looks_like_guide(_n) and os.path.isdir(_e.path):
                    try:
                        with os.scandir(_e.path) as _it2:
                            for _e2 in _it2:
                                if not _e2.is_dir():
                                    continue
                                if _looks_like_syncroot(_e2.name) \
                                        and os.path.isdir(_e2.path):
                                    _SEARCH_ROOTS.append(_e2.path)
                    except Exception:
                        continue
    except Exception:
        continue

# 用户手填根目录并入搜索根（_auto_find_path 用 _walk_limited 递归扫描，
# 手填根会连同内部层级一起覆盖到，无需再单独处理两级跨挂载）
for _ur in _user_extra_roots():
    if _ur not in _SEARCH_ROOTS:
        _SEARCH_ROOTS.append(_ur)


# ============ 共享清单 / 本机状态（v1.10） ============
# 共享清单「应用清单.py」放在 WPS 网盘工作台内，改一次全机同步；
# 本机状态（保活开关、自动找到的安装路径）存本机配置夹，各机独立。
_MANIFEST_NAME = "应用清单.py"


def _find_workbench_base():
    """返回「工作台」目录的上一级（各机盘符不同，靠目录名定位，不写死盘符）"""
    d = os.path.dirname(os.path.abspath(__file__))
    while d and os.path.dirname(d) != d:
        if os.path.basename(d) == "工作台":
            return os.path.dirname(d)
        d = os.path.dirname(d)
    for root in _SEARCH_ROOTS:          # 兜底：在搜索根里找名为「工作台」的子目录
        try:
            with os.scandir(root) as it:
                for e in it:
                    if e.is_dir() and e.name == "工作台":
                        return root
        except Exception:
            continue
    return None


def _find_manifest_path():
    """定位共享清单 应用清单.py：优先工作台内，其次模块同级，最后按文件名兜底深搜"""
    base = _find_workbench_base()
    cands = []
    if base:
        cands.append(os.path.join(base, "工作台", "FYH快速访问", _MANIFEST_NAME))
    here = os.path.dirname(os.path.abspath(__file__))
    cands.append(os.path.join(os.path.dirname(here), _MANIFEST_NAME))
    cands.append(os.path.join(_ROOT_, "FYH快速访问", _MANIFEST_NAME))
    for c in cands:
        if os.path.isfile(c):
            return c
    for root in _SEARCH_ROOTS:          # 兜底：按文件名深搜（限深防卡死）
        try:
            for _dp, _fns in _walk_limited(root, maxdepth=4):
                if _MANIFEST_NAME in _fns:
                    return os.path.join(_dp, _MANIFEST_NAME)
        except Exception:
            continue
    return None


def _load_shared_apps():
    """从共享清单 py 读取 APPS（按文件路径 import，中文文件名安全）；失败返回 []"""
    path = _find_manifest_path()
    if not path:
        return []
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("FYH应用清单", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        data = getattr(mod, "APPS", None)
        if isinstance(data, list):
            return [dict(a) for a in data if isinstance(a, dict)]
    except Exception:
        pass
    return []


def _resolve_install_paths(apps):
    """共享清单里的相对路径（如 工作台\\...）按本机「工作台」真实位置补全为绝对路径"""
    base = _find_workbench_base()
    if not base:
        return
    for a in apps:
        out = []
        for p in (a.get("install_paths") or []):
            p = str(p or "")
            if p and not os.path.isabs(p):
                p = os.path.join(base, p)
            out.append(p)
        a["install_paths"] = out


def _load_local_state():
    """读本机独立状态：{key: {"keep_alive": bool, "found_path": str}}"""
    try:
        if os.path.isfile(LOCAL_STATE_FILE):
            with open(LOCAL_STATE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_local_state(state):
    try:
        with open(LOCAL_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def _set_local(key, **kv):
    """更新本机状态里某个应用的字段（保活/找到的路径），其余字段保持不动"""
    if not key:
        return False
    st = _load_local_state()
    item = st.get(key)
    if not isinstance(item, dict):
        item = {}
    item.update(kv)
    st[key] = item
    return _save_local_state(st)


def _load_apps():
    """加载应用清单：以共享清单 py 为准，找不到回落内置默认清单；
    再叠加本机独立状态（保活开关 keep_alive、自动找到的安装路径）。"""
    apps = _load_shared_apps()
    if not apps:
        apps = [dict(a) for a in DEFAULT_APPS]
    _resolve_install_paths(apps)
    local = _load_local_state()
    for a in apps:
        st = local.get(a.get("key")) or {}
        a["keep_alive"] = bool(st.get("keep_alive", False))
        fp = st.get("found_path") or ""
        if fp and os.path.isfile(fp):
            ps = [p for p in (a.get("install_paths") or []) if p]
            if fp not in ps:
                a["install_paths"] = [fp] + ps
    return apps


def _find_app(apps, key=None, name=None):
    for a in apps:
        if key and a.get("key") == key:
            return a
        if name and a.get("name") == name:
            return a
    return None


def _exe_name(app):
    exe = (app.get("exe") or "").strip()
    return os.path.basename(exe).lower()


_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# v1.09：本模块每条指令都被主程序重新 exec 一次，模块级变量天然是"单指令生命周期"。
# 用它做一次全量进程快照供本轮所有应用复用：此前每个 cmdline 类应用都独立跑一次
# PowerShell（5 个脚本类应用 ≈ 10 次串行，实测 app_list 要 9~11 秒），改为一次快照。
_CMDLINE_SNAP = None        # [(pid, 命令行小写), ...]


def _cmdline_snapshot():
    """一次性取全部 python/pythonw 进程的 (PID, 命令行)，本轮模块实例内复用"""
    global _CMDLINE_SNAP
    if _CMDLINE_SNAP is not None:
        return _CMDLINE_SNAP
    _CMDLINE_SNAP = []
    try:
        # 命令行含中文（路径），PowerShell 输出编码与 Python 解码不一致会乱码，
        # 导致按命令行匹配全部失败（脚本类应用恒显示"未运行"）。故把命令行用
        # Base64(UTF-8) 传输：输出纯 ASCII，任何编码环境下都不会乱码。
        script = (
            "Get-CimInstance Win32_Process -Filter "
            "\"Name='pythonw.exe' or Name='python.exe'\" | "
            "ForEach-Object { \"$($_.ProcessId)||\" + "
            "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$_.CommandLine)) }"
        )
        enc = base64.b64encode(script.encode("utf-16-le")).decode()
        out = subprocess.run(["powershell", "-NoProfile", "-NonInteractive",
                              "-EncodedCommand", enc],
                             capture_output=True, text=True, timeout=20,
                             creationflags=_CREATE_NO_WINDOW, errors="ignore").stdout or ""
        for line in out.splitlines():
            pid, _, b64 = line.partition("||")
            pid = pid.strip()
            if not pid.isdigit():
                continue
            try:
                cmd = base64.b64decode(b64.strip()).decode("utf-8", "replace").lower()
            except Exception:
                cmd = ""
            _CMDLINE_SNAP.append((int(pid), cmd))
    except Exception:
        pass
    return _CMDLINE_SNAP


def _snapshot_reset():
    """清空本轮进程快照缓存，强制下次重新探测。
    操作（打开/重启/关闭）后状态必须重取——沿用操作前的旧快照会把刚启动的应用
    误报"未运行"、把刚关闭的误报"运行中"。"""
    global _CMDLINE_SNAP
    _CMDLINE_SNAP = None


def _cmdline_procs(mark):
    """返回命令行含 mark 的 python/pythonw 进程 PID 列表（脚本类应用检测用）"""
    m = (mark or "").lower()
    return [pid for pid, cmd in _cmdline_snapshot() if m in cmd] if m else []


def _app_running(app):
    """检测进程是否在运行：
    run_detect=cmdline → 按命令行匹配（脚本类）；否则按进程名（exes 多候选）"""
    if app.get("run_detect") == "cmdline":
        mark = app.get("cmdline_mark") or ""
        return bool(mark) and bool(_cmdline_procs(mark))
    try:
        names = [str(n).lower() for n in (app.get("exes") or []) if n]
        if not names:
            exe = _exe_name(app)
            if not exe:
                return False
            names = [exe]
        out = subprocess.run(["tasklist", "/NH"], capture_output=True, text=True,
                             timeout=10, creationflags=_CREATE_NO_WINDOW,
                             errors="ignore").stdout or ""
        return any(n in out.lower() for n in names)
    except Exception:
        return False


def _target_pids(app):
    """该应用对应的全部进程 PID（cmdline 类按命令行；其余按进程名）
    用于判定"要操作的目标是不是 FYH 本进程" """
    if app.get("run_detect") == "cmdline":
        return _cmdline_procs(app.get("cmdline_mark") or "")
    names = [str(n).lower() for n in (app.get("exes") or []) if n]
    if not names:
        exe = _exe_name(app)
        names = [exe] if exe else []
    names = [n for n in names if n]
    if not names:
        return []
    pids = []
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=10,
                             creationflags=_CREATE_NO_WINDOW, errors="ignore").stdout or ""
        for line in out.splitlines():
            cols = [c.strip().strip('"') for c in line.split(",")]
            if len(cols) >= 2 and cols[0].lower() in names:
                try:
                    pids.append(int(cols[1]))
                except ValueError:
                    pass
    except Exception:
        pass
    return pids


def _installed_paths(app):
    """应用安装路径候选：清单里配置的 + 默认清单同 key 的（去重）"""
    ps = [p for p in (app.get("install_paths") or []) if p]
    for d in DEFAULT_APPS:
        if d.get("key") == app.get("key"):
            for p in d.get("install_paths") or []:
                if p not in ps:
                    ps.append(p)
    return ps


def _installed_check(app):
    """安装检测：内置应用恒真；否则 进程/候选路径/注册表卸载项 三查"""
    if app.get("builtin"):
        return True
    if _app_running(app):
        return True
    for p in _installed_paths(app):
        if p and os.path.isfile(p):
            return True
    kws = [str(k).lower() for k in (app.get("install_keywords") or []) if k]
    if not kws:
        return False
    try:
        import winreg
    except Exception:
        return False
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for sub in (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"):
            try:
                with winreg.OpenKey(hive, sub) as k:
                    for i in range(winreg.QueryInfoKey(k)[0]):
                        try:
                            with winreg.OpenKey(k, winreg.EnumKey(k, i)) as sk:
                                try:
                                    dn = winreg.QueryValueEx(sk, "DisplayName")[0] or ""
                                except Exception:
                                    dn = ""
                                if any(w in str(dn).lower() for w in kws):
                                    return True
                        except Exception:
                            pass
            except Exception:
                pass
    return False


def _walk_limited(root, maxdepth=3):
    """限制深度的 os.walk（防止全盘深扫）"""
    root = root.rstrip("\\") + "\\"
    for dirpath, dirnames, filenames in os.walk(root):
        depth = dirpath[len(root):].count(os.sep)
        if depth >= maxdepth:
            dirnames[:] = []
        yield dirpath, filenames


def _ask_manual_path(name):
    """人工指定弹窗（自动寻址全部失败后调用）：
    返回用户填的已存在路径，取消/失败返回 None。同时只允许一个弹窗。"""
    global _manual_dialog_open
    if _manual_dialog_open:
        return None
    _manual_dialog_open = True
    try:
        import tkinter as tk
        from tkinter import simpledialog
        root = tk.Tk()
        root.withdraw()
        got = simpledialog.askstring(
            "手动指定安装路径",
            "%s 自动寻找失败，请手动指定其完整路径（留空=取消）：" % name,
            parent=root)
        root.destroy()
        if got:
            got = got.strip().strip('"').rstrip("\\")
            if got and os.path.isfile(got):
                return got
        return None
    except Exception:
        return None
    finally:
        _manual_dialog_open = False


def _deep_find_drives(target_lower, maxdepth=6):
    """全盘兜底：在所有存在盘上按文件名【完全命中】深搜（限定深度防卡死），
    命中多个时取【修改日期最新】的一个，返回完整路径，否则 None。"""
    best, best_m = None, -1
    for drive in _detect_drives():
        try:
            for dirpath, filenames in _walk_limited(drive + "\\", maxdepth):
                for fn in filenames:
                    if fn.lower() == target_lower:
                        p = os.path.join(dirpath, fn)
                        try:
                            m = os.path.getmtime(p)
                        except Exception:
                            m = 0
                        if m > best_m:
                            best, best_m = p, m
        except Exception:
            continue
    return best


def _save_apps(apps):
    """v1.10：清单本身来自共享 py 只读；这里只把"保活开关"持久化到本机独立文件。
    （保活是每台电脑各自的使用痕迹，不进共享清单）"""
    for a in apps:
        if a.get("key"):
            _set_local(a["key"], keep_alive=bool(a.get("keep_alive")))
    return True


def _save_apps_path(key, found):
    """v1.10：把自动找到的路径记到本机独立文件（各机路径不同，不写进共享清单）"""
    return _set_local(key, found_path=found)


def _auto_find_path(app):
    """地址丢失时自动寻找：在常见安装目录按文件名搜索匹配的可执行文件/脚本"""
    if app.get("run_detect") == "cmdline":
        paths = app.get("install_paths") or []
        target = os.path.basename(paths[0]) if paths else ""
    else:
        exes = app.get("exes") or []
        target = exes[0] if exes else (app.get("exe") or "")
    if not target:
        return False
    tlow = target.lower()
    for root in _SEARCH_ROOTS:
        if not os.path.isdir(root):
            continue
        try:
            for dirpath, filenames in _walk_limited(root):
                for fn in filenames:
                    if fn.lower() == tlow:
                        found = os.path.join(dirpath, fn)
                        ps = [p for p in (app.get("install_paths") or []) if p]
                        if found not in ps:
                            app["install_paths"] = [found] + ps
                            _save_apps_path(app.get("key"), found)
                        return True
        except Exception:
            continue
    # 关键文件夹寻址失败 → 全盘深搜兜底（限定深度，命中即用并持久化）
    found = _deep_find_drives(tlow, maxdepth=6)
    if found:
        ps = [p for p in (app.get("install_paths") or []) if p]
        if found not in ps:
            app["install_paths"] = [found] + ps
            _save_apps_path(app.get("key"), found)
        return True
    # 以上全部失败 → 弹窗人工指定路径（填了就保存，下次直接用）
    got = _ask_manual_path(app.get("name") or target)
    if got:
        ps = [p for p in (app.get("install_paths") or []) if p]
        if got not in ps:
            app["install_paths"] = [got] + ps
            _save_apps_path(app.get("key"), got)
        return True
    return False


def _app_installed(app):
    """安装检测：即时三查（进程/路径/注册表）→ 未命中则自动寻找（5 分钟缓存）"""
    key = app.get("key", "")
    if _installed_check(app):
        _SEARCH_CACHE.pop(key, None)
        return True
    now = time.time()
    c = _SEARCH_CACHE.get(key)
    if c and now - c[1] < _SEARCH_CACHE_TTL:
        return c[0]
    found = _auto_find_path(app)
    _SEARCH_CACHE[key] = (found, now)
    return found


def _app_open(app, ws):
    # 脚本类应用：用 pythonw 运行 .pyw（无控制台窗口）
    if app.get("run_detect") == "cmdline":
        # v1.13：清掉本命令早期的进程快照缓存。重启 = 先关后开，关掉后若不重取，
        # 打开时会拿旧快照误判"仍在运行"而跳过拉起 → 表面回"操作成功"其实没启动。
        _snapshot_reset()
        if _app_running(app):       # v1.08：已在运行就不重复拉起（防止 FYH 等多开产生幽灵设备）
            ws.log_msg(f"远程控制: {app.get('name') or '?'} 已在运行，跳过重复打开")
            return True
        try:
            script = app.get("install_paths") or []
            script = script[0] if script else ""
            if not script or not os.path.isfile(script):
                ws.log_msg(f"远程控制: 打开 {app.get('name') or '?'} 失败: 脚本不存在")
                return False
            try:                        # 冻结适配：取真 python 跑 .pyw（sys.executable 冻结时是 EXE 本身）
                from 冻结环境 import 取解释器 as _取解释器
                pythonw = _取解释器()
            except ImportError:
                pydir = os.path.dirname(sys.executable)
                pythonw = os.path.join(pydir, "pythonw.exe")
                if not os.path.isfile(pythonw):
                    pythonw = sys.executable
            subprocess.Popen([pythonw, script],
                             cwd=os.path.dirname(script),
                             creationflags=_CREATE_NO_WINDOW)
            ws.log_msg(f"远程控制: 打开 {app.get('name') or script}")
            return True
        except Exception as e:
            ws.log_msg(f"远程控制: 打开 {app.get('name') or '?'} 失败: {e}")
            return False
    # 普通应用：优先用实际存在的安装路径启动；否则退回 exe 名（依赖 PATH）
    exe = ""
    for p in _installed_paths(app):
        if p and os.path.isfile(p):
            exe = p
            break
    if not exe:
        exe = (app.get("exe") or "").strip()
    args = (app.get("args") or "").strip()
    path = (app.get("path") or "").strip()
    try:
        if os.path.isfile(exe):
            cmd = f'"{exe}"' + (f" {args}" if args else "")
        else:
            cmd = exe + (f" {args}" if args else "")
        subprocess.Popen(cmd, cwd=path or None, shell=True,
                         creationflags=0x08000000)  # CREATE_NO_WINDOW
        ws.log_msg(f"远程控制: 打开 {app.get('name') or exe}")
        return True
    except Exception as e:
        ws.log_msg(f"远程控制: 打开 {app.get('name') or exe} 失败: {e}")
        return False


def _self_target(app):
    """待操作的目标是否就是 FYH 本进程（识别"控制 FYH 自身"这种自杀式操作）"""
    try:
        return os.getpid() in _target_pids(app)
    except Exception:
        return False


def _detach_self_ctl(app, 拉起):
    """分离式自控：延时 → 杀 FYH 本进程 → (可选)重新拉起。
    用 cmd 的 ping 做延时、start 拉起，完全脱离本进程，避免"自杀后就没人拉起来"。
    拉起时优先照"自己当前怎么跑的"还原（EXE→EXE；脚本→pythonw+本脚本），
    保证重启后还是原来那套运行方式。"""
    start_cmd = ""
    if 拉起:
        if getattr(sys, "frozen", False):                       # 打包 EXE：拉起自己
            exe = sys.executable
            start_cmd = f'start "FYH" /D "{os.path.dirname(exe)}" "{exe}"'
        else:                                                    # 脚本运行：pythonw + 本脚本
            script = os.path.abspath(sys.argv[0]) if (sys.argv and sys.argv[0]) else ""
            if script and os.path.isfile(script):
                start_cmd = f'start "FYH" /D "{os.path.dirname(script)}" "{sys.executable}" "{script}"'
        if not start_cmd:                                        # 兜底：清单里的安装路径
            paths = [p for p in _installed_paths(app) if p and os.path.isfile(p)]
            if paths:
                tgt = paths[0]
                if tgt.lower().endswith((".py", ".pyw")):
                    try:
                        from 冻结环境 import 取解释器 as _取解释器
                        pythonw = _取解释器()
                    except ImportError:
                        pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
                    start_cmd = f'start "FYH" /D "{os.path.dirname(tgt)}" "{pythonw}" "{tgt}"'
                else:
                    start_cmd = f'start "FYH" /D "{os.path.dirname(tgt)}" "{tgt}"'
    parts = ["ping -n 3 127.0.0.1 >nul", f"taskkill /PID {os.getpid()} /F"]
    if start_cmd:
        parts.append("ping -n 2 127.0.0.1 >nul")
        parts.append(start_cmd)
    try:
        subprocess.Popen(" & ".join(parts), shell=True, creationflags=0x08000000)
        return True
    except Exception:
        return False


def _app_close(app, ws):
    # v1.08：要关的就是 FYH 自己 → 先回包（调用方随后发 app_result），再用分离助手延时自杀，
    #        否则本进程一死，回包与后续动作都发不出去
    if _self_target(app):
        ok = _detach_self_ctl(app, 拉起=False)
        ws.log_msg("远程控制: 关闭 FYH 自身（分离助手延时执行）")
        return ok
    # 脚本类应用：按命令行匹配到的 PID 精确关闭（避免误杀其他 pythonw）
    if app.get("run_detect") == "cmdline":
        mark = app.get("cmdline_mark") or ""
        pids = _cmdline_procs(mark) if mark else []
        try:
            for pid in pids:
                subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                               capture_output=True, timeout=10,
                               creationflags=_CREATE_NO_WINDOW, errors="ignore")
            ws.log_msg(f"远程控制: 关闭 {app.get('name') or mark} (PID {pids})")
            return True
        except Exception as e:
            ws.log_msg(f"远程控制: 关闭 {app.get('name') or mark} 失败: {e}")
            return False
    # 普通应用：按进程名关闭
    names = [str(n).lower() for n in (app.get("exes") or []) if n]
    if not names:
        exe = _exe_name(app)
        if exe:
            names = [exe]
    try:
        for n in names:
            subprocess.run(["taskkill", "/IM", n, "/F"],
                           capture_output=True, timeout=10,
                           creationflags=_CREATE_NO_WINDOW, errors="ignore")
        ws.log_msg(f"远程控制: 关闭 {app.get('name') or exe}")
        return True
    except Exception as e:
        ws.log_msg(f"远程控制: 关闭 {app.get('name') or exe} 失败: {e}")
        return False


def _app_restart(app, ws):
    if _self_target(app):
        ok = _detach_self_ctl(app, 拉起=True)
        ws.log_msg("远程控制: 重启 FYH 自身（分离助手延时杀+拉起）")
        return ok
    _app_close(app, ws)
    time.sleep(0.5)
    return _app_open(app, ws)


def _app_info(app, ws):
    inst = _app_installed(app)
    info = {"key": app.get("key", ""),
            "name": app.get("name", ""),
            "installed": inst,
            "keep_alive": bool(app.get("keep_alive")),
            "running": _app_running(app) if inst else False}
    if not inst:
        # 自动寻找过仍找不到 → 标记，面板提示人工指定
        info["missing"] = True
        ws.log_msg(f"远程控制: {app.get('name')} 自动寻找安装位置失败，需人工在共享清单 应用清单.py 指定路径")
    return info


def _get_refresh_sec(ws_app):
    """读取面板自动刷新间隔（秒），取不到则默认 60"""
    try:
        return int(ws_app.get_rc_refresh_sec())
    except Exception:
        return 60


def _dev_id(ws_app):
    """取本机设备标识（v1.11）。
    优先用 WS 模块的持久 device_id；旧版 WS 模块没实现 get_device_id 时，
    退化为设备昵称——旧端仍能被面板按名识别，绝不会 AttributeError 崩掉。"""
    try:
        getter = getattr(ws_app, "get_device_id", None)
        if callable(getter):
            v = (getter() or "").strip()
            if v:
                return v
    except Exception:
        pass
    try:
        return (ws_app.get_device_name() or "").strip()
    except Exception:
        return ""


def handle_remote_cmd(body, sender, ws_app):
    """统一WS收到【FYHRC】消息 → 解析执行，回状态（由 FYH 主程序调用）
    v1.04 铁律：只有网页面板才是客户端，设备（S/H）都不能发出请求——
      a) 仅执行带 "src":"web" 的请求（网页面板 v1.03+ 专属标记）；
      b) 对端发来的响应（app_list 带 apps 字段、cmd=app_result）一律忽略，
         杜绝"把响应当请求再回"的自激死循环（jtb 频道疯发根因）。"""
    if ws_app is None:
        return
    try:
        data = json.loads(body)
    except Exception:
        ws_app.log_msg(f"远程控制: 指令解析失败: {body[:50]}")
        return
    cmd = data.get("cmd")
    # ---- 防环闸门 b：响应类消息直接忽略，绝不回应 ----
    if cmd == "app_result" or (cmd == "app_list" and "apps" in data):
        return  # 这是别的端发来的"响应"，不是请求
    # ---- 客户端闸门 a：只认网页面板（src:"web"），设备互发的请求一律不执行 ----
    if data.get("src") != "web":
        ws_app.log_msg(f"远程控制: 忽略非网页客户端请求 (cmd={cmd}, src={data.get('src') or '无'})")
        return
    # 目标设备过滤（v1.06）：优先按设备ID（主键）；旧面板只带 target 时兼容按昵称
    target_id = data.get("target_id")
    if target_id:
        if target_id != _dev_id(ws_app):
            return
    else:
        target = data.get("target")
        if target and target != ws_app.get_device_name():
            return
    apps = _load_apps()
    if cmd == "app_list":
        ws_app.send_remote_msg({"cmd": "app_list",
                                "refresh_sec": _get_refresh_sec(ws_app),
                                "req_id": data.get("req_id"),      # v1.08：回带请求号，面板据此只认本轮回应
                                "device_id": _dev_id(ws_app),
                                "apps": [_app_info(a, ws_app) for a in apps]})
        ws_app.log_msg(f"远程控制: {sender} 请求应用清单")
    elif cmd in ("app_open", "app_close", "app_restart"):
        app = _find_app(apps, key=data.get("key"), name=data.get("name"))
        if not app:
            ws_app.send_remote_msg({"cmd": "app_result", "ok": False, "msg": "应用不存在",
                                    "key": data.get("key") or data.get("name") or ""})
            return
        if not _app_installed(app):
            ws_app.send_remote_msg({"cmd": "app_result", "ok": False, "msg": "未安装",
                                    "key": app.get("key"), "name": app.get("name"),
                                    "running": False})
            ws_app.log_msg(f"远程控制: {app.get('name')} 未安装，无法{cmd}")
            return
        ok = {"app_open": lambda: _app_open(app, ws_app),
              "app_close": lambda: _app_close(app, ws_app),
              "app_restart": lambda: _app_restart(app, ws_app)}[cmd]()
        time.sleep(0.8)  # 等进程起来再查状态
        _snapshot_reset()  # v1.14：重取进程快照。否则沿用操作前的旧快照，会把刚启动的
                           # 应用误报"未运行"、把刚关闭的误报"运行中"，回执状态与真值反了。
        ws_app.send_remote_msg({"cmd": "app_result", "ok": ok,
                                "key": app.get("key"), "name": app.get("name"),
                                "running": _app_running(app)})
    elif cmd == "keep_alive_set":
        app = _find_app(apps, key=data.get("key"), name=data.get("name"))
        if not app:
            ws_app.send_remote_msg({"cmd": "app_result", "ok": False, "msg": "应用不存在",
                                    "key": data.get("key") or data.get("name") or ""})
            return
        on = bool(data.get("on"))
        app["keep_alive"] = on
        _save_apps(apps)
        ws_app.send_remote_msg({"cmd": "app_result", "ok": True,
                                "key": app.get("key"), "name": app.get("name"),
                                "keep_alive": on, "running": _app_running(app)})
        ws_app.log_msg(f"远程控制: {'开启' if on else '关闭'}自动保活 -> {app.get('name')}")
    elif cmd == "app_status":
        app = _find_app(apps, key=data.get("key"), name=data.get("name"))
        if app:
            ws_app.send_remote_msg({"cmd": "app_result", "ok": True,
                                    "key": app.get("key"), "name": app.get("name"),
                                    "running": _app_running(app)})
    else:
        ws_app.log_msg(f"远程控制: 未知指令 {cmd}")
