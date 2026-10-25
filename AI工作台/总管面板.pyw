# -*- coding: utf-8 -*-
"""
总管面板 · Py 壳（Tk 界面 + 本机网页服务）
------------------------------------------------------------
用法：
  总管面板.pyw                     开 Tk 界面，同时起网页服务
  总管面板.pyw --headless          只跑采集 + 网页（无界面）
  总管面板.pyw --no-web            只跑 Tk（断网也能用）
  总管面板.pyw --自测              跑自检并打印 RESULT
  总管面板.pyw --bind 0.0.0.0 --令牌 <32位串>    对外监听（必须带令牌，否则拒绝启动）

规矩：本文件只做"壳"——所有功能都走 核心.执行()，这里不许写业务逻辑。
"""
import json
import os
import queue
import re
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import 公共  # noqa: E402
import 采集器  # noqa: E402
import 核心  # noqa: E402
import 任务卡库  # noqa: E402
import 原话解析  # noqa: E402
import 任务执行器  # noqa: E402
import 公网桥  # noqa: E402


# ================================================================ 界面注册表
# Tk 壳显式声明"我接了哪些命令"—— 系统.对齐自检 直接扫这张清单，不许别处再写一份。
界面注册表 = [
    "trae.状态",
    "trae.重采集",
    "员工.列表",
    "员工.催办",
    "任务.列表",
    "任务.建卡",
    "任务.改状态",
    "任务.换负责人",
    "任务.加备注",
    "任务.归档",
    "原话.列表",
    "原话.备注",
    "原话.关联卡",
    "原话.建卡",
    "原话.统计",
    "系统.版本",
    "系统.自检",
    "系统.对齐自检",
    "系统.日志",
    "手册.目录",
    "手册.读",
    "手册.搜",
    "手册.追加",
    "手册.新建",
]

灯色 = {"绿": "#1f9d55", "黄": "#c9a227", "红": "#c53030", "灰": "#8a8f98"}


# ================================================================ 网页服务

def _网卡端口可用(端口):
    s = socket.socket()
    s.settimeout(0.2)
    try:
        return s.connect_ex(("127.0.0.1", int(端口))) != 0
    finally:
        s.close()


def 选端口(首选=19900, 上限=19909):
    for 端口 in range(首选, 上限 + 1):
        if _网卡端口可用(端口):
            return 端口
    return 0


