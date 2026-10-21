'use strict';
let flashTimer = null;
function flash(msg, color, ms){
  el.state.textContent = msg;
  el.state.style.color = color || 'var(--red)';
  fbarSync();
  /* 1.62：全屏下 #statebar 不可见 -> 提示同步吐司一份，
     撤回/回退等操作的结果在历史全屏里也看得见 */
  if (msg && document.body.classList.contains('fmsg'))
    ftoast(msg, color, Math.max(ms || 4000, 3400));
  clearTimeout(flashTimer);
  if (msg) flashTimer = setTimeout(() => renderState(S.snap), ms || 4000);
}
/* ============ 2.85（老板口径 2026-10-19）：对服务器的操作「统一四态」提示 ============
   凡网页版→服务端的操作，提示一律分阶段、且每态绑真实信号：
     ① WS 不在线                 →「正在连接 WS…」
     ② WS 在线、命令已发出        →「等待服务器回应…」
     ③ 服务器确认收到（受理/ack） →「服务器开始执行…」
     ④ 服务器给出成功信号         → 才「成功」；失败/超时/无回执如实说。
   ★ 严禁「无信号就播报已排队/已执行」。文案＋颜色只此一处产出，
     各模块（含 2.67 切换状态机——参照物）一律转调，杜绝各写各的文案漂移。 */
const SRV_PHASE = {
  offline: ['正在连接 WS…',   'var(--orange)'],
  /* 2.112（Y12）：动作已提交、服务端尚未回 rcpt accepted ⇒ 明确「已提交 · 排队中…」，
     不再让用户对着「等待服务器回应…」干等。四步口径不变：
     ①offline → ②queued/sent → ③accepted/running → ④ok/fail（＋timeout 待确认）。 */
  queued:  ['已提交 · 排队中…', 'var(--blue)'],
  sent:    ['已提交 · 排队中…', 'var(--blue)'],   /* 2.112：②步统一口径（原「等待服务器回应…」） */
  accepted:['服务器已受理…',   'var(--blue)'],   /* 2.90：rcpt stage=accepted → ③ */
  ack:     ['服务器开始执行…', 'var(--blue)'],   /* rcpt stage=running → ③ */
  ok:      ['成功',            'var(--green)'],
  fail:    ['失败',            'var(--red)'],
  /* 2.105（02-P1-1）：服务端 cmdq 为内存队列，连续动作/重启会丢在途动作 ⇒ 无终态。
     网页端不得永远停在「等待/执行中」，超时如实报「待确认」（服务端持久化由他人负责）。 */
  timeout: ['待确认（长时间无终态回帧，动作可能已丢失）', 'var(--orange)']
};
function srvOpText(phase, label, extra){
  const p = SRV_PHASE[phase] || SRV_PHASE.sent;
  return (label ? label + '：' : '') + p[0] + (extra ? '（' + extra + '）' : '');
}
function srvOpFlash(phase, label, extra, ms){
  const p = SRV_PHASE[phase] || SRV_PHASE.sent;
  flash(srvOpText(phase, label, extra), p[1], ms);
}
/* 未连上中转的统一拦口：true=已拦（命令未发出；如实告知，绝不假装已发） */
function srvNeedOnline(label){
  if (S.onLine) return false;
  srvOpFlash('offline', label, '命令未发出，稍后再试');
  return true;
}
/* ============ 2.90（老板夜间令 B10／C7）：四步闭环=②发送→③受理/执行→④完成/失败 ============
   srvOpSend 为每次「网页端→服务端」操作生成一个动作 id（随 cmd 帧 `id` 字段发出），
   服务端回执（t:'rcpt'，带同 id）据此把 ③「服务器已受理/开始执行」、④「完成／失败」
   补上（见 事件总线.js onRcpt → srvOpAck）。在途登记表 srvOpAcct 以 30s 定时兜底
   过期（旧服务端不回 rcpt 时不泄漏）；命令一字不改，仍走 sendCmd 协议。 */
let srvOpSeq = 0;
const SRV_OP_TTL = 30000;                 /* 在途登记最长存活（无回执自动清） */
const srvOpAcct = {};                      /* 动作 id(str) -> {label, extra, timer} */
function srvOpNewId(){
  srvOpSeq++;
  return 'a' + Date.now().toString(36) + '-' + srvOpSeq;
}
/* 2.87/2.90：带「真实发送信号」的服务器命令出口——②「等待服务器回应…」只在
   报文确实写上线时才播报；WS 未就绪则报 ① 并返回 false（绝不假装已发）。 */
function srvOpSend(cmd, arg, label, extra, ms){
  if (!S.onLine){
    srvOpFlash('offline', label, '命令未发出（WS 未就绪），稍后再试');
    return false;
  }
  const id = srvOpNewId();
  /* 2.112（Y12）：stage 记在途阶段——queued＝已提交、尚未收到 rcpt accepted；
     输入界面.js 的 renderState 据此在状态栏常显「已提交 · 排队中…」（防被快照刷掉）。 */
  const op = {label: label, extra: extra, timer: null, stage: 'queued', at: Date.now()};
  /* 2.109（02-P1-1/2.105 落地）：TTL 到期仍未收到任何终态回帧 ⇒ 不再静默删除，
     如实播报「待确认（长时间无终态回帧，动作可能已丢失）」，绝不永远停在
     「等待/执行中」。收到终态（srvOpAck）会 clearTimeout 并删表项，不误报。 */
  op.timer = setTimeout(() => {
    delete srvOpAcct[id];
    srvOpFlash('timeout', label, extra);
  }, SRV_OP_TTL);
  srvOpAcct[id] = op;
  sendCmd(cmd, arg, null, null, id);
  srvOpFlash('queued', label, extra, ms);    /* ②：已提交，排队中（等 rcpt accepted） */
  return true;
}
/* 2.109：非 cmd 帧（t:'boot'/'switch_box'/'attach_files'）的统一四态出口——
   与 srvOpSend 同一套在途登记/rcpt 收口，只是发的是自定义帧；帧上并入 `id`
   供服务端 回执.受理/开始/终态 配对（服务端「四步提醒」同样按 d.id 回 stage）。
   旧服务端忽略多余 `id` 字段。补充多参数 ms（保持原 flash 时长）。
   2.113：新增可选 `id`（调用方自带动作 id，供「刷新当前会话」在收到 snap_pane
   时用同一 id 收口 ④；不传则维持原行为）。 */
