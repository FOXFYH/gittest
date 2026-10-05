'use strict';
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
    case 'did_ack': {                  /* 1.94：服务端「已受理」回执——仅登记 acked，
        不再据此消卡。用户 2026-09-30 定：卡片要留到聊天记录里真出现那句话
        才消（did_ack 到达快于聊天记录渲染，若据此秒消会「文字还没出来卡就
        没了」，空档期看不见自己发的话）。消卡改由快照 did_hits 负责。 */
      if (v && typeof v === 'string'){
        S.pending.forEach(p => { if (p.did === v) p.acked = true; });
      }
      return;
    }
    case 'did_miss': {                 /* 2.30：服务端确认没受理过该 did
        → 卡片直接转「可能未送达」，不必傻等到 60 秒。 */
      if (v && typeof v === 'string'){
        let hit = false;
        S.pending.forEach(p => { if (p.did === v){ p.state = 'timeout'; hit = true; } });
        if (hit) renderAll();
      }
      return;
    }
    case 'bench_write': {              /* 2.33：阅读器「编辑→保存」写回结果
        （v={ok,path,size,enc} 或 {ok:False,err}）→ 交给阅读器收尾 */
      if (window.FileRead && FileRead.onSaved) FileRead.onSaved(v);
      return;
    }
    case 'snap': {
      if (v._port !== S.port) return;        // 旧目标迟到快照，丢弃防串台
      /* 1.xx：登录轻启动——服务端 hello 只发「框架版」快照（无 msgs，
         正文由登录后第一拍常规快照轮询补齐）。此时若直接 S.snap=v，
         消息区会因 msgs 缺失闪成空白再跳回正文（大会话尤其明显）。
         故框架版只刷列表/模型/状态，正文用旧值兜底，免闪空。 */
      if (v.msgs === undefined && S.snap && Array.isArray(S.snap.msgs)){
        v.msgs = S.snap.msgs;
      }
      S.snap = adoptSnap(v);   /* 2.18 锚定：拒收「别人把桌面挪走」的跟随 */
      /* 2.31：聊天记录带回的 did（服务端把「原文已落到聊天记录」的对话 ID
         搭快照一起发来）→ 直接按 did 消卡。这是可靠通道（能看到 AI 回复
         即证明它必达），不依赖 did_ack 广播；根治「按 ID 判断后 100% 卡住」。 */
      if (Array.isArray(v.did_hits) && v.did_hits.length){
        v.did_hits.forEach(d => { pendClearByDid(d); });
      }
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
      if (S.switch_pend){                    // 1.09：目标会话激活 → 撤条
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
           正文），消息指纹与切换前不同才说明正文真的换过来了 */
        const arrived = msgsFp(v.msgs) !== sp.fp0;
        const timedout = Date.now() - sp.ts > SWITCH_HANG_MS;
        const arrivedOk = act && (spSid ? (act[4] || '') === spSid
                                        : act[1] === sp.title) && arrived;
        if (arrivedOk || !has || timedout){
          /* 1.xx：切换结束判定——成功到达(内容有变)归零失败计数；失败/
             超时不静默：1.87 起在「列表找不着」或「24s超时仍未到达」这
             两种真正的失败场景弹出「⚠ 会话切换失败」显眼提醒（同一目标
             只弹一次：撤条后 switch_pend 已清，后续 snap 不再进本分支）。 */
          if (arrivedOk){
            S.falls_fail = 0;
          } else {
            switchFail(sp.title);
          }
          S.switch_pend = null;              // 超时兜底，别一直挂着
        }
      }
      renderAll();
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
        切走会话也不丢） */
      S.qedit = null;
      const t = (typeof v === 'string' ? v : '').trim();
      if (t){
        el.ent.value = t;
        refreshSendBtn();
        try { el.ent.focus(); } catch(e2){}
        flash('已取出排队消息，可修改后重新发送', 'var(--blue)');
      }
      break;
    }
    case 'input_take_out': {               /* 1.53：取回残留成功——文本回填本端 */
      const t = (typeof v === 'string' ? v : '').trim();
      if (t){
        el.ent.value = t;
        refreshSendBtn();
        try { el.ent.focus(); } catch(e2){}
        flash('已取回残留，可修改后重新发送', 'var(--blue)');
      } else {
        flash('TRAE 输入框无残留', 'var(--red)');
      }
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
      el.ent.value = '';
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
    case 'switch_fail':          /* 1.86：切换失败浮窗提醒 */
      switchFail(v);
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
      renderPorts();
      break;
    case 'cmderr':
      flash('命令失败：' + v);
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
      if (S.switch_pend){ S.switch_pend = null; renderAll(); }
      S.ask_lock = null;               /* 1.27：命令失败解锁提问卡 */
      document.querySelectorAll('.optbtn.picked').forEach(b => {
        b.disabled = false;
        b.classList.remove('picked');
      });
      break;
    case 'bench_ls':                       // 1.01：📂 目录应答
      benchRender(v);
      break;
    case 'bench_read':                     // 0.11：📄 文件阅读应答（分块）
      FileRead.onData(v);
      break;
    case 'bench_open': {                   // 2.28：本地主动弹窗展示
      const o = v || {};
      if (o.mode === 'file') FileRead.open(o.path || '');
      else benchOpen(o.path || '');
      break;
    }
    case 'msg_act':                        // 1.06：回退/删除完成 (kind, mi)
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

