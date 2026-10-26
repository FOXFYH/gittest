/* ============================================================
 * 【清单系统】网页模块 · 接口.js
 * 版本：0.36
 * 职责：网页版与服务器的通信层——由 fetch(/api/*) 改为 WebSocket（WS）请求层。
 *   · 0.36（2026-10-27）分享节流：`分享取卡(卡号, 轻)` 支持只回标题层；
 *     新增 `分享取节点(卡号, 节点号)` → card_share 带节点号，只取一条小绿卡正文。
 *   · 0.35（2026-10-26）新增 `绿卡评定(编号,项,评定)` → `green_note`、
 *     `绿卡缩进(编号,项,方向)` → `green_indent`（小绿卡评定与层级调整）。
 *   · 0.34（2026-10-26）更名「清单系统 1.0」：模块标题/文案换名；localStorage 键改
 *     `清单系统_*`（旧 `任务面板_*` 已由页面脚本一次性迁移）；协议/频道不变。
 *   · 0.33（2026-10-26）终身号分享：新增 `进入分享(号)`——`?卡号=<终身号>` 打开时切到公开只读
 *     频道 TASKHUBSHARE（线路 A、无口令），`分享取卡(号)` 走 `card_share` 取「本卡＋全部下级」；
 *     `连接状态()` 增 `分享` 字段。服务端 网页服务 0.42（分享频道白名单 card_share/ping/状态）。
 *   · 0.32（2026-10-26）按《16_手机网页版开发规范》§16.8 回归**固定口令**（31415926fF@）：
 *     口令缓存键升级为 `清单系统_口令2`（一次性重新输入，源码不写死口令值）。
 *   · 0.31（2026-10-26）P54：取消「谁先答算谁」——首次收到报到帧即默认选中该客户端并存
 *     localStorage（用户可在设置里主动改选）；此后请求帧带 `sv` 定向，只有所选客户端应答。
 *   · 0.30（2026-10-26）P54：连上后经 WS `状态` 自检一次，把服务器「在线」播种进服务器表
 *     （替代旧 8901 HTTP 播种，无额外心跳）；报到时效放宽到 90 秒（服务端 60 秒报到一次）。
 *   · 0.29（2026-10-26）老板口径「GitHub 部署版＝纯 WS 遥控」：**彻底删除本机 HTTP 通道**
 *     （不再 fetch /api/*、不再探测 8901）；线路读取/切换、状态诊断一律走 WS 帧。
 *     首连默认线路改为 B（s20307.nyc1，A 配额已耗尽），口令拼频道规则不变。
 *   · 0.27（2026-10-26）A6 设置页网络诊断配套：本层不改协议，仅版本对齐（0.26→0.27）；
 *     `连接状态()` 继续供 HTTP `/api/status` 不可达时作 WS 行参考；频道/线路/被拒字段未动。
 *   · 0.26（2026-10-26）P51：账号通道 A/B 双频道可自由切换——
 *     线路（cluster/api_key）不再写死在源码，运行时经 `线路()` 路由（HTTP `/api/线路`，失败回落 WS）
 *     从服务端配置读取并缓存 localStorage（`清单系统_线路`）；当前通道存 `清单系统_通道`。
 *     `频道地址()` 按当前线路拼出；`切换通道(名)` 通知服务端切换并重连（频道名规则不变）。
 *     `system:error` / quota / exceeded → 状态「被拒」并记原文，`连接状态()` 回 被拒/拒绝原文/
 *     通道/线路，供设置页红字与「切到线路B」一键切换。
 *   · 0.25（2026-10-24）A5 凭号直达：新增路由 `card_any`（HTTP 镜像 `/api/card_any`）与
 *     `凭号取卡(卡号)`——按任意卡号（`#n` / `An` / `L` / `S` / `T` / `P` / `ST` / `SP`）取卡；
 *     服务端只取卡、**不判可见性**。既有路由与 `邮箱` 自动透传逻辑一行未动。
 *   · 0.24（2026-10-24）按老板口径加「**邮箱号登录 + 每人自己的清单空间**」：本层统一管身份——
 *     `清单系统_邮箱` 本地缓存；`规范化邮箱()`（纯 4 位数字自动补 `@1219299644`）；
 *     `调用()` 给**每个请求**自动带 `邮箱` 参数（已有同名参数则不覆盖）；`清单列表(指纹,全部)`
 *     在「全部」时带 `全部=1` 让服务端放行所有 AI 的清单。口令逻辑原样不动。
 *   · 0.23（2026-10-24）按老板最终口径新增清单【发起联动】勾选：`发起联动(编号,开)` → `联动/切换`
 *     （所有清单可勾；勾上由服务端后台执行宿主登记的 CLI 命令，返回 `{ok,发起联动,联动上次}`）。
 *     不读信号文件、不轮询。服务端 网页服务.py 0.27 / 清单存储 0.32。
 *   · 0.22（2026-10-23）按老板口径给卡片加「**本文书写规则**」（数据层 `书写规则`，提示词，默认空）：
 *     `清单新建` / `清单改` / `任务新建` / `任务改` / `子点新建` / `点改` 各加**第 5 参 `书写规则`**；
 *     新建一律 `书写规则 || ''`（默认空、不套默认文案），改类一律 `undefined ? null : 值`（null＝不改）。
 *     配合《清单存储》0.25 / 网页服务 0.26。
 *   · 0.21（2026-10-22）按用户口径新增「**小绿卡转细分卡**」：`拆细分(编号,项)` → `green_split`
 *     （把某一张小绿卡连同它**全部下级**整棵子树迁成该清单下的一张新细分卡；流水账不支持；
 *     父卡涨版本号、新卡版本号 1）。服务端 网页服务.py 0.24 / 清单存储 0.20。
 *   · 0.20（2026-10-22）按用户口径新增「**流水账**」与小标题按键升级：`追评(编号,标题,正文)`
 *     → `list_append`（只在末尾追一条、小正文 ≤500 字、不涨版本号）；`取段落(编号,项)` → `green_get`
 *     （按小标题取那一条的小正文，流水账省流用）；`改段落(编号,项,标题,正文)` → `green_edit`、
 *     `删段落(编号,项)` → `green_del`（改/删某一条，涨版本号）；`允许改历史(编号,可改)` → `list_hist`
 *     （「允许修改历史流水账」开关，默认 true）。服务端 网页服务.py 0.23 / 清单存储 0.19。
 *   · 0.19（2026-10-22）按用户口径改名：`清单新建` 的默认类型「总管清单」→「**树状清单**」
 *     （旧值服务端仍按别名折算，兼容旧数据/旧服务器）。
 *   · 0.18（2026-10-21）新增 `绿卡状态(编号,项,状态)` → `green_state`（正文顶部小绿卡的状态灯：
 *     未完成/进行中/已完成/放弃；服务端 0.22《清单存储》0.14，正文原文不动、不涨卡片版本号）；
 *     新增 `清单改(编号,名称,详情,大白话)` → `list_edit`（清单卡也能改正文/大白话，改了涨版本号）。
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
 *       页面下拉展示「名称（实例号）· 在线/离线」。④选中项存 localStorage（key=`清单系统_服务器`）；
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

  var 版本 = '0.36';

  /* ---------------- 可配置常量（页面里可覆盖） ----------------
   * §19 对外页面安全：**频道号当口令**——连接频道 = 固定前缀 + 口令，【源码不写死频道名】。
   *   口令由用户首次打开页面时输入、存 localStorage（key=清单系统_口令2），运行时拼出频道。
   *   想整体覆盖（如本机调试）：在页面 <head> 里先定义
   *     window.清单系统_WS配置 = {前缀:'…', 口令:'…', 密钥:'…', 主机:'…'} 即可。
   * 密钥（api_key）是 PieSocket 通道【基础设施】凭据（与 TTS 同一把），非频道口令。 */
  var 口令存储键 = '清单系统_口令2';
  // P54 分享模式：`?卡号=A00001` 打开时走公开只读频道（线路 A，无口令），不要邮箱/登录。
  var _分享模式 = false;
  var 分享频道 = 'TASKHUBSHARE';
  var 分享主机 = 'wss://free.blr2.piesocket.com/v3/';
  var 分享密钥 = 'ReDFavhh0qnOCKUUjQiLKVZ9RdxA6e4BGVKxxNug';   // 线路 A（基础设施凭据）
  var 默认配置 = {
    主机: 'wss://s20307.nyc1.piesocket.com/v3/',
    前缀: 'TASKHUB',                       // 固定前缀（本项目自定、非敏感）
    口令: '',                              // 口令（默认空＝首登填；由 取口令() 供值）
    密钥: 'IWkfk43ha3yilmYGRGLDeAoVW9tu6QqiSviJmudL',   // 线路 B（A 配额已耗尽）
    单段上限: 10000,                       // 单段正文最大字节数（FOX 帧切片）
    请求超时: 20000,                        // 默认单请求超时（毫秒）
    退避: [3, 6, 12, 24, 48, 60]           // 断线逐次退避（秒），用尽即宣告失败
  };
  var 配置 = (function (基础, 覆盖) {
    var o = {}, k;
    for (k in 基础) { if (Object.prototype.hasOwnProperty.call(基础, k)) o[k] = 基础[k]; }
    if (覆盖) { for (k in 覆盖) { if (Object.prototype.hasOwnProperty.call(覆盖, k)) o[k] = 覆盖[k]; } }
    return o;
  })(默认配置, global.清单系统_WS配置);

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
  // 0.32：口令回归《16_手机网页版开发规范》§16.8 固定口令；缓存键升级一次，
  //   让曾存过临时口令的浏览器重新输入（不在源码里写死口令值）。
  // 生效口令：优先本地缓存 → 页面覆盖提供的 配置.口令 → 空（空＝需要首登填）
  function 取口令() {
    var v = 读缓存口令();
    if (v) return v;
    return String(配置.口令 || '');
  }
  function 有口令() { return _分享模式 || !!取口令(); }
  function 频道名() { return _分享模式 ? 分享频道 : (配置.前缀 + 取口令()); }

  /* ---------------- 账号通道（P51：A/B 双线路，同一个频道名） ----------------
   * 两条线路的 cluster/api_key 只存在服务端配置文件里，本页运行经 `线路()` 路由取回后
   * 缓存在 localStorage（`清单系统_线路`）；当前通道存 `清单系统_通道`。
   * 源码不写死 B 的地址/密钥；A 保留原有 `配置.主机/密钥` 作首连兜底。 */
  var 通道存储键 = '清单系统_通道';
  var 线路存储键 = '清单系统_线路';
  function 读通道名() {
    try {
      var v = String(global.localStorage.getItem(通道存储键) || '').trim().toUpperCase();
      if (v === 'A' || v === 'B') return v;
    } catch (e) { }
    return 'A';
  }
  function 存通道名(v) {
    try { global.localStorage.setItem(通道存储键, v); } catch (e) { }
  }
  function 读线路缓存() {
    try {
      var d = JSON.parse(String(global.localStorage.getItem(线路存储键) || '{}'));
      if (d && typeof d === 'object') return d;
    } catch (e) { }
    return {};
  }
  function 存线路缓存(t) {
    try { global.localStorage.setItem(线路存储键, JSON.stringify(t || {})); } catch (e) { }
  }
  function 当前线路() {
    var 名 = 读通道名(), 表 = 读线路缓存(), x = 表[名];
    if (x && x.cluster && x.key) return { 名: 名, cluster: String(x.cluster), key: String(x.key) };
    if (名 === 'B' && 配置.密钥) {
      return { 名: 'B', cluster: '', key: String(配置.密钥), 主机: 配置.主机 };
    }
    return null;
  }
  function 应用线路数据(d) {
    if (!d || typeof d !== 'object') return;
    if (d.线路 && typeof d.线路 === 'object') 存线路缓存(d.线路);
    var 名 = String(d.通道 || '').trim().toUpperCase();
    var 已有 = '';
    try { 已有 = String(global.localStorage.getItem(通道存储键) || ''); } catch (e) { }
    if (!已有 && (名 === 'A' || 名 === 'B')) 存通道名(名);   // 首载按服务端上次选择
    var 应连 = 读通道名();
    if (_连接线路 && 应连 !== _连接线路) 重连();           // 服务端上次是另一条线 → 跟过去
  }
  // 取线路：一律走 WS 路由 `线路`（GitHub Pages 无后端，绝不再碰本机 HTTP）
  function 取线路() {
    return 调用('线路', {}).then(function (d) { 应用线路数据(d); return d; });
  }
  function 通知服务端切通道(名) {
    try { 调用('切换通道', { 通道: 名 })['catch'](function () { }); } catch (e) { }
  }

  /* ---------------- 身份：邮箱号（0.24 老板 2026-10-24 口径） ----------------
   * 每个 AI 用自己的邮箱号登录（如 `0019@1219299644`，只填 4 位数字自动补全称）；
   * 本地缓存 key=清单系统_邮箱；所有请求由 调用() 自动带上 `邮箱` 参数。 */
  var 邮箱存储键 = '清单系统_邮箱';
  var 邮箱域名 = '@1219299644';

  function 规范化邮箱(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^\d{4}$/.test(s)) return s + 邮箱域名;      // 纯 4 位数字 → 补 @1219299644
    return s;
  }
  function 读取邮箱() {
    try { return 规范化邮箱(global.localStorage.getItem(邮箱存储键) || ''); } catch (e) { return ''; }
  }
  function 存邮箱(v) {
    var s = 规范化邮箱(v);
    try {
      if (s) global.localStorage.setItem(邮箱存储键, s);
      else global.localStorage.removeItem(邮箱存储键);
    } catch (e) { }
    return s;
  }
  function 需要邮箱() { return !读取邮箱(); }

  /* ---------------- 服务器（多服务器切换 / 自动发现 / 按服务器归属） ---------------- */
  // 选中项：localStorage 存 {实例号, 名称}；实例号为空串＝「自动（谁先答算谁）」。
  var 服务器存储键 = '清单系统_服务器';
  var 报到时效 = 90000;          // 报到帧视为「在线」的时效（服务端每 60 秒报到一次，90 秒宽容）

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
    // P54：没主动选过服务器时，默认选中这台报到的（不再落到「谁先答算谁」的自动模式）；
    //   之后可在设置里主动切换，选择存 localStorage。
    if (!读服务器选择().实例号) 存服务器选择(sv, String(d.名称 || ''));
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

  /* 0.29：本机 HTTP 路由表已删除——GitHub 部署版不再使用任何 /api/* 调用。 */

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
    var k = '清单系统_网页软件号';
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
  var _拒绝原文 = '';
  var _连接线路 = '';
  var _待发队列 = [];
  var _待应答 = {};
  var _收帧缓冲 = {};

  function 频道地址() {
    if (_分享模式) return 分享主机 + 分享频道 + '?api_key=' + 分享密钥;
    var 线 = 当前线路();
    if (线 && 线.cluster) {
      return 'wss://' + 线.cluster + '.piesocket.com/v3/' + 频道名() + '?api_key=' + 线.key;
    }
    if (线 && 线.key && 线.主机) {
      return 线.主机 + 频道名() + '?api_key=' + 线.key;
    }
    return 配置.主机 + 频道名() + '?api_key=' + 配置.密钥;
  }
  function 有WS() { return !!ws && ws.readyState === 1; }
  function 是被拒原文(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    return t.indexOf('system:error') >= 0 || t.indexOf('quota') >= 0
      || t.indexOf('exceeded') >= 0 || t.indexOf('over daily message quota') >= 0;
  }
  function 标被拒(原文) {
    _连接态 = '被拒';
    _拒绝原文 = String(原文 || '').slice(0, 600);
    _最近错 = _拒绝原文;
    var w = ws; ws = null;
    try { if (w) w.close(); } catch (e) { }
    通知状态();
  }
  function 通知状态() {
    try {
      if (typeof global.清单系统_通道变化 === 'function') {
        global.清单系统_通道变化(连接态对象());
      }
    } catch (e) { }
  }

  function 连接态对象() {
    var 线 = 当前线路();
    return { 状态: _连接态, 频道: 频道名(), 重试: _连续失败, 最近错: _最近错, 需口令: !有口令(),
             分享: _分享模式,
             通道: 读通道名(), 线路: (线 && 线.名) || 读通道名(),
             线路集群: (线 && 线.cluster) || '',
             被拒: _连接态 === '被拒', 拒绝原文: _拒绝原文 };
  }

  // 0.29：连上后立刻用 WS 路由 `状态` 自检一次，把服务器「在线」播种进服务器表
  // （替代旧版 P52 的 8901 HTTP 播种；不额外发心跳，只在每次连上时问一次）
  function 自检播种() {
    if (!有口令()) return;
    try {
      调用('状态', {}, { 超时: 6000 }).then(function (r) {
        var s = (r && r.状态) || {};
        var sv = String(s.服务器实例号 || '').trim();
        if (sv) 记报到({ t: '服务器报到', 名称: s.服务器名称 || '', 服务器: sv,
                        版本: s.版本 || '', 地址: '' });
      })['catch'](function () { });
    } catch (e) { }
  }

  function 开连接() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (_连接态 === '失败') return;
    if (!有口令()) { _连接态 = '等待口令'; _最近错 = '未设置口令（首次使用请先填口令）'; 通知状态(); return; }
    if (!全局可WS()) { _宣告失败('本环境不支持 WebSocket'); return; }
    var w;
    try { w = new WebSocket(频道地址()); } catch (e) { _宣告失败('创建 WebSocket 失败：' + e); return; }
    ws = w; _连接态 = '连接中'; _连接线路 = 读通道名(); 通知状态();
    w.onopen = function () {
      if (ws !== w) return;
      _连接态 = '已连'; _连续失败 = 0; _最近错 = ''; _拒绝原文 = '';
      var 队 = _待发队列; _待发队列 = [];
      队.forEach(function (正文) { try { 发正文(正文); } catch (e) { } });
      通知状态();
      自检播种();
    };
    w.onmessage = function (ev) { 收消息(ev); };
    w.onerror = function () { /* onclose 随后必到 */ };
    w.onclose = function () {
      if (ws !== w) return;
      ws = null;
      if (_连接态 === '被拒') { 通知状态(); return; }
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
    _连接态 = '未连'; _连续失败 = 0; _最近错 = ''; _拒绝原文 = '';
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
    // 0.33：只有「不带 FOX 帧头的纯文本」才可能是拒连原文；正常业务正文里出现 quota 等词
    //   绝不能误判成被拒（分享大正文曾因此被整段当拒绝、页面空白）。
    if (raw.indexOf('【FOXID:') !== 0 && 是被拒原文(raw)) { 标被拒(raw); return; }
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
      if (typeof global.清单系统_投递广播 === 'function') global.清单系统_投递广播(帧);
    } catch (e) { }
  }

  function 消费(正文) {
    var d;
    try { d = JSON.parse(正文); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    if (d.t === '服务器报到') { 记报到(d); return; }   // 报到帧：永远处理（自动发现，不受选中影响）
    if (!归属本机(d)) return;                          // 非本机所选服务器的帧 → 丢弃，不更新界面
    if (d.服务器) _最近应答 = String(d.服务器);         // 0.10：记住「真正应答的那台」，供界面如实提示
    if (d.t === '投递受理' || d.t === '投递结果' || d.t === '清单R2结果') { 广播分发(d); return; }   // 广播帧：不走应答配对（0.41 加系统清单 R2 拉取结果）
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

  // 统一调用：只走 WS（GitHub 部署版＝纯 WS 遥控，无任何本机 HTTP 回退）
  function 调用(路由, 载荷, 选项) {
    载荷 = 载荷 || {};
    选项 = 选项 || {};
    // 0.24：所有请求自动带当前登录邮箱（调用方自己给了就不覆盖；未登录则不带＝公共视角）
    try {
      if (载荷.邮箱 === undefined) {
        var 我 = 读取邮箱();
        if (我) 载荷.邮箱 = 我;
      }
    } catch (e) { }
    if (有WS()) return WS请求(路由, 载荷, 选项);
    if (_连接态 === '失败') {
      return Promise.reject(new Error('通道未连接：' + _最近错));
    }
    return 等连接(2500).then(function (ok) {
      if (ok) return WS请求(路由, 载荷, 选项);
      return WS请求(路由, 载荷, 选项);   // 连接超时后由 WS 请求 reject
    });
  }

  function 进入分享模式() {
    _分享模式 = true;
    _连接态 = '未连';
    重连();
  }

  /* ---------------- 口令（§19 首登填、本地缓存） ---------------- */
  function 需要口令() { return !有口令(); }

  // 设置口令：存本地缓存 → 用新口令重连（重连内部会先关旧连再按新频道开连）。返回 bool。
  function 设置口令(口令值) {
    var v = String(口令值 == null ? '' : 口令值).trim();
    if (!v) return false;
    存缓存口令(v);
    try {
      if (typeof global.清单系统_口令变化 === 'function') global.清单系统_口令变化(v);
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

  /* ---------------- 账号通道切换（P51） ----------------
   * 选 A/B → 记住本地选择 → 通知服务端切到同一条线（持久化配置）→ 立即重连。
   * 频道名不变（同一频道，只换 cluster+api_key）。 */
  function 切换通道(名) {
    var n = String(名 || '').trim().toUpperCase();
    if (n !== 'A' && n !== 'B') return false;
    var 旧 = 读通道名();
    存通道名(n);
    if (n !== 旧) 通知服务端切通道(n);
    重连();
    return true;
  }

  /* ---------------- 对外接口（沿用既有语义，前端解析不用大改） ---------------- */
  var 接口 = {
    版本: 版本,
    raw: 调用,

    连接状态: function () { return 连接态对象(); },
    重连: 重连,
    // 0.33 分享：`?卡号=<终身号>` 打开时切到公开只读频道（线路 A，无口令）
    进入分享: 进入分享模式,

    /* P51 账号通道（A/B 双线路，同一频道名） */
    线路: 取线路,
    线路表: 读线路缓存,
    当前通道: 读通道名,
    切换通道: 切换通道,

    /* §19 口令（首登填、本地缓存） */
    需要口令: 需要口令,
    设置口令: 设置口令,
    读取口令: 取口令,
    清除口令: 清除口令,

    /* 0.24 身份（邮箱号登录）——所有请求自动带 `邮箱` 参数 */
    规范化邮箱: 规范化邮箱,
    读取邮箱: 读取邮箱,
    设置邮箱: 存邮箱,
    需要邮箱: 需要邮箱,

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

    // 0.25 A5 凭号直达：按任意卡号取卡（#n / An / L / S / T / P / ST / SP），服务端不判可见性
    凭号取卡: function (卡号) { return 调用('card_any', { 卡号: 卡号 || '' }); },
    // P54：分享取卡——凭精确终身号只读取回「本卡 + 全部下级」（不需要邮箱/登录）
    // 0.36：轻=true 只回标题层（网页查卡默认）；节点号 → 只取这一条小绿卡的正文（点了才取）
    分享取卡: function (卡号, 轻) {
      var p = { 卡号: 卡号 || '' };
      if (轻) p.轻 = 1;
      return 调用('card_share', p);
    },
    分享取节点: function (卡号, 节点号) {
      return 调用('card_share', { 卡号: 卡号 || '', 节点号: 节点号 || '' });
    },

    /* ---------------- A7：登录下拉框账号列表（服务端 网页服务.py 0.31 /api/accounts） ---------------- */
    账号列表: function () { return 调用('accounts', {}); },

    /* ---------------- 清单库（0.09 新增；服务端 网页服务.py 0.12 路由；名字冻结） ---------------- */
    // 清单列表（带 指纹 → 差额，无变化回 {未变:true}；全部=真 → 看所有 AI 的清单）
    清单列表: function (指纹, 全部) {
      var 体 = 指纹 ? { since: 指纹 } : {};
      if (全部) 体.全部 = '1';
      return 调用('lists', 体);
    },
    // 新建清单（类型：树状清单/系统清单；正文 详情；大白话简述）
    清单新建: function (名称, 详情, 类型, 大白话, 书写规则) {
      return 调用('list_new', { 名称: 名称 || '', 详情: 详情 || '', 类型: 类型 || '树状清单',
                               大白话: 大白话 || '', 书写规则: 书写规则 || '' });
    },
    // 清单详情（返回 {清单, 任务列表}）
    清单详情: function (编号) { return 调用('list_get', { no: 编号, 编号: 编号 }); },
    // 清单改名
    清单改名: function (编号, 名称) {
      return 调用('list_rename', { no: 编号, 编号: 编号, 名称: 名称 || '' });
    },
    // 清单改正文/大白话（清单卡也能像回复框一样改；改了涨版本号）
    清单改: function (编号, 名称, 详情, 大白话, 书写规则) {
      return 调用('list_edit', { no: 编号, 编号: 编号,
                                  名称: (名称 === undefined ? null : 名称),
                                  详情: (详情 === undefined ? null : 详情),
                                  大白话: (大白话 === undefined ? null : 大白话),
                                  书写规则: (书写规则 === undefined ? null : 书写规则) });
    },
    // 清单删除（连同其任务与小点）
    清单删除: function (编号) { return 调用('list_del', { no: 编号, 编号: 编号 }); },

    // 任务新建（在清单下建一张任务小卡；大白话＝标题下简述）
    任务新建: function (清单, 标题, 详情, 大白话, 书写规则) {
      return 调用('task_new', { 清单: 清单, 标题: 标题 || '', 详情: 详情 || '',
                               大白话: 大白话 || '', 书写规则: 书写规则 || '' });
    },
    // 任务详情（返回 {任务, 小点列表}）——也是「呼叫 AI 后轮询 卡片状态」的收口接口
    任务详情: function (编号) { return 调用('task_get', { no: 编号, 编号: 编号 }); },
    // 任务改（标题/详情/大白话；给 null 的不改）
    任务改: function (编号, 标题, 详情, 大白话, 书写规则) {
      return 调用('task_edit', { no: 编号, 编号: 编号, 标题: 标题, 详情: 详情, 大白话: 大白话,
                               书写规则: (书写规则 === undefined ? null : 书写规则) });
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
    子点新建: function (父, 标题, 详情, 大白话, 书写规则) {
      return 调用('point_new', { 父: 父, 任务: 父, 标题: 标题 || '', 详情: 详情 || '',
                                 大白话: 大白话 || '', 书写规则: 书写规则 || '' });
    },
    // 点详情（`point_get {no}` → `{ok, 点:{编号,父,标题,详情,大白话,完成,子,任务}, 子列表:[…]}`）
    点详情: function (编号) { return 调用('point_get', { no: 编号, 编号: 编号 }); },
    // 点改（标题/正文/大白话；给 null 的不改）
    点改: function (编号, 标题, 详情, 大白话, 书写规则) {
      return 调用('point_edit', { no: 编号, 编号: 编号, 标题: 标题, 详情: 详情, 大白话: 大白话,
                                 书写规则: (书写规则 === undefined ? null : 书写规则) });
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
    // 卡片回复（大白话总结 ≤500 + 正文 ≤1 万；不涨卡片版本号）
    卡片回复: function (编号, 大白话, 正文, 作者) {
      return 调用('card_reply', { no: 编号, 编号: 编号, 大白话: 大白话 || '',
                                  正文: 正文 || '', 作者: 作者 || '' });
    },
    // 正文顶部小绿卡的状态灯（未完成/进行中/已完成/放弃；正文原文不动、不涨版本号）
    绿卡状态: function (编号, 项, 状态) {
      return 调用('green_state', { no: 编号, 编号: 编号, 项: 项 || '', 状态: 状态 || '' });
    },

    /* 0.20【流水账（只能追评）＋小标题按键升级（查/改/删某一条）】服务端 网页服务.py 0.23 */
    // 流水账在末尾追评一条（标题＋小正文 ≤500 字；不涨版本号）→ {ok, 详情, 条数}
    追评: function (编号, 标题, 正文) {
      return 调用('list_append', { no: 编号, 编号: 编号, 标题: 标题 || '', 正文: 正文 || '' });
    },
    // 按小标题取那一条的小正文（流水账可能极长：先看小标题、再逐条取）→ {ok, 段落}
    取段落: function (编号, 项) {
      return 调用('green_get', { no: 编号, 编号: 编号, 项: 项 || '' });
    },
    // 改某一条（小标题连同它的小正文；标题改名时状态跟着迁；涨版本号）→ {ok, 详情, 版本号}
    改段落: function (编号, 项, 标题, 正文) {
      return 调用('green_edit', { no: 编号, 编号: 编号, 项: 项 || '',
                                  标题: (标题 === undefined ? null : 标题),
                                  正文: (正文 === undefined ? null : 正文) });
    },
    // 删某一条（小标题连同它的小正文；涨版本号）→ {ok, 详情, 版本号, 条数}
    删段落: function (编号, 项) {
      return 调用('green_del', { no: 编号, 编号: 编号, 项: 项 || '' });
    },
    // 1.08：改小绿卡评定（可信/存疑/未评定）；写回正文、涨版本号 → {ok, 详情, 评定, 版本号}
    绿卡评定: function (编号, 项, 评定) {
      return 调用('green_note', { no: 编号, 编号: 编号, 项: 项 || '', 评定: 评定 || '未评定' });
    },
    // 1.08：调小绿卡层级（左/右，每次 2 空格）→ {ok, 详情, 缩进, 版本号}
    绿卡缩进: function (编号, 项, 方向) {
      return 调用('green_indent', { no: 编号, 编号: 编号, 项: 项 || '', 方向: 方向 || '右' });
    },
    /* 0.21【小绿卡转细分卡（整棵子树迁移）】服务端 网页服务.py 0.24 */
    // 把某一张小绿卡（连同它全部下级）整棵子树迁成该清单下的一张新细分卡 → {ok, 详情, 版本号, 新卡}
    拆细分: function (编号, 项) {
      return 调用('green_split', { no: 编号, 编号: 编号, 项: 项 || '' });
    },
    // 流水账「允许修改历史流水账」开关（默认 true；不传 可改 → 只读）→ {ok, 可改}
    允许改历史: function (编号, 可改) {
      var 体 = { no: 编号, 编号: 编号 };
      if (可改 !== undefined) 体.可改 = 可改 ? 'true' : 'false';
      return 调用('list_hist', 体);
    },

    /* 0.23【清单发起联动】勾上＝这篇清单要对外发联动信号；返回 {ok, 发起联动, 联动上次} */
    发起联动: function (编号, 开) {
      return 调用('联动/切换', { 编号: 编号, no: 编号, 开: 开 ? 'true' : 'false' });
    },

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

    // 网页设置落盘（服务端 0.17）：读/写 使用痕迹\配置文件\清单系统配置.json 的 网页设置
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
        if (typeof global.清单系统_服务器变化 === 'function') global.清单系统_服务器变化(读服务器选择());
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
  // P51：异步取线路配置（含服务端上次选择的通道），拿到后如与首连不同会自动重连
  try { 取线路()['catch'](function () { }); } catch (e) { }

  global.接口 = 接口;
})(window);
