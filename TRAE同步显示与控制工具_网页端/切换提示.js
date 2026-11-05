'use strict';
/* 切换提示.js（网页端）  版本 1.00  日期 2026-11-05
   老板反馈：切换会话时顶部横幅很安静（以前会显示「正在切换…/切换成功」）。
   代码里 2.67 状态机仍在，但提示分散在状态栏/闪条，常被“本地存帧秒显”盖掉、看不见。
   本文件只做一件事：用一条**独立常驻小横幅**，保证切换过程可见——
     · 开始切换 → 「正在切换到「X」…」
     · 收到成功 → 「✓ 切换成功 · X」（2 秒后自动收起）
   只读 S.switch_pend / 当前标题，不发任何帧，不影响广播与业务。 */
(function(){
  var elBar = null, lastPhase = '', okUntil = 0, hideT = 0;

  function ensure(){
    if (elBar) return elBar;
    var st = document.createElement('style');
    st.textContent =
      '#swhint{position:fixed;left:0;right:0;top:0;z-index:99998;display:none;' +
      'padding:8px 12px calc(8px + env(safe-area-inset-top));font-size:13px;line-height:1.4;' +
      'color:#fff;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.18);' +
      'transform:translateY(-100%);transition:transform .18s ease}' +
      '#swhint.on{display:block;transform:translateY(0)}' +
      '#swhint.busy{background:#f39c12}' +
      '#swhint.ok{background:#27ae60}' +
      '#swhint.fail{background:#c0392b}';
    document.head.appendChild(st);
    elBar = document.createElement('div');
    elBar.id = 'swhint';
    document.body.appendChild(elBar);
    return elBar;
  }
  function show(txt, cls, ms){
    var b = ensure();
    b.textContent = txt;
    b.className = 'on ' + (cls || 'busy');
    clearTimeout(hideT);
    if (ms) hideT = setTimeout(function(){ b.className = ''; }, ms);
  }
  function nm(t){ t = String(t || '').trim(); return t.length > 16 ? t.slice(0, 16) + '…' : t; }

  setInterval(function(){
    try {
      var sp = (typeof S !== 'undefined') ? S.switch_pend : null;
      var now = Date.now();
      if (sp){
        var ph = sp.phase || 'switching';
        var t = nm(sp.title || '');
        if (ph === 'connecting') show('正在连接 WS…' + (t ? '（目标「' + t + '」）' : ''), 'busy');
        else if (ph === 'waiting') show('等待服务器回应…' + (t ? '（目标「' + t + '」）' : ''), 'busy');
        else if (ph === 'ok'){
          if (lastPhase !== 'ok'){ okUntil = now + 2200; }
          if (now < okUntil) show('✓ 切换成功' + (t ? ' · ' + t : ''), 'ok', Math.max(200, okUntil - now));
        } else show('正在切换到' + (t ? '「' + t + '」' : '目标会话') + '…', 'busy');
        lastPhase = ph;
      } else if (lastPhase && lastPhase !== 'gone'){
        /* switch_pend 被收口撤掉：若刚才不是失败，给一个短暂的成功提示 */
        if (now < okUntil) show('✓ 切换成功', 'ok', Math.max(200, okUntil - now));
        else { elBar && (elBar.className = ''); }
        lastPhase = 'gone';
      }
    } catch(e){}
  }, 300);

  /* 兜底：任何 switch_fail 提示走红色横幅（读服务端事件由业务层已 flash，这里只补横幅） */
  window.__swHint = show;
})();