"ui";

/**
 * ============================================================
 * 双站切换器  v1.23   （手机端 / AutoX.js v7 / 打包成独立 APK）
 * ------------------------------------------------------------
 * 干什么：
 *   一个应用装两个网站：全屏 WebView + 右上角一条浮层竖条，
 *   竖条上四个同款方块按钮 **T / W / ↻ / ⚙**：
 *     · T ＝ TRAE 网页版（AI，TRAE同步显示与控制工具 手机客户端）
 *     · W ＝ WorkBuddy 网页版（wbcli 手机客户端）
 *     · ↻ ＝ 刷新当前网页
 *     · ⚙ ＝ 设置面板（版本号 / 当前站 / 检查更新 / 清缓存 / 条位复位 / 退出）
 *   点 T/W ＝ 切到对应网站，应用被切到后台时会自己再提到前台。
 *
 * 竖条：
 *   · T / W / ↻ / ⚙ 四个圆角方块，统一 79×79px（黑底+白描边+白字）；
 *   · 按住可拖动，松手记住位置（存记事.json，下次打开还在）；
 *   · ★ 当前站那个按钮＝**更深更实的黑底 + 琥珀描边 + 琥珀字**，一眼看出现在开的是哪个站。
 *
 * ★ v1.21：✕ 撤掉（退出挪进设置面板，防误触）；新增刷新、设置面板。
 * ★ v1.22：刷新/设置改**图标**（↻ / ⚙）——用户不想看字；⚙ 后加 U+FE0E 强制黑白色。
 * ★ v1.23：v1.22 在打包 APK 里起不来（AutoX 脚本环境能跑，APK 不行）→
 *           界面改"最保守写法"：XML 只用 v1.20 验证过的属性（w/h/marginTop/textColor/gravity/text），
 *           底色/描边/字号/隐藏全挪到代码里；外面包 try/catch，崩了退回 v1.20 同构布局并 toast 报错。 
 *          设置面板能看版本号、查更新、清缓存重载、复位竖条。
 *
 * ★ v1.20 架构（用户 2026-10-19 定：照「急救版」那样一次打包、别再折腾）：
 *   ① 本文件就是**整个程序**，直接打包进 APK——不再需要从 /脚本/ 读外部文件，
 *      所以不需要「所有文件访问」权限，永远不会因为读不到脚本而白屏。
 *   ② 竖条改成**应用内浮层**（贴在自己的 WebView 上）——不需要「显示在其他应用上层」权限。
 *   ③ 升级走网络：启动时后台从 GitHub Pages 取一次新版，存进自己的私有目录，
 *      **下次打开自动跑新版**。以后升级＝电脑上传一个文件，手机上零操作、永不重打包。
 *   ④ 痕迹仍优先落 /脚本/痕迹/软件痕迹/双站切换器/（有权限时，方便电脑端遥控验收）；
 *      没权限就自动退回 APK 私有目录，功能不受影响。
 *
 * 远程验收/遥控（有存储权限时可用，配合《狐狸AUTOX助手CLI.py》）：
 *   · 写命令： <痕迹目录>/命令.txt
 *       内容＝ {"命令":"开T"} / {"命令":"开W"} / {"命令":"唤前"} / {"命令":"退出"}
 *   · 读状态： 同目录 状态.json（5 秒心跳：版本/当前站/当前URL/页面OK/意愿）
 *
 * 返回键：网页有历史＝网页后退；首页 2 秒内再按一次＝退出。
 *
 * ★ v1.10：加「防双开」——启动时若已有实例心跳鲜活(<5s)，1.5 秒后复查仍鲜活 → 本实例静默退场。
 * ★ v1.11：权限事故排查（现已由 v1.20 的免权限架构取代）。
 * ============================================================
 */

importClass(android.webkit.WebViewClient);
importClass(android.webkit.WebChromeClient);

var APP_NAME = "双站切换器";
var APP_VERSION = "v1.23";   // v1.23：APK 里起不来 → 界面改"最保守 XML"（只用 v1.20 验证过的属性）+ 崩溃兜底 + 报错可见。

// ★ 两个网站的地址。以后换地址只改这两行（或用 记事.json 的 站点 字段覆盖，不用改代码）。
var 默认站点 = {
    T: "https://foxfyh.github.io/gittest/TRAE同步显示与控制工具_网页客户端_手机版.html",
    W: "https://foxfyh.github.io/gittest/wbcli.html?v=2.00"
};
var 站点说明 = { T: "TRAE 网页版(AI)", W: "WorkBuddy 网页版" };

