# -*- coding: utf-8 -*-
"""
AI工作台 · 手册库（P5 总管手册的数据层）
------------------------------------------------------------
唯一真源＝磁盘目录 `手册\\`（`NN_标题.md`）。面板只渲染、不发明内容：
丢一个新 md 进去，三端刷新后就该出现——所以这里一律"扫目录"，绝不写死页名。

规矩（设计_v0.5 §四）：
  · 没有删除命令；要删给人手动删。
  · 写前把该页备份到 使用痕迹\\AI工作台\\备份\\手册\\（每页留 20 份）。
  · 任何写操作后往 06_变更记录.md 追加一行 `日期 | 改了什么 | 谁`。
"""
import datetime
import glob
import os
import re

import 公共

变更页名 = "06_变更记录"
条目正则 = re.compile(r"^\s*(?:[-*+]\s+|\d+[.、)]\s+)")


# ---------------------------------------------------------------- 工具

def _序号(文件名):
    匹配 = re.match(r"^(\d+)[_\-\.]", 文件名)
    return int(匹配.group(1)) if 匹配 else 999


def _标题(路径, 文件名):
    """优先取正文第一行一级标题，否则用文件名去序号。"""
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            for 行 in f:
                行 = 行.strip()
                if 行.startswith("# "):
                    return 行[2:].strip()
                if 行:
                    break
    except Exception:
        pass
    return re.sub(r"^\d+[_\-\.]\s*", "", os.path.splitext(文件名)[0])


def _条目数(路径):
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            return sum(1 for 行 in f if 条目正则.match(行))
    except Exception:
        return 0


def 解析页名(页):
    """把 `04_故障速查` / `04_故障速查.md` 解析成真实文件路径；越界一律拒绝。"""
    页 = (页 or "").strip()
    if not 页:
        return "", "缺参数：页"
    if os.sep in 页 or "/" in 页 or ".." in 页:
        return "", "页名不许带路径：%s" % 页
    目录 = 公共.手册目录
    候选 = [页] if 页.lower().endswith(".md") else [页 + ".md", 页]
    for 名 in 候选:
        路径 = os.path.join(目录, 名)
        if os.path.isfile(路径):
            return 路径, ""
    return "", "没有这一页：%s（目录 %s）" % (页, 目录)


def 相对名(路径):
    return os.path.basename(路径)


# ---------------------------------------------------------------- 读

def 目录():
    """扫目录，返回页列表（按 NN 排序）。这是"数据驱动"的根：不写死任何页名。"""
    结果 = []
    目录 = 公共.手册目录
    if not os.path.isdir(目录):
        return {"页": [], "总": 0, "目录": 目录,
                "错误": "手册目录不存在：%s" % 目录}
    for 名 in os.listdir(目录):
        if not 名.lower().endswith(".md"):
            continue
        路径 = os.path.join(目录, 名)
        if not os.path.isfile(路径):
            continue
        try:
            信息 = os.stat(路径)
        except Exception:
            continue
        结果.append({
            "文件名": 名,
            "页": os.path.splitext(名)[0],
            "序号": _序号(名),
            "标题": _标题(路径, 名),
            "条目数": _条目数(路径),
            "字节": 信息.st_size,
            "mtime": datetime.datetime.fromtimestamp(信息.st_mtime).strftime("%Y-%m-%d %H:%M"),
        })
    结果.sort(key=lambda x: (x["序号"], x["文件名"]))
    return {"页": 结果, "总": len(结果), "目录": 目录, "错误": ""}


def 读(页):
    路径, 错误 = 解析页名(页)
    if 错误:
        return None, 错误
    try:
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            正文 = f.read()
    except Exception as 错:
        return None, "读页失败: %s" % 错
    return {
        "文件名": 相对名(路径),
        "页": os.path.splitext(相对名(路径))[0],
        "标题": _标题(路径, 相对名(路径)),
        "正文": 正文,
        "行数": 正文.count("\n") + 1,
        "字节": len(正文.encode("utf-8")),
    }, ""


def 取全文(页):
    数据, 错误 = 读(页)
    return (数据 or {}).get("正文", ""), 错误


