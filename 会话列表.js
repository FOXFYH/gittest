'use strict';
function drawerOpen(){
  el.drawer.classList.add('on'); el.mask.classList.add('on');
}
function drawerClose(){ el.drawer.classList.remove('on'); el.mask.classList.remove('on'); }

function renderConvs(rows, conv_unread, conv_unread_ids){
  /* v1.49：conv_unread=服务端快照顶层可选字段「完成-未查看」标题列表。
     旧服务端/无该字段时回退旧行为。清单参与指纹——unread 变化也要重绘。
     v1.95：新增 conv_unread_ids=同一未读集合的【稳定 ID】口径（服务端
     按 sid 记）。优先用 ID 匹配（改名不丢灯），服务端未提供该字段
     （旧版）则回退按标题。 */
  const ur = new Set(Array.isArray(conv_unread) ? conv_unread : []);
  const useId = Array.isArray(conv_unread_ids);
  const uri = new Set(useId ? conv_unread_ids : []);
  /* P15：服务端同帧下发的四字段（会话名/真实SID/状态灯/定时）——有则优先，
     旧服务端无该字段时完全回退原逻辑。 */
  const cfRows = (S.snap && Array.isArray(S.snap.convs_full))
    ? S.snap.convs_full : null;
  const cfKey = cfRows ? cfRows.map(o => (o && o.sid || '') + ':'
      + (o && o.status && o.status.light || '') + ':'
      + (o && o.schedule ? (o.schedule.next_at || '') : '')).sort().join('|') : '';
  const key = rows.map(r => r.join('|')).join('#')
    + '#ur:' + Array.from(ur).sort().join('|')
    + '#uri:' + Array.from(uri).sort().join('|')
    /* P15：四字段（状态灯/定时）变化也必重绘 */
    + '#cf:' + cfKey
    /* 2.40：备注字典纳入指纹——备注变化也要触发重绘（钩子缺失回退空） */
    + '#note:' + (window.备注指纹 ? 备注指纹() : '')
    /* 2.47：定时任务指纹纳入去重——设/撤/推进定时也会重绘（钩子缺失回退空） */
    + '#sched:' + (window.定时指纹 ? 定时指纹() : '')
    /* 本专项 A7：锚点纳入指纹——锚点变化也要重画，选中态即时跟随锚定 */
    + '#a:' + (S.anchorSid || '');
  if (key === S.convs_key) return;
  S.convs_key = key;
  /* 2.87：重命名完成对账——会话行标题真变成目标新名即收口「成功」
     （真实信号；列表标题在指纹里，改名必致 key 变化 → 必到这里）。 */
  renameScanRows(rows);
  el.convs.innerHTML = '';
  let inFolder = false, idx = 0;
  /* 1.31：按位取值（兼容旧 3 元组）——r[3]=状态灯 run/done/fail/stop/''
     v1.95：r[4]=会话稳定 ID（缺失则回退标题锚定） */
  for (const r of rows){
    const kind = r[0], title = r[1] || '', flag = r[2], st = r[3] || '';
    const sid = r[4] || '';
    if (kind === 'f'){
      const d = document.createElement('div');
      d.className = 'convo folder';
      const nm = document.createElement('span');
      nm.className = 'fname';
      nm.textContent = (flag ? '▸ ' : '▾ ') + title;
      d.appendChild(nm);
      /* 1.06：组头 ➕ —— 在该文件夹工作区内新建对话 */
      const p = document.createElement('span');
      p.className = 'fplus';
      p.textContent = '➕';
      p.title = '在此文件夹内新建对话（隶属文件夹工作区）';
      p.onclick = e => {
        e.stopPropagation();
        if (srvNeedOnline('新建对话')) return;
        if (S.task_open) return;
        drawerClose();
        /* 1.11：统一新建弹窗（锁定模式）——创建才真正点组内新建 */
        taskDlgOpen(title);
        flash('在「' + title + '」内新建对话', 'var(--blue)');
      };
      d.appendChild(p);
      d.onclick = () => {              /* 1.09：折叠/展开也要有反馈 */
        /* 2.90：统一走 srvOpSend（未连 WS ⇒ ①「正在连接 WS…」且命令不发出；
           连上 ⇒ ②「等待服务器回应…」＋服务端 rcpt 补 ③④）。 */
        srvOpSend('toggle_folder', title, '折叠/展开', '「' + title + '」');
      };
      el.convs.appendChild(d);
      inFolder = true;
    } else {
      const d = document.createElement('div');
      /* 2026-10-16（用户口径：绑定改终身号）：稳定性键＝终身号（完整 SID 每日变、
         跨天不稳）——锚定/未读灯/备注/定时一律用它；仅 switch 仍送完整 sid。 */
      const sKey = 稳定键(sid, title);
      /* 本专项 A7：列表选中态与锚定态同源——锚定键优先，未锚定才用快照标志 */
      const isAct = S.anchorSid ? (sKey === S.anchorSid) : !!flag;
      d.className = 'convo item' + (isAct ? ' act' : '');
      d.style.paddingLeft = inFolder ? '28px' : '14px';
      /* v1.49：对齐原版状态灯口径——只在这几种显示灯：
         run=蓝·脉动(进行中) fail=红 stop=灰；st=='done' 且「完成未查看」
         → 橙灯；done 已读 → 无灯（移除原绿点）。
         v1.95：未读优先按稳定 ID 命中（改名不丢灯），无 ID 回退标题。 */
      /* P15：四字段优先——服务端同帧带 convs_full 时，状态灯/定时/真 SID 全用它；
         旧服务端无该字段则完全回退原逻辑（零回归）。 */
      const cfx = cfRows ? cfRows.find(o => o && (
        (sid && o.sid === sid) || (sKey && o.stable === sKey))) : null;
      const light = cfx && cfx.status ? (cfx.status.light || '') : '';
      const uread = cfx ? !!(cfx.status && cfx.status.unread) :
        ((st === 'done') && (useId && sid ? uri.has(sid) : ur.has(title)));
      const dotCls = cfx
        ? (light === 'busy' ? 'stdot-run'
          : light === 'fail' ? 'stdot-fail'
          : light === 'stop' ? 'stdot-stop'
          : light === 'unread' ? 'stdot-uread' : '')
        : (st === 'run' ? 'stdot-run' : st === 'fail' ? 'stdot-fail'
          : st === 'stop' ? 'stdot-stop' : uread ? 'stdot-uread' : '');
      if (dotCls){
        const dot = document.createElement('span');
        dot.className = 'stdot ' + dotCls;
        d.appendChild(dot);
      }
      const tspan = document.createElement('span');
      /* 2.40：会话名后追加（备注）——钩子由 会话备注.js 提供，缺失回退空串 */
      /* 2.47：会话名后追加（备注）+ 定时闹钟（⏰）——两钩子各自缺失则回退空串 */
      const nm = document.createElement('span');
      /* 2.137（老板 2026-10-26 08:49 口径：「我网页版还看不到铃铛啊……有个叫延时的，
         我让他自我定时，我查得到他的定时消息，但是没显示铃铛」）——
         **恢复 ⏰ 铃铛**，并按**终身号**绑定显示：sKey＝稳定键(sid,title)＝4 位终身号，
         与定时任务库里的 `锚`（终身号）同口径，跨天/改名都不丢铃铛。
         2.135 撤下铃铛的口径就此作废（以本条为准）。 */
      nm.textContent = title
        + (window.备注后缀 ? 备注后缀(sKey) : '')
        + (window.闹钟后缀 ? 闹钟后缀(sKey) : '');
      nm.style.cssText = 'display:block;overflow:hidden;text-overflow:ellipsis';
      tspan.appendChild(nm);
      /* 2.134（老板 2026-10-25：「每个列表只要有自己的名称、加上原来那个忙闲灯就够了；
         第二行那些个人信息要传到网页版没错，但不需要展示；我就喜欢一行一个会话」）
         ——P15 加的第二行（SID · 忙/闲 · ⏰）整段撤下，不再渲染。
         注意：cfx（会话名/真实SID/状态灯四态/定时）仍然照收照存，只是不上屏；
         谁要用（备注、闹钟、诊断）继续从 cfx / 快照里取，别当成数据被删了。 */
      d.appendChild(tspan);
      const i = idx;
      /* 1.25：长按会话行（550ms）出菜单——重命名等会话操作 */
      let lpTimer = null, lpFired = false;
      const stopLP = () => {
        if (lpTimer){ clearTimeout(lpTimer); lpTimer = null; }
      };
      d.addEventListener('touchstart', () => {
        lpFired = false;
        lpTimer = setTimeout(() => {
          lpFired = true;
          convMenuOpen(title, sid, sKey);
        }, 550);
      }, {passive: true});
      d.addEventListener('touchmove', stopLP, {passive: true});
      d.addEventListener('touchend', stopLP);
      d.addEventListener('touchcancel', stopLP);
      d.onclick = () => {
        if (lpFired){ lpFired = false; return; }  // 长按后不放行切换
        if (!flag){
          /* 2.62：换会话先退出「历史全屏」。输入界面.js 1.20 注释早就写明
             「退出全屏只有两个途径：点『↓ 回到最新』、切换会话」，但此处
             从来没调 exitFmsg()。后果：用户上翻过历史（body.fmsg）再切会话
             时，消息渲染.js 的 inF 分支压过 pinBottom，把 scrollTop 原样还原
             成顶部的 0，并因 scrollTop<60 误触发「正在取回历史记录」。 */
          exitFmsg();
          /* 2.89（老板 2026-10-20）：先记「切换前的锚定」——作为「到达判定」的旧
             正文基线（sameConvBody 判目标正文是否已换）；2.98 起失败不再回退到此。 */
          const _prevAnchor = {sid: S.anchorSid, title: S.anchorTitle,
                               full: S.anchorFull};
          /* 2.98（老板 2026-10-20 09:43）：切走＝离开当前会话 ⇒ 立刻强制落盘一次
             当前会话的完整快照（下次回来能立刻顶出「离开前那一刻」，不看到更旧的）。 */
          if (typeof snapIdbTick === 'function'){ try { snapIdbTick(true); } catch(e){} }
          /* v1.95：优先按稳定 ID 切换（改名/重排不切错），无 ID 回退序号 */
          /* 2.18 锚定：用户主动点会话行 = 自己换锚点；此后网页版守着这个
             会话，别人在电脑版操作别的会话也不会把网页版带走。 */
          S.anchorSid = sKey || ''; S.anchorTitle = title || '';
          S.anchorFull = sid || '';    /* 完整 sid 兜底（switch/路由/占位卡用真 sid） */
          S.anchor_gone = '';          /* 本专项 A4：换锚点即清「已消失」提醒态 */
          anchorReport();              /* 2.74：T16——用户换锚点即上报（去重+≥300ms 节流） */
          /* 本专项 A7：锚点变化 → 列表选中态立即跟随（不等下一拍快照） */
          S.convs_key = null;
          renderConvs(S.snap.convs || [], S.snap.conv_unread,
                      S.snap.conv_unread_ids);
          /* 2.67：切换在途提示（分档状态机）；2.89：带「锁死目标 + 切换前锚定」*/
          pendSwitchSet(title, sid, sid || i,
                        {prevAnchor: _prevAnchor, lockTarget: true, deferRender: true});
          S.livePrefetch = false;      /* 2.67：新切换开始，撤销上一轮预取标记 */
          /* 2.130：本地最新完整存帧同步铺满（一次渲染，0ms）；状态栏不再出
             「正在切换到…/正在获取…快照」等待文案。 */
          snapIdbShow(sKey, title);
          /* 2.61：切会话后消息区钉底——正文（存帧/直播帧）真正上屏那次不再
             把中间态残留的 scrollTop=0 当「用户在翻历史」原样还原到顶部。
             标志在消息渲染.js 消费并清除。 */
          S.pinBottom = true;
          foxStop();                   /* 2.06：切到别的对话即停声（免打扰） */
          sendCmd('switch', sid || i);
          drawerClose();
        }
      };
      el.convs.appendChild(d);
      idx++;
    }
  }
}

