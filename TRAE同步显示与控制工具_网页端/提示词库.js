'use strict';
/* 提示词库.js（网页端）  版本 2.283  日期 2026-11-25
   老板口径（2026-11-25 09:51）：全局/岗位/自定/人类提示词平时几乎不改，却每个会话
   各存一份、内容大量重复。服务端「提示词总库」已按正文去重（系统词拆「私有头+全局段」），
   每条唯一正文一个代码（Q0001…）+ 一个版本号（sha1 前 8 位）。

   本文件做三件事：
   ① 平时只收「代码+版本」索引（ev k=plib_idx），全文不再随广播反复传；
   ② 与 localStorage 缓存比对：缺码 / 版本不符 → 只对这几条发 plib_get 取全文，
      其余全部吃缓存（断网也能看、能复制）；
   ③ 设置页新增「提示词库」块：按代码拼贴成按钮（点开看全文/一键复制），并按会话
      把「私有头+全局+岗位」拼成整段（同样只用本地缓存拼，不再向电脑要全文）。

   协议：cmd('plib_idx') → ev/plib_idx {n,idx:[{c,v,k,t,z,u}],conv:[{sid,n,p:[[k,c]…]}]}
         cmd('plib_get',[码…]) → ev/plib_text {items:{码:全文}}            */
