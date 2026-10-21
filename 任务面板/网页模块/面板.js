/* ============================================================
 * 【任务面板】网页模块 · 面板.js
 * 版本：0.20
 * 职责：页面【装配层】——《软件架构设计》§6 手机网页版。
 *   · 顶栏：左【新建】【返回主页】、中题名+【网页版版本（唯一）】+角色、右【设置】。
 *   · 【设置】菜单：收纳 **服务器选择**（含在线/离线小标）＋**口令**钮＋**版本**（「网页版 v… | 服务器 v…」）。
 *     服务器/本地版版本号显示在设置里；主页顶栏只显示一个版本号（网页版版本，与本页 <meta> 同源）。
 *   · 角色脚标：ping 成功→「已连接」（不再并列服务端版本号）；未连/频道通了没应答/通道失败 如实提示。
 *   · §19 口令：首登窗 + 设置里的「重设口令」（频道＝前缀+口令，运行时拼）。
 *   · 页面主体（主页清单 / 唯一卡片 / 细分跳页 / 呼叫 AI）交由 `清单页.js`（0.03）承载：
 *     本层只在首载时调 `清单页.载入主页()`、切服务器后调 `清单页.重载()`、并把 `提示` 借给它用。
 * 说明：纯 DOM，不引外部 CDN。依赖：接口.js、卡片.js、清单页.js（须先加载）。
 * 维护记录：
 *   · 0.20（2026-10-20）按用户口径：**设置项自动落盘、不随版本升级清理**（「设置这个按钮里面的，
 *     保存的项目要自动落盘，不随版本换或升级而清理」）——装配时先 `接口.设置读取()` 把服务端
 *     使用痕迹里存的 口令/服务器选择 补回本地（本地没有才用），切换服务器/确认口令后 `保存设置()`
 *     自动写回（服务端 `settings_set`，落 任务面板配置.json 的 `网页设置`）。
 *   · 0.19（2026-10-20）**配合「单排按钮 + 展开看正文 + 细分跳页」**（用户 2026-10-20 口径）：
 *     页面主体改由 `清单页.js` 0.03 承载（按钮排一行；【展开】在卡内展示正文；【细分】整页切到
 *     该卡的下级页面；新建填标题≤100＋正文≤10000）；本层装配逻辑不变。顶栏三处版本号与 <meta>、
 *     四个 `?v=` 同步升 0.21（见 任务面板.html 0.21）。
 *   · 0.18（2026-10-20）**配合「只有一种卡片 + 递归容器」**（用户 2026-10-20 纠正口径）：
 *     顶栏新增【返回主页】钮（回顶层/全部收起，由 清单页.js 0.02 绑定）；顶栏仍只显示**一个**
 *     网页版版本号；设置里保留服务器选择与服务器版本。页面主体改由 `清单页.js` 0.02 承载
 *     （全层级同一张卡：一级卡也带完整按钮排，含删除/拆分/呼叫 AI；【拆分子任务】展开递归容器）。
 *     顶栏三处版本号与 <meta>、四个 `?v=` 同步升 0.20（见 任务面板.html 0.20）。
 *   · 0.17（2026-10-20）**清单库大重构配套**（用户 2026-10-20 口径）：页面主体迁出——原「端列表 /
 *     任务卡片 / 发布任务」页改为【清单流水账】，主体逻辑（主页清单堆叠、清单内页、树状子卡、
 *     呼叫 AI 四段胶囊）交新模块 `清单页.js`（0.01）；本层精简为「装配层」：顶栏（左新建/右设置）、
 *     设置菜单（服务器选择＋口令＋版本）、角色脚标、口令窗、启动装配。`接口.呼叫AI/清单库路由`
 *     见 接口.js 0.09；顶栏三处版本号与 <meta>、四个 `?v=` 同步升 0.19（见 任务面板.html 0.19）。
 *   · 0.16（2026-10-20）用户修订口径：**主页顶栏只显示【网页版版本】**；**服务器（本地）版本收进
 *     【设置】菜单**显示（**不在主页并列**）——新增**右上角「设置」菜单**（`装设置()` 装配 + 开合、
 *     点外部自动收起），把**服务器选择**（含在线/离线小标）与**口令**钮**移入设置**；`载角色()` ping
 *     成功后把 `r.版本` 写入设置的「服务器版本」，**不再写顶栏**。设置内版本＝「网页版 v…　|　服务器 v…」。
 *   · 0.15（2026-10-20）对外只显示一个版本号（0.16 修订为：服务器版本未删、改收进设置）（用户 2026-10-20
 *     口径：本款**不拆「客户端/服务端」**，就是【一款软件】；本款作为 TRAE 宿主的一个分页、随宿主启动被
 *     顺便拉起，逻辑上仍独立）——顶栏角色脚标**去掉并列的「已连接 · v<服务端版本>」**，连上后只显「已连接」。
 *   · 0.14（2026-10-19）新增【服务器切换控件】（双机口径：家里/宿舍各一台服务器争抢应答，需网页版切
 *     「谁应答」）：**服务器**下拉与「在线/离线」小标——下拉＝「自动（谁先答算谁）」＋ 自动发现的在线
 *     服务器（接口.js 收 `服务器报到` 帧）＋「手动输入实例号…」；选中即调 接口.设置服务器()（定向：请求帧
 *     带 `sv`、只收该服务器应答/广播）；订阅 接口.订阅服务器 实时刷新，另每 5 秒轻刷新；切换后【重载数据】。
 *   · 0.01（2026-10-18）首版（WS4 网页工位）。0.02~0.13 沿革：WS 请求层适配、口令首登窗、发布弹窗
 *     选端/选对话（含忙闲 10 秒轮询）、通道失败可再武装、角色脚标如实提示等（主体逻辑 0.17 起迁至 清单页.js）。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.20';
  var 提示定时 = null;

  function $(id) { return document.getElementById(id); }

  function 提示(文案) {
    var 条 = $('提示');
    if (!条) return;
    条.textContent = 文案;
    条.classList.remove('隐藏');
    if (提示定时) clearTimeout(提示定时);
    提示定时 = setTimeout(function () { 条.classList.add('隐藏'); }, 2600);
  }

  // ---------------- 顶栏角色（ping → 已连接，不并列服务端版本号） ----------------
  function 载角色(试) {
    试 = 试 || 0;
    var 完 = false;
    var 计时 = setTimeout(function () { if (!完) { 完 = true; 重试(); } }, 4000);
    if (!global.接口 || typeof global.接口.ping !== 'function') { clearTimeout(计时); return; }
    global.接口.ping().then(function (r) {
      if (完) return;
      完 = true; clearTimeout(计时);
      if ($('角色')) $('角色').textContent = '已连接';
      设设置_服务器版本(r && r.版本);
    }).catch(function () {
      if (完) return;
      完 = true; clearTimeout(计时);
      重试();
    });
    function 重试() {
      var 态 = '';
      try { 态 = (global.接口.连接状态 && global.接口.连接状态().状态) || ''; } catch (e) { }
      if (态 === '失败') { if ($('角色')) $('角色').textContent = '通道失败'; return; }
      if (态 === '已连') { if ($('角色')) $('角色').textContent = '已连频道 · 服务器未响应'; }
      else { if ($('角色')) $('角色').textContent = '未连接'; }
      if (试 < 10) setTimeout(function () { 载角色(试 + 1); }, 1500);
    }
  }

  // ---------------- 设置菜单（右上角；收纳 服务器选择 / 口令 / 版本） ----------------
  function 设设置_服务器版本(v) {
    var e = $('设置_服务器版本');
    if (e) e.textContent = v ? ('v' + v) : '–';
  }
  function 开设置(开) {
    var 面 = $('设置面板');
    if (面) 面.classList.toggle('隐藏', !开);
  }
  function 装设置() {
    var 面 = $('设置面板');
    var 钮设置 = $('按钮_设置');
    var 网页版 = $('设置_网页版版本');
    var mt = document.querySelector('meta[name="任务面板版本"]');
    if (网页版 && mt) 网页版.textContent = 'v' + (((mt.getAttribute('content') || '').trim()) || '–');
    if (钮设置) 钮设置.addEventListener('click', function (e) {
      if (e) e.stopPropagation();
      开设置(!面 || 面.classList.contains('隐藏'));
    });
    document.addEventListener('click', function (e) {
      if (!面 || 面.classList.contains('隐藏')) return;
      if (钮设置 && (e.target === 钮设置 || 钮设置.contains(e.target))) return;
      if (面.contains(e.target)) return;
      开设置(false);
    });
  }

  // ---------------- 服务器切换（多服务器 / 自动发现 / 定向谁应答） ----------------
  function 服务器选项(值, 文本) {
    var o = document.createElement('option');
    o.value = 值; o.textContent = 文本;
    return o;
  }
  function 画服务器() {
    var 框 = $('服务器_选择');
    if (!框) return;
    var 选 = { 实例号: '', 名称: '' }, 表 = [];
    try { 选 = global.接口.选中服务器() || 选; 表 = global.接口.服务器列表() || []; } catch (e) { }
    框.innerHTML = '';
    框.appendChild(服务器选项('', '自动（谁先答算谁）'));
    表.forEach(function (服) {
      框.appendChild(服务器选项(服.实例号,
        服.名称 + '（' + 服.实例号 + '） · ' + (服.在线 ? '在线' : '离线')));
    });
    框.appendChild(服务器选项('__手动__', '手动输入实例号…'));
    var 在列 = 表.some(function (服) { return 服.实例号 === 选.实例号; });
    if (选.实例号 && !在列) {
      框.appendChild(服务器选项(选.实例号,
        (选.名称 || '（未知）') + '（' + 选.实例号 + '） · 离线'));
    }
    框.value = 选.实例号 || '';
    画服务器态(选, 表);
  }
  function 画服务器态(选, 表) {
    var 态 = $('服务器_态');
    if (!态) return;
    if (!选.实例号) { 态.textContent = '自动'; 态.className = '服务器态 自动'; return; }
    var 在线 = 表.some(function (服) { return 服.实例号 === 选.实例号 && 服.在线; });
    态.textContent = '所选：' + (选.名称 || 选.实例号) + (在线 ? ' 在线' : ' 离线');
    态.className = '服务器态 ' + (在线 ? '在线' : '离线');
  }
  function 切服务器() {
    var 框 = $('服务器_选择');
    if (!框) return;
    var v = String(框.value || '');
    if (v === '__手动__') {
      var 输 = global.prompt ? global.prompt('请输入要定向的服务器实例号（如 1219299644）', '') : '';
      输 = String(输 || '').trim();
      if (!输) { 画服务器(); return; }
      global.接口.设置服务器(输, '');
      提示('已定向到服务器 ' + 输);
    } else if (!v) {
      global.接口.设置服务器('', '');
      提示('已切回自动（谁先答算谁）');
    } else {
      var 名 = '';
      try {
        (global.接口.服务器列表() || []).forEach(function (服) { if (服.实例号 === v) 名 = 服.名称; });
      } catch (e) { }
      global.接口.设置服务器(v, 名);
      提示('已切换到服务器 ' + (名 || v));
    }
    画服务器();
    保存设置();
    重载数据();
  }
  function 重载数据() {
    载角色();
    try { if (global.清单页 && global.清单页.重载) global.清单页.重载(); } catch (e) { }
  }
  function 装服务器() {
    var 框 = $('服务器_选择');
    if (!框) return;
    画服务器();
    try { global.接口.订阅服务器(function () { 画服务器(); }); } catch (e) { }
    setInterval(function () {
      if (document.activeElement === 框) return;
      画服务器();
    }, 5000);
    框.addEventListener('change', 切服务器);
  }

  // ---------------- 设置落盘（0.20：不随版本升级清理；服务端存 使用痕迹\配置文件） ----------------
  function 保存设置() {
    if (!global.接口 || typeof global.接口.设置保存 !== 'function') return;
    var 口 = '';
    try { 口 = global.接口.读取口令 ? (global.接口.读取口令() || '') : ''; } catch (e) { }
    var 服 = { 实例号: '', 名称: '' };
    try { 服 = global.接口.选中服务器() || 服; } catch (e) { }
    global.接口.设置保存({ 口令: 口, 服务器: 服 })['catch'](function () { });
  }
  function 应用设置(设) {
    设 = 设 || {};
    var 口 = String(设.口令 || '');
    var 本地口 = '';
    try { 本地口 = global.接口.读取口令 ? (global.接口.读取口令() || '') : ''; } catch (e) { }
    if (口 && !本地口) { try { global.接口.设置口令(口); } catch (e) { } }
    var 服 = 设.服务器 || null;
    if (服 && 服.实例号) {
      var 现 = { 实例号: '' };
      try { 现 = global.接口.选中服务器() || 现; } catch (e) { }
      if (!现.实例号) { try { global.接口.设置服务器(服.实例号, 服.名称 || ''); } catch (e) { } }
    }
    画服务器();
  }
  function 拉落地设置() {
    // ① 同源 http(s)（本机/局域网打开）→ 直接 HTTP 读盘，无需口令即可取回
    var 同源 = (location.protocol === 'http:' || location.protocol === 'https:')
      && !/github\.io$/i.test(location.hostname);
    if (同源 && typeof global.fetch === 'function') {
      return global.fetch('/api/settings_get?ts=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.ok) 应用设置(j.设置); })
        ['catch'](function () { return 走WS(); });
    }
    return 走WS();

    function 走WS() {
      if (!global.接口 || typeof global.接口.设置读取 !== 'function') return Promise.resolve();
      return global.接口.设置读取().then(function (r) {
        应用设置((r && r.设置) || {});
      })['catch'](function () { });
    }
  }

  // ---------------- 口令（§19 首登填、本地缓存；频道 = 前缀 + 口令，运行时拼） ----------------
  function 开口令(首登) {
    var 弹 = $('口令弹窗');
    if (!弹) return;
    var 输 = $('口令_输入');
    if (输) {
      if (首登) 输.value = '';
      else { try { 输.value = global.接口.读取口令 ? (global.接口.读取口令() || '') : ''; } catch (e) { } }
    }
    弹.classList.remove('隐藏');
    if (输) { try { 输.focus(); } catch (e) { } }
  }
  function 关口令() { var 弹 = $('口令弹窗'); if (弹) 弹.classList.add('隐藏'); }
  function 确认口令() {
    var 输 = $('口令_输入');
    var v = 输 ? String(输.value || '').trim() : '';
    if (!v) { 提示('请输入口令'); return; }
    关口令();
    try { global.接口.设置口令(v); } catch (e) { }
    保存设置();
    拉落地设置().then(首载);
  }

  // ---------------- 首载（口令就绪后载入主页） ----------------
  function 首载() {
    载角色();
    try { if (global.清单页 && global.清单页.载入主页) global.清单页.载入主页(true); } catch (e) { }
  }

  // ---------------- 启动装配 ----------------
  function 装配() {
    装设置();
    装服务器();
    try { if (global.清单页 && global.清单页.装配) global.清单页.装配(); } catch (e) { }
    if ($('按钮_口令')) $('按钮_口令').addEventListener('click', function () { 开设置(false); 开口令(false); });
    if ($('口令_取消')) $('口令_取消').addEventListener('click', 关口令);
    if ($('口令_确定')) $('口令_确定').addEventListener('click', 确认口令);
    var 输 = $('口令_输入');
    if (输) {
      输.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 确认口令(); } });
    }
    var 需 = true;
    try { 需 = !!(global.接口.需要口令 && global.接口.需要口令()); } catch (e) { 需 = true; }
    拉落地设置().then(function () {
      var 还缺 = 需;
      try { 还缺 = !!(global.接口.需要口令 && global.接口.需要口令()); } catch (e) { 还缺 = 需; }
      if (还缺) {
        if ($('角色')) $('角色').textContent = '未连接';
        开口令(true);
      } else {
        首载();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', 装配);
  } else {
    装配();
  }

  global.面板 = {
    版本: 版本,
    提示: 提示,
    载角色: 载角色,
    开设置: 开设置,
    重载: 重载数据,
    首载: 首载
  };
})(window);
