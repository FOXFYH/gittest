'use strict';
const S = {
  ws: null, onLine: false, wsOpenAt: 0, lastSrv: 0,
  /* 1.57：本次断线是否发生在「页面不可见（切后台/锁屏）」期间——
     用于顶栏文案区分「后台断的，回来自动补」与「前台真断了」 */
  dropByHide: false,
  /* 1.61：连续多少次「压根没连上就断」（连上过一次就清零）。
     用来区分「偶尔抖一下」和「中继服务整个不可用」。 */
  failStreak: 0,
  box: '(未连接)', port: 0, boxes: [], alive: new Set(),
  points: '—', snap: {},
  attach_pending: null,
  model_map: {}, model_busy: false,
  /* 1.15 模型收藏：favs=收藏的模型真名数组（localStorage 持久）；
     models_full=最近一拍官方模型列表 [name,trail,restricted]；
     fav_invalid=失效收藏名集合（官方改名/下架），warned=已提醒集合 */
  favs: [], models_full: [], fav_invalid: [], fav_warned: [],
  model_names: new Set(),
  convs_key: null, msgs_key: null,
  /* 1.35：poll_sec 本地镜像与档位 UI 已移除（服务端 GUI 调整） */
  busy: false, gen: false, ready: false,
  task_open: false, task_mem: '', task_cur: '', task_lock: null,
  /* 1.08 新建任务弹窗 / 1.11 task_lock=锁定文件夹 */
  /* 1.09：待确认项（空窗期反馈）——本地立即回显「我」的占位气泡；
     1.88：消卡改按 did（对话 ID 核对，见 did_ack/pendClearByDid），
     不再按文本/前 N 字识别（2.05 清死代码：连带删净已不参与任何
     判断的 pend_head / pend_age / pend_seen / pend_claims / pend_conv） */
  pending: [], pend_seq: 0,
  qopen: {},                         /* 2.08：排队条每条的「展开全文」标记
                                        {文字: true}——文字默认只显示两行，
                                        点文字即展开；快照重绘后靠它保持，
                                        文字离开队列即清（见 qopenPrune） */
  ask_lock: null,                    /* 1.27：提问卡单选锁 {fp, idx} */
  qedit: null,                       /* 1.29：正在取出编辑的排队条下标
                                        （快照回来后回填输入框） */
  acct: '',                          /* 1.27：TRAE 登录账号名 */
  login_lost_since: 0,               /* 1.77：连续未登录起点（满60s才亮红条） */
  switch_pend: null,
  /* 2.61：切会话后应钉底的一次性标志——切会话入口（会话列表.js）置位，
     消息真正渲染的那一次（消息渲染.js）用 fprog 钉底并清除；中间态
     重画/空渲染都不碰它、也不清它。 */
  pinBottom: false,
  /* 1.xx：最大化/全屏预警——fulls_snooze=静默截止时刻（毫秒时间戳，
     稍后提醒15分钟 / 近期不再提醒6小时）；falls_fail=切换连续失败计数
     （兜底触发预警用，成功到达归零） */
  fulls_snooze: 0, falls_fail: 0,
  /* 1.12 多服务端：在线名册（name → {sid,v,box,port,boxes,alive,
     conn,ts}）+ 当前操控的服务端名（localStorage 记忆） */
  servers: {},
  cur: null,
  /* ===== 2.20 新架构：请求-响应 + 本地缓存 ===== */
  srvVer: '0',          /* 服务端版本号（hello 的 d.ver），拼缓存键用 */
  histConv: '',         /* 当前已拉取历史的会话标题（防重复发 req） */
  histMsgs: null,       /* 本地缓存渲染数组 ['u'|'a',文本,tm,rev,del] */
  histRaw: [],          /* 账本原始记录 [{seq,role,text,tm,can_rev,can_del}] */
  histVer: 0, histHave: 0,   /* 游标：会话版本号 + 已存到的 seq */
  histLoadingPrev: false,    /* 向上补拉老历史防重入 */
  /* 2.49：上滑到顶取更早历史——histEnd=已到最早（服务端回 end 或游标未前进，
     不再空转请求）；histPullFrom=上次请求起始游标（与本次相同=没前进→判到底）；
     histEndFlashT=「已经是最早记录了」提示节流。 */
  histEnd: false, histPullFrom: 0, histEndFlashT: 0,
  /* ===== 2.18 锚定：网页版不再无条件跟随 TRAE 当前选中会话 =====
     用户口径：「网页版是锚定的，它锚定哪个对话，不切换就一直显示这个
     对话」——别人在电脑版操作别的会话，网页版不跟着跳。anchorSid 为
     『空』表示尚未锚定（首拍或锚定会话已被删），此时自动吸附到当前
     选中会话；一旦锚定，除非用户自己切会话/锚定会话消失，否则不换。 */
  /* 2026-10-16（用户口径：绑定改终身号）：anchorSid 存「稳定性键」＝终身号
     （TRAE：SID 前 4 位数字；WorkBuddy：完整 SID，本身永久不变）/ 非数字 SID
     时退回会话名；anchorFull 记锚定会话「当前完整 SID」——供 switch/send/
     路由归还/占位卡归属等**必须用真 sid 定位服务端会话**的地方使用。 */
  anchorSid: '', anchorTitle: '', anchorFull: '',
  /* 本专项 A4：锚定会话「已消失」提醒去重标记（=已提醒过的那把锚定 sid） */
  anchor_gone: '',
  /* 2.88（老板 2026-10-19 23:55）：锚定冻结时效状态——anchor_stale_since=锚定
     被“借框/后台挪走”的起始时刻（桌面回到锚定即清零）；anchor_stale_n=连续被抢
     拍数；anchor_led_at=超阈值后向账本补拉锚定会话最新内容的节流时刻。用于
     「短暂借框固定旧内容、超阈值改走锚定自己的账本」这一时效（见 通用工具.js
     ANCHOR_FREEZE_MS / adoptSnap）。 */
  anchor_stale_since: 0, anchor_stale_n: 0, anchor_led_at: 0,
  /* 2.89（老板 2026-10-20）：冻结到期后的「待刷新」标记（1=已超 ANCHOR_FREEZE_MS
     仍被抢，已节流补拉锚定历史；正文一律保留 old.msgs 不覆盖，见 adoptSnap）。 */
  anchor_need_refresh: 0,
  /* 2.94（老板 2026-10-20 07:38）：快照 msgs 单调护栏状态——msgs_guard_since=同一
     「空帧/明显变短」形态的起始时刻（恢复正常即清零）；msgs_act_at=最近一次收到
     msg_act（回退/删除完成）的时刻，其 2s 内放行变短（合法删除不误伤）。
     见 通用工具.js _msgsMonotonic / adoptSnap。 */
  msgs_guard_since: 0, msgs_act_at: 0,
  /* 本专项 B3：直播帧等待态——livePend=正在等直播帧的锚定 sid；
     liveGot=本次切换是否已拿到直播帧（拿到后本地旧帧不再回铺） */
  livePend: '', liveGot: false,
  /* 2.57B：切换在途上屏的「目标会话落地快照」（2.106 起为单份、切换专用）；
     不属于目标为 null——此时正文诚实留白，绝不回落到仍是旧会话 A 的服务器快照。 */
  liveFrame: null,
  /* 2.106（老板 2026-10-20 17:29「切换即清屏」）：swHold 不再阻止清屏——
     发起切换即立刻清空离开会话的一切，屏幕只允许显示目标落地快照（无则留白）。
     swHold=true 只在「目标落地快照已上屏之后」才由 renderAll 置位，用于防中间态
     闪回（保留 2.89 防交叉闪现的价值，但【绝不】拿它按住旧会话画面）。 */
  swHold: false,
  msgs_last: null,      /* 最近一次 renderMsgs 实参——仅在「目标快照已上屏之后」原样重放（防闪回） */
  swPPainted: false,    /* 本次切换是否已把「目标落地快照」上过屏——只有它置真后 msgs_last 才允许重放 */
  swFrameReady: true,   /* 目标落地快照（IDB 单份）是否已读回：false＝读取在途，此间清屏留白 */
  /* 2.106（B·老板 17:26）：未就绪「连续性门槛」起点——online=false 连续计时，
     满 NOT_READY_WARN_MS 才提示（避免单拍瞬态闪烁误报；只提示、不拦发言）。 */
  notReadySince: 0,
  /* 2.67：切换预取——服务端在点击前先推来的目标会话正文帧（目标在其最近
     抓取的 pane 里时）；置真后本地 IDB 存帧不再回铺覆盖它。 */
  livePrefetch: false,
  /* 2.46：后台借框占用（定时自我激活/收件箱提醒到点投递）——服务端广播
     input_busy 置此；busy 期间禁用发送并提示「程序正在借用输入框」。
     inputBusyT 为安全兜底定时器（防服务端中途消失卡死）。 */
  inputBusy: '', inputBusyT: 0,
  /* T63：加急插入勾选（输入框放大态顶行「急」）——true=本次发送/插话
     走「加急」通道（route_send 的 interject_now，进排队条即点「立即发送」
     插队）。**只活在本会话内存里、不落任何持久配置**：每次打开/刷新页面
     都回到 false（未选中）。 */
  urgent: false,
};

