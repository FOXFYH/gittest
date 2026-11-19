# -*- coding: utf-8 -*-
r"""WS桥（下级模块\WS桥.py）    版本 0.40    日期 2026-11-19

软件名：TRAE同步显示与控制工具_服务端
模块名：WS桥
版本：0.40
日期：2026-11-19
【维护记录】
  …（更早 140 条已归档：各种文档\下级模块_维护记录归档.md）
  0.40  2026-11-19  终极认证闸门（老板实测 bug；VERSION 仍 3.72）：
                    病根＝TRAE 思维流拿不到独立号、快照号与终极同号，客户端把
                    快照当终极落账 → 服务端「号已存在」误判不缺 → 终极永不补。
                    根因是 fin 由 index7 非空推断（快照行 index7 也可能有内容）。
                    ① `_row_code/_round_codes` 增 `final` 参数：只有「该轮已终结
                    **且** index7 非空」才 fin=1，判不出一律 fin=0（fail-closed）；
                    ② 新增 `_终态(sid,src)`：sendIdle+无生成中标志 → 终结；无信号
                    查本地账本末条 AI 行 fin；都取不到按未终结；③ `_ledger_entity`
                    出帧前「未终结净化」：fin=0 的轮在**副本**上清空 a[7]（绝不动
                    _last_snap/pane 原件），客户端自己算出 fin=0；④ 四类标识：
                    ent 增与 rounds 逐轮对齐的 `kinds`（['u','a'] 仅认证终结，
                    未终结为 ['u','snap']），codes **只留 a**（snap/th 永不进
                    codes、不参与 need）；think 直播/ledger_req 帧带 `rkind:'snap'`；
                    ⑤ `_ledger需补`：客户端 fin=0 的 mid 视为未持有终极 ⇒ 必补，
                    只有两端 fin=1 且 hash 相同才算齐。0.39→0.40。
  0.39  2026-11-19  禁双发（老板 2026-11-19 二次澄清，V1.0 §三；VERSION 仍 3.72）：
                    主副两频道同时在线且完全静默（现状已满足）；哪个频道有网页
                    版 login 就只在那个频道回，没登录的频道一字节不发；**严禁同
                    一条消息向两个频道同时发送**。修：① 新增 `_pick_out_ch()`——
                    出向目标恒为**恰好一个或空**：回声频道优先（300s 内来命令
                    且仍在线、仍有登录客户端）→ 否则「在线且 cli_any」里挑**心跳
                    最新**的（ts 平局 main 优先）→ 都没有返回 ''（不发）；②
                    `_sender` 兜底分支原 `targets=[ch for ch in self._online if
                    self.cli_any(ch)]` 会双发，改走 `_pick_out_ch`；③ `_fox_send`
                    入口防御：多目标收敛为第一个并记「出向多目标 收敛为单频道」。
                    0.38→0.39。
  0.38  2026-11-19  存号收口（老板 2026-11-19 令，VERSION 仍 3.72）：0.37
                    合流成果保留（S1 为服务端唯一写者）。`_ledger_entity`
                    组帧时 sid 为空 → 先用 `_账.ledger().sid_of(port,title)`
                    从账本库「名↔号」映射把号**回查**出来（title 有、桌面无
                    号也能回锚）；账本库也查不到才 `nokey:1` 临时锚。绝不再
                    因「号暂时抓不到」压住广播，也绝不拿号码当名字。
                    0.37→0.38。
  0.37  2026-11-19  两道补刀（老板 2026-11-19 令，VERSION 仍 3.72）：
                    ① **ledger 帧不下发根因修复**——实测 login→vcheck 后
                    mod m=ledger 零帧：空闲时 `_ledger_fps` 只覆盖可见会话
                    ⇒ led_need 空；就算点名 sid，`_ledger_rounds_full` 的
                    title 只查桌面快照，查不到 ⇒ `_ledger_entity` 静默 None。
                    修：a) `_on_vcheck` 核对范围扩到「客户端上报里带 codes 的
                    sid ＋ 点名 sid」——本地账本有的会话都能按需出账本；
                    b) `_title_of` 兜底链加长：桌面现查 → pane 缓存 → **本地
                    账本 conv_meta 名↔号映射**（账本 v2.58 新增 sid 列）→
                    都空才弃发；c) `_ledger_rounds_full` title 同链、再退 sid
                    本身（ingest 的 (port,sid)→键 别名照样能取）。
                    ② **全帧服务器标识**：核查 mod（七模块走 send_json 咽喉
                    已盖 sid/srv_sid/srv）/vack/ledger_req/ev/hello 全带；
                    FOX 关闭裸发分支补 `srv_sid`（此前只有 sid/srv）。
                    0.36→0.37。
  0.36  2026-11-19  三要素闸门（老板最终口径，VERSION 仍 3.72 不升版）：
                    终身号存共享库、有时创建不及抓不到，但每个对话一定有名称。
                    ① **有号以号为锚；没号以名称作临时锚照常广播**——帧内
                    sid='' ＋ `nokey:1`，等拿到号客户端自动归并；绝不因暂时
                    无号压住广播。
                    ② **只拦 mid 缺与 title 缺**：mid 缺 → 该轮剔除（整帧若无
                    轮可发则不发）；title 缺 → 整帧不发。绝不拿号码当名字、
                    绝不拼「未命名会话/尾4位」假名。
                    ③ 新增 `_gate_弃发` 诊断（同组合 60s 一行：
                    `三要素不全 弃发 …`）。闸门落点：`_ledger_entity`（None＝
                    弃发）、`_on_ledger_req` 思维流帧；`_mod_push`/vcheck 补发/
                    `_ledger需补` 遇 None 各自跳过。纯状态帧（hb/ev/mod 非账本）
                    不受此闸。
                    ④ 回声分支补 `and self.cli_any(_ch)`——该频道没人登录就不
                    回（logout 后零消耗，不留 5 分钟尾巴）。0.35→0.36。
  0.35  2026-11-19  TR-1/TR-2 静默整改（老板新规）：服务器蹲守多频道但
                    **完全静默、不往频道发任何消息**；只有手机网页版 login
                    喊话才在该频道工作，logout 后零消耗，不靠 ping 判活。
                    ① TR-1 `_sender` 出向路由：删「无登录客户端时
                    targets=list(self._online)」兜底全频道广播，改
                    `targets=[ch for ch in self._online if self.cli_any(ch)]`，
                    空即不发。② TR-2 `_on_open`：删上线即 `send_hello()` 的
                    无条件广播（服务器主动发消息＝违规）；hello 只在被点名时
                    回（login→_push_full、who→announce、命令路由 hello 分支）。
                    `_report_peers()` 保留——它只进本机 realq，不外发。
                    ③ TR-3 服务端侧复核：`t=='hb'` 只登记在线时刻、不回 ack，
                    注释写明刻意设计、禁止后人加 hb_ack。0.34→0.35，VERSION 3.72。
  0.34  2026-11-19  互通实测补两刀（同属 3.71 一次上线）：
                    ① `_fnv` 输入由 utf-8 字节改 **UTF-16LE 码元**（逐 16 位
                    异或，等价 JS charCodeAt，emoji 代理对也逐码元一致）。
                    0.33 的 utf-8 口径与 W1 的 lbHash 对不上——中文必然不等
                    ⇒ 每次核对每会话都判缺 ⇒ 全量补发风暴。基准：'完成卡一'
                    →3285ee40、''→811c9dc5。
                    ② ledger 帧补 **title**（§七·:206／§八·:230／§十·:271）：
                    新增 `_title_of(sid)`——取会话列表缓存真名，取不到给 ''，
                    **绝不把 sid/4 位序号当 title**；`_ledger_entity` 返回体加
                    title，`ledger_req` 的思维流补发帧（原手工拼 dict）也补上。
                    0.33→0.34，VERSION 3.71（仍未重启）。
  0.33  2026-11-19  契约交叉核对修正（部署前，与 W1 客户端对齐）：
                    ① ver 键兼容——`_v = str(cv.get('ver') or cv.get('v')
                    or '')`，吃 W1 过渡版上报的 'v'；不兼容就会「每次核对
                    每个会话都判缺→全量补发风暴」。
                    ② hash 由 md5[:12] 改 **FNV-1a 32 位 8 位 hex**（新增
                    `_fnv` 静态方法，与客户端同口径）；取文改「index7 完成
                    卡摘要，空则回退 index1 正文」——思维流阶段没完成卡，
                    回退正文才能和客户端算到同一个串。账本 dict 取
                    fin_txt/text。
                    ③ `_ledger需补` 单条比较自带容错：fin 非整数只判「该条
                    不同」，绝不因一条脏数据把整个会话判 True。0.32→0.33，
                    VERSION 3.71（仍未重启）。
  0.32  2026-11-19  第五轮（V1.0 §七·:194「同号不同态」）：对账判据由
                    「会话 ver 字符串」升为「编码集合＋完成态＋正文指纹」。
                    ① 新增 `_row_code/_round_codes`——每轮 AI 行取
                    {mid, fin, hash}（fin＝index7 完成卡摘要非空 / 账本
                    rec.fin）；`_ledger_entity` 增 codes＋live（最新轮未
                    完成）。② 新增 `_ledger需补`：ver 快进短路 → mid 集合
                    差 → **同 mid 但 fin/hash 不同必判需补**（覆盖下发同
                    一轮，不新增行/轮）；旧客户端只报 ver 字符串仍按原比对
                    完全兼容。③ `_mod_push` ledger 闸：同 mid 同完成态、仅
                    正文变长（思维流直播）不推，只在「新号/换轮/fin 0→1」
                    推覆盖帧——定稿必推一次，不再因 ver 未变永远缺终极。
                    ④ vcheck 补发对新客户端（报 codes）不再被「上次推过同
                    内容」hash 闸吞掉（那正是永不补的坑），旧客户端保留原
                    Y7 闸防风暴。0.31→0.32，VERSION 3.71。
  0.31  2026-11-19  第四轮 ST 整改（Y23/Y27/Y7 复盘；Y24 在 命令路由 0.33
                    ＋抓取轮询 0.73）：① Y23·一次性 ev 事件发送侧幂等闸
                    ——send_json 咽喉按帧内容指纹 5s 去重（修「假 sid
                    cmderr 双发 2ms 差」「switch_ok 双发」等同一逻辑路径
                    重复发送；rcpt 源侧已按 rid 幂等不落本闸）。② Y27·
                    login 合并窗去滑动改固定窗——0.30 滑动窗在持续重连
                    风暴下把 login vack 永久饿死（每次重连落窗内→永不补
                    答→客户端再重连→死循环，静置 10 分钟 171 连/84
                    login）；固定窗窗满必补答，最坏 10s 一答。③ Y7 复盘
                    ·`_核对一发` ledger 补发同样过内容 hash 闸并回写
                    `_ledger_pushed`——0.30 只闸了 _mod_push，vcheck 补
                    发直推不记账，静置期每次 login 都把同一会话再灌一遍
                    （10 分钟 31 帧/515KB）。0.30→0.31，VERSION 3.70。
  0.30  2026-11-19  第三轮 ST 整改（Y7/Y11/Y13；Y20 在 命令路由 0.32）：
                    ① Y7·ledger 同内容连推根治——`_ledger_pushed` 表值改
                    (ver, 内容hash) 双键：ver 相等直接跳过（不重算实体）；
                    ver 变了先算 rounds 内容 hash，同 hash 整帧不推只记账
                    （修「生成期 tail/finish 指纹翻动、正文一字未变仍连推
                    40 帧/880KB」——内容才是唯一判据）。② Y11·无本地账本
                    切换首帧 1 轮——switch vcheck 到达时在 `_VCHECK_STATE`
                    记下时刻与客户端上报的 ledger 会话键（ts/cli_led），
                    `_mod_push` 推 ledger 首帧时若该会话是 30s 内刚切且
                    客户端没报过 ⇒ n_rounds=1（C5 口径，防清 IDB 后首帧
                    灌 5 轮）。③ Y13·login vcheck 合并窗 3s→10s——重连
                    风暴 6 条/27s 从回 3 条收敛到 ≤2 条（窗口首条即答，
                    后续静默合并）。0.29→0.30，VERSION 3.69。
  0.29  2026-11-18  V2 验收疑点整改（Y4/Y7/Y8/Y12/Y13；Y3 只归因不改码）：
                    ① Y4·排队条灌词剥离——_pend条目 组装 text 前先过新
                    增 `_剥排队原文`：剥首行 DID 后按固定行首标记认行
                    （【来自…】/【回信用…】/你的会话名：/你的终身号：/
                    本会话专属记忆位置：/【全局记忆】等灌词段）从首个灌词
                    行起吞到文末，再剥专属词尾巴与 (@fox-*) 标记；id 保留
                    （N3）。② Y7·指纹过敏收敛——ledger 主动推送改查
                    `_ledger_pushed` 持久表（不再随 pane 挂载/卸载起落，
                    修「同内容 18 连推 437KB」）；`_fp_convs` 的 convs_full
                    段只留 schedule 签名（status 变化只驱动轻量 sig，
                    修「convs 45 帧 384KB」）。③ Y8·卫兵升单例＋实质判据
                    ——`_vcheck_seq` 从实例级升为模块级单例
                    `_VCHECK_STATE`（跨主/副双路连接与全部线程共享），
                    且 `_等切换` 发 stage:2 前加「桌面选中==目标 sid」
                    实质判据：0.28 对号卫兵挡不住「迟到送达的旧 vcheck
                    自己领号变最新」（FOX 分段/批次延迟送达实测 36s），
                    迟到者领号后桌面停在别的会话 ⇒ 仍判陈旧作废。
                    ④ Y12·set_think_int 去重——同报文 2 秒窗内重复到达
                    只回一条 ack（一请求一回执）。⑤ Y13·login vcheck
                    短窗去重——同 act+mods 指纹 3 秒窗内重复 login 不
                    重复回全量。0.28→0.29，VERSION 3.68。
  0.28  2026-11-18  陈旧 stage:2 卫兵（V1.0 §九「强核对合并动作（只执行
                    最新的一个）」代码侧落地）：`_on_vcheck` act='switch'
                    分支给每个切换类 vcheck 发自增序号 `_vcheck_seq`；
                    `_等切换` 线程醒来发 stage:2 前先对号——期间有更大序号
                    的新切换 vcheck 到达 ⇒ 本条作废（不发 stage:2、不执行
                    `_核对一发`），由新 vcheck 自己的线程接管。背景：拥堵
                    时后到 switch 会把先到的合并掉（抓取轮询 2.98
                    `_合并连续切换`），旧线程醒来发的是拿旧会话数据的陈旧
                    核对，与 §三「60 秒失败唯一口径」冲突。报文格式/协议/
                    其它逻辑零改动。0.27→0.28，VERSION 3.67。
  0.27  2026-11-18  W1 接口对齐点(d)·小账本页调控 think 限频：_proto_sniff
                    新增 `{'t':'set_think_int','v':秒}` 处理——v>0 ⇒ 写
                    cfg think_live_sec（夹 1~600）并 think_live_limit_on=
                    True；v<=0 ⇒ 只关 think_live_limit_on（无间隔模式，
                    变更即发·E4）；改完 _save_cfg 立即落盘（免重启生效，
                    下拍 _mod_push 即按新值走），回执
                    {'t':'think_int_ack','ok','sec','on'}。其余 5 个对齐
                    点(a/b/c/e/f)纯文字裁定，零改动。0.26→0.27。
  0.26  2026-11-18  账本系统 V1.0·服务端协议（S1，协议定稿 §一~§八＋统筹批复
                    4 条；§八增量对照表 1-7 全项）：① `k='snap'` 整包拆 7 模块
                    独立帧——每模块指纹＝从 `_snap_fp`/`_pane_fp` 现有分段
                    **逐字拆出**（拼接口径不重写），无变更不下发实体（推送闸
                    `_last_mod_ver` 扩表）；实体帧形态 `{'t':'mod','m':…,'v':
                    …,'d':…,'ts':…}`（m=sig/snote/macct/convs/ledger/didp/
                    think），全帧仍由 send_json 盖 srv/srv_sid（A4），无人在线
                    零广播闸 cli_any 原样保留；② 新增四种上行报文分流
                    _proto_sniff（§八·6）：vcheck（act=login/switch/svr/timer，
                    上行单帧多模块编码·批复1）→ vack 两阶段回执（stage:1/2，
                    same/need/mods/nochange 照 §3.1；switch 的 stage2 等桌面
                    选中==目标 sid 再算，≤8s）；mod（单模块实体帧）；ledger_req
                    （按会话按轮按需补思维流，m='ledger' 携 think 段）；③
                    hello 增 mods 全模块底账（§八·3，登录重放照旧复用）；④
                    pend 项级化（§八·4）：每项 {id=首行14位DID(底层必带界面
                    隐藏·N3), text=剥首行DID+剥专属词尾巴+剥(@fox-*)标记后
                    原文·N2, sid=项级会话归属·N4, canEdit}，随 think 包携带
                    不独立收发（N1），顶层 pend_sid 兜底保留；服务端只对
                    「桌面当前选中会话」有准确排队数据（N5）；⑤ think 专属
                    5 秒丢弃式限频（cfg think_live_limit_on/think_live_sec，
                    窗口期中间版丢弃只发最新帧），只管 think，其余模块变更
                    即推（§八·5）；⑥ didp/macct 收编独立帧（§八·7，macct
                    账号子项=boxes·批复3；think 兼带正文·批复2——frame 含
                    msgs/finish/tail/sendIdle/online/login 整屏）；ledger 按
                    会话版本（_pane_fp 口径），差额补发仅人类+终极不带思维流
                    （G1），无本地账本只补 1 轮（C5）；⑦ 旧整包路径逐字保留，
                    cfg mod_push_on=False 一键回退。**未改任何冻结签名、未碰
                    动作串行执行页面（M1 零改动）**。配套 抓取轮询 0.72
                    （广播闸改 _模块总指纹）、痕迹与配置 0.22、VERSION 3.65。
                    需重启服务端（联调待重启批准）。
  0.25  2026-11-17  WS 静默整改（S27 A00109-1/A00108-3）：`_conn_loop` 的
                    退避归零判据由「本次连上过」改为「本次活够 120 秒」。
                    背景：00:00-08:39 网络抽风，连上 1 秒就被服务商掐，
                    旧逻辑每次把 fails 归零 → 固定 3 秒死磕，刷了 4041 次
                    重连；每次重连 `_on_open` 都 send_hello（含全量快照重放），
                    占今日 tx 九成。现退避 3→6→…→300 秒封顶，同样故障
                    最多几十次。VERSION 3.63→3.64，需重启服务端。
  0.07  2026-10-06  本专项·13.1 软件号规范整改（用户要求）：① 【有则必收】——
                    凡收到带实例号的帧（login/任何客户端帧，裸 JSON 亦然）即
                    写入/更新【设备名册】（痕迹与配置._roster_touch，软件号为
                    主键）；昵称非必填，随正文 nick 字段带上（FOX 帧头格式
                    不变）；② 名册每 3s 节流落盘（_sender 调 _roster_flush）；
                    ③ 13.3【限次限频】——_conn_loop 断线重连改逐次退避
                    （3→6→12→24→48→封顶 60s），连上即归零，不再无限 3s
                    空转；VERSION 2.85→2.86。
  0.08  2026-10-06  本专项·13.1 昵称条：新增 cli_online_disp
                    （在线客户端展示标签：有昵称显示昵称、否则软件号），供
                    网络工具页「主N（昵称）·副N（昵称）在线」显示；import
                    _roster_nick_of。

  0.09  2026-10-07  本专项·切换会话锚定与广播对齐（E 组）：forward_event 的
                    snap 分支重写——① did 按会话 sid 归属扫描（panes 各会话正文
                    一并比对，只销该 did 所属会话的卡，根治跨会话误销）；
                    ② 广播前剥离 panes 正文（取 5 个只播 1 个，防流量爆炸）；
                    ③ 活 pane 摘要（_panes_live）并入指纹，补偿隐藏会话「生成中/
                    完成任务」驱动广播，否则静默漏播。新增静态方法 _sel_sid /
                    _dedup_hits / _panes_live；_light_snap 一并剥离 panes；
                    multi_pane 开关（默认开）门控消费端（关=回退只读选中 1 个）。

  0.10  2026-10-07  堵静默漏网点（用户实测「WS 收发记录里两台服务器拼命刷事件」）：
                    _PortScanner 每 6s 一轮把本机端口在线清单 uiq.put(('ports',…))
                    投进 _TeeQueue，被 forward_event 当远程事件广播出去——0.05
                    整改「全程静默」时的漏网之鱼：两台服务器（HM/SS）各按各的
                    6s 定时器在 main 频道互发 {"t":"ev","k":"ports"}，20 分钟
                    351 条、占全部流量 57%。今把 'ports' 并入 forward_event 的
                    不转发名单，端口扫描结果只进本地队列刷「端口在线 x/y」标签，
                    **绝不上 WS**；在线服务端名册改由既有「↻ 刷新」按钮
                    点名 {'t':'who'} → 在线者 hello 应答（名册/在线数走 hello
                    的 alive 字段，网页端 上线与界面.js 已按其刷新）。
                    VERSION 3.02→3.03。
  0.11  2026-10-19  did_hits **后台算完再合帧**（老板追加 · 卡顿整改）——`forward_event`
                    的 snap 分支原先**在调用方线程**（经 `_on_snap` 的主线程）**同步**跑
                    `_did_hits`/`_did_sim`（SequenceMatcher 重算）——`_DID_LOG` 登记保留 12h，
                    故每次快照都要对全部在册 did 与整屏消息文本重算，主线程被拖慢。现：
                    ① 本拍只注入「**上一拍**后台 worker 算好的」命中：`_h = 痕迹与配置.命中_取缓存()`
                       （命中首次变化仍必广播——先注入、后算指纹，口径同 2.31）；
                    ② 用**本拍** msgs/pend/panes 抛 `痕迹与配置.命中_后台算(任务)`（任务＝
                       `_dedup_hits(命中_算(...))`）算下一拍命中——单 worker、绝不阻塞本线程；
                    ③ 多 pane 口径不变（pends 仅给选中 pane；`_panes_live` 仍并入指纹），
                       panes 仍剥离不进包。代价：命中消卡滞一拍（~1.5s），业务语义不变。
                    配套 痕迹与配置 0.08→0.10（新增 命中_取缓存/命中_后台算/命中_算）。
【本模块职责】PieSocket 中继连接与收发：FOX 分段入流（_FoxIn）、UI 队列旁路
  （_TeeQueue）、远程桥接（_RemoteBridge）、WebSocket 客户端（_WS）（纯逻辑）。
【来源】原样切割自 服务端 L1597-2356；类整体搬运，类体逐字未改。
  头部为新增结构壳：必要 import + 共享资源装配。
"""
import base64
import hashlib
import json
import os
import queue
import random
import re
import socket
import string
import struct
import threading
import time

