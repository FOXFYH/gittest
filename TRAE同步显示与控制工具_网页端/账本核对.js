'use strict';
/* 账本核对.js（网页端）  版本 1.055  日期 2026-11-24
   【1.055 通用模块清单补全（老板 2026-11-24 21:11 令）】`ledgerVcheckBuild` 上报
     模块数组由 sig/snote/macct/convs/didp/think 扩为再加 srv（服务器身份）/input
     （输入框镜像）——只在 LB.mods 有值时才报，旧帧/无值不报，绝不因「没报过」让
     服务端判缺。LB.mods 来源不变：mod 帧（含 input）写 `LB.mods[m]=v`，hello/vack
     的 mods 整体经 `lbModsSet` 覆盖（含 srv/input）。官方排队条自服务端 0.92 起
     不再单列通用模块（只属会话模块 12 条子行）。1.054→1.055。
   【1.054 账本足额同步（老板 2026-11-24 20:53 令）】新增服务端对账帧 t:'lbsync'
     处理函数 lbSyncApply（仿 lbKeepApply）：按 d.order（服务器完整全序 mid）重建
     本会话账本 msgs——本地有该 mid 用本地行、否则用 d.add 给的行（缺条只补内容，
     不盲发全部）、都不存在跳过不造假；不在 order 里的多余行丢弃；重建后
     lbSumSet/lbRowsPut/_frameMem/snap_conv 一并同步，最终两边条数/ID/顺序/内容
     一致。对应服务端「足额补发」默认模式；「智能补发」仍走原 12 条逐条比对。d.think/
     d.pend 服务端另推，不在本函数处理。1.053→1.054。
   【4.10 核对模块化重设计（老板 2026-11-24 20:24 令）】① vcheck 上报升级：
     mods.conv＝当前选中会话「12 条 ID 清单」（最近 10 条对话 mid＋思维流 1 条
     ＋官方排队条 1 条；会话模块无版本号；lbConv12Report 新函数），服务端逐条
     比对、差异条单条粒度补发（一条一帧 ledger 帧，照旧并入小账本）；旧服务端
     忽略该键不破坏兼容。② timer 静默指纹自动含 12 条 ID（mods 整体入指纹，
     逻辑不动）。③ 服务端版本号体系升级为「前缀英文+14位时间戳」（SIG/SNOTE/
     MACCT/CONVS/DIDP/THINK/PEND＋YYYYMMDDHHMMSS；思维流双版本＝绝对＋简短
     think_v），网页端只存底/回传不解释，天然兼容。
   【1.052 timer 静默令（老板 2026-11-24 19:35）】思维流变化大、经常推属正常
     高频；其余模块不该有周期性反复核对/上报。故 timer 主动核对降为**变化触发**：
     每 90s 到点先在本地按同口径构建一帧并取内容指纹（mods 全模块＋ledger 摘要
     ＋thinks＋锚定 sid），与上一条已发 timer 一致 ⇒ 不发不查（LB.lastTimerSig），
     内容变了才发。90s 周期只剩本地指纹计算的零流量开销；协议帧结构不动。
   【1.051 lbkeep 连续链裁剪】服务端 vcheck 模块化对账后下发 t:'lbkeep'
     {sid,keep:[…],del:[…]}：只删本地唯一账（snap_conv）该会话 del 里的 mid
     （keep 保留），删完重建 lbSum 与 snap_conv 记录；无该会话/空指令静默。
   【2.244 单账本（老板令·对齐 WB）】本地只留一套正文账＝snap_conv：
     ledger_conv 停写、历史轮次一次性并入 snap_conv 后清空（lbLedgerMigrateOnce →
     purgeLedgerStore，IDB_VER=3）。真存集/摘要表（vcheck 上报口径）改由 snap_conv
     的 frame.msgs 还原；落账只走 lbWriteBackSnap 写同一张表；思维流只留内存展示。
     登录/首屏 vcheck 照旧按 LB.lbSum 上报（空表也开口→服务端按 need 补缺），
     90 秒主动核对、直播帧缺正文用小账本顶上的口径全部保留。
   【2.220 预备画面同尺子】上一轮只裁本地账本（ledger_conv），① 会话预备画面
     （snap_conv）仍只增不减，老板看到卡片「N 条」超过 10 条。本版把 snap_conv
     的 frame.msgs 也按同一 N（lbRounds 默认 5）裁：lbTrimFrameMsgs 复用
     lbLedgerTrimRounds 判定（lbRoundKey 去重 + slice(-N)），写快照/合并/迁移/
     开机统一走它，卡片条数与实际留存一致。屏幕上的消息照旧显示（零拦截不变）。
   【2.219 保留轮数真正生效】老板 2026-11-20 16:21「保留最近 5 轮这个参数没起作用」：
     本地账本落账/归并/迁移/开机清理统一按 N（CFG.lb_rounds）裁 rounds——
     lbRoundKey 去重后 slice(-N)，只裁 rounds 数组，整条记录其余字段不动；
     被裁轮次记一条 `账本裁剪|键=…|裁前=n|裁后=N`（不记正文）。前端零拦截不变：
     屏幕上的消息照旧显示，裁的只是本地账本存量。
   【2.215 终身号唯一算法】标准＝24hex sid 前 4 位数字；提取失败＝会话名原样兜底；
     新增 lbUidName/lbUidAny；lbUidPick 无号时回落到会话名；桶键只用「号」或「名称」。
   【2.200 补 m=u/input 路由】
   【依据】《手机网页端账本系统V1.0总规范.md》三/六/九/十章 +
           《账本系统V1.0_TRAE协议定稿.md》（含第十一章统筹批复：
           上行 vcheck 单帧多字段、think 兼带正文、macct 按 boxes）。
   【职责】客户端侧账本核对层，一个文件装下六件事：
     ① vcheck 构造（四场景同一函数双入口：login/switch/svr/timer，
        单帧多模块版本编码上报，I2 单入口代码审查依据）；
     ② vack 两阶段回执：stage:1 → 悬浮提示「已变更选中会话，等待账本
        核对中」（复用顶部横幅，经 S.switch_pend.phase）；stage:2 →
        正式成功关提示 + 版本底账刷新 + 智能避让 20s 叠加（I3）；
     ③ mod 单模块实体帧分流（snote/sig/macct/convs/didp/ledger/think）
        ＋ set_think_int 回执 lbThinkIntAck（WS桥 0.27）；
     ④ 主动核对：默认 1 分钟周期（可配）+ 倒计时文本 lbHudText()（缓存查看器
        「③ 账本调控」区常显）＋ #lbhud 悬浮条（追加单 2026-11-18 改开关式：
        CFG.lb_hud 默认关，开关在账本调控区，开才悬浮走字）；
        智能避让（追加单修订）＝switch 发出即冻结、终态（stage:2 或 90s 失败）
        解冻重置；login/svr 完成直接按完整周期重置；旧 20s 叠加已删；
     ⑤ 本地离线倒计时：默认 120s 可配，任意用户操作重置，走完发下线
        信号（logout）；保留现有主动下线场景并新增开关（切后台下线）；
     ⑥ 本地账本（IDB ledger_conv 表，按服务端隔离）：只留最新 N 轮
        （默认 5 可配）；改名/删除会话自动清理；「自动清理无用小账本」
        开关默认勾选、14 天未查看自动删；历史按轮补发仅人类发言+终极回复
        （2.183 修2 按 V1.0 §十二-2：TRAE 无思维流补发概念，ledger_req-think
        通路已撤；按轮补发面板仅 WorkBuddy 章节适用，规范§七-3）。
     调控界面已并入 手机缓存查看器.js「③ 账本调控」tab（规范§十：
     小账本＝现成缓存查看器，禁止新造页面；原 小账本页.js 已撤销）。
   【零依赖降级】服务端未升级（无 vack/mod 帧）时：vcheck 发出无人应答
     ⇒ 走既有 switch 90s 超时兜底；本层绝不妨碍现有 snap 通路（旧协议
     全量保留，新旧并行，联调期互为兜底）。 */
const LS_LBVER = 'trae_webm_lbver';          /* 版本底账落盘（按服务端隔离） */
let LB = {reqSeq: 0, timerAt: 0, push: 0, checking: false, mods: {},
          lastTimerSig: '',                  /* 1.052（老板 2026-11-24 19:35 令·静默令）：上一条 timer 帧内容指纹——没变就不发 */
          frozen: false, frozenT: null,      /* frozen＝切换期间核对冻结（追加单 2026-11-18，取代 20s 叠加） */
          lbHave: new Set(),                 /* V2 验收 Y11：本地【真存】会话集合——ledger 上报只认它，收帧记下的版本不算存 */
          lbSum: {},                         /* 2.184 改4（规范§七 :194）：本地账本摘要表——键＝终身号，
                                                值＝{rounds, codes:[{mid, fin, hash}]}，put 成功后才记；
                                                vcheck 按它上报编码集合＋完成态＋正文指纹 */
          rows: {},                          /* 2026-11-24（老板令·只认小账本）：屏幕唯一正文源——
                                                键＝服务器|终身号（名称作兜底别名），值＝账本 rounds */
          /* 2.234（老板 2026-11-20 23:42）：原 2.227「强核对」可见反馈字段
             （vchkLog/vchkCnt）随大面板一并清除，核对状态只走横幅＋圆球。 */
          chkUntil: 0};                      /* 圆球指示窗截止时刻（四契机通用，10s） */
/* 2026-11-24（老板 10:23「网页版只需要一份小账本」）：屏幕正文只认账本 rounds。
   rows 内存表按「服务器|终身号」存、名称作兜底别名；存帧/标题兜底/预取一律不再上屏。 */
function _lbRowsKey(uid, title){
  /* 只用「终身号｜会话名」做键（不带服务器标签）：开机时服务器名可能还没到，
     带标签会导致账本装进去却查不到。单服务器日常使用下不存在串服问题。 */
  return '|' + (String(uid || '').trim() || String(title || '').trim());
}
function lbRowsPut(uid, title, rounds){
  try{
    if (!Array.isArray(rounds) || !rounds.length) return;
    const u = String(uid || '').trim(), t = String(title || '').trim();
    if (u) LB.rows[_lbRowsKey(u, '')] = rounds;
    if (t) LB.rows[_lbRowsKey('', t)] = rounds;
  }catch(e){}
}
function lbScreenMsgs(sid, title){
  try{
    const t = String(title || '').trim();
    const u = (typeof lbUidPick === 'function')
      ? String(lbUidPick(null, sid, t) || '') : '';
    const keys = [];
    if (u) keys.push(_lbRowsKey(u, ''));
    if (t) keys.push(_lbRowsKey('', t));
    /* 2.273（老板 2026-11-25 00:07 实测：小账本 10 条、主界面只 2 条）：
       uid 键与 title 键两处都可能存着账。旧写法「取第一个非空就返回」，
       若 uid 键里是旧短账本，主界面就永远只显示那一两条、比小账本少。
       改为在候选里取「末条更晚」的一份；末条同秒则取更长的一份。 */
    let best = null;
    for (const k of keys){
      const rs = LB.rows[k];
      if (!Array.isArray(rs) || !rs.length) continue;
      const out = [];
      rs.forEach(r => (r || []).forEach(m => { if (Array.isArray(m)) out.push(m.slice()); }));
      if (!out.length) continue;
      if (best === null){ best = out; continue; }
      if (_lbTailNewer(out, best)
          || (!_lbTailNewer(best, out) && out.length > best.length)){
        best = out;
      }
    }
    return best || [];
  }catch(e){ return []; }
}
function _lbSecOf(m){
  try{
    const id = String((Array.isArray(m) && m[6]) || '');
    return parseInt(id.slice(0, 8), 16) || 0;
  }catch(e){ return 0; }
}
function _lbMaxSec(rec){
  try{
    const ms = (rec && rec.frame && Array.isArray(rec.frame.msgs)) ? rec.frame.msgs : [];
    let m = 0;
    ms.forEach(x => { const v = _lbSecOf(x); if (v > m) m = v; });
    return m;
  }catch(e){ return 0; }
}
function _lbTailNewer(a, b){
  const x = (Array.isArray(a) && a.length) ? _lbSecOf(a[a.length - 1]) : 0;
  const y = (Array.isArray(b) && b.length) ? _lbSecOf(b[b.length - 1]) : 0;
  return x > y;
}
let lbLastAct = Date.now();                  /* 离线倒计时锚点（任意操作重置） */
let _lbHudEl = null, _lbSnapAt = 0;          /* #lbhud 悬浮条（开关式默认关，追加单 2026-11-18） */

/* ================= 配置读取（调控界面在缓存查看器「③ 账本调控」区） ================= */
function lbPeriodMs(){ const v = parseInt(CFG.lb_period) || 90; return Math.max(15, v) * 1000; }   /* 2.241：兜底 60→90 */
function lbOfflineSecs(){ return Math.max(15, parseInt(CFG.lb_offline) || 120); }
function lbRounds(){ return Math.min(50, Math.max(1, parseInt(CFG.lb_rounds) || 5)); }

/* ================= 版本底账（每服务端一份；客户端不重算指纹，
   只存服务端下发过的 ver 做比对——协议定稿 2.1 明文） ================= */
function lbVerLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {};
    LB.mods = o[lbSrvKey()] || {};
  } catch(e){ LB.mods = {}; }
  if (!LB.mods.ledger) LB.mods.ledger = {};
  LB.lbHave = new Set();                     /* 换服务端/重登：真存集按当前服务端重算 */
  lbHaveLoad();
}
/* V2 验收 Y11（2026-11-18）：开机异步预载 IDB ledger_conv → LB.lbHave。
   「版本底账（LB.mods.ledger，服务端下发过什么）」与「本地真存（IDB 里
   实际留着谁）」是两本账：mod ledger 收帧只记版本、可能没落盘成功；清理
   （lbCleanGone/14 天过期）删了盘但版本底账还在。上报若只看版本底账，
   就会替已经不存在的本地账本申报版本（only1 判定被污染）。
   2.184 改4：同步重建 LB.lbSum（摘要表，键＝终身号）——vcheck 上报取它。 */
