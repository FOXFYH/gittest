'use strict';
/* 2.40：定时自我激活（网页端专享）——右键会话 → 填「间隔(分钟)/次数」→
   服务端到点借输入框投递（纯本地，不 WS 广播）。任务库在服务端，网页端
   只下发命令并渲染快照 snap['定时']（字段 {'id','sid','text','every','total',
   'done','next','created'}，every 单位秒）。
   命令口径（冻结协议）：sched_add [sid,text,every_min,total] /
   sched_del [jid] / sched_ls [sid] / sched_clear [sid] /
   sched_set [jid,text,every_min,total]（可选，本端暂不发起）。
   2.47：新增 闹钟后缀(sid)（会话名后显示「 ⏰」，多条带条数）+ 定时指纹()
   （任务列表稳定指纹，参与 会话列表.js 的 convs_key 去重），供会话行一眼
   看出哪些会话设了定时提醒。
   2.80：面板体验整改（用户 2026-10-19 口径：两个输入框含义不明、点了没反馈、
   取消不了）——① 两框加可见标签「① 间隔 / ② 次数 / ③ 发送内容」+ 实时换算
   说明（「＝ 每 N 分钟发一次，共 M 次」），placeholder 因有默认值不显示的问题
   一并解决；② 面板内新增**服务器确认状态行**（比 flash 持久）：点开始/取消先落
   「⏳ 等待服务器确认…」，随后盯服务端权威快照 S.定时 对账（新任务出现=定时生效 /
   目标任务消失=取消成功），5 秒内无变化即提示「⚠ 未确认，请点刷新」；③ 逐条
   「取消定时」去二次确认（旧版「取消定时→弹确定/取消」的「取消」易被误点成放弃，
   用户直呼「取消不了」），直接下发 sched_del 并以状态行反馈。
   依赖：S、sendCmd、flash、$，以及 任务与输入.js 的 bsOpen/bsClose/bsBtn。 */

const 自激活_默认文本 = '（定时自我激活：请继续。）';

/* 2.80：面板内「服务器确认」状态——点开始/取消后先在面板落一行可见状态
   「⏳ 等待服务器确认…」，随后盯服务端权威快照 S.定时 对账：
   新任务出现＝定时成功；目标任务消失＝取消成功；5 秒内仍无变化即提示未确认。
   状态行常驻到下一次操作（比 flash 持久）。kind ∈ 'add'|'del'|'clear'。 */
let 自激活_待确认 = null;

function 自激活_状态行(st, msg, color){
  if (!st) return;
  st.textContent = msg || '';
  st.style.color = color || '#666';
}

function 定时入快照(snap){
  /* 快照到达：把定时任务列表落到全局，供右键菜单/面板读取；
     若自我激活面板正开着，就地刷新其列表，并对账「服务器确认」状态行。
     2.79：**仅当快照确实带「定时」字段才覆盖 S.定时**——命令路径 / 初连等快照
     可能不带该字段，旧实现会当成空把它清掉 → 会话行 ⏰ 角标被误清（铃铛时有时无）。
     服务端 命令路由 0.14 起已在快照广播前统一补注入该字段（双保险）。 */
  if (snap && Object.prototype.hasOwnProperty.call(snap, '定时')){
    const l = snap['定时'];
    S.定时 = Array.isArray(l) ? l : [];
  }
  自我激活刷新();
  自激活_对账();
  return S.定时;
}

function 定时取(sid){
  /* 2026-10-16（用户口径：定时改终身号）：sid 现为稳定性键（终身号）——
     任务库存的是「锚」（终身号/会话名），跨天 SID 变了也能匹配；同时兼容
     按完整 sid 传参（任务字段 sid 为创建那一刻的完整 SID）。 */
  if (!sid) return [];
  return (S.定时 || []).filter(t => t && (t.sid === sid || (t['锚'] || '') === sid));
}

