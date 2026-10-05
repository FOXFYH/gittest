'use strict';
/* 2.30：📂 浏览页两件事——① 记忆上次查看目录（下次点 📂 直接落那里）；
   ② 顶部路径改可点击面包屑（点任一级回退到该上级）。记忆键沿用
   trae_webm_* 命名，读写失败静默，绝不影响浏览主流程。
   2.37：下拉刷新——目录列表是「静态拉取」（服务端 bench_ls 只应答、不广播），
   目录里新出现的文件必须主动重拉；故在列表顶部下拽 → 松手重取当前目录。
   2.38：行尾 ➕ 左边加 ⋯ 操作面板——对单个文件/目录重命名、移动（剪切）、
   删除（二次确认弹框）、复制路径；另加「移动模式」选目标目录。
   2.39：① 文件行右尾显示文件大小（服务端 bench_ls 回包 fsizes）；
   ② ⋯ 面板加「详细信息」——服务端 bench_stat 回大小/类型/三时间/只读等。 */
const BENCH_LAST_KEY = 'trae_webm_bench_last';
function benchLastRel(){
  try { return localStorage.getItem(BENCH_LAST_KEY) || ''; } catch(e){ return ''; }
}
function benchSaveLast(rel){
  try { localStorage.setItem(BENCH_LAST_KEY, rel || ''); } catch(e){}
}
function benchCrumb(abs){        /* 2.68 顶部面包屑：按绝对路径逐级可点—— */
  /* 💽 D: › 网络硬盘 › … › 工作台 › …   点任一级 → 跳到该上级（可跨出工作台、任意盘） */
  const box = el.lbl_bench;
  if (!box) return;
  box.innerHTML = '';
  const path = String(abs || '');
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'sep'; s.textContent = '›';
    return s;
  };
  const chip = (text, target, cur) => {
    const s = document.createElement('span');
    s.className = 'cs' + (cur ? ' cur' : '');
    s.textContent = text;
    if (!cur) s.onclick = () => benchReq(target);  /* 最后一级=当前，不可点 */
    return s;
  };
  const parts = path.split(/[\\\/]+/).filter(Boolean);
  if (!parts.length){ box.appendChild(chip('📂 工作台', '', true)); return; }
  const SP = path.indexOf('\\') >= 0 ? '\\' : '/';
  let acc = '', start = 0;
  if (/^[A-Za-z]:$/.test(parts[0])){            /* Windows 盘符：D: → 目标 D:\ */
    acc = parts[0] + SP;
    box.appendChild(chip('💽 ' + parts[0], acc, parts.length === 1));
    start = 1;
  } else if (path.indexOf(SP + SP) === 0){      /* UNC：\\server\share 整段作根 */
    acc = SP + SP + parts[0] + SP + parts[1] + SP;
    box.appendChild(chip('🖥 ' + parts[0], acc, parts.length <= 2));
    start = 2;
  } else {                                      /* 类 Unix 根 */
    acc = SP;
    box.appendChild(chip('/', acc, parts.length === 0));
  }
  for (let i = start; i < parts.length; i++){
    acc = acc.replace(/[\\\/]+$/, '') + SP + parts[i];
    box.appendChild(sep());
    box.appendChild(chip(parts[i], acc, i === parts.length - 1));
  }
  box.scrollLeft = box.scrollWidth;    /* 路径过长时右滚到当前目录 */
}
function benchReq(p){       /* p：'' =工作台根；工作台内相对路径；或绝对路径（可跨出工作台） */
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  el.benchlist.innerHTML = '<div class="brow empty">读取中…</div>';
  sendJson({t: 'bench_ls', p: p || ''});
}
function benchIns(path){
  const cur = el.ent.value.trim();
  el.ent.value = (cur ? cur + ' ' : '') + path;
  el.benchpage.classList.remove('on');
  S.bench = null;
  flash('已插入路径', 'var(--green)');
}
function benchOpen(path){          /* 2.28：本地主动弹窗——直接打开浏览页到指定路径 */
  if (window.FileRead) FileRead.close();   /* 关掉可能盖在上面的阅读器 */
  S.bench_mode = 'ins';
  el.benchpage.classList.add('on');
  bpReset();                              /* 2.37：进页面先收起下拉区 */
  benchReq(path || '');
}
function benchModeUI(){                 // 1.06：按模式切换头钮/底栏提示
  const pick = S.bench_mode === 'newdir';
  const move = S.bench_mode === 'move';        // 2.38：移动模式（选目标目录）
  el.bench_ok.style.display = (pick || move) ? '' : 'none';
  if (move){
    el.bench_ok.textContent = '📦 移到此';
    el.bench_ok.title = '把待移动对象移动到当前浏览的目录';
    el.bench_ok.style.minWidth = '76px';
  } else {
    el.bench_ok.textContent = '✅';
    el.bench_ok.title = '选定当前浏览的目录（新建任务）';
    el.bench_ok.style.minWidth = '52px';
  }
  el.bfoot.textContent = move
    ? '📦 单击进入子目录 · ✅ 移动到此处（点行尾 ✅ 移进该子目录）'
    : pick ? '📁 单击进入子目录 · ✅ 选定该目录（新建任务用）'
    : '📁 目录单击进入 · 📄 文件单击查看 · ➕ 插入路径 · ⋯ 更多操作';
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
function benchFmtSize(n){       /* 2.39：字节 → 人类可读（B/KB/MB/GB/TB）；-1/无效 → '' */
  if (typeof n !== 'number' || n < 0) return '';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n, i = -1;
  while (v >= 1024 && i < u.length - 1){ v /= 1024; i++; }
  return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}
function benchRender(v){
  bpReset();                          /* 2.37：任何一次应答到达都收起下拉区 */
  if (!v || !v.ok){
    /* 2.30：记忆的上次目录已失效（被删/改名）→ 清记忆、回落根目录 */
    if (S.bench_retry_last){
      S.bench_retry_last = false;
      benchSaveLast('');
      benchReq('');
      return;
    }
    flash('📂 ' + ((v && v.err) || '读取失败')); return;
  }
  S.bench_retry_last = false;
  S.bench = v;
  const move = S.bench_mode === 'move';        /* 2.38：移动模式（选目标目录） */
  const pick = S.bench_mode === 'newdir' || move;
  const rel = v.rel || '';
  /* 2.68：只在工作台内才记忆——跃迁到上级/别的盘是临时的，下次自动回工作台 */
  benchSaveLast(v.in_root ? rel : '');
  benchCrumb(v.path || '');              /* 2.68：顶部按绝对路径逐级可点 */
  const box = el.benchlist;
  box.innerHTML = '';
  if (v.parent_abs){                        // 有上级就显示（含跨出工作台）
    const d = document.createElement('div');
    d.className = 'brow up';
    d.textContent = '⬙ ..';
    d.onclick = () => benchReq(v.parent_abs);
    box.appendChild(d);
  }
  for (const n of (v.dirs || [])){
    const sub = v.path + '\\' + n;          // 2.68：绝对路径进入（可跨出工作台）
    const d = document.createElement('div');
    d.className = 'brow dir';
    d.textContent = '📁 ' + n;
    d.onclick = () => benchReq(sub);       // 目录单击进入（手机无双击）
    const b = document.createElement('span');
    if (pick){                              // 1.06：选目录/移动模式 → ✅
      b.textContent = '✅';
      b.title = move ? '移动到此目录' : '选定此目录新建任务';
      b.onclick = e => { e.stopPropagation();
        move ? benchMoveInto(v.path + '\\' + n) : benchPick(v.path + '\\' + n); };
    } else {                                // 原模式 → ➕ 插路径
      b.textContent = '➕';
      b.title = '插入此目录路径';
      b.onclick = e => { e.stopPropagation(); benchIns(v.path + '\\' + n); };
    }
    b.className = 'plus';
    d.appendChild(b);
    if (!pick) d.appendChild(benchOpsBtn(v.path + '\\' + n, true));  /* 2.38：⋯ */
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
      d.appendChild(benchOpsBtn(v.path + '\\' + n, false));   /* 2.38：⋯ */
      if (v.fsizes && (n in v.fsizes)){                       /* 2.39：文件大小 */
        const s = document.createElement('span');
        s.className = 'bsz';
        s.textContent = benchFmtSize(v.fsizes[n]);
        d.appendChild(s);
      }
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
/* ---- 2.37：📂 浏览页「下拉刷新」——列表顶部继续下拽，松手重取当前目录 ----
   服务端 bench_ls 是「点一次答一次」的静态拉取，不会自动广播；
   目录里新出现的文件/子目录，靠这一下主动重拉刷过来。 */
const BENCH_PULL_MAX = 84, BENCH_PULL_TRIG = 56;   /* 展露上限 / 触发阈值(px) */
let bpStartY = 0, bpActive = false, bpDist = 0;
function bpPageOn(){ return !!(el.benchpage && el.benchpage.classList.contains('on')); }
function bpSet(h, txt, settle){     /* 展露区高度 + 文案（拖拽不加过渡，松手才平滑） */
  const p = el.benchpull;
  if (!p) return;
  p.classList.toggle('settle', !!settle);
  p.style.height = Math.max(0, h) + 'px';
  if (txt != null) p.querySelector('.bp_txt').textContent = txt;
}
function bpReset(){                  /* 收起（应答到达 / 离开浏览页时） */
  bpActive = false; bpDist = 0;
  const p = el.benchpull;
  if (!p) return;
  p.classList.remove('load', 'ready');
  bpSet(0, '下滑刷新', true);
}
function bpRefresh(){                /* 松手过阈：留住展露区 → 重拉当前目录 */
  bpActive = false;
  const p = el.benchpull;
  if (p){ p.classList.add('load'); p.classList.remove('ready'); }
  bpSet(BENCH_PULL_TRIG, '下滑刷新中…', true);
  benchReq((S.bench && S.bench.path) || benchLastRel() || '');  /* 答回→benchRender→bpReset */
}
el.benchlist.addEventListener('touchstart', e => {
  if (!bpPageOn()){ bpActive = false; return; }
  if (el.benchlist.scrollTop <= 0){ bpStartY = e.touches[0].clientY; bpActive = true; bpDist = 0; }
  else bpActive = false;
}, {passive: true});
el.benchlist.addEventListener('touchmove', e => {
  if (!bpActive) return;
  const p = el.benchpull;
  const dy = e.touches[0].clientY - bpStartY;
  if (dy <= 0 || el.benchlist.scrollTop > 0){     /* 上滑 / 列表已滚动 → 撤销下拉 */
    if (bpDist){ bpDist = 0; if (p) p.classList.remove('ready'); bpSet(0, '下滑刷新', false); }
    return;
  }
  bpDist = Math.min(BENCH_PULL_MAX, dy * 0.5);    /* 阻尼 0.5 */
  if (p) p.classList.toggle('ready', bpDist >= BENCH_PULL_TRIG);
  bpSet(bpDist, bpDist >= BENCH_PULL_TRIG ? '松手刷新' : '下滑刷新', false);
  if (e.cancelable) e.preventDefault();           /* 挡住列表原生回弹 */
}, {passive: false});
el.benchlist.addEventListener('touchend', () => {
  if (!bpActive) return;
  bpActive = false;
  if (bpDist >= BENCH_PULL_TRIG) bpRefresh(); else bpReset();
});
el.benchlist.addEventListener('touchcancel', () => { if (bpActive) bpReset(); });
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
  bpReset();                         /* 2.37：进页面先收起下拉区 */
  const last = benchLastRel();       /* 2.30：回到上次查看的目录（无记忆=根） */
  S.bench_retry_last = !!last;
  benchReq(last);
};
el.benchback.onclick = () => {
  el.benchpage.classList.remove('on');
  bpReset();                                /* 2.37：离开页面收起下拉区 */
  S.bench_mode = 'ins';                     // 返回即复位（防模式残留）
  benchModeUI();
};
el.bench_up.onclick = () => benchReq((S.bench || {}).parent_abs || '');
el.bench_ok.onclick = () => {               // 1.06：选定当前浏览目录
  if (S.bench_mode === 'move'){             // 2.38：移动模式 → 移到当前目录
    benchMoveInto((S.bench && S.bench.path) || '');
    return;
  }
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
  bpReset();                       /* 2.37：进页面先收起下拉区 */
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

/* ================= 2.38：浏览页「文件操作」——行尾 ⋯ 面板 =================
   ⋯ 位于 ➕ 左边，点它对单个文件/目录做常见操作：重命名、移动（剪切）、
   删除、复制路径。删除走二次确认弹框（用户要求「删除要慎重」）。
   操作经 bench_rename/bench_move/bench_del 交给服务端执行，结果以同名
   事件回投（benchOnRename/benchOnMove/benchOnDel），成功后重拉当前目录。
   移动采用「先入移动模式 → 再选目标目录」：进模式后行尾 ✅ 变「移到此」，
   可逐级进入目标目录后点 ✅，或直接点头部「📦 移到此」移到当前目录。
   2.39：面板再加「详细信息」（bench_stat → 大小/类型/三时间/只读，可复制）；
   文件行右尾另显文件大小（bench_ls 回包 fsizes）。 */

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
function benchOpsBtn(path, isDir){   /* 行尾 ⋯ 按钮（挂在 ➕ 左边） */
  const s = document.createElement('span');
  s.className = 'ops';
  s.textContent = '⋯';
  s.title = '更多操作（重命名 / 移动 / 删除）';
  s.onclick = e => { e.stopPropagation(); benchOpsOpen(path, isDir); };
  return s;
}
function benchOpsOpen(path, isDir){
  const name = String(path).split(/[\\\/]/).filter(Boolean).pop() || path;
  const box = bsOpen('操作：' + name);
  const item = (ic, label, danger, fn) => {
    const it = document.createElement('div');
    it.className = 'bs_it' + (danger ? ' danger' : '');
    const a = document.createElement('span'); a.className = 'ic'; a.textContent = ic;
    const b = document.createElement('span'); b.textContent = label;
    it.appendChild(a); it.appendChild(b);
    it.onclick = () => { bsClose(); setTimeout(fn, 160); };
    box.appendChild(it);
  };
  item('✏️', '重命名', false, () => benchRenameDlg(path, name));
  item('📦', '移动 / 剪切', false, () => benchMoveStart(path));
  item('🗑️', '删除', true, () => benchDelConfirm(path, name, isDir));
  item('📋', '复制路径', false, () => copyText(path));
  item('ℹ️', '详细信息', false, () => benchInfoDlg(path));   /* 2.39 */
}
function benchRenameDlg(path, name){
  const box = bsOpen('重命名');
  const inp = document.createElement('input');
  inp.className = 'bs_in';
  inp.type = 'text';
  inp.value = name;
  box.appendChild(inp);
  const btns = document.createElement('div');
  btns.className = 'bs_btns';
  btns.appendChild(bsBtn('取消', '', bsClose));
  btns.appendChild(bsBtn('确定', 'primary', () => {
    const nv = inp.value.trim();
    bsClose();
    if (!nv || nv === name) return;
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    flash('✏️ 正在重命名…', 'var(--blue)');
    sendJson({t: 'bench_rename', p: path, name: nv});
  }));
  box.appendChild(btns);
  setTimeout(() => { try { inp.focus(); inp.select(); } catch(e){} }, 240);
}
function benchDelConfirm(path, name, isDir){   /* 删除必须二次确认 */
  const box = bsOpen('删除确认');
  const msg = document.createElement('div');
  msg.className = 'bs_msg';
  msg.textContent = '确定要删除' + (isDir ? '文件夹「' : '文件「') + name + '」吗？'
    + (isDir ? '\n其中的内容会一并删除，' : '') + '此操作不可恢复！';
  box.appendChild(msg);
  const btns = document.createElement('div');
  btns.className = 'bs_btns';
  btns.appendChild(bsBtn('取消', '', bsClose));
  btns.appendChild(bsBtn('删除', 'danger', () => {
    bsClose();
    if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
    flash('🗑 正在删除…', 'var(--red)');
    sendJson({t: 'bench_del', p: path});
  }));
  box.appendChild(btns);
}
function benchMoveStart(path){       /* 进入移动模式：从源所在目录开始选目标 */
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  S.bench_move_src = path;
  S.bench_mode = 'move';
  benchModeUI();
  const par = String(path).replace(/[\\\/][^\\\/]*$/, '');
  benchReq(par || '');
  flash('📦 请选择目标文件夹（行尾 ✅ 或头部「📦 移到此」）', 'var(--blue)');
}
function benchMoveInto(dst){
  const src = S.bench_move_src;
  if (!src){ flash('没有待移动的对象'); benchMoveCancel(); return; }
  if (!dst){ flash('目标目录无效'); return; }
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  flash('📦 正在移动…', 'var(--blue)');
  sendJson({t: 'bench_move', src: src, dst: dst});
  benchMoveCancel();                /* 先退出移动态防重复提交 */
}
function benchMoveCancel(){
  S.bench_mode = 'ins';
  benchModeUI();
}
function benchReload(){ benchReq((S.bench && S.bench.path) || ''); }
function benchAfterOp(msg){
  flash(msg, 'var(--green)');
  if (bpPageOn()) benchReload();
}
function benchOnDel(v){              /* 服务端 bench_del 应答 */
  if (v && v.ok) benchAfterOp('✅ 已删除');
  else flash('删除失败：' + ((v && v.err) || '未知错误'));
}
function benchOnRename(v){           /* 服务端 bench_rename 应答 */
  if (v && v.ok) benchAfterOp('✅ 已重命名');
  else flash('重命名失败：' + ((v && v.err) || '未知错误'));
}
function benchOnMove(v){             /* 服务端 bench_move 应答 */
  if (v && v.ok){
    S.bench_move_src = '';
    benchAfterOp('✅ 已移动');
  } else {
    flash('移动失败：' + ((v && v.err) || '未知错误'));
    if (S.bench_move_src){          /* 失败→回到移动模式供重选目标 */
      S.bench_mode = 'move';
      benchModeUI();
    }
  }
}
function benchInfoDlg(path){         /* 2.39：详细信息——向服务端要 stat */
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  const box = bsOpen('详细信息');
  const w = document.createElement('div');
  w.className = 'bs_msg';
  w.textContent = '读取中…';
  box.appendChild(w);
  sendJson({t: 'bench_stat', p: path});
}
function benchOnStat(v){             /* 服务端 bench_stat 应答 */
  if (!v || !v.ok){
    flash('详细信息读取失败：' + ((v && v.err) || '未知错误')); return;
  }
  const box = bsOpen('详细信息');
  const fmtT = t => t ? new Date(t * 1000).toLocaleString() : '—';
  const rows = [
    ['名称', v.name],
    ['类型', v.is_dir ? '文件夹' : ('文件' + (v.ext ? '（.' + v.ext + '）' : ''))],
    ['位置', v.path],
    ['大小', v.is_dir ? (v.count >= 0 ? (v.count + ' 项') : '—')
                      : (benchFmtSize(v.size) || '—')],
    ['修改时间', fmtT(v.mtime)],
    ['创建时间', fmtT(v.ctime)],
    ['访问时间', fmtT(v.atime)],
    ['只读', v.readonly ? '是' : '否'],
  ];
  for (const kv of rows){
    const r = document.createElement('div');
    r.className = 'bs_kv';
    const a = document.createElement('span'); a.className = 'k'; a.textContent = kv[0];
    const b = document.createElement('span'); b.className = 'v'; b.textContent = kv[1];
    r.appendChild(a); r.appendChild(b);
    box.appendChild(r);
  }
  const btns = document.createElement('div');
  btns.className = 'bs_btns';
  btns.appendChild(bsBtn('复制信息', '', () => {
    copyText(rows.map(kv => kv[0] + '：' + kv[1]).join('\n'));
    flash('已复制详细信息', 'var(--green)');
  }));
  btns.appendChild(bsBtn('关闭', 'primary', bsClose));
  box.appendChild(btns);
}
