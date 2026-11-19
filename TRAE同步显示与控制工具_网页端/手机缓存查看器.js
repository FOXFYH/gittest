'use strict';
/* 手机缓存查看器.js（网页端）  版本 2.16  日期 2026-11-18
   老板要求：进去先看「会话预备画面」——按会话名列出本地缓存的、切换会话时会先显示的那份内容；
   另一个标签页才是「全部缓存」全量查看。
   两个页面都**只读 IndexedDB / LocalStorage**，不联网、不发帧、不触发广播。

   2.16（整改单·老板 2026-11-18 亲批）：本查看器即《账本系统 V1.0》规范§十
     写死的「小账本」本体——禁止另造页面。新增第三个标签页「③ 账本调控」：
     收纳账本系统全部七项调控（自动清理/离线倒计时/核对周期/保留轮数/
     思维流帧间隔/闲置下线/切后台下线）+「核对 Ns · 离线 Ns」每秒递减
     倒计时展示（撤销原 #lbhud 左下角悬浮条，倒计时逻辑仍在 账本核对.js）。
     本地账本查看走现有「② 全部缓存」页（IDB ledger_conv 全量可展开），
     现有展示样式一概不动。

   2.17（老板 2026-11-19 09:58 定·《账本系统 V1.0》§十 :271／§七 :206／§八 :230）：
     ③ 页顶部新增「📒 我的小账本」卡片列表（调控项之上、沿用现成 .cv_rec/.cv_meta/
     .cv_lbrow 风格，不新造页面、不引框架）：
       · 数据源＝IDB ledger_conv 全量，按 rec.ts（最后更新时间）倒序；ts 缺失排最后；
       · 主行＝终身号 sid（等宽字体、过长中间省略、title 提示全文）——核对/归类/去重
         唯一依据；次行＝lbTitleOf 解析的真名，解析不到「未命名会话 ·#尾4位」；
         第三行＝轮数＋最后更新时间（本地时间 MM-DD HH:MM）；
       · 每卡右上角「🗑 删除」：confirm 二次确认 → 删该条 ledger_conv（sk）→ 同步
         LB.lbHave.delete／lbSumDrop（同服务端记录才减，防串服务端）→ 局部重排；
         只删本机缓存，不发任何服务端请求；
       · 排序实时性：每次打开/每次账本落盘（账本核对.js _after 调 window.cvLbDirty）
         重新读表重排；仅查看不改 ts（账本核对.js 内同内容 put 保 ts 不动）；
       · 空态「暂无本地小账本」。

   2.10（老板 2026-11-05 20:17）：
     · 预备画面列表改「两行一张卡片」的网格——第 1 行会话名，第 2 行时间/条数/是否当前生效；
       点卡片进入该会话的详情，顶部返回列表（不再一条占四行、也不再全堆在左侧）。
     · 详情里的人类发言**复用主代码同一条渲染管线**（stripHeadDid + _mdBody + foxHintBind）：
       服务端追加的专属词前后缀（(@fox-sys1)… 等）自动折叠成「系统/自定/人定/岗位」小按钮，
       与主界面显示一字一致。 */
