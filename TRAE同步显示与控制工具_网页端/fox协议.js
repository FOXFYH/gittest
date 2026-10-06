'use strict';
const ENC = new TextEncoder(), DEC = new TextDecoder();
/* 2.50：切片回退探测必须用 fatal 解码器——默认 TextDecoder 遇残缺多字节
   序列不抛错（产出 U+FFFD），try/catch 永不触发，切点落在字符中间会被
   切成乱码、交付内容与原文不符。DEC 仍用于已知完整的字节拼装。 */
const DECF = new TextDecoder('utf-8', {fatal: true});

function foxSplit(text){          // 按 UTF-8 字节切，回退字节边界保多字节完整
  const raw = ENC.encode(text), out = [];
  let cur = 0;
  while (cur < raw.length){
    let end = Math.min(cur + FOX_MAX, raw.length);
    while (end > cur){
      try { out.push(DECF.decode(raw.slice(cur, end))); break; }
      catch(e){ end--; }
    }
    if (end === cur) out.push('');
    cur = end;
  }
  return out;
}

function foxSendRaw(frame){      // 唯一的「写上线」出口（未连接不发）
  if (!ws || ws.readyState !== 1) return false;
  ws.send(frame);
  statsAdd(0, frame.length, 0, 1);
  return true;
}
function pad3(n){ return String(n).padStart(3, '0'); }
function pad6(n){ return String(n).padStart(6, '0'); }
function rnd8(){
  let s = '';
  const a = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < 8; i++) s += a[Math.random()*26|0];
  return s;
}
function foxNewMid(){
  const ts = new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14);
  return ts + rnd8();
}
function foxSliceBytes(raw, cap){  // v2.1 原语：可切成 ≤cap 的字节片（回退边界）
  const out = [];
  let cur = 0;
  while (cur < raw.length){
    let end = Math.min(cur + cap, raw.length);
    while (end > cur){
      try { DECF.decode(raw.slice(cur, end)); break; }
      catch(e){ end--; }
    }
    if (end === cur) end = cur + 1;
    out.push(raw.slice(cur, end));
    cur = end;
  }
  return out;
}

