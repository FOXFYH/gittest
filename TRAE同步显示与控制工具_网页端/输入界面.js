'use strict';
/* 2.64：手势窗口——只有真实人类输入（触屏滑动 / 滚轮 / 按键）之后的短时间内，
   滚动才被当作「人滚的」。程序化滚动（innerHTML='' 把 scrollTop 夹回 0、
   scrollTop=savedTop、fprog）**不产生手势事件**，因而不可能被误判成
   「用户上翻找历史」——根治「切会话自动跳顶 + 进全屏 + 拉历史」。 */
var lastGestureAt = 0;
function markGesture(){ lastGestureAt = Date.now(); }
function clearGesture(){ lastGestureAt = 0; }
const GESTURE_WINDOW_MS = 1200;     // 一次手势后允许继续判定滚动的时长（覆盖惯性滑动）
function fprog(to){                 // 程序化滚动：静默期内不参与判定
  fLockUntil = Date.now() + 450;
  clearGesture();                   // 2.64：程序滚动 → 立刻作废手势窗口
  el.msgs.scrollTop = to;
}
/* 1.21：点输入框 → 手机键盘弹出 → 窗口 resize，#msgs 可视高度骤缩
   使距底距离瞬间超过进入门槛 → 被误判「在找历史」进了全屏、输入行
   被藏掉、根本无法打字。修复：① resize（键盘弹出/收起）静默 800ms；
   ② 输入框/文本域聚焦（正在打字）时不自动进全屏。 */
window.addEventListener('resize', () => {
  fLockUntil = Date.now() + 800;
});
function fTyping(){
  const ae = document.activeElement;
  return !!ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT');
}
/* 2.49：上滑到顶且已无更早记录时的提示（3 秒节流，避免滚动事件刷屏） */
function histEndFlash(){
  const now = Date.now();
  if (now - (S.histEndFlashT || 0) < 3000) return;
  S.histEndFlashT = now;
  flash('已经是最早记录了', 'var(--gray)', 2500);
}
function enterFmsg(){
  if (document.body.classList.contains('fmsg')) return;
  const m = el.msgs;
  const before = m.scrollTop, prevCH = m.clientHeight;
  document.body.classList.add('fmsg');
  /* 布局收窄后 #msgs 变高，补滚同高差保持视野不动（dist 不突变） */
  requestAnimationFrame(() => {
    fprog(before + Math.max(0, m.clientHeight - prevCH));
  });
  /* 1.72：进全屏不再弹 0.5s 悬浮窗/顶栏 flash——顶部 #fbar 横幅
     已常驻提示状态，避免两处重复提醒（用户要求只留横幅） */
}
function exitFmsg(){
  if (!document.body.classList.contains('fmsg')) return;
  document.body.classList.remove('fmsg');
  requestAnimationFrame(() => fprog(el.msgs.scrollHeight));
}
el.fexit.onclick = exitFmsg;
el.msgs.addEventListener('scroll', () => {
  if (Date.now() < fLockUntil) return;      // 1.19：程序滚动静默期
  /* 2.64：切会话在途——一律不判定（等切换定论，免得把中间态重排当成上翻）。 */
  if (S.switch_pend || S.livePend) return;
  /* 2.64：只认「人手滚动」。程序化重排（空渲染把 scrollTop 夹回 0 等）没有
     手势窗口，直接忽略——这是「切会话自动跳顶 + 进全屏 + 拉历史」的根治点。 */
  if (Date.now() - lastGestureAt > GESTURE_WINDOW_MS) return;
  /* 2.25：上下翻滚=真实人类操作 → actSend('scroll')。
     是否真发由统一闸门决定（3 秒节流 / 仅当前选中会话 / 橙灯才发）。 */
  actSend('scroll');
  if (fTyping()) return;                    // 1.21：正在打字不进全屏
  const m = el.msgs;
  const dist = m.scrollHeight - m.scrollTop - m.clientHeight;
  /* 2.49（本专项·本地会话账本移植·阶段五）：接近顶部 → 从账本向前补拉更早历史，
     每次 4 条；服务端回 end / 游标不再前进 → 判到底，不再空转（防死循环）。 */
  if (m.scrollTop < 60 && !S.histLoadingPrev && S.histConv
      && S.histRaw && S.histRaw.length){
    /* 2.129（老板 2026-10-24「上顶加载历史现在不通」）：起点改取「屏幕上已显示的
       最老一条」的 seq（_histFromSeq），不再用 histRaw[0].seq（首次 rebuild 时那是
       整段账本的最老行，拿它当游标会让服务端永远回空）。每次仍固定 4 条。 */
    const fromSeq = _histFromSeq();
    if (!fromSeq || !(fromSeq > 1)){
      histEndFlash();
    } else if (S.histEnd){
      histEndFlash();
    } else if (S.histPullFrom === fromSeq){
      S.histEnd = true;
      histEndFlash();
    } else {
      S.histPullFrom = fromSeq;
      S.histLoadingPrev = true;
      flash('\u23f3 正在取回历史记录\u2026', 'var(--blue)', 4000);
      reqHistPrev(S.histConv, fromSeq, 4);
    }
  }
  /* 1.20：全屏内绝不自动退出——退出只有两个途径：点「↓ 回到
     最新」、切换会话。手指怎么滑都不退（鬼打墙根因）。
     进入门槛降为 0.6 屏：一开始往上找历史就进全屏，
     不必猛甩突破（用户原话：发现我在找历史就自动进）。 */
  if (!document.body.classList.contains('fmsg')
      && dist > m.clientHeight * 0.6
      && m.scrollHeight > m.clientHeight * 1.6){
    enterFmsg();
  }
});
/* 2.64：手势来源监听——只有这几种【真实人类输入】才开手势窗口，程序滚动不会。
   touchmove 覆盖触屏拖动（含持续拖动不断续期）；wheel 覆盖桌面/触控板滚轮；
   keydown 覆盖键盘翻页（空格/方向键等）。 */
