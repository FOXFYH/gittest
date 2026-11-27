'use strict';
 /* 消息渲染.js（网页端）  版本 2.305  日期 2026-11-25 */
/* ========== 2.92：思维流折叠头 / 子代理外层「轻量呈现」（对齐 TRAE 原版） ==========
   服务端「采集剥壳规则整改」（C4·痕迹与配置 0.15 / TRAE界面JS 0.07 / 命令路由 0.23）起，
   `core-expandable-section`（思维流折叠头）与子代理 header 最外层**不再 remove()**，
   这些文案随 AI 行正文（快照 msgs[i][1]）以【文本行】带出（广播/账本/网页端同源）。
   本端把 AI 行按下面的三类「块」轻量重建，尽量贴近原版观感：
     · 折叠头行（思考过程 / 已执行N条命令 / 已搜索N次文件 …）→ 灰色 13px 折叠条；
     · 子代理外层（Sub Coding Agent ＋ 副标题「已编辑N个文件…」）→ 标题＋副标题（灰 13px）；
     · 其余行 → 原样交给原 mdHtml 管线（一字不改）。
   折叠条默认折叠、点击可展开，高 28 / #737373 / 13px（贴原版）。
   人类消息**不折叠**（老板口径：人类发言全量显示）。
   字段缺省（正文无这些文案）⇒ 退化为「整段正文」原样渲染，不渲染、不报错。
   ⚠ 协议待服务端定稿：当前据源码落盘形态＝**文本行**（非结构化字段），
     故本端按文本行识别；若服务端日后改结构化字段，再另行对齐。 */

/* 折叠头判据：短行（≤40 字）＋ 命中关键词/计数条，绝不误伤正文长句。 */
function _isFoldLine(s){
  s = String(s == null ? '' : s).trim();
  if (!s || s.length > 40) return false;
  if (/^Sub\s*Coding\s*Agent/i.test(s)) return false;   /* 子代理头另行处理 */
  if (/^(思考过程|思考中|已深度思考)/.test(s)) return 'fold';
  if (/^已(执行|读取|搜索|创建|修改|编辑|删除|更新|查看|运行|访问|写入|生成|调用|使用|浏览|打开)\s*\d+\s*(条命令|次文件|个文件|条|次|个|项|步|张|段|份)/.test(s))
    return 'fold';
  return false;
}
function _isSubLine(s){
  return /^Sub\s*Coding\s*Agent/i.test(String(s == null ? '' : s).trim());
}

/* 把一段 AI 正文拆成 [{t:'text',lines}|{t:'fold',title,lines}|{t:'sub',title,subtitle,lines}]。
   规则：头与头**之间**的行 → 归入前一个头（其可折叠内容）；头之前的行、
   以及**最后一个头之后**的尾行（通常是 AI 最终答复）→ 归入正文 text 块，
   保证答复绝不被末尾头吞掉。 */
function thinkBlocks(text){
  const lines = String(text == null ? '' : text).split('\n');
  const hdr = [];
  for (let i = 0; i < lines.length; i++){
    if (_isSubLine(lines[i])){
      let j = i + 1, subtitle = '', endIdx = i;
      while (j < lines.length && !String(lines[j]).trim()) j++;
      /* 子代理外层＝标题行 ＋ 紧随其后的副标题行（原版结构恒定：title+subtitle
         相邻）。副标题文案本身可能形如「已编辑N个文件…」（会命中折叠头计数条），
         故此处**不再用 _isFoldLine 排除**——只要紧随的非空行不是另一个 Sub 头，
         就认作副标题，避免把子代理副标题误当独立折叠条。 */
      if (j < lines.length && !_isSubLine(lines[j])){
        subtitle = String(lines[j]).trim(); endIdx = j;
      }
      hdr.push({idx: i, endIdx: endIdx, t: 'sub',
                title: String(lines[i]).trim(), subtitle: subtitle});
      i = endIdx;
    } else if (_isFoldLine(lines[i])){
      hdr.push({idx: i, endIdx: i, t: 'fold',
                title: String(lines[i]).trim(), subtitle: ''});
    }
  }
  const out = [];
  let prevEnd = -1;
  hdr.forEach((h, k) => {
    /* 只有「第一个头之前」的行是独立正文；头与头之间的行恒属前一头内容，
       绝不再重复成正文块（否则同一行既进内容又进正文）。 */
    if (k === 0){
      const pre = lines.slice(0, h.idx);
      if (pre.join('\n').trim()) out.push({t: 'text', lines: pre});
    }
    const next = hdr[k + 1];
    const content = next ? lines.slice(h.endIdx + 1, next.idx) : [];
    out.push({t: h.t, title: h.title, subtitle: h.subtitle, lines: content});
    prevEnd = h.endIdx;
  });
  const tail = lines.slice(prevEnd + 1);
  if (tail.join('\n').trim()) out.push({t: 'text', lines: tail});
  return out;
}

