'use strict';
const LS_SKEL = 'trae_webm_skel';        /* 骨架缓存（会话列表） */
let cacheKey = null, reqSeq = 0, skelLastSave = 0;
const S_reqs = {};                       /* id → {conv, ts}（防过期回包） */
function cacheKeyNow(){ return VER + '|' + (S.srvVer || '0'); }
/* 2.174（固态化失效根因修复·老板 23:1x 实测打脸）：cacheKeyNow 含 S.srvVer——
   在线时 hello 带真实服务端版本（如 '2.173|3.66'）落盘；断网冷开 hello 不来
   ⇒ S.srvVer 保持 '0' ⇒ key='2.173|0' 与落盘必不匹配 ⇒ skel/solid/hist
   【全部读不出】＝「完全没固态化」的真凶。修复三板斧：
   ①srvVer 持久化（写侧 onHello 存、boot 恢复）——让冷开 key 尽量对上；
   ②读取端宽松化（本函数三个读口）——键存在且 JSON 可解析即读，字段级容错
     本就有（solidBoot/skels 各段 try）；防旧格式毒化职责保留在【写侧】：
     在线时 checkVerBump 照常清旧缓存重写（格式永远新鲜），断网则宽松读旧
     （保证打开即活）。多服务端切换无串显风险：三键本就只存最后在线那台的
     快照级数据，在线切换照常覆盖。 */
const LS_SRVVER = 'trae_webm_srvver';      /* 上次在线时的服务端版本号（冷开 key 恢复用） */
function srvVerRestore(){
  try {
    const v = localStorage.getItem(LS_SRVVER);
    if (v && !S.srvVer || S.srvVer === '0'){ S.srvVer = v; }
  } catch(e){}
}
function srvVerPersist(){
  try { localStorage.setItem(LS_SRVVER, String(S.srvVer || '0')); } catch(e){}
}
function skelCacheLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_SKEL) || 'null');
    if (!o) return null;                    /* 2.174：宽松读（断网冷开 key 对不上也要活） */
    return o;
  } catch(e){ return null; }
}
function checkVerBump(){
  /* 首次定键 / 版本变化 → 清空本地骨架与历史缓存（改版重下）。
     本专项 B1：换代同时清 IndexedDB 快照表，并清掉 LS 里明确属快照类的键
     （快照绝不进 localStorage；LS_HIST 属账本历史，上面已按需清）。 */
  const k = cacheKeyNow();
  const bumped = cacheKey !== null && cacheKey !== k;
  if (bumped){
    try { localStorage.removeItem(LS_SKEL);
          localStorage.removeItem('trae_webm_hist');   /* 2026-11-24：LS_HIST 常量已删，仍清旧键 */ } catch(e){}
    try { snapIdbClearList(); } catch(e){}   /* 2.17：只清列表骨架，预备画面保留 */
    _lsPurgeSnapKeys();
    S.histConv = ''; S.histRaw = []; S.histPrevRaw = [];
    /* 2.130：换代 → 内存存帧一并作废，再按新键重新全量预读 */
    try {
      Object.keys(_frameMem).forEach(x => { delete _frameMem[x]; });
      Object.keys(_frameMemByTitle).forEach(x => { delete _frameMemByTitle[x]; });
      _prewarmKey = '';
    } catch(e){}
  }
  cacheKey = k;
  /* 2.130：缓存键定了（首次 hello 带 srvVer）→ 全部会话存帧预读进内存 */
  try {
    if (bumped) snapIdbClearList().then(() => snapIdbPrewarm(k));
    else snapIdbPrewarm(k);
  } catch(e){}
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
/* —— 2.232：按服务器分区的固态包（切服务器立刻还原，不再纯空白）——
   老板 2026-11-20 23:06：换服务器来回切，列表整片空白，违反固态化原则。
   键＝S.box|S.port（与会话列表.js 的 _cvServerKey 同源）；每台服务器各存一份
   列表/未读/锚定/六模块最后已知值。切换时先还原这份，服务端快照到了照常覆盖
   （错后报，绝不拦截操作）。最多留 6 台，LRU 淘汰。 */
const LS_SRV_PACK = 'trae_webm_srvpack';
let srvPackLastSave = 0;
function srvPackKey(box, port){
  const b = (box != null) ? box : S.box;
  const p = (port != null) ? port : S.port;
  /* 2.242（老板 2026-11-21 02:20 切服列表不跟随）：键里加服务器名。
     两台电脑的 TRAE 窗口名/调试端口常常一模一样（同为 9599），旧键 box|port
     会撞车——切到 B 却还原出 A 的列表。 */
  return String(S.cur || '') + '|' + String(b || '') + '|' + String(p || '');
}
function _srvPacksRead(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_SRV_PACK) || 'null');
    return (o && typeof o === 'object') ? o : {};
  } catch(e){ return {}; }
}
function srvPackSave(){
  const now = Date.now();
  if (now - srvPackLastSave < 2000) return;
  srvPackLastSave = now;
  try {
    const s = S.snap || {};
    if (!Array.isArray(s.convs) || !s.convs.length) return;   /* 没列表不写，防空白毒化 */
    const k = srvPackKey();
    const all = _srvPacksRead();
    all[k] = {ts: now,
              convs: s.convs, conv_unread: s.conv_unread || [],
              conv_unread_ids: s.conv_unread_ids || [],
              anchor: S.anchorSid ? {sid: S.anchorSid, title: S.anchorTitle || '',
                                     full: S.anchorFull || ''} : null,
              solid: {备注: S.备注 || {}, 定时: S.定时 || [],
                      models_full: S.models_full || [], boxes: S.boxes || [],
                      acct: S.acct || '', model: (s.model || '')}};
    const ks = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0));
    ks.slice(6).forEach(x => { delete all[x]; });
    localStorage.setItem(LS_SRV_PACK, JSON.stringify(all));
  } catch(e){}
}
function srvPackRestore(box, port){
  try {
    const _all = _srvPacksRead();
    /* 2.242：新键（带服务器名）没有时回退读旧键（box|port），只为减少切换瞬间
       的空白；新服首帧一到即整份覆盖（见 通用工具.js _convsSolidGuard 2.242），
       不会像旧版那样把旧服列表永久钉在屏幕上。 */
    const p = _all[srvPackKey(box, port)]
           || _all[String(box || '') + '|' + String(port || '')];
    if (!p) return false;
    if (!S.snap || typeof S.snap !== 'object') S.snap = {};
    if (Array.isArray(p.convs) && p.convs.length){
      S.snap.convs = p.convs;
      S.snap.conv_unread = p.conv_unread || [];
      S.snap.conv_unread_ids = p.conv_unread_ids || [];
      S.convs_key = null;                       /* 强制重画列表 */
    }
    const d = p.solid || {};
    try { if (d.备注 && typeof d.备注 === 'object') S.备注 = d.备注; } catch(e){}
    try { if (Array.isArray(d.定时) && d.定时.length) S.定时 = d.定时; } catch(e){}
    try { if (Array.isArray(d.models_full) && d.models_full.length){
            S.models_full = d.models_full;
            if (typeof rebuildModelOptions === 'function') rebuildModelOptions();
            if (typeof checkFavInvalid === 'function') checkFavInvalid(); } } catch(e){}
    try { if (Array.isArray(d.boxes) && d.boxes.length){
            S.boxes = d.boxes.filter(Boolean);
            el.box.innerHTML = '';
            S.boxes.forEach(b => { const o = document.createElement('option');
              o.value = b; o.textContent = b; el.box.appendChild(o); });
            el.box.value = box; } } catch(e){}
    try { if (d.acct){ S.acct = String(d.acct); renderAcct(); } } catch(e){}
    try { if (d.model && typeof syncModel === 'function'){ syncModel(d.model);
            if (S.snap) S.snap.model = d.model; } } catch(e){}
    /* 锚定：切回这台服务器＝回到它上次看的会话，立刻用该会话存帧铺满 */
    if (p.anchor && p.anchor.sid){
      S.anchorSid = p.anchor.sid; S.anchorTitle = p.anchor.title || '';
      S.anchorFull = p.anchor.full || '';
    }
    if (el.msgs) el.msgs.innerHTML = '';
    renderAll();
    if (S.anchorSid && typeof snapIdbShow === 'function') snapIdbShow(S.anchorSid, S.anchorTitle);
    return true;
  } catch(e){ return false; }
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
  srvPackSave();                              /* 2.232：顺带写按服务器分区的固态包 */
}
/* （2.174：旧严格版 skelCacheLoad 已并入文件头部的宽松版——key 校验移除） */
/* —— 固态兜底（2.173「打开即活」，老板 2026-11-18 亲批最核心灵魂）——
   盘点结论：会话列表（LS_SKEL）/对话内容（IDB snap_conv 预读秒显）/多电脑名册
   （loadSrvs）已固态；但【备注/定时消息/模型列表/沙盒分身下拉/登录账号/排队条】
   六类打开时是空的，全等服务端帧才渲染（软塌塌启动）。本层把最后已知值落盘，
   打开瞬间同步恢复上屏，后台对账到达后照常覆盖——错后报：基于过期数据操作
   照走既有服务端权威对账，绝不加启动期校验拖延可用时间。 */