el.msgs.addEventListener('touchmove', markGesture, {passive: true});
el.msgs.addEventListener('wheel', markGesture, {passive: true});
document.addEventListener('keydown', markGesture);
/* 1.24：Q 弹退出全屏——用户最常用的回底方式是「滑回最新」，到底
   后浏览器出现 Q 弹（overscroll 回弹）说明人已经到底还想继续。
   实现：全屏下在距底 ≤4px 处继续向上快拽（触屏 dy<-24px / 滚轮
   deltaY>0）即判定触底回弹 → 退出全屏回正常界面，比点按钮顺手。
   （触屏向上滑=滚向底部；到底后继续上拽才是 Q 弹，反向不会误触） */
var fTouchY = 0, fAtBottom = false;
el.msgs.addEventListener('touchstart', e => {
  fTouchY = e.touches[0].clientY;
  fAtBottom = el.msgs.scrollHeight - el.msgs.scrollTop
              - el.msgs.clientHeight < 4;
}, {passive: true});
el.msgs.addEventListener('touchmove', e => {
  if (!fAtBottom || Date.now() < fLockUntil) return;
  if (!document.body.classList.contains('fmsg')){
    fAtBottom = false;
    return;
  }
  if (e.touches[0].clientY - fTouchY < -24){   // 到底后继续上拽
    fAtBottom = false;
    exitFmsg();
    flash('已回到最新', 'var(--green)', 500);
  }
}, {passive: true});
el.msgs.addEventListener('wheel', e => {
  if (!document.body.classList.contains('fmsg')) return;
  if (Date.now() < fLockUntil) return;
  const m = el.msgs;
  if (e.deltaY > 0 && m.scrollHeight - m.scrollTop - m.clientHeight < 4){
    exitFmsg();
    flash('已回到最新', 'var(--green)', 500);
  }
}, {passive: true});