// ================================================================
// 零、痕迹落点（★2026-10-15 规范：痕迹一律落 脚本/痕迹/软件痕迹/<软件名>/）
//   ★ 路径写死 /storage/emulated/0/脚本/... —— 空壳 APK 里也要能按同一地址找到本脚本与痕迹。
// ================================================================
var 私有目录 = "";
try { 私有目录 = String(context.getFilesDir().getAbsolutePath()); } catch (e) {}

// ★ v1.20：痕迹优先落规范位置（/脚本/痕迹/软件痕迹/双站切换器/）；
//   没有"所有文件访问"权限时自动退回 APK 自己的私有目录——程序照样能用，绝不因此起不来。
var 痕迹目录 = (function () {
    var 候选 = ["/storage/emulated/0/脚本/痕迹/软件痕迹/双站切换器/", 私有目录 + "/痕迹/"];
    for (var i = 0; i < 候选.length; i++) {
        try {
            files.ensureDir(候选[i] + "试.txt");
            files.write(候选[i] + "试.txt", "1");
            try { files.remove(候选[i] + "试.txt"); } catch (e) {}
            return 候选[i];
        } catch (e) {}
    }
    return 私有目录 + "/痕迹/";
})();
var 记事文件 = 痕迹目录 + "记事.json";
var 状态文件 = 痕迹目录 + "状态.json";
var 命令文件 = 痕迹目录 + "命令.txt";
try { files.ensureDir(状态文件); } catch (e) {}
try { files.ensureDir(命令文件); } catch (e) {}

// ================================================================
// 零之二、自更新（★ v1.20 免重打包的关键）
//   APK 里带的是"底座"。新版由电脑上传到 GitHub Pages，本程序启动时后台取一次，
//   存进自己的私有目录；**下次打开优先跑新版**。所以以后升级＝电脑上一条上传命令，
//   手机上什么都不用做（不推文件、不重打包、不碰权限）。
// ================================================================
var 更新地址 = "https://foxfyh.github.io/gittest/shuangzhan.js";
var 新版缓存 = 私有目录 + "/最新.js";

function 版本位(v) {
    var a = String(v || "").replace(/^v/i, "").split(".");
    var r = [];
    for (var i = 0; i < 3; i++) r.push(parseInt(a[i], 10) || 0);
    return r;
}
function 版本更大(a, b) {
    var A = 版本位(a), B = 版本位(b);
    for (var i = 0; i < 3; i++) {
        if (A[i] > B[i]) return true;
        if (A[i] < B[i]) return false;
    }
    return false;
}
function 源里版本(src) {
    var m = String(src).match(/APP_VERSION\s*=\s*"v?([\d.]+)"/);
    return m ? m[1] : "";
}

// 启动最早期（还没建界面）：私有目录里有比内置更新的版本 → 直接跑它，本实例退场
(function () {
    try {
        if (!files.exists(新版缓存)) return;
        var src = files.read(新版缓存);
        var v = 源里版本(src);
        if (!v || !版本更大(v, APP_VERSION)) return;
        engines.execScriptFile(新版缓存);
        exit();
    } catch (e) {
        try { files.remove(新版缓存); } catch (e2) {}
    }
})();

// ★ v1.21：加 手动 参数——设置了面板里点「检查更新」要看得见结果（成功/失败都说一声）
function 检查更新(手动) {
    threads.start(function () {
        var 说 = "", 好 = false;
        try {
            var r = http.get(更新地址);
            if (!r || r.statusCode !== 200) throw new Error("连不上更新地址");
            var src = String(r.body.string() || "");
            if (src.length < 3000 || src.indexOf("APP_VERSION") < 0) throw new Error("更新文件不正常");
            var v = 源里版本(src);
            if (!v) throw new Error("读不出版本号");
            if (!版本更大(v, APP_VERSION)) {
                说 = "已是最新 " + APP_VERSION;
                好 = true;
            } else {
                files.write(新版缓存, src);
                说 = "新版 v" + v + " 已下载，下次打开自动生效";
                好 = true;
                最近备注 = "已下载新版 v" + v;
                try { toast("新版 v" + v + " 已下载，下次打开自动生效"); } catch (e) {}
            }
        } catch (e) {
            说 = "检查失败：" + (e && e.message ? e.message : e);
        }
        if (手动) {
            try { toast(说); } catch (e) {}
            最近备注 = 说;
        }
        try { 刷设置文本(); } catch (e) {}
        return 好;
    });
}

