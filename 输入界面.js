'use strict';
function fprog(to){                 // 程序化滚动：静默期内不参与判定
  fLockUntil = Date.now() + 450;
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
  /* 1.89：上下滑动翻滚=真实人类操作 → 上报 act/scroll 清当前会话橙灯。
     节流：同会话 800ms 最多一次；仅当 S.cur 存在时上报；title 为空不上报。 */
  if (S.cur && Date.now() - lastActScroll > 800){
    lastActScroll = Date.now();
    const st = (curTitle() || '').trim();
    /* v1.95：捎带稳定 ID（服务端按 sid 清橙灯，改名也清得掉；无则回退标题） */
    if (st) sendJson({t: 'act', k: 'scroll', title: st, sid: curSid()});
  }
  if (fTyping()) return;                    // 1.21：正在打字不进全屏
  const m = el.msgs;
  const dist = m.scrollHeight - m.scrollTop - m.clientHeight;
  /* 2.20 新架构：接近顶部且本地缓存还有更老 → 从账本向前补拉 */
  if (m.scrollTop < 60 && !S.histLoadingPrev
      && S.histRaw && S.histRaw.length){
    const first = S.histRaw[0];
    if (first && first.seq > 1){
      S.histLoadingPrev = true;
      reqHistPrev(S.histConv, first.seq, 30);
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
  if (!S.ready){ setSendBtn(false, false); return; }
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
  if (!el.ent.value.trim()){
    el.ent.value = t;
    refreshSendBtn();
  }
  const pv = t.length > 40 ? t.slice(0, 40) + '…' : t;
  flash('↩ 已撤回并取回：' + pv, 'var(--blue)', 6000);
}

function renderState(snap){
  S.gen = false;
  S.ready = !!(snap && snap.online);
  if (!S.ready){
    el.state.textContent = 'TRAE 界面未就绪';
    el.state.style.color = 'var(--red)';
    setSendBtn(false, false);
    fbarSync();                            // 1.62：全屏状态条跟随
    return;
  }
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
  /* 1.16：切换在途期间状态栏一律显示「正在切换」——正文没到达前
     不提前放行成「空闲」（跑太快让人以为切好了其实还是旧内容） */
  if (S.switch_pend){
    el.state.textContent = '正在切换「' + S.switch_pend.title + '」…';
    el.state.style.color = 'var(--blue)';
  }
  /* 1.77：未登录异常横幅——1.31 本有此设计，但 el 映射漏挂 loginbar 键，
     横幅从未亮过；现补键修活，并按用户要求加「持续门槛」：
     连续未登录满 60 秒才算确诊（与服务端钉钉报警同一门槛，瞬断不误报）。 */
  renderLoginBar(snap);
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
      e.stopPropagation(); sendCmd('attach_rm', i);
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

