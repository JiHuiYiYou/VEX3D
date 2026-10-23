"""一个**真的支持 Range** 的静态服务器（用来复现 CDN 的行为）。

标准库的 http.server 不处理 Range（直接返回完整 200），
GitHub Pages 之类的 CDN 会**正确**处理 Range：请求 `bytes=0-0` 就只给 1 字节 + 206。
这两者的差别会让「先 Range 探大小、再整取」的代码在 CDN 上翻车
（见 src/scene/assets.ts 的 remoteSize）。

`--flaky N` 还能**模拟下载中断**：前 N 次下载 glb 会「回一个截断的响应」
（content-length 说整个文件大小，但只写一半就断线）—— 真实的弱网就是这样，
用来验证 app 的重试逻辑（`loadGlb` 会重试 3 次）。

    C:/Users/liuzhen/miniconda3/python.exe tools/serve_range.py [port] [dir] [--flaky N]
"""

import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")

# 前 N 次「整取」要掐断（模拟弱网下载中断）
FLAKY_LEFT = 0
SEEN = 0


class RangeHandler(SimpleHTTPRequestHandler):
    """按 Range 头返回 206（部分内容），其余情况返回完整 200。"""

    def do_GET(self):  # noqa: N802
        global SEEN, FLAKY_LEFT
        rng = self.headers.get("Range")
        if not rng:
            path = self.translate_path(self.path)
            if FLAKY_LEFT > 0 and path.endswith(".glb") and os.path.isfile(path):
                FLAKY_LEFT -= 1
                SEEN += 1
                return self._truncated(path)
            return super().do_GET()
        m = RANGE_RE.match(rng)
        if not m:
            return super().do_GET()

        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else 0
        end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        length = end - start + 1

        with open(path, "rb") as f:
            f.seek(start)
            data = f.read(length)

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        self.wfile.write(data)

    def _truncated(self, path: str):
        """回一个「只写了一半就断线」的响应（浏览器会当成下载失败）"""
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            data = f.read(max(1, size // 2))
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Length", str(size))  # 说好的完整大小
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()
        self.close_connection = True  # 然后就断线 → 浏览器看到「传了一半」

    def end_headers(self):
        # 跟 CDN 一样给个 max-age（浏览器会缓存 206 —— 这正是问题的一半）
        self.send_header("Cache-Control", "max-age=600")
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    global FLAKY_LEFT
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flaky = 0
    for a in sys.argv[1:]:
        if a.startswith("--flaky"):
            flaky = int(a.split("=", 1)[1]) if "=" in a else int(sys.argv[sys.argv.index(a) + 1])
    FLAKY_LEFT = flaky
    port = int(args[0]) if len(args) > 0 else 8000
    root = args[1] if len(args) > 1 else "dist"
    os.chdir(root)
    srv = ThreadingHTTPServer(("127.0.0.1", port), RangeHandler)
    print(f"serving {os.getcwd()} on http://127.0.0.1:{port} (支持 Range, flaky={flaky})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