var 记事 = { 当前站: "T", 条X: -1, 条Y: -1, 意愿: "跑", 站点: {} };
(function 读记事() {
    try {
        var j = JSON.parse(files.read(记事文件));
        if (j && typeof j === "object") {
            if (j.当前站 === "T" || j.当前站 === "W") 记事.当前站 = j.当前站;
            if (typeof j.条X === "number") 记事.条X = j.条X;
            if (typeof j.条Y === "number") 记事.条Y = j.条Y;
            if (j.站点 && typeof j.站点 === "object") 记事.站点 = j.站点;
        }
    } catch (e) {}
})();

function 站URL(k) {
    try { if (记事.站点 && 记事.站点[k]) return String(记事.站点[k]); } catch (e) {}
    return 默认站点[k];
}
function 存记事() {
    try { files.write(记事文件, JSON.stringify(记事)); } catch (e) {}
}

var 当前站 = 记事.当前站;
var 页面OK = false;
var 已结束 = false;      // 用户主动退出（设置面板「退出应用」/ 双按返回 / 命令退出）→ 不再复活
var 已让位 = false;      // 撞锁让位的新实例：什么都不干、等 AutoX 收尸
var 最近备注 = "启动";

// ★ v1.10 防双开：启动时若已有实例心跳鲜活（<5 秒），1.5 秒后复查仍鲜活 → 本实例静默退场
//   （不能碰 记事.意愿——那是"活着的那位"的账；也不能写状态——会盖掉真实例的心跳）
threads.start(function () {
    try {
        var j = JSON.parse(files.read(状态文件));
        if (!(j && j.心跳 && Date.now() - j.心跳 < 5000)) return;
        sleep(1500);
        var j2 = JSON.parse(files.read(状态文件));
        if (j2 && j2.心跳 && Date.now() - j2.心跳 < 5000) {
            已让位 = true;
            try { activity.finish(); } catch (e2) {}
            exit();
        }
    } catch (e) {}
});

// ================================================================
// 一、界面：全屏 WebView（按钮都在悬浮竖条上，界面内不放东西）
// ================================================================
// ★ v1.22：刷新/设置改用图标（用户：不想看字）。设置用 U+FE0E 强制文本样式，防小米渲染成彩色 emoji。
var 图刷新 = "\u21BB";           // ↻
var 图设置 = "\u2699\uFE0E";     // ⚙

// ★ v1.23：打包 APK 环境里 v1.21/1.22 那套带 bg/padding/layout_gravity/visibility 的 XML 起不来，
//   改成"最保守写法"——只用 v1.20 验证过的属性（w/h/marginTop/textColor/gravity/text），
//   其余样式（底色/描边/字号/隐藏）全在代码里设。外面再包一层 try/catch + 兜底布局。
var 布局异常 = "";

var 主XML =
    '<frame>' +
    '<webview id="web" w="*" h="*"/>' +
    '<frame id="设罩" w="*" h="*">' +
    '  <vertical w="*" h="*" gravity="center">' +
    '    <vertical id="设卡" w="700px" h="wrap_content">' +
    '      <text id="设标题" text="双站切换器" textColor="#FFFFFF" gravity="center"/>' +
    '      <text id="设版本" text="版本 -" textColor="#FFD54F" gravity="center"/>' +
    '      <text id="设站" text=" " textColor="#CCFFFFFF" gravity="center"/>' +
    '      <text id="设址" text=" " textColor="#88FFFFFF" gravity="center"/>' +
    '      <text id="设更新" text=" " textColor="#FFD54F" gravity="center"/>' +
    '      <text id="btn检查" text="检查更新" w="*" h="64px" marginTop="16px" textColor="#FFFFFF" gravity="center"/>' +
    '      <text id="btn清缓" text="清缓存重载" w="*" h="64px" marginTop="10px" textColor="#FFFFFF" gravity="center"/>' +
    '      <text id="btn复位" text="条位复位" w="*" h="64px" marginTop="10px" textColor="#FFFFFF" gravity="center"/>' +
    '      <text id="btn生效" text="重启应用（生效）" w="*" h="64px" marginTop="10px" textColor="#FFD54F" gravity="center"/>' +
    '      <text id="btn关设" text="关闭" w="*" h="64px" marginTop="10px" textColor="#FFFFFF" gravity="center"/>' +
    '      <text id="btn退出" text="退出应用" w="*" h="58px" marginTop="16px" textColor="#FF8A80" gravity="center"/>' +
    '      <text id="设脚" text="返回键先关本面板" textColor="#66FFFFFF" marginTop="12px" gravity="center"/>' +
    '    </vertical>' +
    '  </vertical>' +
    '</frame>' +
    '<frame id="条根" w="wrap_content" h="wrap_content">' +
    '  <vertical id="条身" w="wrap_content" h="wrap_content">' +
    '    <text id="bT" text="T" w="79px" h="79px" textColor="#FFFFFF" gravity="center"/>' +
    '    <text id="bW" text="W" w="79px" h="79px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
    '    <text id="bR" text="' + 图刷新 + '" w="79px" h="79px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
    '    <text id="bS" text="' + 图设置 + '" w="79px" h="79px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
    '  </vertical>' +
    '</frame>' +
    '</frame>';