/* 单段正文 → HTML（语音卡/提问卡/专属提示词卡三套占位符管线，与原逻辑一字一致）。 */
function _mdBody(t){
  const fsegs = [], asegs = [], hsegs = [];
  let h = mdHtml(foxHintCards(foxAskCards(foxPlayCards(t, fsegs), asegs), hsegs));
  fsegs.forEach((ft, n) => { h = h.replace('@@FPC' + n + '@@', foxCardHtml(ft)); });
  asegs.forEach((at, n) => { h = h.replace('@@FAC' + n + '@@', foxCardHtml(at, true)); });
  hsegs.forEach((hz, n) => { h = h.replace('@@FHC' + n + '@@', foxHintHtml(hz)); });
  return h;
}

/* 折叠头/子代理外层 → 折叠条 HTML（高 28 / 灰 13px；默认折叠）。
   可折叠内容＝头与头之间的行；无内容时不留空 div（点击仅切换箭头）。 */
function thinkBarHtml(b){
  const ic = '<span class="fbic">▸</span>';
  const cnt = (b.lines || []).join('\n');
  const body = cnt.trim() ? '<div class="fbc">' + _mdBody(cnt) + '</div>' : '';
  if (b.t === 'sub'){
    return '<div class="subhd open"><div class="fbhd">' + ic
      + '<span class="subt">' + esc(b.title) + '</span>'
      + (b.subtitle ? '<span class="subs">' + esc(b.subtitle) + '</span>' : '')
      + '</div>' + body + '</div>';
  }
  return '<div class="foldbar open"><div class="fbhd">' + ic
    + '<span class="fbt">' + esc(b.title) + '</span>'
    + '</div>' + body + '</div>';
}

function _pendOwnerOk(pend){
  if (!pend || !pend.length) return true;
  /* 账本V1.0（N4）：条目自带项级 sid ⇒ 整批放行，归属判定下沉到渲染层
     逐条做（pendItemMine），不再因顶层 pend_sid 归属不明误杀整批。 */
  if (pend.some(p => p && typeof p === 'object' && p.sid != null)) return true;
  const ps = String((S.snap && (S.snap.pend_sid || S.snap.selSid)) || '');
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  if (!ps || !cs) return false;
  if (ps === cs) return true;
  return !!(typeof 稳定键 === 'function'
            && 稳定键(ps, '') === 稳定键(cs, ''));
}