function lbHaveLoad(){
  /* 2.244（老板令·一套账）：真存集（LB.lbHave）与摘要表（LB.lbSum，vcheck 上报
     口径）的唯一数据源改为 snap_conv——第二本账 ledger_conv 已停写清空。
     每条存帧按「u 起一轮」还原 rounds，编码/完成态/正文指纹照旧由 lbSumOf 现算。 */
  try {
    return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      /* 2026-11-24：同一会话可能残留多条存帧（旧 sid/同名）——按「最新一条消息的
         mid 时间」升序装，后写覆盖前写 ⇒ 内存账本永远是最新的那一份。 */
      (rows || []).slice().sort((a, b) => _lbMaxSec(a) - _lbMaxSec(b)).forEach(rec => {
        try {
          const fr = rec && rec.frame;
          if (!fr || !Array.isArray(fr.msgs) || !fr.msgs.length) return;
          const t = String(rec.title || '').trim();
          if (!t) return;
          const rounds = lbRoundsFromMsgs(fr.msgs);
          if (!rounds || !rounds.length) return;
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function' ? String(lbUidPick(null, rec.sid, t) || '') : '');
          if (u) LB.lbHave.add(u);
          lbSumSet(u || String(rec.sid || ''), t, rounds);
          lbRowsPut(u, t, rounds);            /* 2026-11-24：开机把账本 rounds 装进屏幕唯一源 */
        } catch(e){}
      });
      return Object.keys(LB.lbSum || {}).length;
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}
/* 2.244（老板令·一套账，对齐 WB 2.49/2.50）：ledger_conv 历史轮次一次性并入
   唯一正文账 snap_conv，随后清表并置 LS 标记（一生只跑一次，幂等可重跑）。
   「只进不退」由 lbWriteBackSnap/_frameCommit 既有闸把关，绝不覆盖更新的真快照。 */
const LS_LB_MIG_244 = 'trae_webm_lb_mig_244';
let _lbMig244P = null;
/* 2.209（老板口径「时间只从消息ID里算，不准再传时间」）：账本/画面缓存清理——
   把每行 m[2] 一律清成空串（历史遗留的抓屏/接口时间也清掉），账本不存任何时间。
   显示/排序一律在读取时按该行 mid 现算（timeFromMid）。幂等，写回只在真改过时发生。 */
let _lbTimeFixAt = 0;
function lbTimeBackfill(days){
  try {
    if (Date.now() - _lbTimeFixAt < 5 * 60 * 1000) return Promise.resolve(0);
    _lbTimeFixAt = Date.now();
    const cut = Date.now() - Math.max(1, Number(days) || 2) * 24 * 3600 * 1000;
    /* 2026-11-24（老板令·只留一本账）：ledger_conv 已退役，这里只清 snap_conv。 */
    return Promise.resolve([]).then(rows => {
      let n = 0;
      const tasks = [];
      /* 2.209：画面缓存 snap_conv 同步清理——把每行 m[2] 清空，
         不碰 sk/frame 其它字段，幂等可重复。 */
      const _snapTask = _idbReq('snap_conv', 'readonly', st => st.getAll()).then(srows => {
        const puts = [];
        (srows || []).forEach(rec => {
          const fr = rec && rec.frame;
          if (!fr || !Array.isArray(fr.msgs)) return;
          let ch = false;
          fr.msgs.forEach(m => {
            if (!Array.isArray(m)) return;
            if (m[2] !== ''){ m[2] = ''; ch = true; }   /* 2.209：不存时间 */
          });
          if (ch) puts.push(_idbReq('snap_conv', 'readwrite', st => st.put(rec)).catch(() => {}));
        });
        return Promise.all(puts).then(() => puts.length);
      }).catch(() => 0);
      return Promise.all(tasks.concat([_snapTask])).then(() => {
        if (n) { try { diagLog('账本时间回补 ' + n + ' 本（最近 ' + (Number(days) || 2) + ' 天）', 'ok'); } catch(e){} }
        return n;
      });
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}
/* 2.184 改4（规范§七 :194 同号不同态）：本地账本摘要——每会话算
   {rounds, codes:[{mid, fin, hash}]}（编码＋完成态指纹＋正文指纹），
   供 vcheck 上报；键＝终身号（lbKey 同口径）。FNV-1a 32 位，够区分不追求密码学。 */
function lbHash(s){
  try {
    let h = 0x811c9dc5;
    const t = String(s == null ? '' : s);
    for (let i = 0; i < t.length; i++){ h ^= t.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  } catch(e){ return ''; }
}
function lbSumOf(rounds){
  /* 2.184 契约（2026-11-19 统筹/S1 定死·上行 mods.ledger.codes 唯一形态）：
     {mid:<hex>, fin:0|1, hash:<8位hex FNV>}——fin 必须是 0/1 整数（完成卡摘要
     非空=1，空=0），不许传字符串（服务端 int() 会抛 → 整会话恒判缺）；
     hash 对「完成卡正文，没有则回退当前正文」（a[7] || a[1]）计算。 */
  const rs = Array.isArray(rounds) ? rounds : [];
  const codes = [];
  /* 2.185（老板 2026-11-19 令·四类标识）：上报集合只收 m[0]==='a' 的已认证
     终极轮；th/snap（思维流，含与终极同号的 TRAE 快照）永不进上报——否则
     服务端看号已存在误判不缺，终极永远补不下来。rounds 计数＝已认证轮数。 */
  rs.forEach(r => {
    const a = (r && r.length) ? r[r.length - 1] : null;
    if (!a) return;
    if (String(a[0] || '').toLowerCase() !== 'a') return;
    codes.push({mid: String(a[6] || ''),
                fin: (String(a[7] || '').trim() ? 1 : 0),
                hash: lbHash(a[7] || a[1] || '')});
  });
  return {rounds: codes.length, codes: codes};
}
function lbSumSet(sid, title, rounds){
  try {
    const s = String(sid || '');
    const t = String(title || '').trim();
    /* 2.184 改7（老板终版口径·锚定双轨）：名称必有、sid 可缺——没有名称的
       一概不记账（摘要表是上报口径，宁缺不猜）；sid 缺就按名称键记。
       2.214：键与服务端可解析口径对齐——有权威终身号用终身号，否则用会话名。 */
    if (!t) return;
    let u = '';
    try { u = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : ''; } catch(e){ u = ''; }
    LB.lbSum[u || t] = lbSumOf(rounds);
  } catch(e){}
}
function lbVerSave(){
  try {
    const o = {};
    try { o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {}; } catch(e2){}
    o[lbSrvKey()] = LB.mods;
    localStorage.setItem(LS_LBVER, JSON.stringify(o));
  } catch(e){}
}
function lbSrvKey(){ return String(S.cur || '默认'); }
/* 2.184 改8（老板令·服务器隔离过滤）：本服标识＝FOX 号优先（登录应答/帧内
   srv_sid 自报，S.curSid），拿不到才退回服务器名。小账本键一律
   「L<本服标识>:<终身号或t:名称>」；同一终身号在别的服务器上是另一本账，
   绝不合并。旧格式键（'lb|名|…'，无 L 前缀）＝未知服务器：保留只读、
   不再并入、不再清理、不再上报。 */
function lbSrvTag(){
  /* 2.264（老板 2026-11-24「刷新后又看不到、读旧存新」真因）：本服标识必须**稳定**。
     旧写法 S.curSid||S.cur||'默认'——一刷新/等 hello 时 S.curSid、S.cur 都会短暂为空，
     同一本账当场被算成「默认」或别的服务器，列表里就看不见了。
     新口径：① 有 FOX 号→用号，并按服务器名记下「名→号」（同一台机反复进出不再漂移）；
             ② 只有服务器名→用该名记过的号，退而用名；
             ③ 身份都还没到→用上次记下的号；实在没有才「默认」。 */
  var nm = '', fox = '';
  try { nm = String((typeof S !== 'undefined' && S && S.cur) || '').trim(); } catch(e){}
  try { fox = String((typeof S !== 'undefined' && S && S.curSid) || '').trim(); } catch(e){}
  try {
    if (fox && nm) localStorage.setItem('trae_webm_srvfox|' + nm, fox);
    if (fox){ localStorage.setItem('trae_webm_srvfox_last', fox); return fox; }
    if (nm){
      var v = localStorage.getItem('trae_webm_srvfox|' + nm);
      if (v) return String(v);
      return nm;
    }
    var last = localStorage.getItem('trae_webm_srvfox_last');
    if (last) return String(last);
  } catch(e){}
  return '默认';
}
/* 2.189（老板令·小账本卡片显示服务器归属）：落盘与展示共用同一对取值函数——
   srvFox＝本服 FOX 号（hello 自报，S.curSid），srvName＝服务器名（S.cur，
   与 lbSrvKey 同源）。读写必须走同一函数同一值，绝不「读 A 存 B」。 */
function lbSrvFox(){ return String(S.curSid || '').trim(); }
function lbSrvName(){ return String(S.cur || '').trim(); }
function lbIsLegacyRec(r){
  return !(r && typeof r.sk === 'string' && r.sk.indexOf('L') === 0
           && String(r.srv || '') === lbSrvTag());
}
/* 2.215（老板 2026-11-20 09:11 终身号唯一算法·与 WS桥 0.57 逐字同口径）：
     ① 标准终身号＝sid 恰 24 位小写十六进制且前 4 位全数字 → 前 4 位（如 0047）；
     ② 提取失败（非 24hex / 前 4 位含字母 / 10 位实例号）→ **会话名称原样**兜底；
     ③ 两者都没有 → 显示「终身号未登记」（只显示，不拦截）。
   账本桶键只有两种：标准号 → 'L<本服>:<号>'；名称兜底 → 'L<本服>:t:<名称>'。
   禁止拿完整 sid / 实例号 / 名字哈希派生键，也禁止「重复/(2)/_2」后缀造新桶。 */
function lbUidAuth(v){
  const u = String(v == null ? '' : v).trim();
  if (!/^\d{4}$/.test(u)) return '';          /* 非 4 位数字（含名称兜底）不认 */
  if (_lbIsSrvAcctLike(u)) return '';         /* 实例号/1632 不是终身号 */
  return u;
}
/* 2.215：服务端下发/本地标题里的**名称兜底终身号**——不是标准 4 位号，也不是
   完整 sid / 实例号；去掉「（临时）/（按名称）」显示后缀后原样返回。 */
function lbUidName(v){
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (lbUidAuth(s)) return '';                 /* 标准号不是名称 */
  if (/^\d{4}$/.test(s)) return '';            /* 4 位数字一律按编号处理（含 1632 假号） */
  if (/^\d{10}$/.test(s)) return '';           /* 10 位实例号 */
  if (/^[0-9a-f]{24}$/i.test(s)) return '';    /* 完整 sid 绝不当身份键 */
  s = s.replace(/\s*（临时）\s*$/, '').replace(/\s*（按名称）\s*$/, '').trim();
  return s;
}
function lbUidAny(v){ return lbUidAuth(v) || lbUidName(v); }
function lbStoreKey(uidOrSid, title){
  const t = (typeof lbNormTitle === 'function')
    ? lbNormTitle(title) : String(title || '').trim();
  const u = lbUidAuth(uidOrSid);
  if (u) return 'L' + lbSrvTag() + ':' + u;
  /* 名称兜底：服务端下发的名称优先，其次会话名（同名一律同一桶） */
  const n = lbUidName(uidOrSid) || t;
  return 'L' + lbSrvTag() + ':t:' + n;
}
/* ============ 2.213（老板 2026-11-20「最终合并版」·前端零拦截）============
   前端只是显示器：后端发什么就原样显示、原样落盘——不判断、不筛选、不拦截、
   不丢弃、不改名、不推断。凡是「收不收／删不删／算不算」的判断一律归后端
   （后端已有 ID 校验）。本文件已撤的闸门：
     · 假会话 ID / 缺 mid 不入账（lbSidValid／lbRowHasId 及三处入口调用）；
     · 按轮过滤缺 ID 的行（lbRoundIdFilter）；
     · 按 index8/index7 推断终极/思维流（lbMsgKind／lbTagKind）；
     · 前端升格提前终极（lbPromoteEarlyFinals，改以后端 early_final/index11 显示）；
     · 开机清理/迁移临时账本（lbCleanupTempLedgers 不再自动触发，见文件尾）；
     · 按保留轮数裁剪（落账不再 slice(-lbRounds)）。
   注（2.219）：上一条「不按轮裁」指的是**不拒收、不丢当前屏内容**；老板
   2026-11-20 16:21 令「保留最近 N 轮必须真正生效」——本地账本存量改由
   lbLedgerTrimRounds 按 N 裁（只裁 rounds 数组），屏幕消息一律照旧显示。
   保留（属「显示/正确性」而非拦截）：换行/转义等最小格式化；排版规则
   （思维流画虚线框、终极回复不进虚线框）；去重/幂等（同 mid 重复帧不重复插入）；
   无合法 mid 不显示时间（只空该字段，其余内容照常）。 */
/* 2.210（老板 2026-11-20 07:08 令·彻底消灭 1632 假终身号）：
   服务端实例号＝hello 自报的 srv_sid（本机 1632115233），它和它的任何截断
   （如 1632）都**不是**会话编号/终身号。会话编号只认：
     ① 原始会话 sid（≥8 位，如 24 位 hex）的前 4 位数字（真终身号）；
     ② 服务端下发、来自共享库的 4 位真终身号（且不是实例号截断）；
     ③ 24 位十六进制会话 sid。
   命中实例号或其截断 ⇒ 返回空并记 `假终身号 拒建账|来源=<帧型>|原值=<值>`。 */
function _lbSrvAcctId(){
  try { return String((typeof S !== 'undefined' && S && S.curSid) || '').trim(); }
  catch(e){ return ''; }
}
function _lbIsSrvAcctLike(v){
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  const acct = _lbSrvAcctId();
  if (acct && s === acct) return true;
  /* 实例号的任何截断：4~10 位纯数字且确为该实例号前缀 */
  if (acct && /^\d{4,10}$/.test(s) && acct.indexOf(s) === 0) return true;
  /* 老板点名的假号 1632（即使当前实例号尚未自报也拒） */
  return s === '1632';
}
let _lbFakeIdT = 0, _lbFakeIdV = '';
function _lbFakeIdLog(src, val){
  const now = Date.now(), v = String(val == null ? '' : val).trim();
  if (now - _lbFakeIdT < 10000 && v === _lbFakeIdV) return;   /* 10 秒同值节流 */
  _lbFakeIdT = now; _lbFakeIdV = v;
  try { diagLog('假终身号 拒建账|来源=' + String(src || '未知')
    + '|原值=' + v, 'bad'); } catch(e){}
}
/* 2.210/2.211：假账本判据——服务端实例号派生的账本/预备画面一律视为假桶。 */
function _lbFakeLedgerRec(rec){
  if (!rec || typeof rec !== 'object') return false;
  const uid = String(rec.uid || '').trim();
  const sid = String(rec.sid || '').trim();
  /* ① sid 本身是 10 位纯数字＝服务端实例号格式，绝不是会话 sid */
  if (/^\d{10}$/.test(sid)) return true;
  /* ② uid 命中实例号或其截断（含 1632）＝假终身号（2.211：不再用 sid 前 4 位
       做任何豁免——终身号只认权威字段，禁止字符串切片推导） */
  if (_lbIsSrvAcctLike(uid)) return true;
  /* ③ uid 为空但 sid 命中实例号 */
  if (_lbIsSrvAcctLike(sid)) return true;
  return false;
}
/* 2.213：lbSidValid／_lbNoIdLog／lbRoundIdFilter 已撤——不再按「假会话 ID」
   「缺 mid」拒收或过滤，收不收由后端判断，前端只显示/落盘。 */
/* 2.212（老板 2026-11-20 07:28 bug①）：终极回复的**唯一判据**——命中即 final，
   任何地方（尤其虚线思维流框）绝不再把它当 think。命中任一：
     · 完成卡摘要 index7 非空（标准 fin/rounds 终态都会写它）；
     · 行级补记标记（index8='patched' / index10=1）；
     · 服务端已下发 index8='a'/'final'（权威类型）。 */
function lbIsFinalRow(m){
  if (!Array.isArray(m)) return false;
  if (String(m[0] || '').toLowerCase() !== 'a') return false;
  const k = String((m.length > 8 && m[8]) || '').toLowerCase();
  if (k === 'a' || k === 'final' || k === 'patched') return true;
  if (lbPatchMarked(m)) return true;
  return String((m.length > 7 && m[7]) || '').trim() !== '';
}
/* 2.213：lbMsgKind 已撤——类型一律以后端 index8 为准，前端不再按
   index7／index8 推断「终极 or 思维流」；缺类型显示「类型未知」。 */
/* ============ 2.204（C·老板 22:42 令）：本轮终极（补记） ============
   AI 还在思维流、终极回复未产生时人类又问新问题，残缺血思维流页不会再生长——
   服务端把它判为「本轮终极（补记）」下发。客户端识别标记后：把这段残缺思维流
   与人类那句凑成一轮入账，**不再把不完整轮掐掉**（2.202 已撤半轮丢弃，此处不回归）。
   兼容服务端可能的多种承载形态（任一命中即视为补记）：
     · 轮级/条目级布尔：patched / fin_patch / final_patch / interrupt_final /
       terminal_patch / recovered / 补记（值为 1/'1'/true）
     · 行级：m[8]==='patched' 或 m[10]===1
   标记只影响「是否按终极落账」，不改正文、不造名、不新增拒收闸门。 */
const LB_PATCH_KEYS = ['patched', 'fin_patch', 'final_patch', 'interrupt_final',
                       'terminal_patch', 'recovered', '补记'];
function lbPatchFlag(v){
  if (!v || typeof v !== 'object') return false;
  for (const k of LB_PATCH_KEYS){
    const x = v[k];
    if (x === true || x === 1 || x === '1' || x === 'true') return true;
  }
  return false;
}
function lbPatchMarked(m){
  if (!Array.isArray(m)) return false;
  if (String(m[8] || '').toLowerCase() === 'patched') return true;
  return (m.length > 10 && (m[10] === 1 || m[10] === '1' || m[10] === true));
}
/* 2.213：lbPromoteEarlyFinals／lbTagKind 已撤——「提前终极回复」不再由前端
   升格：后端已落 index8=a 且带 early_final=1（list 行 index11=1），前端只据此显示
   「AI 终极回复（提前）」（见 手机缓存查看器.js）；行类型也不再回写 index8。 */
/* 四字段之一：uid＝终身号（只认权威来源，取不到即空＝未登记）；sid＝对话ID
   （原始会话 id，锚定路只有终身号时从会话列表反查）。title＝会话名（必有）。
   2.211（老板 2026-11-20 07:08）：**禁止任何字符串切片推导终身号**——
   本函数只做「无权威字段即返回空」，绝不再从 sid 截前 4 位。 */
function lbUidOf(sid){
  /* 2.214：终身号只认后端权威 uid——本函数只回落到会话列表/别名里的权威值，
     绝不切片、不推导、不判真假。 */
  try { return lbUidFromConvs(sid, '') || ''; } catch(e){ return ''; }
}
/* 2.204（B3·名字→编号别名映射）：只做映射，不改历史记录。同一本服的「会话名→终身号」
   持久化到 localStorage；后续只带名字（无号/假号）的帧按别名回锚，0023 与
   人事部长ST 落同一本账。与服务端「改名」口径一致：同名最新号覆盖旧号。 */
const LS_LB_ALIAS = 'trae_webm_lb_alias';
function lbAliasLoad(){
  try { return JSON.parse(localStorage.getItem(LS_LB_ALIAS) || '{}') || {}; }
  catch(e){ return {}; }
}
function lbAliasSave(o){
  try { localStorage.setItem(LS_LB_ALIAS, JSON.stringify(o || {})); } catch(e){}
}
function lbAliasGet(title){
  const t = String(title || '').trim();
  if (!t) return '';
  const o = lbAliasLoad(), m = o[lbSrvKey()] || {};
  const u = String(m[t] || '');
  /* 2.210：历史别名里可能存过假号 1632/实例号截断，读到也一律不认 */
  return (/^\d{4}$/.test(u) && !_lbIsSrvAcctLike(u)) ? u : '';
}
function lbAliasSet(uid, title){
  const u = String(uid || '').trim(), t = String(title || '').trim();
  /* 2.210：假号/实例号截断绝不写进别名映射 */
  if (!/^\d{4}$/.test(u) || !t || _lbIsSrvAcctLike(u)) return;
  const o = lbAliasLoad();
  const k = lbSrvKey();
  const m = o[k] || (o[k] = {});
  if (m[t] === u) return;
  m[t] = u;
  lbAliasSave(o);
}
/* 2.215：从服务端会话列表（convs_full / convs 行 / sig 帧）取权威 uid——
   标准 4 位终身号与名称兜底都收；完整 sid / 实例号不认。 */
function lbUidFromConvs(sid, title){
  const s = String(sid || '').trim(), t = String(title || '').trim();
  try {
    const cf = (S.snap && Array.isArray(S.snap.convs_full)) ? S.snap.convs_full : [];
    for (const o of cf){
      if (!o) continue;
      const u = lbUidAny(o.uid);
      if (!u) continue;
      const osid = String(o.sid || ''), ot = String(o.title || '');
      if ((s && osid === s) || (t && ot === t)) return u;
    }
  } catch(e){}
  try {
    const cv = (S.snap && Array.isArray(S.snap.convs)) ? S.snap.convs : [];
    for (const r of cv){
      if (!Array.isArray(r)) continue;
      const u = lbUidAny(r[5]);
      if (!u) continue;
      if ((s && String(r[4] || '') === s) || (t && String(r[1] || '') === t)) return u;
    }
  } catch(e){}
  try {
    if (S.convUids && typeof S.convUids === 'object'){
      if (s && lbUidAny(S.convUids[s])) return lbUidAny(S.convUids[s]);
      if (t && lbUidAny(S.convUids[t])) return lbUidAny(S.convUids[t]);
    }
  } catch(e){}
  return '';
}
/* 2.215（老板 2026-11-20 09:11·唯一算法）：优先消费服务端下发 uid——
   标准 4 位号原样；非 4 位的名称兜底也收（按名称同一桶）；都没有才用会话名。
   完整 sid / 10 位实例号 / 「1632」绝不进身份键。 */
function lbUidPick(serverUid, sid, title){
  const u = lbUidAuth(serverUid);
  if (u) return u;
  const n = lbUidName(serverUid);
  if (n) return n;
  const a = lbAliasGet(title);
  if (a) return a;
  const c = lbUidFromConvs(sid, title);
  if (c) return c;
  /* ③ 名称兜底：会话名原样当终身号（同名同桶，无后缀） */
  const t = String(title || '').trim();
  return (typeof lbNormTitle === 'function') ? lbNormTitle(t) : t;
}
function lbRawSidOf(uid, title){
  try {
    const u = String(uid || ''), t = String(title || '');
    if (Array.isArray(S.convs)) for (const r of S.convs){
      if (!r || !r[4]) continue;
      if ((u && typeof 稳定键 === 'function' && 稳定键(r[4], r[1]) === u)
          || (t && String(r[1] || '') === t)) return String(r[4]);
    }
  } catch(e){}
  return String(uid || '');
}
function lbModsSet(m){
  LB.mods = (m && typeof m === 'object') ? m : {};
  if (!LB.mods.ledger) LB.mods.ledger = {};
  lbVerSave();
}

/* ================= ① vcheck 构造（单函数双入口，四场景共用） ================= */
/* 4.10（老板 2026-11-24 20:24 令·第四节）：会话模块无版本号，上报的就是
   「12 条 ID 清单」＝最近 10 条对话记录（5 轮＝人类+AI；最后一组还没有
   AI 终极回复时自然是 9 条）＋思维流 1 条＋官方排队条 1 条；有多少给多少，
   不凑数。数据源＝LB.rows 小账本（屏幕唯一正文源）＋思维流展示卡编号＋
   S.snap.pend 排队条 14 位 DID。异常返回 null（该拍不上报该键）。 */
function lbConv12Report(sid, title){
  try{
    const s = String(sid || ''), t = String(title || '').trim();
    if (!s && !t) return null;
    const out = [];
    const rows = (typeof lbScreenMsgs === 'function') ? lbScreenMsgs(s, t) : [];
    const chat = [];
    (Array.isArray(rows) ? rows : []).forEach(m => {
      if (!Array.isArray(m)) return;
      const r = String(m[0] || '').toLowerCase();
      if (r !== 'u' && r !== 'a') return;
      const mid = String(m[6] || '');
      if (mid) chat.push(mid);
    });
    chat.slice(-10).forEach(x => out.push(x));
    const _th = (typeof thinkCardsReport === 'function') ? thinkCardsReport() : null;
    const tid = _th ? String(_th[s] || '') : '';
    if (tid) out.push(tid);
    try{
      const pd = (S.snap && Array.isArray(S.snap.pend)) ? S.snap.pend : [];
      const pit = pd.find(it => it && it.id != null && String(it.id).trim()
                                && String(it.sid || '') === s)
        || pd.find(it => it && it.id != null && String(it.id).trim());
      if (pit) out.push(String(pit.id));
    }catch(e){}
    if (!out.length) return null;
    let key = '';
    try { key = (typeof lbUidPick === 'function')
      ? String(lbUidPick(null, s, t) || '') : ''; } catch(e){ key = ''; }
    return {sid: s, key: (key || t || s), ids: out};
  }catch(e){ return null; }
}
function ledgerVcheckBuild(act, sid){
  /* 上行单帧多模块编码（统筹批复·十-1）：编码合帧不判 FAIL，
     每模块编码独立可辨、服务端逐模块校验。 */
  const mods = {};
  const b = LB.mods || {};
  ['sig', 'snote', 'macct', 'convs', 'didp', 'think', 'srv', 'input', 'points'].forEach(k => {
    if (b[k]) mods[k] = b[k];
  });
  /* 2.184 改4（规范§七 :194 同号不同态＋「客户端上报参数」三条）：ledger 改为
     按会话上报对象 {ver, rounds, codes:[{mid,fin,hash}]}——编码集合＋完成态指纹
     ＋正文指纹全带上，服务端判缺不再只看「这个号码见过没有」（2.184 契约：
     键名必须 ver，S1 服务端同口径）。数据源＝LB.lbSum（IDB put 成功后才有＝真存），
     版本底账里记了但盘上没有的会话绝不代报（V2 验收 Y11 口径保留）。 */
  const led = {};
  const _sum = (LB.lbSum && typeof LB.lbSum === 'object') ? LB.lbSum : {};
  Object.keys(_sum).forEach(k => {
    const s = _sum[k];
    if (!s) return;
    led[k] = {ver: String((b.ledger || {})[k] || '0'),
              rounds: s.rounds | 0,
              codes: Array.isArray(s.codes) ? s.codes : []};
  });
  mods.ledger = led;                       /* ledger 按「本地真存会话（终身号）」逐会话上报 */
  mods.lb_rounds = lbRounds();             /* 规范§七：目标缓存轮数参数（统一按轮） */
  /* 4.10（老板 2026-11-24 20:24 令·第四节）：当前选中会话的 12 条 ID 清单
     （mods.conv＝{sid,key,ids}）——会话模块无版本号，核对走逐条 ID 比对、
     差异条单条粒度补发。旧服务端不认识该键自动忽略，向后兼容。 */
  try{
    const _c12 = lbConv12Report(sid,
      (typeof curTitle === 'function' ? curTitle() : ''));
    if (_c12) mods.conv = _c12;
  }catch(e){}
  const d = {t: 'vcheck', act: act, mods: mods, req_seq: ++LB.reqSeq};
  if (sid) d.sid = String(sid);
  /* 2.207（V1.0 §五-6）：对账上报本端掌握的全部消息编号——**其中包含思维流编号
     （含版本）**；服务端缺号或版本落后即补发当前最新版。卡片本身绝不进 ledger
     口径（不进 need、不参与轮次统计）。 */
  const _th = (typeof thinkCardsReport === 'function') ? thinkCardsReport() : null;
  if (_th && Object.keys(_th).length) d.thinks = _th;
  return d;
}
function ledgerVcheckSend(act, sid){
  /* 四场景同一入口：login（cliLogin）/ switch（点会话、刷新重锚）/
     svr（切服务端）/ timer（主动核对）。WS 不在线 ⇒ 静默放弃
     （switch 场景有 phase:'connecting' 提示兜底，timer 下轮再试）。 */
  try {
    if (!S.onLine || !ws || ws.readyState !== 1) return false;
    if (act === 'login' || act === 'svr') lbVerLoad();   /* 换服务端/重登：按当前服务端重载底账，绝不串用旧服务端版本 */
    const _fr = ledgerVcheckBuild(act, sid);
    /* 1.052（老板 2026-11-24 19:35 令·静默令）：timer 主动核对降为变化触发——
       本轮帧内容（mods 全模块＋ledger 摘要＋thinks＋锚定 sid）与上一条已发
       timer 完全一致 ⇒ 本地指纹没变就不发不查（纯本地构建开销，零网络流量），
       倒计时照常起算、下轮再比；内容变了（收到新帧落账/服务端底账刷新/
       思维流推进）才捎带上报。login/switch/svr 本就是变化契机不比对；
       协议帧结构一字不动，只调节奏；思维流实时推不受影响。 */
    if (act === 'timer'){
      const _sig = JSON.stringify({m: _fr.mods, th: _fr.thinks || null,
                                   sid: String(sid || '')});
      if (_sig === LB.lastTimerSig) return false;
      LB.lastTimerSig = _sig;
    }
    sendJson(_fr);
    /* 2.234（老板 2026-11-20 23:42）：核对一律不再弹框/闪条——
       用户可见的只有两处轻提示：① 顶部横幅「核对中 · 会话名」（仅用户主动
       触发的 login/switch/svr 才占用，timer 主动核对不打扰横幅）；② 顶栏
       「操控:」旁圆球变橙色闪烁（四契机全亮）。原「强核对」大面板与
       ftoast 闪条代码已整段删除，不留壳。 */
    try {
      LB.chkUntil = Date.now() + 10000;      /* 圆球指示窗（四契机通用） */
      if (act !== 'timer'){
        LB.vchkOpen = 1;
        LB.vchkEndAt = Date.now() + 10000;
        LB.vchkTitle = String((S.switch_pend && S.switch_pend.title)
                              || (typeof curTitle === 'function' ? curTitle() : '') || '');
      }
    } catch(e){}
    if (act === 'timer') LB.checking = true;
    /* 追加单 2026-11-18（规范§三「切换期间的核对冻结」）：switch 一经发出，
       主动核对倒计时立即重置并冻结，期间绝不发 timer 帧；直到本轮切换出
       终态（vack stage:2 正式成功，或 90 秒未收终态宣布失败）才解冻并按
       完整周期重新起算。90 秒＝全链路唯一口径（待办卡.js SWITCH_TIMEOUT_MS）。
       V2 第三轮 Y22：冻结改走 lbFreezeOnSwitch（幂等）——WS 未连早退路径
       不会漏冻结（pendSwitchSet 已先冻结，这里再冻结是幂等空转）。 */
    if (act === 'switch') lbFreezeOnSwitch();
    return true;
  } catch(e){ return false; }
}
/* 切换出终态（成功或失败）→ 解冻并按完整周期重新起算（规范§三） */
function lbUnfreeze(){
  try {
    clearTimeout(LB.frozenT);
    LB.frozenT = null;
    LB.frozen = false;
    LB.timerAt = Date.now() + lbPeriodMs();
  } catch(e){ LB.frozen = false; }
}
/* V2 第三轮 Y22（2026-11-19）：冻结与「vcheck 是否真发出」解耦——ST 复测
   20s 断链切换场景里 LB.frozen 全程 false（ledgerVcheckSend('switch') 因
   !S.onLine 早退，冻结块从未执行），60.76s 窗内漏进 1 条 timer。现在
   pendSwitchSet 一落笔就调本函数冻结；终态（vack stage:2 / 90s 兜底 /
   switchClear）才解冻。幂等：已在冻结中不重启兜底定时（防 90s 被拖长）。 */
function lbFreezeOnSwitch(){
  if (LB.frozen) return;
  LB.frozen = true;
  LB.timerAt = Date.now() + lbPeriodMs();
  clearTimeout(LB.frozenT);
  LB.frozenT = setTimeout(lbUnfreeze,
    (typeof SWITCH_TIMEOUT_MS === 'number' && SWITCH_TIMEOUT_MS) || 90000);
}

/* ================= ② vack 两阶段回执 ================= */
function ledgerVack(d){
  if (!d || typeof d !== 'object') return;
  /* stage:1 —— 服务端已变更选中会话，账本核对中（悬浮提示，切换未完成） */
  if (d.stage === 1){
    const sp = S.switch_pend;
    if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
      if (sp.phase !== 'ok'){
        sp.phase = 'ledger_check';
        sp.ts = Date.now();
        clearTimeout(sp._resendT);         /* 服务器已受理：停补发（同 switch_ack 口径） */
        renderAll();
      }
    }
    return;
  }
  /* stage:2 —— 正式成功终态：版本一致（same）或差额补发清单（need） */
  LB.checking = false;
  /* 2.261（老板令·状态时序⑤）：核对结束 → 置「核对成功」pending，
     等补发消息全部渲染完（静默 600ms / 60 秒兜底）再由 renderState 落横幅。 */
  if ((d.act === 'switch' || S.switch_pend) && typeof bannerPendSuccess === 'function')
    bannerPendSuccess();
  /* 2.234：核对出终态 → 关横幅窗、灭圆球，让位给切换成功/四态 */
  LB.vchkOpen = 0; LB.vchkEndAt = 0; LB.chkUntil = 0;
  if (d.mods && typeof d.mods === 'object') lbModsSet(d.mods);   /* 存底，供下轮比对 */
  /* 智能避让（I3 修订版·追加单 2026-11-18）：切换成功＝终态 → 解冻并按完整
     周期重新起算；login/svr 强核对完成 → 倒计时直接重置为完整周期。
     旧「20 秒叠加」口径已作废删除（规范§三／协议定稿§五）。 */
  if (d.act === 'switch') lbUnfreeze();
  else if (d.act === 'login' || d.act === 'svr'){
    LB.timerAt = Date.now() + lbPeriodMs();
  }
  const sp = S.switch_pend;
  if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
    if (d.same){
      ledgerSwitchDone();                  /* 版本一致零实体帧 ⇒ 正式成功关提示 */
    } else {
      /* need 差额补发中：8 秒兜底收口（实体帧陆续到达时会刷新画面） */
      sp.need = Array.isArray(d.need) ? d.need : [];
      clearTimeout(sp._needT);
      sp._needT = setTimeout(() => {
        if (S.switch_pend === sp && sp.need){ delete sp.need; ledgerSwitchDone(); }
      }, 8000);
    }
  }
}
function ledgerSwitchDone(){
  const sp = S.switch_pend;
  if (!sp) return;
  delete sp.need;
  clearTimeout(sp._needT);
  if (sp.phase !== 'ok') switchOk();       /* 复用既有成功收口（2s 成功提示 → 关提示） */
}

/* ================= ③ mod 单模块实体帧分流（下行唯一实体形态） ================= */
/* 2.200：m='u' 人类记录帧与 t:'ev' 的 u/human 双路到同一函数，按 did 3 秒去重
   （同一条消息两路并发只入账一次；无 did 的帧不在此去重，由 lbMsgsAppend 按身份兜底） */
const _lbHumanSeen = new Map();
function ledgerMod(d){
  if (!d || typeof d !== 'object') return;
  const m = String(d.m || ''), v = String(d.v || ''), body = d.d;
  /* 版本存底：mod 帧必带该模块新 ver（协议定稿 3.1） */
  if (v && LB.mods){
    if (m === 'ledger'){
      LB.mods.ledger = LB.mods.ledger || {};
      if (d.sid) LB.mods.ledger[String(d.sid)] = v;
    } else LB.mods[m] = v;
    lbVerSave();
  }
  switch (m){
    /* 2.200 补 m=u/input 路由 */
    case 'u':
    case 'human': {                        /* 人类记录即发帧（服务端 t:'mod' m:'u'）——收到即入账并按发送编号销卡 */
      if (typeof ledgerHumanFrame === 'function'){
        const _didNow = String((body && body.did) || '');
        const _nowu = Date.now();
        let _dup = false;
        if (_didNow){
          const _last = _lbHumanSeen.get(_didNow);
          if (_last && _nowu - _last < 3000) _dup = true;
          _lbHumanSeen.set(_didNow, _nowu);
          if (_lbHumanSeen.size > 200){
            _lbHumanSeen.forEach((ts, k) => { if (_nowu - ts > 3000) _lbHumanSeen.delete(k); });
          }
        }
        if (!_dup) ledgerHumanFrame(body);
      }
      break;
    }
    case 'input': {                        /* 输入框模块帧——横幅「输入框待发」取数点 */
      if (body && S.snap && typeof S.snap === 'object'){
        S.snap.inputText = String((body.text != null ? body.text : '') || '');
        renderAll();
      }
      break;
    }
    case 'snote': {                        /* 定时消息＋备注（合并模块） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (body.notes !== undefined) S.snap['备注'] = body.notes;
        if (body.sched !== undefined) S.snap['定时'] = body.sched;
        if (window.备注入快照) 备注入快照(S.snap);
        if (window.定时入快照) 定时入快照(S.snap);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'sig': {                          /* 信号灯（独立高频） */
      const arr = (body && body.convs) || [];
      /* 2.215：收下服务端下发的权威终身号（标准 4 位或名称兜底；无则未登记）。 */
      try {
        if (!S.convUids) S.convUids = {};
        arr.forEach(o => { if (o && o.sid && lbUidAny(o.uid)) S.convUids[String(o.sid)] = lbUidAny(o.uid); });
      } catch(e){}
      if (arr.length && S.snap){
        const cf = Array.isArray(S.snap.convs_full) ? S.snap.convs_full : [];
        arr.forEach(o => {
          if (!o || !o.sid) return;
          const row = cf.find(x => x && x.sid === o.sid);
          if (row){
            row.status = o.status || row.status;
            if (o.light !== undefined) row.light = o.light;
            if (o.orange !== undefined) row.orange = o.orange;
            if (o.unread !== undefined) row.unread = o.unread;
            if (lbUidAny(o.uid)) row.uid = lbUidAny(o.uid);
          }
        });
        if (Array.isArray(o_unreadIds(arr))) S.snap.conv_unread_ids = o_unreadIds(arr);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'macct': {                        /* 模型列表＋账号列表（合并模块，账号按 boxes） */
      if (body){
        if (Array.isArray(body.models)){
          S.models_full = body.models;
          rebuildModelOptions(); checkFavInvalid();
        }
        if (body.acct !== undefined){ S.acct = String(body.acct || ''); renderAcct(); }
        if (Array.isArray(body.boxes)){
          S.boxes = body.boxes.filter(Boolean);
          el.box.innerHTML = '';
          S.boxes.forEach(b2 => {
            const o = document.createElement('option');
            o.value = b2; o.textContent = b2;
            el.box.appendChild(o);
          });
        }
      }
      break;
    }
    case 'convs': {                        /* 会话列表（改名/删除触发本地账本清理 H2） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (Array.isArray(body.convs)) S.snap.convs = body.convs;
        if (Array.isArray(body.convs_full)) S.snap.convs_full = body.convs_full;
        /* 2.215：收下服务端下发的权威终身号（标准 4 位或名称兜底；uid/uids 都认）。 */
        try {
          if (!S.convUids) S.convUids = {};
          if (body.uids && typeof body.uids === 'object'){
            Object.keys(body.uids).forEach(k => {
              const u = lbUidAny(body.uids[k]);
              if (k && u) S.convUids[String(k)] = u;
            });
          }
          (Array.isArray(body.convs_full) ? body.convs_full : []).forEach(o => {
            if (!o) return;
            const u = lbUidAny(o.uid);
            if (!u) return;
            if (o.sid) S.convUids[String(o.sid)] = u;
            if (o.title) S.convUids[String(o.title)] = u;
          });
          (Array.isArray(body.convs) ? body.convs : []).forEach(r => {
            if (!Array.isArray(r)) return;
            const u = lbUidAny(r[5]);
            if (!u) return;
            if (r[4]) S.convUids[String(r[4])] = u;
            if (r[1]) S.convUids[String(r[1])] = u;
          });
        } catch(e){}
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'didp': {                         /* 销卡池子（F5 补销渠道） */
      const pool = (body && body.pool) || [];
      let ch = false;
      pool.forEach(did => { if (pendClearByDid(did, '')) ch = true; });
      if (ch) renderAll();
      break;
    }
    case 'ledger':                         /* 聊天主账本（按轮补发，G1） */
      /* 2.202（老板 2026-11-19 21:51 令·手机网页端＝诊断口不设限）：撤「缺 title
         弃收」闸门——不合格帧照收照建诊断账本，缺名由 ledgerStorePut 兜底命名并
         打 diag 标记，便于老板一眼发现毛病。
         2.205（人事部长ST 0023 转达老板新令）：只对「缺消息 ID / 缺会话 ID」两类
         做丢弃；缺名但 sid 有效的仍按诊断口口径照建（不扩大化）。 */
      ledgerStoreApply(d.sid || (body && body.sid) || '', body, v);
      break;
    case 'think':                          /* 思维流快照＋排队条（TRAE 专属，E2/N1） */
      /* V2 验收 Y9（2026-11-18）：think 帧归属按 d.sel 优先——服务端 think
         模块按「桌面当前选中」下发并在 sel 带归属 sid，d.sid 只是收帧通道
         语义；优先 sel 才不会把别会话的思维流错挂到当前锚定。 */
      ledgerThinkApply(d.sel || d.sid, body);
      break;
  }
}
/* ============ 1.051：服务端对账帧 lbkeep（账本连续链裁剪） ============ */
function lbKeepApply(d){
  /* 最小处理：按 sid 找本地唯一正文账 snap_conv 里该会话的记录，删除 del 中
     列出的 mid（keep 保留），删完重建 lbSum 与 snap_conv 记录。无该会话或
     空指令一律静默；不新增页面、不改布局。 */
  try{
    if (!d || typeof d !== 'object') return;
    const del = Array.isArray(d.del)
      ? d.del.map(x => String(x || '')).filter(Boolean) : [];
    if (!del.length) return;
    const sid = String(d.sid || '').trim();
    if (!sid) return;
    const _del = new Set(del);
    _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      const puts = [];
      (rows || []).forEach(rec => {
        try{
          if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
          const rs = String(rec.sid || ''), ru = String(rec.uid || '');
          const rt = String(rec.title || '');
          if (sid !== rs && sid !== ru && sid !== rt) return;
          const kept = [];
          let hit = 0;
          rec.frame.msgs.forEach(m => {
            if (Array.isArray(m) && _del.has(String(m[6] || ''))){ hit++; return; }
            kept.push(m);
          });
          if (!hit) return;
          if (!kept.length){
            puts.push(_idbReq('snap_conv', 'readwrite',
              st => st.delete(rec.sk)).catch(() => {}));
            try { LB.lbHave.delete(String(rec.uid || rec.sid || '')); } catch(e){}
            try { lbSumDrop(rec.sid, rec.title); } catch(e){}
            try { delete LB.rows[_lbRowsKey(String(rec.uid || ''), rt)]; } catch(e){}
            try { delete _frameMem[rec.sk]; } catch(e){}
            return;
          }
          const nr = Object.assign({}, rec);
          nr.frame = Object.assign({}, rec.frame, {msgs: kept});
          try {
            if (_frameMem && _frameMem[rec.sk] && Array.isArray(_frameMem[rec.sk].msgs))
              _frameMem[rec.sk].msgs = kept.map(m => m.slice());
          } catch(e){}
          const rounds = lbRoundsFromMsgs(kept);
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function'
                ? String(lbUidPick(null, rec.sid, rt) || '') : '');
          try { lbSumSet(u || String(rec.sid || ''), rt, rounds); } catch(e){}
          try { lbRowsPut(u, rt, rounds); } catch(e){}   /* 2026-11-24：屏幕唯一源同步裁剪 */
          puts.push(_idbReq('snap_conv', 'readwrite',
            st => st.put(nr)).catch(() => {}));
          try { diagLog('lbkeep 裁剪|sid=' + sid + '|删=' + hit
            + '|留=' + kept.length, 'ok'); } catch(e){}
        }catch(e){}
      });
      return Promise.all(puts);
    }).catch(() => {});
  }catch(e){}
}
/* ============ 1.054：服务端对账帧 lbsync（账本足额同步：重排+补齐+删多余） ============ */
function lbSyncApply(d){
  /* 0.90 服务端「足额补发」配套：按 d.order（服务器完整全序 mid）重建本会话
     账本 msgs——本地有该 mid 用本地行、否则用 d.add 给的行（缺条只补内容）、
     都不存在跳过不造假；不在 order 里的多余行丢弃；重建后 lbSum/rows/snap_conv
     一并同步，最终两边条数/ID/顺序/内容一致。d.think/d.pend 服务端另推，不在
     本函数处理。无 order/无命中记录一律静默；不新增页面、不改布局。 */
  try{
    if (!d || typeof d !== 'object') return;
    const order = Array.isArray(d.order)
      ? d.order.map(x => String(x || '')).filter(Boolean) : [];
    const orderSet = new Set(order);
    const sid = String(d.sid || '').trim();
    const wantUid = String(d.uid || '').trim();
    const wantTitle = String(d.title || '').trim();
    if (!sid && !wantUid && !wantTitle) return;
    const addMap = new Map();
    (Array.isArray(d.add) ? d.add : []).forEach(it => {
      try{
        if (!it || typeof it !== 'object') return;
        const mid = String(it.mid || '');
        if (mid && Array.isArray(it.row)) addMap.set(mid, it.row);
      }catch(e){}
    });
    _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      const puts = [];
      (rows || []).forEach(rec => {
        try{
          if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
          const rs = String(rec.sid || ''), ru = String(rec.uid || '');
          const rt = String(rec.title || '');
          /* 三法命中：sid / uid / title 任一相等（同 lbKeepApply :928-930） */
          const hit = (sid && (sid === rs || sid === ru || sid === rt))
            || (wantUid && wantUid === ru) || (wantTitle && wantTitle === rt);
          if (!hit) return;
          const localMap = new Map();
          rec.frame.msgs.forEach(m => {
            if (Array.isArray(m) && m[6]) localMap.set(String(m[6]), m);
          });
          let 删 = 0;
          localMap.forEach((v, k) => { if (!orderSet.has(k)) 删++; });
          let 补 = 0;
          const kept = [];
          order.forEach(mid => {
            if (localMap.has(mid)){ kept.push(localMap.get(mid)); return; }
            if (addMap.has(mid)){ kept.push(addMap.get(mid)); 补++; return; }
          });
          const 留 = kept.length - 补;
          const 键 = sid || wantUid || wantTitle;
          if (!kept.length){
            /* 2.271（老板 2026-11-24 21:29 令·网页固化）：绝不删光——
               order 为空（服务器这拍没给全序/读不到账本），或服务器没给任何可补
               内容（add 空）而本地明明有货，一律拒删、原样保留并留痕。宁可让手机
               显示旧账，也不能被一张坏帧把本地账本清成 0。 */
            const _localN = localMap.size;
            if (!order.length || (_localN > 0 && addMap.size === 0)){
              try { diagLog('lbsync 拒删|sid=' + 键 + '|order=' + order.length
                + '|add=' + addMap.size + '|local=' + _localN + '|保留不动', 'warn'); } catch(e){}
              return;
            }
            puts.push(_idbReq('snap_conv', 'readwrite',
              st => st.delete(rec.sk)).catch(() => {}));
            try { LB.lbHave.delete(String(rec.uid || rec.sid || '')); } catch(e){}
            try { lbSumDrop(rec.sid, rec.title); } catch(e){}
            try { delete LB.rows[_lbRowsKey(String(rec.uid || ''), rt)]; } catch(e){}
            try { delete _frameMem[rec.sk]; } catch(e){}
            try { diagLog('lbsync 足额|sid=' + 键 + '|order=' + order.length
              + '|留=0|补=' + 补 + '|删=' + 删
              + '|rounds=' + (parseInt(d.rounds) || 0), 'ok'); } catch(e){}
            return;
          }
          const nr = Object.assign({}, rec);
          nr.frame = Object.assign({}, rec.frame, {msgs: kept});
          try {
            if (_frameMem && _frameMem[rec.sk] && Array.isArray(_frameMem[rec.sk].msgs))
              _frameMem[rec.sk].msgs = kept.map(m => m.slice());
          } catch(e){}
          const rounds = lbRoundsFromMsgs(kept);
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function'
                ? String(lbUidPick(null, rec.sid, rt) || '') : '');
          try { lbSumSet(u || String(rec.sid || ''), rt, rounds); } catch(e){}
          try { lbRowsPut(u, rt, rounds); } catch(e){}
          puts.push(_idbReq('snap_conv', 'readwrite',
            st => st.put(nr)).catch(() => {}));
          try { diagLog('lbsync 足额|sid=' + 键 + '|order=' + order.length
            + '|留=' + 留 + '|补=' + 补 + '|删=' + 删
            + '|rounds=' + (parseInt(d.rounds) || 0), 'ok'); } catch(e){}
        }catch(e){}
      });
      return Promise.all(puts);
    }).catch(() => {});
  }catch(e){}
}
if (typeof window !== 'undefined') window.lbSyncApply = lbSyncApply;
function o_unreadIds(arr){
  const out = [];
  arr.forEach(o => { if (o && o.sid && o.status && o.status.unread) out.push(o.sid); });
  return out.length ? out : null;
}

