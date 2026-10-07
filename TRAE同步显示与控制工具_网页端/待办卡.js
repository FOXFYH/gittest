'use strict';
function pendSig(){
  return S.pending.map(p => p.id + ':' + p.state).join(',');
}

/* 1.27：提问卡指纹——问题文本+选项文案+选中态+主按钮，任一变化
   都要触发重画并解除单选锁 */
function askFp(a){
  if (!a || !a.opts || !a.opts.length) return '';
  return (a.q || '') + '#' + a.opts.map(o =>
    (o.other ? '◇' : '') + (o.t || '') + (o.sel ? '*' : '')
  ).join('|') + '#' + (a.btn || '');
}

function pendAdd(kind, text){
  if (!text || kind === 'switch') return null;   /* 1.10：切换走提示条，绝不进气泡 */
  const same = S.pending.find(p => p.text === text);
  if (same) return same;               // 同文本已在册（服务端 pend 回显）
  S.pend_seq++;
  /* 1.27：占位挂到发起时的会话上——插话/发送只对当时那个对话有效，
     切到别的对话期间不再显示（切回来仍可见，落地后照常撤下） */
  const p = {id: S.pend_seq, kind: kind, text: text,
             state: 'sending', ts: Date.now(), conv: curTitle(),
             /* 2.16：记稳定 sid（改名/重排不变）。本专项 C1：以【锚定 sid】
                为准——发起时网页版锚定哪个会话，卡就挂哪个会话（绝不按标题猜）。 */
             convSid: S.anchorSid || curSid()};
  S.pending.push(p);
  return p;
}

function pendStat(p){
  /* 1.83：叫法改口径——原「排队中…」名不副实（我们这边没有自建待发
     队列，命令连上 WS 就直接投给服务端执行；唯一的"队"是 TRAE 官方
     排队条）。现在一律按「卡在哪一环」说人话，用户实测后拍板。 */
  if (p.state === 'typed')   return ['已输入 TRAE…', ''];
  if (p.state === 'queued')  return ['已进 TRAE 官方排队条，等待 AI 处理…', 'ok'];
  if (p.state === 'sent')    return ['服务器已执行，等待聊天记录浮现…', 'ok'];
  /* 1.25：占位不再自动超时（插话等多久都正常）；timeout 仅剩
     历史残留兼容，文案不再写死 15 秒 */
  if (p.state === 'timeout') return ['⚠ 可能未送达（可丢弃/改写/重发）', 'bad'];
  /* sending：send 与 interject 同义——都是「已交给服务端，等它动手」 */
  return ['已发出，等待服务器执行…', ''];
}

