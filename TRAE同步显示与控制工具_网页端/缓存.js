'use strict';
const LS_SKEL = 'trae_webm_skel';        /* 骨架缓存（会话列表） */
const LS_HIST = 'trae_webm_hist';        /* 历史消息缓存（按会话） */
let cacheKey = null, reqSeq = 0, skelLastSave = 0;
const S_reqs = {};                       /* id → {conv, ts}（防过期回包） */
function cacheKeyNow(){ return VER + '|' + (S.srvVer || '0'); }
function checkVerBump(){
  /* 首次定键 / 版本变化 → 清空本地骨架与历史缓存（改版重下）。
     本专项 B1：换代同时清 IndexedDB 快照表，并清掉 LS 里明确属快照类的键
     （快照绝不进 localStorage；LS_HIST 属账本历史，上面已按需清）。 */
  const k = cacheKeyNow();
  if (cacheKey !== null && cacheKey !== k){
    try { localStorage.removeItem(LS_SKEL);
          localStorage.removeItem(LS_HIST); } catch(e){}
    try { snapIdbClearAll(); } catch(e){}
    _lsPurgeSnapKeys();
    S.histConv = ''; S.histMsgs = null; S.histRaw = [];
  }
  cacheKey = k;
}
/* 本专项 B1：黑名单式清「疑似快照类」LS 键（绝不误删配置/名册/昵称/收藏） */
function _lsPurgeSnapKeys(){
  try {
    const del = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i) || '';
      if (/^trae_webm_(skel|snap|idb_snap)/.test(k)) del.push(k);
    }
    del.forEach(k => localStorage.removeItem(k));
  } catch(e){}
}
/* —— 骨架缓存：打开页面即秒显会话列表（不用等连上） —— */
function skelCacheSave(snap){
  if (!snap || !Array.isArray(snap.convs) || !snap.convs.length) return;
  const now = Date.now();
  if (now - skelLastSave < 2000) return;      /* 节流：2 秒内只写一次 */
  skelLastSave = now;
  try {
    const o = {key: cacheKeyNow(), ts: now,
               convs: snap.convs, conv_unread: snap.conv_unread || [],
               conv_unread_ids: snap.conv_unread_ids || []};
    localStorage.setItem(LS_SKEL, JSON.stringify(o));
  } catch(e){}
}
function skelCacheLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_SKEL) || 'null');
    if (!o || o.key !== cacheKeyNow()) return null;
    return o;
  } catch(e){ return null; }
}
/* 2.59：本地缓存限「最近 3 轮」（用户 2026-10-07）——「AI 一问我一答」为一轮：
   从末尾往前数到第 4 个问句为止，只保留其后的部分。更早的历史不再落盘，需要时
   由「历史取回」（上滑向本地账本按需索要）拉取——不落盘、只在当次可见。
   两种格式通吃：快照/展示行是数组 [role,text,...]；账本原始记录是对象 {role,...}。 */
