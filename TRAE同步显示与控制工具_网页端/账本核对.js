'use strict';
 /* 账本核对.js（网页端）  版本 1.077  日期 2026-11-26 */
const LS_LBVER = 'trae_webm_lbver';          /* 版本底账落盘（按服务端隔离） */
let LB = {reqSeq: 0, timerAt: 0, push: 0, checking: false, mods: {},
          lastTimerSig: '',
          frozen: false, frozenT: null,
          lbHave: new Set(),                 /* V2 验收 Y11：本地【真存】会话集合——ledger 上报只认它，收帧记下的版本不算存 */
          lbSum: {},                         /* 改4（规范§七 :194）：本地账本摘要表——键＝终身号，
                                                值＝{rounds, codes:[{mid, fin, hash}]}，put 成功后才记；
                                                vcheck 按它上报编码集合＋完成态＋正文指纹 */
          rows: {},                          /* 屏幕唯一正文源（只认小账本）——
                                                键＝服务器|终身号（名称作兜底别名），值＝账本 rounds */
          chkUntil: 0};                      /* 圆球指示窗截止时刻（四契机通用，10s） */
function _lbRowsKey(uid, title){
  /* 只用「终身号｜会话名」做键（不带服务器标签）：开机时服务器名可能还没到，
     带标签会导致账本装进去却查不到。单服务器日常使用下不存在串服问题。 */
  return '|' + (String(uid || '').trim() || String(title || '').trim());
}
let _lbRepaintT = null, _lbRepaintAt = 0;
function lbRepaint(delay){
  try{
    if (typeof renderAll !== 'function') return;
    const d = (delay == null) ? 250 : delay;
    if (d <= 0){
      _lbRepaintAt = Date.now();
      renderAll();
      return;
    }
    if (_lbRepaintT) return;
    _lbRepaintT = setTimeout(() => {
      _lbRepaintT = null;
      _lbRepaintAt = Date.now();
      try { renderAll(); } catch(e){}
    }, d);
  }catch(e){}
}
function lbRowsPut(uid, title, rounds, full){
  try{
    if (!Array.isArray(rounds) || !rounds.length) return;
    const u = String(uid || '').trim(), t = String(title || '').trim();
    const _hasAI = arr => (arr || []).some(r => Array.isArray(r)
      && r.some(m => Array.isArray(m) && String(m[0] || '') !== 'u'));
    const _secOf = id => {
      const v = parseInt(String(id || '').slice(0, 8), 16);
      return isNaN(v) ? 0 : v;
    };
    const _roundSec = r => {
      let mx = 0;
      (r || []).forEach(m => {
        if (!Array.isArray(m)) return;
        const s = _secOf(m[6]);
        if (s > mx) mx = s;
      });
      return mx;
    };
    const put = k => {
      const old = LB.rows[k];
      if (!_hasAI(rounds) && Array.isArray(old) && old.length && _hasAI(old)){
        try { diagLog('账本拒覆盖|键=' + k + '|新帧无AI|旧轮=' + old.length, 'warn'); } catch(e){}
        return;
      }
      let rounds2 = rounds;
      try{
        if (Array.isArray(old) && old.length){
          const _oldByU = {};
          old.forEach(r => {
            const rr = Array.isArray(r) ? r : [];
            const h = rr.find(m => Array.isArray(m) && String(m[0]) === 'u');
            const hk = h && String(h[6] || '');
            if (hk) _oldByU[hk] = rr;
          });
          rounds2 = rounds.map(r => {
            const rr = Array.isArray(r) ? r : [];
            const h = rr.find(m => Array.isArray(m) && String(m[0]) === 'u');
            const hk = h && String(h[6] || '');
            const oldR = hk && _oldByU[hk];
            if (!oldR) return r;
            const _newAI = rr.some(m => Array.isArray(m) && String(m[0]) !== 'u');
            const _oldAI = oldR.some(m => Array.isArray(m) && String(m[0]) !== 'u');
            return (!_newAI && _oldAI) ? oldR : r;
          });
        }
      }catch(e){ rounds2 = rounds; }
      let merged = rounds2;
      if (lbMirrorMode() && !full && Array.isArray(old) && old.length){
        const _uk = rr => {
          let h = '';
          (rr || []).forEach(m => {
            if (Array.isArray(m) && String(m[0]) === 'u' && m[6]) h = String(m[6]);
          });
          return h;
        };
        const _rk = rr => {
          let d = '';
          (rr || []).forEach(m => {
            if (Array.isArray(m) && m[6]){
              const s = String(m[6]);
              if (!d || s < d) d = s;
            }
          });
          return d;
        };
        const _newKeys = new Set(rounds2.map(_uk).filter(Boolean));
        const _incr = old.filter(r => {
          const h = _uk(r);
          return !(h && _newKeys.has(h));
        }).map(r => r);
        rounds2.forEach(r => _incr.push(r));
        _incr.sort((a, b) => {
          const da = _rk(a), db = _rk(b);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return da < db ? -1 : (da > db ? 1 : 0);
        });
        LB.rows[k] = _incr;
        try { diagLog('镜像增量合并|键=' + k + '|旧轮=' + old.length
          + '|新轮=' + rounds2.length + '|合=' + _incr.length, 'ok'); } catch(e){}
        return;
      }
      if (!lbMirrorMode() && Array.isArray(old) && old.length){
        const inNew = new Set();
        rounds2.forEach(r => (r || []).forEach(m => {
          if (Array.isArray(m) && m[6]) inNew.add(String(m[6]));
        }));
        const top = _roundSec(rounds2);
        const tail = [];
        old.forEach(r => {
          const rs2 = Array.isArray(r) ? r : [];
          const ids = rs2.filter(m => Array.isArray(m) && m[6]).map(m => String(m[6]));
          if (ids.length && ids.some(id => inNew.has(id))) return;   /* 新帧已有 ⇒ 听新帧 */
          const mx = _roundSec(rs2);
          const noId = !ids.length;
          if (!noId && mx < top) return;      /* 比新帧最新还旧 ⇒ 正常淘汰 */
          tail.push(r);
        });
        if (tail.length){
          tail.sort((a, b) => _roundSec(a) - _roundSec(b));
          while (tail.length > 6) tail.shift();
          merged = rounds2.concat(tail);
          try { diagLog('账本保留更新行|键=' + k + '|保留轮=' + tail.length
            + '|新帧轮=' + rounds2.length, 'warn'); } catch(e){}
        }
      }
      LB.rows[k] = merged;
    };
    if (u) put(_lbRowsKey(u, ''));
    if (t) put(_lbRowsKey('', t));
    if (typeof lbRepaint === 'function') lbRepaint();
  }catch(e){}
}
function lbScreenMsgs(sid, title){
  try{
    const t = String(title || '').trim();
    const u = (typeof lbUidPick === 'function')
      ? String(lbUidPick(null, sid, t) || '') : '';
    const keys = [];
    if (u) keys.push(_lbRowsKey(u, ''));
    if (t) keys.push(_lbRowsKey('', t));
    const groups = [];
    let _fr = null;                  /* 镜像分支在 try 外也要用，声明提到外面 */
    try{
      const _tag = (typeof lbSrvTag === 'function') ? String(lbSrvTag() || '') : '';
      if (typeof _frameMem !== 'undefined'){
        const _mk = (typeof snapKeyOf === 'function') ? snapKeyOf(sid, t)
          : ((typeof _frameMemKey === 'function') ? _frameMemKey(sid) : '');
        if (_mk && _frameMem[_mk]) _fr = _frameMem[_mk];
        if (!_fr && sid && typeof _frameMemKey === 'function'
            && _frameMemKey(sid) !== _mk && _frameMem[_frameMemKey(sid)])
          _fr = _frameMem[_frameMemKey(sid)];
        if (!_fr && t && typeof _frameTitleKey === 'function'){
          const _tk = _frameTitleKey(t);
          if (_tk && _frameMemByTitle && _frameMemByTitle[_tk]) _fr = _frameMemByTitle[_tk];
        }
      }
      if (_fr && Array.isArray(_fr.msgs) && _fr.msgs.length){
        const _fs = String(_fr._srv || '');
        try{
          const _fsid = String(_fr._sid || '');
          if (_fsid){
            let _same = (_fsid === String(sid || ''));
            if (!_same && typeof 稳定键 === 'function')
              _same = (String(稳定键(_fsid, '') || '')
                       === String(稳定键(String(sid || ''), '') || ''));
            if (!_same) _fr = null;
            /* 有 sid 时**不再比 title**：存帧的 title 常是内部会话名（如 '0047'），
               而这里 t 是显示名（如 'WB+TR整改专员 ST'），比 title 会误杀本会话帧
               （2.327 实测：0047 存帧被整份丢掉，AI 行又不见）。 */
          } else {
            const _ftitle = String(_fr._title || '');
            if (_ftitle && t && _ftitle !== t) _fr = null;
          }
        }catch(e){}
        if (_fr && !(_tag && _fs && _tag !== _fs)){
          const _rows = [];
          _fr.msgs.forEach(m => {
            const k = (typeof _lbKeepRow === 'function') ? _lbKeepRow(m) : m;
            if (k) _rows.push([k]);
          });
          if (_rows.length) groups.push(_rows);
        }
      }
    }catch(e){}
    if (lbMirrorMode()){
      let _tag2 = '';
      try { _tag2 = (typeof lbSrvTag === 'function') ? String(lbSrvTag() || '') : ''; } catch(e){ _tag2 = ''; }
      const _fs2 = String((_fr && _fr._srv) || '');
      if (_fr && Array.isArray(_fr.msgs) && _fr.msgs.length
          && !(_tag2 && _fs2 && _tag2 !== _fs2)){
        const _m3 = [];
        _fr.msgs.forEach(m => {
          if (!Array.isArray(m)) return;
          const k = (typeof _lbMirrorKeepRow === 'function')
            ? _lbMirrorKeepRow(m) : m;
          if (k) _m3.push(k.slice());
        });
        if (_m3.length){
          let _led9 = [], _ledN = 0;
          try{
            const _kU9 = u ? _lbRowsKey(u, '') : '';
            const _kT9 = t ? _lbRowsKey('', t) : '';
            if (_kU9 && Array.isArray(LB.rows[_kU9]) && LB.rows[_kU9].length) _led9 = LB.rows[_kU9];
            else if (_kT9 && Array.isArray(LB.rows[_kT9])) _led9 = LB.rows[_kT9];
            (_led9 || []).forEach(r => { _ledN += (r || []).length; });
          }catch(e){ _led9 = []; _ledN = 0; }
          try{
            let _fmMin = '', _fmMax = '';
            const _have9 = {};
            _m3.forEach(m => {
              const d = String(m[6] || '');
              if (!d) return;
              _have9[d] = 1;
              if (!_fmMin || d < _fmMin) _fmMin = d;
              if (!_fmMax || d > _fmMax) _fmMax = d;
            });
            if (_fmMin){
              const _extra9 = [];
              (_led9 || []).forEach(r => (r || []).forEach(m => {
                if (!Array.isArray(m)) return;
                const d = String(m[6] || '');
                if (!d || _have9[d]) return;
                if (d >= _fmMin){ _have9[d] = 1; _extra9.push(m.slice()); }
              }));
              if (_extra9.length){
                _extra9.forEach(m => _m3.push(m));
                _m3.sort((a, b) => {
                  const x = String(a[6] || ''), y = String(b[6] || '');
                  if (!x && !y) return 0;
                  if (!x) return 1;
                  if (!y) return -1;
                  return x < y ? -1 : (x > y ? 1 : 0);
                });
              }
            }
          }catch(e){}
          if (_ledN >= 3 && _m3.length > _ledN) return _m3.slice(-_ledN);
          return _m3;
        }
      }
      /* 没存帧（刚开机/还没收到模块 3）→ 退回账本里的一份，绝不留白。 */
      const _kU = u ? _lbRowsKey(u, '') : '';
      const _kT = t ? _lbRowsKey('', t) : '';
      let _src = [];
      if (_kU && Array.isArray(LB.rows[_kU]) && LB.rows[_kU].length) _src = LB.rows[_kU];
      else if (_kT && Array.isArray(LB.rows[_kT])) _src = LB.rows[_kT];
      const _out = [], _seen = {};
      _src.forEach(r => (r || []).forEach(m => {
        if (!Array.isArray(m)) return;
        const mk = _msgKey(m);
        if (_seen[mk]) return;
        _seen[mk] = 1; _out.push(m.slice());
      }));
      return _out;
    }
    /* 账本帧（LB.rows）放后面并：同一 mid 以账本（服务端定稿）为准，存帧只补账本没有的轮。 */
    for (const k of keys){
      const rs = LB.rows[k];
      if (Array.isArray(rs) && rs.length) groups.push(rs);
    }
    const out = [], at = {};
    for (const rs of groups){
      if (!Array.isArray(rs) || !rs.length) continue;
      rs.forEach(r => (r || []).forEach(m => {
        if (!Array.isArray(m)) return;
        const mk = _msgKey(m);
        const i = at[mk];
        if (i === undefined){ at[mk] = out.length; out.push(m.slice()); return; }
        const ot = String(out[i][1] || ''), nt = String(m[1] || '');
        const ok = String((out[i].length > 8 && out[i][8]) || '').toLowerCase();
        const nk = String((m.length > 8 && m[8]) || '').toLowerCase();
        if (nk === 'a' && ok !== 'a'){ out[i] = m.slice(); return; }
        if (ok === 'a' && nk === 'a'){
          if (lbCharN(m[1] || '') !== lbCharN(out[i][1] || '')) out[i] = m.slice();
          return;
        }
        if (nt.length > ot.length) out[i] = m.slice();
      }));
    }
    return out;
  }catch(e){ return []; }
}
function lbForceReload(sid, title){
  const s = String(sid || ''), t = String(title || '').trim();
  const u = (typeof lbUidPick === 'function')
    ? String(lbUidPick(null, s, t) || '') : '';
  const scrKeys = [];
  if (u) scrKeys.push(_lbRowsKey(u, ''));
  if (t) scrKeys.push(_lbRowsKey('', t));
  const read = left => {
    const to = new Promise((_, rej) => setTimeout(
      () => rej(new Error('小账本被占用（3 秒无回音）')), 3000));
    return Promise.race([
      _idbReq('snap_conv', 'readonly', st => st.getAll()), to
    ]).catch(err => {
      if (left > 1) return new Promise(r => setTimeout(r, 400)).then(() => read(left - 1));
      throw err;
    });
  };
  return read(3).then(rows => {
    const _sidOf = x => {
      try { return (typeof 稳定键 === 'function')
        ? String(稳定键(String(x || ''), '') || '') : String(x || ''); }
      catch(e){ return String(x || ''); }
    };
    const skSid = _sidOf(s);
    const tNorm = (typeof lbNormTitle === 'function') ? lbNormTitle(t) : t;
    const usable = rec => !!(rec && rec.frame && Array.isArray(rec.frame.msgs)
      && rec.frame.msgs.length && String(rec.title || '').trim());
    /* 先按 sid/会话名圈（精确），一个都没有才按终身号兜底——避免把同一终身号
       名下别的会话一起拉进来。 */
    let mine = (rows || []).filter(rec => {
      if (!usable(rec)) return false;
      if (s && String(rec.sid || '') === s) return true;
      if (skSid && _sidOf(rec.sid) === skSid) return true;
      if (t && String(rec.title || '').trim() === t) return true;
      if (t && tNorm && String((typeof lbNormTitle === 'function'
            ? lbNormTitle(rec.title) : rec.title) || '') === String(tNorm)) return true;
      return false;
    });
    if (!mine.length && u){
      mine = (rows || []).filter(rec => usable(rec)
        && String(rec.uid || '').trim() === u);
    }
    mine.sort((a, b) => _lbMaxSec(a) - _lbMaxSec(b));
    if (!mine.length) return {ok: true, n: 0, rounds: 0, recs: 0};
    const seen = new Set(), all = [];
    mine.forEach(rec => {
      let rounds = [];
      try { rounds = lbRoundsFromMsgs(_lbCleanMsgs(rec.frame.msgs).msgs); } catch(e){}
      (rounds || []).forEach(r => {
        const k = (typeof lbRoundKey === 'function') ? lbRoundKey(r) : JSON.stringify(r);
        if (seen.has(k)) return;
        seen.add(k); all.push(r);
      });
    });
    if (!all.length) return {ok: true, n: 0, rounds: 0, recs: mine.length};
    const _rsec = r => {
      let mx = 0;
      (r || []).forEach(m => {
        if (!Array.isArray(m)) return;
        const v = (typeof _lbSecOf === 'function') ? _lbSecOf(m) : 0;
        if (v > mx) mx = v;
      });
      return mx;
    };
    all.sort((a, b) => _rsec(a) - _rsec(b));
    /* 当前会话所有别名键先清空：旧账一律作废，绝不让并集把旧内容带回屏幕。 */
    const alias = {};
    scrKeys.forEach(k => { alias[k] = 1; });
    const addAlias = (ru, rt) => {
      if (ru) alias[_lbRowsKey(ru, '')] = 1;
      if (rt) alias[_lbRowsKey('', rt)] = 1;
    };
    mine.forEach(rec => addAlias(String(rec.uid || '').trim(),
                                 String(rec.title || '').trim()));
    if (!LB.rows || typeof LB.rows !== 'object') LB.rows = {};
    Object.keys(alias).forEach(k => { delete LB.rows[k]; });
    if (u) LB.rows[_lbRowsKey(u, '')] = all;
    if (t) LB.rows[_lbRowsKey('', t)] = all;
    mine.forEach(rec => addAlias(String(rec.uid || '').trim(),
                                 String(rec.title || '').trim()));
    /* 别名键同样写整份 rounds（号/名两个入口都命中同一份，绝不再各存一半）。 */
    mine.forEach(rec => {
      const ru = String(rec.uid || '').trim(), rt = String(rec.title || '').trim();
      if (ru) LB.rows[_lbRowsKey(ru, '')] = all;
      if (rt) LB.rows[_lbRowsKey('', rt)] = all;
    });
    /* _frameMem 同步替换：lbScreenMsgs 会并集内存存帧，不换掉它屏幕仍可能≠小账本。 */
    try {
      const flat = [];
      all.forEach(r => (r || []).forEach(m => { if (Array.isArray(m)) flat.push(m.slice()); }));
      const newest = mine[mine.length - 1];
      const fr = Object.assign({}, newest.frame, {msgs: flat});
      const mk = (typeof _frameMemKey === 'function')
        ? _frameMemKey(s || String(newest.sid || '')) : '';
      if (mk && typeof _frameMem !== 'undefined') _frameMem[mk] = fr;
      if (t && typeof _frameMemByTitle !== 'undefined'
          && typeof _frameTitleKey === 'function'){
        const tk = _frameTitleKey(t);
        if (tk) _frameMemByTitle[tk] = fr;
      }
    } catch(e){}
    const n = all.reduce((a, r) => a + (r || []).length, 0);
    try { diagLog('读取小账本|' + (t || s) + '|记录=' + mine.length
      + '|轮=' + all.length + '|条=' + n, 'ok'); } catch(e){}
    try { if (typeof lbRepaint === 'function') lbRepaint(0); } catch(e){}
    return {ok: true, n: n, rounds: all.length, recs: mine.length};
  }).catch(err => ({ok: false,
    err: String((err && err.message) || err || '读取失败')}));
}
let _lbGuardAt = 0;
function lbGuardTick(){
  try{
    if (Date.now() - _lbGuardAt < 2500) return;
    const box = document.getElementById('msgs');
    if (!box) return;
    const _sid = (typeof curSid === 'function') ? String(curSid() || '') : '';
    const _ttl = (typeof curTitle === 'function') ? String(curTitle() || '') : '';
    const want = (typeof lbScreenMsgs === 'function')
      ? (lbScreenMsgs(_sid, _ttl) || []) : [];
    if (!want.length) return;                 /* 账本空：没有可比对的，绝不清屏 */
    const wm = [];
    want.forEach(m => {
      const id = Array.isArray(m) ? String(m[6] || '') : '';
      if (id) wm.push(id);
    });
    const dm = [];
    box.querySelectorAll('.msg').forEach(el => {
      if (el.getAttribute('data-think')) return;
      const id = el.getAttribute('data-mid') || '';
      if (id) dm.push(id);
    });
    if (!wm.length && !dm.length) return;
    if (wm.length !== dm.length || wm.some((x, i) => x !== dm[i])){
      _lbGuardAt = Date.now();
      try { diagLog('主界面兜底重绘|账本=' + wm.length + '|屏幕=' + dm.length, 'warn'); } catch(e){}
      lbRepaint(0);
    }
  }catch(e){}
}
try { setInterval(lbGuardTick, 3000); } catch(e){}

