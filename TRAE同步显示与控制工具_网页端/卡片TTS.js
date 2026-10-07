'use strict';
const FPC_REG = /\(@fox-play1\s*\)([\s\S]*?)(?:\(@fox-play2\s*\)|$)/g;
function foxPlayCards(txt, out){
  return String(txt || '').replace(FPC_REG, (m, p1) => {
    const seg = String(p1 || '').replace(/\(@[^)]*$/, '').trim();
    if (!seg) return '';
    out.push(seg);
    return '@@FPC' + (out.length - 1) + '@@';
  });
}
/* ========== 2.21：AI 提问卡（用户 2026-10-01 规定） ========== */
/* 识别标志正则：( @fox-ask1 ) 开头、( @fox-ask2 ) 结尾包夹。用途——AI 要
   向用户提问时（跨会话路由器时代主要面向「AI 问 AI」），把问题用这对标签
   包起来，网页端就把它渲染成**醒目的琥珀色提问卡**（比正文更抢眼，用户能
   一眼看到并及时作答），并复用语音卡那套 ▶ 播放/TTS 通道，可直接听题。
   与 foxPlayCards **同构**：有头就认（结尾可缺、可到消息末尾），末尾残标剪掉。 */
const FAC_REG = /\(@fox-ask1\s*\)([\s\S]*?)(?:\(@fox-ask2\s*\)|$)/g;
function foxAskCards(txt, out){
  return String(txt || '').replace(FAC_REG, (m, p1) => {
    const seg = String(p1 || '').replace(/\(@[^)]*$/, '').trim();
    if (!seg) return '';
    out.push(seg);
    return '@@FAC' + (out.length - 1) + '@@';
  });
}
/* 1.98：每段语音的会话内状态（阶段文案 + 颜色 + 已生成音频 BlobURL）。
   键＝正文文本本身：同一段文字只合成一次，再点 ▶ 直接重播（不重复生成）。 */
