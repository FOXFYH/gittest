'use strict';
let _srv_dirty = false, _srv_save_tm = 0;
function loadSrvs(){
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(LS_SRVS)); } catch(e){}
  if (!raw || typeof raw !== 'object') return;
  const now = Date.now();
  /* 2.48：清掉旧版遗留的「默认服务端」假条目（服务端 2.83 起凡发出的
     报文都带源头名，已无此兜底名；纯属幻觉，读盘时直接抹掉）。 */
  if (raw['默认服务端'] !== undefined) delete raw['默认服务端'];
  for (const nm of Object.keys(raw)){
    /* v2.15：必须用 Number()，不能写 `raw[nm] | 0`——毫秒时间戳(约1.8e12)
       超 32 位，`| 0` 会截断成负数，致 `now - seen > SRV_TTL` 恒真，
       落盘名册每次读回都被判超期清空（刷新后清单恒空）。 */
    const seen = Number(raw[nm]) || 0;
    if (!nm || !seen || now - seen > SRV_TTL) continue;    /* 超期不恢复 */
    const s = S.servers[nm];
    if (!s) S.servers[nm] = {name: nm, ts: 0, seen: seen, conn: false};
    else s.seen = Math.max(s.seen || 0, seen);
  }
  renderSrvList();
}
function saveSrvs(){
  const o = {};
  for (const nm of Object.keys(S.servers)) o[nm] = S.servers[nm].seen || 0;
  try { localStorage.setItem(LS_SRVS, JSON.stringify(o)); } catch(e){}
}
function touchSrvSeen(s){
  s.seen = Date.now(); _srv_dirty = true;
  const now = Date.now();
  if (now - _srv_save_tm >= 3000){ _srv_save_tm = now; _srv_dirty = false; saveSrvs(); }
}

function regSrv(nm, d){
  let s = S.servers[nm];
  if (!s) s = S.servers[nm] = {name: nm, ts: 0, seen: 0, conn: false};
  s.ts = Date.now();
  touchSrvSeen(s);                            /* v1.84：记最后出现时间（落盘） */
  if (d.sid) s.sid = d.sid;
  if (d.v) s.v = d.v;
  if (d.t === 'hello' || d.t === 'srv'){
    if (d.boxes) s.boxes = d.boxes;
    if (d.alive) s.alive = d.alive;
    if (d.conn !== undefined) s.conn = d.conn;
    if (d.box) s.box = d.box;
    if (d.port) s.port = d.port;
    /* 1.13：操控占用状态（正被谁锁着；mine===false=别人） */
    if (d.lock !== undefined) s.lock = d.lock;
    else if (d.t === 'hello' && !d.lock) s.lock = null;
  }
  pickCur();
  renderTop();
}
function pickCur(){
  if (S.cur && S.servers[S.cur]) return;      /* 已选定且仍在名册：不动（离线也保持） */
  if (S.cur) setCur(null);
  /* v1.84：只认 localStorage 里记着的那台，绝不按在线/新鲜度替用户挑：
     记着的那台没上线就什么都不选（等它上来再自动接管）。 */
  let want = null;
  try { want = localStorage.getItem(LS_SRV); } catch(e){}
  /* 1.87（用户规定）：记忆名若连名册里都没有（旧版遗留名/服务端改过名）＝彻底
     作废——清掉它，退回下面的无记忆自动接管第一台在线。 */
  if (want && !S.servers[want]){ want = null; setCur(null); }
  if (want){
    /* 1.87（用户规定）：有记忆就「打开即选中」——不再要求本会话收到过它的
       广播（ts>0），它没在线也保持选中（启动时 loadSrvs 已把它灌回名册）。 */
    if (S.servers[want]){ setCur(want); enterCur(); }
    return;
  }
  /* 1.86（按用户规定细化，2026-09-28）：
     · 有记忆 → 只认上次那台；它没上线就什么都不选、等用户手动切（不替选）；
     · 无记忆（首次使用 / 记忆已作废）→ 名册里有在线的就自动接管第一台
       （帮用户选好，不再出现「连接成功却会话全空」）。 */
  const heard = Object.keys(S.servers).filter(n => S.servers[n].ts);
  if (heard.length){ setCur(heard[0]); enterCur(); }
}
function enterCur(){
  flash('已选择服务端 [' + S.cur + ']', 'var(--blue)');
  applySrvEntry();                           // 载入其缓存状态
  sendJson({t: 'hello'});                    // 拉即时全量
  helloWatch();                              // 1.14：快照看门狗
}
function setCur(nm){
  S.cur = nm;
  try {
    if (nm) localStorage.setItem(LS_SRV, nm);
    else localStorage.removeItem(LS_SRV);
  } catch(e){}
  /* 2.25：切操控服务端=真实人类操作 → actSend('click')（闸门见 通用工具.js） */
  if (nm) actSend('click');
}
/* 1.14：切换后快照看门狗——hello 应答经中继可能丢，3 秒内没等到
   快照就重发 hello（最多 5 次），别让「正在连接」一直卡着。
   点当前已操控的服务器本就直接忽略（switchSrv 入口 nm===S.cur
   return，1.13 已如此），不会触发多余动作。 */
