# -*- coding: utf-8 -*-
"""
AI工作台 · Py 壳（Tk 界面 + 本机网页服务）
------------------------------------------------------------
用法：
  AI工作台.pyw                     开 Tk 界面，同时起网页服务
  AI工作台.pyw --headless          只跑采集 + 网页（无界面）
  AI工作台.pyw --no-web            只跑 Tk（断网也能用）
  AI工作台.pyw --自测              跑自检并打印 RESULT
  AI工作台.pyw --bind 0.0.0.0 --令牌 <32位串>    对外监听（必须带令牌，否则拒绝启动）

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
    "账号.注册",
    "账号.登录",
    "账号.列表",
    "账号.改密",
    "账号.删除",
    "标签.项目列表",
    "标签.模块列表",
    "标签.动作列表",
    "标签.新增",
    "标签.改名",
    "标签.删除",
    "标签.同步预设",
    "标签.引用",
    "任务.换标签",
    "标签.数据位置",
    "标签.同步路径",
    "trae.状态",
    "trae.重采集",
    "员工.列表",
    "员工.排队",
    "员工.排队查询",
    "员工.催办",
    "任务.列表",
    "任务.建卡",
    "任务.改状态",
    "任务.换负责人",
    "任务.加备注",
    "任务.归档",
    "任务.删卡",
    "任务.关联原话",
    "任务.补来源原话",
    "任务.换分组",
    "分组.列表",
    "分组.新建",
    "分组.改名",
    "分组.删除",
    "原话.列表",
    "原话.备注",
    "原话.关联卡",
    "原话.建卡",
    "原话.新建手动",
    "原话.统计",
    "派工单.新建",
    "派工单.列表",
    "派工单.发送",
    "派工单.留言",
    "叮嘱.列表",
    "任务.改详情",
    "派工单.交稿",
    "派工单.验收",
    "派工单.提醒",
    "派工单.投递",
    "派工单.接单",
    "派工单.已读",
    "派工单.闭环",
    "派工单.作废",
    "派工单.令牌",
    "员工.我的列表",
    "员工.我的新增",
    "员工.我的删除",
    "异常.列表",
    "异常.统计",
    "异常.标已处理",
    "提醒.状态",
    "提醒.设忙闲",
    "提醒.标已推",
    "系统.版本",
    "系统.状态",
    "派工.复制预览",
    "派工.发送",
    "系统.自检",
    "系统.对齐自检",
    "系统.日志",
    "手册.一文",
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
    def __init__(self, 界面对象=None, 绑定="127.0.0.1", 令牌="", 端口=0):
        self.界面 = 界面对象
        self.绑定 = 绑定
        self.令牌 = 令牌
        self.指定端口 = int(端口 or 0)   # 沙盒/覆盖指定，0 = 走配置.json
        self.端口 = 0
        self.服务 = None
        self._线程 = None
        self.拒绝日志 = os.path.join(公共.日志目录, "拒绝.log")
        # 口令＝完整频道号（老板只输后半截，前半截程序补）。令牌是给 --bind 0.0.0.0 的附加闸。
        self.口令 = 公共.频道全()
        self.附加令牌 = (令牌 or "").strip()
        self.对外 = 绑定 not in ("127.0.0.1", "localhost")
        self.需要令牌 = True
        self._幂等 = {}          # 幂等键 → (时刻, 结果)，10 分钟内重复请求直接回上次的
        self._幂等锁 = threading.Lock()

    # ---- 内部
    def _命令列表(self):
        """网页端声明支持的命令——唯一源是 HTML 里那份 const 命令列表。"""
        路径 = 公共.网页首页
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
        """通行的口令只有两种：完整频道号（老板唯一会输的那串）、或 --bind 时给的附加令牌。"""
        值 = ""
        if 头:
            头 = 头.strip()
            if 头.lower().startswith("bearer "):
                值 = 头[7:].strip()
            elif 头:
                值 = 头
        if not 值 and isinstance(报文, dict):
            值 = str(报文.get("令牌") or "")
        if not 值:
            return False
        if 公共.口令对(值, self.口令):
            return True
        return bool(self.附加令牌) and 值 == self.附加令牌

    # ---- 起停
    def 启动(self):
        首选 = self.指定端口 or int(公共.读配置().get("网页端口") or 19900)
        self.端口 = 选端口(首选, 首选 + 9)
        if not self.端口:
            公共.日志("%d~%d 全被占用，网页服务未启动" % (首选, 首选 + 9), "错误")
            return 0
        服务 = self

        class 处理器(BaseHTTPRequestHandler):
            server_version = "AIWorkbench/0.4"

            def log_message(self, fmt, *args):  # 静音，别刷屏
                pass

            def _允许源(self):
                """CORS 只放白名单：本机回环 + github.io + trycloudflare 隧道。
                不再回 `*`（收紧）；不在名单里就不发这个头，浏览器自己会挡。"""
                源 = (self.headers.get("Origin") or "").strip()
                if not 源:
                    return ""
                try:
                    主 = (urllib.parse.urlparse(源).hostname or "").lower()
                except Exception:
                    return ""
                if (主 in ("127.0.0.1", "localhost")
                        or 主.endswith(".github.io")
                        or 主.endswith(".trycloudflare.com")
                        or 主.endswith(".workers.dev")):
                    return 源
                return ""

            def _回(self, 码, 体=b"", 类型="application/json; charset=utf-8", 头=None):
                self.send_response(码)
                self.send_header("Content-Type", 类型)
                self.send_header("Content-Length", str(len(体)))
                self.send_header("Cache-Control", "no-store")
                许 = self._允许源()
                if 许:
                    self.send_header("Access-Control-Allow-Origin", 许)
                    self.send_header("Vary", "Origin")
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
                        with open(公共.网页首页, "rb") as f:
                            体 = f.read()
                        self._回(200, 体, "text/html; charset=utf-8")
                    except Exception as 错:
                        self._回(500, ("网页源缺失: %s" % 错).encode("utf-8"),
                                "text/plain; charset=utf-8")
                    return
                if 路径 == "/api/登录参数":
                    # 登录框要用它拼频道。只在本机回环上有意义，公网页面自带同一份常量。
                    self._回json(200, {"前缀": 公共.外连["前缀"], "尾": 公共.外连["尾"],
                                     "api_key": 公共.外连["api_key"], "主机": 公共.外连["主机"],
                                     "名": 公共.外连["名"], "版本": 核心.版本,
                                     "本机": True})
                    return
                if 路径 == "/api/state":
                    if 服务.需要令牌 and not 服务._令牌对(self.headers.get("Authorization"), None):
                        服务._记拒绝(self.client_address[0], "GET /api/state", "没带口令/口令不对")
                        self._回json(401, {"ok": False, "说明": "401 需要口令：Authorization: Bearer <完整频道号>"})
                        return
                    try:
                        with open(公共.状态文件, "rb") as f:
                            体 = f.read()
                        # P1-A：状态回显统一带「端点名」（唯一真源＝核心.端点名()）
                        try:
                            数据 = json.loads(体.decode("utf-8", "replace"))
                            数据["端点名"] = 核心.端点名()
                            体 = json.dumps(数据, ensure_ascii=False).encode("utf-8")
                        except Exception:
                            pass
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
                    服务._记拒绝(self.client_address[0], 命令, "没带口令/口令不对")
                    self._回json(401, {"ok": False, "说明": "401 需要口令：Authorization: Bearer <完整频道号>"})
                    return
                if not 核心.有命令(命令):
                    服务._记拒绝(self.client_address[0], 命令, "未知命令")
                    self._回json(400, {"ok": False, "说明": "未知命令：%s" % 命令})
                    return
                来源 = "网页·远程" if (服务.对外 or 服务.附加令牌) else "网页"
                幂等键 = str(报文.get("幂等") or "").strip()
                if 幂等键:
                    with 服务._幂等锁:
                        旧 = 服务._幂等.get(幂等键)
                        if 旧 and (time.time() - 旧[0]) < 600:
                            回 = dict(旧[1])
                            回["说明"] = "（重复请求，回上次结果）" + str(回.get("说明") or "")
                            回["幂等命中"] = True
                            self._回json(200, 回)
                            return
                参数 = dict(报文.get("参数") or {})
                参数.pop("幂等", None)
                结果 = 核心.执行(命令, 参数, 来源=来源)
                if 幂等键:
                    with 服务._幂等锁:
                        服务._幂等[幂等键] = (time.time(), dict(结果))
                        if len(服务._幂等) > 500:
                            for 键 in sorted(服务._幂等, key=lambda k: 服务._幂等[k][0])[:200]:
                                服务._幂等.pop(键, None)
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
        self.根.title("AI工作台 v%s" % 核心.版本)
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

        self.标题 = tk.Label(self.顶栏, text="AI工作台", font=("Microsoft YaHei", 13, "bold"),
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
        self.页9 = tk.Frame(self.分页, bg="#f7f8fa")
        for 页, 名 in ((self.页1, "TRAE"), (self.页2, "员工"),
                      (self.页3, "任务"), (self.页4, "原话"),
                      (self.页5, "手册"), (self.页9, "派工")):
            self.分页.add(页, text=名)

        self._建页1()
        self._建页2()
        self._建页3()
        self._建页4()
        self._建页5()
        self._建页9()

    # ---- P9 快速派工单
    def _建页9(self):
        tk = self.tk
        包裹 = tk.Frame(self.页9, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=12, pady=10)
        tk.Label(包裹, text="快速派工单（收件人＝P2 同一份员工名册，可多选）",
                 font=("Microsoft YaHei", 11, "bold"), bg="#f7f8fa").pack(anchor="w")
        self.派工收件人 = tk.Listbox(包裹, selectmode="extended", height=6,
                                  font=("Microsoft YaHei", 9), exportselection=False)
        self.派工收件人.pack(fill="x", pady=(6, 4))
        条 = tk.Frame(包裹, bg="#f7f8fa"); 条.pack(fill="x")
        self._按钮(条, "刷新收件人", "员工.列表", self.做_刷新派工收件人)
        tk.Label(包裹, text="派工正文（第一行＝任务卡标题）",
                 font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(anchor="w", pady=(8, 0))
        self.派工正文 = tk.Text(包裹, height=8, font=("Microsoft YaHei", 10),
                             wrap="word", undo=True)
        self.派工正文.pack(fill="both", expand=False)
        钮条 = tk.Frame(包裹, bg="#f7f8fa"); 钮条.pack(fill="x", pady=6)
        self._按钮(钮条, "复制", "派工.复制预览", self.做_派工复制)
        self._按钮(钮条, "一键发送", "派工.发送", self.做_派工发送, "#1f9d55")
        self.派工回音 = tk.Label(钮条, text="", font=("Microsoft YaHei", 9), bg="#f7f8fa")
        self.派工回音.pack(side="left", padx=10)
        self.派工结果 = tk.Text(包裹, height=8, font=("Microsoft YaHei", 9),
                             bg="#111827", fg="#d1fae5", wrap="word")
        self.派工结果.pack(fill="both", expand=True, pady=(6, 0))

    def 做_刷新派工收件人(self):
        self.派工收件人.delete(0, "end")
        for 人 in (self.状态.get("员工") or []):
            名 = str(人.get("会话名") or "")
            if 名:
                self.派工收件人.insert("end", 名)

    def _派工选人名(self):
        return [self.派工收件人.get(i) for i in self.派工收件人.curselection()]

    def 做_派工复制(self):
        收 = self._派工选人名()
        文 = self.派工正文.get("1.0", "end").strip()
        if not 收 or not 文:
            self.派工回音.configure(text="先选收件人、再写派工正文", fg="#c53030")
            return
        结果 = 核心.执行("派工.复制预览", {"收件人": "、".join(收), "文": 文}, "Tk")
        if not 结果.get("ok"):
            self.派工回音.configure(text="拼单失败：" + 结果.get("说明", ""), fg="#c53030")
            return
        全文 = (结果.get("数据") or {}).get("全文", "")
        self.根.clipboard_clear()
        self.根.clipboard_append(全文)
        self.派工回音.configure(text="已复制 %d 字" % len(全文), fg="#1f9d55")

    def 做_派工发送(self):
        收 = self._派工选人名()
        文 = self.派工正文.get("1.0", "end").strip()
        if not 收 or not 文:
            self.派工回音.configure(text="先选收件人、再写派工正文", fg="#c53030")
            return
        self.派工回音.configure(text="发送中…（逐个投递，可能十几秒）", fg="#c9a227")
        self.根.update_idletasks()
        结果 = 核心.执行("派工.发送", {"收件人": "、".join(收), "文": 文}, "Tk")
        数据 = 结果.get("数据") or {}
        行 = []
        for x in (数据.get("结果") or []):
            行.append(("✅ 成功 " if x.get("ok") else "❌ 失败 ") +
                      str(x.get("收件人") or "") + "：" + str(x.get("说明") or ""))
        for k in (数据.get("卡") or []):
            行.append("已建卡 " + k)
        self.派工结果.delete("1.0", "end")
        self.派工结果.insert("end", "\n".join(行) or str(结果.get("说明") or ""))
        成功 = int(数据.get("成功") or 0)
        self.派工回音.configure(text="成功 %d / %d" % (成功, len(收)),
                             fg="#1f9d55" if 成功 == len(收) else "#c53030")

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
        self._按钮(操作, "查排队", "员工.排队查询", self.做_排队查询, "#2563eb")
        self.员工错误 = tk.Label(操作, text="", font=("Microsoft YaHei", 9),
                               bg="#f7f8fa", fg="#c53030", anchor="w")
        self.员工错误.pack(side="left", padx=(12, 0))

        筛行 = tk.Frame(包裹, bg="#f7f8fa")
        筛行.pack(fill="x", pady=(6, 0))
        tk.Label(筛行, text="员工：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left")
        self.员工筛 = tk.StringVar(value="全部")
        self.员工下拉 = self.ttk.Combobox(筛行, textvariable=self.员工筛, width=22,
                                     font=("Microsoft YaHei", 9), values=["全部"])
        self.员工下拉.pack(side="left", padx=4)
        self.员工下拉.bind("<<ComboboxSelected>>", lambda e: self._刷页2(强制=True))
        tk.Label(筛行, text="任务：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left", padx=(10, 0))
        self.近期筛 = tk.StringVar(value="近7天")
        self.近7下拉 = self.ttk.Combobox(筛行, textvariable=self.近期筛, width=8,
                                    font=("Microsoft YaHei", 9), values=["近7天", "全部"])
        self.近7下拉.pack(side="left", padx=4)
        self.近7下拉.bind("<<ComboboxSelected>>", lambda e: self._刷页2(强制=True))

        列 = ("终身号", "会话名", "灯", "状态时长", "系统排队", "名下任务", "今日消息数", "手上任务")
        self.员工表 = ttk.Treeview(包裹, columns=列, show="headings", height=22)
        for 名 in 列:
            self.员工表.heading(名, text=名)
            self.员工表.column(名, width=280 if 名 == "名下任务" else (110 if 名 in ("会话名", "手上任务") else 80), anchor="w")
        self.员工表.pack(fill="both", expand=True, pady=(10, 0))
        self.员工表.bind("<Double-1>", self.做_看排队)
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

        筛行 = tk.Frame(包裹, bg="#f7f8fa")
        筛行.pack(fill="x", pady=(6, 0))
        tk.Label(筛行, text="分组：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left")
        self.分组筛 = tk.StringVar(value="全部")
        self.分组下拉 = self.ttk.Combobox(筛行, textvariable=self.分组筛, width=14,
                                      font=("Microsoft YaHei", 9), values=["全部"])
        self.分组下拉.pack(side="left", padx=4)
        self.分组下拉.bind("<<ComboboxSelected>>", lambda e: self._刷页3(强制=True))
        tk.Label(筛行, text="状态：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left", padx=(10, 0))
        self.状态筛 = tk.StringVar(value="全部")
        self.状态下拉 = self.ttk.Combobox(筛行, textvariable=self.状态筛, width=10,
                                      font=("Microsoft YaHei", 9),
                                      values=["全部", "未完成", "已完成", "未做", "在做", "卡住"])
        self.状态下拉.pack(side="left", padx=4)
        self.状态下拉.bind("<<ComboboxSelected>>", lambda e: self._刷页3(强制=True))
        tk.Label(筛行, text="搜：", font=("Microsoft YaHei", 9), bg="#f7f8fa").pack(side="left", padx=(10, 0))
        self.搜索词 = tk.Entry(筛行, width=18, font=("Microsoft YaHei", 9))
        self.搜索词.pack(side="left", padx=4)
        self.搜索词.bind("<KeyRelease>", lambda e: self._刷页3(强制=True))
        self._按钮(筛行, "刷新分组", "分组.列表", self.做_刷新分组, "#4b5563")
        self._按钮(筛行, "新建分组", "分组.新建", self.做_新建分组, "#7c3aed")
        self._按钮(筛行, "改名", "分组.改名", self.做_改名分组, "#0f766e")
        self._按钮(筛行, "删分组", "分组.删除", self.做_删分组, "#c2410c")

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
        self._按钮(操作, "新建原话", "原话.新建手动", self.做_新建手动原话, "#7c3aed")
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
        self.手册一 = None
        self.手册标记 = {}
        self.手册索引 = []
        包裹 = tk.Frame(self.页5, bg="#f7f8fa")
        包裹.pack(fill="both", expand=True, padx=10, pady=8)

        顶 = tk.Frame(包裹, bg="#f7f8fa")
        顶.pack(fill="x")
        急 = tk.Button(顶, text="我卡住了 →", command=self.做_我卡住了,
                      bg="#c53030", fg="white", font=("Microsoft YaHei", 11, "bold"),
                      relief="flat", padx=14, pady=4, cursor="hand2")
        急.pack(side="left")
        灰 = _灰字(顶, "手册.一文 ｜ 清单系统 S36")
        灰.configure(bg="#f7f8fa")
        灰.pack(side="left", padx=(2, 12))
        self._按钮(顶, "刷新", "手册.一文", self.做_刷新手册, "#4b5563")
        tk.Label(顶, text="内容＝清单系统《总管工作手册》，直接读源文件；左侧分页与这一篇锚定",
                 font=("Microsoft YaHei", 9), bg="#f7f8fa", fg="#6b7280").pack(side="left", padx=8)

        主体 = tk.Frame(包裹, bg="#f7f8fa")
        主体.pack(fill="both", expand=True, pady=(8, 0))
        左 = tk.Frame(主体, bg="white", width=270, highlightbackground="#e3e6ea",
                      highlightthickness=1)
        左.pack(side="left", fill="y")
        左.pack_propagate(False)
        tk.Label(左, text="分页（锚定 S36 总管工作手册）", font=("Microsoft YaHei", 9, "bold"),
                 bg="white", anchor="w").pack(fill="x", padx=8, pady=(6, 2))
        self.手册目录框 = tk.Listbox(左, font=("Microsoft YaHei", 9), activestyle="none",
                                  exportselection=False, height=18)
        self.手册目录框.pack(fill="both", expand=True, padx=4, pady=(0, 6))
        self.手册目录框.bind("<<ListboxSelect>>", self._手册选节)

        右 = tk.Frame(主体, bg="white", highlightbackground="#e3e6ea", highlightthickness=1)
        右.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self.手册标题 = tk.Label(右, text="（载入中…）", font=("Microsoft YaHei", 12, "bold"),
                              bg="white", anchor="w", padx=10, pady=6)
        self.手册标题.pack(fill="x")
        self.手册正文 = tk.Text(右, wrap="word", font=("Microsoft YaHei", 10), bg="white",
                             relief="flat", padx=8, pady=6)
        self.手册正文.pack(fill="both", expand=True)
        滚 = ttk.Scrollbar(右, orient="vertical", command=self.手册正文.yview)
        self.手册正文.configure(yscrollcommand=滚.set)
        滚.place(relx=1.0, rely=0.55, anchor="e")

        T = self.手册正文
        层色们 = [("#eaf7ee", "#9ccfae", "#23553a"), ("#e9f2fd", "#96bce9", "#1f4677"),
                ("#f3edfd", "#bc9fe6", "#4a2d75"), ("#fdf3e4", "#ecc691", "#6b4a14"),
                ("#e7f8f6", "#8fd6cf", "#11504b"), ("#fdeef3", "#f0b0c6", "#7a2444"),
                ("#fbf7e1", "#dfcd88", "#574c12"), ("#eef1f7", "#b6c1d5", "#35415b")]
        for 序, (底, 边, 字) in enumerate(层色们, 1):
            T.tag_configure("题%d" % 序, background=底, foreground=字,
                            font=("Microsoft YaHei", 11, "bold"),
                            lmargin1=6 + (序 - 1) * 14, lmargin2=6 + (序 - 1) * 14,
                            spacing1=5, spacing3=2)
            T.tag_configure("文%d" % 序, background=底, foreground="#2c3a33",
                            font=("Microsoft YaHei", 10),
                            lmargin1=22 + (序 - 1) * 14, lmargin2=34 + (序 - 1) * 14,
                            spacing3=3)
        T.tag_configure("小字", foreground="#6b7280", font=("Microsoft YaHei", 9))
        T.configure(state="disabled")

    # ---- P5 动作（锚定清单系统 S36《总管工作手册》，读源文件；不再扫 手册\ 目录）
    def 做_刷新手册(self):
        结果 = self.叫("手册.一文")
        if not 结果.get("ok"):
            self.说(结果.get("说明") or "读不到手册", "手册.一文", 结果)
            return
        self.手册一 = 结果.get("数据") or {"节点": []}
        节们 = self.手册一.get("节点") or []
        self.手册索引 = []
        self.手册目录框.delete(0, "end")
        for i, n in enumerate(节们):
            self.手册目录框.insert("end", n.get("题", ""))
            self.手册索引.append((i, -1))
            for j, c in enumerate(n.get("子") or []):
                self.手册目录框.insert("end", "      %d) %s" % (j + 1, c.get("题", "")))
                self.手册索引.append((i, j))
        self.手册标题.configure(text="清单系统 %s《%s》 v%s · 更新 %s"
                                % (self.手册一.get("编号", ""), self.手册一.get("标题", ""),
                                   self.手册一.get("版本号", 0), self.手册一.get("更新时间", "")))
        if 节们:
            self.手册目录框.selection_clear(0, "end")
            self.手册目录框.selection_set(0)
            self.开手册节("0")
        self.说("《总管工作手册》%s v%s，%d 个顶层节"
                % (self.手册一.get("编号", ""), self.手册一.get("版本号", 0), len(节们)),
                "手册.一文", 结果)

    def _手册选节(self, _事件=None):
        选 = self.手册目录框.curselection()
        if not 选:
            return
        i, j = self.手册索引[选[0]]
        self.开手册节("%d%s" % (i, (".%d" % j) if j >= 0 else ""))

    def _画手册节点(self, 节点, 层, 路):
        T = self.手册正文
        号 = ((层 - 1) % 8) + 1
        T.mark_set("手卡-" + 路, T.index("end-1c"))
        T.insert("end", "◆ " + (节点.get("题") or "") + "\n", ("题%d" % 号,))
        if 节点.get("文"):
            T.insert("end", 节点["文"] + "\n", ("文%d" % 号,))
        for j, 子 in enumerate(节点.get("子") or []):
            self._画手册节点(子, 层 + 1, "%s.%d" % (路, j))
        T.insert("end", "\n")

    def 开手册节(self, 路):
        if not self.手册一:
            return
        T = self.手册正文
        T.configure(state="normal")
        T.delete("1.0", "end")
        for i, n in enumerate(self.手册一.get("节点") or []):
            self._画手册节点(n, 1, str(i))
        T.configure(state="disabled")
        try:
            T.see("手卡-" + 路)
        except Exception:
            pass

    def 做_我卡住了(self):
        if not self.手册一:
            self.做_刷新手册()
        for i, n in enumerate((self.手册一 or {}).get("节点") or []):
            if re.search("故障|速查", n.get("题") or ""):
                for 序, (ti, tj) in enumerate(self.手册索引):
                    if ti == i and tj == -1:
                        self.手册目录框.selection_clear(0, "end")
                        self.手册目录框.selection_set(序)
                        break
                self.开手册节(str(i))
                self.说("已跳到「%s」" % (n.get("题") or "故障速查"), "手册.一文")
                return

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

    def _刷新卡片(self):
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    def 做_刷新分组(self):
        self.叫("分组.列表", {})
        self._刷新卡片()

    def 做_新建分组(self):
        名 = self._问("新建分组", "分组名称（如：TRAE 修改）：", "")
        if not 名:
            return
        self.叫("分组.新建", {"名": 名})
        self._刷新卡片()

    def 做_改名分组(self):
        旧 = self.分组筛.get()
        if not 旧 or 旧 == "全部":
            self._弹("改名前先选", "先在「分组」下拉里选中要改的分组")
            return
        新 = self._问("分组改名", "把「%s」改成：" % 旧, 旧)
        if not 新 or 新 == 旧:
            return
        self.叫("分组.改名", {"旧": 旧, "新": 新})
        self.分组筛.set("全部")
        self._刷新卡片()

    def 做_删分组(self):
        名 = self.分组筛.get()
        if not 名 or 名 == "全部":
            self._弹("删组前先选", "先在「分组」下拉里选中要删的分组")
            return
        self.叫("分组.删除", {"名": 名})
        self.分组筛.set("全部")
        self._刷新卡片()

    def 做_换分组(self):
        if not self.选中卡:
            return
        组们 = list((self.状态.get("任务") or {}).get("分组") or ["未分类"])
        值 = self._问("换分组 %s" % self.选中卡,
                    "分组（现有：%s；也可直接输新名）：" % "、".join(组们), "")
        if not 值:
            return
        self.叫("任务.换分组", {"卡": self.选中卡, "分组": 值})
        self._刷新卡片()

    def 做_新建手动原话(self):
        from tkinter import simpledialog
        文 = simpledialog.askstring("新建原话", "手动录入一条原话（第一行作摘要）：",
                                    parent=self.根)
        if not 文 or not 文.strip():
            return
        self.叫("原话.新建手动", {"文": 文.strip()})
        self._刷页4(强制=True)

    def 做_看派工单(self):
        if not self.选中卡:
            return
        r = 核心.执行("派工单.列表", {"卡": self.选中卡}, "Tk")
        单们 = (r.get("数据") or {}).get("单") or []
        行 = []
        for x in 单们:
            行.append("%s [%s] 类型=%s%s 工作态=%s 验收态=%s 收件人：%s" % (
                x.get("单号"), x.get("状态"), x.get("类型") or "派工",
                ("(引用 %s)" % x.get("引用单")) if x.get("引用单") else "",
                x.get("工作态") or "待交稿",
                x.get("验收态") or "待验收", "、".join(x.get("收件人") or [])))
            for z in (x.get("叮嘱") or []):
                行.append("    叮嘱：" + str(z))
            for r in (x.get("留言") or []):
                行.append("    · %s %s[%s]：%s" % (r.get("时间"), r.get("谁"), r.get("身份"), r.get("正文")))
            for r in (x.get("回复") or []):
                行.append("    ↳ %s · %s：%s" % (r.get("谁"), r.get("时间"), r.get("正文")))
        if not 行:
            行 = ["（这张卡还没有派工单）"]
        self._弹("派工单 · %s" % self.选中卡, "\n".join(行))

    def 做_新建派工单(self):
        if not self.选中卡:
            return
        from tkinter import simpledialog
        收 = simpledialog.askstring("新建派工单", "收件人（会话名，可多个用、分隔）：",
                                    initialvalue="闲杂事务 1", parent=self.根)
        if not 收:
            return
        文 = simpledialog.askstring("新建派工单", "派工单正文（必填）：", parent=self.根)
        if not 文:
            return
        验 = simpledialog.askstring("新建派工单", "验收标准（必填）：", parent=self.根)
        if not 验:
            return
        嘱 = simpledialog.askstring("新建派工单", "叮嘱（可空，多条用 | 分隔）：", parent=self.根) or ""
        self.叫("派工单.新建", {"卡": self.选中卡, "收件人": 收.strip(), "文": 文.strip(), "验收标准": 验.strip(), "叮嘱": 嘱})
        self.做_看派工单()

    def 做_交稿(self):
        from tkinter import simpledialog
        单号 = simpledialog.askstring("交稿", "单号（如 G0001）：", parent=self.根)
        if not 单号: return
        证 = simpledialog.askstring("交稿", "工作证据：", parent=self.根)
        if not 证: return
        谁 = simpledialog.askstring("交稿", "交稿人：", initialvalue="工作者", parent=self.根) or "工作者"
        self.叫("派工单.交稿", {"单": 单号.strip(), "证据": 证.strip(), "谁": 谁.strip()})
        self.做_看派工单()

    def 做_验收(self):
        from tkinter import simpledialog
        单号 = simpledialog.askstring("验收", "单号（如 G0001）：", parent=self.根)
        if not 单号: return
        结论 = simpledialog.askstring("验收", "结论（合格/不合格/退回整改）：",
                                   initialvalue="合格", parent=self.根)
        if not 结论: return
        话 = simpledialog.askstring("验收", "验收意见/整改要求：", parent=self.根)
        if not 话: return
        谁 = simpledialog.askstring("验收", "验收人：", initialvalue="验收者", parent=self.根) or "验收者"
        self.叫("派工单.验收", {"单": 单号.strip(), "结论": 结论.strip(), "话": 话.strip(), "谁": 谁.strip()})
        self.做_看派工单()

    def 做_提醒(self):
        from tkinter import simpledialog, messagebox
        单号 = simpledialog.askstring("一键提醒", "单号（如 G0001）：", parent=self.根)
        if not 单号: return
        if not messagebox.askyesno("提醒", "把「请查看派工单 %s」发给全部收件人？" % 单号, parent=self.根):
            return
        self.叫("派工单.提醒", {"单": 单号.strip()})

    def 做_留言单(self):
        from tkinter import simpledialog
        单号 = simpledialog.askstring("留言", "单号（如 G0001）：", parent=self.根)
        if not 单号: return
        话 = simpledialog.askstring("留言", "留言内容：", parent=self.根)
        if not 话: return
        self.叫("派工单.留言", {"单": 单号.strip(), "话": 话.strip()})
        self.做_看派工单()

    def 做_改验收标准(self):
        if not self.选中卡:
            return
        from tkinter import simpledialog
        卡 = None
        for 项 in ((self.状态.get("任务") or {}).get("卡") or []):
            if 项.get("id") == self.选中卡: 卡 = 项; break
        新 = simpledialog.askstring("验收标准", "给 %s 写验收标准：" % self.选中卡,
                                   initialvalue=str((卡 or {}).get("验收标准") or ""), parent=self.根)
        if 新 is None:
            return
        self.叫("任务.改详情", {"卡": self.选中卡, "验收标准": 新.strip()})
        self._刷新卡片()

    def 做_发派工单(self):
        from tkinter import simpledialog, messagebox
        单号 = simpledialog.askstring("发送派工单", "单号（如 P0001）：", parent=self.根)
        if not 单号:
            return
        if not messagebox.askyesno("发送", "把派工单 %s 发给全部收件人？" % 单号, parent=self.根):
            return
        self.叫("派工单.发送", {"单": 单号.strip()})

    def 做_删卡(self):
        if not self.选中卡:
            return
        from tkinter import messagebox
        if not messagebox.askyesno("删卡", "删除任务卡 %s？删了不进回收站（日志留痕）" % self.选中卡,
                                   parent=self.根):
            return
        self.叫("任务.删卡", {"卡": self.选中卡})
        self.选中卡 = ""
        self.状态 = 采集器.读状态()
        self._刷页3(强制=True)

    def 做_改来源原话(self):
        if not self.选中卡:
            return
        卡 = None
        for 项 in ((self.状态.get("任务") or {}).get("卡") or []):
            if 项.get("id") == self.选中卡:
                卡 = 项
                break
        旧 = "、".join((卡 or {}).get("来源原话") or [])
        值 = self._问("改关联原话 %s" % self.选中卡,
                    "原话ID（可多张，用、分隔；格式 2026-10-25#042）：", 旧)
        if 值 is None:
            return
        self.叫("任务.关联原话", {"卡": self.选中卡, "条们": 值})
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
        错 = str(self.状态.get("员工错误") or "")
        try:
            self.员工下拉.configure(values=["全部"] + [
                "%s %s" % (人.get("终身号"), 人.get("会话名", ""))
                for 人 in 员工 if 人.get("终身号")])
        except Exception:
            pass
        筛人 = self.员工筛.get() if hasattr(self, "员工筛") else "全部"
        近期 = self.近期筛.get() if hasattr(self, "近期筛") else "近7天"
        全 = list(员工)
        if 筛人 and 筛人 != "全部":
            员工 = [e for e in 员工 if ("%s %s" % (e.get("终身号"), e.get("会话名", ""))) == 筛人]
        if 近期 == "近7天":
            import datetime as _dt
            线 = _dt.datetime.now() - _dt.timedelta(days=7)
            def _日(s):
                s = str(s or "")
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
            def 筛明细(e):
                return dict(e, 任务明细=[x for x in (e.get("任务明细") or []) if (_日(x.get("更新")) or 线) >= 线])
            员工 = [筛明细(e) for e in 员工]
        签名 = (错, 筛人, 近期) + tuple((人.get("终身号"), 人.get("灯"), 人.get("距今秒"),
                            人.get("今日消息数"), 人.get("来源"), len(人.get("任务明细") or []))
                           for 人 in 全)
        if not 强制 and 签名 == self._上次员工签名:
            return
        self._上次员工签名 = 签名
        for 项 in self.员工表.get_children():
            self.员工表.delete(项)
        try:
            self.员工错误.configure(text=("员工数据读不到：" + 错) if 错 else "",
                                   fg="#c53030" if 错 else "#374151")
        except Exception:
            pass
        for 人 in 员工:
            self.员工表.insert("", "end", values=(
                人.get("终身号") or "-", 人.get("会话名", ""), 人.get("灯", ""),
                人.get("时长") or 人.get("最后活动", ""),
                人.get("排队条数", 0),
                "；".join("%s（%s·%s）" % (x.get("标题", ""), x.get("状态", ""), x.get("更新", ""))
                         for x in (人.get("任务明细") or [])) or "暂无任务",
                人.get("今日消息数", 0),
                ",".join(人.get("手上任务", [])) or "—",
            ), tags=(人.get("灯", "灰"),))

    def 做_排队查询(self):
        选 = self.员工表.selection()
        if not 选:
            self._弹("主动查排队", "先在员工表选中一行")
            return
        值 = self.员工表.item(选[0], "values")
        号 = str(值[0] if 值 else "").strip()
        if not 号 or 号 == "-":
            return
        self.说("正在切到 " + 号 + " 查实时排队条…", "员工.排队查询")
        结果 = self.叫("员工.排队查询", {"号": 号})
        if not 结果.get("ok"):
            self._弹("主动查排队 · %s" % 号, 结果.get("说明") or "查询失败")
            self.做_刷新员工()
            return
        数据 = 结果.get("数据") or {}
        条 = 数据.get("条") or []
        文 = "更新：%s\n共 %d 条\n\n%s\n\n写回共享库：%s" % (
            数据.get("写说") or "", len(条),
            "\n\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(条))
            if 条 else "无排队条（消息已进对话流）",
            "成功" if 数据.get("写库") else "未成")
        self._弹("主动查排队 · %s" % 号, 文)
        self.做_刷新员工()

    def 做_看排队(self, _事件=None):
        选 = self.员工表.selection()
        if not 选:
            return
        值 = self.员工表.item(选[0], "values")
        号 = str(值[0] if 值 else "").strip()
        if not 号 or 号 == "-":
            return
        结果 = self.叫("员工.排队", {"号": 号})
        if not 结果.get("ok"):
            self._弹("系统排队条 · %s" % 号, 结果.get("说明") or "读不到")
            return
        数据 = 结果.get("数据") or {}
        条 = 数据.get("条") or []
        文 = "更新：%s\n共 %d 条\n\n%s" % (
            数据.get("时刻") or "（暂无）", len(条),
            "\n\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(条))
            if 条 else "没有排队条（消息已进入对话流）")
        self._弹("系统排队条 · %s" % 号, 文)

    def _刷页3(self, 强制=False):
        任务 = self.状态.get("任务") or {}
        卡们 = 任务.get("卡") or []
        组们 = ["全部"] + list(任务.get("分组") or ["未分类"])
        try:
            self.分组下拉.configure(values=组们)
        except Exception:
            pass
        组 = (self.分组筛.get() if hasattr(self, "分组筛") else "全部") or "全部"
        态 = (self.状态筛.get() if hasattr(self, "状态筛") else "全部") or "全部"
        词 = (self.搜索词.get().strip().lower() if hasattr(self, "搜索词") else "")
        全卡 = list(卡们)
        if 组 != "全部":
            卡们 = [c for c in 卡们 if (c.get("分组") or "未分类") == 组]
        if 态 == "未完成":
            卡们 = [c for c in 卡们 if c.get("状态") in ("未做", "在做", "卡住")]
        elif 态 != "全部":
            卡们 = [c for c in 卡们 if c.get("状态") == 态]
        if 词:
            卡们 = [c for c in 卡们 if 词 in str(c.get("标题") or "").lower()
                    or 词 in str(c.get("详情") or "").lower()]
        签名 = (组, 态, 词) + tuple((卡.get("id"), 卡.get("状态"), 卡.get("负责人"),
                                  卡.get("更新"), len(卡.get("证据") or []),
                                  卡.get("标题"), 卡.get("分组")) for 卡 in 全卡)
        if not 强制 and 签名 == self._上次任务签名:
            return
        self._上次任务签名 = 签名
        汇总 = 任务.get("统计") or {}
        未完成 = 汇总.get("未做", 0) + 汇总.get("在做", 0) + 汇总.get("卡住", 0)
        self.汇总.configure(text="未完成 %d / 已完成 %d　｜　筛出 %d 张" % (
            未完成, 汇总.get("已完成", 0), len(卡们)))

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
        tk.Label(框, text="分组：" + (卡.get("分组") or "未分类"),
                 font=("Microsoft YaHei", 8), bg="white", fg="#0f766e", anchor="w").pack(fill="x", padx=6)
        tk.Label(框, text="原话：" + ("、".join(卡.get("来源原话") or []) or "无对应原话"),
                 font=("Microsoft YaHei", 8), bg="white", fg="#7c3aed", anchor="w",
                 wraplength=210).pack(fill="x", padx=6)
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
        tk.Button(顶部, text="删卡", command=self.做_删卡, bg="#c53030", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8)).pack(side="right", padx=(4, 0))
        tk.Button(顶部, text="归档", command=self.做_归档, bg="#6b7280", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8)).pack(side="right")
        _灰字(self.详情框, "任务.归档").pack(anchor="e", padx=10)

        tk.Label(self.详情框, text=卡.get("标题", ""), font=("Microsoft YaHei", 10),
                 bg="white", fg="#111827", wraplength=310, justify="left",
                 anchor="w").pack(fill="x", padx=10)
        tk.Label(self.详情框, text="验收标准：" + (卡.get("验收标准") or "（未写）"),
                 font=("Microsoft YaHei", 9), bg="white", fg="#c2410c", wraplength=310,
                 justify="left", anchor="w").pack(fill="x", padx=10, pady=(4, 0))
        标行 = tk.Frame(self.详情框, bg="white"); 标行.pack(fill="x", padx=10)
        tk.Button(标行, text="写/改验收标准", command=self.做_改验收标准, bg="#c2410c", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        tk.Label(self.详情框, text="来源原话：" + ("、".join(卡.get("来源原话") or []) or "无对应原话"),
                 font=("Microsoft YaHei", 9), bg="white", fg="#7c3aed",
                 wraplength=310, justify="left", anchor="w").pack(fill="x", padx=10, pady=(6, 0))
        单行 = tk.Frame(self.详情框, bg="white")
        单行.pack(fill="x", padx=10, pady=(2, 4))
        tk.Button(单行, text="派工单", command=self.做_看派工单, bg="#7c3aed", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        tk.Button(单行, text="＋单", command=self.做_新建派工单, bg="#0f766e", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left", padx=6)
        tk.Button(单行, text="发送单", command=self.做_发派工单, bg="#1f9d55", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        tk.Button(单行, text="留言", command=self.做_留言单, bg="#7c3aed", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left", padx=6)
        tk.Button(单行, text="交稿", command=self.做_交稿, bg="#2563eb", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        tk.Button(单行, text="验收", command=self.做_验收, bg="#c2410c", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left", padx=6)
        tk.Button(单行, text="一键提醒", command=self.做_提醒, bg="#4b5563", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        _灰字(self.详情框, "派工单.列表 ／ 派工单.新建 ／ 派工单.发送").pack(anchor="w", padx=10)
        原话行 = tk.Frame(self.详情框, bg="white")
        原话行.pack(fill="x", padx=10, pady=(2, 4))
        tk.Button(原话行, text="改关联原话", command=self.做_改来源原话, bg="#7c3aed", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left")
        tk.Button(原话行, text="换分组", command=self.做_换分组, bg="#0f766e", fg="white",
                  relief="flat", font=("Microsoft YaHei", 8), padx=8).pack(side="left", padx=6)
        _灰字(self.详情框, "任务.关联原话 ／ 任务.换分组").pack(anchor="w", padx=10)

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
        self.根.after(600, self.做_刷新手册)   # P5 目录开机即扫（数据驱动，丢新 md 刷新就有）
        self.根.mainloop()


# ================================================================ 自测

def _原话对得上(原话):
    """面板条数 vs 主表实际行数 —— 现场比对，不写死数字（流水账每天在变）。"""
    try:
        行们, _ = 原话解析.读表(公共.今天前缀())
    except Exception:
        行们 = []
    面板数 = len((原话 or {}).get("条", []))
    print("原话对账：主表 %d 行 / 面板 %d 条" % (len(行们), 面板数))
    return len(行们) > 0 and 面板数 == len(行们)


def _网页常量():
    """把网页源文件里那份常量抠出来（不许手写第二份，只能比对）。"""
    路径 = 公共.网页首页
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            文本 = f.read()
    except Exception:
        return {}
    出 = {}
    for 键 in ("H5_VER", "H5_前缀", "H5_KEY"):
        import re
        命中 = re.search(键 + r"\s*=\s*\"([^\"]*)\"", 文本)
        if 命中:
            出[键] = 命中.group(1)
    return 出


def _频道版本自检():
    """两条静态比对：频道常量两端一致、版本号三处一致。漂了就是 FAIL。"""
    网页 = _网页常量()
    项 = []
    同频道 = (网页.get("H5_前缀") == 公共.外连["前缀"]
              and 网页.get("H5_KEY") == 公共.外连["api_key"])
    项.append(("频道常量两端一致（前缀/api_key）", 同频道))
    print("频道常量：网页 前缀=%s key=%s… / 本机 前缀=%s key=%s…"
          % (网页.get("H5_前缀"), (网页.get("H5_KEY") or "")[:8],
             公共.外连["前缀"], 公共.外连["api_key"][:8]))
    同版本 = (网页.get("H5_VER") == 公共.版本号 == 核心.版本)
    项.append(("版本号三处一致（网页/公共/核心）", 同版本))
    print("版本号：网页=%s 公共=%s 核心=%s"
          % (网页.get("H5_VER"), 公共.版本号, 核心.版本))
    return 项


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
    手册目录 = 核心.执行("手册.目录", {}, "自测")
    print("P5：手册 %d 页 目录=%s" % ((手册目录.get("数据") or {}).get("总", 0),
                                    (手册目录.get("数据") or {}).get("目录", "")))
    print("横幅：%s" % "；".join(状态.get("横幅") or ["（无）"]))

    结果.append(("端口/进程有真数据", trae.get("进程数", 0) > 0 and trae.get("端口9599") is True))
    结果.append(("界面模式读到 Code/Work 或老实判未知", trae.get("界面模式") in ("Code", "Work", "未知")))
    结果.append(("员工表非空", len(状态.get("员工", [])) > 0))
    结果.append(("任务库可读", isinstance((状态.get("任务") or {}).get("统计"), dict)))
    结果.append(("原话条数与主表行数自比对（不写死数字）", _原话对得上(原话)))
    结果.extend(_频道版本自检())

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
    # 沙盒：先把写入根整体搬走（真 状态.json/任务卡 一个字节都不动），再读配置
    if 参["沙盒"] or os.environ.get("AI工作台沙盒") == "1":
        沙盒目录 = 参["沙盒"] or ""
        公共.设沙盒(沙盒目录)
        if "网页端口" not in 参["覆盖"]:
            参["覆盖"]["网页端口"] = 19950   # 沙盒换端口，不跟真实例抢 19900
    配置 = 公共.准备配置(参["覆盖"])

    if 参["自测"]:
        return 跑自测(配置)

    令牌 = 参["令牌"] or 读令牌文件()
    对外 = 参["bind"] not in ("127.0.0.1", "localhost")
    if 对外 and not 令牌:
        print("拒绝启动：--bind %s 必须同时给 --令牌 <串>（公网闸门，缺一个都不许开）。" % 参["bind"],
              file=sys.stderr)
        print("  例：AI工作台.pyw --bind 0.0.0.0 --令牌 <32位随机串>", file=sys.stderr)
        return 2
    if 对外 and len(令牌) < 16:
        print("拒绝启动：对外监听时令牌长度必须 >= 16（当前 %d）。" % len(令牌), file=sys.stderr)
        return 2

    公共.日志("AI工作台启动 v%s（headless=%s, web=%s, bind=%s）"
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
    try:
        import 提醒调度
        threading.Thread(target=提醒调度.主循环, args=(停止, 配置), daemon=True,
                         name="提醒调度").start()
    except Exception as 错:
        公共.日志("提醒调度未启动: %s" % 错, "警告")

    桥 = 公网桥.启动(配置)

    服务 = None
    if not 参["no_web"]:
        服务 = 网页服务(绑定=参["bind"], 令牌=令牌 if 对外 or 令牌 else "",
                        端口=配置.get("网页端口"))
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
        公共.日志("AI工作台退出")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
