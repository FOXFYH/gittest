'use strict';
{
  const sk = skelCacheLoad();
  if (sk && sk.convs && sk.convs.length)
    renderConvs(sk.convs, sk.conv_unread, sk.conv_unread_ids);
}
renderAcct();                            /* 1.27：账号行先显 — */
loadSrvs();                              /* v1.84：先恢复落盘的多电脑名册（离线也显） */
pickCur(); renderSrvList(); renderTop(); /* v1.87：打开即渲染名册 + 直接选中上次那台 */
connect();
startProbe();                            /* v1.50：若此前切在副频道，恢复主频道探测 */
