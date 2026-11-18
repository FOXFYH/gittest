'use strict';
/* 账本核对.js（网页端）  版本 1.00  日期 2026-11-18
   【依据】《手机网页端账本系统V1.0总规范.md》三/六/九/十章 +
           《账本系统V1.0_TRAE协议定稿.md》（含第十一章统筹批复：
           上行 vcheck 单帧多字段、think 兼带正文、macct 按 boxes）。
   【职责】客户端侧账本核对层，一个文件装下六件事：
     ① vcheck 构造（四场景同一函数双入口：login/switch/svr/timer，
        单帧多模块版本编码上报，I2 单入口代码审查依据）；
     ② vack 两阶段回执：stage:1 → 悬浮提示「已变更选中会话，等待账本
        核对中」（复用 切换提示.js 胶囊，经 S.switch_pend.phase）；stage:2 →
        正式成功关提示 + 版本底账刷新 + 智能避让 20s 叠加（I3）；
     ③ mod 单模块实体帧分流（snote/sig/macct/convs/didp/ledger/think）；
     ④ 主动核对：默认 1 分钟周期（可配）+ 页面倒计时（#lbhud）；
        智能避让＝每次强核对完成叠加 20s；
     ⑤ 本地离线倒计时：默认 120s 可配，任意用户操作重置，走完发下线
        信号（logout）；保留现有主动下线场景并新增开关（切后台下线）；
     ⑥ 本地账本（IDB ledger_conv 表，按服务端隔离）：只留最新 N 轮
        （默认 5 可配）；改名/删除会话自动清理；「自动清理无用小账本」
        开关默认勾选、14 天未查看自动删；历史按轮渲染+折叠按钮补发
        （ledger_req）。
   【零依赖降级】服务端未升级（无 vack/mod 帧）时：vcheck 发出无人应答
     ⇒ 走既有 switch 60s 超时兜底；本层绝不妨碍现有 snap 通路（旧协议
     全量保留，新旧并行，联调期互为兜底）。 */
const LS_LBVER = 'trae_webm_lbver';          /* 版本底账落盘（按服务端隔离） */
let LB = {reqSeq: 0, timerAt: 0, push: 0, checking: false, mods: {}};
let lbLastAct = Date.now();                  /* 离线倒计时锚点（任意操作重置） */
let _lbHudEl = null, _lbSnapAt = 0;

/* ================= 配置读取（全部可在小账本页调控，见 小账本页.js） ================= */
function lbPeriodMs(){ const v = parseInt(CFG.lb_period) || 60; return Math.max(15, v) * 1000; }
function lbOfflineSecs(){ return Math.max(15, parseInt(CFG.lb_offline) || 120); }
function lbRounds(){ return Math.min(50, Math.max(1, parseInt(CFG.lb_rounds) || 5)); }

/* ================= 版本底账（每服务端一份；客户端不重算指纹，
   只存服务端下发过的 ver 做比对——协议定稿 2.1 明文） ================= */
function lbVerLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {};
    LB.mods = o[lbSrvKey()] || {};
  } catch(e){ LB.mods = {}; }
}
function lbVerSave(){
  try {
    const o = {};
    try { o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {}; } catch(e2){}
    o[lbSrvKey()] = LB.mods;
    localStorage.setItem(LS_LBVER, JSON.stringify(o));
  } catch(e){}
}
function lbSrvKey(){ return String(S.cur || '默认'); }
function lbModsSet(m){
  LB.mods = (m && typeof m === 'object') ? m : {};
  if (!LB.mods.ledger) LB.mods.ledger = {};
  lbVerSave();
}

/* ================= ① vcheck 构造（单函数双入口，四场景共用） ================= */
function ledgerVcheckBuild(act, sid){
  /* 上行单帧多模块编码（统筹批复·十-1）：编码合帧不判 FAIL，
     每模块编码独立可辨、服务端逐模块校验。 */
  const mods = {};
  const b = LB.mods || {};
  ['sig', 'snote', 'macct', 'convs', 'didp', 'think'].forEach(k => {
    if (b[k]) mods[k] = b[k];
  });
  const led = {};
  Object.keys(b.ledger || {}).forEach(k => { led[k] = b.ledger[k]; });
  mods.ledger = led;                       /* ledger 按「本地留有的会话」逐会话上报 */
  const d = {t: 'vcheck', act: act, mods: mods, req_seq: ++LB.reqSeq};
  if (sid) d.sid = String(sid);
  return d;
}
function ledgerVcheckSend(act, sid){
  /* 四场景同一入口：login（cliLogin）/ switch（点会话、刷新重锚）/
     svr（切服务端）/ timer（主动核对）。WS 不在线 ⇒ 静默放弃
     （switch 场景有 phase:'connecting' 提示兜底，timer 下轮再试）。 */
  try {
    if (!S.onLine || !ws || ws.readyState !== 1) return false;
    if (act === 'login' || act === 'svr') lbVerLoad();   /* 换服务端/重登：按当前服务端重载底账，绝不串用旧服务端版本 */
    sendJson(ledgerVcheckBuild(act, sid));
    if (act === 'timer') LB.checking = true;
    return true;
  } catch(e){ return false; }
}