function renderPending(){
  const old = $('pendbox');
  if (old) old.remove();
  if (!S.pending.length) return;
  /* 1.27：只显示属于当前会话的占位（其余仍挂在册，切回原会话
     照常显示；无会话信息的旧数据一律显示） */
  const cv = curTitle();
  /* 2.16：能拿到 sid 就按稳定 ID 比（改名/重排不丢卡）；拿不到 sid 的
     旧卡片回退原「标题 / 当前会话 / 无 conv」逻辑，不判死旧数据 */
  const sidNow = S.anchorSid || curSid();   /* 本专项 C2：锚定 sid 为准 */
  const shown = S.pending.filter(p => {
    if (p.convSid && sidNow) return p.convSid === sidNow;
    return !p.conv || p.conv === cv || p.conv === '当前会话';
  });
  if (!shown.length) return;
  const wrap = document.createElement('div');
  wrap.id = 'pendbox';
  shown.forEach(p => {
    const st = pendStat(p);
    const d = document.createElement('div');
    d.className = 'msg user pend ' + st[1];
    let h = '<div class="who">我<span class="pstat">' + esc(st[0])
          + '</span>';
    /* 1.83：出口恒亮——服务端"耳聋"（命令已发出却一个回执都收不到）时
       卡片会永久停在中间态（1.25 起刻意无自动超时），原来按钮只在
       timeout 态出现，用户看到的就是"卡住且无按钮、只能干等"。现在：
       · 📋复制 / ✎改写 / 🗑丢弃 —— 任何状态恒显（随时能拷、能撤下来改、扔掉）；
       · 🔁重发 —— 只在服务端尚未确认接收的态显示（已发出/已输入/未确认）；
         sent（服务端已点发送）/queued（已进官方排队条）说明 TRAE 侧已收到，
         再发会多出一份，故不给。
       1.40：复制自 1.40 起恒显，本次连改写/丢弃一起恒显。 */
    let canGo = (p.state === 'sending' || p.state === 'typed'
                 || p.state === 'timeout');
    h += '<span class="pacts"><button class="pendbtn cp" data-cp="'
       + p.id + '">📋 复制</button>'
       + '<button class="pendbtn ed" data-edit="' + p.id + '">✎ 改写</button>';
    if (canGo)
      h += '<button class="pendbtn go" data-go="' + p.id + '">🔁 重发</button>';
    h += '<button class="pendbtn drop" data-drop="' + p.id
       + '">🗑 丢弃</button></span>';
    h += '</div><div class="body">' + esc(p.text) + '</div>';
    d.innerHTML = h;
    wrap.appendChild(d);
  });
  wrap.querySelectorAll('.pendbtn').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const gi = parseInt(b.dataset.go || '0');
      const di = parseInt(b.dataset.drop || '0');
      const ei = parseInt(b.dataset.edit || '0');
      const cpi = parseInt(b.dataset.cp || '0');   // 1.40：复制占位文字
      if (cpi){
        const p = S.pending.find(x => x.id === cpi);
        if (p && p.text) copyText(p.text);
        return;
      }
      if (ei){                       // 1.24：改写 = 撤占位 + 回填输入框
        const p = S.pending.find(x => x.id === ei);
        if (!p) return;
        S.pending = S.pending.filter(x => x.id !== ei);
        el.ent.value = p.text || '';
        refreshSendBtn();
        try { el.ent.focus(); } catch(e2){}
        renderAll();
        flash('已撤回，可修改后重新发送', 'var(--blue)');
        return;
      }
      if (di){                       // 丢弃：撤下占位即可
        S.pending = S.pending.filter(x => x.id !== di);
        renderAll();
        return;
      }
      const p = S.pending.find(x => x.id === gi);
      if (!p) return;
      S.pending = S.pending.filter(x => x.id !== gi);
      /* 2.16：重发锁定原会话 sid——即使用户已切到别的会话，也回原会话 */
      cmd(p.kind, p.text, p.convSid);
    };
  });
  el.msgs.appendChild(wrap);
  el.msgs.scrollTop = el.msgs.scrollHeight;
}

/* ============ 1.88：对话 ID 核对消卡（替代旧的「同文本/前 N 字」识别） ============
   用户 2026-09-29 规定：客户端发出去的对话自带 10 位随机数字对话 ID
   （did，仅用于核对小卡片、绝不污染对话正文）；当收到的广播里出现
   这个 ID（说明服务端已接收：出现在对话记录或托管排队里）→ 直接消卡。
   旧的「识别相同文本」「识别前多少个字」（pendHead100/pendContains/
   normTxt 及 pendReconcile 里的 msgs/排队条文本比对）**全部移除**——
   不再凭内容猜，只凭 did 精确核对。
   兼容：旧版服务端不广播 did 回执 → 本端卡片到 PEND_DID_TMO 后转
   「⚠ 可能未送达」兜底（见 pendReconcile），不永久悬挂。 */

/* 1.88：兜底超时——旧服务端不广播 did_ack 时，卡片转「⚠ 可能未送达」。
   本专项 C3/R8：兜底时长由 60 秒延长到 12 小时——用户口径「卡片绝不早撤」，
   宁可久挂也不让「我发的话」凭空消失（服务端 did 池同步扩到 12 小时）。 */
