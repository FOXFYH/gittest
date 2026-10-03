/* ============================================================================
 * TRAE远程控制3.0 网页模块 · 分身页（对应 page_prof）        版本 1.00
 * ---------------------------------------------------------------------------
 * 3.87：从主入口 HTML 拆出（主入口 URL 不变、仍是唯一入口）；首次点左抽屉
 * 「👥 分身状态」时由主文件 加载模块() 动态注入本文件（带 ?v=VER 杀缓存）。
 *
 * 【同一全局作用域】经典脚本，可直接用主文件的 el / S / flash / esc /
 * sendCmd / VER / $ 等全局；切勿重复声明主文件已有的 const/let/function 名。
 *
 * 【职责】v1.45 谷歌分身状态页：服务端外挂「谷歌分身助手转接器」推送历史积分
 * 与登录状态；「全量实测」=真开无界面 Chrome 读官方用量页（耗时数分钟）；
 * 2.19 一键换号迁移（原版换号 + 对话记录智能迁移）。
 * 【接口】打开分身页()：主入口 el.prof.onclick 经 加载模块() 调用。
 *        本文件加载时自行绑定 btn_profback / btn_profref / btn_profswitch。
 * 【依赖】主文件 el/S/flash/esc/sendCmd/$/drawerClose；profiles/switch_migrate
 *        事件到来时（onEv 内）调用的 renderProf 已带「本页是否打开」守卫，
 *        故未加载本模块时不会被引用。
 * ==========================================================================*/
'use strict';

function renderProf(){
  if (!el.profpage.classList.contains('on')) return;
  const d = S.profiles;
  const run = !!S.prof_run;
  el.profref.disabled = false;
  el.profref.textContent = run ? '停止' : '全量实测';
  const hint = d
    ? ('管理分身 ' + d.count + ' 个 · 已实测 ' + d.checked + ' 个 · 最近实测 ' +
       (d.last_refresh || '—') +
       (run ? ' · 正在实测（真实访问网页，耗时数分钟）' : '') +
       '  ·  右侧「实测」=查登录/积分，「补登录」=借登录助手自动登录')
    : '（无数据）';
  el.profhint.textContent = hint;
  const list = (d && d.profiles) || [];
  let html = '';
  for (const p of list){
    const st = p.status || '未实测';
    const cls = st === '已登录' ? '' : (st === '掉线' ? ' down' : ' unk');
    const qn = JSON.stringify(p.name);         /* 精确名，防前缀连带 */
    html += '<div class="prof_card"><div class="prof_row1">' +
      '<span class="prof_name">' + esc(p.name) + '</span>' +
      '<span class="prof_st' + cls + '">' + esc(st) + '</span>' +
      '<button class="prof_test" data-n="' + qn + '" onclick="profTest(' +
      qn + ')">实测</button>' +
      '<button class="prof_login" data-n="' + qn + '" onclick="profLogin(' +
      qn + ')">补登录</button>' +
      '<span class="prof_acc">' + esc(p.account || '') + '</span></div>' +
      '<div class="prof_row2">' +
      '<span>总积分 <b class="prof_pts">' + esc(p.points || '—') + '</b></span>' +
      '<span>月积分 ' + esc(p.monthly || '—') + '</span>' +
      '<span>最近到期 ' + esc(p.expire || '—') + '</span>' +
      '<span>实测 ' + esc(p.time || '—') + '</span>' +
      '</div></div>';
  }
  el.proflist.innerHTML = html || '<div class="empty">（暂无分身数据）</div>';
}

/* v1.46：单测指定分身。
   v1.47：取代机制——若已在实测，服务端 start_refresh 会自动终止旧的
   改测本分身（即便在跑也可再点，直接取代，不再拒绝）。 */
function profTest(name){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  sendCmd('profiles_refresh', [name]);   /* 传数组 → 服务端精确实测该分身 */
  S.prof_run = true;
  renderProf();
  flash('正在实测 ' + name + ' …', 'var(--blue)');
}

/* 2.18：补登录——借服务端「谷歌分身助手 / T登录助手」的 HTTP 接口，对指定
   分身发起自动登录（分身名→编号自动映射手机号，跟人手操作一样）。服务没起
   时服务端会自动拉起分身助手；滑块/超时由对方负责，跑完回 profiles_login。*/
