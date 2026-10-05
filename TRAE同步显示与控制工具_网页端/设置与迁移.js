'use strict';
function openDiagPage(){
  drawerClose();
  renderToday(); renderNetHist();
  el.netpage.classList.add('on');
}
el.net.onclick = openDiagPage;
/* 1.61：点顶栏状态文字 → 直接进诊断页（看不懂那几个字时就点它） */
el.rlink.onclick = openDiagPage;
el.netback.onclick = () => el.netpage.classList.remove('on');

/* 1.xx：连接诊断按钮 */
el.netreconn.onclick = () => {
  /* 1.60：连接本来好好的时候点这个按钮 = 自己把好连接掐断
     （用户误点 → 「一切回来就断线」观感的元凶）→ 先判新鲜度：
     已在线、且 SRV_IDLE_MS 内还听得到服务端动静，就别重连。 */
  const fresh = S.onLine && S.lastSrv && (Date.now() - S.lastSrv < SRV_IDLE_MS);
  if (fresh){ diagLog('连接正常，已跳过重连（免得自断）', 'ok'); return; }
  diagLog('手动重连', 'warn');
  connect();
};
el.nettest.onclick = diagTest;
/* 1.xx：被动查询最大化/全屏——前端发起，服务端即时检测回投一次结果 */
el.check_fulls.onclick = () => {
  el.lbl_fulls.textContent = '查询中…';
  sendCmd('check_fulls');
};
el.netclear.onclick = () => { DIAG.log.length = 0; diagRender(); };
/* 1.58：一键复制诊断信息（直接粘给 AI 排查，省得截图） */
el.diagcopy.onclick = () => {
  const T = v => (v == null ? '—' : String(v));
  const lines = [
    '【' + APP_NAME + ' 诊断 v' + VER + '】' + new Date().toLocaleString(),
    '频道：' + T(el.diag_chan && el.diag_chan.textContent),
    '本端连上中转：' + T(el.diag_ws && el.diag_ws.textContent),
    '收到电脑端回应：' + T(el.diag_srv && el.diag_srv.textContent),
    '最近回应：' + T(el.diag_last && el.diag_last.textContent),
    '断线/出错：' + T(el.diag_cnt && el.diag_cnt.textContent),
    '主/备中继：' + T(el.lbl_ws1 && el.lbl_ws1.textContent)
      + ' | ' + T(el.lbl_ws2 && el.lbl_ws2.textContent),
    '前台可见：' + (!document.hidden) + '   登录态：' + loggedIn
      + '   空闲：' + Math.round((Date.now() - lastAct) / 1000) + 's'
      + '   末次心跳：' + (lastBeatOk
          ? Math.round((Date.now() - lastBeatOk) / 1000) + 's前' : '—'),
    '框：' + T(S.box) + '   端口：' + T(S.port)
      + '   在线端：' + S.alive.size + '/' + S.boxes.length,
    '设备：' + navigator.userAgent,
    '—— 事件日志（' + DIAG.log.length + ' 条）——'
  ];
  DIAG.log.forEach(l =>
    lines.push(new Date(l.t).toLocaleTimeString() + '  ' + l.txt));
  copyText(lines.join('\n'));
};
// 1.xx：保存原有打开逻辑，追加诊断刷新（打开瞬间刷一次当前状态）
const _old_on_net_click = el.net.onclick;
el.net.onclick = (ev) => {
  _old_on_net_click && _old_on_net_click.call(el.net, ev);
  diagRender();
};

/* ================= 分身状态页（v1.45） ================= */

function renderProf(){
  if (!el.profpage.classList.contains('on')) return;
  const d = S.profiles;
  const run = !!S.prof_run;
  el.profref.disabled = false;
  el.profref.textContent = run ? '停止' : '全量实测';
  const hint = d
    ? ('管理分身 ' + d.count + ' 个 · 已实测 ' + d.checked + ' 个 · 最近实测 ' +
       (d.last_refresh || '—') +
       (run ? ' · 正在实测（真实访问网页，耗时数分钟）' : '') +
       '  ·  右侧「实测」=查登录/积分，「补登录」=借登录助手自动登录')
    : '（无数据）';
  el.profhint.textContent = hint;
  const list = (d && d.profiles) || [];
  let html = '';
  for (const p of list){
    const st = p.status || '未实测';
    const cls = st === '已登录' ? '' : (st === '掉线' ? ' down' : ' unk');
    const qn = JSON.stringify(p.name);         /* 精确名，防前缀连带 */
    html += '<div class="prof_card"><div class="prof_row1">' +
      '<span class="prof_name">' + esc(p.name) + '</span>' +
      '<span class="prof_st' + cls + '">' + esc(st) + '</span>' +
      '<button class="prof_test" data-n="' + qn + '" onclick="profTest(' +
      qn + ')">实测</button>' +
      '<button class="prof_login" data-n="' + qn + '" onclick="profLogin(' +
      qn + ')">补登录</button>' +
      '<span class="prof_acc">' + esc(p.account || '') + '</span></div>' +
      '<div class="prof_row2">' +
      '<span>总积分 <b class="prof_pts">' + esc(p.points || '—') + '</b></span>' +
      '<span>月积分 ' + esc(p.monthly || '—') + '</span>' +
      '<span>最近到期 ' + esc(p.expire || '—') + '</span>' +
      '<span>实测 ' + esc(p.time || '—') + '</span>' +
      '</div></div>';
  }
  el.proflist.innerHTML = html || '<div class="empty">（暂无分身数据）</div>';
}