const PEND_DID_TMO = 12 * 3600 * 1000;

/* 1.88：按 did 精确撤卡——广播里出现本卡 did（服务端 did_ack 回执）
   即认为「服务端已接收」，立即撤下。返回 true 表示有变化需重画。
   兼容：d && d.did 式判断，旧数据/旧广播没有 did 也不会崩。 */
function pendClearByDid(did, sid){
  if (!did) return false;
  let changed = false;
  const keep = [];
  S.pending.forEach(p => {
    if (p.did && p.did === did){
      /* 本专项 C3/B6：回执带 sid 时只销「同一会话」的卡——别会话的 did
         绝不误销本会话的卡（旧实现只比 did，存在跨会话误销风险）。 */
      if (sid && p.convSid && p.convSid !== sid){ keep.push(p); return; }
      changed = true; return;                                 /* 命中即撤 */
    }
    keep.push(p);
  });
  if (changed) S.pending = keep;
  return changed;
}

/* 占位卡生命周期检查（快照到达/定时巡检调用）。
   1.88：旧的「同文本用户消息出现 → 撤下它」文本比对全部移除，
   消卡只走 did_ack（pendClearByDid）；本函数只剩两件事：
   ① 清理误入气泡的 switch 残留（会话标题不在消息区，文本匹配
      永远失败，属历史残留清理，与内容识别无关）；
   ② 兜底超时——PEND_DID_TMO 内没收到 did 回执（对端是旧版服务端
      不广播 did_ack，或消息真没送达）→ 卡片转「⚠ 可能未送达」，
      用户可重发/丢弃，不永久悬挂。 */
function pendReconcile(_msgs){
  if (!S.pending.length) return false;
  const now = Date.now();
  let changed = false;
  const keep = [];
  S.pending.forEach(p => {
    if (p.kind === 'switch'){          /* 1.10：切换占位不进气泡，
        旧版误入的残留直接清掉（文本匹配永远失败） */
      changed = true;
      return;
    }
    /* 2.30：兜底核对——50 秒还没收到回执（广播可能丢），主动向
       服务端问一次该 did 受理没有；已受理→补发 did_ack 消卡，
       未受理→did_miss 转「可能未送达」。只问一次不刷屏。 */
    const _age = now - (p.ts || now);
    if (p.state !== 'chk_sent' && p.state !== 'timeout'
        && _age > 50000 && _age <= PEND_DID_TMO){
      p.state = 'chk_sent';
      sendJson({t:'chk', did:p.did});
      changed = true;
    }
    /* 1.88：did 回执未到且超时 → 标「可能未送达」（旧服务端兼容兜底） */
    if (p.state !== 'timeout' && _age > PEND_DID_TMO){
      p.state = 'timeout';
      changed = true;
    }
    /* 本专项 C3/R7：卡所属对话已不存在 → 卡片不消失，只弹一次提醒
       （复用 📋 复制善后），文本仍可留存。 */
    if (pendOrphanWarn(p)) changed = true;
    keep.push(p);
  });
  if (changed) S.pending = keep;
  return changed;
}

/* 1.88：兜底超时巡检——不依赖快照到达也会到点转「可能未送达」 */
function pendTick(){
  if (S.pending.length && pendReconcile(null)) renderAll();
  pendIdbSync();                        /* 本专项 C1：占位卡镜像落 IDB（5s 一次） */
}
setInterval(pendTick, 5000);

/* 切换在途：会话切换要等 0.8~6s（含最小化恢复），期间给个明确的
   「正在切换…」条，免得旧会话内容留着让人以为点错了。
   1.16：TRAE 先点亮会话标题、后加载正文——仅凭「目标项已激活」
   撤条会提前放行。现记录切换前的消息指纹，快照消息内容真的变了
   （正文到达）才算切换完成；状态栏同步强制「正在切换」。 */
