'use strict';
 /* 连接.js（网页端）  版本 2.315  日期 2026-11-25 */
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
  reconnectTimer = null;   /* Y32a：清完置 null——残留旧 id 是真值，会卡死
                            srvWatch「!reconnectTimer」类救援判据（hung-0/已死
                            两档都靠它判定「无重连定时在跑」）。 */
  loggedIn = false;
  S.ws = null;
  S.lastSrv = 0;
  S.srvLost = false;
  S.curSid = '';
}

function connect(){
  teardownWs();
  S._wsOpenAt = Date.now();   /* Y32a：连接起点时刻——srvWatch 的 hung-0
                               救援（上线与界面.js）按「readyState===0 超 20s」
                               判假死，以本时刻起算，20s 守卫防风暴。 */
  setOnLine(false);
  if (S._rcOffline || S._manualRC || S.failStreak > 0 || DIAG.reconn > 0)
    try { reconnUi('↻ 正在重连…', 'var(--orange)'); } catch(e){}
  gotHello = false;
  helloTries = 0;    // 重连后重起握手重试（原不重置——10 次用尽
                     // 后，重连首条 hello 被中继丢弃就永远失联）
  S.lastSrv = 0;    // 旧连接的服务端活动不再作数
  // ?ws= 参数可临时覆盖服务地址（测试/多环境部署），不改 localStorage
  const qp = new URLSearchParams(location.search).get('ws');
  const cSel = curSel();                 // 按当前选中频道连接
  let ch = chanGet(cSel);
  if (!ch && !qp){
    channelPrompt();                    // 首次使用必须先输频道名
    return;
  }
  ws = new WebSocket(qp || wsUrlOf(ch, cSel));
  S.ws = ws;
  let _openOk = false;
  ws.onopen = () => {
    _openOk = true;
    const _rcWas = !!(S._rcOffline || S._manualRC || S.failStreak > 0 || DIAG.reconn > 0);
    S.failStreak = 0;                 // 连上了就清零
    DIAG.reconn = 0; DIAG.reconnActive = false;   // 成功连上=一轮结束，重试计数归零
    diagLog('已连上中转服务器', 'ok');
    if (S.srvLost){ S.srvLost = false; diagLog('重连成功，解除失联', 'ok'); }
    setOnLine(true);
    if (S._manualRC){ clearTimeout(S._manualRcT); S._manualRC = 0; }
    S._rcLastDelay = 0;
    S._rcOffline = 0;
    if (_rcWas) { try { reconnUi('✓ 已恢复', 'var(--green)', 2500); } catch(e){} }
    cliRebind();
    cliLogin('上线');
    loginWatch();
    try { FoxOut.resumeDeferred(); } catch(e){}
  };
  ws.onmessage = ev => onMsg(ev.data);
  ws.onclose = () => {
    if (DIAG.reconnActive) DIAG.reconn++;
    DIAG.reconnActive = true;
    S.dropByHide = !!document.hidden;
    if (!_openOk){
      S.failStreak++;
      if (S.failStreak === FAIL_ALERT){
        diagLog('已连续 ' + S.failStreak + ' 次连不上中继服务器——'
                + '请检查手机网络，或换主/备中继试试', 'bad');
      }
    }
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
    lastBeatOk = 0;                             // 心跳计时重置
    scheduleReconnect();
  };
  ws.onerror = () => {
    DIAG.err++;
    diagLog('连接出错 #' + DIAG.err + '（网络或中转问题）', 'bad');
  };
  ttsConnect();
  try { if (typeof fvwrPickChanListen === 'function') fvwrPickChanListen(); } catch(e){}
}

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
addEventListener('online', function(){
  try { diagLog('系统网络恢复事件 → 立即尝试重连', 'dim'); } catch(e){}
  S.failStreak = 0;                      /* 连败停摆是断网期攒的，恢复信号到达即清；网络仍坏会重新攒 */
  clearTimeout(reconnectTimer); reconnectTimer = null;
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
    lastBeatOk = 0;            /* 最后一次成功发出登录心跳的时刻 */

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
  S.idbFirstFull = 1;
  S.anchor_reask = 1;
  sendJson({t: 'login', fg: !document.hidden, nick: nickGet()});
  /* 账本核对：登录＝强核对场景之一，与 switch/svr/timer 共用
     ledgerVcheckSend 同一构造函数（账本核对.js）。
     login 也必须带上当前锚定 sid（与 timer/switch 同口径），否则服务端
     不知道网页端在看哪个会话 ⇒ 无法按本户 12 条 ID 逐条补缺额。 */
  try {
    if (window.ledgerVcheckSend) ledgerVcheckSend('login', S.anchorFull
      || (typeof curSid === 'function' ? curSid() : '') || '');
  } catch(e){}
  lastBeatOk = Date.now();
  clearInterval(hbTimer);
}
function cliLogout(reason){
  const was = loggedIn;
  loggedIn = false;
  clearInterval(hbTimer); hbTimer = null;
  clearTimeout(helloTimer);          /* 退出后不得再有定时外发（握手重发也停） */
  if (was){ try { sendJson({t: 'logout', r: reason || ''}); } catch(e){} }
  S.lastSrv = 0;
  S.srvLost = false;
  S.waitT = 0; S.waitN = 0; S.waitLast = 0;
  try { renderLink(); } catch(e){}
}
function cliResume(reason){
  if (ws && ws.readyState === 1){
    const stale = !lastBeatOk || (Date.now() - lastBeatOk > 120000);
    if (!loggedIn || stale) cliLogin(reason || '回前台');
    else { try { sendJson({t: 'vcheck', act: 'beat', sid: String((typeof curSid === 'function' ? curSid() : '') || '')}); } catch(e){} lastBeatOk = Date.now(); }
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
  document.addEventListener('visibilitychange', () => {
    if (document.hidden){
      S.waitT = 0; S.waitN = 0; S.waitLast = 0;
      return;                          // 切后台：不再下线
    }
    cliResume('回前台');              // 回前台：秒续或立即重连
  });
  window.addEventListener('pageshow', () => cliResume('回到页面'));
  /* 僵尸连接自救：后台冻结后 socket 常「以为还开着」但实际上早断了，
     靠 readyState 判不出来。改判「多久没收到服务端任何消息」：
     可见状态下超过 90 秒零收帧 ⇒ 强行关掉重连（不必手动刷新）。 */
  setInterval(() => {
    try {
      if (document.hidden || !S.onLine) return;
      const last = Number(S.lastSrv || 0);
      if (last && Date.now() - last > 90000){
        try { if (ws){ ws.onclose = null; ws.close(); } } catch(e){}
        loggedIn = false; lastBeatOk = 0; S.lastSrv = 0;
        try { ensureConnect(); } catch(e){}
        try { if (typeof flash === 'function') flash('连接已超时，正在自动重连…', 'var(--orange)'); } catch(e){}
      }
    } catch(e){}
  }, 30000);
}
/* ========= 1.33：AI 文本刷新间隔（服务端 poll_sec）=========
   只控制「AI 文本快照」的刷新节奏（＝流量开关，0.5~30s）。点击/
   操作信号在服务端由独立的 0.05s 步长巡检即时执行，与本值完全无关，
   所以调到 30s 也不会让按钮变迟钝。 */

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
    deliverFox(FoxIn.feedCtrl(msg));  /* 补发片补齐也可能即刻交付正文 */
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

function deliverFox(r){
  if (!r) return;
  const sender = r[0], body = r[1];
  if (!sender || sender[0] !== '1') return;   // 只认服务端（'1'
                                              // 开头），拒客户端回声
  srvSeen();                                  // 服务端判活
  handleBody(body, sender);                   // 带上 FOX 头发送者 id 供隔离过滤
}

function srvIsoPass(d, fromId){
  const _t0 = String((d && d.t) || '');
  if (_t0 === 'ev' || _t0 === 'rcpt') return true;
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
  /* 入站解码统一走 WS收发格式化.js（坏包/非对象一律 null，口径与电脑版一致） */
  d = (window.WSFMT && typeof window.WSFMT.解析 === 'function')
    ? window.WSFMT.解析(body) : null;
  if (!d) { try { d = JSON.parse(body); } catch(e){ return; }
            if (!d || typeof d !== 'object') return; }
  if (!d || typeof d !== 'object') return;
  const nm = d.srv || '';
  if (!nm) return;
  regSrv(nm, d);
  if (d.t === 'srv'){
    if (nm === S.cur && d.alive){ S.alive = new Set(d.alive); }
    renderSrvList();
    return;
  }
  if (nm !== S.cur) return;                   // 非当前操控对象：忽略
  if (!srvIsoPass(d, fromId)) return;         // 非本服 FOX 号，整帧丢弃
  if (d.t === 'deny'){
    if (d.target === MY_ID)
      flash('🔒 [' + (d.srv || '远方') + '] 正被 '
            + (d.holder || '其他客户端') + ' 占用，稍后再试',
            'var(--red)');
    return;
  }
  if (d.t === 'ev') { onEv(d.k, d.v); return; }
  if (d.t === 'rcpt') { onRcpt(d); return; }
  if (d.t === 'res') { onRes(d.id, d.k, d.v); return; }
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
  if (d.t === 'lbkeep'){ if (window.lbKeepApply) lbKeepApply(d); return; }
  if (d.t === 'lbsync'){ if (window.lbSyncApply) lbSyncApply(d); return; }
  if (d.t === 'think_int_ack'){ if (window.lbThinkIntAck) lbThinkIntAck(d); return; }   /* 账本V1.0：set_think_int 回执（账本核对.js） */
  if (d.t === 'poll_set') return;                     // 档位已移除，忽略回执
}

/* ============ 1.12 多服务端名册（v1.84：落盘 + 只认名称） ============ */

