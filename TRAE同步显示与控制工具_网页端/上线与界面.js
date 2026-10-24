'use strict';
function onHello(d){
  gotHello = true;                     // 1.01：应答到达即停握手重试
  diagLog('收到服务器 hello 回应 ✓', 'ok');
  /* 2.20 新架构：服务端版本号 → 双版本号缓存键，任一变化清本地缓存 */
  if (d.ver !== undefined){ S.srvVer = String(d.ver || '0'); checkVerBump(); }
  if (DIAG.testAt && !DIAG.testOk) DIAG.testOk = true;
  /* 1.27：登录账号名（hello 同步；服务端读积分时刷新） */
  if (d.acct !== undefined){ S.acct = String(d.acct || ''); renderAcct(); }
  /* 1.33：AI 文本刷新间隔（hello 同步服务端当前值） */
  if (d.poll !== undefined) {/* 1.35：poll 档位 UI 已移除，忽略 */}
  /* 1.13：目标正被其他客户端占用时提示（操控指令会被 deny） */
  if (d.lock && d.lock.mine === false && d.lock.id){
    flash('🔒 [' + (d.srv || '远方') + '] 正被 ' + d.lock.id
          + ' 占用（约 ' + (d.lock.left || 0) + ' 秒后释放）',
          'var(--red)');
    renderSrvList();          // 清单同步显示 🔒 标记
  }
  const boxes = (d.boxes || []).filter(Boolean);
  if (boxes.length && JSON.stringify(boxes) !== JSON.stringify(S.boxes)){
    S.boxes = boxes;
    el.box.innerHTML = '';
    for (const b of boxes){
      const o = document.createElement('option');
      o.value = b; o.textContent = b;
      el.box.appendChild(o);
    }
  }
  S.alive = new Set(d.alive || []);
  if (d.points && d.points !== '—'){
    S.points = d.points;
    el.points.textContent = '积分 ' + d.points;
  }
  if (!d.box || !d.port) return;
  const port = parseInt(d.port);
  if (d.box !== S.box){ applySwitch(d.box, port); }
  else if (port !== S.port){ S.port = port; }
  if (d.conn) onEv('connected', S.port);
}

function applySwitch(box, port){
  foxStop();                   /* 2.06：换服务端目标也停声（免打扰） */
  S.box = box; S.port = port;
  exitFmsg();                  /* 1.14：换目标先退出历史全屏 */
  S.snap = {}; S.convs_key = null; S.msgs_key = null;
  S.attach_pending = null; S.model_busy = false;
  /* 1.09：换目标——待确认项/切换在途条随旧目标作废 */
  S.pending = []; switchAbort();
  S.busy = false;      // 1.07：远程拉起/重启成功经 switched 到此——
                       // 原不重置，boot 一次 S.busy 永卡 true 锁死目标切换
  el.box.value = box;
  el.convs.innerHTML = '';
  el.msgs.innerHTML = '<div class="empty">（正在连接 ' + esc(box)
                     + ' …）</div>';
  renderAttach([]);
  el.model.value = '';
  renderVer(box);
}

function setOnLine(b){
  S.onLine = b;
  if (b){
    S.wsOpenAt = Date.now(); S.dropByHide = false;  // 1.57：连上即清断线标记
    /* 2.67 切换过程状态机：切在途却卡在「正在连接 WS」→ 连上即自动补发 */
    if (S.switch_pend && S.switch_pend.phase === 'connecting'){
      sendCmd('switch', switchRef());
      S.switch_pend.phase = 'waiting';
      S.switch_pend.ts = Date.now();
      switchReArm();
      renderAll();
    }
  }
  renderLink();
}

/* 1.07：顶栏状态灯 = 与服务端的连接状况（不再显示无意义的
   「自身是否在线」——客户端自己显然在运行）。判活依据：收到
   服务端任何来向消息（hello 应答 / 每 6s 一轮的 ports 广播 /
   快照…）即算活着。
   1.59：阈值从硬编码 16s 改成两级 SRV_IDLE_MS(20s) / SRV_DEAD_MS(60s)。
   16s 只够容忍丢 2 轮广播，手机切后台或中继抖一下就误报
   「服务器未启动」；现在 20~60s 只显示中性的「同步暂停中…」，
   满 60s 才提示服务器无响应。
   1.61：全部改白话——「WS坏了」→「连接已断开」（WS/中继这类词用户
   看不懂）；新增一档「连不上服务器」（连续 FAIL_ALERT 次压根没连上，
   指向网络/服务商问题）；状态文字可点，直接进诊断页看展开说明。*/
