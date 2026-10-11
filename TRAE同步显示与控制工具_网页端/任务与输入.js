'use strict';
/* 任务与输入（原「长椅任务.js」）——📂 本端浏览页删除后，本文件只保留与
   bench 无关的共享代码：新建任务弹窗、放大态取回/复制小工具、附件上传、
   积分刷新；并把「📂 选路径 / 选工作目录」改为引用公共独立服务
   「网页版本地文件查看器」（GitHub Pages fileview/index.html）。
   2.72：📂 输入行按钮与「新建任务」选文件夹，改为 window.open 打开公共
   查看器（?h=trae&pick=1&mode=ins|newdir），经
   window.opener.postMessage({type:'fvwr_pick',path,mode,h:'trae'}) 回传后
   插入聊天输入框 / 回填工作目录（参照原 benchIns / benchPick 的等价写法）。 */

/* 公共独立服务「网页版本地文件查看器」网页地址（与 WorkBuddy 等宿主共用同一份） */
const FVWR_URL = 'https://foxfyh.github.io/gittest/fileview/index.html';

/* 打开公共查看器选路径：mode='ins' 选中即插入聊天输入框；
   mode='newdir' 选中即回填「新建任务」工作目录。
   命名窗口 'fvwrPick' 保留 opener 关系（查看器靠 window.opener 回传）。 */
function fvwrOpen(mode){
  try {
    window.open(FVWR_URL + '?h=trae&pick=1&mode=' + encodeURIComponent(mode),
                'fvwrPick');
  } catch (e){ flash('⚠ 打开文件查看器失败'); }
}

/* 接收公共查看器选中回传：{type:'fvwr_pick', path, mode, h}。
   参照原 benchIns（插入输入框）/ benchPick（回填工作目录）的等价写法。 */
window.addEventListener('message', e => {
  const d = e && e.data;
  if (!d || d.type !== 'fvwr_pick' || !d.path) return;
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
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试，无法取回'); return; }
  flash('正在取回 TRAE 输入框残留…', 'var(--blue)');
  sendCmd('input_take');
});
bindTapNoBlur(el.copy, () => {    // 1.76：一键复制输入框内容（放大态小工具）
  const t = el.ent.value;
  if (!t){ flash('输入框是空的，没东西可复制'); return; }
  copyText(t);
});

/* 2.72：📂 输入行按钮——打开公共查看器选路径（mode=ins）插入输入框 */
el.bench.onclick = () => fvwrOpen('ins');

/* —— 1.08：新建任务弹窗（对齐服务端 v1.10 TaskDlg 两态渲染；
   原入口并入——new_task_dir 链路服务端保留但本端不再发送） —— */

function taskDlgOpen(lock){         /* 1.11：lock=文件夹组名 → 锁定模式
  （组头 ➕ 入口）——不预开 TRAE 输入区、无目录选择，创建=new_task_in */
  S.task_open = true;
  S.task_lock = lock || null;
  S.task_mem = '';
  S.task_cur = '';
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
  与记忆有变化才设置 */
  if (S.task_lock){
    taskDlgClose();
    flash('正在文件夹「' + S.task_lock + '」内新建对话…', 'var(--blue)');
    sendCmd('new_task_in', S.task_lock);
    return;
  }
  if (S.task_cur && S.task_cur !== S.task_mem){
    el.td_stat.textContent = '正在设置工作目录…';
    flash('正在设置工作目录…', 'var(--blue)');
    sendCmd('task_dir_set', S.task_cur);
  } else {
    taskDlgClose();
    flash('✅ 新建任务就绪', 'var(--green)');
  }
};
el.td_cancel.onclick = () => {     /* 取消：锁定模式没开 TRAE 输入区
  直接关；普通模式 Esc×2 关 TRAE 输入区 */
  const wasLock = S.task_lock;
  taskDlgClose();
  if (!wasLock) sendCmd('task_dlg_cancel', null);
};

/* —— 附件上传：本地读 base64 → FOX 分段上传（单个 ≤ 6MB） —— */

el.attach.onclick = () => el.file.click();
el.file.onchange = async () => {
  const files = [...el.file.files];
  el.file.value = '';
  if (!files.length) return;
  if (S.attach_pending){ flash('📎 正在附加上一批，请稍候…', 'var(--orange)'); return; }
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
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
  flash('📎 附加中…（' + arr.length + ' 个文件）', 'var(--orange)');
  sendJson({t: 'attach_files', files: arr});
};

/* —— 1.07：导出功能整体移除（用户要求网页版不要导出）：
   抽屉导出区 / export_full 命令 / collected 落盘链路均已删，
   服务端 export_full 处理保留不影响（无人触发即不执行） —— */

/* ================= 网络页 ================= */

el.refresh_pts.onclick = () => {         /* 刷新积分：委托服务端立刻查一次 */
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  flash('正在刷新积分…', 'var(--blue)');
  sendCmd('points', null);              // 服务端 _cmd_points → points 事件回
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