function srvOpSendJson(obj, label, extra, ms, id){
  if (!S.onLine){
    srvOpFlash('offline', label, '命令未发出（WS 未就绪），稍后再试');
    return false;
  }
  id = id || srvOpNewId();
  const op = {label: label, extra: extra, timer: null, stage: 'queued', at: Date.now()};
  op.timer = setTimeout(() => {
    delete srvOpAcct[id];
    srvOpFlash('timeout', label, extra);   /* 2.109：TTL 到期无终态 ⇒ 如实「待确认」 */
  }, SRV_OP_TTL);
  srvOpAcct[id] = op;
  const d = obj || {};
  d.id = id;
  sendJson(d);
  srvOpFlash('queued', label, extra, ms);   /* 2.112（Y12）：已提交 · 排队中… */
  return true;
}
/* 2.90：rcpt 收口——按动作 id 取在途操作，补 ③（accepted/running）与
   ④（done→成功 / fail→失败，如实带 msg）。他人/已清 id 一律忽略。 */
function srvOpAck(id, stage, msg){
  const op = srvOpAcct[id];
  if (!op) return false;
  if (stage === 'accepted'){ op.stage = 'accepted'; srvOpFlash('accepted', op.label, op.extra); return true; }
  if (stage === 'running'){  op.stage = 'running';  srvOpFlash('ack',      op.label, op.extra); return true; }
  if (stage === 'done' || stage === 'fail'){
    clearTimeout(op.timer);
    delete srvOpAcct[id];
    if (stage === 'done') srvOpFlash('ok',   op.label, op.extra);
    else                  srvOpFlash('fail', op.label, msg);
    return true;
  }
  return false;
}
/* 2.112（Y12）：是否还有「已提交、排队中（未受理）」的在途动作——供 输入界面.js
   renderState 在快照之间常显「已提交 · 排队中…」，避免被每秒快照刷回其它状态。
   accepted/running/done/fail/timeout 皆不再算排队中（按原四态推进）。 */
function srvOpQueuedPending(){
  for (const k in srvOpAcct){
    const op = srvOpAcct[k];
    if (op && (op.stage === 'queued' || op.stage === 'sent')) return true;
  }
  return false;
}
/* 本专项 A2/A3：切换文案唯一出口——状态栏（输入界面.js）、
   会话点击提示（会话列表.js）两处共用此函数，杜绝
   「正在切换」/「正在切换到」两套文案漂移。
   2.60：消息区切换条已删，此处由三处收敛为两处。 */
function switchTip(title){
  return '正在切换到「' + (title || '') + '」…';
}
/* 1.62：#fbar 镜像 #statebar；#ftoast 为全屏浮动吐司 */
function fbarSync(){
  const fb = $('fbar');
  if (!fb || !el.state) return;
  fb.textContent = el.state.textContent || '';
  fb.style.color = el.state.style.color || 'var(--gray)';
}
let ftoastTimer = null;
function ftoast(msg, color, ms){
  let t = $('ftoast');
  if (!t){
    t = document.createElement('div');
    t.id = 'ftoast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = color || 'rgba(255,255,255,.65)';
  t.classList.add('on');
  clearTimeout(ftoastTimer);
  ftoastTimer = setTimeout(() => t.classList.remove('on'), ms || 3400);
}
/* 1.72：进全屏不再弹 0.5s 悬浮窗（briefFtoast 已删）——顶部 #fbar
   横幅常驻提示状态，避免两处重复提醒。ftoast 仍保留（撤回结果等用） */

/* ============ 2.117（老板 2026-10-21 15:44）：自绘确认层 uiConfirm ============
   起因：老板点排队条「🗑 删除」没反应。根因＝本端多处仍用浏览器**原生 confirm()**，
   而手机内置浏览器 / 部分 WebView 会【静默屏蔽】confirm（不弹框、直接返回 false），
   于是 `if(!confirm(...)) return` 悄悄退出——既无弹窗、也从不发命令。
   已在 2.110 给「删除会话」改过自绘确认层；本次把其余 5 处（回退/删除消息/
   删除排队消息/清空定时/清除他账号记录）统一收口到本函数，手机上一定能看到弹层。
   · bodyHtml 允许调用方传入已 esc 的正文 ＋ 静态 <br>；
   · 点「取消」/点遮罩外部 = 关闭不执行；点确认 = 关层后执行 onOk。 */
function uiConfirm(head, bodyHtml, okText, onOk){
  const old = $('uimask');
  if (old) old.remove();
  const ov = document.createElement('div');
  ov.id = 'uimask';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);'
    + 'display:flex;align-items:center;justify-content:center;';
  ov.innerHTML = '<div style="background:#fff;border-radius:12px;padding:16px;'
    + 'width:86%;max-width:420px;box-shadow:0 8px 30px rgba(0,0,0,.3);">'
    + '<div style="font-weight:bold;font-size:15px;margin-bottom:10px;">'
    + esc(head) + '</div>'
    + '<div style="font-size:14px;line-height:1.5;margin-bottom:12px;">'
    + (bodyHtml || '') + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button id="uimask_cancel" style="padding:7px 14px;border-radius:8px;'
    + 'border:1px solid #cfd8e3;background:#fff;font-size:14px;">取消</button>'
    + '<button id="uimask_ok" style="padding:7px 14px;border-radius:8px;'
    + 'border:1px solid var(--blue);background:var(--blue);color:#fff;font-size:14px;">'
    + esc(okText || '确定') + '</button>'
    + '</div></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  $('uimask_cancel').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  $('uimask_ok').onclick = () => {
    close();
    try { if (onOk) onOk(); } catch (e) {}
  };
  return ov;
}

/* 1.27：积分预警 toast——页面中上部大字提醒，2 秒后自动消失
   （不走 statebar，那会被下一条快照状态覆盖） */
let warnTimer = null;
function warnFlash(msg){
  let t = $('warnbox');
  if (!t){
    t = document.createElement('div');
    t.id = 'warnbox';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => t.classList.remove('on'), 2000);
}

/* 1.86：切换会话失败弹窗——悬浮不干扰（不挡打字），「会话切换
  失败」+一个「确认」键立刻消除，3 秒自动消失，无其他按钮 */
