# -*- coding: utf-8 -*-
"""AI工作台 · 标签库（P2·2026-10-31）
三层标签：项目(PJ) / 模块(MD) / 动作(AC)。只写自己的 标签库.json，不往 任务卡.json 塞标签定义。
卡上只存 id；名字改了不影响卡。
"""
import os

import 公共
import 任务卡库

层级们 = ("项目", "模块", "动作")
前缀 = {"项目": "PJ", "模块": "MD", "动作": "AC"}
预设动作 = ["Bug修复", "新增功能", "功能优化", "重大重构", "专项整改",
            "功能测试", "功能验收", "需求梳理", "文档补充"]
版本 = "1.0"


def 路径():
    """当前生效空间的 标签库.json（线程局部优先；切账号/端点后自动跟随，P1-B-1）。"""
    return os.path.join(公共.取路径("数据目录"), "标签库.json")


def _文件():
    """路径() 的别名：给函数内被形参「路径」遮住的地方用。"""
    return 路径()


def _空库():
    return {"版本": 版本, "账号": "", "端点": "", "更新": 公共.现在全(),
            "下一个号": {"项目": 1, "模块": 1, "动作": 1},
            "项目": [], "模块": [], "动作": []}


def 读():
    数据 = 公共.读json(路径(), None)
    if not isinstance(数据, dict):
        return _空库()
    for 键 in 层级们:
        if not isinstance(数据.get(键), list):
            数据[键] = []
    if not isinstance(数据.get("下一个号"), dict):
        数据["下一个号"] = {"项目": 1, "模块": 1, "动作": 1}
    for 键 in 层级们:
        数据["下一个号"].setdefault(键, 1)
    数据.setdefault("版本", 版本)
    # P1-B-1（2-1b）：老文件没 账号/端点 也要读得进
    数据.setdefault("账号", "")
    数据.setdefault("端点", "")
    return 数据


def 写(旧, 新):
    """原子写 + 备份（备份文件名带时刻）。头部固定 版本/账号/端点/更新（P1-B-1 · 2-1b）。"""
    import shutil
    新["账号"] = 公共.取路径("账号")
    新["端点"] = 公共.取路径("端点")
    新.setdefault("版本", 版本)
    新["更新"] = 公共.现在全()
    头 = {"版本": 新["版本"], "账号": 新["账号"], "端点": 新["端点"], "更新": 新["更新"]}
    for 键, 值 in list(新.items()):
        if 键 not in 头:
            头[键] = 值
    新.clear()
    新.update(头)
    try:
        备份目 = os.path.join(公共.取路径("数据目录"), "备份")
        os.makedirs(备份目, exist_ok=True)
        旧路径 = 路径()
        if os.path.isfile(旧路径):
            shutil.copy2(旧路径, os.path.join(备份目, "标签库_%s.json"
                                               % 公共.现在秒().replace(":", "").replace(" ", "_")))
    except Exception:
        公共.日志("标签库备份失败", "警告")
    公共.原子写json(路径(), 新)
    return True


def _已删(项):
    return bool(项.get("删"))


def _项目未软删(数据, 项目id):
    项 = next((x for x in 数据["项目"] if x.get("id") == 项目id), None)
    return bool(项) and not _已删(项)


def 解析(层级, 值, 项目id=None):
    """id 或 名字 → 标签对象；解析不到返回 None。模块/动作限定在 项目id 下。"""
    值 = str(值 or "").strip()
    if not 值 or 层级 not in 层级们:
        return None
    数据 = 读()
    for 项 in 数据[层级]:
        if _已删(项):
            continue
        if 层级 in ("模块", "动作") and 项目id and str(项.get("项目")) != str(项目id):
            continue
        if str(项.get("id")) == 值.upper() or str(项.get("名")) == 值:
            return 项
    return None


def _下一个id(数据, 层级):
    号 = int((数据.get("下一个号") or {}).get(层级) or 1)
    已用 = set(str(x.get("id")) for x in 数据[层级])
    while ("%s%04d" % (前缀[层级], 号)) in 已用:
        号 += 1
    数据["下一个号"][层级] = 号 + 1
    return "%s%04d" % (前缀[层级], 号)


def _新条(数据, 层级, 名, 项目=None, 路径值="", 预设=False):
    id = _下一个id(数据, 层级)
    条 = {"id": id, "名": 名}
    if 层级 == "项目":
        条.update({"路径": 路径值, "状态": "正常", "排序": len(数据["项目"]) + 1})
    else:
        条["项目"] = 项目
        条["排序"] = len(数据[层级]) + 1
        条["预设"] = bool(预设)
    条.update({"删": False, "创建": 公共.现在全(), "更新": 公共.现在全(),
              "历史": [{"ts": 公共.现在秒(), "动作": "新建"}]})
    return 条


