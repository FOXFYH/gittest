'use strict';
/* 任务与输入（原「长椅任务.js」）——📂 本端浏览页删除后，本文件只保留与
   bench 无关的共享代码：新建任务弹窗、放大态取回/复制小工具、附件上传、
   积分刷新；并把「📂 选路径 / 选工作目录」改为引用公共独立服务
   「网页版本地文件查看器」（GitHub Pages fileview/index.html）。
   2.72：📂 输入行按钮与「新建任务」选文件夹，改为 window.open 打开公共
   查看器（?h=trae&pick=1&mode=ins|newdir），经
   window.opener.postMessage({type:'fvwr_pick',path,mode,h:'trae'}) 回传后
   插入聊天输入框 / 回填工作目录（参照原 benchIns / benchPick 的等价写法）。
   2.111（老板 2026-10-20 20:44「现在我要新建的话也没效果」）：新建面板加
   「首条消息」框（#td_msg），「创建」除了开草稿还按序发 new_task_send——
   TRAE 的会话行只在首条消息发出后才出现，只开草稿＝列表零变化（真因）；
   不填首条消息则如实提示，不再假装「就绪」。 */

/* 公共独立服务「网页版本地文件查看器」网页地址（与 WorkBuddy 等宿主共用同一份） */
const FVWR_URL = 'https://foxfyh.github.io/gittest/fileview/index.html';

/* 2.115（老板 2026-10-21 08:18「我现在手机网页版不行」）：
   移动端真机复现后，病根不在 window.open（真触摸实测返回正常、并非被拦），
   而在查看器页在手机上没记住「频道公共段」——它直接盖一层全屏「连接设置」，
   列表为空 ⇒ 行尾 ➕ 根本无从点起，看着就是"点了没反应"。
   改法：① 开查看器前，把宿主自己的频道名补进同源 localStorage.fvwr_channel
   （与查看器手工填的是同一把钥匙；公开页仍不写死任何频道号）；
   ② 改用同页全屏 iframe 内嵌查看器（不再依赖 window.open，手机浏览器
   也拦不住），回传走「同源直连 + 频道」双保险，✕ 关闭即回原页；
   ③ iframe 建不起来才退回原 window.open。 */
const FVWR_MASK_ID = 'fvwr_mask';
function fvwrBaseChan(){
  let b = '';
  try { b = (localStorage.getItem('fvwr_channel') || '').trim(); } catch(e){}
  if (!b){ try { b = (chanGet(cSel) || '').trim(); } catch(e){} }
  return b;
}
function fvwrEnsureChannel(){
  let have = '';
  try { have = (localStorage.getItem('fvwr_channel') || '').trim(); } catch(e){}
  if (have) return have;
  let b = '';
  try { b = (chanGet(cSel) || '').trim(); } catch(e){}
  if (b){ try { localStorage.setItem('fvwr_channel', b); } catch(e){} }
  return b;
}
function fvwrClosePick(){
  const m = $(FVWR_MASK_ID);
  if (m){ try { m.remove(); } catch(e){} }
}
function fvwrIframeOpen(mode){
  if (!document.body) return false;
  try {
    fvwrClosePick();
    const m = document.createElement('div');
    m.id = FVWR_MASK_ID;
    m.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#fff;'
      + 'display:flex;flex-direction:column;';
    const bar = document.createElement('div');
    bar.style.cssText = 'flex:none;display:flex;align-items:center;gap:8px;'
      + 'padding:calc(8px + env(safe-area-inset-top)) 10px 8px;'
      + 'background:#1565c0;color:#fff;font-size:14px;';
    const t = document.createElement('b');
    t.textContent = '📂 ' + (mode === 'newdir' ? '选择文件夹' : '选择文件/目录');
    t.style.cssText = 'flex:none;';
    const hint = document.createElement('span');
    hint.textContent = '首次若提示「连接设置」，填与 TRAE 设置页相同的频道即可，填一次永久记住';
    hint.style.cssText = 'flex:1;font-size:11px;opacity:.85;line-height:1.3;';
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.title = '关闭并返回';
    x.style.cssText = 'flex:none;width:38px;height:38px;border:0;border-radius:19px;'
      + 'background:rgba(255,255,255,.18);color:#fff;font-size:18px;';
    x.onclick = fvwrClosePick;
    bar.appendChild(t); bar.appendChild(hint); bar.appendChild(x);
    const f = document.createElement('iframe');
    f.style.cssText = 'flex:1;width:100%;border:0;background:#fff;';
    f.src = FVWR_URL + '?h=trae&pick=1&mode=' + encodeURIComponent(mode);
    f.onload = () => {
      /* 同源窗口：把查看器的 pickBack 再包一层——不依赖 opener，也一定
         落进本页；回传成功后自动收起遮罩回到原页。 */
      try {
        const w = f.contentWindow;
        if (w && typeof w.pickBack === 'function' && !w.__fvwrWrapped){
          const orig = w.pickBack;
          w.__fvwrWrapped = true;
          w.pickBack = function(path){
            try { orig.call(w, path); } catch(e){}
            try { fvwrPickApply({type:'fvwr_pick', path:path, mode:mode, h:'trae'}); } catch(e){}
            fvwrClosePick();
          };
        }
      } catch(e){}
    };
    f.onerror = () => { fvwrClosePick(); try { window.open(f.src, 'fvwrPick'); } catch(e){} };
    m.appendChild(bar); m.appendChild(f);
    document.body.appendChild(m);
    return true;
  } catch(e){ return false; }
}
/* 打开公共查看器选路径：mode='ins' 选中即插入聊天输入框；
   mode='newdir' 选中即回填「新建任务」工作目录。 */
