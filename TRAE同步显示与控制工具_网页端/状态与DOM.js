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
  busy: false, gen: false, ready: false, bench: null,
  bench_mode: 'ins',
  bench_retry_last: false,   /* 2.30：本次是否在尝试「上次目录」（失效则回落根） */
  bench_move_src: '',        /* 2.38：移动模式下的待移动源路径（'' = 无） */
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
  anchorSid: '', anchorTitle: '',
  /* 2.46：后台借框占用（定时自我激活/收件箱提醒到点投递）——服务端广播
     input_busy 置此；busy 期间禁用发送并提示「程序正在借用输入框」。
     inputBusyT 为安全兜底定时器（防服务端中途消失卡死）。 */
  inputBusy: '', inputBusyT: 0,
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
  bench: $('btn_bench'), benchpage: $('page_bench'),
  benchback: $('btn_benchback'), lbl_bench: $('lbl_bench'),
  benchlist: $('bench_list'), bench_up: $('btn_bench_up'),
  benchpull: $('bench_pull'),
  bench_ok: $('btn_bench_ok'), bfoot: $('bfoot'),
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