def 新增(层级, 名, 项目=None, 路径="", 同步预设=True, 谁=""):
    """返回 (ok, 说明, 数据, 原因码)。"""
    if 层级 not in 层级们:
        return False, "层级只能是 项目/模块/动作", {}, "bad_param"
    名 = str(名 or "").strip()
    项目 = str(项目 or "").strip()
    相对 = str(路径 or "").strip()
    if 层级 == "项目" and not 相对:
        return False, "项目层必须给 路径（相对工作台的项目文件夹）", {}, "bad_param"
    if 层级 != "项目" and (not 名 or not 项目):
        return False, "模块/动作层必须给 名 与 项目", {}, "bad_param"
    with 公共.文件锁(_文件() + ".lock"):
        旧 = 读()
        新 = 读()
        if 层级 == "项目":
            根 = 公共.找工作台根()
            绝对 = os.path.join(根, 相对.replace("/", os.sep).replace("\\", os.sep))
            if not os.path.isdir(绝对):
                return False, "项目文件夹不存在：%s" % 绝对, {}, "folder_not_found"
            末名 = os.path.basename(绝对.rstrip(os.sep))
            名 = 名 or 末名
            if 名 != 末名:
                return False, "标签名必须与实际文件夹名一致（文件夹叫 %s）" % 末名, {}, "name_mismatch"
            for 项 in 新["项目"]:
                if str(项.get("路径")) == 相对 and not _已删(项):
                    return True, "项目已存在：%s" % 项.get("id"), {"id": 项.get("id"), "已存在": True}, ""
            条 = _新条(新, "项目", 名, 路径值=相对)
            新["项目"].append(条)
            插入 = 0
            if 同步预设:
                for 序号, 动名 in enumerate(预设动作, 1):
                    if any(str(x.get("名")) == 动名 and str(x.get("项目")) == 条["id"]
                           for x in 新["动作"]):
                        continue
                    a = _新条(新, "动作", 动名, 项目=条["id"], 预设=True)
                    a["排序"] = 序号
                    新["动作"].append(a)
                    插入 += 1
            写(旧, 新)
            return True, "已建项目 %s（动作预设插入 %d）" % (条["id"], 插入), \
                {"id": 条["id"], "已存在": False, "预设插入": 插入}, ""
        项 = 解析("项目", 项目)
        if not 项:
            return False, "项目不存在：%s" % 项目, {}, "not_found"
        父 = 项.get("id")
        for x in 新[层级]:
            if str(x.get("名")) == 名 and str(x.get("项目")) == 父 and not _已删(x):
                return True, "已存在：%s" % x.get("id"), {"id": x.get("id"), "已存在": True}, ""
        条 = _新条(新, 层级, 名, 项目=父)
        新[层级].append(条)
        写(旧, 新)
        return True, "已建%s %s" % (层级, 条["id"]), {"id": 条["id"], "已存在": False}, ""