function msgsFp(msgs){
  return (msgs || []).map(m => m[0] + ':' + m[1] + ':'
    + (m[3] || 0) + (m[4] || 0)).join('#');
}
/* ── 2.67 切换过程状态机（2026-10-07 用户定）──
   原实现只有一个 S.switch_pend，从「一点」糊到「切完」，看不出究竟是在连
   WS、在等服务器回话、还是在真的切。现拆成可分辨的分档，反映真实过程：
     connecting → waiting → switching → ok / fail
   · connecting：本端 WS 没连上中转 → 「正在连接 WS…」（连上后自动补发）
   · waiting   ：命令已发出，未收到服务器 switch_ack → 「等待服务器回应…」
   · switching ：已收 switch_ack → 「正在切换中…」
   · ok        ：已收 switch_ok（或兜底判到达）→ 「切换成功」，2s 后交回状态灯
   · fail      ：switch_fail 或满 60s 无 ok → 「切换失败」
   期间每 10s 补发一次同一 switch 命令（服务端同目标幂等），满 60s 判失败。 */
const SWITCH_RESEND_MS  = 10000;   /* 每 10s 补发一次切换命令（幂等） */
const SWITCH_TIMEOUT_MS = 60000;   /* 满 60s 未成功 → 判失败 */
const SWITCH_OK_SHOW_MS = 2000;    /* 「切换成功」闪现时长，随后交回状态灯 */
const SWITCH_HANG_MS = SWITCH_TIMEOUT_MS;   /* 兼容旧引用（原 24s 墙钟兜底） */

/* 在途切换的目标 ref（稳定 ID 优先，其次序号）——补发用 */
function switchRef(){
  const sp = S.switch_pend;
  if (!sp) return 0;
  return (sp.ref !== undefined && sp.ref !== null && sp.ref !== '')
    ? sp.ref : (sp.sid || 0);
}
/* 目标匹配：双方都有 sid 按 sid，否则按 title（服务端回执可能只带其一） */
function _swMatch(sp, v){
  if (!sp || !v) return false;
  if (sp.sid && v.sid) return sp.sid === v.sid;
  if (sp.title && v.title) return sp.title === v.title;
  return true;
}
/* 重置「补发 + 60s 超时」两只定时器（进入 waiting/switching 或收到回执时调） */
function switchReArm(){
  const sp = S.switch_pend; if (!sp) return;
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT);
  sp._tmoT = setTimeout(switchTimeout, SWITCH_TIMEOUT_MS);
  if (sp.phase === 'waiting' || sp.phase === 'switching')
    sp._resendT = setTimeout(switchResend, SWITCH_RESEND_MS);
}
function switchResend(){
  const sp = S.switch_pend; if (!sp) return;
  if (sp.phase !== 'waiting' && sp.phase !== 'switching') return;
  sendCmd('switch', switchRef());       /* 补发（服务端同目标幂等，不会重复点） */
  sp.ts = Date.now();
  switchReArm();
}
function switchTimeout(){
  const sp = S.switch_pend; if (!sp || sp.phase === 'ok') return;
  switchFail(sp.title);                 /* 满 60s 未成功 → 宣布失败 */
  switchClear();
}
/* 成功收口：显示「切换成功」2 秒，然后交回当前状态灯（用户：成功不常驻） */
function switchOk(){
  const sp = S.switch_pend; if (!sp) return;
  clearTimeout(sp._okT);
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT);
  if (sp.phase !== 'ok'){
    sp.phase = 'ok';
    flash('切换成功', 'var(--green)');
  }
  renderAll();
  sp._okT = setTimeout(function(){
    if (S.switch_pend === sp) switchClear();
  }, SWITCH_OK_SHOW_MS);
}
/* 清在途（成功闪现结束 / 失败 / 换目标时调） */
function switchClear(){
  const sp = S.switch_pend; if (!sp) return false;
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT); clearTimeout(sp._okT);
  S.switch_pend = null;
  renderAll();
  return true;
}
/* 只清不渲染（换服务端/命令报错等自己会重画的地方用） */
function switchAbort(){
  const sp = S.switch_pend; if (!sp) return false;
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT); clearTimeout(sp._okT);
  S.switch_pend = null;
  return true;
}
function pendSwitchSet(title, sid, ref){
  title = title || ''; sid = sid || '';
  /* 1.10：同目标幂等（本地点击与服务端广播都会调，刷新计时即可，
     不重复渲染）；v1.95：有稳定 ID 时按 ID 判同目标（改名也算同一目标） */
  const same = S.switch_pend && (sid && S.switch_pend.sid
      ? S.switch_pend.sid === sid
      : S.switch_pend.title === title);
  if (same){
    S.switch_pend.ts = Date.now();
    S.switch_pend.sid = sid || S.switch_pend.sid;
    if (ref !== undefined) S.switch_pend.ref = ref;
    fullsCheckRearm(title);             /* 1.xx：重启 15s 判空 */
    switchReArm();                      /* v2.67：重置补发/超时 */
    return;
  }
  S.switch_pend = {title: title, sid: sid,
                   ref: (ref !== undefined ? ref : (sid || 0)),
                   ts: Date.now(), fp0: msgsFp(S.snap.msgs),
                   phase: S.onLine ? 'waiting' : 'connecting'};
  fullsCheckRearm(title);               /* 1.xx：切换即起 15s 判空定时 */
  switchReArm();                        /* v2.67：起补发/超时 */
  renderAll();
}
/* 1.xx：被动「切换后 15s 内容仍空」检测——到点若还在切换中且消息区空、
   WS 连通，弹确认框问是否查询最大化压制；用户确认才发 check_fulls
   （每切换只问一次，不自动查）。 */