/* think 帧：整屏快照（统筹批复·兼带正文）＋ 排队条子对象（项级 sid/id/text 剥净） */
function ledgerThinkApply(sid, body){
  const b = body || {};
  /* 排队条随 think 包（N1，不独立收发）：项级 sid 过滤（N4 根治串显），
     text 服务端已剥净（N2）、id 仅底层携带（N3，渲染层绝不展示）。 */
  if (Array.isArray(b.pend)){
    /* V2 第三轮 Y4+Y18（2026-11-19）：入 S.snap.pend 前统一收口——
       Y4 剥词（§十二-5）：stripPendTail 从「你的会话名/【全局记忆】」等锚点起
       整段吞尾，只留原话；剥后全空（整条都是注入）⇒ 丢弃不画空卡。
       Y18 幂等去重：按 id（缺 id 退回文本）Map 去重，服务端双路推送/重复合并
       也只落一条。 */
    const mine = [];
    const _seen = new Set();
    /* 2.187（老板 2026-11-19 实测：消息进排队条后手机端半天不挂条、卡也不销）：
       服务端 `_pend条目`（WS桥 0.26 起）下发的新格式是 {id,text,sid,canEdit}
       ——正文在 **text**，旧格式才在 t。2.177 的剥词/去重收口只认 it.t，
       新格式逐条判空被丢弃 ⇒ S.snap.pend 恒空 ⇒ ①排队条不上屏 ②pendLandingScan
       拿不到条目、渠道③销卡整条失效。此处两形态都收（text 优先）。
       归属：项级 sid 命中本会话，或该项 id（14 位 DID）命中本人待销卡
       ——「我发的这条明明进了队、可桌面选中/锚定还没对齐」时也认领并销卡。 */
    b.pend.filter(it => {
      if (!it || typeof it !== 'object') return false;
      const _m = pendItemMine(it);
      if (_m === true) return true;
      if (typeof pendDidOwn === 'function' && pendDidOwn(it)) return true;
      /* 2.234（老板 2026-11-20 23:09）：旧写法「只留 true / DID 认领」，项级 sid
         缺失或本端拿不到 sid（null）时整条被丢——AI 之间走总管命令发的消息不带
         DID，于是排队条两条只剩一条。回退到 11-18 旧版口径：只有**明确**属于
         别的会话（false）才丢，无从判定（null）一律显示。 */
      return _m !== false;
    }).forEach(it => {
      const _raw = (it.text != null) ? String(it.text)
                : (it.t != null ? String(it.t) : '');
      if (it.text != null) it.text = stripPendTail(it.text);
      if (it.t != null) it.t = stripPendTail(it.t);
      let _tx = (it.text != null) ? it.text : it.t;
      /* 2.236（老板 2026-11-20 23:09「照原来的做法，别只认 DID」）：剥尾后
         整条被剥空时，旧写法直接 return（条被吞）。回退原始正文（剥掉首行
         DID 后）继续显示——宁可多显示一条，也不让队列里的消息凭空消失。 */
      if (!String(_tx || '').trim()){
        _tx = (typeof stripHeadDid === 'function') ? stripHeadDid(_raw) : _raw;
        if (it.text != null) it.text = _tx; else it.t = _tx;
      }
      if (!String(_tx || '').trim()) return;
      /* 2.225（老板 2026-11-20 19:15 排队条翻倍）：按跨形态统一键去重——
         旧格式 {t:'<DID> 正文'} 与新格式 {id:'<DID>',text} 同一句必须算一条；
         旧写法「有 id 用 id、没 id 用原文」会让两种形态各留一份。 */
      /* 2.234（老板 2026-11-20 23:09）：去重键**绝不允许为空就丢条**——旧写法
         无 pendTxtKey 时退回 `String(it.id)`，AI 间总管命令 id 为空串 ⇒ 键空
         ⇒ `if (!k ...) return` 整条被吞（又一处在「只认 DID」）。现：键空＝无从
         判重，直接放行；有键才参与去重。 */
      const k = (typeof pendTxtKey === 'function') ? pendTxtKey(it)
              : String((it.id != null && String(it.id).trim()) ? it.id : _tx);
      if (k && _seen.has(k)) return;
      if (k) _seen.add(k);
      mine.push(it);
    });
    if (!S.snap || typeof S.snap !== 'object') S.snap = {};
    /* 2.188（老板 2026-11-19「排队条一变就要主动推送、这边才能销卡」）：
       排队条内容指纹——id+正文逐项拼，前后不同即「变了」，必须立刻重画。
       livePend（生成中）锁态下旧写法一律跳过 renderAll ⇒ 条上新/条撤下
       都要等下一次非锁态重画，实测空帧后条在 DOM 上一直挂着不撤。 */
    const _sigOf = a => (a || []).map(x => String(x && x.id != null ? x.id : '')
                 + '\u0001' + String(x && x.text != null ? x.text : ((x && x.t) || ''))).join('\u0002');
    const _sigPrev = _sigOf(S.snap && S.snap.pend);
    const _sigNext = _sigOf(mine);
    S.snap.pend = mine;
    S.snap.pend_sid = String(b.pend_sid || sid || '');
    S.convs_key = null;
    /* Y5：排队条到达即扫销卡（渠道③）——消息一进官方队列就算已发出 */
    let _cleared = false;
    if (typeof pendLandingScan === 'function') _cleared = !!pendLandingScan(null, mine);
    /* 2.187：销卡成功必须立刻重画——旧写法只在「非切换锁态」renderAll，
       锁态下卡虽已从 S.pending 摘掉、DOM 上那张卡还挂着（老板看到的现象）。
       2.188：排队条有增减（含撤到空）也一并即时重画，不受锁态约束。 */
    if (_cleared || _sigPrev !== _sigNext
        || typeof _liveLockOn !== 'function' || !_liveLockOn()) renderAll();
  }
  /* 整屏快照上屏判定（S1 裁定·2026-11-18）：模块化模式下服务端【不再有】
     k='snap_pane' 帧（仅 mod_push_on=False 回退时才存在）——上屏唯一驱动＝
     本函数收到的 mod(m='think') 帧且 frame.msgs 存在，经 onEv('snap_pane',…)
     既有通道上屏（锚定会话上屏 / 非锚定存为该会话内存存帧，零打扰）。
     字符串形态（纯画面文本）暂不上屏——TRAE 网页端思维流画面本就随正文行
     呈现，不做卡片化改造（E2）。 */
  /* 2.207（V1.0 §五-2/12）：先落「本会话最新一版」思维流卡——新版覆盖旧版、
     按服务端隔离，只作展示绝不入账；非 1 号也照存（显示侧再拦）。 */
  const f = b.frame;
  const _hasMsgs = !!(f && typeof f === 'object' && Array.isArray(f.msgs)
                      && f.msgs.length);   /* 2.263：空 msgs 视同瘦帧，绝不清屏 */
  if (b.thinkId || b.anchorMid){
    if (_hasMsgs){
      if (thinkCardSet(b, sid)) renderAll();
    } else {
      /* 2.263（瘦帧兼容）：本帧不带整屏 msgs——只更新 THINK_CARDS 一版，
         绝不碰正文、不清屏、不触发 onEv('snap_pane')。 */
      if (thinkCardThinSet(b, sid)){
        /* 只就地刷新思维流卡，不调 renderAll、不重建正文。 */
        thinkCardPaint(thinkCardGet(sid, b.title || ''));
      }
    }
    /* 2.214：把最新一版思维流挂到该会话账本最底部（只留一条，不进轮次）。 */
    try { lbThinkPut(sid, b.title || '', thinkCardGet(sid, b.title || '')); } catch(e){}
  }
  /* 2.266（老板 2026-11-24 20:38 令）：「思维流只为 1 号网页用户提供、非 1 号
     不消费本帧画面」的限制随「1 号」概念废除整块拆除——思维流推送本就广播
     全员且按会话携带，各端按「卡片所属会话 == 本端选中会话」自行匹配显示。 */
  if (_hasMsgs){
    /* 2.213：类型只认服务端 index8（u/a/th），前端不再就地推导/补写；
       缺 index8 的行走「类型未知」，原样上屏不丢。 */
    onEv('snap_pane', {sid: String(sid || ''), title: b.title || '',
                       msgs: f.msgs, finish: f.finish || null});
    S.lb_foldRounds = 0;                   /* 真画面到手 → 归零（2.183 修2：补发面板已撤§十二-2，状态位保留防渲染 key 漂移） */
  }
}

