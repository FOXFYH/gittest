/* ============================================================================
 * TRAE远程控制3.0 网页模块 · 任务弹窗（对应 page_taskdlg）    版本 1.00
 * ---------------------------------------------------------------------------
 * 3.87：从主入口 HTML 拆出（主入口 URL 不变、仍是唯一入口）；首次点左抽屉
 * 「✚ 新任务」或会话文件夹组头「➕」时，由主文件 加载模块() 动态注入本文件
 * （带 ?v=VER 杀缓存）。
 *
 * 【同一全局作用域】经典脚本，可直接用主文件的 el / S / flash / sendCmd 等
 * 全局；切勿重复声明主文件已有的 const/let/function 名。
 * 【职责】1.08 新建任务弹窗（对齐服务端 v1.10 TaskDlg 两态渲染；原入口并入）；
 *        1.11 锁定模式（文件夹组名 → 组内新建）；选择/重选走 📂 浏览页。
 * 【接口】打开新建任务() / taskDlgOpen(lock)：主入口经 加载模块() 调用。
 *        本文件加载时自行绑定 td_none / td_re / td_ok / td_cancel。
 * 【依赖】选目录回填依赖 浏览页模块（taskPickDir 内先 加载模块('模块_浏览页')）。
 *        onEv 里 task_dlg/task_dlg_ok/cmderr 调 taskDlgRender/taskDlgClose 均带
 *        S.task_open 守卫，未加载本模块时不会被引用。
 * ==========================================================================*/
'use strict';

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
  加载模块('模块_浏览页', () => {
    benchModeUI();
    el.benchpage.classList.add('on');
    benchReq('');
  });
}

/* —— 入口（主入口点击后由 加载模块 调用 打开新建任务） —— */
function 打开新建任务(){
  taskDlgOpen();
  flash('正在展开新建任务…', 'var(--blue)');
  sendCmd('new_task_dlg', null);
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