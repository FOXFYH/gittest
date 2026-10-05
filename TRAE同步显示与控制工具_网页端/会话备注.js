'use strict';
/* 2.40：会话备注（网页端专享）——会话名后追加（备注），不改 TRAE 真名。
   独立模块：渲染后缀钩子 备注后缀(sid) + 右键菜单项 备注菜单项(sid,title,ov)。
   数据源：服务端快照 snap['备注'] = {"<sid>":"<文本>"}，收到快照时落到 S.备注；
   写回命令：sendCmd('note_set', [sid, 文本])（空文本 = 删除）。
   依赖：S（状态与DOM.js）、sendCmd（fox协议.js）、flash（通用工具.js）。 */

function 备注入快照(snap){
  /* 快照到达：把备注字典落到全局，供渲染/指纹读取（缺失或非对象时清空）。 */
  const d = snap && snap['备注'];
  S.备注 = (d && typeof d === 'object') ? d : {};
  return S.备注;
}

function 备注取(sid){
  if (!sid) return '';
  const t = (S.备注 || {})[sid];
  return (typeof t === 'string') ? t : '';
}

function 备注后缀(sid){
  /* 有备注返回「（备注）」，无则返回空串——供 会话列表.js renderConvs 调用。 */
  const t = 备注取(sid);
  return t ? '（' + t + '）' : '';
}

function 备注指纹(){
  /* 备注字典的稳定指纹（按键排序拼接）——参与 convs_key 去重，
     保证备注变化也能触发重绘，且顺序变化不误触发。 */
  const d = S.备注 || {};
  return Object.keys(d).sort().map(k => k + ':' + d[k]).join('|');
}

function 备注菜单项(sid, title, ov){
  /* 在会话右键菜单尾部（取消按钮之前）插入「📝 编辑备注」。
     由 会话列表.js convMenuOpen 在拼好菜单后调用；缺失该钩子则整块可摘除。 */
  const sheet = ov.querySelector('.cmsheet');
  if (!sheet) return;
  const b = document.createElement('button');
  b.dataset.act = 'note';
  b.textContent = '📝 编辑备注';
  const cancel = sheet.querySelector('.cmcancel');
  sheet.insertBefore(b, cancel || null);
  b.onclick = e => {
    e.stopPropagation();
    ov.remove();
    if (!sid){ flash('该会话无稳定 ID，暂不支持备注', 'var(--red)'); return; }
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    /* 风格对齐 convMenuOpen 的重命名：prompt 内联编辑；取消(null)则不动。 */
    const nn = prompt('编辑备注（留空则删除；仅网页端显示）', 备注取(sid));
    if (nn === null) return;
    const t = (nn || '').trim();
    sendCmd('note_set', [sid, t]);
    flash(t ? '正在保存备注…' : '正在删除备注…', 'var(--blue)');
  };
}