// 兜底：和 v1.20 完全同构（已验证能跑，连 ✕ 都留着），万一主布局在 APK 里起不来，至少还能用
var 兜底XML =
    '<frame>' +
    '<webview id="web" w="*" h="*"/>' +
    '<frame id="条根" w="wrap_content" h="wrap_content">' +
    '  <vertical id="条身" w="wrap_content" h="wrap_content">' +
    '    <text id="bT" text="T" w="79px" h="79px" textColor="#FFFFFF" gravity="center"/>' +
    '    <text id="bW" text="W" w="79px" h="79px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
    '    <text id="bX" text="✕" w="79px" h="40px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
    '  </vertical>' +
    '</frame>' +
    '</frame>';

try {
    ui.layout(主XML);
} catch (e) {
    布局异常 = "主布局崩:" + String(e) + " | " + String(e && e.stack ? e.stack : "").split("\n")[0];
    try {
        ui.layout(兜底XML);
    } catch (e2) {
        布局异常 += " ‖ 兜底也崩:" + String(e2);
    }
    try { alert("界面异常（已降级为简版）", 布局异常); } catch (e3) {}
}

var wv = ui.web;
try { 设初始样式(); } catch (e) {}
var settings = wv.getSettings();
settings.setJavaScriptEnabled(true);   // 网页要跑自己的逻辑
settings.setDomStorageEnabled(true);   // ★ 登录态在 localStorage，不开就每次重登
settings.setUseWideViewPort(true);     // 跟随网页 viewport
settings.setLoadWithOverviewMode(true);
settings.setSupportZoom(false);
settings.setTextZoom(100);             // 不跟系统字体缩放，免得排版乱

wv.setWebViewClient(new JavaAdapter(WebViewClient, {
    onPageFinished: function (view, url) {
        页面OK = true;
        最近备注 = "页面加载完成";
        落状态(true);
    },
    onReceivedError: function (view, errorCode, description, failingUrl) {
        页面OK = false;
        最近备注 = "加载失败:" + description;
        落状态(true);
    }
}));

function 切站(k, 强制) {
    关设置();
    if (当前站 === k && !强制) { 拉回自己(); return; }   // 已在该站：只把应用提到前台，不重载（保住页面状态）
    当前站 = k;
    记事.当前站 = k;
    存记事();
    页面OK = false;
    最近备注 = "切到" + 站点说明[k];
    try {
        ui.run(function () { try { wv.loadUrl(站URL(k)); } catch (e) {} });
    } catch (e) {}
    拉回自己();
    落状态(true);
    try { toast(APP_NAME + " → " + 站点说明[k]); } catch (e) {}
}

// ================================================================
// 二、应用内浮层竖条（T / W / ↻ / ⚙）
//   ★ v1.20：不再用 floaty 系统悬浮窗（那要「显示在其他应用上层」特殊权限，
//     小米上授不了就一直开不出来）。改成贴在本应用 WebView 上的一层浮窗：
//     不需要任何权限，位置照样可拖、可记；打开应用就能切站。
// ================================================================
var 按钮尺寸 = 79;
var 按钮间距 = 6;
var 条 = null;                 // { 根, bT, bW, bR, bS }
var 窗X = -1, 窗Y = -1, 指X = 0, 指Y = 0, 按下X = 0, 按下Y = 0, 已拖动 = false;

function 屏宽() { try { return context.getResources().getDisplayMetrics().widthPixels; } catch (e) { return 1080; } }
function 屏高() { try { return context.getResources().getDisplayMetrics().heightPixels; } catch (e) { return 1920; } }

function 开竖条() {
    if (条) { try { 条.根.setVisibility(0); } catch (e) {} 绑设置(); return true; }
    try {
        条 = { 根: ui.条根, bT: ui.bT, bW: ui.bW, bR: ui.bR, bS: ui.bS };
        if (!条.根) { 条 = null; return false; }
    } catch (e) { 条 = null; return false; }
    默认条位();
    移条(窗X, 窗Y);
    涂条();
    绑条手势();
    绑设置();
    画当前站();
    return true;
}

function 隐藏条() {
    try { if (条 && 条.根) 条.根.setVisibility(8); } catch (e) {}
}

