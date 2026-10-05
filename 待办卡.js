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
             convSid: curSid()};   /* 2.16：同时记稳定 sid（改名/重排不变） */
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
  const sidNow = curSid();
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

/* 1.88：兜底超时——旧服务端不广播 did_ack 时，卡片 60 秒后转
   「⚠ 可能未送达」（用户规定的兜底口径：不能永远挂着）。 */
const PEND_DID_TMO = 60000;

/* 1.88：按 did 精确撤卡——广播里出现本卡 did（服务端 did_ack 回执）
   即认为「服务端已接收」，立即撤下。返回 true 表示有变化需重画。
   兼容：d && d.did 式判断，旧数据/旧广播没有 did 也不会崩。 */
function pendClearByDid(did){
  if (!did) return false;
  let changed = false;
  const keep = [];
  S.pending.forEach(p => {
    if (p.did && p.did === did){ changed = true; return; }   /* 命中即撤 */
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
    keep.push(p);
  });
  if (changed) S.pending = keep;
  return changed;
}

/* 1.88：兜底超时巡检——不依赖快照到达也会到点转「可能未送达」 */
function pendTick(){
  if (S.pending.length && pendReconcile(null)) renderAll();
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
const SWITCH_HANG_MS = 24000;   /* v2.13：切换等待上限——原 12s 偏短易误判「切换未完成」，
                                   翻倍为 24s（墙钟兜底撤条 + 快照判定超时共用此值） */
function switchHangClear(title){
  /* v1.51：撤条判定块只在 snap 到达时执行；但服务端对 snap 去重，
     目标内容静止时不再转发 → 判定块不再跑 → 「切换中」永挂。
     这里用真定时器到点强制撤条，兑现 L2746「超时兜底，别一直挂着」
     注释本意。正常切换在 24s 内走 snap 直接撤，不受影响。 */
  if (S._swHangTimer) clearTimeout(S._swHangTimer);
  S._swHangTimer = setTimeout(() => {
    if (S.switch_pend && S.switch_pend.title === title){
      /* 1.87：墙钟超时到点尚未确认到达 → 不再静默撤条，弹失败提醒
         （snap 可能因指纹去重不再转发、判定块不再跑，这里兜底提醒） */
      switchFail(title);
      S.switch_pend = null;
      renderAll();
    }
  }, SWITCH_HANG_MS);
}
function pendSwitchSet(title, sid){
  title = title || ''; sid = sid || '';
  /* 1.10：同目标幂等（本地点击与服务端广播都会调，刷新计时即可，
     不重复渲染）；v1.95：有稳定 ID 时按 ID 判同目标（改名也算同一目标） */
  const same = S.switch_pend && (sid && S.switch_pend.sid
      ? S.switch_pend.sid === sid
      : S.switch_pend.title === title);
  if (same){
    S.switch_pend.ts = Date.now();
    S.switch_pend.sid = sid || S.switch_pend.sid;
    fullsCheckRearm(title);             /* 1.xx：重启 15s 判空 */
    switchHangClear(title);             /* v1.51：重新 arm 24s 兜底 */
    return;
  }
  S.switch_pend = {title: title, sid: sid, ts: Date.now(),
                   fp0: msgsFp(S.snap.msgs)};
  fullsCheckRearm(title);               /* 1.xx：切换即起 15s 判空定时 */
  switchHangClear(title);               /* v1.51：24s 墙钟兜底拉条 */
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
function pendSwitchClear(){
  if (!S.switch_pend) return false;
  S.switch_pend = null;
  return true;
}

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
function confirmFulls(msg, onOk){
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
  row.appendChild(mk('查询', 'primary', onOk));
  box.appendChild(txt); box.appendChild(row); ov.appendChild(box);
  document.body.appendChild(ov);
}

/* ===== 2.20 新架构：本地缓存（骨架+历史）+ 双版本号失效 + 请求式历史 =====
   骨架：localStorage 秒出会话列表；历史：localStorage 秒出当前会话消息。
   双版本号键 = '网页VER|服务端VER'（hello.d.ver），任一变化即清空重下。
   请求式历史：发 {t:'req',id,c:'hist'|'hist_prev',...} → {t:'res',id,k,v}。
   直播仍走快照（snap 每拍全文），缓存只在快照未到达前兜底秒显。 */
