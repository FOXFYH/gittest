'use strict';
const MODEL_UNK = '（模型未知）';   // 1.18：模型读不到时的占位显示
function syncModel(cur){
  if (S.model_busy) return;
  const ph = el.model.querySelector('option[data-unk]');
  if (!cur){
    /* 1.18: 冻结/未就绪时 snap.model 为空——原实现直接早退，浏览器
       默认显示第一项，伪装成「已选中第一个模型」误导用户（用户以为
       模型被切走了）。改为明确占位；恢复后自动换成真值 */
    if (!ph){
      const o = document.createElement('option');
      o.value = MODEL_UNK; o.textContent = MODEL_UNK;
      o.dataset.unk = '1';
      el.model.insertBefore(o, el.model.firstChild);
    }
    if (el.model.value !== MODEL_UNK) el.model.value = MODEL_UNK;
    return;
  }
  if (ph) ph.remove();               // 有真值了：撤占位
  if (el.model.value === cur) return;
  let found = false;
  for (const [disp, name] of Object.entries(S.model_map))
    if (name === cur){ el.model.value = disp; found = true; break; }
  if (!found){                                // 列表未到：临时占位
    const o = document.createElement('option');
    o.value = cur; o.textContent = cur;
    el.model.appendChild(o);
    el.model.value = cur;
    S.model_map[cur] = cur;
  }
}

/* ================= 连接 / 事件流 ================= */

let ws = null, reconnectTimer = null, kaTimer = null;
let helloTimer = null, helloTries = 0, gotHello = false;

/* ========== 1.xx：连接诊断（网络页） ==========
   目的：不知道「一直连接中」是我这头死了还是服务端那头死了。
   记录断线/出错/收到服务端回应，网络页据此判定本端↔服务端两侧状态。 */
const DIAG = {reconn: 0, reconnActive: false, err: 0, testAt: 0, testOk: false, log: []};
function diagLog(txt, cls){
  DIAG.log.push({t: Date.now(), txt: txt, cls: cls || ''});
  if (DIAG.log.length > 60) DIAG.log.shift();   // 1.60：8→60，够看清一整轮故障过程
  if (el && el.diag_log) diagRender();
}
function diagTest(){                        // 测服务器：发 hello，5s 内等回应
  DIAG.testAt = Date.now(); DIAG.testOk = false;
  diagLog('测试：已发送 hello，等 5 秒回应…', 'dim');
  try { sendJson({t: 'hello'}); } catch(e){}
  setTimeout(() => {
    if (DIAG.testOk) diagLog('测试：收到服务器回应 ✓', 'ok');
    else diagLog('测试：5 秒内无回应 ✗（服务端未启动？频道不符？）', 'bad');
    DIAG.testAt = 0;
  }, 5000);
}
function diagRender(){
  if (!el.diag_ws) return;
  /* 频道（v1.50：标注主/副） */
  const ch = (typeof chanGet === 'function') ? chanGet() : '';
  const selM = (typeof curSel === 'function') ? curSel() : 'main';
  el.diag_chan.textContent = ch ? (selM === 'backup' ? '副' : '主') + ':' + ch.slice(-2) : '未设置';
  /* 本端连上中转 */
  if (S.onLine){ el.diag_ws.textContent = '✅ 已连上中转';
    el.diag_ws.style.color = '#1a7f37'; }
  else if (S.failStreak >= FAIL_ALERT){
    el.diag_ws.textContent = '❌ 连不上中转（已连续 ' + S.failStreak + ' 次）';
    el.diag_ws.style.color = '#c62828'; }
  else if (S.wsOpenAt){ el.diag_ws.textContent = '❌ 已断开 · 重连中';
    el.diag_ws.style.color = '#c62828'; }
  else { el.diag_ws.textContent = '⏳ 连接中…';
    el.diag_ws.style.color = '#b26a00'; }
  /* 电脑端回应（1.59：两级判定，别把网络抖动当故障） */
  const srvGap = S.lastSrv ? Date.now() - S.lastSrv : -1;
  if (S.lastSrv && srvGap < SRV_IDLE_MS){
    el.diag_srv.textContent = '✅ 正常（' + (SRV_IDLE_MS / 1000) + 's 内收到）';
    el.diag_srv.style.color = '#1a7f37';
    el.diag_last.textContent = new Date(S.lastSrv).toLocaleTimeString();
  } else if (S.lastSrv && srvGap < SRV_DEAD_MS){
    el.diag_srv.textContent = '⚠ ' + Math.round(srvGap / 1000)
      + 's 无新消息（抖动/后台，再等等）';
    el.diag_srv.style.color = '#b26a00';
    el.diag_last.textContent = new Date(S.lastSrv).toLocaleTimeString();
  } else if (S.lastSrv){
    el.diag_srv.textContent = '❌ ' + Math.round(srvGap / 1000)
      + 's 无消息（服务器可能没在跑）';
    el.diag_srv.style.color = '#c62828';
    el.diag_last.textContent = new Date(S.lastSrv).toLocaleTimeString();
  } else {
    el.diag_srv.textContent = '⏳ 尚未收到';
    el.diag_srv.style.color = '#888';
    el.diag_last.textContent = '—';
  }
  el.diag_cnt.textContent = DIAG.reconn + ' 次 / ' + DIAG.err + ' 次';
  /* 日志 */
  /* 日志：数据留 60 条（复制可取全量），面板只铺最近 25 条免得滚动太长 */
  const _seen = DIAG.log.slice(-25);
  el.diag_log.innerHTML =
    (DIAG.log.length > _seen.length
      ? '<div class="dim">… 面板仅显示最近 25 条（共 ' + DIAG.log.length
        + ' 条；点「📋 复制诊断信息」可取全量）</div>'
      : '')
    + (_seen.map(l =>
        '<div class="' + (l.cls || '') + '">'
        + new Date(l.t).toLocaleTimeString() + '  ' + l.txt + '</div>').join('')
       || '<div class="dim">（暂无事件）</div>');
}
setInterval(diagRender, 1000);