function 默认条位() {
    if (记事.条X >= 0 && 记事.条Y >= 0) { 窗X = 记事.条X; 窗Y = 记事.条Y; return; }
    窗X = 屏宽() - 按钮尺寸 - 10;
    窗Y = Math.round(屏高() * 0.3);
}

function 移条(x, y) {
    窗X = Math.max(0, Math.min(x, 屏宽() - 按钮尺寸));
    窗Y = Math.max(0, Math.min(y, 屏高() - 按钮尺寸 * 4 - 按钮间距 * 3));
    try {
        条.根.setTranslationX(窗X);
        条.根.setTranslationY(窗Y);
    } catch (e) {}
}

// 圆角方块：黑底 + 2px 白描边（照 TRAE远程控制APP 竖条同款 GradientDrawable 画法）
// ★ v1.21：选中态（当前站）＝**更深更实的黑底** + 琥珀描边；未选中＝淡一点的黑，一眼分得清。
function 涂钮(控件, 选中) {
    if (!控件) return;
    try {
        var d = new android.graphics.drawable.GradientDrawable();
        d.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
        d.setCornerRadius(Math.floor(按钮尺寸 * 0.25));
        d.setColor(选中 ? android.graphics.Color.argb(255, 0x00, 0x00, 0x00)    // 选中：纯黑实底（更深）
                        : android.graphics.Color.argb(168, 0x00, 0x00, 0x00));   // 未选中：半透明，浅一些
        d.setStroke(选中 ? 3 : 2, android.graphics.Color.parseColor(选中 ? "#FFFFD54F" : "#80FFFFFF"));
        控件.setBackground(d);
    } catch (e) {}
}

function 涂条() {
    if (!条) return;
    var 圆角 = Math.floor(按钮尺寸 * 0.25);
    try {
        var 字大 = Math.max(10, Math.floor(按钮尺寸 * 0.42));
        var 图标大 = Math.max(12, Math.floor(按钮尺寸 * 0.52));   // 符号本身比汉字"小"，放大一点才跟 T/W 一样压得住
        [条.bT, 条.bW].forEach(function (b) {
            try { b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 字大); b.setGravity(17); } catch (e) {}
            涂钮(b, false);
        });
        [条.bR, 条.bS].forEach(function (b) {
            try { b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 图标大); b.setGravity(17); } catch (e) {}
            涂钮(b, false);
        });
    } catch (e) {}
    画当前站();
}

// 当前站那个按钮：更深底 + 琥珀描边 + 琥珀字；另一个白字淡底——不用猜现在开的是哪个站
function 画当前站() {
    if (!条) return;
    try { 涂钮(条.bT, 当前站 === "T"); } catch (e) {}
    try { 涂钮(条.bW, 当前站 === "W"); } catch (e) {}
    try { 涂钮(条.bR, false); } catch (e) {}
    try { 涂钮(条.bS, false); } catch (e) {}
    try { 条.bT.setTextColor(当前站 === "T" ? 0xFFFFD54F : 0xFFFFFFFF); } catch (e) {}
    try { 条.bW.setTextColor(当前站 === "W" ? 0xFFFFD54F : 0xFFFFFFFF); } catch (e) {}
    try { 条.bR.setTextColor(0xFFFFFFFF); } catch (e) {}
    try { 条.bS.setTextColor(0xFFFFFFFF); } catch (e) {}
}

// 按住拖动；**点一下**（没拖动）＝按落点分派到 T/W/↻/⚙（命中检测用控件在屏上的真实位置）
function 绑条手势() {
    if (!条) return;
    try {
        条.根.setOnTouchListener(function (v, event) {
            switch (event.getAction()) {
                case event.ACTION_DOWN:
                    指X = event.getRawX(); 指Y = event.getRawY();
                    按下X = 指X; 按下Y = 指Y; 已拖动 = false;
                    return true;
                case event.ACTION_MOVE:
                    if (Math.abs(event.getRawX() - 按下X) > 12 || Math.abs(event.getRawY() - 按下Y) > 12) 已拖动 = true;
                    移条(窗X + (event.getRawX() - 指X), 窗Y + (event.getRawY() - 指Y));
                    指X = event.getRawX(); 指Y = event.getRawY();
                    return true;
                case event.ACTION_UP:
                    if (!已拖动) {
                        var 命中 = 找命中按钮(event.getRawX(), event.getRawY());
                        if (命中 === "T") { threads.start(function () { 切站("T", false); }); }
                        else if (命中 === "W") { threads.start(function () { 切站("W", false); }); }
                        else if (命中 === "R") { threads.start(function () { 刷新页(); }); }
                        else if (命中 === "S") { threads.start(function () { 开设置(); }); }
                    } else {
                        记事.条X = Math.round(窗X); 记事.条Y = Math.round(窗Y); 存记事();
                    }
                    return true;
            }
            return true;
        });
    } catch (e) {}
}

