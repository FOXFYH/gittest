'use strict';
/* 消息渲染.js（网页端）  版本 2.146  日期 2026-10-31
   【维护记录】
   2.146  2026-10-31  V3.00 P3/E返工 2026-10-31：不再给全局 handleBody 赋值——
                     手机版加载序（待办卡L291 → 缓存L292 → 消息渲染L295 → 连接L298
                     → 事件总线L300）里后加载者会覆盖前加载者，原 2.145 直接赋值
                     的包装在真机上从未执行。改为注册 `window.__body钩子` 钩子表，
                     由事件总线.js（唯一总入口）遍历调用；本钩子只处理自己的帧，
                     不消费、不阻断，其余帧仍交回 连接.js 原实现。
   2.145  2026-10-31  V3.00 P4a/P4 2026-10-31（包E·网页端 UI 层）
                     ① 四-1 发送占位卡：收到服务端「已入账」才撤卡，正式行由账本驱动；
                     ② 七 思维流三阶段：占位 → 逐张思维卡接续 → 最终回复统一撤卡；
                     ③ 五-1 排队条只渲染：服务端全量推送接管显示，代号＝前10＋…＋后10，
                        前端不增不删；未收到全量前维持旧快照面板（兼容）。
                     帧钩子改为注册 `window.__body钩子`（2.146 已改，原「包 handleBody 内层」作废）。
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
  const ps = String((S.snap && (S.snap.pend_sid || S.snap.selSid)) || '');
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  /* 2.132：归属不明就不画——宁可不显示，也不留残影 */
  if (!ps || !cs) return false;
  if (ps === cs) return true;
  return !!(typeof 稳定键 === 'function'
            && 稳定键(ps, '') === 稳定键(cs, ''));
}