function _thinkCardHtml(c){
  const _ph = !!c.placeholder;
  const _m = String(c.time || '').match(/(\d{1,2}):(\d{2})/);
  const hm = _m ? (('0' + _m[1]).slice(-2) + ':' + _m[2]) : '';
  const tm = hm ? '<span class="tm" style="flex-shrink:0;white-space:nowrap;margin-left:6px">' + hm + '</span>' : '';
  const ver = _ph ? '' : ('<span class="tm" style="flex-shrink:0;white-space:nowrap;margin-left:6px">v'
       + (parseInt(c.thinkVer, 10) || 1) + '</span>');
  const ttl = '<span class="tk" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;'
       + 'white-space:nowrap;margin-left:6px">' + esc(c.title || '') + '</span>';
  const body = String(c.text || '').trim() || (_ph ? '正在获取思维流' : '');
  return '<div class="msg agent thinklive' + (_ph ? ' thinkph' : '') + '" data-think="'
       + esc(c.thinkId || '') + '"'
       + ' style="border:1px dashed #4a9eff;border-radius:10px;padding:8px 10px;margin-top:8px">'
       + '<div class="who" style="display:flex;align-items:center;min-width:0">'
       + '<span style="flex-shrink:0">🧠</span>' + ttl + tm + ver + '</div>'
       + '<div class="body" style="white-space:pre-wrap;word-break:break-word;'
       + 'max-height:45vh;overflow:auto">' + _mdBody(body) + '</div></div>';
}
function _lbLastRoundFinal(msgs){
  try{
    const arr = Array.isArray(msgs) ? msgs : [];
    let lastU = -1;
    for (let i = arr.length - 1; i >= 0; i--){
      if (Array.isArray(arr[i]) && arr[i][0] === 'u'){ lastU = i; break; }
    }
    if (lastU < 0) return false;
    for (let i = lastU + 1; i < arr.length; i++){
      const _hard = (typeof lbFinalHard === 'function')
        ? lbFinalHard(arr[i])
        : (typeof lbIsFinalRow === 'function' ? lbIsFinalRow(arr[i]) : false);
      if (_hard) return true;
    }
    return false;
  }catch(e){ return false; }
}

const LS_GUIDE_DONE = 'trae_webm_guide_done';
function guideDone(){
  try { return localStorage.getItem(LS_GUIDE_DONE) === '1'; } catch(e){ return false; }
}
function guideHtml(){
  return '<div class="empty" id="guidecard" style="text-align:left;max-width:430px;'
    + 'margin:18px auto;padding:12px 14px;background:#fff;border:1px solid var(--bd);'
    + 'border-radius:10px;color:#444;line-height:1.75;">'
    + '<div style="font-weight:bold;color:var(--blue);margin-bottom:6px;">第一次用？三步就能聊</div>'
    + '<div>① 上方选择要看的会话（点左上角 ☰ 打开会话列表）</div>'
    + '<div>② 中间是聊天记录：人类发言 / AI 终极回复 / 思维流</div>'
    + '<div>③ 底部输入框发消息，忙时会排队</div>'
    + '<div style="text-align:right;margin-top:8px;">'
    + '<button type="button" onclick="guideDismiss()" '
    + 'style="min-height:30px;padding:2px 14px;">知道了</button></div></div>';
}
function guideDismiss(){
  try { localStorage.setItem(LS_GUIDE_DONE, '1'); } catch(e){}
  const g = document.getElementById('guidecard');
  if (g) g.outerHTML = '<div class="empty">（暂无消息，发送一条开始对话）</div>';
}
/* 启动时若还没人渲染正文（无缓存/首帧未到）也先铺引导，不白屏、不挡输入框 */
function guideBoot(){
  try {
    if (guideDone() || !el || !el.msgs) return;
    if (el.msgs.querySelector('.msg')) return;
    el.msgs.innerHTML = guideHtml();
  } catch(e){}
}