function setSendBtn(stop, enabled){       // 单按钮：发送 ⇄ 停止
  el.send.textContent = stop ? '停止' : '发送';
  el.send.classList.toggle('stopmode', stop);
  el.send.disabled = !enabled;
}
function refreshSendBtn(){               // 1.01：生成中打字 → 插话三态
  el.send.classList.remove('intermode');
  if (S.inputBusy){                      // 2.46：后台借框占用中——禁用发送
    el.send.textContent = '借用中';
    el.send.classList.remove('stopmode');
    el.send.disabled = true;
    return;
  }
  /* 2.106（B·老板 17:26）：本地闸门撤除——不再以 S.ready（online＝「发送键在不在
     DOM」的瞬态量）禁用发送。未就绪只「提示」、由执行侧（服务端动作队列）最终判定，
     见 renderState 的连续性门槛分支。 */
  if (S.gen && el.ent.value.trim()){     // 生成中打字：橙色插话
    el.send.textContent = '插话';
    el.send.classList.remove('stopmode');
    el.send.classList.add('intermode');
    el.send.disabled = false;
  } else {
    setSendBtn(S.gen, true);             // 生成中=停止；空闲=发送
  }
}

/* 1.62：撤回后把被撤回的话回填本端输入框。TRAE 把那条话放回它自己的
   输入框后，快照 inputText 才会带上它；不赌单次时机，改为「撤回发起后
   60 秒内，一旦快照读到输入框有字就回填一次」。本端输入框已有字时不
   覆盖（用户可能正在改），只在全屏（看不到输入行）时额外吐司告知。 */
function revertRefill(snap){
  if (!S.revertPend) return;
  if (Date.now() - S.revertPend > 60000){ S.revertPend = 0; return; }
  const t = ((snap && snap.inputText) || '').trim();
  if (!t) return;
  S.revertPend = 0;
  /* 2.77：撤回取回的是「原文＋专属词三段」——剥掉三段标记还原纯正文（发送时会重拼） */
  const clean = stripHintMarks(t);
  if (!el.ent.value.trim()){
    el.ent.value = clean;
    refreshSendBtn();
  }
  const pv = clean.length > 40 ? clean.slice(0, 40) + '…' : clean;
  flash('↩ 已撤回并取回：' + pv, 'var(--blue)', 6000);
}

/* 2.66：未就绪态分级——用户 2026-10-07：「对面服务器不在线的时候，横幅只会
   显示『TRAE 界面未就绪』，不够准确」。原实现只要 snap.online 为假就一律写
   这一句，把「服务端（电脑上的程序）没在跑」也归成了「界面未就绪」。现按
   真实原因分三档：
     · 本端连不上中转频道 → 说频道问题（与本机网络/中继有关，与服务端无关）；
     · 选中的服务端最近无任何来向消息（> SRV_DEAD_MS，或名册里从没听过它）
       → 判定「服务端不在线」；
     · 服务端消息新鲜（在跑）但 TRAE 没连上 → 才是「TRAE 界面未就绪」。
   判据 S.servers[cur].ts＝该服务端最后一次来向消息时刻（regSrv 每收必刷）。 */
function notReadyState(){
  if (!S.onLine)
    return {txt: '未连上中转频道，正在重连…', col: 'var(--orange)'};
  if (!S.cur)
    return {txt: '未选择服务端（请打开左侧抽屉选一台）', col: 'var(--gray)'};
  const s = S.servers[S.cur];
  const ts = (s && s.ts) || 0;
  if (!ts || Date.now() - ts > SRV_DEAD_MS)
    return {txt: '服务端「' + S.cur + '」不在线（无响应）', col: 'var(--red)'};
  return {txt: 'TRAE 界面未就绪', col: 'var(--red)'};
}
let _nrTxt = '';            /* 2.66：最近一次写入的「未就绪」文案（防抢一次性提示） */
let _stTxt = '';            /* 2.106：最近一次 renderState 写入的状态栏文案——供定期复核（防抢一次性提示） */
/* 2.106（B·老板 17:26）：未就绪「连续性门槛」——online=false 连续满此值才提示
   （参考同项目 LOGIN_WARN_MS），避免「重渲/切会话/遮罩」单拍瞬态闪烁误报。 */