function renderMsgs(msgs, finish, opts, ask, pend){
  opts = opts || [];
  /* V1.1 整改 R9（规范三-2 效果要求）：**渲染取数接小账册**——真帧为空（切会话/
     首屏）时用本地小账册最近 5 轮先铺，真帧到达后由上层照常覆盖。
     取不到（无小账册函数/无记录）时保持原样，零回归。 */
  try {
    if ((!msgs || !msgs.length)
        && typeof 小账册渲染取 === 'function'
        && typeof curSid === 'function') {
      const _sid9 = String(curSid() || '');
      const _sm9 = _sid9 ? 小账册渲染取(_sid9) : [];
      if (_sm9 && _sm9.length) msgs = _sm9;
    }
  } catch(e){}
  /* 2.131：不是当前会话的排队条，一律不画（也不进 #qp: 指纹）。 */
  if (!_pendOwnerOk(pend)) pend = [];
  /* 2.97：记下本次实参——切换「持屏」期（通用工具.js renderAll）原样重放，
     保证不出现「空帧/中间态」等额外面孔（同一 key 会被本函数上方指纹直接跳过）。 */
  S.msgs_last = [msgs, finish, opts, ask, pend];
  /* 1.06：key 纳入 [rev,del] 标志（空闲/生成切换时按钮随之出没）
     与 opts（选项卡答完即销毁）；2.112（X2-1）：纳入「时间未知」标记 m[7]
     （无 mid 行置顶并标注，标记变化必须重画）。 */
  let key = msgs.map(m => m[0] + ':' + m[1] + ':' + (m[3] || 0)
                              + (m[4] || 0) + ':' + (m[7] || 0)).join('#');
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
  /* 1.29：插话排队条参与指纹（队列增删/立即发送都要及时重画） */
  key += '#qp:' + (pend || []).map(p => (p.t || '').slice(0, 40)).join('|');
  /* 1.09：待确认占位参与指纹（状态推进/撤下要重画）；
     2.60：切换在途条已删，指纹不再纳入 switch_pend。 */
  key += '#pend:' + pendSig();
  /* 2.145：包E 三样状态进指纹——服务端全量排队条 / 思维卡 / 最终暂存。
     不加就会「数据变了但 key 没变 ⇒ 重画被跳过」，卡片永远不出现。 */
  const _e2q = _e2QbarNow();
  key += '#e2q:' + (_e2q ? (_e2q.items || []).map(q => String(q && (q.t || q) || '').slice(0, 30)).join('|') : '~');
  key += '#e2t:' + _e2ThinkFp();
  key += '#e2f:' + _e2FinalFp();
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
  const empty = !msgs.length && !opts.length;
  if (empty && !S.pending.length && !S.switch_pend
      && !(pend || []).length && !_e2q){
    el.msgs.innerHTML =
      '<div class="empty">（暂无消息，发送一条开始对话）</div>';
    return;
  }
  if (empty){ renderPending(); if (_e2q) _e2RenderQbar(_e2q); return; }
  const times = resolveTimes(msgs);
  let ui = -1;                       // 「我」的消息序号（rewind/del_msg 用）
  msgs.forEach((m, i) => {
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
      /* v2.84（老板实测 · Bug B/C）：我自己发的消息正文开头是内部时间标记
         14 位 DID（重发/残留可能叠多层）——顶栏时间已由 didTimeOf 取该 DID
         单独显示，故正文【剥净】这些 DID 行，卡上只留真实会话内容；剥净后
         为空也不再出现「只有号码的单行卡」。 */
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
       2.112（X2-1）：无 mid 的行（由 缓存.js orderMsgs 统一置顶）标注「时间未知」，
       绝不用本地时刻/继承时刻冒充该行真实时间。 */
    let h = '<div class="who">' + (user ? '我' : 'TraeWork')
          + (m[7]
              ? '<span class="tm" style="color:var(--gray)">时间未知</span>'
              : (times[i] ? '<span class="tm">' + esc(times[i]) + '</span>' : ''))
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
    /* 2.145（七-2）：该条 AI 行的思维流小卡片——按 mid 定位，逐张接续其下。
       人类行不挂；没有该 mid 的思维卡时不产生任何节点（零开销）。 */
    if (!user) _e2RenderThink(m);
  });
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
  /* 1.29：插话排队条管理面板——快照 pend（TRAE pendingMessageList）。
     生成中插队/排队的消息在这里列出，可删除/立即发送/取出编辑，
     与坐在电脑前管理排队等效。索引用快照内序号（服务端 JS 直点
     同序 DOM 条目，坐标点击会因面板秒级重渲染失效——研究报告结论）。 */
  /* 2.145（五-1）：服务端全量排队条到达并接管时，旧快照面板（可编辑队列）
     不再画——一份数据只出一处，避免「两套排队条并存」。 */
  if (!_e2q && pend && pend.length){
    const qp = document.createElement('div');
    qp.className = 'qpanel';
    /* 2.03：顶部只留标题（用户 2026-09-30 规定）——原先挂着「（AI 完成
       当前步骤后按顺序消费；这是 TRAE 自己的队，不是我们这边的）」一长串
       解释，用户嫌叽里呱啦，拍板顶上就写「官方排队条」即可。 */
    let qh = '<div class="qhead">⏳ 官方排队条</div>';
    qopenPrune(pend);        /* 2.08：清掉已不在队列里的「展开」标记 */
    pend.forEach((p, i) => {
      /* 2.08：左边文字只显示两行（点一下展开全文），右边一个按钮块：
         ⚡发送 独占上行，✎ / 🗑 在下行并排、宽度＋间隔＝发送按钮宽度。
         2.123（老板 2026-10-22 19:10「进输入框的文字会被加后缀…正文那边有折叠
         显示系统，官方排队小卡片这边也做成一样的」）：复用正文同一套
         `foxHintCards` 摘出 sys/usr/co 三段，左列改为「两行正文 ＋ 同一张
         专属提示词折叠卡（系统▸/用户▸/公司▸）」，不再把 (@fox-sys1)… 原样露出。 */
      const _raw = stripHeadDid(p.t || '');
      const _hz = [];
      const _head = foxHintCards(_raw, _hz);
      const _hasH = _hz.length > 0;
      const _txt = _hasH ? _head.replace(/\s*@@FHC\d+@@\s*$/, '') : _raw;
      /* 2.124（老板 2026-10-22 19:38）：排队条默认只显示两行正文，折叠卡（小尾巴）
         只在点开展开后才出现——仍在同一 .qcol 内，紧随 .qtxt 之后，由 CSS 的
         `.qtxt.open + .qfh` 控制显隐，快照重画后随 S.qopen 恢复。 */
      qh += '<div class="qitem">'
         + '<div class="qcol">'
         + '<div class="qtxt' + (S.qopen[p.t] ? ' open' : '') + '"'
         + ' data-qt="' + i + '" title="点一下展开/收起全文">'
         + esc(_txt) + '</div>'
         + (_hasH ? '<div class="qfh">' + foxHintHtml(_hz[0]) + '</div>' : '')
         + '</div>'
         + '<div class="qbtns">'
         + '<button class="go qsend" data-qi="' + i + '">⚡发送</button>'
         + '<div class="qsub">'
         + '<button data-qi="' + i + '" data-qk="edit">✎</button>'
         + '<button class="del" data-qi="' + i + '" data-qk="del">🗑</button>'
         + '</div></div></div>';
    });
    qp.innerHTML = qh;
    /* 2.123：排队条里的专属提示词折叠卡——与正文同一套点开/收起绑定 */
    foxHintBind(qp);
    /* 2.08：点左侧文字区＝展开/收起全文（标记记在 S.qopen，重绘后保持） */
    qp.querySelectorAll('.qtxt').forEach(t2 => {
      t2.onclick = () => {
        const one = pend[parseInt(t2.dataset.qt)];
        if (one && one.t) S.qopen[one.t] = !S.qopen[one.t];
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
            + esc(stripHeadDid(pend[i].t || '').slice(0, 40))
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
          srvOpSend('pend_sendnow', i, '立即发送');     // 2.109：②＋rcpt ③④
        }
      };
    });
    el.msgs.appendChild(qp);
  }
  renderPending();                  // 1.09：占位气泡永远排在末尾
  if (_e2q) _e2RenderQbar(_e2q);    // 2.145（五-1）：只渲染服务端推的全量排队条
  _e2RenderFinal(msgs);             // 2.145（七-3）：最终回复暂存卡（账本行到达即自动让位）
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

