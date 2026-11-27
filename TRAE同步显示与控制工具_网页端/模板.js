/* 自动生成，勿手改；改 下级模块/消息模板.json 后重跑 工具/生成网页模板.py */
window.MSGTPL = {
 "版本": "1.00",
 "说明": "电脑版与网页版共用消息模板单一真源。py 由 下级模块/消息模板.py 读取；网页端由 工具/生成网页模板.py 生成 模板.js。改文案只改这里。",
 "FOX卡": {
  "play1": "(@fox-play1)",
  "play2": "(@fox-play2)",
  "ask1": "(@fox-ask1)",
  "ask2": "(@fox-ask2)",
  "sys1": "(@fox-sys1)",
  "sys2": "(@fox-sys2)",
  "lib1": "(@fox-lib1)",
  "lib2": "(@fox-lib2)"
 },
 "帧": {
  "ev": "ev",
  "mod": "mod",
  "vack": "vack",
  "vcheck": "vcheck",
  "ledger": "ledger",
  "ledger_req": "ledger_req",
  "plib": "plib",
  "plib_idx": "plib_idx",
  "plib_text": "plib_text"
 },
 "提示语": {
  "核对成功": "核对成功",
  "正核对": "切换成功，正核对…",
  "服务器执行中": "服务器执行中",
  "等待服务器回应": "等待服务器回应",
  "已是最早记录": "已经是最早记录了",
  "核对未完成": "核对未完成：屏幕仍缺消息，已请求重绘",
  "暂无消息": "（暂无消息，发送一条开始对话）"
 },
 "钉钉": {
  "积分预警": "积分告警：当前积分 {points}，低于阈值 {th}",
  "登录丢失": "登录态丢失：{srv}",
  "未读超时": "会话「{title}」已 {min} 分钟未读完成"
 },
 "帧格式": {
  "ev": {
   "必选": {
    "t": "str",
    "k": "str",
    "v": "any"
   },
   "可选": {
    "srv": "str",
    "sid": "str",
    "srv_sid": "str",
    "host": "str",
    "ts": "int"
   }
  },
  "mod": {
   "必选": {
    "t": "str",
    "m": "str",
    "v": "str",
    "d": "any"
   },
   "可选": {
    "sid": "str",
    "ts": "int",
    "srv": "str"
   }
  },
  "vack": {
   "必选": {
    "t": "str",
    "act": "str",
    "stage": "int",
    "sid": "str"
   },
   "可选": {
    "need": "list",
    "items": "list",
    "srv_order": "list",
    "same": "bool",
    "mods": "dict",
    "mids": "list"
   }
  },
  "vcheck": {
   "必选": {
    "t": "str",
    "act": "str"
   },
   "可选": {
    "mods": "dict",
    "req_seq": "int",
    "sid": "str",
    "thinks": "dict"
   }
  },
  "ledger_req": {
   "必选": {
    "t": "str"
   },
   "可选": {
    "sid": "str",
    "rounds": "int",
    "ch": "str"
   }
  },
  "cmd": {
   "必选": {
    "t": "str"
   },
   "可选": {
    "arg": "any",
    "k": "str"
   }
  },
  "login": {
   "必选": {
    "t": "str"
   },
   "可选": {
    "nick": "str",
    "fg": "bool"
   }
  }
 }
};
