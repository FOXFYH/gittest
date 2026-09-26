# -*- coding: utf-8 -*-
"""贴吧型派单系统 · 本机服务端

起一个投递口 TCP 0.0.0.0:19885，一行一条 JSON：
  请求  {"id":1,"cmd":"帖_发布","arg":{...}}
  响应  {"ok":true,"data":{...}}  或  {"ok":false,"error":"..."}

默认绑 0.0.0.0（这样同一 WiFi 的手机能直接开网页看贴吧）；
只想本机用就加 --仅本机（或环境变量 TIEBA_LOCAL_ONLY=1）。

为什么要有它：写入唯一方。MCP 壳、CLI、以后网页门面都只是它的客户端，
这样多入口同时来（AI + 网页 + 其他电脑）也不会把 JSON 写坏。

端口沿用项目约定 19885（TRAE 工具占 19876，避开）。
（网页门面 / WebSocket 桥为后续期，本版只保留命令分发表这一层钩子。）

用法：
    py 贴吧服务端.py            # 前台运行（Ctrl+C 退出）
    py 贴吧服务端.py --port 19885
"""

import os
import sys
import json
import time
import socket
import socketserver
import traceback
from urllib.parse import urlparse, parse_qs, unquote

_这里 = os.path.dirname(os.path.abspath(__file__))
if _这里 not in sys.path:
    sys.path.insert(0, _这里)

import 贴吧核心 as 核心模块            # noqa: E402
from 贴吧核心 import 贴吧错误, 智能定位痕迹根   # noqa: E402

模块版本 = '0.1.0'
默认端口 = 19885

核心 = None            # 进程级单例，所有请求共用（核心内部自带写锁）


# ============================ 命令分发表 ============================
# 每个命令 = 一个 lambda(args:dict) -> 可 JSON 序列化的结果
# 加新能力：往这里加一行即可，别处不动。
def _分发表():
    def 必填(a, k):
        v = a.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            raise 贴吧错误('缺少必填参数：%s' % k)
        return v

    return {
        # ---- 吧 ----
        '吧_新建': lambda a: 核心.建吧(必填(a, '路径'), a.get('名称')),
        '吧_列表': lambda a: 核心.列吧(),
        # ---- 帖 · 总管 ----
        '帖_发布': lambda a: 核心.发帖(a.get('吧'), 必填(a, '标题'),
                                     必填(a, '内容'),
                                     a.get('类型') or 'TRae内部记录'),
        '帖_检索': lambda a: 核心.检索帖(必填(a, '关键词'), a.get('吧')),
        '帖_留言': lambda a: 核心.留言(必填(a, 'tid'), 必填(a, '内容')),
        '帖_改楼': lambda a: 核心.改楼(必填(a, 'tid'), a.get('内容'), a.get('标题'),
                                     a.get('楼层')),
        '帖_代发叫停': lambda a: 核心.代发叫停(必填(a, 'tid'), 必填(a, '原因')),
        '帖_终结': lambda a: 核心.终结(必填(a, 'tid'), 必填(a, '原因'),
                                     a.get('操作者') or '总管'),
        '帖_解锁': lambda a: 核心.解锁(必填(a, 'tid'), a.get('操作者') or '总管'),
        # ---- 帖 · 子代理 ----
        '帖_交稿': lambda a: 核心.交稿(必填(a, 'tid'), 必填(a, '内容'),
                                     a.get('已处理至') or 0,
                                     a.get('占者') or '子代理'),
        '帖_占锁': lambda a: 核心.占锁(必填(a, 'tid'), a.get('占者') or '子代理'),
        # ---- 读 ----
        '帖_读': lambda a: 核心.读帖(必填(a, 'tid')),
        '帖_列表': lambda a: 核心.列帖(a.get('吧'), a.get('状态')),
        # ---- 系统 ----
        '系统_状态': lambda a: 核心.系统状态(),
    }


分发 = None      # 延迟构建（核心要先就位）


def 执行命令(cmd, arg):
    if 分发 is None:
        raise 贴吧错误('服务端尚未就绪')
    fn = 分发.get(cmd)
    if fn is None:
        raise 贴吧错误('未知命令：%s（可用：%s）' % (cmd, '、'.join(分发)))
    return fn(arg if isinstance(arg, dict) else {})


# ============================ 投递口（TCP 命令行 + HTTP 网站 同端口） ============================
_网页文件名 = '贴吧网页.html'

