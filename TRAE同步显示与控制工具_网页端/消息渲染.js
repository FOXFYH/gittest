'use strict';
function renderMsgs(msgs, finish, opts, ask, pend){
  opts = opts || [];
  /* 1.06：key 纳入 [rev,del] 标志（空闲/生成切换时按钮随之出没）
     与 opts（选项卡答完即销毁） */
  let key = msgs.map(m => m[0] + ':' + m[1] + ':' + (m[3] || 0)
                              + (m[4] || 0)).join('#');
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
      && !(pend || []).length){
    el.msgs.innerHTML =
      '<div class="empty">（暂无消息，发送一条开始对话）</div>';
    return;
  }
  if (empty){ renderPending(); return; }
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
    if (user){
      bodyHtml = esc(m[1]);
    } else {
      const fsegs = [], asegs = [];
      /* 2.21：语音段与提问段分别摘出——两套占位符（@@FPC / @@FAC）
         互不冲突，先摘语音、后摘提问，再各自回填卡片 */
      bodyHtml = mdHtml(foxAskCards(foxPlayCards(m[1], fsegs), asegs));
      fsegs.forEach((ft, n) => {
        bodyHtml = bodyHtml.replace('@@FPC' + n + '@@',
                                    foxCardHtml(ft));
      });
      asegs.forEach((at, n) => {
        bodyHtml = bodyHtml.replace('@@FAC' + n + '@@',
                                    foxCardHtml(at, true));
      });
    }
    let h = '<div class="who">' + (user ? '我' : 'TRAE')
          + (times[i] ? '<span class="tm">' + esc(times[i]) + '</span>' : '')
          + (acts ? '<span class="mract">' + acts + '</span>' : '')
          + '</div><div class="body">' + bodyHtml + '</div>';
    d.innerHTML = h;
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
    /* 1.06：回退/删除（破坏性操作，confirm 二次确认）
       1.24：复制/重编（本地即时完成，不涉服务端） */
    d.querySelectorAll('.mact').forEach(b => {
      b.onclick = e => {
        e.stopPropagation();
        const k = b.dataset.k, mi = parseInt(b.dataset.mi);
        if (k === 'copy'){
          copyText(msgs[parseInt(b.dataset.i)][1]);
          return;
        }
        if (k === 'edit'){
          const it = msgs[parseInt(b.dataset.i)];
          el.ent.value = it ? (it[1] || '') : '';
          refreshSendBtn();
          try { el.ent.focus(); } catch(e2){}
          flash('已回填输入框，可修改后重新发送', 'var(--blue)');
          return;
        }
        if (k === 'rewind'){
          if (!confirm('回退到第 ' + (mi + 1) + ' 条「我」的消息之前？\n'
            + '其后全部对话（含 AI 回复）将一并移除。')) return;
          flash('正在回退…', 'var(--blue)');
        } else {
          if (!confirm('删除第 ' + (mi + 1) + ' 条「我」的消息？\n'
            + '其对应的 AI 回复会一并删除。')) return;
          flash('正在删除…', 'var(--blue)');
        }
        sendCmd(k, mi);
        /* 1.62：撤回发起后记下时刻——TRAE 会把被撤回的那条话放回它
           自己的输入框，等下一次快照读到再回填本端（见 revertRefill） */
        if (k === 'rewind') S.revertPend = Date.now();
      };
    });
    el.msgs.appendChild(d);
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
        flash('已选「' + b.textContent.slice(0, 20)
            + '」，点「' + (ask.btn || '下一步') + '」继续',
            'var(--blue)');
        sendCmd('ask_pick', idx);
      };
    });
    const go = oc.querySelector('#askgo');
    if (go) go.onclick = () => {
      const inp = oc.querySelector('#askother');
      const v = inp ? (inp.value || '').trim() : '';
      go.disabled = true;
      if (v){
        flash('已提交自定义回答…', 'var(--blue)');
        sendCmd('ask_other', v);
      } else {
        flash('提交答案…', 'var(--blue)');
        sendCmd('ask_submit', 0);
      }
    };
    const cc = oc.querySelector('#askcancel');
    if (cc) cc.onclick = () => {
      cc.disabled = true;
      flash('已取消本次提问…', 'var(--blue)');
      sendCmd('ask_cancel', 0);
    };
    /* v1.28：回退上一问（服务端点 TRAE footer「上一步」按钮） */
    const pv = oc.querySelector('#askprev');
    if (pv) pv.onclick = () => {
      pv.disabled = true;
      S.ask_lock = null;               /* 回退后必然换题，解锁单选 */
      flash('回到上一题…', 'var(--blue)');
      sendCmd('ask_prev', 0);
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
        flash('已选择，正在提交给 TRAE…', 'var(--blue)');
        sendCmd('pick_opt', i);
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
  if (pend && pend.length){
    const qp = document.createElement('div');
    qp.className = 'qpanel';
    /* 2.03：顶部只留标题（用户 2026-09-30 规定）——原先挂着「（AI 完成
       当前步骤后按顺序消费；这是 TRAE 自己的队，不是我们这边的）」一长串
       解释，用户嫌叽里呱啦，拍板顶上就写「官方排队条」即可。 */
    let qh = '<div class="qhead">⏳ 官方排队条</div>';
    qopenPrune(pend);        /* 2.08：清掉已不在队列里的「展开」标记 */
    pend.forEach((p, i) => {
      /* 2.08：左边文字只显示两行（点一下展开全文），右边一个按钮块：
         ⚡发送 独占上行，✎ / 🗑 在下行并排、宽度＋间隔＝发送按钮宽度。 */
      qh += '<div class="qitem">'
         + '<div class="qtxt' + (S.qopen[p.t] ? ' open' : '') + '"'
         + ' data-qt="' + i + '" title="点一下展开/收起全文">'
         + esc(p.t) + '</div>'
         + '<div class="qbtns">'
         + '<button class="go qsend" data-qi="' + i + '">⚡发送</button>'
         + '<div class="qsub">'
         + '<button data-qi="' + i + '" data-qk="edit">✎</button>'
         + '<button class="del" data-qi="' + i + '" data-qk="del">🗑</button>'
         + '</div></div></div>';
    });
    qp.innerHTML = qh;
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
          if (!confirm('删除排队消息「'
            + (pend[i].t || '').slice(0, 40) + '」？\n删除后不会发送。'))
            return;
          b.disabled = true;
          flash('已删除排队消息…', 'var(--blue)');
          sendCmd('pend_del', i);
        } else if (k === 'edit'){
          b.disabled = true;
          S.qedit = i;                     /* 快照回来后回填输入框 */
          flash('正在取出到输入框…', 'var(--blue)');
          sendCmd('pend_edit', i);
        } else {
          b.disabled = true;
          flash('已立即发送，不打断当前生成…', 'var(--blue)');
          sendCmd('pend_sendnow', i);
        }
      };
    });
    el.msgs.appendChild(qp);
  }
  renderPending();                  // 1.09：占位气泡永远排在末尾
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
