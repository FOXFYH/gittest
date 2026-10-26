/* ============================================================
 * 【任务面板】网页模块 · 面板.js
 * 版本：0.27
 * 职责：页面【装配层】——《软件架构设计》§6 手机网页版。
 *   · 顶栏：左【新建】【返回主页】、中题名+【网页版版本（唯一）】+角色、右【设置】。
 *   · 【设置】菜单：收纳 **网络诊断**＋**服务器选择**（含在线/离线小标）＋**账号通道 A/B**
 *     ＋**口令**钮＋**版本**。
 *   · 0.27（2026-10-26）A6 网络诊断：设置面板最上一行一句话判定（红/绿）＋【重测】；
 *     下面「服务器」行＝HTTP 已连/不可达＋地址＋往返毫秒＋服务版本；「WS」行＝通道/线路/
 *     状态/频道/最近收帧时间/最近错原文。数据优先 `GET /api/status`（不污染真配置），
 *     HTTP 不可达时回退页面自身 `接口.连接状态()` 供参考；被拒仍保留「切到线路B」一键钮。
 *   · 0.26（2026-10-26）P51：设置里新增「账号通道」——`#通道_选择` 下拉（主A/副B），选完立即
 *     调 接口.切换通道() 并刷新状态；被拒（quota/key）时设置里红字「线路X 被拒：<原文>」+
 *     「切到线路B」一键切换钮；状态行显示当前线路/集群/连接状态。两账号同一频道名。
 *     服务器/本地版版本号显示在设置里；主页顶栏只显示一个版本号（网页版版本，与本页 <meta> 同源）。
 *   · 角色脚标：ping 成功→「已连接」（不再并列服务端版本号）；未连/频道通了没应答/通道失败 如实提示。
 *   · §19 口令：首登窗 + 设置里的「重设口令」（频道＝前缀+口令，运行时拼）。
 *   · 页面主体（主页清单 / 唯一卡片 / 细分跳页 / 呼叫 AI）交由 `清单页.js`（0.03）承载：
 *     本层只在首载时调 `清单页.载入主页()`、切服务器后调 `清单页.重载()`、并把 `提示` 借给它用。
 * 说明：纯 DOM，不引外部 CDN。依赖：接口.js、卡片.js、清单页.js（须先加载）。
 * 维护记录：
 *   · 0.24（2026-10-25）A7 登录下拉接账号库：**下拉改为先拉服务端账号库**（接口.js `账号列表()`
 *     → 网页服务 0.31 `/api/accounts` → 账号库.账号列表）。开登录窗即拉取，成功立刻重画：
 *     「人类管理员」恒第一 → 账号库真实账号（去重、跳过管理员）→ 末尾「＋ 输入新邮箱…」。
 *     无痕窗口（localStorage 全空）也能看到真实账号；服务端不可达/空表/异常时静默回落本地缓存，
 *     失败最多重试 2 次（仅登录窗仍打开时），不弹错、不阻断登录。空表/单账号/超长邮箱均不报错。
 *     账号不写死在前端。
 *   · 0.23（2026-10-24）A5 凭号直达 + 登录入口：登录窗改为「**下拉框 + 输入新邮箱**」——
 *     下拉框读可配置账号列表（localStorage `任务面板_账号列表`，由后续 A3 账号接口补数据），
 *     **人类管理员固定第一**（`任务面板_管理员` 可配置；为空＝公共视角看全部），其余按列表顺序；
 *     选中即进入。地址栏带 `?卡号=` 时**不弹邮箱登录、不判无权限**，直接 `清单页.打开卡()` 打开该卡。
 *     前端只负责把当前账号交给 接口.js（请求自动带 `邮箱`），**不做任何权限 if**。
 *   · 0.22（2026-10-24）按老板口径加「**邮箱号登录 + 每人自己的清单空间**」：装配时先要邮箱号
 *     （`任务面板_邮箱` 已有则直接进），顶栏显示当前身份并可【换身份】；登录后才继续原有
 *     口令流程（未配置口令仍照旧弹口令框）。身份读写/规范化全在 接口.js 0.24；换身份后就地
 *     重载清单（`清单页.重载()`），不重开口令。
 *   · 0.21（2026-10-24）按 0023 转达的老板口径在【设置】里加**联动命令模板**：新增
 *     「TRAE 命令」「WB 命令」两个输入框＋【保存联动命令】，随 `settings_set` 落
 *     `网页设置` 的 `联动TRAE命令` / `联动WB命令`（与口令/服务器同一份配置、不随版本清理）；
 *     `应用设置()` 首载回填，`保存设置()` 把两条命令一并写回（未回填过的一侧不写，避免清空）。
 *     数据层 清单存储 0.33。
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

  var 版本 = '0.28';
  var 提示定时 = null;
  var _联动已载 = false;      // 0.21：设置里的联动命令是否已从服务端回填（没回填不写，免得清空）
  var _已启动 = false;        // 0.22：邮箱登录后是否已继续原有口令/首载流程

  function $(id) { return document.getElementById(id); }

  function 提示(文案) {
    var 条 = $('提示');
    if (!条) return;
    条.textContent = 文案;
    条.classList.remove('隐藏');
    if (提示定时) clearTimeout(提示定时);
    提示定时 = setTimeout(function () { 条.classList.add('隐藏'); }, 2600);
  }

  // ---------------- 0.25 系统清单 R2 手动拉取（上传全自动、下载纯手动） ----------------
  function 装R2拉取() {
    var 钮 = $('按钮_R2拉取');
    if (钮 && !钮.getAttribute('data-r2绑')) {
      钮.setAttribute('data-r2绑', '1');
      钮.addEventListener('click', function () {
        if (!global.接口 || typeof global.接口.raw !== 'function') { 提示('接口未就绪'); return; }
        提示('正在从 R2 拉取系统清单…');
        global.接口.raw('清单R2下', {}).then(function (r) {
          if (r && r.ok === false) 提示((r && r.err) || '拉取请求失败');
          // ok=true 只是「已受理」，真正结果等服务端广播 清单R2结果 帧
        })['catch'](function (e) { 提示('拉取请求失败：' + ((e && e.message) || e)); });
      });
    }
    if (global.接口 && typeof global.接口.订阅广播 === 'function') {
      global.接口.订阅广播(function (帧) {
        if (!帧 || 帧.t !== '清单R2结果') return;
        var 结 = 帧.结果 || {};
        if (结.忙) { 提示('正在拉取中，请稍候'); return; }
        if (结.ok) {
          if (结.已是最新) 提示('系统清单已是最新 · 远端版本 V' + (结.远端版本 || 0));
          else if (结.说明) 提示((结.说明) + ' · 远端版本 V' + (结.远端版本 || 0));
          else 提示('已拉取 ' + (结.拉取文件数 || 0) + ' 个文件 · 远端版本 V' + (结.远端版本 || 0));
        } else {
          提示('拉取失败：' + (结.err || '未知原因'));
        }
      });
    }
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
    // 0.21：保存两条联动命令（TRAE / WB），同走 settings_set 的网页设置
    var 联存 = $('按钮_联动保存');
    if (联存) 联存.addEventListener('click', function (e) {
      if (e) e.stopPropagation();
      保存设置();
      var 态 = $('设置_联动态');
      if (态) 态.textContent = '已保存';
      提示('联动命令已保存');
    });
    document.addEventListener('click', function (e) {
      if (!面 || 面.classList.contains('隐藏')) return;
      if (钮设置 && (e.target === 钮设置 || 钮设置.contains(e.target))) return;
      if (面.contains(e.target)) return;
      开设置(false);
    });
  }

  // ---------------- 账号通道（P51：A/B 双线路，同一个频道名） ----------------
  function 画通道态(态) {
    态 = 态 || {};
    var 选 = $('通道_选择'), 标 = $('通道_态');
    var 行 = $('通道_被拒行'), 原 = $('通道_拒绝原文'), 钮B = $('按钮_切到B');
    var 通 = String(态.通道 || (global.接口 && global.接口.当前通道 ? global.接口.当前通道() : 'A')).toUpperCase();
    if (选) 选.value = (通 === 'B' ? 'B' : 'A');
    if (!标) return;
    var 线 = String(态.线路 || 通 || 'A').toUpperCase();
    var 集 = String(态.线路集群 || '');
    if (态.被拒) {
      标.textContent = '线路' + 线 + ' 被拒';
      标.className = '服务器态 离线';
      if (原) 原.textContent = '线路' + 线 + ' 被拒：' + String(态.拒绝原文 || '服务端拒绝（无原文）');
      if (行) 行.style.display = '';
      if (钮B) 钮B.style.display = (线 === 'B') ? 'none' : '';
    } else if (态.状态 === '已连') {
      标.textContent = '线路' + 线 + (集 ? '（' + 集 + '）' : '') + ' 已连接';
      标.className = '服务器态 在线';
      if (行) 行.style.display = 'none';
    } else {
      标.textContent = '线路' + 线 + (集 ? '（' + 集 + '）' : '') + ' ' + (态.状态 || '未连');
      标.className = '服务器态 自动';
      if (行) 行.style.display = 'none';
    }
  }
  function 刷新通道态() {
    if (!global.接口 || !global.接口.连接状态) return;
    var 态 = null;
    try { 态 = global.接口.连接状态(); } catch (e) { return; }
    画通道态(态);
  }
  function 切通道(名) {
    名 = String(名 || '').trim().toUpperCase();
    if (名 !== 'A' && 名 !== 'B') return;
    if (global.接口 && global.接口.切换通道) global.接口.切换通道(名);
    if ($('通道_态')) {
      $('通道_态').textContent = '正在切到线路' + 名 + '…';
      $('通道_态').className = '服务器态 自动';
    }
    提示('正在切到线路' + 名 + '…');
    setTimeout(刷新通道态, 800);
    setTimeout(刷新通道态, 2500);
  }
  function 装通道() {
    var 框 = $('通道_选择');
    if (!框) return;
    框.addEventListener('change', function () { 切通道(String(框.value || 'A').toUpperCase()); });
    var 钮B = $('按钮_切到B');
    if (钮B) 钮B.addEventListener('click', function (e) { if (e) e.stopPropagation(); 切通道('B'); });
    global.任务面板_通道变化 = 刷新通道态;
    刷新通道态();
    if (global.接口 && global.接口.线路) {
      try {
        global.接口.线路().then(function () { 刷新通道态(); })['catch'](function () { });
      } catch (e) { }
    }
  }

  // ---------------- 0.28 网络诊断（服务器行＝WS 是否应答 / WS 行＝网页自身连接；判定一句话） ----------------
  var _网络测中 = false;
  var _网络上次 = null;       // { HTTP:{可用,耗时,版本,原因}, WS:{...} }（0.28 起 HTTP 仅作「WS 是否应答」的判定键）

  function 设网络态(元, 文案, 色) {
    if (!元) return;
    元.textContent = 文案;
    元.className = '网络态' + (色 ? ' ' + 色 : '');
  }
  // 服务端 WS 与网页自身 WS 合并显示：任一侧「被拒」都按被拒；服务端已连但网页没连上，
  // 以网页端实际状态显示（老板看到的就是网页这一侧）——/api/status 仍是主数据源。
  function 合并网络WS(服, 页) {
    服 = 服 || {}; 页 = 页 || {};
    var 出 = {}, k;
    for (k in 服) { if (Object.prototype.hasOwnProperty.call(服, k)) 出[k] = 服[k]; }
    var 页态 = String(页.状态 || ''), 服态 = String(服.状态 || '');
    if (页.被拒) {
      出.被拒 = true; 出.状态 = '被拒'; 出.网页被拒 = true;
      出.拒绝原文 = 页.拒绝原文 || 服.拒绝原文 || '';
      出.最近错 = 页.最近错 || 出.最近错 || '';
      出.通道 = 页.通道 || 出.通道; 出.线路 = 页.线路 || 出.线路;
      出.线路集群 = 页.线路集群 || 出.线路集群;
    } else if (页态 && 服态 === '已连' && 页态 !== '已连') {
      出.状态 = 页态; 出.网页状态 = 页态; 出.最近错 = 页.最近错 || 出.最近错 || '';
    }
    出.网页通道 = 页.通道 || ''; 出.网页状态 = 出.网页状态 || 页态;
    return 出;
  }
  function 画网络WS(WS) {
    WS = WS || {};
    var 态 = $('网络_WS态'), 细 = $('网络_WS详情');
    var 名 = String(WS.通道 || '?').toUpperCase();
    var 线 = String(WS.线路 || 名).toUpperCase();
    var 集 = String(WS.线路集群 || '');
    var 状 = String(WS.状态 || '未起');
    var 被拒 = !!WS.被拒;
    var 短 = '通道' + 名 + ' · 线路' + 线 + (集 ? '/' + 集 : '') + ' · ' + 状;
    if (WS.网页被拒 && 状 === '被拒') 短 += '（网页端）';
    else if (WS.网页状态 && WS.网页状态 !== 状) 短 += '（网页端 ' + WS.网页状态 + '）';
    设网络态(态, 短, (状 === '已连' && !被拒) ? '绿' : '红');
    var 片 = [];
    片.push(WS.频道 ? ('频道 ' + WS.频道) : '频道 –');
    片.push(WS.最近收帧时间 ? ('最近收帧 ' + WS.最近收帧时间) : '最近收帧：从未收到');
    if (被拒) 片.push('被拒原文：' + String(WS.拒绝原文 || WS.最近错 || '服务端拒绝（无原文）'));
    else if (WS.最近错) 片.push('最近错：' + String(WS.最近错));
    if (细) 细.textContent = 片.join('　·　');
  }
  function 画网络判定(HTTP, WS) {
    var 元 = $('网络_判定');
    if (!元) return;
    var 文 = '', 色 = '';
    WS = WS || {};
    if (!HTTP || !HTTP.可用) {
      文 = '服务器不可达（WS 通道无应答：' + ((HTTP && HTTP.原因) || '未知原因')
         + '）→ 问题在服务器 / 通道';
      色 = '红';
    } else if (WS.被拒) {
      文 = '服务器正常，WS 被拒（线路' + String(WS.线路 || WS.通道 || '?').toUpperCase()
         + '）：' + String(WS.拒绝原文 || WS.最近错 || '服务端拒绝（无原文）')
         + ' → 问题在 WS 账号配额/密钥';
      色 = '红';
    } else if (WS.状态 !== '已连') {
      文 = '服务器正常，WS 未连（' + String(WS.状态 || '未知') + '）：'
         + String(WS.最近错 || '尚无错误原文') + ' → 问题在 WS 网络/线路';
      色 = '红';
    } else {
      文 = '服务器与 WS 均正常（通道' + String(WS.通道 || '?').toUpperCase() + '）';
      色 = '绿';
    }
    元.textContent = 文;
    元.className = '网络判定 ' + 色;
  }
  function 测网络() {
    if (_网络测中) return;
    _网络测中 = true;
    var 判 = $('网络_判定');
    if (判) { 判.textContent = '网络诊断：读取中…'; 判.className = '网络判定'; }
    设网络态($('网络_服务器态'), '查询中…', '');
    var 起 = (global.performance && global.performance.now) ? global.performance.now() : Date.now();
    var 本 = null;
    try { 本 = (global.接口 && global.接口.连接状态) ? global.接口.连接状态() : null; } catch (eb) { }
    var 待 = null;
    try { 待 = (global.接口 && typeof global.接口.raw === 'function') ? global.接口.raw('状态', {}) : null; } catch (e) { 待 = null; }
    if (!待 || typeof 待.then !== 'function') 待 = Promise.reject(new Error('WS 通道不可用（未填口令 / 未连接）'));
    var 超 = new Promise(function (res) { setTimeout(function () { res(null); }, 4000); });
    Promise.race([待, 超]).then(function (r) {
      var 耗 = Math.round(((global.performance && global.performance.now) ? global.performance.now() : Date.now()) - 起);
      var 服 = (r && r.状态) ? r.状态 : null;
      var 详 = $('网络_服务器详情');
      if (!服) {
        设网络态($('网络_服务器态'), '不可达', '红');
        if (详) 详.textContent = '经 WS 通道　·　4 秒内无应答（服务器未上线 / 通道未连）';
        画网络WS(本 || {});
        画网络判定({ 可用: false, 原因: 'WS 4 秒内无应答' }, 本 || {});
        _网络上次 = { HTTP: { 可用: false, 原因: 'WS 无应答', 经WS: true }, WS: 本 || {} };
        return;
      }
      var WS = 合并网络WS(服.WS || {}, 本 || {});
      设网络态($('网络_服务器态'), '已连', '绿');
      if (详) {
        详.textContent = '经 WS 通道　·　往返 ' + 耗 + 'ms　·　服务版本 v' + (服.版本 || '–')
          + '　·　频道 ' + (WS.频道 || 服.频道 || '–');
      }
      画网络WS(WS);
      画网络判定({ 可用: true, 耗时: 耗, 版本: 服.版本 || '' }, WS);
      _网络上次 = { HTTP: { 可用: true, 耗时: 耗, 经WS: true }, WS: WS };
    })['catch'](function (e) {
      var 因 = String((e && e.message) || e || '未知原因');
      var 本2 = null;
      try { 本2 = (global.接口 && global.接口.连接状态) ? global.接口.连接状态() : null; } catch (e2) { }
      var 详 = $('网络_服务器详情');
      设网络态($('网络_服务器态'), '不可达', '红');
      if (详) 详.textContent = '经 WS 通道　·　原因：' + 因;
      画网络WS(本2 || {});
      画网络判定({ 可用: false, 原因: 因 }, 本2 || {});
      _网络上次 = { HTTP: { 可用: false, 原因: 因, 经WS: true }, WS: 本2 || {} };
    }).then(function () { _网络测中 = false; });
  }
  function 装网络诊断() {
    var 钮 = $('按钮_网络重测');
    if (钮 && !钮.getAttribute('data-网络绑')) {
      钮.setAttribute('data-网络绑', '1');
      钮.addEventListener('click', function (e) { if (e) e.stopPropagation(); 测网络(); });
    }
    var 设钮 = $('按钮_设置');
    if (设钮) 设钮.addEventListener('click', function () {
      setTimeout(function () {
        var 面 = $('设置面板');
        if (面 && !面.classList.contains('隐藏')) 测网络();
      }, 60);
    });
    // 首测延后一点，等页面自己的 WS 先连上；之后靠【重测】/打开设置刷新
    setTimeout(测网络, 4000);
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
    var 体 = { 口令: 口, 服务器: 服 };
    // 0.21：联动命令同存 网页设置（只填不空的输入就别写，免得把已配的命令清空）
    var t = $('设置_联动TRAE'), w = $('设置_联动WB');
    if (_联动已载 || (t && String(t.value || '').trim()) || (w && String(w.value || '').trim())) {
      if (t) 体.联动TRAE命令 = String(t.value || '').trim();
      if (w) 体.联动WB命令 = String(w.value || '').trim();
    }
    global.接口.设置保存(体)['catch'](function () { });
  }
  function 应用设置(设) {
    设 = 设 || {};
    // 0.21：回填两条联动命令（服务端存 网页设置；有键才回填）
    var t = $('设置_联动TRAE'), w = $('设置_联动WB');
    if (t && 设.联动TRAE命令 !== undefined) { t.value = String(设.联动TRAE命令 || ''); _联动已载 = true; }
    if (w && 设.联动WB命令 !== undefined) { w.value = String(设.联动WB命令 || ''); _联动已载 = true; }
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
    _联动已载 = true;      // 服务端设置已拉到（哪怕两条命令为空），后续保存可照实写回
    画服务器();
  }
  function 拉落地设置() {
    // 0.28：GitHub 部署版＝纯 WS——设置一律经 WS 路由 settings_get 读取，不再碰本机 HTTP
    if (!global.接口 || typeof global.接口.设置读取 !== 'function') return Promise.resolve();
    return global.接口.设置读取().then(function (r) {
      应用设置((r && r.设置) || {});
    })['catch'](function () { });
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

  // ---------------- 身份：邮箱号登录（0.23：下拉框 + 输入新邮箱） ----------------
  // 每个 AI 用自己的邮箱号进入自己的清单空间；身份读写/规范化在 接口.js。
  // 账号列表＝可配置列表（localStorage `任务面板_账号列表`，JSON 字符串数组；数据由后续 A3 账号接口补）。
  // 人类管理员固定第一（`任务面板_管理员` 可配置；为空＝公共视角，看全部）。
  // 前端只负责把当前账号交给 接口.js（请求自动带 `邮箱`），**不做任何权限判定/过滤**。
  var 账号存储键 = '任务面板_账号列表';
  var 管理员存储键 = '任务面板_管理员';
  var 新邮箱选项值 = '__新邮箱__';

  function 规范化邮箱(v) {
    try { return (global.接口 && global.接口.规范化邮箱) ? (global.接口.规范化邮箱(v) || '') : String(v || '').trim(); }
    catch (e) { return String(v || '').trim(); }
  }
  function 读取账号列表() {
    var 表 = [];
    try { 表 = JSON.parse(global.localStorage.getItem(账号存储键) || '[]') || []; } catch (e) { 表 = []; }
    if (!(表 instanceof Array)) 表 = [];
    var 出 = [];
    表.forEach(function (x) {
      var 号 = 规范化邮箱(x && x.邮箱 !== undefined ? x.邮箱 : x);
      if (号 && 出.indexOf(号) < 0) 出.push(号);
    });
    return 出;
  }
  function 存账号列表(表) {
    try { global.localStorage.setItem(账号存储键, JSON.stringify(表 || [])); } catch (e) { }
  }
  // A7（0.24）：从服务端账号库（/api/accounts）拉真实账号并缓存；失败/空表保留本地缓存，不阻断登录
  var _账号拉取中 = false;
  function 刷新账号列表(重试) {
    重试 = 重试 || 0;
    if (_账号拉取中) return;
    if (!(global.接口 && typeof global.接口.账号列表 === 'function')) return;
    var 请求;
    try { 请求 = global.接口.账号列表(); } catch (e) { return; }
    if (!请求 || typeof 请求.then !== 'function') return;
    _账号拉取中 = true;
    请求.then(function (r) {
      _账号拉取中 = false;
      if (!r || r.ok === false) { 再试(); return; }
      var 表 = (r.账号 instanceof Array) ? r.账号 : [];
      var 号们 = [];
      表.forEach(function (x) {
        var 号 = 规范化邮箱(x && x.标识 !== undefined ? x.标识 : x);
        if (!号) return;
        if (号们.indexOf(号) < 0) 号们.push(号);
      });
      if (号们.length) { 存账号列表(号们); 画邮箱选项(); }
      else 再试();          // 空表：保留本地缓存，不弹错
    })['catch'](function () { _账号拉取中 = false; 再试(); });

    function 再试() {
      if (_账号拉取中 || 重试 >= 2) return;
      var 弹 = $('邮箱弹窗');
      if (!弹 || 弹.classList.contains('隐藏')) return;   // 登录窗已关就不再打扰
      setTimeout(function () { 刷新账号列表(重试 + 1); }, 2000);
    }
  }
  function 管理员邮箱() {
    try { return 规范化邮箱(global.localStorage.getItem(管理员存储键) || ''); } catch (e) { return ''; }
  }
  function 我的邮箱() {
    try { return (global.接口 && global.接口.读取邮箱) ? (global.接口.读取邮箱() || '') : ''; } catch (e) { return ''; }
  }
  function 画身份() {
    var 我 = 我的邮箱();
    var 显 = $('身份');
    if (显) 显.textContent = 我 || '未登录';
    var 换 = $('按钮_换身份');
    if (换) 换.style.display = _已启动 ? '' : 'none';
  }
  function 选项(值, 文本) {
    var o = document.createElement('option');
    o.value = 值; o.textContent = 文本;
    return o;
  }
  // 下拉框：账号列表顺序（人类管理员也是普通账号，不再固定第一）→ 末尾「输入新邮箱…」
  // 0.24：重画时保留用户当前选中项，避免服务端账号回来重画把正在选的人打断
  function 画邮箱选项() {
    var 框 = $('邮箱_选择');
    if (!框) return;
    var 管 = 管理员邮箱();
    var 我 = 我的邮箱();
    var 原选 = '';
    try { 原选 = String(框.value || ''); } catch (e) { }
    框.innerHTML = '';
    var 表 = 读取账号列表();
    表.forEach(function (号) { 框.appendChild(选项(号, 号)); });
    if (我 && 表.indexOf(我) < 0) 框.appendChild(选项(我, 我));
    if (表.indexOf('人类管理员') < 0 && 我 !== '人类管理员') 框.appendChild(选项('人类管理员', '人类管理员'));
    框.appendChild(选项(新邮箱选项值, '＋ 输入新邮箱…'));
    var 还在 = false;
    for (var i = 0; i < 框.options.length; i++) {
      if (框.options[i].value === 原选) { 还在 = true; break; }
    }
    框.value = 还在 ? 原选 : (我 || 新邮箱选项值);
  }
  function 开邮箱(首登) {
    var 弹 = $('邮箱弹窗');
    if (!弹) return;
    var 输 = $('邮箱_输入');
    if (输) 输.value = 首登 ? '' : 我的邮箱();
    画邮箱选项();            // 先用本地缓存画，登录窗不空等
    弹.classList.remove('隐藏');
    if (输) { try { 输.focus(); } catch (e) { } }
    刷新账号列表();          // 再从服务端账号库拉，成功即重画（无痕窗口也有真实账号）
  }
  function 关邮箱() { var 弹 = $('邮箱弹窗'); if (弹) 弹.classList.add('隐藏'); }
  // 邮箱就绪后继续原有启动流程：先拉服务端设置（可能带回口令），再按「有没有口令」分流
  function 继续启动() {
    if (_已启动) return;
    _已启动 = true;
    画身份();
    拉落地设置().then(function () {
      var 还缺 = true;
      try { 还缺 = !!(global.接口.需要口令 && global.接口.需要口令()); } catch (e) { 还缺 = true; }
      if (还缺) {
        if ($('角色')) $('角色').textContent = '未连接';
        开口令(true);
      } else {
        首载();
      }
    });
  }
  // 确认身份：`指定` 有值＝下拉框直接选的账号；不传＝读「输入框优先、其次下拉框」。
  // 管理员可以没有邮箱（空串＝公共视角），不写死任何账号、不判权限。
  function 确认邮箱(指定) {
    var 输 = $('邮箱_输入');
    var 框 = $('邮箱_选择');
    var 新 = '';
    var 源;
    if (指定 !== undefined) {
      源 = String(指定);
    } else {
      新 = 输 ? String(输.value || '').trim() : '';
      var 选 = 框 ? String(框.value || '') : '';
      if (!新 && 选 === 新邮箱选项值) { 提示('请输入新邮箱号'); return; }
      源 = 新 || 选;
    }
    var 规范 = 规范化邮箱(源);
    if (!规范) { 提示('请先选择账号或输入邮箱号（AI 同样必须带账号）'); return; }
    if (新) {
      if (!规范) { 提示('请输入新邮箱号'); return; }
      var 表 = 读取账号列表();
      if (表.indexOf(规范) < 0) { 表.push(规范); 存账号列表(表); }
    }
    关邮箱();
    try { if (global.接口.设置邮箱) global.接口.设置邮箱(规范); } catch (e) { }
    if (输) 输.value = '';
    画身份();
    画邮箱选项();
    if (_已启动) {
      // 换身份：不重走口令，只按新身份重载清单（服务端默认只回「公共 + 我的」）
      提示('已切换身份：' + (规范 || '未登录'));
      try { if (global.清单页 && global.清单页.重载) global.清单页.重载(); } catch (e) { }
      return;
    }
    继续启动();
  }

  // ---------------- 凭号直达（A5）：地址栏 `?卡号=%23n / L200…` → 直接打开该卡 ----------------
  function 地址卡号() {
    var 串 = '';
    try { 串 = (global.location && global.location.search) || ''; } catch (e) { 串 = ''; }
    var m = /[?&]卡号=([^&]*)/.exec(串);
    if (!m) return '';
    var 值 = m[1];
    try { 值 = global.decodeURIComponent ? global.decodeURIComponent(值.replace(/\+/g, ' ')) : 值; }
    catch (e) { /* 编码异常就按原样用 */ }
    return String(值 || '').trim();
  }
  function 打开直达卡(号) {
    try {
      if (global.清单页 && global.清单页.打开卡) { global.清单页.打开卡(号); return; }
      if (global.清单页 && global.清单页.载入主页) global.清单页.载入主页(true);
    } catch (e) {
      提示('打开卡片失败：' + ((e && e.message) || e));
    }
  }

  // ---------------- 首载（口令就绪后载入主页 / 或直接打开直达卡） ----------------
  function 首载() {
    载角色();
    var 号 = 地址卡号();
    if (号) {
      // A5：凭号直达——不弹登录、不弹无权限，直接整页打开该卡
      setTimeout(function () { 打开直达卡(号); }, 0);
    } else {
      try { if (global.清单页 && global.清单页.载入主页) global.清单页.载入主页(true); } catch (e) { }
    }
    补设置(0);      // 0.20：连接建立后再补一次落盘设置（GitHub Pages 上只能走 WS）
  }
  function 补设置(次) {
    var 选 = { 实例号: '' };
    try { 选 = global.接口.选中服务器() || 选; } catch (e) { }
    if (选.实例号 || 次 >= 3) return;
    setTimeout(function () {
      拉落地设置().then(function () {
        var 新 = { 实例号: '' };
        try { 新 = global.接口.选中服务器() || 新; } catch (e) { }
        if (新.实例号) 重载数据();
        else 补设置(次 + 1);
      });
    }, 3000);
  }

  // ---------------- 启动装配 ----------------
  function 装配() {
    装设置();
    装通道();      // P51：设置里的账号通道（A/B 双线路切换 + 被拒红字/一键切B）
    装网络诊断();  // 0.27：设置里的网络诊断（服务器 HTTP / WS 各自独立成行 + 一句话判定 + 重测）
    装服务器();
    装R2拉取();    // 0.25：系统清单 R2 手动拉取按钮 + 结果帧回音
    try { if (global.清单页 && global.清单页.装配) global.清单页.装配(); } catch (e) { }
    if ($('按钮_口令')) $('按钮_口令').addEventListener('click', function () { 开设置(false); 开口令(false); });
    if ($('口令_取消')) $('口令_取消').addEventListener('click', 关口令);
    if ($('口令_确定')) $('口令_确定').addEventListener('click', 确认口令);
    var 输 = $('口令_输入');
    if (输) {
      输.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); 确认口令(); } });
    }
    // 0.23：邮箱号登录——下拉框选账号（人类管理员固定第一）或输入新邮箱
    if ($('邮箱_确定')) $('邮箱_确定').addEventListener('click', function () { 确认邮箱(); });
    if ($('邮箱_选择')) {
      $('邮箱_选择').addEventListener('change', function () {
        var v = String(this.value || '');
        if (v === 新邮箱选项值) {        // 选「输入新邮箱…」→ 只聚焦输入框，不立即进入
          var 输 = $('邮箱_输入');
          if (输) { 输.value = ''; try { 输.focus(); } catch (e) { } }
          return;
        }
        确认邮箱(v);                     // 管理员空串＝公共视角；其余账号直接进入
      });
    }
    if ($('邮箱_输入')) {
      $('邮箱_输入').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); 确认邮箱(); }
      });
    }
    if ($('按钮_换身份')) $('按钮_换身份').addEventListener('click', function () { 开邮箱(false); });
    画身份();
    画邮箱选项();
    // A5 凭号直达：地址栏带 `?卡号=` → 不弹邮箱登录，直接进（打开该卡由首载负责）
    if (地址卡号()) {
      继续启动();
      return;
    }
    if (!我的邮箱()) {
      if ($('角色')) $('角色').textContent = '未登录';
      开邮箱(true);
      return;
    }
    继续启动();
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
