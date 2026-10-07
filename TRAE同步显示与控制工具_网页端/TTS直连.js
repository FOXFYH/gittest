'use strict';
/* 2.69：TTS 通道分层（用户 2026-10-07）——网页端 WS 直连 TTS 专属频道为
   **默认通道**；服务端「本机 TTS 中转」保留为**备用兜底**，仅在直连走不通时
   才回落（服务端仅被动响应 t=='tts'）。频道名 = 固定前缀 'TTS' + 同一把密钥
   （与主频道共用、自动拼接、用户只输一次），故项目复制到任何电脑都能连上
   「任何一台开着 TTS 的电脑」。遵守《13_软件外连联网如WebSocket等规范》：
   · 免心跳：连上后不发 ping / 不 hello / 不 login，全程静默（省流省电）；
   · 有工作在喊：只在点 ▶ / 试听时才发 FOX 帧，音频回完即归静默；
   · 限次限频：断线按 2/4/8 秒退避重连，≤3 次且累计 60 秒硬时限，用尽即
     宣告失败、绝不死磕；
   · FOX 2.0：请求与回执一律带 57 字节 FOX 头；本链路消息恒为单段
     （音频按 ≤10KB 应用层切片、每片仍单段），不触发分批/补发路径。

   ★ 铁律：同一个 id 只允许真正发出一次请求（直连 或 服务端 二选一），
   绝不两边同时发 → 不会出现两份相同语音。默认直连；TTS_GRACE 毫秒内直连
   未连通才回落服务端；直连一回 tts_error 允许一次服务端兜底；直连一连通即
   把仍在等待的请求改走直连、不再回落。 */
const TTS_PFX = 'TTS';
const TTS_GRACE = 2500;                      // 直连等待窗口（毫秒），超时回落服务端
function ttsChannelUrl(){
  const u = new URLSearchParams(location.search).get('tts');
  if (u) return u;                          // ?tts= 高级覆盖（不改持久化）
  const key = chanGet('main');              // 与主频道同一把密钥（用户只输一次）
  return WS_URL_TMPL.replace('%s', TTS_PFX + key);   // TTS 恒挂账号A(free.blr2)
}
let ttsWs = null, ttsOnLine = false, ttsReconnectTimer = null;
let ttsFailStreak = 0, ttsDeadline = 0;
const TTS_BACKOFF = [2000, 4000, 8000];      // 逐次退避（13.3）
const TTS_DEADLINE = 60000;                  // 单链路总时限（13.3）
const _tts_parts = {};                       // id → 音频分片累加器 {n,total,bin}
const _tts_fb = {};                          // id → 兜底状态 {tm:定时器|null, used:bool}