function profLogin(name){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  sendCmd('profiles_login', name);   /* 传分身名 → 服务端借登录助手 */
  flash('正在补登录 ' + name + ' …（服务端会先确保登录助手在线）',
        'var(--green)');
}

/* 2.19：一键换号迁移——填目标号码，服务端一站式完成「原版换号
   （沙盒启动器 origin-login）+ 对话记录智能迁移（最重度账号全部会话换新ID
   并入当前账号）」。进度经 switch_migrate 事件流回投到 #prof_swlog。 */
function switchMigratePrompt(){
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  let ov = $('swmask');
  if (ov) ov.remove();
  ov = document.createElement('div');
  ov.id = 'swmask';
  ov.style.cssText = 'position:fixed; inset:0; z-index:70; background:rgba(0,0,0,.45);'
    + 'display:flex; align-items:center; justify-content:center;';
  ov.innerHTML =
    '<div style="background:#fff; border-radius:10px; padding:16px; width:86%; max-width:380px;">'
    + '<div style="font-weight:bold; font-size:15px; margin-bottom:8px;">🔁 一键换号迁移</div>'
    + '<div style="font-size:12px; color:#555; line-height:1.55; margin-bottom:10px;">'
    + '把原版 TRAE 换成目标号码的账号，并把「最近最重度使用」账号的全部对话记录'
    + '换新ID 一并带过来（可直接开始对话）。期间会短暂关闭原版 TRAE（写完自动拉起）；'
    + '分身若掉线会自动拉起分身助手补登录（弹滑块需人工滑）。</div>'
    + '<input id="swin" inputmode="numeric" autocomplete="off"'
    + ' placeholder="输入目标号码，如 18" style="width:100%; box-sizing:border-box;'
    + ' padding:9px; border:1px solid #ccc; border-radius:6px; font-size:16px;">'
    + '<div id="swerr" style="color:#c62828; font-size:12px; min-height:16px;'
    + ' margin-top:4px;"></div>'
    + '<div style="display:flex; gap:8px; margin-top:6px;">'
    + '<button id="swcancel" style="flex:1; padding:10px; border:1px solid #ccc;'
    + ' border-radius:6px; background:#f7f7f7;">取消</button>'
    + '<button id="swok" style="flex:1; padding:10px; border:0; border-radius:6px;'
    + ' background:#0a7d32; color:#fff; font-weight:bold;">开始</button></div>'
    + '</div>';
  document.body.appendChild(ov);
  const inp = $('swin'), err = $('swerr');
  setTimeout(() => { try{ inp.focus(); }catch(e){} }, 80);
  const close = () => { try{ ov.remove(); }catch(e){} };
  $('swcancel').onclick = close;
  ov.onclick = e => { if (e.target === ov) close(); };
  const go = () => {
    const n = (inp.value || '').replace(/\D/g, '');
    if (!n){ err.textContent = '请输入目标号码（纯数字）'; return; }
    close();
    const slog = $('prof_swlog');
    if (slog){ slog.style.display = 'block'; slog.textContent = '（已提交，等待服务端…）'; }
    sendCmd('switch_migrate', n);
    S.switch_mig = { on: true, ok: null, log: [] };
    flash('🚀 一键换号迁移已启动（目标 ' + n + ' 号）…', 'var(--blue)', 6000);
  };
  $('swok').onclick = go;
  inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); };
}

/* —— 入口（主入口点击后由 加载模块 调用 打开分身页） —— */
function 打开分身页(){
  drawerClose();
  sendCmd('profiles');              // 拉一次当前数据
  renderProf();
  el.profpage.classList.add('on');
}
el.profback.onclick = () => el.profpage.classList.remove('on');
el.profref.onclick = () => {
  if (!S.onLine){ flash('⚠ 还没连上，稍后再试'); return; }
  /* v1.47：运行中为「停止」；空闲为「全量实测」。停止成功与否由
     profiles_run stopped 事件反馈。 */
  if (S.prof_run){ sendCmd('profiles_stop'); flash('正在停止…'); return; }
  sendCmd('profiles_refresh');      // 真实访问谷歌分身助手（后台）
  S.prof_run = true;
  renderProf();
};
el.profswitch.onclick = switchMigratePrompt;