let swfTimer = null;
function switchFail(title){
  let t = $('swfbox');
  if (!t){
    t = document.createElement('div');
    t.id = 'swfbox';
    t.innerHTML = '<div class="t">⚠ 会话切换失败</div>'
      + '<button>确认</button>';
    t.querySelector('button').onclick = () => t.classList.remove('on');
    document.body.appendChild(t);
  }
  t.classList.add('on');
  clearTimeout(swfTimer);
  swfTimer = setTimeout(() => t.classList.remove('on'), 3000);
}

/* 1.27：登录账号名显示（抽屉「登录账号」行） */
function renderAcct(){
  if (el.acct) el.acct.textContent = S.acct || '—';
}

function esc(s){
  /* 1.97：补转义双引号（用户2026-09-30实测「语音卡片只念前半句」的根因）。
     原先只转义 & < >，而属性是 data-seg="' + esc(seg) + '"：正文里只要出现
     一个英文双引号，属性值就在那里被 HTML 解析截断——span 里的可见文字
     仍是全量（元素内容里双引号合法），getAttribute('data-seg') 却只拿到
     引号前的半句，于是 TTS 只念半句。补上 &quot; 后属性不再破口。
     对所有调用点都安全：&quot; 在元素内容里仍渲染成 " 本身。 */
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* 2.08：排队条的「展开全文」标记维护——快照每秒重绘，展开状态要能
   撑过重绘，故记在 S.qopen（{文字:true}）里；某条文字已被 TRAE 消费/
   删除、不再出现在队列里时，把它的标记清掉，不留脏数据。 */
function qopenPrune(pend){
  const live = {};
  (pend || []).forEach(p => { if (p && p.t && S.qopen[p.t]) live[p.t] = true; });
  S.qopen = live;
}

/* 1.24：一键复制文本（clipboard API 优先，非安全上下文兜底） */
function copyText(t){
  t = String(t == null ? '' : t);
  const done = () => flash('已复制到剪贴板', 'var(--green)');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(done).catch(() => copyFallback(t, done));
  } else copyFallback(t, done);
}
function copyFallback(t, done){
  /* 2.10：临时 textarea 的 select() 会把焦点抢走——输入框因此 blur、
     放大态被摘掉（放大态下点 📋 会连带把输入框缩回去）。记下原焦点、
     复制完还回去，让输入框与软键盘都不受打扰。 */
  const host = document.activeElement;
  try{
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    if (host && host !== document.body && host.focus){
      try { host.focus({preventScroll: true}); } catch(e){ host.focus(); }
    }
    done();
  }catch(e){ flash('复制失败，请长按文本手动复制', 'var(--red)'); }
}

/* ================= Markdown 渲染（AI 消息） ================= */
/* 2.51：渲染实现搬到独立模块「MD渲染器.js」（全项目唯一真源），此处只转调
   chat 模式——输出与原实现逐字一致，气泡观感零变化。 */

function mdHtml(text){
  if (window.MD渲染器 && MD渲染器.html) return MD渲染器.html(text, {chat: true});
  return esc(text);          /* 兜底：模块缺失时只转义，绝不吐裸 HTML */
}

/* ================= 消息时间（本地首见缓存，对齐桌面版） ================= */

function djb2(s){
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h*33 ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0').slice(0, 10);
}
function timesGet(){
  try { return JSON.parse(localStorage.getItem(LS_TM)) || {}; }
  catch(e){ return {}; }
}
function fmtTime(iso){                    // 北京时间 + 完整日期（YYYY-MM-DD HH:MM）
  if (!iso) return '';
  /* 历史缓存是 toISOString().slice(0,19) 的「无时区 UTC 串」（丢 .000Z），
     Date.parse 会按本机时区解释 → 显示比北京慢 8 小时（v1.36 只改了
     fmtTime 的 getHours 分支、没改缓存写入端，故当时「改了没效果」）。
     这里对无时区尾缀的串显式补 Z 按 UTC 解析，旧缓存一并自动纠正。 */
  let ms;
  if (typeof iso === 'number') ms = iso;
  else {
    const s = String(iso);
    const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s);
    ms = Date.parse(bare ? s + '.000Z' : s);
  }
  if (isNaN(ms)) return '';               // 解析失败不显示错误时间
  /* 统一显示北京时间(UTC+8)墙钟——手机时区若被切走，这里显式 +8
     对齐消息真实时刻，显示不随本机时区漂移 */
  const bj = new Date(ms + 8 * 3600 * 1000);
  const s = bj.toISOString();             // epoch+8h 的 UTC 表示 = 北京墙钟
  return s.slice(0, 10) + ' ' + s.slice(11, 19);   // YYYY-MM-DD HH:MM:SS（秒级）
  /* 排序口径（v1.69，用户决策）：消息不发明 seq 编号，排序直接采用时间。
     - 主依据：秒级时间（首见缓存/沿用，直播≈真实时刻）。
     - 同秒碰撞：同一拍快照抓到的新消息首见时间同为 now（同一秒），
       以数组顺序（=TRAE DOM 顺序）为次级依据——它天然存在，不算编号。
     - 老数据：分钟级字符串解析后秒=00，仍可正确显示与参与排序。 */
}
/* v2.82：取消息正文【首行】的 14 位 DID（^\d{14}$ 命中才返回，否则 ''）——
   与网页版发送时插入的口径一致。 */
function firstLineDid(text){
  const s = String(text == null ? '' : text);
  const head = s.split('\n', 1)[0].trim();
  return /^\d{14}$/.test(head) ? head : '';
}
/* v2.82／2.99：14 位 DID（YYYYMMDDHHMMSS）→ 与 fmtTime 同格式的北京时间串
   'YYYY-MM-DD HH:MM:SS'（「我自己发的消息」以首行 DID 的时间为准，不用系统时间）。 */
function didToStr(d){
  return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) + ' '
       + d.slice(8, 10) + ':' + d.slice(10, 12) + ':' + d.slice(12, 14);
}
/* 2.99：取「该条自身」的 14 位 DID——兼容两形态：① 首行纯 DID（换行分隔，
   firstLineDid）；② TRAE 官方排队条把首行 DID 后的换行折叠成空格后的单行形态
   （'20261020114333 正文…'，pendDidOf）。② 正是「更早老对话被统一打上最新时间」
   的根因：旧口径只认 ①，② 取不到 DID 便落进「首见缓存/NOW」兜底。 */
