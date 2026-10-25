# -*- coding: utf-8 -*-
"""
总管面板 · 任务卡库
------------------------------------------------------------
唯一负责 任务卡.json 的读写。契约见 设计_v0.2.md 2.3：
  {"版本":1, "更新":"YYYY-MM-DD HH:MM:SS", "下一个号":N, "卡":[...]}
  id 形如 T + 4 位递增，全局唯一、只增不复用。
  写入一律"读-改-原子写"，并备份上一版（留 30 份）。
任何改卡动作都会在 卡.历史 留 {ts, 谁, 动作}。
"""
import os
import glob
import datetime

import 公共

合法状态 = ("未做", "在做", "已完成", "卡住", "作废")
泳道状态 = ("未做", "在做", "已完成", "卡住")
备份保留份数 = 30


# ---------------------------------------------------------------- 内部

def _空库():
    return {"版本": 1, "更新": 公共.现在全(), "下一个号": 1, "卡": []}


def 读():
    """读整库；文件不存在或坏了返回空库（绝不抛）。"""
    数据 = 公共.读json(公共.任务卡文件, None)
    if not isinstance(数据, dict):
        return _空库()
    数据.setdefault("版本", 1)
    数据.setdefault("下一个号", 1)
    卡们 = 数据.get("卡")
    if not isinstance(卡们, list):
        数据["卡"] = []
    # 补字段，保证界面不会因为缺字段崩
    for 卡 in 数据["卡"]:
        if not isinstance(卡, dict):
            continue
        卡.setdefault("标题", "")
        卡.setdefault("详情", "")
        卡.setdefault("状态", "未做")
        卡.setdefault("负责人", "")
        卡.setdefault("优先级", "")
        卡.setdefault("截止", "")
        卡.setdefault("来源", "")
        卡.setdefault("证据", [])
        卡.setdefault("创建", "")
        卡.setdefault("更新", "")
        卡.setdefault("历史", [])
        if 卡.get("状态") not in 合法状态:
            卡["状态"] = "未做"
    return 数据


def 备份(数据, 时间标签=None):
    """写前备份上一版，只留最近 30 份。备份失败不影响主流程。"""
    try:
        os.makedirs(公共.备份目录, exist_ok=True)
        标签 = 时间标签 or datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        # 同一秒内多次写：补序号，避免互相覆盖
        路径 = os.path.join(公共.备份目录, "任务卡_%s.json" % 标签)
        序号 = 1
        while os.path.exists(路径):
            路径 = os.path.join(公共.备份目录, "任务卡_%s_%d.json" % (标签, 序号))
            序号 += 1
        公共.原子写json(路径, 数据)
        旧 = sorted(glob.glob(os.path.join(公共.备份目录, "任务卡_*.json")),
                    key=os.path.getmtime, reverse=True)
        for 多余 in 旧[备份保留份数:]:
            try:
                os.remove(多余)
            except Exception:
                pass
        return 路径
    except Exception as 错:
        公共.日志("备份任务卡失败: %s" % 错, "警告")
        return ""


def _写(旧数据, 新数据):
    """原子写；先备份旧版。"""
    新数据["版本"] = 1
    新数据["更新"] = 公共.现在全()
    备份(旧数据)
    公共.原子写json(公共.任务卡文件, 新数据)
    return 新数据


def _找卡(数据, 卡id):
    for 卡 in 数据.get("卡", []):
        if 卡.get("id") == 卡id:
            return 卡
    return None


def _下一个id(数据):
    游标 = int(数据.get("下一个号") or 1)
    # 防御：即使游标被写坏，也不许撞已存在的号
    已用 = set(卡.get("id") for 卡 in 数据.get("卡", []))
    while ("T%04d" % 游标) in 已用:
        游标 += 1
    数据["下一个号"] = 游标 + 1
    return "T%04d" % 游标


def _留痕(卡, 谁, 动作):
    卡.setdefault("历史", []).append({"ts": 公共.现在秒(), "谁": 谁 or "未知", "动作": 动作})
    卡["更新"] = 公共.现在秒()


# ---------------------------------------------------------------- 对外动作

def 建卡(标题, 详情="", 负责人="", 优先级="", 截止="", 来源="", 谁="总管面板", 证据=None):
    """建一张卡，返回 (卡id, 卡对象)。标题为空也允许，但会记成"（无标题）"。"""
    标题 = (标题 or "").strip() or "（无标题）"
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        if not 新["卡"]:
            pass
        卡id = _下一个id(新)
        卡 = {
            "id": 卡id,
            "标题": 标题,
            "详情": 详情 or "",
            "状态": "未做",
            "负责人": 负责人 or "",
            "优先级": 优先级 or "",
            "截止": 截止 or "",
            "来源": 来源 or "",
            "证据": list(证据 or []),
            "创建": 公共.现在秒(),
            "更新": 公共.现在秒(),
            "历史": [{"ts": 公共.现在秒(), "谁": 谁, "动作": "建卡"}],
        }
        新["卡"].append(卡)
        _写(旧, 新)
    return 卡id, 卡