/* 1.61：顶栏每一档文案的白话解释（悬停/长按可见，点一下进诊断页） */
/* 1.64：状态改「动词·两维」——不再用「失联/已断开」这类静止判定词，
   全部显示"正在做的动作 + 重试第几次"；用户看到动作就明白在努力，
   也自动区分「频道没连上」vs「频道通了、等服务器回应」两件事。
   频道维度看 S.onLine + DIAG.reconn；服务器维度看 S.lastSrv。 */
const LINKDOC = {
  '链接频道…':        '正在连中转频道（第一次连，或刚点过重连）',
  '链接频道·重试 N':  '频道没连上/刚断——正在自动重试，通常几秒内恢复',
  '等待服务器回应':   '频道已连通，正在等服务端消息（20~60 秒没动静，多半手机后台被冻或中转抖一下，工作仍在做）',
  '等待服务器回应·超时': '频道已连通，但 1 分钟没收到服务端消息——多半服务端（电脑上的程序）没在跑，去电脑上看看',
  '已连接':           '频道通、服务端正常，可以发指令收消息'
};
function renderLink(){
  let txt, col, doc;
  if (!S.onLine){
    /* 1.65：频道没连上——不论首次/断线/连不上，一律"动词式"显示重试第几次。
       不再用「失联/已断开/连不上」这类静止判定词；N 复用 DIAG.reconn。 */
    const n = DIAG.reconn || 0;
    if (n > 0){ txt = '链接频道·重试' + n; col = 'var(--orange)'; }
    else if (DIAG.reconnActive){ txt = '链接频道·重试中…'; col = 'var(--gray)'; } // 1.66：本轮首断先显示重试中，不编号
    else { txt = '链接频道…'; col = 'var(--gray)'; }   // 首次，还没断过
    doc = '频道没连上，正在自动重试（第 ' + (n || 1) + ' 次）——通常几秒内恢复';
  } else {
    const gap = Date.now() - (S.lastSrv || S.wsOpenAt);
    if (S.lastSrv && gap < SRV_IDLE_MS){
      txt = '已连接'; col = 'var(--green)';
    } else if (gap < SRV_IDLE_MS){             // 频道通、刚连上，等服务端应答
      txt = '同步中…'; col = 'var(--gray)';
    } else if (gap < SRV_DEAD_MS){
      /* 频道已通，但 20~60 秒没听到服务端动静——后台被冻/中继抖，
         工作仍在做，中性提示不报故障 */
      txt = '等待服务器回应'; col = 'var(--gray)';
    } else {
      txt = '等待服务器回应·超时'; col = 'var(--orange)';   // 服务端可能没跑
    }
    doc = LINKDOC[txt];
  }
  el.rlink.textContent = txt;
  el.rlink.style.color = col;
  el.rlink.title = doc || LINKDOC[txt] || '';   // 1.61：白话解释
}
function srvSeen(){                    // 服务端来向消息：判活 + 即时刷新
  S.lastSrv = Date.now();
  if (DIAG.testAt && !DIAG.testOk) DIAG.testOk = true;   // 测服务器：收到即成功
  renderLink();
}
setInterval(renderLink, 3000);         // 静默→离线的过渡由定时器兜底

/* ================= 命令 ================= */

