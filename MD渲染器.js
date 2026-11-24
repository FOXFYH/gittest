'use strict';
/* ================= MD 渲染器（独立模块，唯一真源） =================
   全项目唯一的 Markdown → HTML 渲染器，两种模式：
     · html(t, {chat:true})  —— 对话气泡：与原 mdHtml 逐字一致的紧凑渲染
                                （只认行内码/粗斜体/标题/项目符号/链接）
     · html(t)               —— 文档模式：完整排版（标题 h1~h6、分割线、
                                引用块、有序/无序/嵌套列表、任务清单、表格、
                                围栏代码块带语言角标、图片占位、删除线）
   用法：MD渲染器.html(text) / MD渲染器.html(text, {chat:true})
        MD渲染器.isMd(path)  —— 按扩展名判断是否 Markdown
   安全：正文先整体 HTML 转义，再做标记替换；链接只放行
        http/https/mailto/# 与相对地址（挡 javascript: 等）。
   移植：复制本文件 → 页面 <script> 引入即可，无任何外部依赖。
        （须排在 通用工具.js 之前：那边的 mdHtml 已改为转调本模块） */

(function(){
  'use strict';

  /* 与宿主 esc 同口径（& < > " 全转义）——chat 模式要靠它逐字复刻旧输出 */
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  /* ================= 文档模式：行内标记 ================= */
  function safeUrl(u){
    return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u);
  }
  function inlineDoc(s){                 /* s 必须已 esc */
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    /* 斜体放宽到句中（前为标点/中文亦可），但仍挡住 2*3*4 这类算式 */
    s = s.replace(/(^|[^\w*])\*([^*\n]+)\*(?![\w*])/g, '$1<i>$2</i>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    /* 图片：本地路径手机端取不到，不给 <img>（只会是破图），
       渲染成带标题的占位小标签，一眼看出这里有张图 */
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function(_, alt, src){
      return '<span class="md-img" title="' + src + '">🖼 '
             + (alt || '图片') + '</span>';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_, t, u){
      if (!safeUrl(u)) return t;
      return '<a href="' + u + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    return s;
  }

  /* ================= 文档模式：块级解析 ================= */
  function isBlank(l){ return !l || !l.trim(); }
  function indentOf(l){ return (/^\s*/.exec(l)[0]).replace(/\t/g, '    ').length; }
  function isHr(l){ return /^\s*([-*_])(\s*\1){2,}\s*$/.test(l); }
  function isListLine(l){ return /^\s*([-*+]|\d+[.)])\s+/.test(l); }
  function isQuoteLine(l){ return /^\s*>/.test(l); }
  function isHeadLine(l){ return /^\s*#{1,6}\s/.test(l); }

  function splitRow(l){                  /* 表格行 → 单元格数组 */
    var s = String(l || '').trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split('|').map(function(x){ return x.trim(); });
  }
  function isTableSep(l){                /* |---|:--:| 分隔行 */
    var s = String(l || '').trim();
    if (s.indexOf('-') < 0) return false;
    if (s.indexOf('|') < 0) return false;
    return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(s);
  }
  function alignOf(l){
    return splitRow(l).map(function(c){
      var lf = c.charAt(0) === ':', rt = c.charAt(c.length - 1) === ':';
      return (lf && rt) ? 'center' : rt ? 'right' : lf ? 'left' : '';
    });
  }

  function listBlock(lines, i){          /* 连续列表 → <ul>/<ol>（含一层缩进嵌套） */
    var base = indentOf(lines[i]);
    var ordered = /^\s*\d+[.)]\s+/.test(lines[i]);
    var tag = ordered ? 'ol' : 'ul';
    var items = [], n = lines.length;
    while (i < n){
      var l = lines[i];
      if (isBlank(l)){                   /* 空行夹「同型」列表项仍算同一列表 */
        var nx = (i + 1 < n) ? lines[i + 1] : null;
        if (nx != null && isListLine(nx)
            && (/^\s*\d+[.)]\s+/.test(nx)) === ordered
            && indentOf(nx) >= base){ i++; continue; }
        break;
      }
      var m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
      if (!m) break;
      var ind = m[1].replace(/\t/g, '    ').length;
      if (ind < base) break;
      if (ind > base && items.length){   /* 更深缩进 → 递归成子列表 */
        var sub = listBlock(lines, i);
        items[items.length - 1].sub += sub.html;
        i = sub.i;
        continue;
      }
      var txt = m[3], cls = '', body = txt;
      var chk = /^\[([ xX])\]\s+(.*)$/.exec(txt);   /* 任务清单 */
      if (chk){ cls = ' class="tli"'; body = (chk[1] === ' ' ? '☐ ' : '☑ ') + chk[2]; }
      items.push({cls: cls, text: body, sub: ''});
      i++;
    }
    var html = '<' + tag + '>';
    items.forEach(function(it){
      html += '<li' + it.cls + '>' + inlineDoc(esc(it.text)) + it.sub + '</li>';
    });
    return {html: html + '</' + tag + '>', i: i};
  }

  function blocks(src){
    var out = [], lines = src.split('\n'), n = lines.length, i = 0;
    function blockStart(l, nx){
      return isHeadLine(l) || isQuoteLine(l) || isListLine(l) || isHr(l)
          || (l.indexOf('|') >= 0 && nx != null && isTableSep(nx));
    }
    while (i < n){
      var line = lines[i];
      if (isBlank(line)){ i++; continue; }
      if (isHr(line)){ out.push('<hr>'); i++; continue; }

      var hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (hm){
        var lv = hm[1].length;
        out.push('<h' + lv + '>' + inlineDoc(esc(hm[2])) + '</h' + lv + '>');
        i++; continue;
      }

      if (isQuoteLine(line)){            /* 引用块（可再含块级内容） */
        var q = [];
        while (i < n && isQuoteLine(lines[i])){
          q.push(lines[i].replace(/^\s*>\s?/, '')); i++;
        }
        out.push('<blockquote>' + blocks(q.join('\n')) + '</blockquote>');
        continue;
      }

      if (line.indexOf('|') >= 0 && i + 1 < n && isTableSep(lines[i + 1])){
        var head = splitRow(line), align = alignOf(lines[i + 1]), rows = [];
        i += 2;
        while (i < n && !isBlank(lines[i]) && lines[i].indexOf('|') >= 0){
          rows.push(splitRow(lines[i])); i++;
        }
        var at = function(c){ return align[c] ? ' style="text-align:' + align[c] + '"' : ''; };
        var tb = '<table><thead><tr>';
        for (var c = 0; c < head.length; c++)
          tb += '<th' + at(c) + '>' + inlineDoc(esc(head[c])) + '</th>';
        tb += '</tr></thead><tbody>';
        rows.forEach(function(r){
          tb += '<tr>';
          for (var k = 0; k < head.length; k++)
            tb += '<td' + at(k) + '>' + inlineDoc(esc(r[k] == null ? '' : r[k])) + '</td>';
          tb += '</tr>';
        });
        out.push(tb + '</tbody></table>');
        continue;
      }

      if (isListLine(line)){
        var r2 = listBlock(lines, i);
        out.push(r2.html); i = r2.i; continue;
      }

      var para = [];                     /* 普通段落：空行分隔，段内单换行并成空格 */
      while (i < n && !isBlank(lines[i]) && !blockStart(lines[i], lines[i + 1])){
        para.push(lines[i]); i++;
      }
      if (!para.length){ para.push(lines[i]); i++; }
      out.push('<p>' + inlineDoc(esc(para.join(' '))) + '</p>');
    }
    return out.join('');
  }

  /* ================= 对外：渲染入口 ================= */
  function html(text, opts){
    var chat = !!(opts && opts.chat);
    var parts = String(text == null ? '' : text).split(/```/);
    var out = [];
    for (var i = 0; i < parts.length; i++){
      if (i % 2 === 1){                  /* 奇数下标 = 围栏代码块 */
        var c = parts[i];
        if (c.charAt(0) === '\n') c = c.slice(1);
        if (chat){
          out.push('<pre><code>' + esc(c) + '</code></pre>');
          continue;
        }
        var lang = '';
        var nl = c.indexOf('\n');
        var first = nl >= 0 ? c.slice(0, nl) : c;
        if (nl >= 0 && /^[A-Za-z0-9_+#.-]{1,20}$/.test(first.trim())){
          lang = first.trim().toLowerCase();
          c = c.slice(nl + 1);
        }
        out.push('<pre class="md-code"'
                 + (lang ? ' data-lang="' + lang + '"' : '')
                 + '><code>' + esc(c) + '</code></pre>');
        continue;
      }
      if (chat){
        /* —— 与原 mdHtml 完全一致（顺序、正则、替换都别动，保证气泡不变） —— */
        var s = esc(parts[i]);
        s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
        s = s.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<i>$2</i>');
        s = s.replace(/^###### (.*)$/gm, '<h3>$1</h3>');
        s = s.replace(/^##### (.*)$/gm, '<h3>$1</h3>');
        s = s.replace(/^#### (.*)$/gm, '<h3>$1</h3>');
        s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
        s = s.replace(/^\s*[-*] (.*)$/gm, '• $1');
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
          '<a href="$2" target="_blank" rel="noopener">$1</a>');
        out.push(s);
        continue;
      }
      out.push(blocks(parts[i]));
    }
    return out.join('');
  }

  function isMd(p){
    return /\.(md|markdown|mdown|mkd|mdx)$/i.test(String(p || '').trim());
  }

  window.MD渲染器 = {html: html, isMd: isMd};
  if (!window.MD) window.MD = window.MD渲染器;
})();