function _lbSecOf(m){
  try{
    const id = String((Array.isArray(m) && m[6]) || '');
    return parseInt(id.slice(0, 8), 16) || 0;
  }catch(e){ return 0; }
}
function _lbMaxSec(rec){
  try{
    const ms = (rec && rec.frame && Array.isArray(rec.frame.msgs)) ? rec.frame.msgs : [];
    let m = 0;
    ms.forEach(x => { const v = _lbSecOf(x); if (v > m) m = v; });
    return m;
  }catch(e){ return 0; }
}
function _lbTailNewer(a, b){
  const x = (Array.isArray(a) && a.length) ? _lbSecOf(a[a.length - 1]) : 0;
  const y = (Array.isArray(b) && b.length) ? _lbSecOf(b[b.length - 1]) : 0;
  return x > y;
}
let lbLastAct = Date.now();                  /* 离线倒计时锚点（任意操作重置） */
let _lbHudEl = null, _lbSnapAt = 0;

/* ================= 配置读取（调控界面在缓存查看器「③ 账本调控」区） ================= */
function lbPeriodMs(){ const v = parseInt(CFG.lb_period) || 90; return Math.max(15, v) * 1000; }   /* 兜底 60→90 */
function lbOfflineSecs(){ return Math.max(15, parseInt(CFG.lb_offline) || 120); }
function lbRounds(){ return Math.min(50, Math.max(1, parseInt(CFG.lb_rounds) || 5)); }
function lbMirrorMode(){
  try {
    const v = String((S && S.snap && S.snap.lbmode) || '');
    if (!v) return true;
    return v.indexOf('全量镜像') >= 0;
  } catch(e){ return true; }
}

/* ================= 版本底账（每服务端一份；客户端不重算指纹，
   只存服务端下发过的 ver 做比对——协议定稿 2.1 明文） ================= */
