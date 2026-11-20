'use strict';
function renderVer(box){
  try{
    const tag = box ? ' [' + box + ']' : '';
    const vm = APP_NAME + ' v' + VER;
    const vd = 'v' + VER;
    document.title = APP_NAME + ' v' + VER + tag;   /* 地址栏/标签标题带版本号 */
    if (el.lbl_title) el.lbl_title.textContent = vm;
    if (el.lbl_ver) el.lbl_ver.textContent = vd;
  }catch(e){ /* 版本渲染绝不影响连接 */ }
}

/* 1.60：统一「拆旧连接」。
   原来只摘了 onclose，留下三个后患（用户「频繁掉线」观感的主因之一）：
     ① 旧连接的 hbTimer 停不掉 → 定时器泄漏，越重连越多个心跳在跑；
     ② 旧连接的 onerror 还活着 → 关它时把「WS 错误」计数刷高（数字虚高，
        会误判成中继不稳）；关闭旧连接过程中也会触发 onerror。
     ③ 若保留旧 onclose，会再排一次重连定时器 → 叠加连接风暴。
   现在：四个回调全摘 + 定时器全停，再 close。 */
function teardownWs(){
  try {
    if (ws){
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
    }
  } catch(e){}
  clearInterval(hbTimer);  hbTimer = null;
  clearTimeout(helloTimer);
  clearTimeout(reconnectTimer);
  reconnectTimer = null;   /* 2.182 Y32a：清完置 null——残留旧 id 是真值，会卡死
                            srvWatch「!reconnectTimer」类救援判据（hung-0/已死
                            两档都靠它判定「无重连定时在跑」）。 */
  loggedIn = false;
  /* 2.184（老板 2026-11-19 令：一次只在一个频道在线）：拆旧就彻底断——
     S.ws 指针一并置空（配上面的四回调摘除），任何代码都不可能再往旧连接发帧；
     同时清掉与旧链路绑定的判活痕迹，新连接从零开始，杜绝「新旧两条同时在线」。
     注：waitT/waitN 不在此清（重连正是由它触发，清了会无限重试）。 */
  S.ws = null;
  S.lastSrv = 0;
  S.srvLost = false;
}

