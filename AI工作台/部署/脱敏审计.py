# -*- coding: utf-8 -*-
"""
总管面板 · 脱敏审计
------------------------------------------------------------
干什么：把项目里「不该进公网仓库」的东西先找出来。
        被 deploy_github.py 在上传前强制调用，不 CLEAN 就不许上传。

用法：
    python 部署\\脱敏审计.py            # 审「将要上传的文件」（默认；这就是上传闸门）
    python 部署\\脱敏审计.py --全目录    # 全目录体检（含内部作战文档，只作参考）
    python 部署\\脱敏审计.py --json     # 给部署脚本读（机器格式）
    python 部署\\脱敏审计.py --路径 xxx  # 只审某个子目录/单文件

退出码：0 = CLEAN，1 = DIRTY，2 = 参数/环境错误
输出末尾固定一行：RESULT=CLEAN 或 RESULT=DIRTY

两种范围，别搞混：
    默认（上传闸门）＝ 只审「真会进仓库的那批文件」，内部作战文档不在其中，
                       所以正常情况应为 CLEAN；不是 CLEAN 就是真出事，必须修。
    --全目录       ＝ 连设计稿、员工名册、自测报告一起查，用来做定期体检；
                       内部文档里本来就有真值，DIRTY 属正常，只作参考、不拦上传。

查什么：
    1. 10 位数字实例号（一串连着的十位数字）
    2. sess_ 开头的会话 id
    3. 4 位终身号出现在非示例上下文（四位号@实例号 这种写法）
    4. 本机绝对路径（使用痕迹 / 网络硬盘 / Python310 / C 盘 Users）
    5. 邮箱、手机号
    6. token= / api_key= / secret= 后面跟着长度 >= 16 的真值
    7. 真实员工会话名（只许写「0043 任务负责人」这类抽象写法）

豁免：
    · 示例\\ 、示例数据\\ 目录下的 *.example.json —— 只查令牌类
    · README.md 里的 D:\\<痕迹根>\\总管面板\\ —— 设计约定的固定落点，放行
    · 审计器自身不审自己（它本来就装着一堆匹配式）
"""
import argparse
import json
import os
import re
import sys

程序根 = os.path.dirname(os.path.abspath(__file__))
项目根 = os.path.dirname(程序根)

# ------------------------------------------------------------------ 扫描范围
扫描扩展 = {".py", ".pyw", ".html", ".htm", ".css", ".js", ".md",
            ".json", ".txt", ".ini", ".yaml", ".yml"}
跳过目录 = {"__pycache__", ".git", ".idea", ".vscode", "node_modules", "日志", "备份"}
跳过文件 = {
    "状态.json", "任务卡.json", "原话备注.json", "员工名册.json",
    "动作队列.jsonl", "动作结果.jsonl", "配置.json", "遥控令牌.txt",
}
跳过前缀 = ("_tmp_",)
跳过后缀 = (".log", ".tmp", ".pyc")

单文件上限 = 2 * 1024 * 1024  # 单文件 2MB 以上不看（不是源码）
单文件命中上限 = 80            # 一个文件最多报 80 条，防刷屏

# 内部作战文档：设计稿里写着实例号/真名/本机路径，本来就不给外面看。
# 这批不进仓库，也不参与「能不能上传」的判定（全目录体检时仍会点名）。
内部文档前缀 = ("设计_v", "员工名册", "自测报告", "验收", "回执")

# 整目录都不进仓库的内部资料（总管作业手册：含本机痕迹路径与内部排查手法）
内部文档目录 = ("手册",)

# 没有扩展名、扫描器抓不到，但要跟代码一起进仓库的固定文件
固定附带 = (".gitignore", "LICENSE", "部署" + os.sep + "脱敏审计.py")

# ------------------------------------------------------------------ 匹配式
# 注意：下面凡是「本机路径」的字面量，一律用片段拼接/双反斜杠写，
#       否则审计器扫描自己时会自己命中自己。
_痕迹 = "使用" + "痕迹"
_网盘 = "网络" + "硬盘"
_py = "Python" + "310"
_盘符 = "cdef"

