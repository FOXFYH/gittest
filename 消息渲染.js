'use strict';
/* 消息渲染.js（网页端）  版本 2.131  日期 2026-10-24
   【维护记录】
   2.131  2026-10-24  官方排队条「串台」（老板原话：「排队条一定要核实清楚属于
                     哪个会话，不能乱显示，是谁的就显示在谁那边」）：`renderMsgs`
                     画「⏳ 官方排队条」前先校验归属——取快照顶层 `pend_sid`
                     （无该字段回退快照 `selSid`），与当前锚定会话 sid 比对，
                     不一致就**整批丢弃、不画**；一致才进 `#qp:` 指纹与队列面板。
                     服务端配套 抓取轮询 0.58（快照盖章 pend_sid）/ WS桥 0.23
                     （指纹纳入 pend、实时发帧）。2.130→2.131。 */
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

/* 2.131：官方排队条归属校验（老板：「是谁的就显示在谁那边」）。
   快照 pend 只取【电脑端选中】那个会话，本端可能锚定在另一个会话 ⇒
   按顶层 `pend_sid`（旧服务端回退 `selSid`）比当前锚定 sid，不同就丢弃。
   字段都拿不到（旧服务端/列表中间态）⇒ 不新增丢弃，维持旧行为。 */
function _pendOwnerOk(pend){
  if (!pend || !pend.length) return true;
  /* 账本V1.0（N4）：条目自带项级 sid ⇒ 整批放行，归属判定下沉到渲染层
     逐条做（pendItemMine），不再因顶层 pend_sid 归属不明误杀整批。 */
  if (pend.some(p => p && typeof p === 'object' && p.sid != null)) return true;
  const ps = String((S.snap && (S.snap.pend_sid || S.snap.selSid)) || '');
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  /* 2.132：归属不明就不画——宁可不显示，也不留残影 */
  if (!ps || !cs) return false;
  if (ps === cs) return true;
  return !!(typeof 稳定键 === 'function'
            && 稳定键(ps, '') === 稳定键(cs, ''));
}

/* 2.203（老板 2026-11-19 22:02 令）：思维流只为 1 号网页用户提供。
   非 1 号（2/3 号）且当前会话思维灯亮（busy）时，本来该出思维流的位置改显占位文案；
   灯灭或换成别的灯（unread/fail/stop/无灯）即不显示（区域回归空态/正常渲染）。 */
function _thinkNoHostOn(){
  if (typeof hostIsFirst !== 'function' || hostIsFirst()) return false;
  return ((typeof _curConvLight === 'function' ? _curConvLight() : '') === 'busy');
}
function _thinkNoHostHtml(){
  return '<div class="msg agent thinkph"><div class="who">TraeWork</div>'
       + '<div class="body">您不是 1 号网页用户，无法提供思维流</div></div>';
}
/* 2.207（V1.0 §五-8）：小账本最底部固定挂的「一张」思维流卡——只展示，
   走不到 ledger 落盘/轮次统计/终极回复任何一条路。样式内联，免改 css。 */
function _thinkCardHtml(c){
  /* 2.231（老板 22:36 令·恢复 2.229 头部口径）：只留 🧠 + 会话名 + HH:MM + 版本号，
     不写「思维流」三字；会话名 flex:1 可省略，时间/版本不缩。 */
  const _m = String(c.time || '').match(/(\d{1,2}):(\d{2})/);
  const hm = _m ? (('0' + _m[1]).slice(-2) + ':' + _m[2]) : '';
  const tm = hm ? '<span class="tm" style="flex-shrink:0;white-space:nowrap;margin-left:6px">' + hm + '</span>' : '';
  const ver = '<span class="tm" style="flex-shrink:0;white-space:nowrap;margin-left:6px">v' + (parseInt(c.thinkVer, 10) || 1) + '</span>';
  const ttl = '<span class="tk" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;'
       + 'white-space:nowrap;margin-left:6px">' + esc(c.title || '') + '</span>';
  return '<div class="msg agent thinklive" data-think="' + esc(c.thinkId || '') + '"'
       + ' style="border:1px dashed #4a9eff;border-radius:10px;padding:8px 10px;margin-top:8px">'
       + '<div class="who" style="display:flex;align-items:center;min-width:0">'
       + '<span style="flex-shrink:0">🧠</span>' + ttl + tm + ver + '</div>'
       + '<div class="body" style="white-space:pre-wrap;word-break:break-word;'
       + 'max-height:45vh;overflow:auto">' + _mdBody(String(c.text || '')) + '</div></div>';
}

