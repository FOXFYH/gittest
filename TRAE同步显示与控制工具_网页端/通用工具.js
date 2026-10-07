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
/* 本专项 A2/A3：切换文案唯一出口——状态栏（输入界面.js）、消息区切换条
   （消息渲染.js）、会话点击提示（会话列表.js）三处共用此函数，杜绝
   「正在切换」/「正在切换到」两套文案漂移。 */
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
function resolveTimes(msgs){
  /* 2.22：时间以服务端为准——服务端快照给每条消息盖好第 6 位（已格式化的
     北京秒级串 'YYYY-MM-DD HH:MM:SS'），有则直接显示，不再本地打戳（本地
     打戳会因手机时区/首见时刻不准）。无第 6 位（老服务端/本地乐观追加行）
     回退旧本地逻辑。last 统一存「已格式化」串，AI 消息直接沿用，不再二次
     fmtTime（避免对已格式化串再解析造成时区偏移）。 */
  const cache = timesGet(), title = curTitle(), out = [];
  let last = '';
  for (const m of msgs){
    let t = '';
    if (m.length > 5 && m[5]){            // 服务端时间戳优先
      t = String(m[5]);
      if (m[0] === 'u') last = t;
    } else if (m[0] === 'u'){
      const k = S.port + '|' + title + '|' + djb2('u|' + m[1]);
      if (!cache[k]) cache[k] = new Date().toISOString().slice(0,19);
      last = fmtTime(cache[k]);
      t = last;
    } else {
      t = last;                           // AI 消息沿用其提问时间
    }
    out.push(t);
  }
  localStorage.setItem(LS_TM, JSON.stringify(cache));
  return out;
}
function curTitle(){
  /* 本专项 A5：以本地锚定为准（用户点选的会话），快照选中行仅作兜底——
     状态栏会话名与正文会话由同一锚定源产出，杜绝「横幅写 A、正文走 B」。 */
  const convs = (S.snap.convs || []);
  if (S.anchorSid){
    for (const r of convs)
      if (r[0] === 'c' && (r[4] || '') === S.anchorSid) return r[1];
    if (S.anchorTitle) return S.anchorTitle;  /* 锚点不在列表：先用锚定标题兜底（A4 已弹提醒） */
  }
  for (const r of convs) if (r[0] === 'c' && r[2]) return r[1];
  return '当前会话';
}
/* v1.95：当前会话的稳定 ID（convs 'c' 行第 5 位，TRAE 后端主键）。
   本专项 A5：锚定 sid 优先；未锚定才回退快照选中行。拿不到返回 ''。 */
function curSid(){
  if (S.anchorSid) return S.anchorSid;
  const convs = (S.snap.convs || []);
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
function adoptSnap(v){
  /* 用户口径：「网页版是锚定的，它锚定哪个对话，不切换就一直显示这个
     对话」——别人在电脑版操作别的会话（含会话路由器的临时占用），网页版
     不跟着跳，甚至「不要让网页版知道自己的对话被人抢走」。
     做法：来拍快照的选中会话 != 锚定会话时，冻结正文类字段（msgs/
     inputText/ask/attach/tail…），只并入会话列表，并把选中标志改写到
     锚定行——curTitle/curSid/ensureHist/renderAll 全按锚定走，零改动。 */
  const inSid = selSidOf(v), inTitle = selTitleOf(v);
  /* 未锚定（首拍）：吸附到当前选中会话 */
  if (!S.anchorSid && inSid){ S.anchorSid = inSid; S.anchorTitle = inTitle; }
  /* 本专项 A4/A6：锚定 sid 已不在快照会话列表（被删/认不出）→ 只提醒、
     绝不静默改锚（旧实现会把锚点悄悄挪到桌面当前选中，用户毫无察觉）。 */
  const anchorGone = !!(S.anchorSid && !hasSidIn(v, S.anchorSid));
  if (anchorGone){
    if (S.anchor_gone !== S.anchorSid){
      S.anchor_gone = S.anchorSid;
      flash('⚠ 当前锚定会话可能已不存在，请在会话列表重新选择', 'var(--red)', 6000);
    }
  } else if (S.anchor_gone) S.anchor_gone = '';
  /* 用户自己的切换在途：放行原快照，等切换定论（不与锚定抢） */
  if (S.switch_pend) return v;
  const stolen = !!(S.anchorSid && inSid && inSid !== S.anchorSid);
  if (!stolen && !anchorGone) return v;
  const old = S.snap || {};
  v.convs = (v.convs || []).map(r => (r && r[0] === 'c')
      ? [r[0], r[1], (r[4] || '') === S.anchorSid, r[3], r[4]] : r);
  v.msgs = Array.isArray(old.msgs) ? old.msgs : (v.msgs || []);
  v.finish = old.finish;
  v.inputText = old.inputText || '';
  v.ask = old.ask || null;
  v.attach = old.attach || [];
  v.tail = old.tail;
  v.sendIdle = old.sendIdle;
  v.pend = Array.isArray(old.pend) ? old.pend : (v.pend || []);
  v.opts = old.opts || [];
  /* 锚定标题跟随锚点（列表里查到就用最新标题，改名自动同步） */
  const arow = (v.convs || []).find(r => r && r[0] === 'c'
      && (r[4] || '') === S.anchorSid);
  if (arow) S.anchorTitle = arow[1] || S.anchorTitle;
  return v;
}

/* ================= 渲染 ================= */

function renderAll(){
  const snap = S.snap;
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
  renderMsgs(curMsgs(), snap.finish, opts0, snap.ask || null,
             snap.pend || []);
  renderState(snap);
  revertRefill(snap);              // 1.62：撤回后把被撤回的话补回输入框
  renderAttach(snap.attach || []);
  syncModel(snap.model || '');
}

