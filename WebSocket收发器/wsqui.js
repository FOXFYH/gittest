/* wsqui.js —— WebSocket 收发器客户端网页版可选界面（懒加载，仅 DOM/样式） */
(function () {
  'use strict';
  if (!window.WSQ) return;

  var 样式 = ''
    + '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}'
    + '.wsq{max-width:560px;margin:0 auto;background:#f7faf7;color:#1f2a22;font:14px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif}'
    + '.wsq header{position:sticky;top:0;z-index:9;background:#e3f1e6;border-bottom:1px solid #cfe3d4}'
    + '.wsq .h1{display:flex;align-items:center;gap:6px;padding:5px 10px 2px}'
    + '.wsq .ttl{font-size:15px;font-weight:700;color:#1b5e20}'
    + '.wsq .ver{font-size:10px;color:#4a6b50;border:1px solid #b9d6c0;border-radius:999px;padding:0 6px}'
    + '.wsq .sp{flex:1}'
    + '.wsq .h1 button{height:26px;padding:0 10px;border:1px solid #9cc3a5;background:#fff;color:#22532a;border-radius:6px;font-size:12px}'
    + '.wsq .h2{display:flex;align-items:center;gap:8px;padding:2px 10px 5px;font-size:12px;color:#3d5a44}'
    + '.wsq .dot{width:8px;height:8px;border-radius:50%;background:#999;display:inline-block}'
    + '.wsq .dot.on{background:#2e7d32}.wsq .dot.wait{background:#f9a825}.wsq .dot.off{background:#c62828}'
    + '.wsq .card{background:#fff;border:1px solid #dbe7dd;border-radius:8px;margin:8px 8px 0;padding:8px 10px}'
    + '.wsq .card h3{margin:0 0 6px;font-size:12px;color:#4a6b50;font-weight:600;display:flex;align-items:center}'
    + '.wsq .card h3 .r{margin-left:auto;font-weight:400;color:#8aa;font-size:11px}'
    + '.wsq .card h3 button{height:24px;padding:0 8px;border:1px solid #9cc3a5;background:#f3f9f4;color:#22532a;border-radius:5px;font-size:12px;margin-left:auto}'
    + '.wsq .kv{display:grid;grid-template-columns:74px 1fr;gap:2px 6px;font-size:12px}'
    + '.wsq .kv i{font-style:normal;color:#7d8f83}.wsq .kv b{font-weight:500;word-break:break-all}'
    + '.wsq .kv .wide{grid-column:2/3;word-break:break-all}'
    + '.wsq table{width:100%;border-collapse:collapse;font-size:12px}'
    + '.wsq th,.wsq td{padding:3px 4px;border-bottom:1px solid #edf2ee;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.wsq th{background:#eef6f0;color:#4a6b50;font-weight:600;position:sticky;top:0}'
    + '.wsq .tw{max-height:34vh;overflow:auto}'
    + '.wsq td.sum{white-space:normal;word-break:break-all;color:#556}'
    + '.wsq td.dir-f{color:#1565c0}.wsq td.dir-s{color:#2e7d32}'
    + '.wsq .badge{display:inline-block;font-size:10px;padding:0 5px;border-radius:999px;background:#e8f3ea;color:#2e7d32;border:1px solid #bcdcc3}'
    + '.wsq .set{display:none;padding:2px 8px}.wsq .set.show{display:block}.wsq #wsqHome.hide{display:none}'
    + '.wsq .grp{background:#fff;border:1px solid #dbe7dd;border-radius:8px;margin:8px 0 0;padding:8px 10px}'
    + '.wsq .grp h4{margin:0 0 6px;font-size:12px;color:#4a6b50}'
    + '.wsq .f{margin:0 0 7px}'
    + '.wsq .f label{display:block;font-size:11px;color:#7d8f83;margin-bottom:2px}'
    + '.wsq .f input,.wsq .f select,.wsq .f textarea{width:100%;border:1px solid #cfdcd3;border-radius:6px;background:#fbfdfb;color:#1f2a22;font:13px/1.4 inherit;padding:6px 8px}'
    + '.wsq .f textarea{height:150px;font:12px/1.45 Consolas,monospace}'
    + '.wsq .f input[readonly]{background:#f1f4f2;color:#7d8f83}'
    + '.wsq .two{display:flex;gap:8px}.wsq .two>*{flex:1}'
    + '.wsq .chk{display:flex;align-items:center;gap:6px;font-size:13px;margin:4px 0}'
    + '.wsq .chk input{width:16px;height:16px}'
    + '.wsq .btns{display:flex;gap:8px;margin:8px 0 4px}'
    + '.wsq button.act{height:38px;flex:1;border:0;border-radius:8px;background:#2e7d32;color:#fff;font-size:14px;font-weight:600}'
    + '.wsq button.act.gray{background:#e7efe9;color:#3d5a44;border:1px solid #cfdcd3}'
    + '.wsq .tip{font-size:11px;color:#8a9a8e;margin:4px 0 2px}'
    + '.wsq .logbox{height:30vh;overflow:auto;background:#fbfdfb;border:1px solid #e4ece6;border-radius:6px;padding:4px;font:11px/1.5 Consolas,monospace}'
    + '.wsq .logbox div{border-bottom:1px dashed #eef2ee;padding:1px 2px;word-break:break-all;white-space:pre-wrap}'
    + '.wsq .lg-sys{color:#7d8f83}.wsq .lg-err{color:#c62828}';

  var 模板 = ''
    + '<header>'
    + '  <div class="h1"><span class="ttl">客户端 · 收发器</span><span class="ver" id="wsqVer"></span><span class="sp"></span><button id="wsqBtnTpl">模板</button><button id="wsqBtnPage">设置</button></div>'
    + '  <div class="h2"><span class="dot" id="wsqDot"></span><span id="wsqState">未连接</span><span class="badge">客户端</span><span class="badge" id="wsqId"></span></div>'
    + '</header>'
    + '<div id="wsqHome">'
    + '  <div class="card"><h3>当前连接</h3><div class="kv">'
    + '    <i>服务器</i><b id="wsqSrv">-</b><i>目标服务器</i><b id="wsqTarget">-</b><i>业务集群</i><b id="wsqClus">-</b>'
    + '    <i>临时主</i><b id="wsqTemp">-</b><i>频道</i><b id="wsqChan" class="wide">-</b><i>下次心跳</i><b id="wsqHb">-</b><i>主动下线</i><b id="wsqOff">-</b>'
    + '  </div></div>'
    + '  <div class="card"><h3>自身集群在线</h3>'
    + '    <div class="tw" style="max-height:18vh"><table><thead><tr><th>序号</th><th>集群</th><th>类型</th><th>状态</th><th>在线时长</th><th>剩余</th><th>最近活动</th></tr></thead><tbody id="wsqTbCluster"></tbody></table></div></div>'
    + '  <div class="card"><h3>服务器在线<button id="wsqBtnWho">智能调查服务器在线</button></h3>'
    + '    <div class="tw" style="max-height:22vh"><table><thead><tr><th>序号</th><th>昵称</th><th>设备名</th><th>产品</th><th>在线集群</th><th>实例号</th></tr></thead><tbody id="wsqTbSrv"><tr><td colspan="6" style="color:#9aa">尚未发现服务器</td></tr></tbody></table></div>'
    + '    <div class="tip">点某一行＝选定目标服务器（下次启动自动连它）。</div></div>'
    + '  <div class="card"><h3>WS 收发流水 <span class="r">最新在第 1 行</span></h3>'
    + '    <div class="tw" style="max-height:30vh"><table><thead><tr><th>#</th><th>时间</th><th>方向</th><th>集群</th><th>昵称</th><th>实例号</th><th>类型</th><th>大小(KB)</th><th>字数</th><th>摘要</th></tr></thead><tbody id="wsqTbFlow"></tbody></table></div></div>'
    + '  <div class="card"><h3>系统日志 <button id="wsqBtnClearLog">清空</button></h3><div class="logbox" id="wsqSysLog"></div></div>'
    + '</div>'
    + '<div class="set" id="wsqTpl">'
    + '  <div class="grp"><h4>模板（诊断用；通道固定当前业务集群）</h4>'
    + '    <div class="f"><label>模板</label><select id="wsqTplSel"></select></div>'
    + '    <div class="f"><label>接收者</label><select id="wsqTplTo"></select></div>'
    + '    <div id="wsqTplFields"></div>'
    + '  </div>'
    + '  <div class="btns"><button class="act" id="wsqTplSend">发送</button></div>'
    + '  <div class="tip" id="wsqTplTip">缺必填会直接拒发；所有帧都走正式模板。</div>'
    + '</div>'
    + '<div class="set" id="wsqSet">'
    + '  <div class="grp"><h4>本机身份</h4>'
    + '    <div class="f"><label>昵称（空＝设备名）</label><input id="wsqNic" autocomplete="off"></div>'
    + '    <div class="two"><div class="f"><label>产品名称</label><input id="wsqProd" autocomplete="off"></div><div class="f"><label>设备名称</label><input id="wsqDev" autocomplete="off"></div></div>'
    + '    <div class="f"><label>实例号（10 位，浏览器本机固定）</label><input id="wsqId2" readonly></div></div>'
    + '  <div class="grp"><h4>连接</h4>'
    + '    <div class="f"><label>频道口令（前缀 WSRELAY 内置）</label><input id="wsqPass" autocomplete="off"></div>'
    + '    <div class="two"><div class="f"><label>业务集群（切换＝临时主）</label><select id="wsqBiz"></select></div><div class="f"><label>紧急集群</label><select id="wsqEmg"></select></div></div>'
    + '    <div class="chk"><input type="checkbox" id="wsqAuto"><label for="wsqAuto">打开页面自动连接</label></div>'
    + '    <div class="tip">主集群写死 WS1；切到别的集群算临时主，到点自动回 WS1。</div></div>'
    + '  <div class="grp"><h4>心跳与下线</h4>'
    + '    <div class="two"><div class="f"><label>键鼠活跃心跳(秒)</label><input id="wsqHbin" inputmode="numeric"></div><div class="f"><label>静止秒（服务器下发，只读）</label><input id="wsqStill" readonly></div></div>'
    + '    <div class="chk"><input type="checkbox" id="wsqSmart"><label for="wsqSmart">智能发送键鼠活跃（任一 WS 发出即重置；握手后才起算）</label></div></div>'
    + '  <div class="grp"><h4>服务端策略（只读，握手同步）</h4>'
    + '    <div class="chk"><input type="checkbox" id="wsqSmartSurvey" disabled><label for="wsqSmartSurvey">智能调查服务器在线（临时全开各集群再询问）</label></div>'
    + '    <div class="two"><div class="f"><label>临时主回归(分钟)</label><input id="wsqTempMin" readonly></div><div class="f"><label>临时喊话(秒)</label><input id="wsqShoutSec" readonly></div></div></div>'
    + '  <div class="grp"><h4>集群表（JSON：名称 → cluster / key）</h4>'
    + '    <div class="f"><textarea id="wsqClusters" spellcheck="false"></textarea></div>'
    + '    <div class="tip">服务端下发集群信息时会自动覆盖这里的表；密钥只存本机浏览器，不进网页源码。</div></div>'
    + '  <div class="btns"><button class="act" id="wsqBtnSave">保存设置</button><button class="act gray" id="wsqBtnReset">清缓存</button></div>'
    + '  <div class="tip" id="wsqSetTip"></div>'
    + '</div>';

  function 注入样式() {
    if (document.getElementById('wsqStyle')) return;
    var st = document.createElement('style'); st.id = 'wsqStyle'; st.textContent = 样式;
    (document.head || document.documentElement).appendChild(st);
  }
  function 时长(秒) {
    秒 = Math.max(0, Math.round(秒 || 0));
    if (秒 < 60) return 秒 + ' 秒';
    var 分 = Math.floor(秒 / 60), 剩 = 秒 % 60;
    if (分 < 60) return 分 + ' 分' + (剩 ? ' ' + 剩 + ' 秒' : '');
    var 时 = Math.floor(分 / 60);
    return 时 + ' 时' + (分 % 60 ? ' ' + (分 % 60) + ' 分' : '');
  }

  WSQ._注册UI(function (容器, 核心) {
    注入样式();
    容器.classList.add('wsq');
    容器.innerHTML = 模板;
    var $ = function (id) { return document.getElementById(id); };
    var 当前页 = '主页';

    $('wsqVer').textContent = '网页版 v' + 核心.版本;
    $('wsqSetTip').textContent = '内核版本 v' + 核心.版本 + '（界面可单独懒加载）';

    function 画配置() {
      var c = 核心.读配置(), 名 = Object.keys(核心.集群表()), opt = '', i;
      for (i = 0; i < 名.length; i++) opt += '<option value="' + 名[i] + '">' + 名[i] + '</option>';
      $('wsqNic').value = c.nic; $('wsqProd').value = c.prod; $('wsqDev').value = c.dev;
      $('wsqId2').value = c.id; $('wsqPass').value = c.pass; $('wsqHbin').value = c.hb;
      $('wsqSmart').checked = !!c.smart; $('wsqAuto').checked = !!c.auto;
      $('wsqBiz').innerHTML = opt; $('wsqBiz').value = c.biz;
      $('wsqEmg').innerHTML = opt; $('wsqEmg').value = c.emg;
      $('wsqClusters').value = JSON.stringify(核心.集群表(), null, 1);
      $('wsqStill').value = 核心.状态().静止秒;
      $('wsqSmartSurvey').checked = !!c.智调;
      $('wsqTempMin').value = c.临主分;
      $('wsqShoutSec').value = c.喊话秒;
    }

    function 画状态(s) {
      $('wsqState').textContent = s.状态;
      $('wsqDot').className = 'dot ' + (s.状态 === '已连接' ? 'on' : (s.状态 === '未连接' || s.状态 === '已下线' ? 'off' : 'wait'));
      $('wsqSrv').textContent = (s.服务端.昵称 || '-') + (s.服务端.号 ? ' · ' + s.服务端.号 : '');
      var 目标 = s.目标号 || '', 服 = null;
      for (var i = 0; i < (s.服务器 || []).length; i++) if (s.服务器[i].号 === 目标) 服 = s.服务器[i];
      $('wsqTarget').textContent = 目标 ? ((服 ? 服.昵称 : '?') + ' · ' + 目标) : '（不限制）';
      $('wsqClus').textContent = s.业务集群;
      $('wsqTemp').textContent = s.临时主 ? (s.临时主 + '（剩 ' + 时长(s.临时主剩余秒) + '，到点回 WS1）') : '-';
      $('wsqChan').textContent = s.频道;
      $('wsqId').textContent = 核心.读配置().id;
      $('wsqHb').textContent = s.下次心跳秒 + ' 秒（' + (s.心跳满足 ? '满足' : '不满足') + '）';
      $('wsqOff').textContent = !s.允许主动下线 ? '已关闭' : (s.休眠 ? '已下线（动一下即上线）' : Math.max(0, Math.round(s.静止秒 - s.空闲秒)) + ' 秒');
    }

    function 画集群(列表) {
      var h = '', i, v;
      for (i = 0; i < 列表.length; i++) {
        v = 列表[i] || {};
        h += '<tr><td>' + (i + 1) + '</td><td>' + (v.集群 || '-') + '</td><td>' + (v.类型 || '-') + '</td><td>' + (v.状态 || '-') + '</td><td>' + 时长(v.在线秒) + '</td><td>' + ((v.剩余秒 || 0) < 0 ? '-' : 时长(v.剩余秒)) + '</td><td>' + (v.最近 || '-') + '</td></tr>';
      }
      $('wsqTbCluster').innerHTML = h || '<tr><td colspan="7" style="color:#9aa">未连接</td></tr>';
    }
    function 画服务器(列表, 目标) {
      var h = '', i, v;
      for (i = 0; i < 列表.length; i++) {
        v = 列表[i] || {};
        var 集 = (v.在线集群 && v.在线集群.length) ? v.在线集群.join('、') : '-';
        h += '<tr data-id="' + (v.号 || '') + '" style="cursor:pointer' + (v.号 === 目标 ? ';background:#e8f3ea' : '') + '"><td>' + (i + 1) + '</td><td>' + (v.昵称 || '-') + '</td><td>' + (v.设备名 || '-') + '</td><td>' + (v.产品 || '-') + '</td><td>' + 集 + '</td><td>' + (v.号 || '-') + '</td></tr>';
      }
      var tb = $('wsqTbSrv');
      tb.innerHTML = h || '<tr><td colspan="6" style="color:#9aa">尚未发现服务器</td></tr>';
      Array.prototype.forEach.call(tb.querySelectorAll('tr[data-id]'), function (tr) {
        tr.onclick = function () { 核心.选服务器(tr.getAttribute('data-id')); 画状态(核心.状态()); };
      });
    }

    function 画流水(行) {
      var tb = $('wsqTbFlow'), tr = document.createElement('tr');
      tr.innerHTML = '<td>' + 行.i + '</td><td>' + 行.time + '</td><td class="' + (行.dir === '发' ? 'dir-f' : 'dir-s') + '">' + 行.dir + '</td><td>' + 行.acc + '</td><td>' + 行.nic + '</td><td>' + 行.id + '</td><td>' + 行.t + '</td><td>' + (行.kb || '0.00') + '</td><td>' + (行.字 || 0) + '</td><td class="sum">' + 行.sum + '</td>';
      tb.insertBefore(tr, tb.firstChild);
      while (tb.children.length > 200) tb.removeChild(tb.lastChild);
    }
    function 画流水全部() {
      $('wsqTbFlow').innerHTML = '';
      var 列 = 核心.流水();
      for (var i = 0; i < 列.length; i++) 画流水(列[i]);
    }
    function 日志(级别, 文本, 时间) {
      var box = $('wsqSysLog'), d = document.createElement('div');
      d.className = 'lg-' + 级别;
      d.textContent = '[' + (时间 || new Date().toTimeString().slice(0, 8)) + '] ' + 文本;
      box.appendChild(d);
      while (box.children.length > 300) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }

    核心.监听(function (ev) {
      if (ev.类型 === '状态') 画状态(ev.状态);
      else if (ev.类型 === '流水') 画流水(ev.行);
      else if (ev.类型 === '日志') 日志(ev.级别, ev.文本, ev.时间);
      else if (ev.类型 === '集群') 画集群(ev.列表);
      else if (ev.类型 === '服务器') 画服务器(ev.列表, ev.目标);
      else if (ev.类型 === '集群表' || ev.类型 === '配置') { if (当前页 === '设置') 画配置(); }
      else if (ev.类型 === '握手') 画状态(核心.状态());
    });
    setInterval(function () { 画集群(核心.集群在线()); }, 1000);

    function 切页(页名) {
      当前页 = (当前页 === 页名) ? '主页' : 页名;
      $('wsqHome').classList.toggle('hide', 当前页 !== '主页');
      $('wsqTpl').classList.toggle('show', 当前页 === '模板');
      $('wsqSet').classList.toggle('show', 当前页 === '设置');
      if (当前页 === '设置') 画配置();
      if (当前页 === '模板') 画模板();
    }
    $('wsqBtnPage').onclick = function () { 切页('设置'); };
    $('wsqBtnTpl').onclick = function () { 切页('模板'); };
    $('wsqBtnWho').onclick = function () { 核心.智能调查(); };

    function 画模板() {
      var 名们 = Object.keys(核心.客户端模板);
      if (!$('wsqTplSel').options.length) {
        名们.forEach(function (n) {
          var o = document.createElement('option'); o.value = n; o.textContent = n; $('wsqTplSel').appendChild(o);
        });
      }
      var 服 = 核心.服务器(), 头 = '<option value="">群发（不指定）</option>', i;
      for (i = 0; i < 服.length; i++) 头 += '<option value="' + 服[i].号 + '">' + (服[i].昵称 || '-') + '（' + 服[i].号 + '）</option>';
      $('wsqTplTo').innerHTML = 头;
      画模板字段();
    }
    function 画模板字段() {
      var 名 = $('wsqTplSel').value, 模 = 核心.客户端模板[名] || {}, h = '', i, k;
      for (i = 0; i < (模.专用 || []).length; i++) {
        k = 模.专用[i];
        h += '<div class="f"><label>' + k + (((模.必填 || []).indexOf(k) >= 0) ? ' *' : '') + '</label><input data-k="' + k + '" autocomplete="off"></div>';
      }
      $('wsqTplFields').innerHTML = h;
      $('wsqTplTip').textContent = '模板「' + 名 + '」：' + (模.专用 && 模.专用.length ? '填写专用字段后发送。' : '无专用字段，直接发送。');
    }
    $('wsqTplSel').onchange = 画模板字段;
    $('wsqTplSend').onclick = function () {
      var 名 = $('wsqTplSel').value, 值 = {};
      Array.prototype.forEach.call($('wsqTplFields').querySelectorAll('input[data-k]'), function (el) {
        值[el.getAttribute('data-k')] = el.value;
      });
      var 号 = $('wsqTplTo').value, 目标 = null;
      if (号) {
        var 服 = 核心.服务器();
        for (var i = 0; i < 服.length; i++) if (服[i].号 === 号) 目标 = 服[i];
      }
      var ok = 核心.发模板(名, 值, { 目标: 目标 });
      $('wsqTplTip').textContent = ok ? ('已发送「' + 名 + '」' + (目标 ? ' → ' + 目标.昵称 : '（群发）')) : ('未发送：检查必填或连接状态');
    };
    $('wsqBtnClearLog').onclick = function () { $('wsqSysLog').innerHTML = ''; };
    $('wsqBtnSave').onclick = function () {
      var 表;
      try { 表 = JSON.parse($('wsqClusters').value); } catch (e) { $('wsqSetTip').textContent = '集群表不是合法 JSON：' + e.message; return; }
      if (!表 || !Object.keys(表).length) { $('wsqSetTip').textContent = '集群表不能为空'; return; }
      核心.设置集群表(表);
      var 动了 = 核心.改配置({
        nic: $('wsqNic').value.trim(), prod: $('wsqProd').value.trim() || 'WS客户端网页',
        dev: $('wsqDev').value.trim() || '浏览器', pass: $('wsqPass').value.trim(),
        biz: $('wsqBiz').value, emg: $('wsqEmg').value,
        hb: Number($('wsqHbin').value || 60), smart: $('wsqSmart').checked, auto: $('wsqAuto').checked
      });
      $('wsqSetTip').textContent = 动了 ? '已保存；集群切换请求已发出，等服务器点名回应后才正式提交（约 1 秒）' : '已保存（已生效）';
      画配置();
    };
    $('wsqBtnReset').onclick = function () {
      if (!confirm('清空本机缓存（含实例号、昵称、集群表）？')) return;
      核心.清缓存(); location.reload();
    };

    画配置(); 画状态(核心.状态()); 画流水全部(); 画集群(核心.集群在线()); 画服务器(核心.服务器(), 核心.目标号()); 画模板();
    日志('sys', '界面就绪（内核 v' + 核心.版本 + '）');
  });
})();
