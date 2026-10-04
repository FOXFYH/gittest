/* ============================================================================
 * TRAE远程控制3.0 网页模块 · 设置页（对应 page_net）        版本 1.00
 * ---------------------------------------------------------------------------
 * 3.87：从主入口 HTML 拆出「设置页」里**只在打开本页或点击本页按钮时才用**的
 * 逻辑；首次点左抽屉「⚙️ 设置页」或点顶栏状态文字时，由主文件 加载模块()
 * 动态注入本文件（带 ?v=VER 杀缓存）。
 *
 * 【同一全局作用域】经典脚本，可直接用主文件的 el / S / CFG / flash / esc /
 * $ / sendCmd / sendJson / connect / diagLog / diagRender / renderToday /
 * srvIdleMs / ttsVoice / ttsRate / ttsClearCache / chanGet / curSel / netDay /
 * statsFlush / fmtBytes / ensureHist / copyText / DIAG 等全局；切勿重复声明主文件
 * 已有的 const/let/function 名。（3.20：原 idbOpen/idbClear 已随 IndexedDB 深库删除。）
 *
 * 【特意留在主文件的「常驻件」】以下在主文件里是**启动/常驻**用（连接诊断记
 * 录、每秒诊断刷新、积分流量今日行、频道名渲染、副频道探测），故不拆出：
 *   diagLog / diagRender(+setInterval) / renderVer / renderToday(+setInterval) /
 *   chanRender / startProbe / stopProbe / setSel / autofixGet(+自动修复开关)。
 *
 * 【职责】设置页内饰：连接诊断按钮、频道名与保留天数保存、主/副频道切换、
 *        流量历史表、语音播报音色语速、本地缓存查看与一键清空、复制诊断信息。
 * 【接口】openDiagPage()：主入口 el.net.onclick / el.rlink.onclick 经 加载模块()
 *        调用（el.net.onclick 还会再补一次 diagRender()，与拆分前一致）。
 *        本文件加载时自行绑定页内全部按钮与输入。
 * ==========================================================================*/
'use strict';

/* 1.61：抽成函数——顶栏状态文字与抽屉里「设置页」都可进入诊断页 */
function openDiagPage(){
  drawerClose();
  renderToday(); renderNetHist();
  cacheStatsRender();                  /* 3.57：打开设置页即刷一次本地缓存大小 */
  el.netpage.classList.add('on');
}

function diagTest(){                        // 测服务器：发 hello，5s 内等回应
  DIAG.testAt = Date.now(); DIAG.testOk = false;
  diagLog('测试：已发送 hello，等 5 秒回应…', 'dim');
  try { sendJson({t: 'hello'}); } catch(e){}
  setTimeout(() => {
    if (DIAG.testOk) diagLog('测试：收到服务器回应 ✓', 'ok');
    else diagLog('测试：5 秒内无回应 ✗（服务端未启动？频道不符？）', 'bad');
    DIAG.testAt = 0;
  }, 5000);
}

/* ===== 3.57（用户 2026-10-03）：本地缓存查看 + 一键清空聊天记录 =====
   背景：网页端「聊天记录全权由本端组织」——广播只把内容/ID 送进本地仓库，
   前台显示哪几条由网页端自己定。故用户需要一个「看仓库有多大 + 一键清空」的
   入口，彻底排查「缓存越用越大 / 记录异常」。清空只动聊天记录，不碰频道名等设置。 */