function renderMsgs(msgs, finish, opts, ask, pend){
  opts = opts || [];
  if (!_pendOwnerOk(pend)) pend = [];
  S.msgs_last = [msgs, finish, opts, ask, pend];
  try { if (typeof pendLandingScan === 'function') pendLandingScan(msgs, pend || []); } catch(e){}
  let key = msgs.map(m => m[0] + ':' + m[1] + ':' + (m[3] || 0)
                              + (m[4] || 0) + ':' + (m[7] || 0)
                              + ':' + (m[8] || '')).join('#');
  if (finish)
    key += '#fin:' + (finish.inLast ? 'L' : '-') + '|'
           + (finish.files || []).join('|') + '~'
           + (finish.text || '').slice(0, 60);
  key += '#opt:' + opts.map(o => o.t).join('|');
  key += '#ask:' + askFp(ask);
  key += '#qp:' + (pend || []).map(p =>
    ((p && p.text != null) ? String(p.text) : String((p && p.t) || (p && p.id) || '')).slice(0, 40)
  ).join('|');
  key += '#pend:' + pendSig();
  /* 账本V1.0（G1）：历史补发折叠面板轮数参与指纹（面板进出要重画） */
  key += '#lbf:' + (S.lb_foldRounds || 0);
  let _think = (typeof thinkCardNow === 'function') ? thinkCardNow(msgs) : null;
  let _lightNow = (typeof _curConvLight === 'function') ? _curConvLight() : '';
  /* 人类消息即发帧不带会话灯：最后一条是人类行且 30 秒内发出 ⇒ 乐观按 busy，
     让思维灯与正文一起上屏；真实灯/思维流帧到达后自然覆盖 */
  if (_lightNow !== 'busy' && !_lbLastRoundFinal(msgs)
      && Array.isArray(msgs) && msgs.length){
    const _lrow = msgs[msgs.length - 1];
    if (Array.isArray(_lrow) && _lrow[0] === 'u'){
      const _hx = String(_lrow.length > 6 ? (_lrow[6] || '') : '');
      const _mt = parseInt(_hx.slice(0, 8), 16);
      if (_mt && (Date.now() / 1000 - _mt) < 30) _lightNow = 'busy';
    }
  }
  if (!_think && _lightNow === 'busy' && !_lbLastRoundFinal(msgs)){
    _think = {placeholder: true, thinkId: '', time: '', thinkVer: 0,
              title: String((typeof curTitle === 'function' ? curTitle() : '') || ''),
              text: '正在获取思维流'};
  }
  key += '#tc:' + (_think
    ? (_think.thinkId + '\u0001' + String(_think.text || '').slice(-40)) : '0');
  if (key === S.msgs_key) return;
  S.msgs_key = key;
  const inF = document.body.classList.contains('fmsg');
  const savedTop = el.msgs.scrollTop;
  const nearBottom = el.msgs.scrollHeight - savedTop
      - el.msgs.clientHeight < 200;
  clearGesture();
  el.msgs.innerHTML = '';
  const _qLatch = (function(){
    try { qsentLatchSync(pend); } catch(e){}
    return qsentList(pend);
  })();
  const empty = !msgs.length && !opts.length;
  if (empty && !_think && !S.pending.length && !S.switch_pend
      && !(pend || []).length && !_qLatch.length){
    el.msgs.innerHTML = (guideDone()
          ? '<div class="empty">（暂无消息，发送一条开始对话）</div>'
          : guideHtml());
    return;
  }
  if (empty && !_think && !(pend || []).length && !_qLatch.length){
    renderPending();
    return;
  }
  const times = resolveTimes(msgs);
  let ui = -1;                       // 「我」的消息序号（rewind/del_msg 用）
  msgs.forEach((m, i) => {
    const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
    if (_k8 === 'th') return;
    if (/^th:/i.test(String((m.length > 6 && m[6]) || ''))) return;
    if (m[0] !== 'u' && typeof lbPureThink === 'function' && lbPureThink(m)) return;
    const user = m[0] === 'u';
    let acts = '';
    acts += '<button class="mact cpy" data-k="copy" data-i="' + i
          + '">📋 复制</button>';
    if (user){
      ui++;
      acts += '<button class="mact ed" data-k="edit" data-i="' + i
            + '">✎ 重编</button>';
      if (m[3]) acts += '<button class="mact rev" data-k="rewind" data-mi="'
                      + ui + '">↩ 回退</button>';
      if (m[4]) acts += '<button class="mact del" data-k="del_msg" data-mi="'
                      + ui + '">🗑 删除</button>';
    }
    const d = document.createElement('div');
    d.className = 'msg ' + (user ? 'user' : 'agent');
    try { if (m[6]) d.setAttribute('data-mid', String(m[6])); } catch(e){}
    let bodyHtml;
    {
      const _src = user ? stripHeadDid(m[1]) : m[1];
      if (user){
        bodyHtml = '<div class="body">' + _mdBody(_src) + '</div>';
        try{
          const _raw0 = String(m[1] || '');
          const _mine0 = /^\s*\d{14}/.test(_raw0);
          const _inline0 = /\(@fox-sys1|\(@fox-usr1|\(@fox-co1|\(@fox-ai1|\(@fox-lib1/.test(_raw0);
          if (_mine0 && !_inline0 && typeof window.plibHintSegs === 'function'){
            const _hz0 = window.plibHintSegs(
              (typeof curSid === 'function' ? curSid() : ''), '');
            if (_hz0) bodyHtml += foxHintHtml(_hz0);
          }
        }catch(e){}
      } else {
        const _blks = thinkBlocks(_src);
        bodyHtml = _blks.map(b => b.t === 'text'
          ? '<div class="body">' + _mdBody(b.lines.join('\n')) + '</div>'
          : thinkBarHtml(b)).join('');
      }
    }
    let h = '<div class="who">' + (user ? '我' : 'TraeWork')
          + (times[i] ? '<span class="tm">' + esc(times[i]) + '</span>' : '')
          + (acts ? '<span class="mract">' + acts + '</span>' : '')
          + '</div>' + bodyHtml;
    d.innerHTML = h;
    d.querySelectorAll('.foldbar .fbhd, .subhd .fbhd').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        b.parentElement.classList.toggle('open');
      };
    });
    d.querySelectorAll('.foxplay .fpbtn').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const card = b.closest('.foxplay');
        foxPlay(card ? (card.getAttribute('data-seg') || '') : '');
      };
    });
    foxHintBind(d);
    d.querySelectorAll('.mact').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const k = b.dataset.k, mi = parseInt(b.dataset.mi);
        if (k === 'copy'){
          const c0 = msgs[parseInt(b.dataset.i)];
          copyText(c0 ? copyPlain(c0[1], c0[0] === 'u') : '');
          return;
        }
        if (k === 'edit'){
          const it = msgs[parseInt(b.dataset.i)];
          if (!it || it[0] !== 'u'){
            flash('只能取回我发的人类原话，AI 回复不取回', 'var(--red)', 5000);
            return;
          }
          if (!hasUserDid(it[1])){
            flash('该条没有 DID，不是可锚定的人类原话，已跳过取回', 'var(--red)', 5000);
            return;
          }
          el.ent.value = copyPlain(it[1], true);
          refreshSendBtn();
          try { el.ent.focus(); } catch(e2){}
          flash('已回填原话（已去 DID/前后缀），可修改后重新发送', 'var(--blue)');
          return;
        }
        if (k === 'rewind'){
          uiConfirm('↩ 回退到这条消息之前',
            '回退到第 ' + (mi + 1) + ' 条「我」的消息之前？<br>'
            + '其后全部对话（含 AI 回复）将一并移除。', '回退', () => {
              srvOpSend(k, mi, '回退');
              S.revertPend = Date.now();
            });
        } else {
          uiConfirm('🗑 删除这条消息',
            '删除第 ' + (mi + 1) + ' 条「我」的消息？<br>'
            + '其对应的 AI 回复会一并删除。', '删除', () => {
              srvOpSend(k, mi, '删除消息');
            });
        }
      };
    });
    el.msgs.appendChild(d);
  });
  if (ask && ask.opts && ask.opts.length){
    const fp = askFp(ask);
    if (S.ask_lock && S.ask_lock.fp !== fp) S.ask_lock = null;
    const locked = S.ask_lock && S.ask_lock.fp === fp;
    const oc = document.createElement('div');
    oc.id = 'opts';
    let h = '<div class="othint">🤖 AI 提问'
          + (ask.q ? ' · ' + esc(ask.q) : '')
          + '（点选项作答会自动进下一问；或填「其他」点主按钮）</div>';
    ask.opts.forEach((o, i) => {
      if (o.other) return;             /* 其他项渲染成输入框 */
      const isPicked = locked && S.ask_lock.idx === i;
      h += '<button class="optbtn' + (isPicked ? ' picked' : '')
         + '" data-ai="' + i + '"'
         + (locked && !isPicked ? ' disabled' : '') + '>'
         + esc(o.t) + '</button>';
    });
    const oi = ask.opts.findIndex(o => o.other);
    if (oi >= 0)
      h += '<div class="otherrow"><input id="askother" '
         + 'placeholder="其他：输入你的回答（可不选直接填这里）" '
         + 'maxlength="500"></div>';
    h += '<div class="askfoot">'
       + (ask.prev ? '<button id="askprev">⬅ 上一题</button>' : '')
       + (ask.cancel ? '<button id="askcancel">取消</button>' : '')
       + '<button id="askgo">' + esc(ask.btn || '下一步') + '</button>'
       + '</div>';
    oc.innerHTML = h;
    oc.querySelectorAll('.optbtn').forEach(b => {
      b.onclick = () => {
        if (b.disabled) return;
        const idx = parseInt(b.dataset.ai);
        if (locked && S.ask_lock.idx === idx){
          /* 再点已选项 = 反选（TRAE 原生为切换选中态），解锁 */
          S.ask_lock = null;
        } else {
          S.ask_lock = {fp: fp, idx: idx};
        }
        renderAll();                   /* 立即出锁定态（服务端 ~1s 生效） */
        srvOpSend('ask_pick', idx, '选择「' + b.textContent.slice(0, 20) + '」',
                  '点「' + (ask.btn || '下一步') + '」继续');
      };
    });
    const go = oc.querySelector('#askgo');
    if (go) go.onclick = () => {
      const inp = oc.querySelector('#askother');
      const v = inp ? (inp.value || '').trim() : '';
      go.disabled = true;
      if (v){
        srvOpSend('ask_other', v, '提交自定义回答');   // ②＋rcpt ③④
      } else {
        srvOpSend('ask_submit', 0, '提交答案');        // ②＋rcpt ③④
      }
    };
    const cc = oc.querySelector('#askcancel');
    if (cc) cc.onclick = () => {
      cc.disabled = true;
      srvOpSend('ask_cancel', 0, '取消提问');          // ②＋rcpt ③④
    };
    const pv = oc.querySelector('#askprev');
    if (pv) pv.onclick = () => {
      pv.disabled = true;
      S.ask_lock = null;               /* 回退后必然换题，解锁单选 */
      srvOpSend('ask_prev', 0, '回到上一题');          // ②＋rcpt ③④
    };
    el.msgs.appendChild(oc);
  } else if (opts.length){
    const oc = document.createElement('div');
    oc.id = 'opts';
    const hint = document.createElement('div');
    hint.className = 'othint';
    hint.textContent = 'AI 提问 · 点选一项继续：';
    oc.appendChild(hint);
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'optbtn';
      b.textContent = o.t;
      b.onclick = () => {              /* 点了先给反馈并防重复点
                                          （服务端要 ~1s 才生效） */
        if (b.disabled) return;
        b.disabled = true;
        b.classList.add('picked');
        srvOpSend('pick_opt', i, '选择');      // ②＋rcpt ③④
      };
      oc.appendChild(b);
    });
    el.msgs.appendChild(oc);
  }
  const showFin = finish && finish.inLast && (finish.files || finish.text);
  if (showFin){
    const d = document.createElement('div');
    d.id = 'finish';
    let h = '<div class="ft">✅ 任务完成'
          + ((finish.files || []).length
             ? '  生成物 ' + finish.files.length + ' 个' : '')
          + '</div>';
    const txt = (finish.text || '').trim();
    if (txt) h += '<div class="ff">' + esc(txt.split('\n')[0].slice(0,80))
                + '</div>';
    (finish.files || []).forEach(
      f => h += '<div class="ff">📄 ' + esc(f) + '</div>');
    d.innerHTML = h;
    el.msgs.appendChild(d);
  }
  if (_think) el.msgs.insertAdjacentHTML('beforeend', _thinkCardHtml(_think));
  if ((pend && pend.length) || _qLatch.length){
    const qp = document.createElement('div');
    qp.className = 'qpanel';
    let qh = '<div class="qhead" title="AI 忙完会按顺序处理这些消息">⏳ 官方排队条</div>';
    qopenPrune(pend);        /* 清掉已不在队列里的「展开」标记 */
    /* 账本V1.0（N4）：项级 sid 过滤——只渲染当前锚定会话的条目；渲染下标
       仍取服务端原数组序号（data-qi），命令对位不受过滤影响。 */
    const _pendShown = [];
    const _seenQ = new Set();
    pend.forEach((p, i) => {
      const mine = (typeof pendItemMine === 'function') ? pendItemMine(p) : null;
      if (mine === false
          && !(typeof pendDidOwn === 'function' && pendDidOwn(p))) return;
      const _pk = (typeof pendTxtKey === 'function') ? pendTxtKey(p) : '';
      if (_pk && _seenQ.has(_pk)) return;
      if (_pk) _seenQ.add(_pk);
      _pendShown.push([p, i]);
    });
    try {
      if (typeof diagLog === 'function' && pend.length !== _pendShown.length){
        diagLog('[pend] 渲染：数组 ' + pend.length + ' 条 → 画出 '
                + _pendShown.length + ' 条', 'warn');
      }
    } catch(e){}
    _pendShown.forEach(([p, i]) => {
      const qi = (typeof p.__i === 'number') ? p.__i : i;
      /* 账本V1.0（N2）：新格式条目（p.text 有值）＝服务端已剥净的用户原文
         （首行 DID→id 字段底层携带、提示词/后缀已剥），界面只显示原文，
         不再走专属词折叠卡管线；旧格式维持 DID/三段剥净不变。 */
      const _new = (p.text != null);
      const _raw = stripPendTail(_new ? String(p.text) : stripHeadDid(p.t || ''));
      const _hz = [];
      const _head = _new ? _raw : foxHintCards(_raw, _hz);
      const _hasH = _new ? false : _hz.length > 0;
      const _txt = _hasH ? _head.replace(/\s*@@FHC\d+@@\s*$/, '') : _head;
      const _qk = _new ? ('\u0001' + (p.id || _raw)) : p.t;
      const _ghost = !!p._ghost;
      qh += '<div class="qitem">'
         + '<div class="qcol">'
         + '<div class="qtxt' + (S.qopen[_qk] ? ' open' : '') + '"'
         + ' data-qt="' + i + '" title="点一下展开/收起全文">'
         + esc(_txt) + '</div>'
         + (_hasH ? '<div class="qfh">' + foxHintHtml(_hz[0]) + '</div>' : '')
         + '</div>'
         + '<div class="qbtns">'
         + '<button class="go qsend' + (_ghost ? ' dimq' : '') + '" data-qi="' + qi
         + '" data-qx="' + i + '"' + (_ghost ? ' title="待对齐，稍后可操作"' : '') + '>⚡发送</button>'
         + '<div class="qsub">'
         + '<button' + (_ghost ? ' class="dimq" title="待对齐"' : '')
         + ' data-qi="' + qi + '" data-qx="' + i + '" data-qk="edit">✎</button>'
         + '<button class="del' + (_ghost ? ' dimq' : '') + '" data-qi="' + qi
         + '" data-qx="' + i + '" data-qk="del"' + (_ghost ? ' title="待对齐"' : '') + '>🗑</button>'
         + '</div></div>'
         + '</div>';
    });
    _qLatch.forEach(e => {
      qh += '<div class="qitem">'
         + '<div class="qcol">'
         + '<div class="qtxt" title="已发出，等服务器确认进入对话流">'
         + esc(e.text) + '</div>'
         + '</div>'
         + '<div class="qbtns">'
         + '<button class="go qsend" disabled>⏳ 发送中…</button>'
         + '</div></div>';
    });
    qp.innerHTML = qh;
    foxHintBind(qp);
    qp.querySelectorAll('.qtxt').forEach(t2 => {
      t2.onclick = () => {
        const one = pend[parseInt(t2.dataset.qt)];
        /* 账本V1.0：新格式条目展开标记键＝\u0001+id（与渲染侧 _qk 同源） */
        const _k = one ? ((one.text != null) ? ('\u0001' + (one.id || one.text)) : one.t) : '';
        if (one && _k) S.qopen[_k] = !S.qopen[_k];
        t2.classList.toggle('open');
      };
    });
    qp.querySelectorAll('.qbtns button').forEach(b => {
      b.onclick = () => {
        if (b.disabled) return;
        const i = parseInt(b.dataset.qi);
        const k = b.dataset.qk;
        if (k === 'del'){
          uiConfirm('🗑 删除排队消息',
            '确认删除排队消息「'
            + esc(stripHeadDid((pend[i] || {}).t || '').slice(0, 40))
            + '」？<br>删除后不会发送。', '删除', () => {
              b.disabled = true;
              srvOpSend('pend_del', i, '删除排队消息');   // ②＋rcpt ③④
            });
        } else if (k === 'edit'){
          b.disabled = true;
          S.qedit = i;                     /* 快照回来后回填输入框 */
          srvOpSend('pend_edit', i, '取出到输入框');   // ②＋rcpt ③④（pend_edit_out 另回填）
        } else {
          b.disabled = true;
          const _lp = pend[i];
          const _lk = qsentKey(_lp);
          if (_lk){
            const L = S.qsent || (S.qsent = {});
            L[_lk] = {ts: Date.now(),
                      text: stripPendTail((_lp.text != null)
                              ? String(_lp.text || '') : stripHeadDid(_lp.t || ''))};
          }
          srvOpSend('pend_sendnow', i, '立即发送');     // ②＋rcpt ③④
        }
      };
    });
    el.msgs.appendChild(qp);
  }
  renderPending();                  // 占位气泡永远排在末尾
  try {
    const _tc = el.msgs.querySelectorAll('.thinklive');
    for (let i = 0; i < _tc.length - 1; i++){
      const _n = _tc[i];
      if (_n && _n.parentNode) _n.parentNode.removeChild(_n);
    }
  } catch(e){}
  if (inF && !S.pinBottom){
    fprog(savedTop);                /* 改走 fprog（程序滚动）——设静默期 + 作废手势窗口，
                                       位置不被快照拽回，也不会误触发上翻判定；
                                       1.20：全屏内只保位置，绝不自动退出（鬼打墙根因） */
  } else if (S.pinBottom){
    fprog(el.msgs.scrollHeight);
    if (!S.switch_pend && !S.livePend) S.pinBottom = false;
  } else if (nearBottom){
    fprog(el.msgs.scrollHeight);    /* 近底吸附：新消息照常跟底 */
  } else {
    fprog(savedTop);                /* 改走 fprog（程序滚动）——翻历史中位置不被快照拽回，
                                       且不产生「用户上翻」的误判 */
  }
}

var fLockUntil = 0;                 // 程序滚动/进出全屏后的静默截止

const QSENT_TMO = 90000;
function qsentKey(p){
  return (p && p.id != null) ? String(p.id) : '';
}
function qsentLatchSync(pend){
  const L = S.qsent || (S.qsent = {});
  const now = Date.now();
  for (const k in L) if (!(now - L[k].ts < QSENT_TMO)) delete L[k];
  const have = {};
  (pend || []).forEach(p => { const k = qsentKey(p); if (k) have[k] = 1; });
  const dids = {};
  ((S.snap && S.snap.msgs) || []).forEach(m => {
    if (!m || m[0] !== 'u') return;
    const d = (typeof pendDidOf === 'function') ? pendDidOf(m[1]) : '';
    if (d) dids[d] = 1;
  });
  for (const k in L) if (have[k] || dids[k]) delete L[k];
}
function qsentList(pend){
  const L = S.qsent || {};
  const have = {};
  (pend || []).forEach(p => { const k = qsentKey(p); if (k) have[k] = 1; });
  const out = [];
  for (const k in L) if (!have[k]) out.push({id: k, text: L[k].text, ts: L[k].ts});
  return out;
}

