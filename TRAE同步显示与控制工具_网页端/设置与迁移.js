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
  S.failStreak = 0;                 /* 13.3：手动重连＝用户显式动作，重连计数归零 */
  diagLog('手动重连', 'warn');
  connect();
};
el.nettest.onclick = diagTest;
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
  if (srvNeedOnline('实测分身')) return;
  /* 2.109：统一四态出口——②＋rcpt ③④（profiles_run 事件另回填进度）。 */
  srvOpSend('profiles_refresh', [name], '实测分身', name);
  S.prof_run = true;
  renderProf();
}

/* 2.18：补登录——借服务端「谷歌分身助手 / T登录助手」的 HTTP 接口，对指定
   分身发起自动登录（分身名→编号自动映射手机号，跟人手操作一样）。服务没起
   时服务端会自动拉起分身助手；滑块/超时由对方负责，跑完回 profiles_login。*/
function profLogin(name){
  if (srvNeedOnline('补登录')) return;
  /* 2.109：统一四态出口——②＋rcpt ③④（profiles_login 事件另回填结果）。 */
  srvOpSend('profiles_login', name, '补登录',
            name + '（服务端会先确保登录助手在线）');
}

el.prof.onclick = () => {
  drawerClose();
  srvOpSend('profiles', null, '拉取分身数据');   // 2.109：②＋rcpt ③④（profiles 事件另回填）
  renderProf();
  el.profpage.classList.add('on');
};
el.profback.onclick = () => el.profpage.classList.remove('on');
el.profref.onclick = () => {
  if (srvNeedOnline('分身实测')) return;
  /* v1.47：运行中为「停止」；空闲为「全量实测」。停止成功与否由
     profiles_run stopped 事件反馈。 */
  if (S.prof_run){ srvOpSend('profiles_stop', null, '停止实测'); return; }   // 2.109
  /* 2.109：统一四态出口——②＋rcpt ③④（profiles_run 事件另回填进度）。 */
  srvOpSend('profiles_refresh', null, '全量实测');
  S.prof_run = true;
  renderProf();
};

/* 2.19：一键换号迁移——填目标号码，服务端一站式完成「原版换号
   （沙盒启动器 origin-login）+ 对话记录智能迁移（最重度账号全部会话换新ID
   并入当前账号）」。进度经 switch_migrate 事件流回投到 #prof_swlog。 */