function connect(){
  /* 2.184（老板 2026-11-19 令：一次只在一个频道在线）：建新连接前必须先拆旧——
     teardownWs 会把旧 socket 的 open/message/close/error 四回调全置 null 再
     close()，并把 S.ws 置空 ⇒ 绝不会「新旧两条同时在线」，旧连接关闭时也不会
     再排一次重连。切频道（设置页切 main↔backup）、重连、换频道名都走这一条路。 */
  teardownWs();
  S._wsOpenAt = Date.now();   /* 2.182 Y32a：连接起点时刻——srvWatch 的 hung-0
                               救援（上线与界面.js）按「readyState===0 超 20s」
                               判假死，以本时刻起算，20s 守卫防风暴。 */
  setOnLine(false);
  /* 2.216：只有「断过/重试中/手动重连」才亮顶部重连条；首次正常连接不闪橙条 */
  if (S._rcOffline || S._manualRC || S.failStreak > 0 || DIAG.reconn > 0)
    try { reconnUi('↻ 正在重连…', 'var(--orange)'); } catch(e){}
  gotHello = false;
  helloTries = 0;    // 1.07：重连后重起握手重试（原不重置——10 次用尽
                     // 后，重连首条 hello 被中继丢弃就永远失联）
  S.lastSrv = 0;    // 旧连接的服务端活动不再作数
  // ?ws= 参数可临时覆盖服务地址（测试/多环境部署），不改 localStorage
  const qp = new URLSearchParams(location.search).get('ws');
  const cSel = curSel();                 // v1.50：按当前选中频道连接
  let ch = chanGet(cSel);
  if (!ch && !qp){
    channelPrompt();                    // v1.27：首次使用必须先输频道名
    return;
  }
  ws = new WebSocket(qp || wsUrlOf(ch, cSel));
  S.ws = ws;
  /* 1.61：本次连接是否真的打开过——没打开就断＝连不上中继（网络/服务商问题） */
  let _openOk = false;
  ws.onopen = () => {
    _openOk = true;
    /* 2.216：本次连上之前是否处于「断过/重试」——是才提示「已恢复」 */
    const _rcWas = !!(S._rcOffline || S._manualRC || S.failStreak > 0 || DIAG.reconn > 0);
    S.failStreak = 0;                 // 1.61：连上了就清零
    DIAG.reconn = 0; DIAG.reconnActive = false;   // 1.66：成功连上=一轮结束，重试计数归零
    diagLog('已连上中转服务器', 'ok');
    /* 2.180 Y32：重连成功即解除失联态——S.srvLost 残留 true 虽因 onLine 优先
       顶栏回绿，但失联标志挂着语义错（诊断页/后续判定都看它）。connect() 已把
       lastSrv 清零，srvWatch 不会见陈旧 lastSrv 立刻误置。 */
    if (S.srvLost){ S.srvLost = false; diagLog('重连成功，解除失联', 'ok'); }
    setOnLine(true);
    /* 2.216：手动重连成功 → 撤掉兜底定时器；仅「断过/重试」才提示「已恢复」（2.5 秒后自动收起） */
    if (S._manualRC){ clearTimeout(S._manualRcT); S._manualRC = 0; }
    S._rcLastDelay = 0;
    S._rcOffline = 0;
    if (_rcWas) { try { reconnUi('✓ 已恢复', 'var(--green)', 2500); } catch(e){} }
    /* 2.42：删除链路保活 PING（本软件免 PING，由中继自动保持在线） */
    /* v1.32：登录 → 服务端开始广播；loginWatch 兜底握手首条被中继丢弃 */
    cliRebind();
    cliLogin('上线');
    loginWatch();
  };
  ws.onmessage = ev => onMsg(ev.data);
  ws.onclose = () => {
    /* 1.66：重试计数只在「重试这条连接再次失败」时递增；本轮首断不
       立即编号（顶栏先显示"重试中…"，让这一轮的重试计数从0起算） */
    if (DIAG.reconnActive) DIAG.reconn++;
    DIAG.reconnActive = true;
    /* 1.57：记下是否「切后台期间被系统掐断」，顶栏文案据此区分 */
    S.dropByHide = !!document.hidden;
    /* 1.61：压根没连上就断了 → 累加失败次数（连上过则不计） */
    if (!_openOk){
      S.failStreak++;
      if (S.failStreak === FAIL_ALERT){
        diagLog('已连续 ' + S.failStreak + ' 次连不上中继服务器——'
                + '请检查手机网络，或换主/备中继试试', 'bad');
      }
    }
    /* 2.216：断线日志 10 秒节流（手动重连 12 秒兜底也走这里）——不刷屏 */
    if (!S._rcLastLogAt || Date.now() - S._rcLastLogAt > 10000){
      S._rcLastLogAt = Date.now();
      diagLog((S.dropByHide ? '后台断线（回来自动补）'
                            : '断线（第 ' + DIAG.reconn + ' 次）'),
              'bad');
    }
    if (S._manualRC){
      clearTimeout(S._manualRcT); S._manualRC = 0;
      if (el && el.reconn) el.reconn.disabled = false;
    }
    setOnLine(false);
    clearTimeout(helloTimer);
    loggedIn = false; clearInterval(hbTimer);   // 断线＝退出登录
    lastBeatOk = 0;                             // 1.57：心跳计时重置
    scheduleReconnect();
  };
  ws.onerror = () => {
    DIAG.err++;
    diagLog('连接出错 #' + DIAG.err + '（网络或中转问题）', 'bad');
  };
  /* 2.68：主频道每次（重）连接时同步（重）连 TTS 直连频道（密钥随主频道走） */
  ttsConnect();
}

/* 2.216（0047 游客体验·第3件）：连接失败可自救——顶栏「↻ 重连」按钮三态
   （正在重连…／已恢复／仍失败，N 秒后自动重试）；自动重试退避 10s→20s→30s 封顶。
   日志只在退避档位变化/首断时写一条，绝不每拍刷屏。 */
