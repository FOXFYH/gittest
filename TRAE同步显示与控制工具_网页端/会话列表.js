'use strict';
function drawerOpen(){
  el.drawer.classList.add('on'); el.mask.classList.add('on');
}
function drawerClose(){ el.drawer.classList.remove('on'); el.mask.classList.remove('on'); }

/* 2026-11-14（老板：点一个会话，全部橙灯先灭再全亮＝假消除）：
   命令路径推来的「裸快照」不带 convs_full / conv_unread，若按空集合渲染，
   所有橙灯会被误灭，下一拍正常快照又全亮。裸帧一律沿用上一次的未读集合。 */
var _cvUnreadMemo = null;      /* {k, titles, ids}：上一份带未读数据的帧 */
/* 2.200（2026-11-19 WB+TR 整改·子-会话列表固态化·计划书§三「本地固态化优先/
   永远可操作」）：列表改「按 sid 增量复用节点」——不再 innerHTML='' 整表重画。
   配合 通用工具.js _convsSolidGuard（空帧/骤减不落地），切会话/服务端空帧时
   上一份列表原地保留；列表项节点建好即复用（只更新文本/类名/dataset，不销毁），
   任何时候都可点。顶部「服务器暂时读不到会话列表，以下为本地缓存」提示由
   S.convs_stale_hint 控制，列表照旧显示可点；白屏文案整段删除。 */
var _cvNodeMap = {};          /* key（'c|s:sid' / 'c|t:标题' / 'f|标题'）→ 已建节点 */
var _cvHintEl = null;         /* 顶部缓存提示行（常驻复用，不反复新建） */
var _cvServerKey = null;      /* 当前服务器键（cur|port，换服才清旧节点） */
function _cvKeyOf(kind, title, sid){
  return kind === 'f' ? ('f|' + title)
    : ('c|' + (sid ? ('s:' + sid) : ('t:' + title)));
}
/* 会话行节点：结构固定（灯 span + 名称 span），复用后只改内容/类名/dataset，
   不销毁重建 */
function _cvBuildItem(){
  const d = document.createElement('div');
  d.className = 'convo item';
  const dot = document.createElement('span');
  dot.className = 'stdot';
  dot.style.display = 'none';
  d.appendChild(dot);
  const tspan = document.createElement('span');
  /* 2.218：整行不再挂时间 span；名称/备注/定时完整可见——文本允许自然换行，
     不再用省略号截断（行内衬与行距沿用 .convo 原样式）。 */
  tspan.style.cssText = 'flex:1;min-width:0;white-space:normal;overflow:visible;';
  const nm = document.createElement('span');
  nm.style.cssText = 'display:block;white-space:normal;overflow-wrap:anywhere;';
  tspan.appendChild(nm);
  d.appendChild(tspan);
  /* 1.25：长按会话行（550ms）出菜单——读 dataset，节点复用不串台 */
  let lpTimer = null, lpFired = false;
  const stopLP = () => { if (lpTimer){ clearTimeout(lpTimer); lpTimer = null; } };
  d.addEventListener('touchstart', () => {
    lpFired = false;
    lpTimer = setTimeout(() => {
      lpFired = true;
      convMenuOpen(d.dataset.title || '', d.dataset.sid || '', d.dataset.skey || '');
    }, 550);
  }, {passive: true});
  d.addEventListener('touchmove', stopLP, {passive: true});
  d.addEventListener('touchend', stopLP);
  d.addEventListener('touchcancel', stopLP);
  d.onclick = () => {
    if (lpFired){ lpFired = false; return; }  // 长按后不放行切换
    _convItemSwitch(d);
  };
  d._cvDot = dot; d._cvNm = nm; d._cvKind = 'c';
  return d;
}
/* 2.221（老板 2026-11-20 16:31：「备注怎么都不显示了，定时状态，甚至状态灯的
   响应都慢了些」）：备注字典（会话备注.py 全部()）与定时任务锚（定时自我激活.py）
   历史上都按 **4 位权威终身号** 存（实测盘上：{"0019":"夸机 资源","0047":…}），
   2.211「禁止切片」后 `稳定键()` 只返回会话名 ⇒ 按 sKey 查备注/¬闹钟一律落空
   → 备注与 ⏰ 整列消失。这里只读服务端下发的权威 uid（convs_full.uid /
   sig 帧 uid / S.convUids），再按「权威终身号 → 稳定键 → 完整 sid → 会话名」
   逐个试，第一个命中的即用；**绝不自行切片推导终身号**。
   顺带：新建备注/定时也按同一权威键写入（keys 顺序第一），读写同源不再分身。 */
