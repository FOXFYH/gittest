'use strict';
/* 最新一轮.js（网页端）  版本 2.00  日期 2026-11-05
   老板要求：每个会话本地永远保留「最新一轮完整问答」（人问 + AI 终答），
   来消息就更新、不节流、只进不退；切会话时先显示它，绝不先给旧画面。

   做法：每秒巡检当前会话正文（curMsgs），取“最后一条人类消息 → 结尾”这一段，
   把它写成与存帧同格式的一条记录（IndexedDB snap_conv，键 key|sid），
   直接 put（绕开原 10 秒节流与“条数不得更少”闸），并同步内存 _frameMem。
   只写当前锚定会话；切换在途/锁屏时不写，避免污染目标会话。 */
(function(){
  var LAST_KEY_PREFIX = 'LR|';
  var lastFp = {};
  function fpOf(q, a){
    return [q && (q[2] || q[6]), a && (a[2] || a[6]), (a && (a[1] || '').length) || 0].join('|');
  }
  function tick(){
    try {
      if (typeof curMsgs !== 'function' || typeof curSid !== 'function') return;
      if (S.switch_pend && S.switch_pend.lockTarget && !S.switch_pend.arrived) return;
      if (typeof _liveLockOn === 'function' && _liveLockOn()) return;
      var sid = String(S.anchorSid || curSid() || '');
      if (!sid) return;
      var ms = curMsgs() || [];
      if (!Array.isArray(ms) || !ms.length) return;
      /* 从末尾找最后一条 AI（终答），再往前找它对应的人类提问 */
      var ai = null, ui = -1;
      for (var i = ms.length - 1; i >= 0; i--){
        if (ms[i] && ms[i][0] === 'a' && String(ms[i][1] || '').trim()){ ai = ms[i]; break; }
      }
      if (!ai) return;                         /* 没有终答：不落盘（半轮不算完整） */
      for (var j = ms.length - 1; j >= 0; j--){
        if (ms[j] && ms[j][0] === 'u'){ ui = j; break; }
      }
      if (ui < 0) return;
      var q = ms[ui];
      var fp = fpOf(q, ai);
      if (lastFp[sid] === fp) return;          /* 没变化，不重写 */
      lastFp[sid] = fp;
      var _sl = ms.slice(ui);
      /* 2.00（老板 2026-11-05 20:38）：只记人类发言＋AI 终极回复（第 8 位），思维流不落盘 */
      if (typeof _frameMsgs === 'function'){ try { _sl = _frameMsgs(_sl); } catch(e){} }
      var frame = {msgs: _sl, finish: null};
      var sk = (typeof _frameMemKey === 'function') ? _frameMemKey(sid) : sid;
      try { _frameMem[sk] = frame; } catch(e){}
      if (typeof _idbReq === 'function'){
        _idbReq('snap_conv', 'readwrite', function(st){
          st.put({sk: sk, key: cacheKeyNow(), port: S.port, sid: sid,
                  title: (typeof curTitle === 'function' ? curTitle() : ''),
                  ts: Date.now(), frame: frame});
          return null;
        }).catch(function(){});
      }
      window.__lastRoundSaved = (window.__lastRoundSaved || 0) + 1;
    } catch(e){}
  }
  setInterval(tick, 1000);
  /* 切走前再补一次（若正处在切换，闸会拦住，属正常） */
  window.__lastRoundTick = tick;
})();