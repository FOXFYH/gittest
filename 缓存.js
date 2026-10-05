'use strict';
const LS_SKEL = 'trae_webm_skel';        /* 骨架缓存（会话列表） */
const LS_HIST = 'trae_webm_hist';        /* 历史消息缓存（按会话） */
let cacheKey = null, reqSeq = 0, skelLastSave = 0;
const S_reqs = {};                       /* id → {conv, ts}（防过期回包） */
function cacheKeyNow(){ return VER + '|' + (S.srvVer || '0'); }
function checkVerBump(){
  /* 首次定键 / 版本变化 → 清空本地骨架与历史缓存（改版重下） */
  const k = cacheKeyNow();
  if (cacheKey !== null && cacheKey !== k){
    try { localStorage.removeItem(LS_SKEL);
          localStorage.removeItem(LS_HIST); } catch(e){}
    S.histConv = ''; S.histMsgs = null; S.histRaw = [];
  }
  cacheKey = k;
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
/* —— 历史缓存：按 (端口|会话标题) 存账本记录 + 游标 —— */
function histCacheRead(conv){
  try {
    const o = JSON.parse(localStorage.getItem(LS_HIST) || 'null');
    if (!o || o.key !== cacheKeyNow()) return null;
    const e = (o.convs || {})['p' + S.port + '|' + (conv || '')];
    if (!e || !Array.isArray(e.msgs) || !e.msgs.length) return null;
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
      {ver: ver | 0, have_seq: have_seq | 0, msgs: msgs};
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
            from_seq: from_seq | 0, count: count | 30});
}
function onRes(id, k, v){
  const rq = S_reqs[id];
  if (rq) delete S_reqs[id];
  if (!v || !v.ok) return;                     /* 账本不可用/未知 c：静默 */
  if (k === 'hist') applyHist(rq ? rq.conv : '', v);
  else if (k === 'hist_prev') prependHist(rq ? rq.conv : '', v.msgs || []);
}
function applyHist(conv, v){
  if (conv !== S.histConv) return;             /* 过期回包（已切会话） */
  const inc = v.msgs || [];
  if (v.rebuild){                              /* 版本不符：整体重建 */
    S.histRaw = inc.slice();
    S.histMsgs = inc.map(ledToArr);
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
  histCacheWrite(conv, S.histVer, S.histHave, S.histRaw);
  renderAll();
}
function prependHist(conv, older){
  S.histLoadingPrev = false;
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
  const c = histCacheRead(title);
  if (c){                                       /* 本地秒显历史 */
    S.histRaw = c.msgs.slice();
    S.histMsgs = c.msgs.map(ledToArr);
    S.histVer = c.ver | 0; S.histHave = c.have_seq | 0;
  }
  renderAll();                                  /* 秒显（快照未到达前） */
  reqHist(title, S.histHave, S.histVer);        /* 游标增量补新/重建 */
}
function curMsgs(){
  /* 直播权威=快照（每拍全文）；缓存只在快照尚无 msgs 时兜底秒显 */
  if (S.snap && Array.isArray(S.snap.msgs)) return S.snap.msgs;
  return (S.histMsgs && S.histMsgs.length) ? S.histMsgs : [];
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