function msgDidOf(text){
  return firstLineDid(text) || pendDidOf(text);
}
function didTimeOf(text){
  const d = firstLineDid(text);
  return d ? didToStr(d) : '';
}
/* v2.84（老板实测 · Bug B）：剥净正文开头【已有】的 14 位 DID（含多层）——
   重发/重编/残留回填会带着旧 DID，不剥净发送时就会「首行出现两个时间」。
   反复剥到不再以 DID 打头为止（一次重发可能叠了两层）。兼容两形态：
   ① 首行纯 DID（换行分隔）② TRAE 官方排队条把首行 DID 后的换行折叠成
   空格后的单行形态。返回剥净后的正文（可能为空）。 */
function stripHeadDid(text){
  let s = String(text == null ? '' : text);
  for (let i = 0; i < 4; i++){
    const m = /^\s*(\d{14})(?!\d)[ \t]*\n?/.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}
/* v2.84（老板实测 · Bug A）：官方排队条（pend）条目文本取【开头】的 14 位
   DID——实测 TRAE 把首行 DID 后的换行折叠成空格（t='20261019201408 正文…'
   单行），故不能再按「首行 ^\d{14}$」取（那样整段首行≠14 位，永远取不到、
   卡就销不掉）。改取开头 14 位数字（其后须非数字）。 */
function pendDidOf(text){
  const s = String(text == null ? '' : text).trim();
  const m = /^(\d{14})(?!\d)/.exec(s);
  return m ? m[1] : '';
}
function resolveTimes(msgs){
  /* 2.99（老板 2026-10-20 11:43「最近几条对话的时间，居然都是一样的……明明我记得
     这些都是更早之前的老对话，全部一起被打上了最新时间」）——时间【取源】整改。
     根因：v2.82 的 didTimeOf 只认「首行纯 14 位 DID」，而「更早老对话」经 TRAE 官方
     排队条落账后首行 DID 被折进单行（'20261020114333 正文…'，账本 tm 列同时为空）⇒
     取不到 DID ⇒ 落进旧的 else 本地兜底（首见缓存/渲染时刻 NOW）⇒ 同拍多条一并被打上
     「最新时间」（且各条独立、不串用的口径被破坏）。
     2.99 起口径：消息时间必须＝该条【自身】真实时间，按优先序取——
       ① 首行 DID（含折叠单行 msgDidOf；网页版自己发起的消息其时间就是该 DID）；
       ② 账本源 tm（历史行 index 2，见 缓存.js ledToArr；亦＝快照 index 2 的 TRAE DOM
          实测真值，与快照服务端第 6 位同源）；
       ③ 服务端 2.52 盖章（快照 index 5）。
     三者皆无 ⇒ 【不显示时间】（times[i] 空 ⇒ 消息渲染.js .tm 不渲染）——绝不再用
     本地首见/NOW 兜底，各条独立、不串用。AI 行沿用其【紧邻上一句人类提问】的时间
     （该句无真值则 AI 行亦不显）。保留 2.93「双方常显」口径（是显示与否，非时间源）。 */
  const out = [];
  let last = '';                          // 紧邻上一句人类提问的时间（无真值＝''）
  for (const m of msgs){
    /* 2.102（老板 2026-10-20 13:11「AI 每一条对话都会有一个 ID，ID 上面带时间」）：
       **mid 前 8 位十六进制＝Unix 秒**（实测：AI 行 mid `6ad6e17517ef…`
       → 0x6ad6e175 = 1792467317 → 北京时间 2026-10-20 11:35:17，与该行 tm 完全一致）
       ⇒ **AI 行也有自己的时间**，不再沿用上一句提问时间。AI 行优先取 mid。 */
    let t = _midTime(m);
    /* 2.105（⑨·时间一致性）：mid 解出的时间与该行【DOM/账本真值】m[2]（非空完整
       时间）交叉校验——B 组实测 mid→时间 vs 账本 tm 全库 15.4% 不一致（多为 1s~数秒、
       长尾 2751s，部分 mid 非创建时间戳）⇒ 两者皆完整且相差 > MID_TIME_DRIFT_S 时，
       以 m[2]（TRAE DOM / 账本 tm）为准；两者皆无 ⇒ 后续各取源规则落到空。 */
    if (t && m[2]){
      const _a = _timeSec(t), _b = _timeSec(m[2]);
      if (isFinite(_a) && isFinite(_b) && Math.abs(_a - _b) > MID_TIME_DRIFT_S)
        t = String(m[2]);
    }
    if (m[0] === 'u'){
      if (!t){ const d = msgDidOf(m[1]); if (d) t = didToStr(d); }  // ① 首行 DID（兼容折叠单行）
      if (!t && m[2]) t = String(m[2]);    // ② 账本源 tm / TRAE DOM 真值
      if (!t && m.length > 5 && m[5]) t = String(m[5]);   // ③ 服务端 2.52 盖章
      /* else：拿不到真实时间 ⇒ 空（不显示，绝不打 NOW） */
      last = t;
    } else if (!t){
      t = last;                           // AI 无 mid 真值时才沿用其紧邻提问时间
    }
    out.push(t);
  }
  return out;
}
/* 2.102：从 mid 解出该条【自身】的时间——mid 前 8 位十六进制＝Unix 秒（UTC），
   转本地时间字符串（格式对齐账本 tm：YYYY-MM-DD HH:MM:SS）。
   非十六进制/长度不足/秒数超出 2017~2039 合理区间 ⇒ 返回 ''（当作无真值）。 */
function _midTime(m){
  try {
    const s = String((m && m.length > 6) ? (m[6] || '') : '');
    const h = s.slice(0, 8);
    if (!/^[0-9a-fA-F]{8}$/.test(h)) return '';
    const sec = parseInt(h, 16);
    if (!(sec > 1500000000 && sec < 2200000000)) return '';
    const d = new Date(sec * 1000);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
         + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  } catch(e){ return ''; }
}
/* 2.105（⑨）：mid 解出时间与 DOM/账本真值 m[2] 的允许偏差（秒）。B 组实测不一致
   多为 1s~数秒、长尾 2751s；超过此阈值即认定 mid 非该条创建时间戳 ⇒ 以 m[2] 为准。 */
const MID_TIME_DRIFT_S = 300;
function _timeSec(ts){
  /* 'YYYY-MM-DD HH:MM:SS'（含 T 分隔）→ Unix 秒；不完整/非法 ⇒ NaN（不参与比较）。 */
  const s = String(ts == null ? '' : ts).trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(s)) return NaN;
  const p = s.split(/[- :T]/);
  const v = Math.floor(new Date(+p[0], +p[1] - 1, +p[2], +p[3], +p[4], +p[5]).getTime() / 1000);
  return isFinite(v) ? v : NaN;
}
function 稳定键(sid, title){
  /* 2026-10-16 用户口径（绑定改终身号）：会话「稳定性键」——完整 SID 每日会变，
     取前 4 位数字（终身号）作稳定标识；非 4 位数字前缀（临时/hex SID）退回会话名。
     供锚定/未读灯/备注/定时等**需跨天稳定**的键使用；sid 兜底保键非空。 */
  const s = String(sid == null ? '' : sid);
  if (/^\d{4}/.test(s)) return s.slice(0, 4);
  return (title || s);
}
function _行稳定(r){ return 稳定键(r && r[4], r && r[1]); }
function curTitle(){
  /* 本专项 A5：以本地锚定为准（用户点选的会话），快照选中行仅作兜底——
     状态栏会话名与正文会话由同一锚定源产出，杜绝「横幅写 A、正文走 B」。
     2026-10-16：锚定键改「终身号」（S.anchorSid 存稳定性键，不再存易变完整 sid）。 */
  const convs = (S.snap.convs || []);
  if (S.anchorSid){
    for (const r of convs)
      if (r[0] === 'c' && _行稳定(r) === S.anchorSid) return r[1];
    if (S.anchorTitle) return S.anchorTitle;  /* 锚点不在列表：先用锚定标题兜底（A4 已弹提醒） */
  }
  for (const r of convs) if (r[0] === 'c' && r[2]) return r[1];
  return '当前会话';
}
/* v1.95：当前会话的稳定 ID（convs 'c' 行第 5 位，TRAE 后端主键）。
   本专项 A5：锚定优先；未锚定才回退快照选中行。拿不到返回 ''。
   2026-10-16：锚定键现为「终身号」，故按稳定性键在快照里反查**当前完整 sid**
   （SID 每日变也能定位到真 sid，供 switch/send/repaint 等命令使用）。 */
