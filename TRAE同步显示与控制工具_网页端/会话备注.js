'use strict';
/* 2.40：会话备注（网页端专享）——会话名后追加（备注），不改 TRAE 真名。
   独立模块：渲染后缀钩子 备注后缀(sid) + 右键菜单项 备注菜单项(sid,title,ov)。
   数据源：服务端快照 snap['备注'] = {"<sid>":"<文本>"}，收到快照时落到 S.备注；
   写回命令：srvOpSend('note_set', [sid, 文本], 标签)（空文本 = 删除）。
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
    if (srvNeedOnline('备注')) return;
    /* 2.128：改自绘弹层（原 prompt 在手机端内置浏览器/WebView 会被静默屏蔽）。 */
    备注DlgOpen(sid, title);
  };
}

/* ============ 2.128：备注就地弹层（替代原生 prompt） ============
   起因（0021 报障 2026-10-23 16:37，CDP 实测：把 prompt 桩成静默 null 后点击 →
   prompt 被调用 1 次但无弹窗、无 flash、无命令发出，菜单随即关闭）：2.87 重命名、
   2.110 删除都已换成自绘层，唯独「📝 编辑备注」还是浏览器原生 prompt()，被漏掉。
   现改为与 renameDlgOpen 同款：开层即有提示、输入框预填旧备注、取消/确定两键；
   提交后仍走 srvOpSend('note_set',[sid,t],标签) 四态，空文本＝删除。 */
function 备注DlgOpen(sid, title){
  const old = $('notemask');
  if (old) old.remove();
  const cur = 备注取(sid);
  const ov = document.createElement('div');
  ov.id = 'notemask';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9999;'
    + 'background:rgba(0,0,0,.45);display:flex;align-items:center;'
    + 'justify-content:center;';
  ov.innerHTML = '<div style="background:#fff;border-radius:12px;'
    + 'padding:16px;width:86%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.3);">'
    + '<div style="font-weight:bold;font-size:15px;margin-bottom:6px;">'
    + '📝 编辑备注' + (title ? '<span style="font-weight:normal;color:var(--gray);'
      + 'font-size:12px;"> · ' + esc(title) + '</span>' : '') + '</div>'
    + '<div style="color:var(--gray);font-size:12px;margin-bottom:8px;">'
    + '留空则删除；备注仅网页端显示，不改 TRAE 真名</div>'
    + '<input id="notein" autocomplete="off" autocapitalize="off" value="'
      + esc(cur) + '" style="width:100%;box-sizing:border-box;padding:10px;'
    + 'font-size:15px;border:1px solid var(--bd,#ccc);border-radius:8px;">'
    + '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button id="notecancel" style="flex:1;padding:10px;border:1px solid '
      + 'var(--bd,#ccc);border-radius:8px;background:#f6f6f6;">取消</button>'
    + '<button id="noteok" style="flex:1;padding:10px;border:0;border-radius:8px;'
      + 'background:var(--blue,#1565c0);color:#fff;font-weight:bold;">确定</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  /* 开层即反馈——手机端从此不会「点了没反应」。 */
  flash('编辑备注' + (title ? '「' + title + '」' : '') + '：留空则删除', 'var(--blue)');
  const inp = $('notein');
  setTimeout(() => { try { inp.focus(); inp.select(); } catch(e){} }, 60);
  const close = () => ov.remove();
  $('notecancel').onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  const go = () => {
    const t = (inp.value || '').trim();
    if (t === cur){ close(); flash('备注未变，未发送', 'var(--blue)'); return; }
    if (srvNeedOnline('备注')) return;              /* ①：未连 WS，命令不发出 */
    if (!srvOpSend('note_set', [sid, t], t ? '保存备注' : '删除备注')) return;
    close();
  };
  $('noteok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); };
}