/* ============ 2.145 包E（V3.00 P4a/P4 2026-10-31）==========================
   规范条目：四-1 发送占位卡 / 五-1 排队条只渲染 / 七 思维流三阶段。
   原则：
   ① 本段只管【UI 状态与渲染】，绝不伪造消息行——正式消息永远由账本/快照驱动；
   ② 服务端帧统一入口 _e2OnFrame，注册在 `window.__body钩子` 钩子表（2.146：
      不再覆盖全局 handleBody；由事件总线.js 唯一总入口遍历调用，本钩子不消费不阻断）；
   ③ 三种状态互斥：同一 mid 不允许同时出现「发送占位卡」与「思维卡」。
   帧约定（与服务端 C/B 包对齐，字段两种命名都收）：
     {t:"排队条"|"pend_all"|"排队条全量", sid, items:[{t}|"文本"]}
     {t:"思维流"|"think", mid, 序号|seq, 文本|text}
     {t:"最终回复"|"final", mid, 文本|text}
     {t:"已入账"|"sent_ok", tempId|id, mid, did, conv}
   ====================================================================== */

/* 状态懒初始化（不改 状态与DOM.js；S 是全局对象） */
function _e2S(){
  if (!S.v3think) S.v3think = {};                 // mid -> [{seq,text}]
  if (!S.v3final) S.v3final = {};                 // mid -> {text,ts}
  if (S.v3qbar === undefined) S.v3qbar = null;    // {sid,items,ts}；null＝未接管
  return S;
}
function _e2Sid(){
  try { return String((typeof curSid === 'function' && curSid()) || ''); }
  catch(e){ return ''; }
}
/* 五-1：只显示当前选中会话的排队条；归属不明一律不画（宁缺不留残影） */
function _e2OwnOk(fsid){
  const qs = String(fsid || ''), cs = _e2Sid();
  if (!qs) return true;                  /* 服务端本就只推当前选中会话 ⇒ 空 sid 视为当前 */
  if (!cs) return false;
  if (qs === cs) return true;
  return !!(typeof 稳定键 === 'function' && 稳定键(qs, '') === 稳定键(cs, ''));
}
function _e2QbarNow(){
  const q = _e2S().v3qbar;
  if (!q) return null;
  if (!_e2OwnOk(q.sid)) return null;
  return q;
}
/* 五-1：代号＝前 10 ＋ … ＋ 后 10（内容净化：后端已剥 DID，这里兜底再剥一次） */
function _e2Qcode(t){
  let s = String(t == null ? '' : t);
  if (typeof stripHeadDid === 'function') s = stripHeadDid(s);
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= 20) return s;
  return s.slice(0, 10) + '…' + s.slice(-10);
}
function _e2Qtext(it){
  if (it == null) return '';
  if (typeof it === 'string') return it;
  return String(it.t != null ? it.t : (it.text != null ? it.text : ''));
}
/* 五-1：排队条【只渲染】——无删除/发送/编辑按钮，前端不增不删 */
function _e2RenderQbar(q){
  const items = (q && Array.isArray(q.items)) ? q.items : [];
  if (!items.length) return;
  const box = document.createElement('div');
  box.className = 'qbar';
  box.dataset.sid = String(q.sid || '');
  let h = '<div class="qbhead">⏳ 官方排队条</div>';
  items.forEach((it, i) => {
    const txt = _e2Qtext(it);
    h += '<div class="qbitem">'
       + '<span class="qbidx">' + (i + 1) + '</span>'
       + '<span class="qbcode" title="' + esc(txt) + '">'
       + esc(_e2Qcode(txt)) + '</span></div>';
  });
  box.innerHTML = h;
  el.msgs.appendChild(box);
}