function _msgRole(m){
  if (!m) return '';
  if (Array.isArray(m)) return m[0] || '';
  return m.role === 'u' ? 'u' : 'a';
}
function keepLastRounds(a, n){
  if (!Array.isArray(a) || !a.length) return [];
  n = n || WEB_ROUNDS_KEEP;
  let cnt = 0;
  for (let i = a.length - 1; i >= 0; i--){
    if (_msgRole(a[i]) === 'u'){
      cnt++;
      if (cnt > n) return a.slice(i + 1);
    }
  }
  return a.slice();
}
/* —— 历史缓存：按 (端口|会话标题) 存账本记录 + 游标 —— */
function histCacheRead(conv){
  try {
    const o = JSON.parse(localStorage.getItem(LS_HIST) || 'null');
    if (!o || o.key !== cacheKeyNow()) return null;
    const e = (o.convs || {})['p' + S.port + '|' + (conv || '')];
    if (!e || !Array.isArray(e.msgs) || !e.msgs.length) return null;
    e.msgs = keepLastRounds(e.msgs);   /* 2.59：历史遗留的过长缓存「读入即裁」到最近 3 轮 */
    return e;
  } catch(e){ return null; }
}
function histCacheWrite(conv, ver, have_seq, msgs){
  try {
    let o = null;
    try { o = JSON.parse(localStorage.getItem(LS_HIST) || 'null'); } catch(e){}
    if (!o || o.key !== cacheKeyNow()) o = {key: cacheKeyNow(), convs: {}};
    if (!o.convs) o.convs = {};
    o.convs['p' + S.port + '|' + (conv || '')] =
      {ver: ver | 0, have_seq: have_seq | 0,
       msgs: keepLastRounds(msgs)};   /* 2.59：本地历史也只落最近 3 轮 */
    localStorage.setItem(LS_HIST, JSON.stringify(o));
  } catch(e){}
}
function ledToArr(r){
  return [r.role === 'u' ? 'u' : 'a', r.text || '', r.tm || '',
          r.can_rev ? 1 : 0, r.can_del ? 1 : 0];
}
/* —— 请求式历史 —— */
function reqHist(conv, have_seq, ver){
  const id = ++reqSeq;
  S_reqs[id] = {conv: conv || '', ts: Date.now()};
  sendJson({t: 'req', id: id, c: 'hist', conv: conv || '',
            have_seq: have_seq | 0, ver: ver | 0});
}
function reqHistPrev(conv, from_seq, count){
  const id = ++reqSeq;
  S_reqs[id] = {conv: conv || '', ts: Date.now()};
  sendJson({t: 'req', id: id, c: 'hist_prev', conv: conv || '',
            from_seq: from_seq | 0, count: count | 4});   /* 2.49：每次补 4 条 */
  /* 2.49：兜底——服务端 8 秒没回也别把「正在取回历史记录…」挂死、别锁死防重入 */
  setTimeout(function(){
    if (S.histLoadingPrev && S.histPullFrom === (from_seq | 0)){
      S.histLoadingPrev = false;
    }
  }, 8000);
}
function onRes(id, k, v){
  const rq = S_reqs[id];
  if (rq) delete S_reqs[id];
  if (!v || !v.ok) return;                     /* 账本不可用/未知 c：静默 */
  if (k === 'hist') applyHist(rq ? rq.conv : '', v);
  else if (k === 'hist_prev') prependHist(rq ? rq.conv : '', v.msgs || [], v.end);
}
function applyHist(conv, v){
  if (conv !== S.histConv) return;             /* 过期回包（已切会话） */
  const inc = v.msgs || [];
  if (v.rebuild){                              /* 版本不符：整体重建 */
    S.histRaw = keepLastRounds(inc);           /* 2.59：重建也只留最近 3 轮（防首屏超长） */
    S.histMsgs = S.histRaw.map(ledToArr);
    S.histVer = v.ver | 0;
  } else {                                     /* 游标增量：只补新段 */
    if (!Array.isArray(S.histRaw)) S.histRaw = [];
    if (!Array.isArray(S.histMsgs)) S.histMsgs = [];
    for (const r of inc){
      if (S.histRaw.some(x => x.seq === r.seq)) continue;
      S.histRaw.push(r);
      S.histMsgs.push(ledToArr(r));
    }
    S.histVer = v.ver | 0;
  }
  S.histHave = S.histRaw.length
    ? S.histRaw[S.histRaw.length - 1].seq : 0;
  /* 2.59：不论重建还是增量补新，本地账本恒裁到最近 3 轮（防本地缓存随会话膨胀）。 */
  S.histRaw = keepLastRounds(S.histRaw);
  S.histMsgs = S.histRaw.map(ledToArr);
  histCacheWrite(conv, S.histVer, S.histHave, S.histRaw);
  renderAll();
}
function prependHist(conv, older, end){
  S.histLoadingPrev = false;
  if (end) S.histEnd = true;          /* 2.49：服务端判到底 → 不再请求 */
  if (conv !== S.histConv) return;
  if (!Array.isArray(older) || !older.length) return;
  const h = el.msgs.scrollHeight;              /* 保阅读位置 */
  S.histRaw = older.concat(S.histRaw || []);
  S.histMsgs = S.histRaw.map(ledToArr);
  histCacheWrite(conv, S.histVer, S.histHave, S.histRaw);
  renderAll();
  el.msgs.scrollTop = el.msgs.scrollHeight - h;
}
/* —— 会话历史打开：秒显本地 + 发请求式增量 —— */
function ensureHist(){
  if (S.switch_pend) return;                   /* 切换在途：等快照定论 */
  const title = curTitle();
  if (!title || title === S.histConv) return;
  S.histConv = title;
  S.histMsgs = null; S.histRaw = []; S.histVer = 0; S.histHave = 0;
  S.histLoadingPrev = false;
  S.histEnd = false; S.histPullFrom = 0;   /* 2.49：换会话重置到底标记/游标 */
  const c = histCacheRead(title);
  if (c){                                       /* 本地秒显历史 */
    S.histRaw = c.msgs.slice();
    S.histMsgs = c.msgs.map(ledToArr);
    S.histVer = c.ver | 0; S.histHave = c.have_seq | 0;
  }
  renderAll();                                  /* 秒显（快照未到达前） */
  reqHist(title, S.histHave, S.histVer);        /* 游标增量补新/重建 */
}
function _msgKey(m){
  /* 2.54：消息身份指纹——角色 + 正文去空白后前 24 字。 */
  const t = String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 24);
  return ((m && m[0]) || '') + '\u0001' + t;
}
function curMsgs(){
  /* 2.54：快照为权威尾部，账本只补更早。原实现（2.49）在账本比快照长时以账本为骨架，
     账本里的重复/乱序行会让「连续多条 AI 回答而无对应问句」上屏（无头回复）。
     改为：在账本里从后往前找与快照首行同键的位置 cut，账本 [0,cut) 视为更早历史拼在
     快照之前；找不到或就在开头则只用快照（宁缺不乱）。 */
  const snapMsgs = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : null;
  const led = (S.histMsgs && S.histMsgs.length) ? S.histMsgs : null;
  if (!led) return snapMsgs || [];
  if (!snapMsgs || !snapMsgs.length) return led;
  const k0 = _msgKey(snapMsgs[0]);
  let cut = -1;
  for (let i = led.length - 1; i >= 0; i--){
    if (_msgKey(led[i]) === k0){ cut = i; break; }
  }
  if (cut <= 0) return snapMsgs;
  return led.slice(0, cut).concat(snapMsgs);
}

