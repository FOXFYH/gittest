'use strict';
/* 2.107（老板 2026-10-20 18:26/18:28）：三套 FOX 标记（play / ask / 新卡三段）同口径——
   头标之后按此优先级找收尾边界：① 先判是不是「下一个完整头标」（如 (@fox-play1)/(@fox-ask1)/
   第三套头标）⇒ 不是后缀：当前卡在此截断、并从该处另起一张新卡（同条消息可出多张卡）；
   ② 再判是不是「后缀标记的前三个字符 `(@f`」（且不构成完整头标）⇒ 合法收尾，并把残标
      一并吞到 `)`／行尾／下一个头标，避免残片留在正文；
   ③ 整段再无 `(@f` ⇒ 取头标之后【第一个空行】断句收尾（不再吞到消息末尾）；
   ④ 连空行都没有（单行到底）⇒ 不识别为卡片（当普通正文）并记一条告警。
   开头标记须写全（如 `(@fox-play1)`）。 */
const _FOX_ALL_HEAD = '\\(@fox-(?:play1|ask1|sys1|usr1|co1)\\s*\\)';
function _foxAllHeadRe(){ return new RegExp(_FOX_ALL_HEAD, 'g'); }
/* 未识别告警（10s 节流）：console + 诊断日志 + 一次性横幅，让问题立刻可见。 */
const _foxWarnT = {};
function foxClosedWarn(kind, head, tail){
  const now = Date.now();
  if (now - (_foxWarnT[kind] || 0) < 10000) return;
  _foxWarnT[kind] = now;
  const msg = '检测到 ' + head + ' 但未找到收尾边界（' + tail + '），已按普通正文显示';
  try { console.warn('[fox标记] ' + msg); } catch(e){}
  if (typeof diagLog === 'function'){ try { diagLog('⚠ ' + msg, 'bad'); } catch(e){} }
  if (typeof flash === 'function') flash('⚠ ' + msg, 'var(--orange)', 6000);
}
/* 通用扫描器：把某「头标」的卡片逐张摘出（按上述优先级找收尾）；onSeg(seg) 返回该段替换串。
   返回处理后的文本；unclosed=true 表示有头标且无任何合法收尾（未识别为卡片）。 */
function _foxScanCards(text, headRe, onSeg){
  const s = String(text == null ? '' : text);
  let outStr = '', pos = 0, unclosed = false;
  headRe.lastIndex = 0;
  let hm;
  while ((hm = headRe.exec(s))){
    const h0 = hm.index, h1 = h0 + hm[0].length;
    outStr += s.slice(pos, h0);
    const rest = s.slice(h1);
    const mHead = _foxAllHeadRe().exec(rest);       /* 下一个完整头标（零宽边界，不消费） */
    const iHead = mHead ? mHead.index : -1;
    const iAtf = rest.indexOf('(@f');                /* 下一个后缀前三字符 `(@f` */
    if (iAtf >= 0 && (iHead < 0 || iAtf < iHead)){
      /* ② `(@f` 合法后缀：消费残标——自 `(@f` 起吞到「最先到达的自然终点」：`)`（含）／
         换行前／下一个完整头标处（截断、不消费头标）／文末；避免残片（如 ox-play2）留在正文。 */
      const end = h1 + iAtf;
      const tail = s.slice(end);
      const jParen = tail.indexOf(')');
      const jNl = tail.indexOf('\n');
      const mNext = _foxAllHeadRe().exec(tail);
      const jHead = mNext ? mNext.index : -1;
      const cand = [tail.length];
      if (jParen >= 0) cand.push(jParen + 1);
      if (jNl >= 0) cand.push(jNl);
      if (jHead >= 0) cand.push(jHead);
      const ce = end + Math.min.apply(null, cand);
      const seg = s.slice(h1, end).trim();
      if (seg) outStr += onSeg(seg);
      pos = ce; headRe.lastIndex = ce;
    } else if (iHead >= 0){
      /* ① 下一个完整头标 ⇒ 当前卡在此截断；不消费头标（从该处另起一张新卡） */
      const end = h1 + iHead;
      const seg = s.slice(h1, end).trim();
      if (seg) outStr += onSeg(seg);
      pos = end; headRe.lastIndex = end;
    } else {
      /* ③ 整段再无 `(@f` ⇒ 第一个空行断句收尾 */
      const bm = /\n[ \t]*\n/.exec(rest);
      if (bm){
        const end = h1 + bm.index;
        const seg = s.slice(h1, end).trim();
        if (seg) outStr += onSeg(seg);
        pos = end + bm[0].length; headRe.lastIndex = pos;
      } else {
        /* ④ 单行到底、无后缀、无空行 ⇒ 不识别为卡片（当正文）＋告警 */
        unclosed = true;
        outStr += s.slice(h0, h1);
        pos = h1; headRe.lastIndex = h1;
      }
    }
  }
  outStr += s.slice(pos);
  return {text: outStr, unclosed: unclosed};
}
function foxPlayCards(txt, out){
  const r = _foxScanCards(txt, /\(@fox-play1\s*\)/g,
    seg => { out.push(seg); return '@@FPC' + (out.length - 1) + '@@'; });
  if (r.unclosed) foxClosedWarn('play', '(@fox-play1)', '(@f / 空行');
  return r.text;
}
/* ========== 2.21：AI 提问卡（用户 2026-10-01 规定） ==========
   (@fox-ask1) 开头、(@fox-ask2) 结尾包夹：AI 提问时用它把问题包起来，
   网页端渲染成琥珀色提问卡（比正文更抢眼），复用语音卡 ▶ 播放/TTS 通道可直接听题。
   2.107：与 foxPlayCards 同一收尾判定。 */