function cmd(c, a, convSid){
  /* 2.85：统一四态①——WS 不在线绝不假装已发，走公共拦口「正在连接 WS…」 */
  if (srvNeedOnline('命令')) return;
  /* 1.09：空窗期反馈——发送/插话本地立即回显「我」的占位气泡，
     清空输入框的瞬间屏幕上就有东西，不用等 3~6s 的中继往返 */
  /* v2.82（老板口径）：DID ＝ 本机时间 14 位 YYYYMMDDHHMMSS，**插入正文第一行**
     ——服务端扫快照每条消息首行 ^\d{14}$ 命中 ⇒ 该 DID 已进流；网页端凭
     ①快照首行抓到 ②did_pool 池子 销卡。**仅网页版发送才带**（AI 借输入框
     发的消息不带 DID、绝不出卡）。不再用 10 位随机 did / did_ack。 */
  let did = '';
  if ((c === 'send' || c === 'interject') && typeof a === 'string'
      && a.trim()){
    /* v2.84（老板实测 · Bug B）：插入新 DID 前先【剥净正文里已有的 14 位
       DID 首行】（含多层）——重发/重编/残留回填会带着旧 DID，不剥就
       「首行出现两个时间」。剥净后为空（只剩号码）则不发送、不建卡
       （对应 Bug C：绝不产生「只有号码的单行卡」）。 */
    a = stripHeadDid(a);
    if (!a.trim()){
      flash('⚠ 内容只剩旧号码、无正文 → 未发送', 'var(--orange)');
      refreshSendBtn();
      return;
    }
    did = didNow();
    a = did + '\n' + a;              /* 唯一首行 DID ＋ 原正文 */
    /* 占位卡挂 did（pendAdd 内部再按首行 DID 校验）；重发传了锁定 sid →
       新卡片也绑回原会话，与投递目标一致。 */
    const pp = pendAdd(c, a);
    if (pp){ pp.did = did;
      if (convSid) pp.convSid = convSid; }
    /* 记下「自己刚发过的文本」（含首行 DID）——服务端稍后回显 pend 时不再
       重复建卡（占位卡只由本端 cmd 建）。 */
    if (!S.sentGuard) S.sentGuard = {};
    S.sentGuard[a.trim()] = Date.now();
    /* 2.85：统一四态②——已发出、未收到服务端任何信号前只报「等待服务器回应…」，
       绝不说「已排队/已执行/已送达」（那些是服务端信号才有的终态）。 */
    if (c === 'send') srvOpFlash('sent', '发送');
  }
  sendCmd(c, a, did, convSid);
  /* 2.25：发消息/插话=真实人类操作 → actSend('send')（闸门见 通用工具.js） */
  if (c === 'send' || c === 'interject') actSend('send');
  if (c === 'send' || c === 'interject'){
    el.ent.value = '';
    renderAll();
  }
}

el.send.onclick = () => {        // 单按钮三态：插话 ⇄ 停止 ⇄ 发送
  if (S.inputBusy){              /* 2.46：后台借框占用中——挡住人类操作 */
    flash('⏳ ' + S.inputBusy + ' 正在借用输入框，请稍后', 'var(--orange)');
    return;
  }
  const t = el.ent.value.trim();
  if (S.gen){
    if (t){                       /* 1.01：生成中打字=插话——服务端以
       Enter 触发 TRAE 官方排队机制，AI 在当前步骤边界消费；
       空闲时服务端自动降级常规发送 */
      /* 2.85：只说「已发出、等回应」，不再替服务端断言「AI 正在处理」 */
      srvOpFlash('sent', '插话');
      cmd('interject', t);
    } else {
      srvOpFlash('sent', '停止生成');   // 1.09：空白期反馈（②等待服务器回应）
      cmd('stop_gen', null);
    }
    return;
  }
  if (t) cmd('send', t);
};
/* 聚焦增高输入框（255px，按钮跳顶行），失焦缩回单行，随内容自动扩展 */
const ENT_GROW = 255, ENT_MAX = 390;
function entFit(){
  el.ent.style.height = 'auto';
  const h2 = Math.max(el.ent.scrollHeight,
                      (el.ent.value || '') ? ENT_GROW : 34);
  el.ent.style.height = Math.min(h2, ENT_MAX) + 'px';
}
/* 1.82：打开大框时先在正文后面铺好 3 个空行 —— 用户点的方案：
   输入法弹出会盖住大框（255px≈9 行）最下面约 3 行，正文一长就被
   吞掉、又滚不出来（下面没内容可滚）。预留 3 个空行后，被盖住的是
   空行，正文往上滚就能看全；正文仍从第一行起写，光标落在正文末尾
   （＝空行之前），正是用户说的"我在第一个换行开始写"。
   只补末尾、不动正文里用户自己敲的空行；不足 3 行才补，已够就不动
   （反复打开不会越补越多）。
   ⚠ 空行是**内容**，故发送与空值判断一律走 value.trim()（L2332/L3599/
   L3612）——空行不会被当成正文发出去，也不会把发送按钮点亮；发送后
   el.ent.value='' 连空行一起清掉，下次打开再铺，符合"一打开就有"。 */