/* ========== 1.90：文本转语音小卡片 ========== */
/* 识别标志正则（用户规定）：(@fox-play1) 开头、(@fox-play2) 结尾包夹。
   命中段从消息正文里摘出 → 语音卡片；正文中该段被卡片替换（不再重复
   显示原文），data-seg 存完整文本供播放。1.98：卡片改为两行——上行
   「文字 + ▶」、下行「阶段通知」。
   2.14：**容错识别**——采集到的正文尾巴偶尔会缺（账本实测：有消息结尾
   被截成「…要不要照这个定位开工？(@fox」），原正则要求两端都完整，
   于是整段认不出、标记碎片原样露在气泡里（用户反馈「后缀破碎」）。
   改为「有头就认」：结尾要么是完整的 (@fox-play2)，要么就到消息末尾；
   同时把末尾那截残缺标记（如 (@ / (@fox）剪掉，不混进卡片正文。 */

/* ==================== 本专项 B 组：快照落地 IndexedDB ====================
   用户口径（R6/D4/D8/D9/P10/P11）：网页端「快照」（锚定会话正文帧）一律落
   IndexedDB；每 5 秒节流落地、超一周剪枝、换版本清空；localStorage 只留
   长期固定项与账本历史 LS_HIST（快照绝不进 localStorage）。
   秒显：点会话先读本地存帧立刻铺上，并出「正在获取直播帧」小条，
   直到当前锚定会话的真直播帧到达才撤。IDB 打不开则静默降级，绝不阻断主流程。 */