def 搜(词, 上限=50):
    """全文搜，返回 [{页, 标题, 行, 片段}]，最多 50 条。三端必须完全一致。"""
    词 = (词 or "").strip()
    if not 词:
        return None, "缺参数：词"
    命中 = []
    目标 = 词.lower()
    for 项 in 目录()["页"]:
        路径, _ = 解析页名(项["文件名"])
        if not 路径:
            continue
        try:
            with open(路径, "r", encoding="utf-8", errors="replace") as f:
                行们 = f.read().splitlines()
        except Exception:
            continue
        for 号, 行 in enumerate(行们, start=1):
            if 目标 in 行.lower():
                片段 = 行.strip()
                if len(片段) > 160:
                    片段 = 片段[:160] + "…"
                命中.append({"页": 项["页"], "标题": 项["标题"], "行": 号, "片段": 片段})
                if len(命中) >= 上限:
                    return 命中, ""
    return 命中, ""


# ---------------------------------------------------------------- 写

def _备份(路径):
    """写前备份该页；每页留最近 20 份。"""
    try:
        os.makedirs(公共.手册备份目录, exist_ok=True)
        名 = os.path.splitext(os.path.basename(路径))[0]
        标签 = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        目标 = os.path.join(公共.手册备份目录, "%s_%s.md" % (名, 标签))
        序号 = 1
        while os.path.exists(目标):
            目标 = os.path.join(公共.手册备份目录, "%s_%s_%d.md" % (名, 标签, 序号))
            序号 += 1
        with open(路径, "r", encoding="utf-8", errors="replace") as f:
            原文 = f.read()
        公共.原子写文本(目标, 原文)
        旧 = sorted(glob.glob(os.path.join(公共.手册备份目录, "%s_*.md" % 名)),
                    key=os.path.getmtime, reverse=True)
        for 多余 in 旧[20:]:
            try:
                os.remove(多余)
            except Exception:
                pass
        return 目标
    except Exception as 错:
        公共.日志("备份手册页失败：%s" % 错, "警告")
        return ""


def _记变更(改了, 谁):
    """任何写操作后往 06_变更记录.md 追加一行。"""
    try:
        os.makedirs(公共.手册目录, exist_ok=True)
        路径 = os.path.join(公共.手册目录, 变更页名 + ".md")
        新建 = not os.path.isfile(路径)
        行 = "| %s | %s | %s |\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), 改了, 谁 or "未知")
        with open(路径, "a", encoding="utf-8", newline="\n") as f:
            if 新建:
                f.write("# 06 变更记录\n\n| 时间 | 改了什么 | 谁 |\n|---|---|---|\n")
            f.write(行)
        return 路径
    except Exception as 错:
        公共.日志("写变更记录失败：%s" % 错, "警告")
        return ""


def 追加(页, 话, 谁="AI工作台"):
    话 = (话 or "").strip()
    if not 话:
        return False, "缺参数：话"
    路径, 错误 = 解析页名(页)
    if 错误:
        return False, 错误
    备份 = _备份(路径)
    行 = "- %s %s\n" % (datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), 话)
    try:
        with open(路径, "a", encoding="utf-8", newline="\n") as f:
            f.write(行)
    except Exception as 错:
        return False, "追加失败: %s" % 错
    _记变更("追加 %s：%s" % (os.path.splitext(相对名(路径))[0], 话[:40]), 谁)
    return True, "已追加到 %s（备份 %s）" % (相对名(路径), "有" if 备份 else "失败")


模板 = """# {标题}

> 新建于 {时间} ｜ 谁：{谁}

## 一、症状

- （出问题时你看到什么：报错原文 / 数字 / 谁不回话）

## 二、判据

- （怎么确认就是这个问题，而不是别的）

## 三、动作

- （第一步做什么，第二步做什么；做不了往哪升级）
"""


def 新建(标题, 谁="AI工作台"):
    标题 = (标题 or "").strip()
    if not 标题:
        return False, "缺参数：标题"
    if os.sep in 标题 or "/" in 标题 or ".." in 标题:
        return False, "标题里不许带路径分隔符"
    标题 = re.sub(r'[\\/:*?"<>|]', "_", 标题)[:40]
    os.makedirs(公共.手册目录, exist_ok=True)
    现有 = 目录()["页"]
    最大 = max([项["序号"] for 项 in 现有 if 项["序号"] != 999] or [0])
    号 = 最大 + 1
    文件名 = "%02d_%s.md" % (号, 标题)
    路径 = os.path.join(公共.手册目录, 文件名)
    if os.path.exists(路径):
        return False, "已存在同名页：%s" % 文件名
    正文 = 模板.format(标题=标题, 时间=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                      谁=谁 or "未知")
    公共.原子写文本(路径, 正文)
    _记变更("新建 %s" % 文件名, 谁)
    return True, "已新建 %s" % 文件名