/* ===== 2.207 思维流展示卡（V1.0 §五「思维流独立编号与分发」，文档现文为准）=====
   服务端 WS桥 0.48 帧字段：sel/sid、uid、title、time、thinkId（含六位版本）、
   thinkVer、anchorMid、frame{msgs,finish,tail}。
   客户端口径：
     · 每会话只留「最新一版」，新版到即覆盖旧版（不存历史版本）；
     · 按服务端隔离（键含 lbSrvTag），换服绝不串；
     · 只作展示，**绝不入账**（不进 ledger_conv、不参与轮次统计、绝不当终极）。 */
let THINK_CARDS = {};          /* 'L<本服>|<稳定键>' → 最新一版（每会话一条） */

function _thinkCardKey(sid, title){
  let k = '';
  try {
    k = (typeof 稳定键 === 'function')
        ? String(稳定键(String(sid || ''), String(title || '')) || '') : '';
  } catch(e){ k = ''; }
  return 'L' + (typeof lbSrvTag === 'function' ? lbSrvTag() : '')
       + '|' + (k || String(sid || ''));
}
function _thinkTitleEq(a, b){
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}
/* 收帧落「最新一版」：版本旧的迟到帧不回退；返回 true＝有变化（需要重画）。 */
function thinkCardSet(body, sidHint){
  const b = body || {};
  const sid = String(b.sel || sidHint || '');
  const tid = String(b.thinkId || '');
  if (!sid || !tid) return false;            /* 旧服务端无编号：不建卡（不伪造） */
  const ver = parseInt(b.thinkVer, 10) || 0;
  const key = _thinkCardKey(sid, b.title);
  const old = THINK_CARDS[key];
  const anchor = String(b.anchorMid || '');
  if (old && ver && old.thinkVer && ver < old.thinkVer
      && old.anchorMid === anchor) return false;   /* 迟到旧版：不回退 */
  const f = (b.frame && typeof b.frame === 'object') ? b.frame : {};
  const arr = Array.isArray(f.msgs) ? f.msgs : [];
  /* 2.212（老板 2026-11-20 07:28 bug①）：虚线框只准放思维流。
     ①先收集本轮「终极回复」的 mid 集合（唯一判据 lbIsFinalRow）；
     ②只取锚定人类消息**之后**的 AI 行（绝不拿上一轮终极回复冒充本版思维流）；
     ③final 行、以及同一 mid 已有 final 的 think 版，一律跳过；
     ④锚定人类之后一旦出现 final ⇒ 本轮 think 版作废，卡片直接移出虚线框。 */
  const finalMids = new Set();
  arr.forEach(m => {
    if (Array.isArray(m) && lbIsFinalRow(m)){
      const _id = String((m.length > 6 && m[6]) || '').trim();
      if (_id) finalMids.add(_id);
    }
  });
  let _ai = -1;
  if (anchor){
    for (let i = arr.length - 1; i >= 0; i--){
      const m = arr[i];
      if (Array.isArray(m) && m[0] === 'u'
          && String((m.length > 6 && m[6]) || '') === anchor){ _ai = i; break; }
    }
  }
  if (_ai < 0){
    for (let i = arr.length - 1; i >= 0; i--){
      if (Array.isArray(arr[i]) && arr[i][0] === 'u'){ _ai = i; break; }
    }
  }
  let _roundDone = false;
  for (let i = _ai + 1; i < arr.length; i++){
    if (Array.isArray(arr[i]) && lbIsFinalRow(arr[i])){ _roundDone = true; break; }
  }
  if (_roundDone){
    if (old) delete THINK_CARDS[key];          /* final 为准：think 版作废 */
    return !!old;
  }
  let txt = '', textMid = '';
  for (let i = arr.length - 1; i > _ai; i--){
    const m = arr[i];
    if (!Array.isArray(m) || m[0] !== 'a' || !m[1]) continue;
    if (lbIsFinalRow(m)) continue;              /* 终极回复绝不进虚线框 */
    /* 2.222（老板 2026-11-20 17:10 令）：虚线框只收思维流（index8='th'）。
       服务端已带类型时，非 th 一律跳过（a/终极/人类绝不进框）；缺类型的老帧
       仍按原口径（非 final 即可），不凭空丢内容。 */
    const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
    if (_k8 && _k8 !== 'th') continue;
    const _id = String((m.length > 6 && m[6]) || '').trim();
    if (_id && finalMids.has(_id)) continue;    /* 同 mid 已有 final：think 版作废 */
    txt = String(m[1]); textMid = _id; break;
  }
  if (!txt) txt = String(f.tail || '');
  /* 2.209：不读服务端 time 字段——展示时间只由锚定消息 ID 现算 */
  const tm = (typeof timeFromMid === 'function') ? timeFromMid(anchor) : '';
  if (old && old.thinkId === tid && old.text === txt
      && old.textMid === textMid) return false;   /* 同版重发 */
  THINK_CARDS[key] = {
    srv: (typeof lbSrvKey === 'function' ? lbSrvKey() : ''),
    sid: sid, title: String(b.title || ''), uid: String(b.uid || ''),
    thinkId: tid, thinkVer: ver, anchorMid: anchor, time: tm,
    text: txt, textMid: textMid,
    ts: Date.now()
  };
  return true;
}
/* 2.263（瘦帧）：服务端 think 帧不再带整屏 msgs，只带 thinkId/thinkVer/
   anchorMid/text。这里只落「本会话最新一版」卡，绝不读/改正文 msgs。 */
function thinkCardThinSet(body, sidHint){
  const b = body || {};
  const sid = String(b.sel || sidHint || '');
  const tid = String(b.thinkId || '');
  if (!sid || !tid) return false;
  const ver = parseInt(b.thinkVer, 10) || 0;
  const key = _thinkCardKey(sid, b.title);
  const old = THINK_CARDS[key];
  const anchor = String(b.anchorMid || '');
  if (old && ver && old.thinkVer && ver < old.thinkVer
      && old.anchorMid === anchor) return false;      /* 迟到旧版：不回退 */
  const txt = (b.text != null) ? String(b.text)
            : (old && old.text != null ? String(old.text) : '');
  if (old && old.thinkId === tid && old.thinkVer === ver
      && old.anchorMid === anchor && old.text === txt) return false;  /* 同版重发 */
  const tm = (typeof timeFromMid === 'function') ? timeFromMid(anchor) : '';
  THINK_CARDS[key] = {
    srv: (typeof lbSrvKey === 'function' ? lbSrvKey() : ''),
    sid: sid, title: String(b.title || ''), uid: String(b.uid || ''),
    thinkId: tid, thinkVer: ver, anchorMid: anchor, time: tm,
    text: txt, textMid: (old && old.textMid) || '',
    ts: Date.now()
  };
  return true;
}
/* 2.263（瘦帧）：只就地重画已在屏的思维流卡（同 thinkId），
   不重建正文区、不触发 renderMsgs。 */
function thinkCardPaint(c){
  try {
    if (!c || !c.thinkId) return;
    const box = document.getElementById('msgs');
    if (!box) return;
    const nodes = box.querySelectorAll('.thinklive');
    for (let i = nodes.length - 1; i >= 0; i--){
      const nd = nodes[i];
      if (String(nd.getAttribute('data-think') || '') !== String(c.thinkId)) continue;
      if (typeof _thinkCardHtml === 'function') nd.outerHTML = _thinkCardHtml(c);
      else {
        const bd = nd.querySelector('.body');
        if (bd && typeof _mdBody === 'function') bd.innerHTML = _mdBody(String(c.text || ''));
      }
    }
  } catch(e){}
}
function thinkCardGet(sid, title){
  return THINK_CARDS[_thinkCardKey(sid, title)] || null;
}
/* 显示判定（§五-8/9/10）：小账本最底部固定挂一条；四维全匹配＋思维灯亮才显示；
   本轮终极（fin=1 的 a 行）一到立即让位。任一条件不满足返回 null。 */