/* 1.25：会话操作菜单（长按会话行弹出）。1.29 起含：重命名
   （conv_rename，右键菜单「重命名」→ 内联编辑）；置顶/取消置顶
   （conv_pin，TRAE 菜单为切换项，两文案自动适配）；删除
   （conv_del，本端 confirm 后服务端再点确认框「删除」）。 */
function convMenuOpen(title, sid, sKey){
  sid = sid || '';
  sKey = sKey || 稳定键(sid, title);   /* 备注/定时用稳定性键（终身号）；pin/del/rename 仍用完整 sid */
  const old = $('convmenu');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'convmenu';
  ov.innerHTML = '<div class="cmsheet">'
    + '<div class="cmtitle">' + esc(title) + '</div>'
    + '<button data-act="pin">📌 置顶 / 取消置顶</button>'
    + '<button data-act="ren">✎ 重命名</button>'
    + '<button data-act="del" style="color:var(--red)">🗑 删除此会话</button>'
    + '<button class="cmcancel" data-act="cancel">取消</button>'
    + '</div>';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.querySelectorAll('button').forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'cancel'){ ov.remove(); return; }
      if (act === 'pin'){
        ov.remove();
        /* 2.90：统一走 srvOpSend（未连 WS ⇒ ①且不发出；连上 ⇒ ②＋rcpt ③④）。 */
        srvOpSend('conv_pin', sid ? [sid, title] : title, '置顶/取消置顶');
        return;
      }
      if (act === 'del'){
        ov.remove();
        /* 2.110（老板 2026-10-20 20:04：「从网页版删不了，连个弹窗都没有」）：
           原用浏览器原生 confirm() 二次确认——移动端内置浏览器 / 部分 WebView 会
           【静默屏蔽】confirm（不弹框、直接返回 false），于是 `if(!confirm(...)) return`
           悄悄退出：既无确认框、也从不发 conv_del（实测坐实）。改为本端自绘确认层
           （同 2.87 重命名就地弹层做法）：开层即反馈，点「删除」才走 srvOpSend 四态。*/
        delConfirmOpen(title, sid);
        return;
      }
      ov.remove();
      /* 2.87：改「就地弹层」——不再用浏览器原生 prompt（移动端内置
         浏览器 / 部分 WebView 会静默屏蔽 prompt：既不弹框、流程还直接
         return，于是「点了重命名啥也没有、也没弹窗」）。开层即有反馈；
         提交后走四态：①未连 WS→「正在连接 WS…」②已发出→「等待服务器
         受理…」④会话名真被改成新名（快照对账）→「成功」；失败/超时如实。*/
      renameDlgOpen(title, sid);
    };
  });
  document.body.appendChild(ov);
  /* 2.40：追加两项网页端专享菜单——实现各在新 js 的钩子里，缺失则跳过，
     保证两个功能可整块摘除、本文件不膨胀。 */
  if (window.备注菜单项) 备注菜单项(sKey, title, ov);
  if (window.自我激活菜单项) 自我激活菜单项(sKey, title, ov);
}