from 运行时 import VERSION

try:
    import websocket
    HAS_WS = True
except ImportError:
    HAS_WS = False

import 痕迹与配置
import WS收发记录              # 纯诊断用「WS 收发原文」记录器（开关关时零开销）
from 痕迹与配置 import (
    WS_CHANNEL, WS_URL_TMPL, WS2_URL_TMPL,
    _FOX_HDR_RE, _FOX_HDR_BYTES, _FOX_MAX_PAYLOAD, _FOX_MAX_SEGMENTS,
    _FOX_RSN_HDR_BYTES, _FOX_BATCH_SIZE, _FOX_BATCH_TIMEOUT,
    _FOX_BATCH_QRY_MAX, _FOX_FAIL_DEADLINE, _FOX_DOWNGRADE, _FOX_SENT_KEEP,
    _FOX_ACK_RE, _FOX_QRY_RE, _FOX_RSN_RE, _FOX_FAIL_RE,
    _trace_dir, _detail_add, _ensure_cfg, _roster_touch,
    _roster_nick_of,
    _fox_slice_bytes,
    _frame_classify, _mon, _srv_name, _srv_sid, _stats_add,
)
CFG = 痕迹与配置._ensure_cfg()   # 共享同一配置对象（取首次加载后的持久引用）

# D14（2026-10-19·老板「只留最外层表面」）：广播 AI 行**单条正文上限**（字）——
#   1000~2000 区间取 1500，轻便；用户行（含首行 DID）不截。仅广播副本生效。
# ⚠ 2026-10-20 14:4x（实测 A 组发现·老板 12:50 硬口径「**原版人眼可见＝网页版必须可见**」）：
#   **1500 会把长 AI 行截尾**（实测 0002 row3：原版 1562 字 → 网页端只 1500 字，**尾部
#   含语音卡段被切**，语音卡内正文残缺）⇒ **抬到 8000**（覆盖"一屏可见"的绝大多数长行）。
#   若老板要求"完全逐字不截"，可再取消本上限（代价＝单帧体积增大）。
_广播正文上限 = 8000

# 0.29（Y8）：切换类 vcheck 的「最新切换上下文」收【模块级单例】——跨主/副
#   双路连接、跨全部线程共享（0.28 挂在桥实例上的 `_vcheck_seq` 与单桥各线程
#   本可共享，但实测卫兵没拦住：迟到送达的旧 vcheck（FOX 分段/批次延迟，
#   实测迟到 36s）自己领号变「最新」，对号卫兵形同虚设）。升单例后再叠加
#   「桌面选中==目标 sid」实质判据（_等切换 发 stage:2 前核对），迟到/合并/
#   被顶替三种形态全部拦住。V1.0 §九「强核对合并动作（只执行最新的一个）」。
_VCHECK_LOCK = threading.Lock()
_VCHECK_STATE = {'seq': 0, 'sid': '', 'ts': 0.0, 'cli_led': None}
# 0.30（Y13）：login vcheck 10s 滑动合并窗——窗外首条立即答；窗内后续
#   到达只记「最新一条」不答并把窗尾顺延（最新到达+10s），窗满由定时
#   线程补答最新一条。窗状态挂桥实例 `_login_merge`（主/副双路连接共
#   享同一实例），锁模块级。
_LOGIN_MERGE_SEC = 10.0
_LOGIN_MERGE_LOCK = threading.Lock()
# 0.31（Y23）：一次性 ev 事件发送侧幂等闸（send_json 按内容指纹 5s 去重）。
#   表挂桥实例 `_send_idem`；锁模块级（send_json 被多线程共用）。
_SEND_IDEM_TTL = 5.0
_SEND_IDEM_LOCK = threading.Lock()


# ==================== 2026-11-02 老板令：CDP 正文新鲜度闸 ====================
def _mid秒(m):
    """取消息 ID 的秒级时间（mid 前 8 位＝16 进制 Unix 秒）；取不到返回 0。"""
    try:
        if isinstance(m, (list, tuple)):
            mid = str(m[6] if len(m) > 6 else "")
        elif isinstance(m, dict):
            mid = str(m.get("mid") or "")
        else:
            mid = ""
        mid = mid.strip()
        if len(mid) >= 8:
            return int(mid[:8], 16)
    except Exception:
        return 0
    return 0


def _正文新鲜闸(val, bridge):
    """广播前闸门：CDP 正文必须「不比账本最新一条旧」，否则本拍广播没意义。

    老板口径（2026-11-02）：TRAE 切换/答完会自己跳到较靠前的历史，这种拍里
    CDP 抓到的正文是旧的；广播它等于让手机看到过期内容。判据＝正文最后一条
    的 ID 时间必须 >= 账本最新一条的 ID 时间。不合格就用**账本最新 2 轮**顶替。
    合格 / 无法判定 ⇒ 返回 None（正文原样，零回归）。
    """
    try:
        ld = 痕迹与配置._get_ledger()
        if ld is None or not isinstance(val, dict):
            return None
        msgs = val.get("msgs")
        if not isinstance(msgs, list) or not msgs:
            return None
        port = getattr(getattr(bridge, "dlg", None), "port", None)
        try:
            sid = str(bridge._sel_sid(val) or "")
        except Exception:
            sid = str(val.get("sid") or "")
        if not sid:
            return None
        rows = []
        for k in (sid, sid[:4] if sid[:4].isdigit() else ""):
            if not k:
                continue
            try:
                if ld.有会话(port, k):
                    rows = ld.get_prev(port, k, 10 ** 9, 6)
                    if rows:
                        break
            except Exception:
                continue
        if not rows:
            return None
        # 2026-11-02 老板补充：CDP 一抓一大段、里面有很多 ID —— 不取「最后一行」，
        #   而是**取这些 ID 里最晚的一条**与账本最晚的一条比；相等或更晚才放行。
        ref = 0
        for _r in rows:
            _s = _mid秒(_r)
            if _s > ref:
                ref = _s
        now = 0
        for _m in msgs:
            _s = _mid秒(_m)
            if _s > now:
                now = _s
        if now and ref and now >= ref:
            return None                       # 本拍不旧 ⇒ 放行
        # 取账本最后两轮（从倒数第 2 个人类提问起）
        起 = 0
        找 = 0
        for i in range(len(rows) - 1, -1, -1):
            if str((rows[i] or {}).get("role") or "") == "u":
                找 += 1
                if 找 == 2:
                    起 = i
                    break
        out = []
        for r in rows[起:]:
            out.append(["u" if str(r.get("role") or "") == "u" else "a",
                        str(r.get("text") or ""), str(r.get("tm") or ""),
                        1 if r.get("can_rev") else 0,
                        1 if r.get("can_del") else 0, "",
                        str(r.get("mid") or ""),
                        str(r.get("fin") or "")])   # 2026-11-05：补齐第 8 位（终极回复），
                                                    # 与 CDP 路径 msgs 行严格同构
        return out or None
    except Exception:
        return None


def _正文上限():
    """2026-10-22（老板 09:15「广播参数」格）：单条正文广播上限改为**配置驱动**
    （`broadcast_max_chars`，UI 在「对话与广播」页·广播参数格，默认 8000）。
    读不到/非法值一律回落到模块常量，广播行为与旧版一致。"""
    try:
        v = int(_ensure_cfg().get('broadcast_max_chars', _广播正文上限) or
                _广播正文上限)
        return v if v >= 200 else _广播正文上限
    except Exception:
        return _广播正文上限

class _FoxIn(object):
    """FOX v2.1 接收侧：分段拼装 + 控制帧分流 + 批次报告 + 按偏移写回补发
    + 60 秒空闲硬超时兜底。控制帧（ACK/QRY/RSN/FAIL）绝不进正文流。"""

    def __init__(self, ctrl_send=None, out=None, on_deliver=None,
                 log=None, is_self=None):
        self.buf = {}            # {mid: {total, sender, segs:{i:{len,pieces}}}}
        self.lock = threading.Lock()
        self._ctrl_send = ctrl_send    # ctrl_send(ch, text)：回发控制帧
        self._out = out                # _FoxOut：收到的 ACK 交给发送侧
        self._on_deliver = on_deliver  # on_deliver(sender, body, ch)：正文投递
        self._log = log or (lambda *a: None)
        self._is_self = is_self        # 判「自己的回声」的 sid 取值函数

    @staticmethod
    def is_ctrl(msg):
        return msg.startswith(('【FOXACK:', '【FOXQRY:',
                               '【FOXRSN:', '【FOXFAIL:'))

    def feed_ctrl(self, msg, ch='main'):
        """处理一条控制帧；返回 True=已消费。"""
        if msg.startswith('【FOXACK:'):
            m = _FOX_ACK_RE.match(msg)
            if m and self._out:
                miss = [int(x) for x in m.group(5).split(',') if x.strip()]
                self._out.on_ack(m.group(1), int(m.group(2)), miss, ch)
            return True
        if msg.startswith('【FOXQRY:'):
            m = _FOX_QRY_RE.match(msg)
            if m:
                self._report_batch(m.group(1), int(m.group(2)), None, ch)
            return True
        if msg.startswith('【FOXRSN:'):
            self._on_rsn(msg, ch)
            return True
        if msg.startswith('【FOXFAIL:'):
            m = _FOX_FAIL_RE.match(msg)
            if m:
                self._give_up(m.group(1), '对端已放弃')
            return True
        return False

    def feed(self, msg, ch='main'):
        """喂一条原始 WS 文本。是 FOX 数据帧则消化（拼齐时经 on_deliver
        投递）并返回 True；非 FOX 数据帧返回 False。"""
        m = _FOX_HDR_RE.match(msg)
        if not m:
            return False
        ts, rnd, sender = m.group(1), m.group(2), m.group(3)
        idx, total = int(m.group(4)), int(m.group(5))
        seg = msg.encode('utf-8')[_FOX_HDR_BYTES:]
        if total <= 1:
            if self._on_deliver:
                self._on_deliver(sender, seg.decode('utf-8', 'replace'), ch)
            return True
        if self._is_self and self._is_self(sender):
            return True              # 自己的回声：不建缓冲、不回报（防自答）
        mid = ts + rnd
        with self.lock:
            d = self.buf.get(mid)
            if d is None:
                d = self.buf[mid] = {'total': total, 'sender': sender,
                                     'segs': {}, 'timer': None}
            d['segs'][idx] = {'len': len(seg), 'pieces': {0: seg}}
            self._arm_timer(mid)
            body = self._try_deliver(mid)
            batch = (idx - 1) // _FOX_BATCH_SIZE + 1
            need_report = (idx == min(batch * _FOX_BATCH_SIZE, total))
        if need_report:
            self._report_batch(mid, batch, total, ch)
        if body is not None and self._on_deliver:
            self._on_deliver(sender, body, ch)
        return True

    @staticmethod
    def _seg_bytes(seg):
        """把某段的 pieces 按偏移拼成完整字节串；允许相互重叠（先到铺底、
        后到只补末尾）。多轮降级补发（粗切→细切）会留重叠片，严格判段会
        永不补齐。"""
        if not seg:
            return None
        out = bytearray()
        for k in sorted(seg['pieces']):
            b = seg['pieces'][k]
            if k > len(out):
                return None              # 中间有真缺口 → 还不齐
            if k < len(out):
                b = b[len(out) - k:]
            out += b
        if len(out) < seg['len']:
            return None
        return bytes(out[:seg['len']])

    def _try_deliver(self, mid):
        d = self.buf.get(mid)
        if not d:
            return None
        chunks = []
        for i in range(1, d['total'] + 1):
            b = self._seg_bytes(d['segs'].get(i))
            if b is None:
                return None              # 还缺段，继续等补发
            chunks.append(b)
        self._cancel_timer(d)
        self.buf.pop(mid, None)
        return b''.join(chunks).decode('utf-8', 'replace')

    def _missing(self, d, lo, hi):
        return [i for i in range(lo, hi + 1)
                if self._seg_bytes(d['segs'].get(i)) is None]

    def _arm_timer(self, mid):
        d = self.buf.get(mid)
        if not d:
            return
        self._cancel_timer(d)
        t = threading.Timer(_FOX_FAIL_DEADLINE, self._recv_timeout, (mid,))
        t.daemon = True
        d['timer'] = t
        t.start()

    @staticmethod
    def _cancel_timer(d):
        t = d.get('timer')
        if t is not None:
            try:
                t.cancel()
            except Exception:
                pass
            d['timer'] = None

    def _recv_timeout(self, mid):
        self._give_up(mid, '接收超时')

    def _give_up(self, mid, tag):
        with self.lock:
            d = self.buf.pop(mid, None)
            if not d:
                return
            self._cancel_timer(d)
            got = d['total'] - len(self._missing(d, 1, d['total']))
        self._log('长消息接收失败：ID=%s（%s，收到 %d/%d 段）'
                  % (mid, tag, got, d['total']))

    def _report_batch(self, mid, batch, total, ch):
        """接收方主动向发送方回报某批接收情况（miss 为空 = 本批收齐）。"""
        if total is None:
            with self.lock:
                dd = self.buf.get(mid)
            total = dd['total'] if dd else batch * _FOX_BATCH_SIZE
        lo = (batch - 1) * _FOX_BATCH_SIZE + 1
        hi = min(batch * _FOX_BATCH_SIZE, total)
        with self.lock:
            d = self.buf.get(mid)
            miss = self._missing(d, lo, hi) if d else []
        if not self._ctrl_send:
            return
        self._ctrl_send(ch, '【FOXACK:%s=batch(%03d):range(%03d-%03d)'
                            ':miss(%s)】'
                        % (mid, batch, lo, hi,
                           ','.join('%03d' % i for i in miss)))

    def _on_rsn(self, msg, ch):
        m = _FOX_RSN_RE.match(msg)
        if not m:
            return
        mid = m.group(1)
        seg_idx = int(m.group(3))
        seg_len = int(m.group(4))
        off = int(m.group(7))
        payload = msg.encode('utf-8')[_FOX_RSN_HDR_BYTES:]
        report = None
        sender = None
        body = None
        with self.lock:
            d = self.buf.get(mid)
            if not d:
                return               # 已交付/已终局，忽略迟到的补发
            sender = d.get('sender')
            seg = d['segs'].get(seg_idx)
            if seg is None:
                seg = d['segs'][seg_idx] = {'len': seg_len, 'pieces': {}}
            seg['len'] = seg_len
            seg['pieces'][off] = payload
            self._arm_timer(mid)
            body = self._try_deliver(mid)
            batch = (seg_idx - 1) // _FOX_BATCH_SIZE + 1
            d2 = self.buf.get(mid)
            total = d2['total'] if d2 else d['total']
            lo = (batch - 1) * _FOX_BATCH_SIZE + 1
            hi = min(batch * _FOX_BATCH_SIZE, total)
            miss = self._missing(d2, lo, hi) if d2 else []
            if not miss:
                report = (mid, batch, total)
        if report:
            self._report_batch(report[0], report[1], report[2], ch)
        if body is not None and self._on_deliver:
            self._on_deliver(sender, body, ch)


