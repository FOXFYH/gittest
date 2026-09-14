# -*- coding: utf-8 -*-
r"""TRAE同步显示与控制工具_服务端    当前版本 1.48

★ 本文件是「TRAE同步显示与控制工具」的远程服务端版本（派生自本地版
  v2.15）：本机照旧直连 TRAE（CDP 轮询/命令/导出/附件上传全量保留，
  本地体验与原版完全一致），另连一条 WebSocket 到 PieSocket 中继频道
  TRAE——把界面事件（快照/积分/模型列表/端口扫描…）实时转发给远程
  客户端，并接收客户端命令回投本机执行。状态栏多一个「🌐 远程」灯。
  本地原版文件不改动、仍可单独运行（但别与服务端同时连同一 TRAE
  端口——两套轮询会互相打架）。

★ 远程协议（JSON over WS + FOX 分段，与客户端约定）：
  出向 {'t':'ev','k':事件名,'v':值}   —— 与本地 uiq 事件同构
       {'t':'hello', box/port/boxes/alive/conn/points} + 重放最新
       快照/模型列表（客户端连上或掉线重连时秒同步）
  入向 {'t':'hello'}                    请求当前状态
       {'t':'cmd','c':命令,'a':参数}    直投 poller.cmdq 执行
       {'t':'attach_files','files':[{n,d(base64)}]}  附件内容传输
       {'t':'switch_box','box':分身名}  切换目标（服务端复核端口在线）
       {'t':'boot','box':分身名}        带端口拉起（客户端已确认）
  FOX 分段：PieSocket 单消息上限 16KB，>10KB 自动切段，头格式
  【FOXID:14位时间+8位随机+10位发送者ID=cut(NNN/MMM)】（57字节）；
  发送者ID：服务端 1000000001 / 客户端 2000000001（防自己回声）。
  流量节省：快照按内容指纹去重（无变化不重发）；25s 心跳防超时。

★ 版本号规则(改代码前必读):
  顶部标题栏显示: 软件名(统一为 PY 名) + 版本号;
  版本号默认 1.00 起步, 每次修改本文件代码 +0.01, 1.99 就升 2.0
  (2.99 再 +0.01 升 3.0, 依此类推);
  每次 +0.01 同时更新维护记录: 记录文件与本入口 PY 同级(没有就新建),
  命名 = 入口PY名 + 版本升级维护.txt,
  每版追加: 版本号 + 日期 + 变更说明, 方便回溯每版改了什么。

【1.00 新增】远程服务端（派生自本地版 v2.15，改动点）
  · 新增 _RemoteBridge/_TeeQueue/_FoxIn/_fox_split：中继收发/事件
    二路分发/分段拼装；uiq 换 TeeQueue（本地 put/get 行为不变），
    poller/scanner 的 uiq 引用同步换到 tee；
  · TraePanelDialog 新增 _on_rcmd（远程命令分发：cmd 直投 cmdq、
    attach_files 落临时目录后走附件链、switch_box 复核端口、boot
    后台拉起、hello 应答）/_on_remote（远程状态灯）/_alive_last
    （hello 用最新端口在线集）；_on_collected 远程发起时只转发
    不弹本地保存框；_on_close 一并停桥；
  · 设置页新增「远程服务」区（开关 + 服务地址）；状态栏新增
    「🌐 远程」状态灯；快照指纹去重转发；
  · 其余（CDP/沙盒发现/多分身切换/导出/完成提醒/附件上传链）继承
    本地版 v2.15，详见本地版 docstring 与交接文档。

【1.01 修复】沙盒拉不起（start.exe 静默失败）
  · 症状：切换/启动分身报「切换失败：60 秒内端口未就绪」，实为
    start.exe 退出码 1 且无任何输出——沙盒进程根本没创建；
  · 根因：机器上存在两份 Sandboxie（旧机器迁移遗留 C:\Sandboxie-
    Plus 5.72.5 陈旧副本 + 实际在用的 d:\Program Files\Sandboxie-
    Plus 5.71.7，服务/SandMan 全是 D 盘的）。_sbx() 探测优先读
    配置保存值 → 命中 C 盘陈旧副本 → 与运行服务版本不匹配 →
    start.exe 静默失败；设置页「自动寻找」因配置值文件存在视为
    有效永远不修正；
  · 修复：新增 _sandman_running()（枚举运行中的 SandMan 进程取真实
    路径），置 _sbx() 探测链最前（运行实例是唯一权威）；
    SandMan 没开时回落原探测链（此时应同步修正配置保存值）。

【1.02 新增】网络分页 + WS 流量统计
  · 新增「网络」分页（主界面/设置/网络/自检）：设置页的「远程服务」
    区（开关 + 服务地址）移入本页，配独立保存按钮；
  · WS 流量统计：_RemoteBridge 收（on_message 每条 len）/发
    （FOX 每分段实发 + 心跳 4B）字节累计，按天记录（跨天自然
    滚动新桶）；网络页实时显示今日收/发（2 秒刷新）；
  · 落盘 使用痕迹目录\网络流量.json：30 秒定时 + 退出兜底 +
    保存即写；保留天数网络页可调（默认 100 天，超期自动清理）；
    历史记录表倒序展示（今天在最上）；
  · 新配置项 stats_keep（保留天数）。

【1.03 新增】防呆（AI 卡死自动续跑）
  · 巡检 10 秒一次：开启 + 生成中 + 快照内容（tail+消息数+末条）
    超过阈值分钟无变化 → 自动点终止（stop_gen）→ 延时秒后自动
    发「继续」；触发即重置计时（防连环触发，再卡再等一整轮）；
  · 活动指纹：_on_snap 里轻量指纹（tail|消息数|末条文本），变了
    即刷新 _watch_last；切换分身重置计时；
  · 设置页新增「防呆」区：开关 + 无动静阈值分钟（1~600，默认
    15）+ 终止后发「继续」延迟秒（1~120，默认 5）——改动保存后
    即时生效（巡检直接读 CFG）；
  · 状态栏提示：⏰ 防呆：N 分钟无动静，已自动终止 / 已自动发送
    「继续」。

【1.04 新增】流量统计收/发条数 + FOX 协议开关
  · WS 流量统计在字节基础上加「条数」：收（on_message 每条 +1）/
    发（FOX 每分段 +1，心跳 +1）；网络页今日大字显示
    「收 56.4 KB·1234 条  发 1.6 KB·56 条」；历史记录表加
    收/发条数两列；网络流量.json 每日桶新增 rxn/txn 键（旧数据
    无键按 0 显示，平滑兼容）；
  · 网络页「远程服务」区新增「启用 FOX 分段协议」复选框（默认
    打勾——本服务端 FOX 始终启用，体现为勾选态；新配置项
    fox_on）。取消勾选后消息整条直发：≤16KB 可通，超限会被中继
    丢弃（提示文案已注明）；收端对无 FOX 头的裸 JSON 兜底解析，
    并按最近发送原文防自身回声；
  · 两端 fox_on 须一致：一端关一端开时，开 FOX 的一端仍能解
    对端裸 JSON（多段能力退化但能通）；反之为半哑（分段头被
    当裸 JSON 解析失败即丢弃）。

【1.05 新增】插话（排队发送）+ 完成弹窗甄别 + 工作台路径选择
  · 插话：生成中「发送」按钮变「插话」——TRAE 官方排队机制：
    生成中输入文字按 Enter 即排队（AI 在当前步骤边界消费，不等
    全部任务完成）；实现走 CDP Enter 键（不能点 send-button，
    生成中它是停止键）。新命令 interject；_cmd_send 收紧为
    仅空闲可用（原先生成中+输入框有残留会误点停止键）；
  · 完成弹窗甄别：手动点「停止」/ 防呆自动终止的停止不算任务
    完成（不弹完成提醒窗，状态显示「⏹ 已停止」）；只有 AI 自然
    跑完（生成中→空闲自然跳变）才弹；
  · 工作台路径选择：输入行新增「📂」按钮（📎 旁）→ 选文件/选
    文件夹 → 路径插入输入框（发送的是路径文本，AI 按路径自己
    读）；根目录设置页「工作台」区可改（新配置项 bench_root，
    默认 d:\WPS云盘\脚本备份\工作台）；
  · 远程浏览命令 bench_ls（供客户端 📂 用）：入向
    {'t':'bench_ls','p':相对路径} → 出向 ev bench_ls {ok,root,
    rel,parent,dirs,files}；服务端强制路径约束在工作台根内
    （防公开频道任意列目录），目录/文件名截断 200/400 条防超大
    目录撑爆流量。
  · 1.06 新命令（入向 cmd）：rewind {a:消息序号} 回退到该用户
    消息之前 / del_msg {a:消息序号} 删除该用户消息 / pick_opt
    {a:选项序号} 点选 AI 提问选项 / new_task_dir {a:工作台相对
    路径} 新建任务并把工作目录级联选到该处 / new_task_in {a:文件
    夹名} 在该文件夹组内新建对话 / block_update {a:true|false}
    一键禁止/恢复 TRAE 自动升级（本机 OS 操作不走 CDP）/
    block_stat 查询防升级状态。快照扩展：用户消息尾部加
    [可回退,可删除] 两标志（旧客户端读前 3 位不受影响）；新增
    opts 字段 = AI 提问选项按钮文案数组（最后一条 AI 消息区域
    内的可见短文本按钮，启发式收集防改版失效）。新出向事件：
    msg_act (kind,mi) 回退/删除完成 / block_stat {ok,blocked,
    exe,err?,on?} 防升级状态；hello 增加 block 字段（true=已封锁
    /false=未封锁/null=未定位），客户端开关初始态用它。

【1.06 新增】消息回退/删除 + AI 选项点选 + 新建选目录 + 防升级 + 文件夹内新建
  · 消息回退/删除：TRAE 空闲时用户消息 hover 出 4 钮（复制/分享/
    删除 chat-icon-delete/回退 chat-icon-revert），点回退/删除弹
    「取消/确认」框。快照给每条用户消息尾附 [rev,del] 可用标志；
    命令 rewind/del_msg 点击对应按钮 → 自动点「确认」→ 回报快照；
    生成中无按钮，命令先复核空闲态。
  · AI 选项点选：AI 提问（问题+选项卡）时快照 opts 收集最后一条
    AI 消息区域内的可见短文本按钮（排除 iconButton 工具栏/输入栏/
    会话列表/已知文案黑名单——重试、复制全部、分享、赞、踩等），
    pick_opt 按同规则第 N 个点击。选项卡答完即销毁，无法抓真实
    类名，故用启发式位置+黑名单收集（实测校准见维护记录）。
  · 新建任务+选工作目录：new_task_dir（客户端 📂 浏览器选工作台
    根内目录）→ 新建任务 → 点输入栏工作目录按钮（inputBarButton，
    现有会话不显示、新建后才出现）→ 级联选择器（cascadeMenuItem
    条目含标题+绝对路径 subtitle）从「最近」列表逐级导航到目标
    （hover 优先展开、无新层再点击）→ 校验目录按钮文本生效。
  · 文件夹内新建：new_task_in 点击文件夹组头右侧「组内新建」
    （task-list-group-new-btn，aria='New task'），新对话直接隶属
    该文件夹工作区。
  · 一键禁止升级（防改版致本工具操作失灵）：block_update 依
    「TRAEWORK禁止自动升级操作指南」——升级链 = 后台下载完整包到
    %TEMP%\solo-cn-user-x64（约430MB）+ 关闭 TRAE 时安装目录
    tools\inno_updater.exe 静默执行；封锁 = 清理升级包 + icacls
    给 Everyone(S-1-1-0) 加拒绝 ACL(DE,X,WD,AD)，解封 = icacls
    /remove:d。状态查询 block_stat（icacls 输出含 DENY 即已封）。
    定位安装目录复用 find_host_trae_exe；权限不足时回报提示
    （需管理员运行服务端）。

【1.07 新增】重启 TRAE 按钮（一键恢复卡死的目标）
  · 工具行「启动 TRAE」旁新增「重启 TRAE」：无论端口是否在线，
    一律先关闭当前目标再带调试端口拉起——「启动」在端口已在线时
    只会提示无需启动，TRAE 卡死但端口还活着时救不了，此按钮专做
    强制恢复；关闭会中断正在生成的任务，故弹窗确认后执行；
  · 复用 _boot_box(kill_first=True) 全链路（杀进程→等 2s→带端口
    拉起→等端口就绪→switched 重连），busy 防重入、原版/分身两路
    启动路径与既有拉起按钮一致；
  · 远程 boot 命令本就是先杀再拉（kill_first=True），此前仅手机
    客户端在目标在线时本地拦下不放行——手机版 v1.07 同步放行，
    协议无改动。

【1.08 新增】启动/重启失败诊断增强（真机调试产出）
  · 真机调试发现：Sandboxie 服务栈异常（SbieSvc 多实例并存、
    盒内进程创建全局失败）时，TRAE 经 start.exe 拉起后即退或
    根本不起，按钮只报「60 秒内端口未就绪」无法定位；
  · _boot_box 60 秒超时后自动补一次进程探测：盒内/宿主无 TRAE
    进程 → 提示「进程未在运行（可能启动失败或秒退，建议检查
    Sandboxie 服务状态）」；有进程 → 提示「在运行但调试端口
    未监听」，一眼区分「没起来」和「没带端口」；
  · 失败文案按动作区分：切换=「切换失败」/ 启动按钮链=「启动
    失败」/ 重启按钮链=「重启失败」（此前一律「切换失败」，
    启动/重启按钮报错误导排查）；远程 boot 计入「启动失败」。

【1.09 新增】启动/重启按钮职责划分（启动不再代劳重启）
  · 语义收紧：「启动 TRAE」只做「软件没开 → 带端口直接拉起」；
    探测发现目标已在运行（无论带没带端口）一律不再代劳——
    端口在线照旧提示「无需启动」；运行中没带端口改为绿色提示
    「已在运行（未带调试端口），请用「重启 TRAE」」，
    不再弹「要关闭并带端口重启吗」确认框（先杀再拉的链路
    归「重启 TRAE」按钮专属，两按钮职责一目了然）；
  · 实现清理：_boot_current 删 ask_boot 弹窗分支与 _on_ask_boot
    处理器（无调用方即删），WS 桥出向白名单同步移除 ask_boot
    （该事件已绝迹，协议其余零改动，手机客户端无需跟进）。

【1.10 新增】自研文件树 + 新建任务弹窗（指定工作目录）+ 文件夹组内新建
  · 自研文件树 BenchWin（参考网页客户端 📂 浏览页设计，替代原生
    filedialog）：输入行「📂」按钮直接打开——双击进入目录 / 双击文件
    即插入路径，或选中后「插入所选」/「插入当前目录」；路径插入输入
    框末尾（发送的是路径文本，AI 按路径自己读）。⬆ 上级不受工作台根
    限制（本地直读磁盘；远程 bench_ls 才限根——公开频道安全约束只
    属于远程链路）；
  · 新建任务弹窗：点「新建任务」→ 先点 TRAE「新建任务」展开输入区，
    抓「记忆工作目录」回填特征（占位「选择文件夹（可选）」=无；否则
    按钮文本=目录名 → 开级联面板从「最近」条目反查绝对路径）→ 弹窗
    固定带工作目录行：未选显示「选择文件夹…」，已选显示目录名+完整
    路径+「✕ 重选」（重选=文件树里重新选）；「创建」目录有变化才下
    发 task_dir_set（点目录按钮→级联导航→校验生效），与记忆一致则
    零操作；「取消」task_dlg_cancel（Esc×2 关输入区）；
  · _apply_task_dir 从 _cmd_new_task_dir 抽出共用原子段（Esc 关残留
    面板→点目录按钮→级联导航→校验按钮文本），new_task_dir（远程）
    与 task_dir_set（本地弹窗）两链路同一实现；
  · 会话列表右键文件夹组头：「✚ 在此文件夹新建任务」（点 TRAE 组内
    新建按钮，新任务直接隶属该文件夹，同原版左侧菜单）+「折叠/展开」。

【1.12 修复】远程切换会话「一直没消息」（CLI 无头客户端直连中继
  真机复现定位，2026-09-11）
  · 症状：切换后远程一直「没有消息」（TRAE 里其实早有）——
    TRAE 窗口最小化时 Electron 渲染冻结（rAF 停摆），切会话后
    消息区不重排 → 快照 msgs=0 且持续不变（指纹去重不重发）；
    窗口恢复可见 2 秒内消息即回；可见但不前台渲染正常（实测）；
    修复：新增 _trae_windows/_trae_minimized/_trae_restore_noactivate
    （按进程名 trae + Chrome_WidgetWin_1 类找主窗），_snap_wait_msgs
    空列表补采一拍仍空且最小化 → SW_SHOWNOACTIVATE 无焦点恢复
    （不抢用户焦点、不回最小化）等渲染回来再采；
  · v1.12 同时把 _cmd_switch 改成「采快照取 idx 对应标题 → 按标题
    点击」（新 _conv_click_title_js，taskText 同口径前 36 字），
    该改动本身保留（按标题点击抗列表变动）。

【1.34 变更】救活自动交互整体移除：快照纯镜像（2026-09-12，用户定性——
  「能不能不要跳了，TRAE 什么状态就显示什么状态，打开就能用不想看它
  乱跳」。1.28~1.33 的开菜单/点模型/点输入框自动救活对深度冻结全部
  无效且每轮空转搅乱界面；现冻结时如实上报空快照→网页端如实显示
  「模型未知/未就绪」，恢复靠用户在电脑上随手一碰（人工验证一直有
  效）；keep_visible 窗口看护保留（只恢复窗口可见性，不注入点击））

【1.33 修正】救活改为按名称点模型 + 失败指数退避（2026-09-12，用户实测——
  1.32 上线后仍狂跳：按选中态找项在深度冻结下菜单无高亮，永远找不到 →
  每轮退回开菜单+Esc 空转，且与点输入框轮换交替=「一下点模型一下点输入
  框」。改为：救活直接复用 _cmd_switch_model 的按名称点选（用户人工验证
  有效的那条路），名称取冻结前缓存的当前模型；删点输入框轮换与
  _MODEL_RESELECT_JS；救不活时间隔指数退避 6→12→24→48→60s 封顶，列表
  回来即复位——狂跳彻底消失）
【1.32 修正】救活升级：模型菜单「同模型重选」促重渲染（2026-09-12，用户定性——
  v1.30 开菜单+Esc 对深度冻结无效（菜单反复开合=「疯狂切换」且救不活），
  点「当前已选中」模型项=用户人工验证的根治路径，模型不变零副作用；
  1.23~1.31 见维护记录 TXT）

【1.18 变更】设置页两列布局 + 可见性看护入 UI（2026-09-12，用户需求）
【1.19 变更】设置页可滚动 + 参数大盘点入 UI（2026-09-12，用户需求）
【1.20 变更】远程状态灯细分：WS待命中/客户端数 + 启动中/失败（2026-09-12，用户需求）
【1.21 新增】📱 网页版按钮：一键打开手机版客户端（2026-09-12，用户需求）
【1.22 变更】新建统一弹窗·服务端：组头右键改走锁定模式弹窗（2026-09-12，用户需求）
  · 设置页 6 个分区（重要路径/窗口/运行/完成提醒/防呆/工作台）由
    单列纵排改两列 grid（uniform 等宽、sticky=new 顶对齐），高度
    近减半，矮窗口不再看不全；
  · 「运行」区新增勾选「TRAE 保持可见（最小化/进托盘自动无焦点
    弹回，不抢当前焦点）」——1.16 看护的 UI 开关，读写配置项
    keep_visible，默认勾选；保存即时生效（看护线程每拍读 CFG）。

【1.17 修正】「正在切换」占位失真（2026-09-12，用户反馈）
  · 症状：切换明明已成功，端上还挂着「正在切换」好几秒不消失；
    连点几个会话会同时挂好几条；本地面板 15s 后还变「未确认」。
  · 病根：switch 占位被当「发送占位」按消息文本对账——会话标题
    不会出现在消息区，匹配必然失败，只能等 15s 超时；且不同标题
    各入一条，没有唯一性约束。
  · 修正（两端对齐）：
    ① _on_pend：switch 占位永远最多一条，新的顶掉旧的（连点只
      留最后一个，历史作废）；
    ② _pend_reconcile：switch 项改按【当前会话】对账——快照当前
      会话已是目标 ⇒ 立即撤；目标从会话列表消失 ⇒ 撤；6s 兜底
      超时 ⇒ 撤（不再显示假「未确认」）；
    ③ 手机端 switch 广播改走「正在切换」提示条（目标激活即撤/
      目标消失即撤/8s 兜底），绝不变成占位气泡，历史残留清掉。

【1.16 新增】TRAE 可见性看护（2026-09-12，用户需求）
  · 依据 exp6 结论：TRAE 窗口只要【可见】（被遮挡无妨）控制就
    流畅；最小化/托盘即渲染冻结（迟滞 2.6~3.1s 甚至一直 0 消息）。
    v1.15 只在「切会话且消息空」时兜底恢复，覆盖不够。
  · 机制：轮询线程每拍快照前检查 _trae_minimized()——TRAE 处于
    最小化或被隐藏（托盘）就 _trae_restore_noactivate() 无焦点
    弹回可见（SW_SHOWNOACTIVATE，不抢用户正在用的窗口焦点，
    弹回后被别的窗口遮挡=等效状态③），等 0.6s 渲染恢复再采样。
  · 配置：keep_visible（默认开）。用户主动最小化 TRAE 也会被
    弹回——不想这样可在 配置.json 改 keep_visible=false。
    开关本身不用 UI（设为自动看护，零操作）。

【1.15 修正】TRAE 藏进托盘后远程失联（2026-09-12 exp6 定位）
  · 实验（trae_cli/exp6_win_states.py，四窗口状态 × 4 轮切会话计时）：
    任务栏最小化 [1.2,3.1,1.0,2.6s]、隐藏/托盘等效 [1.1,3.1,1.1,2.6s]
    ——不渲染状态切会话后 DOM 更新出现 2.6~3.1s 迟滞（Electron 判
    backgrounded 渲染节流/冻结）；可见但被遮挡 [1.1~1.2s]、前台激活
    [1.1~1.3s]——两种【可见】状态都稳定流畅，无需前台/激活。
  · 漏洞：_trae_windows 只枚举 IsWindowVisible 的窗口——TRAE 若
    真·最小化到托盘（主窗被隐藏），窗口列表为空 → _trae_minimized
    恒 False → _snap_wait_msgs 的无焦点恢复永不触发，远程一直读
    旧 DOM（用户实测「托盘状态切会话动不了」即此）。
  · 修正：枚举不筛可见性、以「标题非空」排除 Chromium 无标题辅助
    窗；_trae_minimized 判定 不可见 或 IsIconic；_trae_restore_
    noactivate 对隐藏/最小化统一 SW_SHOWNOACTIVATE(4)（弹回可见、
    不抢焦点）。

【1.14 新增】空窗期反馈：待确认占位（2026-09-11）
  · 痛点：点「发送」后有一段空白期——文字要经中继传出、服务端在
    TRAE 输入框注入并点发送、TRAE 渲染、0.8s 轮询取快照、再经中继
    传回，客户端才看得到自己发的那条（实测 3~6s，最小化时更长）。
    这段时间用户完全没反馈，像「点了没反应 / 消息丢了」。
  · 机制：新增 uiq 事件 'pend'（v=(kind, text)），命令一被受理就
    广播；'sent' 的 v 由纯文本升级为 {text, stage}，分阶段推进：
    typed（已进 TRAE 输入框）→ clicked（已点发送键）/ queued（已进
    官方排队）。本地面板与手机端收到 pend 立即本地回显一条「我」的
    占位气泡，按状态显示：发送中/排队中→已输入→已发出，等待同步；
    快照里出现同文本用户消息即撤占位；15s 未出现 ⇒ 标「未确认」
    （掉线、cmderr 同样立即标未确认，别让用户干等）。
    协议向后兼容：旧客户端不读 v，'sent' 语义不变；新客户端收到
    非 dict 的旧格式也按原逻辑处理。
  · 覆盖：send / interject（排队）/ switch（切换会话占位，附带
    「正在切换会话…」），本地面板与手机端同一套状态机。

【1.23 新增】多服务端：强制服务器名称 + 目标下拉框直选远方 TRAE
  · 动机：多台电脑可同时开服务端（同一中继频道），必须能互相区分、
    且本机面板能直接操作远方电脑的 TRAE；
  · 强制命名：首次运行/未命名时启动强制弹窗填「服务器名称」（取消
    =退出）；名称与【当前在线的远方服务端】重复时拒绝并强制改名——
    保证同时在线的服务端名称互不相同。名称派生本机 FOX 发送者 ID
    （'1'+9 位数字，服务端类报文前缀 '1'，客户端仍 '4' 开头）；
  · 在线发现：服务端每 20s 广播 {'t':'srv',...} 心跳（上线/收到
    {'t':'who'} 也即时广播），75s 无心跳判离线；面板/网络页实时
    显示在线服务端清单，检测到重名即告警；
  · 目标下拉框直选远方：下拉选项=本机各 TRAE（后缀 @本章名称 ●/○）
    + 各在线远方服务端的各 TRAE（后缀 @远端名 ●/○）——不用单独
    「切换服务端」，直接在 TRAE 选项上体现差异。选中远方选项即切
    「远方操控模式」：快照/积分/模型/端口/占位等事件由远方经中继
    路由进本地界面渲染，发送/插话/切会话/停止/模型切换经中继转发
    远方执行（报文带 'to':远端名 定向，其余服务端忽略）；
  · 远方状态行：操控远方时主界面新增一行「远方▸」显示远端名/TRAE
    连接态/当前会话/生成状态/积分，右侧「✕ 返回本机」一键切回；
  · 防回声风暴：服务端间报文（FOX 发送者 '1' 开头）走 rsrv 分发，
    互不回应 hello（两台服务端同频道不再互相触发应答循环）；
  · 网页端（手机版 v1.12）配套：顶栏显示「操控:远端名」，抽屉可选
    切换操控的服务端，所有报文带 'to' 定向。

【1.13 修正】switch 索引口径回归会话序号（2026-09-11 复核发现）
  · v1.12 的 _cmd_switch 把 idx 当【convs 原始下标】解析（含文件夹
    组头行 'f'），而真实客户端一直发【会话序号】——手机版
    renderConvs 与本地面板 _on_pick 都是只对 'c' 行自增计数
    （旧 _conv_click_js 也只枚举会话行）。两口径在列表中含文件夹
    组头时错位：实测 convs=['f','A','B'] 时客户端点 B(idx=1) 被
    解析成 A。此前 CLI 探针按原始下标发送，故误判为「客户端索引
    错位」，实为测试脚本口径不合；
  · 修正：_cmd_switch 过滤掉 'f' 行后再按会话序号取标题，标题点击
    失败回退 _conv_click_js(idx)（同为会话序号口径）——手机版 /
    本地面板 / CLI 三处口径统一，协议仍零改动。

【注意】
  · 依赖 pip install websocket-client（缺失时其余功能不受影响，
    状态灯提示）；
  · PieSocket 免费中继：单消息 16KB 上限、频道公开——别在公开
    频道传敏感内容；
  · 双击运行：.pyw → pythonw 无控制台（出错静默闪退，排查用命令行
    python.exe 本文件）。
"""
import base64
import ctypes
import hashlib
import json
import os
import queue
import random
import re
import shutil
import socket
import string
import struct
import subprocess
import sys
import threading
import time
import tkinter as tk
import urllib.request
import winreg
from concurrent.futures import ThreadPoolExecutor
from tkinter import ttk, messagebox, filedialog, simpledialog

try:
    import websocket            # PieSocket 中继（pip install websocket-client）
    HAS_WS = True
except ImportError:
    HAS_WS = False

# 软件名统一为 PY 文件名(去 .py), 改名则自动跟随; 弹窗标题(APP_TITLE)同用此名
APP_NAME = os.path.splitext(os.path.basename(__file__))[0]
APP_TITLE = APP_NAME
VERSION = '1.48'
ORIG_NAME = '原版TRAE'      # 下拉框里的原版入口名
ORIG_PORT = 9599            # 原版 TRAE 调试端口默认值（1.19 可配置，读 _orig_port()）
CREATE_NO_WINDOW = 0x08000000
PORT_BASE = 9600            # 分身 TRAE 调试端口 = 9600 + 号码
# 1.05：工作台根目录默认值（📂 一键选路径的起始目录，设置页可改）
BENCH_DEFAULT = r'd:\WPS云盘\脚本备份\工作台'

# 1.25：服务端定位收敛——严格只镜像本机 TRAE（与网页版所见即所控
# 完全一致），移除 v1.23 的「操控远方服务端」能力（跨服务器只由
# 网页版负责）。下方 _TARGET_KINDS/_REV_KINDS（远方事件路由口径）
# 随远方操控一并移除；操控互斥锁保留（防多个网页端同时操控本机）。


def box_number(box):
    """沙盒名尾部数字（New_Box_16 → 16）；无数字返回 None"""
    m = re.search(r'(\d+)\s*$', box or '')
    return int(m.group(1)) if m else None


def _orig_port():
    """1.19：原版 TRAE 调试端口（配置可调，默认 9599；需与 TRAE
    启动参数一致——本工具「重启/切换」会用此端口带参拉起）。"""
    try:
        return int(_ensure_cfg().get('orig_port', ORIG_PORT))
    except Exception:
        return ORIG_PORT


def box_port(box):
    """名字 → 调试端口。原版TRAE=orig_port 配置；分身=9600+号码"""
    if box == ORIG_NAME:
        return _orig_port()
    n = box_number(box)
    return PORT_BASE + n if n else None


# ================= Sandboxie 探测 / 沙盒管理（原 sandbox_copy.py 内联） =================

kernel32 = ctypes.windll.kernel32
TH32CS_SNAPPROCESS = 0x2


def desktop_path():
    """从注册表读当前用户真实桌面路径（兼容 OneDrive 等重定向），
    失败退回 ~/Desktop"""
    for sub, expand in (
            (r'Software\Microsoft\Windows\CurrentVersion\Explorer'
             r'\User Shell Folders', True),
            (r'Software\Microsoft\Windows\CurrentVersion\Explorer'
             r'\Shell Folders', False)):
        try:
            k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, sub)
            v, _ = winreg.QueryValueEx(k, 'Desktop')
            winreg.CloseKey(k)
            p = os.path.expandvars(v) if expand else v
            if p and os.path.isdir(p):
                return p
        except OSError:
            continue
    return os.path.join(os.path.expanduser('~'), 'Desktop')


def _sandman_from_desktop_lnks():
    """从桌面沙盒快捷方式二进制提取 SandMan.exe 真实安装路径"""
    desk = desktop_path()
    try:
        names = os.listdir(desk)
    except OSError:
        return None
    pat = re.compile(r'[A-Za-z]:\\[^"\x00]{2,200}?SandMan\.exe')
    for name in names:
        if not name.lower().endswith('.lnk'):
            continue
        try:
            with open(os.path.join(desk, name), 'rb') as f:
                data = f.read()
        except OSError:
            continue
        for text in (data.decode('latin-1', errors='ignore'),
                     data.decode('utf-16-le', errors='ignore')):
            for m in pat.finditer(text):
                if os.path.isfile(m.group(0)):
                    return m.group(0)
    return None


def _sandman_from_registry():
    """从注册表卸载信息（InstallLocation / DisplayIcon）找 SandMan.exe"""
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            base = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
                0, view)
        except OSError:
            continue
        i = 0
        while True:
            try:
                sub = winreg.EnumKey(base, i)
                i += 1
            except OSError:
                break
            if 'sandbox' not in sub.lower():
                continue
            try:
                k = winreg.OpenKey(base, sub)
                for val in ('InstallLocation', 'DisplayIcon'):
                    try:
                        v, _ = winreg.QueryValueEx(k, val)
                        p = v.split(',')[0].strip('"').strip()
                        if os.path.isfile(p):
                            return p
                        cand = os.path.join(p, 'SandMan.exe')
                        if os.path.isfile(cand):
                            return cand
                    except OSError:
                        continue
                winreg.CloseKey(k)
            except OSError:
                continue
        winreg.CloseKey(base)
    return None


def _sandman_from_drives():
    """全盘符扫描常见安装目录（覆盖任意盘的 Program Files 等）"""
    import string
    for letter in string.ascii_uppercase:
        root = letter + ':' + os.sep
        if not os.path.isdir(root):
            continue
        for rel in (r'Program Files\Sandboxie-Plus\SandMan.exe',
                    r'Program Files (x86)\Sandboxie-Plus\SandMan.exe',
                    r'Sandboxie-Plus\SandMan.exe'):
            p = os.path.join(root, *rel.split(os.sep))
            if os.path.isfile(p):
                return p
    return None


def _sandman_running():
    """正在运行的 SandMan 进程路径（1.01）。机器上可能同时存在多份
    Sandboxie 副本（旧机器迁移遗留），配置保存值/磁盘扫描可能选中与
    实际运行服务不匹配的陈旧副本——start.exe 会静默失败（退出码 1、
    无任何输出），沙盒拉不起且无报错线索。运行中的实例是唯一权威。"""
    try:
        procs = list_processes()
    except Exception:
        return None
    for pid, name in procs.items():
        if pid <= 4 or 'sandman' not in (name or '').lower():
            continue
        p = process_exe_path(pid)
        if p and os.path.isfile(p):
            return p
    return None


_SBX = {'done': False, 'sandman': None, 'start': None, 'ini': None}


def _sbx():
    r"""懒加载并缓存 Sandboxie 信息：{sandman/start/ini 路径}。
    探测顺序（1.01）：运行中的 SandMan 进程（最权威，防多副本错选）
    → 配置保存路径（设置页指定）→ 桌面沙盒快捷方式 → 注册表卸载信息
    → 全盘常见目录 → 默认 C 盘位置；
    ini 探测 SystemDrive\Windows → 安装目录 → ProgramData。
    import 时不做任何磁盘 IO，首次用到才探测。"""
    if not _SBX['done']:
        sandman = _sandman_running()
        if sandman and not os.path.isfile(sandman):
            sandman = None
        if not sandman:
            sandman = _ensure_cfg().get('sandman') or None
        if sandman and not os.path.isfile(sandman):
            sandman = None
        if not sandman:
            for fn in (_sandman_from_desktop_lnks, _sandman_from_registry,
                       _sandman_from_drives):
                try:
                    p = fn()
                except Exception:
                    p = None
                if p:
                    sandman = p
                    break
        if not sandman:
            sandman = r'C:\Program Files\Sandboxie-Plus\SandMan.exe'
        _SBX['sandman'] = sandman
        _SBX['start'] = os.path.join(os.path.dirname(sandman), 'start.exe')
        ini = None
        for p in (os.path.join(
                      os.environ.get('SystemDrive', 'C:') + os.sep,
                      'Windows', 'Sandboxie.ini'),
                  os.path.join(os.path.dirname(sandman), 'Sandboxie.ini'),
                  os.path.join(os.environ.get('ProgramData', ''),
                               'Sandboxie.ini')):
            if p and os.path.isfile(p):
                ini = p
                break
        _SBX['ini'] = ini
        _SBX['done'] = True
    return _SBX


def _startexe():
    return _sbx()['start']


def _load_ini(path):
    """读 ini 为行列表。自动识别 UTF-16/UTF-8/ANSI 编码与 BOM。"""
    with open(path, 'rb') as f:
        raw = f.read()
    if raw.startswith(b'\xff\xfe'):
        text = raw[2:].decode('utf-16-le')
    elif raw.startswith(b'\xfe\xff'):
        text = raw[2:].decode('utf-16-be')
    elif raw.startswith(b'\xef\xbb\xbf'):
        text = raw[3:].decode('utf-8')
    else:
        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError:
            text = raw.decode('mbcs', errors='replace')
    return text.splitlines()


def _ini_box_names(lines):
    """ini 中所有沙盒配置节名（排除 GlobalSettings/UserSettings_*/模板）"""
    names = []
    for line in lines:
        s = line.strip()
        if s.startswith('[') and s.endswith(']'):
            n = s[1:-1].strip()
            low = n.lower()
            if n and low != 'globalsettings' \
                    and not low.startswith('usersettings_') \
                    and not low.startswith('template'):
                names.append(n)
    return names


_SECTION_CACHE = {'key': None, 'names': frozenset()}


def _known_box_names():
    """当前 ini 有效盒名集合（mtime+size 缓存）。读取失败返回 None
    （调用方视为无法校验、放行）。用途：调 start.exe 前先验盒名——
    盒名不在 ini 时 start.exe 会弹『无效沙箱名』GUI 错误框。"""
    ini = _sbx()['ini']
    if not ini:
        return None
    try:
        st = os.stat(ini)
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        return None
    if _SECTION_CACHE['key'] == key:
        return _SECTION_CACHE['names']
    try:
        lines = _load_ini(ini)
    except Exception:
        return None
    _SECTION_CACHE['key'] = key
    _SECTION_CACHE['names'] = frozenset(_ini_box_names(lines))
    return _SECTION_CACHE['names']


def _box_defined(box):
    """盒名是否还在 ini（None=无法校验时放行，保持旧行为）"""
    known = _known_box_names()
    return known is None or box in known


def parse_lnk(path):
    """从 .lnk 二进制提取 (box, exe)，非沙盒快捷方式返回 None。
    字符串块对齐位置不固定，按两种对齐、两种端序都试一次。"""
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except OSError:
        return None
    texts = [data.decode('latin-1', errors='ignore')]
    for off in (0, 1):
        texts.append(data[off:].decode('utf-16-le', errors='ignore'))
        texts.append(data[off:].decode('utf-16-be', errors='ignore'))
    if not any(re.search(r'sandman\.exe', t, re.I) for t in texts):
        return None
    for t in texts:
        m = re.search(r'/box:([^\s"]+)', t)
        if not m:
            continue
        box = m.group(1)
        exe = None
        m2 = re.search(r'/box:[^\s"]+\s*"([A-Za-z]:\\[^"]+\.exe)"', t)
        if m2:
            exe = m2.group(1)
        return box, exe
    return None


def discover_boxes(desktop=None):
    """扫描桌面沙盒快捷方式，返回 [(box, exe, lnk路径)]，按编号排序。
    2.09 兜底：桌面快捷方式缺失/被清空时，用 Sandboxie.ini 盒名补齐
    （exe 统一取原版 TRAE 主程序路径——沙盒内分身跑的就是它），
    分身列表不再随桌面快捷方式一起消失。"""
    if not desktop:
        desktop = desktop_path()
    boxes = {}
    try:
        names = os.listdir(desktop)
    except OSError:
        names = []
    for name in names:
        if name.lower().endswith('.lnk'):
            r = parse_lnk(os.path.join(desktop, name))
            if r:
                box, exe = r
                if box not in boxes:
                    boxes[box] = (exe, os.path.join(desktop, name))
    # ini 盒名兜底：快捷方式里没有的、带尾号数字的盒补进来
    try:
        known = _known_box_names()
    except Exception:
        known = None
    if known:
        # 注意 find_host_trae_exe 吃 {盒: exe路径}，此处 boxes 值是
        # (exe, lnk) 元组，先摊平再传，否则 isfile(元组) 抛 TypeError
        trae = find_host_trae_exe({b: v[0] for b, v in boxes.items()})
        for b in sorted(known):
            if b in boxes or not re.search(r'(\d+)\s*$', b):
                continue
            boxes[b] = (trae, None)

    def key(b):
        m = re.search(r'(\d+)$', b)
        return int(m.group(1)) if m else 0

    return sorted([(b, v[0], v[1]) for b, v in boxes.items()],
                  key=lambda t: (key(t[0]), t[0]))


def box_pids(box):
    """返回沙盒内进程 PID 列表（空=未运行）。start.exe /listpids
    输出：首行进程数，其后每行一个 PID（首行绝不能当 PID 解析，
    否则未运行的沙盒会误报 1 个进程 PID 0）。盒名不在 ini 时直接
    返回空——start.exe 对无效盒名会弹 GUI 错误框。"""
    if not _box_defined(box):
        return []
    try:
        out = subprocess.run([_startexe(), '/box:' + box, '/listpids'],
                             capture_output=True, timeout=20,
                             creationflags=CREATE_NO_WINDOW).stdout
        text = out.decode('latin-1', errors='ignore')
        nums = [int(x) for x in re.findall(r'(?m)^\s*(\d+)\s*$', text)]
        if not nums or nums[0] <= 0:
            return []
        return [p for p in nums[1:] if p > 0]
    except Exception:
        return []


def terminate_box(box):
    """start.exe /box:X /terminate 精确终止沙盒内全部进程。
    盒名不在 ini 时直接跳过（防 start.exe 弹错误框）。"""
    if not _box_defined(box):
        return False
    try:
        subprocess.run([_startexe(), '/box:' + box, '/terminate'],
                       capture_output=True, timeout=30,
                       creationflags=CREATE_NO_WINDOW)
        return True
    except Exception:
        return False


class _PE32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', ctypes.c_uint32),
        ('cntUsage', ctypes.c_uint32),
        ('th32ProcessID', ctypes.c_uint32),
        ('th32DefaultHeapID', ctypes.c_size_t),
        ('th32ModuleID', ctypes.c_uint32),
        ('cntThreads', ctypes.c_uint32),
        ('th32ParentProcessID', ctypes.c_uint32),
        ('pcPriClassBase', ctypes.c_long),
        ('dwFlags', ctypes.c_uint32),
        ('szExeFile', ctypes.c_wchar * 260),
    ]


def list_processes():
    """{PID: 进程名}（CreateToolhelp32Snapshot 快照）"""
    try:
        snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
        if not snap or snap == -1:
            return {}
        res = {}
        ent = _PE32W()
        ent.dwSize = ctypes.sizeof(_PE32W)
        ok = kernel32.Process32FirstW(snap, ctypes.byref(ent))
        while ok:
            res[ent.th32ProcessID] = ent.szExeFile
            ok = kernel32.Process32NextW(snap, ctypes.byref(ent))
        kernel32.CloseHandle(snap)
        return res
    except Exception:
        return {}


def process_exe_path(pid):
    """进程主程序完整路径（OpenProcess + QueryFullProcessImageNameW），
    失败/无权限返回 None。用于重要路径智能寻找：TRAE 开着就能取到
    真实安装位置，不依赖快捷方式和默认安装位置。"""
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    try:
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,
                                 False, pid)
        if not h or h == -1:
            return None
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = ctypes.c_uint32(1024)
            if kernel32.QueryFullProcessImageNameW(
                    h, 0, buf, ctypes.byref(size)):
                return buf.value
            return None
        finally:
            kernel32.CloseHandle(h)
    except Exception:
        return None


def _running_trae_exe():
    """从正在运行的 TRAE 进程取主程序路径。沙盒内分身跑的也是宿主
    安装的同一 exe 文件，路径即原版路径——任取一个 TRAE 进程即可。"""
    try:
        procs = list_processes()
    except Exception:
        return None
    for pid, name in procs.items():
        if pid <= 4 or 'trae' not in (name or '').lower():
            continue
        p = process_exe_path(pid)
        if p and os.path.isfile(p):
            return p
    return None


def find_host_trae_exe(boxes=None):
    """定位宿主机原版 TRAE 主程序。优先级（2.09）：配置保存路径
    （设置页手动指定/自动寻找后采用）→ 沙盒快捷方式里记录的 exe
    （沙盒内跑的就是宿主安装的原版 exe）→ 正在运行的 TRAE 进程
    路径（TRAE 开着就能找到，治「开着却说找不到」）→
    %LOCALAPPDATA%\\Programs 默认位置。找不到返回 None。"""
    p = _ensure_cfg().get('trae_exe')
    if p and os.path.isfile(p):
        return p
    for exe in (boxes or {}).values():
        if exe and os.path.isfile(exe):
            return exe
    p = _running_trae_exe()
    if p:
        return p
    local = os.environ.get('LOCALAPPDATA', '')
    if local:
        for rel in (os.path.join('Programs', 'TRAE SOLO CN',
                                 'TRAE SOLO CN.exe'),
                    os.path.join('Programs', 'TRAE', 'Trae.exe')):
            p = os.path.join(local, rel)
            if os.path.isfile(p):
                return p
    return None


def _sandbox_pids(boxes):
    """收集全部沙盒内 PID（原版 TRAE 探测/杀进程共用的排除集）"""
    sb = set()
    for box in list(boxes or []):
        try:
            sb.update(box_pids(box))
        except Exception:
            pass
    return sb


def host_trae_running(boxes=None):
    """宿主机上是否有原版 TRAE 进程在跑（排除沙盒内分身）。
    「启动 TRAE」按钮用它区分：没运行→直接启动；运行但端口
    不在线→先弹窗确认再带端口重启。"""
    sb = _sandbox_pids(boxes)
    for pid, name in list(list_processes().items()):
        if pid in sb or pid <= 4:
            continue
        if 'trae' in (name or '').lower():
            return True
    return False


def kill_host_trae(boxes=None):
    """终止宿主机上的原版 TRAE 进程（沙盒内分身不被误杀）：
    先用各沙盒 start.exe /listpids 收集盒内全部 PID 做排除集，
    再枚举进程按名含 trae 逐个 taskkill。
    注意：排除集依赖沙盒快捷方式可发现（桌面）；若某盒 PID 收集
    失败，理论上存在误杀该盒 TRAE 的风险（只会导致该分身需重启）。"""
    sb = _sandbox_pids(boxes)
    for pid, name in list(list_processes().items()):
        if pid in sb or pid <= 4:
            continue
        if 'trae' not in (name or '').lower():
            continue
        try:
            subprocess.run(['taskkill', '/PID', str(pid), '/F'],
                           capture_output=True, timeout=10,
                           creationflags=CREATE_NO_WINDOW)
        except Exception:
            pass


# ---- v1.12：TRAE 主窗口状态（遮挡/最小化检测与无焦点恢复） ----
# 2026-09-11 真机 CLI 实测：Electron 窗口最小化后渲染冻结（rAF 停
# 摆），切会话后消息区不重排 → 快照采到 msgs=0 且不再变化，远程
# 端一直「没有消息」；窗口恢复可见 2 秒内消息即回。可见但不前台
# （SW_SHOWNOACTIVATE）渲染正常 → 检测到最小化即无焦点恢复。
# v1.15（2026-09-12 exp6 四状态对照）：最小化与隐藏（托盘）同样
# 冻结（迟滞 2.6~3.1s vs 可见态稳定 1.1~1.3s）；托盘态主窗被
# 隐藏，原「只枚举可见窗口」导致检测不到、恢复永不触发——已修
# （枚举含隐藏窗，最小化/隐藏都触发无焦点恢复）。


def _trae_windows():
    """宿主 TRAE 主窗口句柄列表（按进程名含 trae 判定 +
    Chrome_WidgetWin_1 主窗类）。v1.15：不筛可见性——托盘态主窗
    是被隐藏的，筛了就检测不到、无法触发恢复；以「标题非空」
    排除 Chromium 无标题辅助窗（原靠 IsWindowVisible 排除浮窗，
    该条件与托盘检测冲突，见文件头 1.15）。"""
    try:
        trae_pids = {p for p, n in list_processes().items()
                     if 'trae' in (n or '').lower()}
    except Exception:
        return []
    if not trae_pids:
        return []
    user32 = ctypes.windll.user32
    out = []
    CB = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)

    def cb(h, _l):
        pid = ctypes.c_uint32(0)
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value in trae_pids and user32.GetWindowTextLengthW(h) > 0:
            cls = ctypes.create_unicode_buffer(64)
            user32.GetClassNameW(h, cls, 64)
            if cls.value == 'Chrome_WidgetWin_1':
                out.append(h)
        return True
    user32.EnumWindows(CB(cb), 0)
    return out


def _trae_minimized():
    """TRAE 主窗是否最小化或被隐藏（托盘态 visible=False，
    v1.15 起两种都算——都伴随 Electron 渲染冻结）"""
    user32 = ctypes.windll.user32
    return any((not user32.IsWindowVisible(h)) or user32.IsIconic(h)
               for h in _trae_windows())


def _trae_restore_noactivate():
    """无焦点恢复最小化/隐藏（托盘）的 TRAE 主窗（SW_SHOWNOACTIVATE，
    不抢用户正在用的窗口焦点）。窗口弹回可见后 Electron 恢复
    渲染。有恢复动作返回 True。v1.15：隐藏与最小化统一处理。"""
    user32 = ctypes.windll.user32
    did = False
    for h in _trae_windows():
        if user32.IsIconic(h) or not user32.IsWindowVisible(h):
            user32.ShowWindow(h, 4)        # SW_SHOWNOACTIVATE
            did = True
    return did


def _trace_dir():
    r"""使用痕迹目录。目录规则：D:\ 一级文件夹
    「PY名+使用痕迹+随机字符」（已存在则复用），无 D 盘回退
    脚本同目录。内部文件用固定清晰名（配置.json / 消息时间戳.json）。"""
    try:
        name = os.path.splitext(os.path.basename(
            os.path.abspath(__file__)))[0]
    except NameError:
        name = 'TRAE同步显示与控制工具'
    prefix = name + '使用痕迹'
    root = 'D:\\'
    if os.path.isdir(root):
        try:
            hits = [d for d in os.listdir(root)
                    if d.startswith(prefix)
                    and os.path.isdir(os.path.join(root, d))]
        except OSError:
            hits = []
        if hits:
            return os.path.join(root, hits[0])
        import random
        p = os.path.join(root, '%s%04x'
                         % (prefix, random.randrange(0x10000)))
        try:
            os.makedirs(p, exist_ok=True)
            return p
        except OSError:
            pass
    return os.path.dirname(os.path.abspath(__file__))


def _trace_path():
    return os.path.join(_trace_dir(), '消息时间戳.json')


# ================= 配置文件（重要路径 / 窗口 / 运行选项） =================

_CFG_DEFAULT = {
    'trae_exe': '',          # 原版 TRAE 主程序（设置页重要路径，可手动指定）
    'sandman': '',           # Sandboxie SandMan.exe（start.exe 同目录推导）
    'topmost': True,         # 📌置顶图钉（出厂默认置顶，可改）
    'remember_win': True,    # 记住上次窗口大小位置（拖动立刻保存）
    'geometry': '',          # 上次窗口 geometry（WxH+X+Y）
    'open_home': True,       # 启动打开主页（不打勾=恢复最后使用的分页）
    'keep_visible': True,    # 1.16 TRAE 可见性看护：最小化/托盘即无焦点弹回（保持可见=控制流畅的前提）
    'last_tab': 0,           # 最后使用的分页索引（主界面0/设置1）
    'no_multi': True,        # 禁止多开（重启软件后生效）
    'fin_popup': True,       # 任务完成弹窗提醒（生成中→空闲跳变时弹）
    'fin_popup_sec': 5,      # 弹窗自动关闭秒数（设置页可调）
    'fin_idle_sec': 15,      # 结束→空闲过渡秒数（刚结束显示「结束」）
    'ws_on': True,           # 远程服务开关（WS 桥，重启软件后生效）
    'ws_url': '',            # 远程中继地址（空=默认 PieSocket 频道 TRAE）
    'stats_keep': 100,       # 网络页：流量按天记录保留天数（1.02）
    'watchdog_on': True,     # 1.03 防呆：生成中长时间无动静自动续跑
    'watchdog_min': 15,      # 防呆：无动静阈值（分钟）
    'watchdog_resend_sec': 5,  # 防呆：终止后发「继续」延迟（秒）
    # —— 1.19 设置页参数暴露（调试期摸索出的硬编码参数入 UI）——
    'poll_sec': 0.8,         # 快照轮询间隔秒（小=消息更及时、CPU略高）
    'pend_send_sec': 15,     # 发送占位确认超时秒（超时标「未确认」）
    'pend_switch_sec': 6,    # 切换占位兜底超时秒（快照对账失败再等）
    'pend_head': 100,        # 1.37：发送确认匹配字数（前 N 字相同即算）
    'pend_age_sec': 30,      # 1.38：发送确认只认 N 秒内新出现的消息（用户口径 30 秒）
    'orig_port': 9599,       # 原版 TRAE 调试端口（需与 TRAE 启动参数
                             # 一致；改后由「重启」按钮带新端口拉起）
    'lock_on': True,         # 1.24：远方操控互斥（同一时刻只允许一个
                             # 远方操控者占用本服务端，防多端打架）
    'lock_sec': 60,          # 1.24：占用释放秒数（操控者超时无操作
                             # 自动释放，期间其他操控者被拒绝）
    'srv_name': '',          # 1.23 服务器名称（强制唯一：与在线远方
                             # 服务端重名禁止登录；FOX 发送者ID由此派生）
    'points_warn_th': 100,   # 1.41 积分预警阈值（积分≤阈值时网页弹提醒
                             # 2 秒 + 钉钉97号通道 webhook；0=关闭）
}
CFG = None                  # 懒加载的全局配置（_ensure_cfg 首次访问才读盘）


def _cfg_path():
    return os.path.join(_trace_dir(), '配置.json')


def _ensure_cfg():
    """懒加载配置（import 时不做磁盘 IO；主线程在开线程前先调一次）"""
    global CFG
    if CFG is None:
        cfg = dict(_CFG_DEFAULT)
        try:
            with open(_cfg_path(), encoding='utf-8') as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                cfg.update(saved)
        except Exception:
            pass
        CFG = cfg
    return CFG


def _save_cfg(cfg):
    """立刻落盘（不等退出）——路径采用/窗口拖动/置顶切换等即时保存"""
    try:
        with open(_cfg_path(), 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


_PEND_ZW_RE = re.compile(r'[\s\u200b-\u200d\u2060\ufeff]+')
_PEND_MD_RE = re.compile(r'[`*_~>#]')


def _norm_txt(s):
    """1.38：确认比对前的文本规范化。用户反馈「消息已出现在对话
    记录里却判未确认」——TRAE 渲染会吃掉 markdown 记号与空白
    （**加粗** 变粗体、换行成块级元素），快照文本与发送原文在
    字符层面对不上。双方统一：去全部空白与零宽字符、去 markdown
    修饰符（* ` _ ~ > #）、转小写。"""
    s = _PEND_ZW_RE.sub('', s or '')
    return _PEND_MD_RE.sub('', s).lower()


def _pend_head100(sent, shown, head_n=100):
    """1.36：发送确认匹配——「前 N 字相同」即可（N=设置页「确认匹
    配字数」，默认 100；长消息 TRAE 会折叠显示，全文比对必然失败）。
    一侧不足 N 字时按前缀算（折叠截断可能到不了 N 字）；任一侧短于
    12 字则要求全等（防超短文本如「好的」与历史消息误配）。
    1.38：比对前先 _norm_txt 规范化（格式污染不再导致误判）。"""
    a = _norm_txt(sent)[:head_n]
    b = _norm_txt(shown)[:head_n]
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) >= 12:
        return a.startswith(b) or b.startswith(a)
    return False


# ================= WS 流量统计（1.02：按天累计 / 落盘保留可调天数） =================

_STATS_LOCK = threading.RLock()
_STATS = None    # 懒加载 {'days': {日期: {'rx': 收字节, 'tx': 发字节}}, }


def _stats_path():
    return os.path.join(_trace_dir(), '网络流量.json')


def _stats_load():
    """懒加载流量记录（RLock 可重入；坏文件从零开始）。"""
    global _STATS
    if _STATS is None:
        st = {'days': {}}
        try:
            with open(_stats_path(), encoding='utf-8') as f:
                saved = json.load(f)
            if isinstance(saved, dict) and isinstance(saved.get('days'),
                                                      dict):
                st['days'] = saved['days']
        except Exception:
            pass
        _STATS = st
    return _STATS


def _stats_keep():
    """保留天数（网络页可调，默认 100，最小 1）。"""
    try:
        return max(1, int(_ensure_cfg().get('stats_keep', 100)))
    except Exception:
        return 100


def _stats_add(rx=0, tx=0, rxn=0, txn=0):
    """线程安全（WS 回调/发送线程调用）：今日收/发字节 + 条数累计；
    跨天自然滚动到新桶（旧日数据留在 days 里等落盘）。"""
    day = time.strftime('%Y-%m-%d')
    with _STATS_LOCK:
        b = _stats_load()['days'].setdefault(
            day, {'rx': 0, 'tx': 0, 'rxn': 0, 'txn': 0})
        b['rx'] += rx
        b['tx'] += tx
        b['rxn'] = b.get('rxn', 0) + rxn     # 1.04：收条数（旧桶无键兼容）
        b['txn'] = b.get('txn', 0) + txn     # 1.04：发条数（旧桶无键兼容）


def _stats_flush():
    """落盘：写今日累计 + 清理超期旧记录（读改写小 json）。
    调用点：网络页 30s 定时 / 退出兜底。"""
    with _STATS_LOCK:
        st = _stats_load()
        keep = _stats_keep()
        days = st['days']
        if len(days) > keep:
            for d in sorted(days)[:-keep]:
                days.pop(d, None)
        try:
            with open(_stats_path(), 'w', encoding='utf-8') as f:
                json.dump(st, f, ensure_ascii=False, indent=1)
        except Exception:
            pass


def _fmt_bytes(n):
    """流量人性化显示：B / KB / MB / GB。"""
    n = float(n or 0)
    if n < 1024:
        return '%d B' % n
    if n < 1024 ** 2:
        return '%.1f KB' % (n / 1024)
    if n < 1024 ** 3:
        return '%.2f MB' % (n / 1024 ** 2)
    return '%.2f GB' % (n / 1024 ** 3)


# ================= 远程链路（1.00：PieSocket 中继 + FOX 分段协议） =================

WS_CHANNEL = '31415926fF@'  # 中继频道名（v1.41 换私密频道；仅服务端
                            # 知道，网页客户端一律不硬编码——首次使用
                            # 弹窗输入，存本地）
WS_URL_TMPL = ('wss://free.blr2.piesocket.com/v3/%s'
               '?api_key=ReDFavhh0qnOCKUUjQiLKVZ9RdxA6e4BGVKxxNug')

# ---- 1.41：钉钉 97 通道 webhook（积分预警等通知）----
# 走 webhook发送器 CLI（钉钉通道.txt 现读现发，加签自动处理）。
# 该工具永远在工作台总目录内、可能移动——找不到就现搜。
_WS_CLI = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       '..', '..', '开发资源包', 'webhook发送器',
                       'webhook发送器含CLI.py')


def _find_webhook_cli():
    """定位 webhook发送器含CLI.py：先认常规路径，不在则全工作台搜。"""
    p = os.path.normpath(_WS_CLI)
    if os.path.isfile(p):
        return p
    root = os.path.normpath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    for dirpath, _dirs, files in os.walk(root):
        if 'webhook发送器含CLI.py' in files:
            return os.path.join(dirpath, 'webhook发送器含CLI.py')
    return None


def _dingtalk_97(msg, tries=2):
    """钉钉 97 号通道发文本消息（子进程调 webhook发送器 CLI，
    阻塞在调用线程内，勿占 GUI 线程）。
    2026-09-14 实测：系统代理对 oapi.dingtalk.com 返回 502——
    子进程必须清掉代理环境变量（requests 尊重 HTTP(S)_PROXY）。"""
    cli = _find_webhook_cli()
    if not cli:
        return False
    env = {k: v for k, v in os.environ.items()
           if k.lower() not in ('http_proxy', 'https_proxy',
                                'all_proxy')}
    env['NO_PROXY'] = '*'
    for py in (sys.executable, r'D:\Python310\python.exe',
               r'D:\PY\python.exe'):
        if not py or not os.path.isfile(py):
            continue
        for i in range(tries):
            try:
                r = subprocess.run(
                    [py, cli, '钉钉', '97', str(msg)],
                    capture_output=True, text=True,
                    encoding='utf-8', errors='replace', timeout=30,
                    env=env)
                if r.returncode == 0:
                    return True
            except Exception:
                pass
            time.sleep(2)
    return False
SERVER_ID = '1000000001'    # FOX 发送者ID：服务端（1.23 起为未命名
                            # 兜底值；命名后由 _srv_sid() 派生替换）
CLIENT_ID = '2000000001'    # FOX 发送者ID：客户端（网页版实际用 4 开头）

# ---- 1.23 多服务端：本机 FOX 发送者ID（由服务器名称派生）----
# 约定：FOX 发送者 '1' 开头=服务端、'4' 开头=网页客户端。
# 多台服务端同频道时各有唯一 SID（同名冲突在登录时强制拦截），
# 服务端据此区分「自己的回声」与「远方服务端报文」（旧版两台
# 服务端同为 1000000001 会互相当成回声丢弃）。
_SID = None


def _srv_sid():
    """本机 FOX 发送者ID：已命名=派生SID；未命名=旧版固定值兜底。"""
    return _SID or SERVER_ID


def _srv_name():
    """本机服务器名称（CFG 懒加载安全读取）。"""
    try:
        return (_ensure_cfg().get('srv_name') or '').strip()
    except Exception:
        return ''


def _derive_sid(name):
    """服务器名称 → '1'+9 位数字（md5 派生，稳定可复现）。"""
    d = ''.join(c for c in hashlib.md5(
        ('TRAE-SRV|' + (name or '')).encode('utf-8')).hexdigest()
        if c.isdigit())
    seed = name or ''
    while len(d) < 9:
        d += str(int(hashlib.md5(
            ('TRAE-SRV|' + seed + str(len(d))).encode('utf-8')
        ).hexdigest(), 16) % 10)
    return '1' + d[:9]


def _set_srv_name(name):
    """采纳服务器名称：写全局 SID（供 FOX 收发与回声判定使用）。"""
    global _SID
    _SID = _derive_sid(name) if name else None

# 1.21：手机版网页客户端（GitHub Pages，部署规则=只推 FOXFYH/gittest）
WEB_CLIENT_URL = ('https://foxfyh.github.io/gittest/'
                  'TRAE%E5%90%8C%E6%AD%A5%E6%98%BE%E7%A4%BA%E4%B8%8E'
                  '%E6%8E%A7%E5%88%B6%E5%B7%A5%E5%85%B7_%E7%BD%91%E9'
                  '%A1%B5%E5%AE%A2%E6%88%B7%E7%AB%AF_%E6%89%8B%E6%9C'
                  '%BA%E7%89%88.html?v=' + VERSION)
# ↑ 带 ?v=版本号：GitHub Pages 忽略查询串照常出文件，但浏览器视为
#   不同地址强制绕过缓存——升级服务端后按钮打开的就是新网页版。

_FOX_HDR_RE = re.compile(
    r'^【FOXID:(\d{14})([a-z]{8})(\d{10})=cut\((\d{3})/(\d{3})\)】')
_FOX_HDR_BYTES = 57             # 协议头固定字节数（【】各 3 字节）
_FOX_MAX_PAYLOAD = 10 * 1024 - _FOX_HDR_BYTES   # 单段正文上限（中继 16KB 限）


def _fox_split(text):
    """正文按 UTF-8 字节切成 ≤10KB 的段（回退字节边界保证多字节字符
    完整）。PieSocket 单消息上限 16KB，留足余量。"""
    raw = text.encode('utf-8')
    out, cur = [], 0
    while cur < len(raw):
        end = min(cur + _FOX_MAX_PAYLOAD, len(raw))
        while end > cur:
            try:
                out.append(raw[cur:end].decode('utf-8'))
                break
            except UnicodeDecodeError:
                end -= 1
        else:
            out.append('')
        cur = end
    return out


class _FoxIn(object):
    """FOX 分段接收拼装器：按消息号收集各段，拼齐才交付；
    300 秒没收齐的残包丢弃防泄漏（大附件传输耗时长，超时放宽）。"""

    def __init__(self):
        self.buf = {}
        self.lock = threading.Lock()

    def feed(self, msg):
        """喂一条原始 WS 文本；返回 (发送者ID, 完整正文) 或 None。"""
        m = _FOX_HDR_RE.match(msg)
        if not m:
            return None
        ts, rnd, sender = m.group(1), m.group(2), m.group(3)
        idx, total = int(m.group(4)), int(m.group(5))
        body = msg.encode('utf-8')[_FOX_HDR_BYTES:].decode('utf-8',
                                                            'replace')
        if total <= 1:
            return (sender, body)
        mid = ts + rnd
        with self.lock:
            d = self.buf.setdefault(mid, {'n': total, 'p': {},
                                           'at': time.time()})
            d['p'][idx] = body
            done = len(d['p']) >= d['n']
            if not done:
                for k in [k for k, v in self.buf.items()
                          if time.time() - v['at'] > 300]:
                    self.buf.pop(k, None)
                return None
            full = ''.join(d['p'].get(i, '')
                           for i in range(1, d['n'] + 1))
            self.buf.pop(mid, None)
            return (sender, full)


class _TeeQueue(object):
    """事件二路分发：put 同步进本地 uiq（原行为不变）+ 转发远程桥；
    get_nowait 透传本地队列（_drain 照旧消费）。"""

    def __init__(self, real, bridge):
        self._real = real
        self._bridge = bridge

    def put(self, item):
        self._real.put(item)
        try:
            self._bridge.forward_event(item)
        except Exception:
            pass

    def get_nowait(self):
        return self._real.get_nowait()


class _RemoteBridge(threading.Thread):
    """服务端远程桥（1.00）：连 PieSocket 频道（默认 TRAE）——
    · 出向：uiq 事件经 _TeeQueue 转发（快照按指纹去重省中继配额，
      无变化不重发；掉线期间只更新缓存不排队，重连 hello 重放）；
    · 入向：远程命令以 ('rcmd', 正文) 投回本地 uiq → 主线程
      _on_rcmd 分发；
    · 心跳 25s 防超时；断线 3s 自动重连；FOX 分段收发。"""

    KA_SEC = 25               # 心跳间隔（秒）
    RECONNECT = 3            # 断线重连间隔（秒）

    def __init__(self, realq, dlg):
        threading.Thread.__init__(self, daemon=True)
        self.realq = realq    # 本地 uiq 原队列（入向命令回投用）
        self.dlg = dlg        # 服务端面板（取状态/读几何）
        self.outq = queue.Queue()
        self.fox_in = _FoxIn()
        self.stop_ev = threading.Event()
        self.ws = None
        self.on_line = False
        self._last_snap = None       # 最新快照（hello 重放）
        self._last_models = None     # 最新模型列表（hello 重放）
        self._last_snap_fp = None    # 快照指纹（去重）
        self._remote_export = False  # 远程发起完整导出（本地不弹保存框）
        self._sent_echo = []         # 1.04：fox_on 关闭时最近发送原文（防回声）
        # 1.20：最近客户端统计——sender → 最后一次报文时刻；
        # 60 秒窗口内数出的条数=「在线客户端数」，0=待命中
        self._peers = {}
        self._last_peer_n = -1
        self._peer_lock = threading.Lock()
        # 1.23：远方服务端注册表（name → {v,box,port,boxes,alive,
        # conn,sid,ts}）；每 20s 心跳广播本机信息，75s 无心跳判离线
        self._srv_lock = threading.Lock()
        self.srv_peers = {}
        self._last_ann = 0.0

    # ---- 1.23：远方服务端注册表 ----

    def srv_update(self, d):
        """收到远方服务端 hello/srv 报文：注册/刷新（按名称）。
        返回 True=该服务端可呈现状态有变化（conn/alive/boxes）。"""
        name = (d.get('srv') or '').strip()
        if not name:
            return False
        with self._srv_lock:
            cur = self.srv_peers.get(name) or {}
            ent = dict(cur)
            ent.update({
                'name': name, 'sid': str(d.get('sid') or ''),
                'v': d.get('v'), 'box': d.get('box'),
                'port': d.get('port'),
                'boxes': list(d.get('boxes') or []),
                'alive': list(d.get('alive') or []),
                'conn': bool(d.get('conn')), 'ts': time.time()})
            ch = (not cur
                  or cur.get('conn') != ent['conn']
                  or cur.get('alive') != ent['alive']
                  or cur.get('boxes') != ent['boxes']
                  or cur.get('box') != ent['box']
                  or cur.get('sid') != ent['sid'])
            self.srv_peers[name] = ent
        return ch

    def srv_snapshot(self):
        with self._srv_lock:
            return {k: dict(v) for k, v in self.srv_peers.items()}

    def srv_prune(self):
        """75s 无心跳的远方服务端判离线。返回离线名单（可空）。"""
        now = time.time()
        with self._srv_lock:
            dead = [k for k, v in self.srv_peers.items()
                    if now - v.get('ts', 0) > 75]
            for k in dead:
                del self.srv_peers[k]
        return dead

    def announce(self):
        """广播本机服务端信息（上线/收到 who/每 20s 心跳）。未命名
        不广播（名字是远方识别本机的唯一键）。"""
        name = _srv_name()
        if not name:
            return
        dlg = self.dlg
        try:
            alive = sorted(getattr(dlg, '_alive_last', None) or [])
            conn = bool(dlg.poller.cdp is not None)
        except Exception:
            alive, conn = [], False
        self.send_json({'t': 'srv', 'srv': name, 'sid': _srv_sid(),
                        'v': VERSION, 'box': getattr(dlg, 'box_name', ''),
                        'port': getattr(dlg, 'port', 0),
                        'boxes': getattr(dlg, 'box_names', []),
                        'alive': alive, 'conn': conn})

    # ---- 出向 ----

    def forward_event(self, item):
        """_TeeQueue 调用（任意线程）：本地事件转 JSON 发远程。"""
        if not self.is_alive():
            return                     # 桥未启用（设置页关了远程服务）
        try:
            kind, val = item
        except Exception:
            return
        if kind in ('paths_check', 'rcmd', 'remote', 'rev',
                    'srv_peers', 'srv_conflict'):
            return                     # 本地交互事件，不转发
        if not self.on_line:
            if kind == 'snap':         # 掉线期只缓存，重连后 hello 重放
                self._last_snap = val
            return
        if kind == 'snap':
            fp = hashlib.md5(json.dumps(
                val, ensure_ascii=False, sort_keys=True)
                .encode('utf-8')).hexdigest()
            if fp == self._last_snap_fp:
                return                 # 无变化不重发（省中继配额）
            self._last_snap_fp = fp
            self._last_snap = val
        elif kind == 'models':
            self._last_models = val
        # 1.23：报文带 'srv' 源头名——多服务端同频道时客户端/面板
        # 据此过滤（只渲染当前操控的服务端的事件）
        self.send_json({'t': 'ev', 'k': kind, 'v': val,
                        'srv': _srv_name()})

    def send_json(self, d):
        self.outq.put(json.dumps(d, ensure_ascii=False))

    def _ctl_info(self, sender=None):
        """1.24：本机远方操控占用情况（hello 回报用）。
        mine=True=无占用或占用者正是 sender（可接管/续占）。"""
        try:
            lk = self.dlg._ctl_lock
        except Exception:
            return {'mine': True}
        if not lk.get('id'):
            return {'mine': True}
        sec = max(10, int(_ensure_cfg().get('lock_sec', 60) or 60))
        left = int(lk.get('ts', 0) + sec - time.time())
        return {'id': lk['id'], 'mine': lk['id'] == sender,
                'left': max(0, left)}

    def send_hello(self, sender=None):
        """当前状态广播（客户端连上/请求时）：目标/分身表/端口在线/
        连接态/积分 + 重放最新模型列表与快照。1.24：附带操控占用
        信息（lock），sender=请求者 FOX ID（判断占用是不是自己）。"""
        dlg = self.dlg
        alive = sorted(getattr(dlg, '_alive_last', None) or [])
        try:      # 1.06：防升级状态（None=无法定位，客户端开关置灰）
            bs = dlg._block_stat()
            block = bs.get('blocked') if bs.get('ok') else None
        except Exception:
            block = None
        self.send_json({'t': 'hello', 'srv': _srv_name(),
                        'sid': _srv_sid(),
                        'box': dlg.box_name,
                        'port': dlg.port, 'boxes': dlg.box_names,
                        'alive': alive,
                        'conn': dlg.poller.cdp is not None,
                        'points': dlg.points, 'block': block,
                        'acct': getattr(dlg, 'account', '') or '',
                        'lock': self._ctl_info(sender),
                        # 1.37：发送确认匹配参数同步网页端
                        'pendcfg': {'head': _ensure_cfg().get(
                                        'pend_head', 100),
                                    'age': _ensure_cfg().get(
                                        'pend_age_sec', 30)}})
        # 1.35：重放事件补 'srv' 源头字段——1.23 起客户端按 srv 过滤
        # （非当前操控服务端的事件直接丢弃），hello 重放若不带 srv 会
        # 被判成「默认服务端」≠ 实际绑定的服务端 → 重放快照/模型全被
        # 丢弃：网页端连上后列表/聊天/就绪态永远不显示（模型列表能显
        # 示是因为 model_list 命令触发的 live 转发带 srv），只能等
        # DOM 指纹变化碰巧触发一次带 srv 的 live 快照才恢复（人工切
        # 模型/碰一下 TRAE 即恢复的机制）。
        if self._last_models is not None:
            self.send_json({'t': 'ev', 'k': 'models',
                            'v': self._last_models,
                            'srv': _srv_name()})
        if self._last_snap is not None:
            self.send_json({'t': 'ev', 'k': 'snap',
                            'v': self._last_snap,
                            'srv': _srv_name()})

    # ---- 连接循环 ----

    def run(self):
        threading.Thread(target=self._sender, daemon=True).start()
        while not self.stop_ev.is_set():
            try:
                if HAS_WS:
                    self._serve()
                else:
                    self.realq.put(('remote', '✘ 未装 websocket-client'))
                    self.stop_ev.wait(3600)
            except Exception:
                pass
            self._set_on_line(False)
            self.stop_ev.wait(self.RECONNECT)

    def _serve(self):
        # 1.41：频道名升级为私密频道——旧配置里存的「默认 TRAE 频道」
        # 完整地址视为未自定义，一律用新频道；用户真填了别的中继地址
        # 才尊重之
        url = CFG.get('ws_url') or ''
        if '/v3/TRAE?' in url:
            url = ''
        url = url or (WS_URL_TMPL % WS_CHANNEL)
        self.ws = websocket.WebSocketApp(
            url, on_open=self._on_open, on_message=self._on_msg,
            on_close=lambda *_a: None, on_error=lambda *_a: None)
        self.ws.run_forever()

    def _on_open(self, _ws):
        self._set_on_line(True)
        with self._peer_lock:          # 重连后旧统计作废，重新累计
            self._peers.clear()
        self._report_peers()
        self.send_hello()              # 上线即广播（重连自愈）
        self.announce()                # 1.23：广播本机服务端身份
        self.send_json({'t': 'who'})   # 1.23：请在线服务端亮名册

    def _on_msg(self, _ws, msg):
        _stats_add(rx=len(msg), rxn=1)   # 1.02 字节 + 1.04 条数
        if not CFG.get('fox_on', True):
            self._bare_msg(msg)          # 1.04：FOX 关闭——裸 JSON 直收
            return
        r = self.fox_in.feed(msg)
        if r is None:
            # FOX 开启：兜底解析无 FOX 头的裸 JSON（对端 fox_on 关闭时）
            self._bare_msg(msg)
            return
        sender, body = r
        if sender == _srv_sid():
            return                     # 自己的回声（保险）
        if sender[:1] == '1':
            # 1.23：远方服务端报文（'1' 开头）→ 注册表 + 远方事件路由，
            # 绝不回应（防两台服务端 hello 应答风暴）
            self._srv_msg(sender, body)
            return
        self._peer_seen(sender)        # 客户端（'4' 开头等）
        # 1.24：sender 随报文传递（=操控互斥锁的占有者标识）
        self.realq.put(('rcmd', (body, sender)))

    def _srv_msg(self, sid, body):
        """1.23：远方服务端报文分发：srv/hello → 注册表；who → 亮
        名册。1.25：不再操控远方服务端，ev 路由 / py 互控定向报文 /
        deny 应答（本机作为操控者）全部移除；注册表仅剩「重名检测 +
        网页端发现服务端」用途。"""
        try:
            d = json.loads(body)
        except Exception:
            return
        if not isinstance(d, dict):
            return
        t = d.get('t')
        if t == 'srv' or (t == 'hello' and d.get('srv')):
            d.setdefault('sid', sid)
            self.srv_update(d)
            self.realq.put(('srv_peers', self.srv_snapshot()))
        elif t == 'who':
            self.announce()

    def _bare_msg(self, msg):
        """裸 JSON 兜底（1.04）：先按最近发送原文防回声，再解析投递。"""
        try:
            self._sent_echo.remove(msg)
            return                     # 自己的回声
        except ValueError:
            pass
        try:
            d = json.loads(msg)
        except Exception:
            return                     # 心跳/中继系统消息
        if isinstance(d, dict):
            sid = str(d.get('sid') or '')
            if sid == _srv_sid():
                return                 # 自己的回声（1.23：裸 JSON 带_sid）
            if sid[:1] == '1':
                self._srv_msg(sid, msg)
                return
        else:
            sid = '?'
        self.realq.put(('rcmd', (msg, sid)))

    def _peer_seen(self, sender):
        """1.20：记录最近 1 分钟内有报文来往的远程客户端 sender。"""
        with self._peer_lock:
            self._peers[sender] = time.time()
        self._report_peers()

    def _report_peers(self):
        """1.20：修剪 60 秒窗口并上报客户端数（仅变化时投递）。
        _sender 闲时每 5s 也调一次——客户端安静 1 分钟后 UI 能
        及时回落到「待命中」，而不是等下一条报文才更新。"""
        now = time.time()
        with self._peer_lock:
            for s in [s for s, t in self._peers.items()
                      if now - t > 60]:
                del self._peers[s]
            n = len(self._peers)
        if n != self._last_peer_n:
            self._last_peer_n = n
            self.realq.put(('remote_peers', n))

    def _sender(self):
        """唯一发送线程：出向队列 → FOX 分段发送；闲时心跳。"""
        last_ka = time.time()
        while not self.stop_ev.is_set():
            self._report_peers()
            # 1.23：远方服务端心跳（20s 广播身份）+ 75s 超时判离线
            now = time.time()
            if self.on_line and now - self._last_ann >= 20:
                self._last_ann = now
                self.announce()
            if self.srv_prune():
                self.realq.put(('srv_peers', self.srv_snapshot()))
            try:
                item = self.outq.get(timeout=5)
            except queue.Empty:
                item = None
            try:
                if item is not None:
                    if self.on_line:
                        self._fox_send(item)
                    last_ka = time.time()
                elif (self.on_line
                        and time.time() - last_ka >= self.KA_SEC):
                    self.ws.send('ping')
                    _stats_add(tx=4, txn=1)    # 1.02 字节 + 1.04 条数
                    last_ka = time.time()
            except Exception:
                pass

    def _fox_send(self, text):
        if not CFG.get('fox_on', True):
            # 1.04：FOX 关闭——整条直发（≤16KB 可通，超限被中继丢弃）
            # 1.23：裸 JSON 注入 sid/srv（多服务端回声判定与源头识别）
            try:
                d = json.loads(text)
                if isinstance(d, dict):
                    d['sid'] = _srv_sid()
                    d.setdefault('srv', _srv_name())
                    text = json.dumps(d, ensure_ascii=False)
            except Exception:
                pass
            self.ws.send(text)
            _stats_add(tx=len(text), txn=1)
            self._sent_echo.append(text)
            if len(self._sent_echo) > 16:
                del self._sent_echo[:len(self._sent_echo) - 16]
            return
        parts = _fox_split(text)
        mid = time.strftime('%Y%m%d%H%M%S') + ''.join(
            random.choices(string.ascii_lowercase, k=8))
        for i, p in enumerate(parts, 1):
            s = '【FOXID:%s%s=cut(%03d/%03d)】%s' % (
                mid, _srv_sid(), i, len(parts), p)
            self.ws.send(s)
            _stats_add(tx=len(s), txn=1)  # 1.02 字节 + 1.04 条数（按分段）
            if len(parts) > 1:
                time.sleep(0.03)   # 分段微间隔防中继丢弃（大文件也扛得住）

    def _set_on_line(self, b):
        self.on_line = b
        self.realq.put(('remote', b))


# ================= 极简 CDP 客户端（原 auto_login.py 内联） =================

class _WS(object):
    def __init__(self, host, port, path):
        s = socket.create_connection((host, port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ('GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n'
               'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
               'Sec-WebSocket-Version: 13\r\n\r\n' % (path, host, port, key))
        s.sendall(req.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += s.recv(4096)
        if b'101' not in buf.split(b'\r\n')[0]:
            raise IOError('websocket 握手失败')
        self.s = s
        self.buf = b''
        self.nid = 0

    def send_text(self, text):
        payload = text.encode('utf-8')
        hdr = bytearray([0x81])
        n = len(payload)
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack('>H', n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack('>Q', n)
        mask = os.urandom(4)
        hdr += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.s.sendall(bytes(hdr) + masked)

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise IOError('ws closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def recv_text(self):
        while True:
            h = self._recv_exact(2)
            ln = h[1] & 0x7F
            if ln == 126:
                ln = struct.unpack('>H', self._recv_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack('>Q', self._recv_exact(8))[0]
            payload = self._recv_exact(ln)
            op = h[0] & 0xF
            if op == 1:
                return json.loads(payload.decode('utf-8'))
            if op == 8:
                raise IOError('ws closed by peer')


class CDP(object):
    """连接某调试端口的第一个 page 目标（TRAE 主窗口）"""

    def __init__(self, port, url_contains=None):
        self.port = port
        targets = self._targets()
        page = None
        for t in targets:
            if t.get('type') != 'page':
                continue
            if url_contains is None or url_contains in (t.get('url') or ''):
                page = t
                break
        if page is None:
            raise IOError('调试端口 %d 上没有可用页面%s'
                          % (port, '' if url_contains is None
                             else '（含 %s）' % url_contains))
        url = page['webSocketDebuggerUrl']
        path = '/' + url.split('/', 3)[3] if url.count('/') >= 3 else url
        self.ws = _WS('127.0.0.1', port, path)

    def _targets(self):
        with urllib.request.urlopen(
                'http://127.0.0.1:%d/json/list' % self.port, timeout=5) as r:
            return json.loads(r.read().decode('utf-8'))

    @staticmethod
    def port_alive(port, url_contains=None):
        try:
            with urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/list' % port, timeout=3) as r:
                targets = json.loads(r.read().decode('utf-8'))
            for t in targets:
                if t.get('type') != 'page':
                    continue
                if url_contains is None or url_contains in (t.get('url') or ''):
                    return True
            return False
        except Exception:
            return False

    def call(self, method, params=None):
        self.ws.nid += 1
        mid = self.ws.nid
        self.ws.send_text(json.dumps({'id': mid, 'method': method,
                                      'params': params or {}}))
        while True:
            msg = self.ws.recv_text()
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError('%s: %s' % (method, msg['error']))
                return msg.get('result')

    def eval(self, js):
        r = self.call('Runtime.evaluate', {
            'expression': js, 'returnByValue': True,
            'awaitPromise': True})
        if r.get('exceptionDetails'):
            raise RuntimeError('JS 异常: %s'
                               % json.dumps(r['exceptionDetails'])[:300])
        return r['result'].get('value')

    def click_center(self, js):
        """输入级点击：js 返回 {x, y} 或 null"""
        p = self.eval(js)
        if not p:
            return False
        self.call('Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': p['x'], 'y': p['y'],
            'button': 'left', 'clickCount': 1, 'buttons': 1})
        self.call('Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': p['x'], 'y': p['y'],
            'button': 'left', 'clickCount': 1})
        return True

    def click_send_safe(self):
        """1.41：发送键安全点击——js 返回 {x,y,voice}；voice=True
        （键此刻是语音输入按钮）时绝不点击，返回 'voice' 交调用方
        处置（防进入语音模式死循环）。返回 True=已点击。"""
        p = self.eval(_SEND_CLICK_JS)
        if not p:
            return False
        if p.get('voice'):
            return 'voice'
        self.call('Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': p['x'], 'y': p['y'],
            'button': 'left', 'clickCount': 1, 'buttons': 1})
        self.call('Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': p['x'], 'y': p['y'],
            'button': 'left', 'clickCount': 1})
        return True


# ================= DOM 探针（2026-09-06 实测验证） =================

# 1.06：AI 提问选项收集核心（快照 opts 与 pick_opt 点选共用同一
# 规则）。__findOpts 返回 [{t:文案, b:按钮元素}]。收集规则（启发式，
# 因选项卡答完即销毁抓不到真实类名——位置+黑名单兜底防改版）：
# ① 最后一条可见 AI 消息顶部以下的按钮（问题卡跟在 AI 消息区）；
# ② 排除 iconButton 类（复制/分享/赞/踩等图标工具栏钮）；
# ③ 排除输入栏/左栏会话列表/顶部标签条容器内的按钮；
# ④ 排除已知工具文案黑名单（重试/复制全部/确认/取消等）；
# ⑤ 可见、有文案、≤18 字、去重，最多 8 个。
_OPTS_CORE_JS = r"""
  function __findOpts() {
    const flat = s => (s||'').replace(/\s+/g,' ').trim();
    const BLACK = ['重试','复制','复制全部','分享','赞','踩','已复制',
                   '编辑','删除','回退','取消','确认','选择文件夹',
                   '展开','收起','继续','停止','发送'];
    const ags = [];
    document.querySelectorAll('[class*="turn__agent-message"]')
      .forEach(el => {
        if (el.checkVisibility) {
          if (!el.checkVisibility({checkVisibilityCSS: true})) return;
        }
        ags.push(el);
      });
    if (!ags.length) return [];
    const top = ags[ags.length - 1].getBoundingClientRect().top - 4;
    const out = [];
    document.querySelectorAll('button,[role="button"]').forEach(b => {
      if (out.length >= 8) return;
      if (String(b.className).indexOf('iconButton') >= 0) return;
      if (b.closest('[class*="chat-input"]')) return;
      if (b.closest('[class*="task-list"]')) return;
      if (b.closest('[class*="menubar"]')) return;
      const t = flat(b.innerText);
      if (!t || t.length > 18) return;
      // 1.38：屏蔽「安装 TRAE Code」类安装引导按钮（用户要求，
      // 误点无意义）
      if (t.indexOf('安装') >= 0 && /trae/i.test(t)) return;
      // 1.39：diff 审查/后台命令状态钮不是 AI 提问——「N 个文件
      // 待审查」是代码审查条，「全部撤销/全部保留」是它的操作钮，
      // 「后台命令正在运行」是状态提示，都混进了选项卡（用户要求
      // 移除）
      if (/待审查|后台命令/.test(t)) return;
      if (/^(全部)?(撤销|保留)$/.test(t)) return;
      // 1.40：状态条类杂钮（「任务耗时 1m 37s」等）不是提问选项
      if (/\d+\s*(m|分|min)/i.test(t) && /耗时/.test(t)) return;
      if (BLACK.indexOf(t) >= 0) return;
      const r = b.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      if (r.top < top) return;
      if (out.some(o => o.t === t)) return;
      out.push({t: t, b: b});
    });
    return out;
  }
  /* 1.40：结构化 AI 提问卡提取（2026-09-13 CDP 实测 TRAE 真实
     结构）：AskUserQuestion 工具卡 → choiceList-* 容器 → 选项是
     div.optionItem-*（不是 button，旧启发式永远看不见真选项）；
     最后一项「其他」内嵌 textarea（N/500 计数）；底部
     button.footerBtnFixed-*（primary=下一步/确认，secondary=取消）。
     问题标题在其父链的 header/title 元素（含「1 of 2」多问进度）。
     返回 null = 当前没有提问卡。 */
  function __findAsk() {
    const flat = s => (s||'').replace(/\s+/g,' ').trim();
    let anchor = null;                 /* 提问卡锚点（选项容器或footer） */
    const list = document.querySelector('[class*="choiceList-"]');
    if (list && list.getBoundingClientRect) {
      const r0 = list.getBoundingClientRect();
      if (r0.width > 0 && r0.height > 0) anchor = list;
    }
    /* 1.41：纯文本问（无 choiceList，只有大 textarea + footer）——
       2026-09-14 实测 TRAE 会问「是否有更多补充信息？（可选）2 of 2」
       这类无选项问题，旧逻辑直接返回 null，手机版毫无感知 */
    if (!anchor) {
      document.querySelectorAll('[class*="footerBtnFixed"]').forEach(b => {
        if (anchor) return;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) anchor = b;
      });
    }
    if (!anchor) return null;
    const items = [];
    if (list && anchor === list) {
      document.querySelectorAll('[class*="optionItem-"]').forEach(el => {
        if (!list.contains(el)) return;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) return;
        items.push({
          t: flat(el.innerText).replace(/\s*\d+\/500\s*$/, ''),
          other: /Other/i.test(String(el.className)),
          sel: /Focused|Selected|Active|Checked/i.test(String(el.className))
        });
      });
    }
    if (anchor === list && !items.length) return null;
    if (!items.length) {
      /* 纯文本问：渲染成单项「其他」卡（可空提交=可选问题） */
      items.push({t: '', other: true, sel: false});
    }
    let q = '';
    let anc = anchor.parentElement;
    while (anc && anc !== document.body) {
      const hd = anc.querySelector(
        ':scope > [class*="title"], :scope > [class*="header"]');
      if (hd){ q = flat(hd.innerText); break; }
      const t0 = anc.firstChild && anc.firstChild.nodeType === 3
                 ? flat(anc.firstChild.textContent) : '';
      if (t0){ q = t0; break; }
      anc = anc.parentElement;
    }
    let btn = '', cancel = false, prev = false;
    document.querySelectorAll('[class*="footerBtnFixed"]').forEach(b => {
      const r = b.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const t = flat(b.innerText);
      if (/primary/i.test(String(b.className))) btn = t;
      else if (/^取消/.test(t)) cancel = true;
      else if (/上一步|Previous/i.test(t)) prev = true;
    });
    return {q: q, opts: items, btn: btn, cancel: cancel, prev: prev};
  }
"""

# 全量快照：一个 eval 拿全部（轮询用，降低开销）
# 1.06：注入 __findOpts（快照 opts 用）；opts 只在发现候选时携带
_SNAP_JS = r"""
(() => {
  const __OPTS_CORE__
  const ask = __findAsk();          /* 1.40：结构化提问卡优先 */
  /* 1.44：插话排队条（pendingMessageList）——生成中排队待 AI 消费
     的消息，手机端据此渲染队列管理 UI（实测 DOM：
     pendingMessageItem- > pendingMessageContentText + 三 aria 按钮）*/
  const pendList = document.querySelector('[class*="pendingMessageList"]');
  const pend = pendList ? Array.from(
    pendList.querySelectorAll('[class*="pendingMessageItem-"]'))
    .map(it => ({
      t: ((it.querySelector('[class*="pendingMessageContentText"]')
           || {}).textContent || '').trim(),
      canEdit: !!Array.from(it.querySelectorAll('button')).find(
        b => b.getAttribute('aria-label') === '编辑')
    })).filter(x => x.t) : [];
  const opts = ask ? [] : __findOpts().map(o => ({t: o.t}));
  const send = document.querySelector('[class*="chat-input-v2-send-button"]');
  const input = document.querySelector(
      '[class*="chat-input-v2-input-box-editable"]');
  const tail = document.querySelector('[class*="core-task-tail"]');
  const modelEl = document.querySelector(
      '[class*="core-model-select-trigger-value"]');
  const cls = send ? String(send.className) : '';
  const msgs = [];
  document.querySelectorAll(
      '[class*="turn__user-message"],[class*="turn__agent-message"]')
    .forEach(el => {
      // 2.07：TRAE 把更早的会话段缓存成多个同位容器
      // （visibility:hidden），幽灵 turn 的 innerText 为空 → 空白
      // 气泡。⚠ checkVisibility() 默认不查 visibility:hidden（只查
      // display:none），必须传 {checkVisibilityCSS:true}（2026-09-08
      // 实测踩坑）；屏幕外不算隐藏，滚上去的历史段照常收
      if (el.checkVisibility) {
        if (!el.checkVisibility({checkVisibilityCSS: true})) return;
      } else {
        let q = el, vis = true;
        while (q && q !== document.body) {
          const s = getComputedStyle(q);
          if (s.display === 'none' || s.visibility !== 'visible') {
            vis = false; break;
          }
          q = q.parentElement;
        }
        if (!vis) return;
      }
      const txt = (() => {
        // 1.25：用户消息 hover 条内的时间戳混进 innerText，远端
        // 「已发出」文本比对永远失败 → 挂满 15s 误报「未确认」。
        // 克隆节点摘掉时间元素再取文本（服务端/网页端对账同受益）
        const c = el.cloneNode(true);
        c.querySelectorAll('[class*="user-message__time"]')
            .forEach(x => x.remove());
        // 1.38：克隆节点不在 DOM、没有布局，innerText 会退化成
        // textContent——段落/列表等块级换行全丢（网页端消息
        // 「挤成一坨」的根因）。挂到屏幕外容器再取：布局还原、
        // 换行保留；不能 visibility:hidden（innerText 会当不可见
        // 剔空，同 2.07 幽灵 turn 的坑）。
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:-99999px;top:0;'
            + 'width:900px;pointer-events:none;';
        box.appendChild(c);
        document.body.appendChild(box);
        let t = '';
        try { t = (box.innerText || '').trim(); } catch (e) {}
        box.remove();
        return t;
      })();
      if (!txt) return;   // 空文本（挂载瞬态/纯图片）不收，防空气泡
      const isUser = String(el.className).indexOf('user') >= 0;
      let tm = null, act = [0, 0];
      if (isUser) {
        // TRAE 只在间隔大的用户消息渲染时间（hover 条内，须
        // textContent 读，innerText 对隐藏元素返回空）
        const tEl = el.querySelector('[class*="user-message__time"]');
        if (tEl) tm = (tEl.textContent || '').trim();
        // 1.06：回退/删除按钮可用标志（两钮仅空闲对话渲染，
        // data-testid 即身份；追加在数组尾部，旧客户端读前
        // 3 位不受影响）
        if (el.querySelector('[data-testid="chat-icon-revert"]'))
          act[0] = 1;
        if (el.querySelector('[data-testid="chat-icon-delete"]'))
          act[1] = 1;
      }
      msgs.push([isUser ? 'u' : 'a', txt, tm, act[0], act[1]]);
    });
  // 左栏行（文件夹组头 + 会话，文档顺序）：
  // ① taskItem 去重——taskItemWrapper 外层与 taskItem 内层同被
  //   [class*=taskItem] 命中，跳过含内层匹配的外层（否则×2）
  // ② 折叠组条目 rect 仍全尺寸（overflow 裁剪），按
  //   task-list-group-collapsible 高度 <5 过滤幽灵行
  // ③ classList.contains 按完整 token 匹配——closest/查询用
  //   [class*=...] 子串会误中 task-list-group-header 等
  const convs = [];
  document.querySelectorAll(
      '[class*="task-list-group-title"],[class*="taskItem"]').forEach(el => {
    if (el.querySelector('[class*="taskItem"]')) return;
    const ec = String(el.className);
    if (ec.indexOf('task-list-group-title') >= 0) {
      if (el.getBoundingClientRect().width <= 20) return;
      let g = el.parentElement, grp = null;
      while (g && g !== document.body) {
        if (g.classList && g.classList.contains('task-list-group')) {
          grp = g; break;
        }
        g = g.parentElement;
      }
      let collapsed = false;
      if (grp) {
        const coll = grp.querySelector('.task-list-group-collapsible')
            || grp.querySelector('[class*="task-list-group-collapsible"]');
        if (coll) collapsed = coll.getBoundingClientRect().height < 5;
      }
      convs.push(['f', (el.textContent || '').trim().slice(0, 36),
                  collapsed]);
      return;
    }
    const r = el.getBoundingClientRect();
    if (!(r.width > 50)) return;
    let p = el.parentElement, collaps = null;
    while (p && p !== document.body) {
      if (p.classList &&
          p.classList.contains('task-list-group-collapsible')) {
        collaps = p; break;
      }
      p = p.parentElement;
    }
    if (collaps && collaps.getBoundingClientRect().height < 5) return;
    const t = el.querySelector('[class*="taskText"]') || el;
    /* 1.46：会话状态灯（taskRight > taskStatusIcon >
       .session-status-icon-*）。变体实测自 solo-lite CSS：
       progress=蓝·旋转（进行中组：Pending/Creating/Running/
       Reverting/Waiting/Stopping）；completed=空 div（Finished，
       TRAE 不渲染图标）；failed=内层图标 style 含 status-error
       （红）；stopped/frozen/unknown=内层图标 style 含
       icon-disabled（灰）。'c' 行第 4 位携带，旧客户端不受影响 */
    let st = '';
    const stIcon = el.querySelector('[class*="session-status-icon"]');
    if (stIcon) {
      const ic = String(stIcon.className);
      if (ic.indexOf('session-status-icon-progress') >= 0) st = 'run';
      else {
        const inner = stIcon.firstElementChild;
        const stl = inner ? String(
            inner.getAttribute('style') || '') : '';
        if (stl.indexOf('status-error') >= 0) st = 'fail';
        else if (inner) st = 'stop';
        else st = 'done';
      }
    }
    convs.push(['c', (t.innerText || '').trim().slice(0, 36),
                ec.indexOf('Selected') >= 0, st]);
  });
  // 2.11：完成卡（core-finish-card，TRAE 任务完成的标志物）——
  // 每个完成的任务在 agent 消息尾部渲染一张，含「完成（…）」摘要 +
  // 改动文件清单（artifact-file-item）。取最后一张「可见」的
  // （历史段的卡随 2.07 的 visibility:hidden 一起隐掉），即当前
  // 会话最近一次完成任务。
  // 2.13：inLast=完成卡是否在最后一个对话轮内。完成块的地位是
  // 一张普通对话卡片：只有它就在最后一个 turn 里才在消息区尾部
  // 显示；新对话一来（新 turn 出现）它就被自然挤走，不再常驻尾部。
  let finish = null;
  {
    const froots = [];
    document.querySelectorAll('[class*="core-finish-card"]').forEach(
      el => {
        if (el.classList && el.classList.contains('core-finish-card'))
          froots.push(el);
      });
    let lastTurn = null;
    const allTurns = document.querySelectorAll(
      '[class*="turn__user-message"],[class*="turn__agent-message"]');
    if (allTurns.length) lastTurn = allTurns[allTurns.length - 1];
    for (const c of froots) {
      if (c.checkVisibility &&
          !c.checkVisibility({checkVisibilityCSS: true})) continue;
      const files = [];
      c.querySelectorAll('[class*="artifact-file-item"]').forEach(it => {
        const nm = it.querySelector('[class*="artifact-file-name"]');
        const t = nm ? (nm.textContent || '').trim() : '';
        if (t && files.indexOf(t) < 0) files.push(t);
      });
      finish = {files: files,
                text: (c.textContent || '').trim().slice(0, 160),
                inLast: lastTurn ? lastTurn.contains(c) : false};
    }
  }
  // 2.15：输入栏附件条目（file-upload-item）——上传后 TRAE 渲染的
  // 预览条目。只收主条目（其下挂着移除按钮 item-remove），名称在
  // item-name、大小在 item-size（"TXT · 37 B"）。这些条目随发送或
  // 移除消失，用于本地 chips 行实时回显 + 上传成功校验。
  const attach = [];
  document.querySelectorAll('[class*="chat-input-v2-file-upload-item"]')
    .forEach(el => {
      if (!el.querySelector('[class*="item-remove"]')) return;
      const nm = el.querySelector('[class*="file-upload-item-name"]');
      const sz = el.querySelector('[class*="file-upload-item-size"]');
      const name = nm ? (nm.textContent || '').trim() : '';
      if (!name) return;
      attach.push({name: name,
                   size: sz ? (sz.textContent || '').trim() : ''});
    });
  return {
    online: !!send,
    /* 1.46：登录态——账号区按钮（accountTrigger，侧栏/顶栏变体
       同名）存在且渲染了昵称（accountTriggerName）=已登录。
       未登录时按钮缺失或只剩「登录」文案（昵称 span 没了）。
       acctText 带回账号区原文供异常报告（昵称/免费标签/登录…） */
    login: (() => {
      const b = document.querySelector(
          'button[class*="accountTrigger"]');
      return !!(b && b.querySelector('[class*="accountTriggerName"]'));
    })(),
    acctText: (() => {
      const b = document.querySelector(
          'button[class*="accountTrigger"]');
      return b ? (b.textContent || '').trim().slice(0, 24) : '';
    })(),
    inputOk: !!input,
    inputText: input ? (input.innerText || '').trim() : '',
    sendIdle: cls.indexOf('voice-call-mode') >= 0,
    tail: tail ? (tail.innerText || '').trim() : null,
    model: modelEl ? (modelEl.textContent || '').trim() : '',
    msgs: msgs,
    convs: convs,
    finish: finish,
    attach: attach,
    opts: opts,
    pend: pend,
    ask: ask};
})()
"""
# 注入选项收集核心（__OPTS_CORE__ 占位 → _OPTS_CORE_JS 函数体；
# 保持 _SNAP_JS 单一 eval 语义，函数与调用同处一个 IIFE）
_SNAP_JS = _SNAP_JS.replace('  const __OPTS_CORE__\n',
                            _OPTS_CORE_JS.rstrip('\n') + '\n')

# 点击输入框（聚焦）
_INPUT_CLICK_JS = r"""
(() => {
  const el = document.querySelector(
    '[class*="chat-input-v2-input-box-editable"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 15)};
})()
"""

# 点击发送键（生成中时它是停止键，同一个元素）。
# 1.41 语音防护：TRAE 输入框没有文字时该键会变成「语音输入」按钮
# （voice-call-mode），点了会进入语音模式死循环——点击前必须探测，
# 是语音键就拒点（返回 voice:true），调用方自行处置。
_SEND_CLICK_JS = r"""
(() => {
  const el = document.querySelector('[class*="chat-input-v2-send-button"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cls = String(el.className || '');
  const lab = ((el.getAttribute && el.getAttribute('aria-label')) || '')
              + ' ' + String(el.innerText || '').replace(/\s+/g,' ').trim();
  const voice = cls.indexOf('voice-call-mode') >= 0
                || /voice|语音|mic|麦克风/i.test(lab);
  return {x: r.x + r.width / 2, y: r.y + r.height / 2, voice: voice};
})()
"""

# 2.15：点击第 idx 个附件条目的移除按钮（与快照 attach 同序——
# 都是 DOM 顺序的 file-upload-item 主条目）。JS .click() 触发
# React 合成事件（比 CDP 坐标点击稳，按钮小不易偏）
def _attach_rm_js(idx):
    return r"""
(() => {
  const btns = document.querySelectorAll(
    '[class*="chat-input-v2-file-upload-item-remove"]');
  const b = btns[%d];
  if (!b) return false;
  b.click();
  return true;
})()
""" % idx

# 点击指定序号的会话行（与快照同序：去重+非折叠的 taskItem
# 依次计数，跳过外层 taskItemWrapper 和折叠组幽灵行）
def _conv_click_js(idx):
    return r"""
(() => {
  const items = [];
  document.querySelectorAll('[class*="taskItem"]').forEach(el => {
    if (el.querySelector('[class*="taskItem"]')) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 50)) return;
    let p = el.parentElement, collaps = null;
    while (p && p !== document.body) {
      if (p.classList &&
          p.classList.contains('task-list-group-collapsible')) {
        collaps = p; break;
      }
      p = p.parentElement;
    }
    if (collaps && collaps.getBoundingClientRect().height < 5) return;
    items.push(el);
  });
  const el = items[%d];
  if (!el) return null;
  /* 1.48：滚到视口中央再点——侧栏底部是账号栏（头像按钮宽约
     232px），列表末行中心点会落在账号栏底下，坐标点击误触头像
     （实测 2026-09-14：切最后一行点到头像、「点了没反应」同源：
     小窗时更多行整行滚出视口，点击直接落空）。先 scrollIntoView
     居中，再 elementFromPoint 验证落点在行内，被遮挡（弹层/
     账号栏）就返回 null 放弃，绝不瞎点 */
  el.scrollIntoView({block: 'center'});
  const r = el.getBoundingClientRect();
  if (r.width <= 50) return null;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  if (cy < 0 || cy > window.innerHeight) return null;
  const hitEl = document.elementFromPoint(cx, cy);
  if (!hitEl || !el.contains(hitEl)) return null;
  return {x: cx, y: cy};
})()
""" % idx

# v1.12：按标题点击会话行。_cmd_switch 先把会话序号解析成快照里的
# 会话标题，再按标题定位点击——比纯索引点击抗列表变动（会话重排/
# 新增后索引点击易落偏）。标题同 _SNAP_JS 口径
#（[class*="taskText"] innerText 前 36 字）。标题没命中时回退
# _conv_click_js(idx)（会话序号口径）。
def _conv_click_title_js(title):
    return r"""
(() => {
  const want = %s;
  const rows = [];
  document.querySelectorAll('[class*="taskItem"]').forEach(el => {
    if (el.querySelector('[class*="taskItem"]')) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 50)) return;
    let p = el.parentElement, collaps = null;
    while (p && p !== document.body) {
      if (p.classList &&
          p.classList.contains('task-list-group-collapsible')) {
        collaps = p; break;
      }
      p = p.parentElement;
    }
    if (collaps && collaps.getBoundingClientRect().height < 5) return;
    rows.push(el);
  });
  let hit = null;
  for (const el of rows) {
    const t = el.querySelector('[class*="taskText"]') || el;
    const txt = (t.innerText || '').trim();
    if (txt.slice(0, 36) === want || txt.indexOf(want) === 0) {
      hit = el; break;
    }
  }
  if (!hit) return null;
  /* 1.48：同 _conv_click_js——先滚到视口中央，再验证落点
     未被遮挡，被挡（弹层/账号栏）返回 null 放弃 */
  hit.scrollIntoView({block: 'center'});
  const r = hit.getBoundingClientRect();
  if (r.width <= 50) return null;
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  if (cy < 0 || cy > window.innerHeight) return null;
  const hitEl = document.elementFromPoint(cx, cy);
  if (!hitEl || !hit.contains(hitEl)) return null;
  return {x: cx, y: cy};
})()
""" % json.dumps(title)

# 点击新建任务
_NEW_TASK_JS = r"""
(() => {
  const el = document.querySelector('[class*="task-list-new-task"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
"""

# 1.40：AI 提问卡操作（结构见 _OPTS_CORE_JS 里 __findAsk 注释）。
# 点第 idx 个选项（div.optionItem-*，用输入级坐标点击触发 React 事件）
def _ask_pick_js(idx):
    return r"""
(() => {
  const els = [...document.querySelectorAll('[class*="optionItem-"]')];
  const el = els[%d];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
""" % idx

# 「其他」项的 textarea 定位（先点选项行展开/聚焦，再点文本域拿焦点）
_ASK_OTHER_TXT_JS = r"""
(() => {
  const el = document.querySelector(
    '[class*="optionItemOther"] textarea, [class*="optionItemOther"] input');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + Math.min(r.width / 2, 200), y: r.y + r.height / 2};
})()
"""

# 1.41：纯文本问的 textarea 定位（提问卡无选项，只有大输入框；
# 从 footerBtnFixed 向上找含 textarea 的容器）
_ASK_TXT2_JS = r"""
(() => {
  let fb = null;
  document.querySelectorAll('[class*="footerBtnFixed"]').forEach(b => {
    if (fb) return;
    const r = b.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) fb = b;
  });
  if (!fb) return null;
  let anc = fb.parentElement, ta = null;
  for (let i = 0; i < 8 && anc && anc !== document.body; i++) {
    ta = anc.querySelector('textarea, input[type="text"]');
    if (ta) break;
    anc = anc.parentElement;
  }
  if (!ta) return null;
  const r = ta.getBoundingClientRect();
  return {x: r.x + Math.min(r.width / 2, 200), y: r.y + r.height / 2};
})()
"""

# 底部主按钮（下一步/确认/完成）、取消按钮、上一步按钮。
# ⚠ v1.40 格式串两个 %s 只传一个参数 → ask_submit/ask_other/ask_cancel
# 一调就 TypeError（用户实测「只填自己意见走不通」的根因），v1.41 修复。
# ⚠ v1.41 实测 footer 可能同时有多个 secondary（取消ESC/上一步）——
# 按文案匹配「取消」，别按类名拿最后一个（会误点上一步）。
# v1.43：参数从布尔改为模式串（'primary'/'cancel'/'prev'），新增
# ask_prev 回退上一问（用户要求：手机端要能回到上一题）。
def _ask_footer_js(which):
    cond = {
        'primary': "/primary/i.test(String(b.className))",
        'cancel':  "/^取消/.test(t)",
        'prev':    "/上一步|Previous/i.test(t)",
    }[which]
    return r"""
(() => {
  let hit = null;
  document.querySelectorAll('[class*="footerBtnFixed"]').forEach(b => {
    const r0 = b.getBoundingClientRect();
    if (!(r0.width > 0 && r0.height > 0)) return;
    const t = (b.innerText || '').replace(/\s+/g, ' ').trim();
    if (%s) hit = b;
  });
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
""" % cond

# 1.39：会话重命名——上下文菜单里的「重命名」项（右键会话行后
# 出现；中英文都认，限小尺寸防命中页面正文里恰好含该词的大块）
_RENAME_MENU_JS = r"""
(() => {
  const flat = s => (s || '').replace(/\s+/g, ' ').trim();
  let hit = null;
  document.querySelectorAll(
      '[role="menuitem"],li,div,span,button').forEach(el => {
    if (hit) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 10 && r.width < 420 &&
          r.height > 8 && r.height < 64)) return;
    const t = flat(el.innerText);
    if (t === '重命名' || /^rename$/i.test(t)) hit = el;
  });
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
"""

# 1.45：会话右键菜单项点击（置顶/删除）。实测 2026-09-14：
#   未置顶文案「置顶任务」、已置顶「取消置顶」（不对称）；
#   「删除任务」点击后弹确认框（取消/删除两按钮）。
#   ⚠ 菜单重渲染快，坐标点击偶发失效——统一 JS el.click() 直点。
def _conv_menu_click_js(texts):
    arr = json.dumps(list(texts), ensure_ascii=False)
    return r"""
(() => {
  const want = %s;
  const flat = s => (s || '').replace(/\s+/g, ' ').trim();
  let hit = null;
  document.querySelectorAll(
      '[role="menuitem"],li,div,span,button').forEach(el => {
    if (hit) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 10 && r.width < 420 &&
          r.height > 8 && r.height < 64)) return;
    const t = flat(el.innerText);
    if (want.indexOf(t) >= 0) hit = el;
  });
  if (!hit) return null;
  hit.click();
  return true;
})()""" % arr

# 1.45：删除确认框的「删除」按钮（点击「删除任务」菜单项后弹出；
# 按钮文案就是「删除」，与菜单项同文案但尺寸/上下文不同——此处
# 专找弹窗按钮尺寸段，且此时上下文菜单已关闭不会误中）
_DEL_CONFIRM_JS = r"""
(() => {
  const flat = s => (s || '').replace(/\s+/g, ' ').trim();
  let hit = null;
  document.querySelectorAll('button,div[role=button],[class*="btn"],'
      + '[class*="button"]').forEach(el => {
    if (hit) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 20 && r.height > 10 && r.height < 70)) return;
    if (flat(el.innerText) === '删除') hit = el;
  });
  if (!hit) return null;
  hit.click();
  return true;
})()"""

# 1.39：重命名内联编辑框写入新名（右键菜单点「重命名」后出现；
# 优先取当前聚焦元素，兜底找 taskItem/taskText 区域内的输入框）
_RENAME_APPLY_JS = r"""
(() => {
  const name = %s;
  let ed = null;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' ||
             ae.isContentEditable)) ed = ae;
  if (!ed){
    document.querySelectorAll(
        '[class*="taskItem"] input,[class*="taskText"] input,' +
        'input[type="text"]').forEach(c => {
      if (ed) return;
      const r = c.getBoundingClientRect();
      if (r.width > 30 && r.height > 8) ed = c;
    });
  }
  if (!ed) return false;
  ed.focus();
  if (ed.tagName === 'INPUT' || ed.tagName === 'TEXTAREA'){
    if (ed.select) ed.select();
    document.execCommand('insertText', false, name);
    if (ed.value !== name){
      ed.value = name;
      ed.dispatchEvent(new Event('input', {bubbles: true}));
    }
  } else {
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, name);
  }
  return true;
})()
"""

# 点击文件夹组头（折叠/展开）。按组名精确定位组；点标题区
# （x+50）避开右侧「组内新建」按钮（血泪经验 1：点安全位置）
def _folder_toggle_js(title):
    return r"""
(() => {
  const name = %s;
  let hit = null;
  document.querySelectorAll('[class*="task-list-group"]').forEach(g => {
    if (hit) return;
    const n = g.querySelector('[class*="task-list-group-name"]');
    if (n && (n.textContent || '').trim() === name) hit = g;
  });
  if (!hit) return null;
  const h = hit.querySelector('[class*="task-list-group-header"]') || hit;
  const r = h.getBoundingClientRect();
  if (r.width < 10) return null;
  return {x: Math.min(r.x + 50, r.x + r.width - 12),
          y: r.y + r.height / 2};
})()
""" % json.dumps(title, ensure_ascii=False)

# 1.06：文件夹组头右侧「组内新建」按钮（task-list-group-new-btn，
# aria-label='New task'）。按组名定位组（同 _folder_toggle_js），
# 新对话直接隶属该文件夹工作区（TRAE 原生行为）
def _folder_new_js(title):
    return r"""
(() => {
  const name = %s;
  let hit = null;
  document.querySelectorAll('[class*="task-list-group"]').forEach(g => {
    if (hit) return;
    const n = g.querySelector('[class*="task-list-group-name"]');
    if (n && (n.textContent || '').trim() === name) hit = g;
  });
  if (!hit) return null;
  let b = hit.querySelector('[class*="task-list-group-new"]');
  if (!b) b = hit.querySelector('[aria-label="New task"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return null;
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
""" % json.dumps(title, ensure_ascii=False)

# ---- 1.06：消息回退/删除 + AI 选项点选 ----

# 点击第 mi 条可见用户消息上的 回退(revert)/删除(delete) 按钮
# （两钮仅空闲对话渲染）。JS .click() 触发 React 合成事件（同
# _attach_rm_js 经验：小按钮比坐标点击稳，不会偏移）。
# 返回 'ok' / 'nomsg'（消息不存在）/ 'nobtn'（按钮未渲染）
def _msg_act_js(mi, kind):
    return r"""
(() => {
  const us = [];
  document.querySelectorAll('[class*="turn__user-message"]').forEach(el => {
    if (el.checkVisibility) {
      if (!el.checkVisibility({checkVisibilityCSS: true})) return;
    }
    us.push(el);
  });
  const u = us[%d];
  if (!u) return 'nomsg';
  const b = u.querySelector('[data-testid="chat-icon-%s"]');
  if (!b) return 'nobtn';
  b.click();
  return 'ok';
})()
""" % (mi, kind)

# 回退/删除点击后的确认弹窗里点动作钮。
# 2026-09-10 分身实测：删除弹窗的动作钮文本是「删除」（回退弹窗
# 同理是「回退」）——按钮文案=动作名，不能只认「确认」。
# 修正策略：找可见弹层容器（dialog/modal/popover/confirm/portal，
# 特征=内含「取消」钮+至少一个其他短文本钮，宽度 80~900），容器内
# 优先点「确认/确定」，否则点最后一个非「取消」钮（主操作通常在
# 最右）；无弹层时回落点最后一个可见「确认」（原行为，防误点）
_CONFIRM_OK_JS = r"""
(() => {
  const flat = s => (s||'').replace(/\s+/g,' ').trim();
  const dlgs = [];
  document.querySelectorAll(
      '[class*="dialog"],[class*="modal"],[class*="popover"],'
      + '[class*="confirm"],[class*="portal"]')
    .forEach(el => {
      const cn = String(el.className || '');
      if (!/dialog|modal|popover|confirm|portal/i.test(cn)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.width > 900 || r.height < 30) return;
      if (el.checkVisibility &&
          !el.checkVisibility({checkVisibilityCSS: true})) return;
      // 特征校验：内含「取消」+ 至少一个其他文本钮（防整页 portal
      // 误中——它包着全应用按钮）
      let hasCancel = false, other = 0;
      el.querySelectorAll('button,[role="button"]').forEach(b => {
        const t = flat(b.innerText);
        if (!t) return;
        if (t === '取消') hasCancel = true; else other++;
      });
      if (hasCancel && other) dlgs.push(el);
    });
  if (dlgs.length) {
    const dlg = dlgs[dlgs.length - 1];        // DOM 最后=最上层
    const btns = [];
    dlg.querySelectorAll('button,[role="button"]').forEach(b => {
      const t = flat(b.innerText);
      if (!t || t === '取消') return;
      if (!(b.getBoundingClientRect().width > 0)) return;
      btns.push({b: b, t: t});
    });
    const ok = btns.find(x => x.t === '确认' || x.t === '确定')
           || btns[btns.length - 1];
    if (ok) { ok.b.click(); return true; }
    return false;                    // 只有取消（异常态）→ 不点
  }
  const cands = [];
  document.querySelectorAll('button,[role="button"]').forEach(b => {
    if (flat(b.innerText) !== '确认') return;
    if (!(b.getBoundingClientRect().width > 0)) return;
    cands.push(b);
  });
  if (!cands.length) return false;
  cands[cands.length - 1].click();
  return true;
})()
"""

# 点击第 oi 个 AI 提问选项（与快照 opts 同一收集规则/__findOpts，
# 见 _OPTS_CORE_JS 注释）
def _opt_click_js(oi):
    return ('(() => {%s\n  const a = __findOpts();\n'
            '  const o = a[%d];\n  if (!o) return false;\n'
            '  o.b.click();\n  return true;\n})()'
            % (_OPTS_CORE_JS.rstrip('\n'), oi))

# 输入栏工作目录按钮（新建任务后才渲染；现有会话不显示）。
# 排除「本地」模式钮（同为 inputBarButton）；幽灵层只认宽度>60
# 的第一个。返回 {t:当前目录名, x, y}（读文本用于生效校验）
_DIRBTN_JS = r"""
(() => {
  let hit = null;
  document.querySelectorAll('[class*="inputBarButton"]').forEach(b => {
    if (hit) return;
    const t = (b.innerText || '').trim();
    const r = b.getBoundingClientRect();
    if (!t || t === '本地' || !(r.width > 60)) return;
    hit = {t: t, x: r.x + r.width / 2, y: r.y + r.height / 2};
  });
  return hit;
})()
"""

# 级联目录选择器——当前全部可见条目（标题 t + 绝对路径 sub + 坐标）。
# 只收条目本体（cascadeMenuItem-xxx），排除 Title/Subtitle/Icon/
# Content/Inner/RightSlot 等子元素类前缀
_CASCADE_ITEMS_JS = r"""
(() => {
  const KIDS = ['cascadeMenuItemTitle', 'cascadeMenuItemSubtitle',
                'cascadeMenuItemIcon', 'cascadeMenuItemContent',
                'cascadeMenuItemInner', 'cascadeMenuItemRightSlot'];
  const out = [];
  document.querySelectorAll('[class*="cascadeMenuItem"]').forEach(el => {
    let isItem = false;
    for (const c of String(el.className).split(/\s+/)) {
      if (c.indexOf('cascadeMenuItem') !== 0) continue;
      if (KIDS.some(k => c.indexOf(k) === 0)) { isItem = false; break; }
      isItem = true;
    }
    if (!isItem) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const tEl = el.querySelector('[class*="cascadeMenuItemTitle"]');
    const sEl = el.querySelector('[class*="cascadeMenuItemSubtitle"]');
    out.push({t: tEl ? (tEl.textContent || '').trim() : '',
              sub: sEl ? (sEl.textContent || '').trim() : '',
              x: r.x + r.width / 2, y: r.y + r.height / 2});
  });
  return out;
})()
"""

# 点头像本体（开/关账号菜单；绝不点容器中心——见误触教训）
_AVATAR_JS = r"""
(() => {
  const el = document.querySelector('[class*="accountTriggerAvatar"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
"""

# ---- 模型切换（2.07）----
# 菜单项两套：Auto Mode 项 / 普通模型项；名称在 *-name、积分倍率在
# *-trail（如 0.77x）、受限项带 access-restricted 类。trigger 在输入
# 框右下（core-model-select-trigger，当前值 *-trigger-value）。
# ⚠ 弹层是 body 下 portal（core-model-select-portal-content），列表
# 可能比视口长（DOM 全量挂载、裁剪显示）→ 点项前 scrollIntoView。
_MODEL_TRIGGER_JS = r"""
(() => {
  const el = document.querySelector('[class*="core-model-select-trigger"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 5) return null;
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
"""

# 菜单开着时读全部模型项（名称/倍率/受限/选中态）
# ⚠ 用 classList 精确 token 匹配收本体：项内部有 -wrapper/-name 等
# 前缀近名子元素，[class*=] 子串会误中；「跳过含内层匹配的外层」
# 去重规则在这里会把所有项杀光（taskItem 场景内外层同名才适用）
_MODEL_LIST_JS = r"""
(() => {
  const out = [];
  document.querySelectorAll(
      '[class*="core-model-select-auto-mode-item"],' +
      '[class*="core-model-select-model-item"]').forEach(el => {
    if (!el.classList.contains('core-model-select-model-item')
        && !el.classList.contains('core-model-select-auto-mode-item'))
      return;
    const nameEl = el.querySelector('[class*="-name"]');
    if (!nameEl) return;
    const trailEl = el.querySelector('[class*="-trail"]');
    const cls = String(el.className);
    out.push({
      name: (nameEl.textContent || '').trim(),
      trail: trailEl ? (trailEl.textContent || '').trim() : '',
      restricted: cls.indexOf('restricted') >= 0,
      selected: /selected|active|checked/.test(cls)});
  });
  return out;
})()
"""

# 模型菜单是否开着（portal 有尺寸且可见；关闭时可能残留隐藏节点）
_MODEL_MENU_OPEN_JS = r"""
(() => {
  const el = document.querySelector(
      '[class*="core-model-select-portal-content"]');
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 50 && r.height > 50;
})()
"""

# 菜单开着时按名称点模型项（scrollIntoView 后取中心；精确 token 匹配）
# 1.33：救活也走这条路（按名称点=用户人工验证有效；v1.31/1.32 的
# 按选中态找项在深度冻结下找不到已整体移除）
def _model_click_js(name):
    return r"""
(() => {
  const name = %s;
  let hit = null;
  document.querySelectorAll(
      '[class*="core-model-select-auto-mode-item"],' +
      '[class*="core-model-select-model-item"]').forEach(el => {
    if (hit) return;
    if (!el.classList.contains('core-model-select-model-item')
        && !el.classList.contains('core-model-select-auto-mode-item'))
      return;
    const nameEl = el.querySelector('[class*="-name"]');
    if (nameEl && (nameEl.textContent || '').trim() === name) hit = el;
  });
  if (!hit) return null;
  hit.scrollIntoView({block: 'nearest'});
  const r = hit.getBoundingClientRect();
  if (r.width < 5) return null;
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()
""" % json.dumps(name, ensure_ascii=False)

_MENU_OPEN_JS = ("!!(document.querySelector('[class*=\"accountPopover\"]')"
                 "||document.querySelector('[class*=\"accountCard\"]'))")

_POINTS_JS = r"""
(() => {
  const card = document.querySelector('[class*="accountCard"]');
  if (!card) return null;
  /* v1.42：精准定位。实测（2026-09-14 截图）——旧逻辑抓「第一个纯数字
     叶子」抓到的是账号昵称（昵称恰好是数字"19"），真积分在带⚡图标的
     button.accountUsage-* 里，昵称在 span.accountIdentityName-* 里。 */
  let points = null;
  const usage = card.querySelector('button[class*="accountUsage"]');
  if (usage){
    usage.querySelectorAll('span,div').forEach(el => {
      if (points !== null) return;
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (/^[\d,]+$/.test(t)) points = t;
    });
    if (points === null){
      const t = (usage.textContent || '').trim();
      if (/^[\d,]+$/.test(t)) points = t;
    }
  }
  let name = null;
  /* 注意：accountIdentityNameRow 也含 "accountIdentityName" 子串，
     必须限定 span，否则整行「19免费」都会被抓进来 */
  const idEl = card.querySelector('span[class*="accountIdentityName"]');
  if (idEl) name = (idEl.textContent || '').trim() || null;
  /* 兜底（类名改版时）：旧启发式，但跳过昵称行——纯数字叶子若紧跟
     「免费」标签视为昵称，不当积分 */
  if (points === null || name === null){
    const BAD = /^(免费|升级|会员|积分|兑换|设置|退出|退出登录|管理|充值)$/;
    card.querySelectorAll('span,div').forEach(el => {
      if (points !== null && name !== null) return;
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (!t) return;
      if (/^[\d,]+$/.test(t)){
        if (points === null){
          const row = el.closest('[class*="Identity"],[class*="identity"]');
          if (!row) points = t;          // 昵称行内的数字不当积分
        }
        return;
      }
      if (name === null && !BAD.test(t) && t.length >= 2 && t.length <= 60
          && !/^(x|×)\s*\d/i.test(t))
        name = t;
    });
  }
  return {points: points, name: name};
})()
"""

# ---- 消息区滚动容器探测/操作（完整导出用）----
# 滚动壳是 virtualized-message-list-view__scroller
# （content 只是视口窗口，自身不 overflow，向祖先找不到滚动者）

_SCROLLER_JS = r"""
(() => {
  const el = document.querySelector(
      '[class*="virtualized-message-list-view__scroller"]');
  if (!el) return {ok:false};
  if (el.scrollHeight <= el.clientHeight + 5) return {ok:false};
  return {ok:true, ch: el.clientHeight};
})()
"""

_SCROLL_SET_JS = r"""
(() => {
  const el = document.querySelector(
      '[class*="virtualized-message-list-view__scroller"]');
  if (!el) return 0;
  el.scrollTop = %d;
  return 1;
})()
"""

_SCROLL_BY_JS = r"""
(() => {
  const el = document.querySelector(
      '[class*="virtualized-message-list-view__scroller"]');
  if (!el) return null;
  el.scrollTop += el.clientHeight * 0.8;
  return el.scrollTop;
})()
"""


# ================= Markdown 简易渲染 =================

_INLINE_RE = re.compile(r'(`[^`\n]+`)|(\*\*[^*\n]+\*\*)')


def _inline_segs(ln):
    """一行 → [(文本, tag)]（行内 `代码` / **加粗**）"""
    out = []
    pos = 0
    for m in _INLINE_RE.finditer(ln):
        if m.start() > pos:
            out.append((ln[pos:m.start()], 'txt'))
        s = m.group(0)
        if s[0] == '`':
            out.append((s[1:-1], 'icode'))
        else:
            out.append((s[2:-2], 'bold'))
        pos = m.end()
    if pos < len(ln) or not out:
        out.append((ln[pos:], 'txt'))
    return out


def _esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def _inline_html(s):
    """已转义上下文外用：行内 markdown → HTML 片段"""
    out = []
    pos = 0
    for m in _INLINE_RE.finditer(s):
        if m.start() > pos:
            out.append(_esc(s[pos:m.start()]))
        t = m.group(0)
        if t[0] == '`':
            out.append('<code>%s</code>' % _esc(t[1:-1]))
        else:
            out.append('<strong>%s</strong>' % _esc(t[2:-2]))
        pos = m.end()
    out.append(_esc(s[pos:]))
    return ''.join(out) or '&nbsp;'


def _md_html(text):
    """AI 消息 markdown → HTML（代码块/行内码/加粗/标题/列表）"""
    out = []
    in_code = False
    for ln in text.split('\n'):
        if ln.lstrip().startswith('```'):
            out.append('</code></pre>' if in_code
                       else '<pre class="code"><code>')
            in_code = not in_code
        elif in_code:
            out.append(_esc(ln) if ln.strip() else '')
        elif not ln.strip():
            out.append('<br>')
        else:
            m = re.match(r'^#{1,6}\s+(.*)$', ln)
            if m:
                out.append('<h4>%s</h4>' % _esc(m.group(1)))
            elif re.match(r'^\s*[-*+]\s+', ln):
                out.append('<p class="li">%s</p>'
                           % _inline_html(
                               re.sub(r'^\s*[-*+]\s+', '', ln)))
            elif re.match(r'^\s*\d+[.)]\s+', ln):
                out.append('<p class="li">%s</p>'
                           % _inline_html(
                               re.sub(r'^\s*\d+[.)]\s+', '', ln)))
            else:
                out.append('<p>%s</p>' % _inline_html(ln))
    if in_code:
        out.append('</code></pre>')
    return '\n'.join(out)


def _merge_msgs(acc, cur):
    """滚动收集窗口合并：acc 尾部与 cur 头部最长重叠只留一份"""
    if not acc:
        return list(cur)
    for k in range(min(len(acc), len(cur)), 0, -1):
        if acc[-k:] == cur[:k]:
            return acc + cur[k:]
    return acc + list(cur)


_HTML_CSS = """
body{background:#1E1E1E;color:#D4D4D4;font-family:'Microsoft YaHei',
sans-serif;max-width:860px;margin:0 auto;padding:24px 24px 60px}
h1{font-size:17px;color:#4EC9B0;margin:0 0 8px}
.meta{color:#909090;font-size:12px;border-bottom:1px solid #333;
padding-bottom:10px;margin-bottom:20px}
.msg{margin:16px 0}
.who{font-weight:bold;font-size:13px;margin-bottom:4px}
.msg.user .who{color:#569CD6}
.msg.agent .who{color:#4EC9B0}
.body{line-height:1.6}
p{margin:4px 0;white-space:pre-wrap}
p.li{margin:2px 0 2px 18px}
h4{margin:12px 0 4px;color:#4FC1FF;font-size:14px}
pre.code{background:#252526;color:#CE9178;padding:10px 12px;
border-radius:5px;font-family:Consolas,monospace;font-size:13px;
white-space:pre-wrap;margin:8px 0}
code{background:#3A3A3A;color:#CE9178;border-radius:3px;padding:0 4px;
font-family:Consolas,monospace;font-size:13px}
strong{color:#E8E8E8}
"""


# ================= 后台轮询线程 =================

class _Poller(threading.Thread):
    """独占 CDP 连接的轮询线程：快照轮询 + 执行 UI 命令。
    retarget 命令可切换端口（多分身切换），切换后旧连接即时关闭。"""

    TICK = 0.8          # 常规轮询间隔（秒）
    TICK_DEAD = 5.0     # 掉线重连间隔

    def __init__(self, port, uiq):
        threading.Thread.__init__(self, daemon=True)
        self.port = port
        self.uiq = uiq
        self.cmdq = queue.Queue()
        self.stop_ev = threading.Event()
        self.cdp = None
        # 1.34：救活相关状态（_off_n/_revive_*）随自动交互整体移除——
        # 快照纯镜像上报，不再往 TRAE 注入任何点击

    def run(self):
        while not self.stop_ev.is_set():
            self._drain_cmds()
            if self.cdp is None:
                self._try_connect()
                self.stop_ev.wait(self.TICK_DEAD if self.cdp is None
                                  else 0.2)
                continue
            try:
                # 1.16：可见性看护——TRAE 最小化/藏进托盘时 Electron
                # 渲染冻结（exp6：切会话迟滞 2.6~3.1s，极端一直 0 消
                # 息），而窗口可见（被遮挡无妨）就流畅。每拍快照前
                # 检查，不可见即无焦点弹回（SW_SHOWNOACTIVATE 不抢
                # 焦点，弹回被遮挡=等效「可见+被遮挡」最优状态）。
                if _ensure_cfg().get('keep_visible', True) \
                        and _trae_minimized():
                    if _trae_restore_noactivate():
                        time.sleep(0.6)   # 等 Electron 恢复渲染再采样
                snap = self.cdp.eval(_SNAP_JS)
                snap['_port'] = self.port
                # 1.34：救活自动交互整体移除（用户定性「能不能不要跳了，
                # TRAE 什么状态就显示什么状态」）。1.28~1.33 的开菜单/
                # 点模型/点输入框自动救活对深度冻结全部无效（每轮空转
                # 还搅得界面乱跳、占掉补拍时机），只保留纯镜像上报：
                # 冻结时快照如实为空 → 网页端如实显示（模型未知/未
                # 就绪），恢复靠用户在电脑上随手一碰 TRAE（人工验证
                # 一直有效）。keep_visible 窗口看护（上方）保留——
                # 只恢复窗口可见性，不往界面里注入点击。
                self.uiq.put(('snap', snap))
                # 1.46：登录态看护——界面在线但快照报未登录（账号区
                # 没有 accountTrigger 昵称）→ 冷却主动报警（cmderr+
                # 钉钉97）。手机端同时可从快照 login 字段渲染红条
                if snap.get('online') and snap.get('login') is False:
                    self._login_lost_alert('快照检测')
                # 1.19：轮询间隔可调（设置页「采集与响应」，每拍重读
                # 即时生效；异常值回落默认 0.8）
                try:
                    tick = max(0.2, float(_ensure_cfg().get(
                        'poll_sec', self.TICK)))
                except Exception:
                    tick = self.TICK
                self.stop_ev.wait(tick)
            except Exception as e:
                self._drop()
                self.uiq.put(('dead', str(e)[:60]))

    def _drop(self):
        c, self.cdp = self.cdp, None
        if c is not None:
            try:
                c.ws.s.close()
            except Exception:
                pass

    DONE_KEEP = 600.0        # 1.46：「已完成」绿灯保留时长（秒）

    def _st_track(self, snap):
        """1.46：会话状态灯记忆。TRAE 侧栏只在「进行中/失败/停止」
        时渲染状态图标，任务跑完（Finished）不渲染任何图标——列表
        里看不出「刚聊完」。这里按拍跟踪每行状态：从 run 变回空
        → 记 done，10 分钟内手机端该行左侧亮绿灯，超时淡出。"""
        now = time.time()
        mem = getattr(self, '_st_mem', None)
        if mem is None:
            mem = self._st_mem = {}
        for r in (snap.get('convs') or []):
            if not (r and r[0] == 'c' and len(r) > 3):
                continue
            title, st = r[1], r[3]
            if st:                       # 有图标：以实时图标为准
                mem[title] = [st, now]
            elif mem.get(title, [None])[0] == 'run':
                mem[title] = ['done', now]   # 刚跑完 → 绿灯
        for k in [k for k, v in mem.items()
                  if v[0] == 'done' and now - v[1] > self.DONE_KEEP]:
            del mem[k]
        for r in (snap.get('convs') or []):
            if r and r[0] == 'c' and len(r) > 3 and not r[3]:
                m = mem.get(r[1])
                if m and m[0] == 'done':
                    r[3] = 'done'

    def _try_connect(self):
        try:
            self.cdp = CDP(self.port)
            snap = self.cdp.eval(_SNAP_JS)
            snap['_port'] = self.port
            self.uiq.put(('connected', self.port))
            self.uiq.put(('snap', snap))
        except Exception:
            self._drop()
            # 初次连接失败也上报：让界面显示未连接 + 启动按钮亮起
            self.uiq.put(('dead', '端口未监听'))

    def _drain_cmds(self):
        while True:
            try:
                cmd, arg = self.cmdq.get_nowait()
            except queue.Empty:
                return
            try:
                self._exec(cmd, arg)
            except Exception as e:
                self.uiq.put(('cmderr', '%s: %s' % (cmd, str(e)[:60])))

    def _exec(self, cmd, arg):
        if cmd == 'retarget':
            self._drop()
            self.port = arg
            return
        if self.cdp is None:
            raise RuntimeError('TRAE 未连接')
        if cmd == 'send':
            self._cmd_send(arg)
        elif cmd == 'interject':    # 1.05：插话（生成中排队发送）
            self._cmd_interject(arg)
        elif cmd == 'attach':          # 2.15：上传附件（arg=路径列表）
            self._cmd_attach(arg)
        elif cmd == 'attach_rm':       # 2.15：移除第 arg 个附件
            self._cmd_attach_rm(arg)
        elif cmd == 'switch':
            self._cmd_switch(arg)
        elif cmd == 'conv_rename':     # 1.39：重命名会话 [标题, 新名]
            self._cmd_conv_rename(arg)
        elif cmd == 'conv_pin':        # 1.45：置顶/取消置顶会话
            self._cmd_conv_pin(arg)
        elif cmd == 'conv_del':        # 1.45：删除会话（含确认框）
            self._cmd_conv_del(arg)
        elif cmd == 'toggle_folder':
            self._cmd_toggle_folder(arg)
        elif cmd == 'new_task':
            self._cmd_new_task()
        elif cmd == 'rewind':          # 1.06：回退到第 N 条用户消息之前
            self._cmd_msg_act(arg, 'revert')
        elif cmd == 'del_msg':         # 1.06：删除第 N 条用户消息
            self._cmd_msg_act(arg, 'delete')
        elif cmd == 'pick_opt':        # 1.06：点选 AI 提问选项

            self._cmd_pick_opt(arg)
        elif cmd == 'new_task_dir':    # 1.06：新建任务+级联选工作目录
            self._cmd_new_task_dir(arg)
        elif cmd == 'new_task_in':     # 1.06：文件夹组内新建对话
            self._cmd_new_task_in(arg)
        elif cmd == 'new_task_dlg':    # 1.10：新建任务弹窗（抓记忆目录）
            self._cmd_new_task_dlg()
        elif cmd == 'task_dir_set':    # 1.10：弹窗「创建」——草稿已开仅设目录
            self._cmd_task_dir_set(arg)
        elif cmd == 'task_dlg_cancel':  # 1.10：弹窗「取消」——Esc 关输入区
            self._cmd_task_dlg_cancel()
        elif cmd == 'points':
            self._cmd_points()
        elif cmd == 'ask_pick':        # 1.40：提问卡点选第 arg 个选项
            self._cmd_ask_pick(arg)
        elif cmd == 'ask_other':       # 1.40：提问卡「其他」填文本提交
            self._cmd_ask_other(arg)
        elif cmd == 'ask_submit':      # 1.40：提问卡主按钮（下一步）
            self._cmd_ask_submit()
        elif cmd == 'ask_cancel':      # 1.40：提问卡取消
            self._cmd_ask_cancel()
        elif cmd == 'ask_prev':        # 1.43：提问卡「上一步」回退上一问
            self._cmd_ask_prev()
        elif cmd == 'pend_del':        # 1.44：删排队条第 arg 条
            self._cmd_pend_del(arg)
        elif cmd == 'pend_sendnow':    # 1.44：排队条第 arg 条立即发送
            self._cmd_pend_sendnow(arg)
        elif cmd == 'pend_edit':       # 1.44：排队条第 arg 条取出编辑
            self._cmd_pend_edit(arg)
        elif cmd == 'stop_gen':
            r = self.cdp.click_send_safe()
            if r == 'voice':
                # 1.41：发送键此刻是语音输入按钮（实为空闲态）——
                # 绝不点击（点了进语音模式死循环），广播提示即可
                self.uiq.put(('notice', '已空闲，无需停止'
                              '（发送键是语音按钮，已拒点）'))
        elif cmd == 'model_list':
            self._cmd_model_list()
        elif cmd == 'switch_model':
            self._cmd_switch_model(arg)
        elif cmd == 'export_full':
            self._cmd_export_full(arg)

    # ---- 命令实现 ----

    def _cmd_send(self, text):
        # 1.14：空窗期反馈——命令一到就广播「待确认」占位（本地面板 +
        # 所有手机端立即看到「发送中…」气泡），后面每个节点再推进状态
        self.uiq.put(('pend', ('send', text)))
        snap = self.cdp.eval(_SNAP_JS)
        if not snap.get('online'):
            raise RuntimeError('TRAE 界面未就绪')
        # 1.05：收紧为仅空闲可用——生成中 send-button 是停止键，
        # 点击会误停任务（原先「生成中+输入框有残留」仍放行的漏洞
        # 一并堵上）；生成中请走 interject（官方排队机制）
        if not snap.get('sendIdle'):
            raise RuntimeError('正在生成中，请用「插话」排队发送')
        # 聚焦 → 清残留 → 插入 → 验证 → 发送
        if not self.cdp.click_center(_INPUT_CLICK_JS):
            raise RuntimeError('未找到输入框')
        time.sleep(0.2)
        if snap.get('inputText'):
            self._clear_input()
            time.sleep(0.1)
        self.cdp.call('Input.insertText', {'text': text})
        time.sleep(0.3)
        cur = self.cdp.eval(_SNAP_JS)
        if cur.get('inputText') != text:
            raise RuntimeError('文字未进入输入框: %r' % cur.get('inputText'))
        # 1.14：文字已确认进入 TRAE 输入框（最慢的一段，先给反馈）
        self.uiq.put(('sent', {'text': text, 'stage': 'typed'}))
        # 1.41：语音防护——文字已进框时键应为「发送」，但仍探测一次，
        # 是语音键（异常态）绝不点击，防进语音模式死循环
        r = self.cdp.click_send_safe()
        if r == 'voice':
            raise RuntimeError('发送键此刻是语音输入按钮，已拒点'
                               '（重试一次通常即恢复）')
        if not r:
            raise RuntimeError('未找到发送键')
        # 1.14：已点发送键——此后只等 TRAE 渲染 + 快照回来
        self.uiq.put(('sent', {'text': text, 'stage': 'clicked'}))

    def _cmd_interject(self, text):
        """1.05：插话——生成中把消息排入 TRAE 官方队列。

        TRAE 官方时机：生成中在输入框打字按 Enter，消息进入排队
        （输入栏上方出现排队条），AI 在当前步骤边界消费它，而不是
        等全部任务完成。⚠ 不能点 send-button（生成中它是停止键，
        点击=误停任务），必须 dispatch Enter 键触发发送。"""
        snap = self.cdp.eval(_SNAP_JS)
        if not snap.get('online'):
            raise RuntimeError('TRAE 界面未就绪')
        if snap.get('sendIdle'):        # 已空闲：降级常规发送
            return self._cmd_send(text)
        # 1.14：空窗期反馈——排队插话同样先给占位气泡
        self.uiq.put(('pend', ('interject', text)))
        if not self.cdp.click_center(_INPUT_CLICK_JS):
            raise RuntimeError('未找到输入框')
        time.sleep(0.2)
        if snap.get('inputText'):
            self._clear_input()
            time.sleep(0.1)
        self.cdp.call('Input.insertText', {'text': text})
        time.sleep(0.3)
        cur = self.cdp.eval(_SNAP_JS)
        if cur.get('inputText') != text:
            raise RuntimeError('文字未进入输入框: %r' % cur.get('inputText'))
        self.uiq.put(('sent', {'text': text, 'stage': 'typed'}))
        # Enter 触发官方排队（React onKeyDown Enter=发送；按钮=停止）
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Enter', 'code': 'Enter',
                'windowsVirtualKeyCode': 13, 'nativeVirtualKeyCode': 13})
        time.sleep(0.6)
        # 成功标志：输入框清空（消息进排队条，AI 消费后才出现在
        # 消息区——快照暂时看不到属正常）
        cur2 = self.cdp.eval(_SNAP_JS)
        if cur2.get('inputText'):
            raise RuntimeError('TRAE 未接受排队消息（输入框未清空）')
        self.uiq.put(('sent', {'text': text, 'stage': 'queued'}))

    def _clear_input(self):
        """Ctrl+A 全选 + Backspace 删除（清输入框残留）"""
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'a', 'code': 'KeyA',
                'windowsVirtualKeyCode': 65, 'modifiers': 2})
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Backspace', 'code': 'Backspace',
                'windowsVirtualKeyCode': 8})

    # ---- 附件上传（2.15）----
    # 链路：DOM.getDocument → DOM.querySelector 定位隐藏的
    # <input type=file multiple> → DOM.setFileInputFiles 直投绝对
    # 路径（Chromium 触发 change 事件，TRAE 渲染预览条目）→ 等
    # 渲染后快照校验条目名。上传成功标志：attach 里出现同名条目。
    def _cmd_attach(self, paths):
        paths = [p for p in paths if os.path.isfile(p)]
        if not paths:
            raise RuntimeError('附件文件不存在')
        doc = self.cdp.call('DOM.getDocument', {})
        node = self.cdp.call('DOM.querySelector', {
            'nodeId': doc['root']['nodeId'],
            'selector': 'input[type=file]'})
        if not node or not node.get('nodeId'):
            raise RuntimeError('未找到附件入口（input[type=file]）')
        self.cdp.call('DOM.setFileInputFiles', {
            'files': paths, 'nodeId': node['nodeId']})
        time.sleep(1.2)     # 等 TRAE 渲染附件预览条目
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))
        got = [a.get('name', '') for a in (snap.get('attach') or [])]
        ok = sum(1 for p in paths if os.path.basename(p) in got)
        self.uiq.put(('attach_done', {
            'total': len(paths), 'ok': ok, 'names': got}))

    def _cmd_attach_rm(self, idx):
        if not self.cdp.eval(_attach_rm_js(idx)):
            raise RuntimeError('附件 %d 不存在（已变化，请刷新）'
                               % (idx + 1))
        time.sleep(0.6)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))
        self.uiq.put(('attach_rm_done', idx))

    def _ensure_clean(self):
        """1.46：坐标点击前清场——账号弹层（accountPopover）展开时
        正好盖住侧栏会话列表区（实测 2026-09-14：弹层 x23~285、
        y144~544，底部就是「退出登录」按钮 y≈512）。积分查询曾因
        「菜单检测失败不关菜单」把弹层滞留在界面上，下一次切会话/
        右键的坐标点击就会点到弹层项——「退出登录」事故链根因。
        这里在一切会话坐标点击前把可能滞留的弹层 Esc 干净。"""
        try:
            for _ in range(3):
                if not self.cdp.eval(_MENU_OPEN_JS):
                    return
                self._ctx_esc()
                time.sleep(0.25)
        except Exception:
            pass

    def _cmd_switch(self, idx):
        # v1.13：idx 是【会话序号】——只数会话行、跳过文件夹组头行
        #（手机版 renderConvs / 本地面板 _on_pick / 旧 _conv_click_js
        # 三处同一口径）。v1.12 曾误按 convs 原始下标解析（含组头
        # 行），列表里有文件夹时会选错会话，已修正（见文件头 1.13）。
        # 取到标题后按标题点击（抗列表变动），失败回退会话序号索引。
        base = self.cdp.eval(_SNAP_JS)
        convs = [r for r in (base.get('convs') or [])
                 if r and r[0] != 'f']
        try:
            idx = int(idx)
        except Exception:
            raise RuntimeError('switch 参数无效 %r' % (idx,))
        if idx < 0 or idx >= len(convs):
            raise RuntimeError('会话行 %d 不存在（列表已变化，请刷新）'
                               % (idx + 1))
        title = convs[idx][1] if len(convs[idx]) > 1 else ''
        # 1.14：空窗期反馈——切换要等 0.8~6s（含最小化恢复），先广播
        # 「正在切换」让本地面板与其它手机端有反馈
        self.uiq.put(('pend', ('switch', title)))
        self._ensure_clean()               # 1.46：防弹层吃点击
        if not self.cdp.click_center(_conv_click_title_js(title)):
            if not self.cdp.click_center(_conv_click_js(idx)):
                raise RuntimeError('会话「%s」不存在（列表已变化，请刷新）'
                                   % title)
        snap = self._snap_wait_msgs()
        self.uiq.put(('snap', snap))

    def _cmd_conv_rename(self, arg):
        """1.39：重命名会话（网页端长按会话行 → 菜单 → 重命名）。
        arg = [会话标题, 新名称]。链路：右键会话行呼出上下文菜单
        → 点「重命名」→ 往内联编辑框写入新名 → Enter 确认。"""
        try:
            title, name = arg[0], str(arg[1] or '').strip()
        except Exception:
            raise RuntimeError('conv_rename 参数无效 %r' % (arg,))
        if not name:
            raise RuntimeError('新名称为空')
        if len(name) > 60:
            name = name[:60]
        # ① 右键会话行（先按标题定位，失败按会话序号兜底）
        self._ensure_clean()               # 1.46：防弹层吃右键
        base = self.cdp.eval(_SNAP_JS)
        convs = [r for r in (base.get('convs') or [])
                 if r and r[0] != 'f']
        idx = next((i for i, r in enumerate(convs)
                    if len(r) > 1 and r[1] == title), -1)
        p = None
        if title:
            p = self.cdp.eval(_conv_click_title_js(title))
        if not p and idx >= 0:
            p = self.cdp.eval(_conv_click_js(idx))
        if not p:
            raise RuntimeError('未找到会话「%s」（列表已变化，请刷新）'
                               % (title or '?'))
        for ev in ('mousePressed', 'mouseReleased'):
            self.cdp.call('Input.dispatchMouseEvent', {
                'type': ev, 'x': p['x'], 'y': p['y'],
                'button': 'right', 'clickCount': 1})
        time.sleep(0.6)
        # ② 点上下文菜单「重命名」
        if not self.cdp.click_center(_RENAME_MENU_JS):
            # 没找到菜单项——Esc 关掉可能弹出的菜单再报错
            for k in ('Escape',):
                for ev in ('rawKeyDown', 'keyUp'):
                    self.cdp.call('Input.dispatchKeyEvent', {
                        'type': ev, 'key': k, 'code': k,
                        'windowsVirtualKeyCode': 27,
                        'nativeVirtualKeyCode': 27})
            raise RuntimeError('未找到「重命名」菜单项'
                               '（TRAE 界面可能不同，请反馈实测截图）')
        time.sleep(0.5)
        # ③ 写入新名 + Enter
        if not self.cdp.eval(_RENAME_APPLY_JS % json.dumps(name)):
            raise RuntimeError('重命名输入框未出现')
        time.sleep(0.15)
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Enter', 'code': 'Enter',
                'windowsVirtualKeyCode': 13, 'nativeVirtualKeyCode': 13})
        time.sleep(0.6)

    # ---- 1.45：会话置顶/删除（网页端长按会话行菜单扩展）----
    def _conv_ctx_open(self, title):
        """右键会话行呼出上下文菜单（标题定位，失败按会话序号兜底）"""
        self._ensure_clean()               # 1.46：防弹层吃右键
        base = self.cdp.eval(_SNAP_JS)
        convs = [r for r in (base.get('convs') or [])
                 if r and r[0] != 'f']
        idx = next((i for i, r in enumerate(convs)
                    if len(r) > 1 and r[1] == title), -1)
        p = None
        if title:
            p = self.cdp.eval(_conv_click_title_js(title))
        if not p and idx >= 0:
            p = self.cdp.eval(_conv_click_js(idx))
        if not p:
            raise RuntimeError('未找到会话「%s」（列表已变化，请刷新）'
                               % (title or '?'))
        for ev in ('mousePressed', 'mouseReleased'):
            self.cdp.call('Input.dispatchMouseEvent', {
                'type': ev, 'x': p['x'], 'y': p['y'],
                'button': 'right', 'clickCount': 1})
        time.sleep(0.8)

    def _ctx_esc(self):
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Escape', 'code': 'Escape',
                'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27})

    def _cmd_conv_pin(self, title):
        """置顶/取消置顶（TRAE 菜单是切换项：未置顶「置顶任务」、
        已置顶「取消置顶」——两文案都试，哪个在点哪个）"""
        self._conv_ctx_open(str(title or ''))
        if not self.cdp.eval(_conv_menu_click_js(
                ['置顶任务', '取消置顶', '置顶', '取消置顶任务'])):
            self._ctx_esc()
            raise RuntimeError('未找到「置顶」菜单项')
        time.sleep(1.0)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _cmd_conv_del(self, title):
        """删除会话（含确认框）：右键 → 「删除任务」→ 确认框点
        「删除」。客户端已做 confirm 二次确认，这里是第二道。"""
        self._conv_ctx_open(str(title or ''))
        if not self.cdp.eval(_conv_menu_click_js(['删除任务', '删除'])):
            self._ctx_esc()
            raise RuntimeError('未找到「删除任务」菜单项')
        time.sleep(1.0)
        # 确认框：有则点「删除」，无弹窗视为已直接删除
        if not self.cdp.eval(_DEL_CONFIRM_JS):
            time.sleep(0.4)
            self.cdp.eval(_DEL_CONFIRM_JS)
        time.sleep(0.8)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _snap_wait_msgs(self):
        """v1.12：点击后取快照，消息区为空时等渲染。先照旧
        0.8s 一采；空列表补采一拍；仍空且 TRAE 处于最小化
        （Electron 渲染冻结，切会话后消息区不重排，远程一直
        「没有消息」——2026-09-11 真机实测复现）→ 无焦点恢复
        窗口（不抢焦点、不回最小化）等消息渲染回来再采。"""
        def grab():
            s = self.cdp.eval(_SNAP_JS)
            s['_port'] = self.port
            return s
        time.sleep(0.8)
        snap = grab()
        if snap.get('msgs'):
            return snap
        time.sleep(0.8)
        snap = grab()
        if snap.get('msgs') or not _trae_minimized():
            return snap
        if _trae_restore_noactivate():
            time.sleep(1.2)
            for _ in range(6):
                snap = grab()
                if snap.get('msgs'):
                    break
                time.sleep(0.8)
        return snap

    def _cmd_toggle_folder(self, title):
        """点击文件夹组头（折叠/展开），随后回报新快照"""
        if not self.cdp.click_center(_folder_toggle_js(title)):
            raise RuntimeError('未找到文件夹「%s」' % title)
        time.sleep(0.8)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _cmd_new_task(self):
        if not self.cdp.click_center(_NEW_TASK_JS):
            raise RuntimeError('未找到「新建任务」按钮')
        time.sleep(0.8)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    # ---- 1.06：消息回退/删除 + 选项点选 + 新建选目录/文件夹内新建 ----

    def _cmd_msg_act(self, mi, kind):
        """回退(revert)/删除(delete)第 mi 条可见用户消息（0 起，与
        快照 msgs 同序）。两钮仅空闲对话渲染；点击后 TRAE 弹
        「取消/确认」框 → 自动点「确认」→ 回报新快照 + msg_act 事件。"""
        mi = int(mi)
        snap = self.cdp.eval(_SNAP_JS)
        if not snap.get('sendIdle'):
            raise RuntimeError('正在生成中（无回退/删除按钮），'
                               '等空闲再操作')
        r = self.cdp.eval(_msg_act_js(mi, kind))
        if r == 'nomsg':
            raise RuntimeError('用户消息 %d 不存在（列表已变化，请刷新）'
                               % (mi + 1))
        if r == 'nobtn':
            raise RuntimeError('消息 %d 上没有%s按钮（仅空闲对话出现）'
                               % (mi + 1,
                                  '回退' if kind == 'revert' else '删除'))
        time.sleep(0.9)                       # 等确认弹窗
        self.cdp.eval(_CONFIRM_OK_JS)         # 点「确认」（没弹=直接执行）
        time.sleep(1.2)                       # 等回退/删除落地
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))
        self.uiq.put(('msg_act', (kind, mi)))

    def _cmd_pick_opt(self, oi):
        """点选第 oi 个 AI 提问选项（与快照 opts 同序，0 起）"""
        if not self.cdp.eval(_opt_click_js(int(oi))):
            raise RuntimeError('选项 %d 不存在（列表已变化，请刷新）'
                               % (int(oi) + 1))
        time.sleep(0.9)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    # ---- 1.40：AI 提问卡结构化操作（ask_pick/ask_other/ask_submit/
    #      ask_cancel），配合快照 ask 字段与网页端提问卡 ----
    def _ask_snap_after(self):
        """操作后补一拍快照（0.9s 等 React 重渲染），网页端立即看到
        新的提问状态（选中态/下一问/卡消失）"""
        time.sleep(0.9)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _cmd_ask_pick(self, oi):
        """点提问卡第 oi 个选项（optionItem 同序，0 起）"""
        if not self.cdp.click_center(_ask_pick_js(int(oi))):
            raise RuntimeError('提问选项 %d 不存在（卡片已变化）'
                               % (int(oi) + 1))
        self._ask_snap_after()

    def _cmd_ask_other(self, text):
        """「其他」项填自定义答案：点选项行 → 聚焦 textarea →
        全选清残留 → insertText → 点主按钮提交。
        1.41 兜底：纯文本问（无 optionItemOther）直接点提问卡的
        大 textarea（锚定 footerBtnFixed 所在容器）。"""
        # ① 有「其他」选项行 → 先点它展开输入区
        has_other = self.cdp.eval(r"""
(() => !!document.querySelector('[class*="optionItemOther"]'))()""")
        if has_other:
            if not self.cdp.click_center(r"""
(() => {
  const el = document.querySelector('[class*="optionItemOther"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x + r.width / 2, y: r.y + r.height / 2};
})()"""):
                raise RuntimeError('提问卡没有「其他」项')
            time.sleep(0.4)
            if not self.cdp.click_center(_ASK_OTHER_TXT_JS):
                raise RuntimeError('「其他」输入框未找到')
        else:
            # 纯文本问：点 footer 容器内的 textarea
            if not self.cdp.click_center(_ASK_TXT2_JS):
                raise RuntimeError('提问卡输入框未找到')
        time.sleep(0.2)
        self._clear_input()
        time.sleep(0.1)
        self.cdp.call('Input.insertText', {'text': str(text or '')})
        time.sleep(0.4)
        # ③ 点主按钮提交
        if not self.cdp.click_center(_ask_footer_js('primary')):
            raise RuntimeError('提交按钮未找到（可能未处于提问状态）')
        self._ask_snap_after()

    def _cmd_ask_submit(self):
        """点提问卡底部主按钮（下一步/确认/完成）"""
        if not self.cdp.click_center(_ask_footer_js('primary')):
            raise RuntimeError('提问卡不在（可能已提交或已取消）')
        self._ask_snap_after()

    def _cmd_ask_cancel(self):
        """点提问卡「取消」按钮"""
        if not self.cdp.click_center(_ask_footer_js('cancel')):
            raise RuntimeError('取消按钮未找到')
        self._ask_snap_after()

    def _cmd_ask_prev(self):
        """点提问卡「上一步」按钮（v1.43：手机端回退上一问）"""
        if not self.cdp.click_center(_ask_footer_js('prev')):
            raise RuntimeError('「上一步」按钮未找到（这是第一问？）')
        self._ask_snap_after()

    # ---- 1.44：插话排队条管理（pend_del/pend_sendnow/pend_edit）----
    # 实测关键：排队条每秒重渲染，坐标点击必失效——必须 JS b.click()
    # 直点 DOM（2026-09-14 研究报告结论）。
    @staticmethod
    def _pend_btn_js(idx, name):
        """排队条第 idx 条上 aria-label=name 的按钮点击 JS"""
        return r"""
(() => {
  const l = document.querySelector('[class*="pendingMessageList"]');
  if (!l) return null;
  const it = l.querySelectorAll('[class*="pendingMessageItem-"]')[%d];
  if (!it) return null;
  const b = Array.from(it.querySelectorAll('button')).find(
    x => x.getAttribute('aria-label') === '%s');
  if (!b) return null;
  b.click();
  return true;
})()""" % (int(idx), name)

    def _pend_snap_after(self):
        time.sleep(0.8)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _cmd_pend_del(self, idx):
        """删除排队条第 idx 条（永不发送）"""
        if not self.cdp.eval(self._pend_btn_js(idx, '删除')):
            raise RuntimeError('排队条目 %d 不存在（已被消费/删除？）'
                               % (int(idx) + 1))
        self._pend_snap_after()

    def _cmd_pend_sendnow(self, idx):
        """立即发送排队条第 idx 条（不打断当前生成）"""
        if not self.cdp.eval(self._pend_btn_js(idx, '立即发送')):
            raise RuntimeError('排队条目 %d 不存在（已被消费/删除？）'
                               % (int(idx) + 1))
        self._pend_snap_after()

    def _cmd_pend_edit(self, idx):
        """编辑排队条第 idx 条：出列 + 文本回填 TRAE 输入框。
        回填后客户端用快照 inputText 同步文本到本端编辑框。"""
        if not self.cdp.eval(self._pend_btn_js(idx, '编辑')):
            raise RuntimeError('排队条目 %d 不存在（已被消费/删除？）'
                               % (int(idx) + 1))
        time.sleep(0.5)
        self._pend_snap_after()

    def _cmd_new_task_in(self, folder):
        """文件夹组内新建：点组头右侧「组内新建」按钮，新对话直接
        隶属该文件夹工作区（TRAE 原生行为）"""
        if not self.cdp.click_center(_folder_new_js(folder)):
            raise RuntimeError('文件夹「%s」没有组内新建按钮' % folder)
        time.sleep(1.2)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _cmd_new_task_dir(self, abspath):
        """新建任务 + 工作目录级联选到 abspath（工作台根内绝对路径，
        _on_rcmd 已解析校验）。链路：新建 → _apply_task_dir（1.10 抽取
        的共用原子段：点目录按钮 → 级联导航 → 校验按钮文本）。"""
        abspath = os.path.normpath(abspath)
        if not os.path.isdir(abspath):
            raise RuntimeError('目录不存在: %s' % abspath)
        if not self.cdp.click_center(_NEW_TASK_JS):
            raise RuntimeError('未找到「新建任务」按钮')
        time.sleep(1.5)                       # 等输入栏目录按钮渲染
        self._apply_task_dir(abspath)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _apply_task_dir(self, abspath):
        """1.10：在已打开的新建任务输入区把工作目录级联选到 abspath
        （从 _cmd_new_task_dir 抽出，new_task_dir / task_dir_set 两链路
        同一实现）。"""
        # 2026-09-10 分身实测踩坑：级联面板若已被打开（上次操作残留），
        # 再点目录按钮=把面板关掉 → _nav_cascade 读到空列表直接失败。
        # 先发 Esc 关掉任何残留面板，再点按钮=确定性地「打开」
        self._esc_panel()
        time.sleep(0.3)
        if not self.cdp.click_center(_DIRBTN_JS):
            raise RuntimeError('未找到工作目录按钮（输入栏左侧）')
        time.sleep(0.9)                       # 等级联面板展开
        if not self._nav_cascade(abspath):
            raise RuntimeError('级联选择器走不到该目录（不在最近工作区'
                               '目录树下？先在 TRAE 手动选一次）：%s'
                               % abspath)
        time.sleep(1.0)
        cur = self.cdp.eval(_DIRBTN_JS) or {}
        want = os.path.basename(abspath.rstrip('\\/'))
        if (cur.get('t') or '') != want:
            raise RuntimeError('目录选择未生效（当前=%s，目标=%s）'
                               % (cur.get('t'), want))

    def _esc_panel(self):
        """1.10：发 Esc 关闭级联面板/弹层（rawKeyDown 实测口径，
        同 _probe_dlg2 探针）"""
        for ev in ('rawKeyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Escape', 'code': 'Escape',
                'windowsVirtualKeyCode': 27, 'nativeVirtualKeyCode': 27})

    def _cmd_new_task_dlg(self):
        """1.10：新建任务弹窗·第一步——点 TRAE「新建任务」展开输入区
        （工作目录按钮 inputBarButton 仅新建后渲染），抓 TRAE 记忆的
        上次工作目录（用户观察的回填特征）：占位「选择文件夹（可选）」
        =无；否则按钮文本=目录名 → 开级联面板从「最近」条目反查绝对
        路径 → Esc 关面板 → snap + task_dlg 事件（UI 弹窗预填该目录；
        用户保留=零操作，重选=task_dir_set 覆盖）。"""
        if not self.cdp.click_center(_NEW_TASK_JS):
            raise RuntimeError('未找到「新建任务」按钮')
        time.sleep(1.5)                       # 等输入栏目录按钮渲染
        self._esc_panel()                     # 关残留级联面板（实测踩坑）
        time.sleep(0.3)
        b = self.cdp.eval(_DIRBTN_JS)
        if not b:
            raise RuntimeError('新建任务输入区未出现工作目录按钮')
        t = (b.get('t') or '').strip()
        name = full = ''
        if t and '选择文件夹' not in t:       # 有记忆目录 → 反查绝对路径
            name = t
            self._mclick(b['x'], b['y'])
            time.sleep(0.9)                   # 等级联面板展开
            for i in self.cdp.eval(_CASCADE_ITEMS_JS) or []:
                if (i.get('t') or '').strip() == t and i.get('sub'):
                    full = (i.get('sub') or '').strip()
                    break
            self._esc_panel()                 # 关面板（任务输入区保持）
            time.sleep(0.3)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))
        self.uiq.put(('task_dlg', {'name': name, 'full': full}))

    def _cmd_task_dir_set(self, abspath):
        """1.10：新建任务弹窗「创建」——TRAE 输入区已开，仅把工作目录
        级联选到 abspath（UI 端已比对：与记忆有变化才下发本命令）；
        成功回报 task_dlg_ok。"""
        abspath = os.path.normpath(abspath)
        if not os.path.isdir(abspath):
            raise RuntimeError('目录不存在: %s' % abspath)
        self._apply_task_dir(abspath)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))
        self.uiq.put(('task_dlg_ok', abspath))

    def _cmd_task_dlg_cancel(self):
        """1.10：新建任务弹窗「取消」——Esc×2 关 TRAE 新建任务输入区
        （尽力而为；空任务是否残留由 TRAE 决定），回报快照。"""
        for _ in range(2):
            self._esc_panel()
            time.sleep(0.25)
        snap = self.cdp.eval(_SNAP_JS)
        snap['_port'] = self.port
        self.uiq.put(('snap', snap))

    def _nav_cascade(self, target):
        """级联面板逐级导航到 target（绝对路径）。每轮读条目：
        ① 有 sub==target → 点击选中，完成；
        ② 否则取 sub 是 target 祖先的最深条目 → hover 触发下一级
           （0.7s 后无新条目再点击展开；点击祖先可能直接选中祖先
           本身——由最终目录文本校验兜底）；
        最多 14 轮防死循环。返回是否完成精确选中。"""
        tgt = os.path.normpath(target).lower().rstrip('\\/')

        def _sub(i):
            return os.path.normpath(i.get('sub') or '').lower().rstrip('\\/')

        seen_fp = set()
        for _ in range(14):
            items = self.cdp.eval(_CASCADE_ITEMS_JS) or []
            fp = frozenset((i.get('t'), _sub(i)) for i in items)
            for i in items:
                if _sub(i) and _sub(i) == tgt:
                    self._mclick(i['x'], i['y'])
                    return True
            best = None
            for i in items:
                s = _sub(i)
                if not s:
                    continue
                if s == tgt or tgt.startswith(s + os.sep):
                    if best is None or len(s) > len(_sub(best)):
                        best = i
            if best is None:
                return False
            # hover 优先（级联控件通常悬停展开）
            self.cdp.call('Input.dispatchMouseEvent',
                          {'type': 'mouseMoved', 'x': best['x'],
                           'y': best['y']})
            time.sleep(0.7)
            items2 = self.cdp.eval(_CASCADE_ITEMS_JS) or []
            fp2 = frozenset((i.get('t'), _sub(i)) for i in items2)
            if fp2 - fp:                      # 悬停出了新层级 → 继续
                seen_fp = fp2
                continue
            if not items2:                    # 面板关了（点击选中了祖先）
                return False
            self._mclick(best['x'], best['y'])   # 点击展开下一级
            time.sleep(0.9)
        return False

    def _mclick(self, x, y):
        """CDP 坐标单击（级联条目等有坐标无 JS 引用的元素）"""
        self.cdp.call('Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1, 'buttons': 1})
        self.cdp.call('Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1})

    # ---- 模型切换（2.07）----

    def _esc(self):
        """发 Esc 关闭弹层（菜单/下拉），防止挡界面"""
        for ev in ('keyDown', 'keyUp'):
            self.cdp.call('Input.dispatchKeyEvent', {
                'type': ev, 'key': 'Escape', 'code': 'Escape',
                'windowsVirtualKeyCode': 27})

    def _cmd_model_list(self):
        """开模型菜单 → 读列表 → Esc 关 → 回报 [[名, 倍率, 受限], ...]"""
        if not self.cdp.click_center(_MODEL_TRIGGER_JS):
            raise RuntimeError('未找到模型选择器')
        time.sleep(0.6)
        raw = self.cdp.eval(_MODEL_LIST_JS) or []
        self._esc()
        items = []
        for e in raw:
            nm = (e.get('name') or '').strip()
            if not nm or any(x[0] == nm for x in items):
                continue
            items.append([nm, (e.get('trail') or '').strip(),
                          bool(e.get('restricted'))])
        self.uiq.put(('models', items))

    def _cmd_switch_model(self, name):
        """开菜单 → 点目标模型项 → 菜单没自动关就 Esc → 回报实际值。
        受限模型点击可能无效：状态栏提示实际生效值，不弹错误。"""
        if not self.cdp.click_center(_MODEL_TRIGGER_JS):
            raise RuntimeError('未找到模型选择器')
        time.sleep(0.6)
        if not self.cdp.click_center(_model_click_js(name)):
            self._esc()
            raise RuntimeError('模型列表里没有「%s」' % name)
        time.sleep(0.5)
        # 选择后菜单应自动关；没关（或点了无效项）→ Esc 防挡界面
        if self.cdp.eval(_MODEL_MENU_OPEN_JS):
            self._esc()
            time.sleep(0.3)
        cur = self.cdp.eval(_SNAP_JS).get('model') or ''
        self.uiq.put(('model_set', (name, cur)))

    # ---- 1.41：积分预警（网页弹 2 秒提醒 + 钉钉 97 通道 webhook）----
    _WARN_COOLDOWN = 1800          # 同一轮低积分 30 分钟内不重复轰炸

    def _points_warn_check(self, pts, raw):
        """积分数值低于阈值（cfg points_warn_th，0=关）→ 广播
        points_warn（网页端弹 2 秒提醒）+ 钉钉 97 通道 webhook
        （冷却期内不重复发）。"""
        try:
            th = int((_ensure_cfg().get('points_warn_th') or 0))
        except Exception:
            th = 0
        if th <= 0 or pts > th:
            return
        now = time.time()
        if now - getattr(self, '_warn_ts', 0) < self._WARN_COOLDOWN:
            return
        self._warn_ts = now
        self.uiq.put(('points_warn', {'points': raw, 'th': th}))
        threading.Thread(target=_dingtalk_97, args=(
            '【TRAE积分预警】当前积分 %s，已低于阈值 %d，请注意充值'
            % (raw, th),), daemon=True).start()

    def _cmd_points(self):
        # 开菜单 → 读积分/账号名 → 关菜单（点头像本体，防误触「免费」标签）
        # 1.46：① 先清场（防上次滞留弹层）；② 菜单无论读到读不到
        # 必须关——v1.45 及以前关菜单写在 if ok 里，菜单检测失败时
        # 弹层滞留，下一次会话坐标点击误触「退出登录」（事故链实测）；
        # ③ 菜单开了却读不到积分/昵称 = 疑似未登录，主动报异常
        self._ensure_clean()
        self.cdp.click_center(_AVATAR_JS)
        ok = False
        for _ in range(6):
            time.sleep(0.5)
            if self.cdp.eval(_MENU_OPEN_JS):
                ok = True
                break
        val = None
        acct = None
        if ok:
            r = self.cdp.eval(_POINTS_JS) or {}
            if isinstance(r, dict):            # 1.41：{points, name}
                val = r.get('points')
                acct = r.get('name')
            elif isinstance(r, str):
                val = r
        for _ in range(3):                     # 1.46：无条件关菜单
            if not self.cdp.eval(_MENU_OPEN_JS):
                break
            self._ctx_esc()
            time.sleep(0.3)
        if acct:
            self.uiq.put(('account', acct))
        self.uiq.put(('points', val or '读取失败'))
        if ok and not val:
            # 1.46：菜单打开成功却读不到积分 → 大概率未登录
            self._login_lost_alert(
                '账号菜单已打开但读不到积分/昵称')
        elif ok and val:
            try:
                self._points_warn_check(int(str(val).replace(',', '')),
                                        val)
            except ValueError:
                pass

    def _login_lost_alert(self, hint):
        """1.46：登录态丢失主动报警（30 分钟冷却）——cmderr 走本机
        GUI + 手机端红条，钉钉 97 通道同步通知。"""
        now = time.time()
        if now - getattr(self, '_login_lost_ts', 0) < self._WARN_COOLDOWN:
            return
        self._login_lost_ts = now
        snap = self.cdp.eval(_SNAP_JS) if self.cdp else {}
        acct = (snap or {}).get('acctText') or '账号区空'
        msg = ('TRAE 未登录/登录态丢失（账号区显示：%s；%s）'
               '——发送等操作会失败，请在 TRAE 里重新登录'
               % (acct, hint))
        self.uiq.put(('cmderr', msg))
        threading.Thread(target=_dingtalk_97, args=(
            '【TRAE异常报告】' + msg,), daemon=True).start()

    def _cmd_export_full(self, fmt):
        """滚动收集全部消息（虚拟列表只渲染可见区，需逐屏拼全量）"""
        # 执行时复核生成态（排队时序：发送命令可能刚在前面执行完）
        snap = self.cdp.eval(_SNAP_JS)
        if (snap.get('online') and not snap.get('sendIdle')
                and not snap.get('inputText')):
            self.uiq.put(('cmderr', 'export_full: 正在生成中，'
                                    '等完成再完整导出'))
            return
        info = self.cdp.eval(_SCROLLER_JS)
        if not (info and info.get('ok')):
            snap = self.cdp.eval(_SNAP_JS)
            self.uiq.put(('collected', (fmt, snap.get('msgs') or [])))
            return
        self.cdp.eval(_SCROLL_SET_JS % 0)      # 先到顶（老消息渲染）
        time.sleep(0.7)
        acc = []
        prev = -1.0
        for _ in range(120):
            if self.stop_ev.is_set():
                return
            snap = self.cdp.eval(_SNAP_JS)
            acc = _merge_msgs(acc, snap.get('msgs') or [])
            self.uiq.put(('collecting', len(acc)))
            top = self.cdp.eval(_SCROLL_BY_JS)
            if top is None or abs(float(top) - prev) < 0.5:
                break                            # 滚不动了 = 到底
            prev = float(top)
            time.sleep(0.45)
        self.cdp.eval(_SCROLL_SET_JS % 2000000000)   # 回到底部
        self.uiq.put(('collected', (fmt, acc)))


def _port_fast(pairs):
    """并行 TCP 直连探测端口在线情况。返回在线 [box, ...]。
    本机防火墙对未监听回环端口丢包（连接超时而非拒绝），串行探测
    要 ~1s/个（16 个分身 = 16s），并行一轮 ~1s；监听端口回环
    连接毫秒级完成，timeout=1s 绰绰有余。"""
    if not pairs:
        return []

    def _chk(t):
        b, p = t
        try:
            s = socket.create_connection(('127.0.0.1', p), timeout=1.0)
            s.close()
            return b, True
        except Exception:
            return b, False

    with ThreadPoolExecutor(max_workers=max(4, len(pairs))) as ex:
        return [b for b, ok in ex.map(_chk, pairs) if ok]


class _PortScanner(threading.Thread):
    """周期扫描全部端口在线情况（并行 TCP 探测，6 秒一轮）"""

    INTERVAL = 6

    def __init__(self, pairs, uiq):
        threading.Thread.__init__(self, daemon=True)
        self.pairs = pairs      # [(box, port)]
        self.uiq = uiq
        self.stop_ev = threading.Event()

    def run(self):
        while not self.stop_ev.is_set():
            alive = _port_fast(self.pairs)
            self.uiq.put(('ports', alive))
            self.stop_ev.wait(self.INTERVAL)


# ================= 1.10：自研文件树 + 新建任务弹窗 =================

class BenchWin(tk.Toplevel):
    """1.10：本地文件树（替代原生 filedialog，参考网页客户端 📂 浏览
    页设计）。mode='path'（输入行 📂 按钮）：双击进入目录、双击文件即
    插入；「插入所选」/「插入当前目录」→ on_done(路径)。mode='dir'
    （新建任务工作目录）：只列目录，「✅ 选定当前目录」→ on_done(路径)。
    任何关闭方式（按钮/窗口✕）都回调 on_done(路径|None)。⬆ 上级不
    受工作台根限制（本地直读磁盘；远程 bench_ls 才限根——公开频道
    安全约束只属于远程链路）。"""

    def __init__(self, master, start, mode, on_done):
        tk.Toplevel.__init__(self, master)
        self.title('文件树' + (' - 插入路径' if mode == 'path'
                               else ' - 选择目录'))
        self.geometry('540x440')
        self.minsize(360, 300)
        self.transient(master)
        self.mode = mode
        self.on_done = on_done
        p = os.path.normpath(start or '')
        self.cur = p if os.path.isdir(p) else os.path.expanduser('~')
        top = ttk.Frame(self, padding=(8, 6))
        top.pack(fill='x')
        ttk.Button(top, text='⬆ 上级', width=7,
                   command=self._up).pack(side='left')
        self.lbl_path = ttk.Label(top, text=self._short(self.cur),
                                  foreground='#555')
        self.lbl_path.pack(side='left', padx=(8, 0), fill='x', expand=True)
        mid = ttk.Frame(self, padding=(8, 0))
        mid.pack(fill='both', expand=True)
        self.lst = tk.Listbox(mid, activestyle='none',
                              exportselection=False,
                              font=('Microsoft YaHei', 10))
        sb = ttk.Scrollbar(mid, command=self.lst.yview)
        self.lst.configure(yscrollcommand=sb.set)
        self.lst.pack(side='left', fill='both', expand=True)
        sb.pack(side='left', fill='y')
        self.lst.bind('<Double-Button-1>', self._dbl)
        self._rows = []            # [(是否目录, 名称)]
        bot = ttk.Frame(self, padding=(8, 6))
        bot.pack(fill='x')
        if mode == 'path':
            ttk.Button(bot, text='插入所选', width=10,
                       command=self._ins_sel).pack(side='left')
            ttk.Button(bot, text='插入当前目录', width=13,
                       command=lambda: self._fin(self.cur)
                       ).pack(side='left', padx=(6, 0))
            hint = '双击进入目录 / 双击文件插入路径'
        else:
            ttk.Button(bot, text='✅ 选定当前目录', width=14,
                       command=lambda: self._fin(self.cur)
                       ).pack(side='left')
            hint = '双击进入子目录，选定后点「✅ 选定当前目录」'
        ttk.Label(bot, text=hint, foreground='#888'
                  ).pack(side='left', padx=8)
        ttk.Button(bot, text='关闭' if mode == 'path' else '取消',
                   command=lambda: self._fin(None)).pack(side='right')
        self.protocol('WM_DELETE_WINDOW', lambda: self._fin(None))
        self._load()
        self.grab_set()
        self.focus_set()

    @staticmethod
    def _short(p, n=52):
        return p if len(p) <= n else '…' + p[-(n - 1):]

    def _load(self):
        self.lst.delete(0, 'end')
        self._rows = []
        try:
            with os.scandir(self.cur) as it:
                ents = sorted(it, key=lambda e: e.name.lower())
        except Exception as e:
            self.lst.insert('end', '（读取失败: %s）' % str(e)[:40])
            return
        for e in ents:
            try:
                isd = e.is_dir()
            except OSError:
                continue
            if isd:
                self._rows.append((True, e.name))
                self.lst.insert('end', '📁 %s' % e.name)
            elif self.mode == 'path':       # 目录模式不列文件
                self._rows.append((False, e.name))
                self.lst.insert('end', '📄 %s' % e.name)
        if not self._rows:
            self.lst.insert('end', '（空目录）')

    def _up(self):
        p = os.path.dirname(self.cur)
        if p and p != self.cur:             # 盘根的上级=自身 → 不动
            self.cur = p
            self.lbl_path.config(text=self._short(self.cur))
            self._load()

    def _sel(self):
        i = self.lst.curselection()
        if not i or i[0] >= len(self._rows):
            return None
        return self._rows[i[0]]

    def _dbl(self, _ev):
        s = self._sel()
        if not s:
            return
        if s[0]:
            self.cur = os.path.join(self.cur, s[1])
            self.lbl_path.config(text=self._short(self.cur))
            self._load()
        elif self.mode == 'path':           # 文件：双击即插入
            self._fin(os.path.join(self.cur, s[1]))

    def _ins_sel(self):
        s = self._sel()
        if not s:
            self.lbl_path.config(text='请先在列表中选中一项',
                                 foreground='#c62828')
            self.after(1500, lambda: self.lbl_path.config(
                text=self._short(self.cur), foreground='#555'))
            return
        self._fin(os.path.join(self.cur, s[1]))

    def _fin(self, p):
        try:
            self.grab_release()
        except Exception:
            pass
        self.destroy()
        if self.on_done:
            self.on_done(p)


class TaskDlg(tk.Toplevel):
    """1.10：新建任务弹窗（固定带工作目录行）。d={'name','full'}=
    TRAE 记忆的上次工作目录（_cmd_new_task_dlg 从输入区抓的回填特征）：
    未选显示「选择文件夹…」；已选显示目录名+完整路径+「✕ 重选」
    （重选=文件树里重新选）。「创建」→ 目录与记忆有变化才下发
    task_dir_set（级联选到该处），一致/未选则零操作；「取消」/关窗 →
    task_dlg_cancel（Esc×2 关 TRAE 输入区）。
    1.22 锁定模式：locked=文件夹组名（会话列表组头右键入口）——
    不预开 TRAE 输入区、无目录选择（归属锁定），「创建」=
    new_task_in（点 TRAE 组头「组内新建」），「取消」直接关（无
    TRAE 侧状态要回收）。"""

    def __init__(self, master, d, locked=None):
        tk.Toplevel.__init__(self, master)
        self.locked = locked or ''
        self.title('在此文件夹新建任务' if self.locked else '新建任务')
        self.resizable(False, False)
        self.transient(master)
        self.app = master
        self.name = (d.get('name') or '').strip()
        self.full = (d.get('full') or '').strip()
        # 有效工作目录：优先反查到的绝对路径；只有名（「最近」里没查到
        # 绝对路径）时保留名字展示但不参与比对（TRAE 侧本就已选中）
        self.dir = self.full if self.name else ''
        self.protocol('WM_DELETE_WINDOW', self._cancel)
        frm = ttk.Frame(self, padding=(12, 10))
        frm.pack(fill='both', expand=True)
        if self.locked:
            ttk.Label(frm, foreground='#1565c0', font=(
                'Microsoft YaHei', 10, 'bold'),
                text='🔒 ' + self.locked
                     + '（归属锁定·组内新建）').pack(anchor='w')
            ttk.Label(frm, foreground='#888',
                      text='新对话直接隶属该文件夹工作区；创建后'
                           '在输入框写任务内容发送').pack(
                anchor='w', pady=(4, 0))
        else:
            ttk.Label(frm, text='工作目录（可选）：').pack(anchor='w')
            self.row = ttk.Frame(frm)
            self.row.pack(fill='x', pady=(2, 2))
            self._render_row()
            ttk.Label(frm, foreground='#888',
                      text='不选则沿用 TRAE 记忆（如有）；'
                           '创建后在输入框写任务内容发送'
                      ).pack(anchor='w', pady=(4, 0))
        btns = ttk.Frame(frm)
        btns.pack(fill='x', pady=(8, 0))
        ttk.Button(btns, text='创建', width=9,
                   command=self._ok).pack(side='right')
        ttk.Button(btns, text='取消', width=9,
                   command=self._cancel).pack(side='right', padx=(6, 0))
        self.grab_set()
        self.focus_set()

    def _render_row(self):
        for w in self.row.winfo_children():
            w.destroy()
        if self.dir or self.name:
            box = ttk.Frame(self.row)
            box.pack(fill='x')
            name = os.path.basename(self.dir.rstrip('\\/')) \
                if self.dir else self.name
            ttk.Label(box, text='📁 ' + name,
                      font=('Microsoft YaHei', 10, 'bold')
                      ).pack(side='left')
            ttk.Button(box, text='✕ 重选', width=8,
                       command=self._pick).pack(side='right')
            if self.dir:
                ttk.Label(self.row, text=self._short(self.dir),
                          foreground='#888').pack(anchor='w')
        else:
            ttk.Button(self.row, text='选择文件夹…', width=15,
                       command=self._pick).pack(side='left')

    @staticmethod
    def _short(p, n=64):
        return p if len(p) <= n else '…' + p[-(n - 1):]

    def _pick(self):
        self.grab_release()                 # 让位给文件树（结束后收回）
        start = self.dir if self.dir and os.path.isdir(self.dir) \
            else self.app._bench_root()
        BenchWin(self, start, 'dir', self._picked)

    def _picked(self, p):
        self.after(60, self.grab_set)       # 文件树已销毁，收回模态
        if p:
            self.dir = p
            self._render_row()

    def _ok(self):
        if self.locked:
            # 1.22：锁定模式——此刻才点 TRAE 组头「组内新建」开输入区
            self.app._cmd('new_task_in', self.locked)
            self.destroy()
            return
        cur = os.path.normpath(self.dir) if self.dir else ''
        if cur and (not self.full
                    or os.path.normpath(self.full) != cur):
            self.app._cmd('task_dir_set', cur)      # 有变化才设置
        else:
            self.app._flash('新建任务就绪，输入内容后发送', '#0a7d32')
        self.destroy()

    def _cancel(self):
        if not self.locked:
            # 锁定模式没开过 TRAE 输入区，无需 Esc 回收
            self.app._cmd('task_dlg_cancel', None)
        self.destroy()


# ================= 面板窗口 =================

class TraePanelDialog(tk.Toplevel):
    """TRAE 同步显示与控制面板（可切换多个分身 / 原版 TRAE）"""

    def __init__(self, master, port, box_name='', boxes=None):
        self._own_root = master is None
        if master is None:
            master = tk.Tk()
            master.withdraw()
        tk.Toplevel.__init__(self, master)
        _ensure_cfg()              # 2.09：先加载配置（再开任何后台线程）
        self.port = port
        self.box_name = box_name or ORIG_NAME
        # 1.23 多服务端：本机服务器名称（未命名在启动后由
        # enforce_server_name 强制补齐）；目标=本机或远方服务端
        self.srv_name = _srv_name()
        if self.srv_name:
            _set_srv_name(self.srv_name)
        self._target = None        # 1.25：已废弃（恒 None，仅留兼容）
        self._srv_peers = {}       # 在线远方服务端快照（重名检测用）
        self._tgt_vals = None      # 下拉框选项缓存（变化才重设）
        self._tgt_labels = {}      # 选项标签 → ('local', box)
        # 分身目录：{沙盒: 主程序路径}；缺省自动扫桌面快捷方式
        # （2.09：快捷方式缺失时 discover_boxes 会用 ini 盒名兜底）
        if boxes is None:
            boxes = {}
            try:
                for b, exe, _l in discover_boxes():
                    if box_number(b):
                        boxes[b] = exe
            except Exception:
                pass
        self.boxes = boxes
        self.orig_exe = find_host_trae_exe(boxes)
        self.box_names = [ORIG_NAME] + sorted(
            self.boxes, key=lambda b: (box_number(b) or 0, b))
        if self.box_name not in self.box_names:
            self.box_names.insert(0, self.box_name)
        self.snap = {}
        self._msgs_key = None      # 消息内容指纹（变了才重建）
        self._gen_state = None     # 任务状态机：None未知/'gen'生成中/'idle'空闲
        self._fin_at = None        # 生成→空闲跳变时刻（=任务结束时刻）
        self._fin_pop = None       # 完成提醒弹窗（防重：新的结束先销毁旧的）
        self._manual_stop_at = None  # 1.05：手动/防呆停止时刻（甄别非自然完成）
        # 1.03 防呆：活动指纹 + 最近活动时刻（快照内容变了=有动静）
        self._watch_fp = None
        self._watch_last = time.time()
        self._watch_job = None
        self._convs_key = None     # 会话列表指纹
        self.points = '—'
        self._busy = False         # 分身切换/带端口重启进行中
        # 1.24：远方操控互斥锁——本机正被哪个操控者（FOX 发送者 ID）
        # 占用 + 最近活跃时刻；超过 lock_sec 秒无操作自动失效
        # （1.25：锁保留，防多个网页端同时操控本机）
        self._ctl_lock = {'id': None, 'ts': 0.0}
        self._last_deny_ts = 0.0   # 拒绝应答限频
        # 1.20：状态灯细分（远程桥连接态 / 最近1分钟客户端数 / 启动过程）
        self._remote_line = False
        self._remote_peers = 0
        self._boot_state = None
        self._row_map = []         # 列表行 → ('f', 组名) / ('c', 序号)
        self._task_dlg = None      # 1.10：新建任务弹窗（防重开）
        self._bench_win = None     # 1.10：📂 自研文件树窗口（防重开）
        # 1.14：待确认项（空窗期反馈）——发送/插话的本地回显占位，
        # 每项 {id, kind, text, state, ts}；state: sending/typed/
        # sent/queued/timeout。快照确认到同文本用户消息后移除。
        self._pend = []
        self._pend_seq = 0
        self._pend_claims = []     # 已被占位认领的快照消息下标（防重复确认）
        self._pend_seen = {}       # 1.36：用户消息首见时刻（文本→epoch），
                                   # 「发送确认只认 60 秒内出现的新消息」
        self._pend_conv = ''       # 认领记录所属会话（换会话即清）
        # 模型切换（2.07）：显示文本 → 模型名 映射；切换中防快照回写
        self._model_map = {}
        self._model_busy = False
        # 窗口 geometry 记忆（2.09）：拖动/缩放防抖落盘
        self._geom_job = None
        # 消息时间缓存（本地首见时间；TRAE 自带时间稀疏，见 2.06）
        self._times_file = _trace_path()
        self._times_job = None     # 防抖保存 after 句柄
        self.times = {}
        try:
            with open(self._times_file, encoding='utf-8') as f:
                self.times = json.load(f)
        except Exception:
            self.times = {}

        self.title('%s  v%s  [%s·%s]' % (
            APP_NAME, VERSION, self.box_name,
            self.srv_name or '未命名'))
        # 2.09：记住上次大小位置（不打勾/无记录用默认 960x600）
        if CFG.get('remember_win', True) and CFG.get('geometry'):
            try:
                self.geometry(CFG['geometry'])
            except Exception:
                self.geometry('960x600')
        else:
            self.geometry('960x600')
        self.minsize(780, 460)
        # 2.09：📌置顶图钉（出厂默认置顶，可改，见设置页标签行右侧）
        self.attributes('-topmost', bool(CFG.get('topmost', True)))

        self.uiq = queue.Queue()
        self.poller = _Poller(port, self.uiq)
        self.poller.start()
        self.pairs = [(b, p) for b in self.box_names
                      for p in [box_port(b)] if p]
        self.scanner = _PortScanner(self.pairs, self.uiq)
        self.scanner.start()

        # 1.00：远程服务桥（uiq 换 tee 二路分发：本地照旧 + 转发远程）
        self._alive_last = set()
        self.bridge = _RemoteBridge(self.uiq, self)
        self.uiq = _TeeQueue(self.uiq, self.bridge)
        self.poller.uiq = self.uiq
        self.scanner.uiq = self.uiq
        if CFG.get('ws_on', True) and HAS_WS:
            self.bridge.start()

        self._build()
        self._rebuild_targets()    # 1.23：目标下拉框带 @服务端 ●/○
        self.protocol('WM_DELETE_WINDOW', self._on_close)
        self.after(150, self._drain)
        self._watch_job = self.after(10000, self._watch_tick)  # 1.03 防呆巡检
        # 2.09：窗口大小位置记忆（拖动/缩放防抖 700ms 立刻落盘）
        self.bind('<Configure>', self._on_geom)
        # 2.09：不打勾「启动打开主页」→ 恢复最后使用的分页
        if not CFG.get('open_home', True):
            try:
                self.nb.select(min(int(CFG.get('last_tab') or 0),
                                   len(self.nb.tabs()) - 1))
            except Exception:
                pass
        # 2.09：启动 10 秒后后台校验重要路径（不阻塞启动）：
        # 配置失效的自动找，找到提醒采用，找不到弹手动指定
        self.after(10000, self._auto_paths)

    # ---- UI 构建 ----

    def _build(self):
        # 2.09：多分页标签（主界面/设置），本行右侧📌置顶图钉
        self.nb = ttk.Notebook(self)
        self.nb.pack(fill='both', expand=True)
        self.pin = tk.Label(self.nb,
                            text='📌' if CFG.get('topmost', True) else '📍',
                            cursor='hand2',
                            font=('Microsoft YaHei', 11))
        self.pin.place(relx=1.0, x=-12, y=2, anchor='ne')
        self.pin.bind('<Button-1>', self._toggle_top)
        self.nb.bind('<<NotebookTabChanged>>', self._on_tab)
        page_main = ttk.Frame(self.nb)
        self.nb.add(page_main, text=' 主界面 ')
        page_set = ttk.Frame(self.nb)
        self.nb.add(page_set, text=' 设置 ')
        self._build_main(page_main)
        self._build_set(page_set)
        # 1.02：网络分页（远程服务区自设置页移入 + WS 流量统计）
        page_net = ttk.Frame(self.nb)
        self.nb.add(page_net, text=' 网络 ')
        self._build_net(page_net)
        # 2.14：自检页签（独立模块 TRAE自检模块.py；缺失/损坏时跳过
        # 不影响主程序，也可 py 直跑该模块独立自检）
        try:
            _d = os.path.dirname(os.path.abspath(__file__))
            if _d not in sys.path:
                sys.path.insert(0, _d)
            import TRAE自检模块 as _sc
            page_chk = ttk.Frame(self.nb)
            self.nb.add(page_chk, text=' 自检 ')
            _sc.build_page(page_chk, self)
        except Exception:
            pass

    def _build_main(self, pg):
        # 状态行
        bar = ttk.Frame(pg, padding=(8, 5))
        bar.pack(fill='x')
        self.lbl_conn = ttk.Label(bar, text='● 连接中…',
                                  foreground='#0a7d32')
        self.lbl_conn.pack(side='left')
        ttk.Label(bar, text='   积分:').pack(side='left')
        self.lbl_points = ttk.Label(bar, text='—', foreground='#7c4dff',
                                    font=('', 9, 'bold'))
        self.lbl_points.pack(side='left')
        ttk.Button(bar, text='刷新积分', width=8,
                   command=lambda: self._cmd('points', None)
                   ).pack(side='left', padx=(4, 0))
        # 1.41：登录账号名（读积分时顺带从 TRAE 账号菜单提取）
        self.account = ''
        ttk.Label(bar, text='   账号:').pack(side='left')
        self.lbl_acct = ttk.Label(bar, text='—', foreground='#1565c0')
        self.lbl_acct.pack(side='left')

        # 1.00：远程状态灯（客户端连上同一频道即远控本机 TRAE）
        if not HAS_WS:
            _rt, _rc = '✘ 未装库', '#ef6c00'
        elif not CFG.get('ws_on', True):
            _rt, _rc = '已关闭', '#888888'
        else:
            _rt, _rc = '…', '#888888'
        self.lbl_remote = ttk.Label(bar, text='🌐 远程:%s' % _rt,
                                     foreground=_rc)
        self.lbl_remote.pack(side='left', padx=(10, 0))
        # 1.21：一键打开手机版网页客户端（GitHub Pages · gittest）
        ttk.Button(bar, text='📱 网页版', width=8,
                   command=self._open_web).pack(side='left', padx=(6, 0))
        self.lbl_state = ttk.Label(bar, text='')
        self.lbl_state.pack(side='right')
        self._bar_ref = bar

        # 工具行：目标切换 + 端口扫描 + 导出
        tools = ttk.Frame(pg, padding=(8, 1))
        tools.pack(fill='x')
        ttk.Label(tools, text='目标:').pack(side='left')
        self.cmb = ttk.Combobox(tools, state='readonly', width=26,
                                values=self.box_names,
                                font=('Microsoft YaHei', 9))
        self.cmb.set(self.box_name)
        self.cmb.pack(side='left', padx=(3, 10))
        self.cmb.bind('<<ComboboxSelected>>', self._switch_box)
        self.lbl_ports = ttk.Label(tools, text='端口扫描中…',
                                   foreground='#888888')
        self.lbl_ports.pack(side='left')
        # 模型切换（2.07）：列表连接后自动读；选中即切换
        ttk.Label(tools, text='  模型:').pack(side='left')
        self.cmb_model = ttk.Combobox(tools, state='readonly', width=18,
                                      font=('Microsoft YaHei', 9))
        self.cmb_model.pack(side='left', padx=(3, 10))
        self.cmb_model.bind('<<ComboboxSelected>>', self._on_model_pick)
        ttk.Button(tools, text='导出…', width=8,
                   command=self._export_menu).pack(side='right')
        # 启动按钮：当前目标未连接时可点，一键带调试端口拉起
        self.btn_launch = ttk.Button(tools, text='启动 TRAE', width=10,
                                     command=self._launch_current)
        self.btn_launch.pack(side='right', padx=(6, 0))
        # 1.07：重启按钮——无论端口是否在线，先关闭当前目标再带端口
        # 拉起（TRAE 卡死但端口还活着时，「启动」只报已在线救不了）
        ttk.Button(tools, text='重启 TRAE', width=9,
                   command=self._reboot_current).pack(side='right',
                                                      padx=(6, 0))
        # 1.29：操控互斥快速开关——主界面直接勾/取消勾（默认勾选），
        # 即时落盘生效，方便调试时临时放开「只许一个网页版操控」限制；
        # 设置页里的同名开关与它双向同步
        self.var_lockq = tk.BooleanVar(
            value=bool(_ensure_cfg().get('lock_on', True)))
        ttk.Checkbutton(tools, text='🔒 操控互斥',
                        variable=self.var_lockq,
                        command=self._on_lock_toggle).pack(side='right',
                                                           padx=(6, 0))

        # 底部输入行（2.10 修复：必须先于 mid pack 且 side='bottom'
        # 抢占底边——mid 的 Text 默认 24 行自然高度 ~550px 会先把
        # 960x600 的腔体吃光，本行被挤成 1x1 完全不可见，最大化才出现）
        bottom = ttk.Frame(pg, padding=(8, 6))
        bottom.pack(side='bottom', fill='x')
        # 2.15：📎 附件按钮（选文件→DOM.setFileInputFiles 直投
        # TRAE 输入栏，chips 行回显；随「发送」一并发出）
        self.btn_attach = ttk.Button(bottom, text='📎', width=3,
                                     command=self._on_attach_pick)
        self.btn_attach.pack(side='left', padx=(0, 4))
        # 1.05：📂 工作台路径一键选择——文件/文件夹路径插入输入框
        # （发送的是路径文本，AI 按路径自己读，不传内容）
        self.btn_bench = ttk.Button(bottom, text='📂', width=3,
                                    command=self._on_bench_pick)
        self.btn_bench.pack(side='left', padx=(0, 4))
        # 聚焦时增高（约5倍）的多行输入框：Enter 发送，Shift+Enter 换行
        self.ent = tk.Text(bottom, height=1, wrap='word',
                           font=('Microsoft YaHei', 10))
        self.ent.pack(side='left', fill='x', expand=True, ipady=3)
        self.ent.bind('<Return>', self._on_send_ret)
        self.ent.bind('<Shift-Return>', self._ent_newline)
        self.ent.bind('<FocusIn>', lambda e: self._ent_fit())
        self.ent.bind('<FocusOut>', lambda e: self.ent.configure(height=1))
        self.ent.bind('<KeyRelease>', lambda e: self._ent_fit())
        self.btn_send = ttk.Button(bottom, text='发送', width=8,
                                   command=self._on_send)
        self.btn_send.pack(side='left', padx=(6, 0))
        self.btn_stop = ttk.Button(bottom, text='停止', width=6,
                                    state='disabled',
                                    command=self._stop_manual)
        self.btn_stop.pack(side='left', padx=(6, 0))

        # 2.15：附件 chips 行（bottom 上方；无附件时隐藏）——上传中
        # 灰色占位，成功后按 TRAE 真实状态回显（📎 名称 大小 ✕），
        # ✕ 点击即移除（点 TRAE 里的 item-remove），发送后自动消失
        self._attach_pending = None      # 上传中：[basename, ...]
        self._attach_fp = ''            # chips 内容指纹（防每 tick 重建）
        self.attach_row = ttk.Frame(pg)
        # （pack/pack_forget 由 _render_attach 按需控制）

        # 中部：左会话列表 + 右消息区
        mid = ttk.Frame(pg, padding=(8, 6))
        mid.pack(fill='both', expand=True)
        # 2.15：attach_row 动态 pack 必须插在 mid 之前（before=）——
        # mid expand 吃光腔体，后 pack 不插队会重演 v2.10 的 1x1 挤压
        self._mid_ref = mid

        # 会话列表
        left = ttk.Frame(mid)
        left.pack(side='left', fill='y', padx=(0, 6))
        ttk.Label(left, text='会话列表').pack(anchor='w')
        self.lst = tk.Listbox(left, width=22, activestyle='none',
                              exportselection=False,
                              font=('Microsoft YaHei', 9))
        self.lst.pack(fill='both', expand=True)
        self.lst.bind('<<ListboxSelect>>', self._on_pick)
        self.lst.bind('<Button-3>', self._on_lst_menu)   # 1.10：文件夹右键
        btns = ttk.Frame(left)
        btns.pack(fill='x', pady=(4, 0))
        # 1.10：新建任务 → 弹窗指定工作目录（抓 TRAE 回填特征再弹窗）
        ttk.Button(btns, text='新建任务', width=10,
                   command=self._on_new_task).pack(side='left')

        # 消息区（白纸黑字 + markdown 标签，白底可读性优先）
        self.body = tk.Text(mid, bd=0, relief='flat', wrap='word',
                            background='#FFFFFF', foreground='#1a1a1a',
                            font=('Microsoft YaHei', 10), state='disabled',
                            padx=10, pady=8)
        body_scroll = ttk.Scrollbar(mid, command=self.body.yview)
        self.body.configure(yscrollcommand=body_scroll.set)
        self.body.pack(side='left', fill='both', expand=True)
        body_scroll.pack(side='left', fill='y')
        # 消息色带（气泡底色）：必须最先创建保持低优先级，
        # 代码块等自带背景的标签在后创建才能盖过色带（Tk 同选项
        # 后创建者优先）。覆盖范围含换行符 → 整行铺色成气泡条。
        self.body.tag_configure('ubg', background='#e3f0fb',
                                lmargin1=14, lmargin2=14, rmargin=14,
                                spacing3=2)
        self.body.tag_configure('abg', background='#eff7ef',
                                lmargin1=14, lmargin2=14, rmargin=14,
                                spacing3=2)
        self.body.tag_configure('u', foreground='#1565c0',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('a', foreground='#0a7d32',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('txt', foreground='#1a1a1a')
        self.body.tag_configure('code', foreground='#9c4221',
                                background='#f0f0f0',
                                font=('Consolas', 9),
                                lmargin1=26, lmargin2=26)
        self.body.tag_configure('icode', foreground='#9c4221',
                                background='#ececec',
                                font=('Consolas', 9))
        self.body.tag_configure('bold',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('h2', foreground='#0d47a1',
                                font=('Microsoft YaHei', 11, 'bold'))
        self.body.tag_configure('h3', foreground='#1565c0',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('li', foreground='#1a1a1a',
                                lmargin1=26, lmargin2=38)
        self.body.tag_configure('time', foreground='#8a8a8a',
                                font=('Microsoft YaHei', 8))
        # 2.11：任务完成块（✅ 加粗绿 / 生成物文件名小号绿）
        self.body.tag_configure('fin', foreground='#0a7d32',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('finf', foreground='#0a7d32',
                                font=('Microsoft YaHei', 9))
        # 1.14：待确认占位气泡（虚线感：浅蓝底 + 斜体蓝字 + 状态徽标）
        self.body.tag_configure('pbg', background='#eaf4fd',
                                font=('Microsoft YaHei', 10, 'italic'),
                                lmargin1=6, lmargin2=6, rmargin=6)
        self.body.tag_configure('pu', foreground='#1565c0',
                                font=('Microsoft YaHei', 10, 'bold'))
        self.body.tag_configure('pstat', foreground='#ef6c00',
                                font=('Microsoft YaHei', 8, 'bold'))
        self.body.tag_configure('pstat_bad', foreground='#c62828',
                                font=('Microsoft YaHei', 8, 'bold'))
        self.body.tag_configure('pstat_ok', foreground='#0a7d32',
                                font=('Microsoft YaHei', 8, 'bold'))

    # ---- 设置页（2.09：重要路径 / 窗口 / 运行选项） ----

    def _build_set(self, pg):
        # 底部固定操作栏（按钮居中）：打开所在 / 重启应用 / 保存配置
        bar = ttk.Frame(pg, padding=(6, 8))
        bar.pack(fill='x', side='bottom')
        inner = ttk.Frame(bar)
        inner.pack(expand=True)
        ttk.Button(inner, text='打开所在', width=10,
                   command=self._open_appdir).pack(side='left', padx=4)
        if self._own_root:
            ttk.Button(inner, text='重启应用', width=10,
                       command=self._restart_app).pack(side='left',
                                                       padx=4)
        self.btn_save = ttk.Button(inner, text='保存配置', width=10,
                                   state='disabled',
                                   command=self._save_settings)
        self.btn_save.pack(side='left', padx=4)

        # 1.19：设置页改为「可滚动 + 两列」——参数持续增多（本次新增
        # 采集与响应 / TRAE 连接两区），固定视口迟早装不下；Canvas+
        # Scrollbar 纵向滚动，滚轮悬停区域内生效（Enter/Leave 挂全局
        # 避免子控件吞滚轮事件）。
        wrap = ttk.Frame(pg, padding=(10, 8))
        wrap.pack(fill='both', expand=True)
        canvas = tk.Canvas(wrap, highlightthickness=0)
        vs = ttk.Scrollbar(wrap, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=vs.set)
        vs.pack(side='right', fill='y')
        canvas.pack(side='left', fill='both', expand=True)
        body = ttk.Frame(canvas)
        canvas.create_window((0, 0), window=body, anchor='nw',
                             tags='inner')
        canvas.bind('<Configure>', lambda e:
                    canvas.itemconfigure('inner', width=e.width))
        body.bind('<Configure>',
                  lambda e: canvas.configure(
                      scrollregion=canvas.bbox('all')))

        def _wheel(e):
            canvas.yview_scroll(-1 * int(e.delta / 120), 'units')

        canvas.bind('<Enter>', lambda e: canvas.bind_all(
            '<MouseWheel>', _wheel))
        canvas.bind('<Leave>', lambda e: canvas.unbind_all('<MouseWheel>'))

        # 1.18：两列布局 + uniform 保证两列等宽；滚动模式下行高自适应
        # （weight=0，sticky='new' 顶对齐即可）
        body.columnconfigure(0, weight=1, uniform='setcol')
        body.columnconfigure(1, weight=1, uniform='setcol')

        def _cell(lf, r, c):
            lf.grid(row=r, column=c, sticky='new',
                    padx=(0, 6), pady=(0, 8))

        # —— 重要路径 ——（提示词库：不硬编码、智能寻找、随时修改）
        lf_path = ttk.LabelFrame(body, text=' 重要路径 ', padding=(8, 6))
        _cell(lf_path, 0, 0)
        self.var_trae = tk.StringVar(value=CFG.get('trae_exe') or '')
        self.var_sbx = tk.StringVar(value=CFG.get('sandman') or '')
        self.st_trae = self._mk_path_row(
            lf_path, '原版TRAE主程序', self.var_trae, self._browse_trae,
            self._autofind_trae)
        self.st_sbx = self._mk_path_row(
            lf_path, 'Sandboxie主程序', self.var_sbx, self._browse_sbx,
            self._autofind_sbx)
        ttk.Label(lf_path, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='留空=自动寻找（配置→桌面快捷方式→运行中的TRAE进程→'
                       '默认位置）；Sandboxie的start.exe同目录自动推导。'
                       '\n启动10秒后自动校验：失效的自动找，找到提醒采用，'
                       '找不到弹窗手动指定。').pack(anchor='w', pady=(4, 0))

        # —— 窗口 ——
        lf_win = ttk.LabelFrame(body, text=' 窗口 ', padding=(8, 6))
        _cell(lf_win, 0, 1)
        self.var_remember = tk.BooleanVar(
            value=bool(CFG.get('remember_win', True)))
        ttk.Checkbutton(lf_win, text='记住上次大小位置（拖动/缩放立刻'
                                     '保存，重启后恢复）',
                        variable=self.var_remember,
                        command=self._dirty).pack(anchor='w')
        self.var_openhome = tk.BooleanVar(
            value=bool(CFG.get('open_home', True)))
        ttk.Checkbutton(lf_win, text='启动打开主页（不打勾=恢复最后'
                                     '使用的分页）',
                        variable=self.var_openhome,
                        command=self._dirty).pack(anchor='w')

        # —— 运行 ——
        lf_run = ttk.LabelFrame(body, text=' 运行 ', padding=(8, 6))
        _cell(lf_run, 1, 1)
        self.var_nomulti = tk.BooleanVar(
            value=bool(CFG.get('no_multi', True)))
        ttk.Checkbutton(lf_run, text='禁止多开（同一时间只允许一个实例，'
                                     '重启软件后生效）',
                        variable=self.var_nomulti,
                        command=self._dirty).pack(anchor='w')
        # 1.16→1.18：TRAE 可见性看护（exp6 实测：窗口只要可见（被遮
        # 挡无妨）远程控制就流畅；最小化/托盘即渲染冻结）
        self.var_keepvis = tk.BooleanVar(
            value=bool(CFG.get('keep_visible', True)))
        ttk.Checkbutton(lf_run, text='TRAE 保持可见（最小化/进托盘自动'
                                     '无焦点弹回，不抢当前焦点）',
                        variable=self.var_keepvis,
                        command=self._dirty).pack(anchor='w')
        # 1.24：远程操控互斥（1.25：本机只被网页端等远端操控，同一
        # 时刻仍只允许一个操控者）
        self.var_lockon = tk.BooleanVar(
            value=bool(CFG.get('lock_on', True)))
        ttk.Checkbutton(lf_run, text='远程操控互斥（本服务端同一时刻只'
                                     '允许一个远端操控者，按 FOX 发送'
                                     '者 ID 锁定）',
                        variable=self.var_lockon,
                        command=self._dirty).pack(anchor='w')
        rowlk = ttk.Frame(lf_run)
        rowlk.pack(fill='x', pady=(2, 0))
        ttk.Label(rowlk, text='占用释放').pack(side='left')
        self.var_locksec = tk.StringVar(value=str(CFG.get('lock_sec', 60)))
        sblk = ttk.Spinbox(rowlk, from_=10, to=600, width=5,
                           textvariable=self.var_locksec,
                           command=self._dirty)
        sblk.pack(side='left', padx=4)
        sblk.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(rowlk, text='秒无操作自动释放（操控者切走/退出即还锁'
                              '，期间其他操控者被拒绝）').pack(side='left')
        ttk.Label(lf_run, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='分身列表=桌面沙盒快捷方式+Sandboxie.ini盒名自动'
                       '合并；📌标签行右侧图钉=置顶开关（即时生效）。'
                  ).pack(anchor='w', pady=(4, 0))

        # —— 完成提醒 ——（2.12：任务结束弹窗 + 结束→空闲过渡）
        lf_fin = ttk.LabelFrame(body, text=' 完成提醒 ', padding=(8, 6))
        _cell(lf_fin, 1, 0)
        self.var_finpop = tk.BooleanVar(
            value=bool(CFG.get('fin_popup', True)))
        ttk.Checkbutton(lf_fin, text='任务完成弹窗提醒（生成中转为空闲时'
                                     '弹出，自动关闭）',
                        variable=self.var_finpop,
                        command=self._dirty).pack(anchor='w')
        row1 = ttk.Frame(lf_fin)
        row1.pack(fill='x', pady=(4, 0))
        ttk.Label(row1, text='弹窗自动关闭').pack(side='left')
        self.var_finsec = tk.StringVar(value=str(CFG.get('fin_popup_sec',
                                                         5)))
        sb1 = ttk.Spinbox(row1, from_=1, to=300, width=5,
                          textvariable=self.var_finsec,
                          command=self._dirty)
        sb1.pack(side='left', padx=4)
        sb1.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(row1, text='秒').pack(side='left')
        ttk.Label(row1, text='结束→空闲过渡').pack(side='left',
                                                  padx=(16, 0))
        self.var_finidle = tk.StringVar(value=str(CFG.get('fin_idle_sec',
                                                          15)))
        sb2 = ttk.Spinbox(row1, from_=0, to=600, width=5,
                          textvariable=self.var_finidle,
                          command=self._dirty)
        sb2.pack(side='left', padx=4)
        sb2.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(row1, text='秒').pack(side='left')
        ttk.Label(lf_fin, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='结束→空闲：任务刚结束状态栏显示「✅ 结束」，'
                       '过渡秒数到点后转「空闲」；过渡 0 秒=不区分。'
                  ).pack(anchor='w', pady=(4, 0))

        # —— 防呆 ——（1.03：生成中长时间无动静自动续跑）
        lf_wd = ttk.LabelFrame(body, text=' 防呆 ', padding=(8, 6))
        _cell(lf_wd, 2, 0)
        self.var_wdon = tk.BooleanVar(
            value=bool(CFG.get('watchdog_on', True)))
        ttk.Checkbutton(lf_wd, text='生成中长时间无动静自动续跑'
                                     '（先点终止，再发「继续」）',
                        variable=self.var_wdon,
                        command=self._dirty).pack(anchor='w')
        row = ttk.Frame(lf_wd)
        row.pack(fill='x', pady=(4, 0))
        ttk.Label(row, text='无动静阈值').pack(side='left')
        self.var_wdmin = tk.StringVar(value=str(CFG.get('watchdog_min',
                                                        15)))
        sb = ttk.Spinbox(row, from_=1, to=600, width=5,
                         textvariable=self.var_wdmin,
                         command=self._dirty)
        sb.pack(side='left', padx=4)
        sb.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(row, text='分钟').pack(side='left')
        ttk.Label(row, text='终止后发「继续」延迟').pack(side='left',
                                                      padx=(16, 0))
        self.var_wdsec = tk.StringVar(value=str(CFG.get(
            'watchdog_resend_sec', 5)))
        sb2 = ttk.Spinbox(row, from_=1, to=120, width=5,
                          textvariable=self.var_wdsec,
                          command=self._dirty)
        sb2.pack(side='left', padx=4)
        sb2.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(row, text='秒').pack(side='left')
        ttk.Label(lf_wd, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='AI 卡住（生成中但输出长时间不变化）达阈值即自动'
                       '终止并续跑；改动即时生效，巡检 10 秒一次。'
                  ).pack(anchor='w', pady=(4, 0))

        # —— TRAE 连接 ——（1.19：调试端口入 UI，原为固定约定 9599）
        lf_cdp = ttk.LabelFrame(body, text=' TRAE 连接 ', padding=(8, 6))
        _cell(lf_cdp, 2, 1)
        rowp = ttk.Frame(lf_cdp)
        rowp.pack(fill='x')
        ttk.Label(rowp, text='原版 TRAE 调试端口').pack(side='left')
        self.var_oport = tk.StringVar(value=str(_orig_port()))
        sbp = ttk.Spinbox(rowp, from_=1024, to=65535, width=7,
                          textvariable=self.var_oport,
                          command=self._dirty)
        sbp.pack(side='left', padx=4)
        sbp.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(lf_cdp, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='CDP 远程调试端口（默认 9599）。改端口后点「重启」'
                       '按钮：本工具会带新端口重新拉起 TRAE；分身端口'
                       '固定 9600+盒号不受影响。'
                  ).pack(anchor='w', pady=(4, 0))

        # —— 工作台 ——（1.05：📂 一键选路径的根目录）
        lf_bench = ttk.LabelFrame(body, text=' 工作台 ', padding=(8, 6))
        _cell(lf_bench, 3, 1)
        rowb = ttk.Frame(lf_bench)
        rowb.pack(fill='x')
        ttk.Label(rowb, text='📂 根目录').pack(side='left')
        self.var_benchroot = tk.StringVar(
            value=CFG.get('bench_root', BENCH_DEFAULT))
        ttk.Entry(rowb, textvariable=self.var_benchroot).pack(
            side='left', fill='x', expand=True, padx=6)
        ttk.Button(rowb, text='浏览…', width=7,
                   command=self._browse_bench).pack(side='left')
        ttk.Label(lf_bench, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='输入行「📂」文件树从这里起步（⬆ 可出根），选定'
                       '文件/目录把路径插入输入框发送（发的是路径文本，'
                       'AI 按路径自己读）；远程客户端的目录浏览也以此'
                       '为根。'
                  ).pack(anchor='w', pady=(4, 0))
        # —— 采集与响应 ——（1.19：调试期摸索出的节奏参数入 UI）
        lf_tune = ttk.LabelFrame(body, text=' 采集与响应 ', padding=(8, 6))
        _cell(lf_tune, 3, 0)
        rowt = ttk.Frame(lf_tune)
        rowt.pack(fill='x')
        ttk.Label(rowt, text='快照轮询间隔').pack(side='left')
        self.var_poll = tk.StringVar(value=str(CFG.get('poll_sec', 0.8)))
        sbt = ttk.Spinbox(rowt, from_=0.2, to=5.0, increment=0.1,
                          width=5, textvariable=self.var_poll,
                          command=self._dirty)
        sbt.pack(side='left', padx=4)
        sbt.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(rowt, text='秒').pack(side='left')
        ttk.Label(rowt, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='（改后即时生效）').pack(side='left', padx=(8, 0))
        rowt2 = ttk.Frame(lf_tune)
        rowt2.pack(fill='x', pady=(4, 0))
        # 1.39：「发送确认超时」控件移除——占位不再超时（插话走
        # 官方排队，AI 忙时多久入列都正常，用户要求无限制）
        ttk.Label(rowt2, text='切换兜底超时').pack(side='left')
        self.var_pendsw = tk.StringVar(
            value=str(CFG.get('pend_switch_sec', 6)))
        sbt3 = ttk.Spinbox(rowt2, from_=3, to=60, width=5,
                           textvariable=self.var_pendsw,
                           command=self._dirty)
        sbt3.pack(side='left', padx=4)
        sbt3.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(rowt2, text='秒').pack(side='left')
        # 1.37：发送确认匹配参数（前 N 字相同 / 只认 N 秒内新消息）
        rowt3 = ttk.Frame(lf_tune)
        rowt3.pack(fill='x', pady=(4, 0))
        ttk.Label(rowt3, text='确认匹配字数').pack(side='left')
        self.var_pendhead = tk.StringVar(
            value=str(CFG.get('pend_head', 100)))
        sbt4 = ttk.Spinbox(rowt3, from_=10, to=500, width=5,
                           textvariable=self.var_pendhead,
                           command=self._dirty)
        sbt4.pack(side='left', padx=4)
        sbt4.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(rowt3, text='字').pack(side='left')
        ttk.Label(rowt3, text='消息出现时限').pack(side='left',
                                                  padx=(16, 0))
        self.var_pendage = tk.StringVar(
            value=str(CFG.get('pend_age_sec', 30)))
        sbt5 = ttk.Spinbox(rowt3, from_=5, to=600, width=5,
                           textvariable=self.var_pendage,
                           command=self._dirty)
        sbt5.pack(side='left', padx=4)
        sbt5.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Label(rowt3, text='秒（只认 N 秒内新出现的消息，'
                              '防与历史同开头老消息误配）'
                  ).pack(side='left')
        ttk.Label(lf_tune, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='轮询间隔小=手机端消息更及时、CPU 略高（卡顿可调\n'
                       '大）；发送超时=发出后 TRAE 消息区迟迟不出现就标\n'
                       '「未确认」；切换兜底=快照对账失败后最迟多久撤提示。'
                  ).pack(anchor='w', pady=(4, 0))


        # 1.02：远程服务区移至「网络」分页
        self._refresh_path_states()

    # —— 1.02 网络分页：远程服务 + WS 流量统计 ——

    NET_TICK_MS = 2000        # 今日流量数字刷新间隔（毫秒）
    NET_FLUSH_TICKS = 15      # 每 15 tick（≈30 秒）落盘一次并刷新历史表

    def _build_net(self, pg):
        body = ttk.Frame(pg, padding=(10, 8))
        body.pack(fill='both', expand=True)

        # —— 远程服务（自设置页移入）——
        lf_ws = ttk.LabelFrame(body, text=' 远程服务 ', padding=(8, 6))
        lf_ws.pack(fill='x')
        self.var_wson = tk.BooleanVar(value=bool(CFG.get('ws_on', True)))
        ttk.Checkbutton(lf_ws, text='开启远程服务（WebSocket 桥，重启'
                                    '软件后生效）',
                        variable=self.var_wson,
                        command=self._net_dirty).pack(anchor='w')
        self.var_fox = tk.BooleanVar(value=bool(CFG.get('fox_on', True)))
        ttk.Checkbutton(lf_ws, text='启用 FOX 分段协议（大消息自动切段 '
                                    '≤10KB/段，防中继 16KB 上限丢包；'
                                    '取消后仅 ≤16KB 消息可通）',
                        variable=self.var_fox,
                        command=self._net_dirty).pack(anchor='w')
        _saved_url = CFG.get('ws_url') or ''
        if '/v3/TRAE?' in _saved_url:            # 1.41：旧默认频道作废
            _saved_url = ''
        self.var_wsurl = tk.StringVar(
            value=_saved_url or (WS_URL_TMPL % WS_CHANNEL))
        row = ttk.Frame(lf_ws)
        row.pack(fill='x', pady=(4, 0))
        ttk.Label(row, text='服务地址', width=13).pack(side='left')
        ent = ttk.Entry(row, textvariable=self.var_wsurl,
                        font=('Microsoft YaHei', 9))
        ent.pack(side='left', fill='x', expand=True, padx=(2, 4))
        ent.bind('<KeyRelease>', lambda e: self._net_dirty())
        # 1.23：服务器名称（多服务端唯一标识；改重名保存会被拒绝）
        rown = ttk.Frame(lf_ws)
        rown.pack(fill='x', pady=(4, 0))
        ttk.Label(rown, text='服务器名称', width=13).pack(side='left')
        self.var_srvname = tk.StringVar(value=_srv_name())
        entn = ttk.Entry(rown, textvariable=self.var_srvname, width=22,
                         font=('Microsoft YaHei', 9))
        entn.pack(side='left', padx=(2, 4))
        entn.bind('<KeyRelease>', lambda e: self._net_dirty())
        ttk.Label(lf_ws, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='远程客户端连同一频道即可远控本机 TRAE（频道 %s，'
                       '默认 PieSocket 免费中继）。改地址则两边须一致；'
                       'FOX 开关两边也须一致。'
                  % WS_CHANNEL).pack(anchor='w', pady=(4, 0))
        # 1.23：在线服务端清单（心跳 20s/超时 75s）
        self.lbl_srvs = ttk.Label(lf_ws, foreground='#0a5aa8',
                                  font=('Microsoft YaHei', 8),
                                  text='在线服务端：仅本章')
        self.lbl_srvs.pack(anchor='w', pady=(2, 0))

        # —— 流量统计（今日收发字节+条数 + 按天记录可调保留）——
        lf_st = ttk.LabelFrame(body, text=' 流量统计（WebSocket） ',
                               padding=(8, 6))
        lf_st.pack(fill='both', expand=True, pady=(8, 0))
        self.lbl_net_today = ttk.Label(
            lf_st, text='今日  收 0 B·0 条   发 0 B·0 条',
            font=('Microsoft YaHei', 11, 'bold'),
            foreground='#0a5aa8')
        self.lbl_net_today.pack(anchor='w')

        row1 = ttk.Frame(lf_st)
        row1.pack(fill='x', pady=(6, 0))
        ttk.Label(row1, text='保留天数', width=13).pack(side='left')
        self.var_keep = tk.StringVar(value=str(CFG.get('stats_keep', 100)))
        sp = ttk.Spinbox(row1, from_=1, to=3650, width=6,
                         textvariable=self.var_keep,
                         command=self._net_dirty)
        sp.pack(side='left', padx=(2, 4))
        sp.bind('<KeyRelease>', lambda e: self._net_dirty())
        ttk.Label(row1, foreground='#8a8a8a',
                  font=('Microsoft YaHei', 8),
                  text='按天记录收/发流量，超期自动清理；'
                       '30 秒落盘一次，退出兜底再存。'
                  ).pack(side='left', padx=(6, 0))

        self.tv_net = ttk.Treeview(
            lf_st, columns=('day', 'rx', 'rxn', 'tx', 'txn'),
            show='headings', height=8)
        for col, txt, w, anc in (
                ('day', '日期', 100, 'w'), ('rx', '收', 90, 'e'),
                ('rxn', '收(条)', 70, 'e'), ('tx', '发', 90, 'e'),
                ('txn', '发(条)', 70, 'e')):
            self.tv_net.heading(col, text=txt)
            self.tv_net.column(col, width=w, anchor=anc)
        self.tv_net.pack(fill='both', expand=True, pady=(6, 0))

        # 页底保存
        bot = ttk.Frame(body)
        bot.pack(fill='x', pady=(8, 0))
        self.btn_netsave = ttk.Button(bot, text='保存', width=8,
                                      state='disabled',
                                      command=self._save_net)
        self.btn_netsave.pack(side='right')
        self.lbl_netflash = ttk.Label(bot, text='')
        self.lbl_netflash.pack(side='right', padx=(0, 8))

        self._net_ticks = 0
        self._net_job = None
        self._net_refresh_hist()
        self._net_tick()             # 启动刷新循环

    def _net_dirty(self):
        self.btn_netsave.config(state='normal')

    def _save_net(self):
        """网络页保存：远程服务开关/地址/服务器名称 + FOX 开关 +
        流量保留天数。1.23：名称与在线远方服务端重名拒绝保存。"""
        name = self.var_srvname.get().strip()
        if not name:
            self.lbl_netflash.config(text='服务器名称不能为空',
                                     foreground='#c62828')
            return
        if len(name) > 20:
            self.lbl_netflash.config(text='服务器名称最长 20 个字',
                                     foreground='#c62828')
            return
        if name != _srv_name() and name in self._srv_peers:
            self.lbl_netflash.config(
                text='✘ 与在线服务端 [%s] 重名，必须改名' % name,
                foreground='#c62828')
            return
        renamed = name != _srv_name()
        CFG['ws_on'] = bool(self.var_wson.get())
        CFG['fox_on'] = bool(self.var_fox.get())
        CFG['ws_url'] = self.var_wsurl.get().strip()
        CFG['srv_name'] = name
        try:
            CFG['stats_keep'] = max(1, int(self.var_keep.get()))
        except Exception:
            CFG['stats_keep'] = 100
        _save_cfg(CFG)
        if renamed:
            _set_srv_name(name)
            self.srv_name = name
            self.bridge.announce()       # 立即以新名字广播
            self._rebuild_targets()
            self.title('%s  v%s  [%s·%s]' % (
                APP_NAME, VERSION, self.box_name, name))
        self.btn_netsave.config(state='disabled')
        _stats_flush()               # 立即按新保留天数清理并落盘
        self._net_refresh_hist()
        self.lbl_netflash.config(text='已保存', foreground='#0a7d32')
        self.after(3000, lambda: self.lbl_netflash.config(text=''))

    def _net_tick(self):
        """网络页刷新循环：2 秒更新今日收/发（字节+条数）；每 15 次
        （≈30 秒）落盘并刷新历史表。"""
        try:
            day = time.strftime('%Y-%m-%d')
            with _STATS_LOCK:
                b = _stats_load()['days'].get(day) or {}
                rx, tx = b.get('rx', 0), b.get('tx', 0)
                rxn, txn = b.get('rxn', 0), b.get('txn', 0)
            # 1.23：在线服务端清单（网络页实时可见）
            if hasattr(self, 'lbl_srvs'):
                names = sorted(self._srv_peers)
                self.lbl_srvs.config(
                    text=('在线服务端：%s（含本章，%d 个）'
                          % ('、'.join([self.srv_name or '本章'] + names),
                             len(names) + 1))
                    if names else '在线服务端：仅本章')
            self.lbl_net_today.config(
                text='今日  收 %s·%d 条   发 %s·%d 条'
                     % (_fmt_bytes(rx), rxn, _fmt_bytes(tx), txn))
            self._net_ticks += 1
            if self._net_ticks >= self.NET_FLUSH_TICKS:
                self._net_ticks = 0
                _stats_flush()
                self._net_refresh_hist()
        except Exception:
            pass
        self._net_job = self.after(self.NET_TICK_MS, self._net_tick)

    def _net_refresh_hist(self):
        """历史记录表刷新（倒序今天在最上，只显示保留期内天数）。"""
        try:
            self.tv_net.delete(*self.tv_net.get_children())
            with _STATS_LOCK:
                days = dict(_stats_load()['days'])
            keep = _stats_keep()
            for d in sorted(days, reverse=True)[:keep]:
                b = days.get(d) or {}
                self.tv_net.insert('', 'end', iid=d, values=(
                    d, _fmt_bytes(b.get('rx', 0)), b.get('rxn', 0),
                    _fmt_bytes(b.get('tx', 0)), b.get('txn', 0)))
        except Exception:
            pass

    def _mk_path_row(self, parent, label, var, browse_cmd, find_cmd):
        """重要路径一行：标签 + 输入框 + 浏览… + 自动寻找 + 状态灯"""
        row = ttk.Frame(parent)
        row.pack(fill='x', pady=2)
        ttk.Label(row, text=label, width=13).pack(side='left')
        ent = ttk.Entry(row, textvariable=var,
                        font=('Microsoft YaHei', 9))
        ent.pack(side='left', fill='x', expand=True, padx=(2, 4))
        ent.bind('<KeyRelease>', lambda e: self._dirty())
        ttk.Button(row, text='浏览…', width=7,
                   command=browse_cmd).pack(side='left', padx=(0, 3))
        ttk.Button(row, text='自动寻找', width=8,
                   command=find_cmd).pack(side='left', padx=(0, 3))
        st = ttk.Label(row, text='', width=4,
                       font=('Microsoft YaHei', 9, 'bold'))
        st.pack(side='left')
        return st

    def _refresh_path_states(self):
        """两条重要路径的状态灯：✓已配置/✓自动(绿)、✘未找到(红)"""
        for var, st, eff in (
                (self.var_trae, self.st_trae,
                 lambda: find_host_trae_exe(self.boxes)),
                (self.var_sbx, self.st_sbx,
                 lambda: (_sbx() or {}).get('sandman'))):
            p = var.get().strip()
            if p and os.path.isfile(p):
                st.config(text='✓', foreground='#0a7d32')
            elif p:
                st.config(text='✘', foreground='#c62828')
            else:
                try:
                    ok = bool(eff() and os.path.isfile(eff()))
                except Exception:
                    ok = False
                st.config(text='✓自动' if ok else '✘',
                          foreground='#0a7d32' if ok else '#c62828')

    # —— 设置页：路径浏览 / 自动寻找 ——

    def _browse_trae(self):
        p = filedialog.askopenfilename(
            parent=self, title='指定原版 TRAE 主程序',
            filetypes=[('TRAE 主程序', '*.exe'), ('所有文件', '*.*')])
        if p:
            self.var_trae.set(os.path.normpath(p))
            self._dirty()
            self._refresh_path_states()

    def _browse_sbx(self):
        p = filedialog.askopenfilename(
            parent=self, title='指定 Sandboxie 主程序 SandMan.exe',
            filetypes=[('SandMan.exe', 'SandMan.exe'),
                       ('所有文件', '*.*')])
        if p:
            self.var_sbx.set(os.path.normpath(p))
            self._dirty()
            self._refresh_path_states()

    def _autofind_trae(self):
        p = find_host_trae_exe(self.boxes)
        if p:
            self.var_trae.set(p)
            self._flash('已找到：%s（点「保存配置」生效）' % p, '#0a7d32')
        else:
            self._flash('未找到原版 TRAE 主程序，请用「浏览…」手动指定')
        self._dirty()
        self._refresh_path_states()

    def _autofind_sbx(self):
        _SBX.update({'done': False, 'sandman': None,
                     'start': None, 'ini': None})
        p = _sbx()['sandman']
        if p and os.path.isfile(p):
            self.var_sbx.set(p)
            self._flash('已找到：%s（点「保存配置」生效）' % p, '#0a7d32')
        else:
            self._flash('未找到 Sandboxie 主程序，请用「浏览…」手动指定')
        self._dirty()
        self._refresh_path_states()

    def _browse_bench(self):
        """1.05：设置页浏览工作台根目录"""
        p = filedialog.askdirectory(parent=self, title='选择工作台根目录')
        if p:
            self.var_benchroot.set(os.path.normpath(p))
            self._dirty()

    # —— 设置页：保存 / 打开所在 / 重启应用 ——

    def _on_lock_toggle(self):
        """1.29：工具行「🔒 操控互斥」快速开关——勾=同一时刻只允许
        一个远端（网页版）操控本机；取消勾=放开限制（调试用，多个
        操控者可同时发指令）。即时写配置落盘，_ctl_check 每次都现
        读 CFG，无需重启；设置页同名开关同步回显。"""
        on = bool(self.var_lockq.get())
        CFG['lock_on'] = on
        _save_cfg(CFG)
        try:
            self.var_lockon.set(on)      # 设置页开关同步（若已构建）
        except Exception:
            pass
        self._flash('🔒 操控互斥已%s（%s）' % (
            '开启' if on else '关闭——调试模式，多个远端可同时操控',
            '其他操控者将被拒绝' if on else '重启工具后恢复默认开启'),
            '#0a7d32' if on else '#ef6c00')

    def _dirty(self):
        """参数被修改后才允许点保存配置（否则灰色不可点）"""
        try:
            self.btn_save.config(state='normal')
        except Exception:
            pass

    def _save_settings(self):
        CFG['trae_exe'] = self.var_trae.get().strip()
        CFG['sandman'] = self.var_sbx.get().strip()
        CFG['remember_win'] = bool(self.var_remember.get())
        CFG['open_home'] = bool(self.var_openhome.get())
        CFG['no_multi'] = bool(self.var_nomulti.get())
        # 1.18：TRAE 可见性看护（默认勾选；关掉=允许 TRAE 待在托盘）
        CFG['keep_visible'] = bool(self.var_keepvis.get())
        # 1.24：远方操控互斥（开关 / 占用释放秒数）
        CFG['lock_on'] = bool(self.var_lockon.get())
        try:
            self.var_lockq.set(CFG['lock_on'])   # 1.29：快速开关同步
        except Exception:
            pass
        try:
            CFG['lock_sec'] = max(10, min(600,
                                          int(self.var_locksec.get())))
        except Exception:
            CFG['lock_sec'] = 60
        # 2.12：完成提醒（弹窗开关 / 弹窗关闭秒数 / 结束→空闲过渡秒数）
        CFG['fin_popup'] = bool(self.var_finpop.get())
        try:
            CFG['fin_popup_sec'] = max(1, int(self.var_finsec.get()))
        except Exception:
            CFG['fin_popup_sec'] = 5
        try:
            CFG['fin_idle_sec'] = max(0, int(self.var_finidle.get()))
        except Exception:
            CFG['fin_idle_sec'] = 15
        # 1.03：防呆（开关 / 无动静阈值分钟 / 终止后发「继续」延迟秒）
        CFG['watchdog_on'] = bool(self.var_wdon.get())
        try:
            CFG['watchdog_min'] = max(1, int(self.var_wdmin.get()))
        except Exception:
            CFG['watchdog_min'] = 15
        try:
            CFG['watchdog_resend_sec'] = max(1, int(self.var_wdsec.get()))
        except Exception:
            CFG['watchdog_resend_sec'] = 5
        # 1.05：工作台根目录（📂 一键选路径起始目录，空回落默认）
        CFG['bench_root'] = (self.var_benchroot.get().strip()
                             or BENCH_DEFAULT)
        # 1.19：采集与响应（轮询间隔/发送确认超时/切换兜底超时）
        try:
            CFG['poll_sec'] = min(5.0, max(0.2,
                                           float(self.var_poll.get())))
        except Exception:
            CFG['poll_sec'] = 0.8
        # 1.39：pend_send_sec 保存逻辑随控件一并移除（占位不超时）
        try:
            CFG['pend_switch_sec'] = max(3, int(self.var_pendsw.get()))
        except Exception:
            CFG['pend_switch_sec'] = 6
        # 1.37：发送确认匹配参数（匹配字数 / 消息出现时限）
        try:
            CFG['pend_head'] = max(10, min(500,
                                           int(self.var_pendhead.get())))
        except Exception:
            CFG['pend_head'] = 100
        try:
            CFG['pend_age_sec'] = max(5, min(600,
                                             int(self.var_pendage.get())))
        except Exception:
            CFG['pend_age_sec'] = 30
        try:      # 1.37：配置变更即时推给网页端（不用重连）
            self.bridge.send_json({
                't': 'ev', 'k': 'pendcfg',
                'v': {'head': CFG['pend_head'],
                      'age': CFG['pend_age_sec']},
                'srv': _srv_name()})
        except Exception:
            pass
        # 1.19：TRAE 连接（原版调试端口；重启生效）
        try:
            CFG['orig_port'] = max(1024, min(65535,
                                             int(self.var_oport.get())))
        except Exception:
            CFG['orig_port'] = 9599
        # 1.02：ws_on/ws_url 移至网络分页保存（_save_net）
        _save_cfg(CFG)
        # 生效：刷新 TRAE 路径 + 重置 Sandboxie 缓存（下次现探）
        self.orig_exe = find_host_trae_exe(self.boxes)
        _SBX.update({'done': False, 'sandman': None,
                     'start': None, 'ini': None})
        self._refresh_path_states()
        self.btn_save.config(state='disabled')
        self._flash('配置已保存', '#0a7d32')

    def _open_appdir(self):
        try:
            os.startfile(os.path.dirname(os.path.abspath(__file__)))
        except Exception as e:
            self._flash('打开失败：%s' % str(e)[:60])

    def _restart_app(self):
        """重启本软件（设置页底部，仅独立运行时显示）"""
        try:
            subprocess.Popen([sys.executable, os.path.abspath(__file__)])
        except Exception as e:
            self._flash('重启失败：%s' % str(e)[:60])
            return
        self._on_close()

    # —— 📌置顶图钉 / 页签记忆 / 窗口 geometry 记忆 ——

    def _toggle_top(self, _ev=None):
        top = not bool(self.attributes('-topmost'))
        self.attributes('-topmost', top)
        self.pin.config(text='📌' if top else '📍')
        CFG['topmost'] = top
        _save_cfg(CFG)

    def _on_tab(self, _ev=None):
        try:
            CFG['last_tab'] = self.nb.index('current')
            _save_cfg(CFG)
        except Exception:
            pass
        if hasattr(self, 'tv_net'):    # 1.02：进网络页即刷历史表
            self._net_refresh_hist()

    def _on_geom(self, ev):
        """拖动/缩放 → 防抖 700ms 立刻保存（不等退出）"""
        if ev.widget is not self:
            return
        if self._geom_job:
            self.after_cancel(self._geom_job)
            self._geom_job = None
        if not CFG.get('remember_win', True):
            return
        self._geom_job = self.after(700, self._save_geom_now)

    def _save_geom_now(self):
        self._geom_job = None
        try:
            if self.state() == 'normal':
                CFG['geometry'] = self.geometry()
                _save_cfg(CFG)
        except Exception:
            pass

    # —— 启动10秒后重要路径自动校验 ——

    def _auto_paths(self):
        """后台校验重要路径（提示词库@允许软件剪切到别的电脑使用）：
        配置里有且有效 → 不动；否则自动找。找到的经 uiq 回主线程
        弹窗提醒采用；仍找不到的弹窗手动指定。全程不阻塞启动。"""
        threading.Thread(target=self._auto_paths_work,
                         daemon=True).start()

    def _auto_paths_work(self):
        _ensure_cfg()
        found, missing = [], []
        for key, label in (('trae_exe', '原版TRAE主程序'),
                          ('sandman', 'Sandboxie主程序(SandMan.exe)')):
            cur = CFG.get(key) or ''
            if cur and os.path.isfile(cur):
                continue                       # 配置有效
            if key == 'trae_exe':
                p = find_host_trae_exe(None)
            else:
                sb = _sbx()
                p = sb['sandman'] if sb.get('sandman') \
                    and os.path.isfile(sb['sandman'] or '') else None
            (found if p else missing).append((key, label, p))
        if found or missing:
            self.uiq.put(('paths_check', (found, missing)))

    def _on_paths_check(self, arg):
        found, missing = arg
        if found:
            txt = '\n'.join('%s：\n  %s' % (l, p)
                            for _k, l, p in found)
            if messagebox.askyesno(
                    APP_TITLE,
                    '已自动找到以下重要路径：\n\n%s\n\n是否采用并保存到'
                    '配置？' % txt, parent=self):
                for k, _l, p in found:
                    CFG[k] = p
                _save_cfg(CFG)
                self.var_trae.set(CFG.get('trae_exe') or '')
                self.var_sbx.set(CFG.get('sandman') or '')
                self.orig_exe = find_host_trae_exe(self.boxes)
                _SBX.update({'done': False, 'sandman': None,
                             'start': None, 'ini': None})
                self._refresh_path_states()
                self._flash('重要路径已保存', '#0a7d32')
        if missing:
            names = '\n'.join('· ' + l for _k, l, _p in missing)
            if messagebox.askyesno(
                    APP_TITLE, '以下重要路径未找到：\n\n%s\n\n现在手动'
                    '指定吗？（也可之后到设置页指定）' % names,
                    parent=self):
                for k, l, _p in missing:
                    p = filedialog.askopenfilename(
                        parent=self, title='指定 ' + l,
                        filetypes=[('主程序', '*.exe'),
                                   ('所有文件', '*.*')])
                    if p:
                        CFG[k] = os.path.normpath(p)
                        _save_cfg(CFG)
                        if k == 'trae_exe':
                            self.var_trae.set(CFG[k])
                        else:
                            self.var_sbx.set(CFG[k])
                self.orig_exe = find_host_trae_exe(self.boxes)
                _SBX.update({'done': False, 'sandman': None,
                             'start': None, 'ini': None})
                self._refresh_path_states()

    # ---- 逻辑 ----

    def _cmd(self, cmd, arg):
        # 1.25：只控本机——命令直投本机 poller（远方转发已随
        # 「操控远方服务端」能力移除）
        self.poller.cmdq.put((cmd, arg))
        if cmd in ('send', 'interject'):    # 1.05：插话同样清输入框
            self.ent.delete('1.0', 'end')

    def _on_send(self):
        text = self.ent.get('1.0', 'end').strip()
        if not text:
            return
        # 1.05：生成中自动转「插话」（TRAE 官方排队机制）
        if self._gen_state == 'gen':
            self._flash('💬 已排队插话（AI 在当前步骤边界处理）',
                        '#ef6c00')
            self._cmd('interject', text)
        else:
            self._cmd('send', text)

    def _on_send_ret(self, e=None):
        """Enter 发送（阻止 Text 默认插入换行）"""
        self._on_send()
        return 'break'

    def _ent_newline(self, e=None):
        """Shift+Enter 换行"""
        self.ent.insert('insert', '\n')
        self._ent_fit()
        return 'break'

    def _ent_fit(self):
        """聚焦增高：按行数自适应，基础约5倍，上限8行"""
        try:
            n = int(self.ent.index('end-1c').split('.')[0])
        except Exception:
            n = 1
        self.ent.configure(height=min(max(n, 5), 8))

    def _stop_manual(self):
        """1.05：手动停止——标记非自然完成（8 秒窗口内生成中→空闲
        跳变不弹「任务完成」提醒窗；防呆自动终止同此口径）。"""
        self._manual_stop_at = time.time()
        self._cmd('stop_gen', None)

    def _on_pick(self, _ev):
        sel = self.lst.curselection()
        if not sel or sel[0] >= len(self._row_map):
            return
        # 只有用户主动选的才触发（重建列表时会清 selection）
        kind, val = self._row_map[sel[0]]
        if kind == 'f':
            self._cmd('toggle_folder', val)   # 组头行 = 折叠/展开
            return
        convs = [r for r in (self.snap.get('convs') or []) if r[0] == 'c']
        if val < len(convs) and not convs[val][2]:
            self._cmd('switch', val)

    # ---- 1.10：新建任务弹窗 + 会话列表文件夹右键 ----

    def _on_new_task(self):
        """新建任务：先点 TRAE「新建任务」展开输入区并抓记忆工作目录
        （回填特征），task_dlg 事件回来再弹窗。"""
        if self._task_dlg and self._task_dlg.winfo_exists():
            self._task_dlg.lift()
            return
        self._flash('正在打开新建任务…', '#1565c0')
        self._cmd('new_task_dlg', None)

    def _on_task_dlg(self, d):
        if self._task_dlg and self._task_dlg.winfo_exists():
            self._task_dlg.destroy()
        self._task_dlg = TaskDlg(self, d or {})

    def _task_in_dlg(self, folder):
        """1.22：文件夹组内新建的统一弹窗（锁定模式）——不再直接点
        TRAE 组内新建，先弹窗确认，「创建」才执行 new_task_in。"""
        if self._task_dlg and self._task_dlg.winfo_exists():
            self._task_dlg.destroy()
        self._task_dlg = TaskDlg(self, {}, locked=folder)

    def _on_task_dlg_ok(self, _path):
        self._flash('✅ 新建任务就绪（目录已设置），输入内容后发送',
                    '#0a7d32')

    def _on_lst_menu(self, ev):
        """会话列表右键（仅文件夹组头）：✚ 在此文件夹新建任务（点 TRAE
        「组内新建」按钮，新任务直接隶属该文件夹，同原版左侧菜单）+
        折叠/展开。"""
        idx = self.lst.nearest(ev.y)
        if idx < 0 or idx >= len(self._row_map):
            return
        kind, val = self._row_map[idx]
        if kind != 'f':
            return
        m = tk.Menu(self.lst, tearoff=0)
        # 1.22：统一新建弹窗（锁定模式）——点 TRAE 组内新建的动作
        # 挪到弹窗「创建」时才执行
        m.add_command(label='✚ 在此文件夹新建任务',
                      command=lambda v=val: self._task_in_dlg(v))
        m.add_separator()
        m.add_command(label='折叠 / 展开',
                      command=lambda v=val: self._cmd('toggle_folder', v))
        try:
            m.tk_popup(ev.x_root, ev.y_root)
        finally:
            m.grab_release()

    def _drain(self):
        try:
            while True:
                try:
                    kind, val = self.uiq.get_nowait()
                except queue.Empty:
                    break
                # 1.25：只渲染本机事件（远方 rev 路由/事件过滤已随
                # 「操控远方服务端」能力移除）
                getattr(self, '_on_' + kind)(val)
        finally:
            self.after(150, self._drain)

    def _flash(self, msg, color='#c62828'):
        self.lbl_state.config(text=msg, foreground=color)
        self.after(4000, lambda: self.lbl_state.config(text=''))

    # ---- 目标切换（本机：原版 / 分身）----

    def _switch_box(self, _ev=None):
        """1.25：下拉框只列本机各 TRAE（@本章名 ●/○）——操控远方
        服务端的能力已移除（跨服务器只由网页版负责）。选本机项→
        原有带端口切换链路。"""
        label = self.cmb.get()
        spec = self._tgt_labels.get(label)
        if self._busy:
            self._flash('正在切换/启动，请稍候…')
            self._cmb_sync()
            return
        if spec is None:               # 选项表还没建好（等首拍快照）
            self._rebuild_targets()
            self._cmb_sync()
            return
        if spec[0] == 'local':
            box = spec[1]
            if box == self.box_name:
                return
            self._switch_local(box)

    def _switch_local(self, box):
        if box == ORIG_NAME:
            port = _orig_port()
            exe = self.orig_exe
            if not exe:
                self._flash('找不到原版 TRAE 主程序（沙盒快捷方式和'
                            '默认安装位置都没有）')
                self._cmb_sync()
                return
        else:
            exe = self.boxes.get(box)
            n = box_number(box)
            if not n or not exe:
                self._flash('[%s] 缺号码或主程序路径，无法切换' % box)
                self._cmb_sync()
                return
            port = PORT_BASE + n
        if CDP.port_alive(port):
            self._apply_switch(box, port)
            return
        if box == ORIG_NAME:
            msg = ('原版 TRAE 未带调试端口运行（%d）。\n\n'
                   '要重启原版 TRAE 并带端口吗？\n'
                   '（正在运行的原版 TRAE 会先关闭；\n'
                   '沙盒内各分身不受影响）' % port)
        else:
            msg = ('[%s] 的 TRAE 未带调试端口运行（%d）。\n\n'
                   '要重启盒内 TRAE 并带端口吗？\n'
                   '（正在运行的 TRAE 会先关闭）' % (box, port))
        if not messagebox.askyesno(APP_TITLE, msg,
                                   parent=self):
            self._cmb_sync()
            return
        self._busy = True
        self._flash('正在带端口拉起 %s…' % box, '#1565c0')
        threading.Thread(target=self._boot_box,
                         args=(box, exe, port), daemon=True).start()

    # ---- 1.25：目标下拉框（仅本机各 TRAE）----

    def _rebuild_targets(self):
        """重建目标下拉框选项：仅本机各 TRAE（@本章名 ●/○）。
        1.25：远方服务端选项已移除。值无变化不重设（防闪）。"""
        vals, labels = [], {}
        my = self.srv_name or '未命名'
        for box in self.box_names:
            n = box_number(box)
            port = _orig_port() if box == ORIG_NAME else (
                PORT_BASE + n if n else None)
            on = (box == self.box_name
                  and self.poller.cdp is not None) or \
                 (port is not None and port in self._alive_last)
            lbl = '%s @%s %s' % (box, my, '●' if on else '○')
            vals.append(lbl)
            labels[lbl] = ('local', box)
        if vals != self._tgt_vals:
            self._tgt_vals = vals
            self._tgt_labels = labels
            self.cmb.config(values=vals)
        self._cmb_sync()

    def _cmb_sync(self):
        """下拉框回显当前目标（本机当前 box）。"""
        on = (self.poller.cdp is not None
              or self.box_name in self._alive_last)
        lbl = '%s @%s %s' % (self.box_name, self.srv_name or '未命名',
                             '●' if on else '○')
        if lbl not in (self._tgt_vals or []):
            self._tgt_labels[lbl] = ('local', self.box_name)
            self._tgt_vals = list(self._tgt_vals or []) + [lbl]
            self.cmb.config(values=self._tgt_vals)
        self.cmb.set(lbl)

    def _on_srv_peers(self, snap):
        """1.23：在线远方服务端清单变化（注册/心跳/离线）。
        1.25：仅剩重名检测 + 下拉框刷新用途（不再切远方）。"""
        self._srv_peers = snap or {}
        # 运行期重名检测（登录时已强制唯一，防有人后来顶名）
        for p in self._srv_peers.values():
            if p.get('name') == self.srv_name \
                    and p.get('sid') not in ('', _srv_sid()):
                self._on_srv_conflict(p['name'])
                break
        self._rebuild_targets()

    def _on_srv_conflict(self, name):
        """1.23：检测到远方服务端与本章重名（限频告警，60s 一次）。"""
        if time.time() - getattr(self, '_conflict_at', 0) < 60:
            return
        self._conflict_at = time.time()
        self._flash('⚠ 远方服务端 [%s] 与本章重名！请在网络页改名'
                    % name, '#c62828')

    # ---- 1.23：启动强制命名 ----

    def enforce_server_name(self):
        """启动强制命名：未命名必须填写才能继续；与当前在线的远方
        服务端重名必须改名。WS 关闭时只要求非空（无从查重）。"""
        ws_ok = (CFG.get('ws_on', True) and HAS_WS
                 and self.bridge.is_alive())
        if ws_ok:
            self.bridge.announce()
            self.bridge.send_json({'t': 'who'})   # 请在线服务端亮名册
            self._pump(4.0)                       # 收集名册
        while True:
            cur = _srv_name()
            conflict = None
            if ws_ok and cur:
                for p in self._srv_peers.values():
                    if p.get('name') == cur:
                        conflict = cur
                        break
            if cur and not conflict:
                break
            nxt = self._force_name(conflict)
            if nxt is None:            # 用户选择退出
                return
            if ws_ok:
                self._pump(1.5)        # 改名后复核在线名册
        _set_srv_name(_srv_name())
        self.srv_name = _srv_name()
        self.title('%s  v%s  [%s·%s]' % (
            APP_NAME, VERSION, self.box_name, self.srv_name))
        self.bridge.announce()         # 以正式身份广播
        self._rebuild_targets()

    def _force_name(self, conflict):
        """强制弹窗要名字；取消=确认退出（返回 None）。填了就先写
        配置并生效（回主循环后如仍冲突会再来一遍）。"""
        while True:
            if conflict:
                tip = ('与当前在线的服务端 [%s] 重名！\n\n'
                       '同名服务端会互相干扰，必须另起一个名字才能'
                       '继续。' % conflict)
            else:
                tip = ('首次运行：必须填写「服务器名称」才能继续。\n\n'
                       '多台电脑同时开服务端时靠名字互相区分，'
                       '在线服务端的名称不能重复。')
            name = simpledialog.askstring(
                '服务器名称', tip, initialvalue=conflict or
                (_srv_name() or ''), parent=self)
            if name is None:
                if messagebox.askyesno(
                        APP_TITLE, '未填写服务器名称，退出程序吗？',
                        parent=self):
                    self._on_close()
                    return None
                continue
            name = name.strip()
            if not name:
                messagebox.showwarning(APP_TITLE, '名称不能为空。',
                                       parent=self)
                continue
            if len(name) > 20:
                messagebox.showwarning(APP_TITLE, '名称最长 20 个字。',
                                       parent=self)
                continue
            CFG['srv_name'] = name
            _save_cfg(CFG)
            _set_srv_name(name)
            self.srv_name = name
            self._rebuild_targets()
            return name

    def _pump(self, sec):
        """泵事件 sec 秒（强制命名期间收在线名册；不阻塞 WS 线程）。"""
        end = time.time() + sec
        while time.time() < end:
            try:
                self.update()
            except Exception:
                pass
            time.sleep(0.05)

    # ---- 启动按钮（当前目标未连接时一键拉起）----
    def _launch_current(self):
        """带调试端口启动当前目标的 TRAE。端口探测/进程探测/启动
        全在后台线程（本机防火墙对未监听回环端口丢包，port_alive
        不在线要等满 3s 超时；start.exe /listpids 串行探测 16 个盒
        要数秒——都不能卡 UI）。1.09 起职责收紧：只在软件没开时
        直接拉起；已在运行（没带端口）不弹窗代劳重启，引导用
        「重启 TRAE」按钮。"""
        if self._busy:
            self._flash('正在启动，请稍候…')
            return
        box, port = self.box_name, self.port
        if box == ORIG_NAME:
            exe = self.orig_exe
            if not exe:
                self._flash('找不到原版 TRAE 主程序（沙盒快捷方式和'
                            '默认安装位置都没有）')
                return
        else:
            exe = self.boxes.get(box)
            if not box_number(box) or not exe:
                self._flash('[%s] 缺号码或主程序路径，无法启动' % box)
                return
        self._busy = True
        self._flash('正在检查 %s 运行状态…' % box, '#1565c0')
        threading.Thread(target=self._boot_current,
                         args=(box, exe, port), daemon=True).start()

    def _boot_current(self, box, exe, port):
        """后台：探测端口/运行状态。1.09 起职责收紧——启动按钮只做
        「软件没开 → 带端口直接拉起」；已在运行就不再代劳重启：
        端口在线提示无需启动，运行中没带端口则引导用「重启 TRAE」
        （先杀再拉那条链路归重启按钮专属，不再弹窗确认代跑）。"""
        try:
            if CDP.port_alive(port):
                self.uiq.put(('boot_noop', '端口 %d 已在线，无需启动'
                              % port))
                return
            running = (host_trae_running(self.boxes) if box == ORIG_NAME
                       else bool(box_pids(box)))
            if running:
                if box == ORIG_NAME:
                    tip = ('原版 TRAE 已在运行（未带调试端口 %d），'
                           '请用「重启 TRAE」' % port)
                else:
                    tip = ('[%s] 已在运行（未带调试端口 %d），'
                           '请用「重启 TRAE」' % (box, port))
                self.uiq.put(('boot_noop', tip))
                return
            self._boot_box(box, exe, port, kill_first=False,
                           label='启动')
        except Exception as e:
            self.uiq.put(('booterr', '启动失败：%s' % str(e)[:80]))

    def _on_boot_noop(self, msg):
        """后台探测发现端口其实在线（轮询间隙的边角情况）"""
        self._busy = False
        self._boot_state = None
        self._flash(msg, '#0a7d32')

    def _reboot_current(self):
        """1.07：强制重启当前目标的 TRAE——无论端口是否在线，先关闭
        再带调试端口拉起。        「启动」按钮在端口已在线时只提示无需启动
        （TRAE 卡死但端口还活着时救不了），此按钮专做一键恢复；关闭
        会中断正在生成的任务，故弹窗确认。"""
        if self._busy:
            self._flash('正在启动/切换，请稍候…')
            return
        box, port = self.box_name, self.port
        if box == ORIG_NAME:
            exe = self.orig_exe
            if not exe:
                self._flash('找不到原版 TRAE 主程序（沙盒快捷方式和'
                            '默认安装位置都没有）')
                return
        else:
            exe = self.boxes.get(box)
            if not box_number(box) or not exe:
                self._flash('[%s] 缺号码或主程序路径，无法重启' % box)
                return
        if not messagebox.askyesno(
                APP_TITLE,
                '要关闭并重启 [%s] 的 TRAE 吗？\n\n'
                '（正在生成的任务会中断；重启后自动重连调试端口 %d）'
                % (box, port), parent=self):
            return
        self._busy = True
        self._flash('正在重启 %s…' % box, '#1565c0')
        threading.Thread(target=self._boot_box,
                         args=(box, exe, port, True, '重启'),
                         daemon=True).start()

    def _boot_box(self, box, exe, port, kill_first=True, label='切换'):
        """带调试端口拉起 TRAE。kill_first=False 用于目标本来就没
        运行的场景（启动按钮直接拉起），跳过终止+等待，启动更快。
        label：失败提示的动作名（切换/启动/重启，1.08 按钮链区分）。"""
        try:
            # 1.20：拉起中状态上报（状态条显示「启动中…」而非「未就绪」）
            self.uiq.put(('bootst', 'launch'))
            if box == ORIG_NAME:
                # 原版：需要时杀宿主 TRAE 进程（排除沙盒内 PID）后拉起
                if kill_first:
                    kill_host_trae(self.boxes)
                    time.sleep(2)
                subprocess.Popen([exe, '--remote-debugging-port=%d' % port])
            else:
                # 分身：需要时终止沙盒后经 start.exe 带盒启动
                if kill_first:
                    terminate_box(box)
                    time.sleep(2)
                subprocess.Popen([_startexe(), '/box:' + box, exe,
                                  '--remote-debugging-port=%d' % port])
            ok = False
            for _ in range(60):
                if CDP.port_alive(port):
                    ok = True
                    break
                time.sleep(1)
            if not ok:
                # 1.08：超时后补一次进程探测，区分「没起来」与「没带端口」
                if box == ORIG_NAME:
                    detail = ('TRAE 进程未在运行（可能启动失败或秒退，'
                              '建议检查 Sandboxie 服务状态）'
                              if not host_trae_running(self.boxes)
                              else 'TRAE 在运行但调试端口未监听')
                else:
                    detail = ('盒内无 TRAE 进程（可能启动失败或秒退，'
                              '建议检查 Sandboxie 服务状态）'
                              if not box_pids(box)
                              else '盒内有进程但调试端口未监听')
                raise IOError('60 秒内端口 %d 未就绪：%s' % (port, detail))
            self.uiq.put(('bootst', 'ok'))
            self.uiq.put(('switched', (box, port)))
        except Exception as e:
            self.uiq.put(('booterr', '%s失败：%s'
                          % (label, str(e)[:80])))

    def _apply_switch(self, box, port):
        self.box_name = box
        self.port = port
        self._busy = False
        self._cmb_sync()
        self.snap = {}
        self._msgs_key = None
        self._convs_key = None
        self._pend = []            # 1.14：换目标，旧目标的待确认项作废
        self._pend_claims = []
        self._pend_seen = {}       # 1.36：首见时刻表一并作废
        self._pend_conv = ''
        self._gen_state = None     # 2.12：切换目标重置状态机（新目标无历史跳变）
        self._fin_at = None
        # 1.03：防呆计时随切换重置（新目标重新起算）
        self._watch_fp = None
        self._watch_last = time.time()
        self.points = '—'
        self.lbl_points.config(text='—')
        self._model_map = {}
        self._model_busy = False
        self.cmb_model.set('')
        self.cmb_model.config(values=[])
        self.lbl_conn.config(text='● 连接中…', foreground='#0a7d32')
        self.btn_launch.config(state='disabled')
        self.lst.delete(0, 'end')
        self.body.config(state='normal')
        self.body.delete('1.0', 'end')
        self.body.insert('end', '（正在连接 %s …）\n' % box, 'txt')
        self.body.config(state='disabled')
        self.title('%s  v%s  [%s·%s]' % (
            APP_NAME, VERSION, box, self.srv_name or '未命名'))
        self.poller.cmdq.put(('retarget', port))

    # ---- 导出 ----

    def _export_menu(self):
        m = tk.Menu(self, tearoff=0)
        m.add_command(label='导出 TXT（当前显示）',
                      command=lambda: self._do_export(
                          'txt', self.snap.get('msgs') or []))
        m.add_command(label='导出 HTML（当前显示）',
                      command=lambda: self._do_export(
                          'html', self.snap.get('msgs') or []))
        m.add_separator()
        m.add_command(label='完整导出 TXT（滚动收集全部）',
                      command=lambda: self._export_full('txt'))
        m.add_command(label='完整导出 HTML（滚动收集全部）',
                      command=lambda: self._export_full('html'))
        m.tk_popup(self.winfo_pointerx(), self.winfo_pointery())

    def _export_full(self, fmt):
        if self._busy:
            self._flash('目标切换中，无法导出')
            return
        snap = self.snap
        if not snap.get('online'):
            self._flash('TRAE 未连接，无法完整导出')
            return
        idle = snap.get('sendIdle')
        inp = snap.get('inputText') or ''
        if not idle and not inp:
            self._flash('生成中，等完成再完整导出（内容会变）')
            return
        self._flash('正在滚动收集全部消息…', '#1565c0')
        self._cmd('export_full', fmt)

    def _do_export(self, fmt, msgs, full=False):
        if not msgs:
            self._flash('当前会话没有可导出的消息')
            return
        convs = self.snap.get('convs') or []
        # v1.13：convs 行是 3 元组（[类型, 标题, 当前/折叠]），原写法
        # `for t, s in convs` 解包必崩（导出对话一直报错未察觉）；
        # 取当前会话（'c' 且标志位真）标题。
        title = next((r[1] for r in convs
                      if r and r[0] == 'c' and len(r) > 2 and r[2]),
                     '当前会话')
        safe = re.sub(r'[\\/:*?"<>|#\s]+', '_', title)[:24] or '会话'
        default = 'TRAE对话_%s_%s_%s%s' % (
            self.box_name, safe, time.strftime('%Y%m%d_%H%M'),
            '_完整' if full else '')
        if fmt == 'html':
            types = [('网页文件', '*.html'), ('所有文件', '*.*')]
        else:
            types = [('文本文件', '*.txt'), ('所有文件', '*.*')]
        path = filedialog.asksaveasfilename(
            parent=self, title='导出对话记录',
            initialfile=default, defaultextension='.' + fmt,
            filetypes=types)
        if not path:
            return
        if not path.lower().endswith('.' + fmt):
            path += '.' + fmt
        try:
            if fmt == 'html':
                text = self._export_html_doc(title, msgs, full)
                enc = 'utf-8'
            else:
                text = self._export_txt_text(title, msgs, full)
                enc = 'utf-8-sig'      # 记事本直接打开不乱码
            with open(path, 'w', encoding=enc, newline='') as f:
                f.write(text)
        except Exception as e:
            self._flash('导出失败：%s' % str(e)[:60])
            return
        self._flash('已导出 %d 条消息 → %s' % (len(msgs), path),
                     '#0a7d32')

    def _export_txt_text(self, title, msgs, full):
        L = []
        L.append('═' * 56)
        L.append('TRAE 对话记录导出')
        L.append('目标: %s（端口 %d）' % (self.box_name, self.port))
        L.append('会话: %s' % title)
        if self.points != '—':
            L.append('积分: %s' % self.points)
        L.append('导出时间: %s' % time.strftime('%Y-%m-%d %H:%M:%S'))
        L.append('消息数: %d%s' % (len(msgs), '（完整收集）' if full
                                   else '（当前显示部分）'))
        L.append('（消息时间为近似值：TRAE 间隔时间 + 本地首见记录）')
        L.append('─' * 56)
        times = self._resolve_msg_times(msgs)
        for m, tm in zip(msgs, times):
            role, text = m[0], m[1]
            L.append('')
            L.append('【%s】%s' % ('我' if role == 'u' else 'TRAE',
                                  '（%s）' % tm if tm else ''))
            L.append(text)
        L.append('')
        L.append('═' * 56)
        return '\n'.join(L)

    def _export_html_doc(self, title, msgs, full):
        times = self._resolve_msg_times(msgs)
        rows = []
        for m, tm in zip(msgs, times):
            role, text = m[0], m[1]
            who = ('我' if role == 'u' else 'TRAE') + \
                  ((' · %s' % tm) if tm else '')
            body = (_md_html(text) if role == 'a'
                    else _esc(text).replace('\n', '<br>'))
            rows.append('<div class="msg %s"><div class="who">%s</div>'
                        '<div class="body">%s</div></div>'
                        % ('user' if role == 'u' else 'agent', who, body))
        meta = ('目标 %s（端口 %d） · 会话 %s · 积分 %s · '
                '导出时间 %s · 消息 %d 条%s'
                % (_esc(self.box_name), self.port, _esc(title),
                   _esc(self.points), time.strftime('%Y-%m-%d %H:%M'),
                   len(msgs), '（完整收集）' if full
                   else '（当前显示部分）'))
        return ('<!DOCTYPE html><html><head><meta charset="utf-8">'
                '<title>TRAE 对话 %s</title><style>%s</style></head>'
                '<body><h1>TRAE 对话记录</h1><div class="meta">%s</div>'
                '%s</body></html>'
                % (_esc(title), _HTML_CSS, meta, ''.join(rows)))

    # ---- 事件处理 ----

    def _on_snap(self, snap):
        if snap.get('_port') != self.port:
            return      # 旧目标的迟到快照（切换后），丢弃防串台
        # 1.03 防呆：轻量活动指纹（tail + 消息数 + 末条内容）——
        # 变了=AI 有动静，刷新最近活动时刻
        try:
            _msgs = snap.get('msgs') or []
            _last = _msgs[-1][1] if _msgs else ''
            _fp = '%s|%d|%s' % (snap.get('tail') or '', len(_msgs), _last)
            if _fp != self._watch_fp:
                self._watch_fp = _fp
                self._watch_last = time.time()
        except Exception:
            pass
        self.snap = snap
        self._pend_reconcile(snap.get('msgs') or [])   # 1.14：撤/标占位
        self.lbl_conn.config(text='● 已连接（%d）' % self.port,
                             foreground='#0a7d32')
        self.btn_launch.config(state='disabled')
        self._render_convs(snap.get('convs') or [])
        self._render_msgs(snap.get('msgs') or [], snap.get('finish'))
        self._render_state(snap)
        self._render_attach(snap.get('attach') or [])
        self._sync_model(snap.get('model') or '')

    def _on_dead(self, err):
        self.lbl_conn.config(text='✘ 未连接（%s）' % err,
                             foreground='#c62828')
        # 1.14：掉线——没落地的待确认项直接标「未确认」，别让用户干等
        if self._pend:
            for p in self._pend:
                if p['state'] in ('sending', 'typed'):
                    p['state'] = 'timeout'
            self._redraw_msgs()
        self.btn_launch.config(state='normal')
        self.snap = {}
        self._render_state({'online': False})
        # 2.15：断线时清上传中占位（防灰 chips 悬死）
        if self._attach_pending:
            self._attach_pending = None
            self._attach_fp = ''      # 强制重画（清占位）
            self._render_attach([])

    def _on_connected(self, port):
        if port != self.port:
            return
        # TRAE 刚连上界面未必就绪，延迟几秒再读积分和模型列表
        # （1.30：8 秒太保守——connected 时快照 eval 已成功一次，
        # 界面基本可用，3 秒足够；读失败下轮 hello 重放前手机端
        # 还能靠「拉起」后的重试，实测无碍）
        p = port

        def _rd():
            if self.port == p:
                self._cmd('points', None)
                self._cmd('model_list', None)
        try:
            self.after(3000, _rd)
        except Exception:
            pass

    def _on_pend(self, arg):
        """1.14：命令已受理（发送/插话/切换）——立刻在消息区插一条
        本地占位气泡，让「点下去 → 有反馈」的空白期消失（远程手机端
        收到同一事件做同样的事，多端同看）。"""
        kind, text = (arg[0], arg[1]) if arg else ('send', '')
        if kind == 'switch':
            # 1.17：切换占位永远最多一条——新的顶掉旧的（连点多个
            # 会话只留最后一个，历史占位作废；此前不同标题各入一条，
            # 面板/手机端会同时挂着好几条「正在切换」）
            self._pend = [p for p in self._pend if p['kind'] != 'switch']
        elif text and any(p['text'] == text for p in self._pend):
            return                      # 同文本已在册（防重）
        self._pend_seq += 1
        self._pend.append({'id': self._pend_seq, 'kind': kind, 'text': text,
                           'state': 'sending', 'ts': time.time()})
        self._redraw_msgs()

    def _redraw_msgs(self):
        """强制重建消息区（待确认项有变化时用）"""
        self._msgs_key = None
        s = self.snap or {}
        self._render_msgs(s.get('msgs') or [], s.get('finish'))

    def _pend_reconcile(self, msgs):
        """1.14：快照里出现「我」消息 → 该项已落地，撤占位。
        1.39：不再 15 秒标 timeout——插话走官方排队，AI 忙时多久
        入列都正常（用户要求无限制）；确认或手动丢弃/改写才撤。
        _pend_claims 记住已被认领的 msgs 下标（连发相同文本也不会
        一帧撤两条/一帧被反复确认）；换会话则清空认领记录。
        1.36：匹配规则改为「前 N 字相同 且 该消息是 N 秒内新
        出现的」——长消息 TRAE 会折叠显示，全文比对必然失败；
        只认新消息防止与历史里同开头的老消息误配。
        1.37：N 字 / N 秒由设置页「确认匹配字数 / 消息出现时限」
        可调（pend_head / pend_age_sec）。"""
        if not self._pend:
            return
        try:
            head_n = max(10, int(_ensure_cfg().get('pend_head', 100)))
        except Exception:
            head_n = 100
        try:
            age_sec = max(5, int(_ensure_cfg().get(
                'pend_age_sec', 30)))
        except Exception:
            age_sec = 60
        convs = (self.snap or {}).get('convs') or []
        conv = next((r[1] for r in convs
                     if r and r[0] == 'c' and len(r) > 2 and r[2]), '')
        if conv != self._pend_conv:
            self._pend_conv = conv
            self._pend_claims = []
            self._pend_seen = {}       # 1.36：换会话首见表作废
        users = [(i, _norm_txt(m[1])) for i, m in enumerate(msgs or [])
                 if m and len(m) > 1 and m[0] == 'u' and _norm_txt(m[1])]
        # 1.36：登记首见时刻（只记时限窗口用，顺带裁剪防膨胀）
        # 1.38：键改用规范化文本（与发送原文同一口径）
        now = time.time()
        seen = self._pend_seen
        for _i, utxt in users:
            if utxt and utxt not in seen:
                seen[utxt] = now
        if len(seen) > 500:
            cutoff = now - 300
            self._pend_seen = {k: v for k, v in seen.items()
                               if v > cutoff}
            seen = self._pend_seen
        keep, changed = [], False
        for p in self._pend:
            # 1.17：切换占位不走消息文本对账——会话标题不会出现在
            # 消息区，按文本匹配必然失败 → 挂满 15s 变「未确认」，
            # 切换成功了好几秒还显示「正在切换」，完全不真实。改按
            # 当前会话对账：快照当前会话已是目标 ⇒ 立即撤；目标从
            # 会话列表消失（列表已变化）⇒ 也撤；6 秒兜底超时。
            if p['kind'] == 'switch':
                gone = not any(r and r[0] == 'c' and r[1] == p['text']
                               for r in convs if len(r) > 1)
                try:
                    sw_sec = max(3, float(_ensure_cfg().get(
                        'pend_switch_sec', 6)))
                except Exception:
                    sw_sec = 6
                if conv == p['text'] or gone or (
                        p['state'] != 'timeout'
                        and time.time() - p['ts'] > sw_sec):
                    changed = True
                    continue
                keep.append(p)
                continue
            t = _norm_txt(p['text'])     # 1.38：规范化后再比对
            hit = -1
            for i, txt in reversed(users):
                if i in self._pend_claims:
                    continue
                # 1.36：只认时限内新出现的消息（老消息同开头不认）
                ts0 = seen.get(txt)
                if ts0 is None or now - ts0 > age_sec:
                    continue
                if _pend_head100(t, txt, head_n):
                    hit = i
                    break
            if hit >= 0:
                self._pend_claims.append(hit)   # 消耗一次
                changed = True
                continue
            # 1.39：取消 15 秒「未确认」超时——插话要走官方排队，
            # AI 忙起来可能很久后才入列（时间不确定），超时标红
            # 完全不符合实际（用户原话：应该没有限制）。占位只有
            # 两种结局：出现在对话记录里（上面自动确认撤下），或
            # 用户在网页端手动「丢弃/改写/重发」。
            keep.append(p)
        if changed:
            self._pend = keep
            if keep:
                self._msgs_key = None

    def _on_sent(self, arg):
        """1.14：服务端阶段回报（typed 已进 TRAE 输入框 / clicked 已点
        发送 / queued 已进官方排队）——推进待确认项状态；旧版发纯文本
        也兼容。"""
        stage, text = '', ''
        if isinstance(arg, dict):
            stage, text = arg.get('stage') or '', arg.get('text') or ''
        elif isinstance(arg, str):
            text = arg
        for p in self._pend:
            if text and p['text'] != text:
                continue
            if stage == 'typed':
                p['state'] = 'typed'
            elif stage == 'queued':
                p['state'] = 'queued'
            elif stage == 'clicked':
                p['state'] = 'sent'
            break
        self._redraw_msgs()

    def _on_points(self, val):
        if val and val != '读取失败':
            self.points = val
        self.lbl_points.config(text=val)

    # ---- 1.41：账号名 / 通知 / 积分预警（GUI 侧接收）----

    def _on_account(self, name):
        self.account = str(name or '')
        self.lbl_acct.config(text=self.account or '—')

    def _on_notice(self, text):
        self._flash(str(text), '#1565c0')

    def _on_points_warn(self, v):
        v = v if isinstance(v, dict) else {'points': v, 'th': '?'}
        self._flash('⚠ 积分不足：%s（阈值 %s），已通知钉钉 97 通道'
                    % (v.get('points'), v.get('th')), '#ef6c00')

    # ---- 模型切换（2.07）----

    def _on_models(self, items):
        """后台读到模型列表 → 填下拉框（显示=名+倍率，受限标记）"""
        disp, self._model_map = [], {}
        for name, trail, restricted in items or []:
            d = name + ((' %s' % trail) if trail else '') \
                + ('（受限）' if restricted else '')
            disp.append(d)
            self._model_map[d] = name
        self.cmb_model.config(values=disp)
        # 以快照当前模型为准回填
        self._sync_model((self.snap or {}).get('model') or '')

    def _sync_model(self, cur):
        """快照带当前模型名 → 同步下拉框显示（切换中不回写防打架）"""
        if self._model_busy or not cur:
            return
        if cur == self.cmb_model.get():
            return
        if cur in self._model_map.values():
            d = next(d for d, n in self._model_map.items() if n == cur)
        else:       # 列表还没读到：临时占位显示
            d = cur
            self._model_map[d] = cur
            vals = list(self.cmb_model.cget('values')) or []
            if d not in vals:
                self.cmb_model.config(values=vals + [d])
        self.cmb_model.set(d)

    def _on_model_set(self, arg):
        """切换完成：(目标名, 实际生效名)"""
        want, cur = arg
        self._model_busy = False
        if cur == want:
            self._sync_model(cur)
            self._flash('模型已切换：%s' % cur, '#0a7d32')
        else:
            self._sync_model(cur)
            self._flash('「%s」未生效（当前 %s）' % (want, cur or '未知'))

    def _on_model_pick(self, _ev):
        d = self.cmb_model.get()
        name = self._model_map.get(d)
        if not name or self._model_busy:
            return
        self._model_busy = True
        self._flash('正在切换模型 %s…' % name, '#1565c0')
        self._cmd('switch_model', name)

    def _on_cmderr(self, err):
        self._flash('⚠ ' + err)
        # 附件命令失败：清上传中占位（防灰 chips 悬死）
        if err.startswith('attach'):
            self._attach_pending = None
            self._render_attach((self.snap or {}).get('attach') or [])

    def _on_msg_act(self, arg):
        """1.06：消息回退/删除完成回报 (kind, mi)"""
        kind, mi = arg
        if kind == 'revert':
            self._flash('已回退到第 %d 条用户消息之前' % (mi + 1), '#0a7d32')
        else:
            self._flash('已删除第 %d 条用户消息' % (mi + 1), '#0a7d32')

    # ---- 附件（2.15：上传前后反馈链）----

    # ---- 工作台路径选择（1.05）----

    def _bench_root(self):
        """工作台根目录（配置优先，失配回落默认→用户主目录）"""
        p = (CFG.get('bench_root') or '').strip() or BENCH_DEFAULT
        return p if os.path.isdir(p) else os.path.expanduser('~')

    def _on_bench_pick(self):
        """1.10：📂 按钮——打开自研文件树 BenchWin（参考网页客户端
        浏览页设计，替代原生 filedialog）：双击进入目录、双击文件即
        插入；也可选中后「插入所选」/「插入当前目录」。路径插入输入
        框末尾（已有文字则空格分隔；用户可补说明后手动发送）。"""
        if self._bench_win and self._bench_win.winfo_exists():
            self._bench_win.lift()
            return

        def _done(p):
            self._bench_win = None
            if not p:
                return
            cur = self.ent.get('1.0', 'end').strip()
            self.ent.delete('1.0', 'end')
            self.ent.insert('end', (cur + ' ' if cur else '') + p)
            self.ent.focus_set()
            self.ent.icursor('end')
            self._ent_fit()

        self._bench_win = BenchWin(self, self._bench_root(), 'path', _done)

    def _on_attach_pick(self):
        if self._attach_pending:
            self._flash('📎 正在附加上一批，请稍候…', '#ef6c00')
            return
        paths = filedialog.askopenfilenames(
            parent=self, title='选择附件（可多选）')
        paths = list(paths)
        if not paths:
            return
        # 反馈①：选完立刻灰 chips 占位 + 橙色状态（上传中）
        self._attach_pending = [os.path.basename(p) for p in paths]
        self._render_attach((self.snap or {}).get('attach') or [])
        self.lbl_state.config(text='📎 附加中…（%d 个文件）' % len(paths),
                              foreground='#ef6c00')
        self._cmd('attach', paths)

    def _on_attach_done(self, d):
        """反馈②：上传完成——绿✅（部分成功则黄，全失败红）"""
        self._attach_pending = None
        total, ok = d.get('total', 0), d.get('ok', 0)
        if ok >= total and total:
            self._flash('✅ 已附加 %d 个附件' % ok, '#0a7d32')
        elif ok:
            self._flash('⚠ 仅附加成功 %d/%d（部分被 TRAE 拒收）'
                        % (ok, total), '#ef6c00')
        else:
            self._flash('❌ 附件未出现在输入栏（类型被拒？）', '#c62828')
        self._render_attach((self.snap or {}).get('attach') or [])

    def _on_attach_rm_done(self, idx):
        self._render_attach((self.snap or {}).get('attach') or [])
        self._flash('已移除附件', '#888888')

    def _render_attach(self, items):
        """附件 chips 行：上传中→灰色占位；就绪→TRAE 真实条目。
        指纹防每 tick 重建（chips 上有点击绑定，重建会闪+丢 hover）"""
        if self._attach_pending:
            fp = 'pending:' + '|'.join(self._attach_pending)
        else:
            fp = 'ok:' + '|'.join(
                '%s,%s' % (i.get('name', ''), i.get('size', ''))
                for i in (items or []))
        if fp == self._attach_fp:
            return
        self._attach_fp = fp
        for w in self.attach_row.winfo_children():
            w.destroy()
        if self._attach_pending:
            for nm in self._attach_pending:
                chip = tk.Label(self.attach_row, text='⏳ ' + nm,
                                background='#eeeeee', foreground='#666666',
                                font=('Microsoft YaHei', 9), padx=6, pady=1)
                chip.pack(side='left', padx=(0, 4))
            self.attach_row.pack(side='bottom', fill='x', padx=8,
                                 pady=(0, 2), before=self._mid_ref)
            return
        if not items:
            self.attach_row.pack_forget()
            return
        for i, it in enumerate(items):
            nm = it.get('name', '')
            sz = it.get('size', '')
            chip = tk.Frame(self.attach_row, background='#e3f0fb')
            chip.pack(side='left', padx=(0, 4))
            txt = '📎 %s%s' % (nm, ('  %s' % sz) if sz else '')
            lbl = tk.Label(chip, text=txt, background='#e3f0fb',
                           foreground='#1565c0',
                           font=('Microsoft YaHei', 9), padx=6, pady=1)
            lbl.pack(side='left')
            rm = tk.Label(chip, text='✕', background='#e3f0fb',
                         foreground='#c62828', cursor='hand2',
                         font=('Microsoft YaHei', 9), padx=4)
            rm.pack(side='left')
            rm.bind('<Button-1>', lambda e, idx=i:
                    self._cmd('attach_rm', idx))
        self.attach_row.pack(side='bottom', fill='x', padx=8, pady=(0, 2),
                             before=self._mid_ref)

    def _on_ports(self, alive):
        self._alive_last = set(alive or [])
        self.lbl_ports.config(text='端口在线 %d/%d'
                              % (len(alive or []), len(self.pairs)))
        self._rebuild_targets()   # 1.23：本机 ●/○ 标志随扫描刷新

    def _on_collecting(self, n):
        self.lbl_state.config(text='完整收集中… 已 %d 条' % n,
                              foreground='#1565c0')

    def _on_collected(self, arg):
        # 1.00：远程发起的完整导出只转发（tee 已发），本地不弹保存框
        if getattr(self, 'bridge', None) is not None \
                and self.bridge._remote_export:
            self.bridge._remote_export = False
            self.lbl_state.config(text='')
            return
        fmt, msgs = arg
        self.lbl_state.config(text='')
        self._do_export(fmt, msgs, full=True)

    def _on_switched(self, arg):
        box, port = arg
        self._apply_switch(box, port)

    def _on_booterr(self, msg):
        self._busy = False
        # 1.20：失败态持久显示（不再 4 秒后被清掉变回「未就绪」）
        self._boot_state = {'st': 'fail', 'msg': msg, 'ts': time.time()}
        self._cmb_sync()
        self.lbl_state.config(text=msg, foreground='#c62828')

    # ---- 渲染 ----

    def _render_convs(self, rows):
        """rows: ['f', 组名, 折叠] / ['c', 标题, 选中[, 状态灯]]
        （文档顺序；1.46 起 'c' 行第 4 位是状态灯 run/done/fail/
        stop——按位取值，别解包成 3 元组，同 _render_msgs 的教训）。
        组头 ▾/▸ + 组内条目缩进体现层级；组头深蓝、可点击折叠。"""
        key = '|'.join('|'.join(str(x) for x in r) for r in rows)
        if key == self._convs_key:
            return
        self._convs_key = key
        self.lst.delete(0, 'end')
        self._row_map = []
        in_folder = False
        conv_idx = 0
        for r in rows:
            kind, title, flag = r[0], r[1], r[2]
            if kind == 'f':
                self.lst.insert('end', '%s %s'
                                % ('▸' if flag else '▾', title))
                self.lst.itemconfigure('end', foreground='#0d47a1')
                self._row_map.append(('f', title))
                in_folder = True
            else:
                pad = '    ' if in_folder else '  '
                # 1.46：行首状态灯（同手机版口径：run 蓝/done 绿/
                # fail 红/stop 灰；无灯=空闲不标）
                st = r[3] if len(r) > 3 else ''
                mark = '● ' if st in ('run', 'done', 'fail',
                                      'stop') else ''
                self.lst.insert('end', pad + ('▶ ' if flag else '')
                                + mark + title)
                if mark:
                    self.lst.itemconfigure('end', foreground={
                        'run': '#2f6fed', 'done': '#0a7d32',
                        'fail': '#d32f2f', 'stop': '#9aa0a6'}[st])
                self._row_map.append(('c', conv_idx))
                conv_idx += 1

    def _render_msgs(self, msgs, finish=None):
        # v1.12：消息行自 1.06 起为 5 元组（+回退/删除可用标志），
        # 改按位取值（此前 3 元组解包每次快照抛 ValueError，
        # 本地面板消息区一直渲染不出来）
        key = '#'.join('%s:%s:%s' % (m[0], m[1],
                                     (m[2] if len(m) > 2 else '') or '')
                       for m in msgs)
        if finish:      # 2.11：完成块也纳入指纹（卡出现/更新才重建）
            # 2.13：inLast 参与指纹（被新对话挤走时尾部块消失要重建）
            key += '#fin:%s|%s~%s' % (
                'L' if finish.get('inLast') else '-',
                '|'.join(finish.get('files') or []),
                (finish.get('text') or '')[:60])
        # 1.14：待确认项参与指纹（状态推进/撤销要重画）
        if self._pend:
            key += '#pend:' + '|'.join('%d:%s' % (p['id'], p['state'])
                                       for p in self._pend)
        if key == self._msgs_key:
            return
        self._msgs_key = key
        times = self._resolve_msg_times(msgs)
        self.body.config(state='normal')
        self.body.delete('1.0', 'end')
        if not msgs:
            self.body.insert('end', '（暂无消息，发送一条开始对话）\n',
                             'txt')
        for m, tm in zip(msgs, times):
            role, text = m[0], m[1]
            user = role == 'u'
            # 色带标签覆盖整块（含换行符才整行铺色）：
            # 我的=淡蓝底 / AI=淡绿底，名字行彩色加粗区分说话人
            bg = 'ubg' if user else 'abg'
            ntag = 'u' if user else 'a'
            self.body.insert('end', '我' if user else 'TRAE', (bg, ntag))
            if tm:
                self.body.insert('end', '  ' + tm, (bg, 'time'))
            self.body.insert('end', '\n', (bg,))
            if user:
                self.body.insert('end', text + '\n', (bg, 'txt'))
            else:
                self._insert_md(text, bg)
            self.body.insert('end', '\n', (bg,))     # 气泡底部留白
            self.body.insert('end', '\n', 'txt')     # 消息间空行
        # 2.11：任务完成块（AI 停止思考的标志）——✅ 摘要 + 生成物清单
        # 2.13：普通对话卡片地位——仅当完成卡在最后一个 turn 里
        # （inLast）才渲染尾部块；新对话一来就被挤走（正文里本就
        # 含完成卡文本，信息不丢）
        show_fin = bool(finish) and finish.get('inLast') \
            and (finish.get('files') or finish.get('text'))
        if show_fin:
            files = finish.get('files') or []
            self.body.insert('end', '✅ 任务完成', ('abg', 'fin'))
            if files:
                self.body.insert('end', '  生成物 %d 个' % len(files),
                                 ('abg', 'time'))
            self.body.insert('end', '\n', ('abg',))
            txt = (finish.get('text') or '').strip()
            if txt:
                # 摘要取首行（完成卡以「完成（…）」开头）
                first = txt.split('\n', 1)[0][:80]
                self.body.insert('end', first + '\n', ('abg', 'txt'))
            for fn in files:
                self.body.insert('end', '📄 %s\n' % fn, ('abg', 'finf'))
            self.body.insert('end', '\n', ('abg',))
            self.body.insert('end', '\n', 'txt')
        # 1.14：待确认占位气泡（空窗期反馈）——放在最末：用户刚发的
        # 那条就在眼前，不用等 TRAE 渲染 + 快照回来才看得到
        for p in self._pend:
            st = p['state']
            if st == 'sending':
                label, tag = ('排队中…' if p['kind'] == 'interject'
                              else '发送中…'), 'pstat'
            elif st == 'typed':
                label, tag = '已输入 TRAE…', 'pstat'
            elif st == 'queued':
                label, tag = '已排队，等待 AI 处理…', 'pstat_ok'
            elif st == 'sent':
                label, tag = '已发出，等待同步…', 'pstat_ok'
            else:
                label, tag = '⚠ 未确认（15s 内未出现）', 'pstat_bad'
            if p['kind'] == 'switch':
                label = '正在切换会话…'
            self.body.insert('end', '我', ('pbg', 'pu'))
            self.body.insert('end', '  ' + label, ('pbg', tag))
            self.body.insert('end', '\n', ('pbg',))
            if p['kind'] == 'switch':
                self.body.insert('end', '「%s」' % p['text'] + '\n',
                                 ('pbg', 'txt'))
            else:
                self.body.insert('end', p['text'] + '\n', ('pbg', 'txt'))
            self.body.insert('end', '\n', ('pbg',))
            self.body.insert('end', '\n', 'txt')
        self.body.see('end')
        self.body.config(state='disabled')

    # ---- 消息时间（TRAE 只在间隔大的用户消息渲染 HH:MM 真值，
    #      其余本地首见补齐；AI 消息沿用其提问时间）----

    def _tkey(self, title, text):
        """用户消息的时间缓存键：端口|当前会话标题|内容摘要"""
        h = hashlib.md5(('u|' + text).encode('utf-8')).hexdigest()[:10]
        return '%d|%s|%s' % (self.port, title, h)

    def _fmt_time(self, s):
        """'YYYY-MM-DD HH:MM:SS' → 今天 'HH:MM'，往日 'MM-DD HH:MM'"""
        if not s or len(s) < 16:
            return s or ''
        d, hm = s[:10], s[11:16]
        return hm if d == time.strftime('%Y-%m-%d') else d[5:] + ' ' + hm

    def _resolve_msg_times(self, msgs):
        """每条消息的显示时间。优先级：TRAE 实测（user-message__
        time，稀疏）> 本地首见缓存 >（AI 消息）沿用上一条用户
        消息时间。不在缓存的用户消息当场记 now（历史消息≈首次
        连接时间，近似值）。"""
        convs = self.snap.get('convs') or []
        title = next((t for k, t, s in convs if k == 'c' and s), '')
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        out, last, new = [], None, False
        for mv in msgs:
            role, text = mv[0], mv[1]
            dom = mv[2] if len(mv) > 2 else None
            if role == 'u':
                if dom:
                    t = dom
                else:
                    key = self._tkey(title, text)
                    if key not in self.times:
                        self.times[key] = now
                        new = True
                    t = self._fmt_time(self.times[key])
                out.append(t)
                last = t
            else:
                out.append(last)
        if new:
            self._save_times_later()
        return out

    def _save_times_later(self):
        if self._times_job is None:
            self._times_job = self.after(3000, self._save_times_now)

    def _save_times_now(self):
        self._times_job = None
        try:
            with open(self._times_file, 'w', encoding='utf-8') as f:
                json.dump(self.times, f, ensure_ascii=False)
        except Exception:
            pass

    def _insert_md(self, text, bg=None):
        """AI 消息 markdown → Text 标签片段（代码块/行内码/加粗/标题/
        列表）。bg=消息色带标签（ubg/abg），附加到每个片段形成整条
        气泡底色；代码块自带背景的标签创建在后、优先级更高，会正常
        盖过色带，两者不打架。"""
        def ins(s, *tags):
            self.body.insert('end', s, tags + ((bg,) if bg else ()))
        in_code = False
        for ln in text.split('\n'):
            if ln.lstrip().startswith('```'):
                in_code = not in_code
                continue
            if in_code:
                # 空行补一个空格，保持代码块底色连续
                ins((ln if ln else ' ') + '\n', 'code')
                continue
            if not ln.strip():
                ins('\n', 'txt')
                continue
            m = re.match(r'^(#{1,6})\s+(.*)$', ln)
            if m:
                ins(m.group(2) + '\n',
                    'h2' if len(m.group(1)) <= 2 else 'h3')
                continue
            m = re.match(r'^(\s*)([-*+])\s+(.*)$', ln)
            if m:
                ins('%s %s\n' % (m.group(2), m.group(3)), 'li')
                continue
            m = re.match(r'^(\s*)(\d+)[.)]\s+(.*)$', ln)
            if m:
                ins('%s. %s\n' % (m.group(2), m.group(3)), 'li')
                continue
            for seg, tg in _inline_segs(ln):
                ins(seg, tg or 'txt')
            ins('\n', 'txt')

    def _render_state(self, snap):
        if not snap.get('online'):
            # 1.20：启动过程中显示真实进度而非笼统「未就绪」——
            # launch 态 2 分钟内显示「启动中…」；fail 态 5 分钟内
            # 显示失败原因；超时回落「未就绪」
            bs, now = self._boot_state, time.time()
            if bs and bs.get('st') == 'launch' and now - bs['ts'] < 120:
                self.lbl_state.config(
                    text='启动中…（等 TRAE 界面就绪，最长 1 分钟）',
                    foreground='#1565c0')
            elif bs and bs.get('st') == 'fail' and now - bs['ts'] < 300:
                self.lbl_state.config(text=bs['msg'],
                                      foreground='#c62828')
            else:
                self.lbl_state.config(text='TRAE 界面未就绪',
                                      foreground='#c62828')
            self.btn_send.config(state='disabled')
            self.btn_stop.config(state='disabled')
            return
        self._boot_state = None        # 1.20：界面已就绪，清启动态
        idle = snap.get('sendIdle')
        inp = snap.get('inputText') or ''
        tail = snap.get('tail')
        fin = snap.get('finish')
        if not idle and not inp:
            # —— 生成中 ——（结束计时清零：新一轮任务重新起算）
            self._gen_state = 'gen'
            self._fin_at = None
            tip = '生成中·' + (tail if tail else '输出中')
            self.lbl_state.config(text=tip, foreground='#ef6c00')
            # 1.05：生成中发送键变「插话」（官方排队机制，Enter 发送）
            self.btn_send.config(state='normal', text='插话')
            self.btn_stop.config(state='normal')
        elif idle and not inp:
            # —— 空闲（含刚结束的过渡期）——
            # 2.12 状态机: 生成中→空闲的跳变=任务结束, 此刻起
            # fin_idle_sec 秒内显示「✅ 结束」，到点自动转「空闲」。
            # 1.05：手动/防呆终止的停止不算任务完成（不弹提醒窗，
            # 状态显示「⏹ 已停止」，下一 tick 自然转「空闲」）。
            if self._gen_state == 'gen':
                if self._manual_stop_at is not None:
                    if time.time() - self._manual_stop_at < 8:
                        # 1.05：手动/防呆终止的停止不算任务完成——不弹
                        # 提醒窗；显示「⏹ 已停止」一拍（下个 tick 转空闲）
                        self._gen_state = 'idle'
                        self._fin_at = None
                        self.lbl_state.config(text='⏹ 已停止',
                                              foreground='#888888')
                        self.btn_send.config(state='normal', text='发送',
                                             width=8)
                        self.btn_stop.config(state='disabled')
                        self._manual_stop_at = None
                        return
                    self._manual_stop_at = None   # 过期标志清除
                self._fin_at = time.time()
                self._fire_finish(fin)
            self._gen_state = 'idle'
            left = 0
            if self._fin_at is not None:
                left = int(CFG.get('fin_idle_sec', 15)
                           - (time.time() - self._fin_at))
            if left > 0:
                nf = len((fin or {}).get('files') or [])
                self.lbl_state.config(
                    text='✅ 结束 %ds' % left
                    + ('（生成物 %d 个）' % nf if nf else ''),
                    foreground='#0a7d32')
            else:
                self._fin_at = None
                self.lbl_state.config(text='空闲', foreground='#0a7d32')
            self.btn_send.config(state='normal', text='发送')
            self.btn_stop.config(state='disabled')
        else:
            self._gen_state = 'idle'
            self.lbl_state.config(text='输入框待发' + ('（有残留）' if
                                 len(inp) > 20 else ': ' + inp[:18]),
                                 foreground='#1565c0')
            # 1.05：输入框待发时，生成中仍变「插话」（Enter 走排队）
            self.btn_send.config(state='normal',
                                 text='插话' if not idle else '发送')
            self.btn_send.config(width=8 if idle else 6)
            self.btn_stop.config(
                state='normal' if not idle else 'disabled')

    # ---- 2.12：任务完成提醒弹窗 ----

    def _fire_finish(self, fin):
        """任务结束（生成中→空闲跳变）时弹提醒窗，sec 秒自动关闭。
        fin 为完成卡（可为 None=纯问答无文件改动）。"""
        if not CFG.get('fin_popup', True):
            return
        try:
            sec = max(1, int(CFG.get('fin_popup_sec', 5)))
        except Exception:
            sec = 5
        # 防重：上一发还挂着就先撤（新一轮结束覆盖旧提醒）
        if self._fin_pop is not None and self._fin_pop.winfo_exists():
            try:
                self._fin_pop.after_cancel(self._fin_pop._tick)
                self._fin_pop.destroy()
            except Exception:
                pass
        pop = tk.Toplevel(self)
        self._fin_pop = pop
        pop.title('任务完成')
        pop.attributes('-topmost', True)
        pop.resizable(False, False)
        pop.configure(bg='#f0f7f0')
        box = ttk.Frame(pop, padding=(18, 12))
        box.pack(fill='both', expand=True)
        ttk.Label(box, text='✅ 任务完成', font=('Microsoft YaHei',
                                                 13, 'bold'),
                  foreground='#0a7d32').pack(pady=(0, 2))
        ttk.Label(box, text='[%s] 已停止思考' % self.box_name,
                  foreground='#555555').pack()
        files = (fin or {}).get('files') or []
        if files:
            fl = ttk.Frame(box)
            fl.pack(pady=(6, 0))
            ttk.Label(fl, text='生成物 %d 个：' % len(files),
                      foreground='#333333').pack(anchor='w')
            for fn in files[:8]:
                ttk.Label(fl, text='📄 ' + fn,
                          foreground='#0a7d32',
                          font=('Microsoft YaHei', 9)).pack(anchor='w',
                                                            padx=(10, 0))
            if len(files) > 8:
                ttk.Label(fl, text='…等共 %d 个' % len(files),
                          foreground='#8a8a8a',
                          font=('Microsoft YaHei', 8)).pack(anchor='w',
                                                           padx=(10, 0))
        pop._cnt = tk.Label(pop, text='', fg='#8a8a8a',
                            font=('Microsoft YaHei', 8))
        pop._cnt.pack()
        ttk.Button(box, text='知道了', width=9,
                   command=pop.destroy).pack(pady=(6, 0))
        pop.update_idletasks()
        # 位置：主窗右下角内侧
        try:
            x = self.winfo_x() + self.winfo_width() - pop.winfo_width() - 30
            y = self.winfo_y() + self.winfo_height() - pop.winfo_height() - 50
        except Exception:
            x = y = 60
        pop.geometry('+%d+%d' % (max(x, 0), max(y, 0)))

        def _tick(p=pop, n=sec):
            try:
                if not p.winfo_exists():
                    return
                if n <= 0:
                    p.destroy()
                    return
                p._cnt.config(text='%d 秒后自动关闭' % n)
                p._tick = p.after(1000, lambda: _tick(p, n - 1))
            except Exception:
                pass
        _tick()

    # ---- 1.03 防呆：生成中长时间无动静 → 自动终止 → 发「继续」 ----

    def _watch_tick(self):
        """防呆巡检（10 秒一次）：开启 + 生成中 + 超过阈值无动静 → 触发。"""
        try:
            if (CFG.get('watchdog_on', True)
                    and self._gen_state == 'gen'
                    and self.snap.get('online')):
                try:
                    lim = max(1, int(CFG.get('watchdog_min', 15))) * 60
                except Exception:
                    lim = 900
                if time.time() - self._watch_last >= lim:
                    self._watch_fire(lim)
        except Exception:
            pass
        self._watch_job = self.after(10000, self._watch_tick)

    def _watch_fire(self, lim):
        """触发防呆：点终止（生成中=停止键）→ 延时后自动发「继续」。
        触发即重置计时（防连环触发；再卡再等一整轮阈值）。
        1.05：防呆终止标记为非自然完成（跳变不弹任务完成窗——
        马上还要发「继续」接着跑，此刻弹「完成」是误报）。"""
        try:
            sec = max(1, int(CFG.get('watchdog_resend_sec', 5)))
        except Exception:
            sec = 5
        self._watch_last = time.time()
        self._flash('⏰ 防呆：%d 分钟无动静，已自动终止' % (lim // 60),
                    '#ef6c00')
        self._manual_stop_at = time.time()
        self._cmd('stop_gen', None)
        self.after(sec * 1000, self._watch_continue)

    def _watch_continue(self):
        """终止后补发「继续」，让 AI 接着跑。"""
        self._watch_last = time.time()
        self._flash('⏰ 防呆：已自动发送「继续」', '#ef6c00')
        self._cmd('send', '继续')

    # ---- 1.00 远程：命令分发 / 状态灯 ----

    def _on_rcmd(self, item):
        """远程操控报文（WS 桥投回本地 uiq，已在主线程）——1.25 起
        专供网页客户端等远端操控本机使用（本机不再操控远方服务端）。
        1.23：报文带 'to' 时仅目标服务端受理（多服务端同频道定向）。
        1.24：item=(body, sender)——sender=FOX 发送者 ID，作操控
        互斥锁的占有者标识；控制类报文先过 _ctl_check（互斥），
        被拒则回 deny；hello 应答附带占用信息。"""
        body, sender = item
        try:
            d = json.loads(body)
        except Exception:
            return
        if not isinstance(d, dict):
            return
        t = d.get('t')
        to = d.get('to')
        if to and to != self.srv_name:
            return
        if t == 'hello':
            self.bridge.send_hello(sender)
            return
        if t == 'ctl_free':
            self._ctl_release(sender)      # 1.24：操控者显式释放
            return
        if t == 'ctl_hb':
            self._ctl_check(sender)        # 1.24：仅续占，不执行动作
            return
        if t in ('cmd', 'switch_box', 'boot', 'attach_files'):
            if not self._ctl_check(sender):   # 1.24：互斥锁把关
                return
        if t == 'cmd':
            cmd, arg = d.get('c'), d.get('a')
            if cmd in ('retarget', 'attach'):
                return       # 端口切换走 switch_box；附件走 attach_files
            if cmd in ('block_update', 'block_stat'):
                # 1.06：防升级是本机 OS 操作，不走 CDP/cmdq（TRAE 没连
                # 也能用）；后台线程执行（清 430MB 升级包可能耗时），
                # 结果以 block_stat 事件回投（本地闪现 + 远程同步开关）
                self._block_job(cmd, arg)
                return
            if cmd == 'new_task_dir':
                # 1.06：客户端 📂 给的是工作台根内路径（相对/绝对均可）
                # → 解析成绝对路径并做越界校验（同 bench_ls 约束）
                root = os.path.abspath(self._bench_root())
                ap = os.path.abspath(os.path.join(root, str(arg or '')))
                if ap != root and not ap.startswith(root + os.sep):
                    self.uiq.put(('cmderr',
                                  'new_task_dir: 路径越界（只允许工作台根内）'))
                    return
                if not os.path.isdir(ap):
                    self.uiq.put(('cmderr', 'new_task_dir: 目录不存在 %s' % ap))
                    return
                arg = ap
            if cmd == 'task_dir_set':
                # 1.11：新建任务弹窗「创建」走远程（手机版 v1.08）——路径
                # 由 bench_ls 应答选出（工作台根内绝对路径），仍做越界
                # 校验（本地 TaskDlg 用 BenchWin 可全域选，不受此限）
                root = os.path.abspath(self._bench_root())
                ap = os.path.normpath(os.path.abspath(str(arg or '')))
                if ap != root and not ap.startswith(root + os.sep):
                    self.uiq.put(('cmderr',
                                  'task_dir_set: 路径越界（只允许工作台根内）'))
                    return
                if not os.path.isdir(ap):
                    self.uiq.put(('cmderr', 'task_dir_set: 目录不存在 %s' % ap))
                    return
                arg = ap
            if cmd == 'stop_gen':
                # 1.05：远程停止同口径——不算自然完成，不弹完成窗
                self._manual_stop_at = time.time()
            if cmd == 'export_full':
                self.bridge._remote_export = True   # 本地不弹保存框
            self.poller.cmdq.put((cmd, arg))
            return
        if t == 'attach_files':
            tmp = os.path.join(os.environ.get('TEMP') or '.',
                               'TRAE远程附件')
            paths = []
            try:
                os.makedirs(tmp, exist_ok=True)
                for f in d.get('files') or []:
                    data = base64.b64decode(f.get('d') or '')
                    p = os.path.join(tmp, os.path.basename(
                        f.get('n') or '附件'))
                    with open(p, 'wb') as fh:
                        fh.write(data)
                    paths.append(p)
            except Exception as e:
                self._flash('远程附件接收失败：%s' % str(e)[:50])
                return
            if paths:
                self.poller.cmdq.put(('attach', paths))
            return
        if t == 'bench_ls':
            # 1.05：远程工作台目录浏览（客户端 📂 用）——主线程直列
            # （os.listdir 毫秒级），结果以 ev 事件回投（TeeQueue 自动
            # 转发远程；本地 _on_bench_ls 空消费）
            self.uiq.put(('bench_ls', self._bench_ls(d.get('p') or '')))
            return
        if t == 'switch_box':
            box = d.get('box') or ''
            port = box_port(box)
            if not port:
                self.uiq.put(('booterr', '[%s] 名字无效' % box))
            elif CDP.port_alive(port):
                self._apply_switch(box, port)
            else:
                self.uiq.put(('booterr',
                              '[%s] 端口未在线（刚掉线？稍后重试）' % box))
            return
        if t == 'boot':
            box = d.get('box') or ''
            if self._busy:
                self.uiq.put(('boot_noop', '服务端正忙（切换/启动中）'))
                return
            port = box_port(box)
            exe = self.orig_exe if box == ORIG_NAME \
                else self.boxes.get(box)
            if not port or not exe:
                self.uiq.put(('booterr',
                              '服务端找不到 [%s] 的主程序路径' % box))
                return
            self._busy = True
            threading.Thread(target=self._boot_box,
                             args=(box, exe, port, True, '启动'),
                             daemon=True).start()
            return

    # ---- 1.24：远方操控互斥锁 ----

    def _ctl_check(self, sender):
        """操控者把关：无主/同主/超时 → 接管或续占（True）；
        被别的活跃操控者占着 → 拒绝（False，回 deny 并限频）。
        本机本地操作不走此检查（永远可用）。"""
        if not _ensure_cfg().get('lock_on', True) or not sender:
            return True
        now = time.time()
        lk = self._ctl_lock
        sec = max(10, int(_ensure_cfg().get('lock_sec', 60) or 60))
        if lk.get('id') == sender:
            lk['ts'] = now            # 续占：有动作就刷新活跃时刻
            return True
        if lk.get('id') and now - lk.get('ts', 0) <= sec:
            # 还在别人占用期内 → 拒绝（deny 应答 5 秒限频，防刷屏）
            if now - self._last_deny_ts > 5:
                self._last_deny_ts = now
                self.bridge.send_json({
                    't': 'deny', 'srv': self.srv_name,
                    'target': sender, 'holder': lk['id']})
            self.uiq.put(('ctl_lock', {'id': lk['id'],
                                       'left': int(sec - (now
                                                 - lk['ts']))}))
            return False
        lk['id'], lk['ts'] = sender, now   # 接管（无主或已超时）
        self._last_deny_ts = 0.0
        self.uiq.put(('ctl_lock', {'id': sender, 'left': None}))
        return True

    def _ctl_release(self, sender):
        """操控者显式释放（切走/退出远方模式时发 ctl_free）。"""
        lk = self._ctl_lock
        if not lk.get('id') or lk.get('id') == sender or not sender:
            if lk.get('id'):
                lk['id'], lk['ts'] = None, 0.0
                self.uiq.put(('ctl_lock', {'id': None, 'left': None}))

    def _on_ctl_lock(self, info):
        """1.24：占用状态变化的本地界面提示（不转发远程）。"""
        cid = info.get('id')
        if not cid:
            self._flash('🔓 远方操控占用已释放', '#0a7d32')
        elif info.get('left') is None:
            self._flash('🔒 已被 %s 远程操控（%d 秒无操作自动释放）'
                        % (cid, max(10, int(_ensure_cfg().get(
                            'lock_sec', 60) or 60))), '#1565c0')
        else:
            self._flash('拒绝远方操控：已被 %s 占用（剩 %d 秒）'
                        % (cid, info.get('left', 0)), '#c62828')

    def _bench_ls(self, sub):
        """1.05：列工作台目录（远程客户端浏览用）。sub=根内相对路径。
        返回 {ok, root, rel, parent, dirs, files} 或 {ok:False, err}。
        强制约束在 bench_root 内（频道公开，防任意列目录）。"""
        root = os.path.abspath(self._bench_root())
        p = os.path.abspath(os.path.join(root, sub or ''))
        if p != root and not p.startswith(root + os.sep):
            return {'ok': False, 'err': '路径越界（只允许工作台根内）'}
        if not os.path.isdir(p):
            return {'ok': False, 'err': '目录不存在'}
        try:
            items = sorted(os.listdir(p))
        except Exception as e:
            return {'ok': False, 'err': str(e)[:60]}
        dirs = [i for i in items if os.path.isdir(os.path.join(p, i))][:200]
        files = [i for i in items
                 if not os.path.isdir(os.path.join(p, i))][:400]
        rel = '' if p == root else os.path.relpath(p, root)
        return {'ok': True, 'root': os.path.basename(root) or root,
                'rel': rel, 'parent': os.path.dirname(rel), 'path': p,
                'dirs': dirs, 'files': files}

    def _on_bench_ls(self, v):
        pass      # 本地用 filedialog（更好用），此事件仅供远程客户端

    # ---- 1.06：一键禁止/恢复 TRAE 自动升级（OS 层，不走 CDP）----
    # 依《TRAEWORK禁止自动升级操作指南》：升级链 = 后台下载完整包到
    # %LOCALAPPDATA%\Temp\solo-cn-user-x64 + 关闭 TRAE 时安装目录
    # tools\inno_updater.exe 静默执行。封锁 = 清包 + icacls 给
    # Everyone(SID S-1-1-0) 加拒绝 ACL(DE,X,WD,AD)；解封 = /remove:d。

    def _block_mod(self):
        """懒加载独立防升级模块 TRAE升级阻止工具（同目录；复用避免重复维护）"""
        _d = os.path.dirname(os.path.abspath(__file__))
        if _d not in sys.path:
            sys.path.insert(0, _d)
        import TRAE升级阻止工具 as _bm
        return _bm

    def _block_install_dir(self):
        exe = getattr(self, 'orig_exe', None) or find_host_trae_exe(None)
        return os.path.dirname(exe) if exe else None

    def _updater_exe(self):
        """定位安装目录下 tools\\inno_updater.exe（升级链最终执行者，
        委托独立模块 TRAE升级阻止工具.updater_exe）"""
        return self._block_mod().updater_exe(self._block_install_dir())

    def _block_stat(self):
        """查询防升级状态：{ok, blocked, exe} 或 {ok:False, err}。
        委托独立模块（DENY 英文 / 拒绝 中文双检测更稳）"""
        return self._block_mod().block_stat(self._block_install_dir())

    def _block_set(self, on):
        """封锁(on=True)/解封(on=False)：委托独立模块
        (block_set 内部: 清已下载升级包 + icacls 拒绝/移除 ACL)。"""
        return self._block_mod().block_set(on, self._block_install_dir())

    def _block_job(self, cmd, arg):
        """防升级命令后台执行（rmtree 430MB / icacls 秒级，别卡 UI）"""
        def _run():
            try:
                v = (self._block_stat() if cmd == 'block_stat'
                     else self._block_set(bool(arg)))
            except Exception as e:
                v = {'ok': False, 'err': str(e)[:60]}
            self.uiq.put(('block_stat', v))
        threading.Thread(target=_run, daemon=True).start()

    def _on_block_stat(self, v):
        """防升级状态回报（本地闪现；远程客户端同事件驱动开关）"""
        if not v.get('ok'):
            self._flash('🚫 防升级：%s' % (v.get('err') or '未知错误'))
            return
        act = ''
        if 'on' in v:
            act = '，已%s' % ('封锁' if v['on'] else '恢复')
        self._flash('🚫 自动升级：%s%s'
                    % ('已封锁' if v.get('blocked') else '未封锁', act),
                    '#0a7d32' if v.get('blocked') else '#ef6c00')

    def _on_remote(self, v):
        """远程桥状态灯：True在线 / False离线 / 文本=异常说明。"""
        self._remote_line = v
        self._render_remote()

    def _on_remote_peers(self, n):
        """1.20：最近 1 分钟内有报文往来的客户端数（桥线程上报）。"""
        self._remote_peers = int(n or 0)
        self._render_remote()

    def _render_remote(self):
        """1.20：状态灯三态细分——
        在线且有客户端报文 → 「在线·客户端N」（绿）；
        在线但 60s 无任何客户端报文 → 「WS:待命中」（蓝）；
        离线/异常维持原样（红/橙）。"""
        if not hasattr(self, 'lbl_remote'):
            return
        v = self._remote_line
        if v is True:
            n = self._remote_peers
            if n > 0:
                self.lbl_remote.config(
                    text='🌐 远程:在线·客户端%d' % n,
                    foreground='#0a7d32')
            else:
                self.lbl_remote.config(
                    text='🌐 WS:待命中',
                    foreground='#1565c0')
        elif v is False:
            self.lbl_remote.config(text='🌐 远程:离线',
                                   foreground='#c62828')
        else:
            self.lbl_remote.config(text='🌐 远程:%s' % v,
                                   foreground='#ef6c00')

    def _on_bootst(self, st):
        """1.20：启动过程状态（launch=拉起中 / ok=成功）；
        失败走 booterr（_on_booterr 置 fail 态）。"""
        if st == 'launch':
            self._boot_state = {'st': 'launch', 'ts': time.time()}
            self.lbl_state.config(
                text='启动中…（等 TRAE 界面就绪，最长 1 分钟）',
                foreground='#1565c0')
        else:                          # 'ok'
            self._boot_state = None

    def _open_web(self):
        """1.21：一键打开手机版网页客户端（默认浏览器，gittest）。"""
        try:
            os.startfile(WEB_CLIENT_URL)
        except Exception as e:
            self._flash('网页版打开失败：%s' % str(e)[:60])

    def _on_close(self):
        # 2.09：退出前兜底保存窗口大小位置（防抖未触发时）
        try:
            if CFG.get('remember_win', True) and self.state() == 'normal':
                CFG['geometry'] = self.geometry()
                _save_cfg(CFG)
        except Exception:
            pass
        # 1.02：停网络页刷新循环 + 流量落盘兜底（不等 30 秒定时）
        try:
            if getattr(self, '_net_job', None) is not None:
                self.after_cancel(self._net_job)
        except Exception:
            pass
        # 1.03：停防呆巡检
        try:
            if getattr(self, '_watch_job', None) is not None:
                self.after_cancel(self._watch_job)
        except Exception:
            pass
        try:
            _stats_flush()
        except Exception:
            pass
        self.poller.stop_ev.set()
        self.scanner.stop_ev.set()
        if getattr(self, 'bridge', None) is not None:
            self.bridge.stop_ev.set()
            try:
                if self.bridge.ws is not None:
                    self.bridge.ws.close()
            except Exception:
                pass
        # 1.26：显式释放禁止多开互斥体——不等进程收尾，立刻重开
        # 也不会误判「已在运行（禁止多开）」
        global _MUTEX
        try:
            if _MUTEX is not None:
                ctypes.windll.kernel32.ReleaseMutex(_MUTEX)
                ctypes.windll.kernel32.CloseHandle(_MUTEX)
        except Exception:
            pass
        _MUTEX = None
        self.destroy()
        if self._own_root:
            self.master.destroy()


# ================= 独立运行入口 =================

def _pick_default_target(boxes):
    """独立运行默认目标：并行探测一轮（~1s）后——原版 9599 在线
    优先，否则编号最小的在线分身，都不在线默认原版（面板会提示
    带端口重启）。
    ⚠ 不能串行 port_alive 逐个探：本机防火墙对未监听回环端口丢包
    （超时而非拒绝），每个不在线端口走满 3s 超时，16 分身串行
    ≈ 48s 才出界面——2.01 双击「一直 CMD 不出窗口」的根因。"""
    names = [ORIG_NAME] + sorted(
        boxes, key=lambda b: (box_number(b) or 0, b))
    pairs = [(b, p) for b, p in ((b, box_port(b)) for b in names) if p]
    alive = set(_port_fast(pairs))
    if ORIG_NAME in alive:
        return _orig_port(), ORIG_NAME
    for b, p in pairs:
        if b != ORIG_NAME and b in alive:
            return p, b
    return _orig_port(), ORIG_NAME


_MUTEX = None    # 命名互斥体句柄（禁止多开；保持引用防 GC 关闭）


def _acquire_single():
    """禁止多开（设置页可关，默认开）：命名互斥体，已存在返回 False。
    1.26 修重启误报：关窗到进程彻底结束有数秒收尾（WS 关闭握手/
    统计落盘/线程退出），期间互斥体尚未释放——立刻双击重启会被
    误判「多开」。现发现被占先等最多 8 秒（每 0.25s 重试），等
    到旧实例退出即正常进入；真有存活的另一实例才报多开。"""
    global _MUTEX
    end = time.time() + 8.0
    while True:
        try:
            _MUTEX = ctypes.windll.kernel32.CreateMutexW(
                None, False, 'Local\\%s_SingleInstance' % APP_NAME)
            # 183 = ERROR_ALREADY_EXISTS
            if ctypes.windll.kernel32.GetLastError() != 183:
                return True
            ctypes.windll.kernel32.CloseHandle(_MUTEX)
            _MUTEX = None
        except Exception:
            return True
        if time.time() >= end:
            return False
        time.sleep(0.25)


if __name__ == '__main__':
    _ensure_cfg()                       # 2.09：先加载配置
    if CFG.get('no_multi', True) and not _acquire_single():
        ctypes.windll.user32.MessageBoxW(
            0, '%s 已在运行（禁止多开）。\n可在设置页取消「禁止多开」。'
            % APP_NAME, APP_TITLE, 0x40)
        sys.exit(0)
    boxes = {}
    try:
        for b, exe, _l in discover_boxes():
            if box_number(b):
                boxes[b] = exe
    except Exception:
        pass
    port, box = _pick_default_target(boxes)
    dlg = TraePanelDialog(None, port, box, boxes)
    # 1.23：启动强制命名（未命名必须填写；与在线远方服务端重名必须
    # 改名）——面板建好后跑，期间桥已上线可收在线名册
    dlg.after(200, dlg.enforce_server_name)
    dlg.master.mainloop()
    # 1.26：主循环退出后硬结束进程——守护线程/WS 收尾不再拖住
    # 互斥体释放，重启秒开（统计等已在 _on_close 落盘完毕）
    os._exit(0)