const NOT_READY_WARN_MS = 60000;
/* 2.106：选中的服务端是否「久无来向消息」（> SRV_DEAD_MS，或从没听过它）——真离线，
   非瞬态；用于把「UI 未就绪」（走连续性门槛）与「服务端不在线」区分开。 */
function _srvDead(){
  const s = S.servers[S.cur];
  const ts = (s && s.ts) || 0;
  return !ts || Date.now() - ts > SRV_DEAD_MS;
}
function renderState(snap){
  S.gen = false;
  const _online = !!(snap && snap.online);
  S.ready = _online;
  /* 2.106（B）：online=false 连续性计时——只驱动「提示门槛」，不再作发言闸门。 */
  if (_online) S.notReadySince = 0;
  else if (!S.notReadySince) S.notReadySince = Date.now();

  /* 真离线（本端没连中转 / 没选服务端 / 服务端久无响应）——如实即时提示（非瞬态误报）；
     但【不再本地禁发言】（2.106 B）：真离线时发送由 srvNeedOnline 如实拦下（命令不发出）。 */
  if (!_online && (!S.onLine || !S.cur || _srvDead())){
    const nr = notReadyState();
    _nrTxt = nr.txt; _stTxt = nr.txt;
    el.state.textContent = nr.txt;
    el.state.style.color = nr.col;
    refreshSendBtn();                        // 2.106：不再 setSendBtn(false,false)
    fbarSync();                              // 1.62：全屏状态条跟随
    return;
  }
  _nrTxt = '';
  /* 2.106（C·老板 15:57「横幅四维状态必须准确」）：横幅「忙/闲」仍以 snap.sendIdle 为
     单一取数（服务端快照结构【无「状态灯」字段】——仅 convs 行内携会话灯，本端已有；
     见回报）；服务端 X3-1 已把 sendIdle 纳入指纹去重键、并在「忙↔闲」翻转瞬间强制
     放行一帧 ⇒ 忙→闲可自行翻转。X3-3：不再细分「等待/停顿」，只据 sendIdle 出生成态。 */
  const idle = snap.sendIdle, inp = snap.inputText || '',
        tail = snap.tail;
  if (!idle && !inp){                        // 生成中
    S.gen = true;
    /* 1.5x：生成中用「✏️」符号替代「生成中」三字省空间；AI 实时 tail
       不再逐字显示，只用有无划分两个固定阶段词——空=输出中、有=
       规划中（原「正在规划下一步」精简为规划中）；并像空闲一样带
       上当前会话名 */
    const ct2 = (curTitle() || '').trim();
    el.state.textContent = '✏️ ' + (tail ? '规划中' : '输出中')
      + (ct2 ? ' · ' + (ct2.length > 14 ? ct2.slice(0, 14) + '…' : ct2) : '');
    el.state.style.color = 'var(--orange)';
    refreshSendBtn();                        // 有本地字→插话，无→停止
  } else if (idle && !inp){                  // 空闲
    /* 1.24：空闲时顺带显示当前会话名——整行只写「空闲」太浪费 */
    const ct = (curTitle() || '').trim();
    el.state.textContent = '空闲'
      + (ct ? ' · ' + (ct.length > 14 ? ct.slice(0, 14) + '…' : ct) : '');
    el.state.style.color = 'var(--green)';
    setSendBtn(false, true);
  } else {                                   // 输入框待发（远端残留）
    S.gen = !idle;                           // 生成中残留仍属生成态
    el.state.textContent = '输入框待发' + (inp.length > 20 ? '（有残留）'
      : ': ' + inp.slice(0, 18));
    el.state.style.color = 'var(--blue)';
    setSendBtn(false, true);
  }
  /* 2.106（B）：online=false 满连续性门槛 → 只「提示」可能在重连/界面切换中（不再禁发言，
     最终判定权交执行侧/服务端动作队列）。未满门槛 ⇒ 照常显示上面四态，单拍瞬态不闪报。 */
  if (!_online && S.notReadySince
      && (Date.now() - S.notReadySince) >= NOT_READY_WARN_MS
      && !S.switch_pend && !S.inputBusy){
    el.state.textContent = '⚠ 可能在重连/界面切换中…（已提交服务器判定）';
    el.state.style.color = 'var(--orange)';
  }
  /* 2.67 切换过程状态机：状态栏按在途阶段分档显示真实过程（用户 2026-10-07）。
     2.130（老板 2026-10-24）：撤掉 2.106 的「正在获取「目标」的快照…」等待文案——
     首屏已由本地最新完整存帧同步铺满，不再有获取等待态。 */
  if (S.switch_pend){
    const ph = S.switch_pend.phase || 'switching';
    if (ph === 'connecting'){
      el.state.textContent = '正在连接 WS…';
      el.state.style.color = 'var(--orange)';
    } else if (ph === 'ok'){
      /* 2.118（老板 2026-10-22 09:37）：「切换成功的时候，也要显示一下切换成功，然后
         对话名称，否则我还要等半天都不知道我切换成功到谁了」——与「输出中/输入框待发」
         同口径，成功态后面接当前会话名。 */
      const _okt = (S.switch_pend.title || curTitle() || '').trim();
      el.state.textContent = '切换成功'
        + (_okt ? ' · ' + (_okt.length > 14 ? _okt.slice(0, 14) + '…' : _okt) : '');
      el.state.style.color = 'var(--green)';
    } else if (ph === 'fail'){
      el.state.textContent = '切换失败';
      el.state.style.color = 'var(--red)';
    } else {
      /* 2.130（老板 2026-10-24）：「正在获取「目标」的快照…」整条等待文案删除——
         切会话首屏由本地最新完整存帧同步铺满，有存帧就沿用上面按缓存帧算出的
         真实忙闲；确无该会话存帧（首见会话）才给中性「切换中·名称」。 */
      const _tt = (S.switch_pend.title || curTitle() || '').trim();
      const _f = S.liveFrame;
      if (!(_f && Array.isArray(_f.msgs) && _f.msgs.length)){
        el.state.textContent = '切换中'
          + (_tt ? ' · ' + (_tt.length > 14 ? _tt.slice(0, 14) + '…' : _tt) : '');
        el.state.style.color = 'var(--blue)';
      }
    }
  }
  /* 2.112（Y12·老板：动作已提交却干等无语）：在途动作尚未收到 rcpt accepted ⇒
     状态栏常显「已提交 · 排队中…」（每 5 秒复核循环保证不被快照刷掉）；
     accepted/running/done/fail 一到即由 srvOpAck 推进原四态，本分支自动让位。
     发送消息走的不是 srvOpSend，另按占位卡 state='sending'（已发出、未受理）兜底，
     只在其新鲜期（20s）内提示，之后交回原状态栏，绝不永久占位。 */
  let _qSent = (typeof srvOpQueuedPending === 'function') && srvOpQueuedPending();
  if (!_qSent && Array.isArray(S.pending)){
    for (const p of S.pending){
      if (p && p.state === 'sending' && Date.now() - (p.ts || 0) < 20000){ _qSent = true; break; }
    }
  }
  if (!S.switch_pend && !S.inputBusy && _qSent){
    el.state.textContent = SRV_PHASE.queued[0];
    el.state.style.color = SRV_PHASE.queued[1];
  }
  /* 2.46：后台借框占用——置顶提示并禁用发送，挡住人类操作 */
  if (S.inputBusy){
    el.state.textContent = '⏳ ' + S.inputBusy + ' 正在借用输入框，请稍后';
    el.state.style.color = 'var(--orange)';
    setSendBtn(false, false);
  }
  /* 1.77：未登录异常横幅——1.31 本有此设计，但 el 映射漏挂 loginbar 键，
     横幅从未亮过；现补键修活，并按用户要求加「持续门槛」：
     连续未登录满 60 秒才算确诊（与服务端钉钉报警同一门槛，瞬断不误报）。 */
  renderLoginBar(snap);
  _stTxt = el.state.textContent;             // 2.106：记下本函数刚写的文案，供定期复核/忙闲翻转
  fbarSync();                              // 1.62：全屏状态条镜像 #statebar
}
/* 1.77：未登录横幅判定——60 秒持续门槛 + 每 5 秒复核 */
const LOGIN_WARN_MS = 60000;   /* 连续未登录多久才算确诊（用户定 1 分钟，
                                  与服务端钉钉报警门槛一致） */
