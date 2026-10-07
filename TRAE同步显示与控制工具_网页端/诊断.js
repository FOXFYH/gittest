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

let ws = null, reconnectTimer = null;
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
const VER = '2.67';   /* 2.67：切换过程状态机——把「一点到切完」拆成可分辨的分档，
                            反映真实过程（用户 2026-10-07 定）。switch_pend 改带 phase：
                            connecting(WS 没连上→「正在连接 WS…」)/waiting(已发出未收服务端回应
                            →「等待服务器回应…」)/switching(收到 switch_ack→「正在切换中…」)/
                            ok(收到 switch_ok→「切换成功」2 秒后交回状态灯)/fail(「切换失败」)。
                            每 10s 补发同一条 switch；满 60s 判失败。服务端新增 switch_ack/
                            switch_ok 回执；目标在服务端最近抓取的 pane 里则点击前预取推帧
                            (switch_pre) 先显示。服务端 _cmd_switch 加「已同会话直接跳过」。
                            （待办卡.js/事件总线.js/输入界面.js/会话列表.js/缓存.js/上线与界面.js；
                             服务端 命令路由.py/抓取轮询.py，v3.01）
                         2.66：状态栏未就绪态分级——不再一律写「TRAE 界面未就绪」
                            （用户 2026-10-07 反馈：对面服务器不在线时也写这句，不准确）。
                            renderState 的未就绪分支改调 notReadyState() 按真实原因分档：
                            连不上中转→说频道；没选服务端→说未选择；选中服务端近期无来向
                            消息（> SRV_DEAD_MS）→「服务端「X」不在线（无响应）」；服务端在跑
                            但 TRAE 未连上→才是「TRAE 界面未就绪」。另加 5 秒定期复核（仅在仍
                            写未就绪文案、且没有别的一次性提示在显示时）。输入界面.js。
                         2.65：修「切换服务端后白屏、还得手点会话」（用户 2026-10-07）——
                            switchSrv 只清了 S.snap，S.anchorSid 仍指向旧服务器的会话；
                            新服务端快照到达时 adoptSnap 判「锚定会话已消失」→ 冻结正文（白屏），
                            且会话列表无选中。改为切服务端时清空「锚定 + 本地历史 + 切换在途帧」，
                            让新服务端广播来的「当前选中会话」（convs 第 3 位选中标志）被自动吸附打开：
                            一过去就有对话被打开，不用再手选（电脑名册.js switchSrv）。
                         2.64：根治「切会话自动跳顶 + 进全屏 + 拉历史」（用户 2026-10-07）——
                            滚动回调改为「只认人手滚动」：touchmove/wheel/keydown 打手势窗口；
                            程序化重排（空渲染把 scrollTop 夹回 0、scrollTop=savedTop、fprog）一律
                            不触发「拉历史/进全屏」；并给切换在途设闸、所有程序化滚动统一走 fprog、
                            切会话改「先读存帧再渲染一次」不再先画空帧。前几次只补落点，本条治根。
                         2.63：修「2.61/2.62 上线后手机仍一模一样」——成品入口 HTML 的
                            全部 <script src>/<link href> 补 ?v=2.63 版本查询串（用户 2026-10-07）。
                            真根因：外链 js 无版本查询串，手机长时间开着页面 + 浏览器/CDN 缓存旧 JS，
                            2.61/2.62 的修复根本没被加载，现象与修复前「一模一样」。加 ?v= 后每次发版
                            URL 必变，必然取到新 JS；以后每次发版同步 +0.01 并改这里即可。
                         2.62：修「上翻历史后切会话仍停在最顶」——切换会话补调
                            exitFmsg()，并让 S.pinBottom 压过全屏 inF、切换在途
                            期间不消费标志（用户 2026-10-07）。
                            2.61：切会话后消息区钉底（用户 2026-10-07）——点会话先秒显
                         目标会话本地存帧/留白，切换中间态的两次空渲染把 scrollTop
                         归了 0；正文（本地存帧或直播帧）真正上屏那次原按 savedTop=0
                         原样还原到顶部，且 scrollTop<60 误触发上翻补拉。改为一次性
                         标志 S.pinBottom：切会话入口（会话列表.js）置位，正文渲染
                         那次（消息渲染.js）用 fprog 钉底并清标志——程序化滚动 450ms
                         静默，不再误触发「正在取回历史记录」。全屏态只保位置不动。
                         2.60：删「消息区切换在途提示条」（用户 2026-10-07）——
                         切换会话时目标会话有本地存帧即刻显示、无则纯白（无文字/无
                         虚线框）；「正在切换到「X」…」只留顶栏状态栏一处（消息渲染
                         .js 的 .switching 条已删、样式.css 的 .switching +
                         @keyframes pulse 一并清理）。
                         2.59：网页本地缓存限「最近 3 轮」（用户 2026-10-07）——
                         落盘（IDB 存帧 / 本地历史）+ 服务端全量重建首屏均只留
                         最近 3 轮（一问一答为一轮）；更早的靠「历史取回」按需
                         向本地账本索要，不落盘。
                         2.58：切会话「秒显目标会话本地存帧、无则诚实留白」
                         （用户 2026-10-07）——点会话 B 即刻清掉旧会话 A 的
                         正文：有 B 的 IDB 存帧就上屏供复习，没有就留白 +
                         「正在获取直播帧」条，绝不回落显示 A。
                         2.57：修「直播帧提示条(#livebar)层级过高、压住左侧菜单」
                         （用户 2026-10-07）——样式.css 的 z-index 36→28，
                         低于抽屉 #drawer(30)/遮罩 #mask(29)。
                         2.56：本专项《切换会话锚定与广播对齐》A/B/C/F 组（用户 2026-10-07）——
                         锚定优先（curTitle/curSid 以锚定 sid 为准；锚点已消失只提醒、不静默改锚；
                         会话列表选中态与锚定态同源）；快照落地 IndexedDB（trae_webm_idb：5s 节流 /
                         超一周剪枝 / 换代清空）+ 切换秒显与「正在获取直播帧」小条；占位卡绑锚定
                         sid + IDB 持久化 + 兜底延长到 12 小时。
                         2.54：广播「无头回复」与占位卡滞留专项（用户 2026-10-07）——curMsgs 改
                         「快照权威尾部 + 账本只补更早」（新增 _msgKey 指纹），账本里的重复/
                         乱序行不再让「连续 AI 回答而无对应问句」上屏（无头回复）；配套服务端
                         占位卡补会话归属 + timeout 终局撤卡（服务端 2.93）。
                         2.53：13.1 昵称条——sendJson 给所有 JSON 外发帧统一附 nick（能报就报；
                         不改 FOX 协议头，login/hb 已显式带）。
                         2.52：13.1 软件号规范整改——设置页新增「本机身份」（软件号只读
                         显示 + 昵称输入口，昵称随登录/心跳帧上报，不改 FOX 协议头）；
                         断线重连限次退避（3→6→…→60s，达上限停并宣告失败）。
                         2.51：MD 渲染器（.md 阅读排版）；2.49：上滑到顶取更早历史（本专项·本地会话账本移植·阶段五）——
                         hist_prev 每次 4 条；撞顶亮「正在取回历史记录…」；服务端回 end
                         或游标不再前进即判到底（防死循环）；缓存.js curMsgs 让账本里
                         翻出来的更早段能上屏。配合服务端 2.84（hist_prev 回 end）。
                         2.48：多服务端静默化 + 名册去伪——① 删「默认服务端」假条目兜底
                         （无 srv 一律丢弃；服务端 2.83 起凡发出报文都盖源头名）；
                         ② 抽屉「服务端」标题行加「↻ 刷新」按钮（点名 who，在线者
                         才应答；平时各服务端全程静默、互不报状态）。
                         2.47：会话行显示「定时闹钟」——凡设了「定时自我激活」的
                         会话，在会话名后追加 ⏰（多条带条数），一眼看出哪些
                         会话有定时提醒（自我激活.js 闹钟后缀/定时指纹；
                         会话列表.js 渲染 + 指纹去重）。数据源快照 snap['定时']，
                         无需服务端改动。
                         2.46：后台借框占用保护——服务端借输入框投递（定时自我激活/
                         收件箱提醒）期间广播 input_busy，网页端禁用发送并提示
                         「程序正在借用输入框，请稍后」（挡住人类操作）；服务端另
                         在进官方排队条时点「立即发送」插队、两提醒错拍。
                         2.45：新增「会话备注」「定时自我激活」（右键会话菜单）——
                         会话名后缀（备注）+ 到点借输入框定时投递（纯本地不广播）。
                         2.44：副频道自动切回主频道的探测间隔——由「等 60s 后每分钟探测」改为
                         「15 分钟首探 + 每 15 分钟重试」（设置与迁移.js startProbe）。
                         2.43：TXT 阅读器正文加「下拉刷新」——正文顶部下拽、松手从头重读
                         本文件，抓取电脑上最新内容（与 📂 浏览页列表的下拉刷新同款）。
                         2.42：删除链路保活 PING——网页端 kaTimer/ws.send('ping')、常量
                         KA_SEC，与服务端 run_forever 底层 PING、KA_SEC 保活分支
                         一并去除（本软件免 PING，由中继自动保持在线）。
                         2.41：一键换号迁移弹窗加同款设置——「保留最近 N 轮」（默认 100）+
                         ☑清理其它账号 + ☐智能迁移最重度账号 + ☑自动压缩；下发改为
                         dict `{目标,轮次,清理,压缩,迁移}`（服务端换号内核 1.10 起支持，
                         与电脑上的「TRAE换号工具」同一款内核）。旧式纯号码仍兼容。
                         2.40：会话备注 + 定时自我激活（均为网页端专享，独立 js）——
                         ① 会话名后追加（备注），数据源快照 snap['备注']，不改 TRAE 真名
                         （会话备注.js：备注后缀/备注指纹/备注入快照/备注菜单项）；
                         ② 右键会话菜单新增「📝 编辑备注」（note_set [sid,文本]，空=删除）
                         与「⏰ 定时自我激活」（sched_add/ls/del/clear，间隔分钟×次数，
                         服务端到点借输入框投递、纯本地不广播；自我激活.js）。
                         2.39：📂 浏览页——① 文件行右尾显示文件大小（服务端 bench_ls
                         回包 fsizes，B/KB/MB/GB 自动换算）；② ⋯ 面板新增「详细信息」
                         （bench_stat：名称/类型/位置/大小/修改·创建·访问时间/只读，
                         可一键复制）。2.38：📂 浏览页行尾 ➕ 左边加 ⋯ 操作面板——对单个文件/
                         目录重命名、移动（剪切）、删除（二次确认弹框）、复制路径；
                         移动为「选目标目录」模式（行尾 ✅=移到此 / 头部 📦 移到此）。
                         2.37：📂 浏览页加「下拉刷新」——列表顶部下拽、松手重取当前
                         目录（服务端 bench_ls 是静态拉取，不自动广播，目录里新增
                         文件需主动重拉）；展露区显示「下滑刷新/松手刷新/下滑刷新中…」。
                         2.36：TXT 阅读器去掉自带右键/长按小菜单——复制/粘贴等
                         改用浏览器原生菜单（自绘菜单与原生菜单会重叠）。
                         2.35：WS 链路保活改「免心跳」——KA_SEC 25→1800（30 分钟），
                         与服务端同步。
                         2.34：TXT 阅读器字号落盘 localStorage——A-/A+ 调好后
                         长期记住，不必每回重调（键 trae_freader_font）。
                         2.33：TXT 阅读器加「✎ 编辑 → 💾 保存」——顶部出编辑钮，
                         点后正文就地 contenteditable（不弹窗，直接出光标，落末尾），
                         改完保存写回电脑原文件（bench_write，沿用读到时的编码 + CRLF
                         行尾还原）；附右键/长按小菜单（剪切/复制/粘贴/全选，读模式
                         仅复制/全选）。未读完点 ✎ 会先自动续读到底再进编辑。
                         2.32：📂 浏览页「向上级跃迁」——方向键/⬆/面包屑不再限于
                         工作台根内，可一路到磁盘根、浏览整台电脑（工作台仅作默认
                         出发点）；只在工作台内才记忆目录，跃迁到上级是临时的，
                         下次自动回工作台。面包屑改按绝对路径逐级可点。
                         2.31：TXT 阅读器字号改 A- / A+ 双按钮手动调节（中间
                         显示当前号数），下限 6 号、上限 24 号（用户 2026-10-05）。
                         2.30：📂 浏览页——① 记忆上次查看目录（localStorage
                         trae_webm_bench_last），点 📂 直落上次目录，目录失效
                         自动回落根；② 顶部路径改「可点击面包屑」（📂 根 › 一级
                         › …，点任一级回退该上级）。
                         2.29：benchOpen 先关闭可能盖在上面的文件阅读器，
                         修「先开文件再弹文件夹→文件夹被阅读器遮住」。
                         2.28：本地主动弹窗展示——事件总线消费 bench_open
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
