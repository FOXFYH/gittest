'use strict';
/* 手机缓存查看器.js（网页端）  版本 1.01  日期 2026-11-05
   老板要求：左侧菜单「设置页」下面加一个按钮，进入后全量展示手机上存的东西：
     ① LocalStorage 全部键值（按 登录与连接 / 会话与消息缓存 / 界面与偏好 / 其他 归类）
     ② IndexedDB 全部数据库 → 全部表 → 全部记录（点开才读，避免卡顿）
     ③ 存储占用概览
   纯诊断：只读，不写不删不改任何缓存。 */
(function(){
  var built = false;

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
      '#cv_bd{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 10px 40px}' +
      '.cv_sec{background:#fff;border-radius:12px;margin:0 0 12px;overflow:hidden;border:1px solid #e6ebf0}' +
      '.cv_sec>h3{margin:0;padding:12px 14px;font-size:15px;font-weight:600;background:#eef4fb;border-bottom:1px solid #e6ebf0}' +
      '.cv_sec>h3 .n{font-size:12px;color:#6b7b8c;font-weight:400}' +
      '.cv_row{padding:10px 14px;border-bottom:1px solid #f1f4f7}' +
      '.cv_row:last-child{border-bottom:0}' +
      '.cv_k{font-size:13px;color:#337ab7;word-break:break-all;font-family:Menlo,monospace}' +
      '.cv_meta{font-size:11px;color:#8a98a6;margin-top:3px;white-space:pre-wrap}' +
      '.cv_v{margin:6px 0 0;padding:8px;background:#fafbfc;border:1px solid #eef1f4;border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;font-family:Menlo,monospace}' +
      '.cv_db{padding:10px 14px;border-bottom:1px solid #f1f4f7}' +
      '.cv_db .nm{font-size:14px;font-weight:600;word-break:break-all}' +
      '.cv_store{margin:8px 0 0 8px;padding:8px 10px;background:#fafbfc;border-radius:8px;border:1px solid #eef1f4}' +
      '.cv_store .sn{font-size:13px;color:#444}' +
      '.cv_rec{margin:6px 0 0}' +
      '.cv_rec summary{cursor:pointer;font-size:12px;color:#337ab7;word-break:break-all}' +
      '.cv_empty{padding:14px;font-size:13px;color:#8a98a6}' +
      '.cv_bad{padding:10px 14px;font-size:12px;color:#c62828}';
    document.head.appendChild(st);
  }

  function fmtSize(n){
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function esc(s){
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function jsonText(v){
    try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); }
    catch(e){ return String(v); }
  }
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
    out.sort(function(a, b){ return b.n - a.n; });
    return out;
  }

  function idbNames(){
    return new Promise(function(resolve){
      try {
        if (indexedDB.databases){
          indexedDB.databases().then(function(dbs){
            resolve((dbs || []).map(function(d){ return d && d.name; }).filter(Boolean));
          }).catch(function(){ resolve([]); });
        } else resolve([]);
      } catch(e){ resolve([]); }
    });
  }
  function openDB(name){
    return new Promise(function(res, rej){
      var rq;
      try { rq = indexedDB.open(name); } catch(e){ return rej(e); }
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('open failed')); };
      rq.onblocked = function(){ rej(new Error('blocked')); };
    });
  }
  function storeAll(db, sn){
    return new Promise(function(res){
      var rows = [], err = null, tx;
      try { tx = db.transaction(sn, 'readonly'); } catch(e){ return res({rows: [], err: e}); }
      var st = tx.objectStore(sn), rq;
      try { rq = st.openCursor(); } catch(e){ return res({rows: [], err: e}); }
      rq.onsuccess = function(ev){
        var cur = ev.target.result;
        if (cur){ rows.push({key: cur.key, value: cur.value}); cur.continue(); }
      };
      rq.onerror = function(){ err = rq.error; };
      tx.oncomplete = function(){ res({rows: rows, err: err}); };
      tx.onerror = function(){ res({rows: rows, err: err || tx.error}); };
      tx.onabort = function(){ res({rows: rows, err: err || tx.error}); };
    });
  }

  function sec(title, count){
    var d = document.createElement('div');
    d.className = 'cv_sec';
    d.innerHTML = '<h3>' + esc(title) + ' <span class="n">' + esc(count || '') + '</span></h3>';
    return d;
  }
  function rowKV(k, v, meta){
    /* 2026-11-05 修正（老板：一点就死机）：值体量可能几十 MB（历史缓存），
       一次性全部塞进 DOM 会把手机卡死。改为**折叠**：默认只显示键名+大小，
       点开才把完整值放进来——仍然是全量，只是按需渲染。 */
    var d = document.createElement('details');
    d.className = 'cv_row';
    var sum = document.createElement('summary');
    sum.className = 'cv_k';
    sum.textContent = k + '  ' + (meta || '');
    d.appendChild(sum);
    var loaded = false;
    d.addEventListener('toggle', function(){
      if (!d.open || loaded) return;
      loaded = true;
      var box = document.createElement('div');
      box.className = 'cv_v';
      box.textContent = v;
      d.appendChild(box);
    });
    return d;
  }

  function renderAll(host){
    host.innerHTML = '';
    var ov = sec('概览', '');
    var lsAll = readLS();
    var lsBytes = lsAll.reduce(function(s, x){ return s + x.n; }, 0);
    var o = document.createElement('div');
    o.className = 'cv_row';
    o.innerHTML = '<div class="cv_meta">' + esc(
      '页面：' + location.href + '\n' +
      '时间：' + new Date().toLocaleString() + '\n' +
      'LocalStorage：' + lsAll.length + ' 项，约 ' + fmtSize(lsBytes)) + '</div>';
    ov.appendChild(o);
    host.appendChild(ov);
    if (navigator.storage && navigator.storage.estimate){
      navigator.storage.estimate().then(function(e){
        o.querySelector('.cv_meta').textContent += '\n存储占用：已用 ' + fmtSize(e.usage) + ' / 配额 ' + fmtSize(e.quota);
      }).catch(function(){});
    }

    ['登录与连接', '会话与消息缓存', '界面与偏好', '其他'].forEach(function(cat){
      var items = lsAll.filter(function(x){ return classify(x.k) === cat; });
      var s = sec('LocalStorage · ' + cat, items.length + ' 项，约 ' + fmtSize(items.reduce(function(a,b){ return a + b.n; }, 0)));
      if (!items.length) s.appendChild(Object.assign(document.createElement('div'), {className: 'cv_empty', textContent: '（无）'}));
      else items.forEach(function(x){ s.appendChild(rowKV(x.k, x.v, fmtSize(x.n))); });
      host.appendChild(s);
    });

    var idbSec = sec('IndexedDB · 全部数据库', '读取中…');
    host.appendChild(idbSec);
    idbNames().then(function(names){
      if (!names.length){
        idbSec.querySelector('.n').textContent = '0 个库';
        idbSec.appendChild(Object.assign(document.createElement('div'),
          {className: 'cv_bad', textContent: '浏览器未提供数据库清单（部分手机浏览器不支持 indexedDB.databases），请在电脑端查看。'}));
        return;
      }
      idbSec.querySelector('.n').textContent = names.length + ' 个库';
      names.forEach(function(nm){
        openDB(nm).then(function(db){
          var blk = document.createElement('div');
          blk.className = 'cv_db';
          blk.innerHTML = '<div class="nm">' + esc(nm) + ' <span class="cv_meta">v' + esc(db.version) + ' / ' + db.objectStoreNames.length + ' 个表</span></div>';
          for (var si = 0; si < db.objectStoreNames.length; si++){
            (function(sn){
              var stDiv = document.createElement('div');
              stDiv.className = 'cv_store';
              stDiv.innerHTML = '<div class="sn">📦 ' + esc(sn) + ' <span class="cv_meta">（点开查看全量记录）</span></div>';
              var det = document.createElement('details');
              det.className = 'cv_rec';
              det.innerHTML = '<summary>展开读取全部记录</summary>';
              var loaded = false;
              det.addEventListener('toggle', function(){
                if (!det.open || loaded) return;
                loaded = true;
                var wrap = document.createElement('div');
                wrap.textContent = '读取中…';
                det.appendChild(wrap);
                storeAll(db, sn).then(function(r){
                  wrap.innerHTML = '';
                  if (r.err) wrap.appendChild(Object.assign(document.createElement('div'),
                    {className: 'cv_bad', textContent: '读取失败：' + (r.err.message || r.err)}));
                  wrap.appendChild(Object.assign(document.createElement('div'),
                    {className: 'cv_meta', textContent: '共 ' + r.rows.length + ' 条记录'}));
                  if (!r.rows.length) wrap.appendChild(Object.assign(document.createElement('div'),
                    {className: 'cv_empty', textContent: '（空表）'}));
                  r.rows.forEach(function(x, i){
                    var t = jsonText(x.value);
                    var dd = document.createElement('details');
                    dd.className = 'cv_rec';
                    dd.innerHTML = '<summary>' + esc('#' + (i + 1) + ' 键=' + jsonText(x.key).slice(0, 60) + '（' + fmtSize(t.length) + '）') +
                      '</summary><div class="cv_v">' + esc(t) + '</div>';
                    wrap.appendChild(dd);
                  });
                }).catch(function(e){
                  wrap.innerHTML = '';
                  wrap.appendChild(Object.assign(document.createElement('div'), {className: 'cv_bad', textContent: '读取失败：' + e}));
                });
              });
              stDiv.appendChild(det);
              blk.appendChild(stDiv);
            })(db.objectStoreNames[si]);
          }
          db.close();
          idbSec.appendChild(blk);
        }).catch(function(e){
          idbSec.appendChild(Object.assign(document.createElement('div'), {className: 'cv_bad', textContent: nm + '：打开失败（' + (e && e.message) + '）'}));
        });
      });
    });
  }

  function dumpJson(){
    var ls = {};
    readLS().forEach(function(x){ ls[x.k] = x.v; });
    return idbNames().then(function(names){
      var jobs = names.map(function(nm){
        return openDB(nm).then(function(db){
          var o = {'版本': db.version, '表': {}};
          var chain = Promise.resolve();
          Array.prototype.forEach.call(db.objectStoreNames, function(sn){
            chain = chain.then(function(){
              return storeAll(db, sn).then(function(r){
                o['表'][sn] = r.rows.map(function(x){ return {'键': x.key, '值': x.value}; });
              });
            });
          });
          return chain.then(function(){ db.close(); return [nm, o]; });
        }).catch(function(e){ return [nm, {'打开失败': String(e)}]; });
      });
      return Promise.all(jobs).then(function(list){
        var idb = {};
        list.forEach(function(p){ idb[p[0]] = p[1]; });
        return jsonText({'导出时间': new Date().toLocaleString(), '地址': location.href, 'LocalStorage': ls, 'IndexedDB': idb});
      });
    });
  }

  function build(){
    if (built) return;
    built = true;
    injectStyle();
    var pg = document.createElement('div');
    pg.id = 'cv_page';
    pg.innerHTML = '<div id="cv_hd"><button id="cv_back">‹ 返回</button><div class="t">手机缓存查看器</div>' +
      '<button id="cv_reload">刷新</button><button id="cv_copy">复制全部</button></div><div id="cv_bd"></div>';
    document.body.appendChild(pg);
    var bd = pg.querySelector('#cv_bd');
    pg.querySelector('#cv_back').onclick = function(){ pg.classList.remove('on'); };
    pg.querySelector('#cv_reload').onclick = function(){ renderAll(bd); };
    pg.querySelector('#cv_copy').onclick = function(){
      var btn = this;
      dumpJson().then(function(txt){
        try {
          if (navigator.clipboard && navigator.clipboard.writeText){
            navigator.clipboard.writeText(txt).then(function(){ btn.textContent = '已复制'; },
              function(){ fallback(txt, btn); });
          } else fallback(txt, btn);
        } catch(e){ fallback(txt, btn); }
        setTimeout(function(){ btn.textContent = '复制全部'; }, 1800);
      });
    };
    function fallback(txt, btn){
      var ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); btn.textContent = '已复制'; } catch(e){ btn.textContent = '复制失败'; }
      document.body.removeChild(ta);
    }
    window.cvOpen = function(){ pg.classList.add('on'); renderAll(bd); };
  }

  function bind(){
    var btn = document.getElementById('btn_cacheview');
    if (!btn) return;
    btn.onclick = function(){
      build();
      if (typeof drawerClose === 'function') drawerClose();
      window.cvOpen();
    };
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bind);
  } else bind();
})();