function fvwrOpen(mode){
  fvwrEnsureChannel();              // 2.115：先补齐公共段，查看器不再弹「连接设置」
  fvwrPickChanListen();             // 2.108：开查看器前(重)连选路径收帧频道
  if (fvwrIframeOpen(mode)) return; // 2.115：优先同页内嵌
  try {
    window.open(FVWR_URL + '?h=trae&pick=1&mode=' + encodeURIComponent(mode),
                'fvwrPick');        // 兜底：内嵌不可用才开新窗口
  } catch (e){ flash('⚠ 打开文件查看器失败'); }
}

/* 接收公共查看器选中回传：{type:'fvwr_pick', path, mode, h}。
   参照原 benchIns（插入输入框）/ benchPick（回填工作目录）的等价写法。
   2.108：两条来路共用同一落点——① window.opener.postMessage（兼容路）；
   ② 「公共段 + INS」频道 FOX 帧（主路，不依赖 opener，手机端 opener 丢失也
   能到）。同一路径 3 秒内只认第一次，避免双路重复插入。 */
let _fvwrLastPath = '', _fvwrLastTs = 0;
function fvwrPickApply(d){
  if (!d || d.type !== 'fvwr_pick' || !d.path) return;
  if (d.h && d.h !== '*' && d.h !== 'trae') return;   // 只服务本角色（不打扰另一端）
  const now = Date.now();
  if (d.path === _fvwrLastPath && now - _fvwrLastTs < 3000) return;   // 双路去重
  _fvwrLastPath = d.path; _fvwrLastTs = now;
  if (d.mode === 'newdir'){
    S.task_cur = d.path;                    // 回填（不立即建任务）
    taskDlgRender();
    el.td_stat.textContent = '已选目录，点「创建」开始任务';
    flash('已选工作目录', 'var(--green)');
  } else {
    const cur = el.ent.value.trim();
    el.ent.value = (cur ? cur + ' ' : '') + d.path;
    flash('已插入路径', 'var(--green)');
  }
  fvwrClosePick();       // 2.115：内嵌查看器选中后自动收起，回到原页
}
window.addEventListener('message', e => { fvwrPickApply(e && e.data); });   // 路① postMessage