function foxAskCards(txt, out){
  const r = _foxScanCards(txt, /\(@fox-ask1\s*\)/g,
    seg => { out.push(seg); return '@@FAC' + (out.length - 1) + '@@'; });
  if (r.unclosed) foxClosedWarn('ask', '(@fox-ask1)', '(@f / 空行');
  return r.text;
}
/* ========== 2.77：专属提示词「三段折叠小卡片」（用户 2026-10-18 规定） ==========
   会话专属提示词由服务端 decorate（TRAE会话提示词管理器 1.32）拆成三段、各用一对
   FOX 标记包夹：系统 (@fox-sys1)…(@fox-sys2) / 用户 (@fox-usr1)…(@fox-usr2) /
   公司 (@fox-co1)…(@fox-co2)。网页端把三段合成**一张折叠小卡片**：平时只显示一排
   小标签（系统 ▸ / 用户 ▸ / 公司 ▸），点一个标签就展开该段内容、再点收起。
   2.107：三段各自按与语音卡/提问卡相同的收尾判定摘取（标记名不同，互不干扰）。 */
const FH_HEADS = ['(@fox-sys1', '(@fox-usr1', '(@fox-co1'];
/* 卡片开合状态 + 内容登记：快照每秒重画，开合要撑过重画 → 记在模块级表里（键＝三段内容指纹） */
const _fh_state = {};      /* key -> {open:bool, which:'sys'|'usr'|'co'|''} */
const _fh_data = {};       /* key -> {sys,usr,co} */
function foxHintKey(hz){
  return (hz.sys || '') + '\u0001' + (hz.usr || '') + '\u0001' + (hz.co || '');
}
function foxHintCards(txt, out){
  const s0 = String(txt || '');
  let idx = -1;
  FH_HEADS.forEach(p => { const i = s0.indexOf(p); if (i >= 0 && (idx < 0 || i < idx)) idx = i; });
  if (idx < 0) return s0;                       /* 无头标 → 原样（不误伤别的标记） */
  const head = s0.slice(0, idx);
  let t = s0.slice(idx);
  const segs = {sys: [], usr: [], co: []};
  let unclosed = false;
  const grab = (re, key) => {
    const r = _foxScanCards(t, re, seg => { segs[key].push(seg); return ''; });
    if (r.unclosed) unclosed = true;
    t = r.text;
  };
  grab(/\(@fox-sys1\s*\)/g, 'sys');
  grab(/\(@fox-usr1\s*\)/g, 'usr');
  grab(/\(@fox-co1\s*\)/g, 'co');
  const hz = {sys: segs.sys.length ? segs.sys[segs.sys.length - 1] : '',
              usr: segs.usr.length ? segs.usr[segs.usr.length - 1] : '',
              co:  segs.co.length  ? segs.co[segs.co.length - 1]  : ''};
  if (unclosed && !hz.sys && !hz.usr && !hz.co)
    foxClosedWarn('hint', '(@fox-sys1/@fox-usr1/@fox-co1)', '(@f / 空行');
  if (!hz.sys && !hz.usr && !hz.co) return s0;  /* 只有残标、无有效内容 → 原样 */
  out.push(hz);
  const h = head.replace(/\s+$/, '');
  return (h ? h + '\n' : '') + '@@FHC' + (out.length - 1) + '@@';
}
function foxHintHtml(hz){
  const key = foxHintKey(hz);
  _fh_data[key] = hz;
  const st = _fh_state[key] || (_fh_state[key] = {open: false, which: ''});
  const defs = [['系统', 'sys'], ['用户', 'usr'], ['公司', 'co']];
  let tabs = '';
  defs.forEach(function(d){
    const k = d[1], label = d[0];
    if (!hz[k]) return;                          /* 空段不出标签 */
    const on = (st.open && st.which === k);
    tabs += '<button class="fhbtn' + (on ? ' on' : '') + '" data-fh="' + k
          + '" title="' + label + '专属提示词">' + label + ' ▸</button>';
  });
  if (!tabs) return '';
  let pane = '';
  if (st.open && st.which && hz[st.which]){
    const names = {sys: '系统', usr: '用户', co: '公司'};
    pane = '<div class="fhpane"><div class="fhtitle">' + names[st.which]
         + '专属提示词</div><div class="fhbody">' + esc(hz[st.which]) + '</div></div>';
  }
  return '<div class="foxhint" data-fhkey="' + esc(key) + '">'
       + '<div class="fhrow">' + tabs + '</div>' + pane + '</div>';
}
function foxHintBind(root){
  (root || document).querySelectorAll('.foxhint .fhbtn').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const card = b.closest('.foxhint');
      if (!card) return;
      const key = card.getAttribute('data-fhkey') || '';
      const k = b.getAttribute('data-fh') || '';
      const st = _fh_state[key] || (_fh_state[key] = {open: false, which: ''});
      if (st.open && st.which === k){ st.open = false; st.which = ''; }  /* 再点收起 */
      else { st.open = true; st.which = k; }                            /* 点开该段 */
      const hz = _fh_data[key];
      if (hz){
        const tmp = document.createElement('div');
        tmp.innerHTML = foxHintHtml(hz);           /* setter 不执行脚本（esc 已转义） */
        const nc = tmp.firstElementChild;
        if (nc){
          card.replaceWith(nc);
          foxHintBind(nc.parentNode || document);
        }
      }
    };
  });
}
/* 剥掉三段标记（「取回/重编」我发出的消息时用：把服务端追加的专属词段忽略，还原纯正文）——
   消掉整段（含标记与内容），并剪掉多余空行；不动别的标记（play/ask）。 */
function stripHintMarks(txt){
  let s = String(txt || '');
  s = _foxScanCards(s, /\(@fox-sys1\s*\)/g, () => '').text;
  s = _foxScanCards(s, /\(@fox-usr1\s*\)/g, () => '').text;
  s = _foxScanCards(s, /\(@fox-co1\s*\)/g, () => '').text;
  return s
    .replace(/\(@fox-(?:sys|usr|co)\d?\s*\)/g, '')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
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
      ttsStage(seg, '直连未就绪，30 秒内未连通将自动回落服务端…', 'var(--orange)');
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