let _rcHold = 0, _rcHideT = 0;
function reconnUi(label, color, holdMs){
  const b = el && el.reconn; if (!b) return;
  if (label != null) b.textContent = label;
  b.style.color = color || '';
  b.style.display = '';
  if (holdMs){
    _rcHold = 1; clearTimeout(_rcHideT);
    _rcHideT = setTimeout(() => { _rcHold = 0; try { reconnSync(); } catch(e){} }, holdMs);
  }
}
function reconnSync(){
  const b = el && el.reconn; if (!b || _rcHold) return;
  const _show = !S.onLine && (S._rcOffline || S._manualRC
    || S.failStreak > 0 || DIAG.reconn > 0);
  if (_show){
    b.style.display = '';
    b.disabled = false;
  } else {
    b.style.display = 'none';
    if (S.onLine){ b.disabled = false; b.textContent = '↻ 重连'; b.style.color = ''; }
  }
}
function manualReconnect(){
  S.failStreak = 0;
  S._rcLastDelay = 0;
  S._rcOffline = 1;
  clearTimeout(reconnectTimer); reconnectTimer = null;
  clearTimeout(S._manualRcT);
  S._manualRC = 1;
  diagLog('手动重连', 'warn');
  if (el && el.reconn) el.reconn.disabled = true;
  reconnUi('↻ 正在重连…', 'var(--orange)');
  connect();
  /* 假死/握手无回应兜底：12 秒仍未连上就拆旧转自动重试，绝不让按钮一直转圈 */
  S._manualRcT = setTimeout(() => {
    if (!S._manualRC) return;
    S._manualRC = 0;
    if (el && el.reconn) el.reconn.disabled = false;
    diagLog('手动重连无回应，已转为自动重试', 'bad');
    try { teardownWs(); } catch(e){}
    try { scheduleReconnect(); } catch(e){}
  }, 12000);
}
if (el && el.reconn) el.reconn.onclick = manualReconnect;

function scheduleReconnect(){
  /* 2.216：退避 10s→20s→30s 封顶（不再到上限就停摆）；只在档位变化时记一条日志。 */
  S._rcOffline = 1;
  const n = Math.min(Math.max(S.failStreak, 1) - 1, 2);
  const delay = Math.min(10 * Math.pow(2, n), 30);
  if (S._rcLastDelay !== delay){
    S._rcLastDelay = delay;
    diagLog(delay + 's 后重连（第 ' + ((S.failStreak || 0) + 1) + ' 次尝试）', 'dim');
  }
  reconnectTimer = setTimeout(connect, delay * 1000);
  reconnUi('↻ 仍失败，' + delay + ' 秒后自动重试', 'var(--red)');
}
function ensureConnect(){
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  clearTimeout(reconnectTimer);
  connect();
}
/* 2.181 Y32a：系统网络恢复事件 → 立即重连。Y25 时代把它当「在线判据」不可靠，
   但当【恢复触发】低风险高收益：真恢复立连；假信号最多白连一次，败绩照旧退避重建。
   顺序讲究：先清 failStreak 再 ensureConnect——否则连败停摆态（streak>=MAX）
   会被 ensureConnect 的上限卫兵早退，恢复信号白来。 */
addEventListener('online', function(){
  try { diagLog('系统网络恢复事件 → 立即尝试重连', 'dim'); } catch(e){}
  S.failStreak = 0;                      /* 连败停摆是断网期攒的，恢复信号到达即清；网络仍坏会重新攒 */
  clearTimeout(reconnectTimer); reconnectTimer = null;
  /* 2.182 Y32a（ST§9.7 复测复盘）：online 事件已触发却零动静——旧 socket 两类
     「假活」让 ensureConnect（:119）早退或救不活：
     ① 半开黑洞：readyState===1 但帧全被丢（CDP offline/真半开不拆已建 WS），
        探针帧发进黑洞永不回；② hung CONNECTING：readyState===0 被当「正在连」。
     恢复信号到达即拆旧重连：connect() 自带 teardownWs 全套收口。
     只有「hung-0」或「失联在挂」才动刀；readyState===1 且无失联＝真健康，
     绝不误拆（2.178「不主动断 WS」口径对健康连接仍然成立）。 */
  if (ws && (ws.readyState === 0 || S.srvLost)){
    try { teardownWs(); } catch(e){}
  }
  ensureConnect();
});