const IDB_NAME = 'trae_webm_idb', IDB_VER = 1;
const IDB_KEEP_MS = 7 * 24 * 3600 * 1000;   /* 超一周剪枝（与 SRV_TTL 同一把尺） */
const WEB_ROUNDS_KEEP = 3;               /* 2.59：单帧/本地历史只留最近 3 轮（用户 2026-10-07）；原为尾部 40 条 */
const IDB_PRUNE_MAX = 200;                  /* 单轮最多删 200 条，防长任务卡主线程 */
let _idbP = null, _idbLastAt = 0, _idbLastFp = '', _idbLastSid = '';
function idbOpen(){
  if (_idbP) return _idbP;
  _idbP = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('无 IndexedDB'));
    const rq = indexedDB.open(IDB_NAME, IDB_VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('snap_conv')){
        const st = db.createObjectStore('snap_conv', {keyPath: 'sk'});
        st.createIndex('by_ts', 'ts');                      /* 剪枝游标用 */
      }
      if (!db.objectStoreNames.contains('snap_list'))
        db.createObjectStore('snap_list', {keyPath: 'sk'});
      if (!db.objectStoreNames.contains('snap_pend'))
        db.createObjectStore('snap_pend', {keyPath: 'did'});  /* 占位卡持久化（C1） */
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error || new Error('IndexedDB 打开失败'));
  });
  _idbP.catch(() => { _idbP = null; });     /* 失败可重试，不长期锁死 */
  return _idbP;
}
function _idbReq(store, mode, fn){
  return idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => res(r && r.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  })).catch(e => { throw e; });
}
function _idbFp(){
  const s = S.snap || {};
  return msgsFp(s.msgs) + '|' + (s.finish || '') + '|' + (s.tail || '')
    + '|' + (s.sendIdle ? 1 : 0) + '|' + (s.inputText || '')
    + '|' + (s.model || '') + '|' + ((s.convs || []).length);
}
function _idbFrame(){
  const s = S.snap || {};
  return {online: !!s.online, login: s.login,
          msgs: (Array.isArray(s.msgs) ? keepLastRounds(s.msgs) : []),
          finish: s.finish || null, tail: s.tail || '', sendIdle: s.sendIdle,
          inputText: s.inputText || '', opts: s.opts || [],
          ask: s.ask || null, pend: s.pend || [], attach: s.attach || [],
          model: s.model || ''};
}
/* 每 5 秒（+关键动作强制）把当前锚定会话的快照落地 */
function snapIdbTick(force){
  /* 2.57B：切换在途——此刻 S.snap 正文仍属旧会话 A，绝不能在锚定已指向 B 时
     把它当 B 的存帧落地（否则会把 A 的内容毒化成 B 的缓存）。 */
  if (S.livePend) return;
  const s = S.snap || {};
  if (!Array.isArray(s.convs) || !s.convs.length) return;   /* 还没快照 */
  const sid = (S.anchorSid || curSid() || '');
  if (!sid) return;
  const now = Date.now(), fp = _idbFp();
  if (force !== true){
    if (now - _idbLastAt < 5000) return;                     /* 5 秒时间闸 */
    if (fp === _idbLastFp && sid === _idbLastSid) return;     /* 指纹去重 */
  }
  _idbLastAt = now; _idbLastFp = fp; _idbLastSid = sid;
  const key = cacheKeyNow();
  _idbReq('snap_conv', 'readwrite', st => st.put(
    {sk: key + '|' + sid, key: key, port: S.port, sid: sid,
     title: curTitle(), ts: now, lastAccess: now, frame: _idbFrame()}
  )).catch(() => {});
  _idbReq('snap_list', 'readwrite', st => st.put(
    {sk: key, key: key, ts: now, convs: s.convs,
     conv_unread: s.conv_unread || [], conv_unread_ids: s.conv_unread_ids || []}
  )).catch(() => {});
}
function snapIdbGet(sid){
  if (!sid) return Promise.reject(new Error('无 sid'));
  return _idbReq('snap_conv', 'readonly', st => st.get(cacheKeyNow() + '|' + sid));
}
function snapIdbListGet(){
  return _idbReq('snap_list', 'readonly', st => st.get(cacheKeyNow()));
}
/* 剪枝：超一周的记录按主键逐个删（绝不整库清空），单轮上限 IDB_PRUNE_MAX */
function snapIdbPrune(){
  const cut = Date.now() - IDB_KEEP_MS;
  let n = 0;
  return _idbReq('snap_conv', 'readwrite', st => {
    const rq = st.index('by_ts').openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c || n >= IDB_PRUNE_MAX) return;
      if ((c.value.ts || 0) < cut){ c.delete(); n++; }
      c.continue();
    };
    return rq;
  }).catch(() => {});
}
/* 版本换代 / 清缓存：清空快照类（快照表 + 列表骨架），不动占位卡 */
function snapIdbClearAll(){
  return Promise.all([
    _idbReq('snap_conv', 'readwrite', st => st.clear()),
    _idbReq('snap_list', 'readwrite', st => st.clear())
  ]).catch(() => {});
}
/* 2.57B：切换在途的展示视图（用户 2026-10-07）——已点目标 B、真直播帧尚未
   到达：正文/选项/占位/输入框/附件/模型一律取「B 的本地存帧」，没有存帧
   就留空；绝不回落到服务器快照（那是旧会话 A 的内容，会造成张冠李戴）。
   非切换期原样返回快照。 */
