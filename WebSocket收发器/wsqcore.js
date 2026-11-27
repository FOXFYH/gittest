/* ============================================================================
 * wsqcore.js —— WebSocket 收发器「客户端网页版」纯逻辑内核（无 DOM、无样式）
 *
 * 设计目的
 *   1. 页面元素与纯逻辑分离：本文件只做 WS 连接、FOX 帧、模板收发、心跳、主动下线、
 *      状态与事件分发。任何 DOM/CSS 一律不在这里，可在 Node/浏览器/别家网页里直接跑。
 *   2. 将来做「其他网站的 WS 收发总底座」：宿主页只需加载本文件 → WSQ.初始化() →
 *      WSQ.启动()，然后用 WSQ.监听() 拿事件，自己画自己的界面。
 *   3. 可见界面可选、可懒加载：本文件不加载任何 UI；宿主想用现成界面时再调用
 *      WSQ.挂载界面(容器)，那一刻才去动态加载 wsqui.js（加载失败不影响逻辑）。
 *
 * 典型用法（宿主网站）
 *   <script src="wsqcore.js?v=1.1"></script>
 *   <script>
 *     WSQ.初始化({ 存储前缀:'wsq_' });
 *     WSQ.监听(function(ev){ if(ev.类型==='收') console.log(ev); });
 *     WSQ.启动();
 *     // 想要现成界面时才：WSQ.挂载界面(document.getElementById('app'));
 *   </script>
 *
 * 协议：与电脑端一致 —— 频道＝WSRELAY+口令；帧＝【FOXID:...=cut(001/001)】+JSON
 * ========================================================================== */