def 改名(层级, id或名, 新名, 项目=None, 模式="文件夹", 确认=False, 允许脱钩=False, 谁=""):
    if 层级 not in 层级们:
        return False, "层级只能是 项目/模块/动作", {}, "bad_param"
    新名 = str(新名 or "").strip()
    if not 新名:
        return False, "缺 新名", {}, "bad_param"
    项目id = None
    if 层级 in ("模块", "动作"):
        p = 解析("项目", 项目)
        if not p:
            return False, "项目不存在：%s" % 项目, {}, "not_found"
        项目id = p.get("id")
    项 = 解析(层级, id或名, 项目id)
    if not 项:
        return False, "标签不存在：%s" % id或名, {}, "not_found"
    with 公共.文件锁(路径() + ".lock"):
        旧 = 读()
        新 = 读()
        目标 = next((x for x in 新[层级] if x.get("id") == 项.get("id")), None)
        同层 = [x for x in 新[层级] if str(x.get("项目")) == str(目标.get("项目"))
                and x.get("id") != 目标.get("id") and not _已删(x)] if 层级 != "项目" \
            else [x for x in 新["项目"] if x.get("id") != 目标.get("id") and not _已删(x)]
        if any(str(x.get("名")) == 新名 for x in 同层):
            return False, "同项目下已有同名标签：%s" % 新名, {}, "dup"
        旧名 = 目标.get("名")
        if 层级 == "项目":
            if 模式 == "文件夹":
                if not 确认:
                    return False, "改名会动真实文件夹，请 确认=true", {}, "bad_param"
                根 = 公共.找工作台根()
                旧绝对 = os.path.join(根, str(目标.get("路径") or ""))
                旧父 = os.path.dirname(旧绝对)
                新绝对 = os.path.join(旧父, 新名)
                if not os.path.isdir(旧绝对):
                    return False, "项目文件夹不存在：%s" % 旧绝对, {}, "folder_not_found"
                if os.path.exists(新绝对):
                    return False, "同级已有同名目录：%s" % 新名, {}, "dup"
                try:
                    os.rename(旧绝对, 新绝对)
                except PermissionError:
                    return False, "文件夹被占用，请关闭相关程序再改名", {}, "folder_busy"
                except OSError as 错:
                    return False, "改名失败：%s" % 错, {}, "folder_rename_failed"
                目标["路径"] = os.path.relpath(新绝对, 根).replace(os.sep, "\\")
                目标["状态"] = "正常"
            else:
                if not 允许脱钩:
                    return False, "会与文件夹名脱钩，请加 允许脱钩=true", {}, "name_mismatch"
                目标["状态"] = "脱钩"
        目标["名"] = 新名
        目标["更新"] = 公共.现在全()
        目标.setdefault("历史", []).append({"ts": 公共.现在秒(), "谁": 谁,
                                            "动作": "改名 %s→%s" % (旧名, 新名)})
        写(旧, 新)
        return True, "已改名 %s：%s→%s" % (目标.get("id"), 旧名, 新名), \
            {"id": 目标.get("id"), "名": 新名}, ""


def 引用(层级, id或名, 项目=None):
    """返回引用该标签的卡号列表。"""
    项目id = None
    if 层级 in ("模块", "动作"):
        p = 解析("项目", 项目)
        项目id = p.get("id") if p else None
    项 = 解析(层级, id或名, 项目id)
    if not 项:
        return None, "标签不存在：%s" % id或名, "not_found"
    tid = 项.get("id")
    卡们 = 任务卡库.读().get("卡", []) or []
    return [c.get("id") for c in 卡们
            if str(((c.get("标签") or {}).get(层级)) or "") == str(tid)], "", ""


def 删除(层级, id或名, 项目=None, 方式="软删", 改绑到=None, 恢复=False, 谁=""):
    if 层级 not in 层级们:
        return False, "层级只能是 项目/模块/动作", {}, "bad_param"
    项目id = None
    if 层级 in ("模块", "动作"):
        p = 解析("项目", 项目)
        if not p:
            return False, "项目不存在：%s" % 项目, {}, "not_found"
        项目id = p.get("id")
    if 恢复:
        原 = 读()
        值 = str(id或名 or "").strip()
        项 = next((x for x in 原[层级]
                   if (str(x.get("id")) == 值.upper() or str(x.get("名")) == 值)
                   and (层级 == "项目" or str(x.get("项目")) == str(项目id or ""))), None)
    else:
        项 = 解析(层级, id或名, 项目id)
    if not 项:
        return False, "标签不存在：%s" % id或名, {}, "not_found"
    with 公共.文件锁(路径() + ".lock"):
        旧 = 读()
        新 = 读()
        目标 = next((x for x in 新[层级] if x.get("id") == 项.get("id")), None)
        if 恢复:
            目标["删"] = False
            目标.pop("删于", None)
            目标.setdefault("历史", []).append({"ts": 公共.现在秒(), "动作": "恢复"})
            写(旧, 新)
            return True, "已恢复 %s" % 目标.get("id"), {"id": 目标.get("id")}, ""
        if 方式 == "软删":
            目标["删"] = True
            目标["删于"] = 公共.现在全()
            目标.setdefault("历史", []).append({"ts": 公共.现在秒(), "动作": "软删"})
            写(旧, 新)
            return True, "已软删 %s" % 目标.get("id"), {"id": 目标.get("id")}, ""
        卡们 = 任务卡库.读().get("卡", []) or []
        tid = 目标.get("id")
        refs = [c for c in 卡们 if str(((c.get("标签") or {}).get(层级)) or "") == str(tid)]
        if 层级 in ("模块", "动作"):
            if refs and not 改绑到:
                return False, "该%s有 %d 张卡片，请给 改绑到" % (层级, len(refs)), \
                    {"引用": len(refs)}, "need_rebind"
            if 改绑到:
                sb = 解析(层级, 改绑到, 项目id)
                if not sb or str(sb.get("项目")) != str(项目id):
                    return False, "改绑目标不存在或不属于该项目", {}, "project_mismatch"
        else:
            子 = [x for x in 新["模块"] if str(x.get("项目")) == str(tid)] + \
                 [x for x in 新["动作"] if str(x.get("项目")) == str(tid)]
            if 子 and not refs:
                return False, "项目下还有模块/动作，请先删子级", {"子级": len(子)}, "children_exist"
            if refs:
                return False, "该项目有 %d 张卡片，请选齐 替代项目/模块/动作" % len(refs), \
                    {"引用": len(refs)}, "need_rebind"
        if 层级 in ("模块", "动作"):
            if 改绑到:
                库旧, 库新 = 任务卡库.读(), 任务卡库.读()
                for c in 库新.get("卡", []):
                    if c.get("id") in [x.get("id") for x in refs]:
                        c.setdefault("标签", {})[层级] = sb.get("id")
                        c.setdefault("历史", []).append({"ts": 公共.现在秒(), "动作": "批量改绑"})
                任务卡库._写(库旧, 库新)
            新[层级] = [x for x in 新[层级] if x.get("id") != tid]
        else:
            新["模块"] = [x for x in 新["模块"] if str(x.get("项目")) != str(tid)]
            新["动作"] = [x for x in 新["动作"] if str(x.get("项目")) != str(tid)]
            新["项目"] = [x for x in 新["项目"] if x.get("id") != tid]
        写(旧, 新)
        return True, "已硬删 %s" % tid, {"id": tid}, ""