/* 路②「公共段 + INS」频道收帧：公共段取同源查看器页落的 localStorage 键
   fvwr_channel（与查看器页同源 foxfyh.github.io/gittest，共享），绝不硬编码。
   收到 FOX 帧体 JSON 后转交同一落点 fvwrPickApply。帧很短，恒单段。 */
let _fvwrInsWs = null;
function fvwrPickFrameBody(raw){
  if (!raw) return null;
  const m = /^【FOXID:\d{14}[a-z]{8}\d{10}=cut\(\d{3}\/\d{3}\)】/.exec(raw);
  const body = m ? raw.slice(m[0].length) : raw;
  if (!body || body[0] !== '{') return null;
  try { return JSON.parse(body); } catch(e){ return null; }
}
function fvwrPickChanListen(){
  const base = fvwrBaseChan();           // 2.115：记忆缺失时用宿主自家频道名兜底
  if (!base) return;                     // 无公共段：频道路不可用（postMessage 仍可用）
  const ch = base + 'INS';               // 选路径专用后缀，与查看器约定一致
  if (_fvwrInsWs){ try { _fvwrInsWs.close(); } catch(e){} }
  try { _fvwrInsWs = new WebSocket(WS_URL_TMPL.replace('%s', ch)); }
  catch(e){ _fvwrInsWs = null; return; }
  _fvwrInsWs.onmessage = ev => { const d = fvwrPickFrameBody(ev.data); if (d) fvwrPickApply(d); };
  _fvwrInsWs.onclose = () => { _fvwrInsWs = null; setTimeout(fvwrPickChanListen, 4000); };
}
fvwrPickChanListen();                                        // 开页即听
window.addEventListener('storage', e => {                    // 查看器另一端落了公共段
  if (e.key === 'fvwr_channel') fvwrPickChanListen();
});

/* 2.10：放大态小工具（⇩ 取回 / 📋 复制）「点了没反应」根治。
   病根：这两个按钮只在 #input_row.grow 时显示，而 grow 由输入框
   焦点维持（blur 处理器会立刻摘掉）。真实点击的时序是
   按下(pointerdown/mousedown) → 输入框失焦 → grow 被摘 → 按钮
   变 display:none → 抬起时按钮已不存在 → click 事件根本不触发。
   对策：① 动作从 click 挪到「按下」这一拍（pointerdown/touchstart/
   mousedown，谁先到谁执行，400ms 内只认第一次防双跑）；
   ② 按下即 preventDefault，尽力挡住失焦；click 仅作兜底。 */
function bindTapNoBlur(btn, fn){
  let last = 0;
  const fire = () => {
    const now = Date.now();
    if (now - last < 400) return;
    last = now;
    fn();
  };
  btn.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    /* 只负责「按下即执行」；此处**不能** preventDefault——Chrome 里
       pointerdown 一旦 preventDefault 就把随后的 mousedown 一并掐掉，
       下面那条真正挡失焦的 mousedown 处理器就轮不到执行（实测踩坑）。*/
    fire();
  });
  btn.addEventListener('mousedown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.cancelable) e.preventDefault();   /* 挡住失焦（桌面鼠标就靠这条） */
    fire();
  });
  btn.addEventListener('touchstart', e => {
    if (e.cancelable) e.preventDefault();   /* 挡住失焦（触屏靠这条） */
    fire();
  }, {passive: false});
  btn.addEventListener('click', fire);
}
bindTapNoBlur(el.take, () => {    // 1.53：取回残留——TRAE 输入框文本取回本端+清空
  if (srvNeedOnline('取回残留')) return;
  srvOpSend('input_take', null, '取回残留');    // 2.109：②＋rcpt ③④（input_take_out 另回填）
});
bindTapNoBlur(el.copy, () => {    // 1.76：一键复制输入框内容（放大态小工具）
  const t = el.ent.value;
  if (!t){ flash('输入框是空的，没东西可复制'); return; }
  copyText(t);
});