function _cvUidOf(sid, title, cfx){
  let u = '';
  try {
    u = String((cfx && cfx.uid) || '');
    if (!u && S.convUids){
      u = String(S.convUids[String(sid || '')] || S.convUids[String(title || '')] || '');
    }
  } catch(e){ u = ''; }
  return (u && typeof lbUidAny === 'function') ? (lbUidAny(u) || '') : u;
}
function _cvAliasKeys(sKey, sid, title, uid){
  const a = [];
  [uid, sKey, sid, title].forEach(k => {
    k = String(k == null ? '' : k);
    if (k && a.indexOf(k) < 0) a.push(k);
  });
  return a;
}
/* 备注后缀 + 闹钟后缀：按别名顺序取第一个非空（不叠加、不重复查） */
function _cvNoteSched(sKey, sid, title, uid){
  const al = _cvAliasKeys(sKey, sid, title, uid);
  let note = '', sched = '';
  for (let i = 0; i < al.length; i++){
    if (!note && typeof window.备注后缀 === 'function'){
      try { note = String(备注后缀(al[i]) || ''); } catch(e){}
    }
    if (!sched && typeof window.闹钟后缀 === 'function'){
      try { sched = String(闹钟后缀(al[i]) || ''); } catch(e){}
    }
    if (note && sched) break;
  }
  return note + sched;
}
/* 文件夹组头节点：结构固定（名称 span + ➕ span） */
function _cvBuildFolder(){
  const d = document.createElement('div');
  d.className = 'convo folder';
  const nm = document.createElement('span');
  nm.className = 'fname';
  d.appendChild(nm);
  /* 1.06：组头 ➕ —— 在该文件夹工作区内新建对话 */
  const p = document.createElement('span');
  p.className = 'fplus';
  p.textContent = '➕';
  p.title = '在此文件夹内新建对话（隶属文件夹工作区）';
  p.onclick = e => {
    e.stopPropagation();
    const title = d.dataset.title || '';
    if (srvNeedOnline('新建对话')) return;
    if (S.task_open) return;
    drawerClose();
    /* 1.11：统一新建弹窗（锁定模式）——创建才真正点组内新建 */
    taskDlgOpen(title);
    flash('在「' + title + '」内新建对话', 'var(--blue)');
  };
  d.appendChild(p);
  d.onclick = () => {              /* 1.09：折叠/展开也要有反馈 */
    const title = d.dataset.title || '';
    srvOpSend('toggle_folder', title, '折叠/展开', '「' + title + '」');
  };
  d._cvNm = nm; d._cvKind = 'f';
  return d;
}
/* 点会话＝切换（原 renderConvs 内 onclick 全文搬出，改成读 dataset，
   节点复用时永远拿最新的 title/sid/skey/idx）。 */