function thinkCardNow(msgs){
  try {
    /* 2.266（老板 2026-11-24 20:38 令）：原「非 1 号 return null」随「1 号」
       废除拆除——新口径＝谁把本端选中会话与卡片所属会话对上谁就能看；
       下面 ②③ 会话名/会话 ID 匹配正是新规则的「按会话自匹配」。 */
    if ((typeof _curConvLight === 'function' ? _curConvLight() : '') !== 'busy') return null;
    const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
    const ct = String((typeof curTitle === 'function' ? curTitle() : '') || '');
    if (!cs) return null;
    const c = thinkCardGet(cs, ct);                    /* ③会话 ID 匹配（按稳定键取） */
    if (!c) return null;
    if (c.srv && c.srv !== String((typeof lbSrvKey === 'function' ? lbSrvKey() : '')))
      return null;                                     /* ①服务器匹配 */
    if (!c.title || !_thinkTitleEq(c.title, ct)) return null;   /* ②会话名匹配 */
    if (!c.anchorMid) return null;
    const arr = Array.isArray(msgs) ? msgs : [];
    let hi = -1;
    for (let i = arr.length - 1; i >= 0; i--){
      if (Array.isArray(arr[i]) && arr[i][0] === 'u'){ hi = i; break; }
    }
    if (hi < 0) return null;
    const hmid = String((arr[hi].length > 6 && arr[hi][6]) || '').trim();
    /* 2.223（老板 2026-11-20 17:20 令·中间夹思维流）：官方偶发把活思维流夹在
       两条人类发言之间，服务端 anchor 仍指向旧人类。此时**不撤卡**（撤了思维流
       就没地方显示）——只要锚定那条人类仍在本屏，就把卡贴到最新人类下方。
       锚定人类已不在本屏（被裁/换轮）才不展示，防旧卡死挂。 */
    if (hmid !== c.anchorMid){
      let _anchInView = false;
      for (let i = 0; i < arr.length; i++){
        const m = arr[i];
        if (Array.isArray(m) && m[0] === 'u'
            && String((m.length > 6 && m[6]) || '').trim() === c.anchorMid){
          _anchInView = true; break;
        }
      }
      if (!_anchInView) return null;
    }
    /* 2.212（bug① 渲染层双保险）：卡片正文对应的 mid 一旦已有终极回复，
       think 版立即作废，虚线框绝不显示终极回复。 */
    if (c.textMid){
      for (let i = 0; i < arr.length; i++){
        const m = arr[i];
        if (Array.isArray(m) && lbIsFinalRow(m)
            && String((m.length > 6 && m[6]) || '') === c.textMid) return null;
      }
    }
    for (let i = hi + 1; i < arr.length; i++){
      const m = arr[i];
      if (!Array.isArray(m) || m[0] !== 'a') continue;
      if (lbIsFinalRow(m)) return null;   /* ⑩终极回复优先（含提前终极）：立刻撤卡 */
    }
    /* 2.263：卡片正文优先 card.text；为空才回退本屏 frame.msgs 里锚定后的 th 行。 */
    if (!String(c.text || '').trim()){
      let _ai = -1;
      for (let i = arr.length - 1; i >= 0; i--){
        const m = arr[i];
        if (Array.isArray(m) && m[0] === 'u'
            && String((m.length > 6 && m[6]) || '').trim() === c.anchorMid){
          _ai = i; break;
        }
      }
      if (_ai < 0) _ai = hi;
      for (let i = arr.length - 1; i > _ai; i--){
        const m = arr[i];
        if (!Array.isArray(m) || m[0] !== 'a' || !m[1]) continue;
        if (lbIsFinalRow(m)) continue;
        const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
        if (_k8 && _k8 !== 'th') continue;
        c.text = String(m[1]); break;
      }
    }
    return c;
  } catch(e){ return null; }
}
/* 对账上报（§五-6）：本端掌握的全部思维流编号（sid → thinkId 含版本）。 */
function thinkCardsReport(){
  const out = {};
  const srv = String((typeof lbSrvKey === 'function' ? lbSrvKey() : ''));
  Object.keys(THINK_CARDS).forEach(k => {
    const c = THINK_CARDS[k];
    if (!c || !c.sid || !c.thinkId) return;
    if (c.srv && srv && c.srv !== srv) return;         /* 别服的不上报 */
    out[String(c.sid)] = c.thinkId;
  });
  return out;
}
/* ===== 2.207 思维流展示卡（止）===== */

/* 项级归属判定：true=本会话 / false=别会话 / null=无项级 sid（交回顶层判定） */
function pendItemMine(it){
  if (!it || typeof it !== 'object') return null;
  /* 2.236（老板 2026-11-20 23:09 再核）：空串 sid 与「无 sid」同口径。
     旧写法只拦 null/undefined，`sid:''` 会走到下面与 cs 比对 ⇒ 空串≠cs
     ⇒ 返回 false（被判「确凿是别人的」）⇒ AI 之间走总管命令的排队项整条被丢，
     只剩带 DID 的人类发言（老板看到的「两条只显示一条」）。 */
  if (it.sid == null || String(it.sid).trim() === '') return null;
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  /* 2.234（老板 2026-11-20 23:09「只认带 DID 的、AI 间总管命令不显示，倒退」）：
     本端还没锚定/拿不到当前 sid 时，旧写法返回 false＝「确凿是别人的」，
     调用方据此丢掉条目；而「认领」只有 DID 一条路（pendDidOwn），
     于是无 DID 的 AI 间总管命令全被吞，只剩带 DID 的人类发言。
     拿不到 sid ＝ **无从判定**，返回 null（与项级 sid 缺失同口径），
     由调用方按「宁可显示、不误杀」处理；只有 sid 明确对不上才 false。 */
  if (!cs) return null;
  const s = String(it.sid);
  if (s === cs) return true;
  return !!(typeof 稳定键 === 'function' && 稳定键(s, '') === 稳定键(cs, ''));
}

/* 2.188：本人排队项 DID 认领（含记忆）——消息刚进队那一下，项级 sid 可能还
   指着别处（桌面选中/锚定未对齐），靠占位卡上的 14 位 DID 认领；但销卡与
   重画同一拍完成，卡一销「证据」就没了，下一帧又会被判成别会话 ⇒ 条闪一下
   就没。故认领过的 DID 记 10 分钟（排队项存活远短于此），期间一律算本人的。
   反向：没发过的 DID 永远不认领 ⇒ 别人的条目绝不串显（跨会话红线）。 */
function pendDidOwn(it){
  if (!it || it.id == null) return false;
  const k = String(it.id);
  const _m = S.pendOwn || (S.pendOwn = {});
  const now = Date.now();
  for (const kk in _m) if (!(now - _m[kk] < 600000)) delete _m[kk];
  if ((S.pending || []).some(p => p && p.did === k)){ _m[k] = now; return true; }
  return !!_m[k];
}

/* ================= ⑥ 本地账本（IDB ledger_conv；按服务端隔离） =================
   键＝'lb|<服务端名>|<终身号>'（2.184 改2·规范§十 :268：键＝终身号，名只作显示）；
   值＝{srv, sid, title, ts, lastView, rounds}。1 轮＝[人类行, 终极行]（沿用快照行
   格式，渲染零换算）。同一会话无论从哪条链路进来（锚定快照/账本补发/核对）
   键必须落到同一条终身上，绝不写一条读另一条。 */
function lbKey(sid, title){
  /* 2.184 改2（规范§十 :268 键＝终身号）：账本一律按终身号建档——锚定路
     （S.anchorSid＝稳定键）与账本帧路（d.sid＝完整 id）归一；非 4 位数字
     sid 按 稳定键 口径退回会话名，名也取不到才用原 sid 兜底。 */
  const s = String(sid || '');
  let k = '';
  try { k = (typeof 稳定键 === 'function') ? String(稳定键(s, String(title || '')) || '') : ''; } catch(e){ k = ''; }
  return 'lb|' + lbSrvKey() + '|' + (k || s);
}
function lbRoundKey(r){
  /* 2.184 改3（规范§七 :194 同号不同态）：轮身份＝正式 mid 优先；无正式 mid
     退回「角色|正文前24字|完成卡前12字」（旧账本兼容）。旧实现只按正文，
     同一句话的两轮会互吞，新轮永远进不去（A1 实锤）。 */
  return (r || []).map(m => {
    const id = String((m && m[6]) || '').trim();
    if (/^[0-9a-fA-F]{8}/.test(id)) return 'M\u0001' + id;
    return ((m && m[0]) || '') + '\u0001'
      + String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 24) + '\u0001'
      + String((m && m[7]) || '').replace(/\s+/g, '').slice(0, 12);
  }).join('#');
}
function lbRoundsFromMsgs(msgs){
  /* 2.213（前端零拦截）：这里只做「u 起一轮」的分组，不筛不弃——
     缺 mid／缺类型／未认证的 AI 行一律原样收；行类型照抄后端 index8（缺则空，
     显示端显「类型未知」）。无人类行在前的 AI 行也单列一轮，绝不丢。 */
  const rounds = [];
  let cur = null;
  (msgs || []).forEach(m => {
    if (!Array.isArray(m)) return;
    if (m[0] === 'u'){
      if (cur && cur.length) rounds.push(cur);       /* 半轮也落 */
      cur = [m.slice()];
    } else if (m[0] === 'a'){
      /* 3.02（老板 12:21 令）：思维流永远只有一条、挂账本最底部、不占保留轮数
         ——轮次里只收 AI 终极回复('a')，th 一律不进轮次。 */
      if (String((m.length > 8 && m[8]) || '').toLowerCase() === 'th') return;
      const fin = String((m.length > 7 && m[7]) || '').trim();
      const patch = lbPatchMarked(m);
      /* '提前终极'/'补记'/'账本定稿' 是来源标记不是正文，正文保留原文
         （2.212 口径；2.272 增 '账本定稿'——服务端 ledger 补发用它标 fin=1，
         原样当正文会把 AI 终极回复顶成四个字）。 */
      const _disp = (fin && fin !== '补记' && fin !== '提前终极'
                     && fin !== '账本定稿')
        ? fin : (m[1] || '');
      const row = [m[0], _disp, '', 0, 0, '', m[6] || '',
                   fin || (patch ? '补记' : ''),
                   String(m[8] || ''),          /* 2.213：类型照抄后端 index8，不推断 */
                   m[9] || ''];                 /* 2.209：账本行不存时间（index2 恒空） */
      if (cur) cur.push(row);
      else rounds.push([row]);                      /* 2.213：无人类行的 AI 行原位保留 */
    }
  });
  if (cur && cur.length) rounds.push(cur);
  return rounds;
}
/* 2.219（保留轮数真正生效）：本地账本唯一裁剪入口——lbRoundKey 去重后截尾
   最新 N 轮（N＝lbRounds()）。**只裁 rounds 数组**，整条记录的 ts/lastTs/
   lastView/pend/diag/think 一律保留；屏幕上的消息不受影响（零拦截不变）。
   quiet=true 时不逐本记日志（开机批量只记一条汇总）。 */
function lbLedgerTrimRounds(rounds, key, quiet){
  const n = lbRounds();
  const arr = Array.isArray(rounds) ? rounds : [];
  const seen = new Set(), uniq = [];
  arr.forEach(r => {
    if (!Array.isArray(r) || !r.length) return;
    const k = lbRoundKey(r);
    if (seen.has(k)) return;
    seen.add(k); uniq.push(r);
  });
  if (uniq.length <= n) return uniq;
  const out = uniq.slice(-n);
  if (!quiet){
    try { diagLog('账本裁剪|键=' + String(key || '') + '|裁前=' + uniq.length
      + '|裁后=' + n, 'ok'); } catch(e){}
  }
  return out;
}
/* 2.220（预备画面同一把尺子）：把 snap_conv 的 msgs 按「u 起一轮」分组（AI/思维流
   等其它行随当前轮，思维流不单独计轮），复用 lbLedgerTrimRounds 判定（lbRoundKey
   去重 + slice(-N)）后平铺回行数组。只裁预备画面存量；当前屏 S.snap 不走此路，
   前端零拦截不变。 */
function lbTrimFrameMsgs(msgs, key, quiet){
  const arr = Array.isArray(msgs) ? msgs : [];
  if (!arr.length) return arr;
  const groups = [];
  let cur = null;
  arr.forEach(m => {
    if (!Array.isArray(m)) return;
    if (m[0] === 'u'){
      if (cur && cur.length) groups.push(cur);
      cur = [m];
    } else if (cur){
      cur.push(m);                      /* AI 终极/思维流等随当前轮 */
    } else {
      groups.push([m]);                 /* 人类行之前的孤立行单列一组，绝不丢 */
    }
  });
  if (cur && cur.length) groups.push(cur);
  const kept = lbLedgerTrimRounds(groups, key, true);
  if (kept.length < groups.length && !quiet){
    try { diagLog('预备画面裁剪|键=' + String(key || '') + '|裁前=' + groups.length
      + '|裁后=' + kept.length, 'ok'); } catch(e){}
  }
  const out = [];
  kept.forEach(g => g.forEach(m => out.push(m.slice())));
  return out;
}
/* 2.183 修4b（老板实测：小账本以纯数字命名·落盘层兜底）：title 为空或纯数字
   （/^\d+$/，服务端 TRAE本地账本.py 键常为 4 位序号，显示名在服务端 _名 映射
   未随帧下发）→ 先按 sid 从本地会话列表解析显示名（只读，不发帧）；解析不到
   保持原值。函数内单点做，ledgerStoreApply/ledgerOnSnap 两条调用路自动受益。 */
function lbResolveTitle(sid, title){
  const t = String(title || '').trim();
  if (t && !/^\d+$/.test(t)) return t;
  try {
    const s = String(sid || '');
    if (s && Array.isArray(S.convs)){
      const ks = (typeof 稳定键 === 'function') ? 稳定键(s, '') : null;
      for (const r of S.convs){
        if (!r || !r[1]) continue;
        const rs = String(r[4] || '');
        if (rs === s || (ks !== null && 稳定键(rs, '') === ks)) return String(r[1]);
      }
    }
  } catch(e){}
  return title || '';
}
/* 2.202（老板 2026-11-19 21:51 令·手机网页端＝诊断口，不设拒收闸门）：
   数据不合格（缺名/缺 sid）也照建账本，名称要能一眼定位毛病——
   有 sid 无名 → 「（无名）<sid 后 6 位>」；无名无 sid → 「（无名）无sid」。
   返回 {title, diag}，diag=1 时调用方在账本记录打诊断标记（列表可见）。 */
function lbDiagTitle(sid, title){
  const t = String(title || '').trim();
  if (t) return {title: t, diag: 0};
  const s = String(sid || '').trim();
  return {title: s ? ('（无名）' + s.slice(-6)) : '（无名）无sid', diag: 1};
}
/* 2.264（老板 2026-11-24「读 A 写 B」）：账本落盘键唯一入口——**终身号优先**：
   有权威 4 位终身号就用号，改名不换本（旧写法取 稳定键＝名称，会话一改名就另起
   一本，读旧的、存新的）。名称只在拿不到号时兜底；键形仍沿用 _frameMemKey 口径，
   保证秒显/回写/列表读的是同一条记录。 */
function lbLedgerSnapKey(sid, title){
  const s = String(sid || ''), t = String(title || '').trim();
  let u = '';
  try { u = String((typeof lbUidPick === 'function') ? (lbUidPick(null, s, t) || '') : '').trim(); } catch(e){ u = ''; }
  const k = /^\d{4}$/.test(u) ? u
    : ((typeof 稳定键 === 'function') ? (String(稳定键(s, t) || '') || s || t) : (s || t));
  return (typeof _frameMemKey === 'function') ? String(_frameMemKey(k) || '') : ('frame|' + k);
}
/* 2.184 改1（规范§三 :54 秒显源＝账本本体）：最新账本（对账补发/主动核对/
   强制核对拉到）落盘成功后，立刻把同一份 rounds 平铺成画面写回 snap_conv——
   键走 lbLedgerSnapKey（终身号优先，2.264）＋走 _frameCommit「只进不退」
   闸（旧账本不覆盖更新的真快照，内存槽同步更新 ⇒ 切回 0ms 命中）。 */
function lbWriteBackSnap(sid, title, rounds){
  try {
    if (!Array.isArray(rounds) || !rounds.length) return;
    if (typeof _frameCommit !== 'function' || typeof _frameMemKey !== 'function') return;
    const s = String(sid || '');
    const t = String(title || '').trim();
    if (!t) return;                       /* 2.184 改7：名称必有——无标题不写秒显 */
    const sk = lbLedgerSnapKey(s, t);
    if (!sk) return;
    /* 2.211：画面记录另存**真实 sid** 与**权威 uid**；键仍走稳定键（无名回退完整 sid），
       绝不在记录里塞切片假号。 */
    const _uidAuth = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : '';
    const rows = [];
    rounds.forEach(r => (r || []).forEach(m => { if (Array.isArray(m)) rows.push(m.slice()); }));
    if (!rows.length) return;
    /* 2.220：写回预备画面也走同一把尺子（只留最新 N 轮），与账本存量同源。 */
    const _rows = lbTrimFrameMsgs(rows, sk, true);
    if (!_rows.length) return;
    const frame = {msgs: _rows, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [],
                   model: ''};
    /* 2.243（老板 2026-11-21 08:25「预备画面与小账本合为一个」）：旧闸只看末条
       mid——画面里还有思维流（mid 更大）时，账本终极回复（mid 较小）永远进不去。
       改按轮数放行：账本轮数不更少即可覆盖。 */
    const _oldMsgs = (typeof _frameMem === 'object' && _frameMem[sk]
      && Array.isArray(_frameMem[sk].msgs)) ? _frameMem[sk].msgs
      : (S.liveFrame && Array.isArray(S.liveFrame.msgs)
         && (!S.livePend || (typeof _frameMemKey === 'function' && _frameMemKey(S.livePend) === sk))
         ? S.liveFrame.msgs : null);
    const _oldN = (_oldMsgs && typeof lbRoundsFromMsgs === 'function')
      ? lbRoundsFromMsgs(_oldMsgs).length : 0;
    const _newN = Array.isArray(rounds) ? rounds.length : 0;
    _frameCommit(sk, frame,
      {key: (typeof frameKey === 'function') ? frameKey() : '',
       port: S.port, sid: s, uid: _uidAuth, title: String(title || ''), ts: Date.now()},
      undefined, undefined, (_oldN > 0 && _newN >= _oldN));
  } catch(e){}
}
/* 2.264（老板 2026-11-24 新口径原文：「反正拉来的历史记录，只要进得了前 N 条，那就写到
   小账本，小账本有前 N 条保留机制……够进这个范围，当然就给它记录了。它的地位等同于核对
   账本。」）——hist / hist_prev 回包并入唯一账 snap_conv：
     · 行结构照抄服务端（ledToArr，index5/6/7/8/9 一律不动，尤其 fin 终答不许冲空）；
     · 按 mid 只并「本地账本里还没有的」，已有轮原位不动；
     · 先经 lbTrimFrameMsgs（＝lbRoundsFromMsgs + lbLedgerTrimRounds，N 取 lbRounds()
       默认 5）裁到前 N 轮再写——够进前 N 轮才落盘，更老的翻页不写（写也白写）；
     · 写入只走 _frameCommit：与核对账本同一条通道、同一个键、同一套 srv 标签，
       不另开表、不另起键。
   older=true 表示「更早一页」（hist_prev），合并时排在本账前面。 */
/* 2.264：hist 回包只带 S.histConv（锚定键），本节话的 sid/名称要从锚定或会话列表
   反查——绝不能拿 curTitle() 的「当前会话」兜底名去建账（那会另起一本）。 */
