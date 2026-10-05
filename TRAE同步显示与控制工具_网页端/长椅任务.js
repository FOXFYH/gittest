'use strict';
function benchReq(rel){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  el.benchlist.innerHTML = '<div class="brow empty">读取中…</div>';
  sendJson({t: 'bench_ls', p: rel || ''});
}
function benchIns(path){
  const cur = el.ent.value.trim();
  el.ent.value = (cur ? cur + ' ' : '') + path;
  el.benchpage.classList.remove('on');
  S.bench = null;
  flash('已插入路径', 'var(--green)');
}
function benchOpen(path){          /* 2.28：本地主动弹窗——直接打开浏览页到指定路径 */
  S.bench_mode = 'ins';
  el.benchpage.classList.add('on');
  benchReq(path || '');
}
function benchModeUI(){                 // 1.06：按模式切换头钮/底栏提示
  const pick = S.bench_mode === 'newdir';
  el.bench_ok.style.display = pick ? '' : 'none';
  el.bfoot.textContent = pick
    ? '📁 单击进入子目录 · ✅ 选定该目录（新建任务用）'
    : '📁 目录单击进入 · 📄 文件单击查看 · ➕ 插入路径';
}
function benchPick(path){               // 1.08：选定目录 → 回填弹窗
  el.benchpage.classList.remove('on');
  S.bench = null;
  S.bench_mode = 'ins';
  benchModeUI();
  S.task_cur = path;                    // 回填（不立即建任务）
  taskDlgRender();
  el.td_stat.textContent = '已选目录，点「创建」开始任务';
  flash('已选工作目录', 'var(--green)');
}
function benchRender(v){
  if (!v || !v.ok){ flash('📂 ' + ((v && v.err) || '读取失败')); return; }
  S.bench = v;
  const pick = S.bench_mode === 'newdir';
  const rel = v.rel || '';
  el.lbl_bench.textContent = (pick ? '📂 选工作目录 ' : '📂 ')
                             + (v.root || '工作台')
                             + (rel ? '\\' + rel : '');
  const box = el.benchlist;
  box.innerHTML = '';
  if (rel){                                 // 根目录不显示上级行
    const d = document.createElement('div');
    d.className = 'brow up';
    d.textContent = '⬙ ..';
    d.onclick = () => benchReq(v.parent || '');
    box.appendChild(d);
  }
  for (const n of (v.dirs || [])){
    const sub = rel ? rel + '\\' + n : n;
    const d = document.createElement('div');
    d.className = 'brow dir';
    d.textContent = '📁 ' + n;
    d.onclick = () => benchReq(sub);       // 目录单击进入（手机无双击）
    const b = document.createElement('span');
    if (pick){                              // 1.06：选目录模式 → ✅ 选定
      b.textContent = '✅';
      b.title = '选定此目录新建任务';
      b.onclick = e => { e.stopPropagation(); benchPick(v.path + '\\' + n); };
    } else {                                // 原模式 → ➕ 插路径
      b.textContent = '➕';
      b.title = '插入此目录路径';
      b.onclick = e => { e.stopPropagation(); benchIns(v.path + '\\' + n); };
    }
    b.className = 'plus';
    d.appendChild(b);
    box.appendChild(d);
  }
  if (!pick){                               // 选目录模式不列文件
    for (const n of (v.files || [])){
      const d = document.createElement('div');
      d.className = 'brow file';
      d.textContent = '📄 ' + n;
      d.onclick = () => FileRead.open(v.path + '\\' + n);   // 点文件名→阅读器查看
      const b = document.createElement('span');
      b.textContent = '➕';
      b.title = '插入此文件路径';
      b.onclick = e => { e.stopPropagation(); benchIns(v.path + '\\' + n); };
      b.className = 'plus';
      d.appendChild(b);
      box.appendChild(d);
    }
  }
  if (!box.children.length){
    const d = document.createElement('div');
    d.className = 'brow empty';
    d.textContent = '（空目录）';
    box.appendChild(d);
  }
}
/* 2.10：放大态小工具（⇩ 取回 / 📋 复制）「点了没反应」根治。
   病根：这两个按钮只在 #input_row.grow 时显示，而 grow 由输入框
   焦点维持（blur 处理器会立刻摘掉）。真实点击的时序是
   按下(pointerdown/mousedown) → 输入框失焦 → grow 被摘 → 按钮
   变 display:none → 抬起时按钮已不存在 → click 事件根本不触发。
   实测（Playwright 真鼠标点击）：点 📋 后输入框只是缩回一行、
   statebar 毫无反应，复制处理函数一次都没进。
   对策：① 动作从 click 挪到「按下」这一拍（pointerdown/touchstart/
   mousedown，谁先到谁执行，400ms 内只认第一次防双跑）；
   ② 按下即 preventDefault，尽力挡住失焦——桌面鼠标认 mousedown、
   触屏认 touchstart，能挡住则输入框与软键盘都保住、按钮也不消失；
   万一某机型仍挡不住（实测 Chrome 的 pointerdown preventDefault
   挡不住 mousedown 引起的失焦），动作早已在按下时执行完，不再
   受按钮消失影响。click 仅作兜底。 */
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
el.bench.onclick = () => {
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试，无法浏览工作台'); return; }
  S.bench_mode = 'ins';
  benchModeUI();
  el.benchpage.classList.add('on');
  benchReq('');
};
el.benchback.onclick = () => {
  el.benchpage.classList.remove('on');
  S.bench_mode = 'ins';                     // 返回即复位（防模式残留）
  benchModeUI();
};
el.bench_up.onclick = () => benchReq((S.bench || {}).parent || '');
el.bench_ok.onclick = () => {               // 1.06：选定当前浏览目录
  const b = S.bench;
  if (b && b.ok) benchPick(b.path);
};

/* —— 1.06 防自动升级开关（新任务部分已由 1.08 弹窗取代） —— */

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
function taskPickDir(){            // 选择/重选 → 📂 浏览页选目录回填
  S.bench_mode = 'newdir';
  benchModeUI();
  el.benchpage.classList.add('on');
  benchReq('');
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