规则表 = [
    ("实例号", re.compile(r"(?<!\d)\d{10}(?!\d)"), "10 位数字实例号"),
    ("会话ID", re.compile(r"sess_[0-9A-Za-z]{4,}"), "sess_ 会话 id"),
    ("终身号", re.compile(r"(?<!\d)\d{4}@\d{4,}"), "4 位终身号@实例号"),
    ("本机路径", re.compile(
        r"[%s]:(?:\\|/)(?:%s|%s|%s|Users)" % (_盘符, _痕迹, _网盘, _py),
        re.IGNORECASE), "本机绝对路径"),
    ("邮箱", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "邮箱地址"),
    ("手机号", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "手机号"),
    ("令牌", re.compile(
        r"(?:token|api_key|apikey|secret|password|令牌)\s*[=:：]\s*[\"']?([A-Za-z0-9_\-\.]{16,})",
        re.IGNORECASE), "疑似真令牌"),
    # 频道号＝凭据，只许活在 配置.json（不进仓库）。字面量拆开写，免得审到自己。
    ("频道号", re.compile("fox" + "ai" + "job" + "|" + "31415926" + "fF",
                     re.IGNORECASE), "频道号/凭据"),
    ("员工名", re.compile("|".join([
        "任务面板" + "负责人", "宿舍TRAE" + "总负责", "邮箱" + "负责人", "广播" + "专员",
        "青" + "云", "初" + "瑶", "白" + "芷", "明" + "烛", "青" + "梧",
    ])), "真实员工/会话名"),
]
仅令牌规则 = {"令牌"}


# ------------------------------------------------------------------ 工具

def _相对(路径):
    try:
        return os.path.relpath(路径, 项目根)
    except ValueError:
        return 路径  # 跨盘（例如审 C:\Temp 里的发布目录）就显示绝对路径


def _应跳过(文件名):
    if 文件名 in 跳过文件:
        return True
    if 文件名.startswith(跳过前缀):
        return True
    if 文件名.lower().endswith(跳过后缀):
        return True
    if 文件名 == os.path.basename(__file__):
        return True  # 审计器自身
    return False


def 是示例文件(相对路径):
    """示例\\ / 示例数据\\ 下的 *.example.json → 只查令牌类。"""
    if not 相对路径.lower().endswith(".example.json"):
        return False
    return any(p in ("示例", "示例数据") for p in 相对路径.split(os.sep))


def 是已知可接受(相对路径, 规则名, 片段, 整行):
    """README 里的固定落点 D:\\<痕迹根>\\总管面板\\ 允许出现。"""
    p = 相对路径.replace("\\", "/").lower()
    if not (p == "readme.md" or p.endswith("/readme.md")):
        return False
    if 规则名 != "本机路径":
        return False
    return (_痕迹 in 片段) and ("总管面板" in 整行)


def 是内部文档(文件名):
    """内部作战文档（设计稿 / 名册说明 / 自测报告 / 验收 / 回执）→ 不进仓库。"""
    名 = 文件名.lstrip("_- 、. ")
    if 名.startswith(内部文档前缀):
        return True
    return ("验收" in 名) or ("回执" in 名)


def 收集文件(起点=None, 仅待上传=False):
    """返回 [(绝对路径, 相对路径)]，已按跳过规则过滤。

    仅待上传=True：只留「真要推到仓库」的文件 —— 内部文档排除在外，
                   并补上 .gitignore / LICENSE / 审计器自己（没扩展名扫不到）。
    """
    起点 = 起点 or 项目根
    if os.path.isfile(起点):
        return [(起点, _相对(起点))]
    结果 = []
    for 目录, 子目录们, 文件们 in os.walk(起点):
        子目录们[:] = [d for d in 子目录们
                       if d not in 跳过目录 and not d.startswith(跳过前缀)
                       and not (仅待上传 and d in 内部文档目录)]
        for 名 in 文件们:
            if _应跳过(名):
                continue
            if 仅待上传 and 是内部文档(名):
                continue
            if os.path.splitext(名)[1].lower() not in 扫描扩展:
                continue
            全 = os.path.join(目录, 名)
            try:
                if os.path.getsize(全) > 单文件上限:
                    continue
            except OSError:
                continue
            结果.append((全, _相对(全)))
    if 仅待上传:
        已有 = set(相 for _全, 相 in 结果)
        for 相 in 固定附带:
            全 = os.path.join(项目根, 相)
            if 相 not in 已有 and os.path.exists(全):
                结果.append((全, 相))
    结果.sort(key=lambda x: x[1])
    return 结果


def 列内部文档():
    """全目录里那些「被排除、不进仓库」的内部文档相对路径。"""
    结果 = []
    for 目录, 子目录们, 文件们 in os.walk(项目根):
        子目录们[:] = [d for d in 子目录们
                       if d not in 跳过目录 and not d.startswith(跳过前缀)]
        在内部目录 = any(p in 内部文档目录 for p in 目录.split(os.sep))
        for 名 in 文件们:
            if 在内部目录 or 是内部文档(名):
                结果.append(os.path.relpath(os.path.join(目录, 名), 项目根))
    结果.sort()
    return 结果