function curSid(){
  const convs = (S.snap.convs || []);
  if (S.anchorSid){
    for (const r of convs)
      if (r[0] === 'c' && _行稳定(r) === S.anchorSid) return r[4] || '';
    return S.anchorFull || '';      /* 锚点暂不在列表：用最近一次命中的完整 sid 兜底 */
  }
  for (const r of convs) if (r[0] === 'c' && r[2]) return r[4] || '';
  return '';
}

/* ===== 2.25：act 上报统一闸门（用户 2026-10-05 三条约束）=====
   act = 网页端→服务端的「人类活动」上行信号，只用于清掉当前会话橙灯。
   此前被滥用（每滑就发 / 切服务端也发 / 橙灯灭了仍发），现收敛为：
     ① 全局节流：任意来源合计，最多每 3 秒 1 条；
     ② 只对当前选中会话：未选服务端、或当前没有选中会话 → 不发；
     ③ 只有当前会话确实亮着橙灯才发；发完乐观地把该会话从本地未读集合
       摘掉（橙灯立即灭），此后不再发。 */
const ACT_MIN_MS = 3000;              /* ① 全局节流窗口：3 秒 */
let lastActAt = 0;                    /* 上次成功上报时刻（全局） */
function actCurConv(){                /* 当前选中会话 {title,sid}，无则 null */
  const convs = ((S.snap || {}).convs) || [];
  for (const r of convs) if (r && r[0] === 'c' && r[2])
    return {title: (r[1] || '').trim(), sid: r[4] || ''};
  return null;
}
function actCurUnread(cv){            /* ③ 当前会话是否亮着橙灯（ID 优先，回退标题） */
  const s = S.snap || {};
  if (Array.isArray(s.conv_unread_ids))
    return cv.sid ? s.conv_unread_ids.indexOf(cv.sid) >= 0 : false;
  return (Array.isArray(s.conv_unread) ? s.conv_unread : []).indexOf(cv.title) >= 0;
}
function actClearLocal(cv){           /* ③ 发后乐观清本地未读 → 灯灭即停 */
  const s = S.snap || {};
  if (Array.isArray(s.conv_unread_ids) && cv.sid)
    s.conv_unread_ids = s.conv_unread_ids.filter(x => x !== cv.sid);
  if (Array.isArray(s.conv_unread))
    s.conv_unread = s.conv_unread.filter(x => x !== cv.title);
  S.convs_key = null;                 /* 未读变化 → 指纹重算 → 橙灯立即灭 */
  renderConvs(s.convs || [], s.conv_unread, s.conv_unread_ids);
}
function actSend(k){
  if (!S.cur) return;                 /* ② 未选服务端不发 */
  const cv = actCurConv();
  if (!cv || !cv.title) return;       /* ② 当前没有选中会话不发 */
  if (!actCurUnread(cv)) return;      /* ③ 橙灯没亮不发 */
  const now = Date.now();
  if (now - lastActAt < ACT_MIN_MS) return;   /* ① 全局 3 秒节流 */
  lastActAt = now;
  sendJson({t: 'act', k: k, title: cv.title, sid: cv.sid});
  actClearLocal(cv);                  /* ③ 清完即停 */
}

/* ===== 2.18 锚定：网页版守住自己锚定的会话，不跟随别人在电脑版的切换 ===== */
function selSidOf(v){
  const cs = (v && v.convs) || [];
  for (const r of cs) if (r && r[0] === 'c' && r[2]) return r[4] || '';
  return '';
}
function selTitleOf(v){
  const cs = (v && v.convs) || [];
  for (const r of cs) if (r && r[0] === 'c' && r[2]) return r[1] || '';
  return '';
}
function hasSidIn(v, sid){
  const cs = (v && v.convs) || [];
  return cs.some(r => r && r[0] === 'c' && (r[4] || '') === sid);
}
/* ===== 2.74：T16「锚定上报」——网页端自己选中的会话发生变化那一刻，把锚定上报
   给服务端：{t:'anchor', sid:完整sid（空串=取消）, key:终身号稳定键, title:会话名}。
   去重（同一锚定不重复发）+ ≥300ms 节流（连点合并、只发最后一次）；异常一律吞掉，
   绝不因此报错。调用点：会话列表.js（用户点会话换锚）、adoptSnap（首次自动锚定/
   锚定标题·完整sid变更）、电脑名册.js（切服务端清锚→sid:''）。 */
