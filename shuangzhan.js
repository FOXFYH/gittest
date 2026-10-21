"ui";

/**
 * ============================================================
 * 双站切换器  v2.08   （手机端 / AutoX.js v7 / 打包成独立 APK）
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

// ================================================================
// ★ 底座（v2.00）——这是"打进 APK 的那一层"，只干两件事：
//   ① 看私有目录里有没有比底座更新的版本：有 → **在本引擎里 eval 它**，直接跑新版；
//   ② 没有 / 新版跑崩了 → 老老实实跑本文件后面的「本体」（就是完整程序）。
//
// ★ 为什么把 execScriptFile 换成 eval（v1.20→v1.21 一闪而过的真凶）：
//   v1.20 的写法是 `engines.execScriptFile(新版缓存); exit();`。
//   execScriptFile 是**异步**的——新引擎还在排队，本脚本已经 exit()，
//   在 APK 里 activity 跟着被收掉，新引擎还没建界面 → 整个应用一闪而过。
//   同一引擎直接 eval 就没有这个"生命周期断层"，界面由新版自己建，一次到位。
//
// ★ 日志：全程写 /sdcard/Android/data/<包名>/files/启动日志.txt
//   （应用专属外部目录，**不需要任何权限**，而且电脑端能直接读）。
//   以后任何异常都不用截图，我远程读这个文件就知道崩在哪一步。
// ================================================================
var 底座版本 = "v2.08";
var 日志路径 = "";

(function 定日志位() {
    try { 日志路径 = String(context.getExternalFilesDir(null)) + "/启动日志.txt"; } catch (e) {}
    if (!日志路径) { try { 日志路径 = String(context.getFilesDir().getAbsolutePath()) + "/启动日志.txt"; } catch (e2) {} }
})();

function 记(s) {
    try { files.append(日志路径, "[" + new Date().toLocaleString() + "] " + s + "\n"); } catch (e) {}
}

记("======== 启动 · 底座 " + 底座版本 + " ========");

// ★ 关键：热更必须放在**函数里**跑。
//   ① eval 进来的新版代码，它的 var/function 全部落在这个函数的作用域里，
//      不会污染底座、也不会互相踩（踩了就会两套界面叠在一起，已在真机复现过）。
//   ② 用返回值告诉外面"我接手了没有"，而不是用变量——变量会被新版的同名 var 覆盖。
function 跑热更() {
    var 缓存 = "";
    try { 缓存 = String(context.getFilesDir().getAbsolutePath()) + "/最新.js"; }
    catch (e) { 记("取私有目录失败：" + e); return false; }
    try {
        if (!files.exists(缓存)) { 记("无热更缓存 → 用底座本体"); return false; }
        var s = files.read(缓存);
        var m = String(s).match(/APP_VERSION\s*=\s*"v?([\d.]+)"/);
        if (!m) {
            记("热更缓存没有版本号 → 删掉，用底座本体");
            try { files.remove(缓存); } catch (e1) {}
            return false;
        }
        var 新 = m[1], 旧 = 底座版本.replace(/^v/, "");
        var a = 新.split("."), b = 旧.split(".");
        var 更大 = false;
        for (var i = 0; i < 3; i++) {
            var x = parseInt(a[i], 10) || 0, y = parseInt(b[i], 10) || 0;
            if (x > y) { 更大 = true; break; }
            if (x < y) break;
        }
        记("热更缓存 v" + 新 + " / 底座 v" + 旧 + " / 更大=" + 更大 + " / " + s.length + "字");
        if (!更大 || s.length < 3000) { 记("不用热更 → 用底座本体"); return false; }
        eval(s);                       // ← 新版在这个函数作用域里整份跑完（含它自己的界面）
        记("热更完成：已按 v" + 新 + " 运行");
        return true;
    } catch (e) {
        记("★热更失败：" + e + " ｜" + (e && e.stack ? String(e.stack).split("\n")[0] : ""));
        try { files.remove(缓存); } catch (e2) {}
        return false;
    }
}

function 本体() {
记("进入本体 " + 底座版本);

var APP_NAME = "双站切换器";
var APP_VERSION = "v2.11";   // v2.11：【回滚 v2.10 的三 WebView】——它在本机 APK 环境里直接白屏（登录页打不开）；退回单 WebView，切站恢复 loadUrl
                             // v2.09：治「点快捷方式一打开就弹回桌面」——后台自杀哨兵＋撞锁先问"它在不在前台"（后台的旧实例直接接管）＋让位不再挂 60 秒
                             // v2.00：底座式热更（同引擎 eval，去掉 execScriptFile+exit 的一闪而过）；启动日志落外部目录。

// ★ 两个网站的地址。以后换地址只改这两行（或用 记事.json 的 站点 字段覆盖，不用改代码）。
var 默认站点 = {
    T: "https://foxfyh.github.io/gittest/TRAE同步显示与控制工具_网页客户端_手机版.html",
    W: "https://foxfyh.github.io/gittest/wbcli.html?v=2.00",
    P: "https://foxfyh.github.io/gittest/任务面板/任务面板.html"
};
var 站点说明 = { T: "TRAE 网页版(AI)", W: "WorkBuddy 网页版", P: "任务面板" };

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

// ★ v2.00：这里原本是 `engines.execScriptFile(新版缓存); exit();` —— APK 里一闪而过的真凶。
//   已挪到文件最上面的「底座」里，改成同引擎 eval。这里不再做装载。

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
            if (j.当前站 === "T" || j.当前站 === "W" || j.当前站 === "P") 记事.当前站 = j.当前站;   // ★ v2.10：补 P（v2.07 加第三站时漏了，重启后回不到任务面板）
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
        // ★ v2.09：活着的那个【不在前台】＝后台空壳（以前就是它让你"一点快捷方式就弹回桌面"）。
        //   现在反过来：本实例是用户刚点的，直接接管，并叫它退位。
        if (j.前台 !== 1) {
            try { files.write(命令文件, JSON.stringify({ 命令: "退位" })); } catch (e0) {}
            return;
        }
        sleep(1500);
        var j2 = JSON.parse(files.read(状态文件));
        if (j2 && j2.心跳 && Date.now() - j2.心跳 < 5000 && j2.前台 === 1) {
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
var 图面板 = "\u2630\uFE0E";     // ☰ 记事本/清单（U+FE0E 强制黑白）

// ★ v1.23：打包 APK 环境里 v1.21/1.22 那套带 bg/padding/layout_gravity/visibility 的 XML 起不来，
//   改成"最保守写法"——只用 v1.20 验证过的属性（w/h/marginTop/textColor/gravity/text），
//   其余样式（底色/描边/字号/隐藏）全在代码里设。外面再包一层 try/catch + 兜底布局。
var 布局异常 = "";

var 主XML =
    '<frame>' +
    // ★ v2.11：退回【单个 WebView】。v2.10 的"三个 WebView 常驻叠放"在 APK 环境里直接白屏
    //   （2026-10-21 用户实测：双站登录页打不开，一片白）。AutoX 的 webview 在打包/热更环境里
    //   只稳一个，多开不报错但不出画面——这类"不报错就是白"的坑没法靠 try/catch 兜，只能退回。
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
    '    <text id="bP" text="' + 图面板 + '" w="79px" h="79px" marginTop="6px" textColor="#FFFFFF" gravity="center"/>' +
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

// ★ v2.10：三个 WebView 常驻（切站只换可见性，不重载）；主布局起不来时自动退回单 WebView 老路
var 视图 = { T: null, W: null, P: null };
var 已载 = { T: false, W: false, P: false };
var 三视 = false;
var wv = null;              // 当前站的 WebView（全文沿用这个名字）

function 配视(v, k) {
    if (!v) return null;
    try {
        var s = v.getSettings();
        s.setJavaScriptEnabled(true);   // 网页要跑自己的逻辑
        s.setDomStorageEnabled(true);   // ★ 登录态在 localStorage，不开就每次重登
        s.setUseWideViewPort(true);     // 跟随网页 viewport
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);             // 不跟系统字体缩放，免得排版乱
    } catch (e) {}
    try {
        v.setWebViewClient(new JavaAdapter(WebViewClient, {
            onPageFinished: function (view, url) {
                if (k !== 当前站) return;    // 后台那个站加载完，不干扰当前站的状态
                页面OK = true;
                最近备注 = 站点说明[k] + " 加载完成";
                落状态(true);
            },
            onReceivedError: function (view, errorCode, description, failingUrl) {
                if (k !== 当前站) return;
                页面OK = false;
                最近备注 = "加载失败:" + description;
                落状态(true);
            }
        }));
    } catch (e) {}
    return v;
}

// 只做两件事：把 k 站显示出来（别的藏起）、首次才 loadUrl。**切换本身不重载。**
function 亮出(k) {
    if (!三视) {                                  // 兜底单视图：只能覆盖式加载
        wv = 视图.T || wv;
        if (!wv) return;
        try { wv.loadUrl(站URL(k)); } catch (e) {}
        return;
    }
    var 键 = ["T", "W", "P"];
    for (var i = 0; i < 键.length; i++) {
        var v = 视图[键[i]];
        if (!v) continue;
        try { v.setVisibility(键[i] === k ? 0 : 4); } catch (e) {}   // 0=VISIBLE 4=INVISIBLE（INVISIBLE 保留布局，切回瞬间出图）
    }
    wv = 视图[k] || wv;
    if (!已载[k]) {
        已载[k] = true;
        记("首次加载 " + k + " → " + 站URL(k));
        try { wv.loadUrl(站URL(k)); } catch (e) {}
    } else {
        页面OK = true;                            // 早就加载好了，不会再触发 onPageFinished
    }
}

try {
    if (ui.webT && ui.webW && ui.webP) {
        三视 = true;
        视图.T = 配视(ui.webT, "T");
        视图.W = 配视(ui.webW, "W");
        视图.P = 配视(ui.webP, "P");
        try { ui.webW.setVisibility(4); ui.webP.setVisibility(4); } catch (e) {}   // 先把后台两站藏掉（首帧前完成，看不到闪）
    } else if (ui.web) {
        三视 = false;
        视图.T = 配视(ui.web, "T");
    }
} catch (e) { 三视 = false; 记("多视图初始化异常：" + e); }
wv = 视图[当前站] || 视图.T;
try { 设初始样式(); } catch (e) {}

function 切站(k, 强制) {
    关设置();
    if (当前站 === k && !强制) { 拉回自己(); return; }   // 已在该站：只把应用提到前台，不重载（保住页面状态）
    当前站 = k;
    记事.当前站 = k;
    存记事();
    页面OK = false;
    最近备注 = "切到" + 站点说明[k];
    // ★ v2.10：不再 loadUrl —— 三站各自常驻，切过去只是"把它显示出来"，页面原封不动（滚动位置、输入框、播放进度全在）
    try {
        ui.run(function () {
            try { 亮出(k); } catch (e) {}
            try { 画当前站(); } catch (e) {}
        });
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
        条 = { 根: ui.条根, bT: ui.bT, bW: ui.bW, bR: ui.bR, bS: ui.bS, bP: ui.bP };
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
    窗Y = Math.max(0, Math.min(y, 屏高() - 按钮尺寸 * 5 - 按钮间距 * 4));
    try {
        条.根.setTranslationX(窗X);
        条.根.setTranslationY(窗Y);
    } catch (e) {}
}

// 圆角方块（照 TRAE远程控制APP 竖条同款 GradientDrawable 画法）
// ★ v2.07（用户拍板，此前"选中更深"五连败后改方案）：
//   · **所有按钮底纹恒为 argb(220,0,0,0) 半透明黑**（＝用户认可的设置按钮现在的样子），永不改变；
//   · **选中态＝底纹不变，只把描边换成金框**（#FFD54F 3px）；未选中＝白描边 2px。
//   · 全程不碰透明度——不可能再出现"选中变淡"。
//   · 实现只用一条路：**每次全新 drawable，setColor 直接带透明度的颜色**。
//   · ★血泪：v2.05 用"不透明黑底 + setAlpha 调深浅"，setAlpha 那行在真机上被吞 → 不透明黑裸奔 = 实心黑。
//     所以这里**禁止用 setAlpha**、**禁止复用 getBackground**，深浅只写在颜色本身里。
function 涂钮(控件, 选中) {
    if (!控件) return;
    function 画() {
        try {
            var d = new android.graphics.drawable.GradientDrawable();
            d.setShape(android.graphics.drawable.GradientDrawable.RECTANGLE);
            d.setCornerRadius(Math.floor(按钮尺寸 * 0.25));
            d.setColor(android.graphics.Color.argb(220, 0, 0, 0));   // 底纹恒定：所有按钮、任何状态都这一种
            d.setStroke(选中 ? 3 : 2, android.graphics.Color.parseColor(选中 ? "#FFD54F" : "#80FFFFFF"));
            控件.setBackground(d);
        } catch (e) {}
    }
    try {
        if (ui && ui.isUiThread && ui.isUiThread()) 画();
        else ui.run(画);
    } catch (e) { 画(); }
}

function 涂条() {
    if (!条) return;
    try {
        var 字大 = Math.max(10, Math.floor(按钮尺寸 * 0.42));
        var 图标大 = Math.max(12, Math.floor(按钮尺寸 * 0.52));   // 符号本身比汉字"小"，放大一点才跟 T/W 一样压得住
        [条.bT, 条.bW].forEach(function (b) {
            try { b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 字大); b.setGravity(17); } catch (e) {}
            涂钮(b, false);
        });
        [条.bR, 条.bS, 条.bP].forEach(function (b) {
            try { b.setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, 图标大); b.setGravity(17); } catch (e) {}
            涂钮(b, false);
        });
    } catch (e) {}
    画当前站();
}

// v2.07：选中那颗＝金框，底纹不变；其余全白框。字色一律纯白。
function 画当前站() {
    if (!条) return;
    try { 涂钮(条.bT, 当前站 === "T"); } catch (e) {}
    try { 涂钮(条.bW, 当前站 === "W"); } catch (e) {}
    try { 涂钮(条.bP, 当前站 === "P"); } catch (e) {}
    try { 涂钮(条.bR, false); } catch (e) {}
    try { 涂钮(条.bS, false); } catch (e) {}
    try { 条.bT.setTextColor(0xFFFFFFFF); } catch (e) {}
    try { 条.bW.setTextColor(0xFFFFFFFF); } catch (e) {}
    try { 条.bP.setTextColor(0xFFFFFFFF); } catch (e) {}
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
                        else if (命中 === "P") { threads.start(function () { 切站("P", false); }); }
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
    var 表 = [["bT", "T"], ["bW", "W"], ["bP", "P"], ["bR", "R"], ["bS", "S"]];   // v2.08：补上 bP（v2.07 漏了它 → 点☰无反应）
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
// ★ v2.09：我的窗口还在不在前台（纯 Activity 方法，不依赖无障碍）
function 我在前台() {
    try { return !!activity.hasWindowFocus(); } catch (e) { return true; }
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
    // ★ v2.09：原来在这里「挂 60 秒」等 AutoX 收尸 —— 那 60 秒就是标准空壳
    //   （没窗口、引擎还活着），下次点快捷方式撞上它 → 新实例认输 → 一眼弹回桌面。
    try { sleep(1200); } catch (e) {}
    try { exit(); } catch (e) {}
}
// ★ v2.09：收摊——真退出（给"后台空壳"和"被接管的旧实例"用）
function 收摊退出(原因) {
    if (已让位) return;
    已结束 = true;
    最近备注 = "收摊：" + 原因;
    try { 落状态(true); } catch (e) {}
    已让位 = true;
    try { 隐藏条(); } catch (e) {}
    try { activity.finish(); } catch (e) {}
    try { sleep(400); } catch (e) {}
    try { exit(); } catch (e) {}
}

// ★ v2.09：撞见"另一个我"时先问一句：它在前台吗？
//   在前台＝真窗口（用户就是想切回它）→ 提它上来，本实例让位；
//   不在前台＝后台空壳 → 本实例（用户刚点的）直接接管，并给它下退位令。
function 别的我在前台() {
    try {
        var j = JSON.parse(files.read(状态文件));
        return !!(j && j.心跳 && (Date.now() - j.心跳) < 6000 && j.前台 === 1);
    } catch (e) { return false; }
}
if (_别的我() >= 1) {
    if (别的我在前台()) {
        try { files.write(命令文件, JSON.stringify({ 命令: "唤前" })); } catch (e) {}
        try { toast("「" + APP_NAME + "」已在运行，已切回"); } catch (e) {}
        让位退出();
    } else {
        try { files.write(命令文件, JSON.stringify({ 命令: "退位" })); } catch (e) {}
    }
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
        前台: 我在前台() ? 1 : 0,   // ★ v2.09：新一代判"空壳"靠它——后台的旧实例不再能挡住新实例
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
    else if (c === "开P" || c === "P") { threads.start(function () { 切站("P", true); }); }
    else if (c === "唤前") { threads.start(function () { 拉回自己(); }); }
    else if (c === "退位" || c === "让位") { threads.start(function () { 收摊退出("被新实例接管"); }); }
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
// ★ v2.09：后台自杀哨兵 —— 根治「点快捷方式一打开就弹回桌面」
//   病因：退到桌面后【人没了、引擎还活着】，还照样跳心跳 → 下次点快捷方式时
//        新实例误判"老的在跑" → 认输退出 → 你只看到窗口闪一下回桌面。
//   治法：没窗口 / 长时间不在前台 → 自己真退出，空壳活不过十几秒。
// ================================================================
var 离台刻 = 0;
threads.start(function () {
    var 不可见限 = 15000;
    while (true) {
        try {
            if (已让位 || 已结束) return;
            var 结束 = false;
            try { 结束 = !!activity.isFinishing(); } catch (e1) { 结束 = true; }
            if (结束) { 收摊退出("窗口已销毁"); return; }
            if (我在前台()) 离台刻 = 0;
            else if (!离台刻) 离台刻 = Date.now();
            if (离台刻 && (Date.now() - 离台刻) > 不可见限) {
                收摊退出("不在前台 " + Math.round((Date.now() - 离台刻) / 1000) + " 秒");
                return;
            }
        } catch (e) {}
        sleep(1000);
    }
});

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
try { ui.run(function () { try { 亮出(当前站); } catch (e) {} }); } catch (e) {}
try { 开竖条(); } catch (e) {}
落状态(true);
检查更新();
记("本体启动完成 · 当前站=" + 当前站 + " · 三视图=" + (三视 ? "是" : "否") + " · 布局异常=" + (布局异常 || "无"));

}   // ===== 本体() 结束 =====

// 热更成功 → 新版已经在跑，底座收手；否则跑本体
if (!跑热更()) 本体();
else 记("底座收手（热更版已在运行）");
