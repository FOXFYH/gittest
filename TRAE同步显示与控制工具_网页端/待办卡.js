'use strict';
/* 待办卡.js（网页端）  2.145  V3.00 P4a/P4 2026-10-31（包E·网页端 UI 层）
   四-1 发送占位卡：点发送立刻挂卡（挂发送占位卡）→ 服务端「已入账」才撤卡
   （撤发送占位卡 / 转正式消息）→ 正式行由账本/快照渲染，前端不伪造消息行。
   旧的 DID 三渠道销卡（pendClearByDid / 快照自扫）保留兜底，二者互不冲突。 */
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
  /* v2.82（老板口径）：**只有网页版发出的消息才在网页版出占位卡**——判据＝
     正文首行是 14 位 DID（网页版发送时自动插入）；AI 借输入框发的消息不带
     DID，绝不出卡（根治现状混乱点）。 */
  const _did = firstLineDid(text);
  if (!_did) return null;
  /* v2.84（老板实测 · Bug C）：卡上只显示【真实会话内容】——剥掉首行 DID
     （它只是内部时间标记，非正文）；剥净后为空（只剩号码）⇒ 不建卡，杜绝
     「只有号码的单行卡」。 */
  const _body = stripHeadDid(text);
  if (!_body.trim()) return null;
  const same = S.pending.find(p => p.text === text);
  if (same) return same;               // 同文本已在册（服务端 pend 回显）
  S.pend_seq++;
  /* 1.27：占位挂到发起时的会话上——插话/发送只对当时那个对话有效，
     切到别的对话期间不再显示（切回来仍可见，落地后照常撤下） */
  const p = {id: S.pend_seq, kind: kind, text: text, body: _body, did: _did,
             state: 'sending', ts: Date.now(), conv: curTitle(),
             /* 2.16：记稳定 sid（改名/重排不变）。本专项 C1：以【锚定 sid】
                为准——发起时网页版锚定哪个会话，卡就挂哪个会话（绝不按标题猜）。 */
             convSid: curSid()};
  S.pending.push(p);
  return p;
}
/* ====== 2.145 四-1：发送占位卡三件套（包E·V3.00 P4a/P4 2026-10-31）======
   挂：点发送立刻挂卡（沿用 S.pending 体系渲染，不另起第二套卡片）；
   撤：服务端「已入账」到达才撤卡（tempId / id 精确匹配，不按文本猜）；
   转：正式消息由账本行渲染——本函数只做「撤同 mid 占位 + 归属登记」，
       绝不在前端伪造消息行。 */
/* 2.145：派工单 ① 写作「挂发送占位卡(tempId)」——本函数返回 tempId（卡片 id）；
   若调用方自带 tempId（第二参数），就沿用它（同一 id 已在册则拒绝，防重复挂卡）。 */
function 挂发送占位卡(text, tempId){
  if (!text) return null;
  if (tempId != null && Array.isArray(S.pending)
      && S.pending.some(p => p && String(p.id) === String(tempId))) return null;
  const p = _pe挂卡(text);
  if (!p) return null;
  if (tempId != null){ p.id = tempId; renderAll(); }
  return p.id;
}
/* 内部：建卡并返回卡片对象（对外只暴露 id） */
function _pe挂卡(text){
  const p = pendAdd('send', text);
  if (!p) return null;
  p.state = 'sending';
  renderAll();
  return p;
}
function 撤发送占位卡(tempId){
  if (tempId == null || !Array.isArray(S.pending)) return false;
  const n = S.pending.length;
  S.pending = S.pending.filter(p => !(p && String(p.id) === String(tempId)));
  if (S.pending.length === n) return false;
  renderAll();
  return true;
}
function 转正式消息(mid, text){
  mid = String(mid || '');
  if (!mid || !Array.isArray(S.pending)) return false;
  const n = S.pending.length;
  S.pending = S.pending.filter(p => !(p && p.mid && String(p.mid) === mid));
  const changed = S.pending.length !== n;
  if (changed) renderAll();
  return changed;
}
/* v2.84：占位卡展示/复制/改写用的【纯正文】——优先取建卡时剥好的 body 字段，
   老卡（IDB 恢复等无 body）现场剥首行 DID 兜底。 */
function pendBody(p){
  if (!p) return '';
  return (p.body != null) ? p.body : stripHeadDid(p.text);
}

