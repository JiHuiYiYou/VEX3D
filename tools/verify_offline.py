"""PWA 离线能力的端到端测试。

做的是**真的**断网（Playwright 的 `setOffline`），不是模拟：
先联网访问一次让 service worker 把外壳和资产缓存下来，
然后**切断网络**重新打开，检查：
  · 还能打开（没有「没有 CAD 场地资产」那张报错页）
  · 场地画出来了
  · 摆场能用
  · 摆件能用、计分板有反应

    C:/Users/liuzhen/miniconda3/python.exe tools/verify_offline.py
    C:/Users/liuzhen/miniconda3/python.exe tools/verify_offline.py --url http://127.0.0.1:8023/

⚠️ 要测**生产构建**（service worker 只在生产构建注册）：
先 `npm run build`，再用一个静态服务器伺服 `dist/`。
本脚本自己会起一个（tools/serve_range.py，跟 CDN 一样支持 Range）。
"""

import argparse
import os
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8023
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=None, help="要测的网址（默认自己起一个静态服务器）")
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()

    server = None
    url = args.url
    if not url:
        if not os.path.isdir(os.path.join(ROOT, "dist")):
            print("没有 dist/ —— 先跑 npm run build")
            return 2
        server = subprocess.Popen(
            [
                sys.executable,
                os.path.join(ROOT, "tools", "serve_range.py"),
                str(PORT),
                "dist",
            ],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(2)
        url = f"http://127.0.0.1:{PORT}/?quality=low&debug=1"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(viewport={"width": 1280, "height": 760})
            page = ctx.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=120000)

            # 等缓存稳定（service worker 接管 → 资产陆续进缓存）
            prev, stable, n = -1, 0, 0
            for _ in range(60):
                time.sleep(2)
                n = page.evaluate(
                    """async () => { let n = 0;
                        for (const k of await caches.keys())
                          n += (await (await caches.open(k)).keys()).length;
                        return n; }"""
                )
                stable = stable + 1 if n == prev else 0
                prev = n
                if n >= 10 and stable >= 3:
                    break
            check("联网首访后缓存里有东西", n >= 10, f"{n} 条")

            # ★ 断网
            print("→ 断网，重新打开…")
            ctx.set_offline(True)
            page.reload(wait_until="domcontentloaded", timeout=120000)
            time.sleep(12)
            st = page.evaluate(
                """() => {
                  const e = document.querySelector('.boot-error-msg');
                  const b = window.__bridge;
                  let meshes = 0;
                  if (b && b.scene) b.scene.traverse((o) => { if (o.isMesh) meshes++; });
                  return { err: e ? e.textContent : null, meshes };
                }"""
            )
            check("断网后能打开（没有报错页）", not st["err"], st["err"] or "")
            check("场地画出来了", st["meshes"] > 20, f"{st['meshes']} 个 mesh")

            # 摆场
            page.locator(".topbar button", has_text="摆场").click()
            time.sleep(20)
            setup = page.evaluate(
                """() => { const s = window.__vex3d.getState();
                   return { loose: s.loose.length,
                            stacks: Object.values(s.stacks).flat().length }; }"""
            )
            check("摆场能用", setup["loose"] == 114 and setup["stacks"] == 5, str(setup))

            # 摆件 + 计分
            page.evaluate("() => window.__vex3d.getState().selectGoal('g-r1')")
            time.sleep(1)
            page.locator(".palette-item").first.click()
            time.sleep(2)
            placed = page.evaluate(
                """() => { const s = window.__vex3d.getState();
                   return { n: (s.stacks['g-r1'] || []).length, pending: !!s.pending }; }"""
            )
            check("断网时也能摆件", placed["n"] == 1, str(placed))
            score = page.evaluate("() => document.querySelectorAll('.half-row').length")
            check("计分板有条目", score >= 1, f"{score} 行")

            ctx.set_offline(False)
            browser.close()
    finally:
        if server:
            server.terminate()

    passed = sum(results)
    print(f"\n{passed}/{len(results)} 通过")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
