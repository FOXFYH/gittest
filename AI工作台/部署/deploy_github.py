# -*- coding: utf-8 -*-
"""
总管面板 · 一键推 GitHub + 开 Pages
------------------------------------------------------------
不依赖 git，也不依赖 gh CLI —— 全程走 GitHub REST API（标准库 urllib）。

准备：
    1. 去 GitHub 生成个人访问令牌（勾 repo 权限），见 部署\\推送指南.md
    2. PowerShell:  $env:GH_TOKEN = "ghp_xxxx"

用法：
    python 部署\\deploy_github.py --试运行                 # 只校验令牌 + 列出要上传的文件
    python 部署\\deploy_github.py --账号 你的用户名         # 真建仓并上传（默认私有）
    python 部署\\deploy_github.py --账号 你的用户名 --公开   # 建公开仓库
    python 部署\\deploy_github.py --仓库 总管面板 --账号 xxx

顺序（每步都打中文进度）：
    1. GET /user 验证令牌
    2. POST /user/repos 建仓（auto_init=false）
    3. 先跑 脱敏审计.py，CLEAN 才允许上传；再逐个 PUT contents
    4. POST /pages 开 Pages（409 说明已开 → 改 PUT 更新）
    5. 打印最终网址

铁律：任何一步失败，打印 HTTP 状态码 + 返回体原文（截 500 字），不吞异常。
"""
import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

程序根 = os.path.dirname(os.path.abspath(__file__))
项目根 = os.path.dirname(程序根)
审计脚本 = os.path.join(程序根, "脱敏审计.py")
网页目录 = "网页端源文件"
API = "https://api.github.com"
UA = "zongguan-panel-deploy/1.0"
超时秒 = 45

sys.path.insert(0, 程序根)
try:
    import 脱敏审计  # 复用同一套「哪些文件能上传」规则
except Exception:  # pragma: no cover
    脱敏审计 = None


class 部署失败(Exception):
    def __init__(self, 步骤, 码, 体):
        self.步骤 = 步骤
        self.码 = 码
        self.体 = 体 or ""
        super(部署失败, self).__init__("%s 失败：HTTP %s" % (步骤, 码))


# ------------------------------------------------------------------ 输出

def 标题(序号, 总数, 文字):
    print("\n[%d/%d] %s" % (序号, 总数, 文字))


def 好(文字):
    print("      ✓ %s" % 文字)


def 提示(文字):
    print("      · %s" % 文字)


def 警告(文字):
    print("      ⚠ %s" % 文字)


# ------------------------------------------------------------------ HTTP

def 请求(方法, 路径, 数据=None, 允许=(), 令牌="", 步骤="请求"):
    地址 = 路径 if 路径.startswith("http") else API + 路径
    体 = None if 数据 is None else json.dumps(数据, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(地址, data=体, method=方法)
    req.add_header("User-Agent", UA)          # 缺这个 GitHub 直接 403
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if 令牌:
        req.add_header("Authorization", "Bearer " + 令牌)
    if 体 is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=超时秒) as 回应:
            原文 = 回应.read().decode("utf-8", "replace")
            码 = 回应.status
    except urllib.error.HTTPError as e:
        原文 = e.read().decode("utf-8", "replace")
        if e.code in 允许:
            return e.code, _尝试解析(原文), 原文
        raise 部署失败(步骤, e.code, 原文)
    except urllib.error.URLError as e:
        raise 部署失败(步骤, "网络错误", str(e.reason))
    except Exception as e:  # 超时等
        raise 部署失败(步骤, "异常", "%s: %s" % (type(e).__name__, e))
    return 码, _尝试解析(原文), 原文


def _尝试解析(原文):
    try:
        return json.loads(原文) if 原文.strip() else {}
    except Exception:
        return {}


def 内容地址(owner, repo, 路径, 分支):
    return "/repos/%s/%s/contents/%s?ref=%s" % (
        urllib.parse.quote(owner, safe=""),
        urllib.parse.quote(repo, safe=""),
        urllib.parse.quote(路径.replace(os.sep, "/"), safe="/"),
        urllib.parse.quote(分支, safe=""),
    )


# ------------------------------------------------------------------ 文件清单