function _fmtBytes(n){
  n = Math.max(0, n | 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function _lsBytes(k){
  try { const v = localStorage.getItem(k); return v ? v.length * 2 : 0; } catch(e){ return 0; }
}
/* 3.20（主文件）：聊天记录缓存层（IndexedDB 深库 / 内存镜像 S.histMeta / LS_TM）
   已整删，故原 _histConvCount / idbStats 一并移除；面板对应项显示「已停用」。 */
function cacheStatsRender(){
  if (!el.cache_ls) return;
  try {
    const lsSkel = _lsBytes(LS_SKEL);
    let total = 0, keys = 0;
    const 明细 = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (!k || k.indexOf('trae_webm') !== 0) continue;
      const b = _lsBytes(k);
      total += b; keys++;
      if (b >= 2048) 明细.push([k.replace('trae_webm_', ''), b]);
    }
    明细.sort((a, b) => b[1] - a[1]);
    el.cache_skel.textContent = _fmtBytes(lsSkel);
    /* 3.20（主文件）：聊天记录缓存层（内存镜像 S.histMeta / IndexedDB 深库）已整删——
       纯实时广播不落聊天记录，此项显示「已停用」，不再有体积可算（0 而非 undefined）。 */
    el.cache_ls.textContent = '已停用（0 B）';
    el.cache_all.textContent = _fmtBytes(total) + ' · localStorage ' + keys + ' 项';
    /* 3.84：把 ≥2KB 的 trae_webm 键摊开——均设置项，**没有任何消息正文**。 */
    if (el.cache_lsk_det){
      el.cache_lsk_det.textContent = 明细.length
        ? 明细.map(x => x[0] + ' ' + _fmtBytes(x[1])).join(' · ')
        : '（均 <2KB：设备号/频道/名册/骨架/开关等设置项）';
    }
  } catch(e){}
  if (el.cache_idb) el.cache_idb.textContent = '已停用（历史深库已删）';
}
function clearHistCache(){
  /* 3.20（主文件）：聊天记录缓存层（IndexedDB 深库 / 内存镜像 S.histMeta / LS_TM）
     已整删，本按钮不再需要清任何落盘缓存——保留空动作（清内存显示池 + 重取当前
     会话），避免误触报错；面板「聊天记录缓存/历史深库」均显示「已停用」。
     仍不删 LS_SKEL（会话列表，秒开用）与频道名等设置。 */
  S.histConv = ''; S.histMsgs = null; S.histRaw = []; S.histNear = [];
  S.histLive = []; S.lastLiveRow = null; S.histVer = 0; S.histHave = 0; S.histShow = 4;
  flash('聊天记录缓存已停用（纯实时广播，无落盘记录可清）', 'var(--blue)');
  ensureHist();                 /* 重取当前会话（只取这一个，不全量灌溉） */
  cacheStatsRender();
}

/* ============ v1.50：主/副频道切换 + 自动切回探测 ============ */
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

/* ============ 2.02：语音播报音色/语速（改动立即生效、独立落盘，
   不脏化下面「保存」大按钮——那只管频道名与保留天数） ============ */
function ttsFlash(t, c){
  if (!el.lbl_tts_flash) return;
  el.lbl_tts_flash.textContent = t;
  el.lbl_tts_flash.style.color = c || 'var(--green)';
  setTimeout(() => {
    if (el.lbl_tts_flash.textContent === t) el.lbl_tts_flash.textContent = '';
  }, 3000);
}
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

/* ==================== 页内绑定（本模块加载时执行一次） ==================== */

el.netback.onclick = () => el.netpage.classList.remove('on');

/* 1.xx：连接诊断按钮 */
el.netreconn.onclick = () => {
  /* 1.60：连接本来好好的时候点这个按钮 = 自己把好连接掐断
     （用户误点 → 「一切回来就断线」观感的元凶）→ 先判新鲜度：
     已在线、且 srvIdleMs() 内还听得到服务端动静，就别重连。 */
  const fresh = S.onLine && S.lastSrv && (Date.now() - S.lastSrv < srvIdleMs());
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

if (el.cacheclear) el.cacheclear.onclick = clearHistCache;
if (el.cacheref) el.cacheref.onclick = cacheStatsRender;

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
    '超时（生效）：' + T(el.diag_tmo && el.diag_tmo.textContent),
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

if (el.sel_tts_voice) el.sel_tts_voice.value = ttsVoice();
if (el.sel_tts_rate)  el.sel_tts_rate.value  = ttsRate();
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
if (el.btn_tts_preview) el.btn_tts_preview.onclick = ttsPreview;

if (el.btn_chan_main) el.btn_chan_main.onclick = () => switchChan('main');
if (el.btn_chan_back) el.btn_chan_back.onclick = () => switchChan('backup');