function liveOverlay(snap){
  if (!S.livePend) return snap;
  const f = S.liveFrame || {};
  return Object.assign({}, snap, {
    msgs: (f.msgs || []), finish: f.finish || null, tail: f.tail || '',
    sendIdle: !!f.sendIdle, inputText: f.inputText || '',
    opts: f.opts || [], ask: f.ask || null, pend: f.pend || [],
    attach: f.attach || [], model: f.model || ''
  });
}
/* —— B3：直播帧提示条（横幅正下方小条，真直播帧到达即撤） —— */
function liveShow(){
  let t = $('livebar');
  if (!t){
    t = document.createElement('div');
    t.id = 'livebar';
    document.body.appendChild(t);
  }
  t.textContent = '⏳ 正在获取直播帧…（当前显示的是本地存帧）';
  const host = document.body.classList.contains('fmsg') ? $('fbar') : el.state;
  const r = (host && host.getBoundingClientRect) ? host.getBoundingClientRect() : null;
  t.style.top = ((r && r.bottom ? r.bottom : 34) + 2) + 'px';
  t.classList.add('on');
}
function liveHide(){
  const t = $('livebar');
  if (t) t.classList.remove('on');
}
/* 秒显：点会话后先读本地存帧立刻铺上，并挂「正在获取直播帧」条 */
function snapIdbShow(sid, title){
  if (!sid) return;
  S.liveGot = false; S.livePend = sid;
  S.liveFrame = null;            /* 2.57B：旧会话 A 的正文退场（防张冠李戴） */
  liveShow();
  /* 2.64：先读到目标会话的存帧、再渲染「一次」——不再先画一版空帧。
     原实现先 renderAll() 空帧、再异步补缓存，中间那版空版面会把消息区
     scrollTop 夹回 0 并抛 scroll 事件，成为「自动跳顶 + 拉历史」的源头。
     现在：有存帧 → 一次性铺上（全程不经过空帧）；无存帧 → 只留白一次等直播帧。 */
  snapIdbGet(sid).then(rec => {
    if (S.liveGot) return;                      /* 直播帧已到，别用旧帧盖真画面 */
    if ((S.anchorSid || '') !== sid) return;    /* 已切走 */
    S.liveFrame = (rec && rec.frame) || null;   /* 有存帧 → 一次性上屏 */
    renderAll();
  }).catch(() => {
    /* 读取失败也要铺一次，免卡在上一会话画面 */
    if (!S.liveGot && (S.anchorSid || '') === sid) renderAll();
  });
}
/* 直播帧到达（专属于当前锚定会话）→ 撤条并停用本地帧 */
function liveClear(){
  S.livePend = ''; S.liveGot = true; S.liveFrame = null;   /* 2.57B：真帧到手撤存帧 */
  liveHide();
  snapIdbTick(true);                           /* 真画面到手，立刻落地一帧 */
}
setInterval(() => snapIdbTick(), 5000);
setInterval(() => snapIdbPrune(), 10 * 60 * 1000);
