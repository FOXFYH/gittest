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
  const key = rows.map(r => r.join('|')).join('#')
    + '#ur:' + Array.from(ur).sort().join('|')
    + '#uri:' + Array.from(uri).sort().join('|')
    /* 2.40：备注字典纳入指纹——备注变化也要触发重绘（钩子缺失回退空） */
    + '#note:' + (window.备注指纹 ? 备注指纹() : '')
    /* 2.47：定时任务指纹纳入去重——设/撤/推进定时也会重绘（钩子缺失回退空） */
    + '#sched:' + (window.定时指纹 ? 定时指纹() : '')
    /* 本专项 A7：锚点纳入指纹——锚点变化也要重画，选中态即时跟随锚定 */
    + '#a:' + (S.anchorSid || '');
  if (key === S.convs_key) return;
  S.convs_key = key;
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
        if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
        if (S.task_open) return;
        drawerClose();
        /* 1.11：统一新建弹窗（锁定模式）——创建才真正点组内新建 */
        taskDlgOpen(title);
        flash('在「' + title + '」内新建对话', 'var(--blue)');
      };
      d.appendChild(p);
      d.onclick = () => {              /* 1.09：折叠/展开也要有反馈 */
        flash('正在折叠/展开「' + title + '」…', 'var(--blue)');
        sendCmd('toggle_folder', title);
      };
      el.convs.appendChild(d);
      inFolder = true;
    } else {
      const d = document.createElement('div');
      /* 本专项 A7：列表选中态与锚定态同源——锚定 sid 优先，未锚定才用快照标志 */
      const isAct = S.anchorSid ? (sid === S.anchorSid) : !!flag;
      d.className = 'convo item' + (isAct ? ' act' : '');
      d.style.paddingLeft = inFolder ? '28px' : '14px';
      /* v1.49：对齐原版状态灯口径——只在这几种显示灯：
         run=蓝·脉动(进行中) fail=红 stop=灰；st=='done' 且「完成未查看」
         → 橙灯；done 已读 → 无灯（移除原绿点）。
         v1.95：未读优先按稳定 ID 命中（改名不丢灯），无 ID 回退标题。 */
      const uread = (st === 'done') &&
        (useId && sid ? uri.has(sid) : ur.has(title));
      if (st === 'run' || st === 'fail' || st === 'stop' || uread){
        const dot = document.createElement('span');
        dot.className = 'stdot ' + (uread ? 'stdot-uread' : 'stdot-' + st);
        d.appendChild(dot);
      }
      const tspan = document.createElement('span');
      /* 2.40：会话名后追加（备注）——钩子由 会话备注.js 提供，缺失回退空串 */
      /* 2.47：会话名后追加（备注）+ 定时闹钟（⏰）——两钩子各自缺失则回退空串 */
      tspan.textContent = title + (window.备注后缀 ? 备注后缀(sid) : '')
        + (window.闹钟后缀 ? 闹钟后缀(sid) : '');
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
          convMenuOpen(title, sid);
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
          /* v1.95：优先按稳定 ID 切换（改名/重排不切错），无 ID 回退序号 */
          /* 2.18 锚定：用户主动点会话行 = 自己换锚点；此后网页版守着这个
             会话，别人在电脑版操作别的会话也不会把网页版带走。 */
          S.anchorSid = sid || ''; S.anchorTitle = title || '';
          S.anchor_gone = '';          /* 本专项 A4：换锚点即清「已消失」提醒态 */
          /* 本专项 A7：锚点变化 → 列表选中态立即跟随（不等下一拍快照） */
          S.convs_key = null;
          renderConvs(S.snap.convs || [], S.snap.conv_unread,
                      S.snap.conv_unread_ids);
          pendSwitchSet(title, sid);   /* 1.09：切换在途提示（0.8~6s）*/
          snapIdbShow(sid, title);     /* 本专项 B2/B3：先铺本地存帧秒显 */
          /* 2.61：切会话后消息区钉底——正文（存帧/直播帧）真正上屏那次不再
             把中间态残留的 scrollTop=0 当「用户在翻历史」原样还原到顶部。
             标志在消息渲染.js 消费并清除。 */
          S.pinBottom = true;
          foxStop();                   /* 2.06：切到别的对话即停声（免打扰） */
          flash(switchTip(title), 'var(--blue)');
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
function convMenuOpen(title, sid){
  sid = sid || '';
  const old = $('convmenu');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'convmenu';
  ov.innerHTML = '<div class="cmsheet">'
    + '<div class="cmtitle">' + esc(title) + '</div>'
    + '<button data-act="pin">📌 置顶 / 取消置顶</button>'
    + '<button data-act="ren">✎ 重命名</button>'
    + '<button data-act="del" style="color:var(--red)">🗑 删除</button>'
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
        flash('正在切换置顶…', 'var(--blue)');
        /* v1.95：有稳定 ID 时送 [sid,title]（按 ID 定位，重名/改名不错位） */
        sendCmd('conv_pin', sid ? [sid, title] : title);
        return;
      }
      if (act === 'del'){
        ov.remove();
        if (!confirm('删除会话「' + title + '」？\n删除后不可恢复。')) return;
        flash('正在删除会话…', 'var(--blue)');
        sendCmd('conv_del', sid ? [sid, title] : title);
        return;
      }
      ov.remove();
      const nn = (prompt('重命名会话', title) || '').trim();
      if (!nn || nn === title) return;
      sendCmd('conv_rename', sid ? [sid, title, nn] : [title, nn]);
      flash('正在重命名为「' + nn + '」…', 'var(--blue)');
    };
  });
  document.body.appendChild(ov);
  /* 2.40：追加两项网页端专享菜单——实现各在新 js 的钩子里，缺失则跳过，
     保证两个功能可整块摘除、本文件不膨胀。 */
  if (window.备注菜单项) 备注菜单项(sid, title, ov);
  if (window.自我激活菜单项) 自我激活菜单项(sid, title, ov);
}

/* ============ 1.09：待确认项（空窗期反馈） ============
   点「发送」后要等服务端把文字注入 TRAE 输入框、点发送、TRAE 渲染、
   0.8s 轮询取快照、再经中继回传——实测 3~6s 才看得到自己那条。
   这段空白以前完全没有反馈，像「点了没反应 / 消息丢了」。
   现在：本地立即画一条「我」的占位气泡并标「发送中…」，服务端阶段
   事件（已输入→已发出）推进状态，快照里出现同文本用户消息即撤下。
   1.25：不再 15 秒标「⚠ 未确认」——插话走官方排队，AI 忙时多久
   入列都正常（无限制）；用户可随时手动「丢弃/改写」。 */

