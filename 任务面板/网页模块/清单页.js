/* ============================================================
 * 【任务面板】网页模块 · 清单页.js
 * 版本：0.01
 * 职责：用户 2026-10-20「清单流水账」口径的【页面逻辑层】——
 *   · 主页＝清单小方块堆叠（长方形扁卡片、可无限向下）：每块显示【清单名称＋类型（总管清单）】
 *     ＋任务数/未完成数；点它进该清单。
 *   · 左上角【新建】：弹窗选类型（当前只有「总管清单」）→ 输入清单名称 → 创建（自动带类型名）。
 *   · 清单内页：小卡片列表，一张小卡＝一个任务——标题占两行位置＋详情；底部一排按钮
 *     【查看详细情况】/【快速备注】(未开始·进行中·已完成·已放弃)/【分子任务】/【呼叫 AI 负责本卡片】/
 *     〔删除〕；页面有【返回主页】。
 *   · 树状·可无限拆分：【分子任务】展开子卡（与主卡同构、略缩进略窄），子卡自己还能再展开子卡、
 *     不限层数（服务端小点 `P` 有 `父`/`子` 字段，天然成树，本页递归渲染）。
 *   · 每张卡（含各级子任务）都可单独【呼叫 AI 负责本卡片】：点它才弹窗选 AI（端/对话/终身号，
 *     同旧发布弹窗的选端/选对话）→ 确认后调 `接口.呼叫AI(节点,执行者)`（节点 `T…`/`P…` 皆可）；
 *     卡片胶囊四段（连接 WS 中 → 等待服务器回应 → 服务器已接收 → 投递成功；失败＝发送失败/发送未确认）：
 *     **应答驱动前三段**，再用【点详情/任务详情】轮询 `卡片状态`（已送达→投递成功）收口——
 *     另并行监听【投递结果】广播帧作主收口（见下「收口」说明）。
 * 说明：纯 DOM；复用 任务面板.html 的 .卡/.卡头/.内容/.按钮排/.小钮/.遮罩/.弹窗 等样式，
 *   并复用 `卡片.自适应` 实现「满宽 / 高度上限＝自身宽 / 截断 / 手动展开」。
 * 依赖：接口.js（清单库路由封装）、卡片.js（自适应）。
 *
 * ★★ 与后端实况的对齐（服务端 网页服务.py 0.13 / 清单存储 0.02，以能跑通为准）★★
 *   1) 小点 `P` 天然成树：`{编号,父,标题,完成,子,任务}`——父可＝任务 `T…` 或某点 `P…`、**不限层数**。
 *      本页取树：任务→`接口.任务详情(T).小点列表`（直系子）；某点→`接口.点详情(P).子列表`（直系子）；
 *      递归下行，**无需再自建父子表**（早期草案的 localStorage 兼容方案已不需要）。
 *   2) 服务端 `call_ai` 的节点可＝`T…`/`P…`；投递文本＝《清单存储.派发文本》(标题＋详情＋整棵子树逐层清单)。
 *   3) **收口（第四段「投递成功」）双通道**：①监听【投递结果】广播帧（`{t:"投递结果",状态:投递成功|发送未确认|发送失败}`）
 *      ——受理/结果帧的 `编号`＝投递卡编号（非节点编号），本页按「最近一次在途呼叫」归属；②轮询
 *      「任务详情(T).卡片状态」/「点详情(P).点.卡片状态」。**已知服务端缺口**：`清单存储 0.02` 的
 *      `_点视图` **未暴露 `卡片状态`**，故小点自身的 `卡片状态` 经 `点详情` 读不到——此时以 ① 广播帧为准；
 *      任务 `T` 的 `卡片状态` 经 `任务详情` 可正常读到。
 * 维护记录：
 *   · 0.01（2026-10-20）首版（清单库大重构 · 前端页面层）。承载「清单流水账」主页/清单内页/
 *     树状子卡/呼叫 AI 四段胶囊；与 接口.js 0.09、面板.js 0.17、任务面板.html 0.19 配套。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.01';

  // ---------------- 状态 ----------------
  var 当前清单 = null;       // 进入的清单 dict（{编号,名称,类型,…}）
  var 清单版本 = '';         // 清单列表「版本指纹」（差额：无变化不重绘）
  var 任务缓存 = [];         // 当前清单的任务摘要列表
  var 点树缓存 = {};         // 任务号 -> 该任务的小点树（嵌套：子卡 挂在 `子卡`）
  var 端缓存 = [];           // 端列表（供「呼叫 AI」选端）
  var 呼_目标 = null;        // 「呼叫 AI」当前目标节点
  var 呼_大类 = null, 呼_端 = null, 呼_对话 = null;
  var 忙闲轮询 = null, 轮询在途 = false;   // 「选择对话」忙闲 10 秒轮询
  var 加卡_后端 = null;      // 「加卡弹窗」用途：{类型:'任务'|'子卡', 父, 清单}

  // 投递四段状态机（本页运行时态）：节点编号 -> {态, 卡片状态}。应答驱动前三段、轮询/广播收口第四段。
  var 投递态 = {};
  var 胶囊色 = {
    '连接 WS 中': '态终', '连接WS中': '态终',
    '等待服务器回应': '态中', '服务器已接收': '态好',
    '投递成功': '态好', '发送失败': '态失败', '发送未确认': '态中'
  };
  // 在途呼叫（收口用）：节点编号 -> {时刻}。广播「投递结果」按其编号归属到最近一次在途呼叫。
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
  function 加载中(框, 文本) { if (框) { 框.innerHTML = ''; 框.appendChild(空样(文本 || '加载中…')); } }
  function 失败(框, e) { if (框) { 框.innerHTML = ''; 框.appendChild(空样('加载失败：' + ((e && e.message) || e))); } }

  // ============================================================ 主页（清单堆叠）
  function 载入主页(强制) {
    if (!有接口()) return Promise.resolve();
    return global.接口.清单列表(强制 ? '' : 清单版本).then(function (r) {
      if (r && r.版本) 清单版本 = r.版本;
      if (r && r.未变 && !强制) return;      // 差额：无变化不重绘
      画清单((r && r.清单列表) || []);
    }).catch(function (e) {
      失败($('清单列表'), e);
      if ($('清单计数')) $('清单计数').textContent = '';
    });
  }

  function 画清单(列表) {
    var 框 = $('清单列表');
    if (!框) return;
    框.innerHTML = '';
    if (!列表.length) {
      框.appendChild(空样('还没有清单，点左上角【新建】建一张'));
      if ($('清单计数')) $('清单计数').textContent = '';
      return;
    }
    列表.forEach(function (c) {
      var 卡 = el('div', '清单卡');
      卡.dataset.编号 = c.编号 || '';
      卡.appendChild(el('span', '名', c.名称 || '（未命名清单）'));
      卡.appendChild(el('span', '类', c.类型 || '总管清单'));
      var 数 = el('span', '数');
      数.appendChild(document.createTextNode('任务 ' + (c.任务数 || 0) + ' · 未完成 '));
      数.appendChild(el('span', '未', String(c.未完成数 || 0)));
      卡.appendChild(数);
      卡.appendChild(el('span', '箭', '›'));
      卡.addEventListener('click', function () { 进清单(c); });
      框.appendChild(卡);
    });
    if ($('清单计数')) $('清单计数').textContent = '共 ' + 列表.length + ' 张';
  }

  // ============================================================ 清单内页
  function 进清单(清单) {
    当前清单 = 清单 || {};
    点树缓存 = {};
    if ($('内页_清单名')) $('内页_清单名').textContent = 当前清单.名称 || '（未命名清单）';
    if ($('内页_清单类型')) $('内页_清单类型').textContent = 当前清单.类型 || '';
    if ($('主页')) $('主页').classList.add('隐藏');
    if ($('清单页')) $('清单页').classList.remove('隐藏');
    加载中($('任务列表'), '加载中…');
    清单载入(true);
  }

  function 回主页() {
    当前清单 = null;
    停轮询();
    if ($('清单页')) $('清单页').classList.add('隐藏');
    if ($('主页')) $('主页').classList.remove('隐藏');
    载入主页(true);
  }

  function 清单载入(强制) {
    var 号 = 当前清单 && 当前清单.编号;
    if (!号 || !有接口()) return Promise.resolve();
    return global.接口.清单详情(号).then(function (r) {
      if (!当前清单 || 当前清单.编号 !== 号) return;      // 已切走
      if (!r || r.ok === false) {
        画任务([]);
        提示('清单加载失败：' + ((r && r.err) || ''));
        return;
      }
      var 清单 = r.清单 || {};
      当前清单 = 复制(清单); 当前清单.编号 = 清单.编号 || 号;
      if ($('内页_清单名')) $('内页_清单名').textContent = 当前清单.名称 || '（未命名清单）';
      if ($('内页_清单类型')) $('内页_清单类型').textContent = 当前清单.类型 || '';
      任务缓存 = r.任务列表 || [];
      return 载点树(任务缓存).then(function () { 画任务(任务缓存); });
    }).catch(function (e) {
      画任务([]);
      提示('清单加载失败：' + e.message);
    });
  }

  // 拉每个任务的【完整任务 + 整棵小点树】
  // ⚠ 服务端 `list_get` 的 `任务列表` 是**摘要**（不含 `详情`/`执行者`），故这里逐任务再取一次
  //   `task_get`（返回 `{任务(全字段), 小点列表}`）——否则卡片「详情」会永远是空。
  function 载点树(任务列表) {
    var 们 = (任务列表 || []).map(function (t) {
      var 号 = t.编号 || '';
      return global.接口.任务详情(号).then(function (r) {
        var 全 = (r && r.任务) || {};
        if (全 && 全.编号) {
          for (var k in 全) { if (Object.prototype.hasOwnProperty.call(全, k)) t[k] = 全[k]; }
        }
        return 载子树(号).then(function (树) { 点树缓存[号] = 树; });
      }).catch(function () { 点树缓存[号] = []; });
    });
    return Promise.all(们);
  }
  function 载子树(父号) {
    var p;
    if (/^T/.test(String(父号))) {
      p = global.接口.任务详情(父号).then(function (r) { return (r && r.小点列表) || []; });
    } else {
      p = global.接口.点详情(父号).then(function (r) { return (r && r.子列表) || []; });
    }
    return p.then(function (列) {
      return Promise.all((列 || []).map(function (x) {
        x = 复制(x); x.子卡 = [];
        if (x.子 && x.子.length) {
          return 载子树(x.编号).then(function (子) { x.子卡 = 子; return x; });
        }
        return x;
      }));
    });
  }

  function 画任务(列表) {
    var 框 = $('任务列表');
    if (!框) return;
    框.innerHTML = '';
    if (!列表.length) {
      框.appendChild(空样('这个清单还没有任务，点右上角【＋ 新建任务】加一张'));
      return;
    }
    列表.forEach(function (t) { 框.appendChild(建任务卡组(t)); });
    if (global.卡片 && typeof global.卡片.自适应 === 'function') global.卡片.自适应(框);
    应用胶囊(框);        // 把运行时投递态补显到对应节点卡
  }

  // 一张任务小卡组：任务卡 + 其下【不限层数】的子卡树
  function 建任务卡组(t) {
    var 组 = el('div', '卡组');
    组.appendChild(建卡({ 类型: '任务', 编号: t.编号, 标题: t.标题, 详情: t.详情 || '',
                          状态: t.状态, 卡片状态: t.卡片状态, 所属任务: t.编号 }, {}));
    var 子组 = el('div', '子卡组');
    (点树缓存[t.编号] || []).forEach(function (p) { 子组.appendChild(建点节点(p, t.编号)); });
    组.appendChild(子组);
    return 组;
  }

  // 一个子卡节点（递归：每个子卡自己还能带一层子卡组）
  function 建点节点(p, 任务号) {
    var 卡 = 建卡({ 类型: '小点', 编号: p.编号, 标题: p.标题, 完成: !!p.完成,
                    所属任务: 任务号 }, {});
    if (p.子卡 && p.子卡.length) {
      var 组 = el('div', '子卡组');
      p.子卡.forEach(function (c) { 组.appendChild(建点节点(c, 任务号)); });
      卡.appendChild(组);
    }
    return 卡;
  }

  // ============================================================ 卡片（任务/子点 同构）
  function 建卡(节点, 选项) {
    var 是点 = 节点.类型 === '小点';
    var 卡 = el('div', '卡 ' + (是点 ? '点卡' : '主卡') + (是点 && 节点.完成 ? ' 完成' : ''));
    卡.dataset.编号 = 节点.编号 || '';
    卡.dataset.类型 = 节点.类型;

    var 头 = el('div', '卡头');
    头.appendChild(el('span', '编号', 节点.编号 || ''));
    头.appendChild(el('span', '端标', 是点 ? '子任务' : '任务'));
    var 胶 = el('span', '状态钮', '');
    胶.dataset.胶囊 = '1';
    胶.style.display = 'none';
    头.appendChild(胶);
    卡.appendChild(头);

    // 标题（占两行位置）＋ 副行 ＋ 详情
    卡.appendChild(el('div', '卡标题', 节点.标题 || '（无标题）'));
    if (!是点 && 节点.状态) 卡.appendChild(el('div', '卡副', '状态：' + 节点.状态));
    if (!是点 && String(节点.详情 || '').trim()) {
      var 详 = el('textarea', '内容');
      详.readOnly = true;
      详.value = 节点.详情;
      卡.appendChild(详);
    }

    // 底部按钮排
    var 排 = el('div', '按钮排');
    排.appendChild(钮('查看详细情况', '小钮', function () { 查看详情(节点); }));
    if (是点) {
      排.appendChild(钮(节点.完成 ? '↺ 标未完成' : '✓ 标完成', '小钮', function () { 切点完成(节点); }));
    } else {
      排.appendChild(钮('快速备注', '小钮', function () { 开备注(节点); }));
    }
    排.appendChild(钮('分子任务', '小钮', function () { 开加卡('子卡', 节点); }));
    排.appendChild(钮('呼叫 AI 负责本卡片', '小钮', function () { 开呼(节点); }));
    排.appendChild(钮('删除', '小钮', function () { 删卡(节点); }));
    if (!是点) {
      var 展 = 钮('展开 ▾', '小钮 展开钮', function () {
        var 开 = 卡.classList.toggle('展开');
        展.textContent = 开 ? '收起 ▴' : '展开 ▾';
        if (global.卡片 && global.卡片.自适应) global.卡片.自适应(卡);
      });
      排.appendChild(展);
    }
    卡.appendChild(排);
    return 卡;
  }

  // ============================================================ 快速备注（任务状态四档）
  var 状态枚举 = ['未开始', '进行中', '已完成', '已放弃'];
  function 开备注(节点) {
    if ($('备注_节点')) $('备注_节点').textContent = (节点.编号 || '') + '（' + (节点.标题 || '') + '）';
    var 组 = $('备注_组');
    if (!组) return;
    组.innerHTML = '';
    状态枚举.forEach(function (态) {
      var b = el('button', '选行' + (节点.状态 === 态 ? ' 选中' : ''), 态);
      b.addEventListener('click', function () { 设状态(节点, 态); });
      组.appendChild(b);
    });
    if ($('备注弹窗')) $('备注弹窗').classList.remove('隐藏');
  }
  function 设状态(节点, 态) {
    if (!有接口()) { 提示('接口未就绪'); return; }
    global.接口.任务状态(节点.编号, 态).then(function (r) {
      if (r && r.ok === false) { 提示('设状态失败：' + ((r && r.err) || '')); return; }
      节点.状态 = 态;
      提示('已置：' + 态 + '（' + 节点.编号 + '）');
      if ($('备注弹窗')) $('备注弹窗').classList.add('隐藏');
      清单载入(true);
    }).catch(function (e) { 提示('设状态失败：' + e.message); });
  }

  // ============================================================ 分子任务 / 新建任务（加卡弹窗）
  function 开加卡(类型, 父节点) {
    加卡_后端 = { 类型: 类型, 父: 父节点 || null, 清单: 当前清单 && 当前清单.编号 };
    if ($('加卡_题')) $('加卡_题').textContent = (类型 === '任务' ? '新建任务' : '新建子任务 · ' + ((父节点 && 父节点.编号) || ''));
    if ($('加卡_详情行')) $('加卡_详情行').classList.toggle('隐藏', 类型 !== '任务');
    if ($('加卡_标题')) $('加卡_标题').value = '';
    if ($('加卡_详情')) $('加卡_详情').value = '';
    if ($('加卡弹窗')) $('加卡弹窗').classList.remove('隐藏');
    try { if ($('加卡_标题')) $('加卡_标题').focus(); } catch (e) { }
  }
  function 定加卡() {
    var 后端 = 加卡_后端;
    if (!后端) return;
    var 标 = String(($('加卡_标题') && $('加卡_标题').value) || '').trim();
    if (!标) { 提示('请填写标题'); return; }
    var 定 = $('加卡_确定');
    if (定 && 定.disabled) return;
    if (定) 定.disabled = true;
    var 完 = function () { if (定) 定.disabled = false; };
    if (后端.类型 === '任务') {
      var 详 = String(($('加卡_详情') && $('加卡_详情').value) || '').trim();
      global.接口.任务新建(后端.清单, 标, 详).then(function (r) {
        if (r && r.ok === false) { 提示('新建任务失败：' + ((r && r.err) || '')); 完(); return; }
        var x = (r && r.任务) || {};
        if ($('加卡弹窗')) $('加卡弹窗').classList.add('隐藏');
        提示('已新建任务');
        return 清理重复任务(后端.清单, x.编号, x.标题 || 标, x.创建)
          .then(function () { return 清单载入(true); }).then(完);
      }).catch(function (e) { 提示('新建任务失败：' + e.message); 完(); });
      return;
    }
    // 子卡：父可为任务 T… 或某点 P…（服务端 0.13 支持无限层）
    var 父 = 后端.父;
    if (!父 || !父.编号) { 提示('缺少父卡片'); 完(); return; }
    global.接口.子点新建(父.编号, 标).then(function (r) {
      if (r && r.ok === false) { 提示('新建子卡失败：' + ((r && r.err) || '')); 完(); return; }
      var x = (r && r.小点) || {};
      if ($('加卡弹窗')) $('加卡弹窗').classList.add('隐藏');
      提示('已加子卡' + (x.编号 ? '：' + x.编号 : ''));
      return 清理重复子点(父.编号, x.编号, x.标题 || 标)
        .then(function () { return 清单载入(true); }).then(完);
    }).catch(function (e) { 提示('新建子卡失败：' + e.message); 完(); });
  }

  // ============================================================ 子点：完成切换 / 删除
  function 切点完成(节点) {
    if (!有接口()) { 提示('接口未就绪'); return; }
    global.接口.点切换(节点.编号, !节点.完成).then(function (r) {
      if (r && r.ok === false) { 提示('切换失败：' + ((r && r.err) || '')); return; }
      节点.完成 = !节点.完成;
      提示(节点.编号 + '：' + (节点.完成 ? '已完成' : '未完成'));
      清单载入(true);
    }).catch(function (e) { 提示('切换失败：' + e.message); });
  }

  function 删卡(节点) {
    var 是点 = 节点.类型 === '小点';
    var 问 = '确实要删除 ' + (是点 ? '子卡' : '任务') + ' ' + 节点.编号 + '？不可撤销'
      + (是点 ? '（连同其全部子卡）' : '（连同其全部子卡）');
    if (!global.confirm(问)) return;
    if (!有接口()) { 提示('接口未就绪'); return; }
    var 调 = 是点 ? global.接口.点删除 : global.接口.任务删除;
    调(节点.编号).then(function (r) {
      if (r && r.ok === false) { 提示('删除失败：' + ((r && r.err) || '')); return; }
      提示('已删除 ' + 节点.编号);
      清单载入(true);
    }).catch(function (e) { 提示('删除失败：' + e.message); });
  }

  // ============================================================ 查看详细情况
  function 查看详情(节点) {
    var 盒 = el('div');
    盒.appendChild(行('编号', 节点.编号));
    盒.appendChild(行('类型', 节点.类型 === '小点' ? '子任务（小点）' : '任务（小卡）'));
    盒.appendChild(行('标题', 节点.标题));
    if (节点.类型 !== '小点') 盒.appendChild(行('详情', 节点.详情));
    if (节点.类型 !== '小点') 盒.appendChild(行('状态', 节点.状态));
    if (节点.类型 === '小点') 盒.appendChild(行('完成', 节点.完成 ? '已完成' : '未完成'));
    盒.appendChild(行('卡片状态', 取显示卡片状态(节点)));
    盒.appendChild(行('所属清单', 当前清单 ? ((当前清单.名称 || '') + '（' + (当前清单.类型 || '') + '）') : ''));
    if (节点.类型 === '小点') 盒.appendChild(行('所属任务', 节点.所属任务 || ''));
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
  function 开呼(节点) {
    呼_目标 = 节点;
    呼_大类 = null; 呼_端 = null; 呼_对话 = null;
    if ($('呼_节点')) $('呼_节点').textContent = (节点.编号 || '') + '（' + (节点.类型 === '小点' ? '子任务' : '任务') + '）'
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
        .catch(function (e) { 重置框($('呼_端'), '加载失败：' + e.message); });
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
    }).catch(function (e) {
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

  // 确认呼叫：应答驱动前三段（连接 WS 中→等待服务器回应→服务器已接收），再双通道收口第四段
  function 提交呼() {
    var 节 = 呼_目标;
    if (!节) return;
    if (!呼_端) { 提示('请先选择端'); return; }
    if (!呼_对话) { 提示('请先选择对话'); return; }
    var 节点码 = 节.编号 || '';
    if (!节点码) { 提示('缺少节点编号'); return; }
    // ⚠ 先固化执行者，再关弹窗（关呼() 会把 呼_端/呼_对话 置空，故绝不能在其后拼执行者）
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
      置态(节点码, '服务器已接收', '发送中');     // 应答到达＝服务端已受理（第三段）
      if (节.类型 !== '小点') { var 新 = (r && r.节点) || {}; if (新.卡片状态) 置态(节点码, '服务器已接收', 新.卡片状态); }
      在途[节点码] = { 时刻: Date.now() };          // 登记在途，供广播「投递结果」归属
      提示('服务器已接收，等待投递结果…');
      轮询卡片状态(节点码, 节.类型, 0);
      清单载入(true);                              // 刷新以带上执行者/卡片状态
    }).catch(function (e) { 置态(节点码, '发送失败', '发送失败'); 提示('呼叫失败：' + e.message); });
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

  // 收口②（轮询）：任务 T → 任务详情.卡片状态；小点 P → 点详情.点.卡片状态（服务端 _点视图 暂未暴露）。
  //   读到空串时不视为失败，继续等（广播帧通常先到）；点读不到时不再无限等，靠 ① 广播收口。
  function 轮询卡片状态(节点码, 类型, 次) {
    if (次 >= 20 || !有接口()) return;
    读节点卡片状态(节点码, 类型).then(function (态) {
      if (态 === '已送达') { 置态(节点码, '投递成功', '已送达'); delete 在途[节点码]; 提示('投递成功（' + 节点码 + '）'); return; }
      if (态 === '发送失败') { 置态(节点码, '发送失败', '发送失败'); delete 在途[节点码]; return; }
      if (态 === '发送未确认') { 置态(节点码, '发送未确认', '发送未确认'); delete 在途[节点码]; return; }
      setTimeout(function () { 轮询卡片状态(节点码, 类型, 次 + 1); }, 1500);
    }).catch(function () { setTimeout(function () { 轮询卡片状态(节点码, 类型, 次 + 1); }, 1500); });
  }
  function 读节点卡片状态(节点码, 类型) {
    if (类型 === '小点') {
      return global.接口.点详情(节点码).then(function (r) { return ((r && r.点) || {}).卡片状态 || ''; });
    }
    return global.接口.任务详情(节点码).then(function (r) { return ((r && r.任务) || {}).卡片状态 || ''; });
  }

  // 置投递态：记运行时态 + 就地更新该节点卡的胶囊（卡不在 DOM 时，重绘后由 应用胶囊 补显）
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

  // ============================================================ 新建清单
  // ⚠ 幂等保护（实测）：WS 通道偶发把同一请求**投递两次**（服务端会执行两次 → 同一秒建出两张同名清单/
  //   任务/子点；HTTP 单次只建 1 条，证明是通道层重复投递，非业务层）。本页在每次「创建成功」后做一次
  //   **同秒同名去重**：仅删除「同名 + 创建时间精确相同」的重复项，保留本次应答返回的编号。
  //   仅清重复、不误删用户刻意建的同名卡片（创建时间不同者一律不动）。
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
  // 子点去重：扫「父节点直接子」中【同标题 且 编号相邻(差 1)】的重复（通道双投递的特征），保留较小号。
  //   连扫 3 遍（立即 / +0.9s / +2.0s），覆盖「重复条目迟到」的情况。
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
    if ($('新建_名称')) $('新建_名称').value = '';
    var 组 = $('新建_类型');
    if (组) Array.prototype.forEach.call(组.children, function (b) { if (b.classList) b.classList.add('选中'); });
    if ($('新建清单弹窗')) $('新建清单弹窗').classList.remove('隐藏');
    try { if ($('新建_名称')) $('新建_名称').focus(); } catch (e) { }
  }
  function 新建类型() {
    var 组 = $('新建_类型');
    if (!组 || !组.children.length) return '总管清单';
    return (组.children[0].getAttribute('data-类') || '总管清单');
  }
  function 定新建清单() {
    var 名 = String(($('新建_名称') && $('新建_名称').value) || '').trim();
    if (!名) { 提示('请输入清单名称'); return; }
    if (!有接口()) { 提示('接口未就绪'); return; }
    var 定 = $('新建_确定');
    if (定 && 定.disabled) return;
    if (定) 定.disabled = true;
    global.接口.清单新建(名).then(function (r) {
      if (r && r.ok === false) { 提示('新建失败：' + ((r && r.err) || '')); return; }
      var c = (r && r.清单) || {};
      if ($('新建清单弹窗')) $('新建清单弹窗').classList.add('隐藏');
      提示('已新建：' + (c.名称 || 名) + '（' + (c.类型 || 新建类型()) + '）');
      清单版本 = '';
      return 清理重复清单(c.编号, c.名称 || 名, c.创建).then(function () { 载入主页(true); });
    }).catch(function (e) { 提示('新建失败：' + e.message); })
      .then(function () { if (定) 定.disabled = false; });
  }

  // ============================================================ 装配 / 对外
  function 装配() {
    装广播();
    if ($('按钮_新建')) $('按钮_新建').addEventListener('click', 开新建清单);
    if ($('按钮_返回主页')) $('按钮_返回主页').addEventListener('click', 回主页);
    if ($('按钮_新建任务')) $('按钮_新建任务').addEventListener('click', function () { 开加卡('任务', null); });
    if ($('新建_取消')) $('新建_取消').addEventListener('click', function () { $('新建清单弹窗').classList.add('隐藏'); });
    if ($('新建_确定')) $('新建_确定').addEventListener('click', 定新建清单);
    if ($('新建_名称')) $('新建_名称').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 定新建清单(); } });
    if ($('加卡_取消')) $('加卡_取消').addEventListener('click', function () { $('加卡弹窗').classList.add('隐藏'); });
    if ($('加卡_确定')) $('加卡_确定').addEventListener('click', 定加卡);
    if ($('加卡_标题')) $('加卡_标题').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 定加卡(); } });
    if ($('呼_取消')) $('呼_取消').addEventListener('click', 关呼);
    if ($('呼_确认')) $('呼_确认').addEventListener('click', 提交呼);
    呼钮们().forEach(function (b) {
      b.addEventListener('click', function () { 呼选大类(b.getAttribute('data-类')); });
    });
    if ($('备注_取消')) $('备注_取消').addEventListener('click', function () { $('备注弹窗').classList.add('隐藏'); });
  }

  // 换应答服务器后由 面板.js 调用：重载当前视图
  function 重载() {
    清单版本 = '';
    点树缓存 = {};
    if (当前清单) 清单载入(true); else 载入主页(true);
  }

  global.清单页 = {
    版本: 版本,
    装配: 装配,
    载入主页: 载入主页,
    进清单: 进清单,
    回主页: 回主页,
    开新建清单: 开新建清单,
    重载: 重载,
    当前清单: function () { return 当前清单 ? 复制(当前清单) : null; },
    取投递态: function (编号) { return 投递态[编号] ? 复制(投递态[编号]) : null; }
  };
})(window);