def 同步预设(项目id):
    项 = 解析("项目", 项目id)
    if not 项:
        return False, "项目不存在：%s" % 项目id, {}, "not_found"
    with 公共.文件锁(路径() + ".lock"):
        旧 = 读()
        新 = 读()
        插入, 跳过 = 0, 0
        for 序号, 动名 in enumerate(预设动作, 1):
            if any(str(x.get("名")) == 动名 and str(x.get("项目")) == 项.get("id")
                   for x in 新["动作"] if not _已删(x)):
                跳过 += 1
                continue
            a = _新条(新, "动作", 动名, 项目=项.get("id"), 预设=True)
            a["排序"] = 序号
            新["动作"].append(a)
            插入 += 1
        写(旧, 新)
        return True, "同步预设：插入 %d / 跳过 %d" % (插入, 跳过), \
            {"插入": 插入, "跳过": 跳过}, ""


def 同步路径(只报错=False):
    根 = 公共.找工作台根()
    已纠正, 脱钩, 丢失, 列 = [], [], [], []
    with 公共.文件锁(路径() + ".lock"):
        旧 = 读()
        新 = 读()
        for 项 in 新["项目"]:
            if _已删(项):
                continue
            绝对 = os.path.join(根, str(项.get("路径") or ""))
            if not os.path.isdir(绝对):
                项["状态"] = "丢失"
                丢失.append(项.get("id"))
            else:
                末名 = os.path.basename(绝对.rstrip(os.sep))
                项["状态"] = "正常"
                if str(项.get("名")) != 末名:
                    项["名"] = 末名
                    已纠正.append(项.get("id"))
            if 项.get("状态") == "脱钩":
                脱钩.append(项.get("id"))
            列.append({"id": 项.get("id"), "名": 项.get("名"), "状态": 项.get("状态")})
        if not 只报错:
            写(旧, 新)
        return True, "同步路径：已纠正 %d / 脱钩 %d / 丢失 %d" % (len(已纠正), len(脱钩), len(丢失)), \
            {"已纠正": 已纠正, "脱钩": 脱钩, "丢失": 丢失, "项目": 列}, ""


def 标签齐(卡):
    """三键非空 + 三 id 在库中有效（未硬删、父项目未软删）。返回 (bool, 说明)。"""
    标 = (卡 or {}).get("标签") or {}
    三 = [标.get("项目"), 标.get("模块"), 标.get("动作")]
    if not all(str(x or "").strip() for x in 三):
        return False, "缺标签：项目/模块/动作 没齐"
    数据 = 读()
    p = next((x for x in 数据["项目"] if x.get("id") == 三[0] and not _已删(x)), None)
    if not p:
        return False, "项目标签无效或已删：%s" % 三[0]
    m = next((x for x in 数据["模块"] if x.get("id") == 三[1]
              and str(x.get("项目")) == 三[0] and not _已删(x)), None)
    a = next((x for x in 数据["动作"] if x.get("id") == 三[2]
              and str(x.get("项目")) == 三[0] and not _已删(x)), None)
    if not m:
        return False, "模块标签无效或不属于该项目：%s" % 三[1]
    if not a:
        return False, "动作标签无效或不属于该项目：%s" % 三[2]
    return True, ""