/* ================= DOM 快捷 ================= */

const $ = id => document.getElementById(id);
const el = {
  lbl_title: $('lbl_title'), lbl_ver: $('lbl_ver'),
  menu: $('btn_menu'), rlink: $('lbl_rlink'), box: $('cmb_box'),
  srv: $('lbl_srv'), srvlist: $('srvlist'),
  srvrefresh: $('btn_srvrefresh'),
  ports: $('lbl_ports'), points: $('lbl_points'), model: $('cmb_model'),
  state: $('statebar'), loginbar: $('loginbar'),
  msgs: $('msgs'), attach_row: $('attach_row'),
  input_row: $('input_row'),
  attach: $('btn_attach'), ent: $('ent'), take: $('btn_take'),
  copy: $('btn_copy'),
  urgent: $('btn_urgent'),        /* T63：加急插入勾选（放大态顶行「急」） */
  send: $('btn_send'),
  file: $('file_pick'), drawer: $('drawer'), mask: $('mask'),
  dclose: $('btn_dclose'), convs: $('convs'), new: $('btn_new'),
  launch: $('btn_launch'), refresh_pts: $('btn_refresh_pts'),
  net: $('btn_net'), netpage: $('page_net'),
  netback: $('btn_netback'), today: $('lbl_today'), tnet: $('tv_net'),
  wsurl: $('in_wsurl'), keep: $('in_keep'), nsave: $('btn_netsave'),
  nflash: $('lbl_netflash'),
  sel_tts_voice: $('sel_tts_voice'), sel_tts_rate: $('sel_tts_rate'),
  btn_tts_preview: $('btn_tts_preview'), lbl_tts_flash: $('lbl_tts_flash'),
  lbl_chan_q: $('lbl_chan_q'), btn_chan_main: $('btn_chan_main'),
  btn_chan_back: $('btn_chan_back'), lbl_ws1: $('lbl_ws1'), lbl_ws2: $('lbl_ws2'),
  diag_chan: $('diag_chan'), diag_ws: $('diag_ws'), diag_srv: $('diag_srv'),
  diag_last: $('diag_last'), diag_cnt: $('diag_cnt'), diag_log: $('diag_log'),
  netreconn: $('btn_netreconn'), nettest: $('btn_nettest'),
  check_fulls: $('btn_check_fulls'), lbl_fulls: $('lbl_fulls'),
  netclear: $('btn_netclear'), diagcopy: $('btn_diagcopy'),
  bench: $('btn_bench'), bfoot: $('bfoot'),
  taskpage: $('page_taskdlg'), td_none: $('td_none'),
  td_lock: $('td_lock'),
  td_sel: $('td_sel'), td_name: $('td_name'), td_full: $('td_full'),
  td_re: $('btn_tdre'), td_ok: $('btn_tdok'), td_cancel: $('btn_tdcancel'),
  td_stat: $('td_stat'),
  fexit: $('fexit'),
  fsw: $('fullswarn'), fsw_txt: $('fsw_txt'),
  acct: $('lbl_acct'),
  fav: $('btn_fav'), favpage: $('page_fav'), favback: $('btn_favback'),
  favrefresh: $('btn_favrefresh'),
  favlist: $('fav_list'),
  prof: $('btn_prof'), profpage: $('page_prof'),
  profback: $('btn_profback'), profref: $('btn_profref'),
  profhint: $('prof_hint'), proflist: $('prof_list'),
  profswitch: $('btn_profswitch'), prof_swlog: $('prof_swlog'),
};

