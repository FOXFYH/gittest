'use strict';
{
  /* 2.100（老板 2026-10-20 12:16）：刷新/退出再进入后【继续锚定当前会话】——
     先把持久化的锚定恢复到 S（锚点优先级＝当前锚定，绝不套用更旧的、绝不回退
     上一个会话）。恢复后再 boot，snapIdbBoot 见已有锚定便不再自动吸附服务端选中行。 */
  /* 3.02（老板 2026-11-05 23:30）：刷新/重新打开＝【自己切自己】——
     目标是本地持久化的「我想操作的会话」（LS_ANCHOR，唯一一套）。
     首拍快照到达时走与点击会话完全相同的切换流程（见 事件总线.js）。 */
  if (anchorRestore()){ S.anchor_reask = 1; S.bootSwitch = 1; }
  /* 2.174（固态化失效根因修复）：先恢复上次在线时的服务端版本号——
     否则 cacheKeyNow()='VER|0' 与落盘的 'VER|真实srvVer' 必不匹配，
     skel/solid/hist 全部读不出（老板实测「完全没固态化」真凶）。 */
  try { if (typeof srvVerRestore === 'function') srvVerRestore(); } catch(e){}
  /* 2.173（固态化「打开即活」）：骨架渲染【之前】同步恢复六模块最后已知值
     （备注/定时/模型列表/沙盒下拉/登录账号/排队条）——localStorage 同步读，
     零等待；会话列表备注后缀/定时角标随骨架一并上屏。后台对账帧到达后照常
     覆盖，恢复值不拦截任何操作（错后报）。 */
  try { if (typeof solidBoot === 'function') solidBoot(); } catch(e){}
  const sk = skelCacheLoad();
  if (sk && sk.convs && sk.convs.length)
    renderConvs(sk.convs, sk.conv_unread, sk.conv_unread_ids);
  /* 2.174（B5-b 空落盘最小骨架）：无任何落盘时也渲一次空态行——
     「（暂无本地缓存会话）」，不白屏不死等；否则 boot 链路无人调
     renderConvs，列表容器一直空白，连「等待」的说法都没有。 */
  if (!(sk && sk.convs && sk.convs.length))
    try { renderConvs([]); } catch(e){}
  /* 2.98（标准附录A）：首屏/刷新立刻顶出「当前会话」的 IDB 最新存帧，
     替代更旧的账本残行（无存帧则留白，保 2.57B）。 */
  /* 3.01（老板 2026-11-05 23:25）：刷新/刚打开＝切换会话——
     ① 先把全部存帧预读进内存，再 boot（内存命中即 0ms 上屏，绝不白屏）；
     ② 锚定已在上面 anchorRestore 恢复，登录首拍会补发一次 pane_req 索要直播帧。 */
  Promise.resolve()
    /* 2.244（老板令·一套账）：开机先把旧 ledger_conv 一次性并入唯一正文账
       snap_conv 并清表（只跑一次），再按正文账重建真存集/摘要表（vcheck 上报口径不变）。 */
    .then(function(){ try { if (typeof lbHaveLoad === 'function') return lbHaveLoad(); } catch(e){} })
    .then(function(){ return snapIdbPrewarm(); })
    /* 2.319：开机收敛历史重复账本（同一会话只留一本），再 boot 上屏。 */
    .then(function(){ return (typeof snapIdbDedupUid === 'function') ? snapIdbDedupUid() : 0; })
    .catch(function(){})
    .then(function(){ snapIdbBoot(sk); });
}
renderAcct();                            /* 1.27：账号行先显 — */
loadSrvs();                              /* v1.84：先恢复落盘的多电脑名册（离线也显） */
pickCur(); renderSrvList(); renderTop(); /* v1.87：打开即渲染名册 + 直接选中上次那台 */
/* 2.216（0047 第1件）：首帧未到、又没有本地存帧时，先把三步引导铺上（不白屏、不挡输入框）。 */
try { if (typeof guideBoot === 'function') guideBoot(); } catch(e){}
connect();
/* 2.184（老板 2026-11-19 令：一次只在一个频道在线）：原「副集群每 15 分钟探测
   主集群、恢复即自动切回」的启动调用已删——切哪个频道就只连哪个，
   想回主集群手动点「主集群」按钮。 */