_HTTP原因 = {200: 'OK', 204: 'No Content', 400: 'Bad Request',
            404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error'}


def _执行(cmd, arg):
    """统一执行入口：无论从 TCP 来的还是从 HTTP 网页来的，都走这里。"""
    try:
        data = 执行命令(str(cmd), arg)
        return {'ok': True, 'data': data}
    except 贴吧错误 as e:
        return {'ok': False, 'error': str(e)}
    except Exception as e:
        return {'ok': False, 'error': '服务端内部错误：%s' % e,
                'trace': traceback.format_exc()[-800:]}


class 投递处理(socketserver.StreamRequestHandler):
    """同一个端口两种入口，靠首行内容自动分流：

      · 首行是 "GET /…" / "POST /…"  → 当 HTTP 处理（网页门面 / 网页调 /api）
      · 首行是 JSON（{...}）          → 当 TCP 命令行处理（MCP / CLI）

    异常一律兜底成可读错误，绝不崩进程。
    """

    def handle(self):
        try:
            首行 = self.rfile.readline(1024 * 1024)
        except Exception:
            return
        if not 首行:
            return
        文本 = 首行.decode('utf-8', 'replace').strip()
        if not 文本:
            return
        if 文本[:4] in ('GET ', 'POST', 'HEAD', 'PUT ', 'OPTI'):
            try:
                self._处理HTTP(文本)
            except Exception:
                pass
            return
        self._处理JSON行(首行)

    # ---------- 入口一：TCP 一行一 JSON ----------
    def _处理JSON行(self, 首行):
        try:
            req = json.loads(首行.decode('utf-8'))
            if not isinstance(req, dict):
                raise 贴吧错误('请求必须是 JSON 对象')
            cmd = req.get('cmd')
            if not cmd:
                raise 贴吧错误('请求缺少 cmd')
            回 = _执行(cmd, req.get('arg'))
            回['id'] = req.get('id')
        except 贴吧错误 as e:
            回 = {'ok': False, 'error': str(e)}
        except Exception as e:
            回 = {'ok': False, 'error': '服务端内部错误：%s' % e,
                  'trace': traceback.format_exc()[-800:]}
        self._回写((json.dumps(回, ensure_ascii=False) + '\n').encode('utf-8'))

    # ---------- 入口二：HTTP ----------
    def _处理HTTP(self, 请求行):
        头 = {}
        while True:
            line = self.rfile.readline(65536)
            if not line or not line.strip():
                break
            t = line.decode('utf-8', 'replace').strip()
            if ':' in t:
                k, v = t.split(':', 1)
                头[k.strip().lower()] = v.strip()
        try:
            n = int(头.get('content-length') or 0)
        except Exception:
            n = 0
        体 = self.rfile.read(n) if n > 0 else b''

        段 = 请求行.split(' ')
        方法 = (段[0] or 'GET').upper() if 段 else 'GET'
        原始 = 段[1] if len(段) > 1 else '/'
        u = urlparse(原始)
        路径 = unquote(u.path)
        查询 = parse_qs(u.query)

        if 方法 == 'OPTIONS':
            return self._回HTTP(204, 'text/plain; charset=utf-8', b'')

        if 路径 in ('/', '/index.html', '/' + _网页文件名):
            html = _读网页()
            if html is None:
                return self._回HTTP(404, 'text/plain; charset=utf-8',
                                   ('没找到 %s（应与本服务端放同一目录）'
                                    % _网页文件名).encode('utf-8'))
            return self._回HTTP(200, 'text/html; charset=utf-8', html)

        if 路径 == '/api':
            cmd, arg = None, {}
            if 方法 == 'POST' and 体:
                try:
                    d = json.loads(体.decode('utf-8'))
                    cmd, arg = d.get('cmd'), (d.get('arg') or {})
                except Exception as e:
                    return self._回JSON({'ok': False, 'error': 'JSON 解析失败：%s' % e})
            else:
                cmd = (查询.get('cmd') or [''])[0]
                a = (查询.get('arg') or [''])[0]
                if a:
                    try:
                        arg = json.loads(a)
                    except Exception:
                        arg = {}
            if not cmd:
                return self._回JSON({'ok': False, 'error': '缺少 cmd'})
            return self._回JSON(_执行(cmd, arg))

        return self._回HTTP(404, 'text/plain; charset=utf-8', b'not found')

    def _回写(self, 字节):
        try:
            self.wfile.write(字节)
        except Exception:
            pass

    def _回HTTP(self, code, ctype, body):
        head = ('HTTP/1.1 %d %s\r\n'
                'Content-Type: %s\r\n'
                'Content-Length: %d\r\n'
                'Access-Control-Allow-Origin: *\r\n'
                'Access-Control-Allow-Headers: Content-Type\r\n'
                'Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
                'Cache-Control: no-store\r\n'
                'Connection: close\r\n\r\n'
                % (code, _HTTP原因.get(code, 'OK'), ctype, len(body)))
        self._回写(head.encode('utf-8') + body)

    def _回JSON(self, obj):
        self._回HTTP(200, 'application/json; charset=utf-8',
                     json.dumps(obj, ensure_ascii=False).encode('utf-8'))


def _读网页():
    """每次现读盘 —— 改网页不用重启服务端（开发期最省事）。"""
    p = os.path.join(_这里, _网页文件名)
    try:
        with open(p, 'rb') as f:
            return f.read()
    except Exception:
        return None


class 投递口(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def 起服务(端口, 绑定='0.0.0.0'):
    global 核心, 分发
    核心 = 核心模块.贴吧核心()
    分发 = _分发表()
    try:
        srv = 投递口((绑定, 端口), 投递处理)
    except OSError as e:
        print('× 端口 %d 起不来：%s' % (端口, e))
        print('  多半是已经有一个「贴吧服务端」在跑了 —— 直接用它即可。')
        return 2
    print('=' * 56)
    print('贴吧型派单系统 · 本机服务端 v%s' % 模块版本)
    print('投递口   : %s:%d（MCP/CLI 的 JSON 命令走这里）' % (绑定, 端口))
    print('网页门面 : http://127.0.0.1:%d/  （本机浏览器打开即可看贴吧）' % 端口)
    if 绑定 != '127.0.0.1':
        for ip in _本机局域网地址们():
            print('手机访问 : http://%s:%d/  （同一 WiFi/局域网内，手机浏览器直接开）'
                  % (ip, 端口))
    print('痕迹根   : %s' % 核心.根)
    print('可用命令 : %s' % '、'.join(分发))
    print('=' * 56)
    try:
        核心._写日志('服务端', '启动 %s:%d' % (绑定, 端口))
    except Exception:
        pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n收到退出信号，服务端关闭。')
    finally:
        srv.server_close()
    return 0


def _本机局域网地址们():
    """列出本机可用于局域网访问的 IPv4（给手机看的网址）。纯标准库，失败就返回空。"""
    出 = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if (ip not in 出 and not ip.startswith('127.')
                    and not ip.startswith('169.254.')):   # 跳过回环与自动配置地址
                出.append(ip)
    except Exception:
        pass
    if not 出:
        try:                      # 兜底：开个 UDP 探一下默认出口网卡的地址
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            出.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    return 出


def _取绑定():
    """默认绑 0.0.0.0（手机才能连）；加 --仅本机 或 TIEBA_LOCAL_ONLY=1 只绑 127.0.0.1。"""
    if '--仅本机' in sys.argv[1:]:
        return '127.0.0.1'
    if (os.environ.get('TIEBA_LOCAL_ONLY') or '').strip() in ('1', 'true', 'yes'):
        return '127.0.0.1'
    return '0.0.0.0'


def _取端口():
    argv = sys.argv[1:]
    for i, t in enumerate(argv):
        if t == '--port' and i + 1 < len(argv) and argv[i + 1].isdigit():
            return int(argv[i + 1])
    env = (os.environ.get('TIEBA_PORT') or '').strip()
    if env.isdigit():
        return int(env)
    return 默认端口


def main():
    for _st in ('stdout', 'stderr'):
        try:
            getattr(sys, _st).reconfigure(encoding='utf-8')
        except Exception:
            pass
    # 端口占用自查：能连上说明已有一个在跑，直接提示复用，不重复起
    p = _取端口()
    try:
        s = socket.create_connection(('127.0.0.1', p), timeout=1)
        s.close()
        print('端口 %d 已有服务在跑（很可能是另一个「贴吧服务端」），无需重复启动。' % p)
        return 0
    except Exception:
        pass
    return 起服务(p, _取绑定())


if __name__ == '__main__':
    sys.exit(main())