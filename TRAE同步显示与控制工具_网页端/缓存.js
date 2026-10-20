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
  /* 2.105（②）：账本行补 index6＝mid（原始记录自带 mid；index5 留空＝无服务端盖章），
     供 curMsgs 尾部追加「按 mid 优先去重」，并与快照行同口径取时间。 */
  return [r.role === 'u' ? 'u' : 'a', r.text || '', r.tm || '',
          r.can_rev ? 1 : 0, r.can_del ? 1 : 0, '', r.mid || ''];
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
  /* 2.49：兜底——服务端 8 秒没回也别把「正在取回历史记录…」挂死、别锁死防重入。
     2.85：兜底时**同时清 histPullFrom**——否则「近顶分支」见
     `S.histPullFrom === first.seq`（起始游标未推进）会误判「已到底」，
     把 histEnd 置真、此后永不再拉（深采回包 >8s 时必现）。 */
  setTimeout(function(){
    if (S.histLoadingPrev && S.histPullFrom === (from_seq | 0)){
      S.histLoadingPrev = false;
      S.histPullFrom = 0;              /* 2.85：清游标，避免近顶误判「到底」 */
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
  const h = el.msgs.scrollHeight, t0 = el.msgs.scrollTop;   /* 2.85：记「旧高＋旧位」 */
  /* 2.85：按 seq 去重并入——8s 兜底清游标后可能「旧包未回、新包又发」，两个
     回包同段会重复并入并重复上屏（且扰 curMsgs 的 cut 定位）；这里同 seq 只并一次。 */
  const _have = new Set((S.histRaw || []).map(x => x.seq));
  S.histRaw = older.filter(r => !_have.has(r.seq)).concat(S.histRaw || []);
  S.histMsgs = S.histRaw.map(ledToArr);
  histCacheWrite(conv, S.histVer, S.histHave, S.histRaw);
  renderAll();
  /* 2.85：按「增量」还原阅读位置。旧写法 `scrollTop = 新height - 旧height`：
     ①用户在中间读（t0>0）时被硬拽回相对顶部（新-旧往往很小甚至为 0）；
     ②renderAll() 空转（renderMsgs 指纹相同直接 return，或 curMsgs 未把补拉行
     上屏）时新==旧 ⇒ 赋值 0 ⇒ 跳到最顶上；且该赋值还抛 scroll 事件 →
     近顶分支再发请求 →「鬼打墙」。增量写法：位置 = 旧位 + max(0, 增长量)；
     内容没长高则原地不动（不抛事件，根断重入）。 */
  el.msgs.scrollTop = t0 + Math.max(0, el.msgs.scrollHeight - h);
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
/* 2.112（X2-2/X2-4）：正式 mid＝十六进制串（前 8 位＝Unix 秒）；`temp-agent-…`
   这类非 hex 一律视为「生成期临时号」，不得当正式身份参与去重/对齐/排序。 */
function _midIsFormal(id){
  return /^[0-9a-fA-F]{8}/.test(String(id || ''));
}
function _msgKey(m){
  /* 2.54：消息身份指纹——角色 + 正文去空白后前 24 字。
     2.112（X2-4）：改为 **mid（index6）优先**——mid 是系统唯一身份，原「角色＋正文
     前 24 字」会把两段正文相同的消息错并/错位（重复行或丢行）。mid 缺、或仍是
     `temp-agent-…` 临时号时才退回「角色＋正文前 24 字」。 */
  const id = String((m && m.length > 6 && m[6]) || '');
  if (_midIsFormal(id)) return 'M\u0001' + id;
  const t = String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 24);
  return ((m && m[0]) || '') + '\u0001' + t;
}
/* ===== 2.112（X2-2）：临时号 → 正式 mid 的「就地换号」登记 =====
   同一会话内按「角色＋正文去空白前 48 字」记住已见过的正式 mid；若同一行还挂着
   `temp-agent-…` 临时号，就把正式 mid 补回该行（只换 index6，不新增行、不删除行、
   不移动其它行）。会话切换即清空，绝不跨会话串号。
   注意：只处理明确的临时号（^temp-），「空 mid 行」不换号——避免把两条正文相同的
   无号消息错并成一条。 */
let _midFpConv = '', _midFpMap = {}, _midFpN = 0;
const MID_FP_MAX = 400;
function _rowFp(m){
  const t = String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 48);
  return ((m && m[0]) || '') + '\u0001' + t;
}
function _midFpReset(){
  const conv = (typeof curTitle === 'function') ? curTitle() : '';
  if (conv !== _midFpConv){ _midFpConv = conv; _midFpMap = {}; _midFpN = 0; }
}
function _midCollect(list){
  _midFpReset();
  if (!Array.isArray(list)) return;
  for (const m of list){
    const id = String((m && m[6]) || '');
    if (!_midIsFormal(id)) continue;
    const f = _rowFp(m);
    if (!f || _midFpMap[f] || _midFpN >= MID_FP_MAX) continue;
    _midFpMap[f] = id; _midFpN++;
  }
}
function _midIsTemp(id){
  return /^temp-/i.test(String(id || ''));
}
function _midPromote(list){
  _midFpReset();
  if (!Array.isArray(list)) return list;
  for (let i = 0; i < list.length; i++){
    const m = list[i];
    if (!m) continue;
    const id = String(m[6] || '');
    if (!_midIsTemp(id)) continue;                 /* 只给「临时号」就地换正式号 */
    const f = _midFpMap[_rowFp(m)];
    if (!f) continue;
    const r = m.slice();
    r[6] = f;                                      /* 同行换号：行数不变 */
    list[i] = r;
  }
  return list;
}
/* ===== 2.112（X2-1/X2-2/X2-3）：严格全序排序 =====
   ① 有正式 mid 的行：按 mid 时间升序（同秒按原顺序）——顺序只由系统 ID 决定；
   ② 无 mid 的行（含 temp-agent 临时号、pane/非选中会话缺 mid、账本缺号）：
      **一律置顶**，保持其相互间的原相对次序，并在行上打 m[7]=1（渲染层标「时间未知」）；
   ③ ⇒ 任何输入序列都得到确定的全序，无 mid 行永远抢不到「最新」位置（原 2.103 的
      「有 mid 按时间、无 mid 保持原位」不是全序，正是「老记录跑到最新位」的根因）。 */
function _markNoMid(m){
  if (!m || typeof m.slice !== 'function') return m;
  const r = m.slice();
  r[7] = 1;
  return r;
}
function orderMsgs(list){
  try {
    if (!Array.isArray(list) || !list.length) return list;
    if (typeof _midTime !== 'function' || typeof _timeSec !== 'function') return list;
    _midCollect(list);
    const src = _midPromote(list.slice());
    const arr = src.map((m, i) => ({m: m, i: i, s: _timeSec(_midTime(m))}));
    const known = [], unk = [];
    for (const x of arr){
      if (isFinite(x.s) && x.s > 0) known.push(x); else unk.push(x);
    }
    if (!known.length) return arr.map(x => _markNoMid(x.m));   /* 全无 mid：原序＋标时间未知 */
    known.sort((a, b) => (a.s - b.s) || (a.i - b.i));
    return unk.map(x => _markNoMid(x.m)).concat(known.map(x => x.m));
  } catch(e){ return list; }
}
function _swSnapIsTargetNow(sp){
  /* 2.106（A4）：切换在途，这拍快照正文是否已【确认为目标】——判据＝正文非空、
     且切换发起时记有旧正文基线（prevMsgs），且二者消息身份不同（sameConvBody 假）。
     prevMsgs 缺失 / 正文为空 / 与旧正文同身份 ⇒ 均视为「仍是旧会话」，一律切断回落。 */
  const sm = (S.snap || {}).msgs;
  return !!(Array.isArray(sm) && sm.length
      && Array.isArray(sp && sp.prevMsgs)
      && !sameConvBody(sm, sp.prevMsgs));
}
function curMsgs(){
  /* 2.106（A4·老板 17:29「切走即弃旧」）：切换在途、目标正文尚未到达 ⇒ 一律不再以
     旧会话 S.snap.msgs／本地账本为骨架拼正文（切断对「要离开的会话 A」的回落）；
     正文改由 renderAll 的「目标落地快照」分支顶出（无则留白）。livePend/切换在途皆属此列。 */
  const _sp = S.switch_pend;
  if ((S.livePend || (_sp && _sp.lockTarget && !_sp.arrived))
      && !_swSnapIsTargetNow(_sp)) return [];
  /* 2.54：快照为权威尾部，账本只补更早。原实现（2.49）在账本比快照长时以账本为骨架，
     账本里的重复/乱序行会让「连续多条 AI 回答而无对应问句」上屏（无头回复）。
     改为：在账本里从后往前找与快照首行同键的位置 cut，账本 [0,cut) 视为更早历史拼在
     快照之前；找不到或就在开头则只用快照（宁缺不乱）。 */
  const snapMsgs = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : null;
  const led = (S.histMsgs && S.histMsgs.length) ? S.histMsgs : null;
  /* 2.112（X2-1/X2-3）：任何返回路径都必须走同一条「严格全序」排序，
     绝不让「没有账本」或「只有账本」的会话按出现顺序乱插。 */
  if (!led) return orderMsgs(snapMsgs || []);
  if (!snapMsgs || !snapMsgs.length) return orderMsgs(led);
  /* 2.89（老板 2026-10-20 紧急）：账本「补尾」收紧为**只补不删**——旧 2.88 在
     账本尾部时间更晚时直接 `return led.slice()`，会把快照里存在、账本里缺失的行
     （尤其 AI 行——账本只记终答、常缺 AI 行）整段抹掉 ⇒ 页面「AI 行突然消失」。
     现一律以快照为骨架：账本只 **补更早**（与快照首行对齐点之前的行）＋ **补缺失的
     新行**（快照尾部之后、账本里有而快照没有的），绝不删除快照已有的行。两边时间
     取各自末行：快照行第 6 位（index 5）、账本行第 3 位（index 2）。 */
  const k0 = _msgKey(snapMsgs[0]);
  let cut = -1;
  for (let i = led.length - 1; i >= 0; i--){
    if (_msgKey(led[i]) === k0){ cut = i; break; }
  }
  /* 账本与快照首行对齐点之前的行＝更早历史，拼在快照之前；对齐不上（或就在
     开头）则只用快照（宁缺不乱）。 */
  /* 2.104（老板 2026-10-20 13:37「**最新的人问与 AI 答确实传到网页版了，但没传到正确位置**；
     你赋予了手机网页版自由，它自己拼贴老消息去抢位置」）：**取消"账本更早段前置拼贴"**——
     正文**一律以快照（＝本地/权威帧，也就是原版人眼可见的那几条）为准**，账本**只在
     "快照尾部之后有新行"时追加**（不前置、不抢位置）；位置最终由 2.103 的「按 mid 时间升序」兜底。 */
  /* 2.112（X2-2）：两源先去重前统一「临时号 → 正式 mid」——否则同一行（快照里还是
     `temp-agent-…`、账本里已是正式 mid）会因身份不同而被当成两条重复追加。 */
  _midCollect(snapMsgs); _midCollect(led);
  const snapP = _midPromote(snapMsgs.slice());
  const ledP  = _midPromote(led.slice());
  let out = snapP.slice();
  /* 补缺失的新行：账本尾部时间晚于快照尾部时，只【追加】快照里没有的账本行
     （2.105 起按 mid 优先去重），不覆盖、不删除快照已有的行。 */
  const snapTail = String((snapP[snapP.length - 1] || [])[5] || '');
  const ledTail  = String((ledP[ledP.length - 1] || [])[2] || '');
  if (snapTail && ledTail && ledTail > snapTail){
    /* 2.105（②·老板 2026-10-20：A 组 0001 网页端比原版多 1 行）：「角色+正文指纹(前24字)」
       在正文被截断/微改时对不上 ⇒ 同一 AI 终答被重复追加。改为【按 mid（index6）优先去重、
       _msgKey 兜底】——mid 是消息唯一身份，命中即视为已有（绝不产生重复行）；仍只【追加】、
       绝不删除/覆盖快照已有行；追加过程中同批账本行也据同一集合互相去重。 */
    const haveMid = new Set(), haveKey = new Set();
    for (const m of out){
      const id = String((m && m[6]) || '');
      if (id) haveMid.add(id);
      haveKey.add(_msgKey(m));
    }
    const add = [];
    for (const m of ledP){
      if (!(String(m[2] || '') > snapTail)) continue;
      const id = String((m && m[6]) || '');
      if ((id && haveMid.has(id)) || haveKey.has(_msgKey(m))) continue;
      if (id) haveMid.add(id);
      haveKey.add(_msgKey(m));
      add.push(m);
    }
    if (add.length) out = out.concat(add);
  }
  /* 2.103（老板 2026-10-20 13:36）：网页端不得自行决定顺序——一律按系统 ID（mid）
     的时间升序排。2.112（X2-1/X2-3）：改为**严格全序**——无 mid 的行统一置顶并标
     「时间未知」（见 orderMsgs），绝不让它抢「最新」的位置。仍只【追加】、不删行。 */
  return orderMsgs(out);
}

/* ========== 1.90：文本转语音小卡片 ========== */
/* 识别标志：(@fox-play1) 开头、(@fox-play2) 结尾。收尾判定见 卡片TTS.js——
   头标之后依次找收尾边界：① 下一个完整头标 ⇒ 当前卡截断并另起新卡；
   ② 后缀前三字符 `(@f` ⇒ 合法收尾；③ 整段再无 `(@f` ⇒ 第一个空行断句收尾；
   ④ 连空行都没有 ⇒ 不识别为卡片、当普通正文显示。
   命中段从消息正文里摘出 → 语音卡片（上行「文字 + ▶」、下行「阶段通知」），
   data-seg 存完整文本供播放。 */

/* ==================== 本专项 B 组：快照落地 IndexedDB ====================
   用户口径（R6/D4/D8/D9/P10/P11）：网页端「快照」（锚定会话正文帧）一律落
   IndexedDB；每 5 秒节流落地、超一周剪枝、换版本清空；localStorage 只留
   长期固定项与账本历史 LS_HIST（快照绝不进 localStorage）。
   秒显：点会话先读本地存帧立刻铺上，并出「正在获取直播帧」小条，
   直到当前锚定会话的真直播帧到达才撤。IDB 打不开则静默降级，绝不阻断主流程。 */
const IDB_NAME = 'trae_webm_idb', IDB_VER = 1;
const IDB_KEEP_MS = 10 * 24 * 3600 * 1000;  /* 2.98：超 10 天剪枝（标准《快照缓存策略》§五，原 7 天） */
const WEB_ROUNDS_KEEP = 3;               /* 2.59：单帧/本地历史只留最近 3 轮（用户 2026-10-07）；原为尾部 40 条 */
const IDB_PRUNE_MAX = 200;                  /* 单轮最多删 200 条，防长任务卡主线程 */
/* 2.112（插队·老板 21:35「明明有快照却白屏」）：落盘节流/指纹【按会话】记忆——
   原全局单值 _idbLastAt/_idbLastFp 会让「刚切到的 B」被「刚看过的 A」的指纹
   误判为「无变化」而漏落盘。 */
let _idbP = null;
const _idbLastAtBy = {}, _idbLastFpBy = {};
/* 2.112：内存里每个会话最近一份存帧（键＝cacheKey|sid）——点会话即同步上屏（0ms），
   再异步读 IDB 校正；这才是「明明有快照就必须立刻拿出来给我看」。 */
const _frameMem = {};
function _frameMemKey(sid){ return cacheKeyNow() + '|' + sid; }
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
function _idbFrame(){
  const s = S.snap || {};
  return {online: !!s.online, login: s.login,
          msgs: (Array.isArray(s.msgs) ? keepLastRounds(s.msgs) : []),
          finish: s.finish || null, tail: s.tail || '', sendIdle: s.sendIdle,
          inputText: s.inputText || '', opts: s.opts || [],
          ask: s.ask || null, pend: s.pend || [], attach: s.attach || [],
          model: s.model || ''};
}
/* 2.98（标准《快照缓存策略》§二/二之一）：落盘＝「两次落盘最小间隔 10 秒」的
   节流（不是固定周期到点才落）——只要「上次落盘已超 10 秒」且有完整快照即可落。
   调用点：每 10 秒轮询一拍 ＋ 新快照到达即触发（事件总线.js 快照分支）＋ 关键动作
   强制（liveClear／切走）。
   2.100（老板 2026-10-20 12:14 口径，追加）：切换／掉线重新登录后的【首份完整快照】
   到达即【立即落盘一次】（不受 10 秒节流——「这么新的东西不落盘？」）；其后才回到
   「≥ 10 秒、且有更新才落盘」。 */
function snapIdbTick(force){
  /* 2.57B：切换在途——此刻 S.snap 正文仍属旧会话 A，绝不能在锚定已指向 B 时
     把它当 B 的存帧落地（否则会把 A 的内容毒化成 B 的缓存）。 */
  if (S.livePend) return;
  /* 2.91（老板夜间令 A3）：网页端自己发起的切换、目标正文尚未到达时，
     S.snap 正文仍属旧会话——直接 return，防「旧正文被当作目标会话存帧
     写进 IDB」污染「切回秒显」。 */
  if (S.switch_pend && S.switch_pend.lockTarget
      && !S.switch_pend.arrived) return;
  /* 存帧自检闸（切会话/归还）：过渡期「锁死目标会话」（含 2.93 情形——arrived 已置
     真、但撤锁当下 S.snap 正文仍属切换前旧会话）时，S.snap 正文不属锚定会话，
     绝不把它当锚定会话的存帧写进 IDB、污染「切回秒显」。判据与 _liveLockOn 同源头。 */
  if (typeof _liveLockOn === 'function' && _liveLockOn()) return;
  const s = S.snap || {};
  if (!Array.isArray(s.convs) || !s.convs.length) return;   /* 还没快照 */
  const sid = (S.anchorSid || curSid() || '');
  if (!sid) return;
  const now = Date.now();
  /* 2.100（老板 12:14）：① 旗标 S.idbFirstFull＝切换/重连后首份完整快照 ⇒ 立即落
     （不受节流；上面几道闸已保证本拍正文属当前锚定会话、不是脏帧）；
     ② force=true（liveClear 真帧到手／切走）同样立即落；
     ③ 其后 ⇒ 「该会话 ≥ 10 秒 且 有更新（指纹变化）才落盘」。 */
  const _sk = _frameMemKey(sid);
  const _full = !!(s.msgs && s.msgs.length);
  const _first = !!S.idbFirstFull && _full;
  if (force !== true && !_first && now - (_idbLastAtBy[_sk] || 0) < 10000) return;
  const frame = _idbFrame();
  const _fp = msgsFp(frame.msgs);
  if (force !== true && !_first && _fp === _idbLastFpBy[_sk]) return;   /* 有更新才落盘 */
  if (_first) S.idbFirstFull = 0;
  _idbLastAtBy[_sk] = now; _idbLastFpBy[_sk] = _fp;
  _frameMem[_sk] = frame;               /* 2.112：内存帧同步可用（切回秒显） */
  const key = cacheKeyNow();
  /* 2.112（插队·老板 21:35 + 09:43 原话「不管多少份，永远只有一份…快照只求新」）：
     **按会话各存一份、同一会话覆盖**（键 `key|sid`，不再 st.clear() 全库只留一个）——
     原 2.106 的「全局单份」是对「每会话只留最新一份」的误读，导致切到别的会话必然
     查不到存帧 ⇒ 白屏。顺带清掉旧的错误单份键 `key|@snap`（一次性迁移）。 */
  _idbReq('snap_conv', 'readwrite', st => {
    st.delete(key + '|@snap');
    st.put({sk: _sk, key: key, port: S.port, sid: sid,
            title: curTitle(), ts: now, frame: frame});
    return null;
  }).catch(() => {});
  _idbReq('snap_list', 'readwrite', st => st.put(
    {sk: key, key: key, ts: now, convs: s.convs,
     conv_unread: s.conv_unread || [], conv_unread_ids: s.conv_unread_ids || []}
  )).catch(() => {});
}
function _idbGetByTitle(key, t){
  /* 2.105/2.112：按标题反查兜底（改名/非数字 SID 不丢存帧）；同标题取 ts 最新一条。 */
  return idbOpen().then(db => new Promise(res => {
    const tx = db.transaction('snap_conv', 'readonly');
    const rq = tx.objectStore('snap_conv').openCursor();
    let hit = null;
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c) return;
      const v = c.value || {};
      if (v.key === key && String(v.title || '').trim() === t
          && (!hit || (v.ts || 0) > (hit.ts || 0))) hit = v;
      c.continue();
    };
    tx.oncomplete = () => res(hit);
    tx.onerror = () => res(null);
    tx.onabort = () => res(null);
  })).catch(() => null);
}
function snapIdbGet(sid, title){
  /* 2.112（插队·老板 21:35）：恢复「按会话各存一份」——按 `key|sid` 取该会话自己的
     最新存帧（同会话覆盖，天然只留一份）；取不到再按 title 反查兜底。
     只有确属目标会话才返回；否则 ⇒ null（调用方留白等待，绝不回填旧会话）。 */
  if (!sid) return Promise.reject(new Error('无 sid'));
  const key = cacheKeyNow();
  const t = String(title || '').trim();
  return _idbReq('snap_conv', 'readonly', st => st.get(key + '|' + sid))
    .then(rec => {
      if (rec && (!rec.sid || String(rec.sid) === String(sid))) return rec;
      if (!t) return null;
      return _idbGetByTitle(key, t);
    }, () => null);
}
function snapIdbListGet(){
  return _idbReq('snap_list', 'readonly', st => st.get(cacheKeyNow()));
}
/* 剪枝①：超 10 天的记录按主键逐个删（绝不整库清空），单轮上限 IDB_PRUNE_MAX */
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
/* 剪枝②（2.98·标准《快照缓存策略》§五/§六）：会话不存在则清理——先取【当前会话
   列表】，列表【为空/取不到 ⇒ 本轮直接跳过】（防呆·硬要求：网络未加载出来时绝不
   全删）；有列表才删「不在列表内」的会话存帧，单轮上限 IDB_PRUNE_MAX。
   匹配口径：存帧记录按 sid/标题 归属，只要其 sid（终身号或完整 sid）或标题命中
   当前列表即视为存在（宁留勿误删）。 */