function _convItemSwitch(d){
  const title = d.dataset.title || '', sid = d.dataset.sid || '';
  const sKey = d.dataset.skey || '';
  const i = parseInt(d.dataset.idx || '0', 10) || 0;
  /* 2.62：换会话先退出「历史全屏」 */
  exitFmsg();
  /* 2.89：先记「切换前的锚定」——作为「到达判定」的旧正文基线 */
  const _prevAnchor = {sid: S.anchorSid, title: S.anchorTitle,
                       full: S.anchorFull};
  /* 2.98：切走＝离开当前会话 ⇒ 立刻强制落盘一次当前会话的完整快照 */
  if (typeof snapIdbTick === 'function'){ try { snapIdbTick(true); } catch(e){} }
  /* 2.18 锚定：用户主动点会话行 = 自己换锚点 */
  S.anchorSid = sKey || ''; S.anchorTitle = title || '';
  S.anchorFull = sid || '';
  /* 2.203：2.179「末次点击意图」S.pendIntent 已随「不一致提醒」一并撤除
     （老板 2026-11-19 22:02：选中不一致不再提醒，1 号静默自愈 / 非 1 号不管）。 */
  S.anchor_gone = '';          /* A4：换锚点即清「已消失」提醒态 */
  anchorReport();              /* 2.74：T16——用户换锚点即上报 */
  /* A7：锚点变化 → 列表选中态立即跟随（不等下一拍快照） */
  S.convs_key = null;
  renderConvs(S.snap.convs || [], S.snap.conv_unread,
              S.snap.conv_unread_ids);
  /* 2.67：切换在途提示；2.89：带「锁死目标 + 切换前锚定」*/
  pendSwitchSet(title, sid, sid || i,
                {prevAnchor: _prevAnchor, lockTarget: true, deferRender: true});
  S.livePrefetch = false;
  /* 2.130：本地最新完整存帧同步铺满（一次渲染，0ms） */
  snapIdbShow(sKey, title);
  /* 2.61：切会话后消息区钉底 */
  S.pinBottom = true;
  foxStop();                   /* 2.06：切到别的对话即停声（免打扰） */
  sendCmd('switch', sid || i);
  /* 账本V1.0（C3/I1）：切换请求携全模块版本编码 */
  try { if (window.ledgerVcheckSend) ledgerVcheckSend('switch', sid || ''); } catch(e){}
  drawerClose();
}
function renderConvs(rows, conv_unread, conv_unread_ids){
  const _cf0 = (S.snap && Array.isArray(S.snap.convs_full)) ? S.snap.convs_full : null;
  const _hasUnread = Array.isArray(conv_unread) || Array.isArray(conv_unread_ids);
  const _mk = String(S.cur || '') + '|' + String(S.port || '');
  if (!_cf0 && !_hasUnread && _cvUnreadMemo && _cvUnreadMemo.k === _mk){
    conv_unread = _cvUnreadMemo.titles;
    conv_unread_ids = _cvUnreadMemo.ids || undefined;
  } else if (_cf0 || _hasUnread){
    _cvUnreadMemo = {k: _mk,
                     titles: Array.isArray(conv_unread) ? conv_unread.slice() : [],
                     ids: Array.isArray(conv_unread_ids) ? conv_unread_ids.slice() : null};
  }
  const ur = new Set(Array.isArray(conv_unread) ? conv_unread : []);
  const useId = Array.isArray(conv_unread_ids);
  const uri = new Set(useId ? conv_unread_ids : []);
  const cfRows = (S.snap && Array.isArray(S.snap.convs_full))
    ? S.snap.convs_full : null;
  /* 2.221：指纹只收「影响显示」的字段——sid / 灯态 / 未读。
     不再收 schedule.next_at（定时每次到点必变的时间串）：它一变就整表重画，
     而列表根本不显示时间；定时状态由下方 #sched 指纹（⏰ 条数/轮次）负责。 */
  const cfKey = cfRows ? cfRows.map(o => (o && o.sid || '') + ':'
      + (o && o.status && o.status.light || '') + ':'
      + (o && o.status && o.status.unread ? '1' : '')).sort().join('|') : '';
  const key = rows.map(r => r.join('|')).join('#')
    + '#ur:' + Array.from(ur).sort().join('|')
    + '#uri:' + Array.from(uri).sort().join('|')
    + '#cf:' + cfKey
    + '#note:' + (window.备注指纹 ? 备注指纹() : '')
    + '#sched:' + (window.定时指纹 ? 定时指纹() : '')
    + '#a:' + (S.anchorSid || '')
    /* 2.200：缓存提示显隐也参与指纹 */
    + '#stale:' + (S.convs_stale_hint ? 1 : 0);
  if (key === S.convs_key) return;
  S.convs_key = key;
  /* 2.87：重命名完成对账 */
  renameScanRows(rows);
  /* 换服务器才清旧节点（同一服务器重连/切会话一律不动旧列表，绝不白屏） */
  const _sk = String(S.cur || '') + '|' + String(S.port || '');
  if (_cvServerKey !== _sk){
    _cvServerKey = _sk;
    Object.keys(_cvNodeMap).forEach(k => {
      const n = _cvNodeMap[k];
      if (n && n.parentNode) n.parentNode.removeChild(n);
      delete _cvNodeMap[k];
    });
    if (_cvHintEl && _cvHintEl.parentNode) _cvHintEl.parentNode.removeChild(_cvHintEl);
    _cvHintEl = null;
  }
  /* 顶部「本地缓存」提示：仅连续多拍读不到列表时出现（列表照旧显示可点） */
  if (S.convs_stale_hint && rows.length){
    if (!_cvHintEl){
      _cvHintEl = document.createElement('div');
      _cvHintEl.className = 'convo cv-hint';
      _cvHintEl.style.cssText = 'color:var(--gray,#8a98a6);font-size:12px;text-align:center;padding:8px 10px;';
      _cvHintEl.textContent = '服务器暂时读不到会话列表，以下为本地缓存';
    }
    if (el.convs.firstChild !== _cvHintEl) el.convs.insertBefore(_cvHintEl, el.convs.firstChild);
  } else if (_cvHintEl && _cvHintEl.parentNode){
    _cvHintEl.parentNode.removeChild(_cvHintEl);
  }
  /* 2.218：撤掉 2.217 的「最近时间」与按时间倒序——顺序完全沿用服务端 rows
     原序（含文件夹组头与组内会话），行内不再出现任何时间。 */
  let inFolder = false;
  const _order = [], _used = {};
  /* 1.31：按位取值（兼容旧 3 元组）——r[3]=状态灯 run/done/fail/stop/''
     v1.95：r[4]=会话稳定 ID（缺失则回退标题锚定）
     2.218：dataset.idx 恢复为服务端原始序号（无 sid 时切换回退用原始位置）。 */
  for (let _i = 0; _i < rows.length; _i++){
    const r = rows[_i] || [];
    const kind = r[0], title = r[1] || '', flag = r[2], st = r[3] || '';
    const sid = r[4] || '';
    const ck = _cvKeyOf(kind, title, sid);
    let d = _cvNodeMap[ck];
    if (kind === 'f'){
      if (!d || d._cvKind !== 'f'){ d = _cvBuildFolder(); _cvNodeMap[ck] = d; }
      d.dataset.title = title;
      d._cvNm.textContent = (flag ? '▸ ' : '▾ ') + title;
      inFolder = true;
    } else {
      if (!d || d._cvKind !== 'c'){ d = _cvBuildItem(); _cvNodeMap[ck] = d; }
      /* 2026-10-16：稳定性键＝终身号；列表选中态与锚定态同源 */
      const sKey = 稳定键(sid, title);
      const isAct = S.anchorSid ? (sKey === S.anchorSid) : !!flag;
      /* P15：四字段优先（状态灯/定时/真 SID） */
      const cfx = cfRows ? cfRows.find(o => o && (
        (sid && o.sid === sid) || (sKey && o.stable === sKey))) : null;
      const light = cfx && cfx.status ? (cfx.status.light || '') : '';
      const uread = cfx ? !!(cfx.status && cfx.status.unread)
        : (useId && sid ? uri.has(sid) : ur.has(title));
      const dotCls = cfx
        ? (light === 'busy' ? 'stdot-run'
          : light === 'fail' ? 'stdot-fail'
          : light === 'stop' ? 'stdot-stop'
          : light === 'unread' ? 'stdot-uread' : '')
        : (st === 'run' ? 'stdot-run' : st === 'fail' ? 'stdot-fail'
          : st === 'stop' ? 'stdot-stop' : uread ? 'stdot-uread' : '');
      d.className = 'convo item' + (isAct ? ' act' : '');
      d.style.paddingLeft = inFolder ? '28px' : '14px';
      d.dataset.title = title; d.dataset.sid = sid; d.dataset.skey = sKey;
      d.dataset.idx = String(_i);
      if (dotCls){ d._cvDot.className = 'stdot ' + dotCls; d._cvDot.style.display = ''; }
      else { d._cvDot.className = 'stdot'; d._cvDot.style.display = 'none'; }
      /* 2.40/2.47/2.137 + 2.221：会话名 + 备注后缀 + 定时铃铛。
         备注/定时历史上按 4 位权威终身号存，故不能只拿 sKey（会话名）查——
         先由服务端 uid 起头，逐个别名试（见 _cvNoteSched）。 */
      const uid = _cvUidOf(sid, title, cfx);
      if (uid) d.dataset.uid = uid; else delete d.dataset.uid;
      d._cvNm.textContent = title + _cvNoteSched(sKey, sid, title, uid);
    }
    _used[ck] = true;
    _order.push(d);
  }
  /* 按本次顺序就地重排（appendChild 只移动节点，不销毁重建） */
  for (const d of _order) el.convs.appendChild(d);
  /* 真实删除才摘节点；空帧一律不动（数据层已拦，双保险：永远不清空） */
  if (rows.length){
    Object.keys(_cvNodeMap).forEach(k => {
      if (!_used[k]){
        const n = _cvNodeMap[k];
        if (n && n.parentNode) n.parentNode.removeChild(n);
        delete _cvNodeMap[k];
      }
    });
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
  /* 2.221：备注/定时一律按「权威终身号优先」的同一把键读写——读的时候
     _cvNoteSched 会依次试 uid/名称/sid，写的时候也落 uid，避免新旧数据分身。 */
  let _cfm = null;
  try {
    _cfm = (S.snap && Array.isArray(S.snap.convs_full))
      ? (S.snap.convs_full.find(o => o && ((sid && o.sid === sid)
          || (sKey && o.stable === sKey))) || null) : null;
  } catch(e){ _cfm = null; }
  const _wKey = _cvUidOf(sid, title, _cfm) || sKey;
  if (window.备注菜单项) 备注菜单项(_wKey, title, ov);
  if (window.自我激活菜单项) 自我激活菜单项(_wKey, title, ov);
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

