/* WS收发格式化.js（网页端）  版本 1.00  日期 2026-11-27
   与电脑版 下级模块/WS收发格式化.py 对称：只管报文长什么样。
   出站：ev帧 / mod帧 / 盖源头戳；入站：解析 / 类型 / 取值。
   帧名与文案取 window.MSGTPL（消息模板.json 生成）。 */
(function(){
  'use strict';
  function T(){
    return (typeof window !== 'undefined' && window.MSGTPL) ? window.MSGTPL : {};
  }
  function 帧名(k, 兜底){
    var f = (T().帧) || {};
    return String(f[k] || 兜底);
  }
  function ev帧(k, v, srv){
    return {t: 帧名('ev', 'ev'), k: k, v: v, srv: srv || ''};
  }
  function mod帧(m, ver, d, sid){
    var o = {t: 帧名('mod', 'mod'), m: m, v: ver, d: d,
             ts: Math.floor(Date.now() / 1000)};
    if (sid) o.sid = String(sid);
    return o;
  }
  function vack帧(act, stage, sid, kw){
    var o = {t: 帧名('vack', 'vack'), act: act,
             stage: parseInt(stage, 10) || 0, sid: String(sid || '')};
    if (kw && typeof kw === 'object'){
      Object.keys(kw).forEach(function(k){ o[k] = kw[k]; });
    }
    return o;
  }
  function 解析(body, 上限){
    try{
      if (body == null) return null;
      var s = (typeof body === 'string') ? body : String(body);
      if (!/^\s*\{/.test(s)) return null;
      if (s.length > (上限 || 65536)) return null;
      var d = JSON.parse(s);
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null;
    }catch(e){ return null; }
  }
  var _入站 = {vcheck: 'vcheck', ledger_req: 'ledger_req', login: 'login',
               logout: 'cmd', cmd: 'cmd', ev: 'ev', rcpt: 'cmd',
               hello: 'cmd', vack: 'ev'};
  function 类型(d){
    if (!d || typeof d !== 'object') return 'other';
    var t = String(d.t || '');
    return _入站[t] || 'other';
  }
  function 取值(d, 键, 兜底){
    if (!d || typeof d !== 'object') return 兜底;
    var v = d[键];
    return (v == null) ? 兜底 : v;
  }
  function 盖源头戳(d, srvSid, srv){
    if (!d || typeof d !== 'object') return d;
    if (d.sid == null) d.sid = srvSid || '';
    if (d.srv_sid == null) d.srv_sid = srvSid || '';
    if (d.host == null) d.host = '';
    if (srv && d.srv == null) d.srv = srv;
    return d;
  }

  function 帧格式表(){
    return (T().帧格式) || {};
  }
  function 校验(d){
    if (!d || typeof d !== 'object') return ['t'];
    var t = String(d.t || '');
    var tb = 帧格式表()[t];
    if (!tb) return [];
    var miss = [];
    var req = tb.必选 || {};
    Object.keys(req).forEach(function(k){
      var v = d[k];
      if (v == null || (typeof v === 'string' && v === '' && k !== 'sid')) miss.push(k);
    });
    return miss;
  }
  window.WSFMT = {ev帧: ev帧, mod帧: mod帧, vack帧: vack帧,
                  解析: 解析, 类型: 类型, 取值: 取值, 盖源头戳: 盖源头戳,
                  校验: 校验, 帧格式表: 帧格式表};
})();