let _hello_tm = 0, _hello_n = 0;
function helloWatch(){
  clearTimeout(_hello_tm); _hello_n = 0;
  const tick = () => {
    if (!S.cur || !S.onLine) return;
    if (S.snap && Object.keys(S.snap).length) return;  // 快照已到
    if (++_hello_n > 5) return;
    sendJson({t: 'hello'});
    _hello_tm = setTimeout(tick, 3000);
  };
  _hello_tm = setTimeout(tick, 3000);
}
function switchSrv(nm){
  if (!S.servers[nm] || nm === S.cur) return;
  /* 1.13：切走前向旧目标显式还锁（ctl_free），不等超时自动释放 */
  if (S.cur && S.onLine) sendJson({t: 'ctl_free'});
  exitFmsg();                  /* 1.14：换目标先退出历史全屏 */
  setCur(nm);
  /* 换操控对象：旧目标的界面状态全部作废 */
  S.snap = {}; S.convs_key = null; S.msgs_key = null;
  S.pending = []; switchAbort();
  /* 2.65：换服务端＝换一整套「会话世界」——把【锚定 + 本地历史 + 切换在途帧】
     一并清空。原实现只清了 S.snap，anchorSid 仍指着旧服务器的会话：新服务端
     快照到达时 adoptSnap 见 anchorSid 非空 → 不吸附，且判「锚定会话已消失」
     把正文冻成旧（空）值 → 一直白屏、列表也没选中，用户每次过去都得手点会话
     （用户 2026-10-07 反馈）。清锚后，新服务端广播来的「当前选中会话」
     （convs 行第 3 位选中标志）即被 adoptSnap 自动吸附并打开＝一过去就有对话。 */
  S.anchorSid = ''; S.anchorTitle = ''; S.anchor_gone = '';
  S.histConv = ''; S.histMsgs = null; S.histRaw = [];
  S.histVer = 0; S.histHave = 0; S.histLoadingPrev = false;
  S.histEnd = false; S.histPullFrom = 0;
  S.livePend = ''; S.liveGot = false; S.liveFrame = null; S.livePrefetch = false;
  S.pinBottom = true;              /* 新会话自动上屏那次钉底（看最新） */
  S.busy = false; S.model_busy = false;
  S.points = '—'; el.points.textContent = '积分 —';
  S.alive = new Set(); S.boxes = [];
  el.model.innerHTML = ''; S.model_map = {};
  el.box.innerHTML = '';
  S.box = '(未连接)'; S.port = 0;
  el.convs.innerHTML = '';
  el.msgs.innerHTML = '<div class="empty">（正在连接 ' + esc(nm)
                     + ' …）</div>';
  renderAttach([]);
  applySrvEntry();
  sendJson({t: 'hello'});
  helloWatch();                             /* 1.14：快照看门狗 */
  renderTop(); renderSrvList();
  flash('已切换操控 [' + nm + ']', 'var(--blue)');
}
function applySrvEntry(){
  /* 用名册缓存恢复当前服务端的基础状态（hello 应答再补全） */
  const s = S.servers[S.cur];
  if (!s) return;
  if (s.boxes && s.boxes.length){
    S.boxes = s.boxes;
    el.box.innerHTML = '';
    for (const b of s.boxes){
      const o = document.createElement('option');
      o.value = b; o.textContent = b;
      el.box.appendChild(o);
    }
  }
  if (s.alive){ S.alive = new Set(s.alive); renderPorts(); }
  if (s.box && s.port && s.box !== S.box) applySwitch(s.box, s.port);
}
function pruneSrv(){
  const now = Date.now();
  let changed = false;
  for (const nm of Object.keys(S.servers)){
    const s = S.servers[nm];
    if (now - (s.seen || 0) > SRV_TTL){          /* v1.84：超 7 天未出现→清名册 */
      delete S.servers[nm]; changed = true; continue;
    }
    if (s.ts && now - s.ts > 75000 && s.conn !== false){
      s.conn = false; changed = true;            /* v1.84：无心跳→标离线，名册保留 */
    }
  }
  if (_srv_dirty){ _srv_dirty = false; _srv_save_tm = now; saveSrvs(); }
  if (changed){
    if (!S.cur || !S.servers[S.cur]) pickCur();
    renderSrvList(); renderTop();
  }
}
setInterval(pruneSrv, 5000);
/* 1.13：操控续占心跳——停留在当前操控对象就每 20s 续一次锁
   （服务端默认 60 秒无操作释放；不发心跳即视为离开）
   v1.32：仅登录态才续占——后台/闲置已退出登录就不再占着锁，
   也不再产生流量 */