function lbVerLoad(){
  try {
    const o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {};
    LB.mods = o[lbSrvKey()] || {};
  } catch(e){ LB.mods = {}; }
  if (!LB.mods.ledger) LB.mods.ledger = {};
  LB.lbHave = new Set();                     /* 换服务端/重登：真存集按当前服务端重算 */
  lbHaveLoad();
}
function lbHaveLoad(){
  try {
    return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      (rows || []).slice().sort((a, b) => _lbMaxSec(a) - _lbMaxSec(b)).forEach(rec => {
        try {
          const fr = rec && rec.frame;
          if (!fr || !Array.isArray(fr.msgs) || !fr.msgs.length) return;
          const t = String(rec.title || '').trim();
          if (!t) return;
          const _clean = _lbCleanMsgs(fr.msgs);
          if (_clean.changed){
            if (!_clean.msgs.length){
              try { _idbReq('snap_conv', 'readwrite', st => st.delete(rec.sk)).catch(() => {}); } catch(e){}
              try { diagLog('账本类型清理|删空本|' + t, 'ok'); } catch(e){}
              return;
            }
            const nr = Object.assign({}, rec);
            nr.frame = Object.assign({}, fr, {msgs: _clean.msgs});
            try { _idbReq('snap_conv', 'readwrite', st => st.put(nr)).catch(() => {}); } catch(e){}
            try { diagLog('账本类型清理|' + t + '|清前=' + fr.msgs.length
              + '|清后=' + _clean.msgs.length, 'ok'); } catch(e){}
          }
          const rounds = lbRoundsFromMsgs(_clean.msgs);
          if (!rounds || !rounds.length) return;
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function' ? String(lbUidPick(null, rec.sid, t) || '') : '');
          if (u) LB.lbHave.add(u);
          lbSumSet(u || String(rec.sid || ''), t, rounds);
          lbRowsPut(u, t, rounds, true);
        } catch(e){}
      });
      try { if (typeof lbRepaint === 'function') lbRepaint(0); } catch(e){}
      return Object.keys(LB.lbSum || {}).length;
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}
const LS_LB_MIG_244 = 'trae_webm_lb_mig_244';
let _lbMig244P = null;
let _lbTimeFixAt = 0;
function lbTimeBackfill(days){
  try {
    if (Date.now() - _lbTimeFixAt < 5 * 60 * 1000) return Promise.resolve(0);
    _lbTimeFixAt = Date.now();
    const cut = Date.now() - Math.max(1, Number(days) || 2) * 24 * 3600 * 1000;
    return Promise.resolve([]).then(rows => {
      let n = 0;
      const tasks = [];
      const _snapTask = _idbReq('snap_conv', 'readonly', st => st.getAll()).then(srows => {
        const puts = [];
        (srows || []).forEach(rec => {
          const fr = rec && rec.frame;
          if (!fr || !Array.isArray(fr.msgs)) return;
          let ch = false;
          fr.msgs.forEach(m => {
            if (!Array.isArray(m)) return;
            if (m[2] !== ''){ m[2] = ''; ch = true; }   /* 不存时间 */
          });
          if (ch) puts.push(_idbReq('snap_conv', 'readwrite', st => st.put(rec)).catch(() => {}));
        });
        return Promise.all(puts).then(() => puts.length);
      }).catch(() => 0);
      return Promise.all(tasks.concat([_snapTask])).then(() => {
        if (n) { try { diagLog('账本时间回补 ' + n + ' 本（最近 ' + (Number(days) || 2) + ' 天）', 'ok'); } catch(e){} }
        return n;
      });
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}
function lbHash(s){
  try {
    let h = 0x811c9dc5;
    const t = String(s == null ? '' : s);
    for (let i = 0; i < t.length; i++){ h ^= t.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  } catch(e){ return ''; }
}
function lbCharN(s){
  try{
    const t = String(s == null ? '' : s);
    return Array.from(t).length;
  }catch(e){ return String(s == null ? '' : s).length; }
}
function _lbSameMidDiffN(a, b){
  try{
    const cnt = {};
    (a || []).forEach(m => {
      if (Array.isArray(m) && _midIsFormal(String(m[6] || '')))
        cnt[String(m[6])] = lbCharN(m[1] || '');
    });
    let hasOverlap = false;
    (b || []).forEach(m => {
      if (!Array.isArray(m)) return;
      const id = String(m[6] || '');
      if (!_midIsFormal(id) || !(id in cnt)) return;
      hasOverlap = true;
      /* 字符数固定按正文 index1 计（服务端 row[1]/text 同口径） */
      if (cnt[id] !== lbCharN(m[1] || '')) cnt[id] = -1;   /* -1＝字符数不同 */
    });
    if (!hasOverlap) return false;
    return Object.keys(cnt).some(k => cnt[k] === -1);
  }catch(e){ return false; }
}
function lbSumOf(rounds){
  const rs = Array.isArray(rounds) ? rounds : [];
  const codes = [];
  rs.forEach(r => {
    const a = (r && r.length) ? r[r.length - 1] : null;
    if (!a) return;
    if (String(a[0] || '').toLowerCase() !== 'a') return;
    if (/^th:/i.test(String(a[6] || '')) || lbPureThink(a)) return;
    codes.push({mid: String(a[6] || ''),
                fin: (String(a[7] || '').trim() ? 1 : 0),
                hash: lbHash(a[7] || a[1] || ''),
                n: lbCharN(a[1] || '')});
  });
  return {rounds: codes.length, codes: codes};
}
function lbSumSet(sid, title, rounds){
  try {
    const s = String(sid || '');
    const t = String(title || '').trim();
    if (!t) return;
    let u = '';
    try { u = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : ''; } catch(e){ u = ''; }
    LB.lbSum[u || t] = lbSumOf(rounds);
  } catch(e){}
}
function lbVerSave(){
  try {
    const o = {};
    try { o = JSON.parse(localStorage.getItem(LS_LBVER) || '{}') || {}; } catch(e2){}
    o[lbSrvKey()] = LB.mods;
    localStorage.setItem(LS_LBVER, JSON.stringify(o));
  } catch(e){}
}
function lbSrvKey(){ return String(S.cur || '默认'); }
function lbSrvTag(){
  var nm = '', fox = '';
  try { nm = String((typeof S !== 'undefined' && S && S.cur) || '').trim(); } catch(e){}
  try { fox = String((typeof S !== 'undefined' && S && S.curSid) || '').trim(); } catch(e){}
  try {
    if (fox && nm) localStorage.setItem('trae_webm_srvfox|' + nm, fox);
    if (fox){ localStorage.setItem('trae_webm_srvfox_last', fox); return fox; }
    if (nm){
      var v = localStorage.getItem('trae_webm_srvfox|' + nm);
      if (v) return String(v);
      return nm;
    }
    var last = localStorage.getItem('trae_webm_srvfox_last');
    if (last) return String(last);
  } catch(e){}
  return '默认';
}
function lbSrvFox(){ return String(S.curSid || '').trim(); }
function lbSrvName(){ return String(S.cur || '').trim(); }
function lbIsLegacyRec(r){
  return !(r && typeof r.sk === 'string' && r.sk.indexOf('L') === 0
           && String(r.srv || '') === lbSrvTag());
}
function lbUidAuth(v){
  const u = String(v == null ? '' : v).trim();
  if (!/^\d{4}$/.test(u)) return '';          /* 非 4 位数字（含名称兜底）不认 */
  if (_lbIsSrvAcctLike(u)) return '';         /* 实例号/1632 不是终身号 */
  return u;
}
function lbUidName(v){
  let s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (lbUidAuth(s)) return '';                 /* 标准号不是名称 */
  if (/^\d{4}$/.test(s)) return '';            /* 4 位数字一律按编号处理（含 1632 假号） */
  if (/^\d{10}$/.test(s)) return '';           /* 10 位实例号 */
  if (/^[0-9a-f]{24}$/i.test(s)) return '';    /* 完整 sid 绝不当身份键 */
  s = s.replace(/\s*（临时）\s*$/, '').replace(/\s*（按名称）\s*$/, '').trim();
  return s;
}
function lbUidAny(v){ return lbUidAuth(v) || lbUidName(v); }
function lbStoreKey(uidOrSid, title){
  const t = (typeof lbNormTitle === 'function')
    ? lbNormTitle(title) : String(title || '').trim();
  const u = lbUidAuth(uidOrSid);
  if (u) return 'L' + lbSrvTag() + ':' + u;
  /* 名称兜底：服务端下发的名称优先，其次会话名（同名一律同一桶） */
  const n = lbUidName(uidOrSid) || t;
  return 'L' + lbSrvTag() + ':t:' + n;
}
function _lbSrvAcctId(){
  try { return String((typeof S !== 'undefined' && S && S.curSid) || '').trim(); }
  catch(e){ return ''; }
}
function _lbIsSrvAcctLike(v){
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  const acct = _lbSrvAcctId();
  if (acct && s === acct) return true;
  /* 实例号的任何截断：4~10 位纯数字且确为该实例号前缀 */
  if (acct && /^\d{4,10}$/.test(s) && acct.indexOf(s) === 0) return true;
  return s === '1632';
}
let _lbFakeIdT = 0, _lbFakeIdV = '';
function _lbFakeIdLog(src, val){
  const now = Date.now(), v = String(val == null ? '' : val).trim();
  if (now - _lbFakeIdT < 10000 && v === _lbFakeIdV) return;   /* 10 秒同值节流 */
  _lbFakeIdT = now; _lbFakeIdV = v;
  try { diagLog('假终身号 拒建账|来源=' + String(src || '未知')
    + '|原值=' + v, 'bad'); } catch(e){}
}
function _lbFakeLedgerRec(rec){
  if (!rec || typeof rec !== 'object') return false;
  const uid = String(rec.uid || '').trim();
  const sid = String(rec.sid || '').trim();
  /* ① sid 本身是 10 位纯数字＝服务端实例号格式，绝不是会话 sid */
  if (/^\d{10}$/.test(sid)) return true;
  /* ② uid 命中实例号或其截断（含 1632）＝假终身号（2.211：不再用 sid 前 4 位
       做任何豁免——终身号只认权威字段，禁止字符串切片推导） */
  if (_lbIsSrvAcctLike(uid)) return true;
  /* ③ uid 为空但 sid 命中实例号 */
  if (_lbIsSrvAcctLike(sid)) return true;
  return false;
}
function lbPureThink(m){
  if (!Array.isArray(m)) return false;
  const _k = String((m.length > 8 && m[8]) || '').toLowerCase();
  if (_k === 'a' || _k === 'final' || _k === 'patched') return false;
  if (String((m.length > 7 && m[7]) || '').trim()
      && String((m.length > 7 && m[7]) || '').trim() !== '补记'
      && String((m.length > 7 && m[7]) || '').trim() !== '提前终极') return false;
  const lines = String(m[1] == null ? '' : m[1]).split(/\r?\n/)
    .map(s => s.trim()).filter(s => s);
  if (!lines.length) return false;
  const i = (lines[0] === 'TraeWork' || lines[0] === 'Trae Work') ? 1 : 0;
  if (i >= lines.length) return false;
  return /^(?:思考过程|思考中|正在思考|已深度思考)(?:$|[\s:：])/.test(lines[i]);
}
function lbIsFinalRow(m){
  if (!Array.isArray(m)) return false;
  if (String(m[0] || '').toLowerCase() !== 'a') return false;
  if (/^th:/i.test(String(m[6] || ''))) return false;
  if (lbPureThink(m)) return false;
  const k = String((m.length > 8 && m[8]) || '').toLowerCase();
  if (k === 'a' || k === 'final' || k === 'patched') return true;
  if (lbPatchMarked(m)) return true;
  return String((m.length > 7 && m[7]) || '').trim() !== '';
}
function lbFinalHard(m){
  if (!Array.isArray(m)) return false;
  if (String(m[0] || '').toLowerCase() !== 'a') return false;
  if (/^th:/i.test(String(m[6] || ''))) return false;
  if (lbPureThink(m)) return false;
  const k = String((m.length > 8 && m[8]) || '').toLowerCase();
  if (k === 'a' || k === 'final' || k === 'patched') return true;
  if (lbPatchMarked(m)) return true;
  return false;                       /* 模糊 fin：不算硬终极 */
}
const LB_PATCH_KEYS = ['patched', 'fin_patch', 'final_patch', 'interrupt_final',
                       'terminal_patch', 'recovered', '补记'];
function lbPatchFlag(v){
  if (!v || typeof v !== 'object') return false;
  for (const k of LB_PATCH_KEYS){
    const x = v[k];
    if (x === true || x === 1 || x === '1' || x === 'true') return true;
  }
  return false;
}
function lbPatchMarked(m){
  if (!Array.isArray(m)) return false;
  if (String(m[8] || '').toLowerCase() === 'patched') return true;
  return (m.length > 10 && (m[10] === 1 || m[10] === '1' || m[10] === true));
}
/* 四字段之一：uid＝终身号（只认权威来源，取不到即空＝未登记）；sid＝对话ID
   （原始会话 id，锚定路只有终身号时从会话列表反查）。title＝会话名（必有）。
   禁止任何字符串切片推导终身号——本函数只做「无权威字段即返回空」，
   绝不从 sid 截前 4 位。 */
function lbUidOf(sid){
  try { return lbUidFromConvs(sid, '') || ''; } catch(e){ return ''; }
}
const LS_LB_ALIAS = 'trae_webm_lb_alias';
function lbAliasLoad(){
  try { return JSON.parse(localStorage.getItem(LS_LB_ALIAS) || '{}') || {}; }
  catch(e){ return {}; }
}
function lbAliasSave(o){
  try { localStorage.setItem(LS_LB_ALIAS, JSON.stringify(o || {})); } catch(e){}
}
function lbAliasGet(title){
  const t = String(title || '').trim();
  if (!t) return '';
  const o = lbAliasLoad(), m = o[lbSrvKey()] || {};
  const u = String(m[t] || '');
  return (/^\d{4}$/.test(u) && !_lbIsSrvAcctLike(u)) ? u : '';
}
function lbAliasSet(uid, title){
  const u = String(uid || '').trim(), t = String(title || '').trim();
  if (!/^\d{4}$/.test(u) || !t || _lbIsSrvAcctLike(u)) return;
  const o = lbAliasLoad();
  const k = lbSrvKey();
  const m = o[k] || (o[k] = {});
  if (m[t] === u) return;
  m[t] = u;
  lbAliasSave(o);
}
function lbUidFromConvs(sid, title){
  const s = String(sid || '').trim(), t = String(title || '').trim();
  try {
    const cf = (S.snap && Array.isArray(S.snap.convs_full)) ? S.snap.convs_full : [];
    for (const o of cf){
      if (!o) continue;
      const u = lbUidAny(o.uid);
      if (!u) continue;
      const osid = String(o.sid || ''), ot = String(o.title || '');
      if ((s && osid === s) || (t && ot === t)) return u;
    }
  } catch(e){}
  try {
    const cv = (S.snap && Array.isArray(S.snap.convs)) ? S.snap.convs : [];
    for (const r of cv){
      if (!Array.isArray(r)) continue;
      const u = lbUidAny(r[5]);
      if (!u) continue;
      if ((s && String(r[4] || '') === s) || (t && String(r[1] || '') === t)) return u;
    }
  } catch(e){}
  try {
    if (S.convUids && typeof S.convUids === 'object'){
      if (s && lbUidAny(S.convUids[s])) return lbUidAny(S.convUids[s]);
      if (t && lbUidAny(S.convUids[t])) return lbUidAny(S.convUids[t]);
    }
  } catch(e){}
  return '';
}
function lbUidPick(serverUid, sid, title){
  const u = lbUidAuth(serverUid);
  if (u) return u;
  const n = lbUidName(serverUid);
  if (n) return n;
  const a = lbAliasGet(title);
  if (a) return a;
  const c = lbUidFromConvs(sid, title);
  if (c) return c;
  /* ③ 名称兜底：会话名原样当终身号（同名同桶，无后缀） */
  const t = String(title || '').trim();
  return (typeof lbNormTitle === 'function') ? lbNormTitle(t) : t;
}
function lbRawSidOf(uid, title){
  try {
    const u = String(uid || ''), t = String(title || '');
    if (Array.isArray(S.convs)) for (const r of S.convs){
      if (!r || !r[4]) continue;
      if ((u && typeof 稳定键 === 'function' && 稳定键(r[4], r[1]) === u)
          || (t && String(r[1] || '') === t)) return String(r[4]);
    }
  } catch(e){}
  return String(uid || '');
}
function lbModsSet(m){
  LB.mods = (m && typeof m === 'object') ? m : {};
  if (!LB.mods.ledger) LB.mods.ledger = {};
  lbVerSave();
}

/* ================= ① vcheck 构造（单函数双入口，四场景共用） ================= */
function lbConv12Report(sid, title){
  try{
    const s = String(sid || ''), t = String(title || '').trim();
    if (!s && !t) return null;
    const out = [];
    const rows = (typeof lbScreenMsgs === 'function') ? lbScreenMsgs(s, t) : [];
    const chat = [];
    (Array.isArray(rows) ? rows : []).forEach(m => {
      if (!Array.isArray(m)) return;
      const r = String(m[0] || '').toLowerCase();
      if (r !== 'u' && r !== 'a') return;
      if (r === 'a' && (/^th:/i.test(String(m[6] || '')) || lbPureThink(m))) return;
      const mid = String(m[6] || '');
      if (mid) chat.push(mid);
    });
    chat.slice(-10).forEach(x => out.push(x));
    const _th = (typeof thinkCardsReport === 'function') ? thinkCardsReport() : null;
    const tid = _th ? String(_th[s] || '') : '';
    if (tid) out.push(tid);
    try{
      const pd = (S.snap && Array.isArray(S.snap.pend)) ? S.snap.pend : [];
      const pit = pd.find(it => it && it.id != null && String(it.id).trim()
                                && String(it.sid || '') === s)
        || pd.find(it => it && it.id != null && String(it.id).trim());
      if (pit) out.push(String(pit.id));
    }catch(e){}
    if (!out.length) return null;
    let key = '';
    try { key = (typeof lbUidPick === 'function')
      ? String(lbUidPick(null, s, t) || '') : ''; } catch(e){ key = ''; }
    return {sid: s, key: (key || t || s), ids: out};
  }catch(e){ return null; }
}
function ledgerVcheckBuild(act, sid){
  /* 上行单帧多模块编码（统筹批复·十-1）：编码合帧不判 FAIL，
     每模块编码独立可辨、服务端逐模块校验。 */
  const mods = {};
  const b = LB.mods || {};
  ['sig', 'snote', 'macct', 'convs', 'didp', 'think', 'srv', 'input', 'points'].forEach(k => {
    if (b[k]) mods[k] = b[k];
  });
  const led = {};
  const _sum = (LB.lbSum && typeof LB.lbSum === 'object') ? LB.lbSum : {};
  Object.keys(_sum).forEach(k => {
    const s = _sum[k];
    if (!s) return;
    led[k] = {ver: String((b.ledger || {})[k] || '0'),
              rounds: s.rounds | 0,
              codes: Array.isArray(s.codes) ? s.codes : []};
  });
  mods.ledger = led;                       /* ledger 按「本地真存会话（终身号）」逐会话上报 */
  /* 规范§七：目标缓存轮数参数（统一按轮）。2.306：全量镜像下不再上报
     lb_rounds——保留几轮由服务器决定，网页端无权让服务器缩水。 */
  if (!lbMirrorMode()) mods.lb_rounds = lbRounds();
  try{
    const _c12 = lbConv12Report(sid,
      (typeof curTitle === 'function' ? curTitle() : ''));
    if (_c12) mods.conv = _c12;
  }catch(e){}
  const d = {t: 'vcheck', act: act, mods: mods, req_seq: ++LB.reqSeq};
  if (sid) d.sid = String(sid);
  const _th = (typeof thinkCardsReport === 'function') ? thinkCardsReport() : null;
  if (_th && Object.keys(_th).length) d.thinks = _th;
  return d;
}
function ledgerVcheckSend(act, sid){
  /* 四场景同一入口：login（cliLogin）/ switch（点会话、刷新重锚）/
     svr（切服务端）/ timer（主动核对）。WS 不在线 ⇒ 静默放弃
     （switch 场景有 phase:'connecting' 提示兜底，timer 下轮再试）。 */
  try {
    if (!S.onLine || !ws || ws.readyState !== 1) return false;
    if (act === 'login' || act === 'svr') lbVerLoad();   /* 换服务端/重登：按当前服务端重载底账，绝不串用旧服务端版本 */
    const _fr = ledgerVcheckBuild(act, sid);
    if (act === 'timer'){
      const _sig = JSON.stringify({m: _fr.mods, th: _fr.thinks || null,
                                   sid: String(sid || '')});
      if (_sig === LB.lastTimerSig){
        try { sendJson({t: 'vcheck', act: 'beat', sid: String(sid || '')}); } catch(e){}
        return false;
      }
      LB.lastTimerSig = _sig;
    }
    sendJson(_fr);
    try {
      LB.chkUntil = Date.now() + 10000;      /* 圆球指示窗（四契机通用） */
      if (act !== 'timer'){
        LB.vchkOpen = 1;
        LB.vchkEndAt = Date.now() + 10000;
        LB.vchkTitle = String((S.switch_pend && S.switch_pend.title)
                              || (typeof curTitle === 'function' ? curTitle() : '') || '');
      }
    } catch(e){}
    if (act === 'timer') LB.checking = true;
    if (act === 'switch') lbFreezeOnSwitch();
    return true;
  } catch(e){ return false; }
}
/* 切换出终态（成功或失败）→ 解冻并按完整周期重新起算（规范§三） */
function lbUnfreeze(){
  try {
    clearTimeout(LB.frozenT);
    LB.frozenT = null;
    LB.frozen = false;
    LB.timerAt = Date.now() + lbPeriodMs();
  } catch(e){ LB.frozen = false; }
}
function lbFreezeOnSwitch(){
  if (LB.frozen) return;
  LB.frozen = true;
  LB.timerAt = Date.now() + lbPeriodMs();
  clearTimeout(LB.frozenT);
  LB.frozenT = setTimeout(lbUnfreeze,
    (typeof SWITCH_TIMEOUT_MS === 'number' && SWITCH_TIMEOUT_MS) || 90000);
}

/* ================= ② vack 两阶段回执 ================= */
function ledgerScreenComplete(sid, title){
  try{
    const s = String(sid || (typeof curSid === 'function' ? curSid() : '') || '');
    const t = String(title || (typeof curTitle === 'function' ? curTitle() : '') || '');
    const want = (typeof lbScreenMsgs === 'function') ? (lbScreenMsgs(s, t) || []) : [];
    const wm = want.filter(m => !(Array.isArray(m) && String(m[8] || '')
      .toLowerCase() === 'th'))
      .map(m => String((Array.isArray(m) && m[6]) || '')).filter(Boolean);
    const cs = (typeof curSid === 'function') ? String(curSid() || '') : '';
    if (cs && s && cs !== s) return true;      /* 非当前会话：DOM 上不是它，不拦 */
    if (String(LB.vackSid || '') === s){
      const _u2 = (typeof lbUidPick === 'function')
        ? String(lbUidPick(null, s, t) || '') : '';
      const _k1 = _u2 ? _lbRowsKey(_u2, '') : '';
      const _k2 = t ? _lbRowsKey('', t) : '';
      const _have = {};
      [_k1, _k2].forEach(k => {
        const rs = k ? LB.rows[k] : null;
        if (!Array.isArray(rs)) return;
        rs.forEach(r => (r || []).forEach(m => {
          if (Array.isArray(m) && m[6]) _have[String(m[6])] = 1;
        }));
      });
      const _miss = [];
      (Array.isArray(LB.vackOrder) ? LB.vackOrder : []).forEach(id => {
        id = String(id || '');
        if (id && !_have[id]) _miss.push(id);
      });
      (Array.isArray(LB.vackItems) ? LB.vackItems : []).forEach(it => {
        if (!it || typeof it !== 'object') return;
        if (it.mod === 'ledger'){
          (it.mids || []).forEach(mid => {
            mid = String(mid || '');
            if (mid && !_have[mid]) _miss.push(mid);
          });
        } else if (it.mod && it.ver){
          if (String((LB.mods || {})[it.mod] || '') !== String(it.ver))
            _miss.push('模块:' + it.mod);
        }
      });
      if (_miss.length){
        try { diagLog('核对销账缺项|' + _miss.length + '|'
          + _miss.slice(0, 6).join(','), 'warn'); } catch(e){}
        return false;
      }
    }
    if (!wm.length) return true;              /* 空账不拦（回执清单已校验） */
    const box = document.getElementById('msgs');
    if (!box) return true;
    const dm = [];
    box.querySelectorAll('.msg').forEach(el => {
      const id = el.getAttribute('data-mid') || '';
      if (id) dm.push(id);
    });
    return wm.every(id => dm.indexOf(id) >= 0);
  }catch(e){ return true; }
}
function ledgerVack(d){
  if (!d || typeof d !== 'object') return;
  /* stage:1 —— 服务端已变更选中会话，账本核对中（悬浮提示，切换未完成） */
  if (d.stage === 1){
    const sp = S.switch_pend;
    if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
      if (sp.phase !== 'ok'){
        sp.phase = 'ledger_check';
        sp.ts = Date.now();
        clearTimeout(sp._resendT);         /* 服务器已受理：停补发（同 switch_ack 口径） */
        renderAll();
      }
    }
    return;
  }
  /* stage:2 —— 正式成功终态：版本一致（same）或差额补发清单（need） */
  LB.checking = false;
  LB.vackSid = String(d.sid || '');
  LB.vackOrder = Array.isArray(d.srv_order) ? d.srv_order : [];
  LB.vackItems = Array.isArray(d.items) ? d.items : [];
  if ((d.act === 'switch' || S.switch_pend) && typeof bannerPendSuccess === 'function'){
    /* 轮询式复查：刷新/登录时本地账本为空、补发帧随后才到，
       旧写法只等 900ms 一次就永久放弃 ⇒ 改 300ms 一次、最多 8 秒 */
    if (ledgerScreenComplete(d.sid || '',
        (typeof curTitle === 'function' ? curTitle() : ''))){
      bannerPendSuccess();
    } else {
      try { if (typeof lbRepaint === 'function') lbRepaint(0); } catch(e){}
      (function(){
        var _t0 = Date.now();
        var _sid = d.sid || '';
        var _tk = setInterval(function(){
          var _ok = ledgerScreenComplete(_sid,
            (typeof curTitle === 'function' ? curTitle() : ''));
          if (_ok || Date.now() - _t0 >= 8000){
            clearInterval(_tk);
            if (_ok && typeof bannerPendSuccess === 'function') bannerPendSuccess();
          }
        }, 300);
      })();
    }
  }
  LB.vchkOpen = 0; LB.vchkEndAt = 0; LB.chkUntil = 0;
  if (d.mods && typeof d.mods === 'object') lbModsSet(d.mods);   /* 存底，供下轮比对 */
  if (d.act === 'switch') lbUnfreeze();
  else if (d.act === 'login' || d.act === 'svr'){
    LB.timerAt = Date.now() + lbPeriodMs();
  }
  const sp = S.switch_pend;
  if (sp && (!d.sid || !sp.sid || String(d.sid) === String(sp.sid))){
    if (d.same){
      if (ledgerScreenComplete(d.sid || '',
          (typeof curTitle === 'function' ? curTitle() : ''))){
        ledgerSwitchDone();
      } else {
        try { if (typeof lbRepaint === 'function') lbRepaint(0); } catch(e){}
        setTimeout(function(){
          if (S.switch_pend === sp && ledgerScreenComplete(d.sid || '',
              (typeof curTitle === 'function' ? curTitle() : '')))
            ledgerSwitchDone();
        }, 900);
      }
    } else {
      /* need 差额补发中：8 秒兜底收口（实体帧陆续到达时会刷新画面） */
      sp.need = Array.isArray(d.need) ? d.need : [];
      clearTimeout(sp._needT);
      sp._needT = setTimeout(() => {
        if (S.switch_pend !== sp || !sp.need) return;
        if (ledgerScreenComplete(sp.sid || d.sid || '',
            (typeof curTitle === 'function' ? curTitle() : ''))){
          delete sp.need; ledgerSwitchDone();
        } else {
          try { if (typeof lbRepaint === 'function') lbRepaint(0); } catch(e){}
          try { flash('核对未完成：屏幕仍缺消息，已请求重绘', 'var(--orange)'); } catch(e){}
          sp._needT = setTimeout(() => {
            if (S.switch_pend === sp && sp.need
                && ledgerScreenComplete(sp.sid || d.sid || '',
                   (typeof curTitle === 'function' ? curTitle() : ''))){
              delete sp.need; ledgerSwitchDone();
            }
          }, 2000);
        }
      }, 8000);
    }
  }
}
function ledgerSwitchDone(){
  const sp = S.switch_pend;
  if (!sp) return;
  delete sp.need;
  clearTimeout(sp._needT);
  if (sp.phase !== 'ok') switchOk();       /* 复用既有成功收口（2s 成功提示 → 关提示） */
}

/* ================= ③ mod 单模块实体帧分流（下行唯一实体形态） ================= */
const _lbHumanSeen = new Map();
function ledgerMod(d){
  if (!d || typeof d !== 'object') return;
  const m = String(d.m || ''), v = String(d.v || ''), body = d.d;
  /* 版本存底：mod 帧必带该模块新 ver（协议定稿 3.1） */
  if (v && LB.mods){
    if (m === 'ledger'){
      LB.mods.ledger = LB.mods.ledger || {};
      if (d.sid) LB.mods.ledger[String(d.sid)] = v;
    } else LB.mods[m] = v;
    lbVerSave();
  }
  switch (m){
    case 'u':
    case 'human': {                        /* 人类记录即发帧（服务端 t:'mod' m:'u'）——收到即入账并按发送编号销卡 */
      if (typeof ledgerHumanFrame === 'function'){
        const _didNow = String((body && body.did) || '');
        const _nowu = Date.now();
        let _dup = false;
        if (_didNow){
          const _last = _lbHumanSeen.get(_didNow);
          if (_last && _nowu - _last < 3000) _dup = true;
          _lbHumanSeen.set(_didNow, _nowu);
          if (_lbHumanSeen.size > 200){
            _lbHumanSeen.forEach((ts, k) => { if (_nowu - ts > 3000) _lbHumanSeen.delete(k); });
          }
        }
        if (!_dup) ledgerHumanFrame(body);
      }
      break;
    }
    case 'input': {                        /* 输入框模块帧——横幅「输入框待发」取数点 */
      if (body && S.snap && typeof S.snap === 'object'){
        S.snap.inputText = String((body.text != null ? body.text : '') || '');
        renderAll();
      }
      break;
    }
    case 'snote': {                        /* 定时消息＋备注（合并模块） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (body.notes !== undefined) S.snap['备注'] = body.notes;
        if (body.sched !== undefined) S.snap['定时'] = body.sched;
        if (window.备注入快照) 备注入快照(S.snap);
        if (window.定时入快照) 定时入快照(S.snap);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'sig': {                          /* 信号灯（独立高频） */
      const arr = (body && body.convs) || [];
      try {
        if (!S.convUids) S.convUids = {};
        arr.forEach(o => { if (o && o.sid && lbUidAny(o.uid)) S.convUids[String(o.sid)] = lbUidAny(o.uid); });
      } catch(e){}
      if (arr.length && S.snap){
        const cf = Array.isArray(S.snap.convs_full) ? S.snap.convs_full : [];
        arr.forEach(o => {
          if (!o || !o.sid) return;
          const row = cf.find(x => x && x.sid === o.sid);
          if (row){
            row.status = o.status || row.status;
            if (o.light !== undefined) row.light = o.light;
            if (o.orange !== undefined) row.orange = o.orange;
            if (o.unread !== undefined) row.unread = o.unread;
            if (lbUidAny(o.uid)) row.uid = lbUidAny(o.uid);
          }
        });
        if (Array.isArray(o_unreadIds(arr))) S.snap.conv_unread_ids = o_unreadIds(arr);
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'macct': {                        /* 模型列表＋账号列表（合并模块，账号按 boxes） */
      if (body){
        if (Array.isArray(body.models)){
          S.models_full = body.models;
          rebuildModelOptions(); checkFavInvalid();
        }
        if (body.acct !== undefined){ S.acct = String(body.acct || ''); renderAcct(); }
        if (Array.isArray(body.boxes)){
          S.boxes = body.boxes.filter(Boolean);
          el.box.innerHTML = '';
          S.boxes.forEach(b2 => {
            const o = document.createElement('option');
            o.value = b2; o.textContent = b2;
            el.box.appendChild(o);
          });
        }
      }
      break;
    }
    case 'convs': {                        /* 会话列表（改名/删除触发本地账本清理 H2） */
      if (body && S.snap && typeof S.snap === 'object'){
        if (body.lbmode !== undefined) S.snap.lbmode = String(body.lbmode || '');
        if (Array.isArray(body.convs)) S.snap.convs = body.convs;
        if (Array.isArray(body.convs_full)) S.snap.convs_full = body.convs_full;
        try {
          if (!S.convUids) S.convUids = {};
          if (body.uids && typeof body.uids === 'object'){
            Object.keys(body.uids).forEach(k => {
              const u = lbUidAny(body.uids[k]);
              if (k && u) S.convUids[String(k)] = u;
            });
          }
          (Array.isArray(body.convs_full) ? body.convs_full : []).forEach(o => {
            if (!o) return;
            const u = lbUidAny(o.uid);
            if (!u) return;
            if (o.sid) S.convUids[String(o.sid)] = u;
            if (o.title) S.convUids[String(o.title)] = u;
          });
          (Array.isArray(body.convs) ? body.convs : []).forEach(r => {
            if (!Array.isArray(r)) return;
            const u = lbUidAny(r[5]);
            if (!u) return;
            if (r[4]) S.convUids[String(r[4])] = u;
            if (r[1]) S.convUids[String(r[1])] = u;
          });
        } catch(e){}
        S.convs_key = null;
        renderAll();
      }
      break;
    }
    case 'didp': {                         /* 销卡池子（F5 补销渠道） */
      const pool = (body && body.pool) || [];
      let ch = false;
      pool.forEach(did => { if (pendClearByDid(did, '')) ch = true; });
      if (ch) renderAll();
      break;
    }
    case 'ledger':                         /* 聊天主账本（按轮补发，G1） */
      ledgerStoreApply(d.sid || (body && body.sid) || '', body, v);
      break;
    case 'think':                          /* 思维流快照＋排队条（TRAE 专属，E2/N1） */
      ledgerThinkApply(d.sel || d.sid, body);
      break;
  }
}
/* ============ 1.051：服务端对账帧 lbkeep（账本连续链裁剪） ============ */
function lbKeepApply(d){
  /* 最小处理：按 sid 找本地唯一正文账 snap_conv 里该会话的记录，删除 del 中
     列出的 mid（keep 保留），删完重建 lbSum 与 snap_conv 记录。无该会话或
     空指令一律静默；不新增页面、不改布局。 */
  try{
    if (!d || typeof d !== 'object') return;
    const del = Array.isArray(d.del)
      ? d.del.map(x => String(x || '')).filter(Boolean) : [];
    if (!del.length) return;
    const sid = String(d.sid || '').trim();
    if (!sid) return;
    const _del = new Set(del);
    _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      const puts = [];
      (rows || []).forEach(rec => {
        try{
          if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
          const rs = String(rec.sid || ''), ru = String(rec.uid || '');
          const rt = String(rec.title || '');
          if (sid !== rs && sid !== ru && sid !== rt) return;
          const kept = [];
          let hit = 0;
          rec.frame.msgs.forEach(m => {
            if (Array.isArray(m) && _del.has(String(m[6] || ''))){ hit++; return; }
            kept.push(m);
          });
          if (!hit) return;
          if (!kept.length){
            puts.push(_idbReq('snap_conv', 'readwrite',
              st => st.delete(rec.sk)).catch(() => {}));
            try { LB.lbHave.delete(String(rec.uid || rec.sid || '')); } catch(e){}
            try { lbSumDrop(rec.sid, rec.title); } catch(e){}
            try { delete LB.rows[_lbRowsKey(String(rec.uid || ''), rt)]; } catch(e){}
            try { delete _frameMem[rec.sk]; } catch(e){}
            return;
          }
          const nr = Object.assign({}, rec);
          nr.frame = Object.assign({}, rec.frame, {msgs: kept});
          try {
            if (_frameMem && _frameMem[rec.sk] && Array.isArray(_frameMem[rec.sk].msgs))
              _frameMem[rec.sk].msgs = kept.map(m => m.slice());
          } catch(e){}
          const rounds = lbMirrorMode()
            ? lbMirrorRounds(kept) : lbRoundsFromMsgs(kept);
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function'
                ? String(lbUidPick(null, rec.sid, rt) || '') : '');
          try { lbSumSet(u || String(rec.sid || ''), rt, rounds); } catch(e){}
          try { lbRowsPut(u, rt, rounds, true); } catch(e){}
          puts.push(_idbReq('snap_conv', 'readwrite',
            st => st.put(nr)).catch(() => {}));
          try { diagLog('lbkeep 裁剪|sid=' + sid + '|删=' + hit
            + '|留=' + kept.length, 'ok'); } catch(e){}
        }catch(e){}
      });
      return Promise.all(puts).then(() => { try { lbRepaint(); } catch(e){} });
    }).catch(() => {});
  }catch(e){}
}
/* ============ 1.054：服务端对账帧 lbsync（账本足额同步：重排+补齐+删多余） ============ */
function lbSyncApply(d){
  try{
    if (!d || typeof d !== 'object') return;
    const order = Array.isArray(d.order)
      ? d.order.map(x => String(x || '')).filter(Boolean) : [];
    const orderSet = new Set(order);
    const sid = String(d.sid || '').trim();
    const wantUid = String(d.uid || '').trim();
    const wantTitle = String(d.title || '').trim();
    if (!sid && !wantUid && !wantTitle) return;
    const addMap = new Map();
    (Array.isArray(d.add) ? d.add : []).forEach(it => {
      try{
        if (!it || typeof it !== 'object') return;
        const mid = String(it.mid || '');
        if (mid && Array.isArray(it.row)) addMap.set(mid, it.row);
      }catch(e){}
    });
    const unfin = new Set((Array.isArray(d.unfin) ? d.unfin : [])
      .map(x => String(x || '')).filter(Boolean));
    _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      const puts = [];
      (rows || []).forEach(rec => {
        try{
          if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
          const rs = String(rec.sid || ''), ru = String(rec.uid || '');
          const rt = String(rec.title || '');
          /* 三法命中：sid / uid / title 任一相等（同 lbKeepApply :928-930） */
          const hit = (sid && (sid === rs || sid === ru || sid === rt))
            || (wantUid && wantUid === ru) || (wantTitle && wantTitle === rt);
          if (!hit) return;
          const localMap = new Map();
          rec.frame.msgs.forEach(m => {
            if (Array.isArray(m) && m[6]) localMap.set(String(m[6]), m);
          });
          let 删 = 0;
          localMap.forEach((v, k) => { if (!orderSet.has(k)) 删++; });
          let 补 = 0;
          const kept = [];
          order.forEach(mid => {
            if (unfin.has(mid)) return;      /* 服务器撤销终答 ⇒ 删行 */
            if (addMap.has(mid)){
              const _raw = addMap.get(mid);
              const _rr = lbMirrorMode()
                ? _raw
                : ((typeof _lbKeepRow === 'function') ? _lbKeepRow(_raw) : _raw);
              if (_rr){ kept.push(_rr); 补++; }
              return;
            }
            if (localMap.has(mid)){ kept.push(localMap.get(mid)); return; }
          });
          const _ordSec = order.reduce((m, id) => {
            const v = parseInt(String(id).slice(0, 8), 16) || 0;
            return v > m ? v : m;
          }, 0);
          const _extraNew = [];
          localMap.forEach((v, k) => {
            if (orderSet.has(k)) return;
            if (unfin.has(k)) return;        /* 撤销终答的行不留尾 */
            const sec = parseInt(String(k).slice(0, 8), 16) || 0;
            if (_ordSec && sec > _ordSec) _extraNew.push(v);
          });
          if (_extraNew.length){
            _extraNew.sort((a, b) =>
              String((a && a[6]) || '').localeCompare(String((b && b[6]) || '')));
            _extraNew.forEach(v => kept.push(v));
            删 = Math.max(0, 删 - _extraNew.length);
            try { diagLog('lbsync 保留更新行|sid=' + (sid || wantUid || wantTitle)
              + '|本地新于服务器=' + _extraNew.length + '|order=' + order.length,
              'warn'); } catch(e){}
          }
          const 留 = kept.length - 补;
          const 键 = sid || wantUid || wantTitle;
          if (kept.length === 1 && localMap.size >= 3){
            try { diagLog('lbsync 拒删|sid=' + 键 + '|order=' + order.length
              + '|local=' + localMap.size + '|单条全序保留不动', 'warn'); } catch(e){}
            return;
          }
          if (!kept.length){
            const _localN = localMap.size;
            if (!order.length || (_localN > 0 && addMap.size === 0)){
              try { diagLog('lbsync 拒删|sid=' + 键 + '|order=' + order.length
                + '|add=' + addMap.size + '|local=' + _localN + '|保留不动', 'warn'); } catch(e){}
              return;
            }
            puts.push(_idbReq('snap_conv', 'readwrite',
              st => st.delete(rec.sk)).catch(() => {}));
            try { LB.lbHave.delete(String(rec.uid || rec.sid || '')); } catch(e){}
            try { lbSumDrop(rec.sid, rec.title); } catch(e){}
            try { delete LB.rows[_lbRowsKey(String(rec.uid || ''), rt)]; } catch(e){}
            try { delete _frameMem[rec.sk]; } catch(e){}
            try { diagLog('lbsync 足额|sid=' + 键 + '|order=' + order.length
              + '|留=0|补=' + 补 + '|删=' + 删
              + '|rounds=' + (parseInt(d.rounds) || 0), 'ok'); } catch(e){}
            return;
          }
          const nr = Object.assign({}, rec);
          nr.frame = Object.assign({}, rec.frame, {msgs: kept});
          try {
            if (_frameMem && _frameMem[rec.sk] && Array.isArray(_frameMem[rec.sk].msgs))
              _frameMem[rec.sk].msgs = kept.map(m => m.slice());
          } catch(e){}
          const rounds = lbMirrorMode()
            ? lbMirrorRounds(kept) : lbRoundsFromMsgs(kept);
          const u = String(rec.uid || '').trim()
            || (typeof lbUidPick === 'function'
                ? String(lbUidPick(null, rec.sid, rt) || '') : '');
          try { lbSumSet(u || String(rec.sid || ''), rt, rounds); } catch(e){}
          try { lbRowsPut(u, rt, rounds, true); } catch(e){}
          puts.push(_idbReq('snap_conv', 'readwrite',
            st => st.put(nr)).catch(() => {}));
          try { diagLog('lbsync 足额|sid=' + 键 + '|order=' + order.length
            + '|留=' + 留 + '|补=' + 补 + '|删=' + 删 + '|撤销=' + unfin.size
            + '|rounds=' + (parseInt(d.rounds) || 0), 'ok'); } catch(e){}
        }catch(e){}
      });
      return Promise.all(puts).then(() => { try { lbRepaint(); } catch(e){} });
    }).catch(() => {});
  }catch(e){}
}
if (typeof window !== 'undefined') window.lbSyncApply = lbSyncApply;
function o_unreadIds(arr){
  const out = [];
  arr.forEach(o => { if (o && o.sid && o.status && o.status.unread) out.push(o.sid); });
  return out.length ? out : null;
}

/* think 帧：整屏快照（统筹批复·兼带正文）＋ 排队条子对象（项级 sid/id/text 剥净） */
function ledgerThinkApply(sid, body){
  const b = body || {};
  /* 排队条随 think 包（N1，不独立收发）：项级 sid 过滤（N4 根治串显），
     text 服务端已剥净（N2）、id 仅底层携带（N3，渲染层绝不展示）。 */
  if (Array.isArray(b.pend)){
    const mine = [];
    const _seen = new Set();
    b.pend.filter(it => {
      if (!it || typeof it !== 'object') return false;
      const _m = pendItemMine(it);
      if (_m === true) return true;
      if (typeof pendDidOwn === 'function' && pendDidOwn(it)) return true;
      return _m !== false;
    }).forEach(it => {
      const _raw = (it.text != null) ? String(it.text)
                : (it.t != null ? String(it.t) : '');
      if (it.text != null) it.text = stripPendTail(it.text);
      if (it.t != null) it.t = stripPendTail(it.t);
      let _tx = (it.text != null) ? it.text : it.t;
      if (!String(_tx || '').trim()){
        _tx = (typeof stripHeadDid === 'function') ? stripHeadDid(_raw) : _raw;
        if (it.text != null) it.text = _tx; else it.t = _tx;
      }
      if (!String(_tx || '').trim()) return;
      const k = (typeof pendTxtKey === 'function') ? pendTxtKey(it)
              : String((it.id != null && String(it.id).trim()) ? it.id : _tx);
      if (k && _seen.has(k)) return;
      if (k) _seen.add(k);
      mine.push(it);
    });
    if (!S.snap || typeof S.snap !== 'object') S.snap = {};
    const _sigOf = a => (a || []).map(x => String(x && x.id != null ? x.id : '')
                 + '\u0001' + String(x && x.text != null ? x.text : ((x && x.t) || ''))).join('\u0002');
    const _sigPrev = _sigOf(S.snap && S.snap.pend);
    const _sigNext = _sigOf(mine);
    S.snap.pend = mine;
    S.snap.pend_sid = String(b.pend_sid || sid || '');
    S.convs_key = null;
    let _cleared = false;
    if (typeof pendLandingScan === 'function') _cleared = !!pendLandingScan(null, mine);
    if (_cleared || _sigPrev !== _sigNext
        || typeof _liveLockOn !== 'function' || !_liveLockOn()) renderAll();
  }
  const f = b.frame;
  const _hasMsgs = !!(f && typeof f === 'object' && Array.isArray(f.msgs)
                      && f.msgs.length);   /* 空 msgs 视同瘦帧，绝不清屏 */
  if (b.thinkId || b.anchorMid){
    if (b.done){                       /* 1.076：服务端让位薄帧——思维灯灭，撤卡停报 */
      thinkCardDrop(sid, b);
      renderAll();
      return;                          /* 让位帧无正文，不往下走 */
    }
    if (_hasMsgs){
      if (thinkCardSet(b, sid)) renderAll();
    } else {
      if (thinkCardThinSet(b, sid)){
        /* 只就地刷新思维流卡，不调 renderAll、不重建正文。 */
        thinkCardPaint(thinkCardGet(sid, b.title || ''));
      }
    }
    try { lbThinkPut(sid, b.title || '', thinkCardGet(sid, b.title || '')); } catch(e){}
  }
  if (_hasMsgs){
    onEv('snap_pane', {sid: String(sid || ''), title: b.title || '',
                       msgs: f.msgs, finish: f.finish || null});
    S.lb_foldRounds = 0;                   /* 真画面到手 → 归零（2.183 修2：补发面板已撤§十二-2，状态位保留防渲染 key 漂移） */
  }
}

/* ===== 2.207 思维流展示卡（V1.0 §五「思维流独立编号与分发」，文档现文为准）=====
   服务端 WS桥 0.48 帧字段：sel/sid、uid、title、time、thinkId（含六位版本）、
   thinkVer、anchorMid、frame{msgs,finish,tail}。
   客户端口径：
     · 每会话只留「最新一版」，新版到即覆盖旧版（不存历史版本）；
     · 按服务端隔离（键含 lbSrvTag），换服绝不串；
     · 只作展示，**绝不入账**（不进 ledger_conv、不参与轮次统计、绝不当终极）。 */
let THINK_CARDS = {};          /* 'L<本服>|<稳定键>' → 最新一版（每会话一条） */

function _thinkCardKey(sid, title){
  let k = '';
  try {
    k = (typeof 稳定键 === 'function')
        ? String(稳定键(String(sid || ''), String(title || '')) || '') : '';
  } catch(e){ k = ''; }
  return 'L' + (typeof lbSrvTag === 'function' ? lbSrvTag() : '')
       + '|' + (k || String(sid || ''));
}
function _thinkTitleEq(a, b){
  return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
}
/* 收帧落「最新一版」：版本旧的迟到帧不回退；返回 true＝有变化（需要重画）。 */
/* 1.076 让位：服务端报「本轮终极已定稿、思维灯灭」⇒ 撤该会话展示卡与
   账本底部思维流条（每会话只一条卡，按 sid 反查删除最稳，防同名漂移）。 */
function thinkCardDrop(sid, b){
  try{
    const _s = String(sid || '');
    Object.keys(THINK_CARDS).forEach(k => {
      const c = THINK_CARDS[k];
      if (c && String(c.sid || '') === _s) delete THINK_CARDS[k];
    });
    const t = String((b && b.title) || '').trim();
    if (t && typeof LB === 'object' && LB){
      const u = (typeof lbUidPick === 'function') ? lbUidPick(null, _s, t) : '';
      if (u) delete (LB.thinkBySk || {})[lbStoreKey(u, t)];
    }
  }catch(e){}
}

function thinkCardSet(body, sidHint){
  const b = body || {};
  const sid = String(b.sel || sidHint || '');
  const tid = String(b.thinkId || '');
  if (!sid || !tid) return false;            /* 旧服务端无编号：不建卡（不伪造） */
  const ver = parseInt(b.thinkVer, 10) || 0;
  const key = _thinkCardKey(sid, b.title);
  const old = THINK_CARDS[key];
  const anchor = String(b.anchorMid || '');
  if (old && ver && old.thinkVer && ver < old.thinkVer
      && old.anchorMid === anchor) return false;   /* 迟到旧版：不回退 */
  const f = (b.frame && typeof b.frame === 'object') ? b.frame : {};
  const arr = Array.isArray(f.msgs) ? f.msgs : [];
  const finalMids = new Set();
  arr.forEach(m => {
    if (Array.isArray(m) && lbIsFinalRow(m)){
      const _id = String((m.length > 6 && m[6]) || '').trim();
      if (_id) finalMids.add(_id);
    }
  });
  let _ai = -1;
  if (anchor){
    for (let i = arr.length - 1; i >= 0; i--){
      const m = arr[i];
      if (Array.isArray(m) && m[0] === 'u'
          && String((m.length > 6 && m[6]) || '') === anchor){ _ai = i; break; }
    }
  }
  if (_ai < 0){
    for (let i = arr.length - 1; i >= 0; i--){
      if (Array.isArray(arr[i]) && arr[i][0] === 'u'){ _ai = i; break; }
    }
  }
  let _roundDone = false;
  for (let i = _ai + 1; i < arr.length; i++){
    if (Array.isArray(arr[i]) && lbIsFinalRow(arr[i])){ _roundDone = true; break; }
  }
  if (_roundDone){
    if (old) delete THINK_CARDS[key];          /* final 为准：think 版作废 */
    return !!old;
  }
  let txt = '', textMid = '';
  for (let i = arr.length - 1; i > _ai; i--){
    const m = arr[i];
    if (!Array.isArray(m) || m[0] !== 'a' || !m[1]) continue;
    if (lbIsFinalRow(m)) continue;              /* 终极回复绝不进虚线框 */
    const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
    if (_k8 && _k8 !== 'th') continue;
    const _id = String((m.length > 6 && m[6]) || '').trim();
    if (_id && finalMids.has(_id)) continue;    /* 同 mid 已有 final：think 版作废 */
    txt = String(m[1]); textMid = _id; break;
  }
  if (!txt) txt = String(f.tail || '');
  const tm = (typeof timeFromMid === 'function') ? timeFromMid(anchor) : '';
  if (old && old.thinkId === tid && old.text === txt
      && old.textMid === textMid) return false;   /* 同版重发 */
  THINK_CARDS[key] = {
    srv: (typeof lbSrvKey === 'function' ? lbSrvKey() : ''),
    sid: sid, title: String(b.title || ''), uid: String(b.uid || ''),
    thinkId: tid, thinkVer: ver, anchorMid: anchor, time: tm,
    text: txt, textMid: textMid,
    ts: Date.now()
  };
  return true;
}
function thinkCardThinSet(body, sidHint){
  const b = body || {};
  const sid = String(b.sel || sidHint || '');
  const tid = String(b.thinkId || '');
  if (!sid || !tid) return false;
  const ver = parseInt(b.thinkVer, 10) || 0;
  const key = _thinkCardKey(sid, b.title);
  const old = THINK_CARDS[key];
  const anchor = String(b.anchorMid || '');
  if (old && ver && old.thinkVer && ver < old.thinkVer
      && old.anchorMid === anchor) return false;      /* 迟到旧版：不回退 */
  const txt = (b.text != null) ? String(b.text)
            : (old && old.text != null ? String(old.text) : '');
  if (old && old.thinkId === tid && old.thinkVer === ver
      && old.anchorMid === anchor && old.text === txt) return false;  /* 同版重发 */
  const tm = (typeof timeFromMid === 'function') ? timeFromMid(anchor) : '';
  THINK_CARDS[key] = {
    srv: (typeof lbSrvKey === 'function' ? lbSrvKey() : ''),
    sid: sid, title: String(b.title || ''), uid: String(b.uid || ''),
    thinkId: tid, thinkVer: ver, anchorMid: anchor, time: tm,
    text: txt, textMid: (old && old.textMid) || '',
    ts: Date.now()
  };
  return true;
}
function thinkCardPaint(c){
  try {
    if (!c || !c.thinkId) return;
    try{
      const _lt = (typeof _curConvLight === 'function') ? _curConvLight() : '';
      if (_lt && _lt !== 'busy'){
        const _m = document.getElementById('msgs');
        if (_m) _m.querySelectorAll('.thinklive').forEach(n => n.remove());
        return;
      }
    }catch(e){}
    const box = document.getElementById('msgs');
    if (!box) return;
    const nodes = box.querySelectorAll('.thinklive');
    let _hit = 0;
    for (let i = nodes.length - 1; i >= 0; i--){
      const nd = nodes[i];
      if (String(nd.getAttribute('data-think') || '') !== String(c.thinkId)) continue;
      _hit++;
      if (typeof _thinkCardHtml === 'function') nd.outerHTML = _thinkCardHtml(c);
      else {
        const bd = nd.querySelector('.body');
        if (bd && typeof _mdBody === 'function') bd.innerHTML = _mdBody(String(c.text || ''));
      }
    }
    if (!_hit && typeof _thinkCardHtml === 'function'){
      const ph = box.querySelector('.thinklive.thinkph');
      if (ph){
        const _cs = String((typeof curSid === 'function' ? curSid() : '') || '');
        const _ct = String((typeof curTitle === 'function' ? curTitle() : '') || '');
        const _sameSid = !!c.sid && !!_cs
          && (String(c.sid) === _cs || (typeof 稳定键 === 'function'
              && 稳定键(String(c.sid), '') === 稳定键(_cs, '')));
        const _sameTitle = (typeof _thinkTitleEq === 'function')
          ? _thinkTitleEq(c.title, _ct) : (String(c.title || '') === _ct);
        if (_sameSid || _sameTitle) ph.outerHTML = _thinkCardHtml(c);
      }
    }
  } catch(e){}
}
function thinkCardGet(sid, title){
  return THINK_CARDS[_thinkCardKey(sid, title)] || null;
}
/* 显示判定（§五-8/9/10）：小账本最底部固定挂一条；四维全匹配＋思维灯亮才显示；
   本轮终极（fin=1 的 a 行）一到立即让位。任一条件不满足返回 null。 */
function thinkCardNow(msgs){
  try {
    if ((typeof _curConvLight === 'function' ? _curConvLight() : '') !== 'busy') return null;
    const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
    const ct = String((typeof curTitle === 'function' ? curTitle() : '') || '');
    if (!cs) return null;
    const c = thinkCardGet(cs, ct);                    /* ③会话 ID 匹配（按稳定键取） */
    if (!c) return null;
    if (c.srv && c.srv !== String((typeof lbSrvKey === 'function' ? lbSrvKey() : '')))
      return null;                                     /* ①服务器匹配 */
    if (!c.title || !_thinkTitleEq(c.title, ct)) return null;   /* ②会话名匹配 */
    if (!c.anchorMid) return null;
    const arr = Array.isArray(msgs) ? msgs : [];
    let hi = -1;
    for (let i = arr.length - 1; i >= 0; i--){
      if (Array.isArray(arr[i]) && arr[i][0] === 'u'){ hi = i; break; }
    }
    if (hi < 0) return null;
    const hmid = String((arr[hi].length > 6 && arr[hi][6]) || '').trim();
    if (hmid !== c.anchorMid){
      let _anchInView = false;
      for (let i = 0; i < arr.length; i++){
        const m = arr[i];
        if (Array.isArray(m) && m[0] === 'u'
            && String((m.length > 6 && m[6]) || '').trim() === c.anchorMid){
          _anchInView = true; break;
        }
      }
      if (!_anchInView) return null;
    }
    if (c.textMid){
      for (let i = 0; i < arr.length; i++){
        const m = arr[i];
        if (Array.isArray(m) && (typeof lbFinalHard === 'function'
            ? lbFinalHard(m) : lbIsFinalRow(m))
            && String((m.length > 6 && m[6]) || '') === c.textMid) return null;
      }
    }
    for (let i = hi + 1; i < arr.length; i++){
      const m = arr[i];
      if (!Array.isArray(m) || m[0] !== 'a') continue;
      if ((typeof lbFinalHard === 'function' ? lbFinalHard(m) : lbIsFinalRow(m)))
        return null;   /* ⑩终极回复优先（含提前终极）：立刻撤卡 */
    }
    if (!String(c.text || '').trim()){
      let _ai = -1;
      for (let i = arr.length - 1; i >= 0; i--){
        const m = arr[i];
        if (Array.isArray(m) && m[0] === 'u'
            && String((m.length > 6 && m[6]) || '').trim() === c.anchorMid){
          _ai = i; break;
        }
      }
      if (_ai < 0) _ai = hi;
      for (let i = arr.length - 1; i > _ai; i--){
        const m = arr[i];
        if (!Array.isArray(m) || m[0] !== 'a' || !m[1]) continue;
        if (lbIsFinalRow(m)) continue;
        const _k8 = (m.length > 8 ? String(m[8] || '').trim().toLowerCase() : '');
        if (_k8 && _k8 !== 'th') continue;
        c.text = String(m[1]); break;
      }
    }
    return c;
  } catch(e){ return null; }
}
/* 对账上报（§五-6）：本端掌握的全部思维流编号（sid → thinkId 含版本）。 */
function thinkCardsReport(){
  const out = {};
  const srv = String((typeof lbSrvKey === 'function' ? lbSrvKey() : ''));
  const _cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  const _light = (typeof _curConvLight === 'function' ? _curConvLight() : '');
  Object.keys(THINK_CARDS).forEach(k => {
    const c = THINK_CARDS[k];
    if (!c || !c.sid || !c.thinkId) return;
    if (c.srv && srv && c.srv !== srv) return;         /* 别服的不上报 */
    if (_cs && _light !== 'busy'){
      const _same = (String(c.sid) === _cs)
        || (typeof 稳定键 === 'function'
            && 稳定键(c.sid, '') === 稳定键(_cs, ''));
      if (_same) return;                                /* 思维灯没开：本会话不参与核对 */
    }
    if (Date.now() - (c.ts || 0) > 10 * 60 * 1000) return;
    /* 1.076 兜底：10 分钟无新版＝早已让位（活思维流几秒一版），防让位
       薄帧丢失/服务端重启后的存量残卡造成「左0右1」假差异 */
    out[String(c.sid)] = c.thinkId;
  });
  return out;
}
/* ===== 2.207 思维流展示卡（止）===== */

/* 项级归属判定：true=本会话 / false=别会话 / null=无项级 sid（交回顶层判定） */
function pendItemMine(it){
  if (!it || typeof it !== 'object') return null;
  if (it.sid == null || String(it.sid).trim() === '') return null;
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  if (!cs) return null;
  const s = String(it.sid);
  if (s === cs) return true;
  return !!(typeof 稳定键 === 'function' && 稳定键(s, '') === 稳定键(cs, ''));
}

function pendDidOwn(it){
  if (!it || it.id == null) return false;
  const k = String(it.id);
  const _m = S.pendOwn || (S.pendOwn = {});
  const now = Date.now();
  for (const kk in _m) if (!(now - _m[kk] < 600000)) delete _m[kk];
  if ((S.pending || []).some(p => p && p.did === k)){ _m[k] = now; return true; }
  return !!_m[k];
}

/* ================= ⑥ 本地账本（IDB ledger_conv；按服务端隔离） =================
   键＝'lb|<服务端名>|<终身号>'（2.184 改2·规范§十 :268：键＝终身号，名只作显示）；
   值＝{srv, sid, title, ts, lastView, rounds}。1 轮＝[人类行, 终极行]（沿用快照行
   格式，渲染零换算）。同一会话无论从哪条链路进来（锚定快照/账本补发/核对）
   键必须落到同一条终身上，绝不写一条读另一条。 */
function lbKey(sid, title){
  const s = String(sid || '');
  let k = '';
  try { k = (typeof 稳定键 === 'function') ? String(稳定键(s, String(title || '')) || '') : ''; } catch(e){ k = ''; }
  return 'lb|' + lbSrvKey() + '|' + (k || s);
}
function lbRoundKey(r){
  return (r || []).map(m => {
    const id = String((m && m[6]) || '').trim();
    if (/^[0-9a-fA-F]{8}/.test(id)) return 'M\u0001' + id;
    return ((m && m[0]) || '') + '\u0001'
      + String((m && m[1]) || '').replace(/\s+/g, '').slice(0, 24) + '\u0001'
      + String((m && m[7]) || '').replace(/\s+/g, '').slice(0, 12);
  }).join('#');
}
function _lbKeepRow(m){
  if (!Array.isArray(m) || m.length < 2) return null;
  const role = String(m[0] == null ? '' : m[0]).toLowerCase();
  if (role !== 'u' && role !== 'a') return null;
  if (/^th:/i.test(String(m[6] || ''))) return null;
  const k = String((m.length > 8 && m[8]) || '').trim().toLowerCase();
  if (k === 'q' || k === 'queue') return null;      /* 排队条永不落盘 */
  const _fin7 = String((m.length > 7 && m[7]) || '').trim();
  const _真终答 = !!_fin7 && _fin7 !== '补记'
    && _fin7 !== '提前终极' && _fin7 !== '账本定稿';
  if (k === 'th' || k === 'think' || k === 'snap'){
    if (!(role === 'a' && _真终答)) return null;
  }
  if (role === 'a'){
    if (lbPureThink(m)) return null;
    if (!k && !_真终答) return null;   /* 无类型又无终答 ⇒ 按思维流丢 */
  }
  const row = m.slice();
  row[0] = role;                       /* 角色也归一为小写 u/a */
  row[8] = (role === 'u') ? 'u' : 'a'; /* 类型归一，消除「类型未知」 */
  return row;
}
function _lbMirrorKeepRow(m){
  if (!Array.isArray(m) || m.length < 2) return null;
  const role = String(m[0] == null ? '' : m[0]).toLowerCase();
  if (role !== 'u' && role !== 'a') return null;
  const row = m.slice();
  row[0] = role;
  return row;
}
function lbMirrorRounds(msgs){
  const rounds = [];
  let cur = null;
  (msgs || []).forEach(m0 => {
    const m = _lbMirrorKeepRow(m0);
    if (!m) return;
    if (m[0] === 'u'){
      if (cur && cur.length) rounds.push(cur);
      cur = [m];
    } else {
      if (cur) cur.push(m);
      else rounds.push([m]);
    }
  });
  if (cur && cur.length) rounds.push(cur);
  return rounds;
}
function _lbCleanMsgs(msgs){
  const src = Array.isArray(msgs) ? msgs : [];
  const out = [];
  let changed = false;
  src.forEach(m => {
    const k = _lbKeepRow(m);
    if (!k){ changed = true; return; }
    if (k.length !== m.length || String(k[8]) !== String(m[8])) changed = true;
    out.push(k);
  });
  return {msgs: out, changed: changed};
}
function lbRoundsFromMsgs(msgs){
  const rounds = [];
  let cur = null;
  (msgs || []).forEach(m0 => {
    const m = _lbKeepRow(m0);
    if (!m) return;
    if (m[0] === 'u'){
      if (cur && cur.length) rounds.push(cur);       /* 半轮也落 */
      cur = [m.slice()];
    } else if (m[0] === 'a'){
      if (String((m.length > 8 && m[8]) || '').toLowerCase() === 'th') return;
      if (/^th:/i.test(String(m[6] || '')) || lbPureThink(m)) return;
      const fin = String((m.length > 7 && m[7]) || '').trim();
      const patch = lbPatchMarked(m);
      /* '提前终极'/'补记'/'账本定稿' 是来源标记不是正文，正文保留原文
         （2.212 口径；2.272 增 '账本定稿'——服务端 ledger 补发用它标 fin=1，
         原样当正文会把 AI 终极回复顶成四个字）。 */
      const _disp = (fin && fin !== '补记' && fin !== '提前终极'
                     && fin !== '账本定稿')
        ? fin : (m[1] || '');
      const row = [m[0], _disp, '', 0, 0, '', m[6] || '',
                   fin || (patch ? '补记' : ''),
                   String(m[8] || ''),          /* 类型照抄后端 index8，不推断 */
                   m[9] || ''];                 /* 账本行不存时间（index2 恒空） */
      if (cur) cur.push(row);
      else rounds.push([row]);                      /* 无人类行的 AI 行原位保留 */
    }
  });
  if (cur && cur.length) rounds.push(cur);
  return rounds;
}
function lbLedgerTrimRounds(rounds, key, quiet){
  if (lbMirrorMode()) return Array.isArray(rounds) ? rounds : [];
  const n = lbRounds();
  const arr = Array.isArray(rounds) ? rounds : [];
  const seen = new Set(), uniq = [];
  arr.forEach(r => {
    if (!Array.isArray(r) || !r.length) return;
    const k = lbRoundKey(r);
    if (seen.has(k)) return;
    seen.add(k); uniq.push(r);
  });
  if (uniq.length <= n) return uniq;
  const out = uniq.slice(-n);
  if (!quiet){
    try { diagLog('账本裁剪|键=' + String(key || '') + '|裁前=' + uniq.length
      + '|裁后=' + n, 'ok'); } catch(e){}
  }
  return out;
}
function lbTrimFrameMsgs(msgs, key, quiet){
  const arr = Array.isArray(msgs) ? msgs : [];
  if (lbMirrorMode()) return arr;
  if (!arr.length) return arr;
  const groups = [];
  let cur = null;
  arr.forEach(m => {
    if (!Array.isArray(m)) return;
    if (m[0] === 'u'){
      if (cur && cur.length) groups.push(cur);
      cur = [m];
    } else if (cur){
      cur.push(m);                      /* AI 终极/思维流等随当前轮 */
    } else {
      groups.push([m]);                 /* 人类行之前的孤立行单列一组，绝不丢 */
    }
  });
  if (cur && cur.length) groups.push(cur);
  const kept = lbLedgerTrimRounds(groups, key, true);
  if (kept.length < groups.length && !quiet){
    try { diagLog('预备画面裁剪|键=' + String(key || '') + '|裁前=' + groups.length
      + '|裁后=' + kept.length, 'ok'); } catch(e){}
  }
  const out = [];
  kept.forEach(g => g.forEach(m => out.push(m.slice())));
  return out;
}
function lbResolveTitle(sid, title){
  const t = String(title || '').trim();
  if (t && !/^\d+$/.test(t)) return t;
  try {
    const s = String(sid || '');
    if (s && Array.isArray(S.convs)){
      const ks = (typeof 稳定键 === 'function') ? 稳定键(s, '') : null;
      for (const r of S.convs){
        if (!r || !r[1]) continue;
        const rs = String(r[4] || '');
        if (rs === s || (ks !== null && 稳定键(rs, '') === ks)) return String(r[1]);
      }
    }
  } catch(e){}
  return title || '';
}
function lbDiagTitle(sid, title){
  const t = String(title || '').trim();
  if (t) return {title: t, diag: 0};
  const s = String(sid || '').trim();
  return {title: s ? ('（无名）' + s.slice(-6)) : '（无名）无sid', diag: 1};
}
function lbLedgerSnapKey(sid, title){
  const s = String(sid || ''), t = String(title || '').trim();
  let u = '';
  try { u = String((typeof lbUidPick === 'function') ? (lbUidPick(null, s, t) || '') : '').trim(); } catch(e){ u = ''; }
  const k = /^\d{4}$/.test(u) ? u
    : ((typeof 稳定键 === 'function') ? (String(稳定键(s, t) || '') || s || t) : (s || t));
  return (typeof _frameMemKey === 'function') ? String(_frameMemKey(k) || '') : ('frame|' + k);
}
function lbWriteBackSnap(sid, title, rounds){
  try {
    if (!Array.isArray(rounds) || !rounds.length) return;
    if (typeof _frameCommit !== 'function' || typeof _frameMemKey !== 'function') return;
    const s = String(sid || '');
    const t = String(title || '').trim();
    if (!t) return;                       /* 改7：名称必有——无标题不写秒显 */
    const sk = lbLedgerSnapKey(s, t);
    if (!sk) return;
    const _uidAuth = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : '';
    const rows = [];
    rounds.forEach(r => (r || []).forEach(m => { if (Array.isArray(m)) rows.push(m.slice()); }));
    if (!rows.length) return;
    const _rows = lbTrimFrameMsgs(rows, sk, true);
    if (!_rows.length) return;
    const frame = {msgs: _rows, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [],
                   model: ''};
    const _oldMsgs = (typeof _frameMem === 'object' && _frameMem[sk]
      && Array.isArray(_frameMem[sk].msgs)) ? _frameMem[sk].msgs
      : (S.liveFrame && Array.isArray(S.liveFrame.msgs)
         && (!S.livePend || (typeof _frameMemKey === 'function' && _frameMemKey(S.livePend) === sk))
         ? S.liveFrame.msgs : null);
    const _oldN = (_oldMsgs && typeof lbRoundsFromMsgs === 'function')
      ? lbRoundsFromMsgs(_oldMsgs).length : 0;
    const _newN = Array.isArray(rounds) ? rounds.length : 0;
    _frameCommit(sk, frame,
      {key: (typeof frameKey === 'function') ? frameKey() : '',
       port: S.port, sid: s, uid: _uidAuth, title: String(title || ''), ts: Date.now()},
      undefined, undefined, (_oldN > 0 && _newN >= _oldN));
  } catch(e){}
}
function _lbHistCtx(){
  try {
    const key = String(S.histConv || '').trim();
    if (!key) return null;
    const cv = (S.snap && Array.isArray(S.snap.convs)) ? S.snap.convs : [];
    for (const r of cv){
      if (!Array.isArray(r) || r[0] !== 'c') continue;
      const t = String(r[1] || '').trim(), s = String(r[4] || '');
      if (!t) continue;
      let kk = '';
      try { kk = (typeof 稳定键 === 'function') ? String(稳定键(s, t) || '') : t; } catch(e){ kk = t; }
      if (kk === key || t === key || (s && s === key))
        return {sid: s, title: t};
    }
    /* 锚定兜底：稳定键（无号会话）本来就等于名称，直接用历史键当名称，
       绝不用 curTitle() 的「当前会话」——那会另起一本「当前会话」账。 */
    const at = String(S.anchorTitle || '').trim();
    if (at && at === key) return {sid: String(S.anchorFull || ''), title: at};
    if (!/^\d+$/.test(key) && key.length <= 60)
      return {sid: String(S.anchorFull || ''), title: key};
  } catch(e){}
  return null;
}
function lbHistToLedger(older){
  try{
    if (typeof lbMirrorMode === 'function' && lbMirrorMode()) return;
    const raw = Array.isArray(S.histRaw) ? S.histRaw : [];
    if (!raw.length) return;
    if (typeof ledToArr !== 'function' || typeof _frameCommit !== 'function') return;
    if (typeof _frameMemKey !== 'function' || typeof lbLedgerSnapKey !== 'function') return;
    const ctx = _lbHistCtx();
    if (!ctx) return;                 /* 认不出这会话：宁可不写，绝不拿「当前会话」另起一本 */
    const sid = String(ctx.sid || '');
    const title = String(ctx.title || '').trim();
    if (!title) return;                       /* 改7：名称必有 */
    const sk = lbLedgerSnapKey(sid, title);   /* 与核对账本同一个键（终身号优先） */
    if (!sk) return;
    const rows = [];
    raw.forEach(function(x){
      const m = ledToArr(x);
      if (Array.isArray(m) && m.length) rows.push(m);
    });
    if (!rows.length) return;
    const _write = function(oldMsgs){
    let old = Array.isArray(oldMsgs) ? oldMsgs : [];
    const seen = new Set(), idx = {}, out = [];
    const push = function(list){
      (list || []).forEach(function(m){
        if (!Array.isArray(m) || !m.length) return;
        let k = '';
        try { k = (typeof lbRoundKey === 'function') ? lbRoundKey([m]) : ''; } catch(e){ k = ''; }
        if (!k) k = String(m[0] || '') + '|' + String(m[1] || '').slice(0, 24);
        if (seen.has(k)){
          const i = idx[k];
          if (i != null && out[i] && !String(out[i][7] || '').trim()
              && String(m[7] || '').trim()) out[i] = m.slice();
          return;
        }
        seen.add(k); idx[k] = out.length; out.push(m.slice());
      });
    };
    if (older){ push(rows); push(old); } else { push(old); push(rows); }
    const trimmed = lbTrimFrameMsgs(out, sk, true);      /* ← 前 N 轮裁剪，够进才留 */
    if (!trimmed.length) return;
    const frame = {msgs: trimmed, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [], model: ''};
    const _uid = (typeof lbUidPick === 'function') ? lbUidPick(null, sid, title) : '';
    _frameCommit(sk, frame,
      {key: (typeof frameKey === 'function') ? frameKey() : '',
       port: S.port, sid: sid, uid: _uid, title: title, ts: Date.now()},
      undefined, undefined, false);
    /* 屏幕同源：内存 rows 同步，补进来的历史立刻能被 lbScreenMsgs / curMsgs 读到 */
    try {
      const rounds = lbRoundsFromMsgs(trimmed);
      if (rounds.length && typeof lbRowsPut === 'function') lbRowsPut(_uid, title, rounds);
    } catch(e){}
    };
    let memOld = null;
    try {
      if (typeof _frameMem === 'object' && _frameMem[sk] && Array.isArray(_frameMem[sk].msgs))
        memOld = _frameMem[sk].msgs;
      else if (S.liveFrame && Array.isArray(S.liveFrame.msgs)
               && (!S.livePend || _frameMemKey(S.livePend) === sk)) memOld = S.liveFrame.msgs;
    } catch(e){ memOld = null; }
    if (memOld && memOld.length){ _write(memOld); return; }
    if (typeof _idbReq === 'function'){
      _idbReq('snap_conv', 'readonly', function(st){ return st.get(sk); }).then(function(rec){
        _write((rec && rec.frame && rec.frame.msgs) || null);
      }).catch(function(){ _write(null); });
      return;
    }
    _write(null);
  } catch(e){}
}
function _lbMergeFinals(local, msgs){
  try{
    if (!Array.isArray(msgs) || !msgs.length) return msgs;
    if (!Array.isArray(local) || !local.length) return msgs;
    /* 本地账：人类 mid → 该轮的 AI 行（只认带正式 mid 的轮，没 mid 无法对齐） */
    const want = {};
    let curKey = '';
    local.forEach(m => {
      if (!Array.isArray(m)) return;
      if (m[0] === 'u'){ curKey = String(m[6] || '').trim(); return; }
      if (m[0] === 'a' && curKey) (want[curKey] = want[curKey] || []).push(m);
    });
    if (!Object.keys(want).length) return msgs;
    /* 屏上哪些轮已有 AI 行 */
    const hasA = {};
    let lastU = '';
    msgs.forEach(m => {
      if (!Array.isArray(m)) return;
      if (m[0] === 'u'){ lastU = String(m[6] || '').trim(); return; }
      if (m[0] === 'a' && lastU) hasA[lastU] = true;
    });
    const out = msgs.slice();
    let addN = 0;
    for (let i = out.length - 1; i >= 0; i--){
      const m = out[i];
      if (!Array.isArray(m) || m[0] !== 'u') continue;
      const mid = String(m[6] || '').trim();
      if (!mid || hasA[mid] || !want[mid]) continue;
      let j = i;
      for (let k = i + 1; k < out.length; k++){
        if (Array.isArray(out[k]) && out[k][0] === 'u') break;
        j = k;
      }
      const add = want[mid].map(x => x.slice());
      out.splice.apply(out, [j + 1, 0].concat(add));
      hasA[mid] = true;
      addN += add.length;
    }
    return addN ? out : msgs;
  }catch(e){ return msgs; }
}
function lbFillFinals(sid, title, msgs){
  try{
    if (!Array.isArray(msgs) || !msgs.length) return msgs;
    const s = String(sid || ''), t = String(title || '').trim();
    let local = null;
    try {
      const _leg = (typeof 稳定键 === 'function')
        ? (String(稳定键(s, t) || '') || s || t) : (s || t);
      const sk = (typeof snapKeyOf === 'function') ? snapKeyOf(s, t)
        : ((typeof _frameMemKey === 'function') ? _frameMemKey(_leg) : '');
      const _legSk = (typeof _frameMemKey === 'function') ? _frameMemKey(_leg) : '';
      if (sk && typeof _frameMem === 'object' && _frameMem[sk]
          && Array.isArray(_frameMem[sk].msgs)) local = _frameMem[sk].msgs;
      if (!local && _legSk && _legSk !== sk && typeof _frameMem === 'object'
          && _frameMem[_legSk] && Array.isArray(_frameMem[_legSk].msgs))
        local = _frameMem[_legSk].msgs;
      if (!local && S.liveFrame && Array.isArray(S.liveFrame.msgs)){
        const _lp = String(S.livePend || S.anchorSid || '');
        if (!_lp || (typeof _frameMemKey === 'function'
                     && (_frameMemKey(_lp) === sk || _frameMemKey(_lp) === _legSk)))
          local = S.liveFrame.msgs;
      }
    } catch(e){}
    const out = _lbMergeFinals(local, msgs);
    try { if (out !== msgs && typeof diagLog === 'function')
      diagLog('喂终答|' + (t || s) + '|补 ' + (out.length - msgs.length) + ' 条', 'ok'); } catch(e){}
    return out;
  }catch(e){ return msgs; }
}
const _lbFillAsyncAt = {};
function lbFillFinalsAsync(sid, title){
  try{
    if (typeof _idbReq !== 'function' || typeof _frameMemKey !== 'function') return;
    const s = String(sid || ''), t = String(title || '').trim();
    const key = (typeof 稳定键 === 'function') ? (String(稳定键(s, t) || '') || s || t) : (s || t);
    if (!key) return;
    const _legSk = _frameMemKey(key);
    const sk = (typeof snapKeyOf === 'function') ? snapKeyOf(s, t) : _legSk;
    const now = Date.now();
    if (_lbFillAsyncAt[sk] && now - _lbFillAsyncAt[sk] < 600) return;
    _lbFillAsyncAt[sk] = now;
    _idbReq('snap_conv', 'readonly', st => st.get(sk)).then(rec => {
      if ((!rec || !rec.frame) && _legSk && _legSk !== sk)
        return _idbReq('snap_conv', 'readonly', st => st.get(_legSk))
          .then(r2 => r2 || rec, () => rec);
      return rec;
    }).then(rec => {
      const loc = (rec && rec.frame && Array.isArray(rec.frame.msgs)) ? rec.frame.msgs : null;
      if (!loc || !loc.length) return;
      /* 读盘回来再验一次锚定：已切走就只回填内存槽、不动屏幕 */
      const _onScreen = (String(S.anchorSid || '') === key
                         || String(S.anchorTitle || '') === t);
      const _lv = !!(S.liveFrame && Array.isArray(S.liveFrame.msgs) && S.liveFrame.msgs.length);
      const target = _lv ? S.liveFrame.msgs
                         : ((S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : null);
      const out = (target && target.length) ? _lbLedgerTop(loc, target) : loc;
      if (!out || !out.length) return;
      /* 内存槽同步成账本这一份（切回 0ms 命中且与账本一致） */
      try {
        const f = {online: !!(S.snap && S.snap.online), login: (S.snap && S.snap.login),
                   msgs: out, finish: null, tail: '', sendIdle: true,
                   inputText: '', opts: [], ask: null, pend: [], model: '',
                   _srv: (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : ''};
        _frameMem[sk] = f;
        if (t) _frameMemByTitle[_frameTitleKey(t)] = f;
      } catch(e){}
      try {
        if (typeof lbRowsPut === 'function' && typeof lbRoundsFromMsgs === 'function')
          lbRowsPut((typeof lbUidPick === 'function' ? (lbUidPick(null, s, t) || '') : ''),
                    t, lbRoundsFromMsgs(out), true);
      } catch(e){}
      /* 先落盘：同一份写回唯一账（只进不退；内容未变时闸门自然拒收，无副作用） */
      try {
        if (typeof _frameCommit === 'function')
          _frameCommit(sk, {online: !!(S.snap && S.snap.online),
            login: (S.snap && S.snap.login), msgs: out, finish: null, tail: '',
            sendIdle: true, inputText: '', opts: [], ask: null, pend: [], model: ''},
            {key: (typeof frameKey === 'function') ? frameKey() : '',
             port: S.port, sid: s, title: String(title || ''), ts: Date.now()});
      } catch(e){}
      if (!_onScreen || target === out) return;
      /* 再显示：主界面＝小账本这一份 */
      if (_lv) S.liveFrame.msgs = out; else S.snap.msgs = out;
      try { diagLog('账本顶屏|' + (t || key) + '|' + out.length + '行', 'ok'); } catch(e){}
      renderAll();
    }).catch(() => {});
  }catch(e){}
}
function _lbLedgerTop(loc, target){
  try{
    const out = [], seen = {};
    loc.forEach(m => {
      if (!Array.isArray(m)) return;
      const k = _msgKey(m);
      if (seen[k]) return;
      seen[k] = 1; out.push(m);
    });
    let maxMid = '';
    loc.forEach(m => {
      const d = String((m && m[6]) || '');
      if (_midIsFormal(d) && d > maxMid) maxMid = d;
    });
    target.forEach(m => {
      if (!Array.isArray(m)) return;
      const k = _msgKey(m);
      let at = -1;
      for (let i = 0; i < out.length; i++){ if (_msgKey(out[i]) === k){ at = i; break; } }
      if (at >= 0){
        const ot = String(out[at][1] || ''), nt = String(m[1] || '');
        const _ok = String((out[at].length > 8 && out[at][8]) || '').toLowerCase();
        const _nk = String((m.length > 8 && m[8]) || '').toLowerCase();
        if (_nk === 'a' && _ok !== 'a'){ out[at] = m; return; }
        if (_ok === 'a' && _nk === 'a'){
          if (lbCharN(m[1] || '') !== lbCharN(out[at][1] || '')) out[at] = m;
          return;
        }
        if (nt.length > ot.length) out[at] = m;
        return;
      }
      /* 只收账本里没有的新行：有正式 mid 且比账本末条更新；无 mid 行不补（防历史重复） */
      const d = String((m && m[6]) || '');
      if (_midIsFormal(d) && d > maxMid) out.push(m);
    });
    return out;
  }catch(e){ return loc; }
}
function lbBootMerge(sid, title){
  try{
    const s = String(sid || '');
    const t = String(title || '').trim();
    if (!s && !t) return;
    if (typeof renderAll !== 'function') return;
    const _rows = (typeof lbScreenMsgs === 'function') ? lbScreenMsgs(s, t) : [];
    if (!_rows.length) return;
    if (S.anchorSid){
      const _k2 = (typeof 稳定键 === 'function') ? String(稳定键(s, t) || '') : '';
      if (_k2 && S.anchorSid !== _k2) return;
    }
    S.liveFrame = null; S.msgs_key = '';
    renderAll();
    return;
  }catch(e){}
}
const _lbPurgedSk = {};
function lbMigrateTitle(sid, title){
  return new Promise(res => {
    try {
      const s = String(sid || '').trim(), t = String(title || '').trim();
      if (!s || !t) return res(false);
      const _mu = (typeof lbUidPick === 'function') ? lbUidPick(null, s, t) : '';
      const skTmp = lbStoreKey('', t);               /* 临时键＝L<本服>:t:<名称> */
      const skSid = lbStoreKey(_mu || '', t);        /* 与落账同键（权威 uid 优先） */
      if (skSid === skTmp) return res(false);
      Promise.resolve([]).then(all => {
        const rows = all || [];
        const cur = rows.find(r => !lbIsLegacyRec(r) && r.sk === skSid);
        const tmps = rows.filter(r => !lbIsLegacyRec(r) && r.sk !== skSid
          && (r.sk === skTmp
              || (String(r.title || '').trim() === t && !lbUidAuth(r.uid))));
        if (!tmps.length) return res(false);
        const base = (cur && Array.isArray(cur.rounds)) ? cur.rounds.slice() : [];
        const seen = new Set(base.map(lbRoundKey));
        tmps.forEach(tmp => (tmp.rounds || []).forEach(r => {
          const rk = lbRoundKey(r);
          if (!seen.has(rk)){ seen.add(rk); base.push(r); }
        }));
        const out = base.slice();          /* 归并也不按保留轮数裁剪 */
        const maxNum = (a, b) => Math.max(Number(a) || 0, Number(b) || 0);
        let _think = (cur && cur.think) || null;
        tmps.forEach(tmp => { if (tmp.think && (!_think || (tmp.ts || 0) > (Number(cur && cur.ts) || 0))) _think = tmp.think; });
        const rec = {
          sk: skSid, srv: lbSrvTag(), srvName: lbSrvName(), srvFox: lbSrvFox(),
          uid: _mu || '', sid: s,                 /* 四字段：uid 终身号 / sid 对话ID */
          title: t,                                  /* 改8：改名归并——以现名为准 */
          ts: maxNum(cur && cur.ts, tmps.reduce((m, x) => Math.max(m, x.ts || 0), 0)) || Date.now(),
          lastTs: maxNum(cur && cur.lastTs, tmps.reduce((m, x) => Math.max(m, x.lastTs || 0), 0)),
          lastView: maxNum(cur && cur.lastView, tmps.reduce((m, x) => maxNum(m, x.lastView || 0), 0)),
          pend: (_mu || name) ? 0 : 1, rounds: out
        };
        if (_think) rec.think = _think;
        const sks = tmps.map(x => x.sk);
        const tmpTitles = tmps.map(x => String(x.title || '').trim()).filter(Boolean);
        return Promise.resolve()
          .then(() => {
            /* 临时键摘要全部撤掉（含历史遗留的旧名），换终身号键 */
            tmpTitles.forEach(tt => { try { delete LB.lbSum[tt]; } catch(e){} });
            try { delete LB.lbSum[(cur && cur.title) || '']; } catch(e){}
            try { if (s) delete LB.lbSum[s]; } catch(e){}
            lbSumSet(s, t, out);
            LB.lbHave.add(_mu || s);
            lbWriteBackSnap(s, t, out);              /* 秒显写正式键 */
            /* 秒显临时键（旧名的名称键）删掉：内存槽 + IDB，防同一会话两份秒显。
               2.214：现名 t 的秒显刚写回，绝不删（旧实现会把刚写的这份一起删）。 */
            try {
              tmpTitles.forEach(tt => {
                if (tt === t) return;
                const mk = (typeof _frameMemKey === 'function') ? _frameMemKey(tt) : '';
                if (mk){
                  try { if (_frameMem && typeof _frameMem === 'object') delete _frameMem[mk]; } catch(e){}
                  _idbReq('snap_conv', 'readwrite', st => st.delete(mk)).catch(() => {});
                }
              });
            } catch(e){}
            try { diagLog('临时账本并入终身号 sid=' + s + ' · ' + t, 'ok'); } catch(e){}
            try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
            res(true);
          });
      }).catch(() => res(false));
    } catch(e){ res(false); }
  });
}
function lbNormTitle(t){
  let s = String(t == null ? '' : t).trim();
  if (!s) return '';
  s = s.replace(/\s*（临时）\s*$/, '').replace(/\s*（按名称）\s*$/, '');
  s = s.replace(/\s*[·・]?\s*(重复|副本|duplicate)\s*$/i, '');
  s = s.replace(/\s*[（(]\s*\d+\s*[）)]\s*$/, '');
  s = s.replace(/\s*_\d+\s*$/, '');
  return s.trim() || String(t || '').trim();
}
function lbMergeForConv(sid, title){
  return Promise.resolve(false);
}
function lbThinkRowOf(c){
  if (!c) return null;
  const txt = String(c.text || '').trim();
  if (!txt) return null;
  return ['th', txt, '', 0, 0, '', String(c.textMid || c.anchorMid || ''), '', 'th', ''];
}
function lbThinkPut(sid, title, c){
  try {
    const row = lbThinkRowOf(c);
    const t = String(title || '').trim();
    if (!row || !t) return Promise.resolve(false);
    const u = lbUidPick(null, String(sid || '').trim(), t);
    const sk = lbStoreKey(u, t);
    if (typeof LB === 'object' && LB){
      if (!LB.thinkBySk || typeof LB.thinkBySk !== 'object') LB.thinkBySk = {};
      LB.thinkBySk[sk] = row;
    }
    try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
    return Promise.resolve(true);
  } catch(e){ return Promise.resolve(false); }
}
/* 展示口径（账本最后一屏/最底部）：轮次在前，思维流固定最后一条。 */
function lbLedgerDisplayRows(rec){
  const out = [];
  ((rec && rec.rounds) || []).forEach(r => (r || []).forEach(m => {
    if (Array.isArray(m)) out.push(m);
  }));
  if (rec && Array.isArray(rec.think)) out.push(rec.think);
  return out;
}
let _lbUnextT = 0;
function _lbUnextLog(a){
  const now = Date.now();
  if (now - _lbUnextT < 10000) return;
  _lbUnextT = now;
  try { diagLog('未认证终极 弃收 mid=' + String((a && a[6]) || ''), 'bad'); } catch(e){}
}
function lbOldFromSnaps(uid, title){
  const u = String(uid || '').trim();
  const t = String(title || '').trim();
  if (!u && !t) return Promise.resolve(null);
  const tag = (typeof lbSrvTag === 'function') ? String(lbSrvTag()) : '';
  return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
    let hit = null;
    (rows || []).forEach(rec => {
      try {
        if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs) || !rec.frame.msgs.length) return;
        if (tag && rec.srv && String(rec.srv) !== tag) return;
        const ru = String(rec.uid || '').trim();
        const rt = String(rec.title || '').trim();
        if (!((u && ru && ru === u) || (t && rt === t))) return;
        if (!hit || (Number(rec.ts) || 0) > (Number(hit.ts) || 0)) hit = rec;
      } catch(e){}
    });
    if (!hit) return null;
    const ht = String(hit.title || t).trim();
    return {sk: lbStoreKey(u, ht), uid: hit.uid || u, sid: String(hit.sid || ''),
            title: ht, ts: Number(hit.ts) || 0, lastTs: Number(hit.ts) || 0,
            lastView: 0, diag: 0, rounds: lbRoundsFromMsgs(hit.frame.msgs)};
  }).catch(() => null);
}
function ledgerStorePut(sid, title, rounds, opt){
  try {
    opt = opt || {};
    title = lbResolveTitle(sid, title);
    const _dt = lbDiagTitle(sid, title);
    title = _dt.title;
    const _diag = _dt.diag;
    const _t = String(title || '').trim();
    if (_diag){
      try { diagLog('收到无名条目（诊断口不设限）→ 已建诊断账本 title='
        + _t + ' sid=' + String(sid || ''), 'bad'); } catch(e){}
    }
    const _rs0 = (rounds || []).map(r => {
      const rows = (r || []).map(_lbKeepRow).filter(Boolean);
      return rows.length ? rows : null;
    }).filter(Boolean);
    if (!_rs0.length) return;
    const _rawSid = String(sid || '').trim();
    const _fakeSid = /^\d{10}$/.test(_rawSid);
    if (!_rawSid){
      try { diagLog('缺 sid（对话ID）账本登记 · ' + _t, 'bad'); } catch(e){}
    } else if (_fakeSid){
      try { diagLog('10 位纯数字不当会话编号/终身号（B5）sid=' + _rawSid + ' · ' + _t, 'bad'); } catch(e){}
    }
    const _uid = _fakeSid ? '' : lbUidPick(opt.uid, _rawSid, _t);
    if (_uid) lbAliasSet(_uid, _t);                       /* （B3）：写名字→编号映射 */
    const _dialogSid = _fakeSid ? '' : (_rawSid || lbRawSidOf(_uid, _t));
    _rs0.forEach(rows => rows.forEach(row => {
      if (!Array.isArray(row)) return;
      row[2] = '';
    }));
    const _run = (_effSid) => {
    const _uidEff = String(_effSid || '').trim();          /* 登记主键＝终身号 */
    const sk = lbStoreKey(_uidEff, _t), now = Date.now();
    const rs = _rs0.slice();                               /* 落账不再按保留轮数裁剪 */
    /* put 成功之后的统一收口（2.184 改4：真存记账必须晚于落盘成功，
       原实现 put 前就 add＝落盘失败也假报「有账」）：真存集 + 摘要表 + 秒显回写。 */
    const _after = (out) => {
      if (_uidEff) LB.lbHave.add(_uidEff);
      lbSumSet(_uidEff, _t, out);
      lbRowsPut(_uidEff, _t, out);
      try { lbRepaint(); } catch(e){}
      lbWriteBackSnap(_uidEff, _t, out);                   /* 改1：最新账本立刻回写秒显源 */
      try { lbMergeForConv(_dialogSid, _t); } catch(e){}
      /* 改6（2.17 查看器）：落盘成功即通知「📒 我的小账本」卡片列表重排
         （仅 ③ 页可见时由查看器自己刷，未开页时是个空钩子，零开销） */
      try { if (typeof window.cvLbDirty === 'function') window.cvLbDirty(); } catch(e){}
      return out;
    };
    const _apply = (old) => {
      let out = rs;
      const _incU = new Map();
      rs.forEach(r => {
        const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
        if (k) _incU.set(k, r);
      });
      const _oldRounds = (old && Array.isArray(old.rounds)) ? old.rounds : null;
      if (_oldRounds && _oldRounds.length
          && (_oldRounds.length > rs.length || _incU.size)){
        const _keepOld = [];
        _oldRounds.forEach(r => {
          const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
          const inc = k ? _incU.get(k) : null;
          if (!inc){ _keepOld.push(r); return; }
          if (inc.length >= r.length) return;    /* 新轮更厚：旧半轮让位 */
          if (_lbSameMidDiffN(r, inc)) return;
          _incU.delete(k);                       /* 旧轮更厚：新半轮不并入 */
          _keepOld.push(r);
        });
        if (_oldRounds.length > rs.length){
          /* 旧账更厚（翻页/补发攒过）⇒ 旧轮打底、新轮按身份并入，再截尾 N 轮。
             2.184 改3：轮身份改 mid 优先（lbRoundKey），同文本不同轮不再互吞。
             2.185（老板令·旧脏数据自愈）：同 key 的旧轮与新轮不同态（旧记录是
             思维流/未认证版）⇒ 一律用新轮覆盖成已认证终极版，绝不因「mid 已
             见过」把终极挡在门外。 */
          const incMap = new Map();
          rs.forEach(r => incMap.set(lbRoundKey(r), r));
          out = _keepOld.map(r => incMap.get(lbRoundKey(r)) || r);
        } else {
          out = _keepOld.length ? _keepOld.slice() : rs.slice();
        }
        const seen = new Set(out.map(lbRoundKey));
        const _uSeen = new Set(out.map(r =>
          String((Array.isArray(r) && r[0] && r[0][6]) || '')).filter(Boolean));
        rs.forEach(r => {
          const k = String((Array.isArray(r) && r[0] && r[0][6]) || '');
          if (k && _uSeen.has(k)) return;
          const rk = lbRoundKey(r);
          if (seen.has(rk)) return;
          seen.add(rk);
          out.push(r);
        });
      }
      out = out.map((r, i) => [r, i,
        /^[0-9a-fA-F]{8}/.test(String((Array.isArray(r) && r[0] && r[0][6]) || '').trim())
          ? String(r[0][6]).toLowerCase() : ''])
        .sort((a, b) => {
          if (a[2] && b[2] && a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
          return a[1] - b[1];
        }).map(x => x[0]);
      out = lbLedgerTrimRounds(out, sk);
      const _same = !!opt.touch && Array.isArray(old.rounds)
        && old.rounds.length === out.length
        && old.rounds.map(lbRoundKey).join('|') === out.map(lbRoundKey).join('|');
      const _ts = _same ? (Number(old.ts) || now) : now;
      return Promise.resolve().then(() => _after(out));
    };
    lbOldFromSnaps(_uidEff, _t).then(rec => _apply(rec || {}));
    };
    const _dispatch = () => {
      if (_uid){ _run(_uid); return; }
      lbOldFromSnaps('', _t).then(hit => {
        _run(hit ? lbUidPick(hit.uid, hit.sid, hit.title || _t) : '');
      }).catch(() => _run(''));
    };
    if (_uid) lbMigrateTitle(_uid, _t).then(_dispatch, _dispatch);
    else _dispatch();
  } catch(e){}
}
function lbHumanRecNorm(rec){
  const o = {text: '', mid: '', did: ''};
  if (Array.isArray(rec)){
    o.text = String(rec[1] == null ? '' : rec[1]);
    o.mid  = String(rec[6] == null ? '' : rec[6]);
    o.did  = String(rec[9] == null ? '' : rec[9]);
  } else if (rec && typeof rec === 'object'){
    o.text = String(rec.text != null ? rec.text
                    : (rec.t != null ? rec.t : (rec.body != null ? rec.body : '')));
    o.mid  = String(rec.mid != null ? rec.mid
                    : (rec.msgId != null ? rec.msgId : (rec.id != null ? rec.id : '')));
    o.did  = String(rec.did != null ? rec.did
                    : (rec.sendId != null ? rec.sendId : ''));
  }
  const _d = o.did || firstLineDid(o.text) || pendDidOf(o.text);
  return {text: o.text, mid: o.mid, did: _d};
}
/* 消息身份键：mid 优先，缺则发送编号，再缺则角色＋正文（只用于去重，不生成新号） */
function lbMsgIdent(m){
  if (!Array.isArray(m)) return '';
  const mid = String(m[6] == null ? '' : m[6]).trim();
  if (mid) return 'M' + mid;
  const did = String(m[9] == null ? '' : m[9]).trim();
  if (did) return 'D' + did;
  return 'T' + String(m[0] || '') + '\u0001' + String(m[1] || '').replace(/\s+/g, '');
}
function lbMsgsAppend(rows, m){
  if (!Array.isArray(rows) || !Array.isArray(m)) return false;
  const k = lbMsgIdent(m);
  if (rows.some(x => lbMsgIdent(x) === k)) return false;
  rows.push(m);
  return true;
}
function lbHumanIsCurrent(sid, title){
  const cs = String((typeof curSid === 'function' ? curSid() : '') || '');
  if (!cs) return false;
  const s = String(sid || '');
  if (s){
    if (s === cs) return true;
    try {
      return !!(typeof 稳定键 === 'function' && 稳定键(s, '') === 稳定键(cs, ''));
    } catch(e){ return false; }
  }
  return !!(title && typeof curTitle === 'function' && String(title) === String(curTitle()));
}
/* 切换在途、目标是别会话：不把该帧塞进当前屏幕（仍可落账），回帧时自然显示 */
function lbHumanSwitchBlocked(sid){
  const sp = S.switch_pend;
  if (!sp || !sp.lockTarget || sp.arrived) return false;
  const tgt = String(sp.sid || '');
  if (!tgt) return true;
  if (String(sid || '') === tgt) return false;
  try {
    return !(typeof 稳定键 === 'function' && 稳定键(sid, '') === 稳定键(tgt, ''));
  } catch(e){ return true; }
}
function ledgerHumanApply(sid, title, rec, opt){
  opt = opt || {};
  const _r = lbHumanRecNorm(rec);
  if (!String(_r.text || '').trim()) return false;
  const _sid = String(sid || '').trim();
  const _t = String(title || '').trim();
  const row = ['u', _r.text, '', 0, 0, '', _r.mid || '', '', 'u'];  /* 类型照后端口径 u；index2 不存时间 */
  if (_r.did) row[9] = _r.did;
  /* ② 按发送编号当场销卡（u 帧到达＝已进流，不等下一帧、不等 15 秒灰态） */
  let cleared = false;
  try {
    if (_r.did && typeof pendClearByDid === 'function')
      cleared = !!pendClearByDid(_r.did, _t);
  } catch(e){}
  let shown = false;
  try {
    ledgerStorePut(_sid, _t, [[row]], {touch: true, uid: opt.uid, humanOnly: true});
  } catch(e){}
  try { shown = lbHumanIsCurrent(_sid, _t) && !lbHumanSwitchBlocked(_sid); } catch(e){}
  if (shown || cleared) { try { renderAll(); } catch(e){} }
  return shown || cleared;
}
/* ev k='u' / k='human' 入口：v={sid,title,uid,mid,text,did,ts}（或 v.rec 同形） */
function ledgerHumanFrame(v){
  if (!v || typeof v !== 'object') return false;
  const sid = String(v.sid || v.selSid || v['会话号'] || '');
  const title = String(v.title || v['会话名'] || v.name || '');
  const rec = (v.rec && typeof v.rec === 'object') ? v.rec : v;
  return ledgerHumanApply(sid, title, rec, {uid: v.uid || (rec && rec.uid)});
}
function lbPatchRounds(rounds, body){
  const g = lbPatchFlag(body);
  const idxs = (body && Array.isArray(body.patched_rounds))
    ? body.patched_rounds.map(n => Number(n) | 0) : [];
  const txt = String((body && (body.patch_text || body.tail || body.text)) || '');
  return (rounds || []).map((r, ri) => {
    if (!Array.isArray(r)) return r;
    const rr = r.map(m => Array.isArray(m) ? m.slice() : m);
    const patch = g || idxs.indexOf(ri) >= 0 || lbPatchFlag(rr);
    if (!patch) return rr;
    let ai = rr.length ? rr[rr.length - 1] : null;
    if (ai && String(ai[0] || '').toLowerCase() === 'a'){
      if (!String(ai[8] || '')) ai[8] = 'patched';
      if (!String(ai[7] || '').trim()) ai[7] = '补记';
    } else if (rr.length === 1 && String(rr[0][0] || '').toLowerCase() === 'u'){
      const mid = String(rr[0][6] || '').trim();
      if (txt && mid) rr.push(['a', txt, '', 0, 0, '', mid, '补记', 'patched']);
    }
    return rr;
  });
}
function ledgerStoreApply(sid, body, ver){
  if (!body || !Array.isArray(body.rounds)) return;
  const _sid = String(sid || '').trim();
  const _rounds = lbPatchRounds(body.rounds, body);
  let _hasFinal = false;
  _rounds.forEach(r => {
    const _rows = Array.isArray(r) ? r : [];
    const _u = _rows.find(m => Array.isArray(m) && String(m[0] || '').toLowerCase() === 'u');
    const _hasA = _rows.some(m => Array.isArray(m) && String(m[0] || '').toLowerCase() === 'a');
    if (_u && !_hasA && _rows.length === 1) ledgerHumanApply(_sid, body.title || '', _u, {uid: body.uid});
    else if (_rows.length) _hasFinal = true;
  });
  if (_hasFinal)
    ledgerStorePut(_sid, body.title || '', _rounds, {touch: true, uid: body.uid});
  if (_sid && typeof _paneIsAnchor === 'function'
      && _paneIsAnchor(_sid, body.title || '')){
    const _liveN = (S.liveFrame && Array.isArray(S.liveFrame.msgs))
      ? lbRoundsFromMsgs(S.liveFrame.msgs).length : 0;
    const _newN = _rounds.length;
    const _curArr = (S.snap && Array.isArray(S.snap.msgs)) ? S.snap.msgs : [];
    const _liveArr = (S.liveFrame && Array.isArray(S.liveFrame.msgs))
      ? S.liveFrame.msgs : [];
    const _屏Rows = Math.max(_curArr.length, _liveArr.length);
    const _spNow = S.switch_pend;
    /* 底稿取「屏上更厚的那份」（当前屏可能是 liveFrame 持屏、也可能是 S.snap），
       避免顶屏时把更厚的屏换成更薄的一份（2.237 防回退）。 */
    const _baseSrc = (_liveArr.length > _curArr.length) ? _liveArr : _curArr;
    const _base = (!(_spNow && _spNow.lockTarget && !_spNow.arrived))
      ? _baseSrc.slice() : [];
    const rows = [];
    _rounds.forEach(r => (r || []).forEach(m => {
      if (Array.isArray(m)) rows.push(m);
    }));
    const _merged = _base.slice();
    rows.forEach(m => { lbMsgsAppend(_merged, m); });
    if (rows.length && (!_屏Rows || _newN > _liveN || _merged.length > _屏Rows
                        || (typeof _lbTailNewer === 'function' && _lbTailNewer(rows, _base)))){
      if (S.livePend){ S.livePend = ''; S.liveFrame = null; }   /* 解锁旧帧，交账本轮顶屏 */
      S.livePend = S.anchorSid;
      S.liveFrame = {msgs: _merged, finish: null, tail: '', sendIdle: true,
                     inputText: '', opts: [], ask: null, pend: [],
                     model: ''};
      renderAll();
    }
  }
}
/* 快照到达（事件总线.js snap 分支转调）：账本落盘 + 触碰 lastView + 真画面退场折叠面板 */
function ledgerOnSnap(){
  const s = S.snap || {};
  if (!Array.isArray(s.msgs) || !s.msgs.length) return;
  if (typeof _liveLockOn === 'function' && _liveLockOn()) return;   /* 过渡期正文不属锚定，不记 */
  const sid = S.anchorSid || '';
  if (!sid) return;
  const now = Date.now();
  if (now - _lbSnapAt < 5000){ _lbSnapAt = now; return; }           /* 5 秒节流 */
  _lbSnapAt = now;
  ledgerStorePut(sid, typeof curTitle === 'function' ? curTitle() : '',
                 lbRoundsFromMsgs(s.msgs), {touch: true});
}

/* ================= 失效账本清理（H2/H3） ================= */
function lbSumDrop(sid, title){
  try {
    const s = String(sid || ''), t = String(title || '').trim();
    let u = '';
    try { u = lbUidPick(null, s, t); } catch(e){ u = ''; }
    delete LB.lbSum[u || t];
    if (t) delete LB.lbSum[t];          /* 旧键（会话名）一并清 */
    if (s) delete LB.lbSum[s];          /* 更旧键（原始 sid）一并清 */
  } catch(e){}
}

/* ============ 2.219：开机/改值后按保留轮数 N 批量裁本地账本 ============
   幂等、批量、不弹窗：逐本只裁 rounds（lbLedgerTrimRounds，quiet），整条记录
   （ts/lastTs/lastView/pend/diag/think）不动；跑完记一条汇总日志（会话数＋
   总裁掉轮数）。与「前端零拦截」不冲突：屏幕上的消息照样显示，只裁本地存量。 */
let _lbTrimAllAt = 0;
/* ============ 2.220：开机/改值后按 N 批量裁预备画面（snap_conv） ============
   与 lbTrimAllRounds 同一把尺子：只裁 frame.msgs 的轮次（lbTrimFrameMsgs →
   lbLedgerTrimRounds），sk/key/sid/uid/title/srv/ts 一律不动；未超 N 的记录不
   重写、不记日志；幂等，裁到的每条记 `预备画面裁剪|键=…|裁前=n|裁后=N`。 */
let _lbTrimSnapAt = 0;
function lbTrimAllSnaps(force){
  if (lbMirrorMode()) return Promise.resolve(0);
  try {
    const now = Date.now();
    if (!force && now - _lbTrimSnapAt < 5000) return Promise.resolve(0);
    _lbTrimSnapAt = now;
    let nRec = 0;
    const tasks = [];
    return _idbReq('snap_conv', 'readonly', st => st.getAll()).then(rows => {
      (rows || []).forEach(rec => {
        if (!rec || !rec.frame || !Array.isArray(rec.frame.msgs)) return;
        const before = rec.frame.msgs.length;
        const kept = lbTrimFrameMsgs(rec.frame.msgs, rec.sk, false);
        if (kept.length === before) return;
        nRec++;
        const nrec = Object.assign({}, rec,
          {frame: Object.assign({}, rec.frame, {msgs: kept})});
        tasks.push(_idbReq('snap_conv', 'readwrite', st => st.put(nrec)).catch(() => {}));
        try {
          if (typeof _frameMem === 'object' && _frameMem) _frameMem[rec.sk] = nrec.frame;
          if (typeof _frameMemByTitle === 'object' && _frameMemByTitle && rec.title)
            _frameMemByTitle[String(rec.key || '') + '|' + String(rec.title)] = nrec.frame;
        } catch(e){}
      });
      return Promise.all(tasks).then(() => nRec);
    }).catch(() => 0);
  } catch(e){ return Promise.resolve(0); }
}

/* ============ 历史账本一次性清理（假桶只迁不删） ============
   背景：早期诊断口口径曾允许「无 sid 也按名称建临时账本（键 t:名称、标待补号）」；
   后已废止，这类账本一律不再产生。现行口径：
     · 假桶（uid/sid 为实例号或其截断 1632 的账本/预备画面）**合并/迁移**到正确键
       （本服名称键 `L<本服>:t:<会话名>`），迁移前后条数打印对比，**不许直接删数据**；
       无会话名/空轮次无法迁移的，原样保留并留痕，绝不静默丢弃。
     · uid 与 sid 都为空的按名称临时账本，沿用上述口径删除（与假桶无关）。
   幂等、可重复跑：判据只看记录本身，迁过即无；结果 diagLog 留痕。 */
let _lbTempCleanAt = 0;

/* ============ 存量重复桶一次性合并（只合并不删除内容） ============
   同名/带「重复」字样/伪编号的桶必须合并成唯一一本。
   规则与落账同一口径：有 4 位权威终身号进终身号桶，否则按会话名归并。
   合并前后条数全部 diagLog 打印（总条数不变；仅「完全相同的副本」折叠时
   单独记一条副本数），并在页面提示一次。 */
const LS_LB_MERGED_214 = 'trae_webm_lb_merged_214';
let _lbMergedAt = 0;
function lbMergeKeyOf(rec){
  const r = rec || {};
  let u = lbUidAuth(r.uid);
  if (!u){
    try {
      const cu = S.convUids || {};
      u = lbUidAuth(cu[r.sid]) || lbUidAuth(cu[r.title]);
    } catch(e){ u = ''; }
  }
  if (u) return lbStoreKey(u, lbNormTitle(r.title));
  const n = lbUidName(r.uid) || lbNormTitle(r.title);
  if (n) return lbStoreKey('', n);
  return String(r.sk || '');
}
function _snapMergeKey(rec){
  const r = rec || {};
  const srv = String(r.srv || '');
  const u = lbUidAuth(r.uid);
  if (u) return srv + '|u:' + u;
  const n = lbUidName(r.uid) || lbNormTitle(r.title);
  if (n) return srv + '|t:' + n;
  const s = String(r.sid || '').trim();
  return srv + '|s:' + (s || String(r.sk || ''));
}
function _lbMergeRows(a, b){
  /* mid 去重合并（同 mid：默认保留更厚的那条）；无 mid 仅按整行相同判重。 */
  const A = (a || []).map(m => Array.isArray(m) ? m.slice() : m);
  const seen = new Map();
  A.forEach((m, i) => { if (Array.isArray(m) && m[6]) seen.set(String(m[6]), i); });
  (b || []).forEach(m => {
    if (!Array.isArray(m)) return;
    const id = String(m[6] || '');
    if (id && seen.has(id)){
      const i = seen.get(id);
      const _old = A[i] || [];
      const _oT = String((_old.length > 8 && _old[8]) || '').toLowerCase();
      const _nT = String((m.length > 8 && m[8]) || '').toLowerCase();
      if (_nT === 'a' && _oT !== 'a'){ A[i] = m.slice(); return; }
      if (_oT === 'a' && _nT === 'a'){
        if (lbCharN(m[1] || '') !== lbCharN(_old[1] || '')) A[i] = m.slice();
        return;
      }
      if (m.length > _old.length) A[i] = m.slice();
      return;
    }
    if (!id && A.some(x => JSON.stringify(x) === JSON.stringify(m))) return;
    if (id) seen.set(id, A.length);
    A.push(m.slice());
  });
  return A;
}
/* ================= ④ 主动核对（1 分钟周期+倒计时）与智能避让 ================= */
setInterval(() => {
  try {
    lbHud();                               /* 悬浮条开关式：关则即撤、开则走字（含冻结态） */
    if (LB.frozen) return;
    if (LB.checking || !S.onLine || !loggedIn || document.hidden) return;
    const now = Date.now();
    if (!LB.timerAt) LB.timerAt = now + lbPeriodMs();
    if (now >= LB.timerAt){
      LB.timerAt = now + lbPeriodMs();
      ledgerVcheckSend('timer', S.anchorFull
        || (typeof curSid === 'function' ? curSid() : '') || '');
      setTimeout(() => { LB.checking = false; }, 5000);   /* 防旧服务端无回帧卡旗标 */
    }
  } catch(e){ LB.checking = false; }
}, 1000);

/* ================= ⑤ 本地离线倒计时（默认 120s 可配） ================= */
/* 任意用户操作重置；走完发下线信号（logout）。与既有 5 分钟闲置退登并存
   （120s 先到先触发，效果一致）；开关 CFG.lb_idleout 默认开。 */
['touchstart', 'mousedown', 'keydown', 'scroll', 'click', 'pointerdown']
  .forEach(ev => document.addEventListener(ev, () => { lbLastAct = Date.now(); },
             {passive: true, capture: true}));
setInterval(() => {
  try {
    if (!CFG.lb_idleout) return;
    if (document.hidden || !S.onLine) return;      /* 后台定时器被冻，不判 */
    if (Date.now() - lbLastAct >= lbOfflineSecs() * 1000){
      lbLastAct = Date.now();
      if (loggedIn) cliLogout('闲置' + lbOfflineSecs() + '秒');   /* 下线信号 */
    }
  } catch(e){}
}, 1000);
/* 保留现有主动下线场景并新增开关：切后台/切网页下线（默认关＝现状不下线） */
document.addEventListener('visibilitychange', () => {
  try {
    if (document.hidden && CFG.lb_bgout && loggedIn) cliLogout('切后台');
  } catch(e){}
});

function lbHudText(){
  try {
    const now = Date.now();
    /* 冻结态（切换进行中）：核对倒计时恒显满周期——数字停住＝冻结中，不发送 */
    const ck = LB.frozen ? (lbPeriodMs() / 1000)
      : (LB.timerAt ? Math.max(0, Math.ceil((LB.timerAt - now) / 1000)) : 0);
    const off = CFG.lb_idleout
      ? Math.max(0, Math.ceil((lbLastAct + lbOfflineSecs() * 1000 - now) / 1000)) : 0;
    return '核对 ' + ck + 's · 离线 ' + off + 's';
  } catch(e){ return '—'; }
}
if (typeof window !== 'undefined') window.lbHudText = lbHudText;

function lbChkBall(){
  try {
    const b = document.querySelector('#lbl_srv .srvdot');
    if (!b) return;
    const on = !!(LB.chkUntil && Date.now() < LB.chkUntil);
    b.classList.toggle('chk', on);
  } catch(e){}
}
setInterval(lbChkBall, 500);

function lbHud(){
  try {
    if (!CFG.lb_hud){
      if (_lbHudEl){ _lbHudEl.remove(); _lbHudEl = null; }
      return;
    }
    if (!_lbHudEl){
      const st = document.createElement('style');
      st.textContent = '#lbhud{position:fixed;left:8px;bottom:calc(8px + env(safe-area-inset-bottom));'
        + 'z-index:9000;font-size:10px;line-height:1.3;color:#8a94a6;background:rgba(255,255,255,.88);'
        + 'border:1px solid #dde3ec;border-radius:999px;padding:2px 8px;pointer-events:none;}';
      document.head.appendChild(st);
      _lbHudEl = document.createElement('div');
      _lbHudEl.id = 'lbhud';
      document.body.appendChild(_lbHudEl);
    }
    _lbHudEl.textContent = lbHudText();
  } catch(e){}
}

/* set_think_int 服务端回执（S1 裁定 WS桥 0.27）：{'t':'think_int_ack','ok','sec','on'}
   —— 按 on/sec 更新本地 CFG（服务端是限频间隔的最终真值）；调控输入框由
   缓存查看器「账本调控」区重建 DOM 时按 CFG 回填。 */
function lbThinkIntAck(d){
  try {
    if (!d || typeof d !== 'object') return;
    const sec = Math.max(0, parseInt(d.sec) || 0);
    if (d.ok){
      CFG.lb_think = d.on ? sec : 0;
      cfgSave();
      flash(d.on ? ('思维流间隔已生效：' + sec + ' 秒') : '思维流限频已关闭（画面一变即发）', 'var(--blue)');
    } else {
      flash('思维流间隔下发未生效（服务端拒绝）', 'var(--red)');
    }
  } catch(e){}
}

/* ================= 启动 ================= */
lbVerLoad();
try { setTimeout(() => {
  try {
    try { lbTrimAllSnaps(); } catch(e){}
  } catch(e){}
}, 2500); } catch(e){}
try { setTimeout(() => { try { lbTimeBackfill(2); } catch(e){} }, 4000); } catch(e){}