/* 2.100（老板 2026-10-20 12:16 口径）：锚定【持久化】——刷新、退出再进入、掉线重连
   后继续锚定「当前会话」，绝不套用更旧的、绝不回退上一个会话（老板 10:01：
   「切换＝锚定，失败也不回退」）。存 localStorage（键不含版本号 ⇒ 换代不清锚）。 */
const LS_ANCHOR = 'trae_webm_anchor';
function anchorPersist(){
  try {
    if (S.anchorSid || S.anchorFull || S.anchorTitle)
      localStorage.setItem(LS_ANCHOR, JSON.stringify(
        {key: S.anchorSid || '', title: S.anchorTitle || '',
         full: S.anchorFull || '', ts: Date.now()}));
    else localStorage.removeItem(LS_ANCHOR);
  } catch(e){}
}
function anchorRestore(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_ANCHOR) || 'null');
    if (!o || !o.key) return false;
    S.anchorSid = o.key || ''; S.anchorTitle = o.title || '';
    S.anchorFull = o.full || ''; S.anchor_gone = '';
    return true;
  } catch(e){ return false; }
}
let anchorRepT = 0, anchorRepSig = null;
function anchorReport(){
  try { anchorPersist(); } catch(e){}   /* 2.100：锚定一变即落盘（含清锚） */
  clearTimeout(anchorRepT);
  anchorRepT = setTimeout(() => {
    try {
      const sid = S.anchorFull || '', key = S.anchorSid || '', title = S.anchorTitle || '';
      const sig = sid + '\n' + key + '\n' + title;
      if (sig === anchorRepSig) return;      /* 去重：同一锚定不重复上报 */
      anchorRepSig = sig;
      sendJson({t: 'anchor', sid: sid, key: key, title: title});
    } catch(e){}
  }, 300);
}
/* 2.88（老板 2026-10-19 23:55 口径）：锚定冻结时效阈值——锚定会话被“借框/后台挪走”
   的短暂几拍（< 此值，即一次借框时长内）仍原样固定旧内容（老板明确「借走那几秒固定住
   旧内容是可以的」）；但连续被抢超过此值仍拿不到真帧时，不再无条件沿用旧 msgs（改用
   锚定会话自己的本地账本，见下方 adoptSnap），避免「桌面早已切回/更新，网页却永久钉
   在旧内容」。取值须大于一次借框时长，故给 15s。 */
const ANCHOR_FREEZE_MS = 15000;
/* 2.94（老板 2026-10-20 07:38「已上屏的记录过一会又消失」·最高优先）：快照 msgs
   单调护栏。真因：服务端每拍快照 msgs 非单调——虚拟列表只采「可见窗口」，切换/
   借框/流式重渲染的瞬时空窗被原样广播（实测同秒四拍 8→0→0→4→8、10↔8 反复），
   而网页端把每拍 msgs 当权威尾部、指纹一变即 innerHTML='' 整段重画 ⇒ 已上屏的
   行当场消失。此处对【同一锚定会话、非切换在途】的来拍做「不覆盖」保护：
   来拍 msgs 为空、或比现有 old.msgs 明显变短（条数少 ≥2）时保留现有正文。
   为不误伤合法删除/回退：① 收到 msg_act（回退/删除完成）后 2s 内一律放行变短；
   ② 同一「短帧」形态持续超过 MSGS_MONO_MS（2.5s，远大于瞬时空窗）也放行。
   只挡「空帧/明显变短」，单条合法删除（少 1 条）不在此列、本就放行。 */