const FULLS_CHECK_DELAY = 15000;
function fullsCheckRearm(title){
  clearTimeout(S._fullsCheckTimer);
  S._fullsCheckTimer = setTimeout(() => fullsCheckFire(title),
                                  FULLS_CHECK_DELAY);
}
function fullsCheckFire(title){
  if (!S.switch_pend || S.switch_pend.title !== title) return;  // 已落地/已切换
  const empty = !(S.snap.msgs || []).length
    && !(el.msgs && el.msgs.querySelector('.msg'));
  if (!empty) return;                    // 内容已到，不打扰
  if (!S.onLine) return;                 // 仅 WS 连通时才问（网络正常前提）
  confirmFulls(
    '切换对话超过 15 秒仍未载入内容，是否查询是否有窗口最大化/全屏压制原版渲染？',
    () => sendCmd('check_fulls'));
}
/* 2.67：旧名保留为别名（切在途清理由 switchClear 统一收口，含定时器） */
function pendSwitchClear(){ return switchClear(); }

/* ========== 1.xx：最大化/全屏预警条 ========== */
const FULLS_LATER = 15 * 60 * 1000;    // 稍后提醒：15 分钟后再提醒
const FULLS_QUIET = 6 * 60 * 60 * 1000; // 近期不要再提醒：6 小时内不再提醒
function fullsShow(msg){
  if (Date.now() < S.fulls_snooze) return;   // 静默期内忽略新预警
  S.fulls_show = true;
  el.fsw_txt.textContent = msg || '';
  el.fsw.style.display = 'flex';
}
function fullsHide(){
  S.fulls_show = false;
  el.fsw.style.display = 'none';
}
function fullsLater(){                     // 稍后提醒：静默 15 分钟
  S.fulls_snooze = Date.now() + FULLS_LATER;
  fullsHide();
}
function fullsQuiet(){                     // 近期不再提醒：静默 6 小时
  S.fulls_snooze = Date.now() + FULLS_QUIET;
  fullsHide();
}
/* 1.xx：通用确认弹窗（轻量覆盖层）——onOk 为空安全。 */
function confirmFulls(msg, onOk, okLabel){   /* 本专项 C3：主按钮文案可定制 */
  const old = $('fconfirm');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'fconfirm';
  ov.style.cssText = 'position:fixed;inset:0;z-index:95;background:'
    + 'rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:12px;max-width:320px;'
    + 'width:88%;padding:16px 16px calc(14px);box-sizing:border-box;';
  const txt = document.createElement('div');
  txt.style.cssText = 'font-size:14px;line-height:1.6;color:#222;margin-bottom:14px;';
  txt.textContent = msg;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';
  const mk = (label, cls, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'min-height:36px;padding:4px 14px;border-radius:8px;'
      + (cls ? 'border-color:var(--blue);background:var(--blue);color:#fff;'
             : 'color:var(--gray);');
    b.onclick = () => { ov.remove(); if (fn) fn(); };
    return b;
  };
  row.appendChild(mk('取消', '', null));
  row.appendChild(mk(okLabel || '查询', 'primary', onOk));
  box.appendChild(txt); box.appendChild(row); ov.appendChild(box);
  document.body.appendChild(ov);
}