// 拿按钮在屏幕上的真实矩形判断点没点中（getLocationOnScreen 需要 Java int[]，Android 原生回填，安全）
function 找命中按钮(rx, ry) {
    if (!条) return null;
    var 表 = [["bT", "T"], ["bW", "W"], ["bR", "R"], ["bS", "S"]];
    for (var i = 0; i < 表.length; i++) {
        try {
            var b = 条[表[i][0]];
            if (!b) continue;
            var xy = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, 2);
            b.getLocationOnScreen(xy);
            if (rx >= xy[0] && rx <= xy[0] + b.getWidth() && ry >= xy[1] && ry <= xy[1] + b.getHeight()) return 表[i][1];
        } catch (e) {}
    }
    return null;
}

// ================================================================
// 二之二、刷新 + 设置面板（★ v1.21）
//   ↻ 刷新：重载当前站网页（登录态/历史都保住）
//   ⚙ 设置：版本号 / 当前站 / 检查更新 / 清缓存重载 / 条位复位 / 退出应用
// ================================================================
var 设开 = false;
var 设待新版 = "";
var 绑过设 = false;

function 刷新页() {
    if (已结束 || 已让位) return;
    关设置();
    页面OK = false;
    最近备注 = "手动刷新";
    try { ui.run(function () { try { wv.reload(); } catch (e) {} }); } catch (e) {}
    try { toast("正在刷新…"); } catch (e) {}
    落状态(true);
}

function 开设置() {
    if (已结束 || 已让位) return;
    if (设开) { 关设置(); return; }
    设开 = true;
    var 待 = 算待新版();
    设待新版 = 待;
    try {
        ui.run(function () {
            try { do刷设置文本(待); } catch (e) {}
            try { 涂设置(); } catch (e) {}
            try { ui.设罩.setVisibility(0); } catch (e) {}
        });
    } catch (e) {}
}

function 关设置() {
    if (!设开) return;
    设开 = false;
    try { ui.run(function () { try { ui.设罩.setVisibility(8); } catch (e) {} }); } catch (e) {}
}

function 算待新版() {
    try {
        if (!files.exists(新版缓存)) return "";
        var v = 源里版本(files.read(新版缓存));
        if (v && 版本更大(v, APP_VERSION)) return v;
    } catch (e) {}
    return "";
}

function 刷设置文本() {
    var 待 = 算待新版();
    设待新版 = 待;
    try { ui.run(function () { do刷设置文本(待); }); } catch (e) {}
}

function do刷设置文本(待) {
    try { ui.设版本.setText("版本 " + APP_VERSION); } catch (e) {}
    try { ui.设站.setText("当前站：" + 站点说明[当前站]); } catch (e) {}
    try { ui.设址.setText(站URL(当前站)); } catch (e) {}
    try {
        if (待) {
            ui.设更新.setText("已下载 v" + 待 + "，点下面「重启应用」生效");
            ui.设更新.setTextColor(0xFFFFD54F);
            ui.btn生效.setVisibility(0);
        } else {
            ui.设更新.setText("点「检查更新」看有没有新版");
            ui.设更新.setTextColor(0xFF99FFFFFF);
            ui.btn生效.setVisibility(8);
        }
    } catch (e) {}
}

// 设置卡片也走同一套黑底+白描边风格（★ v1.23：样式全在代码里设，XML 只用 v1.20 验证过的属性）
function 涂设置() {
    function 底(c, 圆角, 色, 边) {
        try {
            var d = new android.graphics.drawable.GradientDrawable();
            d.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
            d.setCornerRadius(圆角);
            d.setColor(色);
            d.setStroke(2, android.graphics.Color.parseColor(边));
            c.setBackground(d);
        } catch (e) {}
    }
    try { ui.设罩.setBackgroundColor(android.graphics.Color.argb(153, 0, 0, 0)); } catch (e) {}
    try { ui.设卡.setPadding(28, 30, 28, 30); } catch (e) {}
    底(ui.设卡, 28, android.graphics.Color.argb(248, 0x0A, 0x0A, 0x0A), "#99FFFFFF");
    function 字号(c, v) {
        try { c.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, v); c.setGravity(17); } catch (e) {}
    }
    字号(ui.设标题, 52);
    字号(ui.设版本, 68);
    字号(ui.设站, 36);
    字号(ui.设址, 28);
    字号(ui.设更新, 32);
    字号(ui.设脚, 24);
    [ui.btn检查, ui.btn清缓, ui.btn复位, ui.btn关设, ui.btn退出].forEach(function (b) {
        字号(b, 34);
        底(b, 13, android.graphics.Color.argb(255, 0x1C, 0x1C, 0x1C), "#60FFFFFF");
    });
    字号(ui.btn生效, 34);
    底(ui.btn生效, 13, android.graphics.Color.argb(255, 0x33, 0x26, 0x00), "#FFFFD54F");
}

