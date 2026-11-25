'use strict';
/* 手机缓存查看器.js（网页端）  版本 2.252  日期 2026-11-25
   2.252（老板 2026-11-25 12:47 令·补漏）：新增 `_pureThinkText`——没带 th: 前缀的
     历史脏行（正文以 TraeWork/思考过程 打头）同样先判 think，不再被 2.249 的
     「带完成卡摘要就认终极」翻案冒充终极回复。2.251→2.252。
   2.251（老板 2026-11-25 12:47 令·思维流专属ID）：思维流行统一带 `th:` 专属
     前缀（kindOf 见到即判 think，先于 2.249 的「带终答认终极」）；详情与恒定卡
     不再显示思维流的号码（纯展示用）。同批服务端 WS桥 0.107 让思维流不进账本。
   2.250（老板 2026-11-25 12:32 令·小账本恒定卡）：小账本详情页在预备画面下方
     固定挂两张卡——「💭 思维流」「⏳ 官方排队条」，没有就明写「没有」；
     排队条只认当前会话（S.snap.pend，逐条 pendItemMine 归属校验），思维流取
     本条记录里 kind=think 的行，绝不跨会话串显。2.249→2.250。
   2.249（老板 2026-11-21 11:37）：①「N 条」只算人类＋AI 终极，思维流单列 thN；
     ② 带终答的 AI 行即使后端标 th 也认回 AI 终极；③ 详情不再折叠丢弃旧思维流；
     ④ AI 正文只在 index7 时兜底取出。
   2.234（老板 2026-11-20 23:42）：③ 调控页原 2.227 的「强核对」独立分组整段删除
     （四契机清单／最近一次／计数／「立即强核对」按钮全部清空，不留壳）；核对状态
     只保留两处轻提示——顶部横幅「核对中 · 会话名」＋顶栏「操控:」旁圆球变橙。
   2.228（2026-11-20·老板 21:37 亲令「小账本全量展示」）：① 会话预备画面不再只
     显示当前服务器——readSnapConvs 去掉 srv===lbSrvTag() 过滤，全部服务器的小账本
     都读出来；renderPreview 改为按 srv 分组渲染：本服务器组置顶，其它服务器组按
     各自最新记录时间倒序，组内同样「最后更新越新越靠前」（取最后一条 mid，无 mid
     退回落盘 ts）；未标 srv 的老记录单独落「未标服务器（旧缓存）」组垫底，绝不改挂
     到任一服务器名下（跨服串显仍是红线）。组内仍按身份去重、每条仍带 🗑。
   2.226（2026-11-20·WB+TR整改ST·人事部长ST 0023 转达老板令「账本缓存合并」）：
     查看器页签只留「① 账本」「② 调控」，原「② 缓存」页签删除；缓存全量渲染
     renderAllCache 整段保留复用，新增顶层 window.cvOpenCache() 供设置页
     「缓存管理」按钮直接打开同一缓存视图（不重写一套）。
   2.220（老板 2026-11-20 16:21「保留最近 5 轮没起作用」收尾）：③ 保留轮数
    改值后 lbRoundsApplied 除裁本地账本外，同步 lbTrimAllSnaps(true) 按新 N
    裁预备画面（snap_conv）；① 卡片「N 条」直接读裁后的 frame.msgs，条数与
    实际留存一致。思维流仍不计入轮次。
   老板要求：进去先看「会话预备画面」——按会话名列出本地缓存的、切换会话时会先显示的那份内容；
   全量缓存内容改由设置页「缓存管理」按钮进入（2.226 起不再是独立页签）。
   两个页面都**只读 IndexedDB / LocalStorage**，不联网、不发帧、不触发广播。

   2.219（老板 2026-11-20 16:21「保留最近 5 轮没起作用」）：③ 两处「保留轮数」
     改值后立即（a）按新 N 批量裁本地账本存量（lbTrimAllRounds）；（b）发一次
     vcheck 把 mods.lb_rounds 上报服务端，服务端据此调整下发轮数——
     参数从此真正三处同值、立即生效。

   2.215（老板 2026-11-20 09:11 终身号规则）：卡片第二行显示三档——标准终身号
     原样（如 0047）／提取失败显示会话名并标「（按名称）」／两者都没有显
     「终身号未登记」；卡片身份同一口径（标准号或同名只出一张卡），绝不完整 sid。

   2.208（老板 2026-11-19 23:50 亲令）：「小账本那边进去以后，查看每一条具体记录的时候，
     每一条具体记录，你得给它带这么一个字段啊。这个是从服务器发过来的：一个是该对话
     到底属于什么？是人类的发言？还是 AI 的终极回复？还是思维流？必须带这个字段，
     并且必须在这里看得见。」落地三处：① ① 账本详情每条记录顶部显中文短标签
     「人类发言／AI 终极回复／思维流」，三类之外显「类型未知」（绝不空白）；
     ② ② 缓存页 ledger_conv 列表行给类型小前缀（人类 n · 终极 n · 思维流 n），
     展开先列「第 N 轮·第 M 条：类型＋正文首 24 字」再给原始 JSON；
     ③ 类型来源以服务端下发为准（WS桥 0.48 给 msgs 每行 index8＝u/a/th），
     缺失才按「角色＋完成卡摘要」推导；顶层暴露 cvKindOf/cvKindText 供自测复用。
     顺带修 2.206 遗留的悬空变量（卡片「更新于」原引用未定义的 tsTxt，会让整个 ①
     列表渲染抛 ReferenceError）：更新时间改由最后一条 mid 推导，取不到只显条数。

   2.16（整改单·老板 2026-11-18 亲批）：本查看器即《账本系统 V1.0》规范§十
     写死的「小账本」本体——禁止另造页面。新增第三个标签页「③ 账本调控」：
     收纳账本系统全部七项调控（自动清理/离线倒计时/核对周期/保留轮数/
     思维流帧间隔/闲置下线/切后台下线）+「核对 Ns · 离线 Ns」每秒递减
     倒计时展示（撤销原 #lbhud 左下角悬浮条，倒计时逻辑仍在 账本核对.js）。
     本地账本查看走现有「② 全部缓存」页（IDB ledger_conv 全量可展开），
     现有展示样式一概不动。

   2.192（老板：「这个小卡片呢你的东西几乎都集中在左侧，导致卡片过高，我希望窄一点，
     左右分布均匀一点，显示的行数会更多」）：① 卡片由四行竖排改「两行两栏」——
     第一行 左会话名(13px 600 省略) / 右「服务器 · FOX号」(11px 灰，flex:none 不压缩)；
     第二行 左终身号(等宽 11px、flex:1 中途省略) / 右「N 条 · 更新于 MM-DD HH:MM」
     （当前会话追加 ● 徽标）＋🗑（挂第二行最右，24×22，不占行）；四样信息一样不少，只重排。
     ② 压扁：卡片 padding 5px 10px、行间距 2px、行高 16px，单卡实测 108px → **52px**。
     ③ 变窄可多列：栅格 minmax(240px→215px,1fr)、gap 10→8px；390 宽仍 1 列，
     820 宽实测 3 列（每列 261px）。
     ④ 坑：全局 `button{min-height:36px}`（样式.css:13）会把 🗑 撑到 36 高，必须显式
     `min-height:0` 才压得下去；`.cv_card` 原 min-height:56px 也一并清 0。

   2.190（老板 2026-11-19 亲批·纠正口径：「那个显示预备画面的那个地方就是我认为的小账本」）：
     ① 与 ③ 曾各有一份「📒 我的小账本」，老板一句「难怪我说你怎么给我做了两个小账本」否定，
     现将 ③ 页那份（renderLbCards 整块，含 readLedgerRows/delLedgerRow/lbTimeText/midEllipsis）
     连样式一并删除，③ 页只留七项调控，另把原属 ① 的「预备账册参数」挪到 ③ 顶部；
     「小账本」唯一落点＝① 会话预备画面。
     ① 卡片改四行、行序固定：服务器归属「宿舍 · 1309107889」→ 终身号（等宽/中途省略，
     无号显「⏳ 待补号」）→ 会话名 →「N 条 · 更新于 MM-DD HH:MM」（当前会话追加「● 当前会话」）；
     按 ts 倒序、按服务器分割；右上角 🗑 二次确认只删本机预备画面缓存（snap_conv），不动服务器与 TRAE。
     数据层：snap_conv 记录补 srv/srvName/srvFox/sid/title 五维（缓存.js _frameCommit），
     readSnapConvs() 只取 srv === lbSrvTag() 的本机服，老记录不显示但报条数；
     读取加 6 秒兜底——IDB 请求悬挂（被旧连接 block）时不再永远停在「读取中…」。
     抽屉「📒 小账本」入口一律落 ①（tab='preview'）。

   2.191（收尾·老板手机会突然看到小账本变空的那个坑）：未标 srv 的老缓存做
     一次性保守迁移——只有 sid（缺则 sk 的 '|' 后半段）能在当前会话列表
     （S.convs / S.snap.convs_full）里找到同一会话，才补 srv/srvName/srvFox；
     对不上的宁可不迁、继续隐藏（跨服串显是红线，绝不猜）。只补这三个字段，
     sk/frame/msgs 一字不动；localStorage.trae_webm_srv_migrated='2.191' 只跑一次；
     会话列表还没到（冷开）时不跑、也不写标记，等下次读再迁。

   2.10（老板 2026-11-05 20:17）：
     · 预备画面列表改「两行一张卡片」的网格——第 1 行会话名，第 2 行时间/条数/是否当前生效；
       点卡片进入该会话的详情，顶部返回列表（不再一条占四行、也不再全堆在左侧）。
     · 详情里的人类发言**复用主代码同一条渲染管线**（stripHeadDid + _mdBody + foxHintBind）：
       服务端追加的专属词前后缀（(@fox-sys1)… 等）自动折叠成「系统/自定/人定/岗位」小按钮，
       与主界面显示一字一致。 */