function renderLoginBar(snap){
  const bad = !!(S.ready && snap && snap.login === false);
  if (!bad){          /* 登录正常 / 未就绪 / 旧服务端无 login 字段 → 撤条 */
    S.login_lost_since = 0;
    el.loginbar.classList.remove('on');
    return;
  }
  if (!S.login_lost_since) S.login_lost_since = Date.now();
  if (Date.now() - S.login_lost_since < LOGIN_WARN_MS) return;  /* 未满 1 分钟不亮 */
  el.loginbar.textContent = '⚠ TRAE 未登录/登录态丢失（账号区：'
    + (snap.acctText || '空') + '）——发送会失败，请在电脑上重新登录';
  el.loginbar.classList.add('on');
}
setInterval(() => renderLoginBar(S.snap), 5000);   /* 持续复核：满 1 分钟自动亮 */
/* 2.66：状态栏定期复核（2.106 扩充）——服务端静默/离线时没有快照驱动 renderState，
   横幅会一直停在旧文字；且「未就绪连续性门槛」到点、以及「忙→闲」（H6）都需要在
   两次快照之间也能自行翻转。每 5 秒重算一次：仅当「当前横幅正是本函数刚写的那句」
   （＝没有别的一次性提示/错误在显示）时才刷新。 */
setInterval(() => {
  if (!_stTxt || el.state.textContent !== _stTxt) return;
  renderState(S.snap);
}, 5000);