/* ========== 1.xx：版本号单源——只改这里，地址栏/标题栏/菜单栏与
   说明行同步更新（APP_NAME / VER） ========== */
const APP_NAME = 'TRAE远程';
const VER = '2.28';   /* 2.28：本地主动弹窗展示——事件总线消费 bench_open
                         （mode=file 走阅读器、mode=dir 走浏览页 benchOpen）。
                         2.27：📂 浏览页文件阅读（点文件名→远程读文本，
                         按需 FOX 分段回传；文件行加 ➕ 插路径）。
                         2.26：FOX 单段正文上限 10KB→15KB（两端同步，对齐中继
                         16KB 硬限，留 64B 安全边）。
                         2.25：act 上行统一闸门——三条约束收口（3 秒全局节流 /
                         仅当前选中会话 / 橙灯才发、发后清本地未读即停），三处
                         发送点改为调用 actSend()，删旧 800ms 局部节流。
                         2.24：附属文件（样式 + 19 个 js）收进子目录
                         TRAE同步显示与控制工具_网页端/，入口 HTML 路径不变
                         （防与同仓其他项目混名/被覆盖）。
                         2.22：消息时间以服务端为准——resolveTimes 优先读 msgs
                         第 6 位（服务端盖好的北京秒级串）直接显示，不再本地
                         打戳（本地戳受手机时区/首见时刻影响）。无第 6 位回退
                         旧本地逻辑。
                         2.21：新增【AI 提问卡】——(@fox-ask1)...(@fox-ask2) 包夹段
                         渲染成醒目琥珀色提问卡（左粗条+暖底+加粗），复用语音卡
                         同一套 ▶ 播放/TTS 通道，可直接听题。用途：AI 向用户/
                         其他 AI 提问时醒目可见、便于及时作答（用户 2026-10-01）。
                         2.20：网页端【锚定】——取消"跟随"，网页版守住自己锚定的
                         会话，别人在电脑版（含会话路由器临时占用）切到别的会话
                         也不跟着跳（adoptSnap：来拍快照选中 != 锚定即冻结正文类
                         字段、只并入会话列表，选中标志改写到锚定行）；点会话行
                         即换锚；发送/插话附 anchor 供服务端"以网页版为尊"归还。
                         2.19：分身状态页新增「一键换号迁移」按钮——填目标号码后由
                         服务端一站式完成「原版换号（沙盒启动器 origin-login）+
                         对话记录智能迁移（把最重度账号全部会话换新ID 并入）」；
                         进度经 switch_migrate 事件流回投（阶段+逐行日志），
                         分身掉线自动拉起助手补登录、收尾自动关掉拉起的窗口。
                         2.18：分身状态页每行新增「补登录」按钮——借服务端
                         「谷歌分身助手 / T登录助手」HTTP 接口对指定分身发起
                         自动登录（服务端可选自动拉起分身助手）；结果经
                         profiles_login 事件回投提示。
                         2.17：发送/插话改走「会话路由器」route_send——
                         带目标会话稳定 sid 自动找上门、到点才临时占用 TRAE
                         输入框发一条、发完即走（不再长期霸占）；残留取回
                         退回本端输入框，服务端整段路由事务串行原子执行 */
/* 1.85 版本自愈（镜像 CLI 版 1.45）：GitHub Pages 缓存旧 html 约10分钟，
   升级后常用浏览器可能仍跑旧 JS。把「上次见过的版本」落盘，发现与本次
   不同（刚升级/缓存错乱）就带 ?v=VER 重载一次绕过缓存取最新，之后不再刷；
   首次访问只记录不刷。 */
try {
  const _VK = 'trae_webm_ver_seen', _pv = localStorage.getItem(_VK);
  localStorage.setItem(_VK, VER);
  if (_pv !== null && _pv !== VER)
    location.replace(location.href.split('?')[0] + '?v=' + VER);
} catch(e){}