const LS_SOLID = 'trae_webm_solid';        /* 固态兜底（六模块最后已知值） */
let solidLastSave = 0;
function solidSave(){
  /* 从 S 全量提取，幂等；2 秒节流。调用点＝renderAll 末尾 + onHello + models 帧。 */
  const now = Date.now();
  if (now - solidLastSave < 2000) return;
  solidLastSave = now;
  try {
    const o = {key: cacheKeyNow(), ts: now,
               备注: S.备注 || {},
               定时: S.定时 || [],
               models_full: S.models_full || [],
               boxes: S.boxes || [],
               acct: S.acct || '',
               model: (S.snap && S.snap.model) || '',
               pend: (S.snap && Array.isArray(S.snap.pend)) ? S.snap.pend : [],
               pend_sid: (S.snap && S.snap.pend_sid) || ''};
    localStorage.setItem(LS_SOLID, JSON.stringify(o));
  } catch(e){}
  srvPackSave();                              /* 2.232：六模块也按服务器分区存一份 */
}
function solidLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_SOLID) || 'null');
    if (!o) return null;                    /* 2.174：宽松读（同 skelCacheLoad 口径） */
    return o;
  } catch(e){ return null; }
}
function solidBoot(){
  /* 打开瞬间同步恢复（零等待）：S 全局状态 + 各下拉/账号行；排队条恢复进
     S.snap.pend（条目项级 sid 过滤与 N4 归属判定天然生效，非本会话条不显示）。
     之后任何服务端帧到达照常覆盖（对账），恢复值绝不拦截任何操作（错后报）。 */
  const d = solidLoad();
  if (!d) return;
  try { S.备注 = (d.备注 && typeof d.备注 === 'object') ? d.备注 : {}; } catch(e){}
  try { if (Array.isArray(d.定时)) S.定时 = d.定时; } catch(e){}
  try {
    if (Array.isArray(d.models_full) && d.models_full.length){
      S.models_full = d.models_full;
      if (typeof rebuildModelOptions === 'function') rebuildModelOptions();
      if (typeof checkFavInvalid === 'function') checkFavInvalid();
    }
  } catch(e){}
  try {
    if (Array.isArray(d.boxes) && d.boxes.length && !S.boxes.length){
      S.boxes = d.boxes.filter(Boolean);
      el.box.innerHTML = '';
      S.boxes.forEach(b => {
        const o = document.createElement('option');
        o.value = b; o.textContent = b;
        el.box.appendChild(o);
      });
    }
  } catch(e){}
  try { if (d.acct){ S.acct = String(d.acct); renderAcct(); } } catch(e){}
  try { if (d.model && typeof syncModel === 'function') syncModel(d.model); } catch(e){}
  try {
    if (Array.isArray(d.pend) && d.pend.length){
      if (!S.snap || typeof S.snap !== 'object') S.snap = {};
      if (!S.snap.pend) { S.snap.pend = d.pend; S.snap.pend_sid = d.pend_sid || ''; }
    }
    /* 2.173：最后已知模型值灌进 S.snap.model——否则 renderState 读
       snap.model 空 → syncModel('') 插「（模型未知）」占位盖掉恢复值。 */
    if (d.model && (!S.snap.model)) S.snap.model = d.model;
  } catch(e){}
  /* 骨架灌入 S.snap：冷开 S.snap={} 时 renderAll→renderConvs([]) 会把
     boot 已铺的骨架列表清空（断网等不到快照一直空）——把 LS_SKEL 的
     convs/未读灌入，保证「打开即活」列表常驻（快照到达后照常覆盖）。 */
  try {
    const sk = (typeof skelCacheLoad === 'function') ? skelCacheLoad() : null;
    if (sk && Array.isArray(sk.convs) && sk.convs.length){
      if (!S.snap || typeof S.snap !== 'object') S.snap = {};
      if (!Array.isArray(S.snap.convs) || !S.snap.convs.length){
        S.snap.convs = sk.convs;
        S.snap.conv_unread = sk.conv_unread || [];
        S.snap.conv_unread_ids = sk.conv_unread_ids || [];
      }
    }
  } catch(e){}
}
/* 2.59 的「只留最近 3 轮」口径已于 2.126 全部删除（老板 2026-10-23）。 */
/* 2.126（老板 2026-10-23 08:22「三轮给我删掉，只保留一份最新、完整、只进不退」）：
   删除「只留最近 3 轮」的全部逻辑（原 2.59／用户 2026-10-07 口径作废）——
   快照与本地账本一律**整帧原样**，不再由网页端裁剪。 */
