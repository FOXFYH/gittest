'use strict';
/* 账本核对.js（网页端）  版本 1.01  日期 2026-11-18
   【依据】《手机网页端账本系统V1.0总规范.md》三/六/九/十章 +
           《账本系统V1.0_TRAE协议定稿.md》（含第十一章统筹批复：
           上行 vcheck 单帧多字段、think 兼带正文、macct 按 boxes）。
   【职责】客户端侧账本核对层，一个文件装下六件事：
     ① vcheck 构造（四场景同一函数双入口：login/switch/svr/timer，
        单帧多模块版本编码上报，I2 单入口代码审查依据）；
     ② vack 两阶段回执：stage:1 → 悬浮提示「已变更选中会话，等待账本
        核对中」（复用 切换提示.js 胶囊，经 S.switch_pend.phase）；stage:2 →
        正式成功关提示 + 版本底账刷新 + 智能避让 20s 叠加（I3）；
     ③ mod 单模块实体帧分流（snote/sig/macct/convs/didp/ledger/think）
        ＋ set_think_int 回执 lbThinkIntAck（WS桥 0.27）；
     ④ 主动核对：默认 1 分钟周期（可配）+ 倒计时文本 lbHudText()（缓存查看器
        「③ 账本调控」区常显）＋ #lbhud 悬浮条（追加单 2026-11-18 改开关式：
        CFG.lb_hud 默认关，开关在账本调控区，开才悬浮走字）；
        智能避让（追加单修订）＝switch 发出即冻结、终态（stage:2 或 60s 失败）
        解冻重置；login/svr 完成直接按完整周期重置；旧 20s 叠加已删；
     ⑤ 本地离线倒计时：默认 120s 可配，任意用户操作重置，走完发下线
        信号（logout）；保留现有主动下线场景并新增开关（切后台下线）；
     ⑥ 本地账本（IDB ledger_conv 表，按服务端隔离）：只留最新 N 轮
        （默认 5 可配）；改名/删除会话自动清理；「自动清理无用小账本」
        开关默认勾选、14 天未查看自动删；历史按轮渲染+折叠按钮补发
        （ledger_req）。
     调控界面已并入 手机缓存查看器.js「③ 账本调控」tab（规范§十：
     小账本＝现成缓存查看器，禁止新造页面；原 小账本页.js 已撤销）。
   【零依赖降级】服务端未升级（无 vack/mod 帧）时：vcheck 发出无人应答
     ⇒ 走既有 switch 60s 超时兜底；本层绝不妨碍现有 snap 通路（旧协议
     全量保留，新旧并行，联调期互为兜底）。 */
const LS_LBVER = 'trae_webm_lbver';          /* 版本底账落盘（按服务端隔离） */
let LB = {reqSeq: 0, timerAt: 0, push: 0, checking: false, mods: {},
          frozen: false, frozenT: null,      /* frozen＝切换期间核对冻结（追加单 2026-11-18，取代 20s 叠加） */
          lbHave: new Set()};                /* V2 验收 Y11：本地【真存】会话集合——ledger 上报只认它，收帧记下的版本不算存 */
let lbLastAct = Date.now();                  /* 离线倒计时锚点（任意操作重置） */
let _lbHudEl = null, _lbSnapAt = 0;          /* #lbhud 悬浮条（开关式默认关，追加单 2026-11-18） */

/* ================= 配置读取（调控界面在缓存查看器「③ 账本调控」区） ================= */
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
  if (!LB.mods.ledger) LB.mods.ledger = {};
  LB.lbHave = new Set();                     /* 换服务端/重登：真存集按当前服务端重算 */
  lbHaveLoad();
}
/* V2 验收 Y11（2026-11-18）：开机异步预载 IDB ledger_conv → LB.lbHave。
   「版本底账（LB.mods.ledger，服务端下发过什么）」与「本地真存（IDB 里
   实际留着谁）」是两本账：mod ledger 收帧只记版本、可能没落盘成功；清理
   （lbCleanGone/14 天过期）删了盘但版本底账还在。上报若只看版本底账，
   就会替已经不存在的本地账本申报版本（only1 判定被污染）。 */