const MSGS_MONO_MS = 2500;
function _msgsMonotonic(v, old){
  try {
    const nv = Array.isArray(v.msgs) ? v.msgs : null;
    const ov = (old && Array.isArray(old.msgs)) ? old.msgs : null;
    if (!nv || !ov || !ov.length) return;
    const empty = !nv.length;
    /* 2.100（老板 2026-10-20 12:14 硬原则「永远不许新的被老的覆盖」）：变短判据由
       「少 ≥2」收紧为「少 ≥1」——服务端虚拟列表只采可见窗口、`抓取轮询._单调保护`
       的陈旧帧，常恰好只少「刚进来的那 1 条新回复」（旧 ≥2 阈值正好漏掉这一条）；
       放行它 ⇒ 新回复被上一拍旧正文顶掉（老板实测「新内容被老内容覆盖」）。 */
    const shrink = nv.length < ov.length && (ov.length - nv.length) >= 1;
    if (!empty && !shrink){ S.msgs_guard_since = 0; return; }
    const now = Date.now();
    if (S.msgs_act_at && now - S.msgs_act_at < 2000){
      S.msgs_guard_since = 0; return;         /* ① 合法删除/回退：放行变短 */
    }
    if (!S.msgs_guard_since) S.msgs_guard_since = now;
    if (now - S.msgs_guard_since < MSGS_MONO_MS){
      v.msgs = ov;                            /* 瞬时空窗/明显变短：不覆盖 */
    } else {
      S.msgs_guard_since = 0;                 /* 持续短帧：认作合法删除，放行 */
    }
  } catch(e){}
}
function adoptSnap(v){
  /* 用户口径：「网页版是锚定的，它锚定哪个对话，不切换就一直显示这个
     对话」——别人在电脑版操作别的会话（含会话路由器的临时占用），网页版
     不跟着跳，甚至「不要让网页版知道自己的对话被人抢走」。
     做法：来拍快照的选中会话 != 锚定会话时，冻结正文类字段（msgs/
     inputText/ask/attach/tail…），只并入会话列表，并把选中标志改写到
     锚定行——curTitle/curSid/ensureHist/renderAll 全按锚定走，零改动。 */
  /* 2.105（最高优先·框架帧）：来帧若【无 msgs 数组】（框架帧/登录轻启动版，含
     snapN=-1）⇒ 只更新会话列表/状态/锚定，正文【绝不动】——保留上一拍已上屏的
     msgs。否则 S.snap.msgs 落到非数组 ⇒ curMsgs 回落账本 ⇒ 已上屏行消失（8→3）。 */
  if (!Array.isArray(v.msgs) && S.snap && Array.isArray(S.snap.msgs)){
    v.msgs = S.snap.msgs;
  }
  const inSid = selSidOf(v), inTitle = selTitleOf(v);
  const inKey = 稳定键(inSid, inTitle);          /* 选中会话的稳定性键＝终身号 */
  /* 未锚定（首拍）：吸附到当前选中会话（锚定键＝终身号；另记完整 sid 兜底） */
  if (!S.anchorSid && inSid){
    S.anchorSid = inKey; S.anchorTitle = inTitle; S.anchorFull = inSid;
    anchorReport();                            /* 2.74：首次自动锚定 → 上报 */
  }
  /* 本专项 A4/A6：锚定会话已不在快照会话列表（被删/认不出）→ 只提醒、
     绝不静默改锚（旧实现会把锚点悄悄挪到桌面当前选中，用户毫无察觉）。
     2026-10-16：锚定键为终身号，故按稳定性键在列表里比对。 */
  const anchorGone = !!(S.anchorSid
      && !(v.convs || []).some(r => r && r[0] === 'c'
                                    && _行稳定(r) === S.anchorSid));
  if (anchorGone){
    if (S.anchor_gone !== S.anchorSid){
      S.anchor_gone = S.anchorSid;
      flash('⚠ 当前锚定会话可能已不存在，请在会话列表重新选择', 'var(--red)', 6000);
    }
  } else if (S.anchor_gone) S.anchor_gone = '';
  /* 用户自己的切换在途：放行原快照，等切换定论（不与锚定抢）。
     2.88：放行收紧为「这拍快照的选中行正是本次切换目标」——否则（切换目标在途
     但选中行是被借框/后台挪去的“别人会话”）继续走锚定冻结，堵死「借框时把别人
     正文当切换预取整段推上屏 ⇒ 标题对/内容错」的串台旁路。目标未知（兼容旧前端
     只送序号、无 sid）时维持旧行为放行。 */
  if (S.switch_pend){
    const tgt = S.switch_pend.sid
        ? 稳定键(S.switch_pend.sid, S.switch_pend.title) : '';
    if (!tgt || tgt === inKey){
      /* 2.97（老板 2026-10-20 09:34）：切换在途、这拍正是目标会话时，对目标正文也做
         「不空/不明显变短」保护——基线＝当前【已上屏的目标正文】（仅当它已不是切换前
         旧会话 A 时才比），防虚拟列表窗口抖动把已上屏的目标帧抹成空/短帧（额外面孔）。 */
      if (S.switch_pend.lockTarget && S.anchorSid && inKey === S.anchorSid
          && Array.isArray(S.switch_pend.prevMsgs) && S.switch_pend.prevMsgs.length
          && !sameConvBody((S.snap || {}).msgs, S.switch_pend.prevMsgs))
        _msgsMonotonic(v, S.snap || {});
      return v;
    }
  }
  const old = S.snap || {};
  /* 2.88：选中行彻底认不出（inSid/inTitle 皆空，如列表中间态/组头行）时也不再
     放行——否则 inKey='' 令 stolen 恒假，桌面被借走那几拍的正文会直接推上屏。 */
  const selUnknown = !inSid && !inTitle;
  const stolen = !!(S.anchorSid
      && ((inKey && inKey !== S.anchorSid)
          || (selUnknown && Array.isArray(old.msgs) && old.msgs.length)));
  if (!stolen && !anchorGone){
    S.anchor_stale_since = 0; S.anchor_stale_n = 0;   /* 桌面回到锚定：清时效 */
    S.anchor_need_refresh = 0;                        /* 2.89：回锚即清「待刷新」 */
    /* 2.94：同一锚定会话、非切换在途 → msgs 单调护栏（防瞬时空窗把已上屏的行抹掉） */
    if (S.anchorSid && inKey === S.anchorSid && !S.switch_pend)
      _msgsMonotonic(v, old);
    return v;
  }
  /* 2.89（老板 2026-10-20 紧急 · AI 行消失最高优先）：冻结到期不再拿锚定账本盖掉
     快照正文——旧 2.88 在超阈值后 `v.msgs = _led.slice()`，账本只记终答、常缺 AI
     行 ⇒ 拿账本盖页面会把快照里已有的 AI 行整段抹掉（「AI 行突然消失」）。现一律
     【保留现有正文】old.msgs（含 AI 行），只置「待刷新」标记并节流补拉一次该锚定的
     最新历史；新行由 缓存.js curMsgs 的「只补不删」并入，绝不整段覆盖快照。 */
  const _now = Date.now();
  if (!S.anchor_stale_since) S.anchor_stale_since = _now;
  S.anchor_stale_n = (S.anchor_stale_n || 0) + 1;
  const _staleMs = _now - S.anchor_stale_since;
  v.convs = (v.convs || []).map(r => (r && r[0] === 'c')
      ? [r[0], r[1], _行稳定(r) === S.anchorSid, r[3], r[4]] : r);
  v.msgs = (Array.isArray(old.msgs) ? old.msgs : (v.msgs || []));
  S.anchor_need_refresh = (_staleMs >= ANCHOR_FREEZE_MS) ? 1 : 0;
  /* 2.89：待刷新（超阈值）→ 10s 节流补拉一次锚定会话最新历史（不覆盖正文）。 */
  if (S.anchor_need_refresh && typeof reqHist === 'function'
      && _now - (S.anchor_led_at || 0) > 10000){
    S.anchor_led_at = _now;
    try { reqHist(curTitle(), S.histHave || 0, S.histVer || 0); } catch(e){}
  }
  v.finish = old.finish;
  v.inputText = old.inputText || '';
  v.ask = old.ask || null;
  v.attach = old.attach || [];
  v.tail = old.tail;
  v.sendIdle = old.sendIdle;
  v.pend = Array.isArray(old.pend) ? old.pend : (v.pend || []);
  v.opts = old.opts || [];
  /* 锚定标题跟随锚点（列表里查到就用最新标题，改名自动同步）；顺带刷新完整 sid 兜底 */
  const arow = (v.convs || []).find(r => r && r[0] === 'c'
      && _行稳定(r) === S.anchorSid);
  if (arow){
    const _oT = S.anchorTitle, _oF = S.anchorFull;
    S.anchorTitle = arow[1] || S.anchorTitle;
    if (arow[4]) S.anchorFull = arow[4];
    /* 2.74：锚定标题/完整 sid 实际变更 → 上报（未变则 anchorReport 自身去重吞掉） */
    if (_oT !== S.anchorTitle || _oF !== S.anchorFull) anchorReport();
  }
  return v;
}

/* ================= 渲染 ================= */