// 启动时一次性：把设置面板铺好并藏起来
function 设初始样式() {
    涂设置();
    try { ui.设罩.setVisibility(8); } catch (e) {}
    try { ui.btn生效.setVisibility(8); } catch (e) {}
}

function 绑设置() {
    if (绑过设) return;
    绑过设 = true;
    try {
        ui.run(function () {
            try { ui.设罩.setClickable(true); } catch (e) {}
            try { ui.设罩.setOnClickListener(function () {}); } catch (e) {}   // 吃掉遮罩上的点击，防止穿到网页
            try { ui.btn检查.on("click", function () { threads.start(function () { 检查更新(true); }); }); } catch (e) {}
            try { ui.btn清缓.on("click", function () { threads.start(清缓存重载); }); } catch (e) {}
            try { ui.btn复位.on("click", function () { threads.start(条位复位); }); } catch (e) {}
            try { ui.btn关设.on("click", function () { 关设置(); }); } catch (e) {}
            try { ui.btn退出.on("click", function () { threads.start(确认退出); }); } catch (e) {}
            try { ui.btn生效.on("click", function () { threads.start(立即生效); }); } catch (e) {}
        });
    } catch (e) {}
}

function 清缓存重载() {
    try { wv.clearCache(true); } catch (e) {}
    try { wv.clearFormData(); } catch (e) {}
    关设置();
    页面OK = false;
    最近备注 = "清缓存重载";
    try { ui.run(function () { try { wv.loadUrl(站URL(当前站)); } catch (e) {} }); } catch (e) {}
    try { toast("已清缓存，正在重载"); } catch (e) {}
}

function 条位复位() {
    记事.条X = -1; 记事.条Y = -1;
    默认条位();
    移条(窗X, 窗Y);
    记事.条X = Math.round(窗X); 记事.条Y = Math.round(窗Y);
    存记事();
    try { toast("竖条位置已复位"); } catch (e) {}
}

function 确认退出() {
    var 行 = true;
    try { 行 = confirm("退出「" + APP_NAME + "」？"); } catch (e) {}
    if (!行) return;
    记事.意愿 = "退出"; 存记事();
    用户退出();
}

// 已下载新版 → 关掉自己，下次点图标就自动跑新版（走 v1.20 顶部那套成熟逻辑，最稳）
function 立即生效() {
    var v = 算待新版();
    if (!v) { try { toast("已是最新 " + APP_VERSION); } catch (e) {} return; }
    关设置();
    最近备注 = "等重启跑新版 v" + v;
    try { toast("已就绪：重新打开应用就是 v" + v); } catch (e) {}
    用户退出("换版");
}

// ================================================================
// 三、把自己提到前台（后台被切走后，点 T/W 要能拉回来）
// ================================================================
var 活动类 = "";
try { 活动类 = String(activity.getClass().getName()); } catch (e) {}
function 包名() {
    try { return context.getPackageName(); } catch (e) { return ""; }
}
function 拉回自己() {
    if (已结束 || 已让位) return;
    var 包 = 包名();
    if (包 && 活动类 && !已结束) {
        try {
            app.startActivity({ packageName: 包, className: 活动类, flags: 0x10000000 });   // NEW_TASK
            return;
        } catch (e) {}
    }
    try { app.launchPackage(包); return; } catch (e) {}
    try { toast("请从桌面点「" + APP_NAME + "」"); } catch (e) {}
}

// ================================================================
// 四、单实例守卫（照 TRAE远程控制APP 成熟写法：数"别的我"+唤醒标志；绝不 forceStop/exit）
// ================================================================
var 本脚本名 = "双站切换器.js";
function _别的我() {
    var 我 = null;
    try { 我 = engines.myEngine(); } catch (e) {}
    var n = 0;
    try {
        engines.all().forEach(function (e) {
            try {
                if (我 && (e === 我 || e.id === 我.id)) return;
                if (String(e.source || "").indexOf(本脚本名) >= 0) n++;
            } catch (x) {}
        });
    } catch (e) {}
    return n;
}