const ENT_PAD = 3;                       /* 底部预留空行数 */
function entPadOpen(){
  try{
    const v = el.ent.value || '';
    const real = v.replace(/\n+$/, '').length;  /* 正文实际长度（末尾空行不算） */
    el.ent.value = v.slice(0, real) + '\n'.repeat(ENT_PAD);
    el.ent.setSelectionRange(real, real);       /* 光标落正文末尾＝第一行起写 */
  }catch(e){}
}
/* 1.79/1.80：大小框分工——放大态（grow）视线钉底、看得到最后一个字；
   收起态（单行小框）回到开头、看得到第一个字，一前一后凑出前后概况。
   （光标已由 entPadOpen 放在正文末尾，此处只管视线，不再动光标。） */
function entPin(){
  const grow = el.ent.classList.contains('grow');
  const pin = () => { try { el.ent.scrollTop = grow ? el.ent.scrollHeight : 0; }
                      catch(e){} };
  pin();
  requestAnimationFrame(pin);
  setTimeout(pin, 130);   /* 等输入法收起动画结束再钉一次 */
}
if (window.visualViewport){   /* 输入法弹出/收起都会动视口尺寸 */
  window.visualViewport.addEventListener('resize', () => {
    if (document.activeElement === el.ent) entPin();
  });
}
el.ent.addEventListener('focus', () => {
  el.ent.classList.add('grow');
  el.input_row.classList.add('grow');   /* 1.27：按钮跳顶行 */
  entPadOpen();   /* 1.82：铺 3 个空行 + 光标落正文末尾 */
  entFit(); entPin();
});
el.ent.addEventListener('blur', () => {
  el.ent.classList.remove('grow');
  el.input_row.classList.remove('grow');
  el.ent.style.height = '34px';
  entPin();           /* 1.79：缩回单行 → 停在开头，看得到第一个字 */
});
el.ent.addEventListener('input', () => { refreshSendBtn(); entFit();
  entPin(); });
/* 1.81：输入法的「换行」键不再被当成「发送」。
   病根：手机上软键盘那个换行键发出来的就是一个**普通 Enter**，等我们收到
   时输入法组字早已结束（isComposing=false），旧的 !e.isComposing 根本挡不住
   → 被 e.preventDefault() 掐掉默认换行、直接发了出去，用户想换行却发了消息
   （"我点击换行的时候，咱们却把输入框发射出去了"）。
   对策：按「输入方式」分流——
     · 触摸设备（coarse pointer，手机/平板）：Enter 一律放行、交还输入框去
       换行；发送只走输入行右侧那个发送按钮——与输入法显示的「换行」字样
       一致，即用户说的"跟它配合好"；
     · 桌面硬件键盘：保留 Enter 发送（原行为不动）。
   · e.shiftKey（Shift+Enter）恒为换行；keyCode 229 是 Android 中文输入法
     组字中的「处理中」标记，一并放行。 */
const _softKb = window.matchMedia
  ? window.matchMedia('(pointer: coarse)').matches
  : ('ontouchstart' in window);