setInterval(() => {
  if (loggedIn && S.onLine && S.cur) sendJson({t: 'ctl_hb'});
}, 20000);

function renderTop(){
  const s = S.servers[S.cur];
  const on = s && s.conn;
  el.srv.textContent = '操控:' + (S.cur || '—') + (on ? ' ●' : ' ○');
  el.srv.style.color = on ? 'var(--green)' : 'var(--gray)';
}
function renderSrvList(){
  el.srvlist.innerHTML = '';
  const names = Object.keys(S.servers).sort();
  if (!names.length){
    const d = document.createElement('div');
    d.className = 'dmi';
    d.textContent = '（暂无服务端，等待上线…）';
    d.style.color = 'var(--gray)';
    el.srvlist.appendChild(d);
    return;
  }
  let remembered = '';
  try { remembered = localStorage.getItem(LS_SRV) || ''; } catch(e){}
  for (const nm of names){
    const s = S.servers[nm];
    const d = document.createElement('div');
    const isCur = nm === S.cur;
    const isRem = !S.cur && nm === remembered;   /* v1.84：标出上次选中的那台 */
    d.className = 'dmi' + (isCur ? ' on' : '');
    /* 1.86：每台左侧紧凑删除按钮（✕，黑白灰）——只删本地落盘与内存；该
       服务端若仍在广播，下次心跳会重新被发现并再次自动落盘（专治僵尸服务器）。 */
    const del = document.createElement('span');
    del.textContent = '✕';
    del.style.cssText = 'display:inline-block;width:18px;height:18px;line-height:16px;'
      + 'text-align:center;font-size:12px;color:var(--gray);border:1px solid var(--gray);'
      + 'border-radius:4px;margin-right:6px;cursor:pointer;vertical-align:middle;'
      + 'opacity:.75;user-select:none;';
    del.onclick = (ev) => { ev.stopPropagation(); delSrv(nm); };
    d.appendChild(del);
    /* 1.86：当前默认操控的那台（S.cur）在条目上打 ⭐（表示默认/常用，用户规定） */
    if (isCur){
      const st = document.createElement('span');
      st.textContent = '⭐';
      st.style.cssText = 'font-size:13px;margin-right:3px;vertical-align:middle;';
      d.appendChild(st);
    }
    const na = (s.alive || []).length,
          nb = (s.boxes || []).length;
    const tx = document.createElement('span');
    tx.textContent = (s.conn ? '● ' : '○ ') + nm
                  + (nb ? '（在线 ' + na + '/' + nb + '）' : '')
                  + (isRem ? '（上次）' : '')
                  + (s.lock && s.lock.mine === false
                     ? ' 🔒' + (s.lock.id || '被占用') : '');
    d.appendChild(tx);
    if (isCur) d.style.color = 'var(--blue)';
    d.onclick = () => { drawerClose(); switchSrv(nm); };
    el.srvlist.appendChild(d);
  }
}
/* 1.86：删除名册条目（✕ 按钮）——只删本地落盘与内存；若服务端仍在广播，
   下次心跳会重新被发现并再次自动落盘（期望行为）。删的正是当前默认操控的
   那台就清掉记忆（setCur(null)）并重新走 pickCur：无记忆则自动接管第一台
   在线，无在线则什么都不选。 */
function delSrv(nm){
  if (!S.servers[nm]) return;
  delete S.servers[nm];
  saveSrvs();
  if (S.cur === nm) setCur(null);
  if (!S.cur || !S.servers[S.cur]) pickCur();
  renderSrvList(); renderTop();
}
el.srv.onclick = () => { drawerOpen(); renderSrvList(); };
/* 2.48：刷新服务端——服务端平时全程静默、互不报状态；只有本按钮主动
   点名（who）时，在线的服务端才应答「我在线」。foxSend 直发纯频道广播
   （不带 to），保证点名发给频道内所有服务端；中继偶发丢帧，1.5s 补点一次。 */
function refreshSrvs(){
  if (!S.onLine){ flash('未连接中继，稍后再刷', 'var(--orange)'); return; }
  foxSend(JSON.stringify({t: 'who'}));
  setTimeout(() => { if (S.onLine) foxSend(JSON.stringify({t: 'who'})); }, 1500);
  flash('已点名，等待在线服务端应答…', 'var(--blue)');
}
el.srvrefresh.onclick = () => refreshSrvs();

