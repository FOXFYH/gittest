# -*- coding: utf-8 -*-
"""贴吧型派单系统 · 命令行工具

给「人」和「脚本」用；和 MCP 完全同一套工具（不重复维护），只是渲染成
好读的贴吧样式。所有命令同样经本机投递口转给「贴吧服务端.py」执行。

用法：
  py 贴吧CLI.py                      # 看帮助
  py 贴吧CLI.py 系统_状态
  py 贴吧CLI.py 吧_新建 --路径 "D:\\网络硬盘\\wps云盘\\脚本备份\\工作台"
  py 贴吧CLI.py 帖_发布 --吧 工作台 --标题 "写延时排班器" --内容 "……"
  py 贴吧CLI.py 帖_读 --tid T001
"""

import os
import sys

_这里 = os.path.dirname(os.path.abspath(__file__))
if _这里 not in sys.path:
    sys.path.insert(0, _这里)

from 贴吧MCP服务 import _cli_main, _cli_help   # noqa: E402


def main():
    for _st in ('stdout', 'stderr', 'stdin'):
        try:
            getattr(sys, _st).reconfigure(encoding='utf-8')
        except Exception:
            pass
    argv = sys.argv[1:]
    if argv and argv[0] in ('-h', '--help', 'help', '帮助'):
        _cli_help()
        return 0
    return _cli_main(argv)


if __name__ == '__main__':
    sys.exit(main())