function _lbHistCtx(){
  try {
    const key = String(S.histConv || '').trim();
    if (!key) return null;
    const cv = (S.snap && Array.isArray(S.snap.convs)) ? S.snap.convs : [];
    for (const r of cv){
      if (!Array.isArray(r) || r[0] !== 'c') continue;
      const t = String(r[1] || '').trim(), s = String(r[4] || '');
      if (!t) continue;
      let kk = '';
      try { kk = (typeof 稳定键 === 'function') ? String(稳定键(s, t) || '') : t; } catch(e){ kk = t; }
      if (kk === key || t === key || (s && s === key))
        return {sid: s, title: t};
    }
    /* 锚定兜底：稳定键（无号会话）本来就等于名称，直接用历史键当名称，
       绝不用 curTitle() 的「当前会话」——那会另起一本「当前会话」账。 */
    const at = String(S.anchorTitle || '').trim();
    if (at && at === key) return {sid: String(S.anchorFull || ''), title: at};
    if (!/^\d+$/.test(key) && key.length <= 60)
      return {sid: String(S.anchorFull || ''), title: key};
  } catch(e){}
  return null;
}
function lbHistToLedger(older){
  try{
    const raw = Array.isArray(S.histRaw) ? S.histRaw : [];
    if (!raw.length) return;
    if (typeof ledToArr !== 'function' || typeof _frameCommit !== 'function') return;
    if (typeof _frameMemKey !== 'function' || typeof lbLedgerSnapKey !== 'function') return;
    const ctx = _lbHistCtx();
    if (!ctx) return;                 /* 认不出这会话：宁可不写，绝不拿「当前会话」另起一本 */
    const sid = String(ctx.sid || '');
    const title = String(ctx.title || '').trim();
    if (!title) return;                       /* 2.184 改7：名称必有 */
    const sk = lbLedgerSnapKey(sid, title);   /* 2.264：与核对账本同一个键（终身号优先） */
    if (!sk) return;
    const rows = [];
    raw.forEach(function(x){
      const m = ledToArr(x);
      if (Array.isArray(m) && m.length) rows.push(m);
    });
    if (!rows.length) return;
    const _write = function(oldMsgs){
    let old = Array.isArray(oldMsgs) ? oldMsgs : [];
    const seen = new Set(), idx = {}, out = [];
    const push = function(list){
      (list || []).forEach(function(m){
        if (!Array.isArray(m) || !m.length) return;
        let k = '';
        try { k = (typeof lbRoundKey === 'function') ? lbRoundKey([m]) : ''; } catch(e){ k = ''; }
        if (!k) k = String(m[0] || '') + '|' + String(m[1] || '').slice(0, 24);
        if (seen.has(k)){
          /* 2.264：同一 mid 已存在时，绝不让「没终答的那版」把「有终答的」盖掉
             ——hist 回包经 ledToArr 不带 index7，用它顶掉账本会丢终极回复。 */
          const i = idx[k];
          if (i != null && out[i] && !String(out[i][7] || '').trim()
              && String(m[7] || '').trim()) out[i] = m.slice();
          return;
        }
        seen.add(k); idx[k] = out.length; out.push(m.slice());
      });
    };
    if (older){ push(rows); push(old); } else { push(old); push(rows); }
    const trimmed = lbTrimFrameMsgs(out, sk, true);      /* ← 前 N 轮裁剪，够进才留 */
    if (!trimmed.length) return;
    const frame = {msgs: trimmed, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [], model: ''};
    const _uid = (typeof lbUidPick === 'function') ? lbUidPick(null, sid, title) : '';
    _frameCommit(sk, frame,
      {key: (typeof frameKey === 'function') ? frameKey() : '',
       port: S.port, sid: sid, uid: _uid, title: title, ts: Date.now()},
      undefined, undefined, false);
    /* 屏幕同源：内存 rows 同步，补进来的历史立刻能被 lbScreenMsgs / curMsgs 读到 */
    try {
      const rounds = lbRoundsFromMsgs(trimmed);
      if (rounds.length && typeof lbRowsPut === 'function') lbRowsPut(_uid, title, rounds);
    } catch(e){}
    };
    /* 2.264：合并基准必需——内存里没有该会话（刚刷新/没点过）时必须先读盘上那份，
       否则 hist 那版（ledToArr 不带 index7）会把已存的终答整轮冲空（实测 [1,2,0,""]）。 */
    let memOld = null;
    try {
      if (typeof _frameMem === 'object' && _frameMem[sk] && Array.isArray(_frameMem[sk].msgs))
        memOld = _frameMem[sk].msgs;
      else if (S.liveFrame && Array.isArray(S.liveFrame.msgs)
               && (!S.livePend || _frameMemKey(S.livePend) === sk)) memOld = S.liveFrame.msgs;
    } catch(e){ memOld = null; }
    if (memOld && memOld.length){ _write(memOld); return; }
    if (typeof _idbReq === 'function'){
      _idbReq('snap_conv', 'readonly', function(st){ return st.get(sk); }).then(function(rec){
        _write((rec && rec.frame && rec.frame.msgs) || null);
      }).catch(function(){ _write(null); });
      return;
    }
    _write(null);
  } catch(e){}
}
/* 2.245（老板 2026-11-21 10:25「切会话跳动、连续三个人类都没有 AI 回复，小账本里却有」）：
   一句话根因——屏幕吃的是服务端快照，唯一账 snap_conv 里的 AI 终极只在几处窄条件下
   顶屏；快照一拍回来就把带 AI 的那版盖掉。治法＝在快照入口先把本地唯一账里「同一轮
   人类发言、屏上却缺 AI 行」的终极补回屏上：补进去的行就地插入该轮末尾（思维流之后），
   不改顺序、不动别的轮；找不到同 mid 的轮一律不碰，防串会话。此后 render/snapIdbTick/
   ledgerOnSnap 拿到的都是补全版，前台与小账本天然同一份。 */
function _lbMergeFinals(local, msgs){
  /* 2.246：合并核心——只按人类 mid 对齐补 AI 行，不改顺序、不碰对不上的轮。 */
  try{
    if (!Array.isArray(msgs) || !msgs.length) return msgs;
    if (!Array.isArray(local) || !local.length) return msgs;
    /* 本地账：人类 mid → 该轮的 AI 行（只认带正式 mid 的轮，没 mid 无法对齐） */
    const want = {};
    let curKey = '';
    local.forEach(m => {
      if (!Array.isArray(m)) return;
      if (m[0] === 'u'){ curKey = String(m[6] || '').trim(); return; }
      if (m[0] === 'a' && curKey) (want[curKey] = want[curKey] || []).push(m);
    });
    if (!Object.keys(want).length) return msgs;
    /* 屏上哪些轮已有 AI 行 */
    const hasA = {};
    let lastU = '';
    msgs.forEach(m => {
      if (!Array.isArray(m)) return;
      if (m[0] === 'u'){ lastU = String(m[6] || '').trim(); return; }
      if (m[0] === 'a' && lastU) hasA[lastU] = true;
    });
    const out = msgs.slice();
    let addN = 0;
    for (let i = out.length - 1; i >= 0; i--){
      const m = out[i];
      if (!Array.isArray(m) || m[0] !== 'u') continue;
      const mid = String(m[6] || '').trim();
      if (!mid || hasA[mid] || !want[mid]) continue;
      let j = i;
      for (let k = i + 1; k < out.length; k++){
        if (Array.isArray(out[k]) && out[k][0] === 'u') break;
        j = k;
      }
      const add = want[mid].map(x => x.slice());
      out.splice.apply(out, [j + 1, 0].concat(add));
      hasA[mid] = true;
      addN += add.length;
    }
    return addN ? out : msgs;
  }catch(e){ return msgs; }
}
function lbFillFinals(sid, title, msgs){
  try{
    if (!Array.isArray(msgs) || !msgs.length) return msgs;
    const s = String(sid || ''), t = String(title || '').trim();
    let local = null;
    try {
      const _sid = (typeof 稳定键 === 'function')
        ? (String(稳定键(s, t) || '') || s || t) : (s || t);
      const sk = (typeof _frameMemKey === 'function') ? _frameMemKey(_sid) : '';
      if (sk && typeof _frameMem === 'object' && _frameMem[sk]
          && Array.isArray(_frameMem[sk].msgs)) local = _frameMem[sk].msgs;
      if (!local && S.liveFrame && Array.isArray(S.liveFrame.msgs)){
        const _lp = String(S.livePend || S.anchorSid || '');
        if (!_lp || (typeof _frameMemKey === 'function' && _frameMemKey(_lp) === sk))
          local = S.liveFrame.msgs;
      }
    } catch(e){}
    const out = _lbMergeFinals(local, msgs);
    try { if (out !== msgs && typeof diagLog === 'function')
      diagLog('喂终答|' + (t || s) + '|补 ' + (out.length - msgs.length) + ' 条', 'ok'); } catch(e){}
    return out;
  }catch(e){ return msgs; }
}
/* 2.248（老板 2026-11-21 11:31 令·一套规则）：主界面就是小账本的显示器——
   小账本（唯一账 snap_conv）有什么，主界面就显示什么。每次快照到达后异步读回本会话
   账本记录，以账本为底（一条不丢、不重排），只把屏上「账本没有且更新」的行补到尾部，
   然后把这一份先写回唯一账（_frameCommit，只进不退）、再顶屏（renderAll）——
   先落盘、后显示，二者永远同一份。同会话 0.6 秒最多读一次盘；读回时锚定已换
   只回填内存槽、绝不动屏幕，绝不串会话。 */
