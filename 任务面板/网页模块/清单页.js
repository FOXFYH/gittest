/* ============================================================
 * 【任务面板】网页模块 · 清单页.js
 * 版本：0.05
 * 职责：用户 2026-10-20 口径【一种卡片 + 跳页式细分】的页面逻辑层——
 *   · 主页＝【我的清单】：摆一级卡（＝一本总管清单，就是一张完整的卡）。
 *   · **一张卡＝一个节点**，全层级共用同一个 `建卡(节点, 层级)`：
 *     卡头（类型标签：一级＝总管清单 / 其下＝任务 / 更下＝子任务，＋编号）
 *     ＋标题（占两行、超出截断）＋副行（状态/任务数）
 *     ＋**正文（默认收起；点【展开】才在卡内展示）**
 *     ＋底部**单排**按钮【展开｜详情｜备注｜细分｜呼叫AI｜删除】（不换行、等分宽度）。
 *   · **细分＝跳页**（0.03 用户纠正）：点【细分】不再同页伸缩，而是**整页切换到该卡的下级页面**
 *     （像进入一个新文件夹），页面里摆同样的卡；可【返回上级】或用左上【新建】在本页加下级。
 *     不限层数。页面里的【新建下级】按钮同样可用。
 *   · 新建（左上角）：主页＝新建清单（选类型「总管清单」）；下级页＝给当前卡新建下级。
 *     标题限 100 字、正文限 1 万字（输入框 maxlength 把关并显示计数）。
 *   · 删除：每张卡（含一级卡）都有【删除】；一级卡删除＝连同整棵子树。
 *     确认弹窗【自绘】（遮罩＋是/否），不用 window.confirm（手机上不好用、可能被拦）。
 *   · 每张卡可单独【呼叫AI】：选端/对话 → 接口.呼叫AI(节点,执行者) →
 *     四段胶囊（连接WS中→等待服务器回应→服务器已接收→投递成功）；应答驱动前三段，
 *     广播「投递结果」＋轮询 `卡片状态` 双通道收口。
 *   · 状态字段兼容：任务 `T` 用 `状态`（四态）；子点 `P` 后端 `完成`(bool) 与可选 `状态`
 *     —— 若 `状态` 存在就用它，否则用 `完成` 映射（true→已完成、false→未开始）。
 * 说明：纯 DOM；复用 任务面板.html 的 .卡/.卡头/.卡标题/.卡副/.正文框/.按钮排/.小钮/.遮罩/.弹窗
 *   等样式，并复用 `卡片.自适应` 实现「满宽 / 高度上限＝自身宽 / 截断 / 手动展开」。
 * 依赖：接口.js（清单库路由封装）、卡片.js（自适应）。
 *
 * ★★ 与后端实况的对齐（服务端 网页服务.py 0.15 / 清单存储 0.03）★★
 *   1) 小点 `P` 天然成树：`{编号,父,标题,详情,完成,子,任务}`——父可＝任务 `T…` 或某点 `P…`、
 *      **不限层数**。本页取子：清单 L→`清单详情.任务列表`（再逐任务 `任务详情` 补全）；
 *      任务 T→`任务详情.小点列表`；小点 P→`点详情.子列表`；递归下行，**无需自建父子表**。
 *   2) 清单 L / 小点 P 的 `详情`（＝卡片正文）由 0.15/0.03 补上；任务 T 本就有。
 *   3) 收口（第四段）双通道：①监听【投递结果】广播帧；②轮询 `任务详情(T).卡片状态` /
 *      `点详情(P).点.卡片状态`（`_点视图` 暂未暴露 `卡片状态`，小点以 ① 广播帧为准）。
 * 维护记录：
 *   · 0.05（2026-10-20）**自动模式优先新版**（修「正文时有时无」的另一半）：未选服务器（自动）时，
 *     ①订阅「服务器报到」——在线最高版本升高（如新版上台）→ 自动重载一次；
 *     ②装配 6 秒后校正一次：若最近应答那台版本低于在线最高版本 → 重载（只校正一次，避免来回刷）。
 *   · 0.04（2026-10-20）修「明明有正文，点【展开】却说缺正文」（起因＝用户 2026-10-20 反馈；
 *     定位：家里那台服务器还是 0.12，`lists` 不返回 `详情`，且「自动」模式谁先答算谁 → 有时被旧版
 *     应答，卡片摘要里天然没有正文）：①`建卡` 对**清单卡**在摘要缺 `详情` 时异步补取一次
 *     （`取正文`：清单→`list_get.清单.详情`、任务→`task_get.任务.详情`、小点→`point_get.点.详情`）；
 *     ②【展开】点开时若仍无正文，**现场再取一次**再判断，仍空才提示；
 *     ③ 若当前应答服务器版本 < 0.15（不返回正文）→ 提示里如实点名「服务器过旧，请到设置切换/升级」。
 *   · 0.03（2026-10-20）按用户纠正改为**跳页式细分 + 单排按钮 + 标题/正文**（起因＝用户原话：
 *     「全部的按钮设计成一排就好了。新建的时候，让填入标题和正文 正文字数限制 1 万字。标题限制
 *     100 个字。……拆分下级的按钮改为细分这么一个按钮。一律都是点击这个按钮，又来到一个全新的
 *     页面。就像进入一个新的文件夹。你现在给我设置成伸缩式的……我要的是直接跳转到一个新页面」；
 *     随后补正：**展开按钮就叫【展开】**，不叫正文——「以后我展开以后不只有正文，还会有更多丰富
 *     的选项」）。① 按钮全部排一行：展开/详情/备注/细分/呼叫AI/删除（等分、不换行、字号收小）；
 *     ②【展开】点开＝卡内展示正文（并解除高度上限），再点收起；无正文时如实提示；
 *     ③【细分】＝整页切到该卡的下级页面（`进节点`），页内可新建下级、可返回上级；
 *     ④ 新建清单/新建下级均填**标题（≤100）＋正文（≤10000）**；⑤ 删除/备注/呼叫AI 逻辑沿用。
 *     与 接口.js 0.10、面板.js 0.19、任务面板.html 0.21 配套。
 *   · 0.02（2026-10-20）「只有一种卡片 + 递归容器」：全层级共用 `建卡`、同页伸缩子容器。
 *   · 0.01（2026-10-20）首版（清单库大重构 · 前端页面层）。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.05';

  // ---------------- 状态 ----------------
  var 清单缓存 = [];         // 清单摘要列表（[{编号,名称,类型,详情,任务数,未完成数}]）
  var 清单指纹 = '';         // 清单列表「版本指纹」（差额：无变化不重绘）
  var 子缓存 = {};           // 节点编号 -> 其子节点数组（清单→任务，任务/子点→子点）
  var 已取 = {};             // 节点编号 -> true（子缓存有效）
  var 节点表 = {};           // 节点编号 -> 节点 dict（按编号就地更新用）
  var 页栈 = [];             // [{节点, 层级}] 当前所在页面链（空＝主页）
  var 端缓存 = [];           // 端列表（供「呼叫AI」选端）
  var 呼_目标 = null;        // 「呼叫AI」当前目标节点
  var 呼_大类 = null, 呼_端 = null, 呼_对话 = null;
  var 忙闲轮询 = null, 轮询在途 = false;   // 「选择对话」忙闲 10 秒轮询
  var 加卡_后端 = null;      // 「加卡弹窗」用途：{节点, 层级}

  // 投递四段状态机（本页运行时态）：节点编号 -> {态, 卡片状态}
  var 投递态 = {};
  var 胶囊色 = {
    '连接 WS 中': '态终', '连接WS中': '态终',
    '等待服务器回应': '态中', '服务器已接收': '态好',
    '投递成功': '态好', '发送失败': '态失败', '发送未确认': '态中'
  };
  var 在途 = {};
  var 广播已装 = false;

  // ---------------- 基础小工具 ----------------
  function $(id) { return document.getElementById(id); }
  function el(标签, 类名, 文本) {
    var e = document.createElement(标签);
    if (类名) e.className = 类名;
    if (文本 !== undefined && 文本 !== null) e.textContent = String(文本);
    if (标签 === 'button') e.type = 'button';
    return e;
  }
  function 钮(文本, 类名, 处理) {
    var b = el('button', 类名, 文本);
    if (处理) b.addEventListener('click', 处理);
    return b;
  }
  function 空样(文本) { return el('div', '空样', 文本); }
  function 复制(o) {
    var r = {};
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; }
    return r;
  }
  function 提示(文案) {
    try { if (global.面板 && typeof global.面板.提示 === 'function') { global.面板.提示(文案); return; } } catch (e) { }
    try { if (global.console && console.log) console.log(文案); } catch (e) { }
  }
  function 有接口() { return !!(global.接口 && global.接口.版本); }
  function 失败(框, e) { if (框) { 框.innerHTML = ''; 框.appendChild(空样('加载失败：' + ((e && e.message) || e))); } }
  function 文字(v) { return (v === undefined || v === null) ? '' : String(v); }
  function 层名(层级) { return 层级 === 1 ? '总管清单' : (层级 === 2 ? '任务' : '子任务'); }
  function 贴自适应(根) { try { if (global.卡片 && global.卡片.自适应) global.卡片.自适应(根 || document); } catch (e) { } }
  function 回页首() {
    try { global.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { try { global.scrollTo(0, 0); } catch (e2) { } }
  }

  // ---------------- 节点（统一形状） ----------------
  // 种：清单 / 任务 / 点；层级：1=总管清单、2=任务、>=3=子任务
  function 清单节点(c) {
    return { 种: '清单', 编号: 文字(c.编号), 标题: 文字(c.名称) || '（未命名清单）',
             详情: 文字(c.详情), 状态: '', 完成: false, 卡片状态: 文字(c.卡片状态),
             类型: 文字(c.类型) || '总管清单',
             任务数: c.任务数 || 0, 未完成数: c.未完成数 || 0, 父: '' };
  }
  function 任务节点(t) {
    return { 种: '任务', 编号: 文字(t.编号), 标题: 文字(t.标题) || '（无标题）',
             详情: 文字(t.详情), 状态: 文字(t.状态) || '未开始', 完成: false,
             卡片状态: 文字(t.卡片状态), 清单: 文字(t.清单), 父: 文字(t.清单),
             任务数: 0, 未完成数: 0 };
  }
  function 点节点(p, 父号, 任务号) {
    var 完成 = !!p.完成;
    var 态 = 文字(p.状态) || (完成 ? '已完成' : '未开始');
    return { 种: '点', 编号: 文字(p.编号), 标题: 文字(p.标题) || '（无标题）',
             详情: 文字(p.详情), 状态: 态, 完成: 完成, 卡片状态: 文字(p.卡片状态),
             父: 文字(父号) || 文字(p.父), 任务: 文字(任务号) || 文字(p.任务),
             任务数: 0, 未完成数: 0 };
  }

  function 取子(节点) {
    var 号 = 节点.编号;
    if (!号 || !有接口()) return Promise.resolve([]);
    if (节点.种 === '清单') {
      return global.接口.清单详情(号).then(function (r) {
        if (!r || r.ok === false) throw new Error((r && r.err) || '清单加载失败');
        var 列 = (r.任务列表) || [];
        return Promise.all(列.map(function (t) {
          var 基 = 任务节点(t);
          基.清单 = 号; 基.父 = 号;
          return global.接口.任务详情(基.编号).then(function (d) {
            var 全 = (d && d.任务) || {};
            ['标题', '详情', '状态', '卡片状态', '清单'].forEach(function (k) {
              if (全[k] !== undefined && 全[k] !== null) 基[k] = 文字(全[k]);
            });
            if (!基.标题) 基.标题 = '（无标题）';
            基.状态 = 基.状态 || '未开始';
            基.清单 = 基.清单 || 号;
            return 基;
          })['catch'](function () { return 基; });
        }));
      });
    }
    if (节点.种 === '任务') {
      return global.接口.任务详情(号).then(function (r) {
        return ((r && r.小点列表) || []).map(function (p) { return 点节点(p, 号, 号); });
      });
    }
    return global.接口.点详情(号).then(function (r) {
      return ((r && r.子列表) || []).map(function (p) { return 点节点(p, 号, 节点.任务 || ''); });
    });
  }

  function 取正文(节点) {
    if (!节点 || !节点.编号 || !有接口()) return Promise.resolve('');
    if (节点.种 === '清单') {
      return global.接口.清单详情(节点.编号).then(function (r) {
        return 文字((r && r.清单 || {}).详情);
      });
    }
    if (节点.种 === '任务') {
      return global.接口.任务详情(节点.编号).then(function (r) {
        return 文字((r && r.任务 || {}).详情);
      });
    }
    return global.接口.点详情(节点.编号).then(function (r) {
      return 文字((r && r.点 || {}).详情);
    });
  }

  // 0.04：当前应答服务器是否过旧（< 0.15 不返回正文）——如实说明，不让人误以为「自己没有正文」
  function 旧服务器说明() {
    try {
      var sv = (global.接口.最近应答 && global.接口.最近应答()) || '';
      if (!sv) return '';
      var 表 = (global.接口.服务器列表 && global.接口.服务器列表()) || [];
      for (var i = 0; i < 表.length; i++) {
        if (String(表[i].实例号) !== sv) continue;
        var 版 = String(表[i].版本 || '');
        if (版 && parseFloat(版) < 0.15) {
          return '（当前应答服务器「' + (表[i].名称 || 表[i].实例号) + '」v' + 版
            + ' 过旧、不返回正文；请到【设置 · 服务器】切到新版服务器）';
        }
        return '';
      }
    } catch (e) { }
    return '';
  }

  // ============================================================ 主页（我的清单）
  function 载入主页(强制) {
    if (!有接口()) return Promise.resolve();
    return global.接口.清单列表(强制 ? '' : 清单指纹).then(function (r) {
      if (r && r.版本) 清单指纹 = r.版本;
      if (r && r.未变 && !强制) return;      // 差额：无变化不重绘
      清单缓存 = (r && r.清单列表) || [];
      画顶层(清单缓存);
    }).catch(function (e) {
      失败($('顶层容器'), e);
      if ($('清单计数')) $('清单计数').textContent = '';
    });
  }

  function 画顶层(列表) {
    var 框 = $('顶层容器');
    if (!框) return;
    框.innerHTML = '';
    节点表 = {};
    if (!列表.length) {
      框.appendChild(空样('还没有清单，点左上角【新建】建一张'));
      if ($('清单计数')) $('清单计数').textContent = '';
      return;
    }
    列表.forEach(function (c) {
      var 节 = 清单节点(c);
      节点表[节.编号] = 节;
      框.appendChild(建卡(节, 1));
    });
    if ($('清单计数')) $('清单计数').textContent = '共 ' + 列表.length + ' 本';
    贴自适应(框);
    应用胶囊(框);
  }

  function 显主页() {
    if ($('主页')) $('主页').classList.remove('隐藏');
    if ($('节点页')) $('节点页').classList.add('隐藏');
    if ($('按钮_新建')) $('按钮_新建').textContent = '新建';
  }
  function 显节点页() {
    if ($('主页')) $('主页').classList.add('隐藏');
    if ($('节点页')) $('节点页').classList.remove('隐藏');
    if ($('按钮_新建')) $('按钮_新建').textContent = '新建下级';
  }

  // 回到主页：清页面栈、显示主页、重载清单
  function 回主页() {
    if ($('呼弹窗')) $('呼弹窗').classList.add('隐藏');
    停轮询();
    页栈 = [];
    显主页();
    载入主页(true);
    回页首();
  }

  // ============================================================ 下级页面（细分＝进入新文件夹）
  function 进节点(节点, 层级) {
    var 顶 = 页栈[页栈.length - 1];
    if (!顶 || 顶.节点.编号 !== 节点.编号) 页栈.push({ 节点: 节点, 层级: 层级 });
    显节点页();
    画节点页(false);
    回页首();
  }

  function 返回上级() {
    if (!页栈.length) { 回主页(); return; }
    页栈.pop();
    if (!页栈.length) {
      显主页();
      载入主页(true);
      回页首();
      return;
    }
    显节点页();
    画节点页(true);
    回页首();
  }

  function 画节点页(重取) {
    var 顶 = 页栈[页栈.length - 1];
    if (!顶) { 显主页(); return Promise.resolve(); }
    if ($('节点页_题')) {
      $('节点页_题').textContent = 层名(顶.层级) + ' · ' + (顶.节点.编号 || '') + ' · ' + (顶.节点.标题 || '');
    }
    if ($('节点页_新建')) $('节点页_新建').textContent = '＋ 新建' + (顶.层级 + 1 === 2 ? '任务' : '子任务');
    var 框 = $('节点容器');
    if (!框) return Promise.resolve();
    if (!重取 && 已取[顶.节点.编号]) { 画节点子(框, 顶); return Promise.resolve(); }
    框.innerHTML = '';
    框.appendChild(空样('加载中…'));
    return 取子(顶.节点).then(function (列) {
      子缓存[顶.节点.编号] = 列;
      已取[顶.节点.编号] = true;
      画节点子(框, 顶);
    })['catch'](function (e) { 失败(框, e); });
  }

  function 画节点子(框, 顶) {
    框.innerHTML = '';
    var 列 = 子缓存[顶.节点.编号] || [];
    if (!列.length) {
      框.appendChild(空样('（这里还没有下级，点上方【新建下级】加一张）'));
    }
    列.forEach(function (x) {
      节点表[x.编号] = x;
      框.appendChild(建卡(x, 顶.层级 + 1));
    });
    贴自适应(框);
    应用胶囊(框);
  }

  // ============================================================ 唯一的一种卡片
  function 建卡(节点, 层级) {
    var 卡 = el('div', '卡 层' + 层级);
    卡.dataset.编号 = 节点.编号 || '';
    卡.dataset.种 = 节点.种;
    卡.dataset.层级 = String(层级);
    if (节点.种 === '点' && 节点.状态 === '已完成') 卡.classList.add('完成');

    // 卡头：编号 + 类型标签 + 投递胶囊
    var 头 = el('div', '卡头');
    头.appendChild(el('span', '编号', 节点.编号 || ''));
    头.appendChild(el('span', '端标', 层名(层级)));
    var 胶 = el('span', '状态钮', '');
    胶.dataset.胶囊 = '1';
    胶.style.display = 'none';
    头.appendChild(胶);
    卡.appendChild(头);

    // 标题（占两行；超出截断）
    var 题 = el('div', '卡标题', 节点.标题 || '（无标题）');
    题.title = 节点.标题 || '';
    卡.appendChild(题);

    // 副行：清单＝类型/任务数；任务/子任务＝状态
    卡.appendChild(建副行(节点));

    // 正文：默认收起；点【展开】才展示（0.03 用户口径；以后还会放更多丰富内容）
    var 正 = el('div', '正文框');
    正.textContent = 文字(节点.详情).trim() || '（本卡没有正文）';
    卡.appendChild(正);

    // 0.04：清单摘要若没带正文（旧版服务器 / 差额缓存），异步补一次，避免误报「没有正文」
    if (节点.种 === '清单' && !文字(节点.详情).trim()) {
      取正文(节点).then(function (文) {
        if (!文字(文).trim()) return;
        节点.详情 = 文;
        正.textContent = 文;
      })['catch'](function () { });
    }

    // 底部按钮排（全层级完全一致，**一排**）
    var 排 = el('div', '按钮排');
    var 展 = 钮('展开', '小钮', null);
    function 展开() {
      卡.classList.add('展开');
      展.textContent = '收起';
      展.classList.add('选中');
      贴自适应(卡);
    }
    function 收起() {
      卡.classList.remove('展开');
      展.textContent = '展开';
      展.classList.remove('选中');
      贴自适应(卡);
    }
    展.addEventListener('click', function () {
      if (卡.classList.contains('展开')) { 收起(); return; }
      if (文字(节点.详情).trim()) { 展开(); return; }
      // 节点上没正文 → 现场取一次（防旧版服务器摘要不带详情）
      展.disabled = true;
      取正文(节点).then(function (文) {
        展.disabled = false;
        if (!文字(文).trim()) { 提示('本卡没有正文' + 旧服务器说明()); return; }
        节点.详情 = 文;
        正.textContent = 文;
        展开();
      })['catch'](function (e) {
        展.disabled = false;
        提示('取正文失败：' + ((e && e.message) || e));
      });
    });
    展.title = '展开本卡（先展示正文，以后还会有更多内容）';
    排.appendChild(展);

    var 详 = 钮('详情', '小钮', function () { 查看详情(节点, 层级); });
    详.title = '查看详细情况';
    排.appendChild(详);

    var 备 = 钮('备注', '小钮', function () { 开备注(节点, 层级); });
    备.title = '快速备注（未开始/进行中/已完成/已放弃）';
    排.appendChild(备);

    var 分 = 钮('细分', '小钮', function () { 进节点(节点, 层级); });
    分.title = '细分：进入这张卡的下级页面';
    排.appendChild(分);

    var 呼 = 钮('呼叫AI', '小钮', function () { 开呼(节点, 层级); });
    呼.title = '呼叫 AI 负责本卡片';
    排.appendChild(呼);

    排.appendChild(钮('删除', '小钮', function () { 删卡(节点, 层级); }));
    卡.appendChild(排);

    return 卡;
  }

  function 建副行(节点) {
    var 副 = el('div', '卡副');
    if (节点.种 === '清单') {
      副.textContent = '类型：' + (节点.类型 || '总管清单') + ' · 任务 ' + (节点.任务数 || 0)
        + ' · 未完成 ' + (节点.未完成数 || 0);
    } else {
      副.textContent = '状态：' + (节点.状态 || (节点.完成 ? '已完成' : '未开始'));
    }
    return 副;
  }

  // ============================================================ 快速备注（四档）
  var 状态枚举 = ['未开始', '进行中', '已完成', '已放弃'];
  function 开备注(节点, 层级) {
    if ($('备注_节点')) $('备注_节点').textContent = (节点.编号 || '') + '（' + 层名(层级) + '）';
    var 组 = $('备注_组');
    if (!组) return;
    组.innerHTML = '';
    状态枚举.forEach(function (态) {
      var b = el('button', '选行' + (节点.状态 === 态 ? ' 选中' : '') + (节点.种 === '清单' ? ' 禁用' : ''), 态);
      b.addEventListener('click', function () {
        if (节点.种 === '清单') { 提示('总管清单本身没有状态，请在任务卡上快速备注'); return; }
        设状态(节点, 态);
      });
      组.appendChild(b);
    });
    if (节点.种 === '清单') 组.appendChild(空样('总管清单本身没有状态字段；请在它的任务卡上快速备注。'));
    if ($('备注弹窗')) $('备注弹窗').classList.remove('隐藏');
  }

  function 设状态(节点, 态) {
    if (!有接口()) { 提示('接口未就绪'); return; }
    var 完成;
    if (节点.种 === '任务') {
      完成 = global.接口.任务状态(节点.编号, 态);
    } else {
      var 步 = [];
      if (typeof global.接口.点状态 === 'function') 步.push(global.接口.点状态(节点.编号, 态));
      步.push(global.接口.点切换(节点.编号, 态 === '已完成'));
      完成 = Promise.all(步);
    }
    完成.then(function () {
      节点.状态 = 态;
      节点.完成 = (态 === '已完成');
      就地更新状态(节点);
      if ($('备注弹窗')) $('备注弹窗').classList.add('隐藏');
      提示('已置：' + 态 + '（' + 节点.编号 + '）');
    })['catch'](function (e) { 提示('设状态失败：' + e.message); });
  }
  function 就地更新状态(节点) {
    var 卡 = document.querySelector('.卡[data-编号="' + (节点.编号 || '') + '"]');
    if (!卡) return;
    var 副 = 卡.querySelector('.卡副');
    if (副) 副.textContent = '状态：' + (节点.状态 || (节点.完成 ? '已完成' : '未开始'));
    卡.classList.toggle('完成', 节点.种 === '点' && 节点.状态 === '已完成');
  }

  // ============================================================ 加卡（新建任务 / 新建下级）
  function 开加卡(父节点, 父层级) {
    加卡_后端 = { 节点: 父节点, 层级: 父层级 };
    var 是清单 = 父节点 && 父节点.种 === '清单';
    if ($('加卡_题')) $('加卡_题').textContent = 是清单 ? '新建任务' : ('新建下级 · ' + ((父节点 && 父节点.编号) || ''));
    if ($('加卡_标题')) $('加卡_标题').value = '';
    if ($('加卡_正文')) $('加卡_正文').value = '';
    刷新增卡计数();
    if ($('加卡弹窗')) $('加卡弹窗').classList.remove('隐藏');
    try { if ($('加卡_标题')) $('加卡_标题').focus(); } catch (e) { }
  }
  function 定加卡() {
    var 后端 = 加卡_后端;
    if (!后端 || !后端.节点) return;
    var 标 = String(($('加卡_标题') && $('加卡_标题').value) || '').trim();
    if (!标) { 提示('请填写标题'); return; }
    var 文 = String(($('加卡_正文') && $('加卡_正文').value) || '');
    var 定 = $('加卡_确定');
    if (定 && 定.disabled) return;
    if (定) 定.disabled = true;
    var 父 = 后端.节点;
    var 完 = function () { if (定) 定.disabled = false; };
    var 收 = function () { if ($('加卡弹窗')) $('加卡弹窗').classList.add('隐藏'); };
    if (父.种 === '清单') {
      global.接口.任务新建(父.编号, 标, 文).then(function (r) {
        if (r && r.ok === false) { 提示('新建任务失败：' + ((r && r.err) || '')); 完(); return; }
        var x = (r && r.任务) || {};
        收();
        提示('已新建任务' + (x.编号 ? '：' + x.编号 : ''));
        return 清理重复任务(父.编号, x.编号, x.标题 || 标, x.创建)
          .then(刷新全量).then(完);
      })['catch'](function (e) { 提示('新建任务失败：' + e.message); 完(); });
      return;
    }
    global.接口.子点新建(父.编号, 标, 文).then(function (r) {
      if (r && r.ok === false) { 提示('新建下级失败：' + ((r && r.err) || '')); 完(); return; }
      var x = (r && r.小点) || {};
      收();
      提示('已新建下级' + (x.编号 ? '：' + x.编号 : ''));
      return 清理重复子点(父.编号, x.编号, x.标题 || 标)
        .then(刷新全量).then(完);
    })['catch'](function (e) { 提示('新建下级失败：' + e.message); 完(); });
  }

  // ============================================================ 删除（自绘确认，含一级卡整棵子树）
  function 删卡(节点, 层级) {
    var 种名 = 层名(层级);
    var 问 = '确实要删除' + 种名 + ' ' + (节点.编号 || '') + '？'
      + (层级 === 1 ? '将连同其全部任务与子任务' : '将连同其全部下级') + '，不可撤销。';
    自绘确认(问, function () {
      if (!有接口()) { 提示('接口未就绪'); return; }
      var 调 = 节点.种 === '清单' ? global.接口.清单删除
        : (节点.种 === '任务' ? global.接口.任务删除 : global.接口.点删除);
      调(节点.编号).then(function (r) {
        if (r && r.ok === false) { 提示('删除失败：' + ((r && r.err) || '')); return; }
        提示('已删除 ' + 节点.编号);
        刷新全量();
      })['catch'](function (e) { 提示('删除失败：' + e.message); });
    });
  }

  // 页面内自绘确认弹窗（不用 window.confirm）
  function 自绘确认(问, 是) {
    var 遮 = el('div', '遮罩');
    var 框 = el('div', '弹窗');
    框.appendChild(el('h3', null, '确认删除'));
    框.appendChild(el('p', '确认文', 问));
    var 底 = el('div', '弹窗底');
    底.appendChild(钮('否', '次钮', function () { 遮.remove(); }));
    var 好 = 钮('是', '主钮', function () { 遮.remove(); 是(); });
    好.dataset.确认 = '1';
    底.appendChild(好);
    框.appendChild(底);
    遮.appendChild(框);
    遮.addEventListener('click', function (ev) { if (ev.target === 遮) 遮.remove(); });
    document.body.appendChild(遮);
    return 遮;
  }

  // 变更后全量刷新（清子缓存；主页重载清单 / 下级页重取当前节点）
  function 刷新全量() {
    子缓存 = {};
    已取 = {};
    清单指纹 = '';
    if (页栈.length) return 画节点页(true);
    return 载入主页(true);
  }

  // ============================================================ 查看详细情况
  function 查看详情(节点, 层级) {
    var 盒 = el('div');
    盒.appendChild(行('编号', 节点.编号));
    盒.appendChild(行('类型', 层名(层级)));
    盒.appendChild(行('标题', 节点.标题));
    if (文字(节点.详情).trim()) 盒.appendChild(行('正文', 节点.详情));
    if (节点.种 === '清单') {
      盒.appendChild(行('清单类型', 节点.类型 || '总管清单'));
      盒.appendChild(行('任务数', 节点.任务数));
      盒.appendChild(行('未完成数', 节点.未完成数));
    } else {
      盒.appendChild(行('状态', 节点.状态));
    }
    if (节点.种 === '点') 盒.appendChild(行('完成（后端字段）', 节点.完成 ? 'true' : 'false'));
    盒.appendChild(行('卡片状态', 取显示卡片状态(节点)));
    if (节点.父) 盒.appendChild(行('父节点', 节点.父));
    if (节点.种 === '点' && 节点.任务) 盒.appendChild(行('所属任务', 节点.任务));
    弹层('卡片详情 · ' + (节点.编号 || ''), 盒);
  }
  function 取显示卡片状态(节点) {
    var t = 投递态[节点.编号];
    if (t && t.卡片状态) return t.卡片状态;
    return 节点.卡片状态 || '—';
  }
  function 行(名, 值) {
    var d = el('div', '原卡');
    d.appendChild(el('div', '原头', 名));
    d.appendChild(el('div', null, (值 === undefined || 值 === null || 值 === '') ? '—' : String(值)));
    return d;
  }
  function 弹层(标题, 内容节点) {
    var 遮 = el('div', '遮罩');
    var 框 = el('div', '弹窗');
    框.appendChild(el('h3', null, 标题));
    框.appendChild(内容节点);
    var 底 = el('div', '弹窗底');
    底.appendChild(钮('关闭', '次钮', function () { 遮.remove(); }));
    框.appendChild(底);
    遮.appendChild(框);
    遮.addEventListener('click', function (ev) { if (ev.target === 遮) 遮.remove(); });
    document.body.appendChild(遮);
    return 遮;
  }

  // ============================================================ 呼叫 AI（选端/对话 → 呼叫 → 胶囊四段）
  function 关呼() {
    if ($('呼弹窗')) $('呼弹窗').classList.add('隐藏');
    停轮询();
    呼_端 = null; 呼_对话 = null;
  }
  function 开呼(节点, 层级) {
    呼_目标 = 节点;
    呼_大类 = null; 呼_端 = null; 呼_对话 = null;
    if ($('呼_节点')) $('呼_节点').textContent = (节点.编号 || '') + '（' + 层名(层级) + '）'
      + (节点.标题 ? ' · ' + 节点.标题 : '');
    if ($('呼_大类')) 呼钮们().forEach(function (b) { b.classList.remove('选中'); });
    重置框($('呼_端'), '请先选大类');
    重置框($('呼_对话'), '请先选端');
    if ($('呼弹窗')) $('呼弹窗').classList.remove('隐藏');
  }
  function 呼钮们() { return Array.prototype.slice.call(document.querySelectorAll('#呼_大类 .大类钮')); }
  function 重置框(框, 文本) { if (框) { 框.innerHTML = ''; 框.appendChild(空样(文本)); } }

  function 呼选大类(类) {
    呼_大类 = 类; 呼_端 = null; 呼_对话 = null;
    呼钮们().forEach(function (b) { b.classList.toggle('选中', b.getAttribute('data-类') === 类); });
    重置框($('呼_对话'), '请先选端');
    var 做 = function () {
      var 该类 = 端缓存.filter(function (端) { return (端.类型 || '') === 类; });
      var 框 = $('呼_端');
      if (!框) return;
      框.innerHTML = '';
      if (!该类.length) {
        框.appendChild(空样('该大类下暂无可扫描到的端' + (端缓存.length ? '' : '（可到「设置 · 服务器」切服务器后重试）')));
        return;
      }
      该类.forEach(function (端) {
        var 行d = el('div', '选行');
        行d.appendChild(el('span', null, 端.端名 || '（未知端）'));
        行d.appendChild(el('span', '端标', 端.类型 || ''));
        var 标在 = el('span', '在线标 ' + (端.在线 ? '在线' : '离线'), 端.在线 ? '在线' : '离线');
        行d.appendChild(标在);
        行d.addEventListener('click', function () { 呼选端(端, 行d); });
        框.appendChild(行d);
      });
    };
    if (!端缓存.length) {
      重置框($('呼_端'), '加载中…');
      if (!有接口()) { 重置框($('呼_端'), '接口未就绪'); return; }
      global.接口.端列表().then(function (r) { 端缓存 = (r && r.端) || []; 做(); })
        ['catch'](function (e) { 重置框($('呼_端'), '加载失败：' + e.message); });
    } else {
      做();
    }
  }

  function 呼选端(端, 行元素) {
    呼_端 = 端; 呼_对话 = null;
    var 框 = $('呼_端');
    if (框) Array.prototype.forEach.call(框.children, function (c) { if (c.classList) c.classList.remove('选中'); });
    if (行元素) 行元素.classList.add('选中');
    重置框($('呼_对话'), '加载对话中…');
    拉对话(false);
    开轮询();
  }

  function 键(对话) { return (对话 && (对话.终身号 || 对话.SID || 对话.对话名)) || ''; }
  function 忙闲标(灯) {
    var 值 = (灯 === '忙' || 灯 === '闲') ? 灯 : '未知';
    return el('span', '忙闲标 ' + 值, 值);
  }
  function 拉对话(静默) {
    var 端 = 呼_端;
    if (!端 || !有接口()) return Promise.resolve();
    if (!静默) 重置框($('呼_对话'), '加载对话中…');
    return global.接口.端对话(端.端名).then(function (r) {
      if (呼_端 !== 端) return;      // 端已切换：丢弃过期应答
      画对话((r && r.对话) || []);
    })['catch'](function (e) {
      if (静默) return;
      重置框($('呼_对话'), '加载失败：' + e.message);
    });
  }
  function 画对话(对话s) {
    var 框 = $('呼_对话');
    if (!框) return;
    var 旧键 = 呼_对话 ? 键(呼_对话) : '';
    框.innerHTML = '';
    if (!对话s.length) { 框.appendChild(空样('该端暂无对话')); 呼_对话 = null; return; }
    var 新选 = null;
    对话s.forEach(function (对话) {
      var 行d = el('div', '选行');
      行d.appendChild(el('span', null, 对话.对话名 || '（未命名对话）'));
      行d.appendChild(忙闲标(对话.忙闲));
      行d.addEventListener('click', function () { 呼选对话(对话, 行d); });
      if (旧键 && 键(对话) === 旧键) { 行d.classList.add('选中'); 新选 = 对话; }
      框.appendChild(行d);
    });
    呼_对话 = 新选;
  }
  function 呼选对话(对话, 行元素) {
    呼_对话 = 对话;
    var 框 = $('呼_对话');
    if (框) Array.prototype.forEach.call(框.children, function (c) { if (c.classList) c.classList.remove('选中'); });
    if (行元素) 行元素.classList.add('选中');
  }

  var 轮询间隔毫秒 = 10000;
  function 开轮询() {
    停轮询();
    忙闲轮询 = setInterval(function () {
      var 弹 = $('呼弹窗');
      if (!弹 || 弹.classList.contains('隐藏') || !呼_端) { 停轮询(); return; }
      if (轮询在途) return;
      轮询在途 = true;
      拉对话(true).then(function () { 轮询在途 = false; });
    }, 轮询间隔毫秒);
  }
  function 停轮询() {
    if (忙闲轮询) { clearInterval(忙闲轮询); 忙闲轮询 = null; }
    轮询在途 = false;
  }

  function 提交呼() {
    var 节 = 呼_目标;
    if (!节) return;
    if (节.种 === '清单') { 提示('总管清单不支持单独呼叫 AI，请到它的任务卡上呼叫'); return; }
    if (!呼_端) { 提示('请先选择端'); return; }
    if (!呼_对话) { 提示('请先选择对话'); return; }
    var 节点码 = 节.编号 || '';
    if (!节点码) { 提示('缺少节点编号'); return; }
    var 执行者 = { 端: (呼_端 && 呼_端.端名) || '', 对话: (呼_对话 && 呼_对话.对话名) || '',
                   终身号: (呼_对话 && 呼_对话.终身号) || '' };
    关呼();
    装广播();
    var 连 = false;
    try { 连 = (global.接口.连接状态 && global.接口.连接状态().状态) === '已连'; } catch (e) { }
    置态(节点码, 连 ? '等待服务器回应' : '连接 WS 中', '发送中');
    提示('正在呼叫 AI…');
    global.接口.呼叫AI(节点码, 执行者).then(function (r) {
      if (r && r.ok === false) { 置态(节点码, '发送失败', '发送失败'); 提示('呼叫失败：' + ((r && r.err) || '')); return; }
      置态(节点码, '服务器已接收', '发送中');
      if (节.种 === '任务') { var 新 = (r && r.节点) || {}; if (新.卡片状态) 置态(节点码, '服务器已接收', 新.卡片状态); }
      在途[节点码] = { 时刻: Date.now() };
      提示('服务器已接收，等待投递结果…');
      轮询卡片状态(节点码, 节.种, 0);
    })['catch'](function (e) { 置态(节点码, '发送失败', '发送失败'); 提示('呼叫失败：' + e.message); });
  }

  // 收口①（主）：监听【投递结果】广播帧，按「最近在途呼叫」归属（帧的 编号＝投递卡编号，非节点编号）
  function 装广播() {
    if (广播已装) return;
    if (!(global.接口 && typeof global.接口.订阅广播 === 'function')) return;
    global.接口.订阅广播(function (帧) {
      if (!帧 || 帧.t !== '投递结果') return;
      var 态 = String(帧.状态 || '');
      var 号 = 最近在途();
      if (!号) return;
      var 显 = 态 === '投递成功' ? '投递成功' : (态 === '发送未确认' ? '发送未确认' : '发送失败');
      置态(号, 显, 显 === '投递成功' ? '已送达' : 显);
      delete 在途[号];
      提示(号 + '：' + 显);
    });
    广播已装 = true;
  }
  function 最近在途() {
    var 最新 = null, 时 = 0;
    Object.keys(在途).forEach(function (k) { if (在途[k].时刻 > 时) { 时 = 在途[k].时刻; 最新 = k; } });
    return 最新;
  }

  // 收口②（轮询）：任务 T → 任务详情.卡片状态；小点 P → 点详情.点.卡片状态（服务端暂未暴露则靠 ①）
  function 轮询卡片状态(节点码, 种, 次) {
    if (次 >= 20 || !有接口()) return;
    读节点卡片状态(节点码, 种).then(function (态) {
      if (态 === '已送达') { 置态(节点码, '投递成功', '已送达'); delete 在途[节点码]; 提示('投递成功（' + 节点码 + '）'); return; }
      if (态 === '发送失败') { 置态(节点码, '发送失败', '发送失败'); delete 在途[节点码]; return; }
      if (态 === '发送未确认') { 置态(节点码, '发送未确认', '发送未确认'); delete 在途[节点码]; return; }
      setTimeout(function () { 轮询卡片状态(节点码, 种, 次 + 1); }, 1500);
    })['catch'](function () { setTimeout(function () { 轮询卡片状态(节点码, 种, 次 + 1); }, 1500); });
  }
  function 读节点卡片状态(节点码, 种) {
    if (种 === '点') {
      return global.接口.点详情(节点码).then(function (r) { return ((r && r.点) || {}).卡片状态 || ''; });
    }
    return global.接口.任务详情(节点码).then(function (r) { return ((r && r.任务) || {}).卡片状态 || ''; });
  }

  // 置投递态：记运行时态 + 就地更新该节点卡的胶囊
  function 置态(节点号, 显示态, 卡片状态) {
    投递态[节点号] = { 态: 显示态, 卡片状态: 卡片状态 || '' };
    应用胶囊(document);
  }
  function 应用胶囊(根) {
    if (!根 || !根.querySelectorAll) return;
    Array.prototype.forEach.call(根.querySelectorAll('.卡[data-编号]'), function (卡) {
      var 号 = 卡.dataset.编号 || '';
      var 胶 = 卡.querySelector('[data-胶囊]');
      if (!胶) return;
      var t = 投递态[号];
      if (t && t.态) {
        胶.textContent = t.态;
        胶.className = '状态钮 ' + (胶囊色[t.态] || '');
        胶.title = '投递：' + t.态 + (t.卡片状态 ? '（卡片状态：' + t.卡片状态 + '）' : '');
        胶.style.display = '';
      }
    });
  }

  // ============================================================ 新建清单（顶层一级卡）
  // ⚠ 幂等保护（实测）：WS 通道偶发把同一请求投递两次 → 同秒建出两张同名清单/任务/子点。
  //   这里只清「同名 + 创建时间完全相同」的重复项，保留本次应答返回的编号；不误删刻意建的同名卡。
  function 清理重复清单(保留编号, 名称, 创建) {
    if (!有接口() || !保留编号) return Promise.resolve();
    function 一遍() {
      return global.接口.清单列表('').then(function (r) {
        var 同 = ((r && r.清单列表) || []).filter(function (x) {
          return x.名称 === 名称 && x.编号 !== 保留编号;
        });
        return Promise.all(同.map(function (x) {
          return global.接口.清单详情(x.编号).then(function (d) {
            var c = (d && d.清单) || {};
            if (String(c.名称 || '') === String(名称 || '') && String(c.创建 || '') === String(创建 || '')) {
              return global.接口.清单删除(x.编号);
            }
          })['catch'](function () { });
        }));
      })['catch'](function () { });
    }
    return 一遍().then(function () { setTimeout(一遍, 1300); });
  }
  function 清理重复任务(清单号, 保留编号, 标题, 创建) {
    if (!有接口() || !保留编号 || !清单号) return Promise.resolve();
    function 一遍() {
      return global.接口.清单详情(清单号).then(function (d) {
        var 同 = ((d && d.任务列表) || []).filter(function (x) {
          return x.标题 === 标题 && x.编号 !== 保留编号 && String(x.创建 || '') === String(创建 || '');
        });
        return Promise.all(同.map(function (x) { return global.接口.任务删除(x.编号)['catch'](function () { }); }));
      })['catch'](function () { });
    }
    return 一遍().then(function () { setTimeout(一遍, 1300); });
  }
  function 清理重复子点(父号, 保留编号, 标题) {
    if (!有接口() || !父号) return Promise.resolve();
    function 号(x) { return parseInt(String((x && x.编号) || '').replace(/\D/g, ''), 10) || 0; }
    function 一遍() {
      var 拉 = /^T/.test(String(父号))
        ? global.接口.任务详情(父号).then(function (r) { return (r && r.小点列表) || []; })
        : global.接口.点详情(父号).then(function (r) { return (r && r.子列表) || []; });
      return 拉.then(function (列) {
        列 = (列 || []).slice().sort(function (a, b) { return 号(a) - 号(b); });
        var 删 = [];
        for (var i = 1; i < 列.length; i++) {
          if (列[i - 1].标题 === 列[i].标题 && (号(列[i]) - 号(列[i - 1])) === 1) 删.push(列[i].编号);
        }
        return Promise.all(删.map(function (x) { return global.接口.点删除(x)['catch'](function () { }); }));
      })['catch'](function () { });
    }
    return 一遍().then(function () {
      setTimeout(一遍, 900);
      setTimeout(一遍, 2000);
    });
  }

  function 开新建清单() {
    if ($('新建_标题')) $('新建_标题').value = '';
    if ($('新建_正文')) $('新建_正文').value = '';
    刷新新建计数();
    var 组 = $('新建_类型');
    if (组) Array.prototype.forEach.call(组.children, function (b) { if (b.classList) b.classList.add('选中'); });
    if ($('新建清单弹窗')) $('新建清单弹窗').classList.remove('隐藏');
    try { if ($('新建_标题')) $('新建_标题').focus(); } catch (e) { }
  }
  function 新建类型() {
    var 组 = $('新建_类型');
    if (!组 || !组.children.length) return '总管清单';
    return (组.children[0].getAttribute('data-类') || '总管清单');
  }
  function 定新建清单() {
    var 名 = String(($('新建_标题') && $('新建_标题').value) || '').trim();
    if (!名) { 提示('请填写标题'); return; }
    if (!有接口()) { 提示('接口未就绪'); return; }
    var 文 = String(($('新建_正文') && $('新建_正文').value) || '');
    var 定 = $('新建_确定');
    if (定 && 定.disabled) return;
    if (定) 定.disabled = true;
    global.接口.清单新建(名, 文).then(function (r) {
      if (r && r.ok === false) { 提示('新建失败：' + ((r && r.err) || '')); return; }
      var c = (r && r.清单) || {};
      if ($('新建清单弹窗')) $('新建清单弹窗').classList.add('隐藏');
      提示('已新建：' + (c.名称 || 名) + '（' + (c.类型 || 新建类型()) + '）');
      清单指纹 = '';
      return 清理重复清单(c.编号, c.名称 || 名, c.创建).then(function () { 刷新全量(); });
    })['catch'](function (e) { 提示('新建失败：' + e.message); })
      .then(function () { if (定) 定.disabled = false; });
  }

  // ============================================================ 字数计数（标题 100 / 正文 10000）
  function 计数(输入, 计数元素, 上限) {
    if (!输入 || !计数元素) return;
    计数元素.textContent = String((输入.value || '').length) + '/' + 上限;
  }
  function 刷新新建计数() {
    计数($('新建_标题'), $('新建_标题数'), 100);
    计数($('新建_正文'), $('新建_正文数'), 10000);
  }
  function 刷新增卡计数() {
    计数($('加卡_标题'), $('加卡_标题数'), 100);
    计数($('加卡_正文'), $('加卡_正文数'), 10000);
  }

  // ============================================================ 装配 / 对外
  function 点新建() {
    if (页栈.length) {
      var 顶 = 页栈[页栈.length - 1];
      开加卡(顶.节点, 顶.层级);
    } else {
      开新建清单();
    }
  }

  // 0.04：多服务器时「自动」优先新版——旧版抢先应答后，等新版报到/稍后校正一次，改用新版数据
  var 已见最高版 = 0;
  var 已校正 = false;
  function 版本数(v) { var m = /^(\d+)\.(\d+)/.exec(String(v || '')); return m ? (+m[1] * 100 + +m[2]) : 0; }
  function 订阅新版服务器() {
    if (!(global.接口 && typeof global.接口.订阅服务器 === 'function')) return;
    global.接口.订阅服务器(function (表) {
      var 最 = 0;
      (表 || []).forEach(function (x) { if (x && x.在线) { var n = 版本数(x.版本); if (n > 最) 最 = n; } });
      var 旧 = 已见最高版;
      if (最 > 已见最高版) 已见最高版 = 最;
      if (最 > 旧 && 旧 > 0 && !全局选中()) 重载();     // 新版上线 → 自动模式改用新版
    });
  }
  function 全局选中() { try { return (global.接口.选中服务器() || {}).实例号 || ''; } catch (e) { return ''; } }
  function 校正应答服务器() {
    if (已校正) return;
    if (!(global.接口 && global.接口.最近应答) || 全局选中()) return;
    var 应 = global.接口.最近应答();
    if (!应) return;
    var 表 = global.接口.服务器列表() || [], 应版 = 0, 最 = 0;
    表.forEach(function (x) {
      if (!x || !x.在线) return;
      var n = 版本数(x.版本);
      if (n > 最) 最 = n;
      if (String(x.实例号) === String(应)) 应版 = n;
    });
    if (应版 > 0 && 最 > 应版) { 已校正 = true; 重载(); }   // 应答方不是最新版 → 只重取一次
  }

  function 装配() {
    装广播();
    订阅新版服务器();
    setTimeout(校正应答服务器, 6000);
    if ($('按钮_新建')) $('按钮_新建').addEventListener('click', 点新建);
    if ($('按钮_返回主页')) $('按钮_返回主页').addEventListener('click', 回主页);
    if ($('按钮_返回上级')) $('按钮_返回上级').addEventListener('click', 返回上级);
    if ($('节点页_新建')) $('节点页_新建').addEventListener('click', 点新建);
    if ($('新建_取消')) $('新建_取消').addEventListener('click', function () { $('新建清单弹窗').classList.add('隐藏'); });
    if ($('新建_确定')) $('新建_确定').addEventListener('click', 定新建清单);
    if ($('新建_标题')) $('新建_标题').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 定新建清单(); } });
    if ($('新建_标题')) $('新建_标题').addEventListener('input', 刷新新建计数);
    if ($('新建_正文')) $('新建_正文').addEventListener('input', 刷新新建计数);
    if ($('加卡_取消')) $('加卡_取消').addEventListener('click', function () { $('加卡弹窗').classList.add('隐藏'); });
    if ($('加卡_确定')) $('加卡_确定').addEventListener('click', 定加卡);
    if ($('加卡_标题')) $('加卡_标题').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 定加卡(); } });
    if ($('加卡_标题')) $('加卡_标题').addEventListener('input', 刷新增卡计数);
    if ($('加卡_正文')) $('加卡_正文').addEventListener('input', 刷新增卡计数);
    if ($('呼_取消')) $('呼_取消').addEventListener('click', 关呼);
    if ($('呼_确认')) $('呼_确认').addEventListener('click', 提交呼);
    呼钮们().forEach(function (b) {
      b.addEventListener('click', function () { 呼选大类(b.getAttribute('data-类')); });
    });
    if ($('备注_取消')) $('备注_取消').addEventListener('click', function () { $('备注弹窗').classList.add('隐藏'); });
    显主页();
    刷新新建计数();
    刷新增卡计数();
  }

  // 换应答服务器后由 面板.js 调用：清缓存、按当前页面重载
  function 重载() {
    子缓存 = {};
    已取 = {};
    清单指纹 = '';
    if (页栈.length) return 画节点页(true);
    return 载入主页(true);
  }

  global.清单页 = {
    版本: 版本,
    装配: 装配,
    载入主页: 载入主页,
    回主页: 回主页,
    重载: 重载,
    取投递态: function (编号) { return 投递态[编号] ? 复制(投递态[编号]) : null; }
  };
})(window);
