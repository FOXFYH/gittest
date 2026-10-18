/* ============================================================
 * 【任务面板】网页模块 · 面板.js
 * 版本：0.05
 * 职责：页面装配（《软件架构设计》§6 手机网页版）。
 *   · 顶部【发布任务】→ 发布界面：填内容 / 选 AI 大类(WorkBuddy|Trae) / 列该类下所有端 /
 *     选中端→列出该端对话 / 指定对话→提交（接口层 接口.js 已改为 WS 请求）。
 *   · 端列表区：列全部端（含历史），【刷新】主动刷新，刷新后显示每个端是否在线（离线灰显）。
 *   · 任务区：贴吧风格列出任务卡，支持展开/收起（卡片交互由 卡片.js 负责）。
 *   · 省流：任务/端列表带「版本指纹」差额——无变化则不重绘（接口层回 {未变:true}）。
 * 说明：纯 DOM，不引外部 CDN。依赖：接口.js、卡片.js（须先加载）。
 * 维护记录：
 *   · 0.01（2026-10-18）首版（WS4 网页工位）。
 *   · 0.02（2026-10-18）WS4C：适配 WS 请求层——任务/端列表「版本指纹」差额、通道失败可再武装。
 *   · 0.03（2026-10-18）WS4C：修「假投递失败」提示——发布是【异步投递】，应答里没有 `投递` 字段；
 *     改为只显示「已发布，编号 #xxx（发送中）」，并稍后按需拉取一次，让最终「已送达/发送失败」
 *     由卡片状态自动跟上（不再出现「投递失败：未知」）。
 *   · 0.04（2026-10-18）§19：新增「口令」首登窗与顶栏「口令」钮（频道＝前缀+口令，运行时拼）。
 *   · 0.05（2026-10-18）排障提示：角色脚标在「频道已连但无服务器应答」时显式提示
 *     「已连频道 · 服务器未响应」（此前误显「未连接」，用户会以为是自己填错口令/连不上）。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.05';
  var 端缓存 = [];       // 全部端（含历史）
  var 端版本 = '';       // 端列表「版本指纹」（差额推送用；空=全量）
  var 任务版本 = '';     // 任务列表「版本指纹」（差额推送用；空=全量）
  var 选大类 = null;     // 'WorkBuddy' | 'Trae'
  var 选端 = null;       // 端 dict
  var 选对话 = null;     // 对话 dict
  var 提示定时 = null;

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
  function 载角色() {
    global.接口.ping().then(function (r) {
      $('角色').textContent = '已连接 · v' + (r.版本 || '');
    }).catch(function () {
      var 态 = '';
      try { 态 = (global.接口.连接状态 && global.接口.连接状态().状态) || ''; } catch (e) { }
      if (态 === '失败') $('角色').textContent = '通道失败';
      else if (态 === '已连') $('角色').textContent = '已连频道 · 服务器未响应';   // §19 排障：频道通了但没服务器应答
      else $('角色').textContent = '未连接';
    });
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

  function 画任务(列表) {
    var 框 = $('任务列表');
    框.innerHTML = '';
    if (!列表.length) {
      框.appendChild(空样('还没有任务，点右上角「发布任务」贴一张'));
      $('任务计数').textContent = '';
      return;
    }
    var 选项 = { 主卡: true, 刷新: function () { return 载任务(true); }, 提示: 提示 };
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

  function 关发布() { $('发布弹窗').classList.add('隐藏'); }

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

  function 选端处理(端, 行元素) {
    选端 = 端; 选对话 = null;
    Array.prototype.forEach.call($('发布_端').children, function (c) {
      c.classList && c.classList.remove('选中');
    });
    行元素.classList.add('选中');
    重置选择框($('发布_对话'), '加载对话中…');
    global.接口.端对话(端.端名).then(function (r) {
      var 对话s = (r && r.对话) || [];
      var 框 = $('发布_对话');
      框.innerHTML = '';
      if (!对话s.length) { 框.appendChild(空样('该端暂无对话')); return; }
      对话s.forEach(function (对话) {
        var 行 = document.createElement('div');
        行.className = '选行';
        行.appendChild(文(对话.对话名 || '（未命名对话）'));
        if (对话.SID) 行.appendChild(标('SID ' + 对话.SID));
        if (对话.终身号) 行.appendChild(标('终身号 ' + 对话.终身号));
        if (对话.终身号) {
          var t = document.createElement('textarea');
          t.className = '隐藏';
          t.value = 对话.终身号;
          行.appendChild(t);
        }
        行.addEventListener('click', function () { 选对话处理(对话, 行); });
        框.appendChild(行);
      });
    }).catch(function (e) {
      重置选择框($('发布_对话'), '加载失败：' + e.message);
    });
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
    提示('正在发布…');
    var 执行者 = { 端: 选端.端名 || '', 对话: 选对话.对话名 || '', 终身号: 选对话.终身号 || '' };
    global.接口.发布(内容, '人', 执行者, '').then(function (r) {
      // 服务端是【异步投递】：应答只带回编号与「发送中」，没有 `投递` 字段——
      // 故此处只报「已发布 + 编号（发送中）」；最终是「已送达」还是「发送失败」，
      // 由卡片状态按钮 / 刷新查看（约 1 秒后后台投递完成会自动改写卡片状态）。
      var 卡 = (r && r.任务) || {};
      提示('已发布，编号 ' + (卡.编号 || '') + '（发送中）');
      关发布();
      // 按需拉取（差额推送）：稍等一拍再拉一次，让「发送中 → 已送达/发送失败」自动跟上
      setTimeout(function () { 载任务(true); }, 1500);
      return 载任务(true);
    }).catch(function (e) {
      提示('发布失败：' + e.message);
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

  global.面板 = { 版本: 版本, 载端: 载端, 载任务: 载任务, 提示: 提示 };
})(window);