/* 七-1/七-2：思维卡逐张接续（挂在对应 mid 的 AI 行下方） */
function _e2RenderThink(m){
  const mid = String((m && m[6]) || '');
  if (!mid) return;
  const arr = _e2S().v3think[mid];
  if (!arr || !arr.length) return;
  const box = document.createElement('div');
  box.className = 'thinkbox';
  box.dataset.mid = mid;
  let h = '';
  arr.forEach((k, i) => {
    h += '<div class="thinkcard">'
       + '<div class="texp">💭 思维 ' + (i + 1) + '</div>'
       + '<div class="tbody">' + esc(String(k.text == null ? '' : k.text)) + '</div>'
       + '</div>';
  });
  box.innerHTML = h;
  el.msgs.appendChild(box);
}
/* 七-3：最终回复到达后统一撤卡；账本行到达即自动让位（绝不重复两条） */
function _e2RenderFinal(msgs){
  const st = _e2S();
  const arr = Array.isArray(msgs) ? msgs : [];
  Object.keys(st.v3final).forEach(mid => {
    if (arr.some(m => m && String(m[6] || '') === mid)) { delete st.v3final[mid]; return; }
    const f = st.v3final[mid] || {};
    const d = document.createElement('div');
    d.className = 'msg agent finalcard';
    d.dataset.mid = mid;
    d.innerHTML = '<div class="who">TraeWork'
                + '<span class="tm">最终回复</span></div>'
                + '<div class="body">' + esc(String(f.text || '')) + '</div>';
    el.msgs.appendChild(d);
  });
}
function _e2ThinkFp(){
  const st = _e2S();
  return Object.keys(st.v3think).map(mid => {
    const a = st.v3think[mid] || [];
    return mid + ':' + a.length + ':' + a.map(x => String(x.text || '').length).join(',');
  }).join(';');
}
function _e2FinalFp(){
  const st = _e2S();
  return Object.keys(st.v3final)
    .map(mid => mid + ':' + String((st.v3final[mid] || {}).text || '').length)
    .join(';');
}
/* 互斥：撤掉某 mid 的发送占位卡（思维卡/最终卡一出现，占位必须让位） */
function _e2DropPendByMid(mid){
  mid = String(mid || '');
  if (!mid || !Array.isArray(S.pending)) return false;
  const n = S.pending.length;
  S.pending = S.pending.filter(p => !(p && p.mid && String(p.mid) === mid));
  return S.pending.length !== n;
}

