/* ============================================================
 * 【任务面板】网页模块 · 接口.js
 * 版本：0.03
 * 职责：网页版与服务器的通信层——由 fetch(/api/*) 改为 WebSocket（WS）请求层。
 *   · 页面与本机服务器各连【同一 PieSocket 频道】；页面发「请求帧」、服务器回「应答帧」。
 *     于是 GitHub Pages（静态、无后端）上打开也能跨网使用（§17 部署与 WS 通道）。
 *   · §19 对外页面安全：**频道号当口令**——`频道 = 固定前缀 + 口令`；源码【不写死频道名】，
 *     口令由用户**首次打开页面时输入**、本地缓存（localStorage），连接时运行时拼出频道。
 *     前缀 `TASKHUB`（本项目自定、非敏感）；口令默认留空、由用户填（用户已知 31415926fF@）。
 *   · 帧格式一律 FOX 2.0（57 字节头 + JSON 正文）；请求/应答带 id 配对、超长切片/拼装。
 *   · 省流：免心跳；任务/端列表用「版本指纹」差额（无变化回 未变、不重发数据）。
 *   · 静默：连上不宣告、不上线广播；仅在收到请求帧时才应答。断线逐次退避
 *     （3→6→12→24→48→60 秒封顶），用尽即宣告失败，绝不死循环轰炸。
 *   · 本机调试兜底：同源 http(s)（非 GitHub Pages）下若 WS 连不上，回落 fetch /api/*。
 * 说明：只用浏览器内置 WebSocket / fetch，不引任何外部 CDN；离线也能打开本文件。
 * 依赖：无（须先于 卡片.js / 面板.js 加载）。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.03';

  /* ---------------- 可配置常量（页面里可覆盖） ----------------
   * §19 对外页面安全：**频道号当口令**——连接频道 = 固定前缀 + 口令，【源码不写死频道名】。
   *   口令由用户首次打开页面时输入、存 localStorage（key=任务面板_口令），运行时拼出频道。
   *   想整体覆盖（如本机调试）：在页面 <head> 里先定义
   *     window.任务面板_WS配置 = {前缀:'…', 口令:'…', 密钥:'…', 主机:'…'} 即可。
   * 密钥（api_key）是 PieSocket 通道【基础设施】凭据（与 TTS 同一把），非频道口令。 */
  var 口令存储键 = '任务面板_口令';
  var 默认配置 = {
    主机: 'wss://free.blr2.piesocket.com/v3/',
    前缀: 'TASKHUB',                       // 固定前缀（本项目自定、非敏感）
    口令: '',                              // 口令（默认空＝首登填；由 取口令() 供值）
    密钥: 'ReDFavhh0qnOCKUUjQiLKVZ9RdxA6e4BGVKxxNug',
    单段上限: 10000,                       // 单段正文最大字节数（FOX 帧切片）
    请求超时: 20000,                        // 默认单请求超时（毫秒）
    退避: [3, 6, 12, 24, 48, 60]           // 断线逐次退避（秒），用尽即宣告失败
  };
  var 配置 = (function (基础, 覆盖) {
    var o = {}, k;
    for (k in 基础) { if (Object.prototype.hasOwnProperty.call(基础, k)) o[k] = 基础[k]; }
    if (覆盖) { for (k in 覆盖) { if (Object.prototype.hasOwnProperty.call(覆盖, k)) o[k] = 覆盖[k]; } }
    return o;
  })(默认配置, global.任务面板_WS配置);

  /* ---------------- 口令（§19：本地缓存，不写死在源码里） ---------------- */
  function 读缓存口令() {
    try { return String(global.localStorage.getItem(口令存储键) || ''); } catch (e) { return ''; }
  }
  function 存缓存口令(v) {
    try { global.localStorage.setItem(口令存储键, v); } catch (e) { }
  }
  function 清缓存口令() {
    try { global.localStorage.removeItem(口令存储键); } catch (e) { }
  }
  // 生效口令：优先本地缓存 → 页面覆盖提供的 配置.口令 → 空（空＝需要首登填）
  function 取口令() {
    var v = 读缓存口令();
    if (v) return v;
    return String(配置.口令 || '');
  }
  function 有口令() { return !!取口令(); }
  function 频道名() { return 配置.前缀 + 取口令(); }

  // 慢接口单独放宽超时（端刷新要扫共享数据库，可能较久）
  var 请求超时表 = { 'ends/refresh': 180000 };

  // 路由 → 本机 HTTP 兜底（仅同源 http(s) 且非 GitHub Pages 时启用；供本机调试）
  var HTTP表 = {
    'ping':         { 路径: '/api/ping',         方法: 'GET' },
    'tasks':        { 路径: '/api/tasks',        方法: 'GET' },
    'tree':         { 路径: '/api/tree',         方法: 'GET' },
    'ends':         { 路径: '/api/ends',         方法: 'GET' },
    'ends/refresh': { 路径: '/api/ends/refresh', 方法: 'GET' },
    'conv':         { 路径: '/api/conv',         方法: 'GET' },
    'publish':      { 路径: '/api/publish',      方法: 'POST' },
    'reply':        { 路径: '/api/reply',        方法: 'POST' },
    'state':        { 路径: '/api/state',        方法: 'POST' },
    'cardstate':    { 路径: '/api/cardstate',    方法: 'POST' },
    'detail':       { 路径: '/api/detail',       方法: 'GET' },
    'card':         { 路径: '/api/card',         方法: 'GET' },
    'redeliver':    { 路径: '/api/redeliver',    方法: 'POST' }
  };

  /* ---------------- 小工具 ---------------- */
  function 随机(k, 字母) {
    var s = '', 池 = 字母 || '0123456789';
    for (var i = 0; i < k; i++) s += 池.charAt(Math.floor(Math.random() * 池.length));
    return s;
  }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function pad3(n) { return ('00' + n).slice(-3); }
  function 新mid() {
    var d = new Date();
    var ts = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
      + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
    return ts + 随机(8, 'abcdefghijklmnopqrstuvwxyz');
  }
  function 字字节(ch) {
    var c = ch.codePointAt(0);
    return c < 0x80 ? 1 : (c < 0x800 ? 2 : (c < 0x10000 ? 3 : 4));
  }
  // 按字节上限切串（按码点切，绝不切断多字节字符 / emoji 代理对）
  function 切片(串, 上限) {
    if (!串) return [''];
    var 出 = [], 当前 = '', n = 0, ch;
    for (ch of 串) {
      var l = 字字节(ch);
      if (n + l > 上限) { 出.push(当前); 当前 = ''; n = 0; }
      当前 += ch; n += l;
    }
    出.push(当前);
    return 出;
  }
  function 头后正文(msg) {
    try {
      var 字 = new TextEncoder().encode(msg);
      return new TextDecoder('utf-8').decode(字.slice(57));
    } catch (e) {
      return msg.slice(57);   // 极老旧浏览器兜底（头为纯 ASCII，字符偏移≈字节偏移）
    }
  }
  var 头正则 = /^【FOXID:(\d{14})([a-z]{8})(\d{10})=cut\((\d{3})\/(\d{3})\)】/;
  function 剥头(msg) {
    var m = 头正则.exec(msg);
    if (!m) return null;
    if (m[3] === _网页号) return { 回声: true };
    return {
      mid: m[1] + m[2], sender: m[3],
      idx: parseInt(m[4], 10), total: parseInt(m[5], 10),
      正文: 头后正文(msg)
    };
  }
  function 帧(正文, idx, total, mid) {
    return '【FOXID:' + mid + _网页号 + '=cut(' + pad3(idx) + '/' + pad3(total) + ')】' + 正文;
  }

  /* ---------------- 网页端软件号（10 位、'3' 开头＝网页端角色；随浏览器持久化） ---------------- */
  function 取网页号() {
    var k = '任务面板_网页软件号';
    try {
      var v = global.localStorage.getItem(k);
      if (v && /^\d{10}$/.test(v)) return v;
    } catch (e) { /* 隐私模式等：退化为内存号 */ }
    var s = '3' + 随机(9);
    try { global.localStorage.setItem(k, s); } catch (e) { }
    return s;
  }
  var _网页号 = 取网页号();

  /* ---------------- 连接状态 ---------------- */
  var ws = null;
  var _连接态 = '未连';       // 未连 / 连接中 / 已连 / 断开 / 重连等待 / 失败
  var _连续失败 = 0;
  var _重连定时 = null;
  var _最近错 = '';
  var _待发队列 = [];
  var _待应答 = {};
  var _收帧缓冲 = {};

  function 频道地址() {
    return 配置.主机 + 频道名() + '?api_key=' + 配置.密钥;
  }
  function 有WS() { return !!ws && ws.readyState === 1; }
  function 通知状态() {
    try {
      if (typeof global.任务面板_通道变化 === 'function') {
        global.任务面板_通道变化(连接状态());
      }
    } catch (e) { }
  }

  function 开连接() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    if (_连接态 === '失败') return;
    if (!有口令()) { _连接态 = '等待口令'; _最近错 = '未设置口令（首次使用请先填口令）'; 通知状态(); return; }
    if (!全局可WS()) { _宣告失败('本环境不支持 WebSocket'); return; }
    var w;
    try { w = new WebSocket(频道地址()); } catch (e) { _宣告失败('创建 WebSocket 失败：' + e); return; }
    ws = w; _连接态 = '连接中'; 通知状态();
    w.onopen = function () {
      if (ws !== w) return;
      _连接态 = '已连'; _连续失败 = 0; _最近错 = '';
      var 队 = _待发队列; _待发队列 = [];
      队.forEach(function (正文) { try { 发正文(正文); } catch (e) { } });
      通知状态();
    };
    w.onmessage = function (ev) { 收消息(ev); };
    w.onerror = function () { /* onclose 随后必到 */ };
    w.onclose = function () {
      if (ws !== w) return;
      ws = null;
      if (_连接态 === '失败' || _连接态 === '未连') { 通知状态(); return; }
      _连接态 = '断开';
      排重连();
      通知状态();
    };
  }

  function 全局可WS() { return typeof global.WebSocket === 'function'; }

  function 排重连() {
    if (_重连定时 || _连接态 === '失败') return;
    _连续失败 += 1;
    if (_连续失败 > 配置.退避.length) {
      _宣告失败('通道断线重连已达上限（' + 配置.退避.length + ' 次），停止重试');
      return;
    }
    var 等 = 配置.退避[_连续失败 - 1];
    _连接态 = '重连等待';
    _最近错 = '断线，' + 等 + ' 秒后第 ' + _连续失败 + ' 次重连';
    _重连定时 = setTimeout(function () { _重连定时 = null; 开连接(); }, 等 * 1000);
  }

  function 宣告失败(原因) { _宣告失败(原因); }
  function _宣告失败(原因) {
    _连接态 = '失败'; _最近错 = 原因;
    _待发队列.length = 0;
    var id;
    for (id in _待应答) {
      if (!Object.prototype.hasOwnProperty.call(_待应答, id)) continue;
      try { clearTimeout(_待应答[id].timer); } catch (e) { }
      try { _待应答[id].reject(new Error(原因)); } catch (e) { }
    }
    _待应答 = {};
    通知状态();
  }

  function 确保连接() {
    if (!有口令()) return;                       // §19：未填口令 → 先不连，等首登填
    if (有WS()) return;
    if (_连接态 === '失败') return;
    if (_连接态 === '未连' || _连接态 === '断开') 开连接();
    else if (_连接态 === '连接中' || _连接态 === '重连等待') { /* 已在途 */ }
  }

  function 重连() {
    if (_重连定时) { clearTimeout(_重连定时); _重连定时 = null; }
    if (ws) { try { ws.close(); } catch (e) { } ws = null; }
    _连接态 = '未连'; _连续失败 = 0; _最近错 = '';
    开连接();
  }

  /* ---------------- 收发 ---------------- */
  function 发正文(正文) {
    if (!有WS()) return false;
    var 片 = 切片(正文, 配置.单段上限);
    var mid = 新mid();
    for (var i = 0; i < 片.length; i++) {
      ws.send(帧(片[i], i + 1, 片.length, mid));
    }
    return true;
  }

  function 发json(对象) {
    var 正文 = JSON.stringify(对象);
    if (有WS()) return 发正文(正文);
    _待发队列.push(正文);
    确保连接();
    return false;
  }

  var _收缓冲上限 = 60000;   // 未拼齐的帧缓冲存活 60 秒
  function 清缓冲() {
    var now = Date.now(), k;
    for (k in _收帧缓冲) {
      if (Object.prototype.hasOwnProperty.call(_收帧缓冲, k) && now - _收帧缓冲[k].时刻 > _收缓冲上限) {
        delete _收帧缓冲[k];
      }
    }
  }
  function 收消息(ev) {
    var raw = ev && ev.data;
    if (typeof raw !== 'string') return;
    var h = 剥头(raw);
    if (!h || h.回声) return;
    if (h.total <= 1) { 消费(h.正文); return; }
    var b = _收帧缓冲[h.mid];
    if (!b) { b = _收帧缓冲[h.mid] = { total: h.total, 片: {}, 时刻: Date.now() }; }
    b.片[h.idx] = h.正文;
    var 齐 = true, i;
    for (i = 1; i <= b.total; i++) { if (b.片[i] === undefined) { 齐 = false; break; } }
    if (齐) {
      var 串 = '';
      for (i = 1; i <= b.total; i++) 串 += b.片[i];
      delete _收帧缓冲[h.mid];
      消费(串);
    }
    清缓冲();
  }

  function 消费(正文) {
    var d;
    try { d = JSON.parse(正文); } catch (e) { return; }
    if (!d || typeof d !== 'object' || d.t !== 'res') return;
    if (d.to && d.to !== _网页号) return;          // 别的网页端的应答，丢弃
    var 待 = _待应答[d.id];
    if (!待) return;
    delete _待应答[d.id];
    try { clearTimeout(待.timer); } catch (e) { }
    if (d.ok === false) { 待.reject(new Error(d.err || '请求失败')); return; }
    待.resolve(d);
  }

  /* ---------------- 请求层 ---------------- */
  function 等连接(毫秒) {
    if (有WS()) return Promise.resolve(true);
    if (_连接态 === '失败') return Promise.resolve(false);
    确保连接();
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var 定时 = setInterval(function () {
        if (有WS()) { clearInterval(定时); resolve(true); return; }
        if (_连接态 === '失败') { clearInterval(定时); resolve(false); return; }
        if (Date.now() - t0 >= 毫秒) { clearInterval(定时); resolve(false); }
      }, 120);
    });
  }

  function WS请求(路由, 载荷, 选项) {
    return new Promise(function (resolve, reject) {
      if (_连接态 === '失败') { reject(new Error('通道未连接：' + _最近错)); return; }
      var id = 'r' + Date.now().toString(36) + 随机(4, 'abcdefghijklmnopqrstuvwxyz');
      var 超时 = (选项 && 选项.超时) || 请求超时表[路由] || 配置.请求超时;
      var 定时 = setTimeout(function () {
        delete _待应答[id];
        reject(new Error('请求超时（' + 路由 + '）'));
      }, 超时);
      _待应答[id] = { resolve: resolve, reject: reject, timer: 定时, 路由: 路由 };
      发json({ t: 'req', id: id, r: 路由, p: 载荷 || {}, sid: _网页号 });
    });
  }

  function 查询串(参数) {
    var 段 = [];
    if (参数) {
      for (var k in 参数) {
        if (!Object.prototype.hasOwnProperty.call(参数, k)) continue;
        var v = 参数[k];
        if (v === undefined || v === null || v === '') continue;
        段.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
      }
    }
    return 段.length ? ('?' + 段.join('&')) : '';
  }

  function 可HTTP回退() {
    try {
      var p = global.location.protocol, h = global.location.hostname || '';
      if (p !== 'http:' && p !== 'https:') return false;
      if (/\.github\.io$/i.test(h)) return false;      // GitHub Pages 是静态页、无后端
      return true;
    } catch (e) { return false; }
  }

  function HTTP请求(路由, 载荷) {
    var 项 = HTTP表[路由];
    if (!项) return Promise.reject(new Error('未知接口：' + 路由));
    载荷 = 载荷 || {};
    var 地址 = 项.路径, init = { method: 项.方法, headers: {} };
    if (项.方法 === 'GET') {
      地址 += 查询串(载荷);
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(载荷);
    }
    return fetch(地址, init).then(function (响应) {
      return 响应.text().then(function (文本) {
        var 数据 = null;
        try { 数据 = 文本 ? JSON.parse(文本) : {}; } catch (e) {
          throw new Error('后端返回非 JSON（HTTP ' + 响应.status + '）');
        }
        if (!响应.ok || (数据 && 数据.ok === false)) {
          throw new Error((数据 && 数据.err) || ('请求失败 HTTP ' + 响应.status));
        }
        return 数据;
      });
    }, function (e) {
      throw new Error('网络不可达：' + ((e && e.message) ? e.message : e));
    });
  }

  // 统一调用：优先 WS；同源 http(s) 且 WS 连不上时回落本机 HTTP（供本机调试）
  function 调用(路由, 载荷, 选项) {
    载荷 = 载荷 || {};
    选项 = 选项 || {};
    if (有WS()) return WS请求(路由, 载荷, 选项);
    if (_连接态 === '失败') {
      if (可HTTP回退()) return HTTP请求(路由, 载荷);
      return Promise.reject(new Error('通道未连接：' + _最近错));
    }
    return 等连接(2500).then(function (ok) {
      if (ok) return WS请求(路由, 载荷, 选项);
      if (可HTTP回退()) return HTTP请求(路由, 载荷);
      return WS请求(路由, 载荷, 选项);   // 最终仍走 WS（连接超时后 reject）
    });
  }

  /* ---------------- 口令（§19 首登填、本地缓存） ---------------- */
  function 需要口令() { return !有口令(); }

  // 设置口令：存本地缓存 → 用新口令重连（重连内部会先关旧连再按新频道开连）。返回 bool。
  function 设置口令(口令值) {
    var v = String(口令值 == null ? '' : 口令值).trim();
    if (!v) return false;
    存缓存口令(v);
    try {
      if (typeof global.任务面板_口令变化 === 'function') global.任务面板_口令变化(v);
    } catch (e) { }
    重连();
    return true;
  }

  // 清除口令：删本地缓存并断连（下次进页面会再要口令）。
  function 清除口令() {
    清缓存口令();
    _连接态 = '未连';
    重连();
  }

  /* ---------------- 对外接口（沿用既有语义，前端解析不用大改） ---------------- */
  var 接口 = {
    版本: 版本,
    raw: 调用,

    连接状态: function () {
      return { 状态: _连接态, 频道: 频道名(), 重试: _连续失败, 最近错: _最近错, 需口令: !有口令() };
    },
    重连: 重连,

    /* §19 口令（首登填、本地缓存） */
    需要口令: 需要口令,
    设置口令: 设置口令,
    读取口令: 取口令,
    清除口令: 清除口令,

    // 连通与版本
    ping: function () { return 调用('ping', {}); },

    // 任务（主卡）列表；传 指纹 时走差额（无变化回 {未变:true}）
    任务列表: function (指纹) { return 调用('tasks', 指纹 ? { since: 指纹 } : {}); },

    // 以某卡为根的整棵卡片树
    任务树: function (编号) { return 调用('tree', { no: 编号 }); },

    // 端列表（含历史）
    端列表: function (指纹) { return 调用('ends', 指纹 ? { since: 指纹 } : {}); },

    // 主动刷新端（探测在线），返回 {ok,结果}
    刷新端: function () { return 调用('ends/refresh', {}); },

    // 某端下的对话列表
    端对话: function (端名) { return 调用('conv', { end: 端名 }); },

    // 发布任务
    发布: function (内容, 发布者, 执行者, 相关情况) {
      return 调用('publish', {
        内容: 内容, 发布者: 发布者 || '人',
        执行者: 执行者 || {}, 相关情况: 相关情况 || ''
      });
    },

    // 回帖（角色 ∈ 人蓝 / AI绿 / AI黄）
    回帖: function (父编号, 作者, 角色, 正文) {
      return 调用('reply', { 父编号: 父编号, 作者: 作者 || '人', 角色: 角色 || '人蓝', 正文: 正文 || '' });
    },

    // 改任务状态（6 档）
    改任务状态: function (编号, 状态, 操作者) {
      return 调用('state', { 编号: 编号, 状态: 状态, 操作者: 操作者 || '人' });
    },

    // 改某张卡的卡片状态（发送中/已送达/发送失败/已读/未读/已结束）
    改卡片状态: function (编号, 状态) {
      return 调用('cardstate', { 编号: 编号, 状态: 状态 });
    },

    // 重投（发送失败后「重试」）
    重投: function (编号) { return 调用('redeliver', { 编号: 编号 }); },

    // 某张卡的详情
    详情: function (编号) { return 调用('detail', { no: 编号 }); },

    // 直接取某张卡内容（供「详情」按钮免按标题翻找）
    取卡: function (编号) { return 调用('card', { no: 编号 }); }
  };

  // 首屏即尝试连接（静默：连上不宣告，只等应答）
  if (全局可WS()) 确保连接();

  global.接口 = 接口;
})(window);
