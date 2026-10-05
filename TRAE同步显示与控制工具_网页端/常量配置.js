'use strict';
let MY_ID = localStorage.getItem('trae_webm_uid');
if (!MY_ID || !/^4\d{9}$/.test(MY_ID)){
  MY_ID = '4' + String(Math.floor(100000000 + Math.random() * 900000000));
  try { localStorage.setItem('trae_webm_uid', MY_ID); } catch(e){}
}
const SERVER_ID= '1000000001';
/* v1.27：频道名 = 密码（只有服务端知道），本端绝不硬编码——
 * 首次使用弹窗输入（localStorage 持久），网络页可改。 */
const WS_URL_TMPL = ('wss://free.blr2.piesocket.com/v3/%s'
                     + '?api_key=ReDFavhh0qnOCKUUjQiLKVZ9RdxA6e4BGVKxxNug');
/* v1.50：副频道（WS2，新集群 s20307.nyc1）——备用兜底/翻倍流量配额。
 * 与服务端一致：副频道走独立模板，但频道名沿用主频道同名 */
const WS_URL_TMPL2 = ('wss://s20307.nyc1.piesocket.com/v3/%s'
                      + '?api_key=IWkfk43ha3yilmYGRGLDeAoVW9tu6QqiSviJmudL');
const KA_SEC = 25;      // WS 链路心跳间隔（秒，保活）
const RECONNECT = 3;    // 断线重连间隔（秒）
/* 1.59：状态灯判活阈值 —— 原来硬编码 16s，手机端太敏感：
   切后台、中继抖一下、或服务端某轮广播没到，就立刻喊「服务器未启动」，
   而电脑上其实一切正常。改成两级：
     20s 无消息  → 「同步暂停中…」（灰、中性，不吓人）
     60s 仍无消息 → 「服务器无响应」（橙，才值得看一眼电脑） */
const SRV_IDLE_MS = 20000;
const SRV_DEAD_MS = 60000;
/* v1.32：客户端登录态节流参数 */
const HB_SEC = 60;              // 登录心跳间隔（秒）——服务端 150s 无心跳判下线
const IDLE_MS = 5 * 60 * 1000;  // 超过 5 分钟无任何操作 → 视为退出登录
/* 1.61：连续 N 次「连都没连上就断」→ 判定为中继服务不可用（比如服务商挂了、
   断网），顶栏换成更直白的「连不上服务器」，不再只是「连接已断开」。 */
const FAIL_ALERT = 3;
const SRV_TTL = 7 * 24 * 60 * 60 * 1000;   // v1.84：多电脑名册保留期（超 7 天未出现即清）
const FOX_HDR = 57;     // 协议头固定字节数
const FOX_MAX = 10 * 1024 - FOX_HDR;   // 单段正文上限（UTF-8 字节）
const FOX_RE = /^【FOXID:(\d{14})([a-z]{8})(\d{10})=cut\((\d{3})\/(\d{3})\)】/;

/* ================= 配置 / 流量统计（localStorage，按本文件独立） ================= */

const LS_CFG = 'trae_webm_cfg', LS_NET = 'trae_webm_net',
      LS_TM = 'trae_webm_times', LS_SRV = 'trae_webm_srv',
      LS_SRVS = 'trae_webm_srvs',     /* v1.84：多电脑名册落盘（name→最后出现毫秒） */
      LS_CH = 'trae_webm_channel',
      /* v1.50：副频道名 + 当前选中频道（main/backup，本地落盘、不固化） */
      LS_CH2 = 'trae_webm_channel2', LS_SEL = 'trae_webm_selct';

function cfgGet(){
  try { return JSON.parse(localStorage.getItem(LS_CFG)) || {}; }
  catch(e){ return {}; }
}
function cfgSave(){ localStorage.setItem(LS_CFG, JSON.stringify(CFG)); }
let CFG = cfgGet();
if (!CFG.stats_keep) CFG.stats_keep = 10;
/* 2.02：语音播报音色/语速（设置页「语音播报」可改）。默认女声晓晓——
   用户 2026-09-30 明确不喜欢原先写死的男声云希（zh-CN-YunxiNeural）。 */
if (!CFG.tts_voice) CFG.tts_voice = 'zh-CN-XiaoxiaoNeural';
if (!CFG.tts_rate)  CFG.tts_rate  = '+0%';
function ttsVoice(){ return CFG.tts_voice || 'zh-CN-XiaoxiaoNeural'; }
function ttsRate(){ return CFG.tts_rate || '+0%'; }
function ttsClearCache(){
  /* 换了音色/语速后，旧的缓存音频（按文本存）必须作废，否则重播还是旧嗓子 */
  try { Object.keys(_tts_state).forEach(k => { _tts_state[k].url = null; }); } catch(e){}
}
/* v1.27：频道名存独立键（旧 CFG.ws_url 含旧公开频道，直接作废） */
try { if (CFG.ws_url) delete CFG.ws_url; } catch(e){}
function curSel(){
  /* 当前选中频道：'main' 主频道（默认）/ 'backup' 副频道。本地落盘，不固化。 */
  try { return (localStorage.getItem(LS_SEL) === 'backup') ? 'backup' : 'main'; }
  catch(e){ return 'main'; }
}
function chanGet(sel){
  /* sel: 'main'|'backup'；缺省用当前选中。副频道名未单独设置时沿用主频道名。 */
  const s = sel || curSel();
  const key = (s === 'backup') ? LS_CH2 : LS_CH;
  let v;
  try { v = (localStorage.getItem(key) || '').trim(); } catch(e){ v = ''; }
  if (!v && s === 'backup'){
    try { v = (localStorage.getItem(LS_CH) || '').trim(); } catch(e){ v = ''; }
  }
  return v;
}
function chanSet(ch, sel){
  const s = sel || curSel();
  const key = (s === 'backup') ? LS_CH2 : LS_CH;
  try { localStorage.setItem(key, ch); } catch(e){}
}
function wsUrlOf(ch, sel){
  const s = sel || curSel();
  const tmpl = (s === 'backup') ? WS_URL_TMPL2 : WS_URL_TMPL;
  /* 不做 URL 编码：'@' 在路径段合法，且须与服务端裸字串完全一致，
     两端才能进同一频道 */
  return tmpl.replace('%s', ch);
}

const NET = (function(){
  let d = {};
  try { d = (JSON.parse(localStorage.getItem(LS_NET)) || {}).days || {}; }
  catch(e){ d = {}; }
  return {days: d};
})();
function netDay(){ return new Date().toLocaleDateString('sv'); }  // YYYY-MM-DD
function statsAdd(rx, tx, rxn, txn){      // 字节 + 条数（对齐服务端 v1.04）
  const b = NET.days[netDay()]
    || (NET.days[netDay()] = {rx:0, tx:0, rxn:0, txn:0});
  if (rx) b.rx += rx;
  if (tx) b.tx += tx;
  if (rxn) b.rxn = (b.rxn || 0) + rxn;
  if (txn) b.txn = (b.txn || 0) + txn;
}
function statsFlush(){
  const keep = Math.max(1, parseInt(CFG.stats_keep) || 10);
  const ks = Object.keys(NET.days).sort();
  if (ks.length > keep)
    ks.slice(0, ks.length - keep).forEach(k => delete NET.days[k]);
  localStorage.setItem(LS_NET, JSON.stringify(NET));
}
function fmtBytes(n){
  n = n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n/1048576).toFixed(2) + ' MB';
  return (n/1073741824).toFixed(2) + ' GB';
}

/* ================= FOX 分段协议 ================= */