(function(){
  var CV_VER = '2.17';      /* 2.13：界面标题栏显示本查看器自己的版本号，便于确认升级生效 */
  var built = false, tab = 'preview';
  var view = 'list';           /* 'list' ＝ 卡片列表；'detail' ＝ 单会话详情 */
  var detailItem = null;

  function injectStyle(){
    if (document.getElementById('cv_style')) return;
    var st = document.createElement('style');
    st.id = 'cv_style';
    st.textContent =
      '#cv_page{position:fixed;inset:0;z-index:99999;background:#f6f8fa;display:none;flex-direction:column;color:#222}' +
      '#cv_page.on{display:flex}' +
      '#cv_hd{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-bottom:1px solid #e3e8ee}' +
      '#cv_hd .t{flex:1;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#cv_hd button{border:1px solid #d5dbe1;background:#fff;border-radius:8px;padding:7px 10px;font-size:13px;color:#222}' +
      '#cv_tabs{flex:none;display:flex;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #e3e8ee}' +
      '#cv_tabs button{flex:1;border:1px solid #d5dbe1;background:#fff;border-radius:8px;padding:9px;font-size:14px;color:#222}' +
      '#cv_tabs button.on{background:#2f6fed;color:#fff;border-color:#2f6fed}' +
      '#cv_bd{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 10px 40px}' +
      '.cv_sec{background:#fff;border-radius:12px;margin:0 0 12px;overflow:hidden;border:1px solid #e6ebf0}' +
      '.cv_sec>h3{margin:0;padding:12px 14px;font-size:15px;font-weight:600;background:#eef4fb;border-bottom:1px solid #e6ebf0}' +
      '.cv_sec>h3 .n{font-size:12px;color:#6b7b8c;font-weight:400}' +
      '.cv_row{padding:10px 14px;border-bottom:1px solid #f1f4f7}' +
      '.cv_row:last-child{border-bottom:0}' +
      '.cv_k{font-size:13px;color:#337ab7;word-break:break-all;font-family:Menlo,monospace}' +
      '.cv_meta{font-size:11px;color:#8a98a6;margin-top:3px;white-space:pre-wrap}' +
      '.cv_v{margin:6px 0 0;padding:8px;background:#fafbfc;border:1px solid #eef1f4;border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;font-family:Menlo,monospace}' +
      '.cv_db{padding:10px 14px;border-bottom:1px solid #f1f4f7}.cv_db .nm{font-size:14px;font-weight:600;word-break:break-all}' +
      '.cv_store{margin:8px 0 0 8px;padding:8px 10px;background:#fafbfc;border-radius:8px;border:1px solid #eef1f4}' +
      '.cv_store .sn{font-size:13px;color:#444}.cv_rec{margin:6px 0 0}' +
      '.cv_rec summary{cursor:pointer;font-size:12px;color:#337ab7;word-break:break-all}' +
      '.cv_empty{padding:14px;font-size:13px;color:#8a98a6}.cv_bad{padding:10px 14px;font-size:12px;color:#c62828}' +
      /* 2.10：两行一张卡片的网格（左列/右侧都用上，不再一条占四行） */
      '.cv_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}' +
      '.cv_card{background:#fff;border:1px solid #e6ebf0;border-radius:12px;padding:10px 12px;min-height:56px;' +
        'display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}' +
      '.cv_card:active{background:#f2f6ff}' +
      '.cv_l1{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cv_l2{margin-top:5px;font-size:11px;color:#8a98a6;display:flex;align-items:center;gap:8px;' +
        'white-space:nowrap;overflow:hidden}' +
      '.cv_l2 .tg{flex:none;border-radius:6px;padding:1px 5px}' +
      '.cv_l2 .tg.ok{background:#e8f7ee;color:#1a7f37}' +
      '.cv_l2 .tg.old{background:#fdecea;color:#c62828}' +
      /* 2.10：详情页（单会话） */
      '.cv_dhd{display:flex;align-items:center;gap:8px;margin:0 0 10px}' +
      '.cv_dhd button{flex:none;border:1px solid #2f6fed;background:#fff;color:#2f6fed;border-radius:8px;padding:6px 10px;font-size:13px}' +
      '.cv_dhd .dt{flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cv_msg{padding:8px 10px;margin:6px 0 0;border-radius:8px;font-size:13px;line-height:1.55;word-break:break-word}' +
      '.cv_msg.u{background:#eef4fb}.cv_msg.a{background:#fff;border:1px solid #eef1f4}' +
      '.cv_msg .who{font-size:11px;color:#8a98a6;margin-bottom:3px}' +
      '.cv_msg .body{font-size:13px;line-height:1.55}' +
      '.cv_msg .body p{margin:0 0 6px}.cv_msg .body p:last-child{margin-bottom:0}' +
      /* 2.16：③ 账本调控区（跟随查看器既有风格，不新造组件形态） */
      '.cv_lbrow{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #f1f4f7;font-size:13px}' +
      '.cv_lbrow:last-child{border-bottom:0}' +
      '.cv_lbrow label{flex:1;min-width:0}' +
      '.cv_lbrow input[type=number]{width:70px;padding:6px 8px;font-size:13px;border:1px solid #d5dbe1;border-radius:6px}' +
      '.cv_lbhint{padding:8px 14px;font-size:11px;color:#8a98a6;line-height:1.6}' +
      '#cv_lb_hud{padding:10px 14px;font-size:14px;font-weight:600;color:#337ab7;letter-spacing:1px}' +
      /* 2.17：③ 页「我的小账本」卡片——沿用既有配色，只补主次层级与删除按钮位 */
      '.cv_lbcard{position:relative;padding:10px 14px;border-bottom:1px solid #f1f4f7}' +
      '.cv_lbcard:last-child{border-bottom:0}' +
      '.cv_lbid{font-size:14px;font-weight:600;color:#1f2d3d;font-family:Menlo,monospace;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:78px}' +
      '.cv_lbname{margin-top:3px;font-size:12px;color:#337ab7;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;padding-right:78px}' +
      '.cv_lbmeta{margin-top:3px;font-size:11px;color:#8a98a6}' +
      '.cv_lbid.cv_lbpending{color:#b58900;font-weight:500;font-family:inherit}' +
      '.cv_lbdel{position:absolute;right:10px;top:9px;border:1px solid #f0c6c2;background:#fff;' +
        'color:#c62828;border-radius:8px;padding:5px 8px;font-size:12px}' +
      '.cv_lbdel[disabled]{opacity:.45}';
    document.head.appendChild(st);
  }
  function fmtSize(n){
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function jsonText(v){ try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch(e){ return String(v); } }
  function classify(k){
    var s = String(k || '').toLowerCase();
    if (/token|pwd|pass|login|account|nick|uid|user|auth|chan|channel|srv|port|did/.test(s)) return '登录与连接';
    if (/skel|hist|snap|frame|msg|conv|draft|led|pend|queue/.test(s)) return '会话与消息缓存';
    if (/trae_webm|cfg|config|ui_|theme|layout|tab|font|tts|voice|pref/.test(s)) return '界面与偏好';
    return '其他';
  }
  function readLS(){
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i), v = '';
        try { v = localStorage.getItem(k); } catch(e){ v = '<读取失败>'; }
        out.push({k: k, v: v, n: (v || '').length});
      }
    } catch(e){}
    out.sort(function(a,b){ return b.n - a.n; });
    return out;
  }
  function curKey(){
    try { return (typeof cacheKeyNow === 'function') ? cacheKeyNow() : ''; } catch(e){ return ''; }
  }

  /* ---------- IndexedDB：会话预备画面（snap_conv） ---------- */
  function openSnapDB(){
    return new Promise(function(res, rej){
      var rq = indexedDB.open('trae_webm_idb');
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('open failed')); };
    });
  }
  function readSnapConvs(){
    return openSnapDB().then(function(db){
      return new Promise(function(res){
        if (!db.objectStoreNames.contains('snap_conv')){ db.close(); return res([]); }
        var tx = db.transaction('snap_conv', 'readonly'), out = [];
        var rq = tx.objectStore('snap_conv').openCursor();
        rq.onsuccess = function(){
          var c = rq.result;
          if (c){
            var v = c.value || {};
            out.push({sk: v.sk || c.key, key: v.key || '', title: v.title || '', sid: v.sid || '',
                      port: v.port, ts: v.ts || 0,
                      n: (v.frame && v.frame.msgs || []).length,
                      msgs: (v.frame && v.frame.msgs) || []});
            c.continue();
          }
        };
        tx.oncomplete = function(){ db.close(); out.sort(function(a,b){ return (b.ts||0)-(a.ts||0); }); res(out); };
        tx.onerror = function(){ db.close(); res(out); };
      });
    }).catch(function(){ return []; });
  }
  function rowText(m){
    if (Array.isArray(m)) return {role: m[0], text: m[1] || '', tm: m[2] || '', mid: m[6] || ''};
    return {role: (m && (m.role || m.r)) || '', text: (m && (m.text || m.t)) || '', tm: '', mid: ''};
  }
  /* 2.10：单条消息走主代码同一条渲染管线（专属词前后缀折叠成按钮，不再整段铺开）。 */
  function bodyHtml(text, isUser){
    var src = String(text == null ? '' : text);
    if (isUser && typeof stripHeadDid === 'function'){ try { src = stripHeadDid(src); } catch(e){} }
    if (typeof _mdBody === 'function'){
      try { return '<div class="body">' + _mdBody(src) + '</div>'; } catch(e){}
    }
    return '<div class="body">' + esc(src) + '</div>';
  }
  function bindFx(host){
    if (typeof foxHintBind === 'function'){ try { foxHintBind(host); } catch(e){} }
  }

  /* ---------- ① 会话预备画面：两行一张卡片 ---------- */
  function renderPreview(host){
    host.innerHTML = '';
    if (view === 'detail' && detailItem){ renderDetail(host, detailItem); return; }
    var cfg = document.createElement('div');
    cfg.className = 'cv_sec';
    cfg.innerHTML = '<h3>预备账册参数 <span class="n">改动后新的缓存按新条数保存</span></h3>' +
      '<div style="padding:10px 14px;font-size:13px;display:flex;align-items:center;gap:8px">' +
      '保存最近 <input id="cv_n" type="number" min="2" max="50" step="1" style="width:64px;' +
      'border:1px solid #d5dbe1;border-radius:6px;padding:5px 6px;font-size:13px" value="4"> 条' +
      '<span class="cv_meta" style="margin:0">（只留人类发言＋终极回复，思维流不存）</span></div>';
    host.appendChild(cfg);
    var nEl = cfg.querySelector('#cv_n');
    try { nEl.value = localStorage.getItem('trae_webm_frame_n') || '4'; } catch(e){}
    nEl.onchange = function(){
      var v = parseInt(nEl.value, 10);
      if (!(v >= 2 && v <= 50)){ v = 4; }
      nEl.value = v;
      try { localStorage.setItem('trae_webm_frame_n', String(v)); } catch(e){}
      nEl.parentElement.lastElementChild.textContent = '已保存：之后每次落盘只留最近 ' + v + ' 条';
    };
    var s = document.createElement('div');
    s.className = 'cv_sec';
    s.innerHTML = '<h3>会话预备画面 <span class="n">读取中…</span></h3>';
    host.appendChild(s);
    readSnapConvs().then(function(list){
      s.querySelector('.n').textContent = list.length + ' 个会话有本地预备画面';
      if (!list.length){
        s.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'（本地还没有任何会话存帧）'}));
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'cv_grid';
      grid.style.marginTop = '10px';
      var seen = {};
      list.forEach(function(it){
        var dup = it.sid && seen[it.sid];
        if (it.sid) seen[it.sid] = true;
        /* 2.15（老板 2026-11-05 21:51）：取消「生效/旧版本」标签——预备画面钥匙已与
           版本号脱钩，全部记录一视同仁，删除只由「最近 N 条」管理。 */
        var card = document.createElement('div');
        card.className = 'cv_card';
        card.innerHTML = '<div class="cv_l1">' + esc(it.title || it.sid || it.sk) + '</div>' +
          '<div class="cv_l2">' +
            '<span>' + esc(it.ts ? new Date(it.ts).toLocaleString() : '—') + '</span>' +
            '<span>' + esc(it.n + ' 条') + (dup ? ' · 重复' : '') + '</span>' +
          '</div>';
        card.onclick = function(){
          detailItem = it; view = 'detail';
          renderPreview(host);
          host.scrollTop = 0;
        };
        grid.appendChild(card);
      });
      s.appendChild(grid);
    });
  }
  /* 2.10：单会话详情（人类发言按主代码格式折叠） */
  function renderDetail(host, it){
    var bar = document.createElement('div');
    bar.className = 'cv_dhd';
    bar.innerHTML = '<button>‹ 返回列表</button><div class="dt">' + esc(it.title || it.sid || it.sk) + '</div>';
    bar.querySelector('button').onclick = function(){ view = 'list'; detailItem = null; renderPreview(host); host.scrollTop = 0; };
    host.appendChild(bar);
    var s = document.createElement('div');
    s.className = 'cv_sec';
    s.innerHTML = '<h3>预备画面 · ' + esc(it.n + ' 条') + ' <span class="n">'
      + esc(it.ts ? new Date(it.ts).toLocaleString() : '—') + '</span></h3>';
    var box = document.createElement('div');
    box.style.padding = '4px 10px 12px';
    if (!it.msgs.length){
      box.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'（这份预备画面是空的）'}));
    } else {
      var lastTm = '';
      it.msgs.forEach(function(m){
        var x = rowText(m);
        var user = x.role === 'u';
        /* 2.11（老板 2026-11-05 20:21）：ID 显示**完整** mid（原 slice(0,12) 是显示截断）；
           时间优先用记录里的完整值（≥10 位＝带日期），残缺（只有 HH:MM）时复用主代码
           _midTime —— mid 前 8 位十六进制＝Unix 秒，可精确到秒。 */
        var tm = String(x.tm || '');
        if (tm.length < 10 && typeof _midTime === 'function'){
          try { tm = _midTime(m) || tm; } catch(e){}
        }
        /* 2.12：AI 行自身时间取不到（无 tm、mid 也非 hex 临时号）时，沿用上一条的时间——
           与主界面 resolveTimes 同一口径；人类行算出的时间成为后续 AI 行的兜底。 */
        if (!tm && !user) tm = lastTm;
        if (tm) lastTm = tm;
        var mid = String(x.mid || '');
        var d = document.createElement('div');
        d.className = 'cv_msg ' + (user ? 'u' : 'a');
        d.innerHTML = '<div class="who">' + esc((user ? '你' : 'AI') +
          (tm ? ' · ' + tm : '') + (mid ? ' · ' + mid : '')) + '</div>' +
          bodyHtml(x.text, user);
        box.appendChild(d);
      });
      bindFx(box);
    }
    s.appendChild(box);
    host.appendChild(s);
  }

  /* ---------- ② 全部缓存 ---------- */
  function sec(title, count){
    var d = document.createElement('div'); d.className = 'cv_sec';
    d.innerHTML = '<h3>' + esc(title) + ' <span class="n">' + esc(count || '') + '</span></h3>';
    return d;
  }
  function rowKV(k, v, meta){
    var d = document.createElement('details'); d.className = 'cv_row';
    var sum = document.createElement('summary'); sum.className = 'cv_k';
    sum.textContent = k + '  ' + (meta || '');
    d.appendChild(sum);
    var loaded = false;
    d.addEventListener('toggle', function(){
      if (!d.open || loaded) return; loaded = true;
      var box = document.createElement('div'); box.className = 'cv_v'; box.textContent = v;
      d.appendChild(box);
    });
    return d;
  }
  /* 2.183 修4a（2026-11-19 老板实测：小账本以纯数字命名，莫名其妙）：
     ledger_conv 展示名三级解析——①rec.title 非空且非纯数字（/^\d+$/ 不算名，
     服务端账本键常为 4 位序号、显示名未随帧下发）→ 直接用；②按 rec.sid 从
     本地会话列表解析显示名（typeof 守卫只读访问，不发帧不触发同步）；
     ③拿不到返回空，调用方兜底「未命名会话 ·#<sid 尾 4 位>」。 */
  function lbTitleOf(rec){
    var t = String((rec && rec.title) || '').trim();
    if (t && !/^\d+$/.test(t)) return t;
    try {
      var sid = String((rec && rec.sid) || '');
      if (sid && (typeof S === 'object') && S && Array.isArray(S.convs)){
        for (var i = 0; i < S.convs.length; i++){
          var r = S.convs[i];
          if (!r || !r[1]) continue;
          if (String(r[4] || '') === sid) return String(r[1]);
          if (typeof 稳定键 === 'function' && 稳定键(String(r[4] || ''), '') === 稳定键(sid, '')) return String(r[1]);
        }
      }
    } catch(e){}
    return '';
  }
  function renderAllCache(host){
    host.innerHTML = '';
    var ov = sec('概览', '');
    var lsAll = readLS();
    var lsBytes = lsAll.reduce(function(a,b){ return a + b.n; }, 0);
    var o = document.createElement('div'); o.className = 'cv_row';
    o.innerHTML = '<div class="cv_meta">' + esc('页面：' + location.href + '\n时间：' + new Date().toLocaleString() +
      '\nLocalStorage：' + lsAll.length + ' 项，约 ' + fmtSize(lsBytes)) + '</div>';
    ov.appendChild(o); host.appendChild(ov);
    ['登录与连接','会话与消息缓存','界面与偏好','其他'].forEach(function(cat){
      var items = lsAll.filter(function(x){ return classify(x.k) === cat; });
      var s = sec('LocalStorage · ' + cat, items.length + ' 项，约 ' + fmtSize(items.reduce(function(a,b){ return a+b.n; },0)));
      if (!items.length) s.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'（无）'}));
      else items.forEach(function(x){ s.appendChild(rowKV(x.k, x.v, fmtSize(x.n))); });
      host.appendChild(s);
    });
    var idbSec = sec('IndexedDB · 全部数据库', '读取中…'); host.appendChild(idbSec);
    readDBs().then(function(names){
      idbSec.querySelector('.n').textContent = names.length + ' 个库';
      if (!names.length) return;
      names.forEach(function(nm){
        openDB(nm).then(function(db){
          var blk = document.createElement('div'); blk.className = 'cv_db';
          blk.innerHTML = '<div class="nm">' + esc(nm) + ' <span class="cv_meta">v' + esc(db.version) + ' / ' + db.objectStoreNames.length + ' 个表</span></div>';
          Array.prototype.forEach.call(db.objectStoreNames, function(sn){
            var stDiv = document.createElement('div'); stDiv.className = 'cv_store';
            stDiv.innerHTML = '<div class="sn">📦 ' + esc(sn) + ' <span class="cv_meta">（点开查看全量记录）</span></div>';
            var det = document.createElement('details'); det.className = 'cv_rec';
            det.innerHTML = '<summary>展开读取全部记录</summary>';
            var loaded = false;
            det.addEventListener('toggle', function(){
              if (!det.open || loaded) return; loaded = true;
              var wrap = document.createElement('div'); wrap.textContent = '读取中…'; det.appendChild(wrap);
              /* 2.183 修4（2026-11-19）：原写法 toggle 时才 storeAll(db, sn)，而外层
                 连接在建完 DOM 后已 db.close() → transaction 恒抛「connection is
                 closing」→ 展开恒 0 条（修4 自测 T-G-b 实锤，2.16 起就坏）。改：展开
                 时自开新连接、读完即关；外层连接只负责枚举 objectStoreNames。 */
              openDB(nm).then(function(db2){
                return storeAll(db2, sn).then(function(r){ db2.close(); return r; });
              }).catch(function(e){ return {rows: [], err: e}; }).then(function(r){
                wrap.innerHTML = '';
                if (r.err) wrap.appendChild(Object.assign(document.createElement('div'), {className:'cv_bad', textContent:'读取失败：' + (r.err.message||r.err)}));
                wrap.appendChild(Object.assign(document.createElement('div'), {className:'cv_meta', textContent:'共 ' + r.rows.length + ' 条记录'}));
                r.rows.forEach(function(x, i){
                  var t = jsonText(x.value);
                  var dd = document.createElement('details'); dd.className = 'cv_rec';
                  var head;
                  /* 2.183 修4a：ledger_conv 记录行改展示名（三级解析＋缀 #sid 尾 4 位
                     防重名）——其它列（读取体/大小）原样不动，样式零改动（§十）。 */
                  if (sn === 'ledger_conv' && x.value && typeof x.value === 'object'){
                    var nm = lbTitleOf(x.value);
                    var sid = String(x.value.sid || '');
                    var tail = sid ? sid.slice(-4) : jsonText(x.key).slice(-4);
                    if (!nm) nm = '未命名会话';
                    head = '#' + (i+1) + ' ' + esc(nm)
                         + ' <span class="cv_meta">·#' + esc(tail)
                         + '（' + fmtSize(t.length) + '）</span>';
                  } else {
                    head = '#' + (i+1) + ' 键=' + esc(jsonText(x.key).slice(0,60)) + '（' + fmtSize(t.length) + '）';
                  }
                  dd.innerHTML = '<summary>' + head + '</summary><div class="cv_v">' + esc(t) + '</div>';
                  wrap.appendChild(dd);
                });
              });
            });
            stDiv.appendChild(det); blk.appendChild(stDiv);
          });
          db.close(); idbSec.appendChild(blk);
        }).catch(function(e){
          idbSec.appendChild(Object.assign(document.createElement('div'), {className:'cv_bad', textContent: nm + '：打开失败（' + (e && e.message) + '）'}));
        });
      });
    });
  }
  function readDBs(){
    return new Promise(function(resolve){
      try {
        if (indexedDB.databases){
          indexedDB.databases().then(function(dbs){ resolve((dbs||[]).map(function(d){ return d && d.name; }).filter(Boolean)); }).catch(function(){ resolve([]); });
        } else resolve([]);
      } catch(e){ resolve([]); }
    });
  }
  function openDB(name){
    return new Promise(function(res, rej){
      var rq = indexedDB.open(name);
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('open failed')); };
    });
  }
  function storeAll(db, sn){
    return new Promise(function(res){
      var rows = [], tx;
      try { tx = db.transaction(sn, 'readonly'); } catch(e){ return res({rows:[], err:e}); }
      var rq = tx.objectStore(sn).openCursor();
      rq.onsuccess = function(){
        var c = rq.result;
        if (c){ rows.push({key: c.key, value: c.value}); c.continue(); }
      };
      tx.oncomplete = function(){ res({rows: rows, err: null}); };
      tx.onerror = function(){ res({rows: rows, err: tx.error}); };
    });
  }

  /* ---------- ③ 页顶部「📒 我的小账本」卡片列表（2.17 老板 2026-11-19 09:58 定） ----------
     规范§十 :271：小账本＝现成缓存查看器本体，禁止另造页面；卡片主行＝终身号 sid
     （核对/归类/去重唯一依据）、次行＝会话名、第三行＝轮数+最后更新时间；🗑 只删
     本机 IDB 记录（confirm 二次确认），绝不发任何服务端请求。 */
  function lbTimeText(ts){
    var n = Number(ts) || 0;
    if (!n) return '—';
    var d = new Date(n);
    if (isNaN(d.getTime())) return '—';
    var p2 = function(x){ return (x < 10 ? '0' : '') + x; };
    return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  /* 中间省略：头尾都留（sid 是唯一依据，只截尾会丢掉区分位） */
  function midEllipsis(s, keep){
    s = String(s == null ? '' : s);
    keep = keep || 18;
    if (s.length <= keep) return s;
    var h = Math.ceil((keep - 1) / 2);
    return s.slice(0, h) + '…' + s.slice(s.length - (keep - 1 - h));
  }
  function readLedgerRows(){
    return new Promise(function(res){
      try {
        if (typeof _idbReq === 'function'){
          _idbReq('ledger_conv', 'readonly', function(st){ return st.getAll(); })
            .then(function(rows){ res(Array.isArray(rows) ? rows : []); })
            .catch(function(){ res([]); });
          return;
        }
      } catch(e){}
      openDB('trae_webm_idb').then(function(db){
        storeAll(db, 'ledger_conv').then(function(r){
          db.close();
          res((r.rows || []).map(function(x){
            var v = (x.value && typeof x.value === 'object') ? x.value : {};
            if (!v.sk) v.sk = x.key;
            return v;
          }));
        }).catch(function(){ db.close(); res([]); });
      }).catch(function(){ res([]); });
    });
  }
  function delLedgerRow(rec){
    var sk = rec && rec.sk;
    return new Promise(function(res, rej){
      if (sk == null) return rej(new Error('记录缺少 sk，无法删除'));
      try {
        if (typeof _idbReq === 'function'){
          _idbReq('ledger_conv', 'readwrite', function(st){ return st.delete(sk); })
            .then(function(){ res(true); }).catch(rej);
          return;
        }
      } catch(e){}
      openDB('trae_webm_idb').then(function(db){
        var tx = db.transaction('ledger_conv', 'readwrite');
        tx.objectStore('ledger_conv').delete(sk);
        tx.oncomplete = function(){ db.close(); res(true); };
        tx.onerror = function(){ db.close(); rej(tx.error); };
        tx.onabort = function(){ db.close(); rej(tx.error || new Error('aborted')); };
      }).catch(rej);
    });
  }
  function renderLbCards(){
    var box = document.createElement('div');
    box.className = 'cv_sec';
    box.innerHTML = '<h3>📒 我的小账本 <span class="n">按最后更新时间倒序 · 只存本机</span></h3>';
    var list = document.createElement('div');
    list.id = 'cv_lb_list';
    box.appendChild(list);
    var draw = function(){
      list.innerHTML = '';
      list.appendChild(Object.assign(document.createElement('div'), {className:'cv_lbhint', textContent:'读取中…'}));
      readLedgerRows().then(function(rows){
        list.innerHTML = '';
        rows = rows.filter(function(r){ return r && typeof r === 'object'; });
        /* 排序：rec.ts 倒序；ts 缺失排最后；同 ts 再按 sid 稳定，避免观察乱跳 */
        rows.sort(function(a, b){
          var d2 = (Number(b.ts) || 0) - (Number(a.ts) || 0);
          if (d2) return d2;
          return String(a.sid || '').localeCompare(String(b.sid || ''));
        });
        if (!rows.length){
          list.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'暂无本地小账本'}));
          return;
        }
        var curSrv = '';
        try { curSrv = (typeof lbSrvKey === 'function') ? String(lbSrvKey()) : ''; } catch(e){ curSrv = ''; }
        rows.forEach(function(rec){
          var sid = String(rec.sid || '');
          var skTxt = String(rec.sk || '');
          var head = sid || skTxt;
          var nm = '';
          try { nm = lbTitleOf(rec); } catch(e){ nm = ''; }
          /* 2.184 追加（锚定双轨终版）：title 必有（空名/纯号码名不渲染，
             绝不兜底「未命名会话 ·#尾4位」、绝不拿号码当名）；sid 允许缺——
             无号账本是「备用账本（待补号）」，照常建卡，主行显灰色「待补号」，
             等 sid 到位归并后自动变高级账本。 */
          if (!nm || /^\d+$/.test(nm)){
            try { if (typeof diagLog === 'function')
              diagLog('缺 title 弃卡 sk=' + skTxt, 'bad'); } catch(e){}
            return;
          }
          var card = document.createElement('div');
          card.className = 'cv_lbcard';
          var idEl = document.createElement('div');
          idEl.className = 'cv_lbid';
          if (sid){
            idEl.textContent = midEllipsis(head, 18);
            idEl.title = head;                     /* 长按/悬停看完整终身号 */
          } else {
            idEl.textContent = '⏳ 待补号';
            idEl.classList.add('cv_lbpending');
            idEl.title = '尚未拿到该会话的终身号，拿到后自动归并';
          }
          var nmEl = document.createElement('div');
          nmEl.className = 'cv_lbname';
          nmEl.textContent = nm;
          var mtEl = document.createElement('div');
          mtEl.className = 'cv_lbmeta';
          var rn = Array.isArray(rec.rounds) ? rec.rounds.length : 0;
          mtEl.textContent = rn + ' 轮 · ' + lbTimeText(rec.ts);
          var del = document.createElement('button');
          del.className = 'cv_lbdel';
          del.textContent = '🗑 删除';
          del.onclick = function(){
            if (!window.confirm('删除这条本地小账本？\n会话：' + nm + '\n（只删本机缓存，不影响服务端与 TRAE 会话）')) return;
            del.disabled = true;
            delLedgerRow(rec).then(function(){
              /* 删完按剩余记录回算：该 sid 已无任何账本 → 真存集与摘要表同步减
                 （规范§七：绝不让 vcheck 替已死账本上报）；其他服务端的记录不动摘要 */
              return readLedgerRows().then(function(left){
                var still = (left || []).some(function(r){
                  return String((r && r.sid) || '') === sid;
                });
                if (!still && sid){
                  try { LB.lbHave.delete(sid); } catch(e){}
                  if (curSrv && String(rec.srv || '') === curSrv){
                    try { if (typeof lbSumDrop === 'function') lbSumDrop(sid, rec.title); } catch(e){}
                  }
                }
                try { if (typeof diagLog === 'function') diagLog('小账本：已删本地账本 ' + (sid || skTxt)); } catch(e){}
                draw();
              });
            }).catch(function(e){
              del.disabled = false;
              alert('删除失败：' + ((e && e.message) || e));
            });
          };
          card.appendChild(idEl); card.appendChild(nmEl); card.appendChild(mtEl); card.appendChild(del);
          list.appendChild(card);
        });
      });
    };
    draw();
    return {el: box, redraw: draw};
  }

  /* ---------- ③ 账本调控（整改单 2026-11-18：原「小账本页.js」调控区并入此处） ----------
     规范§九-4：倒计时以「每秒递减的数字」展示在本区（#cv_lb_hud），不做悬浮窗；
     任意操作会重置倒计时 → 人操作时数字不降属正常设计。数值来源＝账本核对.js
     的 window.lbHudText()（每秒由下方 interval 刷新，仅本 tab 可见时更新）。 */
  function renderLedgerCtl(host){
    host.innerHTML = '';
    /* 2.17：页顶部「📒 我的小账本」卡片列表（调控项之上）；账本落盘后由
       账本核对.js _after 调 window.cvLbDirty 触发重排（仅本页可见时才刷）。 */
    var lbList = renderLbCards();
    host.appendChild(lbList.el);
    window.cvLbDirty = function(){
      try { if (tab === 'ledger' && lbList.el.parentNode) lbList.redraw(); } catch(e){}
    };
    var hud = document.createElement('div');
    hud.className = 'cv_sec';
    hud.innerHTML = '<h3>核对与离线倒计时 <span class="n">每秒递减；任意操作即重置回配置值</span></h3>' +
      '<div id="cv_lb_hud">—</div>';
    host.appendChild(hud);
    var fs = document.createElement('div');
    fs.className = 'cv_sec';
    fs.innerHTML = '<h3>账本调控 <span class="n">改值立即生效并保存</span></h3>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_clean"> 自动清理无用小账本（14 天未查看自动删）</label></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_hud"> 悬浮倒计时条（左下角，默认关；勾选即悬浮走字）</label></div>' +
      '<div class="cv_lbrow"><label>离线倒计时（秒）</label><input type="number" id="lb_in_offline" min="15" max="3600"></div>' +
      '<div class="cv_lbrow"><label>主动核对周期（秒）</label><input type="number" id="lb_in_period" min="15" max="3600"></div>' +
      '<div class="cv_lbrow"><label>本地账本保留轮数</label><input type="number" id="lb_in_rounds" min="1" max="50"></div>' +
      '<div class="cv_lbrow"><label>思维流直播帧间隔（秒，0＝不限频一变即发）</label><input type="number" id="lb_in_think" min="0" max="120"></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_idleout"> 离线倒计时启用（走完发下线信号）</label></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_bgout"> 切后台/切网页自动下线</label></div>' +
      '<div class="cv_lbhint">以上为账本系统 V1.0 全部调控项（唯一集中入口）。本地账本看本页顶部「📒 我的小账本」；原始记录仍可在「② 全部缓存」展开 IndexedDB · trae_webm_idb · ledger_conv。</div>';
    host.appendChild(fs);
    var q = function(id){ return fs.querySelector('#' + id); };
    var save = function(){ try { if (typeof cfgSave === 'function') cfgSave(); } catch(e){} };
    q('lb_ck_clean').checked = !!(typeof CFG !== 'undefined' && CFG.lb_autoclean);
    q('lb_ck_hud').checked = !!(typeof CFG !== 'undefined' && CFG.lb_hud);
    q('lb_ck_idleout').checked = !!(typeof CFG !== 'undefined' && CFG.lb_idleout);
    q('lb_ck_bgout').checked = !!(typeof CFG !== 'undefined' && CFG.lb_bgout);
    q('lb_in_offline').value = (typeof lbOfflineSecs === 'function') ? lbOfflineSecs() : 120;
    q('lb_in_period').value = (typeof CFG !== 'undefined' && parseInt(CFG.lb_period)) || 60;
    q('lb_in_rounds').value = (typeof lbRounds === 'function') ? lbRounds() : 5;
    q('lb_in_think').value = (typeof CFG !== 'undefined' && CFG.lb_think !== undefined) ? CFG.lb_think : 5;
    q('lb_ck_clean').onchange = function(){ CFG.lb_autoclean = this.checked ? 1 : 0; save(); try { if (typeof lbCleanStale === 'function') lbCleanStale(); } catch(e){} };
    q('lb_ck_hud').onchange = function(){
      CFG.lb_hud = this.checked ? 1 : 0; save();
      try { if (typeof lbHud === 'function') lbHud(); } catch(e){}   /* 开→立刻建条走字；关→立刻撤 */
    };
    q('lb_ck_idleout').onchange = function(){ CFG.lb_idleout = this.checked ? 1 : 0; save(); try { if (typeof lbLastAct !== 'undefined') lbLastAct = Date.now(); } catch(e){} };
    q('lb_ck_bgout').onchange = function(){ CFG.lb_bgout = this.checked ? 1 : 0; save(); };
    q('lb_in_offline').onchange = function(){ CFG.lb_offline = Math.max(15, parseInt(this.value, 10) || 120); this.value = CFG.lb_offline; save(); try { if (typeof lbLastAct !== 'undefined') lbLastAct = Date.now(); } catch(e){} };
    q('lb_in_period').onchange = function(){ CFG.lb_period = Math.max(15, parseInt(this.value, 10) || 60); this.value = CFG.lb_period; save(); };
    q('lb_in_rounds').onchange = function(){ CFG.lb_rounds = Math.min(50, Math.max(1, parseInt(this.value, 10) || 5)); this.value = CFG.lb_rounds; save(); };
    q('lb_in_think').onchange = function(){
      CFG.lb_think = Math.max(0, parseInt(this.value, 10) || 0);
      this.value = CFG.lb_think; save();
      /* 规范五：只管思维流模块的推送频率。v 用整数秒下发（S1 裁定：v>0 开限频
         夹 1~600、v<=0 关限频，免重启生效），回执 think_int_ack 由 账本核对.js 处理 */
      try { if (typeof sendJson === 'function') sendJson({t: 'set_think_int', v: CFG.lb_think | 0}); } catch(e){}
    };
    if (!renderLedgerCtl._tick){
      renderLedgerCtl._tick = setInterval(function(){
        var el2 = document.getElementById('cv_lb_hud');
        if (!el2) return;
        var txt = '—';
        try { txt = (typeof window.lbHudText === 'function') ? (window.lbHudText() || '—') : '—'; } catch(e){}
        el2.textContent = txt;
      }, 1000);
    }
  }

  function build(){
    if (built) return; built = true;
    injectStyle();
    var pg = document.createElement('div'); pg.id = 'cv_page';
    pg.innerHTML = '<div id="cv_hd"><button id="cv_back">‹ 返回</button><div class="t">手机缓存查看器 v' + CV_VER + '</div>' +
      '<button id="cv_reload">刷新</button></div>' +
      '<div id="cv_tabs"><button id="cv_t1" class="on">① 会话预备画面</button><button id="cv_t2">② 全部缓存</button><button id="cv_t3">③ 账本调控</button></div>' +
      '<div id="cv_bd"></div>';
    document.body.appendChild(pg);
    var bd = pg.querySelector('#cv_bd');
    pg.querySelector('#cv_back').onclick = function(){ pg.classList.remove('on'); };
    function draw(){
      if (tab === 'preview') renderPreview(bd); else if (tab === 'ledger') renderLedgerCtl(bd); else renderAllCache(bd);
    }
    pg.querySelector('#cv_reload').onclick = function(){ view = 'list'; detailItem = null; draw(); };
    pg.querySelector('#cv_t1').onclick = function(){
      tab = 'preview'; view = 'list'; detailItem = null;
      this.classList.add('on'); pg.querySelector('#cv_t2').classList.remove('on'); pg.querySelector('#cv_t3').classList.remove('on'); draw();
    };
    pg.querySelector('#cv_t2').onclick = function(){
      tab = 'all';
      this.classList.add('on'); pg.querySelector('#cv_t1').classList.remove('on'); pg.querySelector('#cv_t3').classList.remove('on'); draw();
    };
    pg.querySelector('#cv_t3').onclick = function(){
      tab = 'ledger';
      this.classList.add('on'); pg.querySelector('#cv_t1').classList.remove('on'); pg.querySelector('#cv_t2').classList.remove('on'); draw();
    };
    /* 整改单：设置页「小账本」按钮唯一入口——打开入口走顶层 cvEnsure */
    window.cvOpen = function(){ pg.classList.add('on'); draw(); };
  }
  /* V2 验收 Y14（2026-11-18）：#btn_cacheview 重复入口已撤（html 不再有该
     按钮），旧 bind() 死代码一并摘除——设置页「小账本」按钮为唯一入口。 */
  /* 整改单（2026-11-18）：设置页「小账本」按钮唯一入口——顶层暴露，未 build 过
     也先补 build（build 内部自防重复），保证任何入口点开即可用。 */
  window.cvEnsure = function(){ build(); };
})();