const _lbFillAsyncAt = {};
function lbFillFinalsAsync(sid, title){
  try{
    if (typeof _idbReq !== 'function' || typeof _frameMemKey !== 'function') return;
    const s = String(sid || ''), t = String(title || '').trim();
    const key = (typeof 稳定键 === 'function') ? (String(稳定键(s, t) || '') || s || t) : (s || t);
    if (!key) return;
    const sk = _frameMemKey(key);
    const now = Date.now();
    if (_lbFillAsyncAt[sk] && now - _lbFillAsyncAt[sk] < 600) return;
    _lbFillAsyncAt[sk] = now;
    _idbReq('snap_conv', 'readonly', st => st.get(sk)).then(rec => {
      const loc = (rec && rec.frame && Array.isArray(rec.frame.msgs)) ? rec.frame.msgs : null;
      if (!loc || !loc.length) return;
      /* 读盘回来再验一次锚定：已切走就只回填内存槽、不动屏幕 */
      const _onScreen = (String(S.anchorSid || '') === key
                         || String(S.anchorTitle || '') === t);
      const _lv = !!(S.liveFrame && Array.isArray(S.liveFrame.msgs) && S.liveFrame.msgs.length);
      const target = _lv ? S.liveFrame.msgs
                         : ((S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : null);
      const out = (target && target.length) ? _lbLedgerTop(loc, target) : loc;
      if (!out || !out.length) return;
      /* 内存槽同步成账本这一份（切回 0ms 命中且与账本一致） */
      try {
        const f = {online: !!(S.snap && S.snap.online), login: (S.snap && S.snap.login),
                   msgs: out, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [], model: '',
                   _srv: (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : ''};
        _frameMem[sk] = f;
        if (t) _frameMemByTitle[_frameTitleKey(t)] = f;
      } catch(e){}
      /* 先落盘：同一份写回唯一账（只进不退；内容未变时闸门自然拒收，无副作用） */
      try {
        if (typeof _frameCommit === 'function')
          _frameCommit(sk, {online: !!(S.snap && S.snap.online),
            login: (S.snap && S.snap.login), msgs: out, finish: null, tail: '',
            sendIdle: true, inputText: '', opts: [], ask: null, pend: [], model: ''},
            {key: (typeof frameKey === 'function') ? frameKey() : '',
             port: S.port, sid: s, title: String(title || ''), ts: Date.now()});
      } catch(e){}
      if (!_onScreen || target === out) return;
      /* 再显示：主界面＝小账本这一份 */
      if (_lv) S.liveFrame.msgs = out; else S.snap.msgs = out;
      try { diagLog('账本顶屏|' + (t || key) + '|' + out.length + '行', 'ok'); } catch(e){}
      renderAll();
    }).catch(() => {});
  }catch(e){}
}
/* 2.248：以账本帧为底、只补屏上「账本没有且更新」的行（同 mid 取正文更长）。
   账本行一条不丢、不重排、不裁——主界面直接反映小账本。 */
function _lbLedgerTop(loc, target){
  try{
    const out = [], seen = {};
    loc.forEach(m => {
      if (!Array.isArray(m)) return;
      const k = _msgKey(m);
      if (seen[k]) return;
      seen[k] = 1; out.push(m);
    });
    let maxMid = '';
    loc.forEach(m => {
      const d = String((m && m[6]) || '');
      if (_midIsFormal(d) && d > maxMid) maxMid = d;
    });
    target.forEach(m => {
      if (!Array.isArray(m)) return;
      const k = _msgKey(m);
      let at = -1;
      for (let i = 0; i < out.length; i++){ if (_msgKey(out[i]) === k){ at = i; break; } }
      if (at >= 0){
        const ot = String(out[at][1] || ''), nt = String(m[1] || '');
        const _ok = String((out[at].length > 8 && out[at][8]) || '').toLowerCase();
        const _nk = String((m.length > 8 && m[8]) || '').toLowerCase();
        /* 3.02（老板 12:21 令）：只升不降——新帧已判终极('a')时，必须覆盖旧帧
           存下的思维流类型('th')，否则旧类型会被唯一账一直沿用、终答永远被藏。 */
        if ((_nk === 'a' && _ok !== 'a') || nt.length > ot.length) out[at] = m;
        return;
      }
      /* 只收账本里没有的新行：有正式 mid 且比账本末条更新；无 mid 行不补（防历史重复） */
      const d = String((m && m[6]) || '');
      if (_midIsFormal(d) && d > maxMid) out.push(m);
    });
    return out;
  }catch(e){ return loc; }
}
/* 2.248（老板 2026-11-21 11:31 令）：冷启动首屏同样「主界面＝小账本」——
   读唯一账 snap_conv 本会话记录（旧实现在读已清空的 ledger_conv，永远读不到），
   以账本为底、补屏上更新行，先落账再顶屏。 */
function lbBootMerge(sid, title){
  try{
    const s = String(sid || '');
    const t = String(title || '').trim();
    if (!s && !t) return;
    if (typeof renderAll !== 'function') return;
    /* 2026-11-24 单账本：只用账本 rounds 顶屏，不再读存帧。 */
    const _rows = (typeof lbScreenMsgs === 'function') ? lbScreenMsgs(s, t) : [];
    if (!_rows.length) return;
    if (S.anchorSid){
      const _k2 = (typeof 稳定键 === 'function') ? String(稳定键(s, t) || '') : '';
      if (_k2 && S.anchorSid !== _k2) return;
    }
    S.liveFrame = null; S.msgs_key = '';
    renderAll();
    return;
  }catch(e){}
}
/* 2.184 改2（残留清理）：新键已存在、但同会话还挂着旧 raw 键记录（2.183 及
   以前按原始 sid 建过档，或迁移中断）→ 删旧留新，保证「同一会话绝不出现两条
   账本」。按 sk 记账一生只扫一次全表（账本条数很小，代价可忽略）。 */
const _lbPurgedSk = {};
/* 2.184 改7（老板 2026-11-19 终版口径·锚定双轨：终身号优先、名称兜底、后续归并）：
   终身号（sid）存在共享数据库里、有时创建不及时抓不到，但每个对话一定有名称。
   所以「没有 sid」时先用名称当临时键照常建账本（记录带 pend:1 待补号）；等同一
   会话后续帧带上 sid 时，把名称键下的账本整体迁到终身号键：
     · 轮次按 mid 去重合并（lbRoundKey 同口径，绝不重复）；
     · ts / lastTs / lastView 各取较大；
     · 删掉临时键（同一会话只留一条账本）；
     · 秒显（snap_conv + 内存槽）同步迁到终身号键，并删掉名称键那份，防秒显双份。
   非 4 位数字 sid（临时/hex id）本来就以名称为键，无「临时→正式」可迁，直接返回。 */
function lbMigrateTitle(sid, title){
  return new Promise(res => {
    try {
      const s = String(sid || '').trim(), t = String(title || '').trim();
      if (!s || !t) return res(false);
      /* 2.211：正式键只由权威 uid 决定；无权威 uid ⇒ 本来就落名称键，无「临时→正式」可迁。 */
      const _mu = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : '';
      const skTmp = lbStoreKey('', t);               /* 临时键＝L<本服>:t:<名称> */
      const skSid = lbStoreKey(_mu || '', t);        /* 2.196：与落账同键（权威 uid 优先） */
      if (skSid === skTmp) return res(false);
      Promise.resolve([]).then(all => {
        const rows = all || [];
        const cur = rows.find(r => !lbIsLegacyRec(r) && r.sk === skSid);
        /* 2.214（重复桶根因修复）：要并的临时账本＝**同名且无权威终身号**的桶，
           不再要求「sid 必须为空」——旧实现只并 sid 空的记录，而名称键桶落账时
           带的是真实 sid，于是永远并不过来 ⇒ 同名两本（一本 uid 键、一本名称键）。
           同名、无 4 位权威 uid 的桶一律并入正式键（只迁不删内容）。 */
        const tmps = rows.filter(r => !lbIsLegacyRec(r) && r.sk !== skSid
          && (r.sk === skTmp
              || (String(r.title || '').trim() === t && !lbUidAuth(r.uid))));
        if (!tmps.length) return res(false);
        const base = (cur && Array.isArray(cur.rounds)) ? cur.rounds.slice() : [];
        const seen = new Set(base.map(lbRoundKey));
        tmps.forEach(tmp => (tmp.rounds || []).forEach(r => {
          const rk = lbRoundKey(r);
          if (!seen.has(rk)){ seen.add(rk); base.push(r); }
        }));
        const out = base.slice();          /* 2.213：归并也不按保留轮数裁剪 */
        const maxNum = (a, b) => Math.max(Number(a) || 0, Number(b) || 0);
        /* 2.214：思维流只留最新一条（随账本一起迁移，不参与轮次） */
        let _think = (cur && cur.think) || null;
        tmps.forEach(tmp => { if (tmp.think && (!_think || (tmp.ts || 0) > (Number(cur && cur.ts) || 0))) _think = tmp.think; });
        const rec = {
          sk: skSid, srv: lbSrvTag(), srvName: lbSrvName(), srvFox: lbSrvFox(),
          uid: _mu || '', sid: s,                 /* 2.196 四字段：uid 终身号 / sid 对话ID */
          title: t,                                  /* 2.184 改8：改名归并——以现名为准 */
          ts: maxNum(cur && cur.ts, tmps.reduce((m, x) => Math.max(m, x.ts || 0), 0)) || Date.now(),
          lastTs: maxNum(cur && cur.lastTs, tmps.reduce((m, x) => Math.max(m, x.lastTs || 0), 0)),
          lastView: maxNum(cur && cur.lastView, tmps.reduce((m, x) => maxNum(m, x.lastView || 0), 0)),
          pend: (_mu || name) ? 0 : 1, rounds: out
        };
        if (_think) rec.think = _think;
        const sks = tmps.map(x => x.sk);
        const tmpTitles = tmps.map(x => String(x.title || '').trim()).filter(Boolean);
        /* 2026-11-24（老板令·只留一本账）：不再写 ledger_conv（第二本账已退役）。
           合并结果只由下面 lbWriteBackSnap 写进 snap_conv；旧临时行直接删除。 */
        return Promise.resolve()
          .then(() => {
            /* 临时键摘要全部撤掉（含历史遗留的旧名），换终身号键 */
            tmpTitles.forEach(tt => { try { delete LB.lbSum[tt]; } catch(e){} });
            try { delete LB.lbSum[(cur && cur.title) || '']; } catch(e){}
            try { if (s) delete LB.lbSum[s]; } catch(e){}
            lbSumSet(s, t, out);
            LB.lbHave.add(_mu || s);
            lbWriteBackSnap(s, t, out);              /* 秒显写正式键 */
            /* 秒显临时键（旧名的名称键）删掉：内存槽 + IDB，防同一会话两份秒显。
               2.214：现名 t 的秒显刚写回，绝不删（旧实现会把刚写的这份一起删）。 */
            try {
              tmpTitles.forEach(tt => {
                if (tt === t) return;
                const mk = (typeof _frameMemKey === 'function') ? _frameMemKey(tt) : '';
                if (mk){
                  try { if (_frameMem && typeof _frameMem === 'object') delete _frameMem[mk]; } catch(e){}
                  _idbReq('snap_conv', 'readwrite', st => st.delete(mk)).catch(() => {});
                }
              });
            } catch(e){}
            try { diagLog('临时账本并入终身号 sid=' + s + ' · ' + t, 'ok'); } catch(e){}
            try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
            res(true);
          });
      }).catch(() => res(false));
    } catch(e){ res(false); }
  });
}
/* 2.214：会话名归一——「XXX 重复」「XXX（2）」「XXX 副本」「XXX_2」都算同一本
   「XXX」。只用于归并身份与合并落名，绝不因此改写服务端下发的真实会话名。 */
function lbNormTitle(t){
  let s = String(t == null ? '' : t).trim();
  if (!s) return '';
  /* 2.215：旧「（临时）」「（按名称）」都是显示后缀，不是名字本身——归一到同一桶 */
  s = s.replace(/\s*（临时）\s*$/, '').replace(/\s*（按名称）\s*$/, '');
  s = s.replace(/\s*[·・]?\s*(重复|副本|duplicate)\s*$/i, '');
  s = s.replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '');
  s = s.replace(/\s*_\d+\s*$/, '');
  return s.trim() || String(t || '').trim();
}
/* 2.214（重名必须合并、绝不新建第二个同名桶）：把本服**同一会话**（同 sid 或
   同名，含旧「重复」后缀）的账本合并成唯一一本。只并内容不删内容：轮次按
   lbRoundKey 去重，思维流只留最新一条。 */
function lbMergeForConv(sid, title){
  /* 2.244（老板令·一套账）：同名/同 sid 去重改由唯一正文账 snap_conv 承担
     （lbMergeDuplicateBuckets 开机按 srv+uid/名称分组合并），这里不再读写第二本账。 */
  return Promise.resolve(false);
}
/* 2.214（老板 2026-11-20 08:08 令·落账三类）：账本只记 u 人类发言 / a AI 终极回复
   （含 early_final 提前终极）/ th 思维流。思维流**只留最新一条、固定在最底部**，
   不入 rounds、不参与轮次统计。 */
function lbThinkRowOf(c){
  if (!c) return null;
  const txt = String(c.text || '').trim();
  if (!txt) return null;
  return ['th', txt, '', 0, 0, '', String(c.textMid || c.anchorMid || ''), '', 'th', ''];
}
function lbThinkPut(sid, title, c){
  /* 2.244（老板令·一套账）：思维流只作展示——挂内存，不再写 ledger_conv。
     重进会话时由服务端 think 帧重发最新一版（与 2.207 口径一致）。 */
  try {
    const row = lbThinkRowOf(c);
    const t = String(title || '').trim();
    if (!row || !t) return Promise.resolve(false);
    const u = lbUidPick(null, String(sid || '').trim(), t);
    const sk = lbStoreKey(u, t);
    if (typeof LB === 'object' && LB){
      if (!LB.thinkBySk || typeof LB.thinkBySk !== 'object') LB.thinkBySk = {};
      LB.thinkBySk[sk] = row;
    }
    try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
    return Promise.resolve(true);
  } catch(e){ return Promise.resolve(false); }
}
/* 展示口径（账本最后一屏/最底部）：轮次在前，思维流固定最后一条。 */
function lbLedgerDisplayRows(rec){
  const out = [];
  ((rec && rec.rounds) || []).forEach(r => (r || []).forEach(m => {
    if (Array.isArray(m)) out.push(m);
  }));
  if (rec && Array.isArray(rec.think)) out.push(rec.think);
  return out;
}
/* 2.185（老板 2026-11-19 令·未认证终极弃收日志）：10 秒节流一条，防思维流高频帧刷屏 */
let _lbUnextT = 0;
function _lbUnextLog(a){
  const now = Date.now();
  if (now - _lbUnextT < 10000) return;
  _lbUnextT = now;
  try { diagLog('未认证终极 弃收 mid=' + String((a && a[6]) || ''), 'bad'); } catch(e){}
}
/* 2.244（老板令·一套账）：旧态一律从唯一正文账 snap_conv 还原（不再读 ledger_conv）。
   认同一条：uid 相同或标题相同；取 ts 最新的一条，按其 frame.msgs 还原 rounds。
   找不到返回 null（调用方按空账处理）。 */
function lbOldFromSnaps(uid, title){
  const u = String(uid || '').trim();
  const t = String(title || '').trim();
  if (!u && !t) return Promise.resolve(null);
  const tag = (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : '';
  return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
    let hit = null;
    (rows || []).forEach(rec => {
      try {
        if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs) || !rec.frame.msgs.length) return;
        if (tag && rec.srv && String(rec.srv) !== tag) return;
        const ru = String(rec.uid || '').trim();
        const rt = String(rec.title || '').trim();
        if (!((u && ru && ru === u) || (t && rt === t))) return;
        if (!hit || (Number(rec.ts) || 0) > (Number(hit.ts) || 0)) hit = rec;
      } catch(e){}
    });
    if (!hit) return null;
    const ht = String(hit.title || t).trim();
    return {sk: lbStoreKey(u, ht), uid: hit.uid || u, sid: String(hit.sid || ''),
            title: ht, ts: Number(hit.ts) || 0, lastTs: Number(hit.ts) || 0,
            lastView: 0, diag: 0, rounds: lbRoundsFromMsgs(hit.frame.msgs)};
  }).catch(() => null);
}
function ledgerStorePut(sid, title, rounds, opt){
  try {
    opt = opt || {};
    /* 2.183 修4b：纯数字/空名先解析显示名再落库（解析不到保持原值）。
       2.202（老板 2026-11-19 21:51 令·手机网页端＝诊断口不设限）：撤「缺 title
       弃收（不建无名账本）」闸门——缺名照建诊断账本，命名 lbDiagTitle 兜底
       （（无名）尾6位／（无名）无sid），并打 diag 标记。 */
    title = lbResolveTitle(sid, title);
    const _dt = lbDiagTitle(sid, title);
    title = _dt.title;
    const _diag = _dt.diag;
    const _t = String(title || '').trim();
    /* 2.213（前端零拦截）：撤「会话 ID 无效不建账」「只收 human/final」「缺 mid 不收」
       三道闸——收到什么就落什么；行类型照抄后端 index8，前端不推断、不回写。 */
    if (_diag){
      try { diagLog('收到无名条目（诊断口不设限）→ 已建诊断账本 title='
        + _t + ' sid=' + String(sid || ''), 'bad'); } catch(e){}
    }
    const _rs0 = (rounds || []).map(r => {
      const rows = (r || []).filter(m => Array.isArray(m)).map(m => m.slice());
      return rows.length ? rows : null;
    }).filter(Boolean);
    if (!_rs0.length) return;
    /* 2.196 四字段：srv＝服务端（srv/srvName/srvFox 同源）、uid＝终身号（可空）、
       title＝会话名（必有）、sid＝对话ID（原始会话 id，缺则反查会话列表）。 */
    const _rawSid = String(sid || '').trim();
    /* 2.204（B5）：10 位纯数字＝假账号号源（1623/1632），一律不当会话编号/终身号。 */
    const _fakeSid = /^\d{10}$/.test(_rawSid);
    if (!_rawSid){
      /* 2.196：缺 sid（对话ID）属异常，记调试日志；按名称临时账本兜底，绝不丢内容 */
      try { diagLog('缺 sid（对话ID）账本登记 · ' + _t, 'bad'); } catch(e){}
    } else if (_fakeSid){
      try { diagLog('10 位纯数字不当会话编号/终身号（B5）sid=' + _rawSid + ' · ' + _t, 'bad'); } catch(e){}
    }
    /* 2.197：优先消费服务端下发 uid（body.uid），缺失才按 sid / 名字别名回锚。 */
    const _uid = _fakeSid ? '' : lbUidPick(opt.uid, _rawSid, _t);
    if (_uid) lbAliasSet(_uid, _t);                       /* 2.204（B3）：写名字→编号映射 */
    const _dialogSid = _fakeSid ? '' : (_rawSid || lbRawSidOf(_uid, _t));
    /* 2.209（老板口径「不准再传时间」）：写账本前把每行 m[2] 一律置空——
       账本不存任何时间；显示/排序一律在读取时按该行 mid 现算（timeFromMid）。 */
    _rs0.forEach(rows => rows.forEach(row => {
      if (!Array.isArray(row)) return;
      row[2] = '';
    }));
    const _run = (_effSid) => {
    const _uidEff = String(_effSid || '').trim();          /* 登记主键＝终身号 */
    const sk = lbStoreKey(_uidEff, _t), now = Date.now();
    const rs = _rs0.slice();                               /* 2.213：落账不再按保留轮数裁剪 */
    /* put 成功之后的统一收口（2.184 改4：真存记账必须晚于落盘成功，
       原实现 put 前就 add＝落盘失败也假报「有账」）：真存集 + 摘要表 + 秒显回写。 */
    const _after = (out) => {
      /* 2.184 改7：无 sid 的临时账本不进「真存集」——集合按 sid 认，空串会污染 */
      if (_uidEff) LB.lbHave.add(_uidEff);
      lbSumSet(_uidEff, _t, out);
      lbRowsPut(_uidEff, _t, out);            /* 2026-11-24：账本更新即刷屏幕唯一源 */
      try {   /* 2026-11-24：账本一变，屏幕立刻按账本重画（只认小账本） */
        const _a = String(S.anchorSid || '');
        const _au = _a && (typeof lbUidPick === 'function')
          ? String(lbUidPick(null, _a, S.anchorTitle || '') || '') : '';
        if ((_uidEff && _au && _uidEff === _au)
            || (!_uidEff && _t && String(S.anchorTitle || '') === _t)) renderAll();
      } catch(e){}
      lbWriteBackSnap(_uidEff, _t, out);                   /* 改1：最新账本立刻回写秒显源 */
      /* 2.214：同一会话（同 sid 或同名，含旧「重复」后缀）只留一本账 */
      try { lbMergeForConv(_dialogSid, _t); } catch(e){}
      /* 改6（2.17 查看器）：落盘成功即通知「📒 我的小账本」卡片列表重排
         （仅 ③ 页可见时由查看器自己刷，未开页时是个空钩子，零开销） */
      try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
      return out;
    };
    const _apply = (old) => {
      let out = rs;
      /* 2.198（u 帧先落 [u]、终极帧后到）：按人类行编号（index6）认同一轮，
         更厚者胜——旧半轮让位给新全轮，绝不出现「[u] 与 [u,a]」两轮并存；
         反向（旧全轮比新半轮厚）保留旧轮、丢掉新半轮。 */
      const _incU = new Map();
      rs.forEach(r => {
        const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
        if (k) _incU.set(k, r);
      });
      const _oldRounds = (old && Array.isArray(old.rounds)) ? old.rounds : null;
      if (_oldRounds && _oldRounds.length
          && (_oldRounds.length > rs.length || _incU.size)){
        const _keepOld = [];
        _oldRounds.forEach(r => {
          const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
          const inc = k ? _incU.get(k) : null;
          if (!inc){ _keepOld.push(r); return; }
          if (inc.length >= r.length) return;    /* 新轮更厚：旧半轮让位 */
          _incU.delete(k);                       /* 旧轮更厚：新半轮不并入 */
          _keepOld.push(r);
        });
        if (_oldRounds.length > rs.length){
          /* 旧账更厚（翻页/补发攒过）⇒ 旧轮打底、新轮按身份并入，再截尾 N 轮。
             2.184 改3：轮身份改 mid 优先（lbRoundKey），同文本不同轮不再互吞。
             2.185（老板令·旧脏数据自愈）：同 key 的旧轮与新轮不同态（旧记录是
             思维流/未认证版）⇒ 一律用新轮覆盖成已认证终极版，绝不因「mid 已
             见过」把终极挡在门外。 */
          const incMap = new Map();
          rs.forEach(r => incMap.set(lbRoundKey(r), r));
          out = _keepOld.map(r => incMap.get(lbRoundKey(r)) || r);
        } else {
          out = _keepOld.length ? _keepOld.slice() : rs.slice();
        }
        /* 2.198：同一人类行（index6）已有一轮（更厚/等厚）在 out 里 ⇒ 新的
           半轮不再追加；只有全新的人类行才并入。 */
        const seen = new Set(out.map(lbRoundKey));
        const _uSeen = new Set(out.map(r =>
          String((Array.isArray(r) && r[0] && r[0][6]) || '')).filter(Boolean));
        rs.forEach(r => {
          const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
          if (k && _uSeen.has(k)) return;
          const rk = lbRoundKey(r);
          if (seen.has(rk)) return;
          seen.add(rk);
          out.push(r);
        });
      }
      /* 2.264（老板 2026-11-24 17:43 令「小账本层必须按轮 ID 排好序」）：合并
         去重完成后按 mid 升序稳定排序再落库——mid 前 8 位 hex 即 Unix 秒，
         同长 hex 直接字符串比较即时间序；轮 mid＝首行 m[6]（lbRoundKey 同口径）。
         两轮都有 mid 比 mid；任一轮无 mid（0.51 起不该有，保底）按原始 index，
         后到的旧轮绝不沉底。主界面直通小账本原样显示，渲染层零改动。 */
      out = out.map((r, i) => [r, i,
        /^[0-9a-fA-F]{8}/.test(String((Array.isArray(r) && r[0] && r[0][6]) || '').trim())
          ? String(r[0][6]).toLowerCase() : ''])
        .sort((a, b) => {
          if (a[2] && b[2] && a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
          return a[1] - b[1];
        }).map(x => x[0]);
      /* 2.219（保留轮数真正生效）：落账统一按 N 裁——lbRoundKey 去重后只留
         最新 N 轮（只裁 rounds，记录其余字段不动）。 */
      out = lbLedgerTrimRounds(out, sk);
      /* 2.184 改6（老板 2026-11-19 09:58 / 规范§十 :271）：ts＝「最后更新时间」，
         只随真实内容变化走——仅查看（opt.touch）且轮身份全同 ⇒ 保留原 ts，
         小账本卡片按 ts 倒序就不会因为「点开看一眼」而跳位。 */
      const _same = !!opt.touch && Array.isArray(old.rounds)
        && old.rounds.length === out.length
        && old.rounds.map(lbRoundKey).join('|') === out.map(lbRoundKey).join('|');
      const _ts = _same ? (Number(old.ts) || now) : now;
      /* 2.196 登记规则②：uid 相同而 title 变了＝改名，键不变、就地更新 title，
         历史轮次与待补号标记全保留，绝不新建。 */
      /* 2.244（老板令·一套账）：不再写 ledger_conv——唯一正文账由
         _after → lbWriteBackSnap 落 snap_conv；ts/think 等元数据不再另存第二本。 */
      return Promise.resolve().then(() => _after(out));
    };
    /* 2.244（老板令·一套账）：旧态只从唯一正文账 snap_conv 还原；找不到按空账合并。
       第二本账 ledger_conv 已停写清空，绝不在此再读/再写。 */
    lbOldFromSnaps(_uidEff, _t).then(rec => _apply(rec || {}));
    };
    /* 2.196 登记顺序（老板原话，顺序不可乱）：
       ① 有终身号 → 以 uid 为账本主键登记（同名临时代号账本先归并进 uid 键）；
       ② 同 uid 改名 → 在 _apply 里就地更新 title（键未变即不新建）；
       ③ 无 uid 但有 title → 先找同服同名账本，有就归并进他那本；
       ④ 同名也没有（sid 独有且无号）→ 才以名称键新建临时账本（pend:1）。 */
    const _dispatch = () => {
      if (_uid){ _run(_uid); return; }
      /* 2.244（老板令·一套账）：同名归并只在唯一正文账 snap_conv 里找旧账 */
      lbOldFromSnaps('', _t).then(hit => {
        _run(hit ? lbUidPick(hit.uid, hit.sid, hit.title || _t) : '');
      }).catch(() => _run(''));
    };
    if (_uid) lbMigrateTitle(_uid, _t).then(_dispatch, _dispatch);
    else _dispatch();
  } catch(e){}
}
/* ============ 2.198（WB+TR 整改 ST·老板令）：人类记录帧（u）即时应答 ============
   服务端新增「人类记录帧」类型标识 u（会话号 sid、会话名 title、消息编号 mid、
   正文 text、可选发送编号 did）。收到即做三件事，全程不等快照/对账/生成结束：
     ① 渲染：按当前会话 sid 归并——追加到已在屏正文（旧消息一条不藏、不跳账本）；
     ② 销卡：按发送编号（did）当场销占位卡（≤3 秒目标；15 秒灰态只作异常兜底）；
     ③ 入账：uid 优先为账本主键，缺 uid 用名称临时键并标 pend:1 待补号；
     2.202 缺名也照建诊断账本（手机网页端＝诊断口，不设拒收闸门）。 */
function lbHumanRecNorm(rec){
  /* 2.206：人类帧不再读取 rec.time/rec.tm 或 14 位 DID 作为时间——
     时间一律由消息 ID（mid）前 8 位十六进制推导。 */
  const o = {text: '', mid: '', did: ''};
  if (Array.isArray(rec)){
    o.text = String(rec[1] == null ? '' : rec[1]);
    o.mid  = String(rec[6] == null ? '' : rec[6]);
    o.did  = String(rec[9] == null ? '' : rec[9]);
  } else if (rec && typeof rec === 'object'){
    o.text = String(rec.text != null ? rec.text
                    : (rec.t != null ? rec.t : (rec.body != null ? rec.body : '')));
    o.mid  = String(rec.mid != null ? rec.mid
                    : (rec.msgId != null ? rec.msgId : (rec.id != null ? rec.id : '')));
    o.did  = String(rec.did != null ? rec.did
                    : (rec.sendId != null ? rec.sendId : ''));
  }
  const _d = o.did || firstLineDid(o.text) || pendDidOf(o.text);
  /* 2.209：不再携带/存储 tm——账本行时间只由 mid 在显示时现算 */
  return {text: o.text, mid: o.mid, did: _d};
}
/* 消息身份键：mid 优先，缺则发送编号，再缺则角色＋正文（只用于去重，不生成新号） */
function lbMsgIdent(m){
  if (!Array.isArray(m)) return '';
  const mid = String(m[6] == null ? '' : m[6]).trim();
  if (mid) return 'M' + mid;
  const did = String(m[9] == null ? '' : m[9]).trim();
  if (did) return 'D' + did;
  return 'T' + String(m[0] || '') + '\u0001' + String(m[1] || '').replace(/\s+/g, '');
}
function lbMsgsAppend(rows, m){
  if (!Array.isArray(rows) || !Array.isArray(m)) return false;
  const k = lbMsgIdent(m);
  if (rows.some(x => lbMsgIdent(x) === k)) return false;
  rows.push(m);
  return true;
}
function lbHumanIsCurrent(sid, title){
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  if (!cs) return false;
  const s = String(sid || '');
  if (s){
    if (s === cs) return true;
    try {
      return !!(typeof 稳定键 === 'function' && 稳定键(s, '') === 稳定键(cs, ''));
    } catch(e){ return false; }
  }
  return !!(title && typeof curTitle === 'function' && String(title) === String(curTitle()));
}
/* 切换在途、目标是别会话：不把该帧塞进当前屏幕（仍可落账），回帧时自然显示 */
function lbHumanSwitchBlocked(sid){
  const sp = S.switch_pend;
  if (!sp || !sp.lockTarget || sp.arrived) return false;
  const tgt = String(sp.sid || '');
  if (!tgt) return true;
  if (String(sid || '') === tgt) return false;
  try {
    return !(typeof 稳定键 === 'function' && 稳定键(sid, '') === 稳定键(tgt, ''));
  } catch(e){ return true; }
}
function ledgerHumanApply(sid, title, rec, opt){
  opt = opt || {};
  const _r = lbHumanRecNorm(rec);
  if (!String(_r.text || '').trim()) return false;
  const _sid = String(sid || '').trim();
  /* 2.213（前端零拦截）：撤「会话 ID 无效不收」「mid 非 24 位 hex 不收」——
     缺 ID 照收照显（无合法 mid 只是不显示时间），收不收由后端判断。 */
  const _t = String(title || '').trim();
  const row = ['u', _r.text, '', 0, 0, '', _r.mid || '', '', 'u'];  /* 2.213：类型照后端口径 u；index2 不存时间 */
  if (_r.did) row[9] = _r.did;
  /* ② 按发送编号当场销卡（u 帧到达＝已进流，不等下一帧、不等 15 秒灰态） */
  let cleared = false;
  try {
    if (_r.did && typeof pendClearByDid === 'function')
      cleared = !!pendClearByDid(_r.did, _t);
  } catch(e){}
  /* ① 2.265（老板 2026-11-24 铁令·只认小账本）：直推人类行不再直写
     S.liveFrame/S.snap 上屏——新会话二者本为空，直写后只剩这一条，
     renderAll 的回落/兜底分支一读就是「主界面只剩最新一条」（实测旁路根因）。
     现改为：行先经 ledgerStorePut 并入小账本（去重+按 mid 排序+裁剪），
     再由 renderAll→curMsgs 从小账本取出渲染（ledgerStorePut 落账收口
     _after 内含「账本一变立刻重画」），「立即显示」语义不破坏。
     shown＝渲染权（是当前会话且未被切换拦截），供返回值口径不变。 */
  let shown = false;
  try {
    ledgerStorePut(_sid, _t, [[row]], {touch: true, uid: opt.uid, humanOnly: true});
  } catch(e){}
  try { shown = lbHumanIsCurrent(_sid, _t) && !lbHumanSwitchBlocked(_sid); } catch(e){}
  if (shown || cleared) { try { renderAll(); } catch(e){} }
  return shown || cleared;
}
/* ev k='u' / k='human' 入口：v={sid,title,uid,mid,text,did,ts}（或 v.rec 同形） */
function ledgerHumanFrame(v){
  if (!v || typeof v !== 'object') return false;
  const sid = String(v.sid || v.selSid || v['会话号'] || '');
  const title = String(v.title || v['会话名'] || v.name || '');
  const rec = (v.rec && typeof v.rec === 'object') ? v.rec : v;
  return ledgerHumanApply(sid, title, rec, {uid: v.uid || (rec && rec.uid)});
}
/* 2.204（C）：把服务端「本轮终极（补记）」标记落到具体轮次上——
   残缺思维流（AI 行）直接按终极收；只有人类行、文本另带的，补一条补记终极，
   与人类发言凑成一轮。不做任何拒收/过滤，只补标记。 */
function lbPatchRounds(rounds, body){
  const g = lbPatchFlag(body);
  const idxs = (body && Array.isArray(body.patched_rounds))
    ? body.patched_rounds.map(n => Number(n) | 0) : [];
  const txt = String((body && (body.patch_text || body.tail || body.text)) || '');
  return (rounds || []).map((r, ri) => {
    if (!Array.isArray(r)) return r;
    const rr = r.map(m => Array.isArray(m) ? m.slice() : m);
    const patch = g || idxs.indexOf(ri) >= 0 || lbPatchFlag(rr);
    if (!patch) return rr;
    let ai = rr.length ? rr[rr.length - 1] : null;
    if (ai && String(ai[0] || '').toLowerCase() === 'a'){
      if (!String(ai[8] || '')) ai[8] = 'patched';
      if (!String(ai[7] || '').trim()) ai[7] = '补记';
    } else if (rr.length === 1 && String(rr[0][0] || '').toLowerCase() === 'u'){
      const mid = String(rr[0][6] || '').trim();
      if (txt && mid) rr.push(['a', txt, '', 0, 0, '', mid, '补记', 'patched']);
    }
    return rr;
  });
}
function ledgerStoreApply(sid, body, ver){
  /* 2.202（老板 2026-11-19 21:51 令·手机网页端＝诊断口不设限）：撤「缺 title
     整帧弃收」闸门——缺名/缺 sid 照建诊断账本（ledgerStorePut 内 lbDiagTitle
     兜底命名并打 diag 标记）；think 不入账的入账范围不动。 */
  if (!body || !Array.isArray(body.rounds)) return;
  const _sid = String(sid || '').trim();
  /* 2.213（前端零拦截）：撤「缺会话 ID 整帧不收」「按轮过滤缺 ID 行」「前端升格
     提前终极」——收到什么就落什么；提前终极由后端 index8=a+early_final 驱动显示。
     仅保留补记标记识别（lbPatchRounds，只补标记不拒收）。 */
  const _rounds = lbPatchRounds(body.rounds, body);
  /* 2.198：只含人类行、没有 AI 行的轮次＝人类记录帧（u）——立即渲染入账；
     其余轮次照旧走 ledgerStorePut。 */
  let _hasFinal = false;
  _rounds.forEach(r => {
    const _rows = Array.isArray(r) ? r : [];
    const _u = _rows.find(m => Array.isArray(m) && String(m[0] || '').toLowerCase() === 'u');
    const _hasA = _rows.some(m => Array.isArray(m) && String(m[0] || '').toLowerCase() === 'a');
    if (_u && !_hasA && _rows.length === 1) ledgerHumanApply(_sid, body.title || '', _u, {uid: body.uid});
    else if (_rows.length) _hasFinal = true;
  });
  /* 2.197：把服务端下发的终身号 body.uid 一并带入落账（缺失时 ledgerStorePut 回退自算）。 */
  if (_hasFinal)
    ledgerStorePut(_sid, body.title || '', _rounds, {touch: true, uid: body.uid});
  /* G1：锚定会话且屏幕无内容 ⇒ 用补发轮次顶屏（人类+终极+折叠按钮）。
     V2 第三轮 Y19（2026-11-19）：liveFrame 锁定期收到【更厚】账本也解锁顶屏——
     ST 实抓：liveFrame 停旧 8 条（≈4 轮），桌面真消息+AI 回复已出，页面 3 分钟
     不动；根因＝旧条件在锁定期间永不顶屏，而 think 快照又滞后（仍是旧 8 条）。
     判据＝账本轮数 > liveFrame 现有轮数（本地账本只增不减，更厚即更新）；
     等厚/更薄不动（防回退旧帧）。 */
  if (_sid && typeof _paneIsAnchor === 'function'
      && _paneIsAnchor(_sid, body.title || '')){
    const _liveN = (S.liveFrame && Array.isArray(S.liveFrame.msgs))
      ? lbRoundsFromMsgs(S.liveFrame.msgs).length : 0;
    const _newN = _rounds.length;
    /* 2.237（老板 2026-11-20 23:21「等很久正文不来，切到小账本回复已到，刷新才出现」）：
       旧判据只比「轮数」——AI 回复补进**同一轮**（人类半轮早到过）时轮数不变
       （_newN == _liveN）⇒ 永不顶屏；而账本侧照常落库 ⇒ 小账本有、正文不动。
       现改：轮数更多，或「账本行并入屏后比屏上更多」，都顶屏；等厚/更薄不动（防回退旧帧）。 */
    const _curArr = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : [];
    const _liveArr = (S.liveFrame && Array.isArray(S.liveFrame.msgs))
      ? S.liveFrame.msgs : [];
    const _屏Rows = Math.max(_curArr.length, _liveArr.length);
    const _spNow = S.switch_pend;
    /* 底稿取「屏上更厚的那份」（当前屏可能是 liveFrame 持屏、也可能是 S.snap），
       避免顶屏时把更厚的屏换成更薄的一份（2.237 防回退）。 */
    const _baseSrc = (_liveArr.length > _curArr.length) ? _liveArr : _curArr;
    const _base = (!(_spNow && _spNow.lockTarget && !_spNow.arrived))
      ? _baseSrc.slice() : [];
    const rows = [];
    _rounds.forEach(r => (r || []).forEach(m => {
      if (Array.isArray(m)) rows.push(m);
    }));
    const _merged = _base.slice();
    rows.forEach(m => { lbMsgsAppend(_merged, m); });
    if (rows.length && (!_屏Rows || _newN > _liveN || _merged.length > _屏Rows
                        || (typeof _lbTailNewer === 'function' && _lbTailNewer(rows, _base)))){
      if (S.livePend){ S.livePend = ''; S.liveFrame = null; }   /* 解锁旧帧，交账本轮顶屏 */
      S.livePend = S.anchorSid;
      S.liveFrame = {msgs: _merged, finish: null, tail: '', sendIdle: true,
                     inputText: '', opts: [], ask: null, pend: [],
                     model: ''};
      /* 2.183 修2：S.lb_foldRounds 赋值行撤——补发面板已撤（§十二-2），
         状态位只在真画面到手时由 :328 处归零防 key 漂移 */
      renderAll();
    }
  }
}
/* 2.183 修2（老板定性·V1.0 §十二-2）：ledgerReqThink（ledger_req-think 通路）
   整函数撤除——TRAE 无「按轮补发思维流」概念（§十二-2），前端已无调用方
   （消息渲染.js 补发面板同轮撤除）；服务端 ledger_req handler 不动＝死路无害。 */
/* 快照到达（事件总线.js snap 分支转调）：账本落盘 + 触碰 lastView + 真画面退场折叠面板 */
function ledgerOnSnap(){
  const s = S.snap || {};
  if (!Array.isArray(s.msgs) || !s.msgs.length) return;
  if (typeof _liveLockOn === 'function' && _liveLockOn()) return;   /* 过渡期正文不属锚定，不记 */
  const sid = S.anchorSid || '';
  if (!sid) return;
  const now = Date.now();
  if (now - _lbSnapAt < 5000){ _lbSnapAt = now; return; }           /* 5 秒节流 */
  _lbSnapAt = now;
  ledgerStorePut(sid, typeof curTitle === 'function' ? curTitle() : '',
                 lbRoundsFromMsgs(s.msgs), {touch: true});
}

/* ================= 失效账本清理（H2/H3） ================= */
/* 2.184 改4：清盘必须同步删摘要表——否则 vcheck 还替已死账本上报编码集合 */
function lbSumDrop(sid, title){
  try {
    const s = String(sid || ''), t = String(title || '').trim();
    let u = '';
    try { u = lbUidPick(null, s, t); } catch(e){ u = ''; }
    delete LB.lbSum[u || t];
    if (t) delete LB.lbSum[t];          /* 旧键（会话名）一并清 */
    if (s) delete LB.lbSum[s];          /* 更旧键（原始 sid）一并清 */
  } catch(e){}
}

/* ============ 2.219：开机/改值后按保留轮数 N 批量裁本地账本 ============
   幂等、批量、不弹窗：逐本只裁 rounds（lbLedgerTrimRounds，quiet），整条记录
   （ts/lastTs/lastView/pend/diag/think）不动；跑完记一条汇总日志（会话数＋
   总裁掉轮数）。与「前端零拦截」不冲突：屏幕上的消息照样显示，只裁本地存量。 */
let _lbTrimAllAt = 0;
/* ============ 2.220：开机/改值后按 N 批量裁预备画面（snap_conv） ============
   与 lbTrimAllRounds 同一把尺子：只裁 frame.msgs 的轮次（lbTrimFrameMsgs →
   lbLedgerTrimRounds），sk/key/sid/uid/title/srv/ts 一律不动；未超 N 的记录不
   重写、不记日志；幂等，裁到的每条记 `预备画面裁剪|键=…|裁前=n|裁后=N`。 */
let _lbTrimSnapAt = 0;
function lbTrimAllSnaps(force){
  try {
    const now = Date.now();
    if (!force && now - _lbTrimSnapAt < 5000) return Promise.resolve(0);
    _lbTrimSnapAt = now;
    let nRec = 0;
    const tasks = [];
    return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      (rows || []).forEach(rec => {
        if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
        const before = rec.frame.msgs.length;
        const kept = lbTrimFrameMsgs(rec.frame.msgs, rec.sk, false);
        if (kept.length === before) return;
        nRec++;
        const nrec = Object.assign({}, rec,
          {frame: Object.assign({}, rec.frame, {msgs: kept})});
        tasks.push(_idbReq('snap_conv', 'readwrite', st => st.put(nrec)).catch(() => {}));
        try {
          if (typeof _frameMem === 'object' && _frameMem) _frameMem[rec.sk] = nrec.frame;
          if (typeof _frameMemByTitle === 'object' && _frameMemByTitle && rec.title)
            _frameMemByTitle[String(rec.key || '') + '|' + String(rec.title)] = nrec.frame;
        } catch(e){}
      });
      return Promise.all(tasks).then(() => nRec);
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}

/* ============ 2.205/2.211：历史账本一次性清理（假桶只迁不删） ============
   背景：21:51 诊断口口径曾允许「无 sid 也按名称建临时账本（键 t:名称、标待补号）」；
   23:29 新令后这类账本一律不再产生。2.211（老板 2026-11-20 07:08 令）：
     · 假桶（uid/sid 为实例号或其截断 1632 的账本/预备画面）**合并/迁移**到正确键
       （本服名称键 `L<本服>:t:<会话名>`），迁移前后条数打印对比，**不许直接删数据**；
       无会话名/空轮次无法迁移的，原样保留并留痕，绝不静默丢弃。
     · uid 与 sid 都为空的按名称临时账本，沿用 2.205 口径删除（与假桶无关）。
   幂等、可重复跑：判据只看记录本身，迁过即无；结果 diagLog 留痕。 */
let _lbTempCleanAt = 0;
/* 2.213（前端零拦截）：开机不再自动清理/迁移临时账本——上面 lbCleanupTempLedgers
   保留定义但**无任何调用方**（等于默认关闭，只记录不清理）；「删不删」归后端。
   若将来确需一次性迁移，须另加显式开关且默认关，不得再开机自动跑。 */

/* ============ 2.214：存量重复桶一次性合并（只合并不删除内容） ============
   老板 2026-11-20 08:08：同名/带「重复」字样/伪编号的桶必须合并成唯一一本。
   规则与落账同一口径：有 4 位权威终身号进终身号桶，否则按会话名归并。
   合并前后条数全部 diagLog 打印（总条数不变；仅「完全相同的副本」折叠时
   单独记一条副本数），并在页面提示一次。 */
const LS_LB_MERGED_214 = 'trae_webm_lb_merged_214';
let _lbMergedAt = 0;
function lbMergeKeyOf(rec){
  const r = rec || {};
  let u = lbUidAuth(r.uid);
  if (!u){
    try {
      const cu = S.convUids || {};
      u = lbUidAuth(cu[r.sid]) || lbUidAuth(cu[r.title]);
    } catch(e){ u = ''; }
  }
  if (u) return lbStoreKey(u, lbNormTitle(r.title));
  /* 2.215：名称兜底——服务端 uid 名称优先，其次会话名；同名一律同一桶 */
  const n = lbUidName(r.uid) || lbNormTitle(r.title);
  if (n) return lbStoreKey('', n);
  return String(r.sk || '');
}
function _snapMergeKey(rec){
  const r = rec || {};
  const srv = String(r.srv || '');
  const u = lbUidAuth(r.uid);
  if (u) return srv + '|u:' + u;
  const n = lbUidName(r.uid) || lbNormTitle(r.title);
  if (n) return srv + '|t:' + n;
  const s = String(r.sid || '').trim();
  return srv + '|s:' + (s || String(r.sk || ''));
}
function _lbMergeRows(a, b){
  /* mid 去重合并（同 mid：保留更厚的那条）；无 mid 仅按整行相同判重。 */
  const A = (a || []).map(m => Array.isArray(m) ? m.slice() : m);
  const seen = new Map();
  A.forEach((m, i) => { if (Array.isArray(m) && m[6]) seen.set(String(m[6]), i); });
  (b || []).forEach(m => {
    if (!Array.isArray(m)) return;
    const id = String(m[6] || '');
    if (id && seen.has(id)){
      const i = seen.get(id);
      if (m.length > (A[i] || []).length) A[i] = m.slice();
      return;
    }
    if (!id && A.some(x => JSON.stringify(x) === JSON.stringify(m))) return;
    if (id) seen.set(id, A.length);
    A.push(m.slice());
  });
  return A;
}
/* ================= ④ 主动核对（1 分钟周期+倒计时）与智能避让 ================= */
setInterval(() => {
  try {
    lbHud();                               /* 悬浮条开关式：关则即撤、开则走字（含冻结态） */
    if (LB.frozen) return;                 /* 追加单 2026-11-18：切换期间核对冻结，绝不发 timer */
    if (LB.checking || !S.onLine || !loggedIn || document.hidden) return;
    const now = Date.now();
    if (!LB.timerAt) LB.timerAt = now + lbPeriodMs();
    if (now >= LB.timerAt){
      LB.timerAt = now + lbPeriodMs();
      /* V2 验收 Y9（2026-11-18）：timer 核对也带锚定 sid——服务端按 sid
         定位「网页端正在看哪个会话」，缺 sid 时服务端只能猜（拿桌面当前
         选中顶上），锚定≠桌面选中时会核错对象。 */
      ledgerVcheckSend('timer', S.anchorFull
        || (typeof curSid === 'function' ? curSid() : '') || '');
      setTimeout(() => { LB.checking = false; }, 5000);   /* 防旧服务端无回帧卡旗标 */
    }
  } catch(e){ LB.checking = false; }
}, 1000);

/* ================= ⑤ 本地离线倒计时（默认 120s 可配） ================= */
/* 任意用户操作重置；走完发下线信号（logout）。与既有 5 分钟闲置退登并存
   （120s 先到先触发，效果一致）；开关 CFG.lb_idleout 默认开。 */
['touchstart', 'mousedown', 'keydown', 'scroll', 'click', 'pointerdown']
  .forEach(ev => document.addEventListener(ev, () => { lbLastAct = Date.now(); },
             {passive: true, capture: true}));
setInterval(() => {
  try {
    if (!CFG.lb_idleout) return;
    if (document.hidden || !S.onLine) return;      /* 后台定时器被冻，不判 */
    if (Date.now() - lbLastAct >= lbOfflineSecs() * 1000){
      lbLastAct = Date.now();
      if (loggedIn) cliLogout('闲置' + lbOfflineSecs() + '秒');   /* 下线信号 */
    }
  } catch(e){}
}, 1000);
/* 保留现有主动下线场景并新增开关：切后台/切网页下线（默认关＝现状不下线） */
document.addEventListener('visibilitychange', () => {
  try {
    if (document.hidden && CFG.lb_bgout && loggedIn) cliLogout('切后台');
  } catch(e){}
});

/* ================= 倒计时文本（整改单 2026-11-18：撤销 #lbhud 悬浮条） =================
   只出数不做界面：缓存查看器「③ 账本调控」区每秒调 window.lbHudText() 刷新展示。
   规范§九-4：任意操作重置 → 人操作时数字不降属正常设计，静置观察才逐秒下降。 */
function lbHudText(){
  try {
    const now = Date.now();
    /* 冻结态（切换进行中）：核对倒计时恒显满周期——数字停住＝冻结中，不发送 */
    const ck = LB.frozen ? (lbPeriodMs() / 1000)
      : (LB.timerAt ? Math.max(0, Math.ceil((LB.timerAt - now) / 1000)) : 0);
    const off = CFG.lb_idleout
      ? Math.max(0, Math.ceil((lbLastAct + lbOfflineSecs() * 1000 - now) / 1000)) : 0;
    return '核对 ' + ck + 's · 离线 ' + off + 's';
  } catch(e){ return '—'; }
}
if (typeof window !== 'undefined') window.lbHudText = lbHudText;

/* 2.234（老板 2026-11-20 23:42）：核对状态改用顶栏「操控:」旁圆球——
   核对在途（四契机任一）圆球变橙闪烁，终态/10 秒兜底自动恢复原绿/灰。
   只改 class，不碰圆球文本与连接态语义；每 500ms 自愈一次（renderTop 重建
   innerHTML 后 <1 秒内必然重新点亮，不依赖渲染时机）。 */
function lbChkBall(){
  try {
    const b = document.querySelector('#lbl_srv .srvdot');
    if (!b) return;
    const on = !!(LB.chkUntil && Date.now() < LB.chkUntil);
    b.classList.toggle('chk', on);
  } catch(e){}
}
setInterval(lbChkBall, 500);

/* 悬浮倒计时条（追加单 2026-11-18 改开关式：规范§九-4 修订——默认关不悬浮，
   开关在缓存查看器「③ 账本调控」区 CFG.lb_hud；开才创建并走字，关即撤）。 */
function lbHud(){
  try {
    if (!CFG.lb_hud){
      if (_lbHudEl){ _lbHudEl.remove(); _lbHudEl = null; }
      return;
    }
    if (!_lbHudEl){
      const st = document.createElement('style');
      st.textContent = '#lbhud{position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));'
        + 'z-index:9000;font-size:10px;line-height:1.3;color:#8a94a6;background:rgba(255,255,255,.88);'
        + 'border:1px solid #dde3ec;border-radius:999px;padding:2px 8px;pointer-events:none;}';
      document.head.appendChild(st);
      _lbHudEl = document.createElement('div');
      _lbHudEl.id = 'lbhud';
      document.body.appendChild(_lbHudEl);
    }
    _lbHudEl.textContent = lbHudText();
  } catch(e){}
}

/* set_think_int 服务端回执（S1 裁定 WS桥 0.27）：{'t':'think_int_ack','ok','sec','on'}
   —— 按 on/sec 更新本地 CFG（服务端是限频间隔的最终真值）；调控输入框由
   缓存查看器「账本调控」区重建 DOM 时按 CFG 回填。 */
function lbThinkIntAck(d){
  try {
    if (!d || typeof d !== 'object') return;
    const sec = Math.max(0, parseInt(d.sec) || 0);
    if (d.ok){
      CFG.lb_think = d.on ? sec : 0;
      cfgSave();
      flash(d.on ? ('思维流间隔已生效：' + sec + ' 秒') : '思维流限频已关闭（画面一变即发）', 'var(--blue)');
    } else {
      flash('思维流间隔下发未生效（服务端拒绝）', 'var(--red)');
    }
  } catch(e){}
}

/* ================= 启动 ================= */
lbVerLoad();
/* 2.214（老板 2026-11-20 08:08）：开机把存量重复桶合并成唯一一本（只合并内容，
   不删聊天）。刷新/重启凭 localStorage 标记不重复跑；换服务器会重新跑一次。
   2.219（老板 16:21「保留最近 N 轮没起作用」）：合并完成后紧接按 N 批量裁本地
   账本存量（幂等、只裁 rounds、一条汇总日志；屏幕消息不受影响）。 */
try { setTimeout(() => {
  try {
    /* 2026-11-24（老板令·只留小账本）：只按 N 裁 snap_conv（唯一正文账）。 */
    try { lbTrimAllSnaps(); } catch(e){}
  } catch(e){}
}, 2500); } catch(e){}
/* 2.204（B4）：开机静默回补最近 2 天坏时间（幂等，5 分钟节流） */
try { setTimeout(() => { try { lbTimeBackfill(2); } catch(e){} }, 4000); } catch(e){}