class _FoxOut(object):
    """FOX v2.1 发送侧：分批结算 + 留底(LRU) + 超时催问 + 64→32→16KB 降级
    补发 + FAIL 兜底。send() 在发送线程内同步推进各批（ACK 由 WS 收线程
    on_ack 唤醒），以此保证同一发送线程内消息先后顺序不被打乱。"""

    def __init__(self, record=None, log=None):
        self.sent = {}          # mid -> {'sender_id','segments':[bytes],'ts'}
        self.batches = {}       # mid -> {'batch','lo','hi','qry','repair','ev'}
        self.lock = threading.Lock()
        self._record = record or (lambda *a: None)
        self._log = log or (lambda *a: None)
        self._live = []
        self._fc = self._ft = None

    def _raw(self, frame):
        for ch, w in self._live:
            try:
                w.send(frame)
                self._record(ch, frame, self._fc, self._ft)
            except Exception:
                pass

    def _ctrl(self, frame):
        try:
            fc, ft = _frame_classify(frame)
        except Exception:
            fc, ft = None, None
        for ch, w in self._live:
            try:
                w.send(frame)
                self._record(ch, frame, fc, ft)
            except Exception:
                pass

    @staticmethod
    def _new_mid():
        return time.strftime('%Y%m%d%H%M%S') + ''.join(
            random.choices(string.ascii_lowercase, k=8))

    def send(self, text, live, sender_id):
        """发送线程内串行调用：单段直发；多段分批结算。"""
        self._live = list(live)
        self._fc, self._ft = _frame_classify(text)
        segs = _fox_slice_bytes(text.encode('utf-8'), _FOX_MAX_PAYLOAD)
        total = len(segs)
        if total > _FOX_MAX_SEGMENTS:
            self._log('消息过长：需 %d 段，超过上限 %d 段，已放弃'
                      % (total, _FOX_MAX_SEGMENTS))
            return
        if total <= 1:
            self._raw('【FOXID:%s%s=cut(001/001)】%s'
                      % (self._new_mid(), sender_id, segs[0].decode('utf-8')))
            return
        mid = self._new_mid()
        with self.lock:
            self.sent[mid] = {'sender_id': sender_id, 'segments': segs,
                              'ts': time.time()}
            while len(self.sent) > _FOX_SENT_KEEP:   # LRU 兜底，防无限留底
                oldest = min(self.sent, key=lambda k: self.sent[k]['ts'])
                if oldest == mid:
                    break
                del self.sent[oldest]
        nbatch = (total + _FOX_BATCH_SIZE - 1) // _FOX_BATCH_SIZE
        for batch in range(1, nbatch + 1):
            lo = (batch - 1) * _FOX_BATCH_SIZE + 1
            hi = min(batch * _FOX_BATCH_SIZE, total)
            st = {'batch': batch, 'lo': lo, 'hi': hi, 'qry': 0,
                  'repair': 0, 'miss': None, 'ev': threading.Event()}
            with self.lock:
                self.batches[mid] = st    # 铁律：先登记再发送（末段会同步回送）
            self._emit_batch(mid, st)
            if not self._await_batch(mid, st):
                return
        self._clear(mid)

    def _emit_batch(self, mid, st):
        with self.lock:
            buf = self.sent.get(mid)
        if not buf:
            return
        segs = buf['segments']
        total = len(segs)
        sid = buf['sender_id']
        for idx in range(st['lo'], st['hi'] + 1):
            self._raw('【FOXID:%s%s=cut(%03d/%03d)】%s'
                      % (mid, sid, idx, total, segs[idx - 1].decode('utf-8')))
            if idx < st['hi']:
                time.sleep(0.2)          # 规范：段间隔 ≥0.2s

    def _await_batch(self, mid, st):
        """等本批 ACK：无缺→True（可发下一批）；有缺→降级补发后再等；
        超时→先催问 1 次；再超时/降级用尽→FAIL 并返回 False。"""
        while True:
            if not st['ev'].wait(_FOX_BATCH_TIMEOUT):
                if st['qry'] < _FOX_BATCH_QRY_MAX:
                    st['qry'] += 1
                    self._ctrl('【FOXQRY:%s=batch(%03d):range(%03d-%03d)】'
                               % (mid, st['batch'], st['lo'], st['hi']))
                    continue
                self._fail(mid, [])
                self._clear(mid)
                return False
            miss = st['miss'] or []
            if not miss:
                return True
            st['repair'] += 1
            size = _FOX_DOWNGRADE.get(st['repair'])
            if size is None:
                self._fail(mid, miss)
                self._clear(mid)
                return False
            self._resend(mid, miss, size, st['repair'])
            st['qry'] = 0            # 换新一轮，催问计数归零
            st['miss'] = None
            st['ev'].clear()

    def _resend(self, mid, miss, size, rnd):
        """把缺段按指定尺寸重切重发（RSN），片带原段号与原段内偏移。"""
        with self.lock:
            buf = self.sent.get(mid)
        if not buf:
            return
        cap = size - _FOX_RSN_HDR_BYTES
        segs = buf['segments']
        for seg_idx in miss:
            if seg_idx < 1 or seg_idx > len(segs):
                continue
            seg = segs[seg_idx - 1]
            pieces = _fox_slice_bytes(seg, cap)
            npiece = len(pieces)
            off = 0
            for pi, piece in enumerate(pieces, 1):
                self._raw('【FOXRSN:%s=r%02d:seg(%03d):len(%06d)'
                          ':cut(%03d/%03d)@%06d】%s'
                          % (mid, rnd, seg_idx, len(seg), pi, npiece, off,
                             piece.decode('utf-8')))
                off += len(piece)
                time.sleep(0.2)

    def on_ack(self, mid, batch, miss, ch=''):
        """WS 收线程回调：登记本批缺失并唤醒发送线程（重复/过期报告忽略）。"""
        with self.lock:
            st = self.batches.get(mid)
            if not st or st['batch'] != batch or st['ev'].is_set():
                return
            st['miss'] = miss
            st['ev'].set()

    def _fail(self, mid, miss):
        self._ctrl('【FOXFAIL:%s=gave_up:miss(%s)】'
                   % (mid, ','.join('%03d' % i for i in miss)))
        self._log('长消息发送放弃：ID=%s（%s）'
                  % (mid, '降级补发用尽' if miss else '接收方未报告'))

    def _clear(self, mid):
        with self.lock:
            self.batches.pop(mid, None)
            self.sent.pop(mid, None)