def 收集上传文件():
    if 脱敏审计 is None:
        raise 部署失败("收集文件", "-", "无法导入 脱敏审计.py，请确认它在 部署\\ 目录下")
    # 与审计器共用同一套规则：内部文档排除，.gitignore / LICENSE / 审计器自己补上
    return 脱敏审计.收集文件(仅待上传=True)


def 被排除的内部文档():
    if 脱敏审计 is None:
        return []
    try:
        return 脱敏审计.列内部文档()
    except Exception:
        return []


def 跑脱敏审计():
    """真跑一次 脱敏审计.py（子进程），只审「将要上传」的文件。"""
    if not os.path.exists(审计脚本):
        raise 部署失败("脱敏审计", "-", "找不到 %s" % 审计脚本)
    try:
        完成 = subprocess.run(
            [sys.executable, 审计脚本, "--json", "--仅待上传"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=180,
        )
    except Exception as e:
        raise 部署失败("脱敏审计", "启动失败", "%s: %s" % (type(e).__name__, e))
    原文 = 完成.stdout.decode("utf-8", "replace")
    try:
        结果 = json.loads(原文)
    except Exception:
        结果 = {"结果": "ERROR", "命中": [], "扫描文件数": 0}
        提示("审计器输出无法解析，按 DIRTY 处理")
    return 结果.get("结果", "ERROR"), 结果.get("命中", []), 原文


# ------------------------------------------------------------------ 主流程

def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    ap = argparse.ArgumentParser(description="总管面板 · 一键推 GitHub + 开 Pages")
    ap.add_argument("--仓库", default="zongguan-panel", help="仓库名（默认 zongguan-panel）")
    ap.add_argument("--账号", default="", help="GitHub 用户名；省略则用令牌对应的登录名")
    ap.add_argument("--公开", action="store_true", help="建公开仓库（默认私有）")
    ap.add_argument("--试运行", action="store_true", help="只校验令牌 + 列文件，不建仓不上传")
    ap.add_argument("--分支", default="", help="覆盖默认分支名（一般不用给）")
    参数 = ap.parse_args(argv)

    令牌 = os.environ.get("GH_TOKEN", "").strip()

    print("=" * 62)
    print("总管面板 · 一键推 GitHub + 开 Pages")
    print("项目根：%s" % 项目根)
    print("仓库名：%s（%s）" % (参数.仓库, "公开" if 参数.公开 else "私有"))
    if 参数.试运行:
        print("模式：试运行（不建仓、不上传）")
    print("=" * 62)

    try:
        # ---------------- 步骤 1：验证令牌
        标题(1, 5, "验证令牌（GET /user）")
        if not 令牌:
            if 参数.试运行:
                警告("未设置环境变量 GH_TOKEN —— 试运行跳过校验")
                登录名 = 参数.账号 or "(未校验)"
            else:
                raise 部署失败(
                    "验证令牌", "-",
                    "没有 GH_TOKEN。PowerShell 里先执行： $env:GH_TOKEN = \"ghp_xxxx\"")
        else:
            好("已读到 GH_TOKEN（长度 %d）" % len(令牌))
            _, 用户, _ = 请求("GET", "/user", 令牌=令牌, 步骤="验证令牌")
            登录名 = 用户.get("login") or ""
            if not 登录名:
                raise 部署失败("验证令牌", 200, "返回体里没有 login 字段")
            好("令牌有效，登录名：%s" % 登录名)
            if 用户.get("name"):
                提示("显示名：%s" % 用户["name"])

        owner = 参数.账号 or 登录名
        if not owner:
            raise 部署失败("验证令牌", "-", "拿不到账号名，请用 --账号 指定")

        # ---------------- 步骤 2：建仓
        仓库 = 参数.仓库
        if not 仓库.isascii():
            警告("仓库名含非 ASCII 字符，Pages 网址会很难看，建议改成英文")

        if 参数.试运行:
            标题(2, 5, "建仓（试运行跳过）")
            提示("将会创建：%s/%s  private=%s  auto_init=false"
                 % (owner, 仓库, "false" if 参数.公开 else "true"))
            分支 = 参数.分支 or "main"
        else:
            标题(2, 5, "建仓（POST /user/repos）")
            码, 资料, _ = 请求(
                "POST", "/user/repos",
                数据={
                    "name": 仓库,
                    "private": not 参数.公开,
                    "auto_init": False,
                    "description": "总管面板 · TRAE 健康 / 员工 / 任务卡 / 人类原话",
                    "has_issues": False,
                    "has_wiki": False,
                },
                允许=(422,), 令牌=令牌, 步骤="建仓")
            if 码 == 422:
                警告("仓库已存在或参数被拒（%s），按「已存在」继续上传" % 仓库)
                码2, 资料, _ = 请求(
                    "GET", "/repos/%s/%s" % (urllib.parse.quote(owner, safe=""),
                                             urllib.parse.quote(仓库, safe="")),
                    允许=(404,), 令牌=令牌, 步骤="读取仓库")
                if 码2 != 200:
                    raise 部署失败("建仓", 404, "仓库既建不出来也读不到：%s/%s" % (owner, 仓库))
            好("仓库就绪：%s/%s" % (owner, 仓库))
            分支 = 参数.分支 or 资料.get("default_branch") or "main"
            好("默认分支：%s" % 分支)

        # ---------------- 步骤 3：脱敏审计 + 上传
        标题(3, 5, "脱敏审计 + 上传源码（PUT contents）")
        文件们 = 收集上传文件()
        总字节 = 0
        for 全, _相 in 文件们:
            try:
                总字节 += os.path.getsize(全)
            except OSError:
                pass
        提示("待上传 %d 个文件，合计 %.1f KB" % (len(文件们), 总字节 / 1024.0))
        排除 = 被排除的内部文档()
        if 排除:
            print("      · 已排除 %d 个内部文档（内部作战资料，不进仓库）：" % len(排除))
            for 相 in 排除:
                print("        - %s" % 相)

        if 参数.试运行:
            for 全, 相 in 文件们:
                print("        · %-52s %7d B" % (相, os.path.getsize(全)))
            提示("试运行到此为止；脱敏审计请单独跑： python 部署\\脱敏审计.py --仅待上传")
            print("\n" + "=" * 62)
            print("试运行完成：%d 个文件待上传（未真正上传），"
                  "已排除 %d 个内部文档" % (len(文件们), len(排除)))
            return 0

        结果, 命中, _ = 跑脱敏审计()
        if 结果 != "CLEAN":
            警告("脱敏审计结果 = %s，拒绝上传" % 结果)
            if 命中:
                print("      命中清单（共 %d 处）：" % len(命中))
                for h in 命中[:60]:
                    print("        %s:%s  [%s] %s"
                          % (h.get("文件"), h.get("行"), h.get("规则"), h.get("片段")))
                if len(命中) > 60:
                    print("        …… 还有 %d 处，完整清单跑： python 部署\\脱敏审计.py"
                          % (len(命中) - 60))
            raise 部署失败("脱敏审计", "DIRTY",
                           "先把上列真值挪进 配置.json / 状态.json（这两个不进仓库），再重跑")
        好("脱敏审计 CLEAN，允许上传")

        if not 文件们:
            raise 部署失败("上传", "-", "项目根下没有可上传的源码文件")

        首次 = True
        失败数 = 0
        for i, (全, 相) in enumerate(文件们, 1):
            仓库路径 = 相.replace(os.sep, "/")
            try:
                with open(全, "rb") as f:
                    原始 = f.read()
            except OSError as e:
                警告("%s 读不出来，跳过（%s）" % (相, e))
                失败数 += 1
                continue

            sha = ""
            if not 首次:
                sha码, sha资料, _ = 请求(
                    "GET", 内容地址(owner, 仓库, 仓库路径, 分支),
                    允许=(404,), 令牌=令牌, 步骤="查询已有文件")
                if sha码 == 200:
                    sha = sha资料.get("sha", "")

            体 = {
                "message": ("新增 %s" if not sha else "更新 %s") % 仓库路径,
                "content": base64.b64encode(原始).decode("ascii"),
            }
            if sha:
                体["sha"] = sha
            if not 首次:
                体["branch"] = 分支   # 空仓库第一次不能带 branch，否则 422

            try:
                _, _, _ = 请求("PUT", "/repos/%s/%s/contents/%s" % (
                    urllib.parse.quote(owner, safe=""),
                    urllib.parse.quote(仓库, safe=""),
                    urllib.parse.quote(仓库路径, safe="/")),
                    数据=体, 令牌=令牌, 步骤="上传 " + 仓库路径)
            except 部署失败 as e:
                print("      ✗ %s 上传失败：HTTP %s" % (仓库路径, e.码))
                print("        %s" % e.体[:500])
                失败数 += 1
                if e.码 in (401, 403):
                    raise
                continue
            首次 = False
            print("      [%d/%d] %s  (%d B)" % (i, len(文件们), 仓库路径, len(原始)))

        if 失败数:
            警告("%d 个文件没传上去，看上面每个文件的报错" % 失败数)
        else:
            好("全部 %d 个文件上传完成" % len(文件们))

        # ---------------- 步骤 4：开 Pages
        标题(4, 5, "开 Pages（POST /pages）")
        Pages体 = {"source": {"branch": 分支, "path": "/" + 网页目录}}
        网页文件 = [相.replace(os.sep, "/") for _全, 相 in 文件们
                if 相.replace(os.sep, "/").startswith(网页目录 + "/")]
        有首页 = any(名.lower() == (网页目录 + "/index.html").lower() for 名 in 网页文件)
        Pages状态 = "未开启"
        if not 网页文件:
            警告("仓库里没有 %s/ 目录（一个文件都没有）" % 网页目录)
            警告("Pages 这步直接跳过 —— 不建空 Pages，也不报「成功」")
            警告("等网页写进 %s\\ 之后再重跑本脚本" % 网页目录)
            Pages状态 = "跳过（缺网页）"
        else:
            提示("%s/ 里有 %d 个文件" % (网页目录, len(网页文件)))
            if not 有首页:
                警告("%s/ 里没有 index.html —— Pages 打开会是 404，"
                     "要网页作者补一个 index.html" % 网页目录)
            try:
                码, 资料, 原文 = 请求(
                    "POST", "/repos/%s/%s/pages" % (urllib.parse.quote(owner, safe=""),
                                                    urllib.parse.quote(仓库, safe="")),
                    数据=Pages体, 允许=(409, 422, 404), 令牌=令牌, 步骤="开 Pages")
                if 码 == 201:
                    好("Pages 已开启：branch=%s  path=/%s" % (分支, 网页目录))
                    Pages状态 = "已开启"
                elif 码 == 409:
                    提示("Pages 早就开着（409），改成 PUT 更新来源")
                    _, _, _ = 请求(
                        "PUT", "/repos/%s/%s/pages" % (urllib.parse.quote(owner, safe=""),
                                                       urllib.parse.quote(仓库, safe="")),
                        数据=Pages体, 令牌=令牌, 步骤="更新 Pages")
                    好("Pages 来源已更新")
                    Pages状态 = "已开启"
                else:
                    警告("Pages 没开起来（HTTP %s）：%s" % (码, (原文 or "")[:300]))
                    警告("把 %s/ 提交进仓库后，重跑本脚本即可" % 网页目录)
                    Pages状态 = "待补"
            except 部署失败 as e:
                警告("Pages 没开起来（HTTP %s）：%s" % (e.码, e.体[:300]))
                警告("这不影响代码已上传；把 %s/ 补进仓库后重跑本脚本" % 网页目录)
                Pages状态 = "待补"

        # ---------------- 步骤 5：收尾
        标题(5, 5, "完成")
        网址 = "https://%s.github.io/%s/" % (owner, 仓库)
        print("      仓库：https://github.com/%s/%s" % (owner, 仓库))
        print("      网页：%s" % 网址)
        if Pages状态 == "已开启":
            提示("Pages 首次生效要 1~3 分钟（之后改内容约 1 分钟），打不开先等再刷")
            提示("在仓库 Settings → Pages 能看到构建状态；构建失败会在那里报红")
        else:
            提示("Pages 还没生效，网址暂时打不开")
        if 失败数:
            print("\n结果：代码已传、但有 %d 个文件失败；Pages=%s" % (失败数, Pages状态))
        else:
            print("\n结果：代码全部上传；Pages=%s" % Pages状态)
        return 0 if 失败数 == 0 else 1

    except 部署失败 as e:
        print("\n✗ %s 失败" % e.步骤)
        print("  HTTP 状态码：%s" % e.码)
        print("  返回体：%s" % (e.体[:500] if e.体 else "(空)"))
        print("\n排错：看 部署\\推送指南.md 第 ⑥ 节；令牌权限不够（403）就重新生成勾 repo")
        return 1


if __name__ == "__main__":
    sys.exit(main())
