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

   2.190（老板 2026-11-19 亲批·纠正口径：「那个显示预备画面的那个地方就是我认为的小账本」）：
     ① 与 ③ 曾各有一份「📒 我的小账本」，老板一句「难怪我说你怎么给我做了两个小账本」否定，
     现将 ③ 页那份（renderLbCards 整块，含 readLedgerRows/delLedgerRow/lbTimeText/midEllipsis）
     连样式一并删除，③ 页只留七项调控，另把原属 ① 的「预备账册参数」挪到 ③ 顶部；
     「小账本」唯一落点＝① 会话预备画面。
     ① 卡片改四行、行序固定：服务器归属「宿舍 · 1309107889」→ 终身号（等宽/中途省略，
     无号显「⏳ 待补号」）→ 会话名 →「N 条 · 更新于 MM-DD HH:MM」（当前会话追加「● 当前会话」）；
     按 ts 倒序、按服务器分割；右上角 🗑 二次确认只删本机预备画面缓存（snap_conv），不动服务器与 TRAE。
     数据层：snap_conv 记录补 srv/srvName/srvFox/sid/title 五维（缓存.js _frameCommit），
     readSnapConvs() 只取 srv === lbSrvTag() 的本机服，老记录不显示但报条数；
     读取加 6 秒兜底——IDB 请求悬挂（被旧连接 block）时不再永远停在「读取中…」。
     抽屉「📒 小账本」入口一律落 ①（tab='preview'）。

   2.191（收尾·老板手机会突然看到小账本变空的那个坑）：未标 srv 的老缓存做
     一次性保守迁移——只有 sid（缺则 sk 的 '|' 后半段）能在当前会话列表
     （S.convs / S.snap.convs_full）里找到同一会话，才补 srv/srvName/srvFox；
     对不上的宁可不迁、继续隐藏（跨服串显是红线，绝不猜）。只补这三个字段，
     sk/frame/msgs 一字不动；localStorage.trae_webm_srv_migrated='2.191' 只跑一次；
     会话列表还没到（冷开）时不跑、也不写标记，等下次读再迁。

   2.10（老板 2026-11-05 20:17）：
     · 预备画面列表改「两行一张卡片」的网格——第 1 行会话名，第 2 行时间/条数/是否当前生效；
       点卡片进入该会话的详情，顶部返回列表（不再一条占四行、也不再全堆在左侧）。
     · 详情里的人类发言**复用主代码同一条渲染管线**（stripHeadDid + _mdBody + foxHintBind）：
       服务端追加的专属词前后缀（(@fox-sys1)… 等）自动折叠成「系统/自定/人定/岗位」小按钮，
       与主界面显示一字一致。 */