function 定时指纹(){
  /* 2.47：定时任务列表的稳定指纹——参与 会话列表.js convs_key 去重，
     任务增删与推进（done/total）都能触发重绘；顺序变化不误触发。
     2026-10-16：键改用稳定锚（终身号），避免完整 SID 每日变导致指纹漂移。 */
  return (S.定时 || []).map(t => (t && (t['锚'] || t.sid) || '') + ':' + (t && t.id || '')
      + ':' + (t && t.done || 0) + '/' + (t && t.total || 0)).sort().join('|');
}

function 闹钟后缀(sid){
  /* 2.47：该会话有定时自我激活任务时返回「 ⏰」（多条带条数）——供
     会话列表.js renderConvs 在会话名后追加，一眼看出谁设了定时提醒。
     数据源：快照 snap['定时']（全局全部会话的任务，见 定时入快照）。 */
  const n = 定时取(sid).length;
  return n ? (' ⏰' + (n > 1 ? String(n) : '')) : '';
}

function 自激活_时刻(n){
  /* next/created 自适配秒/毫秒（服务端 3.0 口径为秒），无法解析返回空。 */
  n = Number(n) || 0;
  if (!n) return '';
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

function 自激活_面板(sid, title){
  if (!sid){ flash('该会话无稳定 ID，暂不支持定时自我激活', 'var(--red)'); return; }
  if (typeof bsOpen !== 'function'){ flash('面板组件未就绪，请刷新后重试', 'var(--red)'); return; }
  自激活_放弃确认();                    /* 2.80：重开面板即作废旧确认等待 */
  const box = bsOpen('⏰ 定时自我激活 · ' + title);

  /* —— 新建：间隔（分钟）/ 次数 / 文本 —— */
  const mkLabel = txt => {               /* 2.80：可见小标签（旧版占位符因有默认值
                                           不显示，用户只看到裸的 5、3，含义不明） */
    const l = document.createElement('div');
    l.className = 'bs_msg';
    l.style.cssText = 'padding:10px 18px 0;font-size:13px;color:#666';
    l.textContent = txt;
    box.appendChild(l);
  };
  const hint = document.createElement('div');
  hint.className = 'bs_msg';
  hint.textContent = '到点由电脑端临时借输入框发送，纯本地、不广播；'
    + '过期不补发、顺延。';
  box.appendChild(hint);
  const mkIn = (type, val, ph) => {
    const i = document.createElement('input');
    i.className = 'bs_in'; i.type = type;
    if (val !== undefined) i.value = val;
    if (ph) i.placeholder = ph;
    box.appendChild(i);
    return i;
  };
  mkLabel('① 间隔：几分钟发一次');
  const inMin = mkIn('number', '5', '间隔（分钟，≥1）');
  mkLabel('② 次数：一共发几次');
  const inTotal = mkIn('number', '3', '次数（≥1）');

  /* 2.80：实时换算说明——随两框改动即时更新，一眼看懂参数含义 */
  const live = document.createElement('div');
  live.className = 'bs_msg';
  live.style.cssText = 'padding:2px 18px 0;font-size:13px;color:var(--blue)';
  const syncLive = () => {
    const min = Math.max(1, parseInt(inMin.value, 10) || 1);
    const total = Math.max(1, parseInt(inTotal.value, 10) || 1);
    live.textContent = '＝ 每 ' + min + ' 分钟发一次，共 ' + total + ' 次';
  };
  inMin.addEventListener('input', syncLive);
  inTotal.addEventListener('input', syncLive);
  syncLive();
  box.appendChild(live);

  mkLabel('③ 发送内容：到点发这句话（可留默认）');
  const inText = mkIn('text', 自激活_默认文本, '发送文本');
  const goBtns = document.createElement('div');
  goBtns.className = 'bs_btns';
  goBtns.appendChild(bsBtn('取消', '', () => { 自激活_放弃确认(); bsClose(); }));
  goBtns.appendChild(bsBtn('＋ 开始定时', 'primary', () => {
    if (srvNeedOnline('定时')) return;
    const min = Math.max(1, parseInt(inMin.value, 10) || 1);
    const total = Math.max(1, parseInt(inTotal.value, 10) || 1);
    const text = (inText.value || '').trim() || 自激活_默认文本;
    const ids = new Set(定时取(sid).map(t => t && t.id));
    sendCmd('sched_add', [sid, text, min, total]);
    /* 2.85：② 已下发、等服务端确认；成功只由快照对账推进，绝不先报绿 */
    srvOpFlash('sent', '下发定时', '每 ' + min + ' 分钟 × ' + total + ' 次');
    自激活_下发确认({kind:'add', sid, ids, desc:'每 ' + min + ' 分钟 × ' + total + ' 次'});
  }));
  box.appendChild(goBtns);

  /* 2.80：服务器确认状态行——比 flash 持久，常驻到下一次操作 */
  const stat = document.createElement('div');
  stat.id = 'sched_stat';
  stat.className = 'bs_msg';
  stat.style.cssText = 'padding:4px 18px 0;font-size:14px;min-height:22px;color:#666';
  stat.textContent = '　';
  box.appendChild(stat);

  /* —— 已有任务：查看 / 删除 —— */
  const hd = document.createElement('div');
  hd.className = 'bs_msg';
  hd.textContent = '已有任务（本会话）';
  box.appendChild(hd);
  const list = document.createElement('div');
  list.id = 'sched_list';
  list.dataset.sid = sid;
  box.appendChild(list);
  自激活_渲染列表(list, sid);

  const tail = document.createElement('div');
  tail.className = 'bs_btns';
  tail.appendChild(bsBtn('🔄 刷新', '', () => {
    if (srvNeedOnline('刷新定时')) return;
    sendCmd('sched_ls', sid);
    自激活_状态行($('sched_stat'), srvOpText('sent', '刷新定时'),
                  SRV_PHASE.sent[1]);
    flash(srvOpText('sent', '刷新定时'), SRV_PHASE.sent[1]);
  }));
  tail.appendChild(bsBtn('🗑 取消本会话全部定时', 'danger', () => {
    if (!confirm('清空本会话的全部定时自我激活任务？')) return;
    if (srvNeedOnline('取消定时')) return;
    sendCmd('sched_clear', sid);
    srvOpFlash('sent', '清空定时');          // 2.85：② 等待服务器回应
    自激活_下发确认({kind:'clear', sid, desc:'本会话全部定时'});
  }));
  box.appendChild(tail);
}

function 自激活_放弃确认(){
  /* 2.80：撤销进行中的确认等待（清定时器），供重开面板/关闭时调用。 */
  if (自激活_待确认 && 自激活_待确认.timer) clearTimeout(自激活_待确认.timer);
  自激活_待确认 = null;
}

function 自激活_下发确认(p){
  /* 2.80：下发后立刻在面板落「等待服务器确认」状态行，并武装 5 秒兜底；
     真正的成功/失败由 自激活_对账（快照到达时）判定。
     2.85：文案统一走四态——②「等待服务器回应…」（此处）；
     ④「成功」只由对账按服务端权威快照推进，绝不本地先报。 */
  自激活_放弃确认();
  p.timer = setTimeout(() => {
    if (自激活_待确认 !== p) return;
    自激活_状态行($('sched_stat'),
      srvOpText('fail', null, '5 秒内服务器未确认，请点「🔄 刷新」重试'),
      SRV_PHASE.fail[1]);
    自激活_待确认 = null;
  }, 5000);
  自激活_待确认 = p;
  const 标签 = p.kind === 'clear' ? '清空定时'
             : (p.kind === 'del' ? '取消定时' : '下发定时');
  自激活_状态行($('sched_stat'),
    srvOpText('sent', 标签, p.desc || ''), SRV_PHASE.sent[1]);
}

function 自激活_对账(){
  /* 2.80：快照到达时对账「服务器确认」——以服务端权威列表 S.定时 为准。
     成功＝新任务出现 / 目标任务消失；仍在等则原样保留、不误判。
     2.85：④「成功」信号只此来自服务端快照（真实信号），绝不本地乐观宣告。 */
  const p = 自激活_待确认;
  if (!p) return;
  const rows = 定时取(p.sid);
  const st = $('sched_stat');
  if (p.kind === 'add'){
    const 新 = rows.find(t => t && t.id && !p.ids.has(t.id));
    if (!新) return;                          /* 尚未出现，继续等 */
    const nx = 自激活_时刻(新.next);
    自激活_状态行(st, '✅ 定时已生效：' + (p.desc || '')
      + (nx ? ' ｜ 下次 ' + nx : ''), SRV_PHASE.ok[1]);
  } else if (p.kind === 'del'){
    if (rows.some(t => t && t.id === p.jid)) return;   /* 还在，继续等 */
    自激活_状态行(st, '✅ 已取消该定时任务', SRV_PHASE.ok[1]);
  } else if (p.kind === 'clear'){
    if (rows.length) return;
    自激活_状态行(st, '✅ 已取消本会话全部定时', SRV_PHASE.ok[1]);
  }
  自激活_放弃确认();
}

function 自激活_渲染列表(list, sid){
  /* 从本地快照 S.定时 渲染；命令下发后等下一拍快照自动刷新。
     若面板仍开着，下次快照到达时可再调本函数（见 自我激活刷新）。 */
  const rows = 定时取(sid);
  list.innerHTML = '';
  if (!rows.length){
    const e = document.createElement('div');
    e.className = 'bs_msg'; e.textContent = '（暂无）';
    list.appendChild(e);
    return;
  }
  rows.forEach(t => {
    const row = document.createElement('div');
    row.className = 'bs_it';
    const ic = document.createElement('span');
    ic.className = 'ic'; ic.textContent = '⏰';
    const tx = document.createElement('span');
    const tj = t.text ? String(t.text).slice(0, 30) : '（默认文本）';
    const ev = Math.round((Number(t.every) || 0) / 6) / 10;   // 秒 → 分钟(1位)
    const nx = 自激活_时刻(t.next);
    tx.textContent = tj + '  · 每 ' + ev + ' 分钟 · 已发 '
      + (t.done || 0) + '/' + (t.total || 0) + (nx ? ' · 下次 ' + nx : '');
    const del = document.createElement('span');
    del.textContent = '取消定时'; del.style.cssText = 'margin-left:auto;color:#c62828';
    del.onclick = e => {
      e.stopPropagation();
      if (srvNeedOnline('取消定时')) return;
      /* 2.80：去二次确认——旧版「取消定时→弹确定/取消」的「取消」按钮易被误点成
         放弃，用户直呼「取消不了」；现直接下发 sched_del，成败看面板状态行。 */
      sendCmd('sched_del', t.id);
      srvOpFlash('sent', '取消定时');      // 2.85：② 等待服务器回应
      自激活_下发确认({kind:'del', sid, jid: t.id});
    };
    row.appendChild(ic); row.appendChild(tx); row.appendChild(del);
    list.appendChild(row);
  });
}

function 自我激活刷新(){
  /* 快照更新后，若自我激活面板正开着，就地重绘列表（保持输入框内容）。 */
  const list = $('sched_list');
  if (!list) return;
  const sheet = list.closest('#bs_sheet');
  if (sheet && !sheet.classList.contains('on')) return;   // 面板已收起，不必刷
  const sid = list.dataset.sid || '';
  if (sid) 自激活_渲染列表(list, sid);
}

function 自我激活菜单项(sid, title, ov){
  /* 在会话右键菜单尾部（取消按钮之前）插入「⏰ 定时自我激活」，
     文案带本会话现有任务数。由 会话列表.js convMenuOpen 调用。 */
  const sheet = ov.querySelector('.cmsheet');
  if (!sheet) return;
  const n = 定时取(sid).length;
  const b = document.createElement('button');
  b.dataset.act = 'sched';
  b.textContent = '⏰ 定时自我激活' + (n ? '（' + n + '）' : '');
  const cancel = sheet.querySelector('.cmcancel');
  sheet.insertBefore(b, cancel || null);
  b.onclick = e => {
    e.stopPropagation();
    ov.remove();
    自激活_面板(sid, title);
  };
}