class _TeeQueue(object):
    """事件二路分发：put 同步进本地 uiq（原行为不变）+ 转发远程桥；
    get_nowait 透传本地队列（_drain 照旧消费）。"""

    def __init__(self, real, bridge):
        self._real = real
        self._bridge = bridge

    def put(self, item):
        self._real.put(item)
        # 2.52：快照不再由此处转发——改由主线程 _on_snap 给每条消息
        # 盖好服务端时间戳（msgs 第 6 位）后再 forward_event，保证下发的
        # 时间以服务端为准（用户决策）。其余事件照旧立即转发。
        if isinstance(item, tuple) and item and item[0] == 'snap':
            return
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
    · 免 PING 保活（由中继自动保持在线）；断线 3s 自动重连；FOX 分段收发。"""

    RECONNECT = 3            # 断线重连间隔（秒）
    # 1.51：客户端登录/心跳 + 广播闸门（WS 节流）
    #   客户端登录期间每 60s 发一次 hb（心跳）；超过 LOGIN_TMO 无 hb
    #   判为下线。**无任何客户端在线时不广播任何远程事件**——尤其
    #   最耗流量的 msgs（AI 聊天记录，含全部历史）；客户端登录/回到
    #   前台时再整包重放（send_hello）。
    HB_SEC = 300             # P32：客户端心跳间隔 60→300 秒（5 分钟）
    LOGIN_TMO = 900          # P32：无心跳判下线 150→900 秒（3× 心跳，容忍丢两拍）
    PEER_TMO = 900           # P32：「在线客户端数」统计窗口（与 LOGIN_TMO 对齐）

    def __init__(self, realq, dlg):
        threading.Thread.__init__(self, daemon=True)
        self.realq = realq    # 本地 uiq 原队列（入向命令回投用）
        self.dlg = dlg        # 服务端面板（取状态/读几何）
        self.outq = queue.Queue()
        # FOX v2.1：发送侧状态机（分批/留底/催问/降级/FAIL）+ 接收侧拼装器
        # （控制帧分流/批次报告/补发写回/60s 硬超时）。_FoxOut 在发送线程内
        # 串行推进各批，保证同一发送线程内消息先后顺序不被打乱。
        self.fox_out = _FoxOut(record=self._rec_out, log=self._fox_log)
        self.fox_in = _FoxIn(ctrl_send=self._ctrl_send, out=self.fox_out,
                             on_deliver=self._deliver, log=self._fox_log,
                             is_self=_srv_sid)
        self.stop_ev = threading.Event()
        self.ws = None
        self.on_line = False
        # 1.78：双频道（主 main / 副 backup）——同一 outq 复用，
        # 出向按「本频道有无登录客户端」路由；副频道平时零广播。
        self.ws2 = None          # 副频道连接（兼容：self.ws 仍是主）
        self._conns = {}         # ch -> ws（含 main/backup）
        self._online = set()     # 已登上频道的 ch 集合
        self._open_ts = {}       # v3.64：ch -> 本次连接建立时刻（判断「活够 120 秒」才重置退避）
        self._disc = []              # v1.61：断联落账内存环（供网络工具分页）
        self._chanlog = {}           # 1.03：频道活动日志 {ch: [行]}（日志区用）
        self._last_snap = None       # 最新快照（hello 重放）
        self._last_models = None     # 最新模型列表（hello 重放）
        self._last_snap_fp = None    # 快照指纹（去重）
        # 0.26（账本协议 V1.0·S1）：模块化下发——「已下发版本表」（§八·2，
        #   复用 _last_snap_fp 思路从单指纹扩为按模块指纹表）。键=模块标识
        #   （sig/snote/macct/convs/didp/think，ledger 另按会话细分为子表）；
        #   值=该模块上次实际下发的 12 位十六进制 ver。think 限频状态两件
        #   （上次 think 帧下发时刻 / 下发过的 ver）。
        self._last_mod_ver = {}
        self._think_last_ts = 0.0
        self._think_last_ver = None
        # 0.29（Y7）：ledger 主动推送的「已下发内容 ver」持久表（按 sid）——
        #   与 _last_mod_ver['ledger']（=当前可见范围快照，随 pane 起落）分开
        #   记账：pane 卸载再挂载同内容不再重推（修「同内容 18 连推」）。
        self._ledger_pushed = {}
        # 0.29（Y12）→0.30：小报文去重——set_think_int 同报文 2s 窗只回
        #   一条 ack；login vcheck 改 10s 滑动合并窗 `_login_merge`
        #   （Y13：窗外首条立即答、窗内只记最新一条、窗满补答最新一条）。
        self._think_int_last = ('', 0.0)
        self._login_merge = {'fp': '', 'end': 0.0, 'pend': None}
        # 0.31（Y23）：ev 一次性事件幂等闸表（key=帧内容指纹，value=放行时刻）
        self._send_idem = {}
        # 0.21（任务A）：按需单会话下发——网页端明确请求的目标会话 + 限频/去重状态。
        #   _pane_demand: {'sid','title','ts'}（None=无需求，绝不做后台全会话采集）
        #   _pane_last_ts/_pane_last_fp: 每个会话「上次真正下发」的时刻/内容指纹
        #   _last_panes: 本拍各 pane 副本（供重连首拍立即补发，不额外打 CDP）
        self._pane_lock = threading.Lock()
        self._pane_demand = None
        self._pane_last_ts = {}
        self._pane_last_fp = {}
        self._last_panes = {}
        # X3-1（0.20）：上一拍 `sendIdle`——用于侦测「忙↔闲」翻转，
        #   翻转瞬间强制清一次广播指纹放行一帧（双保险）。
        self._last_snap_idle = None
        self._remote_export = False  # 远程发起完整导出（本地不弹保存框）
        self._sent_echo = []         # 1.04：fox_on 关闭时最近发送原文（防回声）
        # 1.20：最近客户端统计——sender → 最后一次报文时刻；
        # 60 秒窗口内数出的条数=「在线客户端数」，0=待命中
        self._peers = {}
        self._last_peer_n = -1
        self._peer_lock = threading.Lock()
        # 1.23：远方服务端注册表（name → {v,box,port,boxes,alive,
        # conn,sid,ts}）；0.05 起本机平时全程静默、不主动播报，仅在
        # 收到 who 点名/上线报到时刷新；75s 无刷新判离线。
        self._srv_lock = threading.Lock()
        self.srv_peers = {}
        # 1.51：客户端登录表（sender → {'ts','fg'}）——节流核心。
        #   login/hb 刷新 ts（fg=是否前台）；logout 或超时即移除。
        #   无人在线 → forward_event 直接丢弃远程事件（不广播）。
        self._cli_lock = threading.Lock()
        self._clients = {}
        self._cli_n = -1

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
        """广播本机服务端信息（**仅在收到 who 点名时**应答；平时全程
        静默、不主动与其它服务端互相报状态）。未命名不广播（名字是
        远方识别本机的唯一键）。"""
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
                    'srv_peers', 'srv_conflict', 'ask_launch',
                    'ports'):
            return                     # 本地交互事件，不转发（ports 见 0.10）
        # 1.51：先无条件更新缓存（掉线期/无人在线都要留最新，供重放）
        if kind == 'models':
            self._last_models = val
        # 1.51：广播闸门——无客户端登录在线时，不广播任何远程事件。
        #   最耗流量的 msgs（AI 聊天记录，含全部历史消息）在此彻底停发，
        #   直到有客户端登录（_push_full 整包重放补齐）。
        if not self.cli_any():
            return
        if not self._online:
            return   # 1.78：任一频道在线即可放行（主离线副在线也能广播）
        if kind == 'models':
            # 0.26（账本协议 V1.0·S1，§八·7）：模型列表收编 `macct` 模块
            #   （模型+账号+boxes 合并模块·批复3）——按指纹变更即推
            #   `{'t':'mod','m':'macct',…}` 实体帧；裸 k='models' 帧仅
            #   mod_push_on=False 回退路径保留。
            try:
                if _ensure_cfg().get('mod_push_on', True):
                    self._macct_push()
                    return
            except Exception:
                pass
            self.send_json({'t': 'ev', 'k': 'models', 'v': val,
                            'srv': _srv_name()})
            return
        if kind == 'snap':
            # 0.12：首行 DID 池广播（老板 2026-10-19 终极办法）——快照逐会话扫「消息
            #   首行 14 位数字」（=网页版发送时插入的 DID），新进流的 DID 收进该会话池
            #   （最近 10 条），池子有新增即以独立帧 `k='did_pool'` 下发。**与快照指纹解耦**
            #   （池子变即发，网页端凭它兜底销卡）。不再回传 did_hits、不再相似度比对。
            # E3（2026-10-07 · 本专项 E 组）：广播前剥离 panes 正文（取 5 个只播 1 个，
            #   防流量爆炸 R-A）；活 pane 摘要（_panes_live）并入指纹补偿隐藏会话
            #   「生成中/完成任务」驱动广播，否则静默漏播（R-B）。
            _mp = True
            try:
                _mp = bool(_ensure_cfg().get('multi_pane', True))
            except Exception:
                _mp = True
            _panes = val.get('panes') if isinstance(val, dict) else None
            _live = ''
            _pool_frames = []
            try:
                if isinstance(val, dict):
                    _多panes = (_panes if (_mp and isinstance(_panes, list)
                                          and _panes) else None)
                    # 0.21（任务A）：**在剥 panes 之前**处理「按需单会话」——
                    #   桌面不在需求会话时，从本拍 pane 单独下发一帧（只 1 个会话）。
                    #   常规流的 panes 剥离/指纹口径一字不动（省流不变）。
                    #   注释：独立于 multi_pane 开关——网页端**明确请求**的会话
                    #   正文照发（multi_pane 只门控常规快照是否消费 panes）。
                    if isinstance(_panes, list) and _panes:
                        try:
                            self._pane_on_demand(_panes, val)
                        except Exception:
                            pass
                    # 首行 DID 池：顶层（选中会话）+ 各可见 pane（各自会话）
                    try:
                        _fr = 痕迹与配置.池子_登记(
                            val.get('msgs'), self._sel_sid(val),
                            self._sel_title(val))
                        if _fr:
                            _pool_frames.append(_fr)
                    except Exception:
                        pass
                    if _多panes is not None:
                        for _p in _多panes:
                            if not isinstance(_p, dict):
                                continue
                            try:
                                _fr = 痕迹与配置.池子_登记(
                                    _p.get('msgs'), _p.get('sid') or '',
                                    self._title_of_sid(val, _p.get('sid')))
                                if _fr:
                                    _pool_frames.append(_fr)
                            except Exception:
                                continue
                        _live = self._panes_live(_panes)
                    if 'panes' in val:
                        val = dict(val)
                        val.pop('panes', None)
            except Exception:
                pass
            # 0.23（排队条串台）：广播前兜底盖归属——抓取轮询 0.58 已在采集侧写
            #   `pend_sid`；旁路/旧快照没写时在此补一次（pend 只取桌面选中 pane
            #   ⇒ 归属＝本拍选中会话 `_sel_sid(val)`）。只加字段，不改采集/渲染口径。
            try:
                if (isinstance(val, dict) and val.get('pend')
                        and not val.get('pend_sid')):
                    _psid = self._sel_sid(val)
                    if _psid:
                        val = dict(val)
                        val['pend_sid'] = _psid
            except Exception:
                pass
            # 池子新增即广播（独立帧，不受快照指纹去重影响）
            # 0.26（账本协议 V1.0·S1）：mod_push_on=True 时改走 `didp` 模块帧
            #   （_mod_push 内部按全量池子指纹/实体下发，F5 独立编码参与核对）；
            #   此处旧 `k='did_pool'` 帧仅 mod_push_on=False 回退路径使用。
            try:
                if not _ensure_cfg().get('mod_push_on', True):
                    for _fr in _pool_frames:
                        self.send_json({'t': 'ev', 'k': 'did_pool', 'v': _fr,
                                        'srv': _srv_name()})
            except Exception:
                pass
            # 2026-11-02 老板令：CDP 正文新鲜度闸——正文比账本旧就改用账本最新 2 轮
            try:
                _新ms = _正文新鲜闸(val, self)
                if _新ms:
                    val = dict(val)
                    val["msgs"] = _新ms
            except Exception:
                pass
            # D14（2026-10-19·老板「只留最外层表面」）：**广播正文限长**——AI 行单条
            #   正文截到 _广播正文上限 字（用户行含首行 DID、不截）；**在副本上做**，
            #   不动 命令路由 侧同一 msgs（保本地渲染/账本/销卡扫描原样）。行级剥壳
            #   已在 命令路由._on_snap 统一做完。另：广播**不带第 8 位（index 7＝最终
            #   版本，账本专用）——既保旧客户端只读前 7 位，又不在广播里多带一份。
            # 0.19：先留「未截长原件」供指纹（防超 1500 字的生成尾段增长漏判，见下方 fp 处）。
            _fp_val = val
            try:
                if isinstance(val, dict) and (isinstance(val.get('msgs'), list)
                                              or isinstance(val.get('pend'), list)):
                    _cp = dict(val)
                    # 0.17（老板 2026-10-20 11:32）：**恢复「排队条命中即撤卡」**——不再
                    #   剥【官方排队条】各项 `t` 的首行 14 位 DID。0.15 曾剥掉它，致网页端
                    #   channel②（事件总线.js 扫 v.pend 首行 DID）失效、卡只能等该话进对话
                    #   记录才撤 ⇒ 老板实测「2.97 卡进排队条后手机仍不消卡」。DID 留在 `t`
                    #   （**仅作硬数据**）；网页端渲染队列条一律 stripHeadDid 剥净再显示 ⇒
                    #   界面绝不出现「数字被当正文」；本地 snap['pend'] 本就原样、不受影响。
                    if isinstance(val.get('msgs'), list):
                        _ms2 = []
                        for _m in val['msgs']:
                            if not isinstance(_m, list):
                                _ms2.append(_m)
                                continue
                            _c2 = list(_m)[:7]
                            if (len(_c2) > 1 and _c2[0] != 'u'
                                    and len(str(_c2[1])) > _正文上限()):
                                _c2[1] = str(_c2[1])[:_正文上限()]
                            _ms2.append(_c2)
                        _cp['msgs'] = _ms2
                    val = _cp
            except Exception:
                pass
            # 0.26（账本协议 V1.0·S1，§八·1）：模块化下发分支——mod_push_on=
            #   True 时按 7 模块独立帧下发（推送闸=每模块已下发 ver 表，无变更
            #   不下发实体）；False 走下方旧整包路径（逐字保留，一键回退）。
            try:
                if _ensure_cfg().get('mod_push_on', True):
                    self._last_snap = val
                    self._mod_push(val, _fp_val)
                    return
            except Exception:
                pass
            self._last_snap = val
            # 0.19（⑪·生成期发帧缺口 31.8s）：指纹改取**未截长的原件** `_fp_val`
            #   ——本拍 msgs 刚被上面 D14 截到 `_广播正文上限`（现值 8000 字）。生成中
            #   末条正文一旦超该上限，其**尾段增长全落在被截掉的部分** ⇒ 截长副本
            #   的末条 hash 恒定 ⇒ 生成期整段被指纹去重吞掉（实测 31.8s 未发一帧＝
            #   老板 13:32「手机端缺最新」）。仅「是否放行」的比较用原件，下发内容
            #   仍为 val（截长口径一字不变）。
            # X3-1（0.20·双保险）：侦测「忙↔闲」翻转瞬间——强制清一次广播指纹，
            #   放行一帧。即便去重键已含 `sendIdle`（见 `_snap_fp`），此处再兜一道：
            #   确保生成被中断/停止（无新消息、tail 回空）时也必发一帧带新 `sendIdle`
            #   的快照，令网页端横幅在下一拍内自行复位（文档「验收标准 1」）。
            _idle_now = (bool(_fp_val.get('sendIdle'))
                         if isinstance(_fp_val, dict) else None)
            if (_idle_now is not None and self._last_snap_idle is not None
                    and _idle_now != self._last_snap_idle):
                self._last_snap_fp = None       # 忙↔闲翻转：放行一帧
            if _idle_now is not None:
                self._last_snap_idle = _idle_now
            fp = self._snap_fp(_fp_val if isinstance(_fp_val, dict) else val)
            if _live:
                fp = hashlib.md5(
                    ('%s|%s' % (fp, _live)).encode('utf-8')).hexdigest()
            if fp == self._last_snap_fp:
                return                 # 无变化不重发（省中继配额）
            self._last_snap_fp = fp
        # 1.23：报文带 'srv' 源头名——多服务端同频道时客户端/面板
        # 据此过滤（只渲染当前操控的服务端的事件）
        self.send_json({'t': 'ev', 'k': kind, 'v': val,
                        'srv': _srv_name()})

    def send_json(self, d):
        # 只入出向队列；「WS收发记录」的「发」不在此处记——此刻尚未上线，
        # 属送出前的伪概念。真实记录点在实际写到频道处（_fox_send 的 w.send
        # 之后），按真实频道逐条记（用户 2026-10-05 要求「频道里的真实收发」）。
        # 0.05：唯一咽喉处统一盖源头戳——凡本机发出的报文一律带 sid/srv，
        # 网页端据此归册，彻底消除「无 srv → 兜底成『默认服务端』」假条目。
        if isinstance(d, dict):
            d.setdefault('sid', _srv_sid())
            # 0.19（④·双主机 `_port` 同为 9599 分不开）：凡本机发出的报文一律再盖
            #   一枚**来源实例号** `srv_sid`（＝`_srv_sid()`，10 位「1+9数字」终身号）。
            #   网页端仅凭 `_port` 过滤时 SS/HM 两台撞同一端口无法区分、跨机帧混入；
            #   本机在**每一帧**都下发该字段 ⇒ 网页端可改用它归册/过滤（网页端由另一
            #   Agent 配合）。旧客户端按名读、多一字段零影响；`sid` 原样保留。
            d.setdefault('srv_sid', _srv_sid())
            _nm = _srv_name()
            if _nm:
                d.setdefault('srv', _nm)
            # 0.31（Y23）：一次性 ev 事件发送侧幂等闸——同一内容 5s 内只放行
            #   一次。实测假 sid cmderr 双发（2ms 差·仅 FOXID 随机段不同）、
            #   switch_ok 双发（0.9s 差）均为同一逻辑路径重复发送；本闸在唯一
            #   咽喉按帧内容指纹去重，双路交付/重入处理等任何来源的重复帧统
            #   一拦在出口。只闸 t=='ev'（cmderr/switch_ok/switch_ack/notice
            #   等一次性事件）；mod/vack/rcpt/snap 各有自己的去重闸不受影响。
            #   rcpt 帧源侧已按 rid 幂等（回执._推进），且不同 rid 内容不同、
            #   不落入本闸，语义不变。
            if d.get('t') == 'ev':
                _k = ''
                try:
                    _k = '%s|%s' % (d.get('k') or '', hashlib.md5(
                        json.dumps(d, sort_keys=True, ensure_ascii=False,
                                   default=str).encode('utf-8')).hexdigest())
                except Exception:
                    _k = ''
                if _k:
                    with _SEND_IDEM_LOCK:
                        _t0 = self._send_idem.get(_k)
                        if _t0 and time.time() - _t0 < _SEND_IDEM_TTL:
                            return
                        self._send_idem[_k] = time.time()
                        if len(self._send_idem) > 256:
                            _cut = time.time() - _SEND_IDEM_TTL
                            for _kk in [k for k, v in self._send_idem.items()
                                        if v < _cut]:
                                self._send_idem.pop(_kk, None)
        s = json.dumps(d, ensure_ascii=False)
        self.outq.put(s)

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

    def _light_snap(self):
        """登录轻启动：把最新快照裁成「框架版」——去掉正文 msgs 头，只留
        会话列表/模型/状态等框架字段。返回新 dict（不改动原 _last_snap）。
        用于 send_hello 重放：连上即秒显示列表与状态，正文由登录后第一拍
        正常快照（指纹不同必转发）补齐，避免整包重放大会话历史拖长连接。"""
        try:
            s = dict(self._last_snap)
            s.pop('msgs', None)
            s.pop('panes', None)      # E3：panes 正文绝不外发（防流量爆炸）
            return s
        except Exception:
            return dict(self._last_snap)

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
                        # 2.20：服务端版本号随 hello 广播——网页端用它拼
                        # 「网页VER|服务端VERSION」双版本号缓存键，任一
                        # 变化即清本地骨架/历史缓存重下（新架构 P4）
                        'ver': VERSION,
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
                                        'pend_age_sec', 30)},
                        # 1.52：AI 文本刷新间隔（网页端抽屉显示/调整）
                        'poll': _ensure_cfg().get('poll_sec', 3.0),
                        # 0.26（账本协议 V1.0·S1，§八·3）：hello 增 `mods`
                        #   服务端当前全模块 ver 底账——客户端登录首轮即有
                        #   比对底账（复用现状 hello 重放，不另起帧；§3.1）。
                        'mods': self._模块vers()})
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
                            'v': self._light_snap(),
                            'srv': _srv_name()})

    # ---- 连接循环 ----

    def run(self):
        threading.Thread(target=self._sender, daemon=True).start()
        if not HAS_WS:
            while not self.stop_ev.is_set():
                self.realq.put(('remote', '✘ 未装 websocket-client'))
                self.stop_ev.wait(3600)
            return
        # 1.78：双频道——主（main）/副（backup）各自独立连接循环
        threading.Thread(target=self._conn_loop, args=('main',),
                         daemon=True).start()
        threading.Thread(target=self._conn_loop, args=('backup',),
                         daemon=True).start()
        # run 线程转为等待：由子线程各自重连，本线程只管停止标志
        self.stop_ev.wait()
        self._set_on_line(False)

    def _conn_loop(self, ch):
        """1.78：单频道连接循环（主/副各自一条）。
        13.3：断线重连【限次限频】——间隔逐次退避（3→6→12→24→48→封顶
        60s），连上即归零；不无限空转高频重连。"""
        fails = 0
        while not self.stop_ev.is_set():
            try:
                if self._serve(ch):
                    continue              # serve 内已阻塞直到断开
            except Exception as e:        # v1.61：断联落账，不再静默吞
                reason = '%s: %s' % (type(e).__name__, e)
            else:
                reason = '连接被服务商关闭'
            dwell = (time.time() - self._open_ts.get(ch, 0)) if ch in self._online else 0
            if ch == 'main':
                self._set_on_line(False)
            self._set_on_channel(ch, False)
            self._log_disconnect('[%s] %s' % (ch, reason))
            # v3.64：只有「活够 120 秒」才算真连上、退避归零；像今晨那样连上 1 秒
            # 就被服务商掐掉，退避必须继续往上爬（3→6→…→300），不能再 3 秒死磕。
            if dwell >= 120:
                fails = 0
            fails += 1
            n = min(fails - 1, 6)
            wait = min(self.RECONNECT * (2 ** n), 300)
            if fails >= 3:
                self._log_disconnect('[%s] 已连续 %d 次短命连接/连不上，退避 %ds 后重试'
                                     % (ch, fails, wait))
            self._open_ts.pop(ch, None)
            self.stop_ev.wait(wait)

    def _serve(self, ch):
        # 1.41：频道名升级为私密频道——旧配置里存的「默认 TRAE 频道」
        # 完整地址视为未自定义，一律用新频道；用户真填了别的中继地址
        # 才尊重之。主频道沿用用户自定义 ws_url；副频道固定用 WS2。
        if ch == 'backup':
            url = WS2_URL_TMPL % WS_CHANNEL
        else:
            url = CFG.get('ws_url') or ''
            if '/v3/TRAE?' in url:
                url = ''
            url = url or (WS_URL_TMPL % WS_CHANNEL)
        def _cb_open(_w, _ch=ch):
            self._on_open(_w, _ch)
        def _cb_msg(_w, msg, _ch=ch):
            self._on_msg(_w, msg, _ch)
        ws = websocket.WebSocketApp(
            url, on_open=_cb_open, on_message=_cb_msg,
            on_close=lambda *_a: None, on_error=lambda *_a: None)
        self._conns[ch] = ws
        if ch == 'main':
            self.ws = ws
        else:
            self.ws2 = ws
        # 2.74：不再启用 WebSocket 底层 PING（本软件免 PING，由中继自动保活）。
        ws.run_forever()
        return False

    def _set_on_channel(self, ch, b):
        """1.78：记录某频道是否已登上。主频道在线态同步反映到 UI 统计。"""
        if b:
            self._online.add(ch)
        else:
            self._online.discard(ch)

    def _log_disconnect(self, reason):
        """v1.61：断联落账——时间+原因写内存环（供「网络工具」分页
        显示）并追加到 使用痕迹目录\桥断联.log。1.03 另入频道活动日志。"""
        line = '%s  %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), reason)
        try:
            self._disc.append(line)
            if len(self._disc) > 60:
                del self._disc[:-60]
        except Exception:
            pass
        ch = reason.split(']', 1)[0].strip('[').strip() \
            if ']' in reason else ''
        self._chan_add(ch or 'main', line)
        try:
            with open(os.path.join(_trace_dir(), '桥断联.log'),
                      'a', encoding='utf-8') as f:
                f.write(line + '\n')
        except Exception:
            pass

    def _chan_add(self, ch, line):
        """1.03：按频道追加活动日志行，仅保留最近 80 行。"""
        try:
            buf = self._chanlog.setdefault(ch, [])
            buf.append(line)
            if len(buf) > 80:
                del buf[:len(buf) - 80]
        except Exception:
            pass

    def _on_open(self, _ws, ch='main'):
        self._set_on_channel(ch, True)
        self._open_ts[ch] = time.time()   # v3.64：记录连上时刻，供退避判断存活时长
        self._chan_add(ch, '%s  [%s] 已连接' % (
            time.strftime('%Y-%m-%d %H:%M:%S'), ch))
        self._set_on_line(True)
        if ch == 'main' and False:   # 主/副共用，不重复统计；保留占位
            with self._peer_lock:          # 重连后旧统计作废，重新累计
                self._peers.clear()
        self._report_peers()           # 只进本机 realq（界面人数），不外发
        # 老板 2026-11-19 令：上线**不主动发 hello**——服务器蹲守频道必须
        #   完全静默，禁止任何「服务器主动发消息」。hello 只在被点名时回：
        #   网页端 login → _push_full(sender)（:2863）、who → announce()
        #   （:2878）、命令路由 hello 分支（命令路由.py:1565）三处按需应答。
        # 0.05：上线不再 announce / 不再发 who——本机平时全程静默，不主动
        # 与其它服务端互报状态；只有被点名（who）时才应答在线。启动期的
        # 一次性报到由 命令路由.enforce_server_name 负责（重名检测需要）。

    def _on_msg(self, _ws, msg, ch='main'):
        # 2026-11-16 老板令：记住「你最后从哪个频道发命令来」，回执就发回那个频道（不双发、省条数）
        self._last_rx_ch = ch
        self._last_rx_ts = time.time()
        _stats_add(rx=len(msg), rxn=1, ch=ch)   # 1.02 字节 + 1.04 条数；1.03 按频道
        _fc, _ft = _frame_classify(msg)  # 1.80：开销分类旁路记账
        _detail_add('r', _fc, _ft, len(msg), 1, ch=ch)
        try:      # 诊断：入向线上原文帧记入「WS收发记录」（开关关时零开销）
            WS收发记录.收(msg, ch, 用途=_fc, 类型=_ft)
        except Exception:
            pass
        if not CFG.get('fox_on', True):
            self._bare_msg(msg, ch)          # 1.04：FOX 关闭——裸 JSON 直收
            return
        # FOX v2.1：控制帧（ACK/QRY/RSN/FAIL）先分流，绝不进正文流
        if self.fox_in.is_ctrl(msg):
            self.fox_in.feed_ctrl(msg, ch)
            return
        if not self.fox_in.feed(msg, ch):
            # FOX 开启：兜底解析无 FOX 头的裸 JSON（对端 fox_on 关闭时）
            self._bare_msg(msg, ch)

    def _deliver(self, sender, body, ch='main'):
        """FOX 拼装完成（或单段到达）后的正文投递——_on_msg 与补发补齐共用。"""
        if sender == _srv_sid():
            return                     # 自己的回声（保险）
        try:                           # 13.1【有则必收】：登记/更新设备名册
            _roster_touch(sender, self._roster_nick(body))
        except Exception:
            pass
        if sender[:1] == '1':
            # 1.23：远方服务端报文（'1' 开头）→ 注册表 + 远方事件路由，
            # 绝不回应（防两台服务端 hello 应答风暴）
            self._srv_msg(sender, body)
            return
        self._peer_seen(sender)        # 客户端（'4' 开头等）
        if self._presence(body, sender, ch):   # 1.51：登录/心跳/退登 → 消费
            return
        # 0.21（任务A）：网页端明确请求某会话正文（switch / pane_req）→ 登记按需下发。
        #   pane_req/pane_get 纯索取，就地消费（不投命令路由、无副作用）；
        #   switch 照常执行，仅顺带登记需求（桌面切不过去时仍能持续推该会话正文）。
        if self._pane_sniff(body):
            return
        # 0.26（账本协议 V1.0·S1，§八·6）：vcheck/ledger_req 协议报文分流——
        #   强核对/主动核对与按需补思维流就地消费，不投命令路由。
        if self._proto_sniff(body):
            return
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

    def _bare_msg(self, msg, ch='main'):
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
        try:                           # 13.1【有则必收】：裸 JSON 也登记名册
            _roster_touch(sid, self._roster_nick(msg))
        except Exception:
            pass
        if self._presence(msg, sid, ch):   # 1.51：登录/心跳/退登（裸 JSON）
            return
        if self._pane_sniff(msg):          # 0.21：按需单会话请求（裸 JSON 兜底）
            return
        if self._proto_sniff(msg):         # 0.26：vcheck/ledger_req（裸 JSON 兜底）
            return
        self.realq.put(('rcmd', (msg, sid)))

    @staticmethod
    def _roster_nick(body):
        """从客户端小报文里取昵称（非必填）。只在小报文里找，绝不为昵称
        解析大正文；取不到给 None（名册昵称留空，不影响任何功能）。"""
        try:
            if not body or body[:1] != '{' or len(body) > 512:
                return None
            d = json.loads(body)
            if isinstance(d, dict):
                n = d.get('nick')
                if isinstance(n, str) and n.strip():
                    return n.strip()[:40]
        except Exception:
            pass
        return None

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
                      if now - t > self.PEER_TMO]:
                del self._peers[s]
            n = len(self._peers)
        if n != self._last_peer_n:
            self._last_peer_n = n
            self.realq.put(('remote_peers', n))

    # ---- 1.51：客户端登录态（WS 节流） ----

    def _cli_touch(self, cid, fg=None, ch=None):
        """客户端 login/hb：刷新在线时刻（fg=是否前台；ch=所在频道）。
        1.78：记录频道——广播路由按频道隔离。"""
        if not cid:
            return
        with self._cli_lock:
            e = self._clients.get(cid) or {}
            e['ts'] = time.time()
            if fg is not None:
                e['fg'] = bool(fg)
            if ch is not None:
                e['ch'] = ch
            self._clients[cid] = e

    def _cli_drop(self, cid):
        """客户端 logout：立即下线（在线客户端数同步回落）。"""
        with self._cli_lock:
            self._clients.pop(cid, None)
        with self._peer_lock:
            self._peers.pop(cid, None)
        self._report_peers()

    def _cli_prune(self):
        """超时（LOGIN_TMO 无心跳）判下线。返回是否有变化。"""
        now = time.time()
        with self._cli_lock:
            dead = [c for c, e in self._clients.items()
                    if now - e.get('ts', 0) > self.LOGIN_TMO]
            for c in dead:
                del self._clients[c]
        return bool(dead)

    def cli_online(self, ch=None):
        """当前在线（已登录且未超时）客户端 sender 列表。
        1.78：ch 给定时只列该频道的在线客户端。"""
        now = time.time()
        with self._cli_lock:
            return [c for c, e in self._clients.items()
                    if now - e.get('ts', 0) <= self.LOGIN_TMO
                    and (ch is None or e.get('ch') == ch)]

    def cli_online_disp(self, ch=None):
        """在线客户端的展示标签列表：有昵称显示昵称，否则显示软件号。
        13.1：昵称与实例号同等待遇——「能显示就显示」。"""
        out = []
        for c in self.cli_online(ch):
            try:
                nk = _roster_nick_of(c)
            except Exception:
                nk = ''
            out.append(nk if nk else c)
        return out

    def cli_any(self, ch=None):
        """有客户端在线否——广播闸门的唯一判据。
        1.78：ch 给定时只判该频道。"""
        return bool(self.cli_online(ch))

    def _pick_out_ch(self):
        """0.39（老板 2026-11-19 令·**严禁同一条消息双频道发送**）：出向目标
        频道**恒为恰好一个或空**。①入参优先——最近 300s 内来过命令的频道
        （且仍在线、仍有登录客户端）；②否则在「在线且 cli_any」的频道里挑
        **客户端心跳最新**的那个（ts 相同 main 优先）；③一个都没有 → ''
        （整帧不发，保持完全静默）。"""
        now = time.time()
        try:
            ch0 = str(getattr(self, '_last_rx_ch', '') or '')
            ts0 = float(getattr(self, '_last_rx_ts', 0) or 0)
            if (ch0 and (now - ts0) < 300 and ch0 in self._online
                    and self.cli_any(ch0)):
                return ch0
        except Exception:
            pass
        try:
            with self._cli_lock:            # 锁内取快照，绝不裸读 _clients
                ents = {c: dict(e) for c, e in self._clients.items()}
        except Exception:
            ents = {}
        best, best_ts = '', -1.0
        for ch in list(self._online or ()):
            ts = -1.0
            for _c, e in ents.items():
                if e.get('ch') != ch:
                    continue
                _t = float(e.get('ts') or 0)
                if now - _t > self.LOGIN_TMO:
                    continue                # 该客户端已超时（等同不在线）
                if _t > ts:
                    ts = _t
            if ts < 0:
                continue                    # 该频道没有登录客户端 ⇒ 不选
            if ts > best_ts or (ts == best_ts and ch == 'main'):
                best, best_ts = ch, ts      # 心跳最新优先，平局 main 胜
        return best

    @staticmethod
    def _sel_sid(val):
        """E3：本拍快照的「桌面当前选中会话」sid（selSid 优先，回落 convs
        选中行）——供 did 按会话归属比对。解析不出返回 ''（=不限定，兼容旧端）。"""
        try:
            s = val.get('selSid') or ''
            if s:
                return s
            for r in (val.get('convs') or []):
                if r and r[0] == 'c' and len(r) > 4 and r[2]:
                    return r[4] or ''
        except Exception:
            pass
        return ''

    @staticmethod
    def _sel_title(val):
        """0.12：本拍快照「桌面当前选中会话」的标题（供首行 DID 池挂会话名）。
        解析不出返回 ''。"""
        try:
            for r in (val.get('convs') or []):
                if r and r[0] == 'c' and len(r) > 1 and r[2]:
                    return r[1] or ''
        except Exception:
            pass
        return ''

    @staticmethod
    def _title_of_sid(val, sid):
        """0.12：按会话稳定 ID 反查 convs 标题（供 pane 池挂会话名）。
        找不到/ sid 空返回 ''。"""
        try:
            if not sid:
                return ''
            for r in (val.get('convs') or []):
                if r and r[0] == 'c' and len(r) > 4 and r[4] == sid:
                    return r[1] or ''
        except Exception:
            pass
        return ''

    def _title_of(self, sid):
        """0.34/0.36/0.37（V1.0 §七·:206／§八·:230／§十·:271）：账本帧必带会话名。
        兜底链（0.37 加长，老板 2026-11-19 令「本地电脑上终身号+会话名轻而易得」）：
        ①桌面会话列表现查（最新鲜）→ ②pane 缓存 title → ③本地账本 conv_meta 的
        名↔号映射（ingest 落库，改名/不在列表也能回锚）→ 都空才 ''（由三要素
        闸门拦下整帧）。绝不猜名、绝不拼「未命名/尾4位」。sid 空时退用当前
        选中会话名＝临时名称锚；标题恰好等于 sid 也判无名。"""
        t = ''
        try:
            val = self._last_snap or {}
            t = (str(self._title_of_sid(val, sid) or '') if sid
                 else str(self._sel_title(val) or ''))
            t = t.strip()
        except Exception:
            t = ''
        if not t:
            try:      # ②pane 缓存（按需采集时记下的 title）
                p = (getattr(self, '_last_panes', {}) or {}).get(sid)
                if isinstance(p, dict):
                    t = str(p.get('title') or '').strip()
            except Exception:
                t = ''
        if not t:
            try:      # ③本地账本 conv_meta 的 名↔号 持久映射（v2.58）
                import TRAE本地账本 as _账
                t = str(_账.ledger().title_of_sid(
                    getattr(self.dlg, 'port', 0), sid) or '').strip()
            except Exception:
                t = ''
        if not t or t == str(sid or ''):
            return ''
        return t

    # ---- 0.21（任务A）：按需单会话限频下发 ----

    @staticmethod
    def _pane_min_sec():
        """同一会话两次按需下发的最小间隔（秒，默认 2s，可配置）。"""
        try:
            return max(0.2, float(_ensure_cfg().get(
                'pane_on_demand_min_sec', 2.0) or 2.0))
        except Exception:
            return 2.0

    @staticmethod
    def _pane_ttl():
        """按需需求的有效期（秒，默认 600s；过期自动撤销，绝不长期后台采集）。"""
        try:
            return max(10.0, float(_ensure_cfg().get(
                'pane_on_demand_ttl', 600.0) or 600.0))
        except Exception:
            return 600.0

    @staticmethod
    def _pane_fp(p):
        """按需会话的内容指纹——**取未截长原件**（下发副本另做截长）。
        口径：sid + 条数 + 末条 mid + 末条正文 hash + finish 文本 hash。
        尾部有增/有换即变 ⇒ 内容无变化不重发。"""
        try:
            ms = p.get('msgs') or []
            last, mid = '', ''
            if ms:
                m = ms[-1]
                if isinstance(m, (list, tuple)):
                    if len(m) > 1:
                        last = str(m[1] or '')
                    if len(m) > 6:
                        mid = str(m[6] or '')
            fin = p.get('finish') or {}
            ft = fin.get('text') if isinstance(fin, dict) else ''
            return '%s|%d|%s|%s|%s' % (
                p.get('sid') or '', len(ms), mid,
                hashlib.md5(last.encode('utf-8')).hexdigest()[:12],
                hashlib.md5(str(ft or '').encode('utf-8')).hexdigest()[:12])
        except Exception:
            return None

    def _pane_send(self, pane, title=''):
        """按需下发**单个会话**正文（独立帧 `k='snap_pane'`，不整包全会话）。
        正文单条截到 `_广播正文上限`（与常规快照 D14 同口径，在副本上做）。"""
        ms = []
        for m in (pane.get('msgs') or []):
            if not isinstance(m, list):
                ms.append(m)
                continue
            c = list(m)
            if (len(c) > 1 and c[0] != 'u'
                    and len(str(c[1])) > _正文上限()):
                c[1] = str(c[1])[:_正文上限()]
            ms.append(c)
        self.send_json({'t': 'ev', 'k': 'snap_pane',
                        'v': {'sid': pane.get('sid') or '',
                              'title': title or '',
                              'msgs': ms, 'n': len(ms),
                              'finish': pane.get('finish'),
                              'sel': bool(pane.get('sel')),
                              'vis': bool(pane.get('vis'))},
                        'srv': _srv_name()})

    def _pane_on_demand(self, panes, val):
        """每拍快照调用（剥 panes 前）：缓存本拍 panes；若网页端登记了需求会话，
        且**桌面并未停在该会话** ⇒ 为该会话单独下发正文（限频＋内容去重）。
        常规快照流完全不受影响。"""
        cache, sel = {}, self._sel_sid(val)
        for p in (panes or []):
            if isinstance(p, dict) and p.get('sid'):
                cache[p['sid']] = p
        if cache:
            with self._pane_lock:
                self._last_panes = cache
        with self._pane_lock:
            d = self._pane_demand
        if not d or not d.get('sid'):
            return                       # 无明确请求 ⇒ 什么都不做（不后台采集）
        sid = d['sid']
        now = time.time()
        if now - float(d.get('ts') or 0) > self._pane_ttl():
            with self._pane_lock:
                if self._pane_demand is d:
                    self._pane_demand = None
            return
        pane = cache.get(sid)
        if pane is None:
            return                       # 本拍未挂载该会话（≤5 pane），等下一拍
        if sel and sel == sid:
            return                       # 桌面已停在该会话 ⇒ 常规快照已带正文
        fp = self._pane_fp(pane)
        with self._pane_lock:
            if fp is not None and fp == self._pane_last_fp.get(sid):
                return                   # 内容无变化不重发
            if (now - float(self._pane_last_ts.get(sid) or 0)
                    < self._pane_min_sec()):
                return                   # 限频：同一会话最小间隔未到
            if fp is not None:
                self._pane_last_fp[sid] = fp
            self._pane_last_ts[sid] = now
        self._pane_send(pane, self._title_of_sid(val, sid))

    def _pane_demand_set(self, sid, title='', kick=False):
        """登记「按需单会话」需求。kick=True 时若有本拍 panes 缓存则立即补发
        （显式索取/重连首拍用；switch 命令走常规 switch_pre 首帧，不重复踢）。"""
        sid = str(sid or '')
        if not sid:
            return
        pane = None
        with self._pane_lock:
            self._pane_demand = {'sid': sid, 'title': title or '',
                                 'ts': time.time()}
            # 新请求：清掉旧的限频/指纹记录，放行首帧
            self._pane_last_ts[sid] = 0
            self._pane_last_fp.pop(sid, None)
            if kick:
                pane = self._last_panes.get(sid)
        if pane is None:
            return
        if self._sel_sid(self._last_snap or {}) == sid:
            return                       # 桌面就在该会话，常规快照已带正文
        with self._pane_lock:
            self._pane_last_ts[sid] = time.time()
            fp = self._pane_fp(pane)
            if fp is not None:
                self._pane_last_fp[sid] = fp
        self._pane_send(pane, title or self._title_of_sid(
            self._last_snap or {}, sid))

    def _pane_demand_rearm(self):
        """网页端登录/重连首拍：需求仍在 ⇒ 解除限频并用缓存 panes 立即补发，
        不必等下一拍（也不额外打 CDP）。"""
        with self._pane_lock:
            d = self._pane_demand
            if not d or not d.get('sid'):
                return
            d['ts'] = time.time()
            sid = d['sid']
            self._pane_last_ts[sid] = 0
            self._pane_last_fp.pop(sid, None)
            pane = self._last_panes.get(sid)
        if pane is None:
            return
        if self._sel_sid(self._last_snap or {}) == sid:
            return
        with self._pane_lock:
            self._pane_last_ts[sid] = time.time()
            fp = self._pane_fp(pane)
            if fp is not None:
                self._pane_last_fp[sid] = fp
        self._pane_send(pane, self._title_of_sid(self._last_snap or {}, sid))

    def _pane_ref_sid(self, ref):
        """switch 的 ref → 稳定 sid：非纯数字串=ID；纯数字=会话序号（跳过组头）。"""
        try:
            if isinstance(ref, str) and ref and not ref.lstrip('-').isdigit():
                return ref
            i = int(ref)
        except Exception:
            return ''
        try:
            convs = [r for r in ((self._last_snap or {}).get('convs') or [])
                     if isinstance(r, (list, tuple)) and r and r[0] == 'c']
            if 0 <= i < len(convs):
                return str(convs[i][4] if len(convs[i]) > 4 else '')
        except Exception:
            pass
        return ''

    def _pane_sniff(self, body):
        """识别网页端「按需单会话」请求（只解析小报文）。返回 True=已消费。
        接受形状：
          {'t':'pane_req','sid':'<会话ID>'}          ← 显式索取（推荐，无副作用）
          {'t':'cmd','c':'pane_get','a':'<会话ID>'}  ← 命令式索取（不投给命令路由）
          {'t':'cmd','c':'switch','a':ID/序号}       ← 切换请求（登记需求，命令照常执行）"""
        try:
            if not body or body[:1] != '{' or len(body) > 4096:
                return False
            d = json.loads(body)
            if not isinstance(d, dict):
                return False
            t = d.get('t')
            if t == 'pane_req':
                self._pane_demand_set(str(d.get('sid') or ''), kick=True)
                return True
            if t != 'cmd':
                return False
            c, a = d.get('c'), d.get('a')
            if c == 'pane_get':
                if isinstance(a, str) and a:
                    self._pane_demand_set(a, kick=True)
                return True
            if c == 'switch':
                sid = self._pane_ref_sid(a)
                if sid:
                    self._pane_demand_set(sid, kick=False)
            return False
        except Exception:
            return False

    @staticmethod
    def _panes_live(panes):
        """E3 指纹补偿：活 pane 摘要（**不进广播包**，只并入指纹）。
        口径：sid前8位:可见:选中:条数:末条前24字指纹:完成卡文本指纹。
        隐藏会话生成中/完成任务时其摘要即变 → 驱动整包广播，防漏播。"""
        out = []
        for p in (panes or []):
            if not isinstance(p, dict):
                continue
            try:
                ms = p.get('msgs') or []
                last = ''
                for m in reversed(ms):
                    if isinstance(m, (list, tuple)) and len(m) > 1 \
                            and isinstance(m[1], str) and m[1]:
                        last = m[1]
                        break
                fin = p.get('finish') or {}
                ft = fin.get('text') if isinstance(fin, dict) else ''
                out.append('%s:%d:%d:%d:%s:%s' % (
                    (p.get('sid') or '')[:8], 1 if p.get('vis') else 0,
                    1 if p.get('sel') else 0, len(ms),
                    hashlib.md5(last[:24].encode('utf-8')).hexdigest()[:8],
                    hashlib.md5((ft or '')[:160].encode(
                        'utf-8')).hexdigest()[:8]))
            except Exception:
                continue
        return '|'.join(out)

    def _snap_fp(self, val):
        """尾部指纹（0.16，与 forward_event 同口径）。
        去重键 = 选中会话 + msgs 条数 + 末条正文 hash + 完成卡文本 hash + tail
        + 单调护栏陈旧标记 `_stale` + 会话列表壳签名（convs 行 role/标题/选中/sid）。
        **0.20（X3-1）：再纳入状态壳字段 `sendIdle`/`online`/`login`**——一次性收口，
        否则「只有忙闲/登录/在线态变、正文没变」的帧被当「无变化」丢弃（近两轮复发点：
        上轮漏 `online`、本轮漏 `sendIdle`）。
        口径：**尾部有增/有换即放行发一次**、换会话（selSid 变）必放行；会话列表/
        状态等壳字段变化仍照常放行。整包 md5 会被单调护栏覆盖回上一拍 msgs ，
        ⇒ 须用尾部指纹＋`_stale` 才能保证「生成期内容一变就发」（0.16 记录）。"""
        try:
            ms = val.get('msgs')
            if not isinstance(ms, list):
                ms = []
            last = ''
            for _m in reversed(ms):
                if isinstance(_m, (list, tuple)) and len(_m) > 1 and _m[1]:
                    last = str(_m[1]); break
            fin = val.get('finish')
            ft = (fin.get('text') if isinstance(fin, dict) else '') or ''
            shell = []
            for r in (val.get('convs') or []):
                if isinstance(r, (list, tuple)):
                    shell.append('%s:%s:%s:%s' % (
                        r[0] if r else '',
                        r[1] if len(r) > 1 else '',
                        r[2] if len(r) > 2 else '',
                        r[4] if len(r) > 4 else ''))
            # X3-1（0.20）：状态壳字段三连（忙闲/在线/登录）并入去重键。
            _idle = 1 if val.get('sendIdle') else 0
            _on = 1 if val.get('online') else 0
            _lg = 1 if val.get('login') else 0
            # 0.23：排队条尾部指纹（条数＋逐项文本 hash＋能否编辑＋归属会话）。
            pd = val.get('pend') if isinstance(val.get('pend'), list) else []
            _psig = []
            for _it in pd:
                _t = (str(_it.get('t') or '') if isinstance(_it, dict) else str(_it))
                _psig.append('%s:%d' % (
                    hashlib.md5(_t.encode('utf-8')).hexdigest()[:10],
                    1 if (isinstance(_it, dict) and _it.get('canEdit')) else 0))
            return '%s|%d|%s|%s|%s|%d|%s|%d%d%d|%d|%s|%s' % (
                self._sel_sid(val), len(ms),
                hashlib.md5(last.encode('utf-8')).hexdigest()[:12],
                hashlib.md5(str(ft).encode('utf-8')).hexdigest()[:12],
                str(val.get('tail') or ''),
                int(val.get('_stale') or 0),
                hashlib.md5('|'.join(shell).encode('utf-8')).hexdigest()[:10],
                _idle, _on, _lg,
                len(pd),
                hashlib.md5('|'.join(_psig).encode('utf-8')).hexdigest()[:10],
                str(val.get('pend_sid') or ''))
        except Exception:
            return None

    def _push_full(self, sender=None):
        """客户端登录/回到前台：重放 hello + 轻量框架快照（不含 msgs）。
        1.xx：登录轻启动——不再整包重放全量正文（大会话历史大、拖长「链接
        中」）；框架先到秒显示列表/模型/状态，正文由登录后第一拍常规快照
        （指纹与轻量版不同，必转发）于 poll 轮询内补齐。故这里把指纹置空，
        让带 msgs 的下一拍愿意转发：若不置空、断线前指纹恰与此后全量相同，
        会被 forward_event 误判「已发过」而去重吞掉，正文永不出现。"""
        self.send_hello(sender)
        self._last_snap_fp = None

    # ============ 0.26：账本系统 V1.0·服务端协议（S1） ============
    # 协议定稿 §一~§八＋统筹批复 4 条（上行 vcheck 单帧多模块编码；think
    # 兼带正文；macct 账号子项=boxes；智能打包不硬编码）。七模块：
    # sig/snote/macct/convs/ledger/didp/think；四报文：vcheck/vack/mod/
    # ledger_req。每模块指纹＝从 _snap_fp/_pane_fp 现有分段逐字拆出。

    _FOX_MARK_RE = re.compile(r'\(@fox-[A-Za-z0-9_-]+\)')

    @staticmethod
    def _ver12(s):
        """模块版本编码：12 位十六进制内容指纹 md5(规范化)[:12]（§2.1）。"""
        try:
            return hashlib.md5(str(s).encode('utf-8')).hexdigest()[:12]
        except Exception:
            return ''

    # ---- 各模块指纹（§2.2 编码口径，分段逐字沿用） ----

    def _fp_sig(self, val):
        """sig 模块指纹＝全部会话 sid:light 有序序列 hash——任一会话信号灯
        变化（含橙灯亮/灭、忙闲跃迁）即变（§2.2）。"""
        try:
            parts = []
            for o in (val.get('convs_full') or []):
                if isinstance(o, dict):
                    st = o.get('status') or {}
                    parts.append('%s:%s' % (o.get('sid') or '',
                                            st.get('light') or ''))
            if not parts:       # 无四字段时从 convs 行 raw 兜底（口径同 _补富化）
                for r in (val.get('convs') or []):
                    if isinstance(r, (list, tuple)) and r and r[0] == 'c':
                        raw = r[3] if len(r) > 3 else ''
                        parts.append('%s:%s' % (
                            r[4] if len(r) > 4 else '',
                            'busy' if raw == 'run' else (raw or 'idle')))
            return self._ver12('|'.join(parts))
        except Exception:
            return None

    def _fp_snote(self, val):
        """snote 模块指纹＝备注字典+定时列表合并规范化（§2.2 两子项一套）。
        让路拍（快照无 `备注` 键）返回 None＝本拍无数据、沿用上次 ver。"""
        try:
            if '备注' not in val:
                return None
            return self._ver12(json.dumps(
                {'n': val.get('备注') or {}, 's': val.get('定时') or []},
                ensure_ascii=False, sort_keys=True, default=str))
        except Exception:
            return None

    def _fp_macct(self):
        """macct 模块指纹＝模型列表+账号列表合并规范化（§2.2；账号子项
        按 boxes·批复3）。"""
        try:
            return self._ver12(json.dumps(
                {'m': self._last_models if self._last_models is not None
                 else [],
                 'a': getattr(self.dlg, 'account', '') or '',
                 'b': list(getattr(self.dlg, 'box_names', []) or [])},
                ensure_ascii=False, sort_keys=True, default=str))
        except Exception:
            return None

    def _fp_convs(self, val):
        """convs 模块指纹＝会话行壳签名（_snap_fp 的 shell 段逐字）＋
        convs_full 的 schedule 段签名，两段再合一次 md5（§2.2 基础上
        0.29（Y7）收敛：status 子段从 convs 指纹摘除——状态灯变化是独立
        高频信号、只驱动轻量 `sig` 帧（§四），不再连带 384KB 级的 convs
        大实体帧；定时 schedule 变化仍归 convs。info 覆盖不缺位：status
        全量在 sig，schedule 在 convs。"""
        try:
            shell = []
            for r in (val.get('convs') or []):
                if isinstance(r, (list, tuple)):
                    shell.append('%s:%s:%s:%s' % (
                        r[0] if r else '',
                        r[1] if len(r) > 1 else '',
                        r[2] if len(r) > 2 else '',
                        r[4] if len(r) > 4 else ''))
            full = []
            for o in (val.get('convs_full') or []):
                if isinstance(o, dict):
                    full.append('%s:%s:%s' % (
                        o.get('sid') or '', o.get('name') or '',
                        json.dumps({'c': o.get('schedule')},
                                   sort_keys=True, ensure_ascii=False,
                                   default=str)))
            h1 = hashlib.md5('|'.join(shell).encode('utf-8')).hexdigest()[:10]
            h2 = hashlib.md5('|'.join(full).encode('utf-8')).hexdigest()[:10]
            return self._ver12('%s|%s' % (h1, h2))
        except Exception:
            return None

    def _fp_didp(self):
        """didp 模块指纹＝池子内容 hash（§2.2；F5 销卡池独立编码参与核对）。"""
        try:
            return self._ver12(json.dumps(
                痕迹与配置.池子_快照(), ensure_ascii=False,
                sort_keys=True, default=str))
        except Exception:
            return None

    def _fp_think(self, val):
        """think 模块指纹＝_snap_fp 的「画面段＋排队段」逐字拆出（§2.2）：
        画面＝选中会话＋msgs 条数＋末条正文 hash＋finish 文本 hash＋tail
        ＋_stale＋忙闲/在线/登录三态；排队＝条数＋逐项文本 hash(canEdit)
        ＋归属会话。**取未截长原件**（调用方传 _fp_val，口径同 0.19）。"""
        try:
            ms = val.get('msgs')
            if not isinstance(ms, list):
                ms = []
            last = ''
            for _m in reversed(ms):
                if isinstance(_m, (list, tuple)) and len(_m) > 1 and _m[1]:
                    last = str(_m[1]); break
            fin = val.get('finish')
            ft = (fin.get('text') if isinstance(fin, dict) else '') or ''
            _idle = 1 if val.get('sendIdle') else 0
            _on = 1 if val.get('online') else 0
            _lg = 1 if val.get('login') else 0
            pd = val.get('pend') if isinstance(val.get('pend'), list) else []
            _psig = []
            for _it in pd:
                _t = (str(_it.get('t') or '')
                      if isinstance(_it, dict) else str(_it))
                _psig.append('%s:%d' % (
                    hashlib.md5(_t.encode('utf-8')).hexdigest()[:10],
                    1 if (isinstance(_it, dict) and _it.get('canEdit')) else 0))
            return self._ver12('%s|%d|%s|%s|%s|%d|%d%d%d|%d|%s|%s' % (
                self._sel_sid(val), len(ms),
                hashlib.md5(last.encode('utf-8')).hexdigest()[:12],
                hashlib.md5(str(ft).encode('utf-8')).hexdigest()[:12],
                str(val.get('tail') or ''),
                int(val.get('_stale') or 0),
                _idle, _on, _lg,
                len(pd),
                hashlib.md5('|'.join(_psig).encode('utf-8')).hexdigest()[:10],
                str(val.get('pend_sid') or '')))
        except Exception:
            return None

    def _ledger_fps(self, val):
        """ledger 模块按会话版本表（§2.2）：单会话 ver＝_pane_fp 口径再 md5
        （sid|条数|末条mid|末条正文hash|finish hash）。范围＝本拍选中会话
        ＋_last_panes 缓存会话（≤5 pane）。"""
        out = {}
        try:
            sel = self._sel_sid(val)
            if sel:
                out[sel] = self._ver12(self._pane_fp({
                    'sid': sel, 'msgs': val.get('msgs') or [],
                    'finish': val.get('finish')}))
            for sid, p in list((self._last_panes or {}).items()):
                if isinstance(p, dict) and sid:
                    v = self._ver12(self._pane_fp(p))
                    if v:
                        out[sid] = v
        except Exception:
            pass
        return out

    def _模块总指纹(self, val):
        """0.26：广播循环整拍去重键（抓取轮询 0.72 调用）——七模块 ver 合并
        一 hash。任一模块变即放行整拍（逐模块闸在 _mod_push）；静置时七段
        全不变 ⇒ 零帧口径不回退（B2）。"""
        try:
            led = self._ledger_fps(val)
            segs = [self._fp_sig(val) or '',
                    self._fp_snote(val) or '',
                    self._fp_macct() or '',
                    self._fp_convs(val) or '',
                    self._fp_didp() or '',
                    self._fp_think(val) or '',
                    json.dumps(led, sort_keys=True, ensure_ascii=False)]
            return hashlib.md5('|'.join(segs).encode('utf-8')).hexdigest()
        except Exception:
            return None

    # ---- pend 项级化（N1-N5） ----

    # 0.29（Y4·§十二-5「只保留用户原文」）：排队条灌词行标记分两类——
    #   A【整行摘除】：【来自…】/【回信用…】信封行（可在原文前后，
    #   整行删、不吞正文）；B【起吞到文末】：灌词大块行首标记
    #   （你的会话名/终身号/专属记忆位置/【全局记忆】等，恒为尾部整段，
    #   命中即从该行起吞到文末）。剥完只剩空白则吞空（与网页端
    #   foxStripTail 同口径）。只作用于 pend 展示层，msgs/账本原样不动。
    _PEND_WRAP_LINE_RE = re.compile(
        r'^\s*【(?:来自|回信用)[^】]*】\s*$')
    _PEND_JUNK_LINE_RE = re.compile(
        r'^\s*(?:【(?:全局记忆|专属提示词|公共提示词|身份卡)[^】]*】'
        r'|你的会话名\s*[:：]|你的终身号\s*[:：]|本会话专属记忆位置\s*[:：]'
        r'|你的专属记忆|你的全局记忆|全局记忆如下|以下是?全局记忆)')

    def _剥排队原文(self, t):
        """0.29（Y4）：排队条 text 剥到只剩用户发送的原始文本——
        ① 【来自…】/【回信用…】信封行整行摘除（不吞正文）；
        ② 灌词大块（你的会话名/终身号/专属记忆位置/【全局记忆】…）从
        首个标记行起吞到文末；③ 末尾 1~2 行【词】尾巴（复用
        痕迹与配置._did_strip_tail）；④ (@fox-*) 卡片标记；
        ⑤ 剥完只剩空白返回空串（不回吞灌词）。"""
        s = str(t or '')
        try:
            lines = s.split('\n')
            cut = None
            out = []
            for i, ln in enumerate(lines):
                if cut is None and self._PEND_JUNK_LINE_RE.match(ln):
                    cut = i                   # ② 灌词大块：起吞到文末
                    break
                if self._PEND_WRAP_LINE_RE.match(ln):
                    continue                  # ① 信封行：整行摘除
                out.append(ln)
            s = '\n'.join(out)                # cut 已含在 break 前，out 即净行
        except Exception:
            pass
        try:                       # ③ 专属词尾巴
            s = 痕迹与配置._did_strip_tail(s)
        except Exception:
            pass
        try:                       # ④ 卡片标记
            s = self._FOX_MARK_RE.sub('', s)
        except Exception:
            pass
        return s.strip()

    def _pend条目(self, val):
        """0.26：排队条项级化——每项 {id,text,sid,canEdit}：id＝首行 14 位
        DID（底层必带、界面隐藏·N3）；text＝剥首行 DID＋剥专属词尾巴
        （【词】后缀）＋剥 (@fox-*) 卡片标记后的用户原文（N2）；sid＝项级
        会话归属（TRAE 只在桌面当前选中会话有准确排队数据·N5，服务端只
        下发该会话排队条）。顶层 pend_sid 兜底保留（N4 过渡双字段并存）。"""
        out = []
        try:
            psid = str(val.get('pend_sid') or '')
            if not psid:
                return out
            for it in (val.get('pend') or []):
                t = str(it.get('t') or '') if isinstance(it, dict) else str(it)
                did = ''
                try:
                    _m = 痕迹与配置._DID_HEAD_RE.match(t)
                    if _m:
                        did = _m.group(0).strip()
                        t = t[_m.end():]
                except Exception:
                    pass
                t = self._剥排队原文(t)   # 0.29（Y4）：剥灌词/尾巴/卡片标记
                out.append({'id': did, 'text': t, 'sid': psid,
                            'canEdit': bool(isinstance(it, dict)
                                            and it.get('canEdit'))})
        except Exception:
            pass
        return out

    # ---- 实体帧（§3.1/§3.3，唯一实体形态） ----

    def _send_mod(self, m, ver, d, sid=None):
        """0.26：单模块实体帧 `{'t':'mod','m':…,'v':…,'d':…,'ts':…}`（A1/B3：
        实体单模块单帧）。全帧由 send_json 咽喉处统一盖 srv/srv_sid（A4）。
        ledger 类帧另带 `sid`（涉及会话）。"""
        f = {'t': 'mod', 'm': m, 'v': ver, 'd': d, 'ts': int(time.time())}
        if sid:
            f['sid'] = sid
        self.send_json(f)

    def _mod_entity(self, m, val):
        """0.26：各模块实体 d（§3.3 归属表）。think 兼带正文（批复2）——
        frame 含 msgs/finish/tail/sendIdle/online/login 整屏，不做拆分（E2）。"""
        try:
            if m == 'sig':
                rows = []
                for o in (val.get('convs_full') or []):
                    if isinstance(o, dict):
                        st = o.get('status') or {}
                        rows.append({'sid': o.get('sid') or '',
                                     'light': st.get('light') or '',
                                     'orange': bool(st.get('orange')),
                                     'unread': bool(st.get('unread'))})
                return {'convs': rows}
            if m == 'snote':
                return {'notes': val.get('备注') or {},
                        'sched': val.get('定时') or []}
            if m == 'macct':
                return {'models': (self._last_models
                                   if self._last_models is not None else []),
                        'acct': getattr(self.dlg, 'account', '') or '',
                        'boxes': list(getattr(self.dlg, 'box_names', []) or [])}
            if m == 'convs':
                return {'convs': val.get('convs') or [],
                        'convs_full': val.get('convs_full') or []}
            if m == 'didp':
                return 痕迹与配置.池子_快照()
            if m == 'think':
                items = self._pend条目(val)
                pv = self._ver12(json.dumps(
                    items, ensure_ascii=False, sort_keys=True, default=str))
                return {'sel': self._sel_sid(val),
                        'frame': {'msgs': val.get('msgs') or [],
                                  'finish': val.get('finish'),
                                  'tail': str(val.get('tail') or ''),
                                  'sendIdle': bool(val.get('sendIdle')),
                                  'online': bool(val.get('online')),
                                  'login': bool(val.get('login'))},
                        'pend': items,
                        'pend_sid': str(val.get('pend_sid') or ''),
                        'pend_ver': pv,
                        # 0.40（老板令·四类标识）：TRAE 思维流直播＝`snap`
                        #   （无独立号、与终极同号），WB 侧为 `th`；永不与本
                        #   账本帧的 `a`（已认证终结）混用同一字段位置。
                        'rkind': 'snap'}
        except Exception:
            pass
        return {}

    # ---- 轮次（G1：1 轮=1 人类+1 终极，不带思维流；C5：无本地账本仅 1 轮） ----

    @staticmethod
    def _fnv(s):
        """0.34（3.71 唯一契约·与 JS 逐码元对齐）：FNV-1a 32 位 → 8 位小写 hex。
        输入按 **UTF-16LE 码元**逐 16 位异或，等价 JS 的 charCodeAt（emoji 代理对
        也逐码元一致）。0.33 用 utf-8 字节算是错的——中文两端必然不等，会退化成
        「每次核对都判缺→全量补发」。基准：'完成卡一'→3285ee40，''→811c9dc5。"""
        h = 0x811c9dc5
        b = str(s or '').encode('utf-16-le', 'surrogatepass')
        for i in range(0, len(b), 2):
            h ^= (b[i] | (b[i + 1] << 8))
            h = (h * 16777619) & 0xffffffff
        return '%08x' % h

    @classmethod
    def _row_code(cls, row, final=False):
        """0.32（3.71·V1.0 §七·:194 同号不同态）：单行 → 编码三元组
        {'mid','fin','hash'}。row 可为 DOM 行（list，index6=mid、index7=完成卡
        摘要）或账本 rec（dict，mid/fin/text）。
        0.33：hash 改 FNV-1a 8 位 hex（与客户端同口径）；取文＝完成卡摘要，
        空则回退正文。
        **0.40（终极认证闸门·老板 2026-11-19 令）**：fin 不再由 index7 非空
        推断——TRAE 思维流快照的 index7 也可能有内容，会把快照当成终极。
        改为「终态认证」：只有 `final=True`（该轮已终结）**且** index7 非空
        才 fin=1；判定不出来一律 fin=0（fail-closed）。账本 dict 行的 fin 由
        ingest 定稿时写入，属权威值，不受 final 影响。"""
        mid, txt, fin_txt, fin = '', '', '', 0
        try:
            if isinstance(row, (list, tuple)):
                if len(row) > 1:
                    txt = str(row[1] or '')
                if len(row) > 6:
                    mid = str(row[6] or '')
                if len(row) > 7:
                    _f = str(row[7] or '')
                    fin = 1 if (bool(final) and _f.strip()) else 0
                    fin_txt = _f or txt
            elif isinstance(row, dict):
                mid = str(row.get('mid') or '')
                txt = str(row.get('text') or '')
                fin_txt = str(row.get('fin_txt') or txt or '')
                fin = int(row.get('fin') or 0)
        except Exception:
            pass
        h = cls._fnv(fin_txt) if fin_txt else ''
        return {'mid': mid, 'fin': fin, 'hash': h}

    @classmethod
    def _round_codes(cls, rounds, finals=None):
        """轮次数组 → 与 rounds 逐轮对齐的 codes（取每轮 AI 行）。无 AI 行的
        轮给空码（mid=''）——客户端据 mid='' 判「该轮尚无终极」。
        0.40：finals 与该轮「是否已终结」逐轮对齐（缺省全 False＝全未终结），
        传给 `_row_code` 做终态认证。"""
        out = []
        for _i, r in enumerate(rounds or []):
            a = None
            try:
                if isinstance(r, (list, tuple)) and len(r) > 1:
                    a = r[1]
                elif isinstance(r, dict):
                    a = r.get('a')
            except Exception:
                a = None
            _fin = bool(finals[_i]) if (finals and _i < len(finals)) else False
            out.append(cls._row_code(a, _fin) if a else
                       {'mid': '', 'fin': 0, 'hash': ''})
        return out

    @staticmethod
    def _rounds_from_rows(ms):
        """0.26：DOM 快照行（[role,text,tm,raw,…,mid]）→ 轮次 [[人类,终极],…]。
        末条 AI 行即终极；中间 AI 行（思维流）不随此帧（G1）。"""
        rounds, cur = [], None
        for m in (ms or []):
            if not isinstance(m, (list, tuple)) or len(m) < 2:
                continue
            if m[0] == 'u':
                if cur is not None:
                    rounds.append(cur)
                cur = [m, None]
            else:
                if cur is None:
                    cur = [None, m]
                else:
                    cur[1] = m
        if cur is not None:
            rounds.append(cur)
        return rounds

    def _ledger_rounds_full(self, sid):
        """0.26：本地账本（TRAE本地账本 单例）记录形态的全轮次
        [{'u':rec,'a':rec,'mids':[中间AI行…]},…]——供 ledger_req 按轮补
        思维流（G2）与差额补发共用。取不到/异常返回 []。"""
        try:
            import TRAE本地账本 as _账
            led = _账.ledger()
            port = getattr(self.dlg, 'port', 0)
            # 0.37：title 走加长兜底链（桌面→pane→账本库映射）；都没有时
            #   退回 sid 本身——ingest 时 (port,sid)→键 别名已登记，照样能取。
            title = self._title_of(sid) or str(sid or '')
            if not title:
                return []
            r = led.get_after(port, title, -1, 0)
            recs = r.get('msgs') or []
            rounds, cur = [], None
            for rec in recs:
                if not isinstance(rec, dict):
                    continue
                if rec.get('role') == 'u':
                    if cur is not None:
                        rounds.append(cur)
                    cur = {'u': rec, 'a': None, 'mids': []}
                else:
                    if cur is None:
                        cur = {'u': None, 'a': rec, 'mids': []}
                    else:
                        if cur.get('a') is not None:
                            cur['mids'].append(cur['a'])
                        cur['a'] = rec
            if cur is not None:
                rounds.append(cur)
            return rounds
        except Exception:
            return []

    def _gate_弃发(self, kind, sid, mid, miss):
        """0.36（老板 2026-11-19 令·三要素闸门）：**消息 ID、会话名**凑不齐
        就不广播（终身号可缺：没号用名称作临时锚，帧内 sid=''+nokey:1）。
        这里只记一行诊断，同一组合 60s 内不重复刷屏。
        禁止「未命名会话 / 尾 4 位号码当名」的兜底——宁可这条不发，也不许猜名。"""
        try:
            key = '%s|%s|%s|%s' % (kind, sid, mid, miss)
            d = getattr(self, '_gate_logs', None)
            if not isinstance(d, dict):
                d = {}
                self._gate_logs = d
            now = time.time()
            if now - float(d.get(key) or 0) < 60.0:
                return
            d[key] = now
            if len(d) > 200:                 # 防无限增长
                for k in list(d)[:100]:
                    d.pop(k, None)
            self.realq.put(('remote', '三要素不全 弃发 %s sid=%s mid=%s 缺=%s'
                            % (kind, sid or '-', mid or '-', miss)))
        except Exception:
            pass

    def _终态(self, sid, src=None):
        """0.40（终极认证闸门·老板 2026-11-19 令）：该轮思维流**是否已结束**。
        只有已终结的轮才允许打终极标志。判定顺序：
        ①数据源带 `sendIdle`（桌面快照有）：True 且 `finish` 无生成中标志 → 终结；
        ②没有信号（pane 缓存不带 sendIdle）→ 查本地账本该会话末条 AI 行 fin
          （ingest 只在定稿时写 ⇒ 权威）；
        ③都取不到 → **False（fail-closed）**，宁可当未终结也不许冒名终极。"""
        try:
            if isinstance(src, dict) and 'sendIdle' in src:
                if not src.get('sendIdle'):
                    return False
                fin = src.get('finish')
                if isinstance(fin, dict):
                    for k in ('busy', 'generating', 'streaming',
                              'running', 'thinking'):
                        if fin.get(k):
                            return False
                return True
        except Exception:
            pass
        try:      # ②账本库兜底：末条 AI 行 fin（定稿才写 1）
            import TRAE本地账本 as _账
            led = _账.ledger()
            title = self._title_of(sid) or str(sid or '')
            if title:
                r = led.get_after(getattr(self.dlg, 'port', 0),
                                  title, -1, 0)
                for rec in reversed(r.get('msgs') or []):
                    if isinstance(rec, dict) and rec.get('role') == 'a':
                        return bool(int(rec.get('fin') or 0))
        except Exception:
            pass
        return False

    def _ledger_entity(self, sid, n_rounds=None):
        """0.26：ledger 模块实体（§3.3/G1）——按轮补发仅人类+终极、不带
        思维流；n_rounds=1 即无本地账本场景只补 1 轮（C5）。数据源优先
        桌面快照/pane 缓存，回落本地账本。"""
        rounds = []
        src = None                 # 0.40：记数据源，判终态用
        try:
            val = self._last_snap if isinstance(self._last_snap, dict) else {}
            sel = self._sel_sid(val)
            # 0.36：sid 为空（终身号还没抓到）＝「当前选中会话」，用桌面 msgs
            if (sid and sel == sid) or (not sid and not sel):
                rounds = self._rounds_from_rows(val.get('msgs') or [])
                if rounds:
                    src = val
            else:
                p = (self._last_panes or {}).get(sid)
                if isinstance(p, dict):
                    rounds = self._rounds_from_rows(p.get('msgs') or [])
                    if rounds:
                        src = p
            if not rounds:
                full = self._ledger_rounds_full(sid)
                rounds = [[r.get('u'), r.get('a')] for r in full]
                src = None         # 账本行 fin 本身权威，不需要拍状态
        except Exception:
            pass
        total = len(rounds)
        try:
            n = int(n_rounds) if n_rounds else max(1, int(
                _ensure_cfg().get('ledger_push_rounds', 5) or 5))
        except Exception:
            n = 5
        if n > 0:
            rounds = rounds[-n:]
        # 0.40（终极认证闸门）：逐轮终态——只有最后一轮可能还在生成；之前的
        #   轮按定义已结束。最后一轮的终态由 `_终态` 认证，取不到信号按未终结。
        finals = [True] * len(rounds)
        if rounds:
            finals[-1] = self._终态(sid, src)
        # 0.32：codes 与 rounds 逐轮对齐（同号不同态判据）。
        codes = self._round_codes(rounds, finals)
        # 0.36（老板 2026-11-19 令·三要素闸门·最终口径）：
        #   有号以号为锚；**没号以名称 title 作临时锚照常广播**（帧内 sid=''
        #   ＋nokey:1，等拿到号客户端自动归并）——绝不因暂时无号压住广播；
        #   只有 mid 缺（该轮没有消息 ID）或 title 缺才不发。绝不拿号码当名字，
        #   也绝不许拼「未命名会话 / 尾4位」之类的假名。
        title = self._title_of(sid)
        if not title:
            self._gate_弃发('ledger', sid, '', 'title')
            return None
        _sid = str(sid or '')
        if not _sid:
            # 0.38（老板 2026-11-19 令·能抓号就尽一切努力抓号）：名称有号先
            #   从账本库映射把号**回查**出来（sid_of），别急着 nokey 临时锚——
            #   号一旦回锚，客户端就能按终身号归并历史。
            try:
                import TRAE本地账本 as _账
                _sid = str(_账.ledger().sid_of(
                    getattr(self.dlg, 'port', 0), title) or '')
            except Exception:
                _sid = ''
        # 0.40（老板令·四类标识 + 未终结净化）：mid 缺的轮剔除；fin=0 的轮
        #   把该 AI 行 index7 **在副本上**清空（绝不动 self._last_snap/pane 原件），
        #   保证客户端拿到 a[7] 为空、它自己算出的 fin 也是 0；同时该轮标
        #   `snap`（TRAE 思维流快照），只有 fin=1 的轮标 `a`（已认证终结）。
        pairs, kinds = [], []
        for _r, _c in zip(rounds, codes):
            if not str(_c.get('mid') or ''):
                continue                      # mid 缺 → 该轮剔除
            _f = int(_c.get('fin') or 0)
            if not _f and isinstance(_r, (list, tuple)) and len(_r) > 1 \
                    and isinstance(_r[1], (list, tuple)):
                _a2 = list(_r[1])
                while len(_a2) <= 7:
                    _a2.append('')
                _a2[7] = ''                   # 净化副本：不许带完成卡摘要
                _r = [_r[0], _a2]
            pairs.append((_r, _c))
            kinds.append(['u', 'a' if _f else str(_c.get('kind') or 'snap')])
        if not pairs:
            self._gate_弃发('ledger', sid, '', 'mid')
            return None
        rounds = [p[0] for p in pairs]
        codes_all = [p[1] for p in pairs]
        live = not int(codes_all[-1].get('fin') or 0)
        # 0.40：对账/补发只允许『u + a』参与 —— snap/th 不进 codes，永不参与
        #   need 判定（TRAE 快照永不可补，补了也是同一个半成品）。
        codes = [c for c in codes_all if int(c.get('fin') or 0) == 1]
        ent = {'sid': _sid, 'title': title,
               'rounds': rounds, 'total': total,
               'full': bool(total <= n), 'codes': codes, 'live': live,
               'kinds': kinds}

        if not _sid:
            ent['nokey'] = 1                    # 临时名称锚：库里也查不到号
        return ent

    def _ledger需补(self, sid, cv, sv):
        """0.32（3.71·V1.0 §七·:194「同号不同态」）：单会话是否要补发/覆盖。
        cv＝客户端上报值：旧客户端给 ver 字符串，新客户端给
        {'ver','rounds','codes':[{'mid','fin','hash'}]}；sv＝服务端该会话 ver。
        判据顺序：ver 快进短路 → 按 mid 集合差 → **同 mid 但 fin/hash 不同
        一律判需补**（编码相同≠内容相同，绝不许因「号码见过」判 same）。"""
        try:
            if cv is None:
                return True
            if isinstance(cv, dict):
                # 0.33：ver 键兼容——W1 过渡版报 'v'，定版报 'ver'
                _v = str(cv.get('ver') or cv.get('v') or '')
                if _v and _v == sv:
                    return False          # 快进：客户端确有该 ver 的内容
                codes = cv.get('codes')
                if not isinstance(codes, list):
                    return True           # 报了新结构却没给编码 ⇒ 当缺
                客户 = {}
                for c in codes:
                    if isinstance(c, dict) and c.get('mid'):
                        客户[str(c['mid'])] = c
                # 0.40（终极认证闸门·老板令）：客户端报 fin=0 的 mid＝它手里
                #   只是思维流快照（无独立号、与终极同号），**视为未持有终极
                #   ⇒ 该轮必须补**；只有两端 fin 都是 1 且 hash 相同才算齐。
                for _c in 客户.values():
                    try:
                        if int(_c.get('fin') or 0) != 1:
                            return True
                    except Exception:
                        return True       # fin 脏数据 ⇒ 按未持有处理
                # 与补发口径对齐：新客户端按「最新 3 轮」比对（§七 分阶段），
                #   否则会拿第 4/5 轮的码永远判缺、天天重灌。
                ent = self._ledger_entity(sid, 3)
                if not isinstance(ent, dict):
                    # 0.36：三要素不全 → 实体已是 None（组帧就弃发），这里判
                    #   「无需补」而不是「缺」，免得每次核对都白算一遍。
                    return False
                服务 = [c for c in (ent.get('codes') or [])
                        if str(c.get('mid') or '')]
                for c in 服务:
                    got = 客户.get(str(c['mid']))
                    if got is None:
                        return True       # 这个号客户端没有 ⇒ 缺
                    # 0.33：单条比较自带容错——fin/hash 脏数据只判「该条不同」，
                    #   绝不因一条异常把整个会话判 True（否则＝全量补发风暴）。
                    try:
                        _gf = int(got.get('fin') or 0)
                    except Exception:
                        return True       # fin 不是整数 ⇒ 该条不同
                    try:
                        _sf = int(c.get('fin') or 0)
                    except Exception:
                        _sf = 0
                    if _gf != _sf:
                        return True       # 同号不同态：完成态变了
                    if str(got.get('hash') or '') != str(c.get('hash') or ''):
                        return True       # 同号不同态：正文变了
                try:                       # 最新轮没编码可比时用轮数兜底
                    _cr = int(cv.get('rounds') or 0)
                    _need_r = min(int(ent.get('total') or 0), 3)
                    if _cr < _need_r:
                        return True
                except Exception:
                    pass
                return False
            return str(cv or '') != sv     # 旧口径：纯 ver 字符串比对
        except Exception:
            return True

    # ---- 推送闸（§八·1/2）与 macct 事件入口 ----

    def _macct_push(self):
        """0.26：macct 模块推送（models 事件与每拍快照共用；变更即推）。"""
        try:
            v = self._fp_macct()
            if v is not None and v != self._last_mod_ver.get('macct'):
                self._last_mod_ver['macct'] = v
                self._send_mod('macct', v, self._mod_entity('macct', {}))
        except Exception:
            pass

    def _mod_push(self, val, fp_val):
        """0.26：模块化下发主闸（§四：变更主动推送，不牵连其他模块）——
        每模块重算 ver 与「已下发 ver 表」比对，变化才发 mod 实体帧；
        think 专属 5 秒丢弃式限频（§六·1，窗口期中间版丢弃只发最新帧），
        其余模块变更即推。终极回复到达→ledger+sig 各自指纹变化自然触发
        推送（§四表）。"""
        now = time.time()
        last = self._last_mod_ver
        try:      # 1. sig（橙灯亮/灭、忙闲跃迁即推·独立高频）
            v = self._fp_sig(val)
            if v is not None and v != last.get('sig'):
                last['sig'] = v
                self._send_mod('sig', v, self._mod_entity('sig', val))
        except Exception:
            pass
        try:      # 2. snote（备注/定时；让路拍无 `备注` 键沿用上次 ver）
            v = self._fp_snote(val)
            if v is not None and v != last.get('snote'):
                last['snote'] = v
                self._send_mod('snote', v, self._mod_entity('snote', val))
        except Exception:
            pass
        try:      # 3. macct（模型/账号）
            self._macct_push()
        except Exception:
            pass
        try:      # 4. convs（会话列表壳+四字段）
            v = self._fp_convs(val)
            if v is not None and v != last.get('convs'):
                last['convs'] = v
                self._send_mod('convs', v, self._mod_entity('convs', val))
        except Exception:
            pass
        try:      # 5. didp（销卡池子）
            v = self._fp_didp()
            if v is not None and v != last.get('didp'):
                last['didp'] = v
                self._send_mod('didp', v, self._mod_entity('didp', val))
        except Exception:
            pass
        try:      # 6. ledger（按会话版本；终极回复落账即推）
            led = self._ledger_fps(val)
            # 0.29（Y7）：查 `_ledger_pushed` 持久表——pane 卸载再挂载、
            #   同内容不重推（修「同内容 ledger 18 连推 437KB」）。
            # 0.30（Y7 双键）：表值改 (ver, 内容hash) 二元组——ver 只防
            #   「整拍重扫」，同 ver 直接跳过（不重算实体）；ver 变了先算
            #   rounds 内容 hash，同 hash 整帧不推只记账：实测生成期
            #   tail/finish 指纹翻动、rounds 正文一字未变仍连推 40 帧/
            #   880KB——内容才是「要不要让客户端重收」的唯一判据。
            # 0.30（Y11）：刚 switch（30s 内）且客户端上报版本缺该会话 ⇒
            #   首帧只发 1 轮（C5 口径，与 _核对一发 only1 同源）——客户端
            #   清了 IDB 后切会话，不再收到 5 轮首帧。
            pushed = self._ledger_pushed
            for sid, v in led.items():
                if not v:
                    continue
                prev = pushed.get(sid)
                if prev and isinstance(prev, tuple) and prev[0] == v:
                    continue          # ver 没动 ⇒ 内容必然没动
                n_r = None
                try:
                    _st = _VCHECK_STATE
                    if (sid == str(_st.get('sid') or '')
                            and time.time() - float(_st.get('ts') or 0) < 30.0
                            and isinstance(_st.get('cli_led'), frozenset)
                            and sid not in _st['cli_led']):
                        n_r = 1       # Y11：无本地账本的刚切会话 ⇒ 1 轮
                except Exception:
                    n_r = None
                ent = self._ledger_entity(sid, n_r)
                if not isinstance(ent, dict):
                    continue          # 0.36：三要素不全 ⇒ 整帧不发（已记诊断）
                codes = ent.get('codes') or []
                shape = [(str(c.get('mid') or ''),
                          int(c.get('fin') or 0)) for c in codes]
                try:
                    h = self._ver12(json.dumps(
                        {'rounds': ent.get('rounds') or [],
                         'codes': codes}, sort_keys=True,
                        ensure_ascii=False, default=str))
                except Exception:
                    h = ''
                if prev and isinstance(prev, tuple) and h and h == prev[1]:
                    pushed[sid] = (v, h, shape)
                    continue
                # 0.32（3.71·同号不同态）：同 mid 同完成态、仅正文变长（思维流
                #   直播）⇒ ledger 不推（直播走 think 模块）；只有「新号 / 完成态
                #   翻转（fin 0→1）/ 换轮」才推覆盖帧。定稿那一次必然翻转 ⇒
                #   客户端最终一定收到终极覆盖，不会因 ver 没变而永远缺终态。
                if (prev and isinstance(prev, tuple) and len(prev) > 2
                        and shape == prev[2]):
                    pushed[sid] = (v, h, shape)
                    continue
                self._send_mod('ledger', v, ent, sid=sid)
                pushed[sid] = (v, h, shape)
            last['ledger'] = led
        except Exception:
            pass
        try:      # 7. think（画面+排队条；5 秒丢弃式限频只管本模块）
            v = self._fp_think(fp_val if isinstance(fp_val, dict) else val)
            if v is not None and v != last.get('think'):
                try:
                    _lim = bool(_ensure_cfg().get('think_live_limit_on', True))
                    _sec = max(0.0, float(
                        _ensure_cfg().get('think_live_sec', 5.0) or 5.0))
                except Exception:
                    _lim, _sec = True, 5.0
                if _lim and now - self._think_last_ts < _sec:
                    pass          # 窗口期内中间版丢弃，时间到只发最新一帧
                else:
                    last['think'] = v
                    self._think_last_ts = now
                    self._think_last_ver = v
                    self._send_mod('think', v, self._mod_entity('think', val))
        except Exception:
            pass

    # ---- 全模块底账（hello.mods / vack.mods） ----

    def _模块vers(self):
        """0.26：服务端当前全模块 ver（§3.1）。ledger 按会话细分（基于
        _last_snap/_last_panes 可见范围）。"""
        val = self._last_snap if isinstance(self._last_snap, dict) else {}
        out = {}
        try:
            out['sig'] = self._fp_sig(val) or ''
            sn = self._fp_snote(val)
            out['snote'] = (sn if sn is not None
                            else (self._last_mod_ver.get('snote') or ''))
            out['macct'] = self._fp_macct() or ''
            out['convs'] = self._fp_convs(val) or ''
            out['didp'] = self._fp_didp() or ''
            out['think'] = self._fp_think(val) or ''
            out['ledger'] = self._ledger_fps(val)
        except Exception:
            pass
        return out

    # ---- 上行报文分流（§八·6）与强核对（§三/§五） ----

    def _proto_sniff(self, body):
        """0.26：vcheck/ledger_req 协议报文分流（只解析小报文）。
        返回 True=已消费。vcheck＝强核对/主动核对（act=login/switch/svr/
        timer，上行单帧多模块编码·批复1）；ledger_req＝按会话按轮按需补
        思维流（§七）。"""
        try:
            if not body or body[:1] != '{' or len(body) > 8192:
                return False
            d = json.loads(body)
            if not isinstance(d, dict):
                return False
            t = d.get('t')
            if t == 'vcheck':
                self._on_vcheck(d)
                return True
            if t == 'ledger_req':
                self._on_ledger_req(d)
                return True
            if t == 'set_think_int':
                # 0.29（Y12）：同报文 2s 窗去重——实测 2 次请求收 4 条 ack
                #   （同帧双路/重发到达），重复帧静默消费：不写 cfg、不回
                #   ack，做到一请求一回执。
                try:
                    _fp = self._ver12(json.dumps(
                        d, sort_keys=True, ensure_ascii=False))
                except Exception:
                    _fp = ''
                if (_fp and _fp == self._think_int_last[0]
                        and time.time() - self._think_int_last[1] < 2.0):
                    return True
                self._think_int_last = (_fp, time.time())
                # 0.27（W1 对齐点 d）：小账本页调控 think 直播帧间隔——
                #   v>0 ⇒ 开限频并设间隔秒（夹 1~600）；v<=0 ⇒ 关限频
                #   （无间隔模式·E4，画面一变即发）。改完立即落盘，免重启
                #   生效（下拍 _mod_push 即按新值走）。回执 think_int_ack。
                try:
                    v = float(d.get('v') or 0)
                except Exception:
                    v = 0.0
                cfg = _ensure_cfg()
                try:
                    if v > 0:
                        sec = max(1.0, min(600.0, v))
                        cfg['think_live_sec'] = sec
                        cfg['think_live_limit_on'] = True
                    else:
                        cfg['think_live_limit_on'] = False
                        sec = float(cfg.get('think_live_sec', 5.0) or 5.0)
                    痕迹与配置._save_cfg(cfg)
                    self.send_json({'t': 'think_int_ack', 'ok': True,
                                    'sec': sec,
                                    'on': bool(cfg.get(
                                        'think_live_limit_on', True))})
                except Exception:
                    self.send_json({'t': 'think_int_ack', 'ok': False})
                return True
        except Exception:
            pass
        return False

    def _on_vcheck(self, d):
        """0.26：强核对/主动核对处理（C2/C3/C4/I1 服务端侧）——上行单帧多
        模块编码；下行 vack stage:1/2 两阶段回执（same/need/mods/nochange
        照 §3.1）＋need 差额 mod 实体帧。act='switch'：stage1 立即回（已
        变更选中会话）；stage2 等桌面选中==目标 sid（≤8s）再核对——切换
        后的版本要等切换完成才有准数。"""
        act = str(d.get('act') or 'timer')
        sid = str(d.get('sid') or '')
        mods = d.get('mods') if isinstance(d.get('mods'), dict) else {}
        seq = d.get('req_seq')
        keys = ('sig', 'snote', 'macct', 'convs', 'didp', 'think')

        def _核对一发(_act=None, _sid=None, _mods=None, _seq=None):
            # 0.30（Y13）：参数化——login 合并窗定时线程到点要用「窗内最
            #   新一条」的 sid/mods/seq 补答；缺省沿用本帧闭包值（其余调
            #   用点零改动）。
            act2 = act if _act is None else _act
            sid2 = sid if _sid is None else _sid
            mods2 = mods if _mods is None else _mods
            seq2 = seq if _seq is None else _seq
            cur = self._模块vers()
            cli_led = (mods2.get('ledger')
                       if isinstance(mods2.get('ledger'), dict) else {})
            need = [k for k in keys
                    if str(mods2.get(k) or '') != cur.get(k)]
            # 0.32（3.71）：逐会话按「编码集合＋完成态＋正文指纹」判缺——
            #   同 mid 但 fin/hash 变了也算缺（同号不同态必须覆盖下发）；
            #   旧客户端只报 ver 字符串的走原字符串比对（向后兼容）。
            led_need = [s for s, v in (cur.get('ledger') or {}).items()
                        if self._ledger需补(s, cli_led.get(s), v)]
            # 0.37（老板 2026-11-19 令「本地账本里有的会话都要能按需出账本」）：
            #   核对范围不能只看「可见会话」——客户端上报里带 codes 的 sid、
            #   以及本次点名的 sid（act=switch 等）都纳入核对；账本库有的
            #   话按需出账本（title/mid 凑不齐的自然被三要素闸门拦下）。
            if isinstance(cli_led, dict):
                for _cs in cli_led:
                    if _cs and _cs not in (cur.get('ledger') or {}) \
                            and _cs not in led_need:
                        led_need.append(_cs)
            if act2 == 'switch' and sid2 and sid2 not in cli_led \
                    and sid2 not in led_need:
                led_need.append(sid2)    # 无本地账本的会话→补发仅 1 轮（C5）
            same = (not need) and (not led_need)
            nochange = [k for k in keys if k not in need]
            if not led_need:
                nochange.append('ledger')
            self.send_json({'t': 'vack', 'act': act2, 'stage': 2,
                            'same': same,
                            'need': need + (['ledger'] if led_need else []),
                            'mods': cur, 'nochange': nochange,
                            'sid': sid2, 'req_seq': seq2})
            for k in need:
                try:
                    self._send_mod(k, cur.get(k) or '',
                                   self._mod_entity(
                                       k, self._last_snap or {}))
                except Exception:
                    pass
            try:
                n = max(1, int(_ensure_cfg().get(
                    'ledger_push_rounds', 5) or 5))
            except Exception:
                n = 5
            for s2 in led_need:
                try:
                    only1 = (s2 not in cli_led)
                    # 0.32（3.71·§七 分阶段）：新客户端（报 codes）按「最新 3 轮」
                    #   补（先保障最新一轮，再补到共 3 轮）；无本地账本的刚切
                    #   会话仍只 1 轮（C5）；旧客户端沿用原 ledger_push_rounds。
                    _新客户 = isinstance(cli_led.get(s2), dict)
                    _n2 = 1 if only1 else (3 if _新客户 else n)
                    _v2 = (cur.get('ledger') or {}).get(s2) or ''
                    _e2 = self._ledger_entity(s2, _n2)
                    if not isinstance(_e2, dict):
                        continue      # 0.36：三要素不全 ⇒ 不补发（已记诊断）
                    # 0.31（Y7 复盘/Y23）：vcheck 补发同样过内容 hash 闸并回
                    #   写 `_ledger_pushed`——0.30 只在 `_mod_push` 闸了，
                    #   这里直推不记账：静置期每次重连 login（cli_led 缺该
                    #   会话）都把同一会话再灌一遍（实测 10 分钟 31 帧/
                    #   515KB；1 轮 ledger 两条 5.47/5.91s 即两次 login 各
                    #   推一帧）。同内容整帧不推，与推送闸同一判据。
                    _h2 = self._ver12(json.dumps(
                        {'rounds': _e2.get('rounds') or [],
                         'codes': _e2.get('codes') or []}, sort_keys=True,
                        ensure_ascii=False, default=str))
                    _p2 = self._ledger_pushed.get(s2)
                    # 0.32：新客户端（报 dict+codes）明确说缺/异态 ⇒ 必须发，
                    #   不再被「上次推过同内容」的 hash 闸吞掉（那正是「同号
                    #   不同态永远补不上」的坑）；旧客户端（只报 ver）仍留原
                    #   Y7 闸，防重连风暴重灌同一帧。
                    if (not _新客户) and _p2 and isinstance(_p2, tuple) \
                            and _h2 and _h2 == _p2[1]:
                        continue
                    self._send_mod('ledger', _v2, _e2, sid=s2)
                    self._ledger_pushed[s2] = (
                        _v2, _h2,
                        [(str(c.get('mid') or ''),
                          int(c.get('fin') or 0))
                         for c in (_e2.get('codes') or [])])
                except Exception:
                    pass

        # 0.30（Y13）→0.31 改固定窗（Y27）：login vcheck 10s 合并窗——窗外
        #   首条立即答；窗内后续到达只记「最新一条」不答（窗尾不再随到达
        #   顺延！），窗满由定时线程补答最新一条。0.30 的滑动窗在持续重连
        #   风暴下把 login vack 永久饿死（每次重连都落窗内→永不补答→客户
        #   端等不到回音再重连→死循环，ST 实测静置 10 分钟 171 连/84
        #   login）；改固定窗后窗满必补答，最坏 10s 一答，风暴必收敛。
        #   timer/svr/switch 不受此窗约束——timer 周期 60s、switch 需即时。
        if act == 'login':
            try:
                _fp = self._ver12(json.dumps(
                    mods, sort_keys=True, ensure_ascii=False, default=str))
            except Exception:
                _fp = ''
            with _LOGIN_MERGE_LOCK:
                st = self._login_merge
                _now = time.time()
                if _fp and _fp == st.get('fp') and _now < st.get('end', 0):
                    st['pend'] = (sid, mods, seq)     # 窗内只记最新一条
                    # 0.31（Y27）：窗尾固定＝首条到达+10s，绝不顺延
                    return
                st['fp'] = _fp
                st['pend'] = None
                st['end'] = _now + _LOGIN_MERGE_SEC
            try:
                _核对一发(act, sid, mods, seq)     # 窗外首条立即答
            except Exception:
                pass

            def _窗满():
                while True:
                    with _LOGIN_MERGE_LOCK:
                        if time.time() >= self._login_merge['end']:
                            break
                    time.sleep(0.3)
                with _LOGIN_MERGE_LOCK:
                    p = self._login_merge.get('pend')
                    if p is not None:
                        self._login_merge['pend'] = None
                if p is not None:
                    try:
                        _核对一发('login', p[0], p[1], p[2])
                    except Exception:
                        pass
            threading.Thread(target=_窗满, daemon=True,
                             name='login-merge').start()

        elif act == 'switch':
            # 0.29（Y8·V1.0 §九）：序号与最新切换上下文收【模块级单例】
            #   （跨主/副双路连接与全部线程共享）；0.28 的实例级对号卫兵
            #   挡不住「迟到送达的旧 vcheck 自己领号变最新」（FOX 分段/
            #   批次延迟实测 36s）——故 `_等切换` 发 stage:2 前再加
            #   「桌面选中==目标 sid」实质判据，迟到/被合并/被顶替三种
            #   形态全部作废。报文格式/协议/其它逻辑不动。
            with _VCHECK_LOCK:
                _VCHECK_STATE['seq'] = int(_VCHECK_STATE.get('seq') or 0) + 1
                _VCHECK_STATE['sid'] = sid
                # 0.30（Y11）：记下 switch 时刻与客户端上报的 ledger 会话键——
                #   _mod_push 推 ledger 首帧时据此判「客户端该会话无本地存」
                #   ⇒ 只发 1 轮（C5），防清 IDB 后切会话首帧灌 5 轮。
                _VCHECK_STATE['ts'] = time.time()
                try:
                    _cli = mods.get('ledger') \
                        if isinstance(mods.get('ledger'), dict) else {}
                    _VCHECK_STATE['cli_led'] = frozenset(
                        str(k) for k in _cli.keys())
                except Exception:
                    _VCHECK_STATE['cli_led'] = None
                _my_seq = _VCHECK_STATE['seq']
            self.send_json({'t': 'vack', 'act': act, 'stage': 1, 'ok': True,
                            'sid': sid, 'req_seq': seq})

            def _等切换():
                dl = time.time() + 8.0
                while time.time() < dl:
                    if _VCHECK_STATE.get('seq') != _my_seq:
                        return          # 已有更新的切换接管 ⇒ 本条作废
                    try:
                        if self._sel_sid(self._last_snap or {}) == sid:
                            break
                    except Exception:
                        break
                    time.sleep(0.3)
                if _VCHECK_STATE.get('seq') != _my_seq:
                    return              # 到点再对号（防等待期撞上后到者）
                if sid and self._sel_sid(
                        self._last_snap or {}) not in ('', sid):
                    return              # 0.29：桌面已停别的会话 ⇒ 陈旧作废
                try:
                    _核对一发()
                except Exception:
                    pass
            threading.Thread(target=_等切换, daemon=True,
                             name='vcheck-switch').start()
        else:
            try:
                _核对一发()
            except Exception:
                pass

    def _on_ledger_req(self, d):
        """0.26（§七/G2）：点折叠卡按需补该轮思维流——{'t':'ledger_req',
        'sid':…,'round':N,'kind':'think'}；帧 m='ledger' 携 think 段（协议
        只锁「按需、不批量」）。round 从最新往旧数（1=最新一轮）。"""
        sid = str(d.get('sid') or '')
        try:
            n = int(d.get('round') or 1)
        except Exception:
            n = 1
        kind = str(d.get('kind') or 'think')
        rows = []
        try:
            full = self._ledger_rounds_full(sid)
            if 1 <= n <= len(full):
                rnd = full[-n]
                rows = list(rnd.get('mids') or [])
                if not rows and rnd.get('a') is not None:
                    rows = [rnd['a']]    # 无中间行时终极行兜底（防空帧）
        except Exception:
            pass
        try:
            v = self._ver12(json.dumps(rows, ensure_ascii=False,
                                       sort_keys=True, default=str))
        except Exception:
            v = ''
        # 0.36（老板 2026-11-19 令·三要素闸门）：title 缺 / 该轮没有任何
        #   消息 ID → 不发；sid 缺但 title 有 → 照常发，带 nokey:1。
        _title = self._title_of(sid)
        if not _title:
            self._gate_弃发('ledger_req', sid, '', 'title')
            return
        if not rows or not any(str(self._row_code(r).get('mid') or '')
                               for r in rows):
            self._gate_弃发('ledger_req', sid, '', 'mid')
            return
        _frame = {'sid': sid, 'title': _title, 'kind': kind,
                  'round': n, 'rows': rows,
                  # 0.40（老板令·四类标识）：本条是 TRAE 思维流补发＝`snap`
                  'rkind': 'snap'}
        if not sid:
            _frame['nokey'] = 1
        self._send_mod('ledger', v, _frame, sid=sid)

    def _presence(self, body, sender, ch=None):
        """拦截客户端登录类报文（login/hb/logout）。
        返回 True=已消费（不再当作操控命令投回 uiq）。
        1.78：ch=报文到达的频道（主/副），登录态按频道隔离。"""
        if not body or body[:1] != '{':
            return False
        try:
            d = json.loads(body)
        except Exception:
            return False
        if not isinstance(d, dict):
            return False
        t = d.get('t')
        if t == 'login':
            self._cli_touch(sender, d.get('fg'), ch)
            self._push_full(sender)          # 登录即给全量
            try:                             # 0.21：重连首拍补发「按需会话」正文
                self._pane_demand_rearm()
            except Exception:
                pass
            return True
        if t == 'hb':
            # 老板 2026-11-19 令（TR-3·服务端侧）：心跳只登记在线时刻，
            #   **绝不回 hb_ack**——服务器蹲守频道＝完全静默，任何回帧都是
            #   配额浪费。这是刻意设计，禁止后人「补一个 ack 更礼貌」。
            self._cli_touch(sender, d.get('fg'), ch)
            return True
        if t == 'logout':
            self._cli_drop(sender)
            return True
        if t == 'who':
            # 0.05：网页端「刷新服务端」按钮 → 客户端点名，本机应答在线。
            # 客户端 who 走本分支（不进 _srv_msg），故必须在此兜住。
            self.announce()
            return True
        return False

    def _sender(self):
        """唯一发送线程：出向队列 → FOX 分段发送。"""
        while not self.stop_ev.is_set():
            self._report_peers()
            # 0.05：删除 20s 周期心跳（本机平时全程静默）；仅保留 75s
            # 超时判离线——谁不再应答点名/上线报到，就把它摘出名册。
            if self.srv_prune():
                self.realq.put(('srv_peers', self.srv_snapshot()))
            # 1.51：登录态超时修剪（无 hb 超 LOGIN_TMO 判下线 → 闸门关闭）
            self._cli_prune()
            try:                       # 13.1：名册有脏则节流落盘（持久化）
                痕迹与配置._roster_flush()
            except Exception:
                pass
            try:
                item = self.outq.get(timeout=5)
            except queue.Empty:
                item = None
            try:
                if item is not None:
                    # 1.78：出向只发给「已登上且有登录客户端」的频道。
                    # 2026-11-16 老板令：不双发（省条数）；只发「你最近发命令所在频道」，
                    #   5 分钟内无入向再退回「有登录客户端的频道」。
                    # 0.39（老板 2026-11-19 令·**严禁同一条消息双频道发送**）：
                    #   目标恒为**恰好一个频道或空**——由 _pick_out_ch 统一裁决
                    #   （回声频道优先 → 心跳最新的那个 → 都没有就不发）。
                    _one = self._pick_out_ch()
                    targets = [_one] if _one else []
                    if targets:
                        self._fox_send(item, targets)
            except Exception:
                pass

    def _fox_send(self, text, chans=()):
        # 0.39（老板 2026-11-19 令·**严禁双频道发送**）：调用方已保证单频道，
        #   这里再兜一层——多目标一律收敛为第一个，并在「WS收发记录」记一条
        #   诊断（防后人再写出双发）。
        try:
            if chans and len(chans) > 1:
                _first = list(chans)[0]
                try:
                    WS收发记录.加('发', '出向多目标 收敛为单频道',
                                  频道=str(_first), 用途='门禁', 类型='收敛')
                except Exception:
                    pass
                chans = [_first]
        except Exception:
            pass
        # 真实送出：只对「确有连接」的频道逐个 w.send；并在写出的那一刻
        # 按真实频道记入「WS收发记录」（用户 2026-10-05：要频道内的真实
        # 收发，不要送出前「待路由」那种伪概念）。live=已定频道的连接表。
        live = [(ch, self._conns.get(ch)) for ch in chans]
        live = [(ch, w) for ch, w in live if w is not None]
        if not live:
            return
        # 1.03 受监督且实际在线的频道集合（逐频道记账）
        mon_chs = [ch for ch, _w in live if _mon(ch)]
        n_mon = len(mon_chs)
        if not CFG.get('fox_on', True):
            # 1.04：FOX 关闭——整条直发（≤16KB 可通，超限被中继丢弃）
            # 1.23：裸 JSON 注入 sid/srv（多服务端回声判定与源头识别）
            # 0.36：补盖 srv_sid——FOX 关闭分支此前漏了来源实例号（老板令
            #   「全帧标识，不能跨服务器混淆」）；send_json 咽喉只管 FOX 开启
            #   时的 JSON 帧与 FOX 关闭时的入队文本，这里重拼所以再盖一次。
            try:
                d = json.loads(text)
                if isinstance(d, dict):
                    d['sid'] = _srv_sid()
                    d.setdefault('srv', _srv_name())
                    d.setdefault('srv_sid', _srv_sid())
                    text = json.dumps(d, ensure_ascii=False)
            except Exception:
                pass
            _fc, _ft = _frame_classify(text)     # 1.80：裸发分类记账
            for ch, w in live:
                w.send(text)
                try:   # 诊断：真实写出即记（按真实频道，整条原文）
                    WS收发记录.发(text, ch, 用途=_fc, 类型=_ft)
                except Exception:
                    pass
            for c in mon_chs:
                _stats_add(tx=len(text), txn=1, ch=c)
                _detail_add('t', _fc, _ft, len(text), 1, ch=c)
            self._sent_echo.append(text)
            if len(self._sent_echo) > 16:
                del self._sent_echo[:len(self._sent_echo) - 16]
            return
        # FOX v2.1：单段直发；多段交 _FoxOut 分批结算（每 20 段一批等 ACK、
        # 超时催问 1 次、缺段 64→32→16KB 降级补发、留底 LRU10、用尽回 FAIL）。
        self.fox_out.send(text, live, _srv_sid())

    def _rec_out(self, ch, frame, fc, ft):
        """FOX 帧真实写出后的诊断记账（与旧 _fox_send 同口径）。"""
        try:
            WS收发记录.发(frame, ch, 用途=fc, 类型=ft)
        except Exception:
            pass
        try:
            if _mon(ch):
                _stats_add(tx=len(frame), txn=1, ch=ch)
                _detail_add('t', fc, ft, len(frame), 1, ch=ch)
        except Exception:
            pass

    def _ctrl_send(self, ch, frame):
        """接收侧回发控制帧（ACK）——只走报文到达的那个频道。"""
        w = self._conns.get(ch)
        if not w:
            return
        try:
            fc, ft = _frame_classify(frame)
            w.send(frame)
            self._rec_out(ch, frame, fc, ft)
        except Exception:
            pass

    def _fox_log(self, line):
        """FOX 长消息终局提示 → 频道活动日志（fox）。"""
        try:
            self._chan_add('fox', '%s  %s'
                           % (time.strftime('%H:%M:%S'), line))
        except Exception:
            pass

    def _set_on_line(self, b):
        self.on_line = b
        self.realq.put(('remote', b))


# ================= 极简 CDP 客户端（原 auto_login.py 内联） =================

class _WS(object):
    def __init__(self, host, port, path):
        # 0001·执行慢四条①：10s 死等 → 3s 短超时（详见维护记录 0.14）。
        s = socket.create_connection((host, port), timeout=3)
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

