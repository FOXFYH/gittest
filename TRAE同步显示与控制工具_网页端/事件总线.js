'use strict';
/* 事件总线.js（网页端）  版本 2.131  日期 2026-10-24
   【维护记录】
   2.131  2026-10-24  官方排队条「串台」（老板原话：「排队条一定要核实清楚属于
                     哪个会话，不能乱显示，是谁的就显示在谁那边」）：`case 'snap'`
                     收到快照后先按 `pend_sid`（旧服务端回退 `v.selSid`）比当前
                     锚定会话 sid——不是本会话的排队条①**先剥掉再 adoptSnap**
                     （防锚定冻结把别人的 pend 留在屏幕上）；②**不用于 DID 销卡**
                     （③通道扫 v.pend 前加同一道闸），避免拿别人会话的排队条销
                     本会话的卡。通过校验的 pend 回写 `S.snap.pend_sid` 供
                     消息渲染.js 2.131 兜底复验。服务端配套 抓取轮询 0.58／
                     WS桥 0.23。2.130→2.131。 */
function onEv(kind, v){
  switch (kind){
    case 'pendlist': {                 /* 1.35：服务端对账结果即时同步——
        撤卡/超时/排队推送不再等下一拍快照（poll=3s 时撤卡滞后 0~3s
        的根因）。服务端 _pend 是权威：列表里没有 = 已确认撤卡；
        state 变化（timeout/queued…）照收。
        1.88：**旧「按 kind+text 对号撤卡」已旁路**——消卡只认 did
        （did_ack）；服务端对账列表仍是权威，但条目与本地卡的对号
        不再靠文本猜（用户规定：识别相同内容不靠谱）。旧服务端
        场景由 PEND_DID_TMO 超时兜底转「可能未送达」。 */
      return;
    }
    case 'did_pool': {                 /* v2.82：服务端广播「最近 10 条由网页版
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
    case 'snap_pane': {                /* 2.113（协议另半边·服务端已 3.41）：按需单会话帧
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
          && (_spv.sid ? String(_spv.sid) === psid
                       : (S.anchorSid && 稳定键(psid, pv.title || '') === S.anchorSid)))
        _spv.arrived = true;
      /* 撤「正在获取直播帧」条（liveClear 内含立即落盘）；无条则补一次存帧 */
      if (S.livePend && (S.livePend === psid || S.livePend === S.anchorSid)) liveClear();
      else { try { snapIdbTick(true); } catch(e){} }
      try { if (typeof paneReqDone === 'function') paneReqDone(psid); } catch(e){}
      renderAll();
      break;
    }
    case 'snap': {
      if (v._port !== S.port) return;        // 旧目标迟到快照，丢弃防串台
      /* 1.xx：登录轻启动——服务端 hello 只发「框架版」快照（无 msgs，
         正文由登录后第一拍常规快照轮询补齐）。此时若直接 S.snap=v，
         消息区会因 msgs 缺失闪成空白再跳回正文（大会话尤其明显）。
         故框架版只刷列表/模型/状态，正文用旧值兜底，免闪空。 */
      /* 2.105（老板 2026-10-20 15:43「头晕脑胀」主因·最高优先）：判据由「仅 msgs 缺失」
         放宽为「msgs 不是数组」——服务端框架版快照 `_light_snap` 会把 msgs 头整个拿走
         （`pop('msgs')`），也可能送来 null/非数组；旧判据漏掉这些形态 ⇒ S.snap.msgs 落到
         非数组 ⇒ curMsgs 回落账本（行数骤减，实测 8→3）。⇒ 来帧若【无 msgs 数组】一律
         只更新会话列表/状态/锚定，正文【保留上一拍已上屏的 msgs】。 */
      if (!Array.isArray(v.msgs) && S.snap && Array.isArray(S.snap.msgs)){
        v.msgs = S.snap.msgs;
      }
      /* 本专项 B3：先记下这拍快照「桌面当前选中行」——它就是直播帧的归属
         会话；当前锚定会话的真直播帧一到，立即撤「正在获取直播帧」小条。 */
      /* 2.131：排队条归属闸（老板「排队条一定要核实清楚属于哪个会话，不能乱
         显示，是谁的就显示在谁那边」）——快照 pend 只取【电脑端选中】会话，
         本端锚定可能在别处。取顶层 `pend_sid`（旧服务端回退 v.selSid），与
         当前锚定 sid 比对；不是本会话的**先剥掉再 adoptSnap**（否则锚定冻结
         会把别人的 pend 原样留在屏幕上），也不拿它销卡。字段都缺 ⇒ 维持旧
         行为、不新增丢弃。 */
      const _penArr = Array.isArray(v.pend) ? v.pend : [];
      const _penOwner = String(v.pend_sid || v.selSid || '');
      const _curSidNow = String((typeof curSid === 'function' ? curSid() : '') || '');
      /* 2.132：有排队条但归属不明 ⇒ 当「不是本会话」，宁可不画也不留残影 */
      const _penMine = (!_penArr.length)
          ? true
          : ((!_penOwner || !_curSidNow) ? false
             : (_penOwner === _curSidNow
                || (typeof 稳定键 === 'function'
                    && 稳定键(_penOwner, '') === 稳定键(_curSidNow, ''))));
      if (_penArr.length && !_penMine) v.pend = [];
      const liveSid = selSidOf(v);
      const liveKey = 稳定键(liveSid, selTitleOf(v));   /* 终身号：跨天也能认出直播帧归属 */
      S.snap = adoptSnap(v);   /* 2.18 锚定：拒收「别人把桌面挪走」的跟随 */
      /* 2.131：走到这里的 pend 已确认属于本会话（别人的上面已先剥，锚定冻结
         留用的也是本会话旧帧）⇒ 回写 pend_sid，供 消息渲染.js 2.131 复验。 */
      if (Array.isArray(v.pend) && v.pend.length){
        v.pend_sid = String((typeof curSid === 'function' ? curSid() : '')
                            || _penOwner || '');
      }
      /* 2.89（老板 2026-10-20）：切换过渡期「锁死目标会话」——网页端自己发起的
         切换在途、且目标正文尚未到达时【不】撤直播帧覆盖。旧实现在「TRAE 先点亮
         B 标题、正文仍属 A」那一拍就 liveClear ⇒ 回落 curMsgs 读到仍是 A 的快照
         正文，出现「一会 B、闪一下 A、再 B」的交叉闪现。
         2.93（老板 2026-10-20 07:09「切换成功瞬间又闪 A」）：判定「仍是旧会话 A」
         改用 sameConvBody（消息身份＝首条角色＋正文，忽略 can_rev/can_del 标志
         抖动）——旧用 msgsFp，标志一抖即被误判成「目标正文已到」⇒ 撤锁露出 A。 */
      const _sp0 = S.switch_pend;
      const _stillOld = !!(_sp0 && _sp0.lockTarget
          && (Array.isArray(_sp0.prevMsgs)
              ? sameConvBody(v.msgs, _sp0.prevMsgs)
              : msgsFp(v.msgs) === _sp0.fp0));
      if (_stillOld){
        /* 过渡期：锁死目标（正文取 B 的帧），快照里 A 的正文不上屏 */
      } else if (S.livePend && liveKey && liveKey === S.anchorSid){
        if (_sp0 && _sp0.lockTarget) _sp0.arrived = true;   /* 目标正文已到 → 收口 */
        liveClear();
      }
      /* 2.40：网页端专享字段落全局——备注字典 + 定时自我激活任务列表，
         供 会话列表.js 渲染后缀/指纹与右键菜单读取（钩子缺失则跳过）。 */
      if (window.备注入快照) 备注入快照(v);
      if (window.定时入快照) 定时入快照(v);
      /* v2.82/v2.83（老板口径）：销卡**三渠道任一命中 ⇒ 立刻销卡**（跳步，
         不死等「已发出」确认）。
         ① 本拍快照的【对话记录】——⚠ **只查「人类的发言」**（role=u，即
            「我」发出的消息）的【首行】14 位 DID；AI 发言不带 DID、绝不误判。
         ③ 本拍快照的【官方排队条】（v.pend 每项 t）——消息一进 TRAE 官方队列
            即算「已发出」，不必等它落进对话记录；命中该 DID 同样立刻销卡。
            v2.84：条目文本实测是「DID 空格 正文」单行（TRAE 把首行 DID 后的
            换行折叠成空格），故用 pendDidOf 取开头 DID（firstLineDid 取不到）。
         （② 服务端 did_pool 广播在下方 did_pool 分支处理。） */
      const _ct = curTitle();
      (v.msgs || []).forEach(m => {          /* ① 只扫人类发言 */
        if (!m || m[0] !== 'u') return;
        const _d = firstLineDid(m[1]);
        if (_d) pendClearByDid(_d, _ct);
      });
      if (_penMine) (v.pend || []).forEach(it => {   /* ③ 官方排队条（限本会话） */
        const _d = pendDidOf(it && it.t);
        if (_d) pendClearByDid(_d, _ct);
      });
      pendReconcile(v.msgs || []);           // 1.09：撤下已落地的占位
      if (S.qedit !== null && S.qedit !== undefined){
        /* 1.29：取出编辑——TRAE 已把条目移出队列并回填其输入框，
           同步到本端输入框供修改重发 */
        S.qedit = null;
        const t = (v.inputText || '').trim();
        if (t){
          el.ent.value = t;
          refreshSendBtn();
          try { el.ent.focus(); } catch(e2){}
          flash('已取出排队消息，可修改后重新发送', 'var(--blue)');
        } else {
          flash('取出失败（条目已变化）', 'var(--red)');
        }
      }
      /* 本专项 F1：到达判定只用于状态灯与「失败回报」，不再阻塞任何操作——
         锚定在用户点击那一刻就已生效（指令先行），正文晚到只影响观感。 */
      if (S.switch_pend){                    /* 2.67 切换过程状态机：兜底到达判定 */
        const cv = v.convs || [];
        const sp = S.switch_pend;
        const spSid = sp.sid || '';
        const act = cv.find(r => r[0] === 'c' && r[2]);
        /* v1.95：有稳定 ID 时按 ID 判「目标是否还在列表/是否激活」
           （改名期间也判得准），无 ID 回退标题 */
        const rowKey = r => (spSid ? (r[4] || '') : (r[1] || ''));
        const has = cv.some(r => r[0] === 'c'
                       && (r[4] || r[1]) && rowKey(r) === (spSid || sp.title));
        /* 1.16：到达确认——标题激活还不够（TRAE 先亮标题后加载
           正文），正文真的换过来才算到达。2.93：改用消息身份
           （sameConvBody），标志抖动不再算「到达」。 */
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
        /* 2.67：超时不再在此按指钟判——由 switchReArm 的 60s 定时器负责 */
      }
      /* 2.100（老板 2026-10-20 12:16）：刷新/重连后「继续锚定当前会话，继续向服务器
         提要求」——首拍若发现服务端选中行≠本地持久化锚定，补发一次 switch（只发一次）。 */
      if (S.anchor_reask){
        S.anchor_reask = 0;
        const _aSel = 稳定键(selSidOf(v), selTitleOf(v));
        if (S.anchorFull && S.anchorSid && _aSel && _aSel !== S.anchorSid){
          try { sendCmd('switch', S.anchorFull); } catch(e){}
        }
      }
      renderAll();
      /* 2.98（标准§二之一「不是等刻度」）：新快照到达即触发一次落盘检查——
         距上次落盘已满 10 秒就立刻落（不必等 10 秒轮询那一拍）。 */
      if (typeof snapIdbTick === 'function') snapIdbTick();
      break;
    }
    case 'profiles': {
      /* v1.45：分身状态数据（服务端外挂「谷歌分身助手转接器」推送） */
      S.profiles = v;
      if (el.profpage.classList.contains('on')) renderProf();
      return;
    }
    case 'profiles_run': {
      /* v1.45：立刻实测状态（on=true 开始 / on=false 结束）。
         v1.47：结束带 stopped=true 表示「被停止」，用户可确认停止成功。 */
      S.prof_run = !!(v && v.on);
      if (v && !v.on && v.stopped) flash('已停止本次实测', 'var(--orange)');
      if (el.profpage.classList.contains('on')) renderProf();
      return;
    }
    case 'profiles_login': {
      /* 2.18：补登录结果回投（v={name,ok,msg}）。 */
      if (v && v.msg) flash((v.ok ? '✓ ' : '✗ ') + v.msg,
                            v.ok ? 'var(--green)' : 'var(--red)');
      return;
    }
    case 'switch_migrate': {
      /* 2.19：一键换号迁移进度（v={stage,msg,ok,done,target,log:[...]}）。
         阶段+逐行日志写进分身页的 #prof_swlog；末条 done 定成败。 */
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
      S.attach_pending = null;
      renderAttach([]);
      break;
    case 'connected':
      if (v !== S.port) return;
      flash('● 已连接（' + v + '）', 'var(--green)');
      /* v1.34：连接/登录不再触发积分与模型查询——服务端后台周期
         自查（积分 10 分钟/有人在线，模型 60 分钟），hello 重放缓存。
         客户端零触发，避免每次上线都打断 TRAE 开菜单。 */
      break;
    case 'pend_edit_out': {                /* 1.53：取出编辑成功——直接回填
        （服务端主动读回 TRAE 输入框文本推送，不依赖快照时机，
        切走会话也不丢）
        2.127（老板 2026-10-23 15:38）：官方排队条取回到手机网页版重新编辑时，
        **只还人类真实发言**——剥首行 DID ＋ 服务端追加的专属词前后缀（sys/usr/co
        三段）＋ FOX 标记（copyPlain(true)，与复制同口径）。电脑端 TRAE 输入框
        由服务端 0.49 同步清空，不留同一份残留；本端改完重新发送即重新排队。 */
      S.qedit = null;
      const raw = (typeof v === 'string' ? v : '').trim();
      /* 2.138（老板 2026-10-26 23:23）：只取回「带 DID 的人类原话」——首行没有 14 位 DID
         的一律不回填（AI/程序塞进输入框的字不是原话，取回来会污染我自己的输入）。 */
      if (raw && !hasUserDid(raw)){
        flash('该条不是带 DID 的人类原话，已跳过取回', 'var(--red)', 5000);
        break;
      }
      const t = raw ? copyPlain(raw, true) : '';
      if (t){
        el.ent.value = t;
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
    case 'input_take_out': {               /* 1.53：取回残留成功——2.139 起不再回填本端 */
      /* 2.139（老板 2026-10-27 00:19）：**残留永远不回填**——电脑端残留由服务端直接清空，
         绝不拿它替换我在网页端正在打的字；「我这边送过去的文本才是老大」。
         这里只按有无残留给一句提示，绝不碰 el.ent.value。 */
      const t = stripHintMarks(typeof v === 'string' ? v : '');
      flash(t ? '电脑端残留已清空（不回填）' : 'TRAE 输入框无残留',
            t ? 'var(--blue)' : 'var(--red)');
      break;
    }
    case 'sent': {                           /* 1.09：服务端阶段回报
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
      /* 2.70：输入框公私隔离——别端 / AI 跨会话投递 / 电脑面板 / 后台提醒
         等「sent」广播一律不得清掉本机正在打的草稿（本机自己发送早在 cmd()
         里清过，此处的清空对本地本就是冗余）。用户 2026-10-04 定：Py 版
         输入框=公用、网页版=私用，操作公用不得波及网页私用草稿。
         对齐 WorkBuddy v1.74 同款修法。 */
      refreshSendBtn();
      renderAll();
      break;
    }
    case 'fullscreen_warn':                  /* 1.xx：最大化检测结果（前端主动查出） */
      if (el.lbl_fulls) el.lbl_fulls.textContent = (v && v.msg) || '—';
      if (v && v.on) fullsShow(v.msg);   /* 有压制时仍横幅提醒 */
      else fullsHide();
      break;
    case 'pend': {                           /* 1.10：命令受理广播——
        别的端（PC 面板）发出的消息也在本机回显占位，多端同看。
        switch 不进气泡：统一走「正在切换」提示条（同目标幂等、
        目标激活即撤、8s 兜底），此前误入气泡会挂 15s 变「未确认」 */
      const pk = (v && v[0]) || 'send';
      const pt = (v && v[1]) || '';
      if (pk === 'switch'){
        pendSwitchSet(pt, (v && v[2]) || '');   /* v2.32：第 3 位=稳定 ID */
        renderAll();
        break;
      }
      if (pt && !S.pending.some(x => x.text === pt)){
        /* 2.31：自己刚发的消息，服务端会把文字回显（pend）过来；若此时本端
           卡片已被 did_ack/did_hits 撤下，回显会重新塞一张【无 did】的卡，
           从此永远匹配不上 did —— 这就是「按 ID 判断后 100% 卡住」的元凶。
           本端 90 秒内刚发过的文本，不再因回显重复建卡。 */
        const _g = S.sentGuard && S.sentGuard[pt];
        if (!(_g && Date.now() - _g < 90000)){
          pendAdd(pk, pt);
          renderAll();
        }
      }
      break;
    }
    case 'points':
      if (v && v !== '读取失败') S.points = v;
      el.points.textContent = '积分 ' + v;
      break;
    case 'points_warn':                    /* 1.27：积分不足预警 */
      warnFlash('⚠ 积分不足：' + (v.points || v)
              + (v.th ? '（阈值 ' + v.th + '）' : '')
              + '，已通知钉钉');
      break;
    case 'account':                        /* 1.27：登录账号名 */
      S.acct = String(v || '');
      renderAcct();
      break;
    case 'notice':                         /* 1.41：服务端提示（如语音键拒点） */
      flash(String(v || ''), 'var(--blue)');
      break;
    case 'boot_ask': {                     /* 2.122：Py 版「拉起」的确认弹窗——
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
    case 'input_busy': {                   /* 2.46：后台借框占用（定时自我激活/
        收件箱提醒到点投递）——busy 期间禁用发送并提示，挡住人类操作；服务端
        在借框前后各发一条（true/false），异常也在 finally 里补 false。 */
      const d = v || {};
      if (d.busy){
        /* 2.74：支持服务端自定义整句播报——d.msg 非空则【原样】flash（不再套
           「⏳ …正在借用输入框」模板）；同时 S.inputBusy 仍取到值（供 输入界面.js
           的「借用中」/禁用发送生效，取 msg 或 who）。msg 为空维持旧文案与行为。 */
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
      S.models_full = v || [];   // 1.15：缓存官方列表供收藏比对/管理页
      rebuildModelOptions();
      checkFavInvalid();
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
    case 'switch_ack':           /* 2.67 切换过程状态机：服务端已收到命令回执
                                    → 从「等待服务器回应」转「正在切换中」；2.81：收到
                                    回执即【静默等待】，停掉补发定时器、不再 re-arm 补发，
                                    只保留 60s 超时兜底（服务器已接收就不再打扰） */
      if (S.switch_pend && _swMatch(S.switch_pend, v)){
        if (S.switch_pend.phase !== 'ok'){
          S.switch_pend.phase = 'switching';
          S.switch_pend.ts = Date.now();
          clearTimeout(S.switch_pend._resendT);   /* 2.81：不再每 10s 补发 */
          renderAll();
        }
      }
      break;
    case 'switch_ok':            /* 2.67 切换过程状态机：切换成功信号 */
      if (S.switch_pend && _swMatch(S.switch_pend, v)) switchOk();
      break;
    case 'switch_pre':           /* 2.67 切换过程状态机：目标已在服务端最近抓取的
                                    pane 里 → 点击前先推来的正文帧，先显示（预取） */
      if (S.switch_pend && v && v.sid && S.switch_pend.sid === v.sid){
        /* 2.97（老板 2026-10-20 09:34）：切换在途（锁死目标、目标全量帧未到）一律
           【不】用预取帧独立上屏——它既非目标「最新存帧（历史）」也非目标「全量最新
           帧」，属「其它来源」的中间态；整帧弃用，保持目标存帧/现画面，等 B 全量帧。 */
        if (S.switch_pend.lockTarget && !S.switch_pend.arrived) break;
        /* 2.93（老板 2026-10-20 07:09）：预取帧若携的仍是【切换前旧会话 A 的
           正文】（服务端偶发把切换前的 pane 帧当预取推来），【不得】据以上屏、
           也不得当作「目标到达」——整帧弃用，保留目标会话的本地存帧，等 B 真帧。
           仅当帧确属目标 B（消息身份与 A 不同）才走原预取路径。 */
        if (S.switch_pend.lockTarget
            && Array.isArray(S.switch_pend.prevMsgs)
            && sameConvBody(v.msgs, S.switch_pend.prevMsgs)) break;
        S.livePrefetch = true;                 /* 标记：别被本地存帧覆盖 */
        S.liveFrame = {msgs: v.msgs || [], finish: v.finish || null,
                       tail: '', sendIdle: true, inputText: '',
                       opts: [], ask: null, pend: [], attach: [], model: ''};
        renderAll();
      }
      break;
    case 'switch_fail':          /* 1.86：切换失败浮窗提醒 */
      switchFail(v);
      if (S.switch_pend && S.switch_pend.phase !== 'ok') switchClear();
      break;
    case 'booterr':
    case 'boot_noop':
      S.busy = false;
      flash(v);
      break;
    case 'attach_done':
      S.attach_pending = null;
      if (v.ok >= v.total && v.total)
        flash('✅ 已附加 ' + v.ok + ' 个附件', 'var(--green)');
      else if (v.ok)
        flash('⚠ 仅附加成功 ' + v.ok + '/' + v.total + '（部分被 TRAE 拒收）',
              'var(--orange)');
      else
        flash('❌ 附件未出现在输入栏（类型被拒？）');
      renderAttach(S.snap.attach || []);
      break;
    case 'attach_rm_done':
      renderAttach(S.snap.attach || []);
      flash('已移除附件', '#888');
      break;
    case 'ports':
      S.alive = new Set(v || []);
      break;
    case 'cmderr':
      flash('命令失败：' + v);
      /* 2.87：在途的「重命名」用真实失败信号收口（不无信号播报成功） */
      if (window.renameFail) renameFail(v);
      /* 1.11：新建弹窗流程出错 → 收起弹窗（否则卡在「正在展开」） */
      if (S.task_open){ taskDlgClose(); }
      /* 1.09：命令报错 → 在途占位立刻标「未确认」，别让用户干等 15s */
      if (S.pending.some(p => p.state === 'sending' || p.state === 'typed')){
        S.pending.forEach(p => {
          if (p.state === 'sending' || p.state === 'typed')
            p.state = 'timeout';
        });
        renderAll();
      }
      if (S.switch_pend){ switchClear(); }
      S.ask_lock = null;               /* 1.27：命令失败解锁提问卡 */
      document.querySelectorAll('.optbtn.picked').forEach(b => {
        b.disabled = false;
        b.classList.remove('picked');
      });
      break;
    case 'msg_act':                        // 1.06：回退/删除完成 (kind, mi)
      /* 2.94：记下「回退/删除完成」时刻——其 2s 内 msgs 变短属合法，通用工具.js
         _msgsMonotonic 护栏在此期间放行（不让单调护栏把合法删除挡成「删不掉」）。 */
      S.msgs_act_at = Date.now();
      flash(v[0] === 'revert'
        ? '已回退到第 ' + (v[1] + 1) + ' 条「我」的消息之前'
        : '已删除第 ' + (v[1] + 1) + ' 条「我」的消息', 'var(--green)');
      /* v1.56：撤回体验对齐原版——原版撤回后会把被撤回的话取回输入框。
         1.62：不再只赌「msg_act 到达时 S.snap.inputText 已有字」（快照与
         msg_act 的到达时机偶有偏差 -> 回填落空、看不出同步结果）；此处
         有字就回填，没字交给下一次快照的 revertRefill() 补上。 */
      if (v[0] === 'revert'){
        try {
          const t = ((S.snap && S.snap.inputText) || '').trim();
          if (t){
            el.ent.value = t;
            refreshSendBtn();
            try { el.ent.focus(); } catch(e2){}
            S.revertPend = 0;
            ftoast('↩ 已取回被撤回的话（见输入框）', 'var(--blue)', 5000);
          }
        } catch(e3){}
      }
      break;
    case 'task_dlg':                        // 1.08：记忆目录抓取结果（预填）
      if (S.task_open){
        S.task_mem = v.full || '';
        S.task_cur = '';
        taskDlgRender();
        el.td_stat.textContent = v.full
          ? '已预填 TRAE 记忆目录（可直接「创建」或「✕ 重选」）'
          : 'TRAE 无记忆目录（可选可不选）';
      }
      break;
    case 'task_dlg_ok':                     // 1.08：task_dir_set 设置成功
      if (S.task_open) taskDlgClose();
      flash('✅ 工作目录已设置：' + (v || ''), 'var(--green)');
      break;
  }
}

/* ============ 2.90（老板夜间令 B10／C7）：接服务端「四步提醒」回执 t:'rcpt' ============
   协议（单通道 + stage）：{"t":"rcpt","id":<网页端动作id>,"cmd":<命令名>,
     "stage":"accepted|running|done|fail","ok":true|false,"did":<供占位卡配对>,
     "msg":<fail原因/done摘要>}。本处理只补「③ 服务器已受理/开始执行」与
     「④ 完成／失败（失败如实显示 msg）」；①（未连 WS）与②（已发出）仍由发送侧
     （srvNeedOnline／srvOpSend 的 srvOpFlash）播报，switch_ack／cmderr 行为一字不动。
   配对：① 通用操作（置顶/取消置顶、删除、折叠/展开、重命名…）按动作 id 匹配
            在途登记表 srvOpAcct（见 通用工具.js）；
         ② 发送/插话占位卡按【真 DID】匹配（不再按「含 DID 的文本」——服务端回执
            已带 did，旧文本匹配遇服务端回纯正文必失配，正是③永不显示之根因）。 */
function onRcpt(d){
  if (!d || typeof d !== 'object') return;
  const stage = String(d.stage || '');
  const did   = (d.did == null) ? '' : String(d.did);
  const id    = (d.id  == null) ? '' : String(d.id);
  const msg   = (d.msg == null) ? '' : String(d.msg);
  /* ② 占位卡（发送/插话）——按真 DID 配对 */
  if (did){
    const p = S.pending.find(x => x.did === did);
    if (p){
      if (stage === 'accepted')      p.state = 'accepted';   /* ③ 服务器已受理 */
      else if (stage === 'running')  p.state = 'typed';      /* ③ 服务器开始执行 */
      else if (stage === 'done')     p.state = 'done';       /* ④ 完成 */
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
/* P1-5：向服务端索取「当前锚定会话」的全额帧（pane_req；服务端 _pane_sniff 同名认）。
   四步提示走 2.90/2.112 公共出口 srvOpSendJson＋SRV_PHASE；无回帧 30s 落「待确认」。 */
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
try { const _bpn = $('btn_panerefresh'); if (_bpn) _bpn.onclick = paneRefreshNow; } catch(e){}