el.ent.addEventListener('keydown', e => {
  const isEnter = (e.key === 'Enter' || e.keyCode === 13);
  if (!isEnter) return;
  if (e.isComposing || e.keyCode === 229 || e.shiftKey) return;
  if (_softKb) return;       /* 软键盘的换行键 → 换行，不抢去发送 */
  e.preventDefault(); el.send.click();
});
el.new.onclick = () => {         // 1.08：统一弹窗流程（原两入口并入）
  drawerClose();
  if (srvNeedOnline('新建任务')) return;
  if (!S.snap || !S.snap.online){ flash('⚠ TRAE 未在线'); return; }
  if (S.task_open) return;
  taskDlgOpen();
  srvOpSend('new_task_dlg', null, '新建任务');   // 2.109：②＋rcpt ③④
};
el.launch.onclick = () => {       // 1.07：拉起/重启当前目标（远程 boot
  /* 2.122（老板 2026-10-22 17:56「直接短路到 Py 版上面，主界面也有一个拉起，
     跟它一样的功能；该弹窗提醒什么，也由 Py 版的往这边传」）：
     · 本端不再自带确认文案，也不再自己判断开着/没开——一律把 boot 交给服务端，
       由服务端走与 Py 主界面「拉起」同一个入口（探测运行状态：开着→弹确认后
       重启；没开→直接带端口启动）。
     · 需要确认时服务端下发 ev/boot_ask（text 即 Py 版弹窗原文），本端用
       uiConfirm 原样展示，确认后回 boot_confirm；取消回 boot_cancel。 */
  drawerClose();
  if (srvNeedOnline('重启/拉起')) return;   // TRAE 卡死救不了
  S.busy = true;
  /* 2.109：非 cmd 帧统一四态出口——②＋rcpt ③④。 */
  srvOpSendJson({t: 'boot', box: S.box}, '拉起 ' + S.box);
};
el.box.onchange = () => {                 // 切换目标：在线直接切/离线确认拉起
  const box = el.box.value;
  if (box === S.box || S.busy){ el.box.value = S.box; return; }
  if (srvNeedOnline('切换目标')){ el.box.value = S.box; return; }
  if (S.alive.has(box)){
    srvOpSendJson({t: 'switch_box', box: box}, '切换目标', box);   // 2.109：②＋rcpt ③④
  } else {
    if (!confirm('[' + box + '] 在服务端未带调试端口运行。\n\n'
      + '要请求服务端重启该 TRAE 并带端口吗？\n'
      + '（服务端正在运行的该 TRAE 会先关闭）')){
      el.box.value = S.box; return;
    }
    S.busy = true;
    /* 2.109：非 cmd 帧统一四态出口——②＋rcpt ③④。 */
    srvOpSendJson({t: 'boot', box: box}, '拉起 ' + box);
  }
};
el.model.onchange = () => {
  const name = S.model_map[el.model.value];
  if (!name || S.model_busy) return;
  if (S.fav_invalid && S.fav_invalid.includes(name)){
    /* 1.15：选中了已失效的收藏——不发送，回显当前模型 */
    flash('⚠「' + name + '」已失效（可能被官方改名/下架），'
      + '请到 ☆ 收藏管理移除后重新收藏新名字');
    syncModel(S.snap.model || '');
    return;
  }
  S.model_busy = true;
  srvOpSend('switch_model', name, '切换模型', name);   // 2.109：②＋rcpt ③④（model_set 另回填）
};

/* —— 1.15：模型收藏管理页 —— */

el.fav.onclick = () => { renderFavPage(); el.favpage.classList.add('on'); };
el.favback.onclick = () => el.favpage.classList.remove('on');
/* 1.74：收藏页「刷新模型」——发 model_list 命令让服务端 CDP 重拉
   最新官方模型列表；结果经 models 事件回来自动刷新本页与下拉。 */
el.favrefresh.onclick = () => {
  const b = el.favrefresh;
  b.disabled = true; b.textContent = '刷新中…';
  renderFavPage();
  srvOpSend('model_list', null, '刷新模型');   // 2.109：②＋rcpt ③④（models 事件另回填）
  setTimeout(() => { b.disabled = false; b.textContent = '↻ 刷新模型'; }, 1200);
};

/* —— 抽屉 —— */

el.menu.onclick = drawerOpen;
el.mask.onclick = drawerClose;
el.dclose.onclick = drawerClose;

/* —— 2.72：📂 工作台浏览改为引用公共独立服务「网页版本地文件查看器」——
   本端原自绘浏览页（bench_ls 逐级拉目录）与入口处理器已删，改由
   任务与输入.js 的 fvwrOpen() 打开公共查看器回传选中路径。 —— */

