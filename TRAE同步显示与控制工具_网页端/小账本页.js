'use strict';
/* 小账本页.js（网页端）  版本 1.00  日期 2026-11-18
   【依据】《手机网页端账本系统V1.0总规范.md》第十章：小账本页面为本次
   所有账本相关功能的唯一集中管理入口——
     ① 账本查看：按会话分类展示所有本地缓存的账本，可进入看全文，
        纯本地浏览（IDB ledger_conv 直读），零同步报文（J1）；
     ② 集中调控：自动清理开关 / 离线倒计时时长 / 主动核对周期 /
        保留轮数 / 思维流直播帧间隔，全部收纳此页，改值立即生效+落盘（J2）。
   页面与抽屉入口均由本文件动态注入（不改 html 结构，CSS 自注入）。 */

function lbPageEnsure(){
  if ($('page_ledger')) return;
  const st = document.createElement('style');
  st.textContent =
    '#page_ledger{position:fixed; inset:0; z-index:40; background:#f2f4f7;' +
    'display:none; flex-direction:column;}' +
    '#page_ledger.on{display:flex;}' +
    '#page_ledger .nbody{flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch;}' +
    '#page_ledger fieldset{border:1px solid var(--bd,#d6dce4); border-radius:10px;' +
    'margin:10px 12px; padding:10px 12px; background:#fff;}' +
    '#page_ledger legend{font-size:13px; color:var(--blue); font-weight:bold; padding:0 6px;}' +
    '#page_ledger .lbrow{display:flex; align-items:center; gap:8px; padding:7px 2px;' +
    'font-size:14px;}' +
    '#page_ledger .lbrow label{flex:1; min-width:0;}' +
    '#page_ledger .lbrow input[type=number]{width:76px; padding:6px 8px; font-size:14px;' +
    'border:1px solid var(--bd,#ccc); border-radius:8px;}' +
    '#page_ledger .lbhint{font-size:11px; color:var(--gray); padding:2px 2px 6px;}' +
    '#page_ledger .lbconv{display:flex; align-items:center; gap:8px; padding:10px 14px;' +
    'border-bottom:1px solid #eef1f5; font-size:14px;}' +
    '#page_ledger .lbconv:active{background:#eef4fb;}' +
    '#page_ledger .lbconv .fname{flex:1; min-width:0; overflow:hidden; white-space:nowrap;' +
    'text-overflow:ellipsis;}' +
    '#page_ledger .lbconv .fmeta{flex:none; color:var(--gray); font-size:11px;}' +
    '#page_ledger .lbview{padding:10px 14px;}' +
    '#page_ledger .lbround{margin:0 0 12px; background:#fff; border:1px solid #e3e8ef;' +
    'border-radius:10px; padding:10px 12px; font-size:13px;}' +
    '#page_ledger .lbrole{font-size:11px; color:var(--blue); font-weight:bold; margin-bottom:4px;}' +
    '#page_ledger .lbrole.ai{color:#737373;}' +
    '#page_ledger .lbtxt{white-space:pre-wrap; word-break:break-word; color:#222;' +
    'line-height:1.5;}' +
    '#page_ledger .lbtm{font-size:10px; color:var(--gray); margin-top:3px;}';
  document.head.appendChild(st);
  const pg = document.createElement('div');
  pg.id = 'page_ledger';
  pg.innerHTML =
    '<div class="nhdr"><button id="btn_lbback">‹ 返回</button><b>📒 小账本</b></div>' +
    '<div class="nbody">' +
    '<fieldset><legend>账本查看（纯本地，零同步）</legend>' +
    '<div id="lb_list"></div><div id="lb_view" style="display:none;"></div>' +
    '</fieldset>' +
    '<fieldset><legend>集中调控（改值立即生效并保存）</legend>' +
    '<div class="lbrow"><label><input type="checkbox" id="lb_ck_clean"> 自动清理无用小账本（14 天未查看自动删）</label></div>' +
    '<div class="lbrow"><label>离线倒计时（秒）</label><input type="number" id="lb_in_offline" min="15" max="3600"></div>' +
    '<div class="lbrow"><label>主动核对周期（秒）</label><input type="number" id="lb_in_period" min="15" max="3600"></div>' +
    '<div class="lbrow"><label>本地账本保留轮数</label><input type="number" id="lb_in_rounds" min="1" max="50"></div>' +
    '<div class="lbrow"><label>思维流直播帧间隔（秒，只管思维流）</label><input type="number" id="lb_in_think" min="0" max="120"></div>' +
    '<div class="lbrow"><label><input type="checkbox" id="lb_ck_idleout"> 离线倒计时启用（走完发下线信号）</label></div>' +
    '<div class="lbrow"><label><input type="checkbox" id="lb_ck_bgout"> 切后台/切网页自动下线</label></div>' +
    '<div class="lbhint">以上为账本系统 V1.0 全部调控项；核对与离线倒计时实时数值见左下角小胶囊。</div>' +
    '</fieldset>' +
    '<div id="lb_foot" style="padding:6px 14px 20px; font-size:11px; color:var(--gray);">—</div>' +
    '</div>';
  document.body.appendChild(pg);
  $('btn_lbback').onclick = () => { $('page_ledger').classList.remove('on'); lbViewClose(); };
  /* J2：改值立即生效 + 落盘（CFG.cfgSave），周期类下一拍自然生效 */
  $('lb_ck_clean').onchange = e => { CFG.lb_autoclean = e.target.checked ? 1 : 0; cfgSave(); try { lbCleanStale(); } catch(e2){} };
  $('lb_ck_idleout').onchange = e => { CFG.lb_idleout = e.target.checked ? 1 : 0; cfgSave(); lbLastAct = Date.now(); };
  $('lb_ck_bgout').onchange = e => { CFG.lb_bgout = e.target.checked ? 1 : 0; cfgSave(); };
  $('lb_in_offline').onchange = e => { CFG.lb_offline = Math.max(15, parseInt(e.target.value) || 120); e.target.value = CFG.lb_offline; cfgSave(); lbLastAct = Date.now(); };
  $('lb_in_period').onchange = e => { CFG.lb_period = Math.max(15, parseInt(e.target.value) || 60); e.target.value = CFG.lb_period; cfgSave(); };
  $('lb_in_rounds').onchange = e => { CFG.lb_rounds = Math.min(50, Math.max(1, parseInt(e.target.value) || 5)); e.target.value = CFG.lb_rounds; cfgSave(); };
  $('lb_in_think').onchange = e => {
    CFG.lb_think = Math.max(0, parseInt(e.target.value) || 0);
    e.target.value = CFG.lb_think; cfgSave();
    /* 只管思维流模块的推送频率（规范五）：v 用整数秒下发（S1 裁定：
       v>0 开限频夹 1~600、v<=0 关限频，免重启生效），回执见 lbThinkIntAck */
    try { sendJson({t: 'set_think_int', v: CFG.lb_think | 0}); } catch(e2){}
  };
}

