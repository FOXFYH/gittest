'use strict';
/* 2.40：定时自我激活（网页端专享）——右键会话 → 填「间隔(分钟)/次数」→
   服务端到点借输入框投递（纯本地，不 WS 广播）。任务库在服务端，网页端
   只下发命令并渲染快照 snap['定时']（字段 {'id','sid','text','every','total',
   'done','next','created'}，every 单位秒）。
   命令口径（冻结协议）：sched_add [sid,text,every_min,total] /
   sched_del [jid] / sched_ls [sid] / sched_clear [sid] /
   sched_set [jid,text,every_min,total]（可选，本端暂不发起）。
   依赖：S、sendCmd、flash、$，以及 长椅任务.js 的 bsOpen/bsClose/bsBtn。 */

const 自激活_默认文本 = '（定时自我激活：请继续。）';

function 定时入快照(snap){
  /* 快照到达：把定时任务列表落到全局，供右键菜单/面板读取；
     若自我激活面板正开着，就地刷新其列表。 */
  const l = snap && snap['定时'];
  S.定时 = Array.isArray(l) ? l : [];
  自我激活刷新();
  return S.定时;
}

function 定时取(sid){
  if (!sid) return [];
  return (S.定时 || []).filter(t => t && t.sid === sid);
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
  const box = bsOpen('⏰ 定时自我激活 · ' + title);

  /* —— 新建：间隔（分钟）/ 次数 / 文本 —— */
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
  const inMin = mkIn('number', '5', '间隔（分钟，≥1）');
  const inTotal = mkIn('number', '3', '次数（≥1）');
  const inText = mkIn('text', 自激活_默认文本, '发送文本');
  const goBtns = document.createElement('div');
  goBtns.className = 'bs_btns';
  goBtns.appendChild(bsBtn('取消', '', bsClose));
  goBtns.appendChild(bsBtn('＋ 开始定时', 'primary', () => {
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    const min = Math.max(1, parseInt(inMin.value, 10) || 1);
    const total = Math.max(1, parseInt(inTotal.value, 10) || 1);
    const text = (inText.value || '').trim() || 自激活_默认文本;
    sendCmd('sched_add', [sid, text, min, total]);
    flash('已下发定时自我激活：每 ' + min + ' 分钟 × ' + total + ' 次',
          'var(--green)');
  }));
  box.appendChild(goBtns);

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
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    sendCmd('sched_ls', sid);
    flash('正在刷新定时任务…', 'var(--blue)');
  }));
  tail.appendChild(bsBtn('🗑 清空本会话', 'danger', () => {
    if (!confirm('清空本会话的全部定时自我激活任务？')) return;
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    sendCmd('sched_clear', sid);
    flash('正在清空定时任务…', 'var(--blue)');
  }));
  box.appendChild(tail);
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
    del.textContent = '🗑'; del.style.cssText = 'margin-left:auto;color:#c62828';
    del.onclick = e => {
      e.stopPropagation();
      if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
      sendCmd('sched_del', t.id);
      flash('正在删除定时任务…', 'var(--blue)');
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