/* ───── FOX v2.1 接收侧：拼装 + 批次报告 + 补发写回 + 60s 空闲硬超时 ───── */
const FoxIn = {
  buf: {},
  feed(msg){                       // 返回 [sender, body]（单段/拼齐）或 null
    const m = FOX_RE.exec(msg);
    if (!m) return null;
    const [, ts, rnd, sender, idxS, totalS] = m;
    const idx = parseInt(idxS), total = parseInt(totalS);
    const seg = ENC.encode(msg.slice(msg.indexOf('】') + 1));
    if (total <= 1) return [sender, DEC.decode(seg)];
    if (sender === MY_ID) return null;   /* 自己的回声：不建缓冲、不回报 */
    const mid = ts + rnd;
    const d = this.buf[mid] || (this.buf[mid]
      = {total: total, sender: sender, segs: {}, timer: null});
    d.segs[idx] = {len: seg.length, pieces: {0: seg}};
    this._arm(mid);
    const body = this._tryDeliver(mid);
    const batch = Math.floor((idx - 1) / FOX_BATCH_SIZE) + 1;
    if (idx === Math.min(batch * FOX_BATCH_SIZE, total))
      this.reportBatch(mid, batch, total);   /* 收齐也回报：d 已删→miss 空 */
    return body !== null ? [sender, body] : null;
  },
  feedCtrl(msg){                   // 控制帧分流（绝不进正文流）；返回 true=已消费
    if (msg.startsWith('【FOXACK:')){ FoxOut.onAck(msg); return true; }
    if (msg.startsWith('【FOXQRY:')){
      const m = FOX_QRY_RE.exec(msg);
      if (m) this.reportBatch(m[1], parseInt(m[2]), null);
      return true;
    }
    if (msg.startsWith('【FOXRSN:')) return this.onRsn(msg);  /* 可能即刻交付 */
    if (msg.startsWith('【FOXFAIL:')){
      const m = FOX_FAIL_RE.exec(msg);
      if (m) this.giveUp(m[1], '对端已放弃');
      return true;
    }
    return false;
  },
  segBytes(seg){                   // 按偏移拼段；允许重叠（先到铺底、后到只补末尾）
    if (!seg) return null;
    const ks = Object.keys(seg.pieces).map(Number).sort((a, b) => a - b);
    let out = new Uint8Array(0);
    for (const k of ks){
      let b = seg.pieces[k];
      if (k > out.length) return null;
      if (k < out.length) b = b.subarray(out.length - k);
      const nx = new Uint8Array(out.length + b.length);
      nx.set(out, 0); nx.set(b, out.length);
      out = nx;
    }
    return out.length < seg.len ? null : out.subarray(0, seg.len);
  },
  _tryDeliver(mid){
    const d = this.buf[mid];
    if (!d) return null;
    const chunks = [];
    for (let i = 1; i <= d.total; i++){
      const b = this.segBytes(d.segs[i]);
      if (b === null) return null;
      chunks.push(b);
    }
    if (d.timer) clearTimeout(d.timer);
    delete this.buf[mid];
    let n = 0; chunks.forEach(c => n += c.length);
    const all = new Uint8Array(n); let off = 0;
    chunks.forEach(c => { all.set(c, off); off += c.length; });
    return DEC.decode(all);
  },
  _missing(d, lo, hi){
    const out = [];
    for (let i = lo; i <= hi; i++)
      if (this.segBytes(d.segs[i]) === null) out.push(i);
    return out;
  },
  _arm(mid){                       // 空闲硬超时：久无新片即终局，防缓冲泄漏
    const d = this.buf[mid];
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    d.timer = setTimeout(() => this.giveUp(mid, '接收超时'),
                         FOX_FAIL_DEADLINE * 1000);
  },
  giveUp(mid, tag){
    const d = this.buf[mid];
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    const got = d.total - this._missing(d, 1, d.total).length;
    delete this.buf[mid];
    try { console.warn('[FOX] 长消息接收失败：ID=' + mid + '（' + tag
                       + '，收到 ' + got + '/' + d.total + ' 段）'); } catch(e){}
  },
  reportBatch(mid, batch, total){  // 主动回报某批接收情况（miss 空 = 本批收齐）
    const d = this.buf[mid];
    if (total === null || total === undefined)
      total = d ? d.total : batch * FOX_BATCH_SIZE;
    const lo = (batch - 1) * FOX_BATCH_SIZE + 1;
    const hi = Math.min(batch * FOX_BATCH_SIZE, total);
    const miss = d ? this._missing(d, lo, hi) : [];
    foxSendRaw('【FOXACK:' + mid + '=batch(' + pad3(batch) + '):range('
      + pad3(lo) + '-' + pad3(hi) + '):miss(' + miss.map(pad3).join(',') + ')】');
  },
  onRsn(msg){                      // 补发片：按偏移写回原段；补齐即回报
    const m = FOX_RSN_RE.exec(msg);
    if (!m) return;
    const mid = m[1], segIdx = parseInt(m[3]), segLen = parseInt(m[4]),
          off = parseInt(m[7]);
    const payload = ENC.encode(msg.slice(msg.indexOf('】') + 1));
    const d = this.buf[mid];
    if (!d) return;                /* 已交付/已终局，忽略迟到的补发 */
    let seg = d.segs[segIdx];
    if (!seg){ seg = d.segs[segIdx] = {len: segLen, pieces: {}}; }
    seg.len = segLen;
    seg.pieces[off] = payload;
    this._arm(mid);
    const body = this._tryDeliver(mid);
    const d2 = this.buf[mid];
    const total = d2 ? d2.total : d.total;
    const batch = Math.floor((segIdx - 1) / FOX_BATCH_SIZE) + 1;
    const lo = (batch - 1) * FOX_BATCH_SIZE + 1;
    const hi = Math.min(batch * FOX_BATCH_SIZE, total);
    const miss = d2 ? this._missing(d2, lo, hi) : [];
    if (!miss.length) this.reportBatch(mid, batch, total);
    return body !== null ? [d.sender, body] : null;
  }
};

