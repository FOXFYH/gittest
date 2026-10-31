# -*- coding: utf-8 -*-
"""
AI 工作台 · 频道桥（网页遥控本机的通道 · 双线路 A/B）
------------------------------------------------------------
GitHub Pages 只能放静态网页，跑不了 Python；本机又没有公网 IP。
所以由本机主动往外连一条 PieSocket 频道，网页往频道里投命令、本机取命令执行、
结果沿原路回 —— 这就是"网页版和本地 Py 版一模一样"的实现方式。

双线路（2026-10-26 总裁 1.03 口径）：账号A（free.blr2）配额用尽会 system:error 并静默丢帧，
所以本桥内置 A/B 两条线路（同一频道名，只换账号）：首登发一帧 to=__probe__ 探配额；
收到 system:error → 记 FAIL 线路X → 立刻自动切另一条（日志 CONN/FAIL 都带线路名）。

协议（一律 JSON 文本，只有这四个类型，别的类型一律丢弃）：
  网页 → 本机  {"类型":"请求","id":"r_xxx","命令":"任务.列表","参数":{},"口令":"<完整频道号>"}
  本机 → 网页  {"类型":"hello","名":"AI工作台","版本":"0.4.6","ts":"…"}      连上/每 60 秒
  本机 → 网页  {"类型":"ack","id":"r_xxx","ts":"…"}                          收到请求立刻回
  本机 → 网页  {"类型":"结果","id":"r_xxx","ok":true,"数据":…,"说明":"…"}    业务做完回

四条硬规矩（写在这一层，不指望上层自觉）：
  1. 只认 类型/命令/参数/口令/id 五个字段，多一个就丢。
  2. 命令必须在 核心.命令表 里，不在表里直接拒。
  3. 口令必须等于完整频道号（网页端登录时用的那一串），不对就丢且记一条拒绝日志。
  4. 远程写动作记 来源=网页·远程，与本地 网页 分开统计。
"""
import json
import queue
import threading
import time
import urllib.parse

import 公共
import 核心

try:
    import websocket  # websocket-client 1.9
except Exception:  # pragma: no cover
    websocket = None

_合法字段 = ("类型", "id", "命令", "参数", "口令")


def 频道地址(频道, api_key, 主机):
    """拼 PieSocket v3 的 wss 地址。频道名百分号编码（'@' → %40），网页端用 encodeURIComponent，两边一致。"""
    return "%s/%s?api_key=%s&notify_self=0" % (
        (主机 or "").rstrip("/"), urllib.parse.quote(频道, safe=""), api_key)


def 校验报文(报文):
    """频道报文白名单校验：字段、命令、参数类型。"""
    if not isinstance(报文, dict):
        return False, "报文不是对象"
    多余 = [k for k in 报文.keys() if k not in _合法字段]
    if 多余:
        return False, "含非法字段：%s" % ",".join(多余)
    命令 = 报文.get("命令") or ""
    if not 核心.有命令(命令):
        return False, "未知命令：%s" % 命令
    参数 = 报文.get("参数") or {}
    if not isinstance(参数, dict):
        return False, "参数必须是对象"
    return True, "通过"