function switchMigratePrompt(){
  if (srvNeedOnline('一键换号迁移')) return;
  let ov = $('swmask');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'swmask';
  ov.style.cssText = 'position:fixed; inset:0; z-index:70; background:rgba(0,0,0,.45);'
    + 'display:flex; align-items:center; justify-content:center;';
  ov.innerHTML =
    '<div style="background:#fff; border-radius:10px; padding:16px; width:90%; max-width:400px;'
    + ' max-height:88vh; overflow:auto;">'
    + '<div style="font-weight:bold; font-size:15px; margin-bottom:8px;">🔁 一键换号迁移</div>'
    + '<div style="font-size:12px; color:#555; line-height:1.5; margin-bottom:10px;">'
    + '把原版 TRAE 换成目标号码的账号，并按下面设置处理对话记录（与电脑上的'
    + '「TRAE换号工具」同一款内核）。期间会短暂关闭原版 TRAE（写完自动拉起）；'
    + '分身若掉线会自动拉起分身助手补登录（弹滑块需人工滑）。</div>'
    + '<input id="swin" inputmode="numeric" autocomplete="off"'
    + ' placeholder="目标号码，如 18" style="width:100%; box-sizing:border-box;'
    + ' padding:9px; border:1px solid #ccc; border-radius:6px; font-size:16px;">'
    + '<div style="margin-top:10px; font-size:13px;">保留最近 '
    + '<input id="swkeep" inputmode="numeric" value="100" style="width:64px; padding:5px;'
    + ' border:1px solid #ccc; border-radius:6px; font-size:14px;"> 轮对话'
    + '<span style="color:#888; font-size:12px;">（0=不裁，原样全留）</span></div>'
    + '<label style="display:block; margin-top:8px; font-size:13px;">'
    + '<input type="checkbox" id="swpurge" checked> 清理其它账号（只保留当前登录账号）</label>'
    + '<label style="display:block; margin-top:6px; font-size:13px;">'
    + '<input type="checkbox" id="swmig"> 智能迁移最重度账号（把最重账号对话并入当前号）</label>'
    + '<label style="display:block; margin-top:6px; font-size:13px;">'
    + '<input type="checkbox" id="swvac" checked> 自动压缩（回收已删空页，库变小更快）</label>'
    + '<div id="swerr" style="color:#c62828; font-size:12px; min-height:16px;'
    + ' margin-top:6px;"></div>'
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
    const keep = Math.max(0, parseInt(($('swkeep').value || '').replace(/\D/g, ''), 10) || 0);
    const purge = $('swpurge').checked, mig = $('swmig').checked, vac = $('swvac').checked;
    /* 2.117：手机端原生 confirm 被静默屏蔽 ⇒ 自绘确认层（危险操作必须看清楚再点） */
    const _run = () => {
      close();
      const slog = $('prof_swlog');
      if (slog){ slog.style.display = 'block'; slog.textContent = '（已提交，等待服务端…）'; }
      /* 2.109：统一四态出口——②＋rcpt ③④（switch_migrate 事件另回投逐行进度）。 */
      srvOpSend('switch_migrate',
                { '目标': n, '轮次': keep, '清理': purge, '压缩': vac, '迁移': mig },
                '一键换号迁移', '目标 ' + n + ' 号', 6000);
      S.switch_mig = { on: true, ok: null, log: [] };
    };
    if (purge){
      uiConfirm('⚠ 清除其它账号的对话记录',
        '将【清除其它所有账号的对话记录】（只保留当前登录账号），确定？', '确定清除', _run);
      return;
    }
    _run();
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
  /* 2.69：试听同走「直连为默认 + 服务端兜底」路由（与语音卡片同一链路），
     用一个无对应卡片的假 seg（ttsStage 对它自然 no-op），音频回来经
     ttsDeliver → fpPlay 播放。 */
  foxUnlock();                       // 借「试听」这次点击的手势解锁音频通道
  const id = newDid(), seg = '__tts_preview__';
  _tts_pend[id] = {ts: Date.now(), seg: seg};
  const payload = {t:'tts', id:id, text:TTS_PREVIEW_TXT,
                   voice:ttsVoice(), rate:ttsRate()};
  if (ttsRoute(id, seg, payload)){
    ttsFlash('正在合成试听…', 'var(--blue)');
  } else {
    ttsFlash('直连未就绪，30 秒内未连通将自动回落服务端…', 'var(--orange)');
  }
}
if (el.btn_tts_preview) el.btn_tts_preview.onclick = ttsPreview;