def 审计(起点=None, 仅待上传=False):
    """返回 {"结果": "CLEAN"/"DIRTY", "命中": [...], "扫描文件数": N}"""
    命中 = []
    文件们 = 收集文件(起点, 仅待上传=仅待上传)
    for 全, 相 in 文件们:
        只查令牌 = 是示例文件(相)
        try:
            with open(全, "r", encoding="utf-8", errors="replace") as f:
                行们 = f.readlines()
        except OSError as e:
            命中.append({"文件": 相, "行": 0, "规则": "读取失败", "片段": str(e)})
            continue
        本文件命中 = 0
        for 号, 行 in enumerate(行们, 1):
            if 本文件命中 >= 单文件命中上限:
                break
            for 规则名, 正则, _说明 in 规则表:
                if 只查令牌 and 规则名 not in 仅令牌规则:
                    continue
                for m in 正则.finditer(行):
                    片段 = m.group(0).strip()
                    if not 片段:
                        continue
                    if 是已知可接受(相, 规则名, 片段, 行):
                        continue
                    命中.append({
                        "文件": 相, "行": 号, "规则": 规则名,
                        "片段": 片段[:120],
                    })
                    本文件命中 += 1
                    if 本文件命中 >= 单文件命中上限:
                        break
                if 本文件命中 >= 单文件命中上限:
                    break
    结果 = "DIRTY" if 命中 else "CLEAN"
    return {"结果": 结果, "命中": 命中, "扫描文件数": len(文件们)}


# ------------------------------------------------------------------ 入口

def main(argv=None):
    ap = argparse.ArgumentParser(description="总管面板 · 脱敏审计")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    ap.add_argument("--路径", default="", help="只审这个文件/目录（默认整个项目根）")
    ap.add_argument("--仅待上传", action="store_true",
                    help="只审「将要推到仓库」的文件（现在就是默认行为，留着兼容）")
    ap.add_argument("--全目录", action="store_true",
                    help="全目录体检（连内部作战文档一起查，只作参考，不拦上传）")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    参数 = ap.parse_args(argv)

    起点 = 参数.路径 or None
    if 起点 and not os.path.exists(起点):
        print("路径不存在：%s" % 起点, file=sys.stderr)
        return 2

    仅待上传 = (not 参数.全目录) and (not 起点)   # 默认就是上传闸门口径
    r = 审计(起点, 仅待上传=仅待上传)
    内部 = 列内部文档() if 仅待上传 else []
    全目录 = 审计() if 仅待上传 else None
    r["已排除内部文档"] = 内部
    if 全目录 is not None:
        r["全目录参考"] = {"结果": 全目录["结果"], "命中数": len(全目录["命中"])}

    if 参数.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0 if r["结果"] == "CLEAN" else 1

    print("=" * 62)
    print("总管面板 · 脱敏审计")
    print("项目根：%s" % (起点 or 项目根))
    print("模式：%s" % ("仅待上传（仓库口径）" if 仅待上传 else "全目录体检"))
    print("扫描文件：%d 个" % r["扫描文件数"])
    print("=" * 62)
    if r["结果"] == "CLEAN":
        print("没有发现需要脱敏的内容。")
    else:
        按文件 = {}
        for h in r["命中"]:
            按文件.setdefault(h["文件"], []).append(h)
        for 文件 in sorted(按文件):
            print("\n%s  （%d 处）" % (文件, len(按文件[文件])))
            for h in 按文件[文件]:
                print("  %s:%d  [%s] %s" % (文件, h["行"], h["规则"], h["片段"]))
        print("\n共 %d 处命中，涉及 %d 个文件。" % (len(r["命中"]), len(按文件)))
        print("处理办法：真值请挪到 配置.json / 状态.json（这些不进仓库），"
              "或改写成示例值。")
    if 内部:
        print("\n已排除 %d 个内部文档（不进仓库）：" % len(内部))
        for 相 in 内部:
            print("  - %s" % 相)
    if 全目录 is not None:
        print("\n全目录体检查询（仅参考，不参与判定）：%s，%d 处命中"
              % (全目录["结果"], len(全目录["命中"])))
        if 全目录["结果"] != "CLEAN":
            print("  这些命中都落在内部文档里，已排除；要清掉就跑全目录模式看明细。")
    print("\nRESULT=%s" % r["结果"])
    return 0 if r["结果"] == "CLEAN" else 1


if __name__ == "__main__":
    sys.exit(main())