/* 2.216（0047 游客体验·第1件）：首屏/空态三步引导。
   纯文字＋现有样式，不引入新框架；「知道了」后 localStorage 记住、不再弹。
   引导卡只画在 #msgs 空态里（输入行独立），不遮挡发送框、不改布局骨架。 */
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
  /* 2.131：不是当前会话的排队条，一律不画（也不进 #qp: 指纹）。 */
  if (!_pendOwnerOk(pend)) pend = [];
  /* 2.97：记下本次实参——切换「持屏」期（通用工具.js renderAll）原样重放，
     保证不出现「空帧/中间态」等额外面孔（同一 key 会被本函数上方指纹直接跳过）。 */
  S.msgs_last = [msgs, finish, opts, ask, pend];
  /* V2 第三轮 Y5（2026-11-19）：真消息渲染成功即撤同 DID 占位卡。renderMsgs
     是全部正文上屏的唯一收口（全量 snap / snap_pane / ledger 顶屏 / 中间态重放
     都走这里）——ST 复测：00:27:02 占位卡在 00:27:21/22 真消息+AI 回复渲染后
     仍不撤。在此扫「人类发言首行 DID＋官方排队条」命中即销（pendLandingScan，
     渠道①③同口径）；撤卡后本函数末尾 renderPending() 只画存活的卡，无需
     额外重画。空态（empty）在下方早退前不扫（无正文可对）。 */
  try { if (typeof pendLandingScan === 'function') pendLandingScan(msgs, pend || []); } catch(e){}
  /* 1.06：key 纳入 [rev,del] 标志（空闲/生成切换时按钮随之出没）
     与 opts（选项卡答完即销毁）；2.112（X2-1）：纳入「时间未知」标记 m[7]
     （无 mid 行置顶并标注，标记变化必须重画）。 */
  /* 2.222：行级类型（index8）也进指纹——th→a 翻转但正文没变时必须重画，
     否则「思维流藏起来、终极回复却没上屏」。 */
  let key = msgs.map(m => m[0] + ':' + m[1] + ':' + (m[3] || 0)
                              + (m[4] || 0) + ':' + (m[7] || 0)
                              + ':' + (m[8] || '')).join('#');
  if (finish)
    key += '#fin:' + (finish.inLast ? 'L' : '-') + '|'
           + (finish.files || []).join('|') + '~'
           + (finish.text || '').slice(0, 60);
  key += '#opt:' + opts.map(o => o.t).join('|');
  /* 1.27：提问卡指纹参与 key——v1.40 只把 opts 放进 key 而 ask
     独立在外，TRAE 连续多问时第 2 问起 ask 变了但 key 没变 →
     重画被跳过，页面永远停在第一问（用户实测「后面的都被吞了」）。
     指纹含问题文本+各选项文案+选中态+主按钮文字，任何一问变化
     都会触发重画。 */
  key += '#ask:' + askFp(ask);
  /* 1.29：插话排队条参与指纹（队列增删/立即发送都要及时重画）
     2.187：新格式条目正文在 text（无 t）——只取 p.t 会让排队条内容变化
     算不出新 key、整块不重画（老板实测「挂了但不动」）。 */
  key += '#qp:' + (pend || []).map(p =>
    ((p && p.text != null) ? String(p.text) : String((p && p.t) || (p && p.id) || '')).slice(0, 40)
  ).join('|');
  /* 1.09：待确认占位参与指纹（状态推进/撤下要重画）；
     2.60：切换在途条已删，指纹不再纳入 switch_pend。 */
  key += '#pend:' + pendSig();
  /* 账本V1.0（G1）：历史补发折叠面板轮数参与指纹（面板进出要重画） */
  key += '#lbf:' + (S.lb_foldRounds || 0);
  /* 2.203：非 1 号思维流占位参与指纹（灯亮↔灯灭必须触发重画，占位才能即时撤） */
  const _noHost = _thinkNoHostOn();
  key += '#nt:' + (_noHost ? '1' : '0');
  /* 2.207（V1.0 §五-8/9/10）：小账本最底部固定挂一张思维流卡——四维＋思维灯
     亮才出（thinkCardNow 判定），新版/终极到达必须重画（版本号＋正文进指纹）。 */
  const _think = (typeof thinkCardNow === 'function') ? thinkCardNow(msgs) : null;
  key += '#tc:' + (_think
    ? (_think.thinkId + '\u0001' + String(_think.text || '').slice(-40)) : '0');
  if (key === S.msgs_key) return;
  S.msgs_key = key;
  /* 1.14：历史全屏下重画保持阅读位置（不强制回底）。
     1.20：非全屏时若用户已上翻找历史（未近底）同样保位置——快照
     每秒重画会把人强拽回底部，永远凑不满进全屏的门槛（鬼打墙
     根因）；只有近底部（200px 内）才吸附回底跟新消息。 */
  const inF = document.body.classList.contains('fmsg');
  const savedTop = el.msgs.scrollTop;
  const nearBottom = el.msgs.scrollHeight - savedTop
      - el.msgs.clientHeight < 200;
  /* 2.64：清空正文前作废手势窗口——innerHTML='' 会把 scrollTop 夹回 0 并抛一个
     scroll 事件；那是程序造成的，绝不能让它被当成「用户上翻找历史」。 */
  clearGesture();
  el.msgs.innerHTML = '';
  /* 2.195 发送闩：先同步（撤「已确认进对话流」/超时项），再决定要不要画条——
     服务端队列空了、但还有点过「⚡发送」未确认的条目时，排队条照样画（只剩闩条）。
     空态早退判据同样要算上闩条，否则「点发送→队列撤空」会被空态文案顶掉（实测）。 */
  const _qLatch = (function(){
    try { qsentLatchSync(pend); } catch(e){}
    return qsentList(pend);
  })();
  const empty = !msgs.length && !opts.length;
  if (empty && !S.pending.length && !S.switch_pend
      && !(pend || []).length && !_qLatch.length){
    el.msgs.innerHTML = _noHost
      ? _thinkNoHostHtml()
      : (guideDone()
          ? '<div class="empty">（暂无消息，发送一条开始对话）</div>'
          : guideHtml());
    return;
  }
  if (empty && !(pend || []).length && !_qLatch.length){
    renderPending();
    if (_noHost) el.msgs.insertAdjacentHTML('beforeend', _thinkNoHostHtml());
    return;
  }
  /* 2.187：正文为空但官方排队条有条目（新会话首条就进了队）——不再早退，
     走正常渲染把「⏳ 官方排队条」挂出来；msgs 空则 forEach 自然零条。 */
  const times = resolveTimes(msgs);
  let ui = -1;                       // 「我」的消息序号（rewind/del_msg 用）
  msgs.forEach((m, i) => {
    /* 2.222（老板 2026-11-20 17:10 令·思维流与终极回复位置混装）：行级类型
       只认后端 index8——`th` 只画虚线框，绝不进普通消息区（防同一行两处同显）；
       `u`/`a`/`?` 照常上屏（`?` 不猜、不丢）。本处是位置分流，不是筛选。
       2.231（老板 22:36 令·撤 3.01 状态占位）：未终结 `th` 行也不再占位显示，
       该位置只留给终极回复；思维流只走底部虚线卡。 */
    const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
    /* 2.231（老板 22:36 令）：TH 行一律不进普通消息区、不显示任何「思考中/执行中」
       状态占位——那个位置只留给终极回复；思维流只走底部虚线卡。 */
    if (_k8 === 'th') return;
    const user = m[0] === 'u';
    let acts = '';
    /* 1.24：一键复制（所有消息）+ 重编（「我」的每条消息——把
       文本回填输入框改完再发；TRAE 端无法真撤回已入列的消息，
       反悔机制 = 回填重编后作为新消息发出） */
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
    /* 1.90：AI 消息正文识别 (@fox-play1)...(@fox-play2) 包夹段 →
       渲染成语音小卡片（占位符先过 mdHtml，再替换成卡片 HTML） */
    let bodyHtml;
    {
      /* v2.84（老板实测 · Bug B/C）：我自己发的消息正文开头是内部标记
         14 位 DID（重发/残留可能叠多层）——时间已改由 mid 推导，正文【剥净】
         这些 DID 行，卡上只留真实会话内容；剥净后为空也不再出现「只有号码的单行卡」。 */
      const _src = user ? stripHeadDid(m[1]) : m[1];
      /* 2.21：语音段与提问段分别摘出——两套占位符（@@FPC / @@FAC）
         互不冲突，先摘语音、后摘提问，再各自回填卡片。
         2.77：再加「专属提示词三段折叠卡」（@@FHC，见 卡片TTS.js foxHintCards）。
         ★用户消息与 AI 消息**一视同仁**处理——专属提示词由服务端 decorate
         拼在「我」发出的消息末尾，必须同样渲染成折叠卡（此前用户消息只 esc 原样）。 */
      /* 2.92：AI 行按「思维流折叠头 / 子代理外层 / 正文」分块渲染（见文件头）。
         三套卡片管线改走 _mdBody（逐段调用，占位符互不串台）。
         人类消息**不折叠**；AI 行无折叠头文案（字段缺省）时退化为整段正文，
         输出与原逻辑逐字一致。 */
      if (user){
        bodyHtml = '<div class="body">' + _mdBody(_src) + '</div>';
      } else {
        const _blks = thinkBlocks(_src);
        bodyHtml = _blks.map(b => b.t === 'text'
          ? '<div class="body">' + _mdBody(b.lines.join('\n')) + '</div>'
          : thinkBarHtml(b)).join('');
      }
    }
    /* 2.91：视觉对齐「原版」——说话人文案 TRAE→TraeWork。
       2.93：时间戳 .tm 用户行与 AI 行都挂。
       2.112（X2-1）：无真时间的行由 缓存.js orderMsgs 统一置顶。
       2.204（B4）：时间已由统一兜底链补全（mid→DID→会话编号），
       不再显示「时间未知」；真拿不到就留空。 */
    let h = '<div class="who">' + (user ? '我' : 'TraeWork')
          + (times[i] ? '<span class="tm">' + esc(times[i]) + '</span>' : '')
          + (acts ? '<span class="mract">' + acts + '</span>' : '')
          + '</div>' + bodyHtml;
    d.innerHTML = h;
    /* 2.92：思维流折叠头 / 子代理外层——点击标题行折叠/展开（默认折叠）。 */
    d.querySelectorAll('.foldbar .fbhd, .subhd .fbhd').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        b.parentElement.classList.toggle('open');
      };
    });
    /* 1.90：语音卡片 ▶ 播放绑定（1.96：卡片已全量显示原文，data-seg 仍存完整原文供合成）
       1.99：改为 closest('.foxplay') 取段文本——▶ 按钮的父节点是 .fprow（不是卡片本身），
       原先写 b.parentElement.getAttribute('data-seg') 取到 null，点 ▶ 等于 foxPlay('')
       直接 return，按钮形同虚设（CDP 实测：点了横幅不动、无 tts 报文）。 */
    d.querySelectorAll('.foxplay .fpbtn').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const card = b.closest('.foxplay');
        foxPlay(card ? (card.getAttribute('data-seg') || '') : '');
      };
    });
    /* 2.77：专属提示词三段折叠卡——标签点开/收起绑定 */
    foxHintBind(d);
    /* 1.06：回退/删除（破坏性操作，confirm 二次确认）
       1.24：复制/重编（本地即时完成，不涉服务端） */
    d.querySelectorAll('.mact').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const k = b.dataset.k, mi = parseInt(b.dataset.mi);
        if (k === 'copy'){
          /* v2.84：我自己发的消息只复制真实正文（剥掉首行 DID 内部标记）
             2.118（老板 2026-10-22 09:37/09:38）：复制一律取纯正文——人类消息剥掉
             服务端追加的专属词前后缀（(@fox-sys1)…(@fox-sys2) 等），AI 消息剥掉
             语音卡/提问卡的 (@fox-play…)(@fox-ask…) 标记（卡里的字保留）。 */
          const c0 = msgs[parseInt(b.dataset.i)];
          copyText(c0 ? copyPlain(c0[1], c0[0] === 'u') : '');
          return;
        }
        if (k === 'edit'){
          const it = msgs[parseInt(b.dataset.i)];
          /* 2.138（老板 2026-10-26 23:23）：只取回带 DID 的人类原话，且用 copyPlain 全剥
             （DID＋专属词三段＋FOX 标记＋系统外壳）；AI 回复一律不取回。 */
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
          /* 2.117：手机端原生 confirm 被静默屏蔽 ⇒ 自绘确认层（老板 15:44 排队条同病） */
          uiConfirm('↩ 回退到这条消息之前',
            '回退到第 ' + (mi + 1) + ' 条「我」的消息之前？<br>'
            + '其后全部对话（含 AI 回复）将一并移除。', '回退', () => {
              /* 2.109：统一四态出口——②＋rcpt ③④（msg_act 事件另回填结果） */
              srvOpSend(k, mi, '回退');
              /* 1.62：撤回发起后记下时刻——TRAE 会把被撤回的那条话放回它
                 自己的输入框，等下一次快照读到再回填本端（见 revertRefill） */
              S.revertPend = Date.now();
            });
        } else {
          uiConfirm('🗑 删除这条消息',
            '删除第 ' + (mi + 1) + ' 条「我」的消息？<br>'
            + '其对应的 AI 回复会一并删除。', '删除', () => {
              /* 2.109：统一四态出口——②＋rcpt ③④（msg_act 事件另回填结果） */
              srvOpSend(k, mi, '删除消息');
            });
        }
        /* 1.62：撤回发起后记下时刻（2.117 起移入确认回调，取消时不误记） */
      };
    });
    el.msgs.appendChild(d);
  });
  /* 2.203：非 1 号网页用户——思维灯亮时在「本该出思维流」的位置显示占位文案
     （灯灭/换灯即撤，见 _thinkNoHostOn；指纹 #nt: 保证灯态变化必重画）。 */
  if (_noHost) el.msgs.insertAdjacentHTML('beforeend', _thinkNoHostHtml());
  /* 1.40：结构化 AI 提问卡（快照 ask，CDP 实测 TRAE
     AskUserQuestion 组件：选项=optionItem div + 「其他」textarea +
     底部 主按钮(下一步/确认)/取消）。可点选项、可填其他、可提交。
     1.27 交互重做：
     · 单选互斥——点选一项后其余选项锁定（指纹不变期间），防连点
       多项把 TRAE 选态点乱（用户实测「竟然能选多个」）；
     · 去掉多余的「发送」小按钮（原版没有，用户困惑）——「其他」
       输入后直接点底部主按钮提交（ask_other），不填则 ask_submit；
     · 主按钮文案沿用 TRAE 原文（下一步/确认/完成）。 */
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
        /* 2.109：统一四态出口——②＋rcpt ③④ */
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
        srvOpSend('ask_other', v, '提交自定义回答');   // 2.109：②＋rcpt ③④
      } else {
        srvOpSend('ask_submit', 0, '提交答案');        // 2.109：②＋rcpt ③④
      }
    };
    const cc = oc.querySelector('#askcancel');
    if (cc) cc.onclick = () => {
      cc.disabled = true;
      srvOpSend('ask_cancel', 0, '取消提问');          // 2.109：②＋rcpt ③④
    };
    /* v1.28：回退上一问（服务端点 TRAE footer「上一步」按钮） */
    const pv = oc.querySelector('#askprev');
    if (pv) pv.onclick = () => {
      pv.disabled = true;
      S.ask_lock = null;               /* 回退后必然换题，解锁单选 */
      srvOpSend('ask_prev', 0, '回到上一题');          // 2.109：②＋rcpt ③④
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
      b.onclick = () => {              /* 1.09：点了先给反馈并防重复点
                                          （服务端要 ~1s 才生效） */
        if (b.disabled) return;
        b.disabled = true;
        b.classList.add('picked');
        srvOpSend('pick_opt', i, '选择');      // 2.109：②＋rcpt ③④
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
  /* 2.223（老板 2026-11-20 17:20 令·思维流卡位置）：卡紧贴最新人类发言下方，
     且必须排在**官方排队条之前**（2.207 原「插在排队条之后」被本令取代）。
     此处插在正文/提问卡/完成任务卡之后、排队条与占位气泡之前，
     DOM 顺序＝人类·终极 → 思维流卡 → 占位 → 官方排队条。
     ★2.224：本处是思维流卡的**唯一插入点**，全文件只此一处插入 _thinkCard，
       禁止在别处再插（2.223 曾同时保留底部旧插入点 ⇒ 同一 _think 画两张）。 */
  if (_think) el.msgs.insertAdjacentHTML('beforeend', _thinkCardHtml(_think));
  /* 1.29：插话排队条管理面板——快照 pend（TRAE pendingMessageList）。
     生成中插队/排队的消息在这里列出，可删除/立即发送/取出编辑，
     与坐在电脑前管理排队等效。索引用快照内序号（服务端 JS 直点
     同序 DOM 条目，坐标点击会因面板秒级重渲染失效——研究报告结论）。 */
  /* 2.195 发送闩已在上方（空态判据前）同步并算出 _qLatch——此处只判「要不要画条」。 */
  if ((pend && pend.length) || _qLatch.length){
    const qp = document.createElement('div');
    qp.className = 'qpanel';
    /* 2.03：顶部只留标题（用户 2026-09-30 规定）——原先挂着「（AI 完成
       当前步骤后按顺序消费；这是 TRAE 自己的队，不是我们这边的）」一长串
       解释，用户嫌叽里呱啦，拍板顶上就写「官方排队条」即可。 */
    /* 2.216（0047）：术语保留原义，补一句人话解释（悬浮/长按可见，不占版面） */
    let qh = '<div class="qhead" title="AI 忙完会按顺序处理这些消息">⏳ 官方排队条</div>';
    qopenPrune(pend);        /* 2.08：清掉已不在队列里的「展开」标记 */
    /* 账本V1.0（N4）：项级 sid 过滤——只渲染当前锚定会话的条目；渲染下标
       仍取服务端原数组序号（data-qi），命令对位不受过滤影响。 */
    const _pendShown = [];
    /* 2.225（老板 2026-11-20 19:15 排队条翻倍）：渲染前再按跨形态统一键去重
       ——哪怕存储层（含旧版缓存 solidLoad）里已存在两种形态各一份，界面也只画
       一条；保留首次出现的下标，data-qi 仍对位官方队列。 */
    const _seenQ = new Set();
    pend.forEach((p, i) => {
      const mine = (typeof pendItemMine === 'function') ? pendItemMine(p) : null;
      /* 2.188：归属闸判「别会话」时，若该项 id（14 位 DID）是本人发过的
         （pendDidOwn：卡还在当场认领；卡已被同拍销掉则凭 10 分钟记忆认），
         仍要画——消息刚发出那一下锚定/选中还没对齐（curSid 可能为空或仍是
         旧会话），旧写法整条不画 ⇒ 条不挂、卡却被销，老板看到的正是这个。
         真别人的条目 DID 对不上，照旧不给画（跨会话绝不串显）。 */
      if (mine === false
          && !(typeof pendDidOwn === 'function' && pendDidOwn(p))) return;
      const _pk = (typeof pendTxtKey === 'function') ? pendTxtKey(p) : '';
      if (_pk && _seenQ.has(_pk)) return;
      if (_pk) _seenQ.add(_pk);
      _pendShown.push([p, i]);
    });
    /* 2.229（取证·排队条 4 条只显示 2 条）：只记账不改行为——入口数组条数
       vs 实际画出条数；差值即本层过滤/去重丢的条数。 */
    try {
      if (typeof diagLog === 'function' && pend.length !== _pendShown.length){
        diagLog('[pend] 渲染：数组 ' + pend.length + ' 条 → 画出 '
                + _pendShown.length + ' 条', 'warn');
      }
    } catch(e){}
    _pendShown.forEach(([p, i]) => {
      /* 2.229（老板 2026-11-20 22:05·立即发送无效）：命令下发用服务端官方队列的
         真实下标 __i（事件总线.js 收帧时打的戳）；局部下标 i 只用于本端取正文。 */
      const qi = (typeof p.__i === 'number') ? p.__i : i;
      /* 账本V1.0（N2）：新格式条目（p.text 有值）＝服务端已剥净的用户原文
         （首行 DID→id 字段底层携带、提示词/后缀已剥），界面只显示原文，
         不再走专属词折叠卡管线；旧格式维持 DID/三段剥净不变。 */
      const _new = (p.text != null);
      /* V2 第三轮 Y4（2026-11-19）：渲染兜底剥尾——存储层（账本核对/事件总线）
         已剥，此处对两形态再收口一次防漏网；§十二-5「排队条界面只展示原文」。
         排队条 _qk 用 p.id/p.t 原文做键，剥尾不影响展开态与命令对位。 */
      const _raw = stripPendTail(_new ? String(p.text) : stripHeadDid(p.t || ''));
      const _hz = [];
      const _head = _new ? _raw : foxHintCards(_raw, _hz);
      const _hasH = _new ? false : _hz.length > 0;
      const _txt = _hasH ? _head.replace(/\s*@@FHC\d+@@\s*$/, '') : _head;
      const _qk = _new ? ('\u0001' + (p.id || _raw)) : p.t;
      /* 2.225：_ghost＝事件总线 2.206 从上一拍补回的遗留条，其下标与官方队列
         已不对位 —— 只展示、不给操作按钮，避免按错下标误删别的排队消息。 */
      const _ghost = !!p._ghost;
      /* 2.124（老板 2026-10-22 19:38）：排队条默认只显示两行正文，折叠卡（小尾巴）
         只在点开展开后才出现——仍在同一 .qcol 内，紧随 .qtxt 之后，由 CSS 的
         `.qtxt.open + .qfh` 控制显隐，快照重画后随 S.qopen 恢复。 */
      qh += '<div class="qitem">'
         + '<div class="qcol">'
         + '<div class="qtxt' + (S.qopen[_qk] ? ' open' : '') + '"'
         + ' data-qt="' + i + '" title="点一下展开/收起全文">'
         + esc(_txt) + '</div>'
         + (_hasH ? '<div class="qfh">' + foxHintHtml(_hz[0]) + '</div>' : '')
         + '</div>'
         + (_ghost
            ? '<div class="qbtns"><button class="go qsend" disabled'
              + ' title="上一拍遗留，未与官方队列对齐，不可操作">—</button></div>'
            : '<div class="qbtns">'
              + '<button class="go qsend" data-qi="' + qi + '" data-qx="' + i + '">⚡发送</button>'
              + '<div class="qsub">'
              + '<button data-qi="' + qi + '" data-qx="' + i + '" data-qk="edit">✎</button>'
              + '<button class="del" data-qi="' + qi + '" data-qx="' + i + '" data-qk="del">🗑</button>'
              + '</div></div>')
         + '</div>';
    });
    /* 2.195 发送闩条追加：服务端队列里已不在、但点过「⚡发送」尚未确认
       进对话流的条目，原样展示、按钮「⏳ 发送中…」禁点（不提供删除/编辑，
       避免与服务端真实队列对不上）。确认/超时由 qsentLatchSync 收口。 */
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
    /* 2.123：排队条里的专属提示词折叠卡——与正文同一套点开/收起绑定 */
    foxHintBind(qp);
    /* 2.08：点左侧文字区＝展开/收起全文（标记记在 S.qopen，重绘后保持） */
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
          /* 2.117（老板 2026-10-21 15:44「点击删除没反应，不应该马上出弹窗问我删不删？」）：
             原用原生 confirm——手机端静默屏蔽 ⇒ 点了连弹窗都没有、命令也不发。
             改自绘确认层：点「删除」立刻弹问，确认后才发 pend_del。 */
          uiConfirm('🗑 删除排队消息',
            '确认删除排队消息「'
            + esc(stripHeadDid((pend[i] || {}).t || '').slice(0, 40))
            + '」？<br>删除后不会发送。', '删除', () => {
              b.disabled = true;
              srvOpSend('pend_del', i, '删除排队消息');   // 2.109：②＋rcpt ③④
            });
        } else if (k === 'edit'){
          b.disabled = true;
          S.qedit = i;                     /* 快照回来后回填输入框 */
          srvOpSend('pend_edit', i, '取出到输入框');   // 2.109：②＋rcpt ③④（pend_edit_out 另回填）
        } else {
          b.disabled = true;
          /* 2.195 发送闩：点「⚡发送」即记闩（键＝14 位 DID）——此后哪怕
             服务端队列先把该项撤了，条目仍留在屏上转「⏳ 发送中…」，
             直到 msgs 里浮现该 DID（服务端确认进对话流）才撤。 */
          const _lp = pend[i];
          const _lk = qsentKey(_lp);
          if (_lk){
            const L = S.qsent || (S.qsent = {});
            L[_lk] = {ts: Date.now(),
                      text: stripPendTail((_lp.text != null)
                              ? String(_lp.text || '') : stripHeadDid(_lp.t || ''))};
          }
          srvOpSend('pend_sendnow', i, '立即发送');     // 2.109：②＋rcpt ③④
        }
      };
    });
    el.msgs.appendChild(qp);
  }
  /* 2.183 修2（老板 2026-11-19 定性·V1.0 §十二-2）：「历史思维流（按轮补发）」
     面板整段撤除——TRAE 的直播方式是整个黑板发过来、有什么发什么，没有
     「按轮补发思维流」概念（那是有逐条思维流绝对编号+历史记录的 WorkBuddy
     章节才有的）；TRAE 的思维流＝正在进入思维流阶段时定时把有变化的情况
     发过来，仅此而已。S.lb_foldRounds 状态位保留防渲染 key 漂移。 */
  renderPending();                  // 1.09：占位气泡永远排在末尾
  /* 2.224（老板 2026-11-20 17:53「思维小卡片重复」）：这里**不再插入**思维流卡
     ——唯一插入点＝上方 538（排队条之前）。2.223 两处都插，同一 _think 被追加
     两次 ⇒ 同屏两张一模一样的虚线卡（实测 .thinklive=2、data-think 相同）。
     只做最后收口：同一时刻全屏只留一张卡，万一有重复保留最后一个（最新内容）。 */
  try {
    const _tc = el.msgs.querySelectorAll('.thinklive');
    for (let i = 0; i < _tc.length - 1; i++){
      const _n = _tc[i];
      if (_n && _n.parentNode) _n.parentNode.removeChild(_n);
    }
  } catch(e){}
  if (inF && !S.pinBottom){
    fprog(savedTop);                /* 2.64：改走 fprog（程序滚动）——设静默期 + 作废手势窗口，
                                       位置不被快照拽回，也不会误触发上翻判定；
                                       1.20：全屏内只保位置，绝不自动退出（鬼打墙根因） */
  } else if (S.pinBottom){
    /* 2.61/2.62：切会话后钉底——2.62 起优先级提到「全屏 inF」之前（原让位给
       inF，而切换会话并不退出全屏历史态 → 上翻过历史再切会话会停在顶部，
       并因 scrollTop<60 误触发上翻补拉）；目标会话正文（本地存帧
       或直播帧）真正上屏的那一次，前面中间态空渲染已把 scrollTop 归 0，
       若不干预会被当成「用户在翻历史」原样还原到顶部，并因 scrollTop<60
       误触发上翻补拉。这里用 fprog 程序化滚到最底并清标志；fprog 的 450ms
       静默期同时压掉这次滚动产生的 scroll 回调，不再误拉历史。 */
    fprog(el.msgs.scrollHeight);
    if (!S.switch_pend && !S.livePend) S.pinBottom = false;
  } else if (nearBottom){
    fprog(el.msgs.scrollHeight);    /* 近底吸附：新消息照常跟底 */
  } else {
    fprog(savedTop);                /* 2.64：改走 fprog（程序滚动）——翻历史中位置不被快照拽回，
                                       且不产生「用户上翻」的误判 */
  }
}