/* set_think_int 服务端回执（S1 裁定 0.27）：{'t':'think_int_ack','ok','sec','on'}
   —— 按 on/sec 更新调控项显示与本地 CFG（服务端是限频间隔的最终真值）。 */
function lbThinkIntAck(d){
  try {
    if (!d || typeof d !== 'object') return;
    const sec = Math.max(0, parseInt(d.sec) || 0);
    if (d.ok){
      CFG.lb_think = d.on ? sec : 0;
      cfgSave();
      const inp = $('lb_in_think');
      if (inp) inp.value = CFG.lb_think;
      flash(d.on ? ('思维流间隔已生效：' + sec + ' 秒') : '思维流限频已关闭（画面一变即发）', 'var(--blue)');
    } else {
      flash('思维流间隔下发未生效（服务端拒绝）', 'var(--red)');
    }
  } catch(e){}
}

function lbPageOpen(){
  lbPageEnsure();
  lbViewClose();
  $('lb_ck_clean').checked = !!CFG.lb_autoclean;
  $('lb_ck_idleout').checked = !!CFG.lb_idleout;
  $('lb_ck_bgout').checked = !!CFG.lb_bgout;
  $('lb_in_offline').value = lbOfflineSecs();
  $('lb_in_period').value = Math.max(15, parseInt(CFG.lb_period) || 60);
  $('lb_in_rounds').value = lbRounds();
  $('lb_in_think').value = (CFG.lb_think === undefined ? 5 : CFG.lb_think);
  lbRenderList();
  drawerClose();
  $('page_ledger').classList.add('on');
}