function renderAll(){
  /* 2.57B：切换在途 → 用「目标会话本地存帧（或空）」覆盖正文类字段，绝不再
     显示旧会话 A 的内容（用户 2026-10-07；见 缓存.js liveOverlay）。 */
  const snap = liveOverlay(S.snap);
  skelCacheSave(snap);                 /* 2.20：骨架缓存写回（秒开列表） */
  ensureHist();                        /* 2.20：本地历史秒开+请求式增量 */
  renderConvs(snap.convs || [], snap.conv_unread, snap.conv_unread_ids);
  /* 1.24：过滤「安装 TRAE Code」类安装引导按钮（误点无意义；
     服务端已滤，此处双保险兼容旧服务端）。1.25：diff 审查
     （N 个文件待审查/全部撤销/全部保留）与「后台命令正在运行」
     状态钮同样不是 AI 提问，一并滤掉。 */
  const opts0 = (snap.opts || [])
    .filter(o => !/安装/i.test(o.t || '') || !/trae/i.test(o.t || ''))
    .filter(o => {
      const t = o.t || '';
      if (/待审查|后台命令/.test(t)) return false;
      if (/^(全部)?(撤销|保留)$/.test(t)) return false;
      return true;
    });
  /* 2.57B：切换在途不并入账本（账本可能仍是旧会话的），只认存帧/空。
     2.89：过渡期锁死目标会话（_liveLockOn）——网页端自己发起切到 B 后，B 的
     真内容未上屏前一律取 B 的帧，快照里仍是 A 的正文绝不上屏。
     2.106（老板 2026-10-20 17:29「切换即清屏」）：发起切换【立刻清屏】——screen
     只允许「目标落地快照 / 已确认的目标真内容 / 留白」三种，绝不再用「持屏」按住
     旧会话 A 的画面（旧 2.97「维持现画面重放」已废）；swHold 仅在目标快照上屏后
     用于防中间态闪回（保 2.89 防交叉闪现）。见下方分支。 */
  const _locked = _liveLockOn();
  const _lf = S.liveFrame;
  const _storeMsgs = (_locked && _lf && Array.isArray(_lf.msgs) && _lf.msgs.length)
      ? _lf.msgs : null;
  /* 2.100（老板 2026-10-20 12:14 硬原则）：持屏闸只在「尚无新内容」时生效——一旦
     锚定会话【自己的快照正文】已比存帧更新（非切换前旧正文、尾部更靠后），立即让位，
     绝不拿旧存帧顶掉已到的新内容。 */
  const _spu = S.switch_pend;
  const _snapIsTarget = (_spu && _spu.lockTarget)
      ? !sameConvBody((S.snap || {}).msgs, _spu.prevMsgs) : true;
  const _curNow = _locked ? curMsgs() : null;
  const _tailKeyOf = a => (a && a.length) ? _msgKey(a[a.length - 1]) : '';
  /* 2.105（03-P3）：让位判定放宽为「尾部消息身份不同即让位」——去掉旧的
     `_curNow.length >= _storeMsgs.length` 条数限制。原判据在锚定会话发生【合法删除/
     回退（变短）】时不满足 `>=` ⇒ 不让位 ⇒ 页面继续显示「比真实更旧/更长」的旧存帧；
     真帧若更短、尾部身份不同，同样必须立即让位（绝不用旧存帧顶掉已到的新内容）。
     2.106：curMsgs 已在「切换在途且快照正文仍属旧会话」时切断回落（返回 []），
     故 _curNow 非空即「已确认是目标」，让位永不误放旧会话 A。 */
  const _targetNewer = !!(_curNow && _curNow.length
      && _snapIsTarget
      && _tailKeyOf(_curNow) !== _tailKeyOf(_storeMsgs || []));
  /* 2.106：目标落地快照上屏 → 置 swPPainted/swHold（此后再出现中间态方可原样重放防闪回）。 */
  const _markSwPainted = () => { S.swPPainted = true; S.swHold = true; };
  const _replayLast = () => renderMsgs(S.msgs_last[0], S.msgs_last[1],
      S.msgs_last[2], S.msgs_last[3], S.msgs_last[4]);
  if (_locked){
    /* 2.106（A·老板 2026-10-20 17:29「切换即清屏，只显目标快照，无则空白」）：
       切换在途正文只允许「目标落地快照 / 已确认的目标真内容 / 留白」三种，绝不重放旧会话 A：
       ① 目标真内容已到（_targetNewer，携已确认目标身份）→ 立即让位上屏（保 2.100）；
       ② 否则有目标落地快照 → 顶它（这就是老板要的「看着快照减少烦躁」）；
       ③ 目标真帧已在快照里（arrived）→ 顶上（2.101 防刷新/重连补发 switch 后整屏长留白）；
       ④ 目标快照上过屏后才有中间态 → 原样重放它（防闪回，保 2.89）；
       ⑤ 其余 → 清屏留白（【绝不放】旧会话正文）。 */
    if (_targetNewer){
      renderMsgs(_curNow, snap.finish, opts0, snap.ask || null, snap.pend || []);
      _markSwPainted();
    } else if (_storeMsgs){
      renderMsgs(_storeMsgs, snap.finish, opts0, snap.ask || null, snap.pend || []);
      _markSwPainted();
    } else if (_spu && _spu.arrived
               && Array.isArray((S.snap || {}).msgs) && S.snap.msgs.length){
      renderMsgs(S.snap.msgs, snap.finish, opts0, snap.ask || null, snap.pend || []);
      _markSwPainted();
    } else if (S.swPPainted && Array.isArray(S.msgs_last) && S.msgs_last.length === 5){
      _replayLast();                           /* 目标快照已上过屏：中间态重放它，防闪回 */
    } else {
      renderMsgs([], snap.finish, opts0, snap.ask || null, snap.pend || []);
    }
  } else {
    const _cur = curMsgs();
    if (_cur.length){                      /* (b) 目标当前全量最新帧上屏 → 松开持屏 */
      renderMsgs(_cur, snap.finish, opts0, snap.ask || null, snap.pend || []);
      S.swHold = false;
    } else if (S.swHold && S.swPPainted
               && Array.isArray(S.msgs_last) && S.msgs_last.length === 5){
      /* 2.106：仅「已上屏目标快照之后」才原样重放（防闪回）；此前一律不重放旧会话 */
      _replayLast();
    } else {
      renderMsgs([], snap.finish, opts0, snap.ask || null, snap.pend || []);
    }
  }
  renderState(snap);
  revertRefill(snap);              // 1.62：撤回后把被撤回的话补回输入框
  renderAttach(snap.attach || []);
  syncModel(snap.model || '');
}

