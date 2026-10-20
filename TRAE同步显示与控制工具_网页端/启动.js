'use strict';
{
  const sk = skelCacheLoad();
  if (sk && sk.convs && sk.convs.length)
    renderConvs(sk.convs, sk.conv_unread, sk.conv_unread_ids);
  /* 2.98（标准附录A）：首屏/刷新立刻顶出「当前会话」的 IDB 最新存帧，
     替代更旧的账本残行（无存帧则留白，保 2.57B）。 */
  snapIdbBoot(sk);
}
renderAcct();                            /* 1.27：账号行先显 — */
loadSrvs();                              /* v1.84：先恢复落盘的多电脑名册（离线也显） */
pickCur(); renderSrvList(); renderTop(); /* v1.87：打开即渲染名册 + 直接选中上次那台 */
connect();
startProbe();                            /* v1.50：若此前切在副频道，恢复主频道探测 */