function pendStat(p){
  /* 1.83：叫法改口径——原「排队中…」名不副实（我们这边没有自建待发
     队列，命令连上 WS 就直接投给服务端执行；唯一的"队"是 TRAE 官方
     排队条）。现在一律按「卡在哪一环」说人话，用户实测后拍板。
     2.85（老板口径）：占位卡＝这条消息的「语音小卡片」，分阶段走且每态
     绑真实信号，禁无信号播报——②「等待服务器回应…」(sending，仅本端已
     发出、服务端尚未回报任何阶段) / ③「服务器开始执行…」(typed，服务端
     已确认写入输入框) / 更后「已进官方排队条」「TRAE 已执行」只认服务端
     sent 事件推来的阶段；超时如实说「可能未送达」。 */
  if (p.state === 'accepted') return ['服务器已受理，等待执行…', ''];
  if (p.state === 'typed')   return ['服务器开始执行…（已输入 TRAE）', ''];
  if (p.state === 'queued')  return ['已进 TRAE 官方排队条，等待 AI 处理…', 'ok'];
  if (p.state === 'sent')    return ['TRAE 已执行，等待聊天记录浮现…', 'ok'];
  /* 2.90（老板夜间令 B10/C7）：接服务端 rcpt 的 ④ 终态——done 完成 / fail 失败
     （失败如实显示服务端 msg；配对按真 DID，见 事件总线.js onRcpt）。 */
  if (p.state === 'done')    return ['✅ 服务器已完成，等待聊天记录浮现…', 'ok'];
  if (p.state === 'fail')    return ['⚠ 服务器执行失败：'
                                    + (p.failMsg || '未知原因'), 'bad'];
  /* 1.25：占位不再自动超时（插话等多久都正常）；timeout 仅剩
     历史残留兼容，文案不再写死 15 秒 */
  if (p.state === 'timeout') return ['⚠ 可能未送达（可丢弃/改写/重发）', 'bad'];
  /* sending：send 与 interject 同义——本端已把命令交给服务端，但还没收到
     任何服务端阶段信号。2.85：如实只说「等待服务器回应…」，不再替服务端
     断言「已发出/已收进排队条」（那是服务端 sent 事件才有的阶段）。 */
  return ['等待服务器回应…', ''];
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
  const sidNow = curSid();   /* 本专项 C2：锚定 sid 为准 */
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
    /* 2.93（老板 2026-10-20 07:10）：占位卡补上老板自己的时间（取首行 DID 的
       14 位时间，见 通用工具.js didTimeOf），用专属元素 .ptm 且常显——不复用
       .tm（.tm 属普通消息行）。 */
    const _pTm = didTimeOf(p.did || p.text);
    let h = '<div class="who">我'
          + (_pTm ? '<span class="ptm">' + esc(_pTm) + '</span>' : '')
          + '<span class="pstat">' + esc(st[0]) + '</span>';
    /* 1.83：出口恒亮——服务端"耳聋"（命令已发出却一个回执都收不到）时
       卡片会永久停在中间态（1.25 起刻意无自动超时），原来按钮只在
       timeout 态出现，用户看到的就是"卡住且无按钮、只能干等"。现在：
       · 📋复制 / ✎改写 / 🗑丢弃 —— 任何状态恒显（随时能拷、能撤下来改、扔掉）；
       · 🔁重发 —— v2.84（老板 2026-10-19 追加）：**卡只要还在，就说明「销卡
         判断（三渠道）失败」**（正常消息一进官方排队条/对话记录即销卡）⇒
         一律给「重发」（此前只在 sending/typed/timeout 给，卡在 queued/sent
         就无路可走、只能干等）。重发按当前时间生成**新号码**并替换首行，
         首行恒只留最新一个（见 cmd 的 stripHeadDid）。
       1.40：复制自 1.40 起恒显，本次连改写/丢弃一起恒显。 */
    let canGo = true;
    h += '<span class="pacts"><button class="pendbtn cp" data-cp="'
       + p.id + '">📋 复制</button>'
       + '<button class="pendbtn ed" data-edit="' + p.id + '">✎ 改写</button>';
    if (canGo)
      h += '<button class="pendbtn go" data-go="' + p.id + '">🔁 重发</button>';
    h += '<button class="pendbtn drop" data-drop="' + p.id
       + '">🗑 丢弃</button></span>';
    h += '</div><div class="body">' + esc(pendBody(p)) + '</div>';
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
        /* v2.84：只复制真实正文（剥掉首行 DID）
           2.118（老板 2026-10-22 09:37/09:38）：再剥服务端追加的专属词前后缀与 FOX 小尾巴 */
        if (p) copyText(copyPlain(pendBody(p), true));
        return;
      }
      if (ei){                       // 1.24：改写 = 撤占位 + 回填输入框
        const p = S.pending.find(x => x.id === ei);
        if (!p) return;
        S.pending = S.pending.filter(x => x.id !== ei);
        el.ent.value = pendBody(p);   /* v2.84：回填纯正文（旧 DID 不再带回去，免重发叠时间） */
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
      /* 2.16：重发锁定原会话 sid——即使用户已切到别的会话，也回原会话。
         v2.84：只把【纯正文】交回 cmd（旧 DID 已剥），cmd 再打新 DID →
         首行恒为唯一 DID（Bug B）。 */
      cmd(p.kind, pendBody(p), p.convSid);
    };
  });
  el.msgs.appendChild(wrap);
  el.msgs.scrollTop = el.msgs.scrollHeight;
}