function renderAttach(items){
  const row = el.attach_row;
  row.innerHTML = '';
  if (S.attach_pending){
    row.classList.add('on');
    for (const nm of S.attach_pending){
      const c = document.createElement('span');
      c.className = 'chip pend';
      c.textContent = '⏳ ' + nm;
      row.appendChild(c);
    }
    return;
  }
  if (!items || !items.length){
    row.classList.remove('on');
    return;
  }
  row.classList.add('on');
  items.forEach((it, i) => {
    const c = document.createElement('span');
    c.className = 'chip ok';
    c.innerHTML = '📎 ' + esc(it.name)
      + (it.size ? '  ' + esc(it.size) : '')
      + ' <span class="rm" title="移除">✕</span>';
    c.querySelector('.rm').onclick = e => {
      e.stopPropagation();
      srvOpSend('attach_rm', i, '移除附件');   // 2.109：②＋rcpt ③④（attach_rm_done 另回填）
    };
    row.appendChild(c);
  });
}

/* ===== 1.15：模型收藏 =====
 * 官方模型列表经常变更（改名/下架），收藏按「模型真名」存
 * localStorage（trae_webm_fav_models），跨服务端通用。有收藏时
 * 下拉只列收藏项 + 当前模型占位；收藏失效标 ⚠ 并弹提醒。 */

function loadFavs(){
  try { return JSON.parse(localStorage.getItem('trae_webm_fav_models')
    || '[]') || []; } catch(e){ return []; }
}
S.favs = loadFavs();            // 1.15：启动即载入收藏（localStorage）
function saveFavs(a){
  S.favs = a;
  try { localStorage.setItem('trae_webm_fav_models', JSON.stringify(a)); }
  catch(e){}
}
function modelDisp(e){          // e=[name,trail,restricted] → 下拉显示文本
  return e[0] + (e[1] ? ' ' + e[1] : '') + (e[2] ? '（受限）' : '');
}