/* ============ 2.87：重命名就地弹层 + 四态反馈 ============
   起因（老板 2026-10-19 22:34）：点「✎ 重命名」后「啥反馈也没有、也没弹窗」。
   断点＝本函数原来用浏览器原生 prompt()：移动端内置浏览器/部分 WebView 会
   【静默屏蔽】prompt（不弹框、直接返回 null），于是 `if (!nn) return` 悄悄
   退出——无弹窗、无提示。改为本端自绘弹层，任何时候都可见可交互；提交后
   四态：① 未连 WS→「正在连接 WS…」（srvOpSend 内置 srvNeedOnline，命令不发出）；
   ② 已发出→「等待服务器回应…」（srvOpSend，绑 S.onLine 真实信号）；
   ③ 服务器已受理/开始执行（2.90 起：rcpt accepted/running → srvOpAck）；
   ④ 会话名真被改成新名（快照对账）、或 rcpt done（成功）/ fail/ cmderr/超时→如实收口。*/
let 重命名在途 = null;
function renameDlgOpen(title, sid){
  const old = $('renmask');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'renmask';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;'
    + 'background:rgba(0,0,0,.45);display:flex;align-items:center;'
    + 'justify-content:center;';
  ov.innerHTML = '<div id="renbox" style="background:#fff;border-radius:12px;'
    + 'padding:16px;width:86%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.3);">'
    + '<div style="font-weight:bold;font-size:15px;margin-bottom:10px;">'
    + '✎ 重命名会话</div>'
    + '<input id="renin" autocomplete="off" autocapitalize="off" value="'
      + esc(title) + '" style="width:100%;box-sizing:border-box;padding:10px;'
      + 'font-size:15px;border:1px solid var(--bd,#ccc);border-radius:8px;">'
    + '<div id="renerr" style="color:var(--red,#c00);font-size:12px;'
      + 'min-height:16px;margin-top:4px;"></div>'
    + '<div style="display:flex;gap:8px;margin-top:6px;">'
    + '<button id="rencancel" style="flex:1;padding:10px;border:1px solid '
      + 'var(--bd,#ccc);border-radius:8px;background:#f6f6f6;">取消</button>'
    + '<button id="renok" style="flex:1;padding:10px;border:0;border-radius:8px;'
      + 'background:var(--blue,#1565c0);color:#fff;font-weight:bold;">确定</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  /* 开层即反馈——「点了没反馈」到此为止（此前 prompt 被屏蔽时连这句都没有）。 */
  flash('重命名「' + title + '」：输入新名称后点「确定」', 'var(--blue)');
  const inp = $('renin'), err = $('renerr');
  setTimeout(() => { try { inp.focus(); inp.select(); } catch(e){} }, 60);
  const close = () => ov.remove();
  $('rencancel').onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  const go = () => {
    const nn = (inp.value || '').trim();
    if (!nn){ err.textContent = '名称不能为空'; return; }
    if (nn === title){ close(); flash('名称未变，未发送', 'var(--blue)'); return; }
    if (srvNeedOnline('重命名')) return;            /* ①：未连 WS，命令不发出 */
    if (!srvOpSend('conv_rename', sid ? [sid, title, nn] : [title, nn],
                   '重命名', '「' + nn + '」')) return;   /* ②：已发出 */
    clearTimeout(重命名在途 && 重命名在途.timer);
    重命名在途 = {sid: sid || '', to: nn, timer: null};
    重命名在途.timer = setTimeout(() => {
      if (重命名在途 && 重命名在途.to === nn){
        重命名在途 = null;
        srvOpFlash('fail', '重命名', '超时未见结果，请刷新确认', 6000);
      }
    }, 30000);                                       /* 失败/超时如实（无信号不宣告成功） */
    close();
  };
  $('renok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); };
}
/* 2.87：快照对账——某会话行标题已变成目标新名 ⇒ 重命名成功（真实信号，非乐观宣告） */
function renameScanRows(rows){
  if (!重命名在途) return;
  const hit = (rows || []).some(r => r && r[0] === 'c'
    && (r[1] || '') === 重命名在途.to
    && (!重命名在途.sid || (r[4] || '') === 重命名在途.sid));
  if (hit){
    const nn = 重命名在途.to;
    clearTimeout(重命名在途.timer);
    重命名在途 = null;
    srvOpFlash('ok', '重命名', '已改为「' + nn + '」');
  }
}
/* 2.87：命令失败（cmderr）→ 如实收口（由 事件总线.js cmderr 分支转调） */
function renameFail(reason){
  if (!重命名在途) return;
  clearTimeout(重命名在途.timer);
  重命名在途 = null;
  srvOpFlash('fail', '重命名', String(reason || '').slice(0, 40));
}

/* ============ 2.110：删除会话就地确认层 + 四态反馈 ============
   起因（老板 2026-10-20 20:04）：「从网页版删不了，连个弹窗都没有」。
   断点＝本文件原用浏览器原生 confirm()：移动端内置浏览器 / 部分 WebView 会
   【静默屏蔽】confirm（不弹框、直接返回 false），于是 `if(!confirm(...)) return`
   悄悄退出——既无确认框、也从不发 conv_del。改为本端自绘确认层（同 2.87 重命名
   就地弹层），任何时候都可见可交互；点「删除」后走四态：① 未连 WS→「正在连接
   WS…」② 已发出→「等待服务器回应…」③ rcpt accepted/running「服务器已受理/开始
   执行…」④ rcpt done→「成功」/ fail→「失败（原因）」或超时「待确认」。*/
function delConfirmOpen(title, sid){
  const old = $('delmask');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'delmask';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;'
    + 'background:rgba(0,0,0,.45);display:flex;align-items:center;'
    + 'justify-content:center;';
  ov.innerHTML = '<div id="delbox" style="background:#fff;border-radius:12px;'
    + 'padding:16px;width:86%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.3);">'
    + '<div style="font-weight:bold;font-size:15px;margin-bottom:10px;">'
    + '🗑 删除会话</div>'
    + '<div style="font-size:14px;line-height:1.5;margin-bottom:12px;">'
    + '确认删除会话「' + esc(title) + '」？<br>删除后不可恢复。</div>'
    + '<div style="display:flex;gap:8px;">'
    + '<button id="delcancel" style="flex:1;padding:10px;border:1px solid '
      + 'var(--bd,#ccc);border-radius:8px;background:#f6f6f6;">取消</button>'
    + '<button id="delok" style="flex:1;padding:10px;border:0;border-radius:8px;'
      + 'background:var(--red,#c62828);color:#fff;font-weight:bold;">删除</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  /* 开层即反馈——「点了没反馈」到此为止（此前 confirm 被屏蔽时连这句都没有）。 */
  flash('删除会话「' + title + '」：点「删除」确认', 'var(--red)');
  const close = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) close(); };
  $('delcancel').onclick = close;
  $('delok').onclick = () => {
    close();
    /* 2.90：统一走 srvOpSend（未连 WS ⇒ ①且不发出；连上 ⇒ ②＋rcpt ③④）。 */
    srvOpSend('conv_del', sid ? [sid, title] : title, '删除会话');
  };
}

/* ============ 1.09：待确认项（空窗期反馈） ============
   点「发送」后要等服务端把文字注入 TRAE 输入框、点发送、TRAE 渲染、
   0.8s 轮询取快照、再经中继回传——实测 3~6s 才看得到自己那条。
   这段空白以前完全没有反馈，像「点了没反应 / 消息丢了」。
   现在：本地立即画一条「我」的占位气泡并标「发送中…」，服务端阶段
   事件（已输入→已发出）推进状态，快照里出现同文本用户消息即撤下。
   1.25：不再 15 秒标「⚠ 未确认」——插话走官方排队，AI 忙时多久
   入列都正常（无限制）；用户可随时手动「丢弃/改写」。 */