def 改状态(卡id, 到, 谁="总管面板"):
    """改状态；返回 (bool, 说明)。状态字面值非法直接拒。"""
    if 到 not in 合法状态:
        return False, "状态非法：%s（只允许 %s）" % (到, "/".join(合法状态))
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        卡 = _找卡(新, 卡id)
        if 卡 is None:
            return False, "卡不存在：%s" % 卡id
        原状态 = 卡.get("状态", "")
        if 原状态 == 到:
            return True, "状态本来就是 %s，未改动" % 到
        卡["状态"] = 到
        _留痕(卡, 谁, "状态 %s→%s" % (原状态, 到))
        _写(旧, 新)
    return True, "%s 状态 %s→%s" % (卡id, 原状态, 到)


def 换负责人(卡id, 负责人, 负责人名="", 谁="总管面板"):
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        卡 = _找卡(新, 卡id)
        if 卡 is None:
            return False, "卡不存在：%s" % 卡id
        原 = 卡.get("负责人", "")
        到 = (负责人 or "").strip()
        if 原 == 到:
            return True, "负责人本来就是 %s，未改动" % (到 or "未指派")
        卡["负责人"] = 到
        说明人 = ("%s %s" % (到, 负责人名)).strip() if 到 else "未指派"
        _留痕(卡, 谁, "负责人 %s→%s" % (原 or "未指派", 说明人))
        _写(旧, 新)
    return True, "%s 负责人改为 %s" % (卡id, 说明人)


def 加备注(卡id, 备注, 谁="总管面板"):
    备注 = (备注 or "").strip()
    if not 备注:
        return False, "备注为空"
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        卡 = _找卡(新, 卡id)
        if 卡 is None:
            return False, "卡不存在：%s" % 卡id
        原详情 = 卡.get("详情", "")
        卡["详情"] = (原详情 + "\n" + 备注).strip() if 原详情 else 备注
        _留痕(卡, 谁, "加备注（%d 字）" % len(备注))
        _写(旧, 新)
    return True, "%s 已追加备注" % 卡id


def 归档(卡id, 谁="总管面板"):
    return 改状态(卡id, "作废", 谁)


def 加证据(卡id, 路径, 谁="总管面板"):
    路径 = (路径 or "").strip()
    if not 路径:
        return False, "证据路径为空"
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        卡 = _找卡(新, 卡id)
        if 卡 is None:
            return False, "卡不存在：%s" % 卡id
        卡.setdefault("证据", [])
        if 路径 in 卡["证据"]:
            return True, "证据已存在"
        卡["证据"].append(路径)
        _留痕(卡, 谁, "加证据")
        _写(旧, 新)
    return True, "%s 已加证据" % 卡id


def 取卡(卡id, 数据=None):
    """按 id 取一张卡（副本引用，只读用途）。"""
    数据 = 数据 or 读()
    return _找卡(数据, 卡id)


def 追加来源(卡id, 标记, 谁="总管面板"):
    """把一段来源标记（如 原话#042）并进 卡.来源，已存在就不重复加。"""
    标记 = (标记 or "").strip()
    if not 标记:
        return False, "来源标记为空"
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        新 = 读()
        卡 = _找卡(新, 卡id)
        if 卡 is None:
            return False, "卡不存在：%s" % 卡id
        原 = 卡.get("来源", "") or ""
        片段 = [x.strip() for x in 原.replace("；", "|").split("|") if x.strip()]
        if 标记 in 片段:
            return True, "来源已包含 %s" % 标记
        片段.append(标记)
        卡["来源"] = " | ".join(片段)
        _留痕(卡, 谁, "来源 += %s" % 标记)
        _写(旧, 新)
    return True, "%s 来源追加 %s" % (卡id, 标记)


def 统计(数据=None):
    数据 = 数据 or 读()
    结果 = {状态: 0 for 状态 in 合法状态}
    for 卡 in 数据.get("卡", []):
        状态 = 卡.get("状态", "未做")
        if 状态 not in 结果:
            状态 = "未做"
        结果[状态] += 1
    return 结果


def 未完成数(统计值=None):
    统计值 = 统计值 or 统计()
    return 统计值.get("未做", 0) + 统计值.get("在做", 0) + 统计值.get("卡住", 0)


def 按人取任务(终身号, 数据=None):
    """某人手上还没完的卡号列表（用于 P2 员工总览）。"""
    数据 = 数据 or 读()
    结果 = []
    for 卡 in 数据.get("卡", []):
        if 卡.get("负责人") == 终身号 and 卡.get("状态") in ("未做", "在做", "卡住"):
            结果.append(卡.get("id"))
    return 结果


def 清空(谁="自测"):
    """危险：只在自测里用。备份后清空。"""
    with 公共.文件锁(公共.任务卡文件 + ".lock"):
        旧 = 读()
        备份(旧)
        公共.原子写json(公共.任务卡文件, _空库())
    return True
