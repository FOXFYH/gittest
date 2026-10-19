/* ============================================================
 * 【任务面板】网页模块 · 面板.js
 * 版本：0.12
 * 职责：页面装配（《软件架构设计》§6 手机网页版）。
 *   · 顶部【发布任务】→ 发布界面：填内容 / 选 AI 大类(WorkBuddy|Trae) / 列该类下所有端 /
 *     选中端→列出该端对话 / 指定对话→提交（接口层 接口.js 已改为 WS 请求）。
 *   · 端列表区：列全部端（含历史），【刷新】主动刷新，刷新后显示每个端是否在线（离线灰显）。
 *   · 任务区：贴吧风格列出任务卡，支持展开/收起（卡片交互由 卡片.js 负责）。
 *   · 省流：任务/端列表带「版本指纹」差额——无变化则不重绘（接口层回 {未变:true}）。
 * 说明：纯 DOM，不引外部 CDN。依赖：接口.js、卡片.js（须先加载）。
 * 维护记录：
 *   · 0.12（2026-10-19）①【平铺回复】适配后端新结构：取数返回「主卡＋平铺 回复列表」，
 *     拍平后代/卡时刻/排卡 优先用 行.回复列表（时间升序）；主卡下方平铺其全部回复（无嵌套）。
 *     ②投递四段状态机：顶栏/卡片胶囊沿用「连接 WS 中 → 等待服务器回应 → 服务器已接收 →
 *     投递成功（失败＝发送失败）」；不再靠「AI 回复出现」判投递成功。③编号显示（主卡 #1 不补零）
 *     与「AI 回复 (n)」（黑＝总数、蓝＝未读）由 卡片.js 0.05 实现。
 *   · 0.11（2026-10-19）修顶栏角色脚标「已连却停『连接中…』」：首载 ping 挂起不落地 → 改超时/失败退避重试（1.5s×≤10），连上后取服务器版本。
 *   · 0.01（2026-10-18）首版（WS4 网页工位）。
 *   · 0.02（2026-10-18）WS4C：适配 WS 请求层——任务/端列表「版本指纹」差额、通道失败可再武装。
 *   · 0.03（2026-10-18）WS4C：修「假投递失败」提示——发布是【异步投递】，应答里没有 `投递` 字段；
 *     改为只显示「已发布，编号 #xxx（发送中）」，并稍后按需拉取一次，让最终「已送达/发送失败」
 *     由卡片状态自动跟上（不再出现「投递失败：未知」）。
 *   · 0.04（2026-10-18）§19：新增「口令」首登窗与顶栏「口令」钮（频道＝前缀+口令，运行时拼）。
 *   · 0.05（2026-10-18）排障提示：角色脚标在「频道已连但无服务器应答」时显式提示
 *     「已连频道 · 服务器未响应」（此前误显「未连接」，用户会以为是自己填错口令/连不上）。
 *   · 0.06（2026-10-18）发布请求阶段上顶栏：点【发布】时，未连 WS → 角色显「WS 连接中」，
 *     已连 → 显「等待服务器接受」；应答后复位（服务器侧的「服务器已开始执行 / 投递成功」
 *     由卡片状态胶囊显示，见 卡片.js 0.02）。
 *   · 0.07（2026-10-18）「选择对话」改版：**一行一个对话，只显示 对话名 + 忙闲标签**
 *     （忙＝红/闲＝绿/未知＝灰，文字就写「忙」「闲」「未知」），**去掉 SID/终身号 展示标签**
 *     （`选对话` 对象里仍保留 `终身号` 供提交）；并在**发布弹窗打开且已选端**时**每 10 秒**
 *     重拉一次该端对话、刷新忙闲（10 秒内新鲜）；`关发布()`（弹窗隐藏）即**停轮询**（清定时器）。
 *     刷新时按稳定键（终身号/SID/对话名）**复原选中**，不打断用户已选。
 *   · 0.08（2026-10-18）按用户口径改【平铺】：新增并导出 `拍平后代()`——把 `接口.任务树()`
 *     返回的**嵌套树**递归展平成**扁平列表**（按时间/编号顺序），供 卡片.js 将互动树里的
 *     后代卡片**同层平铺**渲染（不再递归下钻、不再嵌套缩进）。
 *   · 0.09（2026-10-18）按用户口径改【排序】：主卡列表改按「最后回复时间」**倒序**——
 *     某张主卡（含其平铺在互动树里的回复）最近一次被回复（人或 AI）的时间越新越靠上，
 *     最新发布的新卡排最上面。新增 `时刻()/卡时刻()/排卡()`：服务端 tasks 不含回复时间，
 *     故对有回复的卡按需拉一次 接口.任务树() 取时间（带缓存、失败退化发布时间），
 *     不新增服务端字段、不动冻结签名；画任务() 改为「先异步排序再绘制」。
 *   · 0.10（2026-10-19）主卡新增【删除】整卡（交互与二次确认在 卡片.js 0.04）：本模块
 *     不改逻辑——删除成功后仍复用既有 `载任务(true)`（选项.刷新 已指向它）重绘任务列表；
 *     仅同步版本号并记录。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.11';
  var 端缓存 = [];       // 全部端（含历史）
  var 端版本 = '';       // 端列表「版本指纹」（差额推送用；空=全量）
  var 任务版本 = '';     // 任务列表「版本指纹」（差额推送用；空=全量）
  var 选大类 = null;     // 'WorkBuddy' | 'Trae'
  var 选端 = null;       // 端 dict
  var 选对话 = null;     // 对话 dict
  var 提示定时 = null;
  var 忙闲轮询 = null;   // 「选择对话」忙闲 10 秒轮询定时器
  var 轮询在途 = false;  // 上一轮忙闲拉取是否仍在途（防叠加）

  function $(id) { return document.getElementById(id); }

  function 提示(文案) {
    var 条 = $('提示');
    if (!条) return;
    条.textContent = 文案;
    条.classList.remove('隐藏');
    if (提示定时) clearTimeout(提示定时);
    提示定时 = setTimeout(function () { 条.classList.add('隐藏'); }, 2600);
  }

  function 空样(文本) {
    var d = document.createElement('div');
    d.className = '空样';
    d.textContent = 文本;
    return d;
  }

  // ---------------- 顶栏 / 角色 ----------------
  // 0.11：修「已连频道却一直显示『连接中…』」——首载时 WS 尚未连上，ping 会挂起不落地，
  //   既不走 then 也不走 catch，角色脚标永远停在初始文案。改为「超时/失败即退避重试」，
  //   连上后再取服务器版本；仍如实给「未连接 / 已连频道 · 服务器未响应 / 通道失败」。
  function 载角色(试) {
    试 = 试 || 0;
    var 完 = false;
    var 计时 = setTimeout(function () { if (!完) { 完 = true; 重试(); } }, 4000);
    global.接口.ping().then(function (r) {
      if (完) return;
      完 = true; clearTimeout(计时);
      $('角色').textContent = '已连接 · v' + (r.版本 || '');
    }).catch(function () {
      if (完) return;
      完 = true; clearTimeout(计时);
      重试();
    });
    function 重试() {
      var 态 = '';
      try { 态 = (global.接口.连接状态 && global.接口.连接状态().状态) || ''; } catch (e) { }
      if (态 === '失败') { $('角色').textContent = '通道失败'; return; }
      if (态 === '已连') $('角色').textContent = '已连频道 · 服务器未响应';   // 频道通了但没服务器应答
      else $('角色').textContent = '未连接';
      if (试 < 10) setTimeout(function () { 载角色(试 + 1); }, 1500);        // 连上前每 1.5s 重试，封顶 10 次
    }
  }

  // ---------------- 端列表 ----------------
  function 载端(强制) {
    return global.接口.端列表(强制 ? '' : 端版本).then(function (r) {
      if (r && r.版本) 端版本 = r.版本;
      if (r && r.未变 && !强制) return;   // 无变化不重绘（省流）
      端缓存 = (r && r.端) || [];
      画端();
    }).catch(function (e) {
      $('端列表').innerHTML = '';
      $('端列表').appendChild(空样('加载失败：' + e.message));
      $('端计数').textContent = '';
    });
  }

  function 画端() {
    var 框 = $('端列表');
    框.innerHTML = '';
    if (!端缓存.length) {
      框.appendChild(空样('暂无端（点「刷新」扫描）'));
      $('端计数').textContent = '';
      return;
    }
    var 在线数 = 0;
    端缓存.forEach(function (端) {
      var 在线 = !!端.在线;
      if (在线) 在线数++;
      var 项 = document.createElement('div');
      项.className = '端项' + (在线 ? '' : ' 离线');

      var 名 = document.createElement('span');
      名.className = '端名';
      名.textContent = 端.端名 || '（未知端）';
      项.appendChild(名);

      项.appendChild(标(端.类型 || ''));
      if (端.软件) 项.appendChild(标(端.软件));
      if (端.昵称) 项.appendChild(标(端.昵称));

      var 标在 = document.createElement('span');
      标在.className = '在线标 ' + (在线 ? '在线' : '离线');
      标在.textContent = 在线 ? '在线' : '离线';
      项.appendChild(标在);

      if (端.最近见到) 项.appendChild(标('最近：' + 端.最近见到));
      框.appendChild(项);
    });
    $('端计数').textContent = '共 ' + 端缓存.length + ' 个 · 在线 ' + 在线数;
  }

  function 标(文本) {
    var s = document.createElement('span');
    s.className = '端标';
    s.textContent = 文本;
    return s;
  }

  // ---------------- 主动刷新端 ----------------
  function 刷新端() {
    var 钮刷 = $('按钮_刷新');
    if (钮刷.disabled) return;
    // 通道曾失败：用户点刷新时再武装一次（不做后台无限重试）
    try {
      if (global.接口.连接状态 && global.接口.连接状态().状态 === '失败') global.接口.重连();
    } catch (e) { }
    钮刷.disabled = true;
    提示('正在刷新端…');
    global.接口.刷新端().then(function (r) {
      var 结 = (r && r.结果) || {};
      提示('刷新完成：新增 ' + (结.新增 || 0) + ' · 在线 ' + (结.在线 || 0) + ' · 总数 ' + (结.总数 || 0));
    }).catch(function (e) {
      提示('刷新失败：' + e.message);
    }).then(function () {
      钮刷.disabled = false;
      端版本 = ''; 任务版本 = '';
      return 载端(true);
    }).then(function () {
      return 载任务(true);
    });
  }

  // ---------------- 任务区 ----------------
  function 载任务(强制) {
    return global.接口.任务列表(强制 ? '' : 任务版本).then(function (r) {
      if (r && r.版本) 任务版本 = r.版本;
      if (r && r.未变 && !强制) return;   // 无变化不重绘（省流）
      画任务((r && r.任务) || []);
    }).catch(function (e) {
      $('任务列表').innerHTML = '';
      $('任务列表').appendChild(空样('加载失败：' + e.message));
      $('任务计数').textContent = '';
    });
  }

  // ---------------- 互动树「拍平」（平铺口径） ----------------
  // 把 接口.任务树() 返回的【嵌套树】递归展平成【扁平列表】（按时间/编号顺序），
  // 供 卡片.js 把互动树里的后代卡片同层平铺渲染——只取后代（不含根节点），不再递归下钻。
  function 比序(a, b) {
    var ta = (a && a.时间) || '', tb = (b && b.时间) || '';
    if (ta && tb && ta !== tb) return ta < tb ? -1 : 1;
    var na = (a && a.编号) || '', nb = (b && b.编号) || '';
    return na < nb ? -1 : (na > nb ? 1 : 0);
  }
  function 拍平后代(节点) {
    if (节点 && Object.prototype.toString.call(节点.回复列表) === '[object Array]') {
      return 节点.回复列表.slice();   // 新结构：后端已给【平铺】回复列表（时间升序），原样用
    }
    var 出 = [];
    (function 走(子们) {
      (子们 || []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        出.push(c);
        走(c.子卡);
      });
    })((节点 || {}).子卡);
    出.sort(比序);
    return 出;
  }

  // ---------------- 排序：按「最后回复时间」倒序 ----------------
  // 用户口径：某张主卡（含其平铺在互动树里的回复）最近一次被回复（人或 AI）的时间越新，
  // 整张主卡就越靠上；于是最新发布的新卡会排在最上面。
  // 「最后回复时间」＝该主卡自身时间 与 其全部后代卡片时间 的最大值。
  // 服务端 tasks 只给主卡的「回复」编号列表、不含时间；故对有回复的卡按需拉一次
  // 接口.任务树() 取时间（不新增服务端字段、不动冻结签名）；失败退化为「发布时间」。
  var 时间缓存 = {};      // 编号 -> { 回复数: n, 键: 毫秒 }（回复数未变即复用，免重复拉树）
  var 画序号 = 0;         // 绘制序号：异步排序期间若有更新的一次绘制在途，丢弃本次

  function 时刻(文本) {
    // 兼容云端表格回读格式：`2026/10/18 21:13`（秒被显示层吞掉）、`2026-10-18 14:40:00` 等
    var s = String(文本 == null ? '' : 文本).trim();
    var m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/.exec(s);
    if (!m) return 0;
    return Date.UTC(+m[1], (+m[2]) - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  function 卡时刻(节点) {
    var t = 时刻((节点 || {}).时间 || (节点 || {}).发布时间);
    (拍平后代(节点 || {}) || []).forEach(function (c) {
      var x = 时刻(c && c.时间);
      if (x > t) t = x;
    });
    return t;
  }

  // 排卡：返回 Promise<按「最后回复时间」倒序排好的主卡列表>。无回复 → 用发布时间（免拉树）。
  function 排卡(列表) {
    return Promise.all(列表.map(function (行) {
      var 自身 = 时刻(行.发布时间 || 行.时间);
      var 有列表 = Object.prototype.toString.call(行.回复列表) === '[object Array]';
      var 数 = 有列表 ? 行.回复列表.length : (行.回复 || []).length;
      if (!数) return Promise.resolve({ 行: 行, 键: 自身 });
      if (有列表) return Promise.resolve({ 行: 行, 键: Math.max(自身, 卡时刻(行)) });   // 新结构：本地即得，免拉树
      var 记 = 时间缓存[行.编号];
      if (记 && 记.回复数 === 数) return Promise.resolve({ 行: 行, 键: 记.键 });
      if (!global.接口 || typeof global.接口.任务树 !== 'function') {
        return Promise.resolve({ 行: 行, 键: 自身 });
      }
      return global.接口.任务树(行.编号).then(function (r) {
        var 键 = Math.max(自身, 卡时刻((r && r.树) || {}));
        时间缓存[行.编号] = { 回复数: 数, 键: 键 };
        return { 行: 行, 键: 键 };
      }).catch(function () { return { 行: 行, 键: 自身 }; });
    })).then(function (项们) {
      项们.sort(function (a, b) { return b.键 - a.键; });
      return 项们.map(function (x) { return x.行; });
    });
  }

  function 画任务(列表) {
    if (!列表 || !列表.length) { _画任务(列表 || []); return; }
    var 我 = ++画序号;
    排卡(列表).then(function (排序后) {
      if (我 !== 画序号) return;      // 已有更新的一次绘制在途 → 丢弃本次（防乱序覆盖）
      _画任务(排序后);
    });
  }

  function _画任务(列表) {
    var 框 = $('任务列表');
    框.innerHTML = '';
    if (!列表.length) {
      框.appendChild(空样('还没有任务，点右上角「发布任务」贴一张'));
      $('任务计数').textContent = '';
      return;
    }
    var 选项 = { 主卡: true, 单卡: true, 刷新: function () { return 载任务(true); }, 提示: 提示 };
    列表.forEach(function (行) {
      框.appendChild(global.卡片.渲染卡(行, 选项));
    });
    global.卡片.自适应(框);
    $('任务计数').textContent = '共 ' + 列表.length + ' 个';
  }

  // ---------------- 发布弹窗 ----------------
  function 开发布() {
    选大类 = null; 选端 = null; 选对话 = null;
    $('发布_内容').value = '';
    大类钮们().forEach(function (b) { b.classList.remove('选中'); });
    重置选择框($('发布_端'), '请先选大类');
    重置选择框($('发布_对话'), '请先选端');
    $('发布弹窗').classList.remove('隐藏');
  }

  function 关发布() {
    $('发布弹窗').classList.add('隐藏');
    停轮询();                          // 弹窗关闭即停「忙闲」轮询
    选端 = null; 选对话 = null;
  }

  function 大类钮们() {
    return Array.prototype.slice.call(document.querySelectorAll('#发布_大类 .大类钮'));
  }

  function 重置选择框(框, 文本) {
    框.innerHTML = '';
    框.appendChild(空样(文本));
  }

  function 选大类处理(类) {
    选大类 = 类; 选端 = null; 选对话 = null;
    大类钮们().forEach(function (b) {
      b.classList.toggle('选中', b.getAttribute('data-类') === 类);
    });
    重置选择框($('发布_对话'), '请先选端');
    var 做 = function () {
      var 该类 = 端缓存.filter(function (端) { return (端.类型 || '') === 类; });
      var 框 = $('发布_端');
      框.innerHTML = '';
      if (!该类.length) {
        框.appendChild(空样('该大类下暂无可扫描到的端' + (端缓存.length ? '' : '（请先在端列表点「刷新」）')));
        return;
      }
      该类.forEach(function (端) {
        var 行 = document.createElement('div');
        行.className = '选行';
        行.appendChild(文(端.端名 || '（未知端）'));
        行.appendChild(标(端.类型 || ''));
        var 标在 = document.createElement('span');
        标在.className = '在线标 ' + (端.在线 ? '在线' : '离线');
        标在.textContent = 端.在线 ? '在线' : '离线';
        行.appendChild(标在);
        行.addEventListener('click', function () { 选端处理(端, 行); });
        框.appendChild(行);
      });
    };
    if (!端缓存.length) {
      重置选择框($('发布_端'), '加载中…');
      global.接口.端列表().then(function (r) {
        端缓存 = (r && r.端) || [];
        做();
      }).catch(function (e) {
        重置选择框($('发布_端'), '加载失败：' + e.message);
      });
    } else {
      做();
    }
  }

  var 轮询间隔毫秒 = 10000;   // 「选择对话」忙闲轮询间隔（来源约每 10 秒刷新一轮，故 10 秒内新鲜）

  // 对话的稳定键（用于轮询重绘后复原选中）：终身号优先，其次 SID / 对话名
  function 键(对话) {
    return (对话 && (对话.终身号 || 对话.SID || 对话.对话名)) || '';
  }

  // 忙闲标签：忙＝红 / 闲＝绿 / 未知＝灰（文字就写「忙」「闲」「未知」）
  function 忙闲标(灯) {
    var s = document.createElement('span');
    var 值 = (灯 === '忙' || 灯 === '闲') ? 灯 : '未知';
    s.className = '忙闲标 ' + 值;
    s.textContent = 值;
    return s;
  }

  // 拉该端对话并重绘（静默＝轮询刷新：不显「加载中」、失败不打断已画列表）
  function 拉对话(静默) {
    var 端 = 选端;
    if (!端) return Promise.resolve();
    if (!静默) 重置选择框($('发布_对话'), '加载对话中…');
    return global.接口.端对话(端.端名).then(function (r) {
      if (选端 !== 端) return;              // 端已切换：丢弃过期应答
      画对话((r && r.对话) || []);
    }).catch(function (e) {
      if (静默) return;                     // 轮询失败：保留上一帧、不闪错
      重置选择框($('发布_对话'), '加载失败：' + e.message);
    });
  }

  // 一行一个对话：只显示 对话名 + 忙闲标签（SID/终身号不再展示；终身号仍在 对话 dict 里供提交）
  function 画对话(对话s) {
    var 框 = $('发布_对话');
    var 旧键 = 选对话 ? 键(选对话) : '';
    框.innerHTML = '';
    if (!对话s.length) {
      框.appendChild(空样('该端暂无对话'));
      选对话 = null;
      return;
    }
    var 新选 = null;
    对话s.forEach(function (对话) {
      var 行 = document.createElement('div');
      行.className = '选行';
      行.appendChild(文(对话.对话名 || '（未命名对话）'));
      行.appendChild(忙闲标(对话.忙闲));
      行.addEventListener('click', function () { 选对话处理(对话, 行); });
      if (旧键 && 键(对话) === 旧键) { 行.classList.add('选中'); 新选 = 对话; }
      框.appendChild(行);
    });
    选对话 = 新选;                          // 重绘后按稳定键复原选中；找不到＝视为未选
  }

  function 选端处理(端, 行元素) {
    选端 = 端; 选对话 = null;
    Array.prototype.forEach.call($('发布_端').children, function (c) {
      c.classList && c.classList.remove('选中');
    });
    行元素.classList.add('选中');
    重置选择框($('发布_对话'), '加载对话中…');
    拉对话(false);
    开轮询();                              // 已选端 → 每 10 秒刷新忙闲
  }

  // 「选择对话」忙闲轮询：发布弹窗打开且已选端时每 10 秒重拉一次；弹窗关闭/未选端即停
  function 开轮询() {
    停轮询();
    忙闲轮询 = setInterval(轮询一跳, 轮询间隔毫秒);
  }

  function 停轮询() {
    if (忙闲轮询) { clearInterval(忙闲轮询); 忙闲轮询 = null; }
    轮询在途 = false;
  }

  function 轮询一跳() {
    var 弹 = $('发布弹窗');
    if (!弹 || 弹.classList.contains('隐藏') || !选端) { 停轮询(); return; }   // 弹窗隐藏/未选端 → 停
    if (轮询在途) return;                  // 上一轮未回 → 跳过本次（防叠加）
    轮询在途 = true;
    拉对话(true).then(function () { 轮询在途 = false; });
  }

  function 选对话处理(对话, 行元素) {
    选对话 = 对话;
    Array.prototype.forEach.call($('发布_对话').children, function (c) {
      c.classList && c.classList.remove('选中');
    });
    行元素.classList.add('选中');
  }

  function 文(文本) {
    var s = document.createElement('span');
    s.textContent = 文本;
    return s;
  }

  function 提交发布() {
    var 内容 = ($('发布_内容').value || '').trim();
    if (!内容) { 提示('请先填写任务内容'); return; }
    if (!选端) { 提示('请先选择端'); return; }
    if (!选对话) { 提示('请先选择对话'); return; }
    var 确认 = $('发布_确认');
    if (确认.disabled) return;
    确认.disabled = true;
    // 投递四段状态机（顶栏角色）：未连 → 「连接 WS 中」；已连（已发请求）→ 「等待服务器回应」
    var 连 = false;
    try { 连 = (global.接口.连接状态 && global.接口.连接状态().状态) === '已连'; } catch (e) { }
    $('角色').textContent = 连 ? '等待服务器回应' : '连接 WS 中';
    提示('正在发布…');
    var 执行者 = { 端: 选端.端名 || '', 对话: 选对话.对话名 || '', 终身号: 选对话.终身号 || '' };
    global.接口.发布(内容, '人', 执行者, '').then(function (r) {
      // 服务端是【异步投递】：应答只带回编号与「发送中」，没有 `投递` 字段——
      // 故此处只报「已发布 + 编号（等待服务器回应）」；随后「服务器已接收 → 投递成功 /
      // 发送失败」由【广播帧】与卡片状态胶囊自动跟上（接口.js 收「投递受理/投递结果」）。
      var 卡 = (r && r.任务) || {};
      提示('已发布，编号 ' + (卡.编号 || '') + '（等待服务器回应）');
      关发布();
      载角色();                                 // 顶栏角色复位
      setTimeout(function () { 载任务(true); }, 1500);
      return 载任务(true);
    }).catch(function (e) {
      提示('发布失败：' + e.message);
      载角色();
    }).then(function () {
      确认.disabled = false;
    });
  }

  // ---------------- 口令（§19 首登填、本地缓存；频道 = 前缀 + 口令，运行时拼） ----------------
  function 开口令(首登) {
    var 弹 = $('口令弹窗');
    if (!弹) return;
    var 输 = $('口令_输入');
    if (输) {
      if (首登) {
        输.value = '';
      } else {
        try { 输.value = global.接口.读取口令 ? (global.接口.读取口令() || '') : ''; } catch (e) { }
      }
    }
    弹.classList.remove('隐藏');
    if (输) { try { 输.focus(); } catch (e) { } }
  }

  function 关口令() {
    var 弹 = $('口令弹窗');
    if (弹) 弹.classList.add('隐藏');
  }

  function 确认口令() {
    var 输 = $('口令_输入');
    var v = 输 ? String(输.value || '').trim() : '';
    if (!v) { 提示('请输入口令'); return; }
    关口令();
    try { global.接口.设置口令(v); } catch (e) { }   // 存本地缓存 + 按新频道重连
    首载();
  }

  // 口令就绪后（或已有缓存口令时）载入首屏数据
  function 首载() {
    载角色();
    载端(true);
    载任务(true);
  }

  // ---------------- 启动装配 ----------------
  function 装配() {
    $('按钮_发布任务').addEventListener('click', 开发布);
    $('按钮_刷新').addEventListener('click', 刷新端);
    $('发布_取消').addEventListener('click', 关发布);
    $('发布_确认').addEventListener('click', 提交发布);
    大类钮们().forEach(function (b) {
      b.addEventListener('click', function () { 选大类处理(b.getAttribute('data-类')); });
    });
    // §19 口令：首登窗 + 顶栏「口令」钮（随时重设）
    $('按钮_口令').addEventListener('click', function () { 开口令(false); });
    $('口令_取消').addEventListener('click', 关口令);
    $('口令_确定').addEventListener('click', 确认口令);
    var 输 = $('口令_输入');
    if (输) {
      输.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); 确认口令(); }
      });
    }

    var 需 = true;
    try { 需 = !!(global.接口.需要口令 && global.接口.需要口令()); } catch (e) { 需 = true; }
    if (需) {
      $('角色').textContent = '未连接';
      开口令(true);        // 未缓存口令 → 先要口令，填完再载数据（不写死频道）
    } else {
      首载();             // 已有缓存口令 → 直接连频道载数据
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', 装配);
  } else {
    装配();
  }

  global.面板 = { 版本: 版本, 载端: 载端, 载任务: 载任务, 提示: 提示, 拍平后代: 拍平后代, 排卡: 排卡, 时刻: 时刻 };
})(window);
