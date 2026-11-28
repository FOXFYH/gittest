/* wsqcore.js —— WebSocket 收发器客户端网页版纯逻辑内核（无 DOM、无样式） */
(function (global) {
  'use strict';
  var WSQ = { 版本: '1.8' };

  /* ---------------- 常量 ---------------- */
  var 前缀 = 'WSRELAY1';               /* 业务频道1＝前缀+序号1+口令，与电脑端一致 */
  var 默认口令 = '31415926fF@';
  var 默认心跳 = 60, 默认静止 = 120;
  var 主集群名 = 'WS1';                 /* 主集群代码写死，客户端与服务端一致 */
  var 默认临主分 = 600, 默认喊话秒 = 180;
  function _mk(a) { var s = '', i; for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return s; }
  var 内置集群 = {
    WS1: { cluster: 'free.blr2', key: _mk([82,101,68,70,97,118,104,104,48,113,110,79,67,75,85,85,106,81,105,76,75,86,90,57,82,100,120,65,54,101,52,66,71,86,75,120,120,78,117,103]) },
    WS2: { cluster: 's20307.nyc1', key: _mk([73,87,107,102,107,52,51,104,97,51,121,105,108,109,89,71,82,71,76,68,101,65,111,86,87,57,116,117,54,81,113,105,83,118,105,74,109,117,100,76]) },
    WS3: { cluster: 'free.blr2', key: _mk([56,87,87,110,68,72,101,112,110,117,54,68,80,110,115,49,86,97,106,90,101,78,83,115,105,71,51,103,98,69,99,50,54,72,122,113,115,68,75,73]) },
    WS4: { cluster: 's21218.nyc1', key: _mk([89,122,118,87,68,88,66,117,66,76,112,103,77,78,56,84,85,117,101,113,51,105,77,66,74,81,76,84,84,101,82,115,54,75,80,106,122,111,79,87]) },
    WS5: { cluster: 'free.blr2', key: _mk([68,55,68,86,85,108,89,120,106,83,81,78,111,97,77,107,74,79,56,107,112,115,101,101,100,120,49,115,117,73,55,54,69,54,118,122,72,66,68,101]) }
  };

  /* ---------------- 存储 ---------------- */
  var 存储前缀 = 'wsq_';
  function LS(k, d) { try { var v = localStorage.getItem(存储前缀 + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function SS(k, v) { try { localStorage.setItem(存储前缀 + k, JSON.stringify(v)); } catch (e) {} }
  function 清缓存() { try { for (var i = localStorage.length - 1; i >= 0; i--) { var k = localStorage.key(i); if (k.indexOf(存储前缀) === 0) localStorage.removeItem(k); } } catch (e) {} }

  /* ---------------- 配置与集群表 ---------------- */
  var 配置 = null, 集群表 = null, 内置覆盖 = 内置集群;
  function 默认设备名() { var m = (navigator.userAgent.match(/Windows|Macintosh|iPhone|iPad|Android|Linux/i) || ['浏览器'])[0]; return m; }
  function 新实例号() { return String(Math.floor(1000000000 + Math.random() * 9000000000)); }

  WSQ.初始化 = function (选项) {
    选项 = 选项 || {};
    if (选项.存储前缀) 存储前缀 = String(选项.存储前缀);
    内置覆盖 = 选项.默认集群 || 内置覆盖;
    集群表 = LS('clusters', null) || JSON.parse(JSON.stringify(内置覆盖));
    配置 = {
      id: LS('id', '') || (function () { var v = 新实例号(); SS('id', v); return v; })(),
      nic: LS('nic', ''), prod: LS('prod', 'WS客户端网页'), dev: LS('dev', 默认设备名()),
      pass: LS('pass', 默认口令), biz: LS('biz', ''), emg: LS('emg', 'WS5'),
      hb: LS('hb', 默认心跳), smart: LS('smart', true), auto: LS('auto', true),
      autoSrv: LS('autoSrv', true),
      still: LS('still', 默认静止),
      智调: LS('智调', true), 临主分: Number(LS('临主分', 默认临主分)) || 默认临主分,
      喊话秒: Number(LS('喊话秒', 默认喊话秒)) || 默认喊话秒,
      临主: String(LS('临主', '') || ''), 临主到: Number(LS('临主到', 0) || 0),
      加密频道: String(LS('加密频道', '') || '')
    };
    if (!集群表[配置.emg]) 配置.emg = Object.keys(集群表)[Object.keys(集群表).length - 1];
    /* 启动按临时主到期选集群：过期或无效就回写死的主集群 */
    if (!(配置.临主 && 配置.临主到 > Date.now() && 集群表[配置.临主])) { 配置.临主 = ''; 配置.临主到 = 0; }
    配置.biz = 配置.临主 || 主集群名;
    if (!集群表[配置.biz]) 配置.biz = Object.keys(集群表)[0];
    存配置();
    版本清理();
    return WSQ;
  };
  function 版本清理() {
    var 见 = LS('ver', '');
    if (见 && 见 !== WSQ.版本) {
      var 留 = {}, 键 = ['id','nic','prod','dev','pass','biz','emg','clusters','still','智调','临主分','喊话秒','临主','临主到','lastsrv','autoSrv','加密频道'];
      键.forEach(function (k) { var v = localStorage.getItem(存储前缀 + k); if (v !== null) 留[k] = v; });
      清缓存();
      Object.keys(留).forEach(function (k) { try { localStorage.setItem(存储前缀 + k, 留[k]); } catch (e) {} });
    }
    SS('ver', WSQ.版本);
  }
  function 存配置() {
    ['id','nic','prod','dev','pass','biz','emg','hb','smart','auto','still','智调','临主分','喊话秒','临主','临主到','autoSrv','加密频道']
      .forEach(function (k) { SS(k, 配置[k]); });
  }

  WSQ.读配置 = function () { return JSON.parse(JSON.stringify(配置)); };
  WSQ.集群表 = function () { return JSON.parse(JSON.stringify(集群表)); };
  WSQ.频道 = function () { return 前缀 + (配置.pass || 默认口令); };
  WSQ.设置集群表 = function (表) { if (表 && typeof 表 === 'object' && Object.keys(表).length) { 集群表 = JSON.parse(JSON.stringify(表)); SS('clusters', 集群表); } };
  WSQ.改配置 = function (补丁) {
    if (!补丁) return false;
    补丁 = JSON.parse(JSON.stringify(补丁));
    var 新业务 = 补丁.biz; delete 补丁.biz;
    var 旧emg = 配置.emg, 旧pass = 配置.pass, 动了 = false;
    Object.keys(补丁).forEach(function (k) { if (k in 配置) 配置[k] = 补丁[k]; });
    配置.hb = Math.max(0, Number(配置.hb || 默认心跳));
    存配置(); SS('clusters', 集群表);
    if (新业务 && 集群表[新业务] && 新业务 !== 配置.biz) { 动了 = 切换请求(新业务) || 动了; }
    else if ((旧emg !== 配置.emg || 旧pass !== 配置.pass) && 状态 !== '未连接') { 断开全部(); setTimeout(连接全部, 400); 动了 = true; }
    通知({类型: '配置', 配置: WSQ.读配置()});
    return 动了;
  };
  WSQ.清缓存 = 清缓存;

  /* ---------------- 事件 ---------------- */
  var 监听们 = [];
  function 通知(ev) { for (var i = 0; i < 监听们.length; i++) { try { 监听们[i](ev); } catch (e) {} } }
  WSQ.监听 = function (fn) { if (typeof fn === 'function' && 监听们.indexOf(fn) < 0) 监听们.push(fn); return WSQ; };
  WSQ.取消监听 = function (fn) { var i = 监听们.indexOf(fn); if (i >= 0) 监听们.splice(i, 1); return WSQ; };

  /* ---------------- FOX 帧 ---------------- */
  function 北京时间码() {
    var d = new Date(), p = function (n) { n = '' + n; while (n.length < 2) n = '0' + n; return n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function 随机串(n) { var s = '', c = 'abcdefghijklmnopqrstuvwxyz', i; for (i = 0; i < n; i++) s += c.charAt(Math.floor(Math.random() * 26)); return s; }
  WSQ.封装 = function (对) { return '【FOXID:' + 北京时间码() + 随机串(8) + 配置.id + '=cut(001/001)】' + JSON.stringify(对); };
  var 拼装 = {};
  WSQ.解析 = function (raw) {
    var m = raw.match(/^【FOXID:(\d{14})([a-z]{8})(\d{10})=cut\((\d{3})\/(\d{3})\)】/);
    if (!m) return { text: raw };
    var mid = m[1] + m[2], idx = +m[4], tot = +m[5], body = raw.slice(raw.indexOf('】') + 1);
    if (tot <= 1) return { text: body, sender: m[3] };
    var 项 = 拼装[mid] || (拼装[mid] = { n: tot, seg: {}, t: Date.now() });
    项.seg[idx] = body;
    if (Object.keys(项.seg).length >= tot) {
      var out = '', i; for (i = 1; i <= tot; i++) out += (项.seg[i] || '');
      delete 拼装[mid];
      return { text: out, sender: m[3] };
    }
    return null;
  };

  /* ---------------- 运行状态 ---------------- */
  var 业务ws = null, 紧急ws = null, 附加表 = {};   /* 附加表：名 → {ws, 类型, 到期} */
  var 状态 = '未连接';
  var 服务端 = { 昵称: '', 号: '', 产品: '', 设备名: '' };
  var 允许主动下线 = true, 静止秒 = 默认静止;
  var 休眠 = false, 最近操作 = Date.now(), 上次心跳 = 0, 已连上 = false;
  var 上次在线端 = [];
  var 最近流水 = [], 流水序 = 0, 流水上限 = 200;
  var 服务器表 = {};               /* 实例号 → {昵称,设备名,产品,号,在线集群} */
  var 集群状态 = {};               /* 集群名 → {状态, 类型, 到期, 起, 最近} */
  var 目标号 = LS('lastsrv', '');
  var 启动收集 = null;
  var 待切换 = null, 回归定时 = null, 待调查 = null, 测试发出 = 0;

  WSQ.状态 = function () {
    var 空闲 = (Date.now() - 最近操作) / 1000, 心跳 = Number(配置.hb || 默认心跳);
    var 临剩 = (配置.临主 && 配置.临主到) ? Math.max(0, Math.round((配置.临主到 - Date.now()) / 1000)) : 0;
    return { 状态: 状态, 已连上: 已连上, 休眠: 休眠, 服务端: JSON.parse(JSON.stringify(服务端)),
      允许主动下线: 允许主动下线, 静止秒: 静止秒, 空闲秒: 空闲, 心跳秒: 心跳,
      下次心跳秒: 上次心跳 ? Math.max(0, Math.round(心跳 - (Date.now() - 上次心跳) / 1000)) : 心跳,
      心跳满足: 配置.smart ? (空闲 < 心跳) : true, 业务集群: 配置.biz, 频道: WSQ.频道(),
      目标号: 目标号, 服务器: WSQ.服务器(),
      临时主: 配置.临主 || '', 临时主剩余秒: 临剩 };
  };
  WSQ.在线端 = function () { return JSON.parse(JSON.stringify(上次在线端)); };
  WSQ.流水 = function () { return 最近流水.slice(); };
  WSQ.服务器 = function () {
    return Object.keys(服务器表).map(function (k) { return 服务器表[k]; });
  };
  WSQ.集群在线 = function () {
    return Object.keys(集群状态).sort().map(function (k) {
      var v = 集群状态[k] || {};
      var 临类 = (v.类型 === '临时主' || v.类型 === '临时喊话' || v.类型 === '临时');
      return { 集群: k, 状态: v.状态 || '未连接', 类型: v.类型 || '常驻',
        在线秒: (v.状态 === '已连接' && v.起) ? Math.max(0, Math.round((Date.now() - v.起) / 1000)) : 0,
        剩余秒: (临类 && v.到期) ? Math.max(0, Math.round((v.到期 - Date.now()) / 1000)) : -1,
        最近: v.最近 ? new Date(v.最近).toTimeString().slice(0, 8) : '-' };
    });
  };
  WSQ.目标号 = function () { return 目标号; };
  WSQ.选服务器 = function (号) {
    目标号 = String(号 || '');
    SS('lastsrv', 目标号);
    var 表项 = 服务器表[目标号];
    if (表项) {
      服务端.昵称 = 表项.昵称 || ''; 服务端.号 = 表项.号;
      服务端.设备名 = 表项.设备名 || ''; 服务端.产品 = 表项.产品 || '';
    }
    通知({类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号});
    if (目标号) 发握手(true);
    通知状态();
  };

  function 通知状态() { 通知({类型: '状态', 状态: WSQ.状态()}); }
  function 字节数(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; } }
  function 流水加(方向, 账号, 昵称, 号, 类型, 摘要文, 字节, 字数) {
    流水序++;
    最近流水.unshift({ i: 流水序, time: new Date().toTimeString().slice(0, 8), dir: 方向, acc: 账号,
      ch: WSQ.频道(), nic: 昵称 || '-', id: 号 || '-', t: 类型 || '', kb: ((字节 || 0) / 1024).toFixed(2),
      字: (字数 || 0), sum: (摘要文 || '').slice(0, 160) });
    if (最近流水.length > 流水上限) 最近流水.pop();
    通知({类型: '流水', 行: 最近流水[0]});
  }
  function 记日志(kind, txt) { 通知({类型: '日志', 级别: kind, 文本: txt, 时间: new Date().toTimeString().slice(0, 8) }); }
  WSQ.日志 = 记日志;

  function 摘要(对) {
    if (!对) return '';
    var ks = ['内容', '原文', '说明', '原因', '昵称', '账号'], i;
    for (i = 0; i < ks.length; i++) if (对[ks[i]]) return String(对[ks[i]]);
    return Object.keys(对).slice(0, 6).join(',');
  }
  function 昵称() { return 配置.nic || 配置.dev || '网页客户端'; }
  function 头发(t, 账号, 额外) {
    var 对 = { t: t, 软件号: 配置.id, 昵称: 昵称(), 角色: '客户端', 账号: 账号, 频道: WSQ.频道(), ts: Math.floor(Date.now() / 1000) };
    if (额外) for (var k in 额外) 对[k] = 额外[k];
    return 对;
  }

  /* ---------------- 发送 ---------------- */
  function 取ws(名) {
    if (名 === 配置.biz && 业务ws) return 业务ws;
    if (名 === 配置.emg && 紧急ws) return 紧急ws;
    var c = 附加表[名];
    return c ? c.ws : null;
  }
  WSQ.发 = function (账号, 对) {
    账号 = 账号 || 配置.biz;
    var ws = 取ws(账号);
    if (!ws || ws.readyState !== 1) { 记日志('err', '发送失败：' + 账号 + ' 未连接（' + (对.t || '') + '）'); return false; }
    try {
      if (目标号) 对 = Object.assign({ 目标服务器: 目标号 }, 对);
      var 帧 = WSQ.封装(对);
      ws.send(帧);
      if (配置.smart) 上次心跳 = Date.now();
      流水加('发', 账号, 对.目标昵称 || (账号 === 配置.biz ? 服务端.昵称 : ''),
        对.目标实例号 || (账号 === 配置.biz ? 服务端.号 : ''), 对.t, 摘要(对), 字节数(帧), 帧.length);
      return true;
    } catch (e) { 记日志('err', '发送异常：' + e.message); return false; }
  };

  /* ---------------- 模板（客户端可发） ---------------- */
  WSQ.客户端模板 = {
    '发起上线': { 专用: ['电脑名', '产品'], 必填: [] },
    '发起握手': { 专用: ['电脑名', '产品', '目标服务器'], 必填: [] },
    '谁在': { 专用: [], 必填: [] },
    '键鼠活跃': { 专用: ['说明'], 必填: [] },
    '主动下线': { 专用: ['原因'], 必填: [] },
    '更新集群信息': { 专用: [], 必填: [] },
    '发起切换集群': { 专用: ['目标集群', '目标服务器'], 必填: ['目标集群'] },
    '发起测试': { 专用: [], 必填: [] },
    '在线应答': { 专用: ['电脑名', '产品'], 必填: [] },
    '回应握手': { 专用: ['电脑名', '产品', '主动下线'], 必填: [] },
    '收到加密频道': { 专用: ['加密频道'], 必填: ['加密频道'] },
    '应答': { 专用: ['说明'], 必填: [] }
  };
  WSQ.发模板 = function (名, 值, 接收) {
    var 模 = WSQ.客户端模板[名];
    if (!模) { 记日志('err', '模板「' + 名 + '」不是客户端可发的'); return false; }
    值 = 值 || {};
    var 缺 = (模.必填 || []).filter(function (k) { return !String(值[k] || '').trim(); });
    if (缺.length) { 记日志('err', '模板「' + 名 + '」缺必填：' + 缺.join('、') + ' —— 未发送'); return false; }
    var 额外 = {};
    (模.专用 || []).forEach(function (k) { if (String(值[k] || '').trim()) 额外[k] = String(值[k]).trim(); });
    if (接收 && 接收.目标 && 接收.目标.号) {
      额外.目标服务器 = 接收.目标.号;
      额外.目标实例号 = 接收.目标.号;
      额外.目标昵称 = 接收.目标.昵称 || '';
    }
    return WSQ.发(配置.biz, 头发(名, 配置.biz, 额外));
  };

  /* ---------------- 连接 ---------------- */
  function 记集群(名, 状态文, 类型, 到期) {
    集群状态[名] = 集群状态[名] || {};
    var v = 集群状态[名];
    v.状态 = 状态文;
    v.最近 = Date.now();
    if (类型) v.类型 = 类型;
    v.到期 = Number(到期 || 0);
    if (状态文 === '已连接') v.起 = Date.now(); else v.起 = 0;
    通知({ 类型: '集群', 列表: WSQ.集群在线() });
  }
  function 建ws(名, 用途, 类型, 到期) {
    var a = 集群表[名];
    if (!a) { 记日志('err', '集群表里没有 ' + 名); return null; }
    var url = 'wss://' + a.cluster + '.piesocket.com/v3/' + WSQ.频道() + '?api_key=' + a.key;
    var ws;
    try { ws = new WebSocket(url); } catch (e) { 记日志('err', 名 + ' 连接失败：' + e.message); return null; }
    记集群(名, '连接中', 类型, 到期);
    ws.onopen = function () {
      记日志('sys', 名 + ' 已连接');
      记集群(名, '已连接', 类型, 到期);
      if (用途 === '业务') { 业务ws = ws; }
      else if (用途 === '紧急') { 紧急ws = ws; }
      if (业务ws === ws) {           /* 普通业务连接，或临时主转正后连上 */
        已连上 = true; 状态 = '已连接';
        发握手(!!目标号);
        开始收集();
      }
      通知状态();
    };
    ws.onmessage = function (ev) { 收(名, String(ev.data || '')); };
    ws.onclose = function () {
      记日志('sys', 名 + ' 已断开');
      记集群(名, '已断开', 类型, 0);
      if (业务ws === ws) {
        业务ws = null; 已连上 = false; 上次心跳 = 0; 状态 = '重连中'; 通知状态();
        if (!休眠) setTimeout(重连业务, 4000);
      } else if (紧急ws === ws) { 紧急ws = null; }
      else { var c = 附加表[名]; if (c && c.ws === ws) delete 附加表[名]; }
    };
    ws.onerror = function () { 记日志('err', 名 + ' 连接出错'); 记集群(名, '出错', 类型, 到期); };
    return ws;
  }
  function 开附加(名, 类型, 秒) {
    if (!集群表[名] || 名 === 配置.emg) return false;
    var 到期 = 秒 ? Date.now() + Number(秒) * 1000 : 0;
    if (名 === 配置.biz && 业务ws) return true;
    var c = 附加表[名];
    if (c) {
      c.类型 = 类型; c.到期 = 到期;
      if (c.ws && c.ws.readyState <= 1) { 记集群(名, c.ws.readyState === 1 ? '已连接' : '连接中', 类型, 到期); return true; }
    }
    var ws = 建ws(名, '附加', 类型, 到期);
    if (!ws) return false;
    附加表[名] = { ws: ws, 类型: 类型, 到期: 到期 };
    return true;
  }
  function 关附加(名) {
    var c = 附加表[名];
    if (!c) return;
    delete 附加表[名];
    try { if (c.ws) c.ws.close(); } catch (e) {}
    记集群(名, '已断开', c.类型, 0);
  }
  function 临时有效() { return !!(配置.临主 && 配置.临主 === 配置.biz && 配置.临主到 > Date.now()); }
  function 业务类型() { return 临时有效() ? '临时主' : '主'; }
  function 业务剩余秒() { return 临时有效() ? Math.max(1, Math.round((配置.临主到 - Date.now()) / 1000)) : 0; }

  var 收集定时 = null, 启动重试 = 0;
  function 开始收集() {
    启动收集 = {};
    if (收集定时) clearTimeout(收集定时);
    收集定时 = setTimeout(收尾收集, 4000);
  }
  function 收尾收集() {
    收集定时 = null;
    var 收集 = 启动收集 || {};
    启动收集 = null;
    var 号们 = Object.keys(收集);
    if (!号们.length) {
      if (启动重试 < 4) {
        启动重试++;
        记日志('sys', '开机刷新没收到服务器应答，3 秒后重发握手（第 ' + 启动重试 + ' 次）');
        收集定时 = setTimeout(function () { 发握手(); 开始收集(); }, 3000);
      } else {
        记日志('err', '开机刷新完成：未发现服务器');
      }
      return;
    }
    启动重试 = 0;
    var 上次 = String(LS('lastsrv', '') || '');
    通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
    if (!配置.autoSrv) { 记日志('sys', '开机刷新完成：' + 号们.length + ' 台服务器在线（未开启自动连接，请手动选目标服务器）'); return; }
    if (上次 && 收集[上次]) { WSQ.选服务器(上次); 记日志('sys', '开机自动刷新：上次服务器在线，已自动连接 ' + 上次); }
    else if (号们.length === 1) { WSQ.选服务器(号们[0]); 记日志('sys', '开机自动刷新：唯一在线服务器，已自动连接 ' + 号们[0]); }
    else { 记日志('sys', '开机自动刷新：' + 号们.length + ' 台服务器在线，请在「目标服务器」里手动选择'); }
  }
  function 连接全部() {
    状态 = '连接中'; 通知状态();
    业务ws = 建ws(配置.biz, '业务', 业务类型(), 业务剩余秒());
    紧急ws = 建ws(配置.emg, '紧急', '紧急', 0);
    排回归();
  }
  function 重连业务() { if (业务ws && 业务ws.readyState <= 1) return; 业务ws = 建ws(配置.biz, '业务', 业务类型(), 业务剩余秒()); }
  function 断开全部() {
    try { if (业务ws) 业务ws.close(); } catch (e) {}
    try { if (紧急ws) 紧急ws.close(); } catch (e) {}
    Object.keys(附加表).forEach(关附加);
    业务ws = 紧急ws = null; 已连上 = false; 状态 = '未连接'; 通知状态();
  }
  function 发握手(强制目标) {
    var 额外 = { 电脑名: 配置.dev, 产品: 配置.prod, 主动下线: true };
    if (强制目标 && 目标号) {
      额外.目标服务器 = 目标号;
      额外.目标实例号 = 目标号;
      额外.目标昵称 = (服务器表[目标号] || {}).昵称 || '';
    }
    WSQ.发(配置.biz, 头发('发起握手', 配置.biz, 额外));
  }
  WSQ.启动 = function () { if (!配置) WSQ.初始化(); 连接全部(); return WSQ; };
  WSQ.停止 = function () { 断开全部(); return WSQ; };
  WSQ.重连 = 重连业务;

  /* ---------------- 智能调查（先临时全开所有集群，再逐集群问服务端在线） ---------------- */
  WSQ.刷新谁在 = function () {
    if (!业务ws || 业务ws.readyState !== 1) { 记日志('err', '未连接，不能刷新谁在'); return false; }
    return WSQ.发(配置.biz, 头发('谁在', 配置.biz));
  };
  WSQ.更新集群信息 = function () {
    if (!业务ws || 业务ws.readyState !== 1) { 记日志('err', '未连接，不能更新集群信息'); return false; }
    记日志('sys', '更新集群信息：已向服务器请求最新集群表（经 ' + 配置.biz + '）');
    return WSQ.发(配置.biz, 头发('更新集群信息', 配置.biz));
  };
  WSQ.测试服务器 = function () {
    if (!业务ws || 业务ws.readyState !== 1) { 记日志('err', '未连接，不能测试服务器'); return false; }
    if (!WSQ.发(配置.biz, 头发('发起测试', 配置.biz))) return false;
    测试发出 = Date.now();
    记日志('sys', '测试服务器回应：已发出，5 秒内等回应');
    setTimeout(function () {
      if (!测试发出) return;
      测试发出 = 0;
      记日志('err', '测试服务器回应：5 秒超时，未收到服务器回应');
    }, 5000);
    return true;
  };
  WSQ.智能调查 = function () {
    if (!业务ws || 业务ws.readyState !== 1) { 记日志('err', '未连接，不能智能调查'); return false; }
    if (!配置.智调) {
      记日志('sys', '智能调查已关闭，按普通「谁在·目标服务端」发送');
      return WSQ.发(配置.biz, 头发('谁在', 配置.biz, { 目标角色: '服务端' }));
    }
    var 秒 = Number(配置.喊话秒 || 默认喊话秒);
    var 名们 = [];
    Object.keys(集群表).forEach(function (n) {
      if (n === 配置.emg) return;
      名们.push(n);
      if (n !== 配置.biz) 开附加(n, '临时喊话', 秒);
    });
    记日志('sys', '智能调查：临时全开 ' + 名们.length + ' 个集群（临时喊话 ' + 秒 + ' 秒），逐个集群询问服务器在线');
    待调查 = { 目标: 名们, 已发: {}, 轮: 0 };
    调查轮发();
    return true;
  };
  function 调查轮发() {
    var 任务 = 待调查;
    if (!任务) return;
    任务.目标.forEach(function (名) {
      if (任务.已发[名]) return;
      var ws = 取ws(名);
      if (!ws || ws.readyState !== 1) return;
      if (WSQ.发(名, 头发('谁在', 名, { 目标角色: '服务端', 智能调查: true }))) 任务.已发[名] = 1;
    });
    var 发过 = Object.keys(任务.已发).length;
    if (发过) 记日志('sys', '智能调查：已向 ' + 发过 + '/' + 任务.目标.length + ' 个集群发出询问');
    if (任务.轮 < 12 && 发过 < 任务.目标.length) { 任务.轮++; setTimeout(调查轮发, 400); }
    else 待调查 = null;
  }

  /* ---------------- 切换业务集群（临时主，双通道，等点名回应才提交） ---------------- */
  function 切换请求(新) {
    if (!新 || !集群表[新]) return false;
    if (新 === 配置.biz) { 记日志('sys', '业务集群已经是 ' + 新); return false; }
    var 旧 = 配置.biz;
    var 分钟 = Number(配置.临主分 || 默认临主分);
    开附加(新, '临时主', 分钟 * 60);
    待切换 = { 新: 新, 旧: 旧 };
    var 发请求 = function () {
      if (!待切换 || 待切换.新 !== 新) return;
      WSQ.发(旧, 头发('发起切换集群', 旧, { 目标集群: 新 }));
      if (配置.emg && 配置.emg !== 旧) WSQ.发(配置.emg, 头发('发起切换集群', 配置.emg, { 目标集群: 新 }));
    };
    发请求();
    记日志('sys', '请求切换到集群 ' + 新 + '：已在目标集群临时登录，并在 ' + 旧 + ' 与紧急集群 ' + (配置.emg || '-') + ' 同时发出（服务器只处理第一条，在目标集群点名回应）');
    /* 目标集群可能比服务端回应晚订阅上，回应对不上就补发，直到提交或超时 */
    var 补次 = 0;
    var 补发 = function () {
      if (!待切换 || 待切换.新 !== 新) return;
      if (补次 >= 6) return;
      补次++;
      发请求();
      记日志('sys', '切换集群 ' + 新 + ' 还没收到点名回应，补发请求（第 ' + 补次 + ' 次）');
      setTimeout(补发, 5000);
    };
    setTimeout(补发, 5000);
    setTimeout(function () {
      if (!待切换 || 待切换.新 !== 新) return;
      待切换 = null;
      关附加(新);
      记日志('err', '切换集群 ' + 新 + ' 超时未收到服务器回应，保持 ' + 配置.biz);
    }, 46000);
    return true;
  }
  function 提交切换(新, 分钟) {
    if (!集群表[新]) return;
    var 旧 = 配置.biz;
    var c = 附加表[新];
    delete 附加表[新];
    配置.biz = 新;
    if (旧 && 旧 !== 新 && 旧 !== 配置.emg) {
      if (业务ws && (!c || 业务ws !== c.ws)) { try { 业务ws.close(); } catch (e) {} 业务ws = null; }
    }
    if (c && c.ws) { 业务ws = c.ws; 已连上 = (c.ws.readyState === 1); }
    else if (!业务ws) { 业务ws = 建ws(新, '业务', '临时主', Math.max(1, Math.round(分钟 * 60))); 已连上 = false; }
    状态 = 已连上 ? '已连接' : '连接中';
    if (新 === 主集群名) { 配置.临主 = ''; 配置.临主到 = 0; }
    else { 配置.临主 = 新; 配置.临主到 = Date.now() + Math.max(1, 分钟) * 60000; }
    存配置();
    排回归();
    记日志('sys', '已提交切换：当前业务集群 ' + 新 + (配置.临主 ? '（临时主，' + Math.round(分钟) + ' 分钟后自动回 ' + 主集群名 + '）' : '（主集群）'));
    通知({类型: '配置', 配置: WSQ.读配置()});
    通知状态();
    if (已连上) 发握手(!!目标号);
  }
  function 排回归() {
    if (回归定时) { clearTimeout(回归定时); 回归定时 = null; }
    if (!配置.临主 || !配置.临主到) return;
    var 差 = 配置.临主到 - Date.now();
    if (差 <= 0) return;
    回归定时 = setTimeout(回主, Math.max(1000, 差));
  }
  function 回主() {
    var 临 = 配置.临主;
    配置.临主 = ''; 配置.临主到 = 0;
    var 目标 = 主集群名;
    if (!集群表[目标]) 目标 = Object.keys(集群表)[0] || '';
    if (临 && 配置.biz === 临 && 目标 && 目标 !== 配置.biz) {
      var 旧 = 配置.biz;
      配置.biz = 目标;
      if (旧 !== 配置.emg && 业务ws) { try { 业务ws.close(); } catch (e) {} 业务ws = null; }
      已连上 = false; 上次心跳 = 0; 状态 = '连接中';
      业务ws = 建ws(配置.biz, '业务', '主', 0);
      记日志('sys', '临时主集群 ' + 临 + ' 已到期，自动回主集群 ' + 配置.biz);
    } else if (临) {
      记日志('sys', '临时主集群 ' + 临 + ' 已到期（当前已在 ' + 配置.biz + '）');
    }
    存配置(); 排回归(); 通知({类型: '配置', 配置: WSQ.读配置()}); 通知状态();
  }
  WSQ.切换业务集群 = function (名) { return 切换请求(名); };

  /* ---------------- 收 ---------------- */
  function 收(账号, raw) {
    var r = WSQ.解析(raw);
    if (!r) return;
    var 对;
    try { 对 = JSON.parse(r.text); } catch (e) { 对 = { t: '原文', 原文: r.text.slice(0, 120) }; }
    if (!对 || typeof 对 !== 'object') return;
    if (String(对.软件号 || '') === 配置.id && String(对.角色 || '') === '客户端') return;
    var t = String(对.t || '');
    流水加('收', 账号, 对.昵称, 对.软件号, t, 摘要(对), 字节数(raw), raw.length);
    if (String(对.角色 || '') === '服务端' && 对.软件号 && t !== '回应握手') {
      var 号 = String(对.软件号), 旧 = 服务器表[号] || {};
      服务器表[号] = { 号: 号,
        昵称: 对.昵称 || 旧.昵称 || '', 设备名: 对.电脑名 || 旧.设备名 || '',
        产品: 对.产品 || 旧.产品 || '', 在线集群: 旧.在线集群 || [],
        最近: new Date().toTimeString().slice(0, 8) };
      if (启动收集) 启动收集[号] = true;
      通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
    }

    if (t === '发起握手') {
      var 目标 = String(对.目标客户端 || '');
      /* 点名精准：写了实例号就只认实例号，绝不拿昵称兜底（同名昵称会串台） */
      if (!目标 || 目标 !== 配置.id) return;
      WSQ.发(账号, 头发('回应握手', 账号, { 电脑名: 配置.dev, 产品: 配置.prod, 主动下线: true }));
    } else if (t === '谁在') {
      if (String(对.目标角色 || '') === '服务端') return;
      var 点客 = String(对.目标客户端 || '');
      if (点客 && 点客 !== 配置.id) return;
      WSQ.发(账号, 头发('在线应答', 账号, { 电脑名: 配置.dev, 产品: 配置.prod }));
    }

    if (t === '回应握手') {
      记日志('sys', '收到握手回执 ' + (对.软件号 || '-') + '（目标=' + (目标号 || '不限制') + '）');
      if (对.软件号) {
        var 原表 = 服务器表[String(对.软件号)] || {};
        服务器表[String(对.软件号)] = { 号: String(对.软件号), 昵称: 对.昵称 || '',
          设备名: 对.电脑名 || '', 产品: 对.产品 || '', 在线集群: 原表.在线集群 || [],
          最近: new Date().toTimeString().slice(0, 8) };
        if (启动收集) 启动收集[String(对.软件号)] = true;
        通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
      }
      if (目标号 && String(对.软件号 || '') !== 目标号) { 通知状态(); return; }
      服务端.昵称 = 对.昵称 || 对.电脑名 || ''; 服务端.号 = 对.软件号 || '';
      服务端.产品 = 对.产品 || ''; 服务端.设备名 = 对.电脑名 || '';
      允许主动下线 = 对.主动下线 !== false;
      静止秒 = Number(对.静止秒 || 静止秒) || 默认静止;
      if (对.智能调查服务器在线 !== undefined) 配置.智调 = !!对.智能调查服务器在线;
      if (对.临时主集群回归分钟 !== undefined && Number(对.临时主集群回归分钟) > 0) 配置.临主分 = Number(对.临时主集群回归分钟);
      if (对.临时喊话秒 !== undefined && Number(对.临时喊话秒) > 0) 配置.喊话秒 = Number(对.临时喊话秒);
      存配置();
      上次心跳 = Date.now();
      启动重试 = 0;
      状态 = '已连接'; 通知状态();
      记日志('sys', '握手成功（服务器 ' + 服务端.昵称 + ' · ' + 服务端.号 + '），主动下线=' + (允许主动下线 ? '开' : '关'));
      通知({类型: '握手', 服务端: JSON.parse(JSON.stringify(服务端))});
      if (配置.auto && !休眠) WSQ.刷新谁在();
    } else if (t === '在线应答') {
      上次在线端 = 对.在线端 || [];
      if (对.软件号 && String(对.角色 || '') === '服务端') {
        var 号2 = String(对.软件号), 项 = 服务器表[号2] || { 号: 号2 };
        项.昵称 = 对.昵称 || 项.昵称 || '';
        项.设备名 = 对.电脑名 || 项.设备名 || '';
        项.产品 = 对.产品 || 项.产品 || '';
        if (对.在线集群 && 对.在线集群.length) 项.在线集群 = 对.在线集群.slice();
        项.最近 = new Date().toTimeString().slice(0, 8);
        服务器表[号2] = 项;
        通知({类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号});
      }
      通知({类型: '在线端', 列表: WSQ.在线端()});
      if (!目标号 && !服务端.号 && 对.软件号) { 服务端.昵称 = 对.昵称 || ''; 服务端.号 = 对.软件号; }
      通知状态();
    } else if (t === '下发集群信息') {
      if (对.账号表 && 对.账号表.length) {
        var 新表 = {}, i, a;
        for (i = 0; i < 对.账号表.length; i++) {
          a = 对.账号表[i];
          if (a && a.名称 && a.cluster && a.key) 新表[a.名称] = { cluster: a.cluster, key: a.key };
        }
        if (Object.keys(新表).length) { 集群表 = 新表; SS('clusters', 集群表); 记日志('sys', '已更新集群表（' + Object.keys(新表).length + ' 个）'); 通知({类型: '集群表', 表: WSQ.集群表()}); }
      }
    } else if (t === '下发加密频道') {
      var 点加 = String(对.目标客户端 || ''), 加频 = String(对.加密频道 || '');
      if (!点加 || 点加 !== 配置.id || !加频) { 通知状态(); return; }
      配置.加密频道 = 加频; 存配置();
      WSQ.发(账号, 头发('收到加密频道', 账号, { 加密频道: 加频 }));
      记日志('sys', '已收到专属加密频道：' + 加频 + '（已回执）');
      通知({类型: '配置', 配置: WSQ.读配置()});
    } else if (t === '回应测试') {
      var 耗时 = 测试发出 ? (Date.now() - 测试发出) : -1;
      测试发出 = 0;
      记日志('sys', '测试服务器回应：正常' + (耗时 >= 0 ? ' ' + 耗时 + ' ms' : '') + '（服务器 ' + (对.昵称 || 对.软件号 || '-') + '）');
    通知({类型: '测试', 结果: 'ok', 耗时: 耗时});
    } else if (t === '回应切换集群') {
      var 点 = String(对.目标客户端 || '');
      if (点 && 点 !== 配置.id) { 通知状态(); return; }     /* 不是点名给本端，不提交 */
      var 新 = String(对.账号 || '');
      if (待切换 && 新 && 待切换.新 === 新) {
        var 分 = Number(对.临时主分钟 || 配置.临主分 || 默认临主分);
        待切换 = null;
        提交切换(新, 分);
      } else {
        记日志('sys', '服务端回应集群 ' + (新 || '-') + '：' + (对.说明 || '已就绪') + (新 === 配置.biz ? '' : '（无对应待切换请求，不提交）'));
      }
    } else if (t === '拒绝') {
      记日志('err', '服务端拒绝：' + (对.原因 || '未说明'));
    }
    通知({类型: '收', 账号: 账号, 数据: 对});
    通知状态();
  }

  /* ---------------- 看门狗：主动下线 / 键鼠活跃心跳 / 临时到期 ---------------- */
  setInterval(function () {
    if (状态 === '未连接' || !配置) return;
    if (配置.临主 && 配置.临主到 && Date.now() >= 配置.临主到) 回主();
    Object.keys(附加表).forEach(function (名) {
      var c = 附加表[名];
      if (!c || !c.到期) return;
      if (c.类型 === '临时喊话' || c.类型 === '临时主') { if (Date.now() >= c.到期) 关附加(名); }
    });
    if (!允许主动下线) return;
    var 现在 = Date.now(), 空闲 = (现在 - 最近操作) / 1000, 心跳 = Number(配置.hb || 默认心跳);
    if (!休眠 && 空闲 >= 静止秒) {
      休眠 = true;
      WSQ.发(配置.biz, 头发('主动下线', 配置.biz, { 原因: '客户端静止超时' }));
      记日志('sys', '静止 ' + 静止秒 + ' 秒，已发主动下线（临时主不清，回来自动续上）');
      setTimeout(function () {
        try { if (业务ws) 业务ws.close(); } catch (e) {}
        业务ws = null; 已连上 = false; 状态 = '已下线'; 通知状态();
      }, 300);
    } else if (休眠 && 空闲 < 静止秒) {
      休眠 = false; 状态 = '重连中'; 记日志('sys', '检测到操作，重新上线'); 通知状态();
      业务ws = 建ws(配置.biz, '业务', 业务类型(), 业务剩余秒());
    } else if (!休眠 && 已连上 && 上次心跳 && (空闲 < 心跳 || !配置.smart) && (现在 - 上次心跳) / 1000 >= 心跳) {
      WSQ.发(配置.biz, 头发('键鼠活跃', 配置.biz, { 说明: '最近 ' + Math.round(心跳) + ' 秒有键鼠操作' }));
    }
  }, 5000);
  setInterval(function () { if (配置) 通知状态(); }, 1000);
  ['pointerdown', 'mousemove', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    global.addEventListener(ev, function () { 最近操作 = Date.now(); }, { passive: true });
  });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        最近操作 = Date.now();
        if (配置.临主 && 配置.临主到 && Date.now() >= 配置.临主到) 回主();
        if (!业务ws && 状态 !== '未连接' && !休眠) 重连业务();
      }
    });
  }

  /* ---------------- 可选界面：懒加载 ---------------- */
  var UI注册 = null, UI加载中 = false;
  WSQ._注册UI = function (fn) { if (typeof fn === 'function') { UI注册 = fn; 刷挂载(); } };
  var 挂载们 = [];
  WSQ.挂载界面 = function (容器, 选项) {
    if (typeof 容器 === 'string') 容器 = document.querySelector(容器);
    if (!容器) return false;
    挂载们.push({ 容器: 容器, 选项: 选项 || {} });
    加载UI();
    return true;
  };
  function 刷挂载() {
    if (!UI注册) return;
    while (挂载们.length) { var 项 = 挂载们.shift(); try { UI注册(项.容器, WSQ, 项.选项); } catch (e) {} }
  }
  function 加载UI() {
    if (UI注册) { 刷挂载(); return; }
    if (UI加载中 || typeof document === 'undefined') return;
    UI加载中 = true;
    var s = document.createElement('script');
    s.src = 'wsqui.js?v=' + WSQ.版本;
    s.onload = function () { UI加载中 = false; 刷挂载(); };
    s.onerror = function () { UI加载中 = false; };
    (document.head || document.documentElement).appendChild(s);
  }

  global.WSQ = WSQ;
})(typeof window !== 'undefined' ? window : this);
