'use strict';
 /* 提示词库.js（网页端）  版本 2.288  日期 2026-11-26 */
(function(){
  const KEY = 'plib_cache_v1';
  let L = load();
  let built = false;
  let tried = false;
  const _reqAt = {};
  function requestCodes(codes){
    try{
      if (typeof cmd !== 'function') return;
      const now = Date.now(), out = [];
      (codes || []).forEach(function(c){
        c = String(c == null ? '' : c).trim();
        if (!c || L.txt[c] != null) return;
        if (now - Number(_reqAt[c] || 0) < 60000) return;
        _reqAt[c] = now;
        out.push(c);
      });
      if (out.length) cmd('plib_get', out.slice(0, 20));
    }catch(e){}
  }
  /* 服务端提示词库模块只推差异（add/del/upd 代码）：缺的自动索取、删的本地清掉 */
  window.plibTakeDiff = function(d){
    try{
      const add = (d && Array.isArray(d.add)) ? d.add : [];
      const upd = (d && Array.isArray(d.upd)) ? d.upd : [];
      if (add.length || upd.length) requestCodes(add.concat(upd));
      const del = (d && Array.isArray(d.del)) ? d.del : [];
      if (del.length){
        del.forEach(function(c){ try { delete L.txt[c]; delete L.ver[c]; } catch(e){} });
        save();
      }
    }catch(e){}
  };

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

  /* 类别 → 小钮颜色（缓存到本机=实线，缺=虚线暖色） */
  const KIND_COLOR = {
    '全局': '#7aa7d9', '岗位': '#8bbf7a', '系统': '#b39ddb',
    '自定': '#e0a45f', '人类': '#d98ba6', '私有头': '#9aa7b5'
  };

  /* —— 一行式块：状态 + 版本号组 + 对账/清空（插在设置页版本标签之前） —— */
  function build(){
    if (built || fsEl()) { built = true; return; }
    const body = document.querySelector('#page_net .nbody');
    if (!body) return;
    const fs = document.createElement('fieldset');
    fs.id = 'plib_fs';
    fs.innerHTML =
      '<legend>提示词库（一行版本条 · 按代码缓存）</legend>'
      + '<div class="row" id="plib_strip" style="flex-wrap:nowrap;overflow-x:auto;'
      +   'gap:6px;align-items:center;padding-bottom:2px;margin:0;min-height:24px;">'
      +   '<span id="plib_stat" class="hint" style="white-space:nowrap;font-size:11px;">尚未同步</span>'
      +   '<span id="plib_chips" style="display:inline-flex;gap:5px;flex-wrap:nowrap;"></span>'
      +   '<select id="plib_convsel" title="按会话拼贴（只用本机缓存）" '
      +     'style="max-width:110px;font-size:11px;padding:1px 4px;border-radius:10px;'
      +     'border:1px solid #99c;background:#f3f6ff;flex:0 0 auto;min-height:22px;">'
      +     '<option value="">拼贴…</option></select>'
      +   '<button id="plib_sync" title="立即与服务端对账（只收代码+版本）" '
      +     'style="font-size:11px;padding:1px 8px;border-radius:10px;flex:0 0 auto;min-height:22px;">对账</button>'
      +   '<button id="plib_clear" title="清空本机提示词缓存" '
      +     'style="font-size:11px;padding:1px 8px;border-radius:10px;flex:0 0 auto;min-height:22px;">清空</button>'
      + '</div>'
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
    document.getElementById('plib_convsel').onchange = (e) => {
      const sid = e.target.value;
      e.target.value = '';
      if (sid) showConv(sid);
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
      setStat('⚠ ' + v.err);
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
      setStat((v.n || idx.length) + '条·缺' + miss.length + '…');
      requestCodes(miss);
    } else {
      setStat((v.n || idx.length) + '条·全缓存✓');
      flash('提示词库已是最新（' + (v.n || idx.length) + ' 条）', 'var(--green)');
    }
  }

  function onText(v){
    const items = (v && v.items) || {};
    let n = 0;
    Object.keys(items).forEach(c => {
      L.txt[c] = items[c];
      delete _reqAt[c];              /* 已取回，解除节流标记 */
      if (L.idx) L.idx.forEach(e => { if (e.c === c) L.ver[c] = e.v; });
      n++;
    });
    save();
    render();
    if (n) redrawMsgs();          /* 全文到齐后重画消息，折叠按钮立即出现 */
    const total = (L.idx || []).length;
    const have = (L.idx || []).filter(e => L.txt[e.c] != null).length;
    setStat(total + '条·已缓' + have + (have < total ? '·缺' + (total - have) : '✓'));
    if (n) flash('已取回 ' + n + ' 条提示词全文', 'var(--green)');
  }

  function setStat(t){
    const s = document.getElementById('plib_stat');
    if (s) s.textContent = t;
  }

  /* —— 渲染：一条提示词一个「代码·版本」小钮，整组排在同一行里 —— */
  function render(){
    if (!fsEl()) return;              /* 设置页还没建块：等 build() 后再画 */
    const idx = L.idx || [];
    const box = document.getElementById('plib_chips');
    if (!box) return;
    if (!idx.length){
      box.innerHTML = '';
      setStat('无缓存');
      return;
    }
    let html = '';
    idx.forEach(e => {
      const has = L.txt[e.c] != null;
      const col = KIND_COLOR[e.k] || '#9aa7b5';
      const ver8 = String(e.v || '').slice(0, 8);
      html += '<button class="plib_btn" data-c="' + esc(e.c) + '" '
           +  'title="' + esc(e.k) + '｜' + esc(e.t) + '｜' + esc(e.z) + '字'
           +  (e.u > 1 ? '｜' + e.u + '个会话共用' : '') + '" '
           +  'style="font-size:11px;padding:1px 7px;border-radius:10px;white-space:nowrap;'
           +  'min-height:22px;line-height:1.2;'
           +  'border:1px ' + (has ? 'solid ' : 'dashed ') + col + ';'
           +  'background:' + (has ? '#fff' : '#fff8f4') + ';">'
           +  esc(e.c) + '·' + esc(ver8) + '</button>';
    });
    box.innerHTML = html;
    box.querySelectorAll('.plib_btn').forEach(b => {
      b.onclick = () => showCode(b.getAttribute('data-c'));
    });

    /* 拼贴下拉：一个会话一项（临时行不列） */
    const sel = document.getElementById('plib_convsel');
    if (sel){
      const conv = (L.conv || []).filter(c => !/（临时）\s*$/.test(String(c.sid || '')));
      let oh = '<option value="">拼贴…</option>';
      conv.forEach(c => {
        oh += '<option value="' + esc(c.sid) + '">' + esc(c.n || c.sid) + '</option>';
      });
      sel.innerHTML = oh;
    }
  }

  function showCode(code){
    const e = (L.idx || []).find(x => x.c === code) || {};
    const t = L.txt[code];
    const view = document.getElementById('plib_view');
    const row = document.getElementById('plib_copyrow');
    view.style.display = ''; row.style.display = '';
    view.textContent = (t == null)
      ? '（本机还没缓存这条，点「对账」取回）\n' + (e.t || '')
      : t;
    if (t == null) requestCodes([code]);
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
    if (miss.length) requestCodes(miss);
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

  window.plibHintSegs = function(sid, title){
    try{
      const conv = L.conv || [];
      const h4 = String(sid || '').slice(0, 4);
      let c = conv.find(x => h4 && String(x.sid) === h4);
      if (!c && title) c = conv.find(x => String(x.n || '') === String(title));
      if (!c) return null;
      const MAP = {'私有头': 'sys', '全局': 'sys', '系统': 'sys',
                   '自定': 'usr', '人类': 'co', '岗位': 'ai'};
      const hz = {sys: '', usr: '', co: '', ai: ''};
      const miss = [];
      (c.p || []).forEach(function(pr){
        const k = MAP[pr[0]], code = pr[1];
        if (!k || !code) return;
        const t = L.txt[code];
        if (t == null){ miss.push(code); return; }
        hz[k] += String(t);
      });
      if (miss.length) requestCodes(miss.slice(0, 20));
      return (hz.sys || hz.usr || hz.co || hz.ai) ? hz : null;
    }catch(e){ return null; }
  };
  function redrawMsgs(){
    try{
      if (typeof renderMsgs !== 'function') return;
      if (typeof S !== 'object' || !S || !Array.isArray(S.msgs_last)
          || S.msgs_last.length !== 5) return;
      renderMsgs(S.msgs_last[0], S.msgs_last[1], S.msgs_last[2],
                 S.msgs_last[3], S.msgs_last[4]);
    }catch(e){}
  }

  window.plibHintByCodes = function(codes){
    try{
      const MAP = {'私有头': 'sys', '全局': 'sys', '系统': 'sys',
                   '自定': 'usr', '人类': 'co', '岗位': 'ai'};
      const arr = String(codes == null ? '' : codes)
                    .split(/[,，\s]+/).filter(Boolean);
      const hz = {sys: '', usr: '', co: '', ai: ''};
      const miss = [];
      const kindOf = function(code){
        const e = (L.idx || []).find(x => x.c === code);
        if (e && e.k) return e.k;
        const conv = L.conv || [];
        for (let i = 0; i < conv.length; i++){
          const pr = (conv[i].p || []).find(p => p[1] === code);
          if (pr) return pr[0];
        }
        return '';
      };
      arr.forEach(function(code){
        const k = MAP[kindOf(code)];
        const t = L.txt[code];
        if (t == null){ miss.push(code); return; }
        if (k) hz[k] += String(t);
      });
      if (miss.length) requestCodes(miss.slice(0, 20));
      return (hz.sys || hz.usr || hz.co || hz.ai) ? hz : null;
    }catch(e){ return null; }
  };
})();