/* ================= ② vack 两阶段回执 ================= */
function ledgerVack(d){
  if (!d || typeof d !== 'object') return;
  /* stage:1 —— 服务端已变更选中会话，账本核对中（悬浮提示，切换未完成） */
  if (d.stage === 1){
    const sp = S.switch_pend;
    if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
      if (sp.phase !== 'ok'){
        sp.phase = 'ledger_check';
        sp.ts = Date.now();
        clearTimeout(sp._resendT);         /* 服务器已受理：停补发（同 switch_ack 口径） */
        renderAll();
      }
    }
    return;
  }
  /* stage:2 —— 正式成功终态：版本一致（same）或差额补发清单（need） */
  LB.checking = false;
  if (d.mods && typeof d.mods === 'object') lbModsSet(d.mods);   /* 存底，供下轮比对 */
  /* 智能避让（I3）：任一强核对完成 ⇒ 主动核对推迟，每次强核对叠加 20 秒 */
  if (d.act === 'login' || d.act === 'switch' || d.act === 'svr'){
    LB.push += 20000;
    LB.timerAt = Math.max(LB.timerAt || 0, Date.now() + lbPeriodMs() + LB.push);
  }
  const sp = S.switch_pend;
  if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
    if (d.same){
      ledgerSwitchDone();                  /* 版本一致零实体帧 ⇒ 正式成功关提示 */
    } else {
      /* need 差额补发中：8 秒兜底收口（实体帧陆续到达时会刷新画面） */
      sp.need = Array.isArray(d.need) ? d.need : [];
      clearTimeout(sp._needT);
      sp._needT = setTimeout(() => {
        if (S.switch_pend === sp && sp.need){ delete sp.need; ledgerSwitchDone(); }
      }, 8000);
    }
  }
}
function ledgerSwitchDone(){
  const sp = S.switch_pend;
  if (!sp) return;
  delete sp.need;
  clearTimeout(sp._needT);
  if (sp.phase !== 'ok') switchOk();       /* 复用既有成功收口（2s 成功提示 → 关提示） */
}

