# -*- coding: utf-8 -*-
"""
AI工作台 · 任务执行器
------------------------------------------------------------
每 300ms 扫一遍 动作队列.jsonl 里 state=待执行 的行 → 串行执行 → 结果追加
动作结果.jsonl → 队列该行标 state=已完成。

队列是"外部通道"（网页/别的进程/手工）投命令的唯一入口；三端自己的按钮走
核心.执行() 直连，所以正常情况下队列是空的——执行器是兜底与外部入口。
"""
import json
import os
import time

import 公共
import 核心
import 采集器


def _读队列():
    """读整队列（保留坏行原样，不吞掉用户数据）。"""
    行们 = []
    try:
        with open(公共.动作队列文件, "r", encoding="utf-8", errors="replace") as f:
            for 行 in f:
                原文 = 行.rstrip("\n")
                if not 原文.strip():
                    continue
                try:
                    行们.append({"原文": 原文, "记录": json.loads(原文)})
                except Exception:
                    行们.append({"原文": 原文, "记录": None})
    except Exception:
        return []
    return 行们


def _写队列(行们):
    文本 = "\n".join(项["原文"] for 项 in 行们) + ("\n" if 行们 else "")
    公共.原子写文本(公共.动作队列文件, 文本)


def 跑一轮(配置=None):
    """返回本轮执行条数。"""
    执行数 = 0
    with 公共.文件锁(公共.动作队列文件 + ".lock"):
        行们 = _读队列()
        待办 = [(i, 项) for i, 项 in enumerate(行们)
                if 项["记录"] and 项["记录"].get("state") == "待执行"]
        if not 待办:
            return 0
        for 位置, 项 in 待办:
            记录 = 项["记录"]
            命令 = 记录.get("动作") or 记录.get("命令") or ""
            参数 = 记录.get("参数") or {}
            来源 = 记录.get("来源") or "队列"
            时间 = 公共.现在全()
            结果 = 核心.执行(命令, 参数, 来源, 记账=False)
            try:
                公共.追加jsonl(公共.动作结果文件, {
                    "id": 记录.get("id", ""), "ts": 时间, "来源": 来源,
                    "命令": 命令, "参数": 参数,
                    "结果": "ok" if 结果.get("ok") else "fail",
                    "说明": 结果.get("说明", ""), "耗时ms": 结果.get("耗时ms", 0),
                })
            except Exception as 错:
                公共.日志("执行器写结果失败: %s" % 错, "警告")
            记录["state"] = "已完成"
            记录["完成时刻"] = 时间
            记录["结果"] = "ok" if 结果.get("ok") else "fail"
            行们[位置]["原文"] = json.dumps(记录, ensure_ascii=False)
            行们[位置]["记录"] = 记录
            执行数 += 1
        _写队列(行们)
    return 执行数


def _看重采集标志():
    if os.path.exists(公共.重采集标志):
        try:
            os.remove(公共.重采集标志)
        except Exception:
            pass
        try:
            采集器.采一轮并写(公共.准备配置(), 采集器.读状态().get("网页端口", 0))
        except Exception as 错:
            公共.日志("重采集失败: %s" % 错, "警告")
        return True
    return False


def 主循环(停止事件=None, 配置=None):
    公共.日志("任务执行器已启动（300ms 一轮）")
    while True:
        if 停止事件 is not None and 停止事件.is_set():
            break
        try:
            跑一轮(配置)
        except Exception as 错:
            公共.日志("执行器本轮异常: %s" % 错, "警告")
        try:
            _看重采集标志()
        except Exception:
            pass
        time.sleep(0.3)


if __name__ == "__main__":
    import threading
    主循环(threading.Event())