/* ============ v1.50：主/副集群切换 + 自动切回探测 ============ */
function chanRender(){
  if (!el.lbl_chan_q) return;
  const s = curSel();
  const ch = chanGet(s) || '未设置';
  /* 2.260：切换集群即回填频道名输入框，保存时不会把旧集群的名字写进新集群的键。 */
  if (el.wsurl) el.wsurl.value = chanGet(s) || '';
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
/* 2.184（老板 2026-11-19 令：一次只在一个频道在线）：原「副集群每 15 分钟
   new WebSocket 探测主集群、恢复即自动切回」整段删除——它本质是第二个频道
   短暂在线，且不 login 不心跳，纯浪费帧。现改为纯手动：点「主集群」按钮才切回；
   相关定时器与清理函数一并删，不留任何探测定时器或临时连接。 */
function switchChan(sel){
  if (sel === curSel()){
    /* 2.260：已选中本集群但链路未连通（断线/半开/CONNECTING）＝当重连处理，不再只闪文案。 */
    if (!(ws && ws.readyState === 1)){
      flash('本集群连接未就绪，正在重连…', 'var(--blue)');
      connect();
      return;
    }
    flash((sel === 'backup' ? '已处于副集群' : '已处于主集群'));
    return;
  }
  const ch = chanGet(sel);
  if (!ch){ flash('⚠ 未设置频道名'); return; }
  setSel(sel);
  /* 2.260：若切换会话在途，记下本轮要补发——新连接 open 后由 setOnLine 强制发一次 switch。 */
  if (S.switch_pend && S.switch_pend.phase !== 'ok') S.switch_pend.phase = 'connecting';
  flash((sel === 'backup' ? '已切副集群，重连中…' : '已切回主集群，重连中…'), 'var(--blue)');
  connect();                            // 重连到所选频道（connect 内部先 teardownWs 拆旧，绝不两条并存）
}
if (el.btn_chan_main) el.btn_chan_main.onclick = () => switchChan('main');
if (el.btn_chan_back) el.btn_chan_back.onclick = () => switchChan('backup');
chanRender();

/* 13.1：本机身份卡（软件号【只读】显示 + 昵称输入口）——动态注入设置页顶部，
   不改 HTML。软件号随机生成并随本机持久保存，无任何重置入口。 */
function buildIdCard(){
  if (!el.netpage || document.getElementById('idcard_fs')) return;
  const body = el.netpage.querySelector('.nbody') || el.netpage;
  const fs = document.createElement('fieldset');
  fs.id = 'idcard_fs';
  fs.innerHTML =
    '<legend>本机身份</legend>'
    + '<div class="row" style="gap:6px; align-items:center;">'
    + '<span>软件号</span><b id="lbl_myid" class="diagv"></b>'
    + '<label style="margin-left:8px;">昵称</label>'
    + '<input id="in_nick" maxlength="40" placeholder="选填，如：手机" style="flex:1; min-width:0;">'
    + '<button id="btn_nicksave" style="flex:0 0 auto;">保存</button>'
    + '<span id="nick_flash" class="hint"></span></div>';
  body.insertBefore(fs, body.firstChild);
  const lbl = document.getElementById('lbl_myid');
  if (lbl) lbl.textContent = MY_ID || '—';
  const inp = document.getElementById('in_nick');
  if (inp) inp.value = nickGet();
  const btn = document.getElementById('btn_nicksave');
  if (btn) btn.onclick = () => {
    nickSet(inp.value);
    const f = document.getElementById('nick_flash');
    if (f){ f.textContent = '已保存'; f.style.color = 'var(--green)';
      setTimeout(() => { if (f.textContent === '已保存') f.textContent = ''; }, 2500); }
    try { if (S.onLine && typeof cliLogin === 'function') cliLogin('改昵称'); } catch(e){}
  };
  /* 2026-11-24（老板令）：缓存管理移出身份卡，固定放设置页最底部；顶部只留一行紧凑身份。 */
  const fs2 = document.createElement('fieldset');
  fs2.id = 'cache_fs';
  fs2.innerHTML = '<legend>缓存</legend>'
    + '<div class="row"><button id="btn_cache_mgr" style="flex:1;">缓存管理</button></div>';
  body.appendChild(fs2);
  const cmgr = document.getElementById('btn_cache_mgr');
  if (cmgr) cmgr.onclick = () => {
    try {
      if (typeof window.cvEnsure === 'function') window.cvEnsure();
      if (typeof window.cvOpenCache === 'function') window.cvOpenCache();
      el.netpage.classList.remove('on');
    } catch(e){}
  };
}
buildIdCard();
/* 2.186（2026-11-19 老板令·V1.0 §十-0）：设置页「小账本」按钮整块撤除——
   左上角 ☰ 抽屉（会话与操作）已有一级入口（比它高一级的地方已经有了，不再往深处放重复入口）。
   原 buildLedgerEntry（fieldset + btn_lbopen + 说明行）连同调用一并删除，
   不许留空分组、不许留空标题。 */
/* 打开小账本查看器公共出口——唯一调用方＝抽屉一级入口（btn_lb_drawer）。 */
function lbOpenViewer(){
  try {
    if (typeof window.cvEnsure === 'function') window.cvEnsure();
    if (typeof window.cvOpen === 'function') window.cvOpen();
    el.netpage.classList.remove('on');
  } catch(e){}
}
/* 2.183 修3（2026-11-19 老板修订·V1.0 §十-0）：抽屉一级「📒 小账本」入口——
   2.186 起它是唯一入口（设置页副入口已删）：
   点按＝关抽屉＋开缓存查看器（公共出口 lbOpenViewer）。 */
(function(){
  const d = document.getElementById('btn_lb_drawer');
  if (d) d.onclick = () => { drawerClose(); lbOpenViewer(); };
})();
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