/* T63：输入行放大态顶行新增第 5 个「急」勾选——加急插入对话流。
   未选＝白底常态 / 选中＝红底（醒目）。点它＝取反本次发送的「加急」标志
   （S.urgent，随 route_send 的 interject_now 下发）。**不写任何持久配置**，
   每次打开/刷新页面 S.urgent 即回 false、按钮回白底。
   用 bindTapNoBlur：按下即切换且挡住输入框失焦（否则 grow 被摘、
   按钮瞬间消失——同 ⇩/📋 的踩坑）。 */
bindTapNoBlur(el.urgent, () => {
  S.urgent = !S.urgent;
  el.urgent.classList.toggle('on', S.urgent);
  flash(S.urgent ? '急：本次发送将加急插入对话流（立即插队）'
                 : '急：已取消加急（本次按常规发送）',
        S.urgent ? 'var(--red)' : 'var(--gray)', 1500);
});

/* 2.72：📂 输入行按钮——打开公共查看器选路径（mode=ins）插入输入框
   2.115：改走 bindTapNoBlur（按下即响应），手机 tap 不再依赖 click 时序 */
bindTapNoBlur(el.bench, () => fvwrOpen('ins'));

/* —— 1.08：新建任务弹窗（对齐服务端 v1.10 TaskDlg 两态渲染；
   原入口并入——new_task_dir 链路服务端保留但本端不再发送） —— */

function taskDlgOpen(lock){         /* 1.11：lock=文件夹组名 → 锁定模式
  （组头 ➕ 入口）——不预开 TRAE 输入区、无目录选择，创建=new_task_in */
  S.task_open = true;
  S.task_lock = lock || null;
  S.task_mem = '';
  S.task_cur = '';
  const m = $('td_msg'); if (m) m.value = '';    /* 2.111：首条消息每开即空 */
  taskDlgRender();
  el.td_stat.textContent = S.task_lock
    ? '点「创建」在文件夹内新建对话' : '正在展开新建任务…';
  el.taskpage.classList.add('on');
}
function taskDlgRender(){          // 工作目录行两态 + 1.11 锁定态
  if (S.task_lock){
    el.td_lock.style.display = '';
    el.td_lock.textContent = '🔒 归属文件夹：' + S.task_lock
      + '（组内新建·锁定）';
    el.td_none.style.display = 'none';
    el.td_sel.style.display = 'none';
    document.querySelector('#page_taskdlg .tdsec').style.display = 'none';
    return;
  }
  document.querySelector('#page_taskdlg .tdsec').style.display = '';
  el.td_lock.style.display = 'none';
  const cur = S.task_cur || S.task_mem;
  if (cur){
    el.td_none.style.display = 'none';
    el.td_sel.style.display = '';
    el.td_name.textContent = '📁 '
      + (cur.split(/[\\\/]/).filter(Boolean).pop() || cur);
    el.td_full.textContent = cur;
  } else {
    el.td_none.style.display = '';
    el.td_sel.style.display = 'none';
  }
}
function taskDlgClose(){
  S.task_open = false;
  el.taskpage.classList.remove('on');
}
function taskPickDir(){            // 选择/重选 → 公共查看器选目录回填（mode=newdir）
  fvwrOpen('newdir');
}
el.td_none.onclick = () => taskPickDir();
el.td_re.onclick = () => taskPickDir();
el.td_ok.onclick = () => {         /* 创建：锁定=组内新建；普通=目录
  与记忆有变化才设置。2.111：把「首条消息」真正发进草稿——TRAE 的会话行
  只在首条消息发出后才出现在侧栏；只点新建 = 零变化，就是老板说的「没效果」。
  发帧顺序＝cmdq 顺序：new_task_in/dlg（开草稿）→ task_dir_set（可选）→
  new_task_send（发首条），服务端 _cmd_new_task_send 有「必须仍在草稿」护栏。 */
  const mEl = $('td_msg');
  const msg = ((mEl && mEl.value) || '').trim();
  const first = msg ? (didNow() + '\n' + msg) : '';   /* 与正常发送同口径：首行 DID */
  if (S.task_lock){
    taskDlgClose();
    srvOpSend('new_task_in', S.task_lock, '新建对话', '「' + S.task_lock + '」');   // 2.109：②＋rcpt ③④
    if (first) srvOpSend('new_task_send', first, '新建任务', '首条消息');
    return;
  }
  const dirChanged = !!(S.task_cur && S.task_cur !== S.task_mem);
  if (dirChanged){
    el.td_stat.textContent = srvOpText('sent', '设置工作目录');
    srvOpSend('task_dir_set', S.task_cur, '设置工作目录');                        // 2.109：②＋rcpt ③④
  } else {
    taskDlgClose();
  }
  if (first){
    srvOpSend('new_task_send', first, '新建任务', '首条消息');
  } else if (!dirChanged){
    /* 2.111：不再假装「✅ 就绪」——如实说清为什么列表还没多一条 */
    flash('已展开 TRAE 新任务：在输入框写内容并发送，才会在会话列表生成新会话',
          'var(--blue)', 6000);
  }
};
el.td_cancel.onclick = () => {     /* 取消：锁定模式没开 TRAE 输入区
  直接关；普通模式 Esc×2 关 TRAE 输入区 */
  const wasLock = S.task_lock;
  taskDlgClose();
  if (!wasLock) srvOpSend('task_dlg_cancel', null, '取消新建任务');   // 2.109：②＋rcpt ③④
};