/* —— 历史缓存：按 (端口|会话标题) 存账本记录 + 游标 —— */
function ledToArr(r){
  /* 2.105（②）：账本行补 index6＝mid（原始记录自带 mid；index5 留空＝无服务端盖章），
     供 curMsgs 尾部追加「按 mid 优先去重」。
     2.206：账本读回的时间不再信任 r.tm／服务端字段，一律由 mid 重新推导。 */
  const _mid = r.mid || '';
  return [r.role === 'u' ? 'u' : 'a', r.text || '',
          (typeof timeFromMid === 'function' ? timeFromMid(_mid) : ''),
          r.can_rev ? 1 : 0, r.can_del ? 1 : 0, '', _mid];
}
/* 2.129：上顶翻页的起始游标＝**当前真正显示在屏幕上的最老一条**的账本 seq。
   旧口径直接用 S.histRaw[0].seq——但 hist 首次 rebuild 会把整段账本塞进 histRaw
   （远老于屏幕窗口），拿它当游标 ⇒ 服务端只回「比整段还老」的行（通常没有），
   表现为「上顶没反应 / 直接说已是最早」。 */
function _histFromSeq(){
  if (S.histPrevRaw && S.histPrevRaw.length) return S.histPrevRaw[0].seq;
  const raw = S.histRaw || [];
  if (!raw.length) return 0;
  const sm = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : [];
  if (sm.length){
    const keys = new Set(sm.map(m => _msgKey(m)));
    let best = 0;
    for (const r of raw){
      if (!keys.has(_msgKey(ledToArr(r)))) continue;
      if (!best || r.seq < best) best = r.seq;
    }
    if (best) return best;
  }
  return raw[0].seq;                 /* 匹配不上（账本与快照不同窗）：退回账本最老 */
}
/* —— 请求式历史 —— */
/* 2.125（老板 2026-10-22 21:21）：给服务端同时送「终身号 + 会话名」——服务端
   优先按终身号匹配账本（账本自 v2.55 起只按终身号记），匹配不上再退会话名。 */
