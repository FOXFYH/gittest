/* ============================================================================
 * TRAE远程控制3.0 网页模块 · 收藏页（对应 page_fav）        版本 1.00
 * ---------------------------------------------------------------------------
 * 3.87：从主入口 HTML 拆出（主入口 URL 不变、仍是唯一入口）；首次点顶栏
 * 「☆」时由主文件 加载模块() 动态注入本文件（带 ?v=VER 杀缓存）。
 *
 * 【同一全局作用域】经典脚本，可直接用主文件的 el / S / esc / sendCmd /
 * flash 等全局；切勿重复声明主文件已有的 const/let/function 名。
 *   注意：loadFavs / saveFavs / modelDisp / rebuildModelOptions /
 *   checkFavInvalid 都**仍留在主文件**（启动即用、models 事件即用），
 *   本模块只负责「收藏页」这一页渲染。
 * 【职责】1.15 模型收藏管理页：列出官方全部模型，点行收藏/取消收藏；
 *        失效收藏单列一节可移除；1.74「刷新模型」发 model_list。
 * 【接口】打开收藏页()：主入口 el.fav.onclick 经 加载模块() 调用。
 *        本文件加载时自行绑定 btn_favback / btn_favrefresh。
 * ==========================================================================*/
'use strict';

function renderFavPage(){
  const L = el.favlist;
  L.innerHTML = '';
  const mk = (html, cls) => {
    const d = document.createElement('div');
    d.className = 'frow' + (cls ? ' ' + cls : '');
    d.innerHTML = html;
    return d;
  };
  if (!(S.models_full || []).length){
    L.appendChild(mk('<span class="fname">（尚未获取到官方模型列表，'
      + '连接服务端后会自动加载）</span>', 'empty'));
  }
  const names = new Set((S.models_full || []).map(e => e[0]));
  /* 失效收藏单列一节：红字 + 点击移除。
     v1.54：只在【官方列表已到手】时判失效——列表为空时把全部收藏列成
     「⚠ 已失效 + ✕ 移除」是误伤（用户会照删）；此时上面已给「尚未获取
     到官方模型列表」提示，这里直接不渲染这一节。 */
  for (const fn of (names.size ? (S.favs || []) : [])){
    if (names.has(fn)) continue;
    const d = mk('<span class="fmark">⚠ 已失效</span>'
      + '<span class="fname">' + esc(fn) + '</span>'
      + '<span class="fstar">✕</span>', 'dead');
    d.onclick = () => {
      saveFavs(S.favs.filter(x => x !== fn));
      renderFavPage(); rebuildModelOptions(); checkFavInvalid();
    };
    L.appendChild(d);
  }
  /* 官方全量模型：点行切换收藏状态 */
  for (const e of (S.models_full || [])){
    const fn = e[0], on = (S.favs || []).includes(fn);
    const d = mk('<span class="fname">' + esc(modelDisp(e)) + '</span>'
      + '<span class="fstar">' + (on ? '★' : '☆') + '</span>',
      on ? 'isfav' : '');
    d.onclick = () => {
      saveFavs(on ? S.favs.filter(x => x !== fn)
                  : S.favs.concat([fn]));
      renderFavPage(); rebuildModelOptions();
    };
    L.appendChild(d);
  }
}

/* —— 入口（主入口点击后由 加载模块 调用 打开收藏页） —— */
function 打开收藏页(){
  renderFavPage();
  el.favpage.classList.add('on');
}
el.favback.onclick = () => el.favpage.classList.remove('on');
/* 1.74：收藏页「刷新模型」——发 model_list 命令让服务端 CDP 重拉
   最新官方模型列表；结果经 models 事件回来自动刷新本页与下拉。 */
el.favrefresh.onclick = () => {
  const b = el.favrefresh;
  b.disabled = true; b.textContent = '刷新中…';
  renderFavPage(); sendCmd('model_list', null);
  setTimeout(() => { b.disabled = false; b.textContent = '↻ 刷新模型'; }, 1200);
};