/* —— 附件上传：本地读 base64 → FOX 分段上传（单个 ≤ 6MB） —— */

el.attach.onclick = () => el.file.click();
el.file.onchange = async () => {
  const files = [...el.file.files];
  el.file.value = '';
  if (!files.length) return;
  if (S.attach_pending){ flash('📎 正在附加上一批，请稍候…', 'var(--orange)'); return; }
  if (srvNeedOnline('附加附件')) return;
  const arr = [];
  for (const f of files){
    if (f.size > 6 * 1024 * 1024){
      flash('「' + f.name + '」超过 6MB，远程通道暂不支持'); return;
    }
    const b64 = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1] || '');
      r.onerror = no;
      r.readAsDataURL(f);
    }).catch(() => null);
    if (b64 === null){ flash('读取 ' + f.name + ' 失败'); return; }
    arr.push({n: f.name, d: b64});
  }
  S.attach_pending = arr.map(f => f.n);     // 反馈①：灰 chips 占位
  renderAttach([]);
  /* 2.109：非 cmd 帧统一四态出口——②＋服务端 rcpt ③④（attach_done 事件仍回填结果）。 */
  srvOpSendJson({t: 'attach_files', files: arr}, '附加附件', arr.length + ' 个文件');
};

/* —— 1.07：导出功能整体移除（用户要求网页版不要导出）：
   抽屉导出区 / export_full 命令 / collected 落盘链路均已删，
   服务端 export_full 处理保留不影响（无人触发即不执行） —— */

/* ================= 网络页 ================= */

el.refresh_pts.onclick = () => {         /* 刷新积分：委托服务端立刻查一次 */
  if (srvNeedOnline('刷新积分')) return;
  srvOpSend('points', null, '刷新积分');  // 2.109：②＋rcpt ③④（points 事件另回填）
};

/* 1.61：抽成函数——顶栏状态文字与抽屉里「设置页」都可进入诊断页 */

/* ================= 通用底部操作面板（bs*） =================
   2.38 原为浏览页「文件操作」面板；浏览页删除后，面板本身与 bench 无关，
   被 自我激活.js 复用（bsOpen / bsClose / bsBtn），故随本文件保留。 */