/* v1.46：单测指定分身。
   v1.47：取代机制——若已在实测，服务端 start_refresh 会自动终止旧的
   改测本分身（即便在跑也可再点，直接取代，不再拒绝）。 */
function profTest(name){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  sendCmd('profiles_refresh', [name]);   /* 传数组 → 服务端精确实测该分身 */
  S.prof_run = true;
  renderProf();
  flash('正在实测 ' + name + ' …', 'var(--blue)');
}

/* 2.18：补登录——借服务端「谷歌分身助手 / T登录助手」的 HTTP 接口，对指定
   分身发起自动登录（分身名→编号自动映射手机号，跟人手操作一样）。服务没起
   时服务端会自动拉起分身助手；滑块/超时由对方负责，跑完回 profiles_login。*/
function profLogin(name){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  sendCmd('profiles_login', name);   /* 传分身名 → 服务端借登录助手 */
  flash('正在补登录 ' + name + ' …（服务端会先确保登录助手在线）',
        'var(--green)');
}

el.prof.onclick = () => {
  drawerClose();
  sendCmd('profiles');              // 拉一次当前数据
  renderProf();
  el.profpage.classList.add('on');
};
el.profback.onclick = () => el.profpage.classList.remove('on');
el.profref.onclick = () => {
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  /* v1.47：运行中为「停止」；空闲为「全量实测」。停止成功与否由
     profiles_run stopped 事件反馈。 */
  if (S.prof_run){ sendCmd('profiles_stop'); flash('正在停止…'); return; }
  sendCmd('profiles_refresh');      // 真实访问谷歌分身助手（后台）
  S.prof_run = true;
  renderProf();
};

/* 2.19：一键换号迁移——填目标号码，服务端一站式完成「原版换号
   （沙盒启动器 origin-login）+ 对话记录智能迁移（最重度账号全部会话换新ID
   并入当前账号）」。进度经 switch_migrate 事件流回投到 #prof_swlog。 */