function lbHaveLoad(){
  try {
    _idbReq('ledger_conv', 'readonly', st => st.getAll()).then(rows => {
      (rows || []).forEach(rec => {
        if (rec && rec.srv === lbSrvKey() && rec.sid != null)
          LB.lbHave.add(String(rec.sid));
      });
    }).catch(() => {});
  } catch(e){}
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
  /* V2 验收 Y11（2026-11-18）：ledger 上报只认【本地真存】（LB.lbHave）——
     版本底账里记了但 IDB 已不存在（清理/落盘失败）的会话绝不代报，防
     only1 判定被污染；真存有而版本底账缺（快照路攒下的轮次）补报 '0'
     让服务端决定是否补发。 */
  const _have = (LB.lbHave instanceof Set) ? LB.lbHave : new Set();
  Object.keys(led).forEach(k => { if (!_have.has(String(k))) delete led[k]; });
  _have.forEach(k => { if (!(k in led)) led[k] = '0'; });
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
    /* 追加单 2026-11-18（规范§三「切换期间的核对冻结」）：switch 一经发出，
       主动核对倒计时立即重置并冻结，期间绝不发 timer 帧；直到本轮切换出
       终态（vack stage:2 正式成功，或 60 秒未收终态宣布失败）才解冻并按
       完整周期重新起算。60 秒＝全链路唯一口径（待办卡.js SWITCH_TIMEOUT_MS）。 */
    if (act === 'switch'){
      LB.frozen = true;
      LB.timerAt = Date.now() + lbPeriodMs();
      clearTimeout(LB.frozenT);
      LB.frozenT = setTimeout(() => {
        /* 60 秒失败兜底：与待办卡.js SWITCH_TIMEOUT_MS 同值同域（§三 单一口径） */
        lbUnfreeze();
      }, (typeof SWITCH_TIMEOUT_MS === 'number' && SWITCH_TIMEOUT_MS) || 60000);
    }
    return true;
  } catch(e){ return false; }
}
/* 切换出终态（成功或失败）→ 解冻并按完整周期重新起算（规范§三） */
function lbUnfreeze(){
  try {
    clearTimeout(LB.frozenT);
    LB.frozenT = null;
    LB.frozen = false;
    LB.timerAt = Date.now() + lbPeriodMs();
  } catch(e){ LB.frozen = false; }
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
  /* 智能避让（I3 修订版·追加单 2026-11-18）：切换成功＝终态 → 解冻并按完整
     周期重新起算；login/svr 强核对完成 → 倒计时直接重置为完整周期。
     旧「20 秒叠加」口径已作废删除（规范§三／协议定稿§五）。 */
  if (d.act === 'switch') lbUnfreeze();
  else if (d.act === 'login' || d.act === 'svr'){
    LB.timerAt = Date.now() + lbPeriodMs();
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
      /* V2 验收 Y9（2026-11-18）：think 帧归属按 d.sel 优先——服务端 think
         模块按「桌面当前选中」下发并在 sel 带归属 sid，d.sid 只是收帧通道
         语义；优先 sel 才不会把别会话的思维流错挂到当前锚定。 */
      ledgerThinkApply(d.sel || d.sid, body);
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
    /* Y5：排队条到达即扫销卡（渠道③）——消息一进官方队列就算已发出 */
    if (typeof pendLandingScan === 'function') pendLandingScan(null, mine);
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
    /* Y11：真存记账收口在此单点——ledgerStoreApply（mod ledger 收帧）与
       ledgerOnSnap（快照路落盘）两条路都经这里，Set 重复 add 无害。 */
    if (sid != null) LB.lbHave.add(String(sid));
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
      if (!keep.has(String(rec.sid)) && !keep.has(String(rec.title || ''))){
        LB.lbHave.delete(String(rec.sid));   /* Y11：盘删了真存集同步减，绝不代报 */
        _idbReq('ledger_conv', 'readwrite', st => st.delete(rec.sk)).catch(() => {});
      }
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
      if ((rec.lastView || 0) && rec.lastView < cut){
        LB.lbHave.delete(String(rec.sid));   /* Y11：过期清盘同步减真存集 */
        _idbReq('ledger_conv', 'readwrite', st => st.delete(rec.sk)).catch(() => {});
      }
    });
  }).catch(() => {});
}
setInterval(() => { try { lbCleanStale(); } catch(e){} }, 10 * 60 * 1000);