function sendHello(){
  /* 握手重试：浏览器 WS 握手完成瞬间立即发的第一条消息可能落在
     中继把连接加入频道之前而被丢弃——3 秒重发直到收到应答
     （最多 10 次；重连后从头再来）。 */
  sendJson({t: 'hello', v: 1});
  if (!gotHello && ++helloTries <= 10)
    helloTimer = setTimeout(() => {
      if (!gotHello && S.onLine) sendHello();
    }, 3000);
}

/* ============ v1.32：客户端登录态 + 心跳（WS 节流核心） ============
   服务端只在「有客户端登录在线」时才广播远程事件（尤其最耗流量的
   AI 聊天记录 msgs）。本端策略：
     · 上线 / 回到前台 → 发 login（服务端随即整包重放全量）；
     · 在线期间每 60s 发一次 hb 心跳（服务端 150s 无心跳判下线）；
     · 页面不在前台（切走/切标签）或超过 5 分钟无任何操作 →
       发 logout（之后不再心跳）＝自动退出登录，服务端随之停播；
     · 重新回到前台或再次操作 → 自动重新 login。
   效果：手机没在看的时候，服务端一条消息都不发。 */
let loggedIn = false, hbTimer = null, lastAct = Date.now(),
    actBound = false, _lg_tm = 0,
    lastBeatOk = 0;            /* 1.57：最后一次成功发出登录心跳的时刻 */

/* ==== 1.57 下线语义（用户明确要求，v1.32 那套苛刻条件已全部移除）====
   下线条件**只剩一条**：页面在前台 且 超过 IDLE_MS(5 分钟) 没有任何操作。
   切后台 / 锁屏 / 切标签 / 关页面 **一律不再主动下线** —— 频繁在多个 App
   之间切换时，不再每次回来都重登 + 整包重放。
   页面被系统冻结期间心跳发不出去 → 服务端 150s 无心跳自会判下线（天然兜底）；
   回到前台时若发现「心跳已停太久」本端会主动重发 login 补登记 + 重放。 */
function cliLogin(reason){
  if (!ws || ws.readyState !== 1){ loggedIn = false; return; }
  lastAct = Date.now();
  loggedIn = true;
  /* 2.100（老板 2026-10-20 12:14/12:16）：登录/掉线重连后——
     ① 首份「完整版快照」到达即落盘一次（不受 10 秒节流；缓存.js snapIdbTick 认此旗标）；
     ② 若本地有持久化锚定，首拍补发一次 switch（继续锚定当前会话）。 */
  S.idbFirstFull = 1;
  S.anchor_reask = 1;
  sendJson({t: 'login', fg: !document.hidden, nick: nickGet()});
  /* 账本V1.0（I1/I2）：登录＝强核对场景之一，与 switch/svr/timer 共用
     ledgerVcheckSend 同一构造函数（账本核对.js）。 */
  try { if (window.ledgerVcheckSend) ledgerVcheckSend('login'); } catch(e){}
  lastBeatOk = Date.now();
  clearInterval(hbTimer);
  hbTimer = setInterval(cliBeat, HB_SEC * 1000);
}
function cliBeat(){
  if (!loggedIn){ clearInterval(hbTimer); return; }
  if (!ws || ws.readyState !== 1){
    loggedIn = false; clearInterval(hbTimer); return;
  }
  /* 唯一的自检：仅「前台且闲置超时」才退出登录；后台不算下线 */
  if (!document.hidden && Date.now() - lastAct > IDLE_MS){
    cliLogout('闲置5分钟'); return;
  }
  sendJson({t: 'hb', fg: !document.hidden, nick: nickGet()});
  lastBeatOk = Date.now();
}
function cliLogout(reason){
  const was = loggedIn;
  loggedIn = false;
  clearInterval(hbTimer); hbTimer = null;
  clearTimeout(helloTimer);          /* 2.184：退出后不得再有定时外发（握手重发也停） */
  if (was){ try { sendJson({t: 'logout', r: reason || ''}); } catch(e){} }
  /* 2.184（老板 2026-11-19 令：退出后频道零消耗）：把「等回应 / 失联 / 判活」
     痕迹全部归零。此后除用户主动操作（cliRebind → cliLogin）外，本端不再定时
     发送任何帧：hb 心跳已停；ctl_hb（电脑名册.js:191）与账本 vcheck
     （账本核对.js:678）都以 loggedIn 为闸，自然停发；srvWatch 已无任何探针帧。 */
  S.lastSrv = 0;
  S.srvLost = false;
  S.waitT = 0; S.waitN = 0; S.waitLast = 0;
  try { renderLink(); } catch(e){}
}
/* 1.57：回前台统一入口——秒续优先，其次重登，最后立即重连
     · 链路活着且心跳没断太久 → 只补一个 hb（秒续，不重放、省流量）
     · 心跳已停 >120s（服务端 150s 就会踢掉）或本端已离线 → 重发 login 重放
     · 链路已断 → 立刻重连（不等 3s 定时器），onopen 里自会 login   */