class 网页服务(object):
    def __init__(self, 界面对象=None, 绑定="127.0.0.1", 令牌=""):
        self.界面 = 界面对象
        self.绑定 = 绑定
        self.令牌 = 令牌
        self.端口 = 0
        self.服务 = None
        self._线程 = None
        self.拒绝日志 = os.path.join(公共.日志目录, "拒绝.log")
        self.需要令牌 = bool(令牌)

    # ---- 内部
    def _命令列表(self):
        """网页端声明支持的命令——唯一源是 HTML 里那份 const 命令列表。"""
        路径 = os.path.join(公共.网页源目录, "总管面板.html")
        try:
            with open(路径, "r", encoding="utf-8", errors="replace") as f:
                文本 = f.read()
            位置 = 文本.find("const 命令列表")
            起 = 文本.find("[", 位置)
            止 = 文本.find("]", 起)
            return re.findall(r'"([^"]+)"', 文本[起:止])
        except Exception:
            return []

    def _记拒绝(self, 客户端, 命令, 原因):
        段 = (客户端 or "0.0.0.0").split(".")
        掩 = ".".join(段[:2]) + ".x.x"
        行 = "[%s] 拒绝 ip=%s 命令=%s 原因=%s" % (公共.现在全(), 掩, 命令 or "-", 原因)
        try:
            with open(self.拒绝日志, "a", encoding="utf-8", newline="\n") as f:
                f.write(行 + "\n")
        except Exception:
            pass
        公共.日志(行, "警告")

    def _令牌对(self, 头, 报文):
        值 = ""
        if 头:
            头 = 头.strip()
            if 头.lower().startswith("bearer "):
                值 = 头[7:].strip()
            elif 头:
                值 = 头
        if not 值 and isinstance(报文, dict):
            值 = str(报文.get("令牌") or "")
        return bool(self.令牌) and 值 == self.令牌

    # ---- 起停
    def 启动(self):
        self.端口 = 选端口(int(公共.读配置().get("网页端口") or 19900))
        if not self.端口:
            公共.日志("19900~19909 全被占用，网页服务未启动", "错误")
            return 0
        服务 = self

        class 处理器(BaseHTTPRequestHandler):
            server_version = "ZongGuanPanel/0.3"

            def log_message(self, fmt, *args):  # 静音，别刷屏
                pass

            def _回(self, 码, 体=b"", 类型="application/json; charset=utf-8", 头=None):
                self.send_response(码)
                self.send_header("Content-Type", 类型)
                self.send_header("Content-Length", str(len(体)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                for 键, 值 in (头 or {}).items():
                    self.send_header(键, 值)
                self.end_headers()
                try:
                    self.wfile.write(体)
                except Exception:
                    pass

            def _回json(self, 码, 数据):
                self._回(码, json.dumps(数据, ensure_ascii=False).encode("utf-8"))

            def do_OPTIONS(self):
                self._回(204, b"", 头={"Access-Control-Allow-Headers": "Authorization,Content-Type",
                                     "Access-Control-Allow-Methods": "GET,POST,OPTIONS"})

            def do_GET(self):
                路径 = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
                if 路径 in ("/", "/index.html"):
                    try:
                        with open(os.path.join(公共.网页源目录, "总管面板.html"), "rb") as f:
                            体 = f.read()
                        self._回(200, 体, "text/html; charset=utf-8")
                    except Exception as 错:
                        self._回(500, ("网页源缺失: %s" % 错).encode("utf-8"),
                                "text/plain; charset=utf-8")
                    return
                if 路径 == "/api/state":
                    if 服务.需要令牌 and not 服务._令牌对(self.headers.get("Authorization"), None):
                        服务._记拒绝(self.client_address[0], "GET /api/state", "无令牌/令牌错")
                        self._回json(401, {"ok": False, "说明": "401 需要令牌"})
                        return
                    try:
                        with open(公共.状态文件, "rb") as f:
                            体 = f.read()
                        self._回(200, 体)
                    except Exception:
                        self._回json(200, {"ts": "", "ts_ms": 0, "说明": "状态文件还没生成"})
                    return
                if 路径 == "/api/cmd列表":
                    self._回json(200, {"命令": 服务._命令列表(), "命令表": 核心.命令清单(),
                                     "版本": 核心.版本})
                    return
                self._回(404, b'{"ok":false,"\\u8bf4\\u660e":"404"}')

            def do_POST(self):
                路径 = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
                if 路径 != "/api/cmd":
                    self._回(404, b'{"ok":false}')
                    return
                try:
                    长度 = int(self.headers.get("Content-Length") or 0)
                    原文 = self.rfile.read(长度).decode("utf-8", "replace") if 长度 else "{}"
                    报文 = json.loads(原文 or "{}")
                except Exception as 错:
                    self._回json(400, {"ok": False, "说明": "报文不是 JSON: %s" % 错})
                    return
                命令 = str(报文.get("命令") or "")
                if 服务.需要令牌 and not 服务._令牌对(self.headers.get("Authorization"), 报文):
                    服务._记拒绝(self.client_address[0], 命令, "无令牌/令牌错")
                    self._回json(401, {"ok": False, "说明": "401 需要令牌 Authorization: Bearer <串>"})
                    return
                if not 核心.有命令(命令):
                    服务._记拒绝(self.client_address[0], 命令, "未知命令")
                    self._回json(400, {"ok": False, "说明": "未知命令：%s" % 命令})
                    return
                来源 = "网页·远程" if 服务.需要令牌 else "网页"
                结果 = 核心.执行(命令, 报文.get("参数") or {}, 来源=来源)
                self._回json(200, 结果)

        try:
            self.服务 = ThreadingHTTPServer((self.绑定, self.端口), 处理器)
        except Exception as 错:
            公共.日志("网页服务起不来: %s" % 错, "错误")
            self.端口 = 0
            return 0
        self._线程 = threading.Thread(target=self.服务.serve_forever, kwargs={"poll_interval": 0.3},
                                     daemon=True, name="网页服务")
        self._线程.start()
        公共.日志("网页服务已起：http://%s:%d/（令牌%s）"
                 % (self.绑定, self.端口, "已启用" if self.需要令牌 else "未启用"))
        return self.端口

    def 停止(self):
        if self.服务 is not None:
            try:
                self.服务.shutdown()
                self.服务.server_close()
            except Exception:
                pass
            self.服务 = None


# ================================================================ Tk 界面

def _灰字(父, 命令名):
    """每个按钮下面那行 8px 灰字——老板要能"看见"三端是同一套命令。"""
    import tkinter as tk
    return tk.Label(父, text=命令名, font=("Consolas", 8), fg="#9aa0a6")


class 主界面(object):
    def __init__(self, 配置, 网页端口, 桥):
        import tkinter as tk
        from tkinter import ttk
        self.tk = tk
        self.ttk = ttk
        self.配置 = 配置
        self.网页端口 = 网页端口
        self.桥 = 桥
        self.队列 = []
        self.状态 = 采集器.读状态()
        self.原话数据 = {}
        self.选中卡 = ""
        self.筛选 = "全部"
        self.搜索词 = ""
        self._上次ts = 0
        self._上次任务签名 = None
        self._上次员工签名 = None
        self._上次原话签名 = None

        self.根 = tk.Tk()
        self.根.title("总管面板 v%s" % 核心.版本)
        self.根.geometry("1280x820")
        self.根.minsize(960, 640)
        self.根.configure(bg="#eef1f5")

        self._建顶栏()
        self._建分页()
        self._建底栏()

    # ------------------------------------------------------------ 顶栏
    def _建顶栏(self):
        tk, ttk = self.tk, self.ttk
        self.顶栏 = tk.Frame(self.根, bg="#1f2937", height=52)
        self.顶栏.pack(fill="x", side="top")
        self.顶栏.pack_propagate(False)

        self.总灯 = tk.Label(self.顶栏, text="●", font=("Segoe UI", 18), fg="#8a8f98", bg="#1f2937")
        self.总灯.pack(side="left", padx=(14, 6))

        self.标题 = tk.Label(self.顶栏, text="总管面板", font=("Microsoft YaHei", 13, "bold"),
                            fg="white", bg="#1f2937")
        self.标题.pack(side="left")

        self.横幅 = tk.Label(self.顶栏, text="等待采集…", font=("Microsoft YaHei", 10),
                            fg="#fde68a", bg="#1f2937", anchor="w")
        self.横幅.pack(side="left", padx=16, fill="x", expand=True)

        self.小结 = tk.Label(self.顶栏, text="", font=("Microsoft YaHei", 10), fg="white",
                            bg="#374151", padx=10, pady=4)
        self.小结.pack(side="right", padx=(6, 14))

    # ------------------------------------------------------------ 分页
    def _建分页(self):
        tk, ttk = self.tk, self.ttk
        self.分页 = ttk.Notebook(self.根)
        self.分页.pack(fill="both", expand=True, padx=8, pady=(8, 4))

        self.页1 = tk.Frame(self.分页, bg="#f7f8fa")
        self.页2 = tk.Frame(self.分页, bg="#f7f8fa")
        self.页3 = tk.Frame(self.分页, bg="#f7f8fa")
        self.页4 = tk.Frame(self.分页, bg="#f7f8fa")
        self.页5 = tk.Frame(self.分页, bg="#f7f8fa")
        for 页, 名 in ((self.页1, "P1 TRAE 面板"), (self.页2, "P2 员工总览"),
                      (self.页3, "P3 任务面板"), (self.页4, "P4 人类原话"),
                      (self.页5, "P5 总管手册")):
            self.分页.add(页, text=名)
        for 名 in ("P6 服务健康", "P7 频道与用量", "P8 设置与审计"):
            占位 = tk.Frame(self.分页, bg="#f7f8fa")
            tk.Label(占位, text="%s —— 未实现" % 名,
                     font=("Microsoft YaHei", 14), fg="#9aa0a6", bg="#f7f8fa").pack(pady=80)
            self.分页.add(占位, text=名)

        self._建页1()
        self._建页2()
        self._建页3()
        self._建页4()
        self._建页5()

    def _按钮(self, 父, 文字, 命令名, 动作, 色="#2563eb"):
        tk = self.tk
        框 = tk.Frame(父, bg=父["bg"])
        框.pack(side="left", padx=6)
        钮 = tk.Button(框, text=文字, command=动作, bg=色, fg="white",
                      font=("Microsoft YaHei", 9), relief="flat", padx=10, pady=3,
                      activebackground="#1d4ed8", cursor="hand2")
        钮.pack()
        _灰字(框, 命令名).pack()
        return 钮

    # ---- P1
    def _建页1(self):
        tk = self.tk
        包裹 = tk.Frame(self.页1, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=14, pady=12)

        操作 = tk.Frame(包裹, bg="#f7f8fa")
        操作.pack(fill="x")
        tk.Label(操作, text="TRAE 健康（只观测，绝不杀/不重启）",
                 font=("Microsoft YaHei", 11, "bold"), bg="#f7f8fa").pack(side="left", padx=(0, 12))
        self._按钮(操作, "立即重采", "trae.重采集", self.做_重采集)
        self._按钮(操作, "自检", "系统.自检", self.做_自检, "#0f766e")
        self._按钮(操作, "对齐自检", "系统.对齐自检", self.做_对齐自检, "#7c3aed")

        网格 = tk.Frame(包裹, bg="white", highlightbackground="#e3e6ea", highlightthickness=1)
        网格.pack(fill="x", pady=(12, 8))
        self.卡1 = {}
        项们 = [("进程数", "进程数"), ("进程名", "进程名"), ("端口 9599", "端口9599"),
               ("端口 19876", "端口19876"), ("服务端 pid", "服务端pid"),
               ("服务端启动", "服务端启动时刻"), ("服务端版本", "服务端版本"),
               ("10 分钟重启", "服务端重启次数_10分钟"), ("界面模式", "界面模式"),
               ("模式读取", "模式读取方式"), ("判定", "判定"), ("判定原因", "判定原因")]
        for i, (标, 键) in enumerate(项们):
            行, 列 = divmod(i, 4)
            tk.Label(网格, text=标, font=("Microsoft YaHei", 9), fg="#6b7280", bg="white",
                     anchor="w").grid(row=行 * 2, column=列, sticky="w", padx=12, pady=(8, 0))
            值 = tk.Label(网格, text="—", font=("Microsoft YaHei", 12, "bold"), fg="#111827",
                         bg="white", anchor="w")
            值.grid(row=行 * 2 + 1, column=列, sticky="w", padx=12, pady=(0, 8))
            self.卡1[键] = 值
        for 列 in range(4):
            网格.grid_columnconfigure(列, weight=1)

        tk.Label(包裹, text="进程明细（pid / 启动时刻）", font=("Microsoft YaHei", 9),
                 fg="#6b7280", bg="#f7f8fa", anchor="w").pack(fill="x")
        self.进程框 = tk.Text(包裹, height=8, font=("Consolas", 9), bg="#0b1220", fg="#a7f3d0",
                            relief="flat", padx=10, pady=8)
        self.进程框.pack(fill="both", expand=True, pady=(4, 0))

    # ---- P2
    def _建页2(self):
        tk, ttk = self.tk, self.ttk
        包裹 = tk.Frame(self.页2, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=14, pady=12)

        操作 = tk.Frame(包裹, bg="#f7f8fa")
        操作.pack(fill="x")
        tk.Label(操作, text="员工总览（数据源：聊天账本 msgs 按 title 取 max(tm)）",
                 font=("Microsoft YaHei", 11, "bold"), bg="#f7f8fa").pack(side="left", padx=(0, 12))
        self._按钮(操作, "刷新", "员工.列表", self.做_刷新员工, "#2563eb")
        self._按钮(操作, "催办", "员工.催办", self.做_催办, "#c2410c")

        列 = ("终身号", "会话名", "灯", "最后活动", "距今秒", "今日消息数", "手上任务")
        self.员工表 = ttk.Treeview(包裹, columns=列, show="headings", height=22)
        for 名 in 列:
            self.员工表.heading(名, text=名)
            self.员工表.column(名, width=110 if 名 in ("会话名", "手上任务") else 80, anchor="w")
        self.员工表.pack(fill="both", expand=True, pady=(10, 0))
        for 灯, 色 in 灯色.items():
            self.员工表.tag_configure(灯, foreground=色)

    # ---- P3
    def _建页3(self):
        tk = self.tk
        包裹 = tk.Frame(self.页3, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=10, pady=8)

        顶 = tk.Frame(包裹, bg="#f7f8fa")
        顶.pack(fill="x")
        tk.Label(顶, text="任务面板（小卡片四泳道）", font=("Microsoft YaHei", 11, "bold"),
                 bg="#f7f8fa").pack(side="left")
        self._按钮(顶, "＋ 新任务", "任务.建卡", self.做_新任务)
        self.汇总 = tk.Label(顶, text="未完成 0 / 已完成 0", font=("Microsoft YaHei", 10, "bold"),
                            fg="#111827", bg="#f7f8fa")
        self.汇总.pack(side="right", padx=10)

        体 = tk.Frame(包裹, bg="#f7f8fa")
        体.pack(fill="both", expand=True, pady=(8, 0))

        self.泳道画布 = tk.Canvas(体, bg="#eef1f5", highlightthickness=0)
        竖 = tk.Scrollbar(体, orient="vertical", command=self.泳道画布.yview)
        横 = tk.Scrollbar(包裹, orient="horizontal", command=self.泳道画布.xview)
        self.泳道画布.configure(yscrollcommand=竖.set, xscrollcommand=横.set)
        self.泳道内框 = tk.Frame(self.泳道画布, bg="#eef1f5")
        self.泳道画布.create_window((0, 0), window=self.泳道内框, anchor="nw")
        self.泳道内框.bind("<Configure>",
                          lambda e: self.泳道画布.configure(scrollregion=self.泳道画布.bbox("all")))
        self.泳道画布.pack(side="left", fill="both", expand=True)
        竖.pack(side="right", fill="y")
        横.pack(fill="x")

        self.详情框 = tk.Frame(包裹, bg="white", width=340,
                              highlightbackground="#e3e6ea", highlightthickness=1)
        self.详情框.pack(side="right", fill="y", padx=(8, 0))
        self.详情框.pack_propagate(False)
        self._画详情(None)

    # ---- P4
    def _建页4(self):
        tk, ttk = self.tk, self.ttk
        包裹 = tk.Frame(self.页4, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=12, pady=10)

        self.原话横幅 = tk.Label(包裹, text="载入中…", font=("Microsoft YaHei", 11, "bold"),
                                fg="white", bg="#1f9d55", anchor="w", padx=12, pady=8)
        self.原话横幅.pack(fill="x")

        操作 = tk.Frame(包裹, bg="#f7f8fa")
        操作.pack(fill="x", pady=8)
        tk.Label(操作, text="筛选：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left")
        self.筛选值 = tk.StringVar(value="全部")
        for 名 in ("全部", "只看未派", "只看未落实", "只看已验收"):
            tk.Radiobutton(操作, text=名, value=名, variable=self.筛选值,
                           command=self._改筛选, bg="#f7f8fa",
                           font=("Microsoft YaHei", 9)).pack(side="left")
        self.搜索框 = tk.Entry(操作, width=22, font=("Microsoft YaHei", 9))
        self.搜索框.pack(side="left", padx=(12, 4))
        self.搜索框.bind("<Return>", lambda e: self._改筛选())
        tk.Label(操作, text="搜原话（回车）", font=("Microsoft YaHei", 8), fg="#9aa0a6",
                 bg="#f7f8fa").pack(side="left")

        self._按钮(操作, "补备注", "原话.备注", self.做_原话备注, "#0f766e")
        self._按钮(操作, "建卡", "原话.建卡", self.做_原话建卡, "#2563eb")
        self._按钮(操作, "关联卡", "原话.关联卡", self.做_原话关联, "#7c3aed")
        self._按钮(操作, "看全文", "系统.日志", lambda: self.做_看全文(), "#4b5563")

        列 = ("序号", "时刻", "原话（摘）", "备注", "落实成", "状态", "灯")
        self.原话表 = ttk.Treeview(包裹, columns=列, show="headings")
        for 名 in 列:
            宽 = {"原话（摘）": 320, "备注": 190, "落实成": 170}.get(名, 80)
            self.原话表.heading(名, text=名)
            self.原话表.column(名, width=宽, anchor="w")
        self.原话表.pack(fill="both", expand=True)
        self.原话表.bind("<Double-1>", lambda e: self.做_看全文())
        for 灯, 色 in 灯色.items():
            self.原话表.tag_configure(灯, foreground=色)

    # ---- P5 总管手册（数据驱动：目录里有什么就显示什么，页面内容不写死）
    def _建页5(self):
        tk, ttk = self.tk, self.ttk
        self.手册页 = {}
        self.手册当前 = ""
        包裹 = tk.Frame(self.页5, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=10, pady=8)

        # 顶栏：红色"我卡住了"，永远在最上面
        顶 = tk.Frame(包裹, bg="#f7f8fa")
        顶.pack(fill="x")
        急 = tk.Button(顶, text="我卡住了 →", command=self.做_我卡住了,
                      bg="#c53030", fg="white", font=("Microsoft YaHei", 11, "bold"),
                      relief="flat", padx=14, pady=4, cursor="hand2")
        急.pack(side="left")
        急灰 = _灰字(顶, "手册.读 页=04_故障速查")
        急灰.configure(bg="#f7f8fa")
        急灰.pack(side="left", padx=(2, 12))

        self.手册搜索框 = tk.Entry(顶, width=26, font=("Microsoft YaHei", 10))
        self.手册搜索框.pack(side="left")
        self.手册搜索框.bind("<Return>", lambda e: self.做_手册搜())
        self._按钮(顶, "搜索", "手册.搜", self.做_手册搜, "#2563eb")
        self._按钮(顶, "刷新目录", "手册.目录", self.做_刷新手册, "#4b5563")
        self._按钮(顶, "新建页", "手册.新建", self.做_手册新建, "#0f766e")
        self._按钮(顶, "往本页追加", "手册.追加", self.做_手册追加, "#7c3aed")

        主体 = tk.Frame(包裹, bg="#f7f8fa")
        主体.pack(fill="both", expand=True, pady=(8, 0))

        # 左：目录 + 搜索结果
        左 = tk.Frame(主体, bg="white", width=270, highlightbackground="#e3e6ea",
                      highlightthickness=1)
        左.pack(side="left", fill="y")
        左.pack_propagate(False)
        tk.Label(左, text="目录", font=("Microsoft YaHei", 9, "bold"), bg="white",
                 anchor="w").pack(fill="x", padx=8, pady=(6, 2))
        self.手册目录框 = tk.Listbox(左, font=("Microsoft YaHei", 9), activestyle="none",
                                  exportselection=False, height=12)
        self.手册目录框.pack(fill="both", expand=True, padx=4)
        self.手册目录框.bind("<<ListboxSelect>>", self._手册选页)
        tk.Label(左, text="搜索结果（点一条跳过去）", font=("Microsoft YaHei", 8),
                 fg="#6b7280", bg="white", anchor="w").pack(fill="x", padx=8, pady=(6, 2))
        self.手册结果框 = tk.Listbox(左, font=("Microsoft YaHei", 8), activestyle="none",
                                  exportselection=False, height=9)
        self.手册结果框.pack(fill="both", expand=True, padx=4, pady=(0, 6))
        self.手册结果框.bind("<<ListboxSelect>>", self._手册选结果)
        self.手册结果 = []

        # 右：正文
        右 = tk.Frame(主体, bg="white", highlightbackground="#e3e6ea", highlightthickness=1)
        右.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self.手册标题 = tk.Label(右, text="（选一页）", font=("Microsoft YaHei", 13, "bold"),
                              bg="white", anchor="w", padx=10, pady=6)
        self.手册标题.pack(fill="x")
        self.手册正文 = tk.Text(右, wrap="word", font=("Microsoft YaHei", 10), bg="white",
                             relief="flat", padx=12, pady=6)
        self.手册正文.pack(fill="both", expand=True)
        滚 = ttk.Scrollbar(右, orient="vertical", command=self.手册正文.yview)
        self.手册正文.configure(yscrollcommand=滚.set)
        滚.place(relx=1.0, rely=0.55, anchor="e")

        T = self.手册正文
        T.tag_configure("h1", font=("Microsoft YaHei", 16, "bold"), spacing1=8, spacing3=4)
        T.tag_configure("h2", font=("Microsoft YaHei", 13, "bold"), spacing1=6, spacing3=2)
        T.tag_configure("h3", font=("Microsoft YaHei", 11, "bold"), spacing1=4)
        T.tag_configure("li", lmargin1=18, lmargin2=30)
        T.tag_configure("code", font=("Consolas", 9), background="#f3f4f6")
        T.tag_configure("quote", foreground="#6b7280", lmargin1=16, lmargin2=16)
        T.tag_configure("bold", font=("Microsoft YaHei", 10, "bold"))
        T.tag_configure("hit", background="#fde68a")
        T.configure(state="disabled")

    # ---- P5 动作
    def 做_刷新手册(self):
        结果 = self.叫("手册.目录")
        数据 = 结果.get("数据") or {}
        self.手册目录框.delete(0, "end")
        self.手册页 = {}
        for 项 in 数据.get("页", []):
            self.手册页[项["页"]] = 项
            self.手册目录框.insert("end", "%s · %s  （%d 条 / %d B）"
                                 % (项["页"][:2], 项["标题"], 项["条目数"], 项["字节"]))
        self.说("手册目录 %d 页" % 数据.get("总", 0), "手册.目录", 结果)

    def _手册选页(self, _事件=None):
        选 = self.手册目录框.curselection()
        if not 选:
            return
        项 = list(self.手册页.values())[选[0]]
        self.开手册页(项["页"])

    def 开手册页(self, 页, 行号=None):
        结果 = self.叫("手册.读", {"页": 页})
        if not 结果.get("ok"):
            return
        数据 = 结果.get("数据") or {}
        self.手册当前 = 数据.get("文件名", 页)
        self.手册标题.configure(text="%s    ｜ %d 行 ｜ %d B"
                                % (数据.get("标题", 页), 数据.get("行数", 0), 数据.get("字节", 0)))
        self._渲染手册(数据.get("正文", ""), 行号)

    def _渲染手册(self, 正文, 行号=None):
        """极简 Markdown：标题/段落/列表/表格/代码块/行内代码/加粗。无第三方库。"""
        T = self.手册正文
        T.configure(state="normal")
        T.delete("1.0", "end")
        在代码块 = False
        for 序号, 原行 in enumerate(正文.splitlines(), start=1):
            行 = 原行.rstrip()
            if 行.strip().startswith("```"):
                在代码块 = not 在代码块
                continue
            if 在代码块:
                T.insert("end", 行 + "\n", "code")
                continue
            if not 行.strip():
                T.insert("end", "\n")
                continue
            if 行.startswith("### "):
                T.insert("end", 行[4:].strip() + "\n", "h3")
            elif 行.startswith("## "):
                T.insert("end", 行[3:].strip() + "\n", "h2")
            elif 行.startswith("# "):
                T.insert("end", 行[2:].strip() + "\n", "h1")
            elif 行.lstrip().startswith(("- ", "* ", "+ ")):
                内容 = 行.lstrip()[2:]
                T.insert("end", "• ", "li")
                self._行内(内容)
                T.insert("end", "\n", "li")
            elif 行.startswith("|"):
                格 = [c.strip() for c in 行.strip().strip("|").split("|")]
                if all(set(c) <= set("-: ") for c in 格 if c):
                    continue
                T.insert("end", "  " + " │ ".join(格) + "\n", "code")
            elif 行.startswith(">"):
                T.insert("end", 行.lstrip("> ").strip() + "\n", "quote")
            else:
                self._行内(行)
                T.insert("end", "\n")
        if 行号:
            try:
                T.tag_add("hit", "%d.0" % 行号, "%d.end" % 行号)
                T.see("%d.0" % 行号)
            except Exception:
                pass
        T.configure(state="disabled")

    def _行内(self, 文本):
        """行内 `code` 与 **加粗**。"""
        T = self.手册正文
        for 段 in re.split(r"(`[^`]+`|\*\*[^*]+\*\*)", 文本):
            if not 段:
                continue
            if 段.startswith("`") and 段.endswith("`") and len(段) > 2:
                T.insert("end", 段[1:-1], "code")
            elif 段.startswith("**") and 段.endswith("**") and len(段) > 4:
                T.insert("end", 段[2:-2], "bold")
            else:
                T.insert("end", 段)

    def 做_手册搜(self):
        词 = self.手册搜索框.get().strip()
        if not 词:
            self.说("先输入搜索词")
            return
        结果 = self.叫("手册.搜", {"词": 词})
        数据 = 结果.get("数据") or {}
        self.手册结果 = 数据.get("命中", [])
        self.手册结果框.delete(0, "end")
        for 项 in self.手册结果:
            self.手册结果框.insert("end", "%s · 第%d行 · %s" % (项["页"], 项["行"], 项["片段"][:40]))
        self.说("「%s」命中 %d 条（最多 50）" % (词, len(self.手册结果)), "手册.搜", 结果)

    def _手册选结果(self, _事件=None):
        选 = self.手册结果框.curselection()
        if not 选 or 选[0] >= len(self.手册结果):
            return
        项 = self.手册结果[选[0]]
        # 同步左侧目录选中状态
        for 序, 值 in enumerate(self.手册页.values()):
            if 值["页"] == 项["页"]:
                self.手册目录框.selection_clear(0, "end")
                self.手册目录框.selection_set(序)
                break
        self.开手册页(项["页"], 项["行"])

    def 做_我卡住了(self):
        """慌乱时的一步：直接跳故障速查，并把光标丢进搜索框。"""
        self.开手册页("04_故障速查")
        self.手册搜索框.focus_set()
        self.手册搜索框.selection_range(0, "end")
        self.说("已跳到 04_故障速查（搜索框已聚焦）", "手册.读")

    def 做_手册新建(self):
        标题 = self._问("新建手册页", "页标题（会存成 NN_标题.md，套三段模板）")
        if not 标题:
            return
        结果 = self.叫("手册.新建", {"标题": 标题})
        if 结果.get("ok"):
            self.做_刷新手册()

    def 做_手册追加(self):
        if not self.手册当前:
            self._弹("追加", "先打开一页")
            return
        话 = self._问("追加到 %s" % self.手册当前, "追加一条（自动带日期时间前缀）")
        if not 话:
            return
        结果 = self.叫("手册.追加", {"页": self.手册当前, "话": 话})
        if 结果.get("ok"):
            self.开手册页(self.手册当前)

    # ------------------------------------------------------------ 底栏
    def _建底栏(self):
        tk = self.tk
        条 = tk.Frame(self.根, bg="#e5e7eb", height=26)
        条.pack(fill="x", side="bottom")
        条.pack_propagate(False)
        self.底栏 = tk.Label(条, text="就绪", font=("Microsoft YaHei", 9), fg="#374151",
                            bg="#e5e7eb", anchor="w")
        self.底栏.pack(side="left", padx=10)
        self.端口标签 = tk.Label(条, text="", font=("Consolas", 9), fg="#374151", bg="#e5e7eb")
        self.端口标签.pack(side="right", padx=10)
        self.端口标签.configure(
            text="网页：%s" % ("http://127.0.0.1:%d/" % self.网页端口 if self.网页端口 else "未启动"))

    def 说(self, 文字, 命令=None, 结果=None):
        if 结果 is not None:
            文字 = "%s | %s | %s ms" % (文字, "ok" if 结果.get("ok") else "fail",
                                        结果.get("耗时ms", 0))
        self.底栏.configure(text=文字)
        公共.日志("[Tk] %s" % 文字)

    # ------------------------------------------------------------ 命令调用
    def 叫(self, 命令, 参数=None):
        结果 = 核心.执行(命令, 参数 or {}, 来源="Tk")
        self.说("%s：%s" % (命令, 结果.get("说明", "")), 命令, 结果)
        if not 结果.get("ok"):
            self._弹("命令失败", "%s\n\n%s" % (命令, 结果.get("说明", "")))
        return 结果

    def _弹(self, 标题, 内容):
        from tkinter import messagebox
        messagebox.showinfo(标题, 内容)

    def _问(self, 标题, 提示, 默认=""):
        from tkinter import simpledialog
        return simpledialog.askstring(标题, 提示, initialvalue=默认, parent=self.根)

    # ------------------------------------------------------------ P1 动作
    def 做_重采集(self):
        结果 = self.叫("trae.重采集")
        if 结果.get("ok"):
            self.状态 = 采集器.读状态()
            self._刷页1()

    def 做_自检(self):
        def 跑():
            结果 = 核心.执行("系统.自检", {}, 来源="Tk")
            数据 = 结果.get("数据") or {}
            行 = ["%s %s  %s" % ("OK" if 项["ok"] else "--", 项["项"], 项["说明"])
                  for 项 in 数据.get("项", [])]
            self.根.after(0, lambda: self._弹("系统.自检 %s" % 数据.get("RESULT", ""),
                                             "\n".join(行) or 结果.get("说明", "")))
        threading.Thread(target=跑, daemon=True).start()

    def 做_对齐自检(self):
        self.说("系统.对齐自检 运行中（要真跑 19 次 CLI，约 10 秒）…")
        def 跑():
            结果 = 核心.执行("系统.对齐自检", {}, 来源="Tk")
            数据 = 结果.get("数据") or {}
            行 = ["%-16s CLI:%-4s Tk:%-4s 网页:%-4s %s" % (
                 x["命令"], "OK" if x["CLI"] else "--", "OK" if x["Tk"] else "--",
                 "OK" if x["网页"] else "--", x["读写"]) for x in 数据.get("表", [])]
            行.append("")
            行.append("网页探测方式：%s" % 数据.get("网页探测方式", ""))
            行.append("RESULT=%s" % 数据.get("RESULT", ""))
            行.extend(数据.get("缺", []))
            self.根.after(0, lambda: self._弹("三端对齐自检", "\n".join(行)))
            self.根.after(0, lambda: self.说("对齐自检 %s" % 数据.get("RESULT", "")))
        threading.Thread(target=跑, daemon=True).start()

    # ------------------------------------------------------------ P2 动作
    def 做_刷新员工(self):
        结果 = self.叫("员工.列表")
        if 结果.get("ok"):
            self._刷页2(强制=True)

    def 做_催办(self):
        选 = self.员工表.selection()
        if not 选:
            self._弹("催办", "先在列表里选一个人")
            return
        值 = self.员工表.item(选[0], "values")
        号 = 值[0] if 值 else ""
        if not 号:
            self._弹("催办", "这一行没有终身号（临时会话不能按号催办）")
            return
        话 = self._问("催办 %s" % 号, "说什么？", "请立刻回一行当前进度")
        if not 话:
            return
        结果 = self.叫("员工.催办", {"号": 号, "话": 话})
        self._弹("催办", 结果.get("说明", ""))

    # ------------------------------------------------------------ P3 动作
    def 做_新任务(self):
        标题 = self._问("新建任务卡", "标题：", "")
        if not 标题:
            return
        负责人 = self._问("新建任务卡", "负责人终身号（可空）：", "")
        结果 = self.叫("任务.建卡", {"标题": 标题, "负责人": (负责人 or "").strip()})
        if 结果.get("ok"):
            self.状态 = 采集器.读状态()
            self._刷页3(强制=True)

    def 做_改状态(self, 到):
        if not self.选中卡:
            return
        self.叫("任务.改状态", {"卡": self.选中卡, "到": 到})
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    def 做_换负责人(self, 号):
        if not self.选中卡:
            return
        self.叫("任务.换负责人", {"卡": self.选中卡, "号": 号})
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    def 做_加备注(self):
        if not self.选中卡:
            return
        话 = self._问("加备注 %s" % self.选中卡, "备注：", "")
        if not 话:
            return
        self.叫("任务.加备注", {"卡": self.选中卡, "话": 话})
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    def 做_归档(self):
        if not self.选中卡:
            return
        self.叫("任务.归档", {"卡": self.选中卡})
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    # ------------------------------------------------------------ P4 动作
    def _选中原话(self):
        选 = self.原话表.selection()
        if not 选:
            self._弹("原话", "先在表里选一条原话")
            return None
        值 = self.原话表.item(选[0], "values")
        序号 = 值[0] if 值 else ""
        日 = (self.原话数据.get("日") or 公共.今天前缀())
        return "%s#%s" % (日, 序号)

    def 做_原话备注(self):
        键 = self._选中原话()
        if not 键:
            return
        话 = self._问("补备注 %s" % 键, "备注：", "")
        if not 话:
            return
        结果 = self.叫("原话.备注", {"条": 键, "话": 话})
        self._弹("补备注", 结果.get("说明", ""))
        self._刷页4(强制=True)

    def 做_原话建卡(self):
        键 = self._选中原话()
        if not 键:
            return
        结果 = self.叫("原话.建卡", {"条": 键})
        self._弹("建卡", 结果.get("说明", ""))
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)
        self._刷页4(强制=True)

    def 做_原话关联(self):
        键 = self._选中原话()
        if not 键:
            return
        卡id = self._问("关联卡 %s" % 键, "卡号（如 T0042）：", "")
        if not 卡id:
            return
        结果 = self.叫("原话.关联卡", {"条": 键, "卡": 卡id.strip()})
        self._弹("关联卡", 结果.get("说明", ""))
        self._刷页4(强制=True)

    def 做_看全文(self):
        选 = self.原话表.selection()
        if not 选:
            return
        值 = self.原话表.item(选[0], "values")
        序号 = 值[0] if 值 else ""
        日 = self.原话数据.get("日") or 公共.今天前缀()
        全文 = 原话解析.取全文(日, 序号) or "（素材里没有第 %s 条全文）" % 序号
        窗 = self.tk.Toplevel(self.根)
        窗.title("原话全文 · 第 %s 条" % 序号)
        窗.geometry("720x520")
        文本 = self.tk.Text(窗, wrap="word", font=("Microsoft YaHei", 10), padx=12, pady=12)
        文本.pack(fill="both", expand=True)
        文本.insert("1.0", 全文)
        文本.configure(state="disabled")

    # ------------------------------------------------------------ 刷新
    def 刷新(self):
        try:
            self.状态 = 采集器.读状态()
            ts = self.状态.get("ts_ms", 0)
            if ts != self._上次ts:
                self._上次ts = ts
                self._刷页1()
                self._刷页2()
                self._刷页3()
                self._刷顶栏()
            # P4 稍慢（要读 md），每 3 秒一次足够
            if int(time.time()) % 3 == 0:
                self._刷页4()
        except Exception as 错:
            公共.日志("[Tk] 刷新异常: %s" % 错, "警告")
        finally:
            self.根.after(1000, self.刷新)

    def _刷顶栏(self):
        状态 = self.状态
        灯 = 状态.get("总状态", "灰")
        self.总灯.configure(fg=灯色.get(灯, "#8a8f98"))
        横幅 = 状态.get("横幅") or []
        文本 = "；".join(横幅) if 横幅 else "一切正常"
        self.横幅.configure(text=文本,
                          fg="#fecaca" if 灯 in ("红", "黄") else "#d1fae5")
        任务 = (状态.get("任务") or {}).get("统计") or {}
        未完成 = 任务.get("未做", 0) + 任务.get("在做", 0) + 任务.get("卡住", 0)
        self.小结.configure(text="未完成 %d / 已完成 %d" % (未完成, 任务.get("已完成", 0)))
        self.汇总.configure(text="未完成 %d / 已完成 %d" % (未完成, 任务.get("已完成", 0)))

    def _刷页1(self):
        trae = self.状态.get("trae") or {}
        for 键, 标签 in self.卡1.items():
            值 = trae.get(键, "—")
            if isinstance(值, bool):
                值 = "在" if 值 else "不在"
            文本 = str(值)
            标签.configure(text=文本)
            if 键 == "判定":
                标签.configure(fg=灯色.get(文本, "#111827"))
            elif 键 == "界面模式":
                标签.configure(fg="#1f9d55" if 文本 == "Code" else "#c9a227")
        明细 = trae.get("进程明细") or []
        行 = "  ".join("%s@%s" % (d.get("pid"), d.get("起") or "?") for d in 明细)
        self.进程框.configure(state="normal")
        self.进程框.delete("1.0", "end")
        self.进程框.insert("1.0", "共 %d 个进程\n\n%s" % (trae.get("进程数", 0), 行))
        self.进程框.configure(state="disabled")

    def _刷页2(self, 强制=False):
        员工 = self.状态.get("员工") or []
        签名 = tuple((人.get("终身号"), 人.get("灯"), 人.get("距今秒"), 人.get("今日消息数"))
                    for 人 in 员工)
        if not 强制 and 签名 == self._上次员工签名:
            return
        self._上次员工签名 = 签名
        for 项 in self.员工表.get_children():
            self.员工表.delete(项)
        for 人 in 员工:
            self.员工表.insert("", "end", values=(
                人.get("终身号") or "-", 人.get("会话名", ""), 人.get("灯", ""),
                人.get("最后活动", ""), 人.get("距今秒", ""), 人.get("今日消息数", 0),
                ",".join(人.get("手上任务", [])) or "—",
            ), tags=(人.get("灯", "灰"),))

    def _刷页3(self, 强制=False):
        任务 = self.状态.get("任务") or {}
        卡们 = 任务.get("卡") or []
        签名 = tuple((卡.get("id"), 卡.get("状态"), 卡.get("负责人"), 卡.get("更新"),
                      len(卡.get("证据") or []), 卡.get("标题")) for 卡 in 卡们)
        if not 强制 and 签名 == self._上次任务签名:
            return
        self._上次任务签名 = 签名
        汇总 = 任务.get("统计") or {}
        未完成 = 汇总.get("未做", 0) + 汇总.get("在做", 0) + 汇总.get("卡住", 0)
        self.汇总.configure(text="未完成 %d / 已完成 %d" % (未完成, 汇总.get("已完成", 0)))

        for 子 in self.泳道内框.winfo_children():
            子.destroy()
        泳道们 = ("未做", "在做", "已完成", "卡住")
        for i, 状态名 in enumerate(泳道们):
            列框 = self.tk.Frame(self.泳道内框, bg="#eef1f5", padx=6, pady=4)
            列框.grid(row=0, column=i, sticky="n", padx=4, pady=4)
            本列 = [卡 for 卡 in 卡们 if 卡.get("状态") == 状态名]
            头 = self.tk.Label(列框, text="%s %d" % (状态名, len(本列)),
                              font=("Microsoft YaHei", 10, "bold"), bg="#eef1f5",
                              fg={"未做": "#6b7280", "在做": "#2563eb",
                                  "已完成": "#1f9d55", "卡住": "#c53030"}.get(状态名, "#111"))
            头.pack(anchor="w", pady=(0, 6))
            if not 本列:
                self.tk.Label(列框, text="（空）", font=("Microsoft YaHei", 9),
                              fg="#9aa0a6", bg="#eef1f5").pack(anchor="w")
            for 卡 in 本列[:30]:
                self._画卡(列框, 卡)
        self._画详情(self.选中卡)

    def _画卡(self, 父, 卡):
        tk = self.tk
        色 = {"未做": "#9ca3af", "在做": "#2563eb", "已完成": "#1f9d55",
             "卡住": "#c53030", "作废": "#6b7280"}.get(卡.get("状态"), "#9ca3af")
        框 = tk.Frame(父, bg="white", highlightbackground="#e3e6ea", highlightthickness=1,
                      cursor="hand2")
        框.pack(fill="x", pady=4, ipadx=2, ipady=2)
        条 = tk.Frame(框, bg=色, height=3)
        条.pack(fill="x")
        头 = tk.Frame(框, bg="white")
        头.pack(fill="x", padx=6, pady=(4, 0))
        tk.Label(头, text=卡.get("id", ""), font=("Consolas", 9, "bold"), bg="white",
                 fg="#111827").pack(side="left")
        tk.Label(头, text=卡.get("状态", ""), font=("Microsoft YaHei", 8), bg="white",
                 fg=色).pack(side="left", padx=6)
        标题 = (卡.get("标题") or "")[:34]
        tk.Label(框, text=标题, font=("Microsoft YaHei", 9), bg="white", fg="#111827",
                 anchor="w", justify="left", wraplength=210).pack(fill="x", padx=6)
        负责 = "负责：%s %s" % (卡.get("负责人") or "未指派", 卡.get("负责人名", ""))
        tk.Label(框, text=负责.strip() if 卡.get("负责人") else "负责：未指派",
                 font=("Microsoft YaHei", 8), bg="white", fg="#6b7280", anchor="w").pack(
            fill="x", padx=6)
        tk.Label(框, text="更新 %s · 证据 %d 条" % (卡.get("更新", ""), len(卡.get("证据") or [])),
                 font=("Microsoft YaHei", 8), bg="white", fg="#9aa0a6", anchor="w").pack(
            fill="x", padx=6, pady=(0, 4))
        for 控件 in (框, 条, 头):
            控件.bind("<Button-1>", lambda e, c=卡: self._选卡(c.get("id")))
        for 子 in 框.winfo_children():
            for 孙 in 子.winfo_children():
                孙.bind("<Button-1>", lambda e, c=卡: self._选卡(c.get("id")))

    def _选卡(self, 卡id):
        self.选中卡 = 卡id or ""
        卡 = None
        for 项 in ((self.状态.get("任务") or {}).get("卡") or []):
            if 项.get("id") == 卡id:
                卡 = 项
                break
        self._画详情(卡)

    def _画详情(self, 卡):
        tk = self.tk
        for 子 in self.详情框.winfo_children():
            子.destroy()
        if not 卡:
            tk.Label(self.详情框, text="点左边卡片看详情", font=("Microsoft YaHei", 9),
                     fg="#9aa0a6", bg="white").pack(pady=40)
            return
        顶部 = tk.Frame(self.详情框, bg="white")
        顶部.pack(fill="x", padx=10, pady=(10, 4))
        tk.Label(顶部, text="%s  [%s]" % (卡.get("id"), 卡.get("状态")),
                 font=("Microsoft YaHei", 11, "bold"), bg="white",
                 fg="#111827").pack(side="left")
        tk.Button(顶部, text="归档", command=self.做_归档, bg="#6b7280", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8)).pack(side="right")
        _灰字(self.详情框, "任务.归档").pack(anchor="e", padx=10)

        tk.Label(self.详情框, text=卡.get("标题", ""), font=("Microsoft YaHei", 10),
                 bg="white", fg="#111827", wraplength=310, justify="left",
                 anchor="w").pack(fill="x", padx=10)

        状态行 = tk.Frame(self.详情框, bg="white")
        状态行.pack(fill="x", padx=10, pady=6)
        for 到 in ("未做", "在做", "已完成", "卡住"):
            tk.Button(状态行, text=到, command=lambda t=到: self.做_改状态(t),
                      bg="#e5e7eb", relief="flat", font=("Microsoft YaHei", 8),
                      padx=6).pack(side="left", padx=2)
        _灰字(self.详情框, "任务.改状态").pack(anchor="w", padx=10)

        人行 = tk.Frame(self.详情框, bg="white")
        人行.pack(fill="x", padx=10, pady=6)
        tk.Label(人行, text="负责人：", font=("Microsoft YaHei", 9), bg="white").pack(side="left")
        名们 = ["（未指派）"] + ["%s %s" % (人.get("终身号"), 人.get("会话名", ""))
                              for 人 in (self.状态.get("员工") or []) if 人.get("终身号")]
        选值 = tk.StringVar(value="（未指派）")
        for 人 in (self.状态.get("员工") or []):
            if 人.get("终身号") == 卡.get("负责人"):
                选值.set("%s %s" % (人.get("终身号"), 人.get("会话名", "")))
        下拉 = self.ttk.Combobox(人行, values=名们, textvariable=选值, width=18,
                                font=("Microsoft YaHei", 8))
        下拉.pack(side="left")
        def 换(e=None):
            文本 = 选值.get().strip()
            号 = "" if 文本.startswith("（") else 文本.split(" ")[0]
            self.做_换负责人(号)
        下拉.bind("<<ComboboxSelected>>", 换)
        _灰字(self.详情框, "任务.换负责人").pack(anchor="w", padx=10)

        备注行 = tk.Frame(self.详情框, bg="white")
        备注行.pack(fill="x", padx=10, pady=6)
        tk.Button(备注行, text="加备注", command=self.做_加备注, bg="#0f766e", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        _灰字(self.详情框, "任务.加备注").pack(anchor="w", padx=10)

        tk.Label(self.详情框, text="证据（%d）" % len(卡.get("证据") or []),
                 font=("Microsoft YaHei", 9, "bold"), bg="white", anchor="w").pack(
            fill="x", padx=10, pady=(6, 0))
        证据框 = tk.Text(self.详情框, height=4, font=("Consolas", 8), bg="#f9fafb",
                        relief="flat")
        证据框.pack(fill="x", padx=10)
        证据框.insert("1.0", "\n".join(卡.get("证据") or []) or "（无）")
        证据框.configure(state="disabled")

        tk.Label(self.详情框, text="变更历史", font=("Microsoft YaHei", 9, "bold"),
                 bg="white", anchor="w").pack(fill="x", padx=10, pady=(6, 0))
        历史框 = tk.Text(self.详情框, height=6, font=("Microsoft YaHei", 8), bg="#f9fafb",
                        relief="flat")
        历史框.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        卡库 = {c.get("id"): c for c in 任务卡库.读().get("卡", [])}
        历史 = (卡库.get(卡.get("id"), {}) or {}).get("历史", [])
        历史框.insert("1.0", "\n".join("%s %s %s" % (h.get("ts", ""), h.get("谁", ""),
                                                    h.get("动作", "")) for h in 历史) or "（无）")
        历史框.configure(state="disabled")

    def _刷页4(self, 强制=False):
        结果 = 核心.执行("原话.列表", {"日": 公共.今天前缀()}, 来源="Tk")
        数据 = 结果.get("数据") or {}
        if not 结果.get("ok"):
            self.原话横幅.configure(text="原话表读不到：%s" % 结果.get("说明", ""), bg="#c53030")
            return
        统计 = 数据.get("统计") or {}
        签名 = (数据.get("日"), len(数据.get("条", [])),
                tuple((条.get("序号"), 条.get("灯"), 条.get("备注", "")[:12],
                       ",".join(条.get("关联卡", []))) for 条 in 数据.get("条", [])))
        if not 强制 and 签名 == self._上次原话签名:
            return
        self._上次原话签名 = 签名
        self.原话数据 = 数据

        横幅 = "今日原话 %d 条 · 已派 %d（%.0f%%）· 已验收 %d · 未派 %d（含待派 %d）" % (
            统计.get("总数", 0), 统计.get("已派", 0), 统计.get("覆盖率", 0),
            统计.get("已验收", 0), 统计.get("未派", 0), 统计.get("待派", 0))
        self.原话横幅.configure(text=横幅,
                              bg="#c53030" if 统计.get("未派", 0) > 0 else "#1f9d55")

        for 项 in self.原话表.get_children():
            self.原话表.delete(项)
        筛选 = self.筛选值.get()
        词 = self.搜索框.get().strip()
        for 条 in 数据.get("条", []):
            if 筛选 == "只看未派" and 条.get("灯") != "红":
                continue
            if 筛选 == "只看未落实" and 条.get("已落实"):
                continue
            if 筛选 == "只看已验收" and (条.get("落实") or "") != "已验收":
                continue
            if 词 and 词 not in (条.get("摘要", "") + 条.get("备注", "")):
                continue
            落实 = "未落实成任务" if not 条.get("关联卡") else "；".join(
                "%s %s" % (卡["id"], 卡.get("状态", "")) for 卡 in 条.get("卡", []))
            self.原话表.insert("", "end", values=(
                条.get("序号"), 条.get("时刻"), 条.get("摘要", "")[:46],
                条.get("备注", "")[:28], 落实, 条.get("落实", ""), 条.get("灯", ""),
            ), tags=(条.get("灯", "灰"),))

    def _改筛选(self):
        self._刷页4(强制=True)

    def 运行(self):
        self.根.after(1000, self.刷新)
        self.根.mainloop()


# ================================================================ 自测

def 跑自测(配置):
    公共.日志("=== --自测 开始 ===")
    结果 = []
    状态 = 采集器.采一轮并写(配置, 0)
    trae = 状态.get("trae", {})
    print("采集：总状态=%s 耗时=%dms" % (状态.get("总状态"), 状态.get("采集耗时ms", 0)))
    print("P1：进程数=%s 9599=%s 19876=%s pid=%s 启动=%s 模式=%s(%s) 判定=%s"
          % (trae.get("进程数"), trae.get("端口9599"), trae.get("端口19876"),
             trae.get("服务端pid"), trae.get("服务端启动时刻"), trae.get("界面模式"),
             trae.get("模式读取方式"), trae.get("判定")))
    print("P2：员工 %d 人" % len(状态.get("员工", [])))
    print("P3：任务卡 %d 张 统计=%s" % (len((状态.get("任务") or {}).get("卡", [])),
                                    (状态.get("任务") or {}).get("统计")))
    原话 = 原话解析.合并()
    print("P4：原话 %d 条 统计=%s" % (len(原话.get("条", [])), 原话.get("统计", {}).get("未派")))
    print("横幅：%s" % "；".join(状态.get("横幅") or ["（无）"]))

    结果.append(("端口/进程有真数据", trae.get("进程数", 0) > 0 and trae.get("端口9599") is True))
    结果.append(("界面模式读到 Code/Work 或老实判未知", trae.get("界面模式") in ("Code", "Work", "未知")))
    结果.append(("员工表非空", len(状态.get("员工", [])) > 0))
    结果.append(("任务库可读", isinstance((状态.get("任务") or {}).get("统计"), dict)))
    结果.append(("原话条数与表行数一致（109）", len(原话.get("条", [])) == 109))

    # 崩溃模拟（改进程名的自测）：期望正好判红 + 横幅写"进程 0 个"，这才叫证明。
    if (配置.get("进程名") or "") != "TRAE SOLO CN.exe":
        崩 = (trae.get("进程数") == 0 and trae.get("判定") == "红"
             and any("进程 0 个" in 行 for 行 in (状态.get("横幅") or [])))
        print("=== 崩溃模拟（进程名=%s）===" % 配置.get("进程名"))
        结果 = [("崩溃模拟判红且横幅写「进程 0 个」", 崩)]
    全通 = all(项[1] for 项 in 结果)
    for 名, 好 in 结果:
        print("  %-4s %s" % ("OK" if 好 else "--", 名))
    print("RESULT=%s" % ("PASS" if 全通 else "FAIL"))
    return 0 if 全通 else 2


# ================================================================ 参数与主流程

def 解析参数(argv):
    参数 = {"headless": False, "no_web": False, "自测": False, "bind": "127.0.0.1",
          "令牌": "", "沙盒": "", "覆盖": {}}
    i = 0
    while i < len(argv):
        项 = argv[i]
        if 项 == "--headless":
            参数["headless"] = True
        elif 项 == "--no-web":
            参数["no_web"] = True
        elif 项 == "--自测":
            参数["自测"] = True
        elif 项 == "--沙盒" and i + 1 < len(argv):
            参数["沙盒"] = argv[i + 1]
            i += 1
        elif 项.startswith("--沙盒="):
            参数["沙盒"] = 项.split("=", 1)[1]
        elif 项 == "--bind" and i + 1 < len(argv):
            参数["bind"] = argv[i + 1]
            i += 1
        elif 项.startswith("--bind="):
            参数["bind"] = 项.split("=", 1)[1]
        elif 项 == "--令牌" and i + 1 < len(argv):
            参数["令牌"] = argv[i + 1]
            i += 1
        elif 项.startswith("--令牌="):
            参数["令牌"] = 项.split("=", 1)[1]
        elif 项.startswith("--进程名="):
            参数["覆盖"]["进程名"] = 项.split("=", 1)[1]
        elif 项.startswith("--端口9599="):
            参数["覆盖"]["端口9599"] = int(项.split("=", 1)[1])
        elif 项.startswith("--端口19876="):
            参数["覆盖"]["端口19876"] = int(项.split("=", 1)[1])
        elif 项.startswith("--账本="):
            参数["覆盖"]["账本路径"] = 项.split("=", 1)[1]
        i += 1
    return 参数


def 读令牌文件():
    路径 = os.path.join(公共.数据目录, "遥控令牌.txt")
    try:
        with open(路径, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def main(argv):
    参 = 解析参数(argv)
    配置 = 公共.准备配置(参["覆盖"])

    if 参["自测"]:
        return 跑自测(配置)

    令牌 = 参["令牌"] or 读令牌文件()
    对外 = 参["bind"] not in ("127.0.0.1", "localhost")
    if 对外 and not 令牌:
        print("拒绝启动：--bind %s 必须同时给 --令牌 <串>（公网闸门，缺一个都不许开）。" % 参["bind"],
              file=sys.stderr)
        print("  例：总管面板.pyw --bind 0.0.0.0 --令牌 <32位随机串>", file=sys.stderr)
        return 2
    if 对外 and len(令牌) < 16:
        print("拒绝启动：对外监听时令牌长度必须 >= 16（当前 %d）。" % len(令牌), file=sys.stderr)
        return 2

    公共.日志("总管面板启动 v%s（headless=%s, web=%s, bind=%s）"
             % (核心.版本, 参["headless"], not 参["no_web"], 参["bind"]))

    停止 = threading.Event()
    共享 = {"网页端口": 0}

    # 采集线程（Tk 主线程不做阻塞采集）
    def 采集循环():
        轮 = 0
        while not 停止.is_set():
            起点 = time.time()
            try:
                采集器.采一轮并写(配置, 共享["网页端口"])
            except Exception as 错:
                公共.日志("采集异常: %s" % 错, "错误")
            轮 += 1
            等 = max(0.05, 1.0 - (time.time() - 起点))
            停止.wait(等)

    threading.Thread(target=采集循环, daemon=True, name="采集器").start()
    threading.Thread(target=任务执行器.主循环, args=(停止, 配置), daemon=True,
                     name="任务执行器").start()

    桥 = 公网桥.启动(配置)

    服务 = None
    if not 参["no_web"]:
        服务 = 网页服务(绑定=参["bind"], 令牌=令牌 if 对外 or 令牌 else "")
        端口 = 服务.启动()
        共享["网页端口"] = 端口
        if 端口:
            print("网页：http://127.0.0.1:%d/" % 端口, flush=True)

    if 参["headless"]:
        公共.日志("headless 模式运行中（Ctrl+C 退出）")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            停止.set()
            服务 and 服务.停止()
            桥.停止()
        return 0

    # 有界面的情况下先起服务再建窗
    if 服务 is None:
        共享["网页端口"] = 0
    界面 = 主界面(配置, 共享["网页端口"], 桥)
    try:
        界面.运行()
    finally:
        停止.set()
        服务 and 服务.停止()
        桥.停止()
        公共.日志("总管面板退出")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