/* ---------- 对外函数（七-1 占位 / 七-2 流式 / 七-3 定格 / 五 排队条） ---------- */
/* 七-1：接一张思维卡。序号缺省＝追加；同 mid 的发送占位卡立即撤下（三态互斥）。 */
function 接一张思维卡(mid, 序号, 文本){
  mid = String(mid || '');
  if (!mid) return false;
  const st = _e2S();
  const arr = st.v3think[mid] || (st.v3think[mid] = []);
  const n = Number(序号);
  const seq = (序号 == null || !isFinite(n) || n <= 0) ? (arr.length + 1) : n;
  if (arr.some(x => x.seq === seq)) return false;          /* 丢包重推：同序号不重复 */
  arr.push({seq: seq, text: String(文本 == null ? '' : 文本)});
  arr.sort((a, b) => a.seq - b.seq);
  _e2DropPendByMid(mid);
  renderAll();
  return true;
}
/* 七-3：定格最终——清掉该 mid 全部思维卡；有正文先暂存占位，账本行到达即让位。 */
function 定格最终(mid, 文本){
  mid = String(mid || '');
  if (!mid) return false;
  const st = _e2S();
  const had = !!st.v3think[mid];
  delete st.v3think[mid];
  const txt = String(文本 == null ? '' : 文本);
  if (txt) st.v3final[mid] = {text: txt, ts: Date.now()};
  else delete st.v3final[mid];
  _e2DropPendByMid(mid);
  renderAll();
  return had || !!txt;
}
/* 五-2：全量同步场景（刷新/切会话/登录）先清空本地，完全采用服务端推送 */
function 清空排队条(){
  const st = _e2S();
  st.v3qbar = {sid: _e2Sid(), items: [], ts: Date.now()};
  renderAll();
  return true;
}
/* 五-2/五-3：灌服务端全量排队条（覆盖式，不合并、不自行增删） */
function 灌排队条(全量数组, sid){
  const st = _e2S();
  const items = Array.isArray(全量数组) ? 全量数组.slice() : [];
  st.v3qbar = {sid: String(sid || _e2Sid()), items: items, ts: Date.now()};
  renderAll();
  return items.length;
}

/* ---------- 帧入口 ---------- */
function _e2OnFrame(d){
  const t = String((d && d.t) || '');
  if (!t) return false;
  /* 五：排队条全量（事件触发 / 60 秒保底 / 对账回复，三种都是全量覆盖） */
  if (t === '排队条' || t === 'pend_all' || t === '排队条全量'
      || t === '排队条对账_结果'){
    const items = d.items || d.list || d.pend || [];
    const st = _e2S();
    st.v3qbar = {sid: String(d.sid || ''), items: Array.isArray(items) ? items.slice() : [],
                 ts: Date.now()};
    renderAll();
    return true;
  }
  /* 七-2：思维流逐卡（不回执、允许丢包，符合规范） */
  if (t === '思维流' || t === 'think' || t === 'think_card'){
    return 接一张思维卡(d.mid, (d.序号 != null ? d.序号 : d.seq),
                       (d.文本 != null ? d.文本 : d.text));
  }
  /* 七-3：最终回复 */
  if (t === '最终回复' || t === 'final' || t === 'final_reply'){
    return 定格最终(d.mid, (d.文本 != null ? d.文本 : d.text));
  }
  /* 四-2/四-3：服务端「已入账」——撤发送占位卡，正式行由账本帧驱动 */
  if (t === '已入账' || t === 'sent_ok' || t === 'send_ack' || t === '入账'){
    const mid = String(d.mid || '');
    let changed = false;
    const tid = (d.tempId != null ? d.tempId : d.id);
    if (tid != null && Array.isArray(S.pending)){
      const n = S.pending.length;
      S.pending = S.pending.filter(p => !(p && String(p.id) === String(tid)));
      changed = S.pending.length !== n;
    }
    if (!changed && d.did && typeof pendClearByDid === 'function'){
      changed = !!pendClearByDid(String(d.did), d.conv || '');
    }
    /* 记下 mid：后续思维卡/最终卡到达时可据此撤掉同一条占位 */
    if (mid && Array.isArray(S.pending)){
      S.pending.forEach(p => { if (!p.mid && changed === false && p.did === d.did) p.mid = mid; });
    }
    if (changed) renderAll();
    return changed;
  }
  return false;
}
/* 2.146（E返工）：注册到钩子表 `window.__body钩子`，**不再给全局 handleBody 赋值**。
   手机版加载序：待办卡L291 → 缓存L292 → 消息渲染L295 → 连接L298 → 事件总线L300；
   2.145 的 `handleBody = function(...)` 会被后加载的 连接.js／事件总线.js 覆盖，
   真机上本段从未执行（验收实测发现）。现由 事件总线.js（唯一总入口，4号负责）
   遍历钩子表逐个调用；本钩子只处理自己的帧，**不消费、不阻断**，
   其余帧仍由总入口交回 连接.js 原实现。 */
(window.__body钩子 = window.__body钩子 || []).push(function(body){
  let d = null;
  try { d = JSON.parse(body); } catch(e){ return; }
  if (d && d.t){
    /* 与 连接.js／事件总线.js 同两道闸：非当前操控服务端一律不认 */
    if (d.srv && S.cur && d.srv !== S.cur) return;
    try { _e2OnFrame(d); } catch(e){}
  }
});