/* J1：按会话分类列出本地账本（IDB 直读，零同步报文） */
function lbRenderList(){
  _idbReq('ledger_conv', 'readonly', st => st.getAll()).then(rows => {
    const L = $('lb_list');
    if (!L) return;
    const mine = (rows || []).filter(r => r && r.srv === lbSrvKey() && Array.isArray(r.rounds));
    mine.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    let h = '';
    if (!mine.length) h = '<div class="fhint">（本服务端暂无本地账本——进入过会话后自动积累）</div>';
    mine.forEach(r => {
      const lv = r.lastView ? new Date(r.lastView).toLocaleString('sv').slice(0, 16) : '未查看';
      h += '<div class="lbconv" data-sid="' + esc(String(r.sid || '')) + '"'
        + ' data-title="' + esc(r.title || '') + '">'
        + '<span class="fname">' + esc(r.title || r.sid || '') + '</span>'
        + '<span class="fmeta">' + (r.rounds || []).length + ' 轮 · ' + esc(lv) + '</span></div>';
    });
    L.innerHTML = h;
    L.querySelectorAll('.lbconv').forEach(d => {
      d.onclick = () => lbViewOpen(d.dataset.sid, d.dataset.title);
    });
    $('lb_foot').textContent = '服务端：' + lbSrvKey() + ' · 共 ' + mine.length + ' 份本地账本 · 版本底账模块数 '
      + Object.keys(LB.mods || {}).length;
  }).catch(() => {});
}
function lbViewClose(){
  const v = $('lb_view');
  if (v){ v.style.display = 'none'; v.innerHTML = ''; }
  const L = $('lb_list');
  if (L) L.style.display = '';
}
function lbViewOpen(sid, title){
  /* 纯本地浏览：ledger_conv 直读该会话全部轮次，不触发任何服务端同步 */
  _idbReq('ledger_conv', 'readonly', st => st.get(lbKey(sid))).then(rec => {
    const v = $('lb_view'), L = $('lb_list');
    if (!v || !rec) { flash('该会话本地账本不存在', 'var(--red)'); return; }
    L.style.display = 'none';
    /* 进入查看即触碰 lastView（14 天自动删的计时基准） */
    rec.lastView = Date.now();
    _idbReq('ledger_conv', 'readwrite', st => st.put(rec)).catch(() => {});
    let h = '<div class="fhint">「' + esc(rec.title || sid) + '」· '
      + (rec.rounds || []).length + ' 轮 · 纯本地浏览</div>';
    (rec.rounds || []).forEach((r, i) => {
      h += '<div class="lbround"><div style="color:var(--gray); font-size:11px; margin-bottom:6px;">第 '
        + (i + 1) + ' 轮</div>';
      (r || []).forEach(m => {
        if (!Array.isArray(m)) return;
        const u = m[0] === 'u';
        h += '<div class="lbrole' + (u ? '' : ' ai') + '">' + (u ? '我' : 'TraeWork') + '</div>'
           + '<div class="lbtxt">' + esc(u ? stripHeadDid(m[1]) : m[1]) + '</div>'
           + (m[2] ? '<div class="lbtm">' + esc(String(m[2]).slice(0, 19)) + '</div>' : '');
      });
      h += '</div>';
    });
    v.innerHTML = h;
    v.style.display = 'block';
    v.onclick = lbViewClose;               /* 点查看区任意处返回清单 */
  }).catch(() => {});
}

/* 抽屉入口动态注入（≤小账本页唯一入口；其它页面不散落配置项） */
setTimeout(() => {
  try {
    const dmis = $('dmis');
    if (dmis && !$('btn_ledger')){
      const d = document.createElement('div');
      d.className = 'dmi';
      d.id = 'btn_ledger';
      d.textContent = '📒 小账本';
      d.onclick = lbPageOpen;
      const ref = $('btn_cacheview');
      if (ref && ref.parentNode === dmis) dmis.insertBefore(d, ref);
      else dmis.appendChild(d);
    }
  } catch(e){}
}, 600);
