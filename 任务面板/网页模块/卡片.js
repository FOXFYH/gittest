/* ============================================================
 * 【任务面板】网页模块 · 卡片.js
 * 版本：0.03
 * 职责：任务卡 / 回复卡的渲染与交互（《软件架构设计》§5 卡片视觉与交互规范）。
 *   · 主卡：顶部文本框展示任务内容；底部小按钮【任务回复】【任务详情】【任务状态】。
 *   · 点【任务回复】→ 整卡变高，下方展开互动树（懒加载 /api/tree）；互动树里的后代卡片
 *     【拍平成同层平铺一列】——递归展开所有层级，但视觉上不再嵌套/缩进。
 *   · 底纹：人类发言=蓝、AI 普通=绿、AI 提问(AI黄)=黄。
 *   · 每张回复卡【回复】按钮 → 在其下方新增「我来写」输入卡（蓝底）并可提交。
 *   · 每张卡只显示「编号 + 状态胶囊」（回复卡与主卡同等待遇；不再显示「回复 X」）。
 *   · 每张回复卡【详情】按钮 → 直接调出「它所回复的那张卡」的内容（调 /api/card，免按标题翻）。
 *   · 卡头状态钮＝卡片状态胶囊：投递各阶段在这里显示
 *     （等待服务器接受 → 服务器已开始执行 → 投递成功 / 发送失败）。
 * 说明：纯 DOM，不引外部 CDN。依赖：接口.js（须先加载）；「拍平后代」由 面板.js 提供。
 * 维护记录：
 *   · 0.01（2026-10-18）首版。
 *   · 0.02（2026-10-18）按用户口径收口：①卡头只留「编号（＋回复对象）」+ 状态胶囊，
 *     去掉与正文重复的「标题」行（不再分标题/正文，正文只一个框）；②状态胶囊改为显示
 *     投递阶段名：发送中→「服务器已开始执行」、已送达→「投递成功」（发送失败＝重试）。
 *   · 0.03（2026-10-18）按用户口径改【平铺】：①删掉回复卡的「回复 X」标题（不再强调
 *     回复的是哪张卡）；②互动树里的后代卡片递归拍平成【同层平铺一列】——去掉「子卡组」
 *     缩进/嵌套容器，全部作为同一层依次排列，每张仍带自己的状态胶囊。
 * ============================================================ */