function cliResume(reason){
  if (ws && ws.readyState === 1){
    const stale = !lastBeatOk || (Date.now() - lastBeatOk > 120000);
    if (!loggedIn || stale) cliLogin(reason || '回前台');
    else { sendJson({t: 'hb', fg: true, nick: nickGet()}); lastBeatOk = Date.now(); }
  } else {
    ensureConnect();
  }
}
function cliRebind(){
  if (actBound) return;
  actBound = true;
  /* 任何真实操作都算「活跃」；闲置退出后一操作即自动重新登录 */
  ['touchstart', 'mousedown', 'keydown', 'scroll', 'click', 'pointerdown']
    .forEach(ev => document.addEventListener(ev, () => {
      lastAct = Date.now();
      if (!loggedIn && ws && ws.readyState === 1) cliLogin('活跃');
    }, {passive: true, capture: true}));
  /* 1.57：切走什么都不做（不再主动下线）；回来时秒续 / 立即重连。
     pagehide 的「离开页面即下线」也已移除——关掉网页后由服务端
     150s 无心跳超时兜底。 */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      /* 2.163：切后台时定时器被冻，这段时间「没收到回应」不能算服务器没回
         ——撤销本次等回应，避免回前台瞬间误报「服务器无响应」。 */
      S.waitT = 0; S.waitN = 0; S.waitLast = 0;
      return;                          // 切后台：不再下线
    }
    cliResume('回前台');              // 回前台：秒续或立即重连
  });
  window.addEventListener('pageshow', () => cliResume('回到页面'));
}
/* ========= 1.33：AI 文本刷新间隔（服务端 poll_sec）=========
   只控制「AI 文本快照」的刷新节奏（＝流量开关，0.5~30s）。点击/
   操作信号在服务端由独立的 0.05s 步长巡检即时执行，与本值完全无关，
   所以调到 30s 也不会让按钮变迟钝。 */
/* 1.35：POLL_FMT 随档位 UI 移除 */
/* 1.35：抽屉刷新率档位整体移除（renderPoll/setPoll/onPollSet/
   bindPollBtns 一并删除）——poll_sec 只在服务端 GUI 调整（用户：
   网页端不浪费空间）。服务端 poll_set 回执/ hello poll 字段客户端
   忽略即可，无需处理。 */

/* 登录后 4 秒仍无快照 → 重发 login（+hello，兼容未支持 login 的旧
   服务端）。握手首条常被中继丢弃，重发保证服务端确实知道「有人登录」
   ——否则服务端会一直以为无人在线而停播。 */