class 频道桥(object):
    def __init__(self, 配置=None):
        self.配置 = 配置 or {}
        段 = self.配置.get("公网桥")
        段 = 段 if isinstance(段, dict) else {}
        self.启用 = bool(段.get("启用", True))
        self.尾 = (段.get("尾") or 公共.外连["尾"]).strip()
        self.频道 = 公共.频道全(self.尾)
        self.api_key = 段.get("api_key") or 公共.外连["api_key"]
        self.主机 = 段.get("主机") or 公共.外连["主机"]
        self.已连 = False
        self.最后错误 = ""
        self.连上次数 = 0
        self.收到条数 = 0
        self.拒绝条数 = 0
        self.执行条数 = 0
        self.最后心跳 = ""
        self._ws = None
        self._锁 = threading.RLock()
        self._收件 = queue.Queue(maxsize=200)
        self._停止 = threading.Event()
        self._线程 = None
        self._工 = None
        self._心跳 = None
        self._线路序 = 0          # 当前走第几条（0=A / 1=B），切线后记住
        self._线路名 = 'A'
        self._切线路 = threading.Event()   # system:error → 置位，连循环据此换线
        self._探过 = set()        # 本次进程已探过配额的线路

    # ------------------------------------------------------------ 生命周期
    def 启动(self):
        if not self.启用:
            公共.日志("频道桥未启用（公网桥.启用=False），跳过连接")
            self.最后错误 = "未启用"
            return self
        if websocket is None:
            self.最后错误 = "缺 websocket-client 库"
            公共.日志("频道桥起不来：%s" % self.最后错误, "错误")
            return self
        self._工 = threading.Thread(target=self._干活循环, daemon=True, name="频道桥-执行")
        self._工.start()
        self._线程 = threading.Thread(target=self._连接循环, daemon=True, name="频道桥-连接")
        self._线程.start()
        self._心跳 = threading.Thread(target=self._心跳循环, daemon=True, name="频道桥-心跳")
        self._心跳.start()
        公共.日志("频道桥启动：频道=%s（api_key 已内置，不落日志）" % self.频道)
        return self

    def 停止(self):
        self._停止.set()
        self.已连 = False
        with self._锁:
            ws = self._ws
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass

    def 健康(self):
        return {"启用": self.启用, "已连": self.已连, "频道": self.频道,
                "线路": self._线路名, "线路序": self._线路序,
                "连上次数": self.连上次数, "收": self.收到条数,
                "拒": self.拒绝条数, "执行": self.执行条数,
                "最后心跳": self.最后心跳, "说明": self.最后错误}

    # ------------------------------------------------------------ 双线路
    def _线路们(self):
        """A/B 两条线路，同一频道名，只换账号；B 可经配置「公网桥.主机2/api_key2」覆盖。"""
        段 = self.配置.get("公网桥")
        段 = 段 if isinstance(段, dict) else {}
        甲 = ('A', self.主机.rstrip('/') + '/%s?api_key=' + self.api_key)
        乙址 = str(段.get('主机2') or 公共.外连.get('主机2') or '').strip()
        乙钥 = str(段.get('api_key2') or 公共.外连.get('api_key2') or '').strip()
        乙 = ('B', 乙址.rstrip('/') + '/%s?api_key=' + 乙钥)
        线 = [甲]
        if 乙址 and 乙钥 and 乙[1] != 甲[1]:
            线.append(乙)
        return 线

    def _拼址(self, 模板):
        try:
            return 模板 % urllib.parse.quote(self.频道, safe='')
        except Exception:
            return 模板

    # ------------------------------------------------------------ 连接
    def _连接循环(self):
        线 = self._线路们()
        退避 = 5
        while not self._停止.is_set():
            名, 模板 = 线[self._线路序 % len(线)]
            self._线路名 = 名
            网址 = self._拼址(模板)
            try:
                ws = websocket.WebSocketApp(
                    网址,
                    on_open=self._连上,
                    on_message=self._来信,
                    on_error=self._出错,
                    on_close=self._断开)
                with self._锁:
                    self._ws = ws
                公共.日志("CONN 正在连频道（线路%s）：%s" % (名, self.频道))
                # 免 ping（老板 2026-10-25 口径：本 WS 免 ping，纯保活 ping 一律不要；
                # 非 ping 不可最多 30 分钟一条）。断线仍靠 run_forever 返回后的退避重连。
                ws.run_forever(ping_interval=0)
            except Exception as 错:
                self.最后错误 = str(错)
            self.已连 = False
            if self._停止.is_set():
                break
            if self._切线路.is_set():
                # 配额用尽 / key 失效：立刻切另一条线路，不退避
                self._切线路.clear()
                self._线路序 = (self._线路序 + 1) % len(线)
                self._线路名 = 线[self._线路序][0]
                公共.日志("CONN 切到线路%s 重连" % self._线路名)
                continue
            self.最后错误 = self.最后错误 or "连接断开，%d 秒后重连" % 退避
            time.sleep(退避)
            退避 = min(退避 * 2, 60)

    def _连上(self, ws):
        self.已连 = True
        self.连上次数 += 1
        self.最后错误 = ""
        公共.日志("CONN 已登频道（线路%s）" % self._线路名)
        self._发({"类型": "hello", "名": 公共.外连["名"], "版本": 核心.版本,
                  "ts": 公共.现在全()})
        if self._线路名 not in self._探过:
            self._探过.add(self._线路名)
            self._发({"类型": "探活", "to": "__probe__", "ts": 公共.现在全()})

    def _断开(self, ws, 码=None, 因=None):
        self.已连 = False
        公共.日志("频道桥断开（码=%s 原因=%s）" % (码, 因), "警告")

    def _出错(self, ws, 错):
        self.最后错误 = "%s" % 错
        公共.日志("频道桥出错：%s" % 错, "警告")

    def _发(self, 报文):
        with self._锁:
            ws = self._ws
        if ws is None or not self.已连:
            return False
        try:
            ws.send(json.dumps(报文, ensure_ascii=False))
            return True
        except Exception as 错:
            self.最后错误 = "发送失败: %s" % 错
            return False

    def _心跳循环(self):
        while not self._停止.is_set():
            if self.已连:
                self.最后心跳 = 公共.现在全()
                self._发({"类型": "hello", "名": 公共.外连["名"], "版本": 核心.版本,
                          "ts": self.最后心跳})
            # 60 秒（老板 2026-10-25：心跳只允许 TRAE/WB 每分钟一条；本帧只保在线判定，降为 60s）。
            time.sleep(60)

    # ------------------------------------------------------------ 收与执行
    def _来信(self, ws, 文本):
        原文 = str(文本 or '')
        if 'system:error' in 原文:
            公共.日志("FAIL 线路%s 被服务端拒绝：%s" % (self._线路名, 原文[:200]), "警告")
            self.最后错误 = "线路%s 被拒：%s" % (self._线路名, 原文[:120])
            self._切线路.set()
            try:
                ws.close()
            except Exception:
                pass
            return
        try:
            报文 = json.loads(原文)
        except Exception:
            return
        if not isinstance(报文, dict) or 报文.get("类型") != "请求":
            return
        self.收到条数 += 1
        好, 原因 = 校验报文(报文)
        if not 好:
            self._拒(报文, 原因)
            return
        if not 公共.口令对(报文.get("口令"), self.频道):
            self._拒(报文, "口令不对")
            return
        # 先回 hello（网页登录就靠这一条判定「本机在」），再回 ack，都不等业务做完
        self._发({"类型": "hello", "名": 公共.外连["名"], "版本": 核心.版本,
                  "ts": 公共.现在全()})
        self._发({"类型": "ack", "id": 报文.get("id") or "", "ts": 公共.现在全()})
        try:
            self._收件.put_nowait(报文)
        except queue.Full:
            self._发({"类型": "结果", "id": 报文.get("id") or "", "ok": False,
                      "说明": "本机忙：命令队列已满，稍后再试"})

    def _拒(self, 报文, 原因):
        self.拒绝条数 += 1
        公共.日志("频道桥拒绝：命令=%s 原因=%s" % (报文.get("命令") or "-", 原因), "警告")
        self._发({"类型": "结果", "id": 报文.get("id") or "", "ok": False,
                  "说明": "拒绝：%s" % 原因})

    def _干活循环(self):
        while not self._停止.is_set():
            try:
                报文 = self._收件.get(timeout=0.5)
            except queue.Empty:
                continue
            if 报文 is None:
                continue
            aid = 报文.get("id") or ""
            命令 = 报文.get("命令")
            参数 = 报文.get("参数") or {}
            try:
                结果 = 核心.执行(命令, 参数, "网页·远程")
            except Exception as 错:
                结果 = {"ok": False, "说明": "执行异常: %s" % 错}
            self.执行条数 += 1
            回 = dict(结果 or {})
            回.update({"类型": "结果", "id": aid, "来源": "网页·远程",
                       "ts": 公共.现在全()})
            self._发(回)

    # ------------------------------------------------------------ 兼容老接口
    def 收命令(self):
        try:
            return self._收件.get_nowait()
        except queue.Empty:
            return None

    def 发状态(self, 状态=None):
        if not self.已连:
            return False
        return self._发({"类型": "hello", "名": 公共.外连["名"], "版本": 核心.版本,
                         "ts": 公共.现在全()})


_单例 = None


def 启动(配置=None):
    """模块级入口：返回桥对象（未启用也返回，接口一致）。"""
    global _单例
    _单例 = 频道桥(配置).启动()
    return _单例


def 当前():
    return _单例
