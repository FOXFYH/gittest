/* Fox记事本 网页版 v1.24 —— 主逻辑
   与 Python 版共用金山文档表格「Fox记事本」的 6.0 云端库。
   云同步协议：读取索引 / 查找 / 同步提交 / 转正确认 / 批量写入 / 删除行 / 解锁，
   全部照《文件管理6.0专用同步脚本.js》实现，不自行发明参数。 */
(function () {
  'use strict';

  // ===================== 常量与默认值 =====================
  const APP_VERSION = 'v1.30';
  const PRE = 'foxpad_';                       // 本地缓存键名前缀
  const CLOUD_PROXY = 'https://1408347752-dxgsap4qrj.ap-guangzhou.tencentscf.com';
  const CLOUD_WEBHOOK = 'https://www.kdocs.cn/api/v3/ide/file/cbDG0BYEda3W/script/V2-6JlKZr50nGpgw7u2HJEIFy/sync_task';
  const MAX_CLOUD_CHARS = 30000;               // 整 JSON 单格拆分阈值（与 6.0 内核一致）

  // 版本不符清缓存时保留的白名单（规范 3.3：只留登录信息与显示偏好）
  const WHITELIST = ['foxpad_ver', 'foxpad_settings', 'foxpad_device'];

  const DEFAULT_SETTINGS = {
    fontFamily: 'Microsoft YaHei UI',
    fontSize: 11,
    lineSpacing: 2,
    wordWrap: true,
    autoScroll: false,
    autoScrollSpeed: 60,
    user: 'test',
    password: '1234',
    sheet: 'Fox记事本'
  };

  // 同步状态四步曲：所有文案与颜色只从这里出（规范 5.2）
  const SRV_PHASE = {
    idle:     { text: '未连',       bg: '#f0f1f3', color: '#77808b', border: '#dcdfe4' },
    sending:  { text: '已发待回执', bg: '#fff4e5', color: '#b26a00', border: '#f2d3a2' },
    received: { text: '服务端已收', bg: '#e8f0fe', color: '#1a5fb4', border: '#b7cfee' },
    ok:       { text: '成功',       bg: '#e7f7ec', color: '#1e7d34', border: '#b7e2c4' },
    fail:     { text: '失败',       bg: '#fdecea', color: '#c0392b', border: '#f0c0ba' }
  };

  // ===================== 工具函数 =====================
  function $(id) { return document.getElementById(id); }
  function clamp(n, min, max) { n = Number(n); if (!isFinite(n)) return min; return Math.max(min, Math.min(max, n)); }
  function genId() { return String(Math.floor(1e9 + Math.random() * 9 * 1e9)); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDateTime(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function fmtInsertTime(d) {
    d = d || new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' ' +
      d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }
  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ===================== 本地缓存（版本校验 + 白名单） =====================
  function clearCacheExceptWhitelist() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PRE) === 0 && WHITELIST.indexOf(k) === -1) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
  }

  // 规范 3.2.2：网页版版本号与本地记录不一致 → 立即清缓存（白名单除外）
  (function checkVersion() {
    const stored = localStorage.getItem(PRE + 'ver');
    if (stored !== APP_VERSION) clearCacheExceptWhitelist();
    try { localStorage.setItem(PRE + 'ver', APP_VERSION); } catch (e) { /* 隐私模式忽略 */ }
  })();

  function cacheGet(key, def) {
    try { const v = localStorage.getItem(PRE + key); return v === null ? def : v; } catch (e) { return def; }
  }
  function cacheSet(key, val) {
    try { localStorage.setItem(PRE + key, String(val)); } catch (e) { /* 超限时静默 */ }
  }

  function loadSettings() {
    let raw = null;
    try { raw = JSON.parse(cacheGet('settings', '{}')); } catch (e) { raw = {}; }
    const s = Object.assign({}, DEFAULT_SETTINGS, raw || {});
    s.fontSize = clamp(s.fontSize, 6, 128);
    s.lineSpacing = clamp(s.lineSpacing, 0, 12);
    s.autoScrollSpeed = clamp(s.autoScrollSpeed, 1, 600);
    s.fontFamily = String(s.fontFamily || DEFAULT_SETTINGS.fontFamily);
    s.user = String(s.user || DEFAULT_SETTINGS.user);
    s.password = String(s.password || DEFAULT_SETTINGS.password);
    s.sheet = String(s.sheet || DEFAULT_SETTINGS.sheet);
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(PRE + 'settings', JSON.stringify(settings)); } catch (e) { /* 忽略 */ }
  }

  function deviceId() {
    let d = cacheGet('device', '');
    if (!d) {
      d = 'W' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      cacheSet('device', d);
    }
    return d;
  }

  // ===================== 运行状态 =====================
  let settings = loadSettings();
  const editor = $('editor');

  // ===================== 富文本模型（contenteditable） =====================
  // 存储格式与 Py 版一致：无颜色时存纯文本；有颜色时存单行 JSON：
  // {"foxrich":1,"text":"<完整纯文本>","colors":[[起始,结束,"#RRGGBB"],...]}
  // 偏移口径：Unicode 码点（与 Python len() 一致，emoji 按 1 个码点计），
  // 从 0 开始、end 开区间、按起始升序、同一字符仅一色。
  const RICH_PREFIX = '{"foxrich"';
  const TEXT_COLORS = [
    { hex: '#E53935', name: '大红' },
    { hex: '#1E63D8', name: '大蓝' },
    { hex: '#F2C200', name: '大黄' },
    { hex: '#2E9E44', name: '大绿' },
    { hex: '#7B2FD6', name: '大紫' },
    { hex: '#F57C00', name: '橙' },
    { hex: '#000000', name: '黑色（恢复默认）' }
  ];

  function cpLen(s) {
    // UTF-16 代理对算 1 个 Unicode 码点（与 Python len() 口径一致）
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) i++;
      }
      n++;
    }
    return n;
  }

  function hexFromCss(v) {
    if (!v) return '';
    v = String(v).trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return ('#' + h).toUpperCase();
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    if (m) {
      const two = function (x) {
        const h = clamp(parseInt(x, 10), 0, 255).toString(16);
        return h.length < 2 ? '0' + h : h;
      };
      return ('#' + two(m[1]) + two(m[2]) + two(m[3])).toUpperCase();
    }
    return '';
  }

  function elementColor(el) {
    if (!el || el.nodeType !== 1) return '';
    const attr = el.getAttribute && el.getAttribute('color');
    if (attr) {
      const h = hexFromCss(attr);
      if (h) return h;
    }
    if (el.style && el.style.color) return hexFromCss(el.style.color);
    return '';
  }

  function isBlockEl(el) {
    if (!el || el.nodeType !== 1) return false;
    return /^(DIV|P|LI|BLOCKQUOTE|H1|H2|H3|H4|H5|H6|PRE)$/.test(el.tagName);
  }

  // 空块里的 <br> 只是占位符，换行由“块起始边界”代表，不能重复计数
  function isPlaceholderBr(br) {
    const p = br.parentNode;
    if (!p || p.nodeType !== 1 || !isBlockEl(p) || p.textContent) return false;
    let brCount = 0;
    let other = false;
    for (let i = 0; i < p.childNodes.length; i++) {
      const n = p.childNodes[i];
      if (n.nodeType === 1 && n.tagName === 'BR') brCount++;
      else if (n.nodeType === 1 || (n.nodeType === 3 && n.data)) other = true;
    }
    return brCount === 1 && !other;
  }

  // 遍历 DOM 生成：纯文本、颜色区间（码点偏移）、UTF-16 片段表
  function buildModel(root) {
    root = root || editor;
    const state = { text: '', u16: 0, cp: 0, colors: [], segs: [] };
    function addColor(startCp, endCp, hex) {
      if (!hex || hex === '#000000' || endCp <= startCp) return;
      const last = state.colors[state.colors.length - 1];
      if (last && last[2] === hex && last[1] === startCp) last[1] = endCp;
      else state.colors.push([startCp, endCp, hex]);
    }
    function addText(node, color) {
      const data = node.data;
      if (!data) return;
      const startCp = state.cp;
      state.segs.push({ kind: 'text', node: node, u16Start: state.u16, u16End: state.u16 + data.length });
      state.text += data;
      state.u16 += data.length;
      state.cp += cpLen(data);
      if (color) addColor(startCp, state.cp, color);
    }
    function addNewline(beforeNode, beforeOffset, afterNode, afterOffset) {
      state.segs.push({
        kind: 'nl',
        beforeNode: beforeNode, beforeOffset: beforeOffset,
        afterNode: afterNode, afterOffset: afterOffset,
        u16Start: state.u16, u16End: state.u16 + 1
      });
      state.text += '\n';
      state.u16 += 1;
      state.cp += 1;
    }
    function walk(parent, inherit) {
      const kids = parent.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const node = kids[i];
        if (node.nodeType === 3) { addText(node, inherit); continue; }
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'BR') {
          if (!isPlaceholderBr(node)) addNewline(parent, i, parent, i + 1);
          continue;
        }
        const color = elementColor(node) || inherit;
        if (isBlockEl(node)) {
          const prev = node.previousSibling;
          const prevIsBr = prev && prev.nodeType === 1 && prev.tagName === 'BR';
          const prevIsBlock = prev && prev.nodeType === 1 && isBlockEl(prev);
          const endsNl = state.text.charAt(state.text.length - 1) === '\n';
          if (state.u16 > 0 && !prevIsBr && !(endsNl && !prevIsBlock)) {
            addNewline(parent, i, node, 0);
          }
          walk(node, color);
        } else {
          walk(node, color);
        }
      }
    }
    walk(root, '');
    return state;
  }

  function getPlainText() { return buildModel().text; }

  // 码点偏移 → UTF-16 下标表（长度 = 码点数 + 1）
  function splitCpIndex(text) {
    const out = [0];
    let i = 0;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) i += 2;
        else i += 1;
      } else {
        i += 1;
      }
      out.push(i);
    }
    return out;
  }

  function appendPiece(frag, text, idx, fromCp, toCp, color) {
    if (toCp <= fromCp) return;
    const piece = text.substring(idx[fromCp], idx[toCp]);
    if (!piece) return;
    if (!color) {
      frag.appendChild(document.createTextNode(piece));
    } else {
      const span = document.createElement('span');
      span.style.color = color;
      span.appendChild(document.createTextNode(piece));
      frag.appendChild(span);
    }
  }

  // content（纯文本或 foxrich JSON）→ 编辑器 DOM
  function setEditorContent(content) {
    let text = content || '';
    let colors = [];
    if (typeof text === 'string' && text.indexOf(RICH_PREFIX) === 0) {
      try {
        const obj = JSON.parse(text);
        if (obj && typeof obj.text === 'string' && Array.isArray(obj.colors)) {
          text = obj.text;
          colors = obj.colors;
        }
      } catch (e) { /* JSON 损坏时按纯文本 */ }
    }
    editor.innerHTML = '';
    if (!text) return;
    const idx = splitCpIndex(text);
    const cpCount = idx.length - 1;
    const ranges = [];
    colors.forEach(function (r) {
      if (!Array.isArray(r) || r.length < 3) return;
      const s = clamp(parseInt(r[0], 10), 0, cpCount);
      const e = clamp(parseInt(r[1], 10), 0, cpCount);
      const hex = hexFromCss(r[2]);
      if (e <= s || !hex || hex === '#000000') return;
      ranges.push([s, e, hex]);
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    const frag = document.createDocumentFragment();
    let cur = 0;
    ranges.forEach(function (r) {
      if (r[0] < cur) return;                    // 与上一段重叠：跳过
      if (r[0] > cur) appendPiece(frag, text, idx, cur, r[0], '');
      appendPiece(frag, text, idx, r[0], r[1], r[2]);
      cur = r[1];
    });
    if (cur < cpCount) appendPiece(frag, text, idx, cur, cpCount, '');
    editor.appendChild(frag);
  }

  function serializeEditor() {
    const m = buildModel();
    if (!m.colors.length) return m.text;
    return JSON.stringify({ foxrich: 1, text: m.text, colors: m.colors });
  }

  // ===================== 选区与偏移 =====================
  let lastEditorRange = null;

  function rangeInEditor() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const okStart = r.startContainer === editor || editor.contains(r.startContainer);
    const okEnd = r.endContainer === editor || editor.contains(r.endContainer);
    return okStart && okEnd ? r : null;
  }

  document.addEventListener('selectionchange', function () {
    const r = rangeInEditor();
    if (r) lastEditorRange = r.cloneRange();
  });

  function restoreEditorSelection() {
    let r = rangeInEditor();
    if (!r && lastEditorRange && lastEditorRange.startContainer &&
        (lastEditorRange.startContainer === editor || editor.contains(lastEditorRange.startContainer))) {
      r = lastEditorRange.cloneRange();
    }
    if (!r) return null;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return r;
  }

  function prefixTextLength(container, offset) {
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.setEnd(container, offset);
    return buildModel(r.cloneContents()).text.length;
  }

  function offsetsFromRange(r) {
    let start = prefixTextLength(r.startContainer, r.startOffset);
    let end = prefixTextLength(r.endContainer, r.endOffset);
    if (start > end) { const t = start; start = end; end = t; }
    return { start: start, end: end, collapsed: start === end };
  }

  function selectionOffsets() {
    const r = rangeInEditor();
    return r ? offsetsFromRange(r) : null;
  }

  function currentEditorOffsets() {
    let r = rangeInEditor();
    if (!r && lastEditorRange && lastEditorRange.startContainer &&
        (lastEditorRange.startContainer === editor || editor.contains(lastEditorRange.startContainer))) {
      r = lastEditorRange;
    }
    return r ? offsetsFromRange(r) : null;
  }

  function selectedPlainText() {
    const r = restoreEditorSelection();
    if (!r) return '';
    const o = offsetsFromRange(r);
    return getPlainText().substring(o.start, o.end);
  }

  function boundaryFromModel(m, pos) {
    if (pos <= 0) return { node: editor, offset: 0 };
    for (let i = 0; i < m.segs.length; i++) {
      const s = m.segs[i];
      if (pos >= s.u16Start && pos < s.u16End) {
        if (s.kind === 'text') return { node: s.node, offset: pos - s.u16Start };
        return pos === s.u16Start
          ? { node: s.beforeNode, offset: s.beforeOffset }
          : { node: s.afterNode, offset: s.afterOffset };
      }
      if (pos === s.u16End) {
        if (s.kind === 'text') return { node: s.node, offset: s.node.data.length };
        return { node: s.afterNode, offset: s.afterOffset };
      }
    }
    return { node: editor, offset: editor.childNodes.length };
  }

  function rangeFromModel(m, start, end) {
    const a = boundaryFromModel(m, start);
    const b = boundaryFromModel(m, end);
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  }

  function selectTextRange(start, end) {
    const m = buildModel();
    start = clamp(start, 0, m.text.length);
    end = clamp(end, 0, m.text.length);
    const r = rangeFromModel(m, start, end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return r;
  }

  // ===================== 文字颜色 UI =====================
  let colorPop = null;
  let ctxMenu = null;

  function updateColorSwatch(hex) {
    const s = $('textColorSwatch');
    if (s) s.style.background = hex || '#000000';
  }

  function closeColorPop() {
    if (colorPop) { colorPop.remove(); colorPop = null; }
  }

  function makeColorSwatches(wrap, onPick) {
    TEXT_COLORS.forEach(function (c) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw';
      b.style.background = c.hex;
      b.title = c.name + ' ' + c.hex;
      b.dataset.hex = c.hex;
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onPick(c.hex);
      });
      wrap.appendChild(b);
    });
  }

  function applyTextColor(hex) {
    let r = rangeInEditor();
    if (!r && lastEditorRange && lastEditorRange.startContainer &&
        (lastEditorRange.startContainer === editor || editor.contains(lastEditorRange.startContainer))) {
      r = lastEditorRange.cloneRange();
    }
    if (!r || r.collapsed) { toast('请先选中文字'); return; }
    editor.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* 忽略 */ }
    try {
      if (hex === '#000000') document.execCommand('removeFormat');
      else document.execCommand('foreColor', false, hex);
    } catch (e) { /* 忽略 */ }
    markDirty();
    updateColorSwatch(hex);
  }

  function toggleColorPop(anchor) {
    if (colorPop) { closeColorPop(); return; }
    closeCtxMenu();
    const pop = document.createElement('div');
    pop.className = 'color-pop';
    pop.id = 'colorPop';
    const row = document.createElement('div');
    row.className = 'color-row';
    makeColorSwatches(row, function (hex) { applyTextColor(hex); closeColorPop(); });
    pop.appendChild(row);
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
    let top = rect.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 6) top = Math.max(6, rect.top - pop.offsetHeight - 6);
    pop.style.top = top + 'px';
    colorPop = pop;
  }

  function closeCtxMenu() {
    if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
  }

  function makeCtxItem(label, kbd, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item no-check';
    const t = document.createElement('span');
    t.textContent = label;
    b.appendChild(t);
    if (kbd) {
      const k = document.createElement('span');
      k.className = 'kbd';
      k.textContent = kbd;
      b.appendChild(k);
    }
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); handler(); });
    return b;
  }

  function openCtxMenu(x, y) {
    closeCtxMenu();
    closeColorPop();
    closeMenu();
    const pop = document.createElement('div');
    pop.className = 'menu-pop ctx-menu';
    pop.addEventListener('mousedown', function (e) {
      // 保住编辑器里的选区，否则点菜单项会丢选区
      if (e.target !== pop) e.preventDefault();
    });
    pop.appendChild(makeCtxItem('剪切', 'Ctrl+X', function () { closeCtxMenu(); cutSelection(); }));
    pop.appendChild(makeCtxItem('复制', 'Ctrl+C', function () { closeCtxMenu(); copySelection(); }));
    pop.appendChild(makeCtxItem('粘贴', 'Ctrl+V', function () { closeCtxMenu(); pasteClipboard(); }));
    pop.appendChild(makeCtxItem('全选', 'Ctrl+A', function () { closeCtxMenu(); selectAllText(); }));
    const sep = document.createElement('div');
    sep.className = 'menu-sep';
    pop.appendChild(sep);
    const colorsBox = document.createElement('div');
    colorsBox.className = 'ctx-colors';
    colorsBox.hidden = true;
    const colorItem = makeCtxItem('文字颜色', '', function () { colorsBox.hidden = !colorsBox.hidden; });
    const arrow = document.createElement('span');
    arrow.className = 'sub-arrow';
    arrow.textContent = '▸';
    colorItem.classList.add('has-sub');
    colorItem.appendChild(arrow);
    pop.appendChild(colorItem);
    makeColorSwatches(colorsBox, function (hex) { applyTextColor(hex); closeCtxMenu(); });
    pop.appendChild(colorsBox);
    document.body.appendChild(pop);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = Math.max(6, Math.min(x, window.innerWidth - w - 6)) + 'px';
    pop.style.top = Math.max(6, Math.min(y, window.innerHeight - h - 6)) + 'px';
    ctxMenu = pop;
  }
  let doc = {
    name: '', id: '', s: null, e: null, isNew: true,
    folder: '', dirty: false, createTime: ''
  };

  let phase = { key: 'idle', detail: '' };
  let page = 'edit';
  let settingsReturnPage = 'edit';

  let cloudIndex = [];
  let currentFolder = '';
  let syncBusy = false;
  let autoTimer = null;
  let autoAcc = 0;
  let autoLast = 0;
  let toastTimer = null;
  let docSaveTimer = null;

  // ===================== 状态栏（唯一出口） =====================
  function setPhase(key, detail) {
    phase.key = key;
    phase.detail = detail || '';
    renderPhase();
  }
  function renderPhase() {
    const p = SRV_PHASE[phase.key] || SRV_PHASE.idle;
    ['statusPill', 'fileStatusPill'].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.textContent = p.text;
      el.style.background = p.bg;
      el.style.color = p.color;
      el.style.borderColor = p.border;
      el.title = phase.detail || p.text;
    });
    updateTitle();
  }

  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  // ===================== 云端通道 =====================
  // quiet=true 时不改状态栏（用于解锁等收尾动作）
  async function cloudCall(action, params, quiet) {
    const argv = {
      '表格名': settings.sheet,
      '操作': action,
      '用户名': settings.user,
      '密码': settings.password
    };
    Object.assign(argv, params || {});

    if (!quiet) setPhase('sending', '正在发送：' + action);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, 45000);
    let txt = '';
    try {
      const resp = await fetch(CLOUD_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: CLOUD_WEBHOOK, message: { Context: { argv: argv } } }),
        signal: ctrl.signal
      });
      txt = await resp.text();
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
    } catch (err) {
      if (!quiet) setPhase('fail', '网络失败：' + (err && err.name === 'AbortError' ? '请求超时' : (err.message || err)));
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!quiet) setPhase('received', '服务端已回执：' + action);
    let payload = null;
    try { payload = JSON.parse(txt); } catch (e) {
      if (!quiet) setPhase('fail', '回执不是有效 JSON');
      throw new Error('云端回执解析失败');
    }
    const result = (payload && payload.data && payload.data.result)
      ? payload.data.result
      : ((payload && payload.result) ? payload.result : payload);
    if (!result || typeof result !== 'object') {
      if (!quiet) setPhase('fail', '云端回执为空');
      throw new Error('云端回执为空');
    }
    if (result.status === 'error') {
      const err = new Error(result.tongzhi || result.message || '云端返回错误');
      err.cloud = result;
      if (!quiet) setPhase('fail', err.message);
      throw err;
    }
    if (!quiet) setPhase('ok', action + '完成');
    return result;
  }

  async function unlockCloud() {
    try { await cloudCall('解锁', { '锁登记处': deviceId() }, true); } catch (e) { /* 解锁失败不影响主流程 */ }
  }

  // ===================== 文档与缓存 =====================
  function writeDocCache() {
    cacheSet('doc_text', serializeEditor());
    cacheSet('doc_meta', JSON.stringify({
      name: doc.name, id: doc.id, s: doc.s, e: doc.e, isNew: doc.isNew,
      folder: doc.folder, dirty: doc.dirty, createTime: doc.createTime
    }));
  }
  function scheduleDocCache() {
    clearTimeout(docSaveTimer);
    docSaveTimer = setTimeout(writeDocCache, 300);
  }

  function restoreDocCache() {
    setEditorContent(cacheGet('doc_text', ''));
    let meta = null;
    try { meta = JSON.parse(cacheGet('doc_meta', '{}')); } catch (e) { meta = {}; }
    meta = meta || {};
    doc = {
      name: String(meta.name || ''),
      id: String(meta.id || ''),
      s: meta.s === null || meta.s === undefined ? null : Number(meta.s),
      e: meta.e === null || meta.e === undefined ? null : Number(meta.e),
      isNew: meta.isNew !== false,
      folder: String(meta.folder || ''),
      dirty: !!meta.dirty,
      createTime: String(meta.createTime || '')
    };
  }

  function setDoc(name, content, meta) {
    doc = {
      name: name || '',
      id: (meta && meta.id) || '',
      s: meta && meta.s !== undefined ? Number(meta.s) : null,
      e: meta && meta.e !== undefined ? Number(meta.e) : null,
      isNew: !(meta && meta.id),
      folder: (meta && meta.folder) || '',
      dirty: !!(meta && meta.dirty),
      createTime: (meta && meta.createTime) || ''
    };
    setEditorContent(content || '');
    applyFont();
    updateHeader();
    writeDocCache();
    updateTitle();
  }

  function markDirty() {
    if (doc.isNew) {
      doc.dirty = true;
    } else {
      doc.dirty = true;
      const s = Number(doc.s || 0);
      doc.e = s + 1;          // 本地编辑：起点号不变，终点号 +1
    }
    updateHeader();
    scheduleDocCache();
    updateTitle();
  }

  // ===================== 显示与偏好 =====================
  function applyFont() {
    const size = clamp(settings.fontSize, 6, 128);
    const spacing = clamp(settings.lineSpacing, 0, 12);
    const family = String(settings.fontFamily || DEFAULT_SETTINGS.fontFamily);
    editor.style.fontFamily = /[,\s]/.test(family) ? family : '"' + family + '", "Microsoft YaHei UI", sans-serif';
    editor.style.fontSize = size + 'px';
    editor.style.lineHeight = Math.round(size * 1.55 + spacing) + 'px';
    $('fontSizeBox').value = size;
  }

  function applyWrap() {
    editor.classList.toggle('nowrap', !settings.wordWrap);
    $('btnWrap').classList.toggle('on', !!settings.wordWrap);
    $('btnWrap').textContent = settings.wordWrap ? '换行：开' : '换行：关';
    $('btnWrap').title = '自动换行开关';
  }

  function applyAutoScrollBtn() {
    const btn = $('btnAutoScroll');
    btn.classList.toggle('on', !!settings.autoScroll);
    btn.textContent = settings.autoScroll ? '上滑：停' : '上滑：开';
    btn.title = '自动上滑开关（速度在设置页调整）';
  }

  function startAutoScroll() {
    stopAutoScroll();
    autoLast = Date.now();
    autoAcc = 0;
    autoTimer = setInterval(autoScrollTick, 200);
  }
  function stopAutoScroll() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
  function autoScrollTick() {
    if (!settings.autoScroll || page !== 'edit') return;
    const now = Date.now();
    const dt = now - autoLast;
    autoLast = now;
    const max = editor.scrollHeight - editor.clientHeight;
    if (max <= 0) return;
    autoAcc += clamp(settings.autoScrollSpeed, 1, 600) * dt / 60000;
    if (autoAcc < 1) return;
    const px = Math.floor(autoAcc);
    autoAcc -= px;
    if (editor.scrollTop >= max - 1) {
      settings.autoScroll = false;
      saveSettings();
      stopAutoScroll();
      applyAutoScrollBtn();
      toast('已到文末，自动上滑停止');
      return;
    }
    editor.scrollTop = Math.min(max, editor.scrollTop + px);
  }
  function toggleAutoScroll() {
    settings.autoScroll = !settings.autoScroll;
    saveSettings();
    applyAutoScrollBtn();
    if (settings.autoScroll) { startAutoScroll(); toast('自动上滑已开启'); }
    else { stopAutoScroll(); toast('自动上滑已关闭'); }
  }

  function setFontSize(n) {
    n = clamp(Math.round(Number(n)), 6, 128);
    settings.fontSize = n;
    applyFont();
    saveSettings();
  }

  // ===================== 顶栏与标题 =====================
  function updateHeader() {
    $('docName').textContent = doc.name || '未命名';
    const s = doc.s === null || doc.s === undefined ? '-' : doc.s;
    const e = doc.e === null || doc.e === undefined ? '-' : doc.e;
    $('docSE').textContent = '起点 ' + s + ' / 终点 ' + e;
    $('docSE').title = '6.0 云端版本号：起点号 / 终点号';
  }
  function updateTitle() {
    const name = doc.name || '未命名';
    const st = (SRV_PHASE[phase.key] || SRV_PHASE.idle).text;
    document.title = 'Fox记事本 ' + APP_VERSION + ' - ' + name + ' [' + st + ']';
  }

  // ===================== 页面切换 =====================
  function showPage(name) {
    page = name;
    document.querySelectorAll('.page').forEach(function (el) { el.classList.remove('active'); });
    const el = $('page' + (name === 'edit' ? 'Edit' : name === 'files' ? 'Files' : 'Settings'));
    if (el) el.classList.add('active');
    if (name === 'edit') {
      autoLast = Date.now();      // 回到编辑页时重置上滑计时，避免一次跳很远
      setTimeout(function () { editor.focus(); }, 60);
    }
  }

  // ===================== 模态框 =====================
  // 弹窗骨架：返回 layer/body/foot，由各业务弹窗自行填充
  function modalBase(title) {
    const layer = $('modalLayer');
    layer.hidden = false;
    layer.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'modal';
    const head = document.createElement('div');
    head.className = 'modal-head';
    head.textContent = title;
    const body = document.createElement('div');
    body.className = 'modal-body';
    const foot = document.createElement('div');
    foot.className = 'modal-foot';
    box.appendChild(head);
    box.appendChild(body);
    box.appendChild(foot);
    layer.appendChild(box);
    return { layer: layer, box: box, body: body, foot: foot };
  }

  function modalConfirm(title, message, okText, danger) {
    return new Promise(function (resolve) {
      const m = modalBase(title);
      const p = document.createElement('div');
      p.textContent = message;
      m.body.appendChild(p);

      let closed = false;
      const onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
      };
      const done = function (v) {
        if (closed) return;
        closed = true;
        m.layer.hidden = true;
        m.layer.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      document.addEventListener('keydown', onKey);

      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function () { done(false); });
      const ok = document.createElement('button');
      ok.className = 'btn' + (danger ? ' danger' : ' primary');
      ok.textContent = okText || '确定';
      ok.addEventListener('click', function () { done(true); });
      m.foot.appendChild(cancel);
      m.foot.appendChild(ok);
      setTimeout(function () { ok.focus(); }, 40);
    });
  }

  // 统一文本输入弹窗：确定返回字符串（可能为空），取消返回 null
  function askText(title, label, defaultValue) {
    return new Promise(function (resolve) {
      const m = modalBase(title);
      const lab = document.createElement('div');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue || '';
      m.body.appendChild(lab);
      m.body.appendChild(input);

      let closed = false;
      const onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      };
      const done = function (v) {
        if (closed) return;
        closed = true;
        m.layer.hidden = true;
        m.layer.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      document.addEventListener('keydown', onKey);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim()); }
      });

      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function () { done(null); });
      const ok = document.createElement('button');
      ok.className = 'btn primary';
      ok.textContent = '确定';
      ok.addEventListener('click', function () { done(input.value.trim()); });
      m.foot.appendChild(cancel);
      m.foot.appendChild(ok);
      setTimeout(function () { input.focus(); input.select(); }, 40);
    });
  }

  // 多选一弹窗：返回选项 value，取消返回 null
  function chooseOne(title, message, options) {
    return new Promise(function (resolve) {
      const m = modalBase(title);
      const p = document.createElement('div');
      p.textContent = message;
      m.body.appendChild(p);

      let closed = false;
      const onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); done(null); }
      };
      const done = function (v) {
        if (closed) return;
        closed = true;
        m.layer.hidden = true;
        m.layer.innerHTML = '';
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      document.addEventListener('keydown', onKey);

      const wrap = document.createElement('div');
      wrap.className = 'modal-choices';
      options.forEach(function (op) {
        const b = document.createElement('button');
        b.className = 'btn' + (op.danger ? ' danger' : '');
        b.textContent = op.label;
        b.addEventListener('click', function () { done(op.value); });
        wrap.appendChild(b);
      });
      m.body.appendChild(wrap);

      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = '取消';
      cancel.addEventListener('click', function () { done(null); });
      m.foot.appendChild(cancel);
    });
  }

  // ===================== 菜单 =====================
  const MENUS = {
    file: [
      { label: '新建', kbd: 'Ctrl+N', act: 'new' },
      { label: '打开云端文件…', kbd: 'Ctrl+O', act: 'openList' },
      { label: '保存到云端', kbd: 'Ctrl+S', act: 'save' },
      { label: '另存为…', kbd: 'Ctrl+Shift+S', act: 'saveAs' },
      { sep: true },
      { label: '退出 / 清空文档', act: 'exit' }
    ],
    edit: [
      { label: '撤销', kbd: 'Ctrl+Z', act: 'undo' },
      { label: '重做', kbd: 'Ctrl+Y', act: 'redo' },
      { sep: true },
      { label: '剪切', kbd: 'Ctrl+X', act: 'cut' },
      { label: '复制', kbd: 'Ctrl+C', act: 'copy' },
      { label: '粘贴', kbd: 'Ctrl+V', act: 'paste' },
      { label: '删除', kbd: 'Del', act: 'del' },
      { sep: true },
      { label: '查找…', kbd: 'Ctrl+F', act: 'find' },
      { label: '查找下一个', kbd: 'F3', act: 'findNext' },
      { label: '替换…', kbd: 'Ctrl+H', act: 'replace' },
      { label: '转到…', kbd: 'Ctrl+G', act: 'goto' },
      { sep: true },
      { label: '全选', kbd: 'Ctrl+A', act: 'selectAll' },
      { label: '时间/日期', kbd: 'F5', act: 'time' }
    ],
    format: [
      { label: '自动换行', act: 'toggleWrap', check: 'wrap' },
      { label: '字体…', act: 'openSettings' }
    ],
    view: [
      { label: '放大', kbd: 'Ctrl+=', act: 'zoomIn' },
      { label: '缩小', kbd: 'Ctrl+-', act: 'zoomOut' },
      { label: '恢复默认字号（11）', kbd: 'Ctrl+0', act: 'zoomReset' },
      { sep: true },
      { label: '自动上滑', act: 'toggleAutoScroll', check: 'autoscroll' }
    ],
    sync: [
      { label: '同步到 6.0 云端', act: 'save' },
      { label: '从 6.0 云端拉取', act: 'pull' }
    ],
    help: [
      { label: '关于 Fox记事本', act: 'about' }
    ]
  };

  function menuItem(onState) {
    return function (item) {
      const b = document.createElement('button');
      if (item.sep) {
        const s = document.createElement('div');
        s.className = 'menu-sep';
        return s;
      }
      b.className = 'menu-item ' + (item.check ? (onState(item.check) ? 'check' : 'no-check') : 'no-check');
      const label = document.createElement('span');
      label.textContent = item.label;
      b.appendChild(label);
      if (item.kbd) {
        const k = document.createElement('span');
        k.className = 'kbd';
        k.textContent = item.kbd;
        b.appendChild(k);
      }
      b.dataset.act = item.act;
      return b;
    };
  }

  function openMenu(name, anchor) {
    const layer = $('menuLayer');
    layer.hidden = false;
    layer.innerHTML = '';
    const pop = document.createElement('div');
    pop.className = 'menu-pop';
    const onState = function (k) {
      if (k === 'wrap') return !!settings.wordWrap;
      if (k === 'autoscroll') return !!settings.autoScroll;
      return false;
    };
    const maker = menuItem(onState);
    if (name === 'all') {
      Object.keys(MENUS).forEach(function (g) {
        const title = document.createElement('div');
        title.className = 'menu-group-title';
        title.textContent = ({ file: '文件', edit: '编辑', format: '格式', view: '视图', sync: '同步', help: '帮助' })[g] || g;
        pop.appendChild(title);
        MENUS[g].forEach(function (it) { pop.appendChild(maker(it)); });
      });
    } else {
      (MENUS[name] || []).forEach(function (it) { pop.appendChild(maker(it)); });
    }
    layer.appendChild(pop);

    const barH = $('topbar').getBoundingClientRect().height;
    const rect = anchor.getBoundingClientRect();
    const w = Math.min(230, window.innerWidth - 16);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(6, Math.min(rect.left, window.innerWidth - w - 8)) + 'px';
    let top = rect.bottom - barH + 2;
    pop.style.top = top + 'px';
    // 打开后若超出可视高度，向上贴边
    const maxTop = window.innerHeight - barH - 20;
    const ph = pop.getBoundingClientRect().height;
    if (top + ph > maxTop) pop.style.top = Math.max(4, maxTop - ph) + 'px';
    document.querySelectorAll('.mbtn').forEach(function (b) { b.classList.remove('active'); });
    anchor.classList.add('active');
  }

  function closeMenu() {
    const layer = $('menuLayer');
    layer.hidden = true;
    layer.innerHTML = '';
    document.querySelectorAll('.mbtn').forEach(function (b) { b.classList.remove('active'); });
  }

  // ===================== 编辑器动作 =====================
  function applyEditorChange(fn) {
    editor.focus();
    fn();
    markDirty();
  }

  function insertAtCursor(text) {
    let r = rangeInEditor();
    if (!r && lastEditorRange && lastEditorRange.startContainer &&
        (lastEditorRange.startContainer === editor || editor.contains(lastEditorRange.startContainer))) {
      r = lastEditorRange.cloneRange();
    }
    editor.focus();
    const sel = window.getSelection();
    if (r) {
      sel.removeAllRanges();
      sel.addRange(r);
    } else {
      const nr = document.createRange();
      nr.selectNodeContents(editor);
      nr.collapse(false);
      sel.removeAllRanges();
      sel.addRange(nr);
    }
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok) {
      const rg = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (rg) {
        rg.deleteContents();
        const tn = document.createTextNode(text);
        rg.insertNode(tn);
        rg.setStartAfter(tn);
        rg.collapse(true);
        sel.removeAllRanges();
        sel.addRange(rg);
      }
    }
    markDirty();
  }

  function execCommand(cmd) {
    editor.focus();
    try { document.execCommand(cmd); } catch (e) { /* 浏览器不支持时忽略 */ }
    markDirty();
  }

  async function copySelection() {
    const text = selectedPlainText();
    if (!text) { toast('没有选中内容'); return; }
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch (e) { execCommand('copy'); }
  }

  async function cutSelection() {
    const text = selectedPlainText();
    if (!text) { toast('没有选中内容'); return; }
    try { await navigator.clipboard.writeText(text); } catch (e) { /* 忽略，仍删除选中 */ }
    deleteSelection();
    toast('已剪切');
  }

  async function pasteClipboard() {
    let text = null;
    try { text = await navigator.clipboard.readText(); } catch (e) { text = null; }
    if (text === null) {
      toast('浏览器不允许读取剪贴板，请按 Ctrl+V 粘贴');
      editor.focus();
      return;
    }
    insertAtCursor(text);
  }

  function deleteSelection() {
    editor.focus();
    try { document.execCommand('delete'); } catch (e) { /* 忽略 */ }
    markDirty();
  }

  function selectAllText() {
    editor.focus();
    const r = document.createRange();
    r.selectNodeContents(editor);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function insertTime() {
    insertAtCursor(fmtInsertTime());
  }

  function gotoLine() {
    const text = getPlainText();
    const total = text.split('\n').length;
    askText('转到行', '行号（1 - ' + total + '）', String(1)).then(function (v) {
      if (v === null) return;
      const n = clamp(parseInt(v, 10) || 1, 1, total);
      const lines = text.split('\n');
      let pos = 0;
      for (let i = 0; i < n - 1; i++) pos += lines[i].length + 1;
      editor.focus();
      selectTextRange(pos, pos + lines[n - 1].length);
      const lineH = parseFloat(getComputedStyle(editor).lineHeight) || 19;
      editor.scrollTop = Math.max(0, (n - 1) * lineH - editor.clientHeight / 3);
    });
  }

  function openFind(showReplace) {
    const bar = $('findBar');
    bar.hidden = false;
    const offs = currentEditorOffsets();
    const sel = offs ? getPlainText().substring(offs.start, offs.end) : '';
    if (sel && sel.indexOf('\n') < 0) $('findInput').value = sel;
    $('findInput').focus();
    if (showReplace) $('replaceInput').focus();
  }

  function closeFind() { $('findBar').hidden = true; }

  function findNext(dir) {
    const q = $('findInput').value;
    if (!q) { toast('请输入查找内容'); $('findInput').focus(); return; }
    const cs = $('findCase').checked;
    const text = getPlainText();
    const hay = cs ? text : text.toLowerCase();
    const needle = cs ? q : q.toLowerCase();
    const offs = currentEditorOffsets();
    let start;
    if (dir > 0) start = offs ? offs.end : 0;
    else start = offs ? Math.max(0, offs.start - 1) : Math.max(0, text.length - 1);
    let idx = dir > 0 ? hay.indexOf(needle, start) : hay.lastIndexOf(needle, start);
    if (idx < 0) idx = dir > 0 ? hay.indexOf(needle, 0) : hay.lastIndexOf(needle);
    if (idx < 0) { toast('未找到：' + q); return; }
    editor.focus();
    selectTextRange(idx, idx + q.length);
    const lineH = parseFloat(getComputedStyle(editor).lineHeight) || 19;
    const before = text.substring(0, idx).split('\n').length - 1;
    if (before * lineH < editor.scrollTop || before * lineH > editor.scrollTop + editor.clientHeight - lineH * 2) {
      editor.scrollTop = Math.max(0, before * lineH - editor.clientHeight / 3);
    }
  }

  function currentMatch() {
    const q = $('findInput').value;
    if (!q) return false;
    const cs = $('findCase').checked;
    const sel = selectedPlainText();
    return cs ? sel === q : sel.toLowerCase() === q.toLowerCase();
  }

  function replaceOne() {
    const q = $('findInput').value;
    if (!q) { toast('请输入查找内容'); return; }
    if (!currentMatch()) { findNext(1); return; }
    const rep = $('replaceInput').value;
    editor.focus();
    try {
      if (rep) document.execCommand('insertText', false, rep);
      else document.execCommand('delete');
    } catch (e) { /* 忽略 */ }
    markDirty();
    findNext(1);
  }

  function replaceAll() {
    const q = $('findInput').value;
    if (!q) { toast('请输入查找内容'); return; }
    const rep = $('replaceInput').value;
    const cs = $('findCase').checked;
    const model = buildModel();
    const text = model.text;
    const hay = cs ? text : text.toLowerCase();
    const needle = cs ? q : q.toLowerCase();
    const matches = [];
    let pos = 0;
    while (pos <= hay.length) {
      const idx = hay.indexOf(needle, pos);
      if (idx < 0) break;
      matches.push([idx, idx + q.length]);
      pos = idx + q.length;
    }
    if (!matches.length) { toast('未找到：' + q); return; }
    const ranges = matches.map(function (m) { return rangeFromModel(model, m[0], m[1]); });
    editor.focus();
    // 从后往前替换：靠前的 Range 不受后面 DOM 变化影响，颜色也不会被冲掉
    for (let i = ranges.length - 1; i >= 0; i--) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(ranges[i]);
      try {
        if (rep) document.execCommand('insertText', false, rep);
        else document.execCommand('delete');
      } catch (e) { /* 忽略 */ }
    }
    markDirty();
    toast('已替换 ' + matches.length + ' 处');
  }
  // ===================== 云端读写 =====================
  function buildFileData(id, name, content, S, E, folder, owner, createTime) {
    const now = fmtDateTime();
    const created = createTime || now;
    return {
      '拥有者': owner || '',
      'ID': id,
      '文件名': name,
      '内容': content,
      '起点号': String(S),
      '终点号': String(E),
      '文件夹路径': folder || '',
      '最后上传发起时间': now,
      '最后编辑时间': now,
      '同步时间': now,
      'MD5': '',
      '内容字符数': String(content.length),
      '创建日期': created,
      '文件JSON': JSON.stringify({
        'id': id, 'name': name, '内容': content, '起点号': S, '终点号': E,
        '拥有者': owner || '', '文件夹路径': folder || '', '创建日期': created,
        '最后编辑时间': now, '内容字符数': content.length
      })
    };
  }

  function splitCloudJson(whole, baseId) {
    if (whole.length <= MAX_CLOUD_CHARS) return null;
    const totalParts = Math.ceil(whole.length / MAX_CLOUD_CHARS);
    const parts = [];
    for (let i = 0; i < totalParts; i++) {
      const start = i * MAX_CLOUD_CHARS;
      const end = Math.min(start + MAX_CLOUD_CHARS, whole.length);
      parts.push({
        id: i === 0 ? baseId : baseId + '-' + (i + 1),
        json: whole.substring(start, end),
        charCountStr: whole.length + '-' + (i + 1) + '/' + totalParts
      });
    }
    return parts;
  }

  async function writeFragments(parts, ver, name, folder, owner, createTime) {
    for (let i = 1; i < parts.length; i++) {
      const p = parts[i];
      await cloudCall('批量写入', {
        'ID': p.id,
        '本地新文件标识': 'true',
        '锁登记处': deviceId(),
        '数据': {
          'ID': p.id,
          '文件名': name,
          '起点号': String(ver),
          '终点号': String(ver),
          '拥有者': owner || '',
          '文件夹路径': folder || '',
          '内容字符数': p.charCountStr,
          '创建日期': createTime || fmtDateTime(),
          '最后上传发起时间': fmtDateTime(),
          '最后编辑时间': fmtDateTime(),
          '文件JSON': p.json
        }
      });
    }
  }

  async function findRowById(id) {
    const r = await cloudCall('查找', { '列名': 'ID', '关键字': id });
    return (r['数据'] || [])[0] || null;
  }

  // 按 ID 取正文；大文件按 6.0 的「ID-2…」片段顺序拼接（与内核 merge_cloud_fragments 一致）
  async function fetchContentById(id) {
    const row = await findRowById(id);
    if (!row) throw new Error('云端没有该文件（ID=' + id + '）');
    let raw = row['文件JSON'] || '';
    const m = /^(\d+)-(\d+)\/(\d+)$/.exec(String(row['内容字符数'] || ''));
    if (m && Number(m[3]) > 1) {
      const total = Math.min(Number(m[3]), 20);
      for (let i = 2; i <= total; i++) {
        const fr = await findRowById(id + '-' + i);
        if (fr && fr['文件JSON']) raw += fr['文件JSON'];
      }
    }
    let obj = null;
    try { obj = JSON.parse(raw); } catch (e) { throw new Error('云端文件JSON解析失败'); }
    return {
      content: typeof obj['内容'] === 'string' ? obj['内容'] : '',
      s: Number(row['起点号']) || 0,
      e: Number(row['终点号']) || 0,
      name: row['文件名'] || '',
      folder: row['文件夹路径'] || '',
      createTime: row['创建日期'] || ''
    };
  }

  function applyCloudVersion(ver) {
    doc.s = Number(ver);
    doc.e = Number(ver);
    doc.isNew = false;
    doc.dirty = false;
    updateHeader();
    writeDocCache();
    updateTitle();
  }

  async function saveToCloud(asNew) {
    if (syncBusy) { toast('正在同步，请稍候'); return; }
    let name = doc.name;
    if (asNew) {
      name = await askText('另存为', '请输入新的云端文件名', doc.name || '无标题.txt');
      if (name === null) return;
      name = name.trim();
      if (!name) { toast('文件名不能为空'); return; }
    } else if (!name) {
      name = await askText('保存到云端', '请输入云端文件名', '无标题.txt');
      if (name === null) return;
      name = name.trim();
      if (!name) { toast('文件名不能为空'); return; }
    }

    const content = serializeEditor();
    let id = doc.id;
    let S;
    let E;
    let isNew;
    if (asNew || !id) {
      id = id && !asNew ? id : genId();
      S = 0;
      E = 1;
      isNew = true;
    } else if (doc.isNew) {
      S = 0;
      E = 1;
      isNew = true;
    } else {
      S = Number(doc.s || 0);
      if (doc.dirty) E = S + 1;
      else E = Number(doc.e === null || doc.e === undefined ? S : doc.e);
      isNew = false;
    }

    const owner = settings.user;
    const folder = doc.folder || currentFolder || '';
    const createTime = asNew ? fmtDateTime() : (doc.createTime || fmtDateTime());

    const whole = JSON.stringify({
      'id': id, 'name': name, '内容': content, '起点号': S, '终点号': E,
      '拥有者': owner, '文件夹路径': folder, '创建日期': createTime,
      '最后编辑时间': fmtDateTime(), '内容字符数': content.length
    });
    let data = buildFileData(id, name, content, S, E, folder, owner, createTime);
    const parts = splitCloudJson(whole, id);
    if (parts) {
      data['文件JSON'] = parts[0].json;
      data['内容字符数'] = parts[0].charCountStr;
    }

    syncBusy = true;
    $('btnSync').disabled = true;
    try {
      const sub = await cloudCall('同步提交', {
        'ID': id,
        '起点号': String(S),
        '终点号': String(E),
        '本地新文件标识': isNew ? 'true' : 'false',
        '数据': data,
        '锁登记处': deviceId()
      });

      const judge = sub['判定结果'];
      if (sub.status === 'conflict' || judge === '同步冲突') {
        await handleConflict(id, name, content, S, E, data, sub['云端版本号']);
        return;
      }
      if (judge === '无需上传') {
        applyCloudVersion(Number(sub['云端版本号']) || E);
        doc.name = name;
        toast('云端已是最新，无需上传');
      } else if (judge === '全新接收' || judge === '收为临时') {
        const ver = Number(sub['云端版本号'] || sub['终点号'] || E) || E;
        if (parts) {
          await writeFragments(parts, ver, name, folder, owner, createTime);
        }
        if (judge === '收为临时') {
          await cloudCall('转正确认', { 'ID': id, '起点号': String(ver), '锁登记处': deviceId() });
        }
        doc.id = id;
        doc.name = name;
        doc.folder = folder;
        doc.createTime = createTime;
        applyCloudVersion(ver);
        toast('已同步到 6.0 云端：' + name + '（v' + ver + '）');
      } else {
        // 兜底：把两号追平，不误报失败
        applyCloudVersion(E);
        doc.name = name;
        toast('同步完成：' + name);
      }
      if (page === 'files') await refreshIndex(true);
    } catch (err) {
      toast('同步失败：' + (err.message || err));
    } finally {
      await unlockCloud();
      syncBusy = false;
      $('btnSync').disabled = false;
    }
  }

  async function handleConflict(id, name, content, S, E, data, cloudVer) {
    const choice = await chooseOne(
      '同步冲突',
      '本地版本 v' + S + ' 与云端 v' + cloudVer + ' 不一致，请选择处理方式。',
      [
        { label: '使用云端版本（覆盖本地）', value: 'cloud' },
        { label: '用本地覆盖云端', value: 'local' },
        { label: '稍后处理', value: null }
      ]
    );
    if (!choice) { toast('同步冲突：已保留本地，稍后处理'); return; }
    if (choice === 'cloud') {
      const info = await fetchContentById(id);
      doc.id = id;
      doc.name = name;
      setDoc(name, info.content, { id: id, s: info.s, e: info.e, folder: info.folder, createTime: info.createTime });
      toast('已改用云端版本');
      return;
    }
    await cloudCall('强制覆盖云端', {
      'ID': id,
      '数据': data,
      '强制终点号': String(E),
      '锁登记处': deviceId()
    });
    doc.id = id;
    doc.name = name;
    applyCloudVersion(E);
    toast('已用本地版本覆盖云端');
  }

  async function pullCurrent() {
    if (syncBusy) { toast('正在同步，请稍候'); return; }
    let id = doc.id;
    let name = doc.name;
    if (!id) {
      // 未绑定云端文件：直接打开云端文件列表让用户点选，不再要求手输文件名
      showPage('files');
      refreshIndex(false);
      toast('请从列表中选择要打开的云端文件', 3200);
      return;
    }
    if (doc.dirty && !(await modalConfirm('覆盖本地修改？', '当前文档有未同步的修改，拉取云端版本会覆盖它。', '覆盖并拉取'))) return;

    syncBusy = true;
    try {
      const info = await fetchContentById(id);
      setDoc(info.name || name, info.content, {
        id: id, s: info.s, e: info.e, folder: info.folder, createTime: info.createTime
      });
      doc.name = info.name || name;
      updateHeader();
      toast('已从 6.0 云端拉取：' + doc.name + '（v' + info.s + '）');
    } catch (err) {
      toast('拉取失败：' + err.message);
    } finally {
      syncBusy = false;
    }
  }

  // ===================== 文件列表 =====================
  function findFolderName(fid) {
    const f = cloudIndex.find(function (x) { return x['ID'] === fid; });
    return f ? f['文件名'] : fid;
  }

  async function refreshIndex(silent) {
    try {
      const r = await cloudCall('读取索引');
      cloudIndex = Array.isArray(r['数据']) ? r['数据'].slice() : [];
      renderFiles();
      if (!silent) toast('已刷新云端文件列表（' + cloudIndex.length + ' 项）');
    } catch (err) {
      if (!silent) toast('刷新失败：' + err.message);
    }
  }

  function renderFiles() {
    const tbody = $('fileTbody');
    const q = ($('fileSearch').value || '').trim().toLowerCase();
    let rows = cloudIndex.filter(function (f) {
      const folder = String(f['文件夹路径'] || '');
      if (folder !== currentFolder) return false;
      if (!q) return true;
      return String(f['文件名'] || '').toLowerCase().indexOf(q) !== -1;
    });

    rows.sort(function (a, b) {
      const af = String(a['ID'] || '').indexOf('FOLDER_') === 0;
      const bf = String(b['ID'] || '').indexOf('FOLDER_') === 0;
      if (af !== bf) return af ? -1 : 1;
      return String(b['最后编辑时间'] || '').localeCompare(String(a['最后编辑时间'] || ''));
    });

    tbody.innerHTML = '';
    rows.forEach(function (f) {
      const id = String(f['ID'] || '');
      const isFolder = id.indexOf('FOLDER_') === 0;
      const tr = document.createElement('tr');
      if (isFolder) tr.className = 'row-folder';

      const tdName = document.createElement('td');
      tdName.className = 'col-name';
      const wrap = document.createElement('span');
      wrap.className = 'fname';
      const ico = document.createElement('span');
      ico.className = 'ico';
      ico.textContent = isFolder ? '📁' : '📄';
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = String(f['文件名'] || '（无名称）');
      txt.title = txt.textContent;
      wrap.appendChild(ico);
      wrap.appendChild(txt);
      tdName.appendChild(wrap);
      tr.appendChild(tdName);

      const cells = [
        isFolder ? '—' : String(f['内容字符数'] || '0'),
        isFolder ? '—' : String(f['起点号'] || '0'),
        isFolder ? '—' : String(f['终点号'] || '0'),
        isFolder ? '—' : String(f['最后编辑时间'] || '')
      ];
      cells.forEach(function (v) {
        const td = document.createElement('td');
        td.className = 'col-num';
        td.textContent = v;
        tr.appendChild(td);
      });

      const tdState = document.createElement('td');
      tdState.className = 'col-state';
      const tag = document.createElement('span');
      const rawState = isFolder ? '文件夹' : String(f['状态'] || '');
      tag.className = 'state-tag' + (rawState === '官方' ? ' ok' : rawState === '临时' ? ' tmp' : '');
      tag.textContent = rawState || '—';
      tdState.appendChild(tag);
      tr.appendChild(tdState);

      const tdOp = document.createElement('td');
      tdOp.className = 'col-op';
      const opWrap = document.createElement('div');
      opWrap.className = 'op-cell';
      const bOpen = document.createElement('button');
      bOpen.className = 'btn';
      bOpen.textContent = '打开';
      bOpen.dataset.act = isFolder ? 'enter-folder' : 'open-file';
      bOpen.dataset.id = id;
      opWrap.appendChild(bOpen);
      if (!isFolder) {
        const bDel = document.createElement('button');
        bDel.className = 'btn danger';
        bDel.textContent = '删除';
        bDel.dataset.act = 'delete-file';
        bDel.dataset.id = id;
        bDel.dataset.name = String(f['文件名'] || '');
        opWrap.appendChild(bDel);
      }
      tdOp.appendChild(opWrap);
      tr.appendChild(tdOp);

      // 整行可点：手机上不必横向滑动找按钮——文件夹=进入，文章=直接打开
      tr.addEventListener('click', function (e) {
        if (e.target.closest('button')) return;
        if (isFolder) enterFolder(id); else openCloudFile(id);
      });
      tbody.appendChild(tr);
    });

    $('fileEmpty').hidden = rows.length > 0;
    $('crumb').textContent = currentFolder ? ('根目录 / ' + findFolderName(currentFolder)) : '根目录';
    $('crumb').classList.toggle('clickable', !!currentFolder);
  }

  function enterFolder(id) {
    currentFolder = id;
    renderFiles();
  }
  function goRoot() {
    currentFolder = '';
    renderFiles();
  }

  async function openCloudFile(id) {
    if (doc.dirty && !(await modalConfirm('放弃未保存的修改？', '当前文档有未同步的修改，打开其他文件会丢失。', '继续打开'))) return;
    try {
      const info = await fetchContentById(id);
      setDoc(info.name, info.content, {
        id: id, s: info.s, e: info.e, folder: info.folder, createTime: info.createTime
      });
      showPage('edit');
      toast('已打开：' + info.name);
    } catch (err) {
      toast('打开失败：' + err.message);
    }
  }

  async function deleteCloudFile(id, name) {
    if (!(await modalConfirm('删除云端文件', '确定删除「' + name + '」？此操作不可恢复。', '删除', true))) return;
    if (!(await modalConfirm('再次确认', '真的要删除「' + name + '」吗？删除后无法从回收站恢复。', '仍然删除', true))) return;
    try {
      await cloudCall('删除行', { 'ID': id, '锁登记处': deviceId() });
      if (doc.id === id) {
        setDoc('', '', null);
        doc.dirty = false;
        writeDocCache();
      }
      await refreshIndex(true);
      toast('已删除：' + name);
    } catch (err) {
      toast('删除失败：' + err.message);
    } finally {
      await unlockCloud();
    }
  }

  async function createFolder() {
    const name = await askText('新建文件夹', '请输入文件夹名称', '');
    if (name === null) return;
    const folderName = name.trim();
    if (!folderName) { toast('文件夹名称不能为空'); return; }
    const parent = currentFolder;
    const exists = cloudIndex.some(function (f) {
      return String(f['ID'] || '').indexOf('FOLDER_') === 0 &&
        String(f['文件夹路径'] || '') === parent &&
        String(f['文件名'] || '') === folderName;
    });
    if (exists) { toast('同名文件夹已存在'); return; }
    try {
      const folderId = 'FOLDER_' + genId();
      await cloudCall('批量写入', {
        'ID': folderId,
        '本地新文件标识': 'true',
        '锁登记处': deviceId(),
        '数据': {
          'ID': folderId,
          '文件名': folderName,
          '内容': '',
          '起点号': '0',
          '终点号': '0',
          '文件夹路径': parent,
          '最后上传发起时间': fmtDateTime()
        }
      });
      await refreshIndex(true);
      toast('已新建文件夹：' + folderName);
    } catch (err) {
      toast('新建文件夹失败：' + err.message);
    } finally {
      await unlockCloud();
    }
  }

  // ===================== 文件动作 =====================
  function newDocument() {
    if (doc.dirty && !window.confirm('当前文档有未同步的修改，仍要新建吗？')) return;
    setDoc('', '', null);
    doc.dirty = false;
    doc.folder = currentFolder;
    writeDocCache();
    showPage('edit');
    updateHeader();
    toast('已新建空白文档');
  }

  async function exitDocument() {
    if (doc.dirty && !(await modalConfirm('退出 / 清空', '当前文档有未同步的修改，退出会清空正文。', '仍然退出', true))) return;
    setDoc('', '', null);
    doc.dirty = false;
    writeDocCache();
    showPage('edit');
    updateHeader();
    toast('文档已清空');
  }

  function showFiles() {
    showPage('files');
    renderFiles();
    refreshIndex(true);
  }

  function showSettings() {
    settingsReturnPage = page;
    settingsReturnPage = page === 'settings' ? 'edit' : page;
    fillSettingsForm();
    showPage('settings');
  }

  function fillSettingsForm() {
    $('setFamily').value = settings.fontFamily;
    $('setSize').value = settings.fontSize;
    $('setSpacing').value = settings.lineSpacing;
    $('setWrap').checked = !!settings.wordWrap;
    $('setAutoScroll').checked = !!settings.autoScroll;
    $('setSpeed').value = settings.autoScrollSpeed;
    $('setSheet').value = settings.sheet;
    $('setUser').value = settings.user;
    $('setPass').value = settings.password;
    $('verStatic').textContent = APP_VERSION;
    $('settingsVer').textContent = APP_VERSION;
  }

  function saveSettingsForm() {
    const size = clamp(parseInt($('setSize').value, 10) || 11, 6, 128);
    const spacing = clamp(parseInt($('setSpacing').value, 10) || 0, 0, 12);
    const speed = clamp(parseInt($('setSpeed').value, 10) || 60, 1, 600);
    const family = ($('setFamily').value || '').trim() || DEFAULT_SETTINGS.fontFamily;
    const sheet = ($('setSheet').value || '').trim() || DEFAULT_SETTINGS.sheet;
    const user = ($('setUser').value || '').trim() || DEFAULT_SETTINGS.user;
    const pass = ($('setPass').value || '').trim() || DEFAULT_SETTINGS.password;

    settings.fontFamily = family;
    settings.fontSize = size;
    settings.lineSpacing = spacing;
    settings.wordWrap = !!$('setWrap').checked;
    settings.autoScroll = !!$('setAutoScroll').checked;
    settings.autoScrollSpeed = speed;
    settings.sheet = sheet;
    settings.user = user;
    settings.password = pass;
    saveSettings();
    applyFont();
    applyWrap();
    applyAutoScrollBtn();
    if (settings.autoScroll) startAutoScroll(); else stopAutoScroll();
    showPage(settingsReturnPage === 'settings' ? 'edit' : settingsReturnPage);
    toast('设置已保存');
  }

  async function clearLocalCache() {
    if (!(await modalConfirm('清空本地缓存', '将删除本地缓存的正文、文件名、云端编号等（保留账号密码与显示偏好）。', '清空'))) return;
    clearCacheExceptWhitelist();
    cacheSet('ver', APP_VERSION);
    setDoc('', '', null);
    doc.dirty = false;
    writeDocCache();
    updateHeader();
    toast('本地缓存已清空');
  }

  function showAbout() {
    const m = modalBase('关于 Fox记事本');
    const lines = [
      'Fox记事本 网页版 ' + APP_VERSION,
      '与 Python 版共用 6.0 云端库（金山文档表格「Fox记事本」）。',
      '云同步：起点号 / 终点号 双号 + 两阶段提交。',
      '账号：' + settings.user + '　表格：' + settings.sheet,
      '',
      '本页面为纯静态文件，可直接部署到 GitHub Pages。'
    ];
    lines.forEach(function (t) {
      const div = document.createElement('div');
      div.textContent = t;
      m.body.appendChild(div);
    });
    const close = document.createElement('button');
    close.className = 'btn primary';
    close.textContent = '关闭';
    close.addEventListener('click', function () {
      m.layer.hidden = true;
      m.layer.innerHTML = '';
    });
    m.foot.appendChild(close);
  }

  // ===================== 菜单动作表 =====================
  const ACTIONS = {
    'new': newDocument,
    'openList': showFiles,
    'save': function () { saveToCloud(false); },
    'saveAs': function () { saveToCloud(true); },
    'exit': exitDocument,
    'undo': function () { execCommand('undo'); },
    'redo': function () { execCommand('redo'); },
    'cut': cutSelection,
    'copy': copySelection,
    'paste': pasteClipboard,
    'del': deleteSelection,
    'find': function () { openFind(false); },
    'findNext': function () { findNext(1); },
    'replace': function () { openFind(true); },
    'goto': gotoLine,
    'selectAll': selectAllText,
    'time': insertTime,
    'toggleWrap': function () {
      settings.wordWrap = !settings.wordWrap;
      applyWrap();
      saveSettings();
    },
    'openSettings': showSettings,
    'zoomIn': function () { setFontSize(settings.fontSize + 1); },
    'zoomOut': function () { setFontSize(settings.fontSize - 1); },
    'zoomReset': function () { setFontSize(11); },
    'toggleAutoScroll': toggleAutoScroll,
    'pull': pullCurrent,
    'about': showAbout
  };

  // ===================== 事件绑定 =====================
  function bindEvents() {
    // 顶栏菜单按钮
    document.querySelectorAll('.mbtn[data-menu]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!$('menuLayer').hidden && b.classList.contains('active')) { closeMenu(); return; }
        openMenu(b.dataset.menu, b);
      });
    });
    $('btnAllMenu').addEventListener('click', function (e) {
      e.stopPropagation();
      if (!$('menuLayer').hidden) { closeMenu(); return; }
      openMenu('all', $('btnAllMenu'));
    });
    $('menuLayer').addEventListener('click', function (e) {
      if (e.target === $('menuLayer')) { closeMenu(); return; }
      const item = e.target.closest('[data-act]');
      if (item && ACTIONS[item.dataset.act]) {
        closeMenu();
        ACTIONS[item.dataset.act]();
      }
    });

    // 第一行
    $('btnSync').addEventListener('click', function () { saveToCloud(false); });
    $('btnPull').addEventListener('click', pullCurrent);

    // 第二行
    $('btnZoomIn').addEventListener('click', function () { setFontSize(settings.fontSize + 1); });
    $('btnZoomOut').addEventListener('click', function () { setFontSize(settings.fontSize - 1); });
    $('fontSizeBox').addEventListener('change', function () {
      setFontSize(parseInt(this.value, 10) || 11);
    });
    $('btnWrap').addEventListener('click', function () {
      settings.wordWrap = !settings.wordWrap;
      applyWrap();
      saveSettings();
    });
    $('btnAutoScroll').addEventListener('click', toggleAutoScroll);
    $('btnFiles').addEventListener('click', showFiles);
    $('btnSettings').addEventListener('click', showSettings);

    // 编辑
    editor.addEventListener('input', markDirty);
    editor.addEventListener('scroll', function () {
      if (settings.autoScroll) autoLast = Date.now();
    });
    editor.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault(); setFontSize(settings.fontSize + 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault(); setFontSize(settings.fontSize - 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault(); setFontSize(11);
      }
    });
    editor.addEventListener('wheel', function (e) {
      if (e.ctrlKey) {
        e.preventDefault();
        setFontSize(settings.fontSize + (e.deltaY < 0 ? 1 : -1));
      }
    }, { passive: false });

    // 文字颜色：顶栏按钮 / 右键菜单 / 弹层
    $('btnTextColor').addEventListener('mousedown', function (e) { e.preventDefault(); });
    $('btnTextColor').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleColorPop(this);
    });
    editor.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY);
    });
    editor.addEventListener('paste', function (e) {
      // 只接收纯文本，避免把外部 HTML/样式带进来破坏颜色模型
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      let text = '';
      try { text = cd ? (cd.getData('text/plain') || '') : ''; } catch (err) { text = ''; }
      insertAtCursor(text);
    });
    document.addEventListener('click', function (e) {
      const inBtn = e.target && e.target.closest && e.target.closest('#btnTextColor');
      if (colorPop && !inBtn && !colorPop.contains(e.target)) closeColorPop();
      if (ctxMenu && !ctxMenu.contains(e.target)) closeCtxMenu();
    });
    window.addEventListener('resize', function () { closeColorPop(); closeCtxMenu(); });

    // 查找条
    $('btnFindPrev').addEventListener('click', function () { findNext(-1); });
    $('btnFindNext').addEventListener('click', function () { findNext(1); });
    $('btnReplace').addEventListener('click', replaceOne);
    $('btnReplaceAll').addEventListener('click', replaceAll);
    $('btnFindClose').addEventListener('click', closeFind);
    $('findInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    });
    $('replaceInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    });

    // 文件列表
    $('btnBackEdit').addEventListener('click', function () { showPage('edit'); });
    $('btnRefresh').addEventListener('click', function () { refreshIndex(false); });
    $('btnNewFile').addEventListener('click', newDocument);
    $('btnNewFolder').addEventListener('click', createFolder);
    $('fileSearch').addEventListener('input', renderFiles);
    $('crumb').addEventListener('click', function () { if (currentFolder) goRoot(); });
    $('fileTbody').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'open-file') openCloudFile(id);
      else if (btn.dataset.act === 'delete-file') deleteCloudFile(id, btn.dataset.name);
      else if (btn.dataset.act === 'enter-folder') enterFolder(id);
    });

    // 设置页
    $('btnSettingsSave').addEventListener('click', saveSettingsForm);
    $('btnSettingsExit').addEventListener('click', function () {
      showPage(settingsReturnPage === 'settings' ? 'edit' : settingsReturnPage);
    });
    $('btnClearCache').addEventListener('click', clearLocalCache);

    // 全局快捷键
    document.addEventListener('keydown', function (e) {
      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && (key === 's' || key === 'S')) {
        e.preventDefault();
        if (e.shiftKey) saveToCloud(true); else saveToCloud(false);
      } else if (ctrl && (key === 'n' || key === 'N')) {
        e.preventDefault(); newDocument();
      } else if (ctrl && (key === 'o' || key === 'O')) {
        e.preventDefault(); showFiles();
      } else if (ctrl && (key === 'f' || key === 'F')) {
        e.preventDefault(); openFind(false);
      } else if (ctrl && (key === 'h' || key === 'H')) {
        e.preventDefault(); openFind(true);
      } else if (ctrl && (key === 'g' || key === 'G')) {
        e.preventDefault(); gotoLine();
      } else if (key === 'F3') {
        e.preventDefault(); findNext(1);
      } else if (key === 'F5') {
        e.preventDefault(); if (page === 'edit') insertTime();
      } else if (key === 'Escape') {
        if (!$('menuLayer').hidden) closeMenu();
        if (colorPop) closeColorPop();
        if (ctxMenu) closeCtxMenu();
        if (!$('findBar').hidden) closeFind();
      }
    });

    window.addEventListener('beforeunload', function (e) {
      writeDocCache();
      if (doc.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ===================== 启动 =====================
  function boot() {
    // 版本号显示（页面里唯一出处是常量，顶栏/设置页同值）
    $('verPill').textContent = APP_VERSION;
    $('verStatic').textContent = APP_VERSION;
    $('settingsVer').textContent = APP_VERSION;

    restoreDocCache();
    applyFont();
    applyWrap();
    applyAutoScrollBtn();
    updateHeader();
    setPhase('idle', '正在连接云端…');
    bindEvents();
    renderFiles();

    // 开机自动连云端：直接读表格索引，成功即显示“已连接”，无需任何手动点击
    (async function 自动连接云端() {
      try {
        const r = await cloudCall('读取索引', {}, true);
        cloudIndex = Array.isArray(r['数据']) ? r['数据'].slice() : [];
        renderFiles();
        setPhase('ok', '已连接云端（' + cloudIndex.length + ' 项）');
      } catch (err) {
        setPhase('fail', '云端连接失败：' + (err && err.message ? err.message : err));
      }
    })();

    if (getPlainText()) {
      toast('已恢复上次编辑的文档：' + (doc.name || '未命名'), 3200);
    }
    setTimeout(function () { editor.focus(); }, 100);
  }

  boot();
})();