function switchMigratePrompt(){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  let ov = $('swmask');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'swmask';
  ov.style.cssText = 'position:fixed; inset:0; z-index:70; background:rgba(0,0,0,.45);'
    + 'display:flex; align-items:center; justify-content:center;';
  ov.innerHTML =
    '<div style="background:#fff; border-radius:10px; padding:16px; width:86%; max-width:380px;">'
    + '<div style="font-weight:bold; font-size:15px; margin-bottom:8px;">🔁 一键换号迁移</div>'
    + '<div style="font-size:12px; color:#555; line-height:1.55; margin-bottom:10px;">'
    + '把原版 TRAE 换成目标号码的账号，并把「最近最重度使用」账号的全部对话记录'
    + '换新ID 一并带过来（可直接开始对话）。期间会短暂关闭原版 TRAE（写完自动拉起）；'
    + '分身若掉线会自动拉起分身助手补登录（弹滑块需人工滑）。</div>'
    + '<input id="swin" inputmode="numeric" autocomplete="off"'
    + ' placeholder="输入目标号码，如 18" style="width:100%; box-sizing:border-box;'
    + ' padding:9px; border:1px solid #ccc; border-radius:6px; font-size:16px;">'
    + '<div id="swerr" style="color:#c62828; font-size:12px; min-height:16px;'
    + ' margin-top:4px;"></div>'
    + '<div style="display:flex; gap:8px; margin-top:6px;">'
    + '<button id="swcancel" style="flex:1; padding:10px; border:1px solid #ccc;'
    + ' border-radius:6px; background:#f7f7f7;">取消</button>'
    + '<button id="swok" style="flex:1; padding:10px; border:0; border-radius:6px;'
    + ' background:#0a7d32; color:#fff; font-weight:bold;">开始</button></div>'
    + '</div>';
  document.body.appendChild(ov);
  const inp = $('swin'), err = $('swerr');
  setTimeout(() => { try{ inp.focus(); }catch(e){} }, 80);
  const close = () => { try{ ov.remove(); }catch(e){} };
  $('swcancel').onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  const go = () => {
    const n = (inp.value || '').replace(/\D/g, '');
    if (!n){ err.textContent = '请输入目标号码（纯数字）'; return; }
    close();
    const slog = $('prof_swlog');
    if (slog){ slog.style.display = 'block'; slog.textContent = '（已提交，等待服务端…）'; }
    sendCmd('switch_migrate', n);
    S.switch_mig = { on: true, ok: null, log: [] };
    flash('🚀 一键换号迁移已启动（目标 ' + n + ' 号）…', 'var(--blue)', 6000);
  };
  $('swok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); };
}
el.profswitch.onclick = switchMigratePrompt;


el.wsurl.value = chanGet();          /* v1.27：网络页改存频道名 */
el.keep.value = CFG.stats_keep;

function netDirty(){ el.nsave.disabled = false; }
el.wsurl.oninput = netDirty;
el.keep.oninput = netDirty;
el.nsave.onclick = () => {
  const ch = el.wsurl.value.trim();
  if (!ch){ flash('频道名不能为空'); return; }
  chanSet(ch);
  CFG.stats_keep = Math.max(1, parseInt(el.keep.value) || 10);
  cfgSave();
  el.keep.value = CFG.stats_keep;
  el.nsave.disabled = true;
  chanRender();
  statsFlush(); renderNetHist();
  el.nflash.textContent = '已保存';
  el.nflash.style.color = 'var(--green)';
  setTimeout(() => el.nflash.textContent = '', 3000);
  connect();                                  // 重连生效
};

/* ============ 2.02：语音播报音色/语速（改动立即生效、独立落盘，
   不脏化下面「保存」大按钮——那只管频道名与保留天数） ============ */
if (el.sel_tts_voice) el.sel_tts_voice.value = ttsVoice();
if (el.sel_tts_rate)  el.sel_tts_rate.value  = ttsRate();
function ttsFlash(t, c){
  if (!el.lbl_tts_flash) return;
  el.lbl_tts_flash.textContent = t;
  el.lbl_tts_flash.style.color = c || 'var(--green)';
  setTimeout(() => {
    if (el.lbl_tts_flash.textContent === t) el.lbl_tts_flash.textContent = '';
  }, 3000);
}
if (el.sel_tts_voice) el.sel_tts_voice.onchange = () => {
  CFG.tts_voice = el.sel_tts_voice.value;
  cfgSave(); ttsClearCache();
  const op = el.sel_tts_voice.options[el.sel_tts_voice.selectedIndex];
  ttsFlash('已保存：' + (op ? op.textContent : CFG.tts_voice));
};
if (el.sel_tts_rate) el.sel_tts_rate.onchange = () => {
  CFG.tts_rate = el.sel_tts_rate.value;
  cfgSave(); ttsClearCache();
  ttsFlash('已保存：语速 ' + CFG.tts_rate);
};
const TTS_PREVIEW_TXT = '你好，这是当前音色的试听。如果音色和语速听着合适，就这样用。';
function ttsPreview(){
  /* 试听：手机连不上 127.0.0.1，必须经服务端转发——走与语音卡片同一条
     链路（t:'tts' → 服务端 → 本机 TTS）。用一个固定的假 seg（没有对应
     卡片，ttsStage 自然 no-op），音频回来由 onTtsResp → fpPlay 播放。 */
  foxUnlock();                       // 借「试听」这次点击的手势解锁音频通道
  if (!S.onLine){ ttsFlash('未连接电脑端，无法试听', 'var(--red)'); return; }
  const id = newDid(), seg = '__tts_preview__';
  _tts_pend[id] = {ts: Date.now(), seg: seg};
  ttsFlash('正在合成试听…', 'var(--blue)');
  sendJson({t: 'tts', id: id, text: TTS_PREVIEW_TXT,
            voice: ttsVoice(), rate: ttsRate()});
}
if (el.btn_tts_preview) el.btn_tts_preview.onclick = ttsPreview;

/* ============ v1.50：主/副频道切换 + 自动切回探测 ============ */
function chanRender(){
  if (!el.lbl_chan_q) return;
  const s = curSel();
  const ch = chanGet(s) || '未设置';
  el.lbl_chan_q.textContent = (s === 'backup' ? '副' : '主') + ' • ' + ch;
  el.lbl_chan_q.style.color = (s === 'backup') ? '#b26a00' : 'var(--green)';
  if (el.btn_chan_main) el.btn_chan_main.style.fontWeight = (s === 'main') ? 'bold' : 'normal';
  if (el.btn_chan_back) el.btn_chan_back.style.fontWeight = (s === 'backup') ? 'bold' : 'normal';
  /* 双通道地址显示（WS1 主 / WS2 副，随频道名实时刷新） */
  if (el.lbl_ws1 || el.lbl_ws2){
    const c1 = chanGet('main');
    const c2 = chanGet('backup');
    if (el.lbl_ws1) el.lbl_ws1.textContent = c1 ? wsUrlOf(c1, 'main') : '未设置频道名';
    if (el.lbl_ws2) el.lbl_ws2.textContent = c2 ? wsUrlOf(c2, 'backup') : '未设置频道名';
  }
}
function setSel(sel){
  try { localStorage.setItem(LS_SEL, sel); } catch(e){}
  chanRender();
}
let probeTimer = null;
function stopProbe(){ if (probeTimer){ clearTimeout(probeTimer); probeTimer = null; } }
function startProbe(){
  /* 处于副频道时：等 60s 后开始每分钟探测主频道，恢复即自动切回。
     探测用临时连接，不 login、不心跳，不耗流量配额。 */
  if (curSel() !== 'backup') return;
  stopProbe();
  const tick = () => {
    if (curSel() !== 'backup'){ stopProbe(); return; }   // 已切回/停用
    const ch = chanGet('main');
    if (!ch){ stopProbe(); return; }
    let p = null;
    try{
      p = new WebSocket(wsUrlOf(ch, 'main'));
      p.onopen = () => {
        try { p.close(); } catch(e){}
        stopProbe();
        setSel('main');
        flash('主频道已恢复，自动切回 ✓', 'var(--green)');
        connect();
      };
      p.onclose = () => {};
      p.onerror = () => { try { if (p) p.close(); } catch(e){} };
    }catch(e){}
    probeTimer = setTimeout(tick, 60 * 1000);
  };
  probeTimer = setTimeout(tick, 60 * 1000);
}
function switchChan(sel){
  if (sel === curSel()){ flash((sel === 'backup' ? '已处于副频道' : '已处于主频道')); return; }
  const ch = chanGet(sel);
  if (!ch){ flash('⚠ 未设置频道名'); return; }
  setSel(sel);
  flash((sel === 'backup' ? '已切副频道，重连中…' : '已切回主频道，重连中…'), 'var(--blue)');
  if (sel === 'backup') startProbe();   // 副频道就位 → 开始探测主频道
  else stopProbe();
  connect();                            // 重连到所选频道，自动回连
}
if (el.btn_chan_main) el.btn_chan_main.onclick = () => switchChan('main');
if (el.btn_chan_back) el.btn_chan_back.onclick = () => switchChan('backup');
chanRender();

function renderToday(){
  const b = NET.days[netDay()] || {rx:0, tx:0, rxn:0, txn:0};
  el.today.textContent = '今日  收 ' + fmtBytes(b.rx) + '·' + (b.rxn||0)
                       + ' 条   发 ' + fmtBytes(b.tx) + '·' + (b.txn||0)
                       + ' 条';
}
function renderNetHist(){
  const tb = el.tnet.querySelector('tbody');
  tb.innerHTML = '';
  const keep = Math.max(1, parseInt(CFG.stats_keep) || 10);
  const ks = Object.keys(NET.days).sort().reverse().slice(0, keep);
  for (const k of ks){
    const b = NET.days[k] || {};
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + k + '</td><td class="num">'
      + fmtBytes(b.rx || 0) + '</td><td class="num">' + (b.rxn || 0)
      + '</td><td class="num">' + fmtBytes(b.tx || 0)
      + '</td><td class="num">' + (b.txn || 0) + '</td>';
    tb.appendChild(tr);
  }
}
setInterval(renderToday, 2000);
setInterval(statsFlush, 30000);
window.addEventListener('beforeunload', () => { statsFlush(); saveSrvs(); });

/* ================= 启动 ================= */

renderVer();                     /* 1.xx：统一版本号（三处同步） */
/* 2.20 新架构：骨架秒出——本地缓存的会话列表直接渲染，不用等连上 */
