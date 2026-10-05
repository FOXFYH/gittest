'use strict';
/* ================= 文件阅读器（可移植自包含模块） =================
   移植方法：复制本文件 → 在页面 <script> 引入 → 点击处调
   FileRead.open(path) 即可；收到服务端 bench_read 应答时调
   FileRead.onData(v)，收到 bench_write 应答时调 FileRead.onSaved(v)。
   本模块自带 DOM 与 CSS（全屏覆盖层，手机竖版 TXT 阅读风），
   除发送钩子外不依赖宿主项目任何函数/变量。
   2.33：顶部 ✎ 就地编辑（不弹窗，直接出光标）→ 💾 保存写回电脑原文件。
   2.34：字号落盘 localStorage——调好一次长期生效，不必每回重调。
   2.36：去掉自带右键/长按小菜单——复制/粘贴等改用浏览器原生菜单
         （自绘菜单与原生菜单会重叠，故取消）。
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
  /* 正文字号：A- / A+ 手动调节，下限 6 号（用户 2026-10-05 要求）
     2.34：字号落盘 localStorage——调好一次长期生效，不必每回重调。 */
  var MIN_FONT = 6, MAX_FONT = 24, FONT_STEP = 2;
  var FONT_KEY = 'trae_freader_font';
  var fontSize = 16;
  (function(){                 /* 读回落盘字号（缺失/非法/越界则回落 16） */
    try{
      var v = parseInt(localStorage.getItem(FONT_KEY), 10);
      if (v >= MIN_FONT && v <= MAX_FONT) fontSize = v;
    }catch(e){}
  })();

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
  var box = null, ttl = null, pre = null, note = null, more = null,
      fm = null, fp = null, fsz = null,
      ed = null, saveBtn = null, cancelBtn = null;
  var origText = '';          /* 进入编辑时的原文本（取消时还原） */
  var pendingEdit = false;    /* 未读完就点 ✎：先自动续读到底再进编辑 */
  function applyFont(){            /* 应用当前字号到正文 + 刷新读数 */
    if (pre) pre.style.fontSize = fontSize + 'px';
    if (fsz) fsz.textContent = fontSize;
  }
  function saveFont(){             /* 字号落盘（本机记住，长期生效） */
    try{ localStorage.setItem(FONT_KEY, String(fontSize)); }catch(e){}
  }

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
      '#freader .fr_fsz{flex:none;min-width:26px;text-align:center;font-size:14px;color:#666}' +
      '#freader .fr_body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:0 0 60px}' +
      '#freader pre{margin:0;padding:14px 14px 60px;white-space:pre-wrap;word-break:break-word;' +
        'font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;' +
        'font-size:16px;line-height:1.75;color:#222}' +
      '#freader .fr_note{padding:20px 14px;color:#888;font-size:14px;text-align:center}' +
      '#freader .fr_more{display:block;width:calc(100% - 24px);margin:0 12px 40px;padding:12px;' +
        'border:1px solid #e8e8e8;background:#fafafa;color:#222;border-radius:8px;font-size:14px}' +
      '#freader .fr_save,#freader .fr_cancel{display:none}' +
      '#freader.edit .fr_ed,#freader.edit .fr_fm,#freader.edit .fr_fsz,#freader.edit .fr_fp{display:none}' +
      '#freader.edit .fr_save,#freader.edit .fr_cancel{display:inline-block}' +
      '#freader pre[contenteditable="true"]{outline:none;background:#fbfbf7}' +
      '@media(prefers-color-scheme:dark){' +
        '#freader{background:#161616;color:#ddd}' +
        '#freader .fr_bar{background:#161616;border-color:#2c2c2c}' +
        '#freader .fr_bar button{background:#1e1e1e;color:#ddd;border-color:#2c2c2c}' +
        '#freader .fr_bar button:active{background:#2c2c2c}' +
        '#freader pre{color:#ddd}' +
        '#freader pre[contenteditable="true"]{background:#1c1c1c}' +
        '#freader .fr_fsz{color:#aaa}' +
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
        '<button class="fr_ed" title="编辑">✎</button>' +
        '<button class="fr_save" title="保存到电脑">💾 保存</button>' +
        '<button class="fr_cancel" title="取消编辑">✖ 取消</button>' +
        '<button class="fr_fm" title="缩小字号">A-</button>' +
        '<span class="fr_fsz">16</span>' +
        '<button class="fr_fp" title="放大字号">A+</button>' +
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
    fm = box.querySelector('.fr_fm');
    fp = box.querySelector('.fr_fp');
    fsz = box.querySelector('.fr_fsz');
    ed = box.querySelector('.fr_ed');
    saveBtn = box.querySelector('.fr_save');
    cancelBtn = box.querySelector('.fr_cancel');

    box.querySelector('.fr_back').onclick = close;
    ed.onclick = enterEdit;
    saveBtn.onclick = saveEdit;
    cancelBtn.onclick = cancelEdit;
    fm.onclick = function(){                   /* A-：缩小，下限 6 号 */
      fontSize = Math.max(MIN_FONT, fontSize - FONT_STEP);
      applyFont();
      saveFont();
    };
    fp.onclick = function(){                   /* A+：放大，上限 24 号 */
      fontSize = Math.min(MAX_FONT, fontSize + FONT_STEP);
      applyFont();
      saveFont();
    };
    more.onclick = function(){ pull(); };       /* 继续加载 */
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && box.classList.contains('on')){
        if (box.classList.contains('edit')) cancelEdit(); else close();
      }
    });
  }

  function close(){
    if (box){
      pre.contentEditable = 'false';
      box.classList.remove('edit');
      box.classList.remove('on');
    }
    cur = null;
    pendingEdit = false;
  }

  function pull(){
    if (!cur) return;
    note.textContent = '读取中…';
    _send('bench_read', {p: cur.path, off: cur.off});
  }

  /* ---- 编辑 / 保存（2.33：顶部 ✎ 就地编辑 → 💾 写回电脑原文件）---- */
  function readEditText(){        /* 取编辑框全文，按原文行尾还原 CRLF */
    var t = pre.innerText || '';
    if (cur && cur.eol === '\r\n') t = t.replace(/\r?\n/g, '\r\n');
    return t;
  }
  function enterEdit(){           /* ✎：未读完先自动续读到底，再进编辑 */
    if (!cur || !box.classList.contains('on')) return;
    if (cur.next != null){
      pendingEdit = true;
      more.style.display = 'none';
      pull();
      note.textContent = '正在载入全部内容以便编辑…';
      return;
    }
    doEnterEdit();
  }
  function doEnterEdit(){
    pendingEdit = false;
    origText = pre.textContent;
    pre.contentEditable = 'true';
    pre.spellcheck = false;
    box.classList.add('edit');
    note.textContent = '编辑中——改完点顶部「💾 保存」写回电脑';
    try{                        /* 光标落到末尾，免弹窗、直接就位可敲 */
      pre.focus();
      var r = document.createRange();
      r.selectNodeContents(pre); r.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
    }catch(e){}
  }
  function cancelEdit(){          /* ✖：还原原文本、退出编辑 */
    pre.contentEditable = 'false';
    pre.textContent = origText;
    box.classList.remove('edit');
    note.textContent = '';
  }
  function saveEdit(){            /* 💾：把全文写回电脑上的原文件 */
    if (!cur || !box.classList.contains('edit')) return;
    note.textContent = '保存中…';
    _send('bench_write', {p: cur.path, text: readEditText(),
                          enc: cur.enc || ''});
  }
  function onSaved(v){            /* 服务端 bench_write 应答 */
    if (!cur || !box || !box.classList.contains('on')) return;
    if (v && v.ok){
      pre.contentEditable = 'false';
      box.classList.remove('edit');
      origText = pre.textContent;
      if (v.enc) cur.enc = v.enc;
      cur.size = v.size;
      ttl.textContent = baseName(cur.path) + '（' + fmtSize(v.size) + '）';
      note.textContent = '✓ 已保存到电脑';
      setTimeout(function(){
        if (!box.classList.contains('edit') && note.textContent === '✓ 已保存到电脑')
          note.textContent = '';
      }, 2500);
    } else {
      note.textContent = '保存失败：' + ((v && v.err) || '未知错误');
    }
  }

  /* ---- 公开 API ---- */
  function open(path){
    inject();
    applyFont();                 /* 沿用上次调好的字号（含读数刷新） */
    pre.contentEditable = 'false';
    box.classList.remove('edit');
    pendingEdit = false;
    origText = '';
    cur = {path: path, off: 0, size: 0, enc: '', eol: '\n'};
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
    if (!v || !v.ok){
      if (pendingEdit) pendingEdit = false;
      note.textContent = (v && v.err) || '读取失败'; return;
    }
    if (v.bin){                                  /* 二进制：给提示，不显示正文 */
      if (pendingEdit) pendingEdit = false;
      pre.textContent = '';
      more.style.display = 'none';
      note.textContent = v.err || '非文本文件';
      return;
    }
    if (v.err){                                  /* 如：文件过大 */
      if (pendingEdit) pendingEdit = false;
      note.textContent = v.err; return;
    }
    if (!pendingEdit) note.textContent = '';
    var chunk = v.text || '';
    if (chunk.indexOf('\r\n') >= 0) cur.eol = '\r\n';
    pre.textContent += chunk;
    if (v.off === 0 && v.enc) cur.enc = v.enc;   /* 编码只认首块（BOM 只在首块） */
    cur.size = v.size;
    ttl.textContent = baseName(cur.path) + '（' + fmtSize(v.size) + '）';
    if (v.next != null){
      cur.off = v.next;
      more.style.display = 'block';
      more.textContent = '继续加载（已到 ' + fmtSize(cur.off) + ' / ' + fmtSize(v.size) + '）';
    } else {
      more.style.display = 'none';
      if (pendingEdit) doEnterEdit();            /* 读完 → 自动进编辑 */
    }
  }

  window.FileRead = {open: open, onData: onData, close: close, onSaved: onSaved};
})();