function loginWatch(){
  clearTimeout(_lg_tm);
  let n = 0;
  const tick = () => {
    if (!S.onLine) return;
    if (S.snap && Object.keys(S.snap).length) return;
    if (++n > 4) return;
    sendJson({t: 'login', fg: !document.hidden, nick: nickGet()});
    sendJson({t: 'hello'});
    _lg_tm = setTimeout(tick, 3000);
  };
  _lg_tm = setTimeout(tick, 4000);
}

/* ============ v1.27：频道名（密码）输入弹窗 ============
   频道名只有服务端知道，本端绝不硬编码。首次使用（本地无记录）
   弹全屏输入层；输对才能连上服务端。网络页可随时修改。 */
function channelPrompt(){
  let ov = $('chanmask');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'chanmask';
  ov.innerHTML =
    '<div id="chanbox">'
    + '<div class="ctitle">🔑 输入频道名</div>'
    + '<div class="chint">频道名相当于连接密码，由服务端提供'
    + '（服务端「设置→远程服务」处可见）。首次输入后将保存在'
    + '本机，下次自动连接。</div>'
    + '<input id="chanin" autocomplete="off" autocapitalize="off" '
    + 'placeholder="输入频道名…">'
    + '<div class="cerr" id="chanerr"></div>'
    + '<button id="chanok">保存并连接</button>'
    + '</div>';
  document.body.appendChild(ov);
  const inp = $('chanin');
  const err = $('chanerr');
  setTimeout(() => { try { inp.focus(); } catch(e){} }, 80);
  const go = () => {
    const v = (inp.value || '').trim();
    if (!v){ err.textContent = '频道名不能为空'; return; }
    chanSet(v);
    ov.remove();
    chanRender();                       // 刷新双通道地址
    flash('频道名已保存，正在连接…', 'var(--blue)');
    connect();
  };
  $('chanok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); };
}

function onMsg(msg){
  statsAdd(msg.length, 0, 1, 0);
  /* FOX v2.1：控制帧（ACK/QRY/RSN/FAIL）先分流，绝不进正文流 */
  if (msg.startsWith('【FOXACK:') || msg.startsWith('【FOXQRY:')
      || msg.startsWith('【FOXRSN:') || msg.startsWith('【FOXFAIL:')){
    deliverFox(FoxIn.feedCtrl(msg));  /* 2.50：补发片补齐也可能即刻交付正文 */
    return;
  }
  const r = FoxIn.feed(msg);
  if (r === null){
    /* 无 FOX 头：本端只发 FOX 帧，不可能撞自己回声——兜底收对端
       （服务端 fox_on 关闭时）整条直发的裸 JSON。 */
    if (msg[0] === '{'){
      try { JSON.parse(msg); srvSeen(); handleBody(msg); } catch(e){}
    }
    return;                                   // 其余=心跳/中继系统消息
  }
  deliverFox(r);
}

/* 2.50：FOX 正文交付统一出口（数据帧直收 / RSN 补发片补齐，两条路都经此，
   避免补发补齐的那份正文被 feedCtrl 的布尔返回值吃掉）。 */
function deliverFox(r){
  if (!r) return;
  const sender = r[0], body = r[1];
  if (!sender || sender[0] !== '1') return;   // 1.12：只认服务端（'1'
                                              // 开头），拒客户端回声
  srvSeen();                                  // 1.07：服务端判活
  handleBody(body, sender);                   // 2.184：带上 FOX 头发送者 id 供隔离过滤
}

/* 2.184 追加（服务器隔离过滤·老板令）：帧必须来自本服。身份取帧内 srv_sid
   优先、无则 FOX 头发送者 id；本服号来源＝hello 自报（onHello 落 S.curSid），
   否则首个带身份的帧记为本服。不符 → 整帧丢弃并记「跨服帧 弃收」。
   无身份帧（t:'srv' 名册心跳等）无法判源，不判=放行，不误杀。 */
function srvIsoPass(d, fromId){
  const tag = String((d && (d.srv_sid || fromId)) || '').trim();
  if (!tag) return true;                      // 无身份：不判
  if (!S.curSid){                             // 首个自报身份记为本服
    S.curSid = tag;
    try { diagLog('本服 FOX 号=' + tag + '（首个身份自报）', 'ok'); } catch(e){}
    return true;
  }
  if (tag !== S.curSid){
    try { diagLog('跨服帧 弃收 srv=' + tag + ' t=' + String((d && d.t) || ''), 'bad'); } catch(e){}
    return false;
  }
  return true;
}

function handleBody(body, fromId){
  let d;
  try { d = JSON.parse(body); } catch(e){ return; }
  if (!d || typeof d !== 'object') return;
  /* 1.12 多服务端：报文按 'srv' 源头名归册；只渲染当前操控服务端
     的内容（hello/srv 心跳同时维护名册）。
     2.48：无 'srv' 字段一律丢弃——不再兜底成「默认服务端」假条目
     （服务端 2.83 起在 send_json 唯一咽喉盖章，凡发出的报文都带源头名）。 */
  const nm = d.srv || '';
  if (!nm) return;
  regSrv(nm, d);
  if (d.t === 'srv'){
    if (nm === S.cur && d.alive){ S.alive = new Set(d.alive); }
    renderSrvList();
    return;
  }
  if (nm !== S.cur) return;                   // 非当前操控对象：忽略
  if (!srvIsoPass(d, fromId)) return;         // 2.184：非本服 FOX 号，整帧丢弃
  /* 2.203（老板 2026-11-19 22:02 令）：服务端每帧盖 host＝当前操控持有者（1 号网页
     用户）；此处只落状态，判定统一走 hostIsFirst()。空串＝当前无持有者。 */
  if (d.host !== undefined){
    S.hostId = String(d.host || '');
    S.hostKnown = true;
  }
  /* 1.13：操控互斥——目标拒绝（正被其他客户端占用） */
  if (d.t === 'deny'){
    if (d.target === MY_ID)
      flash('🔒 [' + (d.srv || '远方') + '] 正被 '
            + (d.holder || '其他客户端') + ' 占用，稍后再试',
            'var(--red)');
    return;
  }
  if (d.t === 'ev') { onEv(d.k, d.v); return; }
  /* 2.90：「四步提醒」服务端回执（t:'rcpt'，单通道 + stage）——按 stage 补
     ③（accepted/running）与 ④（done/fail），配对见 事件总线.js onRcpt。 */
  if (d.t === 'rcpt') { onRcpt(d); return; }
  /* 2.20 新架构：请求-响应配对（req_id → res） */
  if (d.t === 'res') { onRes(d.id, d.k, d.v); return; }
  /* 2.69：服务端备用通道回执（TTS 直连走不通时回落本机中转）——复用直连那套
     交付/回执处理：任一通道先到先交付，后到因 _tts_pend[id] 已清被忽略（天然去重）。 */
  if (d.t === 'tts_ack') { onTtsAck(d); return; }
  if (d.t === 'tts_resp') {
    if (d.err) onTtsErr(d.id, d.err);
    else if (d.b64) ttsDeliver(d.id, atob(d.b64));
    return;
  }
  if (d.t === 'hello') onHello(d);
  /* 账本系统 V1.0（账本核对.js）：vack 两阶段核对回执 / mod 单模块实体帧。
     旧服务端不下发这两类帧 ⇒ 以下分支永不触发，旧协议通路零影响。 */
  if (d.t === 'vack'){ if (window.ledgerVack) ledgerVack(d); return; }
  if (d.t === 'mod'){ if (window.ledgerMod) ledgerMod(d); return; }
  if (d.t === 'think_int_ack'){ if (window.lbThinkIntAck) lbThinkIntAck(d); return; }   /* 账本V1.0：set_think_int 回执（账本核对.js） */
  if (d.t === 'poll_set') return;                     // 1.35：档位已移除，忽略回执
}

/* ============ 1.12 多服务端名册（v1.84：落盘 + 只认名称） ============ */

/* v1.84：名册落盘——网页端只认「电脑名称」（随机 ID/sid 只在后台识别用，
   界面一律不显示）。名称＋最后出现时间存 LS_SRVS，刷新/重开页面立即恢复
   清单（离线的也留一行 ○）；超 SRV_TTL(7 天) 未再出现的名称自动清理。 */
