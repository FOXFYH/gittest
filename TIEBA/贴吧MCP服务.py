# -*- coding: utf-8 -*-
"""贴吧型派单系统 · MCP 服务端（stdio + JSON-RPC 2.0）

把「贴吧型派单系统」的全部能力以标准 MCP 开放给 AI（总管 Agent / 子代理都用它）。
本文件只做「转发壳」：所有工具命令经【本机投递口】127.0.0.1:19885 转给
「贴吧服务端.py」执行 —— 服务端才是唯一写入方（多入口不打架）。
投递口没起时会自动把服务端拉起来（脱离启动，不随本进程退出）。

工具一览（奇偶铁律由服务端强制，AI 不用管楼层号）：
  总管用：吧_新建 / 吧_列表 / 帖_发布 / 帖_检索 / 帖_留言 / 帖_改楼 /
          帖_代发叫停 / 帖_终结 / 帖_解锁 / 帖_列表 / 帖_读
  子代理用：帖_交稿 / 帖_占锁
  其他：系统_状态

用法（在 MCP 宿主里新增 stdio 服务）：
  命令: <Python 绝对路径，如 D:\\Python310\\python.exe>
  参数: <本文件绝对路径>

也可直接命令行调（与 MCP 共用同一批工具）：
  py 贴吧MCP服务.py cli 系统_状态
  py 贴吧MCP服务.py cli 吧_新建 --路径 "D:\\网络硬盘\\wps云盘\\脚本备份\\工作台"
"""

import os
import sys
import json
import time
import socket
import subprocess

模块版本 = '0.1.0'

_SRV_HOST = '127.0.0.1'
_SRV_PORT = int((os.environ.get('TIEBA_PORT') or '').strip() or 19885)
_SRV_TIMEOUT = 45


# ========================== 本机投递口客户端 ==========================
class 服务端错误(RuntimeError):
    pass


def _试着连(超时=10):
    """返回已连接的 socket；连不上返回 None。"""
    try:
        return socket.create_connection((_SRV_HOST, _SRV_PORT), timeout=超时)
    except Exception:
        return None