/* ============ v2.82：销卡改「首行 DID」硬数据（老板 2026-10-19 终极办法） ============
   网页版发送时把本机时间 14 位 `YYYYMMDDHHMMSS` **插入正文第一行** 作 DID；
   占位卡键＝(会话名, DID)。v2.83（老板口径）：销卡**三渠道任一命中 ⇒ 立刻
   销卡**（跳步，不死等「已发出」确认；**不再用 did_ack／相似度**）：
   ① 对话记录——本拍快照【人类的发言】首行抓到该 DID（网页端自扫，见 事件总线.js）；
   ② 官方排队条——本拍快照 v.pend 每项 t 首行抓到该 DID（同上，事件总线.js）；
   ③ 服务端广播 did_pool（最近 10 条由网页版发出、且已进流的 DID）。
   旧「按 did_ack 秒消 / 按文本前 N 字识别」（pendHead100/pendContains/normTxt
   及 pendReconcile 里的 msgs 文本比对）**全部作废**。 */

/* v2.82：占位卡**至少保留 24 小时**（与服务端 did_pool 池 25h TTL 对齐）；
   到期仍未销卡才转「⚠ 可能未送达」（卡片绝不早撤）。 */
const PEND_DID_TMO = 24 * 3600 * 1000;

/* v2.82：按 DID 撤卡——命中本卡 did 即撤（可选按会话名 conv 收紧，防跨会话
   误销）。返回 true 表示有变化需重画。 */
function pendClearByDid(did, conv){
  if (!did) return false;
  let changed = false;
  const keep = [];
  S.pending.forEach(p => {
    if (p.did && p.did === did){
      if (conv && p.conv && p.conv !== conv){ keep.push(p); return; }
      changed = true; return;                                 /* 命中即撤 */
    }
    keep.push(p);
  });
  if (changed) S.pending = keep;
  return changed;
}

/* 占位卡生命周期检查（快照到达/定时巡检调用）。
   v2.82：销卡**不再走 did_ack**（该回执整条作废）——销卡只认 ①本会话快照
   抓到首行 DID ②服务端 did_pool 池子（见 事件总线.js）。本函数只剩两件事：
   ① 清理误入气泡的 switch 残留；
   ② 兜底超时——PEND_DID_TMO（≥24h）内仍未销卡 → 转「⚠ 可能未送达」。 */
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
    /* v2.82：≥24h 仍未销卡 → 标「可能未送达」。卡片绝不早撤。 */
    const _age = now - (p.ts || now);
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
  /* 2.105（03-P4）：指纹改为【消息身份口径】——去掉 m[3]/m[4]（可否回退/删除）
     易变标志位，只看 角色(index0)+正文(index1)。旧拼法把标志位计入 ⇒ 标志一抖
     （无正文变化）即被当作「有更新」多触发一次落盘（与到达判定兜底）。 */
  return (msgs || []).map(m => m[0] + ':' + m[1]).join('#');
}
/* 2.93（老板 2026-10-20 07:09「切换成功瞬间闪出 A 的缓存」）：判断「这拍快照的
   正文是否仍属切换前旧会话 A」不再用 msgsFp（2.105 前它含 can_rev/can_del 易变标志，
   标志一抖就被误判成「正文已换＝到达」）。改看【消息身份】——首条消息的
   角色＋正文前 40 字（去空白）；会话真正换掉时首条完全变，A 只是追加/翻标志
   时首条不变 ⇒ 仍判「旧会话」。 */