function ttsPayload(id){
  /* 由在途请求那段的文本重建一条 tts 请求（回落服务端时用同一条 payload） */
  const j = _tts_pend[id];
  return {t: 'tts', id: id, text: (j && (j.text || j.seg)) || '',
          voice: ttsVoice(), rate: ttsRate()};
}
function ttsClear(id){
  /* 任一路交付/失败/超时的统一落点：三处状态一并清干净（防泄漏/防重交付） */
  delete _tts_pend[id];
  delete _tts_parts[id];
  const f = _tts_fb[id];
  if (f && f.tm) clearTimeout(f.tm);
  delete _tts_fb[id];
}
function ttsRoute(id, seg, payload){
  /* 统一发送路由（外部唯一入口）：直连为默认，直连不通才在 TTS_GRACE 后回落
     服务端本机中转（备用兜底）。返回 true = 已由直连真正发出。 */
  const j0 = _tts_pend[id];
  if (j0) j0.text = payload.text;  // 试听 seg 是占位串，兜底重建 payload 要用真文本
  if (ttsOnLine && ttsWs && ttsWs.readyState === 1 && ttsFoxSend(payload)){
    return true;                            // 只走直连，绝不再碰服务端
  }
  ttsEnsure();                              // 直连没就绪：立刻起一次连接
  _tts_fb[id] = {tm: setTimeout(() => ttsFallback(id), TTS_GRACE), used: false};
  return false;
}
function ttsFallback(id){
  /* TTS_GRACE 到点：直连仍不通才走服务端；若已被某路交付则什么都不做。 */
  const f = _tts_fb[id];
  if (!_tts_pend[id]){ if (f) delete _tts_fb[id]; return; }
  if (ttsOnLine && ttsWs && ttsWs.readyState === 1 && ttsFoxSend(ttsPayload(id))){
    if (f) f.tm = null;                     // 直连赶上了：改走直连
    return;
  }
  if (f) f.used = true;                     // 标记本 id 兜底已用（同 id 最多一次）
  try { sendJson(ttsPayload(id)); } catch(e){}   // 备用：经主频道发服务端中转
}
function ttsErrorFallback(id){
  /* 直连回 tts_error：允许一次服务端兜底。返回 true = 已发起兜底。 */
  const f = _tts_fb[id];
  if (f && f.tm){ clearTimeout(f.tm); f.tm = null; }
  if (f && f.used) return false;            // 已用过兜底 → 不再重试
  if (f) f.used = true; else _tts_fb[id] = {tm: null, used: true};
  try { sendJson(ttsPayload(id)); return true; } catch(e){ return false; }
}
function ttsFoxSend(obj){
  /* 把一条 JSON 按 FOX 帧发到 TTS 频道（本链路恒单段，超 64KB 才分段） */
  if (!ttsOnLine || !ttsWs || ttsWs.readyState !== 1) return false;
  const parts = foxSplit(JSON.stringify(obj));
  const mid = foxNewMid();
  const ts = mid.slice(0, 14), rnd = mid.slice(14);
  try {
    for (let i = 1; i <= parts.length; i++){
      ttsWs.send('【FOXID:' + ts + rnd + MY_ID + '=cut(' + pad3(i) + '/'
                 + pad3(parts.length) + ')】' + parts[i-1]);
    }
  } catch(e){ return false; }
  return true;
}
function ttsConnect(){
  /* 建 TTS 直连（静默：无 ping/无 hello/无 login）。 */
  if (ttsWs){ try { ttsWs.onopen = ttsWs.onmessage = ttsWs.onclose = ttsWs.onerror = null; ttsWs.close(); } catch(e){} }
  clearTimeout(ttsReconnectTimer); ttsReconnectTimer = null;
  if (!chanGet('main')){ ttsWs = null; return; }   // 无密钥：等填完再连
  try { ttsWs = new WebSocket(ttsChannelUrl()); } catch(e){ ttsWs = null; return; }
  const w = ttsWs;
  w.onopen = () => {
    ttsOnLine = true; ttsFailStreak = 0; ttsDeadline = 0;
    diagLog('TTS 直连频道已就绪（静默待命）', 'ok');
    ttsFlushWait();                    // 连上即把仍在等待的请求改走直连
  };
  w.onmessage = ev => ttsOnMsg(ev.data);
  w.onerror = () => { /* 统一交给 onclose 走退避重连 */ };
  w.onclose = () => {
    ttsOnLine = false;
    if (!ttsDeadline) ttsDeadline = Date.now() + TTS_DEADLINE;
    if (ttsFailStreak >= TTS_BACKOFF.length || Date.now() > ttsDeadline){
      diagLog('TTS 直连不可达（重连 ' + ttsFailStreak + ' 次用尽），已停手', 'bad');
      ttsFailStreak = 0; ttsDeadline = 0;
      return;
    }
    ttsReconnectTimer = setTimeout(ttsConnect, TTS_BACKOFF[ttsFailStreak++]);
  };
}
function ttsEnsure(){
  /* 需要播报时确保链路就绪：已就绪→true；否则立刻起一次连接并返回 false */
  if (ttsOnLine && ttsWs && ttsWs.readyState === 1) return true;
  ttsFailStreak = 0; ttsDeadline = 0;   // 用户主动要播报 → 重开一次重连窗口
  ttsConnect();
  return false;
}
function ttsFlushWait(){
  /* 直连一通：把仍在等待窗口、还没真正发出的请求立即改走直连（不再回落服务端） */
  Object.keys(_tts_fb).forEach(id => {
    const f = _tts_fb[id];
    if (!f || f.used || !f.tm) return;      // 已用兜底 / 已发出 → 不动
    if (!_tts_pend[id]){ clearTimeout(f.tm); delete _tts_fb[id]; return; }
    if (ttsOnLine && ttsWs && ttsWs.readyState === 1 && ttsFoxSend(ttsPayload(id))){
      clearTimeout(f.tm); f.tm = null;
      ttsStage(_tts_pend[id].seg, '任务已提交', 'var(--blue)');
    }
  });
}
const FoxInTts = {                       // TTS 通道 FOX 拼装器（60s 残包超时）
  buf: {},
  feed(msg){
    const m = FOX_RE.exec(msg);
    if (!m) return null;
    const [, ts, rnd, sender, idx, total] = m;
    const body = msg.slice(msg.indexOf('】') + 1);
    if (parseInt(total) <= 1) return [sender, body];
    const mid = ts + rnd, t = Date.now();
    const d = this.buf[mid] || (this.buf[mid] = {n: parseInt(total), p: {}, at: t});
    d.p[parseInt(idx)] = body; d.at = t;
    if (Object.keys(d.p).length < d.n){
      for (const k in this.buf)
        if (t - this.buf[k].at > 60000) delete this.buf[k];
      return null;
    }
    let full = '';
    for (let i = 1; i <= d.n; i++) full += (d.p[i] || '');
    delete this.buf[mid];
    return [sender, full];
  }
};
function ttsOnMsg(msg){
  /* TTS 通道收帧：FOX 拼装 → JSON → 分流（tts_ack / tts_audio / tts_error） */
  statsAdd(msg.length, 0, 1, 0);
  const r = FoxInTts.feed(msg);
  if (!r) return;                        // 残余段 / 中继系统消息
  const [sender, body] = r;
  if (sender[0] !== '1') return;         // 只认 TTS 服务端（'1' 开头）
  let d; try { d = JSON.parse(body); } catch(e){ return; }
  if (!d || typeof d !== 'object') return;
  if (d.t === 'tts_ack'){ onTtsAck(d); return; }
  if (d.t === 'tts_error'){              // 2.69：直连失败 → 允许一次服务端兜底
    if (!ttsErrorFallback(d.id)) onTtsErr(d.id, d.error);
    return;
  }
  if (d.t !== 'tts_audio') return;
  const j = _tts_pend[d.id];
  if (!j) return;                        // 过期/不匹配（多端）忽略
  const a = _tts_parts[d.id] || (_tts_parts[d.id] = {n: 0, total: 0, bin: ''});
  a.total = parseInt(d.total) || 1;
  if (d.b64){ a.n++; a.bin += atob(d.b64); }   // 分片按**字节**拼，不能拼 base64
  if (a.n >= a.total){
    const bin = a.bin;
    delete _tts_parts[d.id];
    ttsDeliver(d.id, bin);
  } else {
    ttsStage(j.seg, '正在接收音频 ' + a.n + '/' + a.total + '…', 'var(--blue)');
  }
}
function onTtsAck(d){
  /* TTS 阶段回执——recv=已收到并受理、conv=引擎已开始合成 */
  const j = _tts_pend[d.id];
  if (!j) return;
  const conv = (d.st === 'conv');
  const txt = conv ? 'TTS 引擎正在转换…' : 'TTS 已收到，引擎正在转换…';
  ttsStage(j.seg, txt, 'var(--blue)');
  flash('🔈 ' + txt, 'var(--blue)');
}
function onTtsErr(id, msg){
  /* TTS 合成失败（直连 tts_error / 服务端 tts_resp 带 err） */
  const j = _tts_pend[id];
  if (!j) return;
  ttsClear(id);
  const t = msg || 'TTS 合成失败';
  ttsStage(j.seg, '🔇 ' + t, 'var(--red)');
  flash('🔇 ' + t, 'var(--red)');
}
function ttsDeliver(id, binStr){
  /* 音频分片全部收齐（或服务端整段 b64）→ 拼成 mp3 Blob → 缓存 + 播放。
     点 ▶ 那一拍 foxUnlock() 已借用户手势解锁音频通道，这里直接播；万一仍被
     系统拦，fpPlay 的 catch 会把横幅改成「请再点 ▶」（音频已缓存，再点必出声）。 */
  const j = _tts_pend[id];
  if (!j) return;                        // 已被先到的一路交付 → 天然去重
  ttsClear(id);
  const seg = j.seg;
  if (!binStr){ ttsStage(seg, '🔇 空音频', 'var(--red)'); return; }
  try {
    const ab = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) ab[i] = binStr.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([ab], {type: 'audio/mpeg'}));
    const o = ttsGet(seg);
    if (o.url){ try { URL.revokeObjectURL(o.url); } catch(e){} }
    o.url = url;                 // 存起来：下次点 ▶ 直接重播，不重复生成
    ttsStage(seg, '正在播放…', 'var(--blue)');
    fpPlay(seg, url);
  } catch(e){
    ttsStage(seg, '🔇 音频解码失败', 'var(--red)');
  }
}