function snapIdbPruneMissing(){
  const s = S.snap || {};
  const convs = Array.isArray(s.convs) ? s.convs : [];
  const keep = new Set();
  for (const r of convs){
    if (!r || r[0] !== 'c') continue;
    if (r[1]) keep.add(String(r[1]));                 /* 会话标题 */
    if (r[4]) keep.add(String(r[4]));                 /* 完整 SID */
    const k = 稳定键(r[4], r[1]); if (k) keep.add(k);  /* 稳定性键＝终身号 */
  }
  if (!keep.size) return;                             /* 防呆：列表空/取不到 ⇒ 全部保留 */
  const key = cacheKeyNow();
  let n = 0;
  return _idbReq('snap_conv', 'readwrite', st => {
    const rq = st.openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c || n >= IDB_PRUNE_MAX) return;
      const rec = c.value || {};
      const gone = rec.key === key
          && !keep.has(String(rec.sid || ''))
          && !keep.has(String(rec.title || ''));
      if (gone){ c.delete(); n++; }
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
/* 2.89（老板 2026-10-20）：切换过渡期是否「锁死目标会话」——一旦网页端自己发起
   切到 B，正文一律以 B 的帧为准（B 的帧优先，快照里仍是 A 的正文不得上屏），直到
   切换成功、或失败（2.98：失败也【继续锚定 B】、不回退 A）。条件：livePend 置位中，或网页端自己发起的
   切换在途且目标正文尚未到达（switch_pend.lockTarget && !arrived）。非过渡期不锁。
   2.93（老板 2026-10-20 07:09）：再加一道缓存层护栏——即便 arrived 已被置真，
   只要撤锁当下 S.snap 正文【仍属切换前旧会话 A】，就继续锁死目标（不上屏 A 的
   缓存），等 B 的真帧到达（S.snap 换会话）再放行。 */
function _liveLockOn(){
  if (S.livePend) return true;
  const sp = S.switch_pend;
  if (!sp || !sp.lockTarget) return false;
  if (!sp.arrived) return true;
  if (Array.isArray(sp.prevMsgs)
      && sameConvBody((S.snap || {}).msgs, sp.prevMsgs)) return true;
  return false;
}
/* 2.57B：切换在途的展示视图（用户 2026-10-07）——已点目标 B、真直播帧尚未
   到达：正文/选项/占位/输入框/附件/模型一律取「B 的本地存帧」，没有存帧
   就留空；绝不回落到服务器快照（那是旧会话 A 的内容，会造成张冠李戴）。
   2.89：过渡期锁死目标会话（见 _liveLockOn）一并纳入闸门。
   非切换期原样返回快照。 */
function liveOverlay(snap){
  if (!_liveLockOn()) return snap;
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
  /* 2.112（插队·老板 21:35「明明有快照却白屏/不先给我看」）：内存里已有该会话最近
     存帧 ⇒ **同步立刻上屏**（同一次点击任务内完成，浏览器根本来不及画出白屏），
     再异步读 IDB 校正；内存没有才等 IDB 那一次异步读取（极短暂白）。 */
  const _mk = _frameMemKey(sid);
  const _mem = _frameMem[_mk] || null;
  if (_mem && Array.isArray(_mem.msgs) && _mem.msgs.length){
    S.liveFrame = _mem;
    S.swFrameReady = true;                      /* 存帧已上屏（读取闸视为已结） */
    renderAll();
  }
  snapIdbGet(sid, title).then(rec => {
    S.swFrameReady = true;                      /* 2.97：存帧读取已结（有/无皆算结） */
    if (rec && rec.frame) _frameMem[_mk] = rec.frame;   /* 校正内存帧 */
    if (S.liveGot) return;                      /* 直播帧已到，别用旧帧盖真画面 */
    if ((S.anchorSid || '') !== sid) return;    /* 已切走 */
    if (S.livePrefetch) return;                 /* 2.67：服务端已预取该会话正文帧，别用本地存帧覆盖 */
    if (_mem) return;                           /* 2.112：内存帧已上屏（且更新），不拿 IDB 旧帧回盖 */
    S.liveFrame = (rec && rec.frame) || null;   /* 有存帧 → 一次性上屏 */
    renderAll();
  }).catch(() => {
    /* 读取失败也要铺一次，免卡在上一会话画面 */
    S.swFrameReady = true;                      /* 2.97：读取失败也算「结」→ 无存帧则留白（2.57B） */
    if (!S.liveGot && (S.anchorSid || '') === sid) renderAll();
  });
}
/* 2.113：非锚定会话的按需帧（snap_pane）→ 存为该会话的内存存帧＋按会话键落 IDB。
   键与 2.112 完全一致（`cacheKey|稳定键`，snapIdbTick/snapIdbShow 同源），点该会话时
   同步命中 `_frameMem` 即秒显；**绝不碰 S.snap / 当前屏幕**（非目标不打扰），也不动
   落盘节流账（按会话各自记账）。 */
function paneFrameStore(sid, title, v){
  try{
    if (!sid || !v || !Array.isArray(v.msgs)) return false;
    const _sid = 稳定键(sid, title || '') || String(sid);
    const _sk = _frameMemKey(_sid), key = cacheKeyNow(), now = Date.now();
    const frame = {online: !!(S.snap && S.snap.online),
                   login: (S.snap && S.snap.login),
                   msgs: keepLastRounds(v.msgs),
                   finish: v.finish || null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [],
                   attach: [], model: ''};
    _frameMem[_sk] = frame;                 /* 内存帧：切过去 0ms 同步上屏 */
    _idbLastAtBy[_sk] = now; _idbLastFpBy[_sk] = msgsFp(frame.msgs);
    _idbReq('snap_conv', 'readwrite', st => st.put(
      {sk: _sk, key: key, port: S.port, sid: _sid,
       title: title || '', ts: now, frame: frame})).catch(() => {});
    return true;
  }catch(e){ return false; }
}
/* 直播帧到达（专属于当前锚定会话）→ 撤条并停用本地帧 */
function liveClear(){
  S.livePend = ''; S.liveGot = true; S.liveFrame = null;   /* 2.57B：真帧到手撤存帧 */
  S.livePrefetch = false;                                  /* 2.67：预取标记一并清 */
  liveHide();
  snapIdbTick(true);                           /* 真画面到手，立刻落地一帧 */
}
/* 2.98（标准《快照缓存策略》附录A「刷新/首屏也应立刻顶出最新缓存」）：首屏/刷新在
   骨架秒显后，立刻读「当前会话」的 IDB 最新存帧顶出（走 snapIdbShow 同一入口），
   替代更旧的账本残行。当前会话＝骨架（或快照）列表里被选中那行，无选中则第一行
   会话；列表取不到 ⇒ 不动作（保 2.57B「无缓存即空白」语义）。 */
function snapIdbBoot(sk){
  try{
    if (S.livePend || S.liveGot || S.livePrefetch) return;
    const convs = (sk && sk.convs) || (S.snap && S.snap.convs) || [];
    let sel = null;
    for (const r of convs){
      if (!r || r[0] !== 'c') continue;
      if (!sel) sel = r;
      if (r[2]){ sel = r; break; }
    }
    if (!sel || !sel[4]) return;
    const key = 稳定键(sel[4], sel[1]);
    if (!key) return;
    /* 首屏无锚定：先锚定到上次看的会话（跨刷新续锚，与「网页版锚定自己选的会话」同源） */
    if (!S.anchorSid){
      S.anchorSid = key; S.anchorTitle = sel[1] || ''; S.anchorFull = sel[4] || '';
    }
    snapIdbShow(key, sel[1]);
  }catch(e){}
}
setInterval(() => snapIdbTick(), 10000);                       /* 2.98：10 秒节流（原 5 秒） */
setInterval(() => { snapIdbPrune(); snapIdbPruneMissing(); }, 10 * 60 * 1000);