/* 1.14：上翻历史自动进入全屏（隐藏顶栏/输入行，消息区独占整屏看
   更多历史）；1.20 按用户设计定型：发现用户开始找历史（上翻约
   0.6 屏）就进全屏，全屏内绝不自动退出——只有点「↓ 回到最新」
   或切换会话才退出；快照重画在翻历史时保位置不拽回底部。
   1.19 修闪烁：进出全屏会隐藏/恢复顶栏输入行，#msgs 高度突变导致
   距底距离 dist 突变——刚过线就进入→dist 缩水→误判翻回底部→退出
   →再进入，死循环闪烁进不去。修复：① fprog 程序化滚动统一走静默
   （450ms 内忽略 scroll 回调）；② enterFmsg 布局变化后按高度差补偿
   scrollTop，视野停留在同一段内容上（dist 不变，不会立即误退）。 */
var fLockUntil = 0;                 // 程序滚动/进出全屏后的静默截止

/* ===== 2.195（老板 2026-11-19 实测「官方排队条点 ⚡发送，整条瞬间就消失」）=====
   发送闩（qsent latch）：点「⚡发送」后，该条目在本地排队条里**保留展示**，
   按钮转「⏳ 发送中…」（禁点），直到**服务端帧确认它真正进入对话流**
   （该项 14 位 DID 命中本会话 msgs 的人类发言）才撤——撤除的唯一权威＝
   服务端数据，客户端绝不先斩。90 秒兜底防永久挂（TRAE 消费远快于此）。
   键＝排队项 id（14 位 DID）；没有 id 的旧格式条目不闩（无法与正文对账）。 */
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

