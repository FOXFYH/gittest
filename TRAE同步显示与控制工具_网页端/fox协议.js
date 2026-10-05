'use strict';
const ENC = new TextEncoder(), DEC = new TextDecoder();

function foxSplit(text){          // 按 UTF-8 字节切，回退字节边界保多字节完整
  const raw = ENC.encode(text), out = [];
  let cur = 0;
  while (cur < raw.length){
    let end = Math.min(cur + FOX_MAX, raw.length);
    while (end > cur){
      try { out.push(DEC.decode(raw.slice(cur, end))); break; }
      catch(e){ end--; }
    }
    if (end === cur) out.push('');
    cur = end;
  }
  return out;
}

const FoxIn = {                   // 分段拼装器（300s 残包超时丢弃）
  buf: {},
  feed(msg){
    const m = FOX_RE.exec(msg);
    if (!m) return null;
    const [, ts, rnd, sender, idx, total] = m;
    const body = msg.slice(msg.indexOf('】') + 1);
    if (parseInt(total) <= 1) return [sender, body];
    const mid = ts + rnd, t = Date.now();
    const d = this.buf[mid] || (this.buf[mid] =
      {n: parseInt(total), p: {}, at: t});
    d.p[parseInt(idx)] = body;
    d.at = t;
    if (Object.keys(d.p).length < d.n){
      for (const k in this.buf)
        if (t - this.buf[k].at > 300000) delete this.buf[k];
      return null;
    }
    let full = '';
    for (let i = 1; i <= d.n; i++) full += (d.p[i] || '');
    delete this.buf[mid];
    return [sender, full];
  }
};

function rnd8(){
  let s = '';
  const a = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 8; i++) s += a[Math.random()*26|0];
  return s;
}
function pad3(n){ return String(n).padStart(3, '0'); }

async function foxSend(text){      // 分段发送（多段微间隔 30ms 防中继丢弃）
  if (!ws || ws.readyState !== 1) return;    /* 未连接不发（onopen/helloWatch 兜底） */
  const parts = foxSplit(text);
  const ts = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  const mid = ts + rnd8();
  for (let i = 1; i <= parts.length; i++){
    const s = '【FOXID:' + mid + MY_ID + '=cut(' + pad3(i) + '/'
              + pad3(parts.length) + ')】' + parts[i-1];
    ws.send(s);
    statsAdd(0, s.length, 0, 1);
    if (parts.length > 1) await new Promise(r => setTimeout(r, 30));
  }
}
function sendJson(d){
  /* 1.12：报文自动定向到当前操控的服务端（多服务端同频道）
     2.11 纯 ID 双寻址·设备层：优先用名册里的稳定 sid（s.sid=服务端
     srv_id，改名不影响）；名册没 sid（旧服务端）才回落电脑名。此前
     只发电脑名，机器一改名就投错/全丢。 */
  if (S.cur && !d.to){
    const s = S.servers[S.cur];
    d.to = (s && s.sid) ? s.sid : S.cur;
  }
  foxSend(JSON.stringify(d));
}
/* 1.88：10 位随机数字对话 ID——客户端发出的发送/插话自带一个
   仅用于小卡片核对（消卡回执）的随机 ID，随协议字段 did 发送，
   绝不拼进正文文本、不污染对话。 */
function newDid(){
  return String(Math.floor(Math.random() * 1e10)).padStart(10, '0');
}
function sendCmd(c, a, did, convSid){
  /* 2.17：发送/插话统一改走「会话路由器」——带着目标会话稳定 sid 自动
     找上门，到点才临时占用 TRAE 输入框发一条、发完立刻走人（不再长期
     霸占输入框）。正文 + 目标 sid + 模式都放进 arg；服务端
     _cmd_route_send 把整段路由事务（切会话→核验→取回残留→写入→回读→
     发送）作为【一条 cmdq 命令】串行执行，段内插不进任何人。
     2.11/2.16：外部传入锁定 sid（重发）就用它、绝不现取 curSid()。
     旧服务端忽略多余字段（无 route_send 时退回原 send/interject）。 */
  if (c === 'send' || c === 'interject'){
    const sid = convSid || curSid() || '';
    /* 2.18：附带网页版【锚定】的 sid——服务端路由若临时把桌面挪去别处
       发消息，结束时按"网页版为尊"归还到锚定会话（见 会话路由器.anchor）。 */
    const d = {t:'cmd', c:'route_send',
               a:{sid: sid, text: a, mode: (c === 'interject'
                                            ? 'interject' : 'auto'),
                  anchor: S.anchorSid || ''}};
    if (did) d.did = did;   /* 1.88：did 仅用于消卡回执 */
    sendJson(d);
    return;
  }
  const d = {t:'cmd', c:c, a:a};
  if (did) d.did = did;
  sendJson(d);
}

/* ================= 状态 ================= */

