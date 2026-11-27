'use strict';
 /* 事件总线.js（网页端）  版本 2.132  日期 2026-11-05 */
function onEv(kind, v){
  switch (kind){
    case 'pendlist': {                 /* 服务端对账结果即时同步——
        撤卡/超时/排队推送不再等下一拍快照（poll=3s 时撤卡滞后 0~3s
        的根因）。服务端 _pend 是权威：列表里没有 = 已确认撤卡；
        state 变化（timeout/queued…）照收。
        1.88：**旧「按 kind+text 对号撤卡」已旁路**——消卡只认 did
        （did_ack）；服务端对账列表仍是权威，但条目与本地卡的对号
        不再靠文本猜（用户规定：识别相同内容不靠谱）。旧服务端
        场景由 PEND_DID_TMO 超时兜底转「可能未送达」。 */
      return;
    }
    case 'did_pool': {                 /* 服务端广播「最近 10 条由网页版
        发出、且已进流」的 DID 池（帧 v={sid, 会话名, dids:[新→旧]}）——兜底
        销卡（有些会话不在本拍快照里）。did_ack/did_miss 已整条作废，不处理。
        v2.83（老板口径）：这是**销卡渠道②**——池子里出现该 DID ⇒ 立刻销卡。 */
      const dp = v || {};
      if (Array.isArray(dp.dids) && dp.dids.length){
        let ch = false;
        dp.dids.forEach(d => {
          if (pendClearByDid(d, dp['会话名'] || '')) ch = true;
        });
        if (ch) renderAll();
      }
      return;
    }
    case 'snap_pane': {                /* （协议另半边·服务端已 3.41）：按需单会话帧
        （v={sid,title,msgs,n,finish,sel,vis}，服务端只为一个会话单独下发，正文单条已截 8000）。
        ① 该 sid 就是网页端当前锚定会话 ⇒ 当作目标正文上屏：与常规快照走同一条护栏
           （_msgsMonotonic「少≥1」＋ renderAll 持屏闸），绝不把已上屏内容打回去；真帧到
           即撤「正在获取直播帧」条，并给「刷新当前会话」收口。
        ② 不是锚定会话 ⇒ **不打扰当前屏幕**：只存为该会话的内存存帧＋按会话键落 IDB
           （复用 2.112 的 _frameMem 与 `cacheKey|稳定键` 口径），切过去即可秒显。
        缺字段/旧服务端（无此帧）一律静默忽略，绝不影响既有语义。 */
      const pv = (v && typeof v === 'object') ? v : {};
      const psid = String(pv.sid || '');
      if (!psid || !Array.isArray(pv.msgs)) break;
      if (!_paneIsAnchor(psid, pv.title || '')){
        try { if (typeof paneFrameStore === 'function')
          paneFrameStore(psid, pv.title || '', pv); } catch(e){}
        break;
      }
      const _prevPm = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : null;
      const _inc = {msgs: pv.msgs.slice(), finish: pv.finish};
      /* 单调护栏只对「同一会话的正文」比较：切换在途、S.snap 正文仍是旧会话 A 时
         这是目标 B 的帧，跨会话比条数会把 B 误判成「少≥1」打回（同 adoptSnap 口径）。 */
      const _spg = S.switch_pend;
      const _crossConv = !!(_spg && _spg.lockTarget && !_spg.arrived
          && Array.isArray(_spg.prevMsgs)
          && sameConvBody((S.snap || {}).msgs, _spg.prevMsgs));
      if (!_crossConv && _prevPm && _prevPm.length) _msgsMonotonic(_inc, S.snap);
      if (_prevPm && _inc.msgs === _prevPm) break;   /* 空帧/少≥1：护栏已拦，保持已上屏 */
      if (S.snap && typeof S.snap === 'object'){
        S.snap.msgs = _inc.msgs;
        if ('finish' in pv) S.snap.finish = pv.finish || null;
      } else {
        S.snap = {msgs: _inc.msgs, finish: pv.finish || null, convs: []};
      }
      /* 切换在途：目标正文真到 ⇒ 立即收口（解锁持屏，交给 renderAll 正常让位） */
      const _spv = S.switch_pend;
      if (_spv && _spv.lockTarget && !_spv.arrived
          && Array.isArray(_inc.msgs) && _inc.msgs.length
          && (_spv.sid ? String(_spv.sid) === psid
                       : (S.anchorSid && 稳定键(psid, pv.title || '') === S.anchorSid)))
        _spv.arrived = true;
      /* 撤「正在获取直播帧」条（liveClear 内含立即落盘）；无条则补一次存帧 */
      if (S.livePend && (稳定键(S.livePend) === 稳定键(psid, pv.title || '')
                         || S.livePend === S.anchorSid)) liveClear();
      else { try { snapIdbTick(true); } catch(e){} }
      try { if (typeof paneReqDone === 'function') paneReqDone(psid); } catch(e){}
      if (typeof pendLandingScan === 'function')
        pendLandingScan(_inc.msgs,
          (S.snap && Array.isArray(S.snap.pend)) ? S.snap.pend : []);
      renderAll();
      try {
        if (typeof lbFillFinalsAsync === 'function')
          lbFillFinalsAsync(psid, pv.title || '');
      } catch(e){}
      break;
    }
    case 'snap': {
      if (v._port !== S.port) return;        // 旧目标迟到快照，丢弃防串台
      /* 1.xx：登录轻启动——服务端 hello 只发「框架版」快照（无 msgs，
         正文由登录后第一拍常规快照轮询补齐）。此时若直接 S.snap=v，
         消息区会因 msgs 缺失闪成空白再跳回正文（大会话尤其明显）。
         故框架版只刷列表/模型/状态，正文用旧值兜底，免闪空。 */
      if (!Array.isArray(v.msgs) && S.snap && Array.isArray(S.snap.msgs)){
        v.msgs = S.snap.msgs;
      }
      /* 本专项 B3：先记下这拍快照「桌面当前选中行」——它就是直播帧的归属
         会话；当前锚定会话的真直播帧一到，立即撤「正在获取直播帧」小条。 */
      const _penArr = Array.isArray(v.pend) ? v.pend : [];
      _penArr.forEach((it, _ix) => {
        if (it && typeof it === 'object' && typeof it.__i !== 'number') it.__i = _ix;
      });
      const _pendRawN = _penArr.length;   /* 原始条数（取证用） */
      const _penOwner = String(v.pend_sid || v.selSid || '');
      const _curSidNow = String((typeof curSid === 'function' ? curSid() : '') || '');
      let _penMine;
      if (!_penArr.length){
        _penMine = true;
      } else if (_penArr.some(it => it && typeof it === 'object' && it.sid != null)){
        /* 账本V1.0（N4 根治串显）：项级 sid 为准——逐条过滤，只留当前锚定
           会话的条目；顶层 pend_sid 仅兜底。pendItemMine（账本核对.js）
           true=本会话 / false=别会话 / null=无项级 sid（宁可不画不留残影）。
           2.187：id（14 位 DID）命中本人待销卡的一律保留——消息刚进队那一下
           桌面选中/锚定可能还没对齐，整批剥掉会让这张卡销不掉（老板实测）。
           渲染层仍按 pendItemMine 逐条过滤，跨会话绝不串显。 */
        v.pend = _penArr.filter(it => {
          const _m = pendItemMine(it);
          if (_m === true) return true;
          if (typeof pendDidOwn === 'function' && pendDidOwn(it)) return true;
          if (_m === false) return false;
          return (!_penOwner || !_curSidNow || _penOwner === _curSidNow);
        });
        _penMine = v.pend.length > 0;
      } else if (!_penOwner || !_curSidNow){
        _penMine = _penArr.some(it => {
          const _pd = pendDidOf(it && it.t);
          return !!(_pd && (typeof pendDidOwn === 'function' && pendDidOwn({id: _pd})));
        });
      } else {
        _penMine = (_penOwner === _curSidNow
                    || (typeof 稳定键 === 'function'
                        && 稳定键(_penOwner, '') === 稳定键(_curSidNow, '')));
      }
      if (_penArr.length && !_penMine) v.pend = [];
      const liveSid = selSidOf(v);
      const liveKey = 稳定键(liveSid, selTitleOf(v));   /* 终身号：跨天也能认出直播帧归属 */
      try {
        if (typeof lbFillFinals === 'function' && Array.isArray(v.msgs) && v.msgs.length)
          v.msgs = lbFillFinals(liveSid, selTitleOf(v), v.msgs);
      } catch(e){}
      if (typeof anchorSelfHeal === 'function')
        anchorSelfHeal(liveKey);   /* 已退役空壳，调用点保留防报错 */
      const _prevPend = (S.snap && Array.isArray(S.snap.pend)) ? S.snap.pend.slice() : [];
      const _prevPendSid = String((S.snap && S.snap.pend_sid) || '');
      S.snap = adoptSnap(v);   /* 锚定：拒收「别人把桌面挪走」的跟随 */
      let _pv = [];
      const _seen2 = new Set();
      (Array.isArray(v.pend) ? v.pend : []).forEach(it => {
        if (!it || typeof it !== 'object') return;
        const _raw = (it.text != null) ? String(it.text)
                  : (it.t != null ? String(it.t) : '');
        if (it.text != null) it.text = stripPendTail(it.text);
        if (it.t != null) it.t = stripPendTail(it.t);
        let _tx = (it.text != null) ? it.text : it.t;
        if (!String(_tx || '').trim()){
          _tx = (typeof stripHeadDid === 'function') ? stripHeadDid(_raw) : _raw;
          if (it.text != null) it.text = _tx; else it.t = _tx;
        }
        if (!String(_tx || '').trim()) return;
        const k = (typeof pendTxtKey === 'function') ? pendTxtKey(it)
              : String((it.id != null && String(it.id).trim()) ? it.id : _tx);
        if (k && _seen2.has(k)) return;
        if (k) _seen2.add(k);
        _pv.push(it);
      });
      try {
        const _curPendSid = String((typeof curSid === 'function' ? curSid() : '')
                                    || _penOwner || '');
        if (_prevPend.length && (!_prevPendSid || _prevPendSid === _curPendSid)){
          const _landed = new Set();
          (v.msgs || []).forEach(m => {
            if (!Array.isArray(m)) return;
            const d = pendDidOf(m[1]) || String(m[9] || '');
            if (d) _landed.add(d);
          });
          const _have = new Set(_pv.map(it => (typeof pendTxtKey === 'function')
              ? pendTxtKey(it)
              : String(it.id != null ? it.id : ((it.text != null) ? it.text : it.t))));
          _prevPend.forEach(it => {
            if (!it || typeof it !== 'object') return;
            const _d = String(it.id || '') || pendDidOf((it.text != null) ? it.text : it.t);
            const _txt = String((it.text != null) ? it.text : (it.t || ''));
            if (_d && _landed.has(_d)) return;          /* 已落地：淘汰 */
            const k = (typeof pendTxtKey === 'function') ? pendTxtKey(it)
                                                        : String(it.id != null ? it.id : _txt);
            if (!k || _have.has(k)) return;
            _have.add(k);
            try { it._ghost = 1; it._ghostAt = Date.now(); } catch(e){}
            /* 幽灵项宽限 20 秒：过期即淘汰，不再长期占位成空气泡 */

            _pv.push(it);
          });
        }
      } catch(e){}
      try { _pv = _pv.filter(function (it){
        return !(it && it._ghost && it._ghostAt && Date.now() - it._ghostAt > 20000);
      }); } catch(e){}
      v.pend = _pv;
      try {
        if (typeof diagLog === 'function' && _pendRawN !== _pv.length){
          diagLog('[pend] 服务端 ' + _pendRawN + ' 条 → 屏上 ' + _pv.length + ' 条',
                  'warn');
        }
      } catch(e){}
      if (Array.isArray(v.pend) && v.pend.length){
        v.pend_sid = String((typeof curSid === 'function' ? curSid() : '')
                            || _penOwner || '');
      }
      const _sp0 = S.switch_pend;
      const _stillOld = !!(_sp0 && _sp0.lockTarget
          && (Array.isArray(_sp0.prevMsgs)
              ? sameConvBody(v.msgs, _sp0.prevMsgs)
              : msgsFp(v.msgs) === _sp0.fp0));
      if (_stillOld){
        /* 过渡期：锁死目标（正文取 B 的帧），快照里 A 的正文不上屏 */
      } else if (S.livePend && liveKey && liveKey === S.anchorSid){
        if (_sp0 && _sp0.lockTarget && Array.isArray(v.msgs)
            && v.msgs.length) _sp0.arrived = true;   /* 空帧不算到达 */
        liveClear();
      }
      if (window.备注入快照) 备注入快照(v);
      if (window.定时入快照) 定时入快照(v);
      const _ct = curTitle();
      (v.msgs || []).forEach(m => {          /* ① 只扫人类发言 */
        if (!m || m[0] !== 'u') return;
        const _d = pendDidOf(m[1]);
        if (_d) pendClearByDid(_d, _ct);
      });
      if (_penMine) (v.pend || []).forEach(it => {   /* ③ 官方排队条（限本会话） */
        /* 账本V1.0（N3）：新格式条目身份标识在 id 字段（界面隐藏不展示），
           旧格式仍从文本首行取 DID——两形态都进销卡渠道③。 */
        const _d = pendDidOf(it && it.t) || (it && it.id) || '';
        if (_d) pendClearByDid(_d, _ct);
      });
      pendReconcile(v.msgs || []);           // 撤下已落地的占位
      if (S.qedit !== null && S.qedit !== undefined){
        S.qedit = null;
        const t = (v.inputText || '').trim();
        if (t){
          el.ent.value = copyPlain(t, true);
          refreshSendBtn();
          try { el.ent.focus(); } catch(e2){}
          flash('已取出排队消息，可修改后重新发送', 'var(--blue)');
        } else {
          flash('取出失败（条目已变化）', 'var(--red)');
        }
      }
      /* 本专项 F1：到达判定只用于状态灯与「失败回报」，不再阻塞任何操作——
         锚定在用户点击那一刻就已生效（指令先行），正文晚到只影响观感。 */
      if (S.switch_pend){                    /* 切换过程状态机：兜底到达判定 */
        const cv = v.convs || [];
        const sp = S.switch_pend;
        const spSid = sp.sid || '';
        const act = cv.find(r => r[0] === 'c' && r[2]);
        const rowKey = r => (spSid ? (r[4] || '') : (r[1] || ''));
        const has = cv.some(r => r[0] === 'c'
                       && (r[4] || r[1]) && rowKey(r) === (spSid || sp.title));
        const arrived = Array.isArray(sp.prevMsgs)
            ? !sameConvBody(v.msgs, sp.prevMsgs) : (msgsFp(v.msgs) !== sp.fp0);
        const arrivedOk = act && (spSid ? (act[4] || '') === spSid
                                        : act[1] === sp.title) && arrived;
        if (arrivedOk){
          S.falls_fail = 0;
          switchOk();                        /* 正文真到达 → 成功收口（2s 闪现） */
        } else if (!has){
          switchFail(sp.title);              /* 目标已不在列表 → 失败 */
          switchClear();
        }
      }
      if (S.anchor_reask || S.bootSwitch){
        const _boot = !!S.bootSwitch;
        S.anchor_reask = 0; S.bootSwitch = 0;
        const _aSel = 稳定键(selSidOf(v), selTitleOf(v));
        if (_boot && S.anchorSid && S.anchorFull){
          try {
            pendSwitchSet(S.anchorTitle || '', S.anchorFull, S.anchorFull,
                          {lockTarget: true, deferRender: true});
            snapIdbShow(S.anchorSid, S.anchorTitle || '');
            sendCmd('switch', S.anchorFull);
            /* 账本V1.0：刷新/重开＝自己切自己，同样走 switch 强核对（I1） */
            if (window.ledgerVcheckSend) ledgerVcheckSend('switch', S.anchorFull);
          } catch(e){}
        } else if (S.anchorFull && S.anchorSid && _aSel && _aSel !== S.anchorSid){
          try {
            sendCmd('switch', S.anchorFull);
            if (window.ledgerVcheckSend) ledgerVcheckSend('switch', S.anchorFull);
          } catch(e){}
        }
        try { if (S.anchorFull) sendJson({t: 'pane_req', sid: S.anchorFull}); } catch(e){}
      }
      renderAll();
      if (typeof snapIdbTick === 'function') snapIdbTick();
      /* 账本V1.0（H1/H8）：本地账本落盘（只留最新 N 轮）+ 触碰 lastView；
         真快照正文到手 → 历史补发折叠面板退场（账本核对.js）。 */
      try { if (window.ledgerOnSnap) ledgerOnSnap(); } catch(e){}
      try {
        if (typeof lbFillFinalsAsync === 'function')
          lbFillFinalsAsync(liveSid, selTitleOf(v));
      } catch(e){}
      break;
    }
    case 'switch_migrate': {
      const smLog = (v && v.log) || [];
      S.switch_mig = { on: !(v && v.done), ok: (v && v.ok), log: smLog };
      const slog = $('prof_swlog');
      if (slog){
        if (smLog.length){
          slog.style.display = 'block';
          slog.textContent = smLog.join('\n');
          slog.scrollTop = slog.scrollHeight;
        } else { slog.style.display = 'none'; }
      }
      if (v && v.msg)
        flash(v.msg,
              (v.done && v.ok === false) ? 'var(--red)'
                : (v.done ? 'var(--green)' : 'var(--blue)'),
              v.done ? 6000 : 4000);
      return;
    }
    case 'dead':
      flash('✘ 未连接（' + v + '）', 'var(--red)');
      S.snap = {};
      renderState({});
      break;
    case 'connected':
      if (v !== S.port) return;
      flash('● 已连接（' + v + '）', 'var(--green)');
      break;
    case 'pend_edit_out': {                /* 取出编辑成功——直接回填
        （服务端主动读回 TRAE 输入框文本推送，不依赖快照时机，
        切走会话也不丢）
        官方排队条取回到手机网页版重新编辑时，
        **只还人类真实发言**——剥首行 DID ＋ 服务端追加的专属词前后缀（sys/usr/co
        三段）＋ FOX 标记（copyPlain(true)，与复制同口径）。电脑端 TRAE 输入框
        由服务端 0.49 同步清空，不留同一份残留；本端改完重新发送即重新排队。 */
      S.qedit = null;
      const raw = (typeof v === 'string' ? v : '').trim();
      try { srvOpSend('pend_edit_ack', 1, '取回回执'); } catch(e){}
      if (raw && !hasUserDid(raw)){
        flash('该条不是带 DID 的人类原话，已跳过取回', 'var(--red)', 5000);
        break;
      }
      const t = raw ? copyPlain(raw, true) : '';
      if (t){
        if (typeof fillEntSafe === 'function') fillEntSafe(t);
        else el.ent.value = t;
        refreshSendBtn();
        try { el.ent.focus(); } catch(e2){}
        flash('已取出排队消息，可修改后重新发送', 'var(--blue)');
      } else if (raw){
        flash('排队消息已取出，剥掉专属词后正文为空', 'var(--red)', 6000);
      } else {
        flash('排队消息已取出，但正文为空', 'var(--red)', 6000);
      }
      break;
    }
    case 'input_take_out': {               /* 取回残留成功——2.139 起不再回填本端 */
      const t = stripHintMarks(typeof v === 'string' ? v : '');
      flash(t ? '电脑端残留已清空（不回填）' : 'TRAE 输入框无残留',
            t ? 'var(--blue)' : 'var(--red)');
      break;
    }
    case 'sent': {                           /* 服务端阶段回报
        （typed 已进 TRAE 输入框 / clicked 已点发送 / queued 已排队；
        旧版服务端发纯文本也兼容——只当 unknown 状态处理）。
        1.88：本事件**只推进卡片文案状态**（已输入/已执行/已排队），
        不再承担消卡——消卡一律走 did_ack（按 did 核对）。did 回执
        到达时卡片已撤下，此处 find 通常落空，纯兜底。 */
      let stage = '', text = '';
      if (v && typeof v === 'object'){
        stage = v.stage || ''; text = v.text || '';
      } else if (typeof v === 'string') text = v;
      const p = S.pending.find(x => (!text || x.text === text)
                                    && x.state !== 'timeout');
      if (p){
        if (stage === 'queued') p.state = 'queued';
        else if (stage === 'clicked') p.state = 'sent';
        else if (stage === 'typed') p.state = 'typed';
      }
      S.msgs_key = null;
      refreshSendBtn();
      renderAll();
      break;
    }
    case 'fullscreen_warn':                  /* 1.xx：最大化检测结果（前端主动查出） */
      if (el.lbl_fulls) el.lbl_fulls.textContent = (v && v.msg) || '—';
      if (v && v.on) fullsShow(v.msg);   /* 有压制时仍横幅提醒 */
      else fullsHide();
      break;
    case 'pend': {                           /* 命令受理广播——
        别的端（PC 面板）发出的消息也在本机回显占位，多端同看。
        switch 不进气泡：统一走「正在切换」提示条（同目标幂等、
        目标激活即撤、8s 兜底），此前误入气泡会挂 15s 变「未确认」 */
      const pk = (v && v[0]) || 'send';
      const pt = (v && v[1]) || '';
      if (pk === 'switch'){
        pendSwitchSet(pt, (v && typeof v[2] === 'string') ? v[2] : '');
        renderAll();
        break;
      }
      if (pt && !S.pending.some(x => x.text === pt)){
        const _g = S.sentGuard && S.sentGuard[pt];
        if (!(_g && Date.now() - _g < 90000)){
          pendAdd(pk, pt);
          renderAll();
        }
      }
      break;
    }
    case 'u':
    case 'human': {                        /* （WB+TR 整改 ST）：服务端人类
        记录帧（u）——带会话号 sid、会话名 title、消息编号 mid、正文 text、
        发送编号 did。收到即渲染入账并按发送编号销卡，不等快照/对账/生成结束。 */
      if (typeof ledgerHumanFrame === 'function') ledgerHumanFrame(v);
      break;
    }
    case 'points':
      if (v && v !== '读取失败' && v !== '—'){
        S.points = v;
        el.points.textContent = '积分 ' + v;
      } else if (!S.points || S.points === '—' || S.points === '读取失败'){
        el.points.textContent = '积分 ' + v;
      }
      break;
    case 'points_warn':                    /* 积分不足预警 */
      warnFlash('⚠ 积分不足：' + (v.points || v)
              + (v.th ? '（阈值 ' + v.th + '）' : '')
              + '，已通知钉钉');
      break;
    case 'account':                        /* 登录账号名 */
      S.acct = String(v || '');
      renderAcct();
      break;
    case 'notice':                         /* 服务端提示（如语音键拒点） */
      flash(String(v || ''), 'var(--blue)');
      break;
    case 'boot_ask': {                     /* Py 版「拉起」的确认弹窗——
        服务端探测到目标 TRAE 正开着，把 Py 主界面弹窗原文（v.text）下发；
        本端不自拟文案，原样展示。确认回 boot_confirm，取消回 boot_cancel。 */
      const d = v || {};
      const box = d.box || '';
      const html = esc(String(d.text || '')).replace(/\n/g, '<br>');
      const ov = uiConfirm('拉起', html, '重启', () => {
        srvOpSendJson({t: 'boot_confirm', box: box}, '拉起 ' + box);
      });
      const cancel = () => {
        ov.remove();
        if (S.onLine) sendJson({t: 'boot_cancel', box: box});
      };
      ov.querySelector('#uimask_cancel').onclick = cancel;
      ov.onclick = e => { if (e.target === ov) cancel(); };
      break;
    }
    case 'input_busy': {                   /* 后台借框占用（定时自我激活/
        收件箱提醒到点投递）——busy 期间禁用发送并提示，挡住人类操作；服务端
        在借框前后各发一条（true/false），异常也在 finally 里补 false。 */
      const d = v || {};
      if (d.busy){
        const msg = String(d.msg || '');
        S.inputBusy = msg || String(d.who || '程序');
        clearTimeout(S.inputBusyT);
        S.inputBusyT = setTimeout(() => {   /* 安全兜底：防服务端中途消失卡死 */
          S.inputBusy = ''; renderState(S.snap);
        }, 25000);
        flash(msg || ('⏳ ' + S.inputBusy + ' 正在借用输入框，请稍后'), 'var(--orange)');
      } else {
        S.inputBusy = '';
        clearTimeout(S.inputBusyT);
      }
      renderState(S.snap);
      return;
    }
    case 'models':
      S.models_full = v || [];   // 缓存官方列表供收藏比对/管理页
      rebuildModelOptions();
      checkFavInvalid();
      try { if (typeof solidSave === 'function') solidSave(); } catch(e){}   /* 模型列表固态兜底 */
      break;
    case 'model_set':
      S.model_busy = false;
      flash(v[0] === v[1] ? '模型已切换：' + v[1]
        : '「' + v[0] + '」未生效（当前 ' + (v[1] || '未知') + '）',
        v[0] === v[1] ? 'var(--green)' : 'var(--red)');
      syncModel(v[1]);
      break;
    case 'switched':
      applySwitch(v[0], v[1]);
      break;
    case 'switch_ack':           /* 切换过程状态机：服务端已收到命令回执
                                    → 从「等待服务器回应」转「正在切换中」；2.81：收到
                                    回执即【静默等待】，停掉补发定时器、不再 re-arm 补发，
                                    只保留 90s 超时兜底（服务器已接收就不再打扰；
                                    2.176 老板令：口径 60s→90s） */
      if (S.switch_pend && _swMatch(S.switch_pend, v)){
        if (S.switch_pend.phase !== 'ok'){
          S.switch_pend.phase = 'switching';
          S.switch_pend.ts = Date.now();
          clearTimeout(S.switch_pend._resendT);   /* 不再每 10s 补发 */
          if (typeof setBanner === 'function') setBanner('服务器执行中');
          renderAll();
        }
      }
      break;
    case 'switch_ok':            /* 切换过程状态机：切换成功信号 */
      if (S.switch_pend && _swMatch(S.switch_pend, v)) switchOk();
      break;
    case 'switch_pre':           /* 切换过程状态机：目标已在服务端最近抓取的
                                    pane 里 → 点击前先推来的正文帧，先显示（预取） */
      if (S.switch_pend && v && v.sid && S.switch_pend.sid === v.sid){
        if (S.switch_pend.lockTarget && !S.switch_pend.arrived) break;
        if (S.switch_pend.lockTarget
            && Array.isArray(S.switch_pend.prevMsgs)
            && sameConvBody(v.msgs, S.switch_pend.prevMsgs)) break;
        S.livePrefetch = true;                 /* 标记：别被本地存帧覆盖 */
        let _pfm = v.msgs || [];
        try {
          if (typeof lbFillFinals === 'function' && Array.isArray(_pfm) && _pfm.length)
            _pfm = lbFillFinals(v.sid, v.title || S.switch_pend.title || '', _pfm);
        } catch(e){}
        S.liveFrame = {msgs: _pfm, finish: v.finish || null,
                       tail: '', sendIdle: true, inputText: '',
                       opts: [], ask: null, pend: [], model: ''};
        renderAll();
      }
      break;
    case 'switch_fail':          /* 切换失败浮窗提醒 */
      switchFail(v);
      if (S.switch_pend && S.switch_pend.phase !== 'ok') switchClear();
      break;
    case 'booterr':
    case 'boot_noop':
      S.busy = false;
      flash(v);
      break;
    case 'ports':
      S.alive = new Set(v || []);
      break;
    case 'cmderr':
      flash('命令失败：' + v);
      if (window.renameFail) renameFail(v);
      if (S.task_open){ taskDlgClose(); }
      if (S.pending.some(p => p.state === 'sending' || p.state === 'typed')){
        S.pending.forEach(p => {
          if (p.state === 'sending' || p.state === 'typed')
            p.state = 'timeout';
        });
        renderAll();
      }
      if (S.switch_pend){ switchClear(); }
      S.ask_lock = null;               /* 命令失败解锁提问卡 */
      document.querySelectorAll('.optbtn.picked').forEach(b => {
        b.disabled = false;
        b.classList.remove('picked');
      });
      break;
    case 'msg_act':                        // 回退/删除完成 (kind, mi)
      S.msgs_act_at = Date.now();
      flash(v[0] === 'revert'
        ? '已回退到第 ' + (v[1] + 1) + ' 条「我」的消息之前'
        : '已删除第 ' + (v[1] + 1) + ' 条「我」的消息', 'var(--green)');
      if (v[0] === 'revert'){
        try {
          const t = ((S.snap && S.snap.inputText) || '').trim();
          if (t){
            el.ent.value = copyPlain(t, true);
            refreshSendBtn();
            try { el.ent.focus(); } catch(e2){}
            S.revertPend = 0;
            ftoast('↩ 已取回被撤回的话（见输入框）', 'var(--blue)', 5000);
          }
        } catch(e3){}
      }
      break;
    case 'task_dlg':                        // 记忆目录抓取结果（预填）
      if (S.task_open){
        S.task_mem = v.full || '';
        S.task_cur = '';
        taskDlgRender();
        el.td_stat.textContent = v.full
          ? '已预填 TRAE 记忆目录（可直接「创建」或「✕ 重选」）'
          : 'TRAE 无记忆目录（可选可不选）';
      }
      break;
    case 'task_dlg_ok':                     // task_dir_set 设置成功
      if (S.task_open) taskDlgClose();
      flash('✅ 工作目录已设置：' + (v || ''), 'var(--green)');
      break;
  }
}