const _tts_state = {};
function ttsGet(seg){
  return _tts_state[seg] || (_tts_state[seg] = {st: '', cl: '', url: null});
}
function ttsStage(seg, st, cl){
  /* 阶段通知：先写进状态（快照重渲染卡片时沿用、阶段不丢），
     再就地更新当前已渲染的那张卡片的 .fpst 行 */
  const o = ttsGet(seg);
  o.st = st || ''; o.cl = cl || '';
  document.querySelectorAll('.foxplay').forEach(c => {
    if (c.getAttribute('data-seg') !== seg) return;
    const s = c.querySelector('.fpst');
    if (s){ s.textContent = o.st; s.style.color = o.cl || 'var(--gray)'; }
  });
}
function foxCardHtml(seg, ask){
  /* 1.96：全量显示原文（原先 >60 字截断加省略号，音频不可用时正文也看
     不全；用户规定必须全显示）。成本仅一行文字，不再截断。
     1.98：阶段通知行随卡片重建一起还原（取自 _tts_state）。
     1.99：阶段横幅**移到卡片最顶部**（用户2026-09-30指令）——正文一长
     （100 字以上）卡片就撑高，原先压在正文下方的提示行直接掉出视线，
     用户反馈「提示都看不到」。故 .fpst 必须排在 .fprow 之前，样式见
     CSS（负外边距撑满、贴齐顶边，空文本时 :empty 整条隐藏）。
     注意：st 为空时不要写入空白，否则 :empty 失效、会多出一条空横幅。
     2.04：按钮图标随播放态出——正在出声的那段显示 ⏸（暂停），其余 ▶。 */
  const o = _tts_state[seg];
  const st = o ? o.st : '', cl = o ? o.cl : '';
  const on = _foxOn(seg);
  return '<div class="foxplay' + (ask ? ' ask' : '') + '" data-seg="'
       + esc(seg) + '">'
       + '<div class="fpst"' + (cl ? ' style="color:' + cl + '"' : '')
       + '>' + esc(st) + '</div>'
       + '<div class="fprow"><span class="fptxt">'
       + (ask ? '❓ AI 提问：' : '🔈 ') + esc(seg) + '</span>'
       + '<button class="fpbtn" title="' + (on ? '暂停' : '播放语音') + '">'
       + (on ? '⏸' : '▶') + '</button></div>'
       + '</div>';
}
/* 2.00：一段 0.2 秒静音 WAV 的 base64（8000Hz / 16bit / 单声道）——用途：用户点 ▶ 的那一次手指手势里拿它当占位，把音频通道解锁。2.01 起循环播放（loop），当作「一直在播的假音频」占住已解锁的播放态，真音频到了只换源接着播。不这样做，云端音频 2~11 秒后才回来，早已脱离手势，play() 必被系统拦。 */
const FOX_SILENT = 'data:audio/wav;base64,UklGRqQMAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YYAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
let foxA = null;                 // 当前播放中的 Audio（新播放前停旧的）
let foxSeg = null;               // 2.04：当前正在播（或已暂停）的那段语音文本；null＝没在播
let foxPrimed = false;           // 2.00：音频通道是否已借用户手势解锁过（只解锁一次）
const _tts_pend = {};            // 在途请求：id → {ts, seg}
function foxUnlock(){
  /* 2.00：解锁音频通道，必须在**用户手势那一拍**里调用（foxPlay 开头）。
     2.01：改成「占位元素一直假装在播、真音频来了只换源接着播」（用户思路）——
     实测有效的正解是**复用同一个 audio 元素**，而不是另建一个新的：
       ① 手势里把 foxA 建出来、循环播 FOX_SILENT（无声，loop），元素就带着
          「已解锁、正在播放」的状态一直挂着，等真音频；
       ② 真音频到了，fpPlay 只把这个元素的 src 换掉接着播（loop 关掉），
          浏览器认的是这个元素已经开播过，不再当新的一次自动播放来拦。
     回调先置 null，别让静音播完/换源这些事改写横幅文案。解锁失败不报错——
     后面自动播被拦时，仍旧退回「请点击播放」让用户手点。 */
  if (foxPrimed) return;
  foxPrimed = true;
  try {
    foxA = new Audio(FOX_SILENT);
    foxA.onended = null; foxA.onerror = null;
    foxA.loop = true;                 // 一直「假装在播」，占住已解锁的播放态
    const p = foxA.play();
    if (p && p.catch) p.catch(() => {});
  } catch(e){ foxA = null; }
}
/* 2.04：播放/暂停三件套（用户 2026-09-30 规定：点播放后按钮要变暂停键） */
function _foxOn(seg){
  /* 这段语音此刻是否「正在出声」＝按钮该显示 ⏸ 的条件。
     只看我们自己记的 foxSeg：foxUnlock 的静音占位元素一直在循环播，
     foxA.paused 恒为 false，不能拿它当判断依据。 */
  return !!(seg && seg === foxSeg && foxA && !foxA.paused);
}
function foxSyncBtn(){
  /* 就地刷新已渲染卡片的按钮图标（卡片是快照重渲染的，
     foxCardHtml 里按同一条件出图标，两处判定保持一致）。 */
  document.querySelectorAll('.foxplay').forEach(c => {
    const b = c.querySelector('.fpbtn');
    if (!b) return;
    const on = _foxOn(c.getAttribute('data-seg'));
    b.textContent = on ? '⏸' : '▶';
    b.title = on ? '暂停' : '播放语音';
  });
}
function foxPause(seg){
  /* 暂停：foxA.pause() 后 _foxOn 自动转 false，按钮随之变回 ▶；
     阶段文案写进 _tts_state，快照重渲染也不丢。 */
  try { if (foxA) foxA.pause(); } catch(e){}
  ttsStage(seg || foxSeg, '已暂停，再点 ▶ 继续', 'var(--gray)');
  foxSyncBtn();
}
function foxStop(){
  /* 2.06：免打扰——切到别的会话 / 别的服务端目标时，立刻把正在播的语音停掉。
     只暂停 + 清 foxSeg（按钮随之刷回 ▶），不写阶段文案：此刻卡片已随切换被
     重渲染或清空，文案没人看。 */
  try { if (foxA) foxA.pause(); } catch(e){}
  foxSeg = null;
  foxSyncBtn();
}
function fpPlay(seg, url){
  /* 真正出声：音频已缓存，直连本地 blob 播放（不再走服务端）
     1.99：换源前**先摘掉旧元素的两个回调**——旧 audio 的 onerror/onended
     闭包指向同一个 seg，清 src 会让旧元素触发 error，把横幅改写成「音频播放
     失败」并弹红条，而新音频其实正在正常播放（CDP 实测：时间轴照走）。
     2.01：不再每次 new Audio，改为**复用 foxUnlock 建好的那个元素**换源接着播
     （见 foxUnlock 注释）；必须 loop=false，否则占位用的循环会把真音频念成死循环。
     2.04：记下 foxSeg（▶ 随即变 ⏸）；播完 / 出错 / 被拦一律清掉 foxSeg 并刷新按钮。 */
  foxA = foxA || new Audio();         // 兜底：万分解锁那一步没建成元素
  const a = foxA;
  a.onended = null; a.onerror = null;
  try { a.pause(); } catch(e){}
  a.loop = false;
  a.src = url;
  foxSeg = seg;                       // 2.04：记下在播哪段
  a.onended = () => {
    foxSeg = null; foxSyncBtn();      // 2.04：播完 → 按钮回 ▶
    ttsStage(seg, '播放完毕，点 ▶ 可重播', 'var(--gray)');
  };
  a.onerror = () => {
    foxSeg = null; foxSyncBtn();
    ttsStage(seg, '🔇 音频播放失败', 'var(--red)');
    flash('🔇 音频播放失败', 'var(--red)');
  };
  const p = a.play();
  foxSyncBtn();
  if (p && p.catch) p.catch(() => {
    foxSeg = null; foxSyncBtn();
    ttsStage(seg, '🔇 浏览器拦截播放，请再点 ▶', 'var(--orange)');
    flash('🔇 浏览器拦截自动播放，请再点 ▶', 'var(--orange)');
  });
  if (p && p.then) p.then(() => foxSyncBtn());
}
function foxPlay(seg){
  if (!seg) return;
  foxUnlock();     // 2.00：就在这一次点 ▶ 的手势里解锁音频通道（见 foxUnlock 注释）
  const o = ttsGet(seg);
  /* 2.04：同一张卡片再点一下＝暂停/继续（用户 2026-09-30 规定：点了播放，
     按钮要变成暂停键）。三种情形——正在出声→暂停；暂停中→从原处续播（不
     从头重新念）；已播完（foxSeg 已清）→ 往下走重播 / 重新合成流程。 */
  if (_foxOn(seg)){ foxPause(seg); return; }
  if (o.url && seg === foxSeg && foxA && foxA.paused){
    const rp = foxA.play();
    if (rp && rp.catch) rp.catch(() => {});
    if (rp && rp.then) rp.then(() => foxSyncBtn());
    ttsStage(seg, '正在播放…', 'var(--blue)');
    foxSyncBtn();
    return;
  }
  /* 已生成过 → 直接重播，一个字节都不再走服务端（用户规定：不重复生成） */
  if (o.url){ ttsStage(seg, '正在播放…', 'var(--blue)'); fpPlay(seg, o.url); return; }
  const id = newDid();
  _tts_pend[id] = {ts: Date.now(), seg: seg};
  ttsStage(seg, '正在连接 TTS…', 'var(--gray)');
  /* 2.69：直连为默认通道；直连不通则 TTS_GRACE 后回落服务端本机中转（备用兜底）。
     同一 id 只真正发出一次（直连或服务端二选一），不会出现两份相同语音。 */
  const payload = {t:'tts', id:id, text:seg, voice:ttsVoice(), rate:ttsRate()};
  /* 先让「正在连接 TTS」这一帧落地可见再发出（rAF 双帧保证已绘制；
     页面切后台时 rAF 不跑，用 setTimeout 兜底） */
  let _sent = false;
  const doSend = () => {
    if (_sent || !_tts_pend[id]) return;
    _sent = true;
    if (ttsRoute(id, seg, payload)){
      ttsStage(seg, '任务已提交', 'var(--blue)');
      flash('🔈 任务已提交，等 TTS 接收…', 'var(--blue)');
    } else {
      ttsStage(seg, '直连未就绪，2.5 秒内未连通将自动回落服务端…', 'var(--orange)');
      flash('🔈 直连未就绪，稍后自动回落服务端…', 'var(--orange)');
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(doSend));
  setTimeout(doSend, 120);
}
/* 在途 tts 请求超时兜底：60 秒没回就清掉（防 _tts_pend 泄漏） */
setInterval(() => {
  const now = Date.now();
  Object.keys(_tts_pend).forEach(id => {
    if (now - _tts_pend[id].ts > 60000){
      const seg = _tts_pend[id].seg;
      ttsClear(id);
      const o = _tts_state[seg];
      if (o && !o.url) ttsStage(seg, '⚠ TTS 60 秒未回，可重试', 'var(--orange)');
    }
  });
}, 20000);

