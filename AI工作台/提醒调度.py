# -*- coding: utf-8 -*-
"""AI工作台 · 提醒调度（P5 · 2026-10-31）
职责：按 配置.提醒周期 扫描异常 → 入队；主人空闲时取出前 5 条，逐条投到主人会话并标已推。
铁律：只经 核心 写 提醒队列/留痕/异常处理；只读 状态.json；绝不写 状态.json / 不碰采集器 / 不碰网页。
启动：由 AI工作台.pyw 主函数在 采集器、任务执行器 之后起线程（import + Thread 各一处，try/except 包住）。
"""
import importlib
import time

import 公共


def _核心():
    return importlib.import_module("核心")


def 取配置(配置=None):
    try:
        配 = 公共.读配置() or {}
    except Exception:
        配 = {}
    return 配 if isinstance(配, dict) else {}


def 周期秒(配):
    try:
        数 = int(配.get("提醒周期") or 300)
    except Exception:
        数 = 300
    return max(60, min(86400, 数))


def 启用(配):
    return str(配.get("提醒启用", True)).strip().lower() not in ("0", "false", "否", "no", "off")


def 跑一拍(配置=None):
    """扫描一次 + 主人空闲才推前 5 条。异常不外抛（由主循环兜）。"""
    核 = _核心()
    配 = 取配置(配置)
    账号 = str(配.get("提醒账号") or "").strip()
    端点 = str(配.get("提醒端点") or "").strip()
    切了 = False
    if 账号:
        好, _说 = 核.进入线程空间(账号, 端点)
        切了 = bool(好)
    try:
        统 = 核.提醒扫描()
        忙, 来源文, _到期 = 核._主人忙闲()
        if 忙:
            return dict(统, 推送=0, 失败=0, 主人=来源文, 另有=0)
        取 = 核.提醒取出()
        条们 = 取.get("条") or []
        会话 = 核.提醒主人会话名()
        推 = 0
        败 = 0
        if 条们 and 会话:
            for 条 in 条们:
                文 = "【提醒·%s】%s（触发 %s）" % (条.get("优先级"), 条.get("标题"),
                                               条.get("触发时刻"))
                if 取.get("另有"):
                    文 += "\n另有 %d 条在队列里" % 取.get("另有")
                try:
                    好, 说 = 核._发到会话(会话, 文, "")
                except Exception as 错:
                    好, 说 = False, "调用异常：%s" % 错
                if 好:
                    核._cmd_提醒标已推({"键": [条.get("键")], "结果": "已推"}, "提醒调度")
                    推 += 1
                else:
                    核._提醒留痕追加(条.get("类型"), 条.get("来源"), 条.get("关联编号"),
                                 条.get("首次入队"), 公共.现在全(), "暂缓",
                                 "推送失败：" + str(说)[:80])
                    败 += 1
        elif 条们:
            核._提醒留痕追加(0, "忙闲", "主人", 公共.现在全(), 公共.现在全(),
                        "暂缓", "主人不在线或无会话名")
        return dict(统, 推送=推, 失败=败, 主人=来源文, 另有=取.get("另有", 0))
    finally:
        if 切了:
            核.退出线程空间()


def _等(停止事件, 秒):
    try:
        秒 = max(0.1, float(秒))
    except Exception:
        秒 = 0.1
    if 停止事件 is None:
        time.sleep(秒)
        return
    try:
        停止事件.wait(秒)
    except Exception:
        time.sleep(秒)


def 主循环(停止事件=None, 配置=None):
    """分片睡 ≤30 秒（每片查停止事件）；配置每片重读，周期下拍生效。"""
    下次 = 0.0
    while not (停止事件 is not None and 停止事件.is_set()):
        配 = 取配置(配置)
        if not 启用(配):
            _等(停止事件, 30)
            continue
        周期 = 周期秒(配)
        现在 = time.time()
        if 现在 >= 下次:
            try:
                跑一拍(配)
            except Exception as 错:
                公共.日志("提醒调度异常: %s" % 错, "错误")
            下次 = time.time() + 周期
        片 = min(30.0, max(1.0, 下次 - time.time()))
        _等(停止事件, 片)