function 让位退出() {
    已让位 = true;
    try { 隐藏条(); } catch (e) {}
    try { activity.finish(); } catch (e) {}
    for (var i = 0; i < 60; i++) {          // 挂住等 AutoX 随 Activity 销毁终止本脚本（绝不主动 exit，见 TRAE v1.11 教训）
        try { sleep(1000); } catch (e) { return; }
    }
    try { exit(); } catch (e) {}            // 兜底（正常走不到）
}

if (_别的我() >= 1) {
    try { files.write(命令文件, JSON.stringify({ 命令: "唤前" })); } catch (e) {}   // 让活实例真提前台
    try { toast("「" + APP_NAME + "」已在运行，已切回"); } catch (e) {}
    让位退出();
}

// ================================================================
// 五、状态落盘 + 命令轮询（远程验收全靠这两样）
// ================================================================
function 落状态(立刻) {
    if (已让位) return;
    var s = {
        版本: APP_VERSION,
        当前站: 当前站,
        当前URL: 站URL(当前站),
        页面OK: 页面OK,
        设置开: 设开 ? 1 : 0,
        待新版: 设待新版,
        布局异常: 布局异常,
        意愿: 已结束 ? "退出" : "跑",
        心跳: Date.now(),
        备注: 最近备注
    };
    try { files.write(状态文件, JSON.stringify(s)); } catch (e) {}
}

function 查命令() {
    if (已让位 || 已结束) return;
    var t = "";
    try { if (files.exists(命令文件)) t = files.read(命令文件); } catch (e) {}
    if (!t || !String(t).trim()) return;
    try { files.write(命令文件, ""); } catch (e) {}
    var j = null;
    try { j = JSON.parse(String(t)); } catch (e) { j = { 命令: String(t).trim() }; }
    var c = String(j.命令 || "").trim();
    最近备注 = "收到命令:" + c;
    if (c === "开T" || c === "T") { threads.start(function () { 切站("T", true); }); }
    else if (c === "开W" || c === "W") { threads.start(function () { 切站("W", true); }); }
    else if (c === "唤前") { threads.start(function () { 拉回自己(); }); }
    else if (c === "刷新") { threads.start(function () { 刷新页(); }); }
    else if (c === "设置") { threads.start(function () { 开设置(); }); }
    else if (c === "关设") { threads.start(function () { 关设置(); }); }
    else if (c === "重启") { 记事.意愿 = "换版"; 存记事(); threads.start(function () { 用户退出("换版"); }); }
    else if (c === "状态") { 落状态(true); }
    else if (c === "退出" || c === "exit") { 记事.意愿 = "退出"; 存记事(); threads.start(function () { 用户退出(); }); }
}

setInterval(function () { 落状态(false); }, 5000);   // 心跳：壳靠"心跳断没断"判断要不要拉新
setInterval(function () { try { 查命令(); } catch (e) {} }, 1000);

// ================================================================
// 六、返回键与退出
// ================================================================
var 上次返回 = 0, 上次提示 = 0;
function onBackKey(e) {
    try { e.consumed = true; } catch (err) {}
    if (已让位 || 已结束) return;
    if (设开) { 关设置(); return; }        // ★ v1.21：设置面板开着，返回键先关面板
    var now = Date.now();
    if (now - 上次返回 < 300) return;
    上次返回 = now;
    if (wv.canGoBack()) {
        wv.goBack();
    } else if (now - 上次提示 < 2000) {
        记事.意愿 = "退出"; 存记事();
        用户退出();
    } else {
        上次提示 = now;
        try { toast("再按一次退出"); } catch (e) {}
    }
}
try { ui.emitter.on("back_pressed", onBackKey); } catch (e) {}
try { events.on("back_pressed", onBackKey); } catch (e) {}

function 用户退出(为什么) {
    已结束 = true;
    记事.意愿 = 为什么 === "换版" ? "换版" : "退出";
    存记事();
    最近备注 = 为什么 === "换版" ? "收到重启命令，等新版" : "用户退出";
    落状态(true);
    try { 隐藏条(); } catch (e) {}
    try { activity.finish(); } catch (e) {}
}
try {
    events.on("exit", function () {
        try { 隐藏条(); } catch (e) {}
    });
} catch (e) {}

// ================================================================
// 七、启动
// ================================================================
记事.意愿 = "跑";
存记事();
if (布局异常) {
    最近备注 = 布局异常;
    try { toast("界面异常：" + String(布局异常).substring(0, 90)); } catch (e) {}
}
try { wv.loadUrl(站URL(当前站)); } catch (e) {}
try { 开竖条(); } catch (e) {}
落状态(true);
检查更新();