def _拉起服务端():
    """把「贴吧服务端.py」脱离启动（不占本进程，也不随本进程退出而死）。"""
    here = os.path.dirname(os.path.abspath(__file__))
    srv = os.path.join(here, '贴吧服务端.py')
    if not os.path.isfile(srv):
        return False
    解释器 = sys.executable or 'py'
    标志 = 0
    if os.name == 'nt':
        标志 = 0x00000008 | 0x00000200      # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    try:
        subprocess.Popen([解释器, srv], cwd=here, close_fds=True,
                         creationflags=标志, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False


def _保活连接():
    """拿一条到投递口的连接（必要时自动拉起服务端并等它就绪）。"""
    s = _试着连()
    if s:
        return s
    拉起来了 = _拉起服务端()
    截止 = time.time() + 8
    while time.time() < 截止:
        time.sleep(0.4)
        s = _试着连()
        if s:
            return s
    raise 服务端错误(
        '连不上本机投递口 127.0.0.1:%d%s。请手动跑一次「贴吧服务端.py」(py 贴吧服务端.py)。'
        % (_SRV_PORT, '（已尝试自动拉起，但未等到就绪）' if 拉起来了 else ''))


def _调服务端(cmd, arg=None):
    """发一条命令，读回一条响应，返回 data。"""
    s = _保活连接()
    try:
        s.settimeout(_SRV_TIMEOUT)
        req = {'id': 1, 'cmd': cmd, 'arg': arg if arg is not None else {}}
        s.sendall((json.dumps(req, ensure_ascii=False) + '\n').encode('utf-8'))
        f = s.makefile('rb')
        line = f.readline().decode('utf-8', 'replace')
        resp = json.loads(line) if line else None
    except 服务端错误:
        raise
    except Exception as e:
        raise 服务端错误('投递口通信失败：%s' % e)
    finally:
        try:
            s.close()
        except Exception:
            pass
    if not isinstance(resp, dict) or not resp.get('ok'):
        raise 服务端错误((resp or {}).get('error') or '服务端响应异常')
    return resp.get('data')


# ========================== 可扩展工具注册表 ==========================
_TOOLS = {}


def register_tool(name, desc='', schema=None, handler=None):
    _TOOLS[name] = {'desc': desc,
                    'schema': schema or {'type': 'object', 'properties': {}},
                    'handler': handler}


def _S(属性, 必填=None):
    return {'type': 'object', 'properties': 属性, 'required': 必填 or []}


_路径 = {'type': 'string', 'description': '项目文件夹的绝对路径（= 这个吧的网址）'}


def _注册全部():
    register_tool(
        '吧_新建',
        '把一个项目文件夹建成一个「吧」（一个文件夹 = 一个项目 = 一个吧）。'
        '吧名默认取文件夹名。已建过则直接返回旧的。',
        _S({'路径': _路径, '名称': {'type': 'string', 'description': '可选，自定义吧名'}},
           ['路径']),
        lambda a: _调服务端('吧_新建', a))

    register_tool(
        '吧_列表', '列出所有吧（含各自的帖数）。',
        _S({}), lambda a: _调服务端('吧_列表', a))

    register_tool(
        '帖_发布',
        '总管发布一张工单（1楼，写清楚工作内容）。帖名 = 工作内容简介。'
        '发之前建议先用「帖_检索」看有没有可复用的老帖。',
        _S({'吧': {'type': 'string', 'description': 'bid / 吧名 / 文件夹路径'},
            '标题': {'type': 'string', 'description': '帖名，工作内容的一个简介'},
            '内容': {'type': 'string', 'description': '1楼正文，写清楚要干什么'},
            '类型': {'type': 'string',
                   'description': '默认 TRae内部记录；另有 会话内部交流预留'}},
           ['吧', '标题', '内容']),
        lambda a: _调服务端('帖_发布', a))

    register_tool(
        '帖_检索',
        '总管派活前的复用检索：在本吧已有帖里搜相似且有延续性的工单。'
        '命中且「可复用」为真 → 用「帖_留言」在它后面追加奇数楼，不要新开帖。',
        _S({'关键词': {'type': 'string', 'description': '拿工作内容里的关键词来搜，空格分隔'},
            '吧': {'type': 'string', 'description': '可选，限定某个吧；不填搜全部'}},
           ['关键词']),
        lambda a: _调服务端('帖_检索', a))

    register_tool(
        '帖_留言',
        '总管追加一楼（落在奇数楼）：补充派活 / 回复子代理交稿 / 续接老帖。'
        '若下一楼是偶数楼（子代理的位子），服务端会拒绝：'
        '只想补充改内容请用「帖_改楼」；子代理被叫停请用「帖_代发叫停」。',
        _S({'tid': {'type': 'string', 'description': '帖号，如 T001'},
            '内容': {'type': 'string'}}, ['tid', '内容']),
        lambda a: _调服务端('帖_留言', a))

    register_tool(
        '帖_改楼',
        '总管就地修改自己那一楼（= 改原帖）：补充/改派活内容、改帖名。'
        '不占新楼层、不动奇偶。只要子代理还没回帖就能改；子代理一回复就锁住不许回头改'
        '（那时请用「帖_留言」发新的奇数楼）。改过的地方会留痕（已改N次）。',
        _S({'tid': {'type': 'string'},
            '内容': {'type': 'string', 'description': '这一楼的新正文（整段替换）'},
            '标题': {'type': 'string', 'description': '可选，顺手改帖名'},
            '楼层': {'type': 'integer', 'description': '可选，默认改自己最后一楼'}},
           ['tid']),
        lambda a: _调服务端('帖_改楼', a))

    register_tool(
        '帖_代发叫停',
        '子代理被叫停、来不及回帖时，总管替它补一个偶数楼（类别=代发叫停），'
        '写明简单原因，以维持奇偶不断。',
        _S({'tid': {'type': 'string'}, '原因': {'type': 'string', 'description': '叫停的简单原因'}},
           ['tid', '原因']),
        lambda a: _调服务端('帖_代发叫停', a))

    register_tool(
        '帖_终结',
        '总管终结一张帖：填原因（任务已完成 / 放弃任务 / 待命 / 转其他帖 / 其他），'
        '终结后封存不可再改。完成后请重新唤醒子代理读一次帖。',
        _S({'tid': {'type': 'string'}, '原因': {'type': 'string'}}, ['tid', '原因']),
        lambda a: _调服务端('帖_终结', a))

    register_tool(
        '帖_解锁',
        '总管应急解锁：帖被子代理占锁冻结后，确需改动时用它恢复活跃态。',
        _S({'tid': {'type': 'string'}}, ['tid']),
        lambda a: _调服务端('帖_解锁', a))

    register_tool(
        '帖_交稿',
        '子代理交稿（落在偶数楼）：总结自己做了什么。'
        '重要：请带上你读帖时看到的最后一个总管楼号（已处理至）；'
        '若总管有新留言，服务端会拒绝，要求你先处理完最新留言再回来交稿。',
        _S({'tid': {'type': 'string'},
            '内容': {'type': 'string', 'description': '总结本次完成的工作'},
            '已处理至': {'type': 'integer',
                      'description': '你读帖时看到的最后一个总管楼号（= 帖里的「总管最后一楼」）'},
            '占者': {'type': 'string', 'description': '默认 子代理，占锁后交最终稿时带上'}},
           ['tid', '内容']),
        lambda a: _调服务端('帖_交稿', a))

    register_tool(
        '帖_占锁',
        '子代理交最终稿前先占锁 → 整帖冻结，任何人（含总管）不能再改内容，'
        '只有持锁者能发最终交稿楼。',
        _S({'tid': {'type': 'string'},
            '占者': {'type': 'string', 'description': '默认 子代理'}}, ['tid']),
        lambda a: _调服务端('帖_占锁', a))

    register_tool(
        '帖_读', '读一整张帖（含全部楼层、名义发言人、状态、锁定/终结信息）。',
        _S({'tid': {'type': 'string'}}, ['tid']),
        lambda a: _调服务端('帖_读', a))

    register_tool(
        '帖_列表', '列帖（可按吧、按状态筛选：活跃 / 锁定 / 已终结 / 全部）。',
        _S({'吧': {'type': 'string', 'description': '可选'},
            '状态': {'type': 'string', 'description': '可选：活跃 / 锁定 / 已终结 / 全部'}}),
        lambda a: _调服务端('帖_列表', a))

    register_tool(
        '系统_状态', '看本系统状态：痕迹根、吧数、帖数、可用帖类型与终结原因。',
        _S({}), lambda a: _调服务端('系统_状态', a))


_注册全部()


# ========================== MCP 协议（stdio JSON-RPC 2.0） ==========================
_SERVER_INFO = {'name': '贴吧型派单系统-MCP', 'version': 模块版本}


def _send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()


def _error(req_id, code, message, data=None):
    err = {'code': code, 'message': message}
    if data is not None:
        err['data'] = data
    return {'jsonrpc': '2.0', 'id': req_id, 'error': err}


def _result(req_id, out):
    return {'jsonrpc': '2.0', 'id': req_id, 'result': out}


def _handle_initialize(_params):
    return {'protocolVersion': '2025-03-26',
            'capabilities': {'tools': {}},
            'serverInfo': _SERVER_INFO}


def _handle_tools_list(_params):
    return {'tools': [{'name': n, 'description': s['desc'], 'inputSchema': s['schema']}
                      for n, s in _TOOLS.items()]}


def _handle_tools_call(params):
    name = (params or {}).get('name')
    args = (params or {}).get('arguments') or {}
    spec = _TOOLS.get(name)
    if spec is None:
        return {'content': [{'type': 'text',
                             'text': '未知工具: %s（可用: %s）' % (name, '、'.join(_TOOLS))}],
                'isError': True}
    try:
        out = spec['handler'](args)
        return {'content': [{'type': 'text',
                             'text': json.dumps(out, ensure_ascii=False, indent=2)}],
                'isError': False}
    except Exception as e:
        return {'content': [{'type': 'text',
                             'text': '工具 %s 执行失败: %s' % (name, e)}],
                'isError': True}


_METHODS = {'initialize': _handle_initialize,
            'tools/list': _handle_tools_list,
            'tools/call': _handle_tools_call}


def _dispatch(req):
    req_id = req.get('id')
    method = req.get('method')
    if method in _METHODS:
        try:
            out = _METHODS[method](req.get('params'))
        except Exception as e:
            _send(_error(req_id, -32603, '内部错误: %s' % e))
            return
        if out is None:
            return
        _send(_result(req_id, out))
        return
    if method and method.startswith('notifications/'):
        return
    _send(_error(req_id, -32601, '方法未实现: %s' % method,
                 {'server': _SERVER_INFO, 'tools': list(_TOOLS)}))


# ========================== 人类可读渲染（CLI 用） ==========================
def _渲染(name, out):
    if isinstance(out, dict) and isinstance(out.get('帖'), dict) and '楼层' in out['帖']:
        帖 = out['帖']
        行 = ['帖%s  《%s》  [%s]  状态=%s'
              % (帖.get('tid'), 帖.get('标题'), 帖.get('类型'), 帖.get('状态')),
              '吧：%s   楼数：%s   下一楼：第%s楼（%s）'
              % (帖.get('吧名'), 帖.get('楼数'), 帖.get('下一楼'),
                 帖.get('下一楼名义发言人')),
              '-' * 52]
        for 楼 in 帖.get('楼层') or []:
            标 = '总管' if 楼.get('名义发言人') == '总管' else '子代理'
            代 = '' if 楼.get('实际发帖者') == 楼.get('名义发言人') \
                else '（%s代发）' % 楼.get('实际发帖者')
            改过 = len(楼.get('修改记录') or [])
            行.append('【第%s楼 · %s%s · %s·%s%s】'
                      % (楼.get('楼层'), 标, 代, 楼.get('类别'), 楼.get('时间'),
                         '（已改%d次）' % 改过 if 改过 else ''))
            行.append((楼.get('内容') or '').rstrip())
            行.append('')
        if 帖.get('锁定'):
            行.append('※ 已占锁：%s @%s' % (帖['锁定'].get('占者'), 帖['锁定'].get('时间')))
        if 帖.get('终结'):
            行.append('※ 已终结：%s（%s）' % (帖['终结'].get('原因'),
                                            帖['终结'].get('时间')))
        for k in ('说明', '下一步', '落在楼层', '改的楼层', '改了', '原占者'):
            if out.get(k):
                行.append('%s：%s' % (k, out[k]))
        return '\n'.join(行)
    if isinstance(out, dict) and isinstance(out.get('帖'), list):
        行 = ['%s：%s' % (k, out[k]) for k in ('数量', '命中数', '关键词', '状态筛选')
              if k in out]
        for t in out['帖']:
            行.append('  %s 《%s》 [%s] %s 楼数=%s 更新=%s%s'
                      % (t.get('tid'), t.get('标题'), t.get('类型'), t.get('状态'),
                         t.get('楼数'), t.get('更新时间'),
                         '  可复用' if t.get('可复用') else ''))
        if out.get('提示'):
            行.append('提示：%s' % out['提示'])
        return '\n'.join(行) or '(空)'
    if isinstance(out, dict) and isinstance(out.get('吧'), list):
        行 = ['吧数：%s' % out.get('数量')]
        for b in out['吧']:
            行.append('  %s  %s  帖数=%s\n      %s'
                      % (b.get('bid'), b.get('名称'), b.get('帖数'), b.get('路径')))
        return '\n'.join(行)
    return json.dumps(out, ensure_ascii=False, indent=2)


# ========================== CLI 入口 ==========================
def _cli_help():
    print('用法: py 贴吧MCP服务.py cli <工具名> [--参数 值] ...')
    print('可用工具:')
    for n, s in _TOOLS.items():
        print('  %s — %s' % (n, s['desc']))
    print('示例:')
    print('  py 贴吧MCP服务.py cli 吧_新建 --路径 "D:\\网络硬盘\\wps云盘\\脚本备份\\工作台"')
    print('  py 贴吧MCP服务.py cli 帖_发布 --吧 工作台 --标题 "写个延时排班器" --内容 "……"')
    print('  py 贴吧MCP服务.py cli 帖_读 --tid T001')
    print('  py 贴吧MCP服务.py cli 帖_交稿 --tid T001 --内容 "做完了" --已处理至 1')


def _cli_main(argv):
    if not argv:
        _cli_help()
        return 0
    name = argv[0]
    if name not in _TOOLS:
        print('未知工具: %s' % name)
        _cli_help()
        return 2
    arg, rest, i = {}, argv[1:], 0
    while i < len(rest):
        tok = rest[i]
        if tok.startswith('--'):
            key = tok[2:]
            if i + 1 < len(rest) and not rest[i + 1].startswith('--'):
                arg[key] = rest[i + 1]
                i += 2
            else:
                arg[key] = ''
                i += 1
        else:
            i += 1
    if str(arg.get('已处理至', '')).isdigit():
        arg['已处理至'] = int(arg['已处理至'])
    try:
        out = _TOOLS[name]['handler'](arg)
        print(_渲染(name, out))
        return 0
    except Exception as e:
        print('执行失败: %s' % e)
        return 1


def main():
    for _st in ('stdout', 'stderr', 'stdin'):
        try:
            getattr(sys, _st).reconfigure(encoding='utf-8')
        except Exception:
            pass
    if len(sys.argv) >= 2 and sys.argv[1] == 'cli':
        sys.exit(_cli_main(sys.argv[2:]))
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            _send({'jsonrpc': '2.0', 'id': None,
                   'error': {'code': -32700, 'message': '解析错误: JSON 格式非法'}})
            continue
        if not isinstance(req, dict):
            _send({'jsonrpc': '2.0', 'id': None,
                   'error': {'code': -32600, 'message': '请求非法'}})
            continue
        _dispatch(req)


if __name__ == '__main__':
    main()