function msgsHeadId(msgs){
  const a = msgs || [];
  if (!a.length) return '';
  const m = a[0] || [];
  return (m[0] || '') + ':' + String(m[1] || '').replace(/\s+/g, '').slice(0, 40);
}
function sameConvBody(msgs, prevMsgs){
  /* 未记旧正文（旧数据）→ 无法判定，返回 false（交由调用方回退 fp0 口径）。 */
  if (!Array.isArray(prevMsgs)) return false;
  const h0 = msgsHeadId(prevMsgs), h1 = msgsHeadId(msgs);
  if (!h0) return false;   /* 旧会话无正文 ⇒ 没有「旧内容」可误显 */
  return h1 === h0;
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
   期间 waiting 阶段保留一次兜底补发（服务端同目标幂等），满 60s 判失败。
   2.81：收到服务端 switch_ack（服务器已收到）后即【静默等待】，不再每 10s 补发——
   服务端切换实测要 15~30s，ack→ok 间隙 > 10s，旧逻辑会重复补发 4~5 条
   （点 1 次变 5 条且重复执行）。现仅在 waiting（尚未收到 ack）时兜底补发。 */
const SWITCH_RESEND_MS  = 15000;   /* 仅 waiting 阶段兜底补发间隔（2.81 放宽，原 10s） */
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
/* 重置「补发 + 60s 超时」两只定时器（进入 waiting 或收到回执时调）。
   2.81：补发只在 waiting 阶段武装；进入 switching（已收 ack）不再补发，
   仅保留 60s 超时兜底——实现「知道服务器已接收就安静等待」。 */
function switchReArm(){
  const sp = S.switch_pend; if (!sp) return;
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT);
  sp._tmoT = setTimeout(switchTimeout, SWITCH_TIMEOUT_MS);
  if (sp.phase === 'waiting')
    sp._resendT = setTimeout(switchResend, SWITCH_RESEND_MS);
}
function switchResend(){
  const sp = S.switch_pend; if (!sp) return;
  if (sp.phase !== 'waiting') return;   /* 2.81：仅 waiting 补发；收 ack 后静默 */
  sendCmd('switch', switchRef());       /* 补发（服务端同目标幂等，不会重复点） */
  sp.ts = Date.now();
  switchReArm();
}
function switchTimeout(){
  const sp = S.switch_pend; if (!sp || sp.phase === 'ok') return;
  switchFail(sp.title);                 /* 满 60s 未成功 → 宣布失败 */
  switchClear();
  /* 2.98（老板 2026-10-20 10:01「失败也继续锚定目标」）：超时＝失败，也【不】撤
     「直播帧覆盖」——保留目标会话本地存帧显示（收口在 switchClear，见下）。 */
}
/* 成功收口：显示「切换成功」2 秒，然后交回当前状态灯（用户：成功不常驻） */
function switchOk(){
  const sp = S.switch_pend; if (!sp) return;
  clearTimeout(sp._okT);
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT);
  if (sp.phase !== 'ok'){
    sp.phase = 'ok';
    /* 2.118（老板 2026-10-22 09:37）：成功吐司也带上是哪个对话，别让人干等还不知道切到谁 */
    const _nt = (sp.title || '').trim();
    flash('切换成功' + (_nt ? ' · ' + (_nt.length > 14 ? _nt.slice(0, 14) + '…' : _nt) : ''),
          'var(--green)');
  }
  /* 2.89（老板 2026-10-20）：成功收口【不】在此撤「直播帧覆盖」——服务端
     switch_ok 常先到、目标快照随后才到；若此刻就 liveClear 回落 curMsgs，会
     读到仍是 A 的快照正文（A/B 交叉闪现）。改由「目标正文真到达」那一刻
     （事件总线.js 快照分支）撤覆盖，或 switchClear（成功闪现 2s 后）兜底；
     失败/超时路径（switchTimeout/switchClear）仍保留撤覆盖（见 2.87 修复）。 */
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
  S.swHold = false;         /* 2.97：切换收口 → 松开持屏，回落真快照 */
  /* 2.98（老板 2026-10-20 10:01「失败也继续锚定目标」·与本文相反）：切换【失败】
     不再回退到切换前的旧会话 A——锚定保持在本目标会话，页面继续显示目标会话的
     本地存帧（保留目标锁，见下方 livePend 分支），直至目标真直播帧到达才收口。
     旧 2.89 的「失败回退 prevAnchor/prevMsgs」语义按新口径【删除】。 */
  /* 2.87：切换收口统一补一处——若「直播帧覆盖」仍置位则清除，让页面回落
     真快照（旧实现只有 事件总线.js「桌面选中行＝锚定」才会 liveClear，
     失败/超时、或桌面被后台投递/借框抢走时永不触发 ⇒ 页面被永久钉在旧
     本地存帧、上翻拉历史也被禁）。成功路径由「目标正文到达」先执行＝空操作。 */
  /* 2.91（老板夜间令 A3）：成功收口但【目标正文尚未到达】时不撤「直播帧锁」——
     服务端 switch_ok 走 _TeeQueue 立刻外发、目标快照随后才到，两帧可差数秒；
     此刻撤锁会回落 S.snap（正文仍属旧会话 A）⇒「切回后 +2s 仍显旧会话」。
     改由 事件总线.js「目标正文真到达」（liveKey===锚定）时撤覆盖；
     失败/超时（phase!=='ok'）与已到真帧（arrived）仍照常撤。
     2.93（老板 2026-10-20 07:09「切换成功瞬间又闪 A」）：「成功且 arrived」这一支
     再核一遍——若撤锁当下 S.snap 正文【仍属切换前旧会话 A】，宁可不撤（继续显示
     目标存帧 B），防 arrived 被误置后露出 A 的缓存；等 B 真帧到达那一拍再撤。 */
  const _snapStillOld = Array.isArray(sp.prevMsgs)
      && sameConvBody((S.snap || {}).msgs, sp.prevMsgs);
  /* 2.98：失败（phase!=='ok'）不再撤「直播帧覆盖」——保留目标存帧显示（失败也
     继续锚定目标）。仅【成功】且目标正文已到、且快照正文确已换掉旧会话 A 这一支撤锁。*/
  if (S.livePend && typeof liveClear === 'function'
      && sp.phase === 'ok' && sp.arrived && !_snapStillOld) liveClear();
  renderAll();
  return true;
}
/* 只清不渲染（换服务端/命令报错等自己会重画的地方用） */
function switchAbort(){
  const sp = S.switch_pend; if (!sp) return false;
  clearTimeout(sp._resendT); clearTimeout(sp._tmoT); clearTimeout(sp._okT);
  S.switch_pend = null;
  S.swHold = false;         /* 2.97：一并松开持屏 */
  return true;
}
function pendSwitchSet(title, sid, ref, opt){
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
  /* 2.89（老板 2026-10-20）：网页端自己点会话切换时带 opt——
       lockTarget=true：切换过渡期锁死目标（正文一律以目标帧为准，见 缓存.js
                        _liveLockOn / 事件总线.js）；
       prevAnchor/prevMsgs：切换前的锚定与正文，失败时回退用（见 switchClear）。 */
  S.switch_pend = {title: title, sid: sid,
                   ref: (ref !== undefined ? ref : (sid || 0)),
                   ts: Date.now(), fp0: msgsFp(S.snap.msgs),
                   phase: S.onLine ? 'waiting' : 'connecting',
                   lockTarget: !!(opt && opt.lockTarget),
                   arrived: false,
                   prevAnchor: (opt && opt.prevAnchor) || null,
                   prevMsgs: (S.snap && Array.isArray(S.snap.msgs))
                             ? S.snap.msgs.slice() : null};
  /* 2.106（老板 2026-10-20 17:29「切换即清屏」）：网页端自己发起的切换，
     【不再起「持屏」】（持屏＝刻意按住旧会话画面，正是「卡着当前的、卡很久」的根因）——
     立刻清屏留白，只等目标落地快照顶上；目标无存帧 ⇒ 一直留白。
     swHold 只在「目标落地快照已上屏之后」由 renderAll 置真（防中间态闪回）。 */
  if (S.switch_pend.lockTarget){
    S.swHold = false; S.liveFrame = null;            /* 2.106：不再起持屏阻止清屏 */
    S.swPPainted = false; S.swFrameReady = false;    /* 目标落地快照读取在途 → 清屏留白 */
  }
  fullsCheckRearm(title);               /* 1.xx：切换即起 15s 判空定时 */
  switchReArm();                        /* v2.67：起补发/超时 */
  /* 2.130（老板 2026-10-24）：本端点击切换带 deferRender ⇒ 这里不再先渲染一版
     空屏，直接由 snapIdbShow 用内存存帧一次性同步铺满（少一次重画、零白屏）；
     服务端广播等其它入口照旧立即重渲染。 */
  if (!(opt && opt.deferRender)) renderAll();
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
    () => srvOpSend('check_fulls', null, '查询全屏'));   // 2.109：②＋rcpt ③④
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
    () => copyText(copyPlain(pendBody(p), true)), '复制文本');
  return false;                                        /* 卡片不消失 */
}
/* 本文件早于 缓存.js 加载，_idbReq 尚未就绪 → 延后一拍再恢复存卡 */
setTimeout(pendIdbLoad, 1500);