(function(){
  /* 2.190（老板：进来看到标题还写着 2.17，怀疑「我们讲的不是同一个地方」）：
     CV_VER 不再手写死——运行时直接取页面总版本 VER（诊断.js，全局可见），
     取不到才退回本地兜底常量。铁规矩：**每次动查看器都必须让 CV_VER 与页面
     VER 恒等**；build() 里再自检一次，不一致打 bad 日志。 */
  var CV_VER = (typeof VER === 'string' && VER) ? VER : '2.216';
  var built = false, tab = 'preview';
  var view = 'list';           /* 'list' ＝ 卡片列表；'detail' ＝ 单会话详情 */
  var detailItem = null;

  function injectStyle(){
    if (document.getElementById('cv_style')) return;
    var st = document.createElement('style');
    st.id = 'cv_style';
    st.textContent =
      '#cv_page{position:fixed;inset:0;z-index:99999;background:#f6f8fa;display:none;flex-direction:column;color:#222}' +
      '#cv_page.on{display:flex}' +
      '#cv_hd{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#fff;border-bottom:1px solid #e3e8ee}' +
      '#cv_hd .t{flex:1;font-size:16px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#cv_hd button{border:1px solid #d5dbe1;background:#fff;border-radius:8px;padding:7px 10px;font-size:13px;color:#222}' +
      '#cv_tabs{flex:none;display:flex;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #e3e8ee}' +
      '#cv_tabs button{flex:1;border:1px solid #d5dbe1;background:#fff;border-radius:8px;padding:9px;font-size:14px;color:#222}' +
      '#cv_tabs button.on{background:#2f6fed;color:#fff;border-color:#2f6fed}' +
      '#cv_bd{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 10px 40px}' +
      '.cv_sec{background:#fff;border-radius:12px;margin:0 0 12px;overflow:hidden;border:1px solid #e6ebf0}' +
      '.cv_sec>h3{margin:0;padding:12px 14px;font-size:15px;font-weight:600;background:#eef4fb;border-bottom:1px solid #e6ebf0}' +
      '.cv_sec>h3 .n{font-size:12px;color:#6b7b8c;font-weight:400}' +
      '.cv_row{padding:10px 14px;border-bottom:1px solid #f1f4f7}' +
      '.cv_row:last-child{border-bottom:0}' +
      '.cv_k{font-size:13px;color:#337ab7;word-break:break-all;font-family:Menlo,monospace}' +
      '.cv_meta{font-size:11px;color:#8a98a6;margin-top:3px;white-space:pre-wrap}' +
      '.cv_v{margin:6px 0 0;padding:8px;background:#fafbfc;border:1px solid #eef1f4;border-radius:6px;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;font-family:Menlo,monospace}' +
      '.cv_db{padding:10px 14px;border-bottom:1px solid #f1f4f7}.cv_db .nm{font-size:14px;font-weight:600;word-break:break-all}' +
      '.cv_store{margin:8px 0 0 8px;padding:8px 10px;background:#fafbfc;border-radius:8px;border:1px solid #eef1f4}' +
      '.cv_store .sn{font-size:13px;color:#444}.cv_rec{margin:6px 0 0}' +
      '.cv_rec summary{cursor:pointer;font-size:12px;color:#337ab7;word-break:break-all}' +
      '.cv_empty{padding:14px;font-size:13px;color:#8a98a6}.cv_bad{padding:10px 14px;font-size:12px;color:#c62828}' +
      /* 2.10：两行一张卡片的网格（左列/右侧都用上，不再一条占四行） */
      '.cv_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:8px}' +
      '.cv_card{background:#fff;border:1px solid #e6ebf0;border-radius:12px;padding:10px 12px;min-height:56px;' +
        'display:flex;flex-direction:column;justify-content:center;box-sizing:border-box}' +
      '.cv_card:active{background:#f2f6ff}' +
      '.cv_l1{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cv_l2{margin-top:5px;font-size:11px;color:#8a98a6;display:flex;align-items:center;gap:8px;' +
        'white-space:nowrap;overflow:hidden}' +
      '.cv_l2 .tg{flex:none;border-radius:6px;padding:1px 5px}' +
      '.cv_l2 .tg.ok{background:#e8f7ee;color:#1a7f37}' +
      '.cv_l2 .tg.old{background:#fdecea;color:#c62828}' +
      /* 2.10：详情页（单会话） */
      '.cv_dhd{display:flex;align-items:center;gap:8px;margin:0 0 10px}' +
      '.cv_dhd button{flex:none;border:1px solid #2f6fed;background:#fff;color:#2f6fed;border-radius:8px;padding:6px 10px;font-size:13px}' +
      '.cv_dhd .dt{flex:1;min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cv_msg{padding:8px 10px;margin:6px 0 0;border-radius:8px;font-size:13px;line-height:1.55;word-break:break-word}' +
      '.cv_msg.u{background:#eef4fb}.cv_msg.a{background:#fff;border:1px solid #eef1f4}' +
      '.cv_msg .who{font-size:11px;color:#8a98a6;margin-bottom:3px}' +
      /* 2.208（老板 2026-11-19 23:50 令）：每条具体记录必须写明类型（人类发言／AI 终极回复／思维流）。 */
      '.cv_msg .who .kd{display:inline-block;font-size:10px;line-height:15px;padding:0 5px;margin-right:5px;' +
        'border:1px solid transparent;border-radius:4px}' +
      '.cv_msg .who .kd.human{background:#e8f0fe;color:#1a56c4;border-color:#cfe0ff}' +
      '.cv_msg .who .kd.final{background:#e8f7ee;color:#1a7f37;border-color:#c8ead4}' +
      '.cv_msg .who .kd.think{background:#fff4e5;color:#9a5b00;border-color:#ffe0b2}' +
      '.cv_msg .who .kd.unknown{background:#f2f4f7;color:#8a98a6;border-color:#e3e8ee}' +
      '.cv_kinds{padding:8px 10px;background:#fafbfc;border-top:1px solid #eef1f4;font-size:12px;line-height:1.7;' +
        'color:#33404d;white-space:pre-wrap;word-break:break-all}' +
      '.cv_msg .body{font-size:13px;line-height:1.55}' +
      '.cv_msg .body p{margin:0 0 6px}.cv_msg .body p:last-child{margin-bottom:0}' +
      /* 2.16：③ 账本调控区（跟随查看器既有风格，不新造组件形态） */
      '.cv_lbrow{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #f1f4f7;font-size:13px}' +
      '.cv_lbrow:last-child{border-bottom:0}' +
      '.cv_lbrow label{flex:1;min-width:0}' +
      '.cv_lbrow input[type=number]{width:70px;padding:6px 8px;font-size:13px;border:1px solid #d5dbe1;border-radius:6px}' +
      '.cv_lbhint{padding:8px 14px;font-size:11px;color:#8a98a6;line-height:1.6}' +
      '#cv_lb_hud{padding:10px 14px;font-size:14px;font-weight:600;color:#337ab7;letter-spacing:1px}' +
      /* 2.192（老板：内容全挤左侧、卡片太高）：改「两行两栏」——第一行 左会话名 / 右服务器，
         第二行 左终身号 / 右 条数·时间＋当前会话徽标＋🗑；压到 ≤52px，卡片变窄宽屏可两列。 */
      '.cv_card{position:relative;padding:5px 10px;min-height:0}' +
      '.cv_r{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;line-height:16px}' +
      '.cv_r+.cv_r{margin-top:2px}' +
      '.cv_rt{flex:1;min-width:0;font-size:13px;font-weight:600;color:#1f2d3d;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis}' +
      '.cv_rs{flex:none;max-width:48%;font-size:11px;color:#6b7a89;white-space:nowrap;overflow:hidden;' +
        'text-overflow:ellipsis}' +
      '.cv_rid{flex:1;min-width:0;font-size:11px;color:#5b6b7a;font-family:Menlo,monospace;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.cv_rid.cv_lbpending{color:#b58900;font-family:inherit}' +
      '.cv_rmeta{flex:none;font-size:11px;color:#8a98a6;white-space:nowrap}' +
      '.cv_rmeta .cv_lbcur{margin-left:4px;font-size:11px;color:#8a98a6}' +
      '.cv_lbdel{flex:none;width:24px;height:22px;min-height:0;line-height:1;border:1px solid #f0c6c2;' +
        'background:#fff;color:#c62828;border-radius:6px;padding:0;font-size:11px}' +
      '.cv_lbdel[disabled]{opacity:.45}';
    document.head.appendChild(st);
  }
  function fmtSize(n){
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function jsonText(v){ try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch(e){ return String(v); } }
  function classify(k){
    var s = String(k || '').toLowerCase();
    if (/token|pwd|pass|login|account|nick|uid|user|auth|chan|channel|srv|port|did/.test(s)) return '登录与连接';
    if (/skel|hist|snap|frame|msg|conv|draft|led|pend|queue/.test(s)) return '会话与消息缓存';
    if (/trae_webm|cfg|config|ui_|theme|layout|tab|font|tts|voice|pref/.test(s)) return '界面与偏好';
    return '其他';
  }
  function readLS(){
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i), v = '';
        try { v = localStorage.getItem(k); } catch(e){ v = '<读取失败>'; }
        out.push({k: k, v: v, n: (v || '').length});
      }
    } catch(e){}
    out.sort(function(a,b){ return b.n - a.n; });
    return out;
  }
  function curKey(){
    try { return (typeof cacheKeyNow === 'function') ? cacheKeyNow() : ''; } catch(e){ return ''; }
  }

  /* ---------- IndexedDB：会话预备画面（snap_conv） ---------- */
  function openSnapDB(){
    return new Promise(function(res, rej){
      var rq = indexedDB.open('trae_webm_idb');
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('open failed')); };
    });
  }
  /* 2.191（保守迁移·老板红线：跨服串显绝不猜）：只给「能证明属于当前登录服务器」
     的老记录补 srv/srvName/srvFox 三字段。证明方式＝该记录 sid（缺失则取 sk 的
     '|' 后半段）能在当前会话列表（S.convs 行 / S.snap.convs_full）里找到同一会话；
     找不到一律不迁移、继续按「未标服务器」隐藏。sk / frame / msgs 一字不动（改了会白屏）。 */
  function _migSidOf(x){
    var sid = String((x && x.sid) || '');
    if (!sid){
      var sk = String((x && x.sk) || ''), i = sk.indexOf('|');
      if (i >= 0) sid = sk.slice(i + 1);
      if (sid === '@snap' || !/^[0-9A-Za-z_-]{4,}$/.test(sid)) sid = '';
    }
    return sid;
  }
  function _convsReady(){
    try {
      if (S && Array.isArray(S.convs) && S.convs.length) return true;
      if (S && S.snap && Array.isArray(S.snap.convs_full) && S.snap.convs_full.length) return true;
    } catch(e){}
    return false;
  }
  function _migInConvs(sid){
    if (!sid) return false;
    var rows = [], cf = [];
    try { rows = (S && Array.isArray(S.convs)) ? S.convs : []; } catch(e){ rows = []; }
    try { cf = (S && S.snap && Array.isArray(S.snap.convs_full)) ? S.snap.convs_full : []; } catch(e){ cf = []; }
    var hit = function(full){
      full = String(full || '');
      if (!full) return false;
      if (full === sid) return true;
      try {
        if (typeof 稳定键 === 'function' && 稳定键(full, '') === 稳定键(sid, '')) return true;
      } catch(e){}
      return false;
    };
    for (var i = 0; i < rows.length; i++){
      if (rows[i] && hit(rows[i][4])) return true;
    }
    for (var j = 0; j < cf.length; j++){
      if (cf[j] && hit(cf[j].sid)) return true;
    }
    return false;
  }
  function migrateSrv(list){
    var todo = [], i;
    for (i = 0; i < list.length; i++){
      var x = list[i];
      if (String(x.srv || '').trim()) continue;          /* 已有归属，不动 */
      if (!_migInConvs(_migSidOf(x))) continue;          /* 证明不了，宁可不迁 */
      todo.push(x);
    }
    if (!todo.length) return Promise.resolve(0);
    var tag = '', nm = '', fx = '';
    try { tag = String(lbSrvTag() || ''); } catch(e){ tag = ''; }
    try { nm = String(lbSrvName() || ''); } catch(e){ nm = ''; }
    try { fx = String(lbSrvFox() || ''); } catch(e){ fx = ''; }
    if (!tag) return Promise.resolve(0);
    return openSnapDB().then(function(db){
      return new Promise(function(res){
        var done = false;
        var timer = setTimeout(function(){
          if (done) return; done = true;
          try { db.close(); } catch(e){}
          res(0);
        }, 6000);
        var tx = db.transaction('snap_conv', 'readwrite'), st = tx.objectStore('snap_conv');
        todo.forEach(function(x){
          var v = x._raw || {};
          if (!v || !v.sk) return;
          var sid = _migSidOf(x);
          v.srv = tag; v.srvName = nm; v.srvFox = fx;
          /* 2.191：sk 的后半段本身就是 sid（_frameMemKey＝'frame|'+sid），既然已用它
             证明归属，就顺手把空 sid 补上——只补这一个普通字段，sk/frame/msgs 不碰。 */
          if (!v.sid && sid) v.sid = sid;
          try { st.put(v); } catch(e){}
        });
        tx.oncomplete = function(){
          if (done) return; done = true; clearTimeout(timer);
          try { db.close(); } catch(e){}
          todo.forEach(function(x){
            x.srv = tag; x.srvName = nm; x.srvFox = fx;
            if (!x.sid){ var s2 = _migSidOf(x); if (s2) x.sid = s2; }
          });
          res(todo.length);
        };
        tx.onerror = function(){
          if (done) return; done = true; clearTimeout(timer);
          try { db.close(); } catch(e){}
          res(0);
        };
      });
    }).catch(function(){ return 0; });
  }
  function readSnapConvs(){
    return openSnapDB().then(function(db){
      return new Promise(function(res){
        if (!db.objectStoreNames.contains('snap_conv')){ db.close(); return res({all:[], timeout:false}); }
        /* 2.190：加 6 秒兜底——IDB open 被别的旧连接挡住（onblocked）时请求永不
           落地，读取会永远停在「读取中…」（老板看到的那张卡卡死的真因）。超时按空表返回。 */
        var done = false, timer = setTimeout(function(){
          if (done) return; done = true;
          try { db.close(); } catch(e){}
          res({all: [], timeout: true});
        }, 6000);
        var fin = function(v){ if (done) return; done = true; clearTimeout(timer); res(v); };
        var tx = db.transaction('snap_conv', 'readonly'), out = [];
        var rq = tx.objectStore('snap_conv').openCursor();
        rq.onsuccess = function(){
          var c = rq.result;
          if (c){
            var v = c.value || {};
            var _msAll = (v.frame && v.frame.msgs) || [];
            /* 2.249（老板 2026-11-21 11:37）：「N 条」只算人类发言＋AI 终极回复，
               思维流单独计数（thN），不再混进总条数导致「10 条里混了思维流」。 */
            var _nVis = 0, _nTh = 0;
            _msAll.forEach(function(mm){
              if (kindOf(mm) === 'think') _nTh++; else _nVis++;
            });
            out.push({sk: v.sk || c.key, key: v.key || '', title: v.title || '', sid: v.sid || '',
                      uid: v.uid || '',
                      srv: v.srv || '', srvName: v.srvName || '', srvFox: v.srvFox || '',
                      port: v.port, ts: v.ts || 0,
                      n: _nVis, thN: _nTh,
                      msgs: _msAll,
                      _raw: v});
            c.continue();
          }
        };
        tx.oncomplete = function(){ db.close(); fin({all: out, timeout: false}); };
        tx.onerror = function(){ db.close(); fin({all: out, timeout: false}); };
      });
    }).then(function(r){
      var all = (r && r.all) || [], timedOut = !!(r && r.timeout);
      var cur = '';
      try { cur = (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : ''; } catch(e){ cur = ''; }
      /* 2.191：未标服务器的老记录做一次性保守迁移。会话列表还没到（冷开）时
         不能跑——跑了必然全对不上，还会把一次性标记锁死，老记录就永远回不来。 */
      var mp = Promise.resolve(0), flag = '';
      try { flag = localStorage.getItem('trae_webm_srv_migrated') || ''; } catch(e){ flag = ''; }
      if (!timedOut && flag !== '2.191' && all.length && _convsReady()){
        mp = migrateSrv(all).then(function(n){
          try { localStorage.setItem('trae_webm_srv_migrated', '2.191'); } catch(e){}
          return n;
        });
      }
      return mp.then(function(migrated){
        /* 2.228（老板 2026-11-20 21:37 亲令）：小账本改全量展示——所有服务器的记录
           都读出来列，本服务器由 renderPreview 顶置分组，故这里不再按 srv 过滤。
           没有 srv 的老记录照实落「未标服务器」组，绝不改挂到别的服务器名下
           （跨服串显仍是红线：只标记、不猜测）。 */
        var hidden = 0, list = all;
        /* 2.209：会话列表「最近时间」一律取该会话最后一条消息的 ID 时间
           （mid 前 8 位 hex），不再用落盘时间 ts 排序；2.228 起无 mid 的记录
           退回落盘 ts（秒）参与排序，保证「最后更新越新越靠前」不落空。 */
        function _lastMidSec(x){
          var ms = (x && x.msgs) || [], v = 0;
          for (var i = ms.length - 1; i >= 0; i--){
            var m = ms[i];
            var s = (Array.isArray(m) && typeof midSec === 'function') ? midSec(m[6]) : NaN;
            if (isFinite(s)){ v = s; break; }
          }
          if (!v && x && x.ts) v = Math.floor(Number(x.ts) / 1000) || 0;
          return v;
        }
        list.sort(function(a,b){ return _lastMidSec(b) - _lastMidSec(a); });
        return {list: list, hidden: hidden, cur: cur, timeout: timedOut, migrated: (migrated || 0)};
      });
    }).catch(function(){ return {list: [], hidden: 0, timeout: false, migrated: 0}; });
  }
  function rowText(m){
    /* 2.209：不读记录里的 tm（账本已不存时间）；显示只用 mid 现算。 */
    if (Array.isArray(m)){
      var _tx = m[1] || '';
      /* 2.249：AI 行正文若只在 index7（终答），此处兜底取出，避免「有记录却空白看不见」。 */
      if (!_tx && m[0] === 'a'){
        var _fn = String(m[7] || '').trim();
        if (_fn && _fn !== '补记' && _fn !== '提前终极') _tx = _fn;
      }
      return {role: m[0], text: _tx, mid: m[6] || ''};
    }
    return {role: (m && (m.role || m.r)) || '', text: (m && (m.text || m.t)) || '', mid: ''};
  }
  /* ===== 2.208（老板 2026-11-19 23:50 令）=====
     「每一条具体记录，你得给它带这么一个字段啊。这个是从服务器发过来的：一个是该对话
      到底属于什么？是人类的发言？还是 AI 的终极回复？还是思维流？必须带这个字段，
      并且必须在这里看得见。」
     口径：服务端下发 index8／kind＝u/a/th（见 WS桥 0.48），前端落账为 human/final/think；
     读取优先级＝行内 index8 → 行对象 kind/type → 按角色＋完成卡摘要推导（u=人类、
     a 且有终答=终极、a 无终答=思维流）；三类之外一律「类型未知」，绝不空白。 */
  var KIND_TEXT = {human: '人类发言', final: 'AI 终极回复', think: '思维流'};
  function _kindNorm(s){
    s = String(s == null ? '' : s).trim().toLowerCase();
    if (s === 'u' || s === 'human' || s === 'user' || s === '人') return 'human';
    if (s === 'a' || s === 'final' || s === 'ai') return 'final';
    if (s === 'th' || s === 'think' || s === 'snap') return 'think';
    return '';
  }
  /* 2.252（老板 12:47 令）：纯思维块识别——正文以 TraeWork/思考过程 打头的 AI 行
     永远算思维流；即使历史账本行带着完成卡摘要，也不许按 2.249 翻案成终极回复。 */
  function _pureThinkText(txt){
    var ls = String(txt == null ? '' : txt).split(/\r?\n/).map(function(s){
      return s.trim();
    }).filter(function(s){ return s; });
    if (!ls.length) return false;
    var i = (ls[0] === 'TraeWork' || ls[0] === 'Trae Work') ? 1 : 0;
    if (i >= ls.length) return false;
    return /^(?:思考过程|思考中|正在思考|已深度思考)(?:$|[\s:：])/.test(ls[i]);
  }
  function kindOf(m){
    /* 2.213（前端零拦截）：类型只认后端下发——行 index8（u/a/th）或对象 kind/type；
       缺字段一律 ''，显示「类型未知」；前端不再按角色/完成卡自己推断。 */
    if (!m || typeof m !== 'object') return '';
    /* 2.287（老板 2026-11-25 12:47 令）：思维流专属 ID（th: 前缀）＝思维流，铁定
       不是终极回复——先于下面 2.249「带终答就认终极」的规则，防止历史脏数据翻案。 */
    if (Array.isArray(m) && /^th:/i.test(String(m[6] || ''))) return 'think';
    /* 2.252：纯思维块（没带 th: 前缀的历史行）同样先判思维流，不翻案。 */
    if (Array.isArray(m) && m[0] === 'a' && _pureThinkText(m[1])) return 'think';
    var k = Array.isArray(m) ? _kindNorm(m[8])
                             : _kindNorm(m.kind != null ? m.kind : m.type);
    /* 2.249（老板 2026-11-21 11:37）：TRAE 思维流与终极回复同号，后端有时把
       「带终答的 AI 行」也标成 th —— 只要该行有真终答（index7 非空且非来源标记），
       一律按 AI 终极回复认，不让它被当成思维流折叠吞掉。 */
    if (k === 'think' && Array.isArray(m) && m[0] === 'a'){
      var fin = String(m[7] || '').trim();
      if (fin && fin !== '补记' && fin !== '提前终极') return 'final';
    }
    return k;
  }
  function kindText(m){
    var k = kindOf(m);
    /* 2.213：提前终极只认后端字段——数组行 index11=1（服务端 list 行）或
       对象 early_final=1；不再读前端自造的 m[7]='提前终极'。 */
    var _early = Array.isArray(m)
      ? (m[11] == 1 || m[11] === '1')
      : !!(m && (m.early_final == 1 || m.early_final === '1'));
    if (_early) return 'AI 终极回复（提前）';
    return KIND_TEXT[k] || '类型未知';
  }
  /* 类型徽标（详情每条必显；色标仅供一眼分辨，文字为准）
     2.216（0047）：术语保留，补一句人话解释（长按/悬浮可见）。 */
  function kindTag(m){
    var k = kindOf(m) || 'unknown';
    return '<span class="kd ' + k + '"'
      + (k === 'unknown' ? ' title="旧记录未带类型，不影响阅读"' : '')
      + '>' + esc(kindText(m)) + '</span>';
  }
  /* ② 缓存页 ledger_conv：把整本账逐条类型列出来（原始 JSON 里 index8 不直观） */
  function kindsDigestHtml(rec){
    var rows = (rec && rec.rounds) || [], out = [];
    rows.forEach(function(r, i){
      (Array.isArray(r) ? r : []).forEach(function(m, j){
        var t = (Array.isArray(m) ? String(m[1] || '') : '').replace(/\s+/g, ' ').slice(0, 24);
        out.push('第 ' + (i + 1) + ' 轮 · 第 ' + (j + 1) + ' 条：' + kindText(m) + (t ? ('　' + t) : ''));
      });
    });
    /* 2.214：思维流只留最新一条，单独显示在账本最底部（不占轮次） */
    if (rec && Array.isArray(rec.think)){
      var _t = String(rec.think[1] || '').replace(/\s+/g, ' ').slice(0, 24);
      out.push('账本底部：' + kindText(rec.think) + (_t ? ('　' + _t) : ''));
    }
    if (!out.length) return '';
    return '<div class="cv_kinds">' + out.map(function(s){ return '<div>' + esc(s) + '</div>'; }).join('') + '</div>';
  }
  /* ② 缓存页列表行小前缀：整本账的类型分布（人类 n · 终极 n · 思维流 n） */
  function kindStatText(rec){
    var n = {human: 0, final: 0, think: 0, unknown: 0};
    ((rec && rec.rounds) || []).forEach(function(r){
      (Array.isArray(r) ? r : []).forEach(function(m){ n[kindOf(m) || 'unknown']++; });
    });
    var parts = [];
    if (n.human) parts.push('人类 ' + n.human);
    if (n.final) parts.push('终极 ' + n.final);
    if (n.think) parts.push('思维流 ' + n.think);
    if (n.unknown) parts.push('类型未知 ' + n.unknown + '（旧记录未带类型）');
    return parts.join(' · ');
  }
  /* 2.10：单条消息走主代码同一条渲染管线（专属词前后缀折叠成按钮，不再整段铺开）。 */
  function bodyHtml(text, isUser){
    var src = String(text == null ? '' : text);
    if (isUser && typeof stripHeadDid === 'function'){ try { src = stripHeadDid(src); } catch(e){} }
    if (typeof _mdBody === 'function'){
      try { return '<div class="body">' + _mdBody(src) + '</div>'; } catch(e){}
    }
    return '<div class="body">' + esc(src) + '</div>';
  }
  function bindFx(host){
    if (typeof foxHintBind === 'function'){ try { foxHintBind(host); } catch(e){} }
  }

  /* 2.215：一张卡的身份（标准终身号 → 号；提取失败 → 会话名/名称兜底；
     无名才认 sid）。同名只出一张卡，绝不再打「· 重复」标。 */
  function _snapIdent(it){
    var u = String((it && it.uid) || '').trim();
    var _std = '';
    try { _std = (typeof lbUidAuth === 'function') ? lbUidAuth(u) : ''; } catch(e){ _std = ''; }
    if (_std) return 'u:' + _std;
    var n = '';
    try { n = (typeof lbUidName === 'function') ? lbUidName(u) : ''; } catch(e){ n = ''; }
    var t = String((it && it.title) || '').trim();
    if (!t){
      try { t = (typeof lbNormTitle === 'function') ? lbNormTitle(n) : n; } catch(e){ t = n; }
    }
    if (t){
      try { if (typeof lbNormTitle === 'function') t = lbNormTitle(t); } catch(e){}
      return 't:' + t;
    }
    var s = String((it && it.sid) || '').trim();
    return s ? ('s:' + s) : '';
  }
  /* 2.214：显示名不带「重复/（2）/副本」后缀（旧脏名归一显示）。 */
  function _dispTitle(it){
    var t = String((it && it.title) || '').trim() || '（无名会话）';
    try { if (typeof lbNormTitle === 'function') t = lbNormTitle(t) || t; } catch(e){}
    return t;
  }
  /* ---------- ① 会话预备画面：全服务器小账本，本机顶置 ---------- */
  function renderPreview(host){
    host.innerHTML = '';
    if (view === 'detail' && detailItem){ renderDetail(host, detailItem); return; }
    /* 2.190：① 只留卡片网格（唯一小账本）；「预备账册参数」已挪到 ③ 配套调控区。 */
    var s = document.createElement('div');
    s.className = 'cv_sec';
    s.innerHTML = '<h3>会话预备画面 <span class="n">读取中…</span></h3>';
    host.appendChild(s);
    readSnapConvs().then(function(r){
      var list = (r && r.list) || [], _hid = (r && r.hidden) || 0;
      var cur = String((r && r.cur) || '');
      /* 2.228（老板 2026-11-20 21:37 亲令）：小账本全量展示——所有服务器的记录都列，
         本服务器置顶，组内按「最后更新时间」倒序（越新越前，无 mid 退回落盘 ts）；
         未标 srv 的老记录单独落「未标服务器」组，绝不改挂到任一服务器名下。 */
      function _lm(x){
        var ms = (x && x.msgs) || [];
        for (var i = ms.length - 1; i >= 0; i--){
          var m = ms[i];
          var v = (Array.isArray(m) && typeof midSec === 'function') ? midSec(m[6]) : NaN;
          if (isFinite(v)) return v;
        }
        return (x && x.ts) ? (Math.floor(Number(x.ts) / 1000) || 0) : 0;
      }
      var gmap = {}, gorder = [];
      list.forEach(function(it){
        var k = String(it.srv || '').trim();
        /* 2.264（老板 2026-11-24「刷新后又看不到」）：服务器归属改「双认」——
           2.263 及更早写下的记录，srv 可能是「默认」/机器名/空（那时本服标识会漂），
           只要 srvFox 命中本服 FOX 号、或 srvName 命中本服名，就当本服务器的账本，
           绝不把自家账本算成「其它服务器」。别的服务器（号与名都不同）照旧单列。 */
        try {
          if (cur && k !== cur){
            var _fx = String(it.srvFox || '').trim();
            var _sn = String(it.srvName || '').trim();
            var _my = String((typeof lbSrvName === 'function') ? (lbSrvName() || '') : '').trim();
            if (_fx === cur || (_sn && _my && _sn === _my)) k = cur;
          }
        } catch(e){}
        if (!gmap[k]){ gmap[k] = []; gorder.push(k); }
        gmap[k].push(it);
      });
      /* 2.214：组内同一身份只出一张卡（有权威终身号认终身号，否则认同名），
         再按时间倒序；组与组之间不合并，绝不把 A 服务器的卡吞进 B 服务器。 */
      gorder.forEach(function(k){
        var arr = gmap[k], _byKey = {}, _order = [];
        arr.forEach(function(it){
          var key = _snapIdent(it);
          if (!key){ _byKey['sk:' + it.sk] = it; _order.push('sk:' + it.sk); return; }
          var prev = _byKey[key];
          if (!prev){ _byKey[key] = it; _order.push(key); return; }
          if ((it.n || 0) > (prev.n || 0)) _byKey[key] = it;
        });
        arr = _order.map(function(x){ return _byKey[x]; });
        arr.sort(function(a, b){ return _lm(b) - _lm(a); });
        gmap[k] = arr;
      });
      /* 组排序：本服务器第一；其它服务器按组内最新一条记录的时间倒序；
         未标服务器（'' 组）永远垫底。 */
      var ownK = (cur && gmap[cur]) ? cur : null;
      var otherKs = gorder.filter(function(k){ return k && k !== ownK; });
      otherKs.sort(function(a, b){
        return (_lm((gmap[b] || [])[0]) || 0) - (_lm((gmap[a] || [])[0]) || 0);
      });
      var unknownK = Object.prototype.hasOwnProperty.call(gmap, '') ? '' : null;
      var _mineN = ownK ? gmap[ownK].length : 0, _otherN = 0;
      otherKs.forEach(function(k){ _otherN += (gmap[k] || []).length; });
      s.querySelector('.n').textContent = list.length + ' 个会话有本地预备画面'
        + '（本服务器 ' + _mineN + ' · 其它服务器 ' + _otherN
        + (unknownK !== null ? (' · 未标服务器 ' + gmap[unknownK].length) : '') + '）'
        + (_hid ? (' · ' + _hid + ' 条读取异常已跳过') : '');
      if (!list.length){
        s.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty',
          textContent: (r && r.timeout) ? '读取超时（缓存库被占用），稍后点「刷新」再看'
                                        : '（本地还没有任何会话存帧）'}));
        return;
      }
      function srvLabelOf(key){
        var arr = gmap[key] || [], sn = '', fx = '';
        for (var i = 0; i < arr.length; i++){
          sn = String(arr[i].srvName || '').trim() || sn;
          fx = String(arr[i].srvFox || '').trim() || fx;
          if (sn && fx) break;
        }
        if (!sn && /^\d+$/.test(String(key))) fx = fx || String(key);
        return (sn || (key ? '服务器 ' + key : '服务器未知')) + (fx ? (' · ' + fx) : '');
      }
      function paintSec(title, arr){
        var sec = document.createElement('div');
        sec.className = 'cv_sec';
        sec.style.marginTop = '12px';
        sec.innerHTML = '<h3>' + esc(title) + ' <span class="n">' + arr.length + ' 个会话</span></h3>';
        var grid = document.createElement('div');
        grid.className = 'cv_grid';
        grid.style.marginTop = '10px';
        arr.forEach(function(it){ grid.appendChild(cardOf(it)); });
        sec.appendChild(grid);
        host.appendChild(sec);
      }
      function cardOf(it){
        var sid = String(it.sid || '');
        /* 2.190（老板：小账本＝①，卡片行序按 V1.0 §十-353 定死）：
           ① 服务器归属「宿舍 · 1309107889」 ② 终身号 ③ 会话名 ④ N 条/更新于。 */
        var _sn = String(it.srvName || '').trim();
        var _fx = String(it.srvFox || '').trim();
        if (!_fx && /^\d+$/.test(String(it.srv || ''))) _fx = String(it.srv);
        /* 2.264：FOX 号命中本服而记录没存下名字时，用本服当前名补上——
           免得本服卡片显示成「未知服务器 · 1309107889」。 */
        if (!_sn && _fx){
          try { if (typeof lbSrvFox === 'function' && _fx === String(lbSrvFox() || ''))
                  _sn = String((typeof lbSrvName === 'function' ? lbSrvName() : '') || '').trim(); } catch(e){}
        }
        /* 2.228：跨服务器展示时不再拿本机服务器名兜底——没有归属就照实写「服务器未知」。 */
        var srvTxt = (_sn || _fx) ? ((_sn || '未知服务器') + (_fx ? (' · ' + _fx) : '')) : '服务器未知';
        /* 2.215（老板 2026-11-20 09:11）：第二行显示口径——
           ① 标准终身号（24hex sid 前 4 位数字）→ 原样（如 0047）；
           ② 提取失败 → 会话名称原样并标「（按名称）」；
           ③ 两者都没有 → 「终身号未登记」（只显示，不拦截）。
           绝不把完整 sid / 实例号当终身号展示。 */
        var _uid2 = String(it.uid || '').trim();
        var _std2 = '', _nm2 = '';
        try {
          _std2 = (typeof lbUidAuth === 'function') ? (lbUidAuth(_uid2) || '')
            : ((/^\d{4}$/.test(_uid2) && _uid2 !== '1632') ? _uid2 : '');
          _nm2 = _std2 ? '' : ((typeof lbUidName === 'function') ? (lbUidName(_uid2) || '') : '');
          if (!_std2 && !_nm2){
            var _tt2 = String(it.title || '').trim();
            if (_tt2) _nm2 = (typeof lbNormTitle === 'function')
              ? (lbNormTitle(_tt2) || '') : _tt2;
            if (/^\d{4}$/.test(_nm2) || /^\d{10}$/.test(_nm2)) _nm2 = '';  /* 数字名不当号 */
          }
        } catch(e){ _std2 = ''; _nm2 = ''; }
        var _uidOk = !!(_std2 || _nm2);          /* 名称兜底也是合法终身号，不再标待补 */
        var sidTxt = _std2 ? _std2 : (_nm2 ? (_nm2 + '（按名称）') : '终身号未登记');
        /* 2.206：缓存记录的接口/落盘时间（it.ts）不再作为任何显示时间。 */
        var _cur = '';
        try { _cur = (typeof curSid === 'function') ? String(curSid() || '') : ''; } catch(e){ _cur = ''; }
        var isCur = !!sid && (_cur ? (sid === _cur)
          : (!!S.anchorSid && typeof 稳定键 === 'function'
             && 稳定键(sid, it.title || '') === String(S.anchorSid)));
        /* 2.206/2.208：更新时间只取「最后一条有 mid 的记录」由 mid 推导；
           两个来源都取不到时只显示条数（绝不显示缓存落盘时间，也不留空变量）。 */
        var _tsTxt = it.n + ' 条';
        try {
          var _ms = it.msgs || [], _lm0 = '';
          for (var _mi = _ms.length - 1; _mi >= 0; _mi--){
            var _mr = _ms[_mi];
            if (Array.isArray(_mr) && _mr[6]){ _lm0 = String(_mr[6]); break; }
          }
          var _upd = _lm0 ? String((typeof timeFromMid === 'function' ? timeFromMid(_lm0) : '') || '') : '';
          if (_upd) _tsTxt += ' · 更新于 ' + _upd;
        } catch(e){}
        var card = document.createElement('div');
        card.className = 'cv_card';
        /* 2.192（老板：内容全挤左侧、卡片太高）：两行两栏——
           第一行 左会话名 / 右服务器；第二行 左终身号 / 右 条数·更新于（＋当前会话徽标）。
           🗑 由下方 appendChild 塞进第二行最右，不再占独立一行。 */
        card.innerHTML =
          '<div class="cv_r"><div class="cv_rt">' + esc(_dispTitle(it)) + '</div>'
            + '<div class="cv_rs">' + esc(srvTxt) + '</div></div>' +
          '<div class="cv_r"><div class="cv_rid' + (_uidOk ? '' : ' cv_lbpending') + '"'
            + (_uidOk ? '' : ' title="系统暂未登记该会话编号，不影响聊天"') + '>'
            + esc(sidTxt) + '</div>'
            + '<div class="cv_rmeta">' + esc(_tsTxt)
            + (isCur ? '<span class="cv_lbcur">● 当前会话</span>' : '') + '</div></div>';
        var del = document.createElement('button');
        del.className = 'cv_lbdel';
        del.textContent = '🗑';
        del.title = '删除这条本地预备画面缓存';
        del.onclick = function(ev){
          try { ev.stopPropagation(); } catch(e){}
          if (!window.confirm('删除这条本地预备画面？\n会话：' + (it.title || sid || it.sk)
              + '\n（只删本机预备画面缓存，不影响服务器与 TRAE 会话）')) return;
          del.disabled = true;
          var sk = it.sk;
          openSnapDB().then(function(db){
            return new Promise(function(res, rej){
              var tx = db.transaction('snap_conv', 'readwrite');
              tx.objectStore('snap_conv').delete(sk);
              tx.oncomplete = function(){ db.close(); res(true); };
              tx.onerror = function(){ db.close(); rej(tx.error); };
            });
          }).then(function(){
            try { if (_frameMem && typeof _frameMem === 'object' && sk) delete _frameMem[sk]; } catch(e){}
            renderPreview(host);
          }).catch(function(e){
            del.disabled = false;
            alert('删除失败：' + ((e && e.message) || e));
          });
        };
        /* 2.192：🗑 挂在第二行最右（与「条数·更新于」同排），不撑高卡片 */
        var _r2 = card.querySelectorAll('.cv_r');
        (_r2[1] || card).appendChild(del);
        card.onclick = function(){
          detailItem = it; view = 'detail';
          renderPreview(host);
          host.scrollTop = 0;
        };
        return card;
      }
      if (ownK){ paintSec('📒 本服务器小账本 · ' + srvLabelOf(ownK), gmap[ownK]); }
      otherKs.forEach(function(k){
        paintSec('🗄 其它服务器 · ' + srvLabelOf(k), gmap[k]);
      });
      if (unknownK !== null){ paintSec('❓ 未标服务器（旧缓存）', gmap[unknownK]); }
    });
  }
  /* 2.10：单会话详情（人类发言按主代码格式折叠） */
  function renderDetail(host, it){
    var bar = document.createElement('div');
    bar.className = 'cv_dhd';
    bar.innerHTML = '<button>‹ 返回列表</button><div class="dt">' + esc(_dispTitle(it) || it.sid || it.sk) + '</div>';
    bar.querySelector('button').onclick = function(){ view = 'list'; detailItem = null; renderPreview(host); host.scrollTop = 0; };
    host.appendChild(bar);
    var s = document.createElement('div');
    s.className = 'cv_sec';
    /* 2.206：详情头不再显示缓存落盘时间（时间只看每条 mid）。 */
    /* 2.249：N 条＝人类＋AI 终极；思维流单列另注，口径透明。 */
    s.innerHTML = '<h3>预备画面 · ' + esc(it.n + ' 条')
      + (it.thN ? esc('（另有 ' + it.thN + ' 条思维流）') : '') + '</h3>';
    var box = document.createElement('div');
    box.style.padding = '4px 10px 12px';
    if (!it.msgs.length){
      box.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'（这份预备画面是空的）'}));
    } else {
      /* 2.249（老板 2026-11-21 11:37）：账本有什么就显示什么——不再把旧思维流
         折叠丢弃（曾导致「条数算进去、详情看不见」）；思维流也逐条显示并带类型。 */
      it.msgs.forEach(function(m){
        var x = rowText(m);
        /* 2.208：类型以服务端下发为准（index8/kind）；缺则按角色＋终答推导；不得空白。 */
        var _k = kindOf(m);
        var user = x.role === 'u' || _k === 'human';
        /* 2.206（老板最终合并口径）：时间只由该条 mid 前 8 位十六进制推导，
           不读记录里的 tm（旧值），也不再「沿用上一条」。ID 显示完整 mid。 */
        var tm = String(x.mid || '') ? String((typeof timeFromMid === 'function' ? timeFromMid(x.mid) : '') || '') : '';
        var mid = String(x.mid || '');
        var d = document.createElement('div');
        d.className = 'cv_msg ' + (user ? 'u' : 'a');
        d.innerHTML = '<div class="who">' + kindTag(m) + esc((user ? '你' : 'AI') +
          (tm ? ' · ' + tm : '') + (mid && _k !== 'think' ? ' · ' + mid : '')) + '</div>' +
          bodyHtml(x.text, user);
        box.appendChild(d);
      });
      bindFx(box);
    }
    s.appendChild(box);
    host.appendChild(s);
    /* 2.250（老板 2026-11-25 12:32 令·小账本恒定卡）：预备画面下方固定两张卡——
       思维流 / 官方排队条；没有就明写「没有」，不让老板猜。 */
    var _pendRows = [], _thRows = [];
    try {
      var _curR = String((typeof curSid === 'function') ? (curSid() || '') : '');
      var _sidR = String(it.sid || '');
      var _sameR = !!_sidR && (_curR ? (_sidR === _curR)
        : (!!S.anchorSid && typeof 稳定键 === 'function'
           && 稳定键(_sidR, it.title || '') === String(S.anchorSid)));
      if (_sameR && S.snap && Array.isArray(S.snap.pend)){
        S.snap.pend.forEach(function(p){
          if (typeof pendItemMine === 'function' && pendItemMine(p) === false) return;
          var _tx = (p && p.text != null) ? String(p.text) : String((p && p.t) || '');
          if (_tx) _pendRows.push(_tx);
        });
      }
    } catch(e){}
    it.msgs.forEach(function(m){
      if (kindOf(m) !== 'think') return;
      var _x = rowText(m);
      if (_x.text) _thRows.push(_x);
    });
    function _恒卡(title, rows, renderOne){
      var _sec = document.createElement('div');
      _sec.className = 'cv_sec';
      _sec.innerHTML = '<h3>' + title + ' <span class="n">' + rows.length + ' 条</span></h3>';
      var _bx = document.createElement('div');
      _bx.style.padding = '4px 10px 12px';
      if (!rows.length){
        _bx.appendChild(Object.assign(document.createElement('div'),
          {className:'cv_empty', textContent:'没有'}));
      } else {
        rows.forEach(function(x){ _bx.appendChild(renderOne(x)); });
        bindFx(_bx);
      }
      _sec.appendChild(_bx);
      host.appendChild(_sec);
    }
    _恒卡('💭 思维流', _thRows, function(x){
      var _d = document.createElement('div');
      _d.className = 'cv_msg a';
      var _tm = String(x.mid || '') ? String((typeof timeFromMid === 'function' ? timeFromMid(x.mid) : '') || '') : '';
      _d.innerHTML = '<div class="who">思维流' + (_tm ? ' · ' + _tm : '') + '</div>'
        + bodyHtml(x.text, false);
      return _d;
    });
    _恒卡('⏳ 官方排队条', _pendRows, function(t){
      var _d = document.createElement('div');
      _d.className = 'cv_msg u';
      _d.innerHTML = '<div class="who">排队中</div>' + bodyHtml(String(t), false);
      return _d;
    });
  }

  /* ---------- ② 全部缓存 ---------- */
  function sec(title, count){
    var d = document.createElement('div'); d.className = 'cv_sec';
    d.innerHTML = '<h3>' + esc(title) + ' <span class="n">' + esc(count || '') + '</span></h3>';
    return d;
  }
  function rowKV(k, v, meta){
    var d = document.createElement('details'); d.className = 'cv_row';
    var sum = document.createElement('summary'); sum.className = 'cv_k';
    sum.textContent = k + '  ' + (meta || '');
    d.appendChild(sum);
    var loaded = false;
    d.addEventListener('toggle', function(){
      if (!d.open || loaded) return; loaded = true;
      var box = document.createElement('div'); box.className = 'cv_v'; box.textContent = v;
      d.appendChild(box);
    });
    return d;
  }
  /* 2.183 修4a（2026-11-19 老板实测：小账本以纯数字命名，莫名其妙）：
     ledger_conv 展示名三级解析——①rec.title 非空且非纯数字（/^\d+$/ 不算名，
     服务端账本键常为 4 位序号、显示名未随帧下发）→ 直接用；②按 rec.sid 从
     本地会话列表解析显示名（typeof 守卫只读访问，不发帧不触发同步）；
     ③拿不到返回空，调用方兜底「未命名会话 ·#<sid 尾 4 位>」。 */
  function lbTitleOf(rec){
    var t = String((rec && rec.title) || '').trim();
    if (t && !/^\d+$/.test(t)) return t;
    try {
      var sid = String((rec && rec.sid) || '');
      if (sid && (typeof S === 'object') && S && Array.isArray(S.convs)){
        for (var i = 0; i < S.convs.length; i++){
          var r = S.convs[i];
          if (!r || !r[1]) continue;
          if (String(r[4] || '') === sid) return String(r[1]);
          if (typeof 稳定键 === 'function' && 稳定键(String(r[4] || ''), '') === 稳定键(sid, '')) return String(r[1]);
        }
      }
    } catch(e){}
    return '';
  }
  function renderAllCache(host){
    host.innerHTML = '';
    var ov = sec('概览', '');
    var lsAll = readLS();
    var lsBytes = lsAll.reduce(function(a,b){ return a + b.n; }, 0);
    var o = document.createElement('div'); o.className = 'cv_row';
    o.innerHTML = '<div class="cv_meta">' + esc('页面：' + location.href + '\n时间：' + new Date().toLocaleString() +
      '\nLocalStorage：' + lsAll.length + ' 项，约 ' + fmtSize(lsBytes)) + '</div>';
    ov.appendChild(o); host.appendChild(ov);
    ['登录与连接','会话与消息缓存','界面与偏好','其他'].forEach(function(cat){
      var items = lsAll.filter(function(x){ return classify(x.k) === cat; });
      var s = sec('LocalStorage · ' + cat, items.length + ' 项，约 ' + fmtSize(items.reduce(function(a,b){ return a+b.n; },0)));
      if (!items.length) s.appendChild(Object.assign(document.createElement('div'), {className:'cv_empty', textContent:'（无）'}));
      else items.forEach(function(x){ s.appendChild(rowKV(x.k, x.v, fmtSize(x.n))); });
      host.appendChild(s);
    });
    var idbSec = sec('IndexedDB · 全部数据库', '读取中…'); host.appendChild(idbSec);
    readDBs().then(function(names){
      idbSec.querySelector('.n').textContent = names.length + ' 个库';
      if (!names.length) return;
      names.forEach(function(nm){
        openDB(nm).then(function(db){
          var blk = document.createElement('div'); blk.className = 'cv_db';
          blk.innerHTML = '<div class="nm">' + esc(nm) + ' <span class="cv_meta">v' + esc(db.version) + ' / ' + db.objectStoreNames.length + ' 个表</span></div>';
          Array.prototype.forEach.call(db.objectStoreNames, function(sn){
            var stDiv = document.createElement('div'); stDiv.className = 'cv_store';
            stDiv.innerHTML = '<div class="sn">📦 ' + esc(sn) + ' <span class="cv_meta">（点开查看全量记录）</span></div>';
            var det = document.createElement('details'); det.className = 'cv_rec';
            det.innerHTML = '<summary>展开读取全部记录</summary>';
            var loaded = false;
            det.addEventListener('toggle', function(){
              if (!det.open || loaded) return; loaded = true;
              var wrap = document.createElement('div'); wrap.textContent = '读取中…'; det.appendChild(wrap);
              /* 2.183 修4（2026-11-19）：原写法 toggle 时才 storeAll(db, sn)，而外层
                 连接在建完 DOM 后已 db.close() → transaction 恒抛「connection is
                 closing」→ 展开恒 0 条（修4 自测 T-G-b 实锤，2.16 起就坏）。改：展开
                 时自开新连接、读完即关；外层连接只负责枚举 objectStoreNames。 */
              openDB(nm).then(function(db2){
                return storeAll(db2, sn).then(function(r){ db2.close(); return r; });
              }).catch(function(e){ return {rows: [], err: e}; }).then(function(r){
                wrap.innerHTML = '';
                if (r.err) wrap.appendChild(Object.assign(document.createElement('div'), {className:'cv_bad', textContent:'读取失败：' + (r.err.message||r.err)}));
                wrap.appendChild(Object.assign(document.createElement('div'), {className:'cv_meta', textContent:'共 ' + r.rows.length + ' 条记录'}));
                r.rows.forEach(function(x, i){
                  var t = jsonText(x.value);
                  var dd = document.createElement('details'); dd.className = 'cv_rec';
                  var head;
                  /* 2.183 修4a：ledger_conv 记录行改展示名（三级解析＋缀 #sid 尾 4 位
                     防重名）——其它列（读取体/大小）原样不动，样式零改动（§十）。 */
                  /* 2026-11-24：ledger_conv 已物理删除，格式化展示分支一并删除。 */
                  head = '#' + (i+1) + ' 键=' + esc(jsonText(x.key).slice(0,60)) + '（' + fmtSize(t.length) + '）';
                  /* 2.208：展开即先列「每条记录的类型」（中文短标签），再给原始 JSON。 */
                  dd.innerHTML = '<summary>' + head + '</summary>'
                    + '<div class="cv_v">' + esc(t) + '</div>';
                  wrap.appendChild(dd);
                });
              });
            });
            stDiv.appendChild(det); blk.appendChild(stDiv);
          });
          db.close(); idbSec.appendChild(blk);
        }).catch(function(e){
          idbSec.appendChild(Object.assign(document.createElement('div'), {className:'cv_bad', textContent: nm + '：打开失败（' + (e && e.message) + '）'}));
        });
      });
    });
  }
  function readDBs(){
    return new Promise(function(resolve){
      try {
        if (indexedDB.databases){
          indexedDB.databases().then(function(dbs){ resolve((dbs||[]).map(function(d){ return d && d.name; }).filter(Boolean)); }).catch(function(){ resolve([]); });
        } else resolve([]);
      } catch(e){ resolve([]); }
    });
  }
  function openDB(name){
    return new Promise(function(res, rej){
      var rq = indexedDB.open(name);
      rq.onsuccess = function(){ res(rq.result); };
      rq.onerror = function(){ rej(rq.error || new Error('open failed')); };
    });
  }
  function storeAll(db, sn){
    return new Promise(function(res){
      var rows = [], tx;
      try { tx = db.transaction(sn, 'readonly'); } catch(e){ return res({rows:[], err:e}); }
      var rq = tx.objectStore(sn).openCursor();
      rq.onsuccess = function(){
        var c = rq.result;
        if (c){ rows.push({key: c.key, value: c.value}); c.continue(); }
      };
      tx.oncomplete = function(){ res({rows: rows, err: null}); };
      tx.onerror = function(){ res({rows: rows, err: tx.error}); };
    });
  }

  /* ---------- ③ 账本调控（整改单 2026-11-18：原「小账本页.js」调控区并入此处） ----------
     规范§九-4：倒计时以「每秒递减的数字」展示在本区（#cv_lb_hud），不做悬浮窗；
     任意操作会重置倒计时 → 人操作时数字不降属正常设计。数值来源＝账本核对.js
     的 window.lbHudText()（每秒由下方 interval 刷新，仅本 tab 可见时更新）。 */
  /* 2.219（老板 2026-11-20 16:21「保留最近 N 轮没起作用」）：保留下发轮数
     改值后立即 ① 按新 N 批量裁本地账本存量；② 发一次 timer 核对，把
     mods.lb_rounds 上报服务端（服务端 _采纳lb轮数 立即调整下发轮数）。 */
  function lbRoundsApplied(){
    try { if (typeof lbTrimAllSnaps === 'function') lbTrimAllSnaps(true); } catch(e){}
    /* 2.220：预备画面（snap_conv）与本地账本同一把尺子——改值当拍即按新 N 裁。 */
    try { if (typeof lbTrimAllSnaps === 'function') lbTrimAllSnaps(true); } catch(e){}
    try {
      var sid = (typeof S !== 'undefined' && S)
        ? (S.anchorFull || ((typeof curSid === 'function') ? curSid() : '')) : '';
      if (typeof ledgerVcheckSend === 'function') ledgerVcheckSend('timer', sid || '');
    } catch(e){}
  }
  function renderLedgerCtl(host){
    host.innerHTML = '';
    /* 2.190（老板纠正口径：小账本＝① 会话预备画面，③ 只放配套调控功能）：
       原「📒 我的小账本」第二本账整块删除（renderLbCards/readLedgerRows/
       delLedgerRow 一并删，不是隐藏）；③ 顶部改放从 ① 挪来的「预备账册参数」——
       它是配套参数，不是账本本体。 */
    var cfg = document.createElement('div');
    cfg.className = 'cv_sec';
    /* 2.204（B1）：单位统一为「轮」（1 轮＝人类发言＋终极回复），默认 5 轮，
       与本地账本 CFG.lb_rounds、服务端 ledger_push_rounds 三处同值；
       此处与下方「本地账本保留轮数」是同一个值，改任一处两边同步。 */
    cfg.innerHTML = '<h3>预备账册参数 <span class="n">单位：轮（1 轮＝人类发言＋终极回复）</span></h3>' +
      '<div style="padding:10px 14px;font-size:13px;display:flex;align-items:center;gap:8px">' +
      '保存最近 <input id="cv_n" type="number" min="1" max="50" step="1" style="width:64px;' +
      'border:1px solid #d5dbe1;border-radius:6px;padding:5px 6px;font-size:13px" value="5"> 轮' +
      '<span class="cv_meta" style="margin:0">（只留人类发言＋终极回复，思维流不存）</span></div>' +
      '<div class="cv_lbhint" style="padding:0 14px 8px">服务端每次补发轮数：<b>' +
      ((typeof lbRounds === 'function') ? lbRounds() : 5) +
      ' 轮</b>（跟随「保留轮数」，改值后下一次核对即同步到服务端）</div>';
    host.appendChild(cfg);
    var nEl = cfg.querySelector('#cv_n');
    try { nEl.value = (typeof lbRounds === 'function') ? lbRounds() : 5; } catch(e){ nEl.value = 5; }
    nEl.onchange = function(){
      var v = parseInt(nEl.value, 10);
      if (!(v >= 1 && v <= 50)){ v = 5; }
      nEl.value = v;
      try {
        if (typeof CFG !== 'undefined'){ CFG.lb_rounds = v; if (typeof cfgSave === 'function') cfgSave(); }
        localStorage.setItem('trae_webm_frame_n', String(v));   /* 旧键镜像，兼容老逻辑 */
        localStorage.setItem('trae_webm_frame_n_unit', 'round');
      } catch(e){}
      try { var r = document.getElementById('lb_in_rounds'); if (r) r.value = v; } catch(e){}
      nEl.parentElement.lastElementChild.textContent = '已保存：之后每次落盘只留最近 ' + v + ' 轮（本地账本＝服务端下发同值）';
      lbRoundsApplied();
    };
    var hud = document.createElement('div');
    hud.className = 'cv_sec';
    hud.innerHTML = '<h3>核对与离线倒计时 <span class="n">每秒递减；任意操作即重置回配置值</span></h3>' +
      '<div id="cv_lb_hud">—</div>';
    host.appendChild(hud);
    var fs = document.createElement('div');
    fs.className = 'cv_sec';
    fs.innerHTML = '<h3>账本调控 <span class="n">改值立即生效并保存</span></h3>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_clean"> 自动清理无用小账本（14 天未查看自动删）</label></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_hud"> 悬浮倒计时条（左下角，默认关；勾选即悬浮走字）</label></div>' +
      '<div class="cv_lbrow"><label>离线倒计时（秒）</label><input type="number" id="lb_in_offline" min="15" max="3600"></div>' +
      '<div class="cv_lbrow"><label>主动核对周期（秒）</label><input type="number" id="lb_in_period" min="15" max="3600"></div>' +
      '<div class="cv_lbhint">核对契机共 4 个：① 登录 / 打开网页版（login）② 手机切换会话（switch）③ 切换操控服务端（svr）④ 到点主动核对（timer，按本周期）。①②③ 由操作触发、立即发一次；④ 只在网页在线时按周期发。网页不在线 → 一律不发（0 WS）。</div>' +
      '<div class="cv_lbrow"><label>保留轮数（本地账本＝预备画面＝服务端默认同值）</label><input type="number" id="lb_in_rounds" min="1" max="50"></div>' +
      '<div class="cv_lbrow"><label>思维流直播帧间隔（秒，0＝不限频一变即发）</label><input type="number" id="lb_in_think" min="0" max="120"></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_idleout"> 离线倒计时启用（走完发下线信号）</label></div>' +
      '<div class="cv_lbrow"><label><input type="checkbox" id="lb_ck_bgout"> 切后台/切网页自动下线</label></div>' +
      '<div class="cv_lbhint">以上为账本系统 V1.0 全部调控项（唯一集中入口）。小账本本体在「① 会话预备画面」，本页只放配套调控；原始记录仍可在「② 全部缓存」展开 IndexedDB · trae_webm_idb · ledger_conv。保留轮数三处同值：本地账本 / 预备画面 / 服务端补发默认（服务端侧可配）。</div>';
    host.appendChild(fs);
    var q = function(id){ return fs.querySelector('#' + id); };
    var save = function(){ try { if (typeof cfgSave === 'function') cfgSave(); } catch(e){} };
    q('lb_ck_clean').checked = !!(typeof CFG !== 'undefined' && CFG.lb_autoclean);
    q('lb_ck_hud').checked = !!(typeof CFG !== 'undefined' && CFG.lb_hud);
    q('lb_ck_idleout').checked = !!(typeof CFG !== 'undefined' && CFG.lb_idleout);
    q('lb_ck_bgout').checked = !!(typeof CFG !== 'undefined' && CFG.lb_bgout);
    q('lb_in_offline').value = (typeof lbOfflineSecs === 'function') ? lbOfflineSecs() : 120;
    q('lb_in_period').value = (typeof CFG !== 'undefined' && parseInt(CFG.lb_period)) || 90;
    q('lb_in_rounds').value = (typeof lbRounds === 'function') ? lbRounds() : 5;
    q('lb_in_think').value = (typeof CFG !== 'undefined' && CFG.lb_think !== undefined) ? CFG.lb_think : 5;
    q('lb_ck_clean').onchange = function(){ CFG.lb_autoclean = this.checked ? 1 : 0; save(); };
    q('lb_ck_hud').onchange = function(){
      CFG.lb_hud = this.checked ? 1 : 0; save();
      try { if (typeof lbHud === 'function') lbHud(); } catch(e){}   /* 开→立刻建条走字；关→立刻撤 */
    };
    q('lb_ck_idleout').onchange = function(){ CFG.lb_idleout = this.checked ? 1 : 0; save(); try { if (typeof lbLastAct !== 'undefined') lbLastAct = Date.now(); } catch(e){} };
    q('lb_ck_bgout').onchange = function(){ CFG.lb_bgout = this.checked ? 1 : 0; save(); };
    q('lb_in_offline').onchange = function(){ CFG.lb_offline = Math.max(15, parseInt(this.value, 10) || 120); this.value = CFG.lb_offline; save(); try { if (typeof lbLastAct !== 'undefined') lbLastAct = Date.now(); } catch(e){} };
    q('lb_in_period').onchange = function(){ CFG.lb_period = Math.max(15, parseInt(this.value, 10) || 90); this.value = CFG.lb_period; save(); };
    q('lb_in_rounds').onchange = function(){ CFG.lb_rounds = Math.min(50, Math.max(1, parseInt(this.value, 10) || 5)); this.value = CFG.lb_rounds; save(); try { localStorage.setItem('trae_webm_frame_n', String(CFG.lb_rounds)); } catch(e){} var n0 = document.getElementById('cv_n'); if (n0) n0.value = CFG.lb_rounds; lbRoundsApplied(); };
    q('lb_in_think').onchange = function(){
      CFG.lb_think = Math.max(0, parseInt(this.value, 10) || 0);
      this.value = CFG.lb_think; save();
      /* 规范五：只管思维流模块的推送频率。v 用整数秒下发（S1 裁定：v>0 开限频
         夹 1~600、v<=0 关限频，免重启生效），回执 think_int_ack 由 账本核对.js 处理 */
      try { if (typeof sendJson === 'function') sendJson({t: 'set_think_int', v: CFG.lb_think | 0}); } catch(e){}
    };
    /* 2.234（老板 2026-11-20 23:42）：原「强核对」独立分组整段删除——不再需要
       大面板。核对状态只看两处轻提示：顶部横幅「核对中 · 会话名」＋顶栏圆球变橙。 */
    if (!renderLedgerCtl._tick){
      renderLedgerCtl._tick = setInterval(function(){
        var el2 = document.getElementById('cv_lb_hud');
        if (!el2) return;
        var txt = '—';
        try { txt = (typeof window.lbHudText === 'function') ? (window.lbHudText() || '—') : '—'; } catch(e){}
        el2.textContent = txt;
      }, 1000);
    }
  }

  function build(){
    if (built) return; built = true;
    /* 2.190 自检：查看器版本必须与页面总版本恒等（不一致＝有人漏改，打 bad 日志） */
    if (typeof VER === 'string' && VER && CV_VER !== VER){
      try { if (typeof diagLog === 'function')
        diagLog('版本不同步 查看器=' + CV_VER + ' 页面=' + VER, 'bad'); } catch(e){}
    }
    injectStyle();
    var pg = document.createElement('div'); pg.id = 'cv_page';
    pg.innerHTML = '<div id="cv_hd"><button id="cv_back">‹ 返回</button><div class="t">手机缓存查看器 v' + CV_VER + '</div>' +
      '<button id="cv_reload">刷新</button></div>' +
      '<div id="cv_tabs"><button id="cv_t1" class="on">① 账本</button><button id="cv_t3">② 调控</button></div>' +
      '<div id="cv_bd"></div>';
    document.body.appendChild(pg);
    var bd = pg.querySelector('#cv_bd');
    var ttl = pg.querySelector('#cv_hd .t');
    var tabsEl = pg.querySelector('#cv_tabs');
    function showTabs(on){ if (tabsEl) tabsEl.style.display = on ? '' : 'none'; }
    pg.querySelector('#cv_back').onclick = function(){ pg.classList.remove('on'); };
    function draw(){
      if (tab === 'preview') renderPreview(bd);
      else if (tab === 'ledger') renderLedgerCtl(bd);
      else if (tab === 'all') renderAllCache(bd);   /* 2.226：缓存视图仅由设置页「缓存管理」进入 */
    }
    pg.querySelector('#cv_reload').onclick = function(){ view = 'list'; detailItem = null; draw(); };
    pg.querySelector('#cv_t1').onclick = function(){
      tab = 'preview'; view = 'list'; detailItem = null;
      this.classList.add('on'); pg.querySelector('#cv_t3').classList.remove('on');
      if (ttl) ttl.textContent = '手机缓存查看器 v' + CV_VER;
      showTabs(true); draw();
    };
    pg.querySelector('#cv_t3').onclick = function(){
      tab = 'ledger';
      this.classList.add('on'); pg.querySelector('#cv_t1').classList.remove('on');
      if (ttl) ttl.textContent = '手机缓存查看器 v' + CV_VER;
      showTabs(true); draw();
    };
    /* 整改单：设置页「小账本」按钮唯一入口——打开入口走顶层 cvEnsure */
    /* 2.190（老板：点「📒 小账本」应该直接看到账本本体＝① 会话预备画面） */
    window.cvOpen = function(){
      tab = 'preview'; view = 'list'; detailItem = null;
      var b1 = pg.querySelector('#cv_t1'), b3 = pg.querySelector('#cv_t3');
      if (b1) b1.classList.add('on'); if (b3) b3.classList.remove('on');
      if (ttl) ttl.textContent = '手机缓存查看器 v' + CV_VER;
      showTabs(true); pg.classList.add('on'); draw();
    };
    /* 2.226（老板令：缓存不再是页签）：「缓存管理」入口——复用同一页与 renderAllCache，
       进入时隐藏「账本/调控」页签，标题改「缓存管理」，返回键照旧退出。 */
    window.cvOpenCache = function(){
      tab = 'all'; view = 'list'; detailItem = null;
      if (ttl) ttl.textContent = '缓存管理 v' + CV_VER;
      showTabs(false); pg.classList.add('on'); draw();
    };
  }
  /* V2 验收 Y14（2026-11-18）：#btn_cacheview 重复入口已撤（html 不再有该
     按钮），旧 bind() 死代码一并摘除——设置页「小账本」按钮为唯一入口。 */
  /* 整改单（2026-11-18）：设置页「小账本」按钮唯一入口——顶层暴露，未 build 过
     也先补 build（build 内部自防重复），保证任何入口点开即可用。 */
  window.cvEnsure = function(){ build(); };
  /* 2.208（老板令·每条记录必须看得见类型）：顶层暴露只读映射，供详情/其它模块与自测复用，
     返回固定中文短标签「人类发言 / AI 终极回复 / 思维流 / 类型未知」。 */
  window.cvKindOf = function(m){ return kindOf(m); };
  window.cvKindText = function(m){ return kindText(m); };
})();
