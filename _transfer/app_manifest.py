# -*- coding: utf-8 -*-
"""
FYH 远程控制 · 应用清单（共享清单）
================================================
本文件是【网页面板应用按钮】的唯一权威清单，放在 WPS 网盘同步目录内，
改一次全机器自动同步（所有装了 FYH 的电脑都用这一份）。

由 自身模块\\FYH远程控制模块.py 直接 import 读取，不再使用本机的 apps.json。

约定：
- APPS 是一个列表，每项一个应用字典，字段含义：
    key            唯一标识（面板按此下发指令，勿随意改）
    name           面板上显示的名字
    exe/exes       普通 exe 应用的进程名（可多候选）
    run_detect     填 "cmdline" 表示脚本类应用（.py/.pyw），改用命令行匹配
    cmdline_mark   脚本类应用的命令行特征串
    path/args      自定义启动路径/参数（一般留空）
    install_paths  安装位置候选（仅作提示，找不到会自动全盘搜索并记到本机）
    install_keywords  注册表卸载项关键词（判断是否安装）
- 【不要】在这里写 keep_alive（保活是每台电脑各自独立的"使用痕迹"，
  由 FYH远程控制模块.py 存在各机本地配置夹，不随本文件同步）。
- 想增删按钮：直接改本文件并保存，各机下一次刷新清单即生效。
"""

APPS = [
    {
        "key": "sunlogin",
        "name": "向日葵远程",
        "exe": "SunloginClient.exe",
        "exes": ["SunloginClient.exe", "AweSun.exe"],
        "path": "",
        "args": "",
        "install_paths": [
            r"C:\Program Files\Oray\SunLogin\SunloginClient\SunloginClient.exe",
            r"C:\Program Files (x86)\Oray\SunLogin\SunloginClient\SunloginClient.exe",
            r"D:\Program Files\Oray\SunLogin\SunloginClient\SunloginClient.exe",
            r"C:\Program Files\Oray\AweSun\AweSun.exe",
            r"C:\Program Files (x86)\Oray\AweSun\AweSun.exe",
            r"D:\Program Files\Oray\AweSun\AweSun.exe",
        ],
        "install_keywords": ["sunlogin", "向日葵"],
    },
    {
        "key": "todesk",
        "name": "ToDesk",
        "exe": "ToDesk.exe",
        "exes": ["ToDesk.exe"],
        "path": "",
        "args": "",
        "install_paths": [
            r"C:\Program Files\ToDesk\ToDesk.exe",
            r"C:\Program Files (x86)\ToDesk\ToDesk.exe",
            r"D:\Program Files\ToDesk\ToDesk.exe",
        ],
        "install_keywords": ["todesk"],
    },
    {
        "key": "trae_server",
        "name": "TRAE同步服务端",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "TRAE同步显示与控制工具_服务端.pyw",
        "install_paths": [
            r"工作台\AI大模型工具\TRAE同步显示与控制工具\TRAE同步显示与控制工具_服务端.pyw",
        ],
        "install_keywords": [],
    },
    {
        "key": "workbuddy_server",
        "name": "WorkBuddy同步服务端",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "WorkBuddy同步显示与控制工具_服务端.pyw",
        "install_paths": [
            r"工作台\AI大模型工具\WorkBuddy同步显示与控制工具\WorkBuddy同步显示与控制工具_服务端.pyw",
        ],
        "install_keywords": [],
    },
    {
        "key": "workbuddy_cli_server",
        "name": "WorkBuddyCLI服务端",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "WorkBuddy 清爽版.pyw",
        "install_paths": [
            r"工作台\AI大模型工具\WorkBuddy远程控制CLI版\WorkBuddy 清爽版.pyw",
        ],
        "install_keywords": [],
    },
    {
        "key": "tts_server",
        "name": "网页版文字转语音服务",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "本地TTS服务.py",
        "install_paths": [
            r"工作台\网页版文字转语音\本地TTS服务.py",
        ],
        "install_keywords": [],
    },
    {
        "key": "fyh",
        "name": "FYH快速访问",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "FYH快速访问2.0",
        "install_paths": [
            r"工作台\FYH快速访问\FYH快速访问2.0.pyw",
        ],
        "install_keywords": [],
    },
    {
        "key": "shou_1r",
        "name": "远控端-触手1.0R",
        "exe": "启动前线助手.exe",
        "exes": ["启动前线助手.exe"],
        "path": "",
        "args": "",
        "install_paths": [
            r"工作台\----------开发资源包---------\远程触手\TRAE触手1.0-R版本\前线触手\启动前线助手.exe",
        ],
        "install_keywords": ["远程触手", "启动前线助手"],
    },
    {
        "key": "shou_2",
        "name": "远控端-触手2.0",
        "exe": "",
        "path": "",
        "args": "",
        "run_detect": "cmdline",
        "cmdline_mark": "前线触手2.0GUI.pyw",
        "install_paths": [
            r"工作台\----------开发资源包---------\远程触手\TRAE触手2.0-自研\前线触手2.0\前线触手2.0开发版\前线触手2.0GUI.pyw",
        ],
        "install_keywords": ["远程触手", "前线触手2.0"],
    },
]
