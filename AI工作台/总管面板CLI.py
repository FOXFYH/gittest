# -*- coding: utf-8 -*-
"""
总管面板 · 控制台壳（CLI）
------------------------------------------------------------
壳只负责"叫"：解析参数 → 核心.执行() → 打印。业务逻辑一行都不许写在这里。

用法：
  总管面板CLI.py 系统.版本
  总管面板CLI.py 任务.建卡 标题="补齐下拉菜单" 负责人=0043 --json
  总管面板CLI.py 原话.列表 日=2026-10-25
  总管面板CLI.py 系统.对齐自检            # 退出码 0=全通 / 2=有不齐
  总管面板CLI.py --列表                    # 打印功能全集
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import 核心  # noqa: E402


def _洗值(文本):
    文本 = 文本.strip()
    if len(文本) >= 2 and 文本[0] == 文本[-1] and 文本[0] in ("'", '"'):
        return 文本[1:-1]
    return 文本


def 解析(argv):
    命令 = ""
    参数 = {}
    dry = False
    来源 = "CLI"
    输出JSON = False
    列表 = False
    for 项 in argv:
        if 项 in ("--json",):
            输出JSON = True
        elif 项 in ("--dry", "--预检"):
            dry = True
        elif 项 in ("--列表", "--list", "-l"):
            列表 = True
        elif 项.startswith("--来源="):
            来源 = 项.split("=", 1)[1] or "CLI"
        elif 项.startswith("--from="):
            来源 = 项.split("=", 1)[1] or "CLI"
        elif "=" in 项 and not 项.startswith("-"):
            键, 值 = 项.split("=", 1)
            参数[键.strip()] = _洗值(值)
        elif not 项.startswith("-") and not 命令:
            命令 = 项.strip()
    return 命令, 参数, dry, 来源, 输出JSON, 列表


def 打印人话(结果):
    命令 = 结果.get("命令", "")
    头 = "[OK]" if 结果.get("ok") else "[FAIL]"
    print("%s %s（%s，%d ms）" % (头, 命令 or "?", 结果.get("来源", ""), 结果.get("耗时ms", 0)))
    if 结果.get("说明"):
        print("  说明：%s" % 结果["说明"])
    数据 = 结果.get("数据")

    if isinstance(数据, dict):
        if "表" in 数据 and "RESULT" in 数据:
            print("  %-16s %-4s %-4s %-4s %-4s %s" % ("命令", "实现", "CLI", "Tk", "网页", "读写"))
            叉 = 0
            for 行 in 数据["表"]:
                def 符(值):
                    return "OK" if 值 else "--"
                if not (行["CLI"] and 行["Tk"] and 行["网页"]):
                    叉 += 1
                print("  %-16s %-4s %-4s %-4s %-4s %s" %
                      (行["命令"], 符(行["实现"]), 符(行["CLI"]), 符(行["Tk"]),
                       符(行["网页"]), 行["读写"]))
            print("  %d 条命令，%d 条不齐；网页探测方式：%s"
                  % (len(数据["表"]), 叉, 数据.get("网页探测方式", "")))
            for 缺 in 数据.get("缺", []):
                print("  · %s" % 缺)
            print("  %s" % 数据.get("RESULT"))
            return
        if "项" in 数据 and "RESULT" in 数据:
            for 项 in 数据["项"]:
                print("  %-4s %-12s %s" % ("OK" if 项["ok"] else "--", 项["项"], 项["说明"]))
            print("  %s" % 数据["RESULT"])
            return
        if "员工" in 数据:
            print("  共 %d 人" % 数据.get("条数", len(数据["员工"])))
            for 人 in 数据["员工"][:20]:
                print("  %-6s %-14s %s  %-8s 距今%-6s 今日%s条" % (
                    人.get("终身号") or "-", 人.get("会话名", ""), 人.get("灯", ""),
                    人.get("最后活动", ""), 人.get("距今秒", ""), 人.get("今日消息数", 0)))
            if len(数据["员工"]) > 20:
                print("  …（省略 %d 人）" % (len(数据["员工"]) - 20))
            return
        if "卡" in 数据 and isinstance(数据["卡"], list):
            print("  共 %d 张卡  统计=%s" % (len(数据["卡"]), 数据.get("统计", {})))
            for 卡 in 数据["卡"][:20]:
                print("  %-6s [%s] %s  负责：%s %s" % (
                    卡.get("id"), 卡.get("状态"), 卡.get("标题", "")[:24],
                    卡.get("负责人") or "未指派", 卡.get("负责人名", "")))
            return
        if "条" in 数据 and isinstance(数据["条"], list):
            统计 = 数据.get("统计", {})
            print("  %s  共 %d 条  已派 %s / 未派 %s / 已验收 %s / 覆盖率 %s%%" % (
                数据.get("日"), len(数据["条"]), 统计.get("已派"), 统计.get("未派"),
                统计.get("已验收"), 统计.get("覆盖率")))
            for 条 in 数据["条"][:10]:
                print("  %s %s %s 灯=%s 卡=%s" % (
                    条.get("序号"), 条.get("时刻"), 条.get("摘要", "")[:28],
                    条.get("灯"), ",".join(条.get("关联卡", [])) or "无"))
            return
        if "行" in 数据:
            for 行 in 数据["行"]:
                print("  %s" % 行)
            return
    print("  %s" % json.dumps(数据, ensure_ascii=False)[:400])


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help", "帮助"):
        print(__doc__)
        print("功能全集：")
        for 项 in 核心.命令清单():
            print("  %-14s %-3s %-4s %s" % (项["命令"], 项["页"], 项["读写"], 项["说明"]))
        return 0

    命令, 参数, dry, 来源, 输出JSON, 列表 = 解析(argv)
    if 列表:
        for 项 in 核心.命令清单():
            print("%s\t%s\t%s\t%s" % (项["命令"], 项["页"], 项["读写"], 项["说明"]))
        return 0
    if not 命令:
        print("缺命令名。例：总管面板CLI.py 系统.版本", file=sys.stderr)
        return 2

    if dry:
        结果 = 核心.预检(命令, 参数)
        结果["来源"] = 来源
    else:
        结果 = 核心.执行(命令, 参数, 来源)

    if 输出JSON:
        print(json.dumps(结果, ensure_ascii=False))
    else:
        打印人话(结果)

    数据 = 结果.get("数据") or {}
    if isinstance(数据, dict) and 数据.get("RESULT") == "FAIL":
        return 2
    return 0 if 结果.get("ok") else 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        sys.exit(0)
