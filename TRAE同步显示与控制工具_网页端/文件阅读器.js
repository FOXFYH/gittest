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
   2.37：正文顶部下拉 → 松手从头重读本文件（抓取电脑上最新内容，
         与 📂 浏览页列表的下拉刷新同款手感）。
   2.38：新增「MD 模式」——打开 .md/.markdown 自动渲染 Markdown 排版
         （标题/列表/表格/引用/代码块…，渲染交独立模块 MD渲染器.js）；
         顶栏 MD⇄原文 一键切换，编辑自动回原文、改完回 MD。
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
      ed = null, saveBtn = null, cancelBtn = null,
      fbody = null, frPull = null,
      mdBtn = null, mdBox = null;
  var origText = '';          /* 进入编辑时的原文本（取消时还原） */
  var rawText = '';           /* 2.38：累计原文——MD 模式下据此现场重渲染 */
  var pendingEdit = false;    /* 未读完就点 ✎：先自动续读到底再进编辑 */
  /* 2.37：正文下拉刷新状态（松手从头重读本文件） */
  var FR_PULL_MAX = 84, FR_PULL_TRIG = 56;
  var frStartY = 0, frActive = false, frDist = 0;
  function applyFont(){            /* 应用当前字号到正文 + 刷新读数 */
    if (pre) pre.style.fontSize = fontSize + 'px';
    if (mdBox) mdBox.style.fontSize = fontSize + 'px';
    if (fsz) fsz.textContent = fontSize;
  }
  function saveFont(){             /* 字号落盘（本机记住，长期生效） */
    try{ localStorage.setItem(FONT_KEY, String(fontSize)); }catch(e){}
  }
  /* ---- 2.38：MD 模式（.md 文件渲染排版；渲染交独立模块 MD渲染器.js） ---- */
  function renderMd(){
    if (!mdBox) return;
    if (window.MD渲染器 && MD渲染器.html) mdBox.innerHTML = MD渲染器.html(rawText);
    else mdBox.textContent = rawText;      /* 模块缺失：退纯文本 */
  }
  function setMdMode(on){
    if (!box) return;
    if (on){ renderMd(); box.classList.add('md'); }
    else box.classList.remove('md');
    if (mdBtn) mdBtn.textContent = on ? '原文' : 'MD';
    if (fbody) fbody.scrollTop = 0;
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
      '#freader .fr_pull{height:0;overflow:hidden;display:flex;align-items:center;' +
        'justify-content:center;gap:6px;font-size:13px;color:#888}' +
      '#freader .fr_pull.settle{transition:height .18s ease}' +
      '#freader .fr_pull.ready{color:#222}' +
      '#freader .fr_pull.load .fp_spin{display:inline-block;animation:frspin .8s linear infinite}' +
      '@keyframes frspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '#freader .fr_save,#freader .fr_cancel{display:none}' +
      '#freader.edit .fr_ed,#freader.edit .fr_fm,#freader.edit .fr_fsz,#freader.edit .fr_fp{display:none}' +
      '#freader.edit .fr_save,#freader.edit .fr_cancel{display:inline-block}' +
      '#freader pre[contenteditable="true"]{outline:none;background:#fbfbf7}' +
      '#freader .fr_md{display:none;padding:10px 14px 60px;font-size:16px;' +
        'line-height:1.75;color:#222;word-break:break-word}' +
      '#freader.md .fr_md{display:block}' +
      '#freader.md .fr_src{display:none}' +
      '#freader .fr_md h1,#freader .fr_md h2,#freader .fr_md h3,' +
        '#freader .fr_md h4,#freader .fr_md h5,#freader .fr_md h6{' +
        'margin:1.1em 0 .5em;line-height:1.35;font-weight:700}' +
      '#freader .fr_md h1{font-size:1.6em;border-bottom:1px solid #e8e8e8;padding-bottom:.25em}' +
      '#freader .fr_md h2{font-size:1.35em;border-bottom:1px solid #e8e8e8;padding-bottom:.2em}' +
      '#freader .fr_md h3{font-size:1.18em}' +
      '#freader .fr_md h4{font-size:1.06em}' +
      '#freader .fr_md h5,#freader .fr_md h6{font-size:1em;color:#555}' +
      '#freader .fr_md p{margin:.6em 0}' +
      '#freader .fr_md ul,#freader .fr_md ol{margin:.5em 0;padding-left:1.6em}' +
      '#freader .fr_md li{margin:.2em 0}' +
      '#freader .fr_md li.tli{list-style:none;margin-left:-1.2em}' +
      '#freader .fr_md blockquote{margin:.6em 0;padding:.2em .9em;' +
        'border-left:3px solid #d0d0d0;color:#666;background:#fafafa}' +
      '#freader .fr_md hr{border:0;border-top:1px solid #e0e0e0;margin:1.2em 0}' +
      '#freader .fr_md code{background:#f2f2f2;padding:.1em .35em;border-radius:4px;' +
        'font-family:"SFMono-Regular",Consolas,Menlo,monospace;font-size:.9em}' +
      '#freader .fr_md pre{position:relative;margin:.7em 0;padding:10px 12px;' +
        'background:#f6f6f6;border-radius:8px;overflow:auto;white-space:pre-wrap;' +
        'word-break:break-word;font-size:.9em}' +
      '#freader .fr_md pre code{background:none;padding:0;font-size:1em}' +
      '#freader .fr_md pre[data-lang]::before{content:attr(data-lang);position:absolute;' +
        'top:0;right:0;font-size:11px;color:#999;padding:2px 6px}' +
      '#freader .fr_md table{border-collapse:collapse;margin:.7em 0;width:100%;font-size:.95em}' +
      '#freader .fr_md th,#freader .fr_md td{border:1px solid #e0e0e0;padding:5px 8px}' +
      '#freader .fr_md th{background:#f6f6f6;font-weight:700}' +
      '#freader .fr_md a{color:#1565c0}' +
      '#freader .fr_md .md-img{display:inline-block;padding:0 4px;background:#f2f2f2;' +
        'border-radius:4px;color:#666;font-size:.9em}' +
      '#freader .fr_md>:first-child{margin-top:0}' +
      '#freader .fr_mdbtn{display:none}' +
      '#freader.ismd .fr_mdbtn{display:inline-block}' +
      '#freader.edit .fr_mdbtn{display:none}' +
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
        '#freader .fr_md{color:#ddd}' +
        '#freader .fr_md h1,#freader .fr_md h2{border-color:#2c2c2c}' +
        '#freader .fr_md h5,#freader .fr_md h6{color:#aaa}' +
        '#freader .fr_md code{background:#242424}' +
        '#freader .fr_md pre{background:#1c1c1c}' +
        '#freader .fr_md blockquote{background:#1c1c1c;border-color:#3a3a3a;color:#aaa}' +
        '#freader .fr_md th,#freader .fr_md td{border-color:#2c2c2c}' +
        '#freader .fr_md th{background:#1e1e1e}' +
        '#freader .fr_md a{color:#5aa9ff}' +
        '#freader .fr_md hr{border-color:#2c2c2c}' +
        '#freader .fr_md .md-img{background:#242424;color:#aaa}' +
      '}';
    document.head.appendChild(st);

    box = document.createElement('div');
    box.id = 'freader';
    box.innerHTML =
      '<div class="fr_bar">' +
        '<button class="fr_back" title="返回">←</button>' +
        '<span class="fr_ttl"></span>' +
        '<button class="fr_mdbtn" title="Markdown 渲染 / 原文 切换">MD</button>' +
        '<button class="fr_ed" title="编辑">✎</button>' +
        '<button class="fr_save" title="保存到电脑">💾 保存</button>' +
        '<button class="fr_cancel" title="取消编辑">✖ 取消</button>' +
        '<button class="fr_fm" title="缩小字号">A-</button>' +
        '<span class="fr_fsz">16</span>' +
        '<button class="fr_fp" title="放大字号">A+</button>' +
      '</div>' +
      '<div class="fr_body">' +
        '<div class="fr_pull"><span class="fp_spin">↻</span><span class="fp_txt">下拉刷新</span></div>' +
        '<pre class="fr_src"></pre>' +
        '<div class="fr_md"></div>' +
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
    fbody = box.querySelector('.fr_body');
    frPull = box.querySelector('.fr_pull');
    mdBtn = box.querySelector('.fr_mdbtn');
    mdBox = box.querySelector('.fr_md');
    bindPull();

    box.querySelector('.fr_back').onclick = close;
    mdBtn.onclick = function(){ setMdMode(!box.classList.contains('md')); };
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
    rawText = '';
    if (mdBox) mdBox.innerHTML = '';
    if (box) box.classList.remove('md', 'ismd');
    frPullReset();
  }

  function pull(){
    if (!cur) return;
    note.textContent = '读取中…';
    _send('bench_read', {p: cur.path, off: cur.off});
  }

  /* ---- 2.37：正文下拉刷新（松手从头重读本文件，抓取电脑上最新内容） ---- */
  function frPullSet(h, txt, settle){
    if (!frPull) return;
    frPull.classList.toggle('settle', !!settle);
    frPull.style.height = Math.max(0, h) + 'px';
    if (txt != null) frPull.querySelector('.fp_txt').textContent = txt;
  }
  function frPullReset(){
    frActive = false; frDist = 0;
    if (!frPull) return;
    frPull.classList.remove('load', 'ready');
    frPullSet(0, '下拉刷新', true);
  }
  function frReload(){             /* 松手过阈：从头重读本文件 */
    frActive = false;
    if (frPull){ frPull.classList.add('load'); frPull.classList.remove('ready'); }
    frPullSet(FR_PULL_TRIG, '刷新中…', true);
    if (!cur) return;
    cur.off = 0; cur.size = 0;
    rawText = '';
    if (mdBox) mdBox.innerHTML = '';
    pre.textContent = '';
    more.style.display = 'none';
    note.textContent = '读取中…';
    if (fbody) fbody.scrollTop = 0;
    pull();
  }
  function bindPull(){
    if (!fbody) return;
    fbody.addEventListener('touchstart', function(e){
      if (!box.classList.contains('on') || box.classList.contains('edit')){
        frActive = false; return;
      }
      if (fbody.scrollTop <= 0){ frStartY = e.touches[0].clientY; frActive = true; frDist = 0; }
      else frActive = false;
    }, {passive: true});
    fbody.addEventListener('touchmove', function(e){
      if (!frActive) return;
      var dy = e.touches[0].clientY - frStartY;
      if (dy <= 0 || fbody.scrollTop > 0){
        if (frDist){ frDist = 0; if (frPull) frPull.classList.remove('ready'); frPullSet(0, '下拉刷新', false); }
        return;
      }
      frDist = Math.min(FR_PULL_MAX, dy * 0.5);
      if (frPull) frPull.classList.toggle('ready', frDist >= FR_PULL_TRIG);
      frPullSet(frDist, frDist >= FR_PULL_TRIG ? '松手刷新' : '下拉刷新', false);
      if (e.cancelable) e.preventDefault();
    }, {passive: false});
    fbody.addEventListener('touchend', function(){
      if (!frActive) return;
      frActive = false;
      if (frDist >= FR_PULL_TRIG) frReload(); else frPullReset();
    });
    fbody.addEventListener('touchcancel', function(){ if (frActive) frPullReset(); });
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
    if (box.classList.contains('md')) setMdMode(false);   /* 编辑一律看原文 */
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
    if (cur && cur.md) setMdMode(true);
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
      rawText = pre.textContent;          /* 渲染视图跟着落盘内容走 */
      if (cur.md) setMdMode(true);
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
    cur = {path: path, off: 0, size: 0, enc: '', eol: '\n',
           md: !!(window.MD渲染器 && MD渲染器.isMd(path))};
    rawText = '';
    if (mdBox) mdBox.innerHTML = '';
    box.classList.toggle('ismd', !!cur.md);
    pre.textContent = '';
    note.textContent = '读取中…';
    more.style.display = 'none';
    ttl.textContent = baseName(path);
    box.classList.add('on');
    if (cur.md) setMdMode(true); else box.classList.remove('md');
    frPullReset();
    if (fbody) fbody.scrollTop = 0;
    pull();
  }

  function onData(v){
    if (!cur || !box || !box.classList.contains('on')) return;
    frPullReset();                 /* 2.37：任一应答到达即收起下拉区 */
    if (v && v.path && cur.path && v.path !== cur.path) return;   /* 非本次阅读，忽略 */
    if (!v || !v.ok){
      if (pendingEdit) pendingEdit = false;
      note.textContent = (v && v.err) || '读取失败'; return;
    }
    if (v.bin){                                  /* 二进制：给提示，不显示正文 */
      if (pendingEdit) pendingEdit = false;
      pre.textContent = '';
      if (mdBox) mdBox.innerHTML = '';
      more.style.display = 'none';
      note.textContent = v.err || '非文本文件';
      return;
    }
    if (v.err){                                  /* 如：文件过大 */
      if (pendingEdit) pendingEdit = false;
      if (mdBox) mdBox.innerHTML = '';
      note.textContent = v.err; return;
    }
    if (!pendingEdit) note.textContent = '';
    var chunk = v.text || '';
    if (chunk.indexOf('\r\n') >= 0) cur.eol = '\r\n';
    pre.textContent += chunk;
    if (cur.md){                       /* 2.38：累积原文，MD 视图现场重渲染 */
      rawText += chunk;
      if (box.classList.contains('md')
          && (rawText.length < 400000 || v.next == null)) renderMd();
    }
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