(function (global) {
  'use strict';

  var 版本 = '0.03';

  var 角色底纹 = { '人蓝': '底蓝', 'AI绿': '底绿', 'AI黄': '底黄' };
  var 卡片状态类 = {
    '发送中': '态中', '已送达': '态好', '发送失败': '态失败',
    '已读': '态好', '未读': '态中', '已结束': '态终'
  };
  // 卡片状态 → 胶囊显示名（投递阶段口径；用户口径：用胶囊显示这些状态变化）
  var 状态显示名 = {
    '发送中': '服务器已开始执行',   // 服务器已接单、正在投递
    '已送达': '投递成功',           // 已成功插入目标会话输入框
    '发送失败': '发送失败'
  };
  var 任务状态名 = {
    1: '发布中', 2: 'AI执行中', 3: 'AI已回复', 4: 'AI提问', 5: 'AI判定已完成', 6: '任务结束'
  };

  // ---------- 基础小工具 ----------
  function 元素(标签, 类名, 文本) {
    var e = document.createElement(标签);
    if (类名) e.className = 类名;
    if (文本 !== undefined && 文本 !== null) e.textContent = String(文本);
    if (标签 === 'button') e.type = 'button';
    return e;
  }
  function 钮(文本, 类名, 处理) {
    var b = 元素('button', 类名, 文本);
    if (处理) b.addEventListener('click', 处理);
    return b;
  }
  function 空样(文本) { return 元素('div', '空样', 文本); }
  function 复制(源, 覆盖) {
    var o = {};
    for (var k in 源) { if (Object.prototype.hasOwnProperty.call(源, k)) o[k] = 源[k]; }
    for (var j in 覆盖) { if (Object.prototype.hasOwnProperty.call(覆盖, j)) o[j] = 覆盖[j]; }
    return o;
  }
  function 提示(选项, 文案) { if (选项 && 选项.提示) 选项.提示(文案); }
  function 刷新(选项) { if (选项 && 选项.刷新) 选项.刷新(); }
  function 有接口() { return !!(global.接口 && global.接口.版本); }

  // 文本框自适应高度（内容全部可见）
  function 自适应(根) {
    var 域 = (根 || document).querySelectorAll('textarea.内容');
    域.forEach(function (t) {
      t.style.height = 'auto';
      var 高 = t.scrollHeight + 2;
      t.style.height = Math.max(60, 高) + 'px';
    });
  }

  // ---------- 卡头状态钮 ----------
  function 建状态钮(节点, 选项) {
    var 态 = 节点.卡片状态 || '';
    if (态 === '发送失败') {
      return 钮('发送失败 · 重试', '状态钮 态失败', function () {
        if (!有接口()) { 提示(选项, '接口未就绪'); return; }
        global.接口.重投(节点.编号).then(function () {
          提示(选项, '已重投，请留意状态变化');
          刷新(选项);
        }).catch(function (e) { 提示(选项, '重投失败：' + e.message); });
      });
    }
    var 钮态 = 元素('button', '状态钮 ' + (卡片状态类[态] || ''), 状态显示名[态] || 态 || '—');
    钮态.title = '卡片状态（投递阶段）';
    钮态.addEventListener('click', function () {
      提示(选项, '卡片状态：' + (状态显示名[态] || 态 || '未知'));
    });
    return 钮态;
  }

  // ---------- 弹层（复用 HTML 的 .遮罩/.弹窗 样式）----------
  function 弹层(标题, 内容节点) {
    var 遮 = 元素('div', '遮罩');
    var 框 = 元素('div', '弹窗');
    框.appendChild(元素('h3', null, 标题));
    框.appendChild(内容节点);
    var 底 = 元素('div', '弹窗底');
    底.appendChild(钮('关闭', '次钮', function () { 遮.remove(); }));
    框.appendChild(底);
    遮.appendChild(框);
    遮.addEventListener('click', function (ev) { if (ev.target === 遮) 遮.remove(); });
    document.body.appendChild(遮);
    return 遮;
  }
  function 信息行(名, 值) {
    var 行 = 元素('div', '原卡');
    var 头 = 元素('div', '原头', 名);
    行.appendChild(头);
    行.appendChild(元素('div', null, (值 === undefined || 值 === null || 值 === '') ? '—' : String(值)));
    return 行;
  }

  // ---------- 任务详情（主卡）----------
  function 弹任务详情(节点, 选项) {
    var 盒 = 元素('div');
    盒.appendChild(信息行('任务编号', 节点.编号));
    盒.appendChild(信息行('标题', 节点.标题));
    盒.appendChild(信息行('发布者', 节点.发布者 || 节点.作者));
    var 执 = 节点.执行者 || {};
    盒.appendChild(信息行('执行者 · 端', 执.端));
    盒.appendChild(信息行('执行者 · 对话', 执.对话));
    盒.appendChild(信息行('执行者 · 终身号', 执.终身号));
    盒.appendChild(信息行('发布时间', 节点.发布时间 || 节点.时间));
    盒.appendChild(信息行('任务状态', 任务状态名[节点.状态] || 节点.状态));
    盒.appendChild(信息行('卡片状态', 节点.卡片状态));
    盒.appendChild(信息行('相关情况', 节点.相关情况));
    盒.appendChild(信息行('回复数', (节点.回复 || []).length));
    弹层('任务详情 · ' + (节点.编号 || ''), 盒);
  }

  // ---------- 回复对象详情（回复卡的「详情」）----------
  function 弹回复对象(节点, 选项) {
    var 号 = 节点.回复对象 || '';
    if (!号) { 弹任务详情(节点, 选项); return; }
    if (!有接口()) { 提示(选项, '接口未就绪'); return; }
    var 盒 = 元素('div');
    盒.appendChild(空样('加载中…'));
    弹层('详情 · ' + 号, 盒);
    global.接口.取卡(号).then(function (r) {
      var 卡 = (r && r.卡) || {};
      盒.innerHTML = '';
      盒.appendChild(信息行('被回复卡编号', 卡.编号 || 号));
      盒.appendChild(信息行('标题', 卡.标题));
      盒.appendChild(信息行('作者', 卡.作者 || 卡.发布者));
      盒.appendChild(信息行('角色', 卡.角色));
      盒.appendChild(信息行('时间', 卡.时间 || 卡.发布时间));
      盒.appendChild(信息行('正文', 卡.正文));
    }).catch(function (e) {
      盒.innerHTML = '';
      盒.appendChild(空样('加载失败：' + e.message));
    });
  }

  // ---------- 任务状态切换（主卡）----------
  function 弹任务状态(节点, 选项) {
    var 盒 = 元素('div');
    var 当前 = int(节点.状态);
    [1, 2, 3, 4, 5, 6].forEach(function (n) {
      var 选中 = (n === 当前);
      var b = 钮((n === 6 ? '★ ' : '') + n + ' ' + 任务状态名[n], '选行' + (选中 ? ' 选中' : ''), function () {
        if (!有接口()) { 提示(选项, '接口未就绪'); return; }
        global.接口.改任务状态(节点.编号, n, '人').then(function () {
          提示(选项, '任务状态已置：' + 任务状态名[n]);
          遮.remove();
          刷新(选项);
        }).catch(function (e) { 提示(选项, '置状态失败：' + e.message); });
      });
      盒.appendChild(b);
    });
    if (当前 === 6) 盒.appendChild(空样('提示：任务已结束(6)，AI 不再跟进；人仍可回帖。'));
    else 盒.appendChild(空样('提示：状态 6（任务结束）只能由人置；置 6 后 AI 不再跟进。'));
    var 遮 = 弹层('任务状态 · ' + (节点.编号 || ''), 盒);
  }
  function int(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  // ---------- 后代卡片渲染：拍平成同层平铺一列 ----------
  // 递归展开所有层级、视觉不再嵌套：把 接口.任务树() 的嵌套树先拍平成【扁平列表】
  // （按时间/编号顺序），再逐张平铺渲染。拍平由 面板.js 提供（面板.js 已在载入后可用）。
  function 拍平后代(节点) {
    if (global.面板 && typeof global.面板.拍平后代 === 'function') return global.面板.拍平后代(节点);
    return [];
  }
  function 填子组(容器, 父节点, 选项) {
    容器.innerHTML = '';
    var 平 = 拍平后代(父节点);
    if (!平.length) { 容器.appendChild(空样('（暂无回复）')); return; }
    平.forEach(function (c) {
      容器.appendChild(渲染卡(c, 复制(选项, { 主卡: false })));
    });
  }

  // ---------- 展开 / 收起互动树（懒加载）----------
  function 切换互动树(卡, 节点, 选项) {
    var 树区 = 卡.querySelector('.互动树');
    if (!树区) return;
    if (树区.classList.contains('隐藏')) {
      var 平区 = 树区.querySelector('.平铺列');
      if (!树区.dataset.已载) {
        树区.dataset.已载 = '1';
        if (节点.子卡 !== undefined) {
          填子组(平区, 节点, 选项);
        } else if (有接口()) {
          平区.innerHTML = '';
          平区.appendChild(空样('加载中…'));
          global.接口.任务树(节点.编号).then(function (r) {
            填子组(平区, (r && r.树) || {}, 选项);
            自适应(卡);
          }).catch(function (e) {
            平区.innerHTML = '';
            平区.appendChild(空样('加载失败：' + e.message));
            自适应(卡);
          });
        }
      }
      树区.classList.remove('隐藏');
    } else {
      树区.classList.add('隐藏');
    }
    自适应(卡);
  }

  // ---------- 「我来写」输入卡（蓝底）----------
  function 开我来写(卡, 节点, 选项) {
    var 已有 = 卡.querySelector('.我来写');
    if (已有) { 已有.classList.toggle('隐藏'); 自适应(卡); return; }
    var 树区 = 卡.querySelector('.互动树');
    树区.classList.remove('隐藏');

    var w = 元素('div', '我来写 卡 底蓝');
    var 头 = 元素('div', '卡头');
    头.appendChild(元素('span', '标题', '我来写 · 回复 ' + (节点.编号 || '')));
    w.appendChild(头);
    var 输入 = 元素('textarea');
    输入.placeholder = '写下你的回复…';
    w.appendChild(输入);
    var 排 = 元素('div', '按钮排');
    var 提交 = 钮('提交', '小钮', null);
    var 取消 = 钮('取消', '小钮', function () { w.classList.add('隐藏'); 自适应(卡); });
    排.appendChild(提交);
    排.appendChild(取消);
    w.appendChild(排);
    树区.appendChild(w);

    提交.addEventListener('click', function () {
      var 正文 = (输入.value || '').trim();
      if (!正文) { 提示(选项, '请先写点内容'); 输入.focus(); return; }
      if (!有接口()) { 提示(选项, '接口未就绪'); return; }
      提交.disabled = true;
      global.接口.回帖(节点.编号, '人', '人蓝', 正文).then(function () {
        提示(选项, '已提交');
        刷新(选项);
      }).catch(function (e) {
        提示(选项, '提交失败：' + e.message);
        提交.disabled = false;
      });
    });
    自适应(卡);
    输入.focus();
  }

  // ---------- 渲染一张卡 ----------
  function 渲染卡(节点, 选项) {
    选项 = 选项 || {};
    节点 = 节点 || {};
    var 主卡 = !!选项.主卡;
    var 角色 = 节点.角色 || (主卡 ? '人蓝' : 'AI绿');
    var 底纹 = 角色底纹[角色] || '';

    var 卡 = 元素('div', '卡 ' + (主卡 ? '主卡 ' : '回复卡 ') + 底纹);
    卡.dataset.编号 = 节点.编号 || '';

    // 卡头：编号 ＋ 状态胶囊（回复卡与主卡同等待遇，一律平铺并列、不再显示「回复 X」）。
    var 头 = 元素('div', '卡头');
    头.appendChild(元素('span', '编号', 节点.编号 || ''));
    头.appendChild(建状态钮(节点, 选项));
    卡.appendChild(头);

    // 顶部文本框：展示该卡内容
    var 内容 = 元素('textarea', '内容');
    内容.readOnly = true;
    内容.value = 节点.正文 || '';
    卡.appendChild(内容);

    // 底部小按钮排
    var 排 = 元素('div', '按钮排');
    if (主卡) {
      排.appendChild(钮('任务回复', '小钮', function () { 切换互动树(卡, 节点, 选项); }));
      排.appendChild(钮('任务详情', '小钮', function () { 弹任务详情(节点, 选项); }));
      排.appendChild(钮('任务状态', '小钮', function () { 弹任务状态(节点, 选项); }));
    } else {
      排.appendChild(钮('回复', '小钮', function () { 开我来写(卡, 节点, 选项); }));
      排.appendChild(钮('详情', '小钮', function () { 弹回复对象(节点, 选项); }));
    }
    卡.appendChild(排);

    // 互动树（默认收起）：主卡的后代卡片【拍平成同层平铺一列】（不再嵌套/缩进）；
    // 回复卡只在互动树里放「我来写」容器，其自身不再下钻（全部后代已平铺在主卡的平铺列里）。
    var 树区 = 元素('div', '互动树 隐藏');
    var 平区 = 元素('div', '平铺列');
    树区.appendChild(平区);
    if (主卡) {
      if (节点.子卡 !== undefined) {
        树区.dataset.已载 = '1';
        填子组(平区, 节点, 选项);          // 节点已带后代 → 直接拍平（懒加载已在内存时免再请求）
      } else {
        平区.appendChild(空样('（点「任务回复」展开）'));
      }
    }
    卡.appendChild(树区);

    return 卡;
  }

  global.卡片 = {
    版本: 版本,
    渲染卡: 渲染卡,
    自适应: 自适应,
    任务状态名: 任务状态名
  };
})(window);
