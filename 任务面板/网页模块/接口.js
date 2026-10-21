/* ============================================================
 * 【任务面板】网页模块 · 接口.js
 * 版本：0.16
 * 职责：网页版与服务器的通信层——由 fetch(/api/*) 改为 WebSocket（WS）请求层。
 *   · 0.13（2026-10-20）新增 设置读取()/设置保存(设置)（settings_get/settings_set，网页设置落盘）。
 *   · 0.12（2026-10-20）按用户口径新增清单类型「系统清单」：`清单新建(名称,详情,类型)` 把类型发到
 *     `list_new.类型`（总管清单/系统清单，服务端 0.16）。
 *   · 0.11（2026-10-20）①新增 `最近应答()`：记住最近一次真正应答的服务器实例号，供清单页在
 *     「展开取不到正文」时点名是哪台旧版服务器（家里 0.12 不返回 `详情`）；②**自动模式优先新版**：
 *     应答方版本低于当前在线最高版本时丢弃该帧（旧版抢先应答会让正文等新字段凭空消失）。
 *   · 0.10（2026-10-20）按用户口径「新建时填标题＋正文」：`清单新建(名称,详情)` 把正文发到
 *     `list_new.详情`、`子点新建(父,标题,详情)` 把正文发到 `point_new.详情`（服务端 0.15）；
 *     `详情` 均可省略（旧调用照旧）。任务新建本就带 `详情`，不变。
 *   · 0.09（2026-10-20）【清单库大重构 · 前端通信层封装（服务端 网页服务.py 0.12 已就绪）】按用户
 *     2026-10-20「清单流水账」口径，本层照现有风格新增一组清单库路由封装（对外方法名冻结）：
 *     清单列表(指纹)→`lists`、清单新建(名称)→`list_new`、清单详情(编号)→`list_get`、
 *     清单改名(编号,名称)→`list_rename`、清单删除(编号)→`list_del`；任务新建(清单,标题,详情)→
 *     `task_new`、任务详情(编号)→`task_get`、任务改(编号,标题,详情)→`task_edit`、
 *     任务状态(编号,状态)→`task_state`、任务删除(编号)→`task_del`；子点新建(父,标题)→`point_new`、
 *     点详情(编号)→`point_get`、点切换(编号,完成)→`point_toggle`、点删除(编号)→`point_del`；
 *     呼叫AI(节点,执行者)→`call_ai`（第一参数＝节点 `T…`/`P…`）。既有 `tasks/tree/ends/...` 一律不动。
 *     ⚠ **与后端实况的对齐（服务端 网页服务.py 0.13 / 清单存储 0.02，以能跑通为准）**：
 *     ①`point_new` 的「父」**可为任务 `T…` 或某点 `P…`、不限层数**（服务端 `父号 = 体.父 or 体.任务`），
 *     故本层 `子点新建(父…)` **同时带 `父`/`任务` 两键**（`任务`＝父的兜底兼容键）；小点返回含
 *     `{编号,父,标题,完成,子,任务}`——前端据 `父`/`子` 直接还原无限层树，**无需再自建父子表**；
 *     ②`point_get {no}` → `{ok,点,子列表}`（点含 `父`/`子`；子列表＝直系子），本层 `点详情()` 如实调它；
 *     ③`call_ai` 的节点**可＝`T…`/`P…`**（服务端 `节点号 = 体.节点 or 体.任务`），投递文本＝《清单存储.
 *    派发文本》＝该节点标题＋详情＋整棵子树逐层清单＋再分派授权语；本层 `呼叫AI()` 同时带
 *     `节点`/`任务`/`父` 三键。
 *     ⚠ 已知服务端**状态读取面的一处缺口**：`清单存储 0.02` 的 `_点视图` **未暴露 `卡片状态`**，
 *     故 `point_get` 查不到小点自身的 `卡片状态`（任务 T 的 `卡片状态` 经 `task_get` 可读）；
 *     本页据此把「小点呼叫 AI」的收口做成 **广播「投递结果」帧 + 轮询 点详情/任务详情** 双通道
 *     （见 清单页.js）。
 *   · 0.08（2026-10-20）【修「选中服务器后仍被旧版（无 `服务器` 字段）污染」】起因＝真机实测：
 *     家里跑的仍是旧版 0.10 服务器，其应答【不带 `服务器` 字段】却对所有请求都应答；0.07 的
 *     「无该字段 → 兼容接收」把它当合法数据收下 → 下拉选「宿舍」却显示家里（HM…）的端/会话。
 *     改法＝**选中即严格按 `服务器` 字段归属**：已明确选中（选中项 ≠ 「自动」）时，只接收
 *     `服务器` 字段存在且 === 选中实例号的应答/广播帧，**不带该字段的一律丢弃**；未选（＝自动
 *     「谁先答算谁」）仍维持兼容（都收）。`服务器报到` 帧不受影响（永远处理，供自动发现）。
 *   · 0.07（2026-10-19）【多服务器切换 / 服务器归属】起因＝用户 2026-10-19 双机口径
 *     （「家里」「宿舍」各跑一台服务器、争抢应答，网页版需切「谁应答」）：
 *     ①**定向 `sv`**：已选服务器时，请求帧顶层带 `sv=<实例号>`（服务端仅在自己==sv 时应答；
 *       未选不带、兼容旧「谁先答算谁」）。②**归属判定**：收到的应答/广播帧若带 `服务器` 字段
 *       且 ≠ 当前选中 → **丢弃**（不更新界面）；= 选中 或 无该字段 → 照常处理。③**自动发现**：
 *       收 `{"t":"服务器报到",…}` → 记入服务器表（按实例号去重、刷新名称/版本/最近在线），供
 *       页面下拉展示「名称（实例号）· 在线/离线」。④选中项存 localStorage（key=`任务面板_服务器`）；
 *       选中实例不在线时**如实提示、仍按其定向**（不偷偷改选）。
 *   · 0.06（2026-10-19）【回帖改发新参数】`回帖()` 由旧 `父编号` 改为发送 **`回复对象`**
 *     （被回复者编号；同时带上 `父编号` 兼容旧签名）——对齐后端 `reply` 路由的新平铺 A 系列
 *     口径（0.10 起后端两者都收，此处以前者为主）。应答 `{ok, 回复:{编号,回复对象,…}}`。
 *   · 0.05（2026-10-19）新增【广播帧】接收：收 `{"t":"投递受理","编号":…}` /
 *     `{"t":"投递结果","编号":…,"状态":"投递成功"|…}` 两类服务器广播帧（非应答），
 *     统一分发给订阅者（对外 接口.订阅广播(fn) / 退订广播(fn)）——供卡片四段状态机置位
 *     「服务器已接收 / 投递成功 / 发送失败」；页面不再靠「AI 回复出现」判投递成功。
 *   · 0.04（2026-10-19）新增 WS 路由 `del`（参数 `编号`）＝删除整张主卡及其全部回复；
 *     对外封装为 接口.删除卡(编号)，并登记本机 HTTP 兜底路径 /api/del。应答 { ok, 编号 }。
 *   · 页面与本机服务器各连【同一 PieSocket 频道】；页面发「请求帧」、服务器回「应答帧」。
 *     于是 GitHub Pages（静态、无后端）上打开也能跨网使用（§17 部署与 WS 通道）。
 *   · §19 对外页面安全：**频道号当口令**——`频道 = 固定前缀 + 口令`；源码【不写死频道名】，
 *     口令由用户**首次打开页面时输入**、本地缓存（localStorage），连接时运行时拼出频道。
 *     前缀 `TASKHUB`（本项目自定、非敏感）；口令默认留空、由用户填（用户已知 31415926fF@）。
 *   · 帧格式一律 FOX 2.0（57 字节头 + JSON 正文）；请求/应答带 id 配对、超长切片/拼装。
 *   · 省流：免心跳；任务/端列表用「版本指纹」差额（无变化回 未变、不重发数据）。
 *   · 静默：连上不宣告、不上线广播；仅在收到请求帧时才应答。断线逐次退避
 *     （3→6→12→24→48→60 秒封顶），用尽即宣告失败，绝不死循环轰炸。
 *   · 本机调试兜底：同源 http(s)（非 GitHub Pages）下若 WS 连不上，回落 fetch /api/*。
 * 说明：只用浏览器内置 WebSocket / fetch，不引任何外部 CDN；离线也能打开本文件。
 * 依赖：无（须先于 卡片.js / 面板.js 加载）。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.16';

  /* ---------------- 可配置常量（页面里可覆盖） ----------------
   * §19 对外页面安全：**频道号当口令**——连接频道 = 固定前缀 + 口令，【源码不写死频道名】。
   *   口令由用户首次打开页面时输入、存 localStorage（key=任务面板_口令），运行时拼出频道。
   *   想整体覆盖（如本机调试）：在页面 <head> 里先定义
   *     window.任务面板_WS配置 = {前缀:'…', 口令:'…', 密钥:'…', 主机:'…'} 即可。
   * 密钥（api_key）是 PieSocket 通道【基础设施】凭据（与 TTS 同一把），非频道口令。 */
  var 口令存储键 = '任务面板_口令';
  var 默认配置 = {
    主机: 'wss://free.blr2.piesocket.com/v3/',
    前缀: 'TASKHUB',                       // 固定前缀（本项目自定、非敏感）
    口令: '',                              // 口令（默认空＝首登填；由 取口令() 供值）
    密钥: 'ReDFavhh0qnOCKUUjQiLKVZ9RdxA6e4BGVKxxNug',
    单段上限: 10000,                       // 单段正文最大字节数（FOX 帧切片）
    请求超时: 20000,                        // 默认单请求超时（毫秒）
    退避: [3, 6, 12, 24, 48, 60]           // 断线逐次退避（秒），用尽即宣告失败
  };
  var 配置 = (function (基础, 覆盖) {
    var o = {}, k;
    for (k in 基础) { if (Object.prototype.hasOwnProperty.call(基础, k)) o[k] = 基础[k]; }
    if (覆盖) { for (k in 覆盖) { if (Object.prototype.hasOwnProperty.call(覆盖, k)) o[k] = 覆盖[k]; } }
    return o;
  })(默认配置, global.任务面板_WS配置);

  /* ---------------- 口令（§19：本地缓存，不写死在源码里） ---------------- */
  function 读缓存口令() {
    try { return String(global.localStorage.getItem(口令存储键) || ''); } catch (e) { return ''; }
  }
  function 存缓存口令(v) {
    try { global.localStorage.setItem(口令存储键, v); } catch (e) { }
  }
  function 清缓存口令() {
    try { global.localStorage.removeItem(口令存储键); } catch (e) { }
  }
  // 生效口令：优先本地缓存 → 页面覆盖提供的 配置.口令 → 空（空＝需要首登填）
  function 取口令() {
    var v = 读缓存口令();
    if (v) return v;
    return String(配置.口令 || '');
  }
  function 有口令() { return !!取口令(); }
  function 频道名() { return 配置.前缀 + 取口令(); }

  /* ---------------- 服务器（多服务器切换 / 自动发现 / 按服务器归属） ---------------- */
  // 选中项：localStorage 存 {实例号, 名称}；实例号为空串＝「自动（谁先答算谁）」。
  var 服务器存储键 = '任务面板_服务器';
  var 报到时效 = 30000;          // 报到帧视为「在线」的时效（服务端每 10 秒报到一次，30 秒宽容）

  function 读服务器选择() {
    try {
      var raw = String(global.localStorage.getItem(服务器存储键) || '');
      if (!raw) return { 实例号: '', 名称: '' };
      var d = JSON.parse(raw);
      if (d && typeof d === 'object') return { 实例号: String(d.实例号 || ''), 名称: String(d.名称 || '') };
      return { 实例号: raw, 名称: '' };   // 兜底：曾直接存了实例号
    } catch (e) { return { 实例号: '', 名称: '' }; }
  }
  function 存服务器选择(实例号, 名称) {
    try {
      if (!实例号) global.localStorage.removeItem(服务器存储键);
      else global.localStorage.setItem(服务器存储键,
        JSON.stringify({ 实例号: String(实例号), 名称: String(名称 || '') }));
    } catch (e) { }
  }
  function 选中实例号() { return 读服务器选择().实例号; }

  // 发现的服务器表：实例号 -> {名称,版本,地址,最近}（按实例号去重、刷新名称/版本/最近在线）
  var _服务器表 = {};
  var _服务器监听 = [];
  var _最近应答 = '';             // 0.10：最近一次真正应答的服务器实例号（供界面如实提示旧版服务器）
  function 记报到(d) {
    var sv = String((d && d.服务器) || '').trim();
    if (!sv) return;
    _服务器表[sv] = {
      实例号: sv, 名称: String(d.名称 || ''), 版本: String(d.版本 || ''),
      地址: String(d.地址 || ''), 最近: Date.now()
    };
    服务器分发();
  }
  function 在线判定(最近) { return (Date.now() - (最近 || 0)) < 报到时效; }
  function 服务器列表() {
    var 出 = [], k;
    for (k in _服务器表) {
      if (!Object.prototype.hasOwnProperty.call(_服务器表, k)) continue;
      var v = _服务器表[k];
      出.push({ 实例号: v.实例号, 名称: v.名称, 版本: v.版本, 地址: v.地址,
                最近: v.最近, 在线: 在线判定(v.最近) });
    }
    出.sort(function (a, b) { return (b.最近 || 0) - (a.最近 || 0); });
    return 出;
  }
  function 服务器分发() {
    _服务器监听.slice().forEach(function (fn) { try { fn(服务器列表()); } catch (e) { } });
  }
  // 归属判定（0.08 收紧）：未选（自动）→ 谁答都收；已选 → 仅收带 `服务器` 且 === 选中实例号的
  //   应答/广播帧；【不带 `服务器` 字段的一律丢弃】（挡住旧版服务器不带字段的污染）。
  //   0.11：**自动模式优先新版**——若应答那台的版本低于当前在线服务器里的最高版本，丢弃该帧
  //   （否则家里旧版 0.12 抢先应答会让「正文」等新字段凭空消失）。
  function 版本数(v) {
    var m = /^(\d+)\.(\d+)/.exec(String(v || ''));
    return m ? (parseInt(m[1], 10) * 100 + parseInt(m[2], 10)) : 0;
  }
  function 最新在线版本() {
    var 最大 = 0;
    服务器列表().forEach(function (x) {
      if (!x || !x.在线) return;
      var n = 版本数(x.版本);
      if (n > 最大) 最大 = n;
    });
    return 最大;
  }
  function 归属本机(d) {
    var 选 = 选中实例号();
    var sv = String((d && d.服务器) || '').trim();
    if (!选) {
      if (!sv) return true;                        // 自动 + 旧版无字段：照旧兼容
      var 最 = 最新在线版本();
      if (最 > 0) {
        var 表 = 服务器列表();
        for (var i = 0; i < 表.length; i++) {
          if (String(表[i].实例号) !== sv) continue;
          var n = 版本数(表[i].版本);
          if (n > 0 && n < 最) return false;       // 旧版服务器抢先应答 → 丢弃
          break;
        }
      }
      return true;
    }
    return !!sv && sv === 选;          // 已选：无字段（旧版）或 ≠ 选中 → 丢弃
  }

  // 慢接口单独放宽超时（端刷新要扫共享数据库，可能较久）
  var 请求超时表 = { 'ends/refresh': 180000 };

  // 路由 → 本机 HTTP 兜底（仅同源 http(s) 且非 GitHub Pages 时启用；供本机调试）
  var HTTP表 = {
    'ping':         { 路径: '/api/ping',         方法: 'GET' },
    'tasks':        { 路径: '/api/tasks',        方法: 'GET' },
    'tree':         { 路径: '/api/tree',         方法: 'GET' },
    'ends':         { 路径: '/api/ends',         方法: 'GET' },
    'ends/refresh': { 路径: '/api/ends/refresh', 方法: 'GET' },
    'conv':         { 路径: '/api/conv',         方法: 'GET' },
    'publish':      { 路径: '/api/publish',      方法: 'POST' },
    'reply':        { 路径: '/api/reply',        方法: 'POST' },
    'state':        { 路径: '/api/state',        方法: 'POST' },
    'cardstate':    { 路径: '/api/cardstate',    方法: 'POST' },
    'detail':       { 路径: '/api/detail',       方法: 'GET' },
    'card':         { 路径: '/api/card',         方法: 'GET' },
    'redeliver':    { 路径: '/api/redeliver',    方法: 'POST' },
    'del':          { 路径: '/api/del',          方法: 'POST' },
    /* 0.09 清单库（HTTP 镜像，供本机调试；WS 请求帧的 r 直接用路由名）——
       照 网页服务.py 0.12 的 _路径路由（服务端未提供 /api/point_get，故此处亦无）。 */
    'lists':        { 路径: '/api/lists',        方法: 'GET' },
    'list_new':     { 路径: '/api/list_new',     方法: 'POST' },
    'list_get':     { 路径: '/api/list_get',     方法: 'GET' },
    'list_rename':  { 路径: '/api/list_rename',  方法: 'POST' },
    'list_del':     { 路径: '/api/list_del',     方法: 'POST' },
    'task_new':     { 路径: '/api/task_new',     方法: 'POST' },
    'task_get':     { 路径: '/api/task_get',     方法: 'GET' },
    'task_edit':    { 路径: '/api/task_edit',     方法: 'POST' },
    'task_state':   { 路径: '/api/task_state',    方法: 'POST' },
    'task_del':     { 路径: '/api/task_del',      方法: 'POST' },
    'point_new':    { 路径: '/api/point_new',     方法: 'POST' },
    'point_toggle': { 路径: '/api/point_toggle',  方法: 'POST' },
    'point_del':    { 路径: '/api/point_del',     方法: 'POST' },
    'call_ai':      { 路径: '/api/call_ai',       方法: 'POST' }
  };

  /* ---------------- 小工具 ---------------- */
  function 随机(k, 字母) {
    var s = '', 池 = 字母 || '0123456789';
    for (var i = 0; i < k; i++) s += 池.charAt(Math.floor(Math.random() * 池.length));
    return s;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function pad3(n) { return ('00' + n).slice(-3); }
  function 新mid() {
    var d = new Date();
    var ts = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
      + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    return ts + 随机(8, 'abcdefghijklmnopqrstuvwxyz');
  }
  function 字字节(ch) {
    var c = ch.codePointAt(0);
    return c < 0x80 ? 1 : (c < 0x800 ? 2 : (c < 0x10000 ? 3 : 4));
  }
  // 按字节上限切串（按码点切，绝不切断多字节字符 / emoji 代理对）
  function 切片(串, 上限) {
    if (!串) return [''];
    var 出 = [], 当前 = '', n = 0, ch;
    for (ch of 串) {
      var l = 字字节(ch);
      if (n + l > 上限) { 出.push(当前); 当前 = ''; n = 0; }
      当前 += ch; n += l;
    }
    出.push(当前);
    return 出;
  }
  function 头后正文(msg) {
    try {
      var 字 = new TextEncoder().encode(msg);
      return new TextDecoder('utf-8').decode(字.slice(57));
    } catch (e) {
      return msg.slice(57);   // 极老旧浏览器兜底（头为纯 ASCII，字符偏移≈字节偏移）
    }
  }
  var 头正则 = /^【FOXID:(\d{14})([a-z]{8})(\d{10})=cut\((\d{3})\/(\d{3})\)】/;
  function 剥头(msg) {
    var m = 头正则.exec(msg);
    if (!m) return null;
    if (m[3] === _网页号) return { 回声: true };
    return {
      mid: m[1] + m[2], sender: m[3],
      idx: parseInt(m[4], 10), total: parseInt(m[5], 10),
      正文: 头后正文(msg)
    };
  }
  function 帧(正文, idx, total, mid) {
    return '【FOXID:' + mid + _网页号 + '=cut(' + pad3(idx) + '/' + pad3(total) + ')】' + 正文;
  }

  /* ---------------- 网页端软件号（10 位、'3' 开头＝网页端角色；随浏览器持久化） ---------------- */
  function 取网页号() {
    var k = '任务面板_网页软件号';
    try {
      var v = global.localStorage.getItem(k);
      if (v && /^\d{10}$/.test(v)) return v;
    } catch (e) { /* 隐私模式等：退化为内存号 */ }
    var s = '3' + 随机(9);
    try { global.localStorage.setItem(k, s); } catch (e) { }
    return s;
  }
  var _网页号 = 取网页号();

  /* ---------------- 连接状态 ---------------- */
  var ws = null;
  var _连接态 = '未连';       // 未连 / 连接中 / 已连 / 断开 / 重连等待 / 失败
  var _连续失败 = 0;
  var _重连定时 = null;
  var _最近错 = '';
  var _待发队列 = [];
  var _待应答 = {};
  var _收帧缓冲 = {};

  function 频道地址() {
    return 配置.主机 + 频道名() + '?api_key=' + 配置.密钥;
  }
  function 有WS() { return !!ws && ws.readyState === 1; }
  function 通知状态() {
    try {
      if (typeof global.任务面板_通道变化 === 'function') {
        global.任务面板_通道变化(连接状态());
      }
    } catch (e) { }
  }

  function 开连接() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (_连接态 === '失败') return;
    if (!有口令()) { _连接态 = '等待口令'; _最近错 = '未设置口令（首次使用请先填口令）'; 通知状态(); return; }
    if (!全局可WS()) { _宣告失败('本环境不支持 WebSocket'); return; }
    var w;
    try { w = new WebSocket(频道地址()); } catch (e) { _宣告失败('创建 WebSocket 失败：' + e); return; }
    ws = w; _连接态 = '连接中'; 通知状态();
    w.onopen = function () {
      if (ws !== w) return;
      _连接态 = '已连'; _连续失败 = 0; _最近错 = '';
      var 队 = _待发队列; _待发队列 = [];
      队.forEach(function (正文) { try { 发正文(正文); } catch (e) { } });
      通知状态();
    };
    w.onmessage = function (ev) { 收消息(ev); };
    w.onerror = function () { /* onclose 随后必到 */ };
    w.onclose = function () {
      if (ws !== w) return;
      ws = null;
      if (_连接态 === '失败' || _连接态 === '未连') { 通知状态(); return; }
      _连接态 = '断开';
      排重连();
      通知状态();
    };
  }

  function 全局可WS() { return typeof global.WebSocket === 'function'; }

  function 排重连() {
    if (_重连定时 || _连接态 === '失败') return;
    _连续失败 += 1;
    if (_连续失败 > 配置.退避.length) {
      _宣告失败('通道断线重连已达上限（' + 配置.退避.length + ' 次），停止重试');
      return;
    }
    var 等 = 配置.退避[_连续失败 - 1];
    _连接态 = '重连等待';
    _最近错 = '断线，' + 等 + ' 秒后第 ' + _连续失败 + ' 次重连';
    _重连定时 = setTimeout(function () { _重连定时 = null; 开连接(); }, 等 * 1000);
  }

  function 宣告失败(原因) { _宣告失败(原因); }
  function _宣告失败(原因) {
    _连接态 = '失败'; _最近错 = 原因;
    _待发队列.length = 0;
    var id;
    for (id in _待应答) {
      if (!Object.prototype.hasOwnProperty.call(_待应答, id)) continue;
      try { clearTimeout(_待应答[id].timer); } catch (e) { }
      try { _待应答[id].reject(new Error(原因)); } catch (e) { }
    }
    _待应答 = {};
    通知状态();
  }

  function 确保连接() {
    if (!有口令()) return;                       // §19：未填口令 → 先不连，等首登填
    if (有WS()) return;
    if (_连接态 === '失败') return;
    if (_连接态 === '未连' || _连接态 === '断开') 开连接();
    else if (_连接态 === '连接中' || _连接态 === '重连等待') { /* 已在途 */ }
  }

  function 重连() {
    if (_重连定时) { clearTimeout(_重连定时); _重连定时 = null; }
    if (ws) { try { ws.close(); } catch (e) { } ws = null; }
    _连接态 = '未连'; _连续失败 = 0; _最近错 = '';
    开连接();
  }

  /* ---------------- 收发 ---------------- */
  function 发正文(正文) {
    if (!有WS()) return false;
    var 片 = 切片(正文, 配置.单段上限);
    var mid = 新mid();
    for (var i = 0; i < 片.length; i++) {
      ws.send(帧(片[i], i + 1, 片.length, mid));
    }
    return true;
  }

  function 发json(对象) {
    var 正文 = JSON.stringify(对象);
    if (有WS()) return 发正文(正文);
    _待发队列.push(正文);
    确保连接();
    return false;
  }

  var _收缓冲上限 = 60000;   // 未拼齐的帧缓冲存活 60 秒
  function 清缓冲() {
    var now = Date.now(), k;
    for (k in _收帧缓冲) {
      if (Object.prototype.hasOwnProperty.call(_收帧缓冲, k) && now - _收帧缓冲[k].时刻 > _收缓冲上限) {
        delete _收帧缓冲[k];
      }
    }
  }
  function 收消息(ev) {
    var raw = ev && ev.data;
    if (typeof raw !== 'string') return;
    var h = 剥头(raw);
    if (!h || h.回声) return;
    if (h.total <= 1) { 消费(h.正文); return; }
    var b = _收帧缓冲[h.mid];
    if (!b) { b = _收帧缓冲[h.mid] = { total: h.total, 片: {}, 时刻: Date.now() }; }
    b.片[h.idx] = h.正文;
    var 齐 = true, i;
    for (i = 1; i <= b.total; i++) { if (b.片[i] === undefined) { 齐 = false; break; } }
    if (齐) {
      var 串 = '';
      for (i = 1; i <= b.total; i++) 串 += b.片[i];
      delete _收帧缓冲[h.mid];
      消费(串);
    }
    清缓冲();
  }

  // 广播帧（服务器主动推、非应答）：`{"t":"投递受理","编号":…}` / `{"t":"投递结果","编号":…,"状态":…}`。
  // 统一分发给订阅者（页面卡片状态机据此置「服务器已接收 / 投递成功 / 发送失败」）。
  var _广播监听 = [];
  function 广播分发(帧) {
    _广播监听.slice().forEach(function (fn) { try { fn(帧); } catch (e) { } });
    try {
      if (typeof global.任务面板_投递广播 === 'function') global.任务面板_投递广播(帧);
    } catch (e) { }
  }

  function 消费(正文) {
    var d;
    try { d = JSON.parse(正文); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    if (d.t === '服务器报到') { 记报到(d); return; }   // 报到帧：永远处理（自动发现，不受选中影响）
    if (!归属本机(d)) return;                          // 非本机所选服务器的帧 → 丢弃，不更新界面
    if (d.服务器) _最近应答 = String(d.服务器);         // 0.10：记住「真正应答的那台」，供界面如实提示
    if (d.t === '投递受理' || d.t === '投递结果') { 广播分发(d); return; }   // 广播帧：不走应答配对
    if (d.t !== 'res') return;
    if (d.to && d.to !== _网页号) return;          // 别的网页端的应答，丢弃
    var 待 = _待应答[d.id];
    if (!待) return;
    delete _待应答[d.id];
    try { clearTimeout(待.timer); } catch (e) { }
    if (d.ok === false) { 待.reject(new Error(d.err || '请求失败')); return; }
    待.resolve(d);
  }

  /* ---------------- 请求层 ---------------- */
  function 等连接(毫秒) {
    if (有WS()) return Promise.resolve(true);
    if (_连接态 === '失败') return Promise.resolve(false);
    确保连接();
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var 定时 = setInterval(function () {
        if (有WS()) { clearInterval(定时); resolve(true); return; }
        if (_连接态 === '失败') { clearInterval(定时); resolve(false); return; }
        if (Date.now() - t0 >= 毫秒) { clearInterval(定时); resolve(false); }
      }, 120);
    });
  }

  function WS请求(路由, 载荷, 选项) {
    return new Promise(function (resolve, reject) {
      if (_连接态 === '失败') { reject(new Error('通道未连接：' + _最近错)); return; }
      var id = 'r' + Date.now().toString(36) + 随机(4, 'abcdefghijklmnopqrstuvwxyz');
      var 超时 = (选项 && 选项.超时) || 请求超时表[路由] || 配置.请求超时;
      var 定时 = setTimeout(function () {
        delete _待应答[id];
        reject(new Error('请求超时（' + 路由 + '）'));
      }, 超时);
      _待应答[id] = { resolve: resolve, reject: reject, timer: 定时, 路由: 路由 };
      var 请求帧 = { t: 'req', id: id, r: 路由, p: 载荷 || {}, sid: _网页号 };
      var 选 = 选中实例号();
      if (选) 请求帧.sv = 选;   // 已选服务器 → 定向：服务端仅在自己==sv 时应答（未选不带，兼容）
      发json(请求帧);
    });
  }

  function 查询串(参数) {
    var 段 = [];
    if (参数) {
      for (var k in 参数) {
        if (!Object.prototype.hasOwnProperty.call(参数, k)) continue;
        var v = 参数[k];
        if (v === undefined || v === null || v === '') continue;
        段.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
    }
    return 段.length ? ('?' + 段.join('&')) : '';
  }

  function 可HTTP回退() {
    try {
      var p = global.location.protocol, h = global.location.hostname || '';
      if (p !== 'http:' && p !== 'https:') return false;
      if (/\.github\.io$/i.test(h)) return false;      // GitHub Pages 是静态页、无后端
      return true;
    } catch (e) { return false; }
  }

  function HTTP请求(路由, 载荷) {
    var 项 = HTTP表[路由];
    if (!项) return Promise.reject(new Error('未知接口：' + 路由));
    载荷 = 载荷 || {};
    var 地址 = 项.路径, init = { method: 项.方法, headers: {} };
    if (项.方法 === 'GET') {
      地址 += 查询串(载荷);
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(载荷);
    }
    return fetch(地址, init).then(function (响应) {
      return 响应.text().then(function (文本) {
        var 数据 = null;
        try { 数据 = 文本 ? JSON.parse(文本) : {}; } catch (e) {
          throw new Error('后端返回非 JSON（HTTP ' + 响应.status + '）');
        }
        if (!响应.ok || (数据 && 数据.ok === false)) {
          throw new Error((数据 && 数据.err) || ('请求失败 HTTP ' + 响应.status));
        }
        return 数据;
      });
    }, function (e) {
      throw new Error('网络不可达：' + ((e && e.message) ? e.message : e));
    });
  }

  // 统一调用：优先 WS；同源 http(s) 且 WS 连不上时回落本机 HTTP（供本机调试）
  function 调用(路由, 载荷, 选项) {
    载荷 = 载荷 || {};
    选项 = 选项 || {};
    if (有WS()) return WS请求(路由, 载荷, 选项);
    if (_连接态 === '失败') {
      if (可HTTP回退()) return HTTP请求(路由, 载荷);
      return Promise.reject(new Error('通道未连接：' + _最近错));
    }
    return 等连接(2500).then(function (ok) {
      if (ok) return WS请求(路由, 载荷, 选项);
      if (可HTTP回退()) return HTTP请求(路由, 载荷);
      return WS请求(路由, 载荷, 选项);   // 最终仍走 WS（连接超时后 reject）
    });
  }

  /* ---------------- 口令（§19 首登填、本地缓存） ---------------- */
  function 需要口令() { return !有口令(); }

  // 设置口令：存本地缓存 → 用新口令重连（重连内部会先关旧连再按新频道开连）。返回 bool。
  function 设置口令(口令值) {
    var v = String(口令值 == null ? '' : 口令值).trim();
    if (!v) return false;
    存缓存口令(v);
    try {
      if (typeof global.任务面板_口令变化 === 'function') global.任务面板_口令变化(v);
    } catch (e) { }
    重连();
    return true;
  }

  // 清除口令：删本地缓存并断连（下次进页面会再要口令）。
  function 清除口令() {
    清缓存口令();
    _连接态 = '未连';
    重连();
  }

  /* ---------------- 对外接口（沿用既有语义，前端解析不用大改） ---------------- */
  var 接口 = {
    版本: 版本,
    raw: 调用,

    连接状态: function () {
      return { 状态: _连接态, 频道: 频道名(), 重试: _连续失败, 最近错: _最近错, 需口令: !有口令() };
    },
    重连: 重连,

    /* §19 口令（首登填、本地缓存） */
    需要口令: 需要口令,
    设置口令: 设置口令,
    读取口令: 取口令,
    清除口令: 清除口令,

    // 连通与版本
    ping: function () { return 调用('ping', {}); },

    // 任务（主卡）列表；传 指纹 时走差额（无变化回 {未变:true}）
    任务列表: function (指纹) { return 调用('tasks', 指纹 ? { since: 指纹 } : {}); },

    // 以某卡为根的整棵卡片树
    任务树: function (编号) { return 调用('tree', { no: 编号 }); },

    // 端列表（含历史）
    端列表: function (指纹) { return 调用('ends', 指纹 ? { since: 指纹 } : {}); },

    // 主动刷新端（探测在线），返回 {ok,结果}
    刷新端: function () { return 调用('ends/refresh', {}); },

    // 某端下的对话列表
    端对话: function (端名) { return 调用('conv', { end: 端名 }); },

    // 发布任务
    发布: function (内容, 发布者, 执行者, 相关情况) {
      return 调用('publish', {
        内容: 内容, 发布者: 发布者 || '人',
        执行者: 执行者 || {}, 相关情况: 相关情况 || ''
      });
    },

    // 回帖（0.06：改发 `回复对象`；被回复者可为主卡 `#1` 或另一条回复 `A1`；同时带 `父编号` 兼容旧签名）
    回帖: function (父编号, 作者, 角色, 正文) {
      return 调用('reply', { 回复对象: 父编号, 父编号: 父编号,
                            作者: 作者 || '人', 角色: 角色 || '人蓝', 正文: 正文 || '' });
    },

    // 改任务状态（6 档）
    改任务状态: function (编号, 状态, 操作者) {
      return 调用('state', { 编号: 编号, 状态: 状态, 操作者: 操作者 || '人' });
    },

    // 改某张卡的卡片状态（发送中/已送达/发送失败/已读/未读/已结束）
    改卡片状态: function (编号, 状态) {
      return 调用('cardstate', { 编号: 编号, 状态: 状态 });
    },

    // 重投（发送失败后「重试」）
    重投: function (编号) { return 调用('redeliver', { 编号: 编号 }); },

    // 删除整张主卡及其全部回复（参数 `编号`；应答 { ok, 编号 }）
    删除卡: function (编号) { return 调用('del', { 编号: 编号 }); },

    // 某张卡的详情
    详情: function (编号) { return 调用('detail', { no: 编号 }); },

    // 直接取某张卡内容（供「详情」按钮免按标题翻找）
    取卡: function (编号) { return 调用('card', { no: 编号 }); },

    /* ---------------- 清单库（0.09 新增；服务端 网页服务.py 0.12 路由；名字冻结） ---------------- */
    // 清单列表（带 指纹 → 差额，无变化回 {未变:true}）
    清单列表: function (指纹) { return 调用('lists', 指纹 ? { since: 指纹 } : {}); },
    // 新建清单（类型：总管清单/系统清单；正文 详情；大白话简述）
    清单新建: function (名称, 详情, 类型, 大白话) {
      return 调用('list_new', { 名称: 名称 || '', 详情: 详情 || '', 类型: 类型 || '总管清单',
                               大白话: 大白话 || '' });
    },
    // 清单详情（返回 {清单, 任务列表}）
    清单详情: function (编号) { return 调用('list_get', { no: 编号, 编号: 编号 }); },
    // 清单改名
    清单改名: function (编号, 名称) {
      return 调用('list_rename', { no: 编号, 编号: 编号, 名称: 名称 || '' });
    },
    // 清单删除（连同其任务与小点）
    清单删除: function (编号) { return 调用('list_del', { no: 编号, 编号: 编号 }); },

    // 任务新建（在清单下建一张任务小卡；大白话＝标题下简述）
    任务新建: function (清单, 标题, 详情, 大白话) {
      return 调用('task_new', { 清单: 清单, 标题: 标题 || '', 详情: 详情 || '',
                               大白话: 大白话 || '' });
    },
    // 任务详情（返回 {任务, 小点列表}）——也是「呼叫 AI 后轮询 卡片状态」的收口接口
    任务详情: function (编号) { return 调用('task_get', { no: 编号, 编号: 编号 }); },
    // 任务改（标题/详情/大白话；给 null 的不改）
    任务改: function (编号, 标题, 详情, 大白话) {
      return 调用('task_edit', { no: 编号, 编号: 编号, 标题: 标题, 详情: 详情, 大白话: 大白话 });
    },
    // 任务状态（快速备注）：未开始/进行中/已完成/已放弃
    任务状态: function (编号, 状态) {
      return 调用('task_state', { no: 编号, 编号: 编号, 状态: 状态 });
    },
    // 任务删除（连同其全部小点）
    任务删除: function (编号) { return 调用('task_del', { no: 编号, 编号: 编号 }); },

    /* 子点新建(父, 标题, 详情)：父可为任务 `T…` 或某点 `P…`（服务端 0.13 支持无限层；0.15 收正文）。
       服务端 `父号 = 体.父 or 体.任务`，故同时带 `父`/`任务` 两键（`任务`＝兜底兼容键）。
       返回 {ok, 小点:{编号,父,标题,详情,完成,子,任务}}。 */
    子点新建: function (父, 标题, 详情, 大白话) {
      return 调用('point_new', { 父: 父, 任务: 父, 标题: 标题 || '', 详情: 详情 || '',
                                 大白话: 大白话 || '' });
    },
    // 点详情（`point_get {no}` → `{ok, 点:{编号,父,标题,详情,大白话,完成,子,任务}, 子列表:[…]}`）
    点详情: function (编号) { return 调用('point_get', { no: 编号, 编号: 编号 }); },
    // 点改（标题/正文/大白话；给 null 的不改）
    点改: function (编号, 标题, 详情, 大白话) {
      return 调用('point_edit', { no: 编号, 编号: 编号, 标题: 标题, 详情: 详情, 大白话: 大白话 });
    },
    // 点切换（完成/未完成）
    点切换: function (编号, 完成) {
      return 调用('point_toggle', { no: 编号, 编号: 编号, 完成: 完成 ? 'true' : 'false' });
    },
    // 点删除
    点删除: function (编号) { return 调用('point_del', { no: 编号, 编号: 编号 }); },

    /* 0.15【编辑】移动 / 合并（用户 2026-10-21 口径：删除钮改编辑，里面含移动卡片、合并卡片） */
    // 移动目标（该卡可挂的合法父卡）→ {ok, 目标列表:[{编号,标题,类型}]}
    移动目标: function (编号) { return 调用('move_targets', { no: 编号, 编号: 编号 }); },
    // 移动卡片（整棵子树一起搬）
    移动卡片: function (编号, 父号) {
      return 调用('card_move', { no: 编号, 编号: 编号, 父: 父号, 新父: 父号 });
    },
    // 合并卡片（被并卡 → 目标卡；旧号登记后仍可寻址）
    合并卡片: function (编号, 到) {
      return 调用('card_merge', { no: 编号, 编号: 编号, 到: 到, 目标: 到 });
    },
    // 历史版本（含合并前的分支：用旧号查返回旧号那支，用新号查带 分支 列表）
    卡片历史: function (编号) { return 调用('card_hist', { no: 编号, 编号: 编号 }); },

    /* 呼叫AI(节点, 执行者)：第一参数＝节点 `T…`（任务）/`P…`（小点/子任务），**每张卡片都能单独呼叫**；
       执行者＝{端,对话,终身号}。服务端 0.13 `节点号 = 体.节点 or 体.任务`，故同时带 `节点`/`任务`/`父`
       三键。投递文本＝《清单存储.派发文本》(该节点标题＋详情＋整棵子树逐层清单＋再分派授权语)。
       应答 {ok, 节点, 任务, 投递:"已发出"}（`节点` 含 `卡片状态`，受理即「发送中」）。 */
    呼叫AI: function (节点, 执行者) {
      执行者 = 执行者 || {};
      return 调用('call_ai', {
        节点: 节点, 任务: 节点, 父: 节点,
        执行者: { 端: 执行者.端 || '', 对话: 执行者.对话 || '', 终身号: 执行者.终身号 || '' }
      });
    },

    /* 广播帧订阅（投递受理 / 投递结果）：fn(帧) 收帧即回调；返回 fn 便于退订。 */
    订阅广播: function (fn) {
      if (typeof fn === 'function') _广播监听.push(fn);
      return fn;
    },
    退订广播: function (fn) {
      var i = _广播监听.indexOf(fn);
      if (i >= 0) _广播监听.splice(i, 1);
    },

    // 网页设置落盘（服务端 0.17）：读/写 使用痕迹\配置文件\任务面板配置.json 的 网页设置
    设置读取: function () { return 调用('settings_get', {}); },
    设置保存: function (设置) {
      var 体 = (设置 && typeof 设置 === 'object') ? 设置 : {};
      return 调用('settings_set', { 设置: 体 });
    },

    /* 服务器（0.07 多服务器切换 / 自动发现）：选中项＝「定向谁应答」 */
    选中服务器: function () { return 读服务器选择(); },     // {实例号, 名称}；实例号空＝自动（谁先答算谁）
    设置服务器: function (实例号, 名称) {
      var v = String(实例号 == null ? '' : 实例号).trim();
      var 名 = String(名称 || (_服务器表[v] ? _服务器表[v].名称 : '') || '');
      存服务器选择(v, 名);                                  // 空实例号＝清除，回到「自动」
      try {
        if (typeof global.任务面板_服务器变化 === 'function') global.任务面板_服务器变化(读服务器选择());
      } catch (e) { }
      return 读服务器选择();
    },
    服务器列表: 服务器列表,           // [{实例号,名称,版本,地址,在线,最近}]（按最近在线倒序）
    最近应答: function () { return _最近应答; },
    订阅服务器: function (fn) { if (typeof fn === 'function') _服务器监听.push(fn); return fn; },
    退订服务器: function (fn) {
      var i = _服务器监听.indexOf(fn);
      if (i >= 0) _服务器监听.splice(i, 1);
    },
    选中在线: function () {                                  // 选中的实例是否当前在线（界面如实提示用）
      var sv = 选中实例号();
      if (!sv) return true;
      var 表 = 服务器列表(), i;
      for (i = 0; i < 表.length; i++) { if (表[i].实例号 === sv) return !!表[i].在线; }
      return false;
    }
  };

  // 首屏即尝试连接（静默：连上不宣告，只等应答）
  if (全局可WS()) 确保连接();

  global.接口 = 接口;
})(window);
