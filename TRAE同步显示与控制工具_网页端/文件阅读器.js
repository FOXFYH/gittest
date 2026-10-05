'use strict';
/* ================= 文件阅读器（可移植自包含模块） =================
   移植方法：复制本文件 → 在页面 <script> 引入 → 点击处调
   FileRead.open(path) 即可；收到服务端 bench_read 应答时调
   FileRead.onData(v)。
   本模块自带 DOM 与 CSS（全屏覆盖层，手机竖版 TXT 阅读风），
   除发送钩子外不依赖宿主项目任何函数/变量。
   ★ 发送钩子：_send(t, params) —— 移植时若你的发送函数不叫
     sendJson，只改 _send 里那一行即可。 */
(function(){
  'use strict';

  /* ---- 发送钩子（移植时改这里：把 sendJson 换成你的发送函数） ---- */
  function _send(t, params){
    /* 默认实现：本项目宿主已有全局 sendJson(d)，d 形如 {t:..., ...} */
    if (typeof sendJson === 'function'){
      var d = {t: t};
      if (params){
        for (var k in params){
          if (Object.prototype.hasOwnProperty.call(params, k)) d[k] = params[k];
        }
      }
      sendJson(d);
    }
  }

  /* ---- 状态 ---- */
  var cur = null;         /* 当前阅读中的文件 {path, off, size} */
  var fontSize = 16;      /* 正文默认字号（14~24 循环） */

  function fmtSize(n){
    if (n == null) return '';
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(1) + 'K';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + 'M';
    return (n / 1073741824).toFixed(1) + 'G';
  }
  function baseName(p){
    return String(p || '').split(/[\\\/]/).pop() || p || '';
  }

  /* ---- DOM + CSS 注入（一次性） ---- */
  var box = null, ttl = null, pre = null, note = null, more = null, fbtn = null;

  function inject(){
    if (box) return;
    var st = document.createElement('style');
    st.textContent =
      '#freader{position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;' +
        'background:#fff;color:#222;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '#freader.on{display:flex}' +
      '#freader .fr_bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;' +
        'border-bottom:1px solid #e8e8e8;background:#fff}' +
      '#freader .fr_bar button{flex:none;min-width:38px;height:38px;border:1px solid #e8e8e8;' +
        'background:#fafafa;color:#222;border-radius:8px;font-size:16px;padding:0 8px}' +
      '#freader .fr_bar button:active{background:#e8e8e8}' +
      '#freader .fr_ttl{flex:1;min-width:0;font-size:14px;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#freader .fr_body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:0 0 60px}' +
      '#freader pre{margin:0;padding:14px 14px 60px;white-space:pre-wrap;word-break:break-word;' +
        'font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;' +
        'font-size:16px;line-height:1.75;color:#222}' +
      '#freader .fr_note{padding:20px 14px;color:#888;font-size:14px;text-align:center}' +
      '#freader .fr_more{display:block;width:calc(100% - 24px);margin:0 12px 40px;padding:12px;' +
        'border:1px solid #e8e8e8;background:#fafafa;color:#222;border-radius:8px;font-size:14px}' +
      '@media(prefers-color-scheme:dark){' +
        '#freader{background:#161616;color:#ddd}' +
        '#freader .fr_bar{background:#161616;border-color:#2c2c2c}' +
        '#freader .fr_bar button{background:#1e1e1e;color:#ddd;border-color:#2c2c2c}' +
        '#freader .fr_bar button:active{background:#2c2c2c}' +
        '#freader pre{color:#ddd}' +
        '#freader .fr_note{color:#888}' +
        '#freader .fr_more{background:#1e1e1e;color:#ddd;border-color:#2c2c2c}' +
      '}';
    document.head.appendChild(st);

    box = document.createElement('div');
    box.id = 'freader';
    box.innerHTML =
      '<div class="fr_bar">' +
        '<button class="fr_back" title="返回">←</button>' +
        '<span class="fr_ttl"></span>' +
        '<button class="fr_font" title="字号">A16</button>' +
      '</div>' +
      '<div class="fr_body">' +
        '<pre></pre>' +
        '<button class="fr_more" style="display:none"></button>' +
        '<div class="fr_note"></div>' +
      '</div>';
    document.body.appendChild(box);

    ttl = box.querySelector('.fr_ttl');
    pre = box.querySelector('pre');
    note = box.querySelector('.fr_note');
    more = box.querySelector('.fr_more');
    fbtn = box.querySelector('.fr_font');

    box.querySelector('.fr_back').onclick = close;
    fbtn.onclick = function(){                 /* 字号：14~24 循环 */
      fontSize = fontSize >= 24 ? 14 : fontSize + 2;
      pre.style.fontSize = fontSize + 'px';
      fbtn.textContent = 'A' + fontSize;
    };
    more.onclick = function(){ pull(); };       /* 继续加载 */
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && box.classList.contains('on')) close();
    });
  }

  function close(){
    if (box) box.classList.remove('on');
    cur = null;
  }

  function pull(){
    if (!cur) return;
    note.textContent = '读取中…';
    _send('bench_read', {p: cur.path, off: cur.off});
  }

  /* ---- 公开 API ---- */
  function open(path){
    inject();
    cur = {path: path, off: 0, size: 0};
    pre.textContent = '';
    note.textContent = '读取中…';
    more.style.display = 'none';
    ttl.textContent = baseName(path);
    box.classList.add('on');
    box.querySelector('.fr_body').scrollTop = 0;
    pull();
  }

  function onData(v){
    if (!cur || !box || !box.classList.contains('on')) return;
    if (v && v.path && cur.path && v.path !== cur.path) return;   /* 非本次阅读，忽略 */
    if (!v || !v.ok){ note.textContent = (v && v.err) || '读取失败'; return; }
    if (v.bin){                                  /* 二进制：给提示，不显示正文 */
      pre.textContent = '';
      more.style.display = 'none';
      note.textContent = v.err || '非文本文件';
      return;
    }
    if (v.err){ note.textContent = v.err; return; }              /* 如：文件过大 */
    note.textContent = '';
    pre.textContent += v.text || '';
    cur.size = v.size;
    ttl.textContent = baseName(cur.path) + '（' + fmtSize(v.size) + '）';
    if (v.next != null){
      cur.off = v.next;
      more.style.display = 'block';
      more.textContent = '继续加载（已到 ' + fmtSize(cur.off) + ' / ' + fmtSize(v.size) + '）';
    } else {
      more.style.display = 'none';
    }
  }

  window.FileRead = {open: open, onData: onData, close: close};
})();