function rebuildModelOptions(){
  /* 按收藏规则重建模型下拉（models 事件 / 收藏变更时调用） */
  const entries = S.models_full || [];
  const names = new Set(entries.map(e => e[0]));
  S.model_names = names;
  const cur = S.snap.model || '';
  const favs = S.favs || [];
  const items = [];             // [disp, name, dead]
  if (!favs.length){            // 无收藏：官方全量（原行为）
    for (const e of entries) items.push([modelDisp(e), e[0], false]);
  } else {
    const inList = new Set();
    for (const fn of favs){     // 收藏按收藏顺序列出
      const e = entries.find(x => x[0] === fn);
      if (e){ items.push([modelDisp(e), fn, false]); inList.add(fn); }
      else    items.push(['⚠ ' + fn + '（已失效）', fn, true]);
    }
    if (cur && !inList.has(cur)){   // 当前选中的非收藏模型：保留显示
      const e = entries.find(x => x[0] === cur);
      items.push([(e ? modelDisp(e) : cur) + '（当前）', cur, false]);
    }
  }
  el.model.innerHTML = '';
  S.model_map = {};
  for (const [disp, name] of items){
    const o = document.createElement('option');
    o.value = disp; o.textContent = disp;
    el.model.appendChild(o);
    S.model_map[disp] = name;
  }
  syncModel(cur);
}

function checkFavInvalid(){
  /* models 事件后核对：收藏不在官方列表 → 弹提醒（每次新失效才提醒） */
  /* v1.54：官方列表为空 ≠ 收藏失效。空列表只说明服务端还没采到模型
     （采集被遮罩吞掉、界面未就绪、或断线重放前）——原实现会把全部收藏
     判成「已失效」并弹提醒，逼用户去删好收藏（2026-09-22 现场：服务端
     重放空列表 → 整页收藏被标 ⚠）。列表为空时直接静默，等真列表到了
     再核。 */
  if (!(S.models_full || []).length){
    S.fav_invalid = [];
    return;
  }
  const names = S.model_names || new Set();
  const inv = (S.favs || []).filter(fn => !names.has(fn));
  const fresh = inv.filter(fn => !S.fav_warned.includes(fn));
  S.fav_invalid = inv;
  if (inv.length){
    S.fav_warned = inv.slice();
    if (fresh.length)
      flash('⚠ 收藏模型已失效：' + fresh.join('、')
        + '（可能被官方改名/下架，请到 ☆ 收藏管理移除）');
  } else if (S.fav_warned.length){
    S.fav_warned = [];          // 失效恢复（官方又加回来了）清提醒标记
  }
}

function renderFavPage(){
  const L = el.favlist;
  L.innerHTML = '';
  const mk = (html, cls) => {
    const d = document.createElement('div');
    d.className = 'frow' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    return d;
  };
  if (!(S.models_full || []).length){
    L.appendChild(mk('<span class="fname">（尚未获取到官方模型列表，'
      + '连接服务端后会自动加载）</span>', 'empty'));
  }
  const names = new Set((S.models_full || []).map(e => e[0]));
  /* 失效收藏单列一节：红字 + 点击移除。
     v1.54：只在【官方列表已到手】时判失效——列表为空时把全部收藏列成
     「⚠ 已失效 + ✕ 移除」是误伤（用户会照删）；此时上面已给「尚未获取
     到官方模型列表」提示，这里直接不渲染这一节。 */
  for (const fn of (names.size ? (S.favs || []) : [])){
    if (names.has(fn)) continue;
    const d = mk('<span class="fmark">⚠ 已失效</span>'
      + '<span class="fname">' + esc(fn) + '</span>'
      + '<span class="fstar">✕</span>', 'dead');
    d.onclick = () => {
      saveFavs(S.favs.filter(x => x !== fn));
      renderFavPage(); rebuildModelOptions(); checkFavInvalid();
    };
    L.appendChild(d);
  }
  /* 官方全量模型：点行切换收藏状态 */
  for (const e of (S.models_full || [])){
    const fn = e[0], on = (S.favs || []).includes(fn);
    const d = mk('<span class="fname">' + esc(modelDisp(e)) + '</span>'
      + '<span class="fstar">' + (on ? '★' : '☆') + '</span>',
      on ? 'isfav' : '');
    d.onclick = () => {
      saveFavs(on ? S.favs.filter(x => x !== fn)
                  : S.favs.concat([fn]));
      renderFavPage(); rebuildModelOptions();
    };
    L.appendChild(d);
  }
}