(function (global) {
  'use strict';
  var WSQ = { 版本: '1.4' };

  /* ---------------- 常量 ---------------- */
  var 前缀 = 'WSRELAY';
  var 默认口令 = '31415926fF@';
  var 默认心跳 = 60, 默认静止 = 120;
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
      pass: LS('pass', 默认口令), biz: LS('biz', 'WS1'), emg: LS('emg', 'WS5'),
      hb: LS('hb', 默认心跳), smart: LS('smart', true), auto: LS('auto', true),
      still: LS('still', 默认静止)
    };
    if (!集群表[配置.biz]) 配置.biz = Object.keys(集群表)[0];
    if (!集群表[配置.emg]) 配置.emg = Object.keys(集群表)[Object.keys(集群表).length - 1];
    版本清理();
    return WSQ;
  };
  function 版本清理() {
    var 见 = LS('ver', '');
    if (见 && 见 !== WSQ.版本) {
      var 留 = {}, 键 = ['id','nic','prod','dev','pass','biz','emg','clusters','still'];
      键.forEach(function (k) { var v = localStorage.getItem(存储前缀 + k); if (v !== null) 留[k] = v; });
      清缓存();
      Object.keys(留).forEach(function (k) { try { localStorage.setItem(存储前缀 + k, 留[k]); } catch (e) {} });
    }
    SS('ver', WSQ.版本);
  }

  WSQ.读配置 = function () { return JSON.parse(JSON.stringify(配置)); };
  WSQ.集群表 = function () { return JSON.parse(JSON.stringify(集群表)); };
  WSQ.频道 = function () { return 前缀 + (配置.pass || 默认口令); };
  WSQ.设置集群表 = function (表) { if (表 && typeof 表 === 'object' && Object.keys(表).length) { 集群表 = JSON.parse(JSON.stringify(表)); 存('clusters', 集群表); } };
  function 存(k, v) { SS(k, v); }
  WSQ.改配置 = function (补丁) {
    if (!补丁) return;
    var 旧biz = 配置.biz, 旧emg = 配置.emg, 旧pass = 配置.pass;
    Object.keys(补丁).forEach(function (k) { if (k in 配置) 配置[k] = 补丁[k]; });
    配置.hb = Math.max(0, Number(配置.hb || 默认心跳));
    ['id','nic','prod','dev','pass','biz','emg','hb','smart','auto'].forEach(function (k) { SS(k, 配置[k]); });
    SS('clusters', 集群表);
    var 要重连 = (旧biz !== 配置.biz || 旧emg !== 配置.emg || 旧pass !== 配置.pass);
    if (要重连 && 状态 !== '未连接') { 断开全部(); setTimeout(连接全部, 400); }
    通知({类型: '配置', 配置: WSQ.读配置()});
    return 要重连;
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
  var 业务ws = null, 紧急ws = null;
  var 状态 = '未连接';
  var 服务端 = { 昵称: '', 号: '', 产品: '', 设备名: '' };
  var 允许主动下线 = true, 静止秒 = 默认静止;
  var 休眠 = false, 最近操作 = Date.now(), 上次心跳 = 0, 已连上 = false;
  var 上次在线端 = [];
  var 最近流水 = [], 流水序 = 0, 流水上限 = 200;
  var 服务器表 = {};               /* 实例号 → {昵称,设备名,产品,号} */
  var 集群状态 = {};               /* 集群名 → {状态, 起, 最近} */
  var 目标号 = LS('lastsrv', '');
  var 启动收集 = null;             /* 开机握手后 4 秒内收到的服务器；null＝不在收集中 */

  WSQ.状态 = function () {
    var 空闲 = (Date.now() - 最近操作) / 1000, 心跳 = Number(配置.hb || 默认心跳);
    return { 状态: 状态, 已连上: 已连上, 休眠: 休眠, 服务端: JSON.parse(JSON.stringify(服务端)),
      允许主动下线: 允许主动下线, 静止秒: 静止秒, 空闲秒: 空闲, 心跳秒: 心跳,
      下次心跳秒: 上次心跳 ? Math.max(0, Math.round(心跳 - (Date.now() - 上次心跳) / 1000)) : 心跳,
      心跳满足: 配置.smart ? (空闲 < 心跳) : true, 业务集群: 配置.biz, 频道: WSQ.频道(),
      目标号: 目标号, 服务器: WSQ.服务器() };
  };
  WSQ.在线端 = function () { return JSON.parse(JSON.stringify(上次在线端)); };
  WSQ.流水 = function () { return 最近流水.slice(); };
  WSQ.服务器 = function () {
    return Object.keys(服务器表).map(function (k) { return 服务器表[k]; });
  };
  WSQ.集群在线 = function () {
    return Object.keys(集群状态).sort().map(function (k) {
      var v = 集群状态[k] || {};
      return { 集群: k, 状态: v.状态 || '未连接',
        在线秒: (v.状态 === '已连接' && v.起) ? Math.max(0, Math.round((Date.now() - v.起) / 1000)) : 0,
        最近: v.最近 ? new Date(v.最近).toTimeString().slice(0, 8) : '-' };
    });
  };
  WSQ.目标号 = function () { return 目标号; };
  WSQ.选服务器 = function (号) {
    目标号 = String(号 || '');
    SS('lastsrv', 目标号);
    通知({类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号});
    if (目标号 && 已连上) 发握手(true);      /* 换服务器即朝它重新握手 */
    通知状态();
  };

  function 通知状态() { 通知({类型: '状态', 状态: WSQ.状态()}); }
  function 字节数(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; } }
  function 流水加(方向, 账号, 昵称, 号, 类型, 摘要文, 字节, 字数) {
    流水序++;
    最近流水.unshift({ i: 流水序, time: new Date().toTimeString().slice(0, 8), dir: 方向, acc: 账号,
      nic: 昵称 || '-', id: 号 || '-', t: 类型 || '', kb: ((字节 || 0) / 1024).toFixed(2),
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
  WSQ.发 = function (账号, 对) {
    账号 = 账号 || 配置.biz;
    var ws = (账号 === 配置.emg ? 紧急ws : 业务ws);
    if (!ws || ws.readyState !== 1) { 记日志('err', '发送失败：' + 账号 + ' 未连接（' + (对.t || '') + '）'); return false; }
    try {
      if (目标号) 载荷 = Object.assign({ 目标服务器: 目标号 }, 载荷);
      var 帧 = WSQ.封装(对);
      ws.send(帧);
      if (配置.smart) 上次心跳 = Date.now();
      流水加('发', 账号, 对.目标昵称 || (账号 === 配置.emg ? '' : 服务端.昵称),
        对.目标实例号 || (账号 === 配置.emg ? '' : 服务端.号), 对.t, 摘要(对), 字节数(帧), 帧.length);
      return true;
    } catch (e) { 记日志('err', '发送异常：' + e.message); return false; }
  };

  /* ---------------- 连接 ---------------- */
  function 建ws(名, 是业务) {
    var a = 集群表[名];
    if (!a) { 记日志('err', '集群表里没有 ' + 名); return null; }
    var url = 'wss://' + a.cluster + '.piesocket.com/v3/' + WSQ.频道() + '?api_key=' + a.key;
    var ws;
    try { ws = new WebSocket(url); } catch (e) { 记日志('err', 名 + ' 连接失败：' + e.message); return null; }
    ws.onopen = function () {
      记日志('sys', 名 + ' 已连接');
      记集群(名, '已连接');
      if (是业务) {
        业务ws = ws; 已连上 = true; 状态 = '已连接';
        发握手();
        开始收集();
      } else { 紧急ws = ws; }
      通知状态();
    };
    ws.onmessage = function (ev) { 收(名, String(ev.data || '')); };
    ws.onclose = function () {
      记日志('sys', 名 + ' 已断开');
      记集群(名, '已断开');
      if (是业务 && 业务ws === ws) {
        业务ws = null; 已连上 = false; 上次心跳 = 0; 状态 = '重连中'; 通知状态();
        if (!休眠) setTimeout(重连业务, 4000);
      } else if (!是业务 && 紧急ws === ws) { 紧急ws = null; }
    };
    ws.onerror = function () { 记日志('err', 名 + ' 连接出错'); 记集群(名, '出错'); };
    return ws;
  }
  function 记集群(名, 状态文) {
    集群状态[名] = 集群状态[名] || {};
    集群状态[名].状态 = 状态文;
    集群状态[名].最近 = Date.now();
    if (状态文 === '已连接') 集群状态[名].起 = Date.now();
    通知({ 类型: '集群', 列表: WSQ.集群在线() });
  }
  /* 开机握手 4 秒收集服务器（与电脑端一致）：上次那台在线就自动连它，只有一台也连 */
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
    if (上次 && 收集[上次]) { WSQ.选服务器(上次); 记日志('sys', '开机自动刷新：上次服务器在线，已自动连接 ' + 上次); }
    else if (号们.length === 1) { WSQ.选服务器(号们[0]); 记日志('sys', '开机自动刷新：唯一在线服务器，已自动连接 ' + 号们[0]); }
    else { 记日志('sys', '开机自动刷新：' + 号们.length + ' 台服务器在线，请手动选择'); }
    通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
  }
  function 连接全部() {
    状态 = '连接中'; 通知状态();
    业务ws = 建ws(配置.biz, true);
    紧急ws = 建ws(配置.emg, false);
  }
  function 重连业务() { if (业务ws && 业务ws.readyState <= 1) return; 业务ws = 建ws(配置.biz, true); }
  function 断开全部() {
    try { if (业务ws) 业务ws.close(); } catch (e) {}
    try { if (紧急ws) 紧急ws.close(); } catch (e) {}
    业务ws = 紧急ws = null; 已连上 = false; 状态 = '未连接'; 通知状态();
  }
  function 发握手(强制目标) {
    var 额外 = { 电脑名: 配置.dev, 产品: 配置.prod, 主动下线: true };
    if (强制目标 && 目标号) 额外.目标服务器 = 目标号;
    WSQ.发(配置.biz, 头发('发起握手', 配置.biz, 额外));
  }
  WSQ.启动 = function () { if (!配置) WSQ.初始化(); 连接全部(); return WSQ; };
  WSQ.停止 = function () { 断开全部(); return WSQ; };
  WSQ.重连 = 重连业务;
  WSQ.刷新谁在 = function () {
    if (!业务ws || 业务ws.readyState !== 1) { 记日志('err', '未连接，不能刷新谁在'); return false; }
    return WSQ.发(配置.biz, 头发('谁在', 配置.biz));
  };

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
    /* 任何来自「服务端」角色的帧都算一次服务器露面：多台服务器时靠它补全列表 */
    if (String(对.角色 || '') === '服务端' && 对.软件号 && t !== '回应握手') {
      var 旧 = 服务器表[String(对.软件号)] || {};
      服务器表[String(对.软件号)] = { 号: String(对.软件号),
        昵称: 对.昵称 || 旧.昵称 || '', 设备名: 对.电脑名 || 旧.设备名 || '',
        产品: 对.产品 || 旧.产品 || '' };
      if (启动收集) 启动收集[String(对.软件号)] = true;
      通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
    }

    /* 客户端业务：对服务端问询作答 */
    if (t === '发起握手') {
      var 目标 = String(对.目标客户端 || '');
      /* 没写目标客户端的握手是广播给服务器的，客户端不得抢答 */
      if (!目标) return;
      if (目标 !== 配置.id && String(对.目标昵称 || '') !== 昵称()) return;
      WSQ.发(账号, 头发('回应握手', 账号, { 电脑名: 配置.dev, 产品: 配置.prod, 主动下线: true }));
    } else if (t === '谁在') {
      WSQ.发(账号, 头发('在线应答', 账号, { 电脑名: 配置.dev, 产品: 配置.prod }));
    }

    if (t === '回应握手') {
      服务端.昵称 = 对.昵称 || 对.电脑名 || ''; 服务端.号 = 对.软件号 || '';
      服务端.产品 = 对.产品 || ''; 服务端.设备名 = 对.电脑名 || '';
      if (对.软件号) {
        服务器表[String(对.软件号)] = { 号: String(对.软件号), 昵称: 对.昵称 || '',
          设备名: 对.电脑名 || '', 产品: 对.产品 || '' };
        if (启动收集) 启动收集[String(对.软件号)] = true;
        通知({ 类型: '服务器', 列表: WSQ.服务器(), 目标: 目标号 });
      }
      允许主动下线 = 对.主动下线 !== false;
      静止秒 = Number(对.静止秒 || 静止秒) || 默认静止;
      SS('still', 静止秒);
      上次心跳 = Date.now();
      状态 = '已连接'; 通知状态();
      记日志('sys', '握手成功（服务器 ' + 服务端.昵称 + ' · ' + 服务端.号 + '），主动下线=' + (允许主动下线 ? '开' : '关'));
      通知({类型: '握手', 服务端: JSON.parse(JSON.stringify(服务端))});
      if (配置.auto && !休眠) WSQ.刷新谁在();
    } else if (t === '在线应答') {
      上次在线端 = 对.在线端 || [];
      通知({类型: '在线端', 列表: WSQ.在线端()});
      if (!服务端.号 && 对.软件号) { 服务端.昵称 = 对.昵称 || ''; 服务端.号 = 对.软件号; }
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
    } else if (t === '回应切换集群') {
      记日志('sys', '服务端回应集群 ' + 对.账号 + '：' + (对.说明 || '已就绪'));
    } else if (t === '拒绝') {
      记日志('err', '服务端拒绝：' + (对.原因 || '未说明'));
    }
    通知({类型: '收', 账号: 账号, 数据: 对});
    通知状态();
  }

  /* ---------------- 看门狗：主动下线 / 键鼠活跃心跳 ---------------- */
  setInterval(function () {
    if (状态 === '未连接' || !配置) return;
    if (!允许主动下线) return;
    var 现在 = Date.now(), 空闲 = (现在 - 最近操作) / 1000, 心跳 = Number(配置.hb || 默认心跳);
    if (!休眠 && 空闲 >= 静止秒) {
      休眠 = true;
      WSQ.发(配置.biz, 头发('主动下线', 配置.biz, { 原因: '客户端静止超时' }));
      记日志('sys', '静止 ' + 静止秒 + ' 秒，已发主动下线');
      setTimeout(function () {
        try { if (业务ws) 业务ws.close(); } catch (e) {}
        业务ws = null; 已连上 = false; 状态 = '已下线'; 通知状态();
      }, 300);
    } else if (休眠 && 空闲 < 静止秒) {
      休眠 = false; 状态 = '重连中'; 记日志('sys', '检测到操作，重新上线'); 通知状态();
      业务ws = 建ws(配置.biz, true);
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
      if (!document.hidden) { 最近操作 = Date.now(); if (!业务ws && 状态 !== '未连接' && !休眠) 重连业务(); }
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
    s.onerror = function () { UI加载中 = false; };      /* 没有 UI 文件也照常跑逻辑 */
    (document.head || document.documentElement).appendChild(s);
  }

  global.WSQ = WSQ;
})(typeof window !== 'undefined' ? window : this);
