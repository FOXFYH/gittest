'use strict';
{
  /* 2.100（老板 2026-10-20 12:16）：刷新/退出再进入后【继续锚定当前会话】——
     先把持久化的锚定恢复到 S（锚点优先级＝当前锚定，绝不套用更旧的、绝不回退
     上一个会话）。恢复后再 boot，snapIdbBoot 见已有锚定便不再自动吸附服务端选中行。 */
  if (anchorRestore()) S.anchor_reask = 1;   /* 登录后补发一次 switch（继续向服务器提要求） */
  const sk = skelCacheLoad();
  if (sk && sk.convs && sk.convs.length)
    renderConvs(sk.convs, sk.conv_unread, sk.conv_unread_ids);
  /* 2.98（标准附录A）：首屏/刷新立刻顶出「当前会话」的 IDB 最新存帧，
     替代更旧的账本残行（无存帧则留白，保 2.57B）。 */
  /* 3.01（老板 2026-11-05 23:25）：刷新/刚打开＝切换会话——
     ① 先把全部存帧预读进内存，再 boot（内存命中即 0ms 上屏，绝不白屏）；
     ② 锚定已在上面 anchorRestore 恢复，登录首拍会补发一次 pane_req 索要直播帧。 */
  Promise.resolve()
    .then(function(){ return snapIdbPrewarm(); })
    .catch(function(){})
    .then(function(){ snapIdbBoot(sk); });
}
renderAcct();                            /* 1.27：账号行先显 — */
loadSrvs();                              /* v1.84：先恢复落盘的多电脑名册（离线也显） */
pickCur(); renderSrvList(); renderTop(); /* v1.87：打开即渲染名册 + 直接选中上次那台 */
connect();
startProbe();                            /* v1.50：若此前切在副频道，恢复主频道探测 */