/* ================= ④ 主动核对（1 分钟周期+倒计时）与智能避让 ================= */
setInterval(() => {
  try {
    lbHud();                               /* 悬浮条开关式：关则即撤、开则走字（含冻结态） */
    if (LB.frozen) return;                 /* 追加单 2026-11-18：切换期间核对冻结，绝不发 timer */
    if (LB.checking || !S.onLine || !loggedIn || document.hidden) return;
    const now = Date.now();
    if (!LB.timerAt) LB.timerAt = now + lbPeriodMs();
    if (now >= LB.timerAt){
      LB.timerAt = now + lbPeriodMs();
      /* V2 验收 Y9（2026-11-18）：timer 核对也带锚定 sid——服务端按 sid
         定位「网页端正在看哪个会话」，缺 sid 时服务端只能猜（拿桌面当前
         选中顶上），锚定≠桌面选中时会核错对象。 */
      ledgerVcheckSend('timer', S.anchorFull
        || (typeof curSid === 'function' ? curSid() : '') || '');
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

/* ================= 倒计时文本（整改单 2026-11-18：撤销 #lbhud 悬浮条） =================
   只出数不做界面：缓存查看器「③ 账本调控」区每秒调 window.lbHudText() 刷新展示。
   规范§九-4：任意操作重置 → 人操作时数字不降属正常设计，静置观察才逐秒下降。 */
function lbHudText(){
  try {
    const now = Date.now();
    /* 冻结态（切换进行中）：核对倒计时恒显满周期——数字停住＝冻结中，不发送 */
    const ck = LB.frozen ? (lbPeriodMs() / 1000)
      : (LB.timerAt ? Math.max(0, Math.ceil((LB.timerAt - now) / 1000)) : 0);
    const off = CFG.lb_idleout
      ? Math.max(0, Math.ceil((lbLastAct + lbOfflineSecs() * 1000 - now) / 1000)) : 0;
    return '核对 ' + ck + 's · 离线 ' + off + 's';
  } catch(e){ return '—'; }
}
if (typeof window !== 'undefined') window.lbHudText = lbHudText;

/* 悬浮倒计时条（追加单 2026-11-18 改开关式：规范§九-4 修订——默认关不悬浮，
   开关在缓存查看器「③ 账本调控」区 CFG.lb_hud；开才创建并走字，关即撤）。 */
function lbHud(){
  try {
    if (!CFG.lb_hud){
      if (_lbHudEl){ _lbHudEl.remove(); _lbHudEl = null; }
      return;
    }
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
    _lbHudEl.textContent = lbHudText();
  } catch(e){}
}

/* set_think_int 服务端回执（S1 裁定 WS桥 0.27）：{'t':'think_int_ack','ok','sec','on'}
   —— 按 on/sec 更新本地 CFG（服务端是限频间隔的最终真值）；调控输入框由
   缓存查看器「账本调控」区重建 DOM 时按 CFG 回填。 */
function lbThinkIntAck(d){
  try {
    if (!d || typeof d !== 'object') return;
    const sec = Math.max(0, parseInt(d.sec) || 0);
    if (d.ok){
      CFG.lb_think = d.on ? sec : 0;
      cfgSave();
      flash(d.on ? ('思维流间隔已生效：' + sec + ' 秒') : '思维流限频已关闭（画面一变即发）', 'var(--blue)');
    } else {
      flash('思维流间隔下发未生效（服务端拒绝）', 'var(--red)');
    }
  } catch(e){}
}

/* ================= 启动 ================= */
lbVerLoad();