/* ===== 2.20 新架构：本地缓存（骨架+历史）+ 双版本号失效 + 请求式历史 =====
   骨架：localStorage 秒出会话列表；历史：localStorage 秒出当前会话消息。
   双版本号键 = '网页VER|服务端VER'（hello.d.ver），任一变化即清空重下。
   请求式历史：发 {t:'req',id,c:'hist'|'hist_prev',...} → {t:'res',id,k,v}。
   直播仍走快照（snap 每拍全文），缓存只在快照未到达前兜底秒显。 */

/* ============ 本专项 C1/C3：占位卡 IndexedDB 持久化与善后 ============
   与快照同库 trae_webm_idb 的 snap_pend 表（keyPath='did'）——跨刷新/跨切号
   不丢卡。镜像策略：每 5 秒把「带 did 的卡」整表重写（单写者，不互抢）。 */
function pendIdbSync(){
  const rows = (S.pending || []).filter(p => p.did).map(p => ({
    did: String(p.did), convSid: p.convSid || '', conv: p.conv || '',
    text: p.text || '', state: p.state || 'sending', ts: p.ts || Date.now()
  }));
  _idbReq('snap_pend', 'readwrite', st => {
    st.clear();
    rows.forEach(r => st.put(r));
    return null;
  }).catch(() => {});
}
function pendIdbLoad(){
  return _idbReq('snap_pend', 'readonly', st => st.getAll()).then(rows => {
    (rows || []).forEach(r => {
      if (!r || !r.did) return;
      if (S.pending.some(x => x.did === r.did)) return;
      S.pend_seq++;
      S.pending.push({id: S.pend_seq, kind: 'send', text: r.text || '',
                      state: r.state || 'sending', ts: r.ts || Date.now(),
                      conv: r.conv || '', convSid: r.convSid || '',
                      did: r.did});
    });
    if (S.pending.length) renderAll();
  }).catch(() => {});
}
/* 本专项 C3/R7：卡所属对话已不存在 → 卡片不消失，只弹一次提醒 */
function pendOrphanWarn(p){
  if (p.orphan_warned) return false;
  const cv = (S.snap && S.snap.convs) || [];
  if (!p.convSid || !cv.length) return false;          /* 列表未知：不判，免误报 */
  if (cv.some(r => r && r[0] === 'c' && (r[4] || '') === p.convSid)) return false;
  p.orphan_warned = true;
  confirmFulls('占位卡所属对话「' + (p.conv || '（未知）')
    + '」已不存在。卡片文本仍然保留，可复制留存。',
    () => copyText(p.text), '复制文本');
  return false;                                        /* 卡片不消失 */
}
/* 本文件早于 缓存.js 加载，_idbReq 尚未就绪 → 延后一拍再恢复存卡 */
setTimeout(pendIdbLoad, 1500);