let bsEl = null;
function bsInject(){                 /* 底部操作面板（一次性注入） */
  if (bsEl) return;
  const st = document.createElement('style');
  st.textContent =
    '#bs_mask{position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.35);display:none}' +
    '#bs_mask.on{display:block}' +
    '#bs_sheet{position:fixed;left:0;right:0;bottom:0;z-index:99991;background:#fff;color:#222;' +
      'border-radius:16px 16px 0 0;padding:6px 0 calc(8px + env(safe-area-inset-bottom));' +
      'transform:translateY(110%);transition:transform .2s ease;max-height:80vh;overflow:auto}' +
    '#bs_sheet.on{transform:translateY(0)}' +
    '#bs_sheet .bs_ttl{padding:11px 18px 9px;font-size:13px;color:#888;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid #eef1f4}' +
    '#bs_sheet .bs_it{display:flex;align-items:center;gap:10px;padding:14px 18px;font-size:16px;' +
      'color:#222;cursor:pointer;border-bottom:1px solid #f3f5f7}' +
    '#bs_sheet .bs_it:active{background:#eef4fb}' +
    '#bs_sheet .bs_it.danger{color:#c62828}' +
    '#bs_sheet .bs_it .ic{width:22px;text-align:center}' +
    '#bs_sheet .bs_msg{padding:16px 18px 6px;font-size:15px;color:#333;line-height:1.6;' +
      'white-space:pre-line}' +
    '#bs_sheet .bs_in{display:block;width:calc(100% - 36px);margin:8px 18px 4px;padding:11px 12px;' +
      'font-size:16px;border:1px solid #d5dbe1;border-radius:8px;box-sizing:border-box}' +
    '#bs_sheet .bs_kv{display:flex;gap:12px;padding:9px 18px;font-size:14px;' +
      'border-bottom:1px solid #f3f5f7;align-items:flex-start}' +
    '#bs_sheet .bs_kv .k{flex:none;width:64px;color:#888}' +
    '#bs_sheet .bs_kv .v{flex:1;color:#222;word-break:break-all}' +
    '#bs_sheet .bs_btns{display:flex;gap:10px;padding:12px 18px 6px}' +
    '#bs_sheet .bs_btn{flex:1;height:44px;border:none;border-radius:10px;font-size:16px;' +
      'background:#f0f2f5;color:#333}' +
    '#bs_sheet .bs_btn.primary{background:var(--blue);color:#fff}' +
    '#bs_sheet .bs_btn.danger{background:#c62828;color:#fff}' +
    '@media(prefers-color-scheme:dark){' +
      '#bs_sheet{background:#1c1c1c;color:#ddd}' +
      '#bs_sheet .bs_ttl{color:#999;border-color:#2c2c2c}' +
      '#bs_sheet .bs_it{color:#ddd;border-color:#262626}' +
      '#bs_sheet .bs_it:active{background:#2a2a2a}' +
      '#bs_sheet .bs_msg{color:#ddd}' +
      '#bs_sheet .bs_in{background:#111;color:#eee;border-color:#333}' +
      '#bs_sheet .bs_kv{border-color:#262626}' +
      '#bs_sheet .bs_kv .k{color:#999}' +
      '#bs_sheet .bs_kv .v{color:#ddd}' +
      '#bs_sheet .bs_btn{background:#2a2a2a;color:#ddd}' +
    '}';
  document.head.appendChild(st);
  const mask = document.createElement('div');
  mask.id = 'bs_mask';
  mask.onclick = bsClose;
  const sheet = document.createElement('div');
  sheet.id = 'bs_sheet';
  document.body.appendChild(mask);
  document.body.appendChild(sheet);
  bsEl = {mask: mask, sheet: sheet};
}
function bsOpen(ttl){                /* 打开面板，返回可挂内容的容器 */
  bsInject();
  bsEl.sheet.innerHTML = '';
  if (ttl){
    const t = document.createElement('div');
    t.className = 'bs_ttl'; t.textContent = ttl;
    bsEl.sheet.appendChild(t);
  }
  const body = document.createElement('div');
  bsEl.sheet.appendChild(body);
  bsEl.mask.classList.add('on');
  requestAnimationFrame(() => bsEl.sheet.classList.add('on'));
  return body;
}
function bsClose(){
  if (!bsEl) return;
  bsEl.sheet.classList.remove('on');
  bsEl.mask.classList.remove('on');
}
function bsBtn(label, cls, fn){
  const b = document.createElement('button');
  b.className = 'bs_btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.onclick = fn;
  return b;
}