function onRcpt(d){
  if (!d || typeof d !== 'object') return;
  const stage = String(d.stage || '');
  const did   = (d.did == null) ? '' : String(d.did);
  const id    = (d.id  == null) ? '' : String(d.id);
  const msg   = (d.msg == null) ? '' : String(d.msg);
  const _cardHit = (id ? S.pending.find(x => x.opId && x.opId === id) : null);
  const _didHit = _cardHit
                || (did ? S.pending.find(x => x.did === did) : null)
                || (/^\d{14}$/.test(id) ? S.pending.find(x => x.did === id) : null);
  if (_didHit){
    {
      const p = _didHit;
      if (stage === 'accepted')      p.state = 'accepted';
      else if (stage === 'running')  p.state = 'running';
      else if (stage === 'done'){
        p.state = 'done';                                     /* ④ 完成 */
        p.doneAt = Date.now();
        try {
          const _v = (d.v && typeof d.v === 'object') ? d.v : {};
          const _txt = String(_v.text != null ? _v.text
                     : (_v.body != null ? _v.body
                     : (d.text != null ? d.text : '')));
          if (_txt && typeof ledgerHumanFrame === 'function'){
            ledgerHumanFrame({sid: _v.sid || d.sid || '',
                              title: _v.title || d.title || '',
                              uid: _v.uid || d.uid,
                              mid: _v.mid || d.mid || '',
                              did: did || id, text: _txt});
          }
        } catch(e){}
        setTimeout(function(){
          const q = (S.pending || []).find(x => x.id === p.id);
          if (q && q.state === 'done' && q.doneAt
              && Date.now() - q.doneAt > PEND_DONE_STALE_MS - 500){
            q.state = 'stale'; renderAll();
          }
        }, PEND_DONE_STALE_MS);
      }
      else if (stage === 'fail'){    p.state = 'fail';       /* ④ 失败（如实带 msg） */
        p.failMsg = msg; }
      renderAll();
    }
  }
  /* ① 通用操作——按动作 id 匹配在途登记表（③④ 收口） */
  if (id) srvOpAck(id, stage, msg);
}

