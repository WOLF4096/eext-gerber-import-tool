#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地调试服务器（只用于开发，不进扩展包 —— /tools/ 已在 .edaignore 里排除）

为什么需要它：
  · `iframe/ImportGerber.html` 里的资源全部是绝对路径 `/iframe/...`，
    所以必须以「项目根目录」为站点根来提供，直接把 html 拖进浏览器会全是 404；
  · 页面大量调用 `eda.*`（sys_Message / sys_Environment / sys_IFrame …），
    脱离嘉立创EDA 打开会直接抛错。这里在 HTML 里注入一个最小的 eda mock，
    于是普通浏览器里也能完整点开界面、拖 Gerber 进来调试。

用法：
    python tools/serve.py                    # http://127.0.0.1:8456/iframe/ImportGerber.html
    python tools/serve.py --port 9000
    python tools/serve.py --no-reload        # 关掉自动刷新
    python tools/serve.py --no-mock          # 注入 mock（默认注入）
  URL 参数：
    ?ver=4.1.78   模拟不同 EDA 版本（首字符 2→pro_v2 / 3→pro_v3 / 4→pro_v4）
    ?nomock=1     本次不给 eda mock（想看真实环境的报错时用）
    ?reload=0     本次不注入自动刷新

自动刷新：监听 iframe/ 下 *.html / *.js / *.css 的 mtime，改动后浏览器自动 reload。
注意：直接改文件即生效，不需要重启服务。
"""
import argparse
import os
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # 项目根 = tools/ 的上一级

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.map': 'application/json; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/plain; charset=utf-8',
}

# ---------------------------------------------------------------- eda mock ----
MOCK_JS = r"""
/* 最小 eda mock：只为在普通浏览器里跑通界面，不实现任何编辑器能力。 */
(function () {
    if (window.eda) return;
    var qs = new URLSearchParams(location.search);
    var ver = qs.get('ver') || '3.0.0';

    function toast(msg, type) {
        var box = document.getElementById('__dev_toast');
        if (!box) {
            box = document.createElement('div');
            box.id = '__dev_toast';
            box.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);' +
                'background:#2a2a2e;color:#eee;border:1px solid #555;border-radius:6px;' +
                'padding:8px 14px;font:12px/1.5 Consolas,monospace;z-index:999999;max-width:70%;' +
                'box-shadow:0 4px 16px rgba(0,0,0,.5);white-space:pre-wrap;';
            document.body.appendChild(box);
        }
        box.textContent = String(msg);
        box.style.display = 'block';
        clearTimeout(box.__t);
        box.__t = setTimeout(function () { box.style.display = 'none'; }, 4000);
    }

    var real = {
        sys_Message: {
            showToastMessage: function (msg, type, sec) { toast(msg, type); },
            showMessageBox: function (msg) { console.log('[eda.showMessageBox]', msg); },
            showConfirmDialog: function () { return Promise.resolve(true); }
        },
        sys_Environment: {
            getEditorCurrentVersion: function () { return ver; },
            getAppVersion: function () { return '1.0.0'; }
        },
        sys_IFrame: {
            openIFrame: function (url) { console.log('[eda.openIFrame]', url); },
            closeIFrame: function () { }
        },
        sys_FileSystem: {
            getExtensionFile: function () { return Promise.reject(new Error('dev mock')); }
        }
    };

    // 其余接口一律返回「可调用、可继续取属性」的代理，避免 undefined 报错
    function stub(name) {
        var fn = function () { return undefined; };
        return new Proxy(fn, {
            get: function (t, k) {
                if (k === 'then') return undefined;          // 别被当成 thenable
                if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return function () { return '[eda.' + name + ']'; };
                return stub(name + '.' + String(k));
            },
            apply: function () { return undefined; }
        });
    }

    function wrap(obj, path) {
        return new Proxy(obj, {
            get: function (t, k) {
                if (k === 'then') return undefined;
                if (k in t) return t[k];
                return stub((path ? path + '.' : '') + String(k));
            }
        });
    }

    window.eda = wrap(real, '');
    console.log('%c[dev] eda mock 已注入，模拟版本 ' + ver, 'color:#4caf50');
})();
"""

RELOAD_JS = r"""
/* 自动刷新：监听服务端的文件变更事件 */
(function () {
    if (!window.EventSource) return;
    try {
        var es = new EventSource('/__dev/reload');
        es.onmessage = function (e) {
            if (e.data === 'reload') { console.log('[dev] 文件已改动，自动刷新'); location.reload(); }
        };
    } catch (err) { /* 忽略 */ }
})();
"""

# -------------------------------------------------------------- 文件变更监听 ----
class Watcher(threading.Thread):
    """轮询 iframe/ 下 html/js/css 的 mtime，变化后通知所有 SSE 客户端。"""

    def __init__(self, root, interval=0.6):
        super().__init__(daemon=True)
        self.root = os.path.join(root, 'iframe')
        self.interval = interval
        self.clients = []
        self.lock = threading.Lock()
        self.stop_flag = threading.Event()

    def snapshot(self):
        snap = {}
        for dirpath, _dirnames, filenames in os.walk(self.root):
            for name in filenames:
                if not name.lower().endswith(('.html', '.htm', '.js', '.css')):
                    continue
                p = os.path.join(dirpath, name)
                try:
                    st = os.stat(p)
                except OSError:
                    continue
                snap[p] = (st.st_mtime_ns, st.st_size)
        return snap

    def add(self, wfile):
        with self.lock:
            self.clients.append(wfile)

    def remove(self, wfile):
        with self.lock:
            if wfile in self.clients:
                self.clients.remove(wfile)

    def broadcast(self):
        dead = []
        with self.lock:
            for w in self.clients:
                try:
                    w.write(b'data: reload\n\n')
                    w.flush()
                except Exception:
                    dead.append(w)
            for w in dead:
                self.clients.remove(w)

    def run(self):
        prev = self.snapshot()
        while not self.stop_flag.wait(self.interval):
            cur = self.snapshot()
            if cur != prev:
                changed = [os.path.basename(k) for k in cur if prev.get(k) != cur.get(k)]
                print('  ~ 变更：' + ', '.join(changed[:5]) + (' …' if len(changed) > 5 else ''))
                prev = cur
                self.broadcast()


WATCHER = None

# ------------------------------------------------------------------- handler ----
class DevHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'gerber-dev/1.0'

    def __init__(self, *args, root=ROOT, use_mock=True, use_reload=True, **kwargs):
        self.site_root = root
        self.use_mock = use_mock
        self.use_reload = use_reload
        super().__init__(*args, directory=root, **kwargs)

    # -- 工具 --
    def _send_bytes(self, body, ctype, code=200, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()

    # -- 路由 --
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == '/':
            return self._redirect('/iframe/ImportGerber.html')

        if path == '/__dev/eda-mock.js':
            return self._send_bytes(MOCK_JS.encode('utf-8'), 'application/javascript; charset=utf-8')

        if path == '/__dev/reload.js':
            return self._send_bytes(RELOAD_JS.encode('utf-8'), 'application/javascript; charset=utf-8')

        if path == '/__dev/reload':
            return self._sse()

        # 浏览器标签图标：有 logo 就发 logo，避免控制台一直挂一条 404 干扰调试
        if path == '/favicon.ico':
            logo = os.path.join(self.site_root, 'images', 'logo.png')
            if os.path.isfile(logo):
                with open(logo, 'rb') as f:
                    return self._send_bytes(f.read(), 'image/png')
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return

        # 静态文件
        fs_path = self._resolve(path)
        if fs_path is None:
            return self._send_bytes(b'404', 'text/plain; charset=utf-8', 404)
        if os.path.isdir(fs_path):
            index = os.path.join(fs_path, 'index.html')
            if os.path.isfile(index):
                fs_path = index
            else:
                return self._send_bytes(b'404 (directory)', 'text/plain; charset=utf-8', 404)

        ext = os.path.splitext(fs_path)[1].lower()
        ctype = MIME.get(ext) or 'application/octet-stream'

        try:
            with open(fs_path, 'rb') as f:
                body = f.read()
        except OSError:
            return self._send_bytes(b'404', 'text/plain; charset=utf-8', 404)

        if ext in ('.html', '.htm'):
            body = self._inject(body, qs)
            ctype = MIME['.html']

        return self._send_bytes(body, ctype)

    def do_HEAD(self):
        self.do_GET()

    # -- 内部 --
    def _resolve(self, url_path):
        rel = url_path.lstrip('/')
        full = os.path.normpath(os.path.join(self.site_root, rel))
        if not full.startswith(self.site_root):
            return None
        return full

    def _inject(self, html_bytes, qs):
        """在 </head> 前插入 mock / 自动刷新脚本（可通过 URL 参数关掉）。"""
        text = html_bytes.decode('utf-8-sig', errors='replace')
        tags = []
        if self.use_mock and qs.get('nomock', ['0'])[0] != '1':
            tags.append('<script src="/__dev/eda-mock.js"></script>')
        if self.use_reload and qs.get('reload', ['1'])[0] != '0':
            tags.append('<script src="/__dev/reload.js"></script>')
        if not tags:
            return html_bytes
        block = '\n\t' + '\n\t'.join(tags) + '\n'
        marker = '</head>'
        idx = text.lower().find(marker)
        if idx < 0:
            text = block + text
        else:
            text = text[:idx] + block + text[idx:]
        # 原始 html 没有 BOM；这里统一按 UTF-8 输出（服务端已声明 charset）
        return text.encode('utf-8')

    def _sse(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(b'retry: 1000\n\n')
            self.wfile.flush()
            if WATCHER:
                WATCHER.add(self.wfile)
            while True:
                time.sleep(10)
                self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except Exception:
            pass
        finally:
            if WATCHER:
                WATCHER.remove(self.wfile)

    def log_message(self, fmt, *args):
        # 只报非静态资源的动作 + 错误，避免刷屏
        msg = fmt % args
        if '"GET /__dev/reload' in msg or ' 304 ' in msg:
            return
        print('  ' + msg)


def port_free(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


def main():
    ap = argparse.ArgumentParser(description='Gerber 扩展前端调试服务器')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8456)
    ap.add_argument('--root', default=ROOT, help='站点根目录（默认项目根）')
    ap.add_argument('--no-mock', action='store_true', help='不注入 eda mock')
    ap.add_argument('--no-reload', action='store_true', help='不注入自动刷新')
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isfile(os.path.join(root, 'iframe', 'ImportGerber.html')):
        print('✗ 站点根下找不到 iframe/ImportGerber.html：%s' % root)
        return 2

    if not port_free(args.host, args.port):
        print('✗ 端口 %d 已被占用（可能已经有一个本服务在跑）' % args.port)
        return 1

    global WATCHER
    if not args.no_reload:
        WATCHER = Watcher(root)
        WATCHER.start()

    handler = lambda *a, **kw: DevHandler(*a, root=root,
                                          use_mock=not args.no_mock,
                                          use_reload=not args.no_reload, **kw)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    httpd.daemon_threads = True

    print('站点根：%s' % root)
    print('打开：http://%s:%d/iframe/ImportGerber.html' % (args.host, args.port))
    print('eda mock：%s   自动刷新：%s' % ('关' if args.no_mock else '开',
                                          '关' if args.no_reload else '开（监听 iframe/*.js|css|html）'))
    print('Ctrl+C 结束\n')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止')
    finally:
        if WATCHER:
            WATCHER.stop_flag.set()
        httpd.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