/* ───── FOX v2.1 发送侧：分批结算 + 留底(LRU) + 催问 + 降级补发 + FAIL ───── */
const FoxOut = {
  sent: {},                        // mid -> {segments:[Uint8Array], ts}
  batches: {},                     // mid -> {batch,lo,hi,qry,repair,timer,done}
  send(text){
    if (!ws || ws.readyState !== 1) return;   /* 未连接不发 */
    const segs = foxSliceBytes(ENC.encode(text), FOX_MAX);
    if (segs.length <= 1){
      foxSendRaw('【FOXID:' + foxNewMid() + MY_ID + '=cut(001/001)】' + text);
      return;
    }
    const mid = foxNewMid();
    this.sent[mid] = {segments: segs, ts: Date.now()};
    const ks = Object.keys(this.sent);
    if (ks.length > FOX_SENT_KEEP){            // LRU 兜底，防无限留底
      ks.sort((a, b) => this.sent[a].ts - this.sent[b].ts);
      while (ks.length > FOX_SENT_KEEP) delete this.sent[ks.shift()];
    }
    this.sendBatch(mid, 1);
  },
  async sendBatch(mid, batch){
    const buf = this.sent[mid];
    if (!buf) return;
    const total = buf.segments.length;
    const lo = (batch - 1) * FOX_BATCH_SIZE + 1;
    const hi = Math.min(batch * FOX_BATCH_SIZE, total);
    /* 铁律：先登记批次状态、再逐段发送——接收方在本批末段到达时同步回送
       报告；登记晚于发送会把该报告当未知批次丢弃、多批传输卡死在第 1 批。 */
    const st = {batch: batch, lo: lo, hi: hi, qry: 0, repair: 0,
                timer: null, done: false};
    this.batches[mid] = st;
    this._armBatch(mid);
    for (let idx = lo; idx <= hi; idx++){
      foxSendRaw('【FOXID:' + mid + MY_ID + '=cut(' + pad3(idx) + '/'
        + pad3(total) + ')】' + DEC.decode(buf.segments[idx - 1]));
      if (idx < hi) await new Promise(r => setTimeout(r, 200));   /* ≥0.2s */
    }
  },
  _armBatch(mid){
    const st = this.batches[mid];
    if (!st) return;
    if (st.timer) clearTimeout(st.timer);
    st.timer = setTimeout(() => this._onTick(mid), FOX_BATCH_TIMEOUT_MS);
  },
  _onTick(mid){                    // 等报告超时：先催问 1 次，仍无 → FAIL
    const st = this.batches[mid];
    if (!st) return;
    if (st.qry < FOX_BATCH_QRY_MAX){
      st.qry++;
      foxSendRaw('【FOXQRY:' + mid + '=batch(' + pad3(st.batch) + '):range('
        + pad3(st.lo) + '-' + pad3(st.hi) + ')】');
      this._armBatch(mid);
      return;
    }
    this._fail(mid, []);
    this._clear(mid);
  },
  onAck(msg){                      // 批次报告：无缺→下一批/收工；有缺→降级补发
    const m = FOX_ACK_RE.exec(msg);
    if (!m) return;
    const mid = m[1], batch = parseInt(m[2]);
    const miss = m[5].split(',').filter(x => x.trim()).map(x => parseInt(x));
    const st = this.batches[mid], buf = this.sent[mid];
    if (!st || !buf || st.batch !== batch || st.done) return;   /* 过期/重复 */
    if (st.timer){ clearTimeout(st.timer); st.timer = null; }
    const total = buf.segments.length;
    if (!miss.length){
      st.done = true;
      if (st.hi >= total) this._clear(mid);
      else this.sendBatch(mid, batch + 1);
      return;
    }
    st.repair++;
    const size = FOX_DOWNGRADE[st.repair];
    if (size === undefined){ this._fail(mid, miss); this._clear(mid); return; }
    this._resend(mid, miss, size, st.repair);
    st.qry = 0;                    /* 换新一轮，催问计数归零 */
    this._armBatch(mid);
  },
  async _resend(mid, miss, size, rnd){   // 缺段按尺寸重切重发（RSN）
    const buf = this.sent[mid];
    if (!buf) return;
    const cap = size - FOX_RSN_HDR;
    for (const segIdx of miss){
      const seg = buf.segments[segIdx - 1];
      if (!seg) continue;
      const pieces = foxSliceBytes(seg, cap);
      let off = 0;
      for (let pi = 1; pi <= pieces.length; pi++){
        foxSendRaw('【FOXRSN:' + mid + '=r' + String(rnd).padStart(2, '0')
          + ':seg(' + pad3(segIdx) + '):len(' + pad6(seg.length)
          + '):cut(' + pad3(pi) + '/' + pad3(pieces.length) + ')@'
          + pad6(off) + '】' + DEC.decode(pieces[pi - 1]));
        off += pieces[pi - 1].length;
        if (pi < pieces.length) await new Promise(r => setTimeout(r, 200));
      }
    }
  },
  _fail(mid, miss){
    foxSendRaw('【FOXFAIL:' + mid + '=gave_up:miss('
      + miss.map(pad3).join(',') + ')】');
  },
  _clear(mid){
    const st = this.batches[mid];
    if (st && st.timer) clearTimeout(st.timer);
    delete this.batches[mid];
    delete this.sent[mid];
  }
};

function foxSend(text){            // 对外统一入口（单段直发 / 多段分批结算）
  FoxOut.send(text);
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