/* ============ 2.113：按需单会话（snap_pane）与「刷新当前会话」 ============
   服务端 3.41 新增 `{'t':'ev','k':'snap_pane',v:{sid,title,msgs,…}}`：同一次
   只送 1 个会话的正文（≥2s 限频、内容不变不发），需求来源＝网页端 switch /
   `{'t':'pane_req','sid':…}` / 登录重连首拍。此处补齐网页端这半边。 */
function _paneIsAnchor(sid, title){
  if (!sid) return false;
  if (S.anchorFull && String(S.anchorFull) === String(sid)) return true;
  /* 刷新/跨天后 anchorFull 可能还是旧完整 SID：按终身号再认一次 */
  return !!(S.anchorSid && typeof 稳定键 === 'function'
            && 稳定键(sid, title || '') === S.anchorSid);
}
/* 「刷新当前会话」在途登记（成功标志＝收到该 sid 的 snap_pane） */
let _paneReqWait = null;
function paneReqDone(sid){
  const w = _paneReqWait;
  if (!w || String(w.sid) !== String(sid)) return;
  _paneReqWait = null;
  try { srvOpAck(w.id, 'done'); } catch(e){}   /* ④ 成功（文案仍只由 SRV_PHASE 出） */
}
function paneRefreshNow(){
  const label = '刷新当前会话';
  const sid = String(S.anchorFull || (typeof curSid === 'function' ? curSid() : '') || '');
  if (!sid){ srvOpFlash('fail', label, '当前无锚定会话'); return false; }
  if (!S.onLine){ srvOpFlash('offline', label, '命令未发出（WS 未就绪），稍后再试'); return false; }
  const id = srvOpNewId();
  _paneReqWait = {sid: sid, id: id, at: Date.now()};
  const ok = srvOpSendJson({t: 'pane_req', sid: sid}, label, '', 4000, id);
  if (!ok) _paneReqWait = null;
  return ok;
}