(function(){
  const KEY = 'plib_cache_v1';
  const KIND_ORDER = ['全局', '岗位', '系统', '自定', '人类', '私有头'];
  let L = load();
  let built = false;
  let tried = false;

  function load(){
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
      if (!o.txt) o.txt = {};
      if (!o.ver) o.ver = {};
      return o;
    } catch(e){ return {txt:{}, ver:{}}; }
  }
  function save(){
    try { localStorage.setItem(KEY, JSON.stringify(L)); } catch(e){}
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fsEl(){ return document.getElementById('plib_fs'); }

  /* —— 建块（设置页 .nbody 里、版本标签之前） —— */
  function build(){
    if (built || fsEl()) { built = true; return; }
    const body = document.querySelector('#page_net .nbody');
    if (!body) return;
    const fs = document.createElement('fieldset');
    fs.id = 'plib_fs';
    fs.innerHTML =
      '<legend>提示词库（去重 · 按代码缓存）</legend>'
      + '<div class="row" id="plib_stat"><span class="hint">尚未同步</span></div>'
      + '<div class="row" style="gap:8px;">'
      +   '<button id="plib_sync" style="flex:1;">立即对账</button>'
      +   '<button id="plib_clear" style="flex:1;">清空本机缓存</button>'
      + '</div>'
      + '<div id="plib_idxbox"></div>'
      + '<div id="plib_convbox"></div>'
      + '<pre id="plib_view" style="display:none;white-space:pre-wrap;word-break:break-all;'
      +   'max-height:220px;overflow:auto;background:#fff;border:1px solid #ccd;'
      +   'border-radius:6px;padding:8px;font-size:12px;line-height:1.5;"></pre>'
      + '<div class="row" style="gap:8px;display:none;" id="plib_copyrow">'
      +   '<button id="plib_copy" style="flex:1;">📋 复制这段</button>'
      + '</div>';
    const ver = document.getElementById('lbl_ver');
    if (ver && ver.parentNode === body) body.insertBefore(fs, ver);
    else body.appendChild(fs);
    built = true;
    document.getElementById('plib_sync').onclick = () => sync(true);
    document.getElementById('plib_clear').onclick = () => {
      L = {txt:{}, ver:{}}; save(); tried = false;
      flash('已清空本机提示词缓存，稍后自动重新取', 'var(--orange)');
      render(); sync(false);
    };
    document.getElementById('plib_copy').onclick = () => {
      const t = document.getElementById('plib_view').textContent || '';
      if (t) copyText(t);
    };
    render();
  }

  /* —— 与服务端对账：平时只拿代码+版本 —— */
  function sync(manual){
    if (typeof srvNeedOnline === 'function' && srvNeedOnline('提示词库')) return;
    if (manual && typeof srvOpSend === 'function'){
      srvOpSend('plib_idx', null, '提示词库对账');
    } else if (typeof cmd === 'function'){
      cmd('plib_idx', null);
    }
  }

  function onIdx(v){
    v = v || {};
    if (v.err){
      setStat('⚠ 电脑端：' + v.err);
      return;
    }
    const idx = Array.isArray(v.idx) ? v.idx : [];
    const conv = Array.isArray(v.conv) ? v.conv : [];
    /* 缓存只留当前仍在用的代码（改过的旧码清掉，省空间也防串版本） */
    const txt = {}, ver = {};
    idx.forEach(e => {
      if (L.txt[e.c] != null && L.ver[e.c] === e.v){
        txt[e.c] = L.txt[e.c]; ver[e.c] = e.v;
      }
    });
    L = {idx: idx, conv: conv, n: v.n || idx.length, ts: v.ts || '',
         txt: txt, ver: ver};
    save();
    const miss = idx.filter(e => ver[e.c] !== e.v).map(e => e.c);
    render();
    if (miss.length){
      setStat('电脑端共 ' + (v.n || idx.length) + ' 条；本机缺 ' + miss.length
              + ' 条，正在取…');
      if (typeof cmd === 'function') cmd('plib_get', miss);
    } else {
      setStat('电脑端共 ' + (v.n || idx.length) + ' 条；本机已全部缓存 ✓'
              + (v.ts ? '（' + v.ts + '）' : ''));
      flash('提示词库已是最新（' + (v.n || idx.length) + ' 条）', 'var(--green)');
    }
  }

  function onText(v){
    const items = (v && v.items) || {};
    let n = 0;
    Object.keys(items).forEach(c => {
      L.txt[c] = items[c];
      if (L.idx) L.idx.forEach(e => { if (e.c === c) L.ver[c] = e.v; });
      n++;
    });
    save();
    render();
    const total = (L.idx || []).length;
    const have = (L.idx || []).filter(e => L.txt[e.c] != null).length;
    setStat('电脑端共 ' + total + ' 条；本机已缓存 ' + have + ' 条'
            + (have < total ? '，还缺 ' + (total - have) + ' 条' : ' ✓'));
    if (n) flash('已取回 ' + n + ' 条提示词全文', 'var(--green)');
  }

  function setStat(t){
    const s = document.getElementById('plib_stat');
    if (s) s.innerHTML = '<span class="hint">' + esc(t) + '</span>';
  }

  /* —— 渲染：条目按钮（按代码）+ 会话拼贴按钮 —— */
  function render(){
    if (!fsEl()) return;              /* 设置页还没建块：等 build() 后再画 */
    const idx = L.idx || [];
    if (!idx.length){
      setStat('本机还没有提示词缓存（点「立即对账」从电脑端取）');
      return;
    }
    const groups = {};
    idx.forEach(e => { (groups[e.k] = groups[e.k] || []).push(e); });
    let html = '';
    KIND_ORDER.concat(Object.keys(groups).filter(k => KIND_ORDER.indexOf(k) < 0))
      .forEach(k => {
        const arr = groups[k];
        if (!arr || !arr.length) return;
        html += '<div class="row" style="margin-top:6px;"><b style="font-size:12px;">'
             +  esc(k) + '（' + arr.length + '）</b></div>'
             +  '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
        arr.forEach(e => {
          const has = L.txt[e.c] != null;
          html += '<button class="plib_btn" data-c="' + esc(e.c) + '" '
               +  'title="' + esc(e.t) + '" style="font-size:11px;padding:4px 7px;'
               +  'border-radius:12px;border:1px solid ' + (has ? '#9c9' : '#e99')
               +  ';background:' + (has ? '#f3fff3' : '#fff6f3') + ';">'
               +  esc(e.c) + ' · ' + esc(e.t) + ' · ' + esc(e.z) + '字'
               +  (e.u > 1 ? ' · ' + e.u + '会话' : '') + '</button>';
        });
        html += '</div>';
      });
    const box = document.getElementById('plib_idxbox');
    box.innerHTML = html;
    box.querySelectorAll('.plib_btn').forEach(b => {
      b.onclick = () => showCode(b.getAttribute('data-c'));
    });

    const conv = (L.conv || []).filter(c => !/（临时）\s*$/.test(String(c.sid || '')));
    let ch = '';
    if (conv.length){
      ch += '<div class="row" style="margin-top:8px;"><b style="font-size:12px;">'
         +  '按会话拼贴（私有头+全局+岗位，全用本机缓存）</b></div>'
         +  '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      conv.forEach(c => {
        ch += '<button class="plib_cbtn" data-sid="' + esc(c.sid) + '" '
           +  'style="font-size:11px;padding:4px 7px;border-radius:12px;'
           +  'border:1px solid #99c;background:#f3f6ff;">'
           +  esc(c.n || c.sid) + '</button>';
      });
      ch += '</div>';
    }
    const cb = document.getElementById('plib_convbox');
    cb.innerHTML = ch;
    cb.querySelectorAll('.plib_cbtn').forEach(b => {
      b.onclick = () => showConv(b.getAttribute('data-sid'));
    });
  }

  function showCode(code){
    const e = (L.idx || []).find(x => x.c === code) || {};
    const t = L.txt[code];
    const view = document.getElementById('plib_view');
    const row = document.getElementById('plib_copyrow');
    view.style.display = ''; row.style.display = '';
    view.textContent = (t == null)
      ? '（本机还没缓存这条，点「立即对账」取回）\n' + (e.t || '')
      : t;
    if (t == null) if (typeof cmd === 'function') cmd('plib_get', [code]);
    view.scrollIntoView({block: 'nearest'});
  }

  function showConv(sid){
    const c = (L.conv || []).find(x => String(x.sid) === String(sid)) || {};
    const parts = c.p || [];
    const miss = [];
    const txts = parts.map(([k, code]) => {
      if (L.txt[code] == null) miss.push(code);
      return (L.txt[code] != null) ? L.txt[code] : '〔' + k + ' ' + code + ' 未缓存〕';
    });
    const view = document.getElementById('plib_view');
    const row = document.getElementById('plib_copyrow');
    view.style.display = ''; row.style.display = '';
    view.textContent = '【' + (c.n || sid) + '】拼贴全文（' + parts.length + ' 段）\n\n'
                     + txts.join('\n\n');
    if (miss.length) if (typeof cmd === 'function') cmd('plib_get', miss);
    view.scrollIntoView({block: 'nearest'});
  }

  /* —— 挂事件：索引/全文两条 ev；首帧快照后自动对账一次 —— */
  if (typeof onEv === 'function'){
    const _old = onEv;
    onEv = function(kind, v){
      if (kind === 'plib_idx'){ onIdx(v); return; }
      if (kind === 'plib_text'){ onText(v); return; }
      if (!tried && (kind === 'snap' || kind === 'snap_pane')){
        tried = true;
        setTimeout(() => sync(false), 800);
      }
      return _old(kind, v);
    };
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', build);
  else
    build();
  window.plibSync = () => sync(true);
})();
