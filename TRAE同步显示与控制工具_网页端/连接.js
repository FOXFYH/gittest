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
  loggedIn = false;
}

function connect(){
  teardownWs();
  setOnLine(false);
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
    S.failStreak = 0;                 // 1.61：连上了就清零
    DIAG.reconn = 0; DIAG.reconnActive = false;   // 1.66：成功连上=一轮结束，重试计数归零
    diagLog('已连上中转服务器', 'ok');
    setOnLine(true);
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
    diagLog((S.dropByHide ? '后台断线（回来自动补）'
                          : '断线（第 ' + DIAG.reconn + ' 次）'),
            'bad');
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

/* 1.57：立即重连（回前台专用）——不再干等 RECONNECT 那 3 秒定时器；
   正在连接 / 已连上则什么也不做。 */
/* 13.3【限次限频·宣告失败·杜绝死循环】：断线重连不再无限 3s 空转——间隔
   逐次退避（3→6→12→24→48→封顶 60s），连续连不上达 RECONNECT_MAX 次即
   停止自动重连并明确宣告失败（可点「连接诊断」手动重连、或刷新页面恢复）。 */
function scheduleReconnect(){
  if (S.failStreak >= RECONNECT_MAX){
    diagLog('已连续 ' + S.failStreak + ' 次连不上中继服务器，停止自动重连（失败）；'
            + '请检查网络，或点「连接诊断」手动重连', 'bad');
    flash('连不上中继，已停止自动重连', 'var(--red)', 6000);
    return;
  }
  const n = Math.min(Math.max(S.failStreak, 1) - 1, 5);
  const delay = Math.min(RECONNECT * Math.pow(2, n), 60);
  diagLog(delay + 's 后重连（第 ' + (S.failStreak + 1) + ' 次尝试）', 'dim');
  reconnectTimer = setTimeout(connect, delay * 1000);
}
function ensureConnect(){
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  if (S.failStreak >= RECONNECT_MAX) return;   /* 13.3：已达重连上限，改为手动重连 */
  clearTimeout(reconnectTimer);
  connect();
}

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
  sendJson({t: 'login', fg: !document.hidden, nick: nickGet()});
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
  clearInterval(hbTimer);
  if (was){ try { sendJson({t: 'logout', r: reason || ''}); } catch(e){} }
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
    if (document.hidden) return;      // 切后台：不再下线
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
  handleBody(body);
}

function handleBody(body){
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
    if (nm === S.cur && d.alive){ S.alive = new Set(d.alive); renderPorts(); }
    renderSrvList();
    return;
  }
  if (nm !== S.cur) return;                   // 非当前操控对象：忽略
  /* 1.13：操控互斥——目标拒绝（正被其他客户端占用） */
  if (d.t === 'deny'){
    if (d.target === MY_ID)
      flash('🔒 [' + (d.srv || '远方') + '] 正被 '
            + (d.holder || '其他客户端') + ' 占用，稍后再试',
            'var(--red)');
    return;
  }
  if (d.t === 'ev') { onEv(d.k, d.v); return; }
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
  if (d.t === 'poll_set') return;                     // 1.35：档位已移除，忽略回执
}

/* ============ 1.12 多服务端名册（v1.84：落盘 + 只认名称） ============ */

/* v1.84：名册落盘——网页端只认「电脑名称」（随机 ID/sid 只在后台识别用，
   界面一律不显示）。名称＋最后出现时间存 LS_SRVS，刷新/重开页面立即恢复
   清单（离线的也留一行 ○）；超 SRV_TTL(7 天) 未再出现的名称自动清理。 */