function _ltOf(conv){
  /* 2.261：hist/hist_prev 的 lt 以唯一锚定键为准 */
  try { return S.anchorSid || 稳定键(curSid(), conv || ''); } catch(e){ return ''; }
}
function reqHist(conv, have_seq, ver){
  const id = ++reqSeq;
  S_reqs[id] = {conv: conv || '', ts: Date.now()};
  sendJson({t: 'req', id: id, c: 'hist', conv: conv || '',
            lt: _ltOf(conv),
            have_seq: have_seq | 0, ver: ver | 0});
}
function reqHistPrev(conv, from_seq, count){
  const id = ++reqSeq;
  S_reqs[id] = {conv: conv || '', ts: Date.now()};
  sendJson({t: 'req', id: id, c: 'hist_prev', conv: conv || '',
            lt: _ltOf(conv),
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
    S.histRaw = inc.slice();                   /* 2.126：整段原样，不再裁 3 轮 */
    S.histVer = v.ver | 0;
  } else {                                     /* 游标增量：只补新段 */
    if (!Array.isArray(S.histRaw)) S.histRaw = [];
    for (const r of inc){
      if (S.histRaw.some(x => x.seq === r.seq)) continue;
      S.histRaw.push(r);
    }
    S.histVer = v.ver | 0;
  }
  S.histHave = S.histRaw.length
    ? S.histRaw[S.histRaw.length - 1].seq : 0;
  /* 2.263：hist 只回最新 N 轮（v.msgs 原样合并去重）。
     has_more===false 即到底；字段缺失保持旧逻辑，不报错。 */
  if (v.has_more === false) S.histEnd = true;
  else if (v.has_more === true) S.histEnd = false;
  /* 2.126：整段原样保留，不再裁 3 轮。
     3.00：不再写本地账本副本（LS_HIST 已废）。
     2.264（老板 2026-11-24）：拉回来的历史能进前 N 轮就并入小账本——地位等同核对账本，
     走 lbHistToLedger 同一条 _frameCommit 通道（older=false＝增量新段）。 */
  try { if (typeof lbHistToLedger === 'function') lbHistToLedger(false); } catch(e){}
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
  const _add = older.filter(r => !_have.has(r.seq));
  S.histRaw = _add.concat(S.histRaw || []);
  /* 2.129（老板 2026-10-24「上顶加载历史现在不通」）：另记一份「用户显式翻出来的
     更早页」。curMsgs 2.104 起正文只以快照为骨架、账本只补尾部之后 ⇒ 翻页回包虽
     已并入 histRaw，却永远不上屏。这里单独留存，由 curMsgs 只把这一段前置。
     ★ 即使这 4 条早已在 histRaw 里（首次 rebuild 把整段账本塞进来）也要收进
     histPrevRaw——否则翻页「成功」但一条也出不来；只按 histPrevRaw 自身去重。 */
  if (!Array.isArray(S.histPrevRaw)) S.histPrevRaw = [];
  const _haveP = new Set(S.histPrevRaw.map(x => x.seq));
  const _addP = older.filter(r => !_haveP.has(r.seq));
  S.histPrevRaw = _addP.concat(S.histPrevRaw);
  /* 3.00：不再写本地账本副本（LS_HIST 已废）
     2.264（老板 2026-11-24）：上顶翻出来的更早一页也一样——能进前 N 轮就并进小账本
     （older=true＝更早段，排在账本前面）。 */
  try { if (typeof lbHistToLedger === 'function') lbHistToLedger(true); } catch(e){}
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
  /* 2.261：histConv 存唯一锚定键（anchorSid），hist/hist_prev 均以锚定为准 */
  const key = S.anchorSid || 稳定键(curSid(), curTitle());
  if (!key || key === S.histConv) return;
  S.histConv = key;
  S.histRaw = []; S.histPrevRaw = []; S.histVer = 0; S.histHave = 0;
  S.histLoadingPrev = false;
  S.histEnd = false; S.histPullFrom = 0;   /* 2.49：换会话重置到底标记/游标 */
  /* 3.00（老板 2026-11-05 23:10）：正文只认「快照 + 预备画面」——
     不再读本地账本副本（LS_HIST 已废），也不再拿账本秒显。
     这里只发一次 hist 请求取「账本游标(seq)」，供用户上顶时翻更早页。
     （不发渲染、不落盘；快照到位前由预备画面顶住。） */
  reqHist(key, 0, 0);
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
   ② 无真时间的行（含 temp-agent 临时号、pane/非选中会话缺 mid、账本缺号）：
      **一律置顶**，保持其相互间的原相对次序；
   ③ ⇒ 任何输入序列都得到确定的全序，无真时间行永远抢不到「最新」位置（原 2.103 的
      「有 mid 按时间、无 mid 保持原位」不是全序，正是「老记录跑到最新位」的根因）。 */
/* ② 无真时间的行：一律置顶，保持原相对次序；
   2.204（B4）：不再往 m[7] 写「时间未知」标记——m[7] 是 AI 完成卡摘要，
   写 1 会污染完成态/上报指纹；渲染层已改为「有真时间就显示，没有就留空」。 */
function _markNoMid(m){
  return m;
}
function orderMsgs(list){
  /* 2.213（前端零拦截）：顺序完全按后端下发——不排序、不剔除、不挪位。
     无有效 mid 的行原位保留（只是该行不显示时间）；同 mid 重复也不重排。 */
  try {
    return Array.isArray(list) ? list : [];
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
/* 2026-11-24（老板令·只认小账本）：原 _curLocalFrameMsgs / _mergeLocalSnap
   （本地存帧铺底、标题兜底、与活帧合并）整段删除——屏幕正文只从账本 rounds 出。 */
function curMsgs(){
  /* 3.00（老板 2026-11-05 23:10）：正文唯一来源＝
     ① 服务端真快照（S.snap.msgs，内存，不落盘）；
     ② 用户上顶翻出来的更早一页（S.histPrevRaw，账本给的历史）。
     本地账本副本（S.histMsgs / LS_HIST）彻底退出屏幕，不再抢位置、不再补尾。
     3.01（老板 2026-11-20 令）：主界面「吃小账本」——①先铺本地 IndexedDB 全量快照
     （_curLocalFrameMsgs，按 srv+sid 归属校验），再叠加服务端活帧增量；同 mid 取
     正文更长的那份、绝不重复成两条；无本地缓存则原样用活帧（降级不报错）。 */
  const _sp = S.switch_pend;
  if ((S.livePend || (_sp && _sp.lockTarget && !_sp.arrived))
      && !_swSnapIsTargetNow(_sp)){
    /* 2026-11-24 单账本：切会话在途也直接显示目标会话账本，不再清屏等快照。 */
    const _l = (typeof lbScreenMsgs === 'function')
      ? lbScreenMsgs((typeof curSid === 'function' ? curSid() : ''),
                     (typeof curTitle === 'function' ? curTitle() : '')) : [];
    return orderMsgs(_l);
  }
  /* 2026-11-24（老板 10:23「只认小账本」）：正文唯一来源＝当前会话账本 rounds。
     2.265（老板 2026-11-24 铁令）：撤「账本读空回落服务端活帧」——S.snap.msgs
     是 WS 直推内容（snap_pane 增量帧/直推人类行会把它污染成单条），回落＝
     「主界面只剩最新一条、上下文全没了」的旁路；账本读空一律空态，
     等账本帧/hist 补入后自动渲染，绝不直显直推单条。 */
  const snapMsgs = (typeof lbScreenMsgs === 'function')
    ? lbScreenMsgs((typeof curSid === 'function' ? curSid() : ''),
                   (typeof curTitle === 'function' ? curTitle() : ''))
    : [];
  const prevRaw = (S.histPrevRaw && S.histPrevRaw.length) ? S.histPrevRaw : [];
  if (!prevRaw.length) return orderMsgs(snapMsgs);
  const prevArr = prevRaw.map(ledToArr);
  _midCollect(snapMsgs); _midCollect(prevArr);
  const outP = _midPromote(snapMsgs), prevP = _midPromote(prevArr);
  const haveMid = new Set(), haveKey = new Set();
  for (const m of outP){
    const id = String((m && m[6]) || '');
    if (id) haveMid.add(id);
    haveKey.add(_msgKey(m));
  }
  const pre = [];
  for (const m of prevP){
    const id = String((m && m[6]) || '');
    if ((id && haveMid.has(id)) || haveKey.has(_msgKey(m))) continue;
    if (id) haveMid.add(id);
    haveKey.add(_msgKey(m));
    pre.push(m);
  }
  return orderMsgs(pre.length ? pre.concat(outP) : outP);
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
   秒显：点会话直接从内存取本地最新完整存帧立刻整屏铺上（2.130 起不再出任何
   等待提示条）；IDB 打不开则静默降级，绝不阻断主流程。 */
/* 2.244（老板令·一套账，对齐 WB IDB_VER=3/purgeConvStore）：升 3——
   ledger_conv 退役停写、一次性清空，本地只留 snap_conv 一套正文账。
   表定义仍保留（旧库升级不报 NotFound，清空后永不写入）。 */
const IDB_NAME = 'trae_webm_idb', IDB_VER = 4;   /* 2026-11-24：v4 物理删除 ledger_conv（只留 snap_conv 一本账） */
const IDB_KEEP_MS = 10 * 24 * 3600 * 1000;  /* 2.98：超 10 天剪枝（标准《快照缓存策略》§五，原 7 天） */
/* 2.126：WEB_ROUNDS_KEEP 已删除（三轮口径作废，快照与账本一律整帧原样）。 */
const IDB_PRUNE_MAX = 200;                  /* 单轮最多删 200 条，防长任务卡主线程 */
/* 2.112（插队·老板 21:35「明明有快照却白屏」）：落盘节流/指纹【按会话】记忆——
   原全局单值 _idbLastAt/_idbLastFp 会让「刚切到的 B」被「刚看过的 A」的指纹
   误判为「无变化」而漏落盘。 */
let _idbP = null;
const _idbLastAtBy = {}, _idbLastFpBy = {};
/* 2.112：内存里每个会话最近一份存帧（键＝cacheKey|sid）——点会话即同步上屏（0ms），
   再异步读 IDB 校正；这才是「明明有快照就必须立刻拿出来给我看」。
   2.130：新增标题索引 _frameMemByTitle（键＝cacheKey|标题）——存帧里 sid 与点击时的
   稳定键对不上（改名/非数字 SID）时仍能同步命中；并在打开页面时全量预读进内存。 */
const _frameMem = {}, _frameMemByTitle = {};
function _frameMemKey(sid){ return frameKey() + '|' + sid; }
function _frameTitleKey(title){
  const t = String(title || '').trim();
  return t ? frameKey() + '|' + t : '';
}
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
      /* 2026-11-24（老板令·只留小账本）：ledger_conv 第二本账物理删除，不再创建。 */
      if (db.objectStoreNames.contains('ledger_conv')) db.deleteObjectStore('ledger_conv');
    };
    rq.onsuccess = () => {
      const db = rq.result;
      /* 2.246：旧标签页（旧版本页）持着老连接的 IDB 不放手，会把 v3 升级永久卡在
         blocked（本轮 CDP 实测：另一个 2.240 页面把主线 repro 卡死 60 秒）。收到
         versionchange 立即关连接让位；本页随后的 DB 操作按需重开。 */
      try { db.onversionchange = () => { try { db.close(); } catch(e){}
        _idbP = null; }; } catch(e){}
      res(db);
    };
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
/* 2.169（老板 2026-11-05 20:53）：预备账册＝「最近 N 轮」（1 轮＝人类发言＋终极回复）——
   2.204（WB+TR 整改 ST·B1）：单位由「条」统一为「轮」，默认 5 轮，与本地账本
   CFG.lb_rounds、服务端 ledger_push_rounds 三处同值；调控页改一值即三处同源。
   ① 只收【人类发言】与【有终极回复的 AI 行】（第 8 位；思维流一律不落盘）；
   ② 按 mid 前 8 位十六进制时间排序，只留最新 N 轮；
   ③ N 存 localStorage（手机缓存查看器里可直接改，默认 5）。 */
const FRAME_KEEP_KEY = 'trae_webm_frame_n';
/* 2.17（老板 2026-11-05 21:51）：预备画面【不再跟版本号走】——钥匙固定为 'frame'。
   老板原意：版本升级清缓存可以，但预备画面现在有「最近 N 轮」自动管理，不必再靠
   版本号一刀清；升级也不该把已有预备画面变成「旧版本」或删掉。 */
const FRAME_KEY = 'frame';
function frameKey(){ return FRAME_KEY; }
function _frameKeepN(){
  try{
    /* 2.204：账本轮数是唯一真值（调控页只改它）；frame_n 只作旧值兼容镜像。 */
    if (typeof lbRounds === 'function') return lbRounds();
    const v = parseInt(localStorage.getItem(FRAME_KEEP_KEY) || '5', 10);
    return (v >= 1 && v <= 50) ? v : 5;
  }catch(e){ return 5; }
}
function _frameRoundTrim(rows, n){
  /* 从尾部往前数 n 个「人类发言」作为轮边界，保留其后全部行；
     1 轮＝[u] 或 [u,a]，绝不按「条」裁出半轮。 */
  if (!Array.isArray(rows) || !rows.length) return [];
  let cnt = 0, from = 0;
  for (let i = rows.length - 1; i >= 0; i--){
    const m = rows[i] && rows[i].m;
    if (m && m[0] === 'u'){
      cnt++;
      if (cnt >= n){ from = i; break; }
    }
  }
  return rows.slice(from);
}
function _msgOrd(m, i){
  /* 2.206：预备账册排序同样只认 mid 前 8 位十六进制秒数；无有效 mid 的行
     交给 _frameMsgs／上层剔除，这里用原序兜底（不再读 tm/DID）。 */
  const ts = (typeof midSec === 'function') ? midSec(m && m[6]) : NaN;
  if (isFinite(ts)) return ts * 1000 + (i % 1000);
  return i;
}
function _frameMsgs(msgs, idle){
  /* 2.213（前端零拦截）：原样落盘——不再按「无 mid」「思维流关键词」丢弃任何行，
     也不再按保留轮数裁剪；顺序按后端下发（不重排）。
     AI 行有终答（index7 非空）时正文取终答，其余保留后端原文（最小格式化）。 */
  if (!Array.isArray(msgs)) return [];
  const out = [];
  msgs.forEach(function(m){
    if (!Array.isArray(m)) return;
    const r = m.slice();
    if (m[0] === 'a'){
      /* '提前终极'/'补记' 是来源标记不是正文，正文保持后端原文。 */
      const fin = (m.length > 7) ? String(m[7] || '').trim() : '';
      if (fin && fin !== '补记' && fin !== '提前终极') r[1] = fin;
    }
    out.push(r);
  });
  return out;
}
function _idbFrame(){
  const s = S.snap || {};
  return {online: !!s.online, login: s.login,
          msgs: _frameMsgs(Array.isArray(s.msgs) ? s.msgs.slice() : [], !!s.sendIdle),  /* 3.05 */
          finish: s.finish || null, tail: s.tail || '', sendIdle: s.sendIdle,
          inputText: s.inputText || '', opts: s.opts || [],
          ask: s.ask || null, pend: [],
          model: s.model || ''};
}
/* ========== 2.126：本地快照「只进不退」统一闸 ==========
   老板 2026-10-23：「每个会话只保留一份最新的、完整的、只进不退的快照。」
   - 完整：整帧原样（上面 _idbFrame／paneFrameStore 已不再裁轮数）。
   - 只进不退：新帧末条消息 ID 必须比已存帧新；末条相同则条数不得更少；
     旧帧／空帧／碎片帧一律拒收，绝不覆盖。
   - 所有写库入口（定时落盘、切换强制落、预取帧、内存帧）统一走 _frameCommit。 */
function _frameTailOrder(msgs){
  /* 2.209：末条身份只认消息 ID（mid）——不再读 m[2] 时间列。 */
  let n = 0, mid = '';
  if (Array.isArray(msgs)){
    n = msgs.length;
    for (let i = msgs.length - 1; i >= 0; i--){
      const m = msgs[i];
      const d = String((m && m[6]) || '');
      if (d){ mid = d; break; }
    }
  }
  return {n: n, mid: mid};
}
function _frameNewerOrEqual(a, b){
  /* true＝a（新帧）可以覆盖 b（已存帧） */
  if (!b || !Array.isArray(b.msgs) || !b.msgs.length) return true;
  if (!a || !Array.isArray(a.msgs) || !a.msgs.length) return false;   /* 空帧绝不上位 */
  const A = _frameTailOrder(a.msgs), B = _frameTailOrder(b.msgs);
  if (A.mid && B.mid && A.mid !== B.mid) return A.mid > B.mid;   /* ID 时间（前 8 位 hex）序 */
  return A.n >= B.n;                       /* 同一条 ID：条数不得更少 */
}
/* 2.220（预备画面同一把尺子）：落盘前按 N 裁 frame.msgs，复用 账本核对.js
   的 lbTrimFrameMsgs（内部就是「u 起一轮」分组 + lbLedgerTrimRounds 的
   lbRoundKey 去重/slice(-N)），不另写第二套。当前屏 S.snap 不经过本函数，
   屏幕上的消息照旧显示（前端零拦截不变）。 */
function _frameTrimN(msgs, sk, quiet){
  try {
    if (typeof lbTrimFrameMsgs === 'function') return lbTrimFrameMsgs(msgs, sk, quiet !== false);
  } catch(e){}
  return msgs;
}
function _frameCommit(sk, frame, meta, onOk, memNow, force){
  const _mk = String(meta.title || '').trim();
  /* 3.01：给存帧盖「当前服务器」归属，供小账本短路按 srv+sid 校验（切服不串显）。 */
  try { if (frame && typeof frame === 'object' && typeof lbSrvTag === 'function')
          frame._srv = String(lbSrvTag()); } catch(e){}
  /* 2.220：新帧先按 N 裁再参与「只进不退」比较与落盘——否则已存 12 轮旧帧
     会以「条数更多」把裁后的 5 轮新帧判成旧帧拒收。 */
  if (frame && Array.isArray(frame.msgs)) frame.msgs = _frameTrimN(frame.msgs, sk, false);
  const _put = () => {
    _frameMem[sk] = frame;
    if (_mk) _frameMemByTitle[meta.key + '|' + _mk] = frame;
    _idbReq('snap_conv', 'readwrite', st => {
      st.delete(meta.key + '|@snap');
      /* 2.215：记录另存真实 sid 与**权威终身号**——标准 4 位号或会话名称兜底
         （lbUidPick 已含名称兜底）；显示端按「号 / 名称（按名称）/ 未登记」三档，
         绝不把完整 sid / 实例号当终身号。 */
      let _uid = String(meta.uid || '').trim();
      if (!_uid && typeof lbUidPick === 'function')
        { try { _uid = String(lbUidPick(null, meta.sid, meta.title) || ''); } catch(e){ _uid = ''; } }
      st.put({sk: sk, key: meta.key, port: meta.port, sid: meta.sid, uid: _uid,
              /* 2.190（老板：只显示当前登录服务器的预备画面）：记录补服务器维度——
                 取值与账本落盘同源（lbSrvTag/lbSrvName/lbSrvFox），读时按同一函数过滤。
                 键（_frameMemKey）不动，避免老缓存全失效白屏。 */
              srv: (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : '',
              srvName: (typeof lbSrvName === 'function') ? String(lbSrvName()) : '',
              srvFox: (typeof lbSrvFox === 'function') ? String(lbSrvFox()) : '',
              title: meta.title, ts: meta.ts, frame: frame});
      return null;
    }).catch(() => {});
    if (typeof onOk === 'function') onOk();
  };
  if (Object.prototype.hasOwnProperty.call(_frameMem, sk)){
    /* 2.220：旧内存帧也先按 N 裁再比，避免旧帧「条数更多」压住裁后新帧。 */
    if (_frameMem[sk] && Array.isArray(_frameMem[sk].msgs))
      _frameMem[sk].msgs = _frameTrimN(_frameMem[sk].msgs, sk, true);
    if (!force && !_frameNewerOrEqual(frame, _frameMem[sk])) return false;
    _put();
    return true;
  }
  /* 2.130（老板 2026-10-24「切会话必须有本地最新完整快照」）：切走/真帧到手这类
     当前会话的完整帧——先把内存槽同步置新（切回时 0ms 命中，不读盘），磁盘侧再按
     「只进不退」与已存帧比对后写入；若磁盘那份更新，内存回填更新的那份。 */
  if (memNow && frame && Array.isArray(frame.msgs) && frame.msgs.length){
    _frameMem[sk] = frame;
    if (_mk) _frameMemByTitle[meta.key + '|' + _mk] = frame;
    if (force){ _put(); return true; }              /* 2.243：强制覆盖，跳过磁盘比对 */
    _idbReq('snap_conv', 'readonly', st => st.get(sk)).then(rec => {
      const old = (rec && rec.frame) || null;
      if (old && Array.isArray(old.msgs)) old.msgs = _frameTrimN(old.msgs, sk, true);
      if (old && !_frameNewerOrEqual(frame, old)){
        _frameMem[sk] = old;                        /* 磁盘更新：内存回填更新帧 */
        const ot = String((rec && rec.title) || '').trim();
        if (ot) _frameMemByTitle[meta.key + '|' + ot] = old;
        return;
      }
      _put();
    }).catch(() => { _put(); });
    return true;
  }
  /* 内存里还没有该会话：先读 IDB 已存帧做比较（首启/未点过的会话） */
  if (force){ _put(); return true; }              /* 2.243：强制覆盖，跳过磁盘比对 */
  _idbReq('snap_conv', 'readonly', st => st.get(sk)).then(rec => {
    const old = (rec && rec.frame) || null;
    if (old && Array.isArray(old.msgs)) old.msgs = _frameTrimN(old.msgs, sk, true);
    if (old) _frameMem[sk] = old;                 /* 回填内存基准 */
    if (!_frameNewerOrEqual(frame, old)) return;  /* 旧帧／碎片帧拒收 */
    _put();
  }).catch(() => { _put(); });                    /* 读失败不阻断首落 */
  return true;
}
/* 2.130（老板 2026-10-24）：打开页面即把该缓存键下【全部会话】的最新完整存帧预读进
   内存——切会话只从 _frameMem 同步取，不读盘、不请求。同一缓存键只预热一次；
   磁盘里同一会话有多条时按「只进不退」取最新那条（同 ts 取条数多的）。 */
let _prewarmKey = '';
function snapIdbPrewarm(key){
  const k = key || frameKey();
  if (_prewarmKey === k) return Promise.resolve(0);
  _prewarmKey = k;
  return _idbReq('snap_conv', 'readonly', st => {
    const out = [];
    const rq = st.openCursor();
    rq.onsuccess = () => {
      const c = rq.result;
      if (!c){ return; }
      const v = c.value || {};
      if ((!v.key || v.key === k || v.key === FRAME_KEY || v.key.indexOf('|') > 0)
          && v.sid && v.frame
          && Array.isArray(v.frame.msgs) && v.frame.msgs.length) out.push(v);
      c.continue();
    };
    return {result: out};
  }).then(arr => {
    (arr || []).forEach(rec => {
      const sk = k + '|' + rec.sid;
      const old = _frameMem[sk] || null;
      /* 3.01：内存存帧带上记录里的服务器归属，供小账本短路 srv+sid 校验。 */
      try { if (rec.frame && typeof rec.frame === 'object') rec.frame._srv = String(rec.srv || ''); } catch(e){}
      if (old && !_frameNewerOrEqual(rec.frame, old)) return;
      _frameMem[sk] = rec.frame;
      const t = String(rec.title || '').trim();
      if (t) _frameMemByTitle[k + '|' + t] = rec.frame;
    });
    return (arr || []).length;
  }).catch(() => { _prewarmKey = ''; return 0; });
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
  const key = frameKey();      /* 2.17：预备画面钥匙固定，升级不再失效 */
  /* 2.126（老板 2026-10-23「只保留一份最新、完整、只进不退」）：走统一闸——
     旧帧／空帧／碎片帧直接拒收（不写内存、不写 IDB）；节流记账与"首份"标记
     只在真正放行后更新，避免"被拒也算已落"导致后续不再落盘。
     2.112 口径不变：按会话各存一份（键 `key|sid`）、同一会话覆盖、不留历史版本。 */
  /* 2.244（老板令·一套账）：删除 2.204「本地账本已有就不落画面」的双账分流——
     snap_conv 就是唯一正文账，快照路照常按「只进不退」落盘，不再被第二本账拦住。
     账本路（ledgerOnSnap / 对账补发）仍走 lbWriteBackSnap 回写同一张表。 */
  _frameCommit(_sk, frame,
    {key: key, port: S.port, sid: sid, title: curTitle(), ts: now},
    function(){
      _idbLastAtBy[_sk] = now; _idbLastFpBy[_sk] = _fp;
      if (_first) S.idbFirstFull = 0;
    }, force === true || _first);
  _idbReq('snap_list', 'readwrite', st => st.put(
    {sk: cacheKeyNow(), key: cacheKeyNow(), ts: now, convs: s.convs,
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
  const key = frameKey();
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
/* 2.17：版本换代只清「会话列表骨架」，预备画面（snap_conv）不再清 */
function snapIdbClearList(){
  return _idbReq('snap_list', 'readwrite', st => st.clear()).catch(() => {});
}
/* 2.244（老板令·一套账，对齐 WB purgeConvStore/维护记录 2.49、2.50）：
   ledger_conv 停写并清空——历史轮次由 账本核对.js lbLedgerMigrateOnce 先一次性
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
    msgs: (typeof lbScreenMsgs === 'function'
           ? lbScreenMsgs((typeof curSid === 'function' ? curSid() : ''),
                          (typeof curTitle === 'function' ? curTitle() : ''))
           : (f.msgs || [])),
    finish: f.finish || null, tail: f.tail || '',
    sendIdle: !!f.sendIdle, inputText: f.inputText || '',
    opts: f.opts || [], ask: f.ask || null,
    /* 2.173（固态化「打开即活」）：pend 不再硬清空——原 [] 是 2.57B 时代唯一
       防串显手段；现 N4 项级 sid 过滤（_pendOwnerOk/pendItemMine）已根治归属
       串显，透出快照排队条交由渲染层逐条判归属。否则断网冷开「打开即活」
       时排队条会被这里的 [] 永久盖掉（等不到真帧回落）。 */
    pend: (snap.pend || []),
    /* 2.173：model 同 pend 口径——存帧 model 为空（旧存帧无此值）时回落
       snap.model，避免 renderState 读到 '' 插「（模型未知）」占位盖掉固态恢复值 */
    model: f.model || snap.model || ''
  });
}
/* 2.130（老板 2026-10-24）：直播帧等待小条「正在获取直播帧…」整条删除——
   首屏一律由本地最新完整存帧同步铺满，后台真帧到达后按「只进不退」平滑替换。 */
/* 秒显：点会话后直接从内存取本地最新完整存帧同步铺上（不读盘、不请求） */
function snapIdbShow(sid, title){
  if (!sid) return;
  S.liveGot = false; S.livePend = S.anchorSid || 稳定键(sid, title) || String(sid || '');   /* 2.261：一律存锚定键 */
  S.liveFrame = null;            /* 2.57B：旧会话 A 的正文退场（防张冠李戴） */
  /* 2026-11-24 单账本：切会话不再用存帧铺底，直接按账本 rounds 渲染并返回。 */
  S.swFrameReady = true;
  renderAll();
  return;
}
/* 2.113：非锚定会话的按需帧（snap_pane）→ 存为该会话的内存存帧＋按会话键落 IDB。
   键与 2.112 完全一致（`cacheKey|稳定键`，snapIdbTick/snapIdbShow 同源），点该会话时
   同步命中 `_frameMem` 即秒显；**绝不碰 S.snap / 当前屏幕**（非目标不打扰），也不动
   落盘节流账（按会话各自记账）。 */
function paneFrameStore(sid, title, v){
  try{
    if (!sid || !v || !Array.isArray(v.msgs)) return false;
    const _sid = 稳定键(sid, title || '') || String(sid);
    const _sk = _frameMemKey(_sid), key = frameKey(), now = Date.now();
    const frame = {online: !!(S.snap && S.snap.online),
                   login: (S.snap && S.snap.login),
                   msgs: _frameMsgs(v.msgs.slice(), true),   /* 3.05：pane 帧按已结束处理 */
                   finish: v.finish || null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [],
                   model: ''};
    /* 2.126：走「只进不退」统一闸——预取帧也不得用碎片／旧帧覆盖已存的完整帧 */
    _frameCommit(_sk, frame,
      {key: key, port: S.port, sid: String(sid), title: title || '', ts: now},
      function(){ _idbLastAtBy[_sk] = now; _idbLastFpBy[_sk] = msgsFp(frame.msgs); });
    return true;
  }catch(e){ return false; }
}
/* 直播帧到达（专属于当前锚定会话）→ 停用本地帧，回落真快照 */
function liveClear(){
  /* 2.15（老板 2026-11-05 20:41「33 个都有缓存，签哪个都不该白屏」）：
     只有【真快照确有正文】才撤本地存帧覆盖；框架帧/空帧/正文未到的这一拍
     一律保留 S.liveFrame 继续顶住，绝不给白屏。 */
  if (!(S.snap && Array.isArray(S.snap.msgs) && S.snap.msgs.length)
      && S.liveFrame && Array.isArray(S.liveFrame.msgs) && S.liveFrame.msgs.length){
    return;
  }
  S.livePend = ''; S.liveGot = true; S.liveFrame = null;   /* 2.57B：真帧到手撤存帧 */
  S.livePrefetch = false;                                  /* 2.67：预取标记一并清 */
  S.lb_foldRounds = 0;     /* 账本V1.0：真画面到手 → 归零（2.183 修2：补发面板已撤§十二-2，状态位保留防渲染 key 漂移） */
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
    if (!sel || !sel[4]){
      /* 3.01（老板 2026-11-05 23:25「刷新/刚打开一直白屏」）：没有会话列表
         （刚升级清空骨架、或首拍还没到）时，直接用【本地持久化锚定】顶出
         预备画面——刷新/登录＝切换，绝不留白。 */
      if (S.anchorSid) snapIdbShow(S.anchorSid, S.anchorTitle || '');
      /* 2.243：快照先秒显，再用本地小账本补全/替换同会话内容 */
      if (typeof lbBootMerge === 'function')
        lbBootMerge(S.anchorFull || S.anchorSid, S.anchorTitle || '');
      return;
    }
    const key = 稳定键(sel[4], sel[1]);
    if (!key) return;
    /* 首屏无锚定：先锚定到上次看的会话（跨刷新续锚，与「网页版锚定自己选的会话」同源） */
    if (!S.anchorSid){
      S.anchorSid = key; S.anchorTitle = sel[1] || ''; S.anchorFull = sel[4] || '';
    }
    snapIdbShow(key, sel[1]);
    /* 2.243：快照先秒显，再用本地小账本补全/替换同会话内容 */
    if (typeof lbBootMerge === 'function') lbBootMerge(sel[4], sel[1]);
  }catch(e){}
}
setInterval(() => snapIdbTick(), 10000);                       /* 2.98：10 秒节流（原 5 秒） */
/* 2.17（老板 2026-11-05 21:53）：两处自动剪枝停用——预备画面改由「最近 N 条」
   自行管理删除，绝不再因「不在当前列表/超天数」误删。 */
/* setInterval(() => { snapIdbPrune(); snapIdbPruneMissing(); }, 10 * 60 * 1000); */
