/* ============================================================================
 * TRAE远程控制3.0 网页模块 · 浏览页（对应 page_bench）        版本 1.00
 * ---------------------------------------------------------------------------
 * 3.87：从主入口 HTML 拆出。主入口 URL 不变、仍是唯一入口；首次点「📂」等
 * 入口时由主文件 加载模块() 动态注入本文件（带 ?v=VER 杀缓存）后执行。
 *
 * 【为什么会话是同一个】本文件是「经典脚本」——与主文件共享同一个全局作用
 * 域，可直接读取主文件的 el / S / flash / esc / sendCmd / sendJson / VER 等
 * 全局；因此**切勿在此重复声明主文件已有的 const/let/function 名**，否则会
 * 触发「重复声明」或互相覆盖。
 *
 * 【职责】📂 工作台远程浏览页：bench_ls 逐级拉目录（服务端强制约束在工作台
 * 根内）；双模式——ins=插路径（原行为）/ newdir=选工作目录新建任务。
 * 【接口】打开浏览页()：主入口 el.bench.onclick 经 加载模块() 调用。
 *        本文件加载时自行绑定 btn_benchback / btn_bench_up / btn_bench_ok。
 * 【依赖】主文件 el/S/flash/sendJson；选目录回填用到 任务弹窗模块 的 taskDlgRender
 *        （只在 newdir 模式触发，彼时 任务弹窗模块 必已加载）。
 * ==========================================================================*/
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
function benchModeUI(){                 // 1.06：按模式切换头钮/底栏提示
  const pick = S.bench_mode === 'newdir';
  el.bench_ok.style.display = pick ? '' : 'none';
  el.bfoot.textContent = pick
    ? '📁 单击进入子目录 · ✅ 选定该目录（新建任务用）'
    : '📁 目录单击进入 · ➕ 插入目录路径 · 📄 文件单击插入';
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
      d.onclick = () => benchIns(v.path + '\\' + n);
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

/* —— 入口（主入口点击后由 加载模块 调用 打开浏览页） —— */
function 打开浏览页(){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试，无法浏览工作台'); return; }
  S.bench_mode = 'ins';
  benchModeUI();
  el.benchpage.classList.add('on');
  benchReq('');
}
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