(function(){
  /* 2.190（老板：进来看到标题还写着 2.17，怀疑「我们讲的不是同一个地方」）：
     CV_VER 不再手写死——运行时直接取页面总版本 VER（诊断.js，全局可见），
     取不到才退回本地兜底常量。铁规矩：**每次动查看器都必须让 CV_VER 与页面
     VER 恒等**；build() 里再自检一次，不一致打 bad 日志。 */
  var CV_VER = (typeof VER === 'string' && VER) ? VER : '2.191';
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
      /* 2.190（老板纠正：小账本＝① 会话预备画面）：卡片四行、行序固定
         （服务器 → 终身号 → 会话名 → 条数/更新于），右上角 🗑；③ 页那套
         第二本账的样式（cv_lbcard/cv_lbid/cv_lbsrv…）随功能一并删除。 */
      '.cv_card{position:relative;justify-content:flex-start}' +
      '.cv_l1{font-size:12px;color:#6b7a89;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;padding-right:70px}' +
      '.cv_lid{margin-top:3px;font-size:14px;font-weight:600;color:#1f2d3d;font-family:Menlo,monospace;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:70px}' +
      '.cv_lid.cv_lbpending{color:#b58900;font-weight:500;font-family:inherit;font-size:13px}' +
      '.cv_l3{margin-top:3px;font-size:13px;color:#337ab7;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis;padding-right:70px}' +
      '.cv_l4{margin-top:3px;font-size:11px;color:#8a98a6;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis}' +
      '.cv_l4 .cv_lbcur{margin-left:4px;font-size:11px;color:#8a98a6}' +
      '.cv_lbdel{position:absolute;right:8px;top:8px;border:1px solid #f0c6c2;background:#fff;' +
        'color:#c62828;border-radius:8px;padding:4px 7px;font-size:11px}' +
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
  /* 2.191（保守迁移·老板红线：跨服串显绝不猜）：只给「能证明属于当前登录服务器」
     的老记录补 srv/srvName/srvFox 三字段。证明方式＝该记录 sid（缺失则取 sk 的
     '|' 后半段）能在当前会话列表（S.convs 行 / S.snap.convs_full）里找到同一会话；
     找不到一律不迁移、继续按「未标服务器」隐藏。sk / frame / msgs 一字不动（改了会白屏）。 */
  function _migSidOf(x){
    var sid = String((x && x.sid) || '');
    if (!sid){
      var sk = String((x && x.sk) || ''), i = sk.indexOf('|');
      if (i >= 0) sid = sk.slice(i + 1);
      if (sid === '@snap' || !/^[0-9A-Za-z_-]{4,}$/.test(sid)) sid = '';
    }
    return sid;
  }
  function _convsReady(){
    try {
      if (S && Array.isArray(S.convs) && S.convs.length) return true;
      if (S && S.snap && Array.isArray(S.snap.convs_full) && S.snap.convs_full.length) return true;
    } catch(e){}
    return false;
  }
  function _migInConvs(sid){
    if (!sid) return false;
    var rows = [], cf = [];
    try { rows = (S && Array.isArray(S.convs)) ? S.convs : []; } catch(e){ rows = []; }
    try { cf = (S && S.snap && Array.isArray(S.snap.convs_full)) ? S.snap.convs_full : []; } catch(e){ cf = []; }
    var hit = function(full){
      full = String(full || '');
      if (!full) return false;
      if (full === sid) return true;
      try {
        if (typeof 稳定键 === 'function' && 稳定键(full, '') === 稳定键(sid, '')) return true;
      } catch(e){}
      return false;
    };
    for (var i = 0; i < rows.length; i++){
      if (rows[i] && hit(rows[i][4])) return true;
    }
    for (var j = 0; j < cf.length; j++){
      if (cf[j] && hit(cf[j].sid)) return true;
    }
    return false;
  }
  function migrateSrv(list){
    var todo = [], i;
    for (i = 0; i < list.length; i++){
      var x = list[i];
      if (String(x.srv || '').trim()) continue;          /* 已有归属，不动 */
      if (!_migInConvs(_migSidOf(x))) continue;          /* 证明不了，宁可不迁 */
      todo.push(x);
    }
    if (!todo.length) return Promise.resolve(0);
    var tag = '', nm = '', fx = '';
    try { tag = String(lbSrvTag() || ''); } catch(e){ tag = ''; }
    try { nm = String(lbSrvName() || ''); } catch(e){ nm = ''; }
    try { fx = String(lbSrvFox() || ''); } catch(e){ fx = ''; }
    if (!tag) return Promise.resolve(0);
    return openSnapDB().then(function(db){
      return new Promise(function(res){
        var done = false;
        var timer = setTimeout(function(){
          if (done) return; done = true;
          try { db.close(); } catch(e){}
          res(0);
        }, 6000);
        var tx = db.transaction('snap_conv', 'readwrite'), st = tx.objectStore('snap_conv');
        todo.forEach(function(x){
          var v = x._raw || {};
          if (!v || !v.sk) return;
          var sid = _migSidOf(x);
          v.srv = tag; v.srvName = nm; v.srvFox = fx;
          /* 2.191：sk 的后半段本身就是 sid（_frameMemKey＝'frame|'+sid），既然已用它
             证明归属，就顺手把空 sid 补上——只补这一个普通字段，sk/frame/msgs 不碰。 */
          if (!v.sid && sid) v.sid = sid;
          try { st.put(v); } catch(e){}
        });
        tx.oncomplete = function(){
          if (done) return; done = true; clearTimeout(timer);
          try { db.close(); } catch(e){}
          todo.forEach(function(x){
            x.srv = tag; x.srvName = nm; x.srvFox = fx;
            if (!x.sid){ var s2 = _migSidOf(x); if (s2) x.sid = s2; }
          });
          res(todo.length);
        };
        tx.onerror = function(){
          if (done) return; done = true; clearTimeout(timer);
          try { db.close(); } catch(e){}
          res(0);
        };
      });
    }).catch(function(){ return 0; });
  }
  function readSnapConvs(){
    return openSnapDB().then(function(db){
      return new Promise(function(res){
        if (!db.objectStoreNames.contains('snap_conv')){ db.close(); return res({all:[], timeout:false}); }
        /* 2.190：加 6 秒兜底——IDB open 被别的旧连接挡住（onblocked）时请求永不
           落地，读取会永远停在「读取中…」（老板看到的那张卡卡死的真因）。超时按空表返回。 */
        var done = false, timer = setTimeout(function(){
          if (done) return; done = true;
          try { db.close(); } catch(e){}
          res({all: [], timeout: true});
        }, 6000);
        var fin = function(v){ if (done) return; done = true; clearTimeout(timer); res(v); };
        var tx = db.transaction('snap_conv', 'readonly'), out = [];
        var rq = tx.objectStore('snap_conv').openCursor();
        rq.onsuccess = function(){
          var c = rq.result;
          if (c){
            var v = c.value || {};
            out.push({sk: v.sk || c.key, key: v.key || '', title: v.title || '', sid: v.sid || '',
                      srv: v.srv || '', srvName: v.srvName || '', srvFox: v.srvFox || '',
                      port: v.port, ts: v.ts || 0,
                      n: (v.frame && v.frame.msgs || []).length,
                      msgs: (v.frame && v.frame.msgs) || [],
                      _raw: v});
            c.continue();
          }
        };
        tx.oncomplete = function(){ db.close(); fin({all: out, timeout: false}); };
        tx.onerror = function(){ db.close(); fin({all: out, timeout: false}); };
      });
    }).then(function(r){
      var all = (r && r.all) || [], timedOut = !!(r && r.timeout);
      var cur = '';
      try { cur = (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : ''; } catch(e){ cur = ''; }
      /* 2.191：未标服务器的老记录做一次性保守迁移。会话列表还没到（冷开）时
         不能跑——跑了必然全对不上，还会把一次性标记锁死，老记录就永远回不来。 */
      var mp = Promise.resolve(0), flag = '';
      try { flag = localStorage.getItem('trae_webm_srv_migrated') || ''; } catch(e){ flag = ''; }
      if (!timedOut && flag !== '2.191' && all.length && _convsReady()){
        mp = migrateSrv(all).then(function(n){
          try { localStorage.setItem('trae_webm_srv_migrated', '2.191'); } catch(e){}
          return n;
        });
      }
      return mp.then(function(migrated){
        /* 2.190（老板：只显示当前登录服务器的预备画面）：写 srv 与读时过滤，
           同一个函数 lbSrvTag() 算的同一个值；没有 srv 的老缓存不显示、只报条数。 */
        var hidden = 0, list = all;
        if (cur){
          list = all.filter(function(x){
            var ok = String(x.srv || '') === cur;
            if (!ok) hidden++;
            return ok;
          });
        }
        list.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
        return {list: list, hidden: hidden, timeout: timedOut, migrated: (migrated || 0)};
      });
    }).catch(function(){ return {list: [], hidden: 0, timeout: false, migrated: 0}; });
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
    /* 2.190：① 只留卡片网格（唯一小账本）；「预备账册参数」已挪到 ③ 配套调控区。 */
    var s = document.createElement('div');
    s.className = 'cv_sec';
    s.innerHTML = '<h3>会话预备画面 <span class="n">读取中…</span></h3>';
    host.appendChild(s);
    readSnapConvs().then(function(r){
      var list = (r && r.list) || [], _hid = (r && r.hidden) || 0;
      s.querySelector('.n').textContent = list.length + ' 个会话有本地预备画面'
        + (_hid ? (' · 另有 ' + _hid + ' 条其它服务器/无服务器标记的缓存已隐藏') : '');
      if (!list.length){
        s.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty',
          textContent: (r && r.timeout) ? '读取超时（缓存库被占用），稍后点「刷新」再看'
                                        : '（本地还没有任何会话存帧）'}));
        return;
      }
      var grid = document.createElement('div');
      grid.className = 'cv_grid';
      grid.style.marginTop = '10px';
      var seen = {};
      list.forEach(function(it){
        var dup = it.sid && seen[it.sid];
        if (it.sid) seen[it.sid] = true;
        var sid = String(it.sid || '');
        /* 2.190（老板：小账本＝①，卡片行序按 V1.0 §十-353 定死）：
           ① 服务器归属「宿舍 · 1309107889」 ② 终身号 ③ 会话名 ④ N 条/更新于。 */
        var _sn = String(it.srvName || '').trim();
        var _fx = String(it.srvFox || '').trim();
        if (!_sn){ try { _sn = (typeof lbSrvName === 'function') ? String(lbSrvName() || '') : ''; } catch(e){ _sn = ''; } }
        if (!_fx && /^\d+$/.test(String(it.srv || ''))) _fx = String(it.srv);
        var srvTxt = (_sn || _fx) ? ((_sn || '未知服务器') + (_fx ? (' · ' + _fx) : '')) : '服务器未知';
        var sidTxt = sid ? (sid.length > 18 ? (sid.slice(0, 9) + '…' + sid.slice(-8)) : sid) : '⏳ 待补号';
        var dt = it.ts ? new Date(it.ts) : null;
        var p2 = function(x){ return (x < 10 ? '0' : '') + x; };
        var tsTxt = dt ? (p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' '
                         + p2(dt.getHours()) + ':' + p2(dt.getMinutes())) : '—';
        var _cur = '';
        try { _cur = (typeof curSid === 'function') ? String(curSid() || '') : ''; } catch(e){ _cur = ''; }
        var isCur = !!sid && (_cur ? (sid === _cur)
          : (!!S.anchorSid && typeof 稳定键 === 'function'
             && 稳定键(sid, it.title || '') === String(S.anchorSid)));
        var card = document.createElement('div');
        card.className = 'cv_card';
        card.innerHTML = '<div class="cv_l1">' + esc(srvTxt) + '</div>' +
          '<div class="cv_lid' + (sid ? '' : ' cv_lbpending') + '">' + esc(sidTxt) + '</div>' +
          '<div class="cv_l3">' + esc(it.title || '（无名会话）') + (dup ? ' · 重复' : '') + '</div>' +
          '<div class="cv_l4">' + esc(it.n + ' 条 · 更新于 ' + tsTxt)
            + (isCur ? '<span class="cv_lbcur">● 当前会话</span>' : '') + '</div>';
        var del = document.createElement('button');
        del.className = 'cv_lbdel';
        del.textContent = '🗑';
        del.title = '删除这条本地预备画面缓存';
        del.onclick = function(ev){
          try { ev.stopPropagation(); } catch(e){}
          if (!window.confirm('删除这条本地预备画面？\n会话：' + (it.title || sid || it.sk)
              + '\n（只删本机预备画面缓存，不影响服务器与 TRAE 会话）')) return;
          del.disabled = true;
          var sk = it.sk;
          openSnapDB().then(function(db){
            return new Promise(function(res, rej){
              var tx = db.transaction('snap_conv', 'readwrite');
              tx.objectStore('snap_conv').delete(sk);
              tx.oncomplete = function(){ db.close(); res(true); };
              tx.onerror = function(){ db.close(); rej(tx.error); };
            });
          }).then(function(){
            try { if (_frameMem && typeof _frameMem === 'object' && sk) delete _frameMem[sk]; } catch(e){}
            renderPreview(host);
          }).catch(function(e){
            del.disabled = false;
            alert('删除失败：' + ((e && e.message) || e));
          });
        };
        card.appendChild(del);
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

  /* ---------- ③ 账本调控（整改单 2026-11-18：原「小账本页.js」调控区并入此处） ----------
     规范§九-4：倒计时以「每秒递减的数字」展示在本区（#cv_lb_hud），不做悬浮窗；
     任意操作会重置倒计时 → 人操作时数字不降属正常设计。数值来源＝账本核对.js
     的 window.lbHudText()（每秒由下方 interval 刷新，仅本 tab 可见时更新）。 */
  function renderLedgerCtl(host){
    host.innerHTML = '';
    /* 2.190（老板纠正口径：小账本＝① 会话预备画面，③ 只放配套调控功能）：
       原「📒 我的小账本」第二本账整块删除（renderLbCards/readLedgerRows/
       delLedgerRow 一并删，不是隐藏）；③ 顶部改放从 ① 挪来的「预备账册参数」——
       它是配套参数，不是账本本体。 */
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
      '<div class="cv_lbhint">以上为账本系统 V1.0 全部调控项（唯一集中入口）。小账本本体在「① 会话预备画面」，本页只放配套调控；原始记录仍可在「② 全部缓存」展开 IndexedDB · trae_webm_idb · ledger_conv。</div>';
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
    /* 2.190 自检：查看器版本必须与页面总版本恒等（不一致＝有人漏改，打 bad 日志） */
    if (typeof VER === 'string' && VER && CV_VER !== VER){
      try { if (typeof diagLog === 'function')
        diagLog('版本不同步 查看器=' + CV_VER + ' 页面=' + VER, 'bad'); } catch(e){}
    }
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
    /* 2.190（老板：点「📒 小账本」应该直接看到账本本体＝① 会话预备画面） */
    window.cvOpen = function(){
      tab = 'preview'; view = 'list'; detailItem = null;
      var b1 = pg.querySelector('#cv_t1'), b2 = pg.querySelector('#cv_t2'), b3 = pg.querySelector('#cv_t3');
      if (b1) b1.classList.add('on'); if (b2) b2.classList.remove('on'); if (b3) b3.classList.remove('on');
      pg.classList.add('on'); draw();
    };
  }
  /* V2 验收 Y14（2026-11-18）：#btn_cacheview 重复入口已撤（html 不再有该
     按钮），旧 bind() 死代码一并摘除——设置页「小账本」按钮为唯一入口。 */
  /* 整改单（2026-11-18）：设置页「小账本」按钮唯一入口——顶层暴露，未 build 过
     也先补 build（build 内部自防重复），保证任何入口点开即可用。 */
  window.cvEnsure = function(){ build(); };
})();