/* ================= ③ mod 单模块实体帧分流（下行唯一实体形态） ================= */
function ledgerMod(d){
  if (!d || typeof d !== 'object') return;
  const m = String(d.m || ''), v = String(d.v || ''), body = d.d;
  /* 版本存底：mod 帧必带该模块新 ver（协议定稿 3.1） */
  if (v && LB.mods){
    if (m === 'ledger'){
      LB.mods.ledger = LB.mods.ledger || {};
      if (d.sid) LB.mods.ledger[String(d.sid)] = v;
    } else LB.mods[m] = v;
    lbVerSave();
  }
  switch (m){
    case 'snote': {                        /* 定时消息＋备注（合并模块） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (body.notes !== undefined) S.snap['备注'] = body.notes;
        if (body.sched !== undefined) S.snap['定时'] = body.sched;
        if (window.备注入快照) 备注入快照(S.snap);
        if (window.定时入快照) 定时入快照(S.snap);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'sig': {                          /* 信号灯（独立高频） */
      const arr = (body && body.convs) || [];
      if (arr.length && S.snap){
        const cf = Array.isArray(S.snap.convs_full) ? S.snap.convs_full : [];
        arr.forEach(o => {
          if (!o || !o.sid) return;
          const row = cf.find(x => x && x.sid === o.sid);
          if (row) row.status = o.status || row.status;
        });
        if (Array.isArray(o_unreadIds(arr))) S.snap.conv_unread_ids = o_unreadIds(arr);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'macct': {                        /* 模型列表＋账号列表（合并模块，账号按 boxes） */
      if (body){
        if (Array.isArray(body.models)){
          S.models_full = body.models;
          rebuildModelOptions(); checkFavInvalid();
        }
        if (body.acct !== undefined){ S.acct = String(body.acct || ''); renderAcct(); }
        if (Array.isArray(body.boxes)){
          S.boxes = body.boxes.filter(Boolean);
          el.box.innerHTML = '';
          S.boxes.forEach(b2 => {
            const o = document.createElement('option');
            o.value = b2; o.textContent = b2;
            el.box.appendChild(o);
          });
        }
      }
      break;
    }
    case 'convs': {                        /* 会话列表（改名/删除触发本地账本清理 H2） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (Array.isArray(body.convs)) S.snap.convs = body.convs;
        if (Array.isArray(body.convs_full)) S.snap.convs_full = body.convs_full;
        S.convs_key = null;
        renderAll();
      }
      lbCleanGone();                       /* 已删除会话的本地账本自动清理 */
      break;
    }
    case 'didp': {                         /* 销卡池子（F5 补销渠道） */
      const pool = (body && body.pool) || [];
      let ch = false;
      pool.forEach(did => { if (pendClearByDid(did, '')) ch = true; });
      if (ch) renderAll();
      break;
    }
    case 'ledger':                         /* 聊天主账本（按轮补发，G1） */
      ledgerStoreApply(d.sid, body, v);
      break;
    case 'think':                          /* 思维流快照＋排队条（TRAE 专属，E2/N1） */
      ledgerThinkApply(d.sid, body);
      break;
  }
}
function o_unreadIds(arr){
  const out = [];
  arr.forEach(o => { if (o && o.sid && o.status && o.status.unread) out.push(o.sid); });
  return out.length ? out : null;
}

/* think 帧：整屏快照（统筹批复·兼带正文）＋ 排队条子对象（项级 sid/id/text 剥净） */
function ledgerThinkApply(sid, body){
  const b = body || {};
  /* 排队条随 think 包（N1，不独立收发）：项级 sid 过滤（N4 根治串显），
     text 服务端已剥净（N2）、id 仅底层携带（N3，渲染层绝不展示）。 */
  if (Array.isArray(b.pend)){
    const mine = b.pend.filter(it => pendItemMine(it) === true);
    if (!S.snap || typeof S.snap !== 'object') S.snap = {};
    S.snap.pend = mine;
    S.snap.pend_sid = String(b.pend_sid || sid || '');
    S.convs_key = null;
    if (typeof _liveLockOn !== 'function' || !_liveLockOn()) renderAll();
  }
  /* 整屏快照上屏判定（S1 裁定·2026-11-18）：模块化模式下服务端【不再有】
     k='snap_pane' 帧（仅 mod_push_on=False 回退时才存在）——上屏唯一驱动＝
     本函数收到的 mod(m='think') 帧且 frame.msgs 存在，经 onEv('snap_pane',…)
     既有通道上屏（锚定会话上屏 / 非锚定存为该会话内存存帧，零打扰）。
     字符串形态（纯画面文本）暂不上屏——TRAE 网页端思维流画面本就随正文行
     呈现，不做卡片化改造（E2）。 */
  const f = b.frame;
  if (f && typeof f === 'object' && Array.isArray(f.msgs)){
    onEv('snap_pane', {sid: String(sid || ''), title: b.title || '',
                       msgs: f.msgs, finish: f.finish || null});
    S.lb_foldRounds = 0;                   /* 真画面到手 → 历史补发折叠面板退场 */
  }
}

/* 项级归属判定：true=本会话 / false=别会话 / null=无项级 sid（交回顶层判定） */
function pendItemMine(it){
  if (!it || typeof it !== 'object' || it.sid == null) return null;
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  if (!cs) return false;
  const s = String(it.sid);
  if (s === cs) return true;
  return !!(typeof 稳定键 === 'function' && 稳定键(s, '') === 稳定键(cs, ''));
}

/* ================= ⑥ 本地账本（IDB ledger_conv；按服务端隔离） =================
   键＝'lb|<服务端名>|<稳定键>'；值＝{srv, sid, title, ts, lastView, rounds}。
   1 轮＝[人类行, 终极行]（沿用快照行格式，渲染零换算）。 */
function lbKey(sid){ return 'lb|' + lbSrvKey() + '|' + String(sid || ''); }
function lbRoundKey(r){
  return (r || []).map(m => ((m && m[0]) || '') + '|'
    + String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 24)).join('#');
}
function lbRoundsFromMsgs(msgs){
  /* 1 轮＝1 条人类 + 1 条 AI 终极（终极取第 8 位完成卡正文，缺则原文兜底）；
     思维流不落本地账本（按需补发，规范七）。 */
  const rounds = [];
  let cur = null;
  (msgs || []).forEach(m => {
    if (!Array.isArray(m)) return;
    if (m[0] === 'u'){ if (cur) rounds.push(cur); cur = [m.slice()]; }
    else if (m[0] === 'a' && cur){
      const fin = (m.length > 7 && String(m[7] || '').trim()) ? String(m[7]) : String(m[1] || '');
      cur.push([m[0], fin, m[2] || '', 0, 0, m[5] || '', m[6] || '', m[7] || '']);
    }
  });
  if (cur) rounds.push(cur);
  return rounds;
}
function ledgerStorePut(sid, title, rounds, opt){
  try {
    opt = opt || {};
    const sk = lbKey(sid), now = Date.now();
    const rs = (rounds || []).slice(-lbRounds());          /* H1：只留最新 N 轮 */
    _idbReq('ledger_conv', 'readonly', st => st.get(sk)).then(rec => {
      const old = rec || {};
      let out = rs;
      if (Array.isArray(old.rounds) && old.rounds.length > rs.length){
        /* 旧账更厚（翻页/补发攒过）⇒ 旧轮打底、新轮按身份并入，再截尾 N 轮 */
        const seen = new Set(old.rounds.map(lbRoundKey));
        out = old.rounds.concat(rs.filter(r => !seen.has(lbRoundKey(r)))).slice(-lbRounds());
      }
      return _idbReq('ledger_conv', 'readwrite', st => st.put({
        sk: sk, srv: lbSrvKey(), sid: String(sid), title: title || old.title || '',
        ts: now, lastView: opt.touch ? now : (old.lastView || 0), rounds: out}));
    }).catch(() => {
      _idbReq('ledger_conv', 'readwrite', st => st.put({
        sk: sk, srv: lbSrvKey(), sid: String(sid), title: title || '',
        ts: now, lastView: opt.touch ? now : 0, rounds: rs}));
    });
  } catch(e){}
}
function ledgerStoreApply(sid, body, ver){
  if (!sid || !body || !Array.isArray(body.rounds)) return;
  ledgerStorePut(sid, body.title || '', body.rounds, {touch: true});
  /* G1：锚定会话且屏幕无内容 ⇒ 用补发轮次顶屏（人类+终极+折叠按钮） */
  if (typeof _paneIsAnchor === 'function'
      && _paneIsAnchor(String(sid), body.title || '')
      && !(S.liveFrame && Array.isArray(S.liveFrame.msgs) && S.liveFrame.msgs.length)){
    const rows = [];
    (body.rounds || []).forEach(r => (r || []).forEach(m => {
      if (Array.isArray(m)) rows.push(m);
    }));
    if (rows.length){
      S.livePend = S.anchorSid;
      S.liveFrame = {msgs: rows, finish: null, tail: '', sendIdle: true,
                     inputText: '', opts: [], ask: null, pend: [],
                     attach: [], model: ''};
      S.lb_foldRounds = (body.rounds || []).length;
      renderAll();
    }
  }
}
/* G2：点折叠按钮 → 按需补该轮思维流（协议定稿 七：ledger_req） */
function ledgerReqThink(round){
  try {
    sendJson({t: 'ledger_req', sid: S.anchorFull || (typeof curSid === 'function' ? curSid() : '') || '',
              round: round | 0, kind: 'think'});
    flash('已请求第 ' + round + ' 轮思维流…', 'var(--blue)');
  } catch(e){}
}
/* 快照到达（事件总线.js snap 分支转调）：账本落盘 + 触碰 lastView + 真画面退场折叠面板 */
function ledgerOnSnap(){
  const s = S.snap || {};
  if (!Array.isArray(s.msgs) || !s.msgs.length) return;
  if (typeof _liveLockOn === 'function' && _liveLockOn()) return;   /* 过渡期正文不属锚定，不记 */
  const sid = S.anchorSid || '';
  if (!sid) return;
  const now = Date.now();
  if (now - _lbSnapAt < 5000){ _lbSnapAt = now; return; }           /* 5 秒节流 */
  _lbSnapAt = now;
  ledgerStorePut(sid, typeof curTitle === 'function' ? curTitle() : '',
                 lbRoundsFromMsgs(s.msgs), {touch: true});
}

/* ================= 失效账本清理（H2/H3） ================= */
function lbCleanGone(){
  /* 已删除/改名不存在会话 → 本地账本自动清理。防呆：会话列表空 ⇒ 全部保留。 */
  const convs = (S.snap && Array.isArray(S.snap.convs)) ? S.snap.convs : [];
  if (!convs.length) return;
  const keep = new Set();
  convs.forEach(r => {
    if (r && r[0] === 'c'){
      if (r[4] && typeof 稳定键 === 'function') keep.add(稳定键(r[4], r[1]));
      if (r[1]) keep.add(String(r[1]));
    }
  });
  if (!keep.size) return;
  _idbReq('ledger_conv', 'readonly', st => st.getAll()).then(rows => {
    (rows || []).forEach(rec => {
      if (!rec || rec.srv !== lbSrvKey()) return;
      if (!keep.has(String(rec.sid)) && !keep.has(String(rec.title || '')))
        _idbReq('ledger_conv', 'readwrite', st => st.delete(rec.sk)).catch(() => {});
    });
  }).catch(() => {});
}
function lbCleanStale(){
  /* H3：「自动清理无用小账本」默认勾选——14 天未被查看的本地账本自动删除 */
  if (!CFG.lb_autoclean) return;
  const cut = Date.now() - 14 * 24 * 3600 * 1000;
  _idbReq('ledger_conv', 'readonly', st => st.getAll()).then(rows => {
    (rows || []).forEach(rec => {
      if (!rec || rec.srv !== lbSrvKey()) return;
      if ((rec.lastView || 0) && rec.lastView < cut)
        _idbReq('ledger_conv', 'readwrite', st => st.delete(rec.sk)).catch(() => {});
    });
  }).catch(() => {});
}
setInterval(() => { try { lbCleanStale(); } catch(e){} }, 10 * 60 * 1000);

/* ================= ④ 主动核对（1 分钟周期+倒计时）与智能避让 ================= */
setInterval(() => {
  try {
    lbHud();
    if (LB.checking || !S.onLine || !loggedIn || document.hidden) return;
    const now = Date.now();
    if (!LB.timerAt) LB.timerAt = now + lbPeriodMs();
    if (now >= LB.timerAt){
      LB.push = 0;                         /* 避让已消费：叠加计数清零 */
      LB.timerAt = now + lbPeriodMs();
      ledgerVcheckSend('timer');           /* 本质＝自动化强核对（同一构造函数） */
      setTimeout(() => { LB.checking = false; }, 5000);   /* 防旧服务端无回帧卡旗标 */
    }
  } catch(e){ LB.checking = false; }
}, 1000);

/* ================= ⑤ 本地离线倒计时（默认 120s 可配） ================= */
/* 任意用户操作重置；走完发下线信号（logout）。与既有 5 分钟闲置退登并存
   （120s 先到先触发，效果一致）；开关 CFG.lb_idleout 默认开。 */
['touchstart', 'mousedown', 'keydown', 'scroll', 'click', 'pointerdown']
  .forEach(ev => document.addEventListener(ev, () => { lbLastAct = Date.now(); },
             {passive: true, capture: true}));
setInterval(() => {
  try {
    if (!CFG.lb_idleout) return;
    if (document.hidden || !S.onLine) return;      /* 后台定时器被冻，不判 */
    if (Date.now() - lbLastAct >= lbOfflineSecs() * 1000){
      lbLastAct = Date.now();
      if (loggedIn) cliLogout('闲置' + lbOfflineSecs() + '秒');   /* 下线信号 */
    }
  } catch(e){}
}, 1000);
/* 保留现有主动下线场景并新增开关：切后台/切网页下线（默认关＝现状不下线） */
document.addEventListener('visibilitychange', () => {
  try {
    if (document.hidden && CFG.lb_bgout && loggedIn) cliLogout('切后台');
  } catch(e){}
});

/* ================= 倒计时 HUD（I2：页面展示对应倒计时） ================= */
function lbHud(){
  try {
    if (!_lbHudEl){
      const st = document.createElement('style');
      st.textContent = '#lbhud{position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));'
        + 'z-index:9000;font-size:10px;line-height:1.3;color:#8a94a6;background:rgba(255,255,255,.88);'
        + 'border:1px solid #dde3ec;border-radius:999px;padding:2px 8px;pointer-events:none;}';
      document.head.appendChild(st);
      _lbHudEl = document.createElement('div');
      _lbHudEl.id = 'lbhud';
      document.body.appendChild(_lbHudEl);
    }
    const now = Date.now();
    const ck = LB.timerAt ? Math.max(0, Math.ceil((LB.timerAt - now) / 1000)) : 0;
    const off = CFG.lb_idleout
      ? Math.max(0, Math.ceil((lbLastAct + lbOfflineSecs() * 1000 - now) / 1000)) : 0;
    _lbHudEl.textContent = '核对 ' + ck + 's · 离线 ' + off + 's';
  } catch(e){}
}

/* ================= 启动 ================= */
lbVerLoad();
