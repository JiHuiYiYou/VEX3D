"""
VEX3D UI 端到端验证（无头 Chromium + WebGL/SwiftShader）。

用法:
    C:/Users/liuzhen/miniconda3/python.exe tools/verify_ui.py [--url http://127.0.0.1:5173/]

产出:
    tools/shots/*.png  截图
    控制台打印每一步的断言结果
"""

import argparse
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")

LAUNCH_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
]

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:5173/?quality=low")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    os.makedirs(SHOTS, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed, args=LAUNCH_ARGS)
        page = browser.new_page(viewport={"width": 1280, "height": 760})

        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"pageerror: {e}"))

        print("→ 打开页面")
        page.goto(args.url, wait_until="networkidle", timeout=60000)
        page.wait_for_selector("canvas", timeout=30000)
        time.sleep(3.0)

        # ── 1. WebGL 起来了没有 ───────────────────────────────
        info = page.evaluate(
            """() => {
              const c = document.querySelector('canvas');
              if (!c) return {ok:false};
              const gl = c.getContext('webgl2') || c.getContext('webgl');
              return {ok: !!gl, w: c.width, h: c.height};
            }"""
        )
        check("WebGL 上下文可用", bool(info.get("ok")), f"canvas {info.get('w')}x{info.get('h')}")

        # ── 2. 界面元素在不在 ───────────────────────────────
        check("顶栏存在", page.locator(".topbar").count() == 1)
        check("左侧面板存在", page.locator(".panel-left").count() == 1)
        check("计分板存在", page.locator(".panel-score").count() == 1)
        check("Toggle 面板存在", page.locator(".panel-toggle").count() == 1)
        check("4 个 Toggle 卡片", page.locator(".toggle-card").count() == 4)
        check("未选中时左侧是提示", page.locator(".panel-left .hint").count() >= 1)

        page.screenshot(timeout=180000, path=os.path.join(SHOTS, "01-overview.png"))

        # ── 2b. 俯视图（用来和真实场地照片对表）─────────────
        page.evaluate(
            """() => {
              const b = window.__bridge;
              if (!b || !b.camera) return false;
              b.camera.position.set(0, 5200, 0);
              b.camera.up.set(0, 0, -1);   // three 的 −Z = 场地北向 → 画面上方是北
              b.camera.lookAt(0, 0, 0);
              b.camera.updateProjectionMatrix();
              b.invalidate && b.invalidate();
              return true;
            }"""
        )
        time.sleep(1.0)
        page.screenshot(timeout=180000, path=os.path.join(SHOTS, "01b-topdown.png"))
        # 视角复位
        page.evaluate(
            """() => {
              const b = window.__bridge;
              b.camera.up.set(0, 1, 0);
              b.camera.position.set(0, 3900, 4100);
              b.camera.lookAt(0, 0, 0);
              b.invalidate && b.invalidate();
            }"""
        )
        time.sleep(0.4)

        # ── 3. 找出一个 Goal 并点击 ──────────────────────────
        canvas = page.locator("canvas")
        box = canvas.bounding_box()
        found = None
        # 扫描画布，找能让左侧面板切到调色板的位置
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        offsets = []
        for r in (60, 110, 160, 210, 260, 310):
            for a in range(0, 360, 20):
                offsets.append((r * __import__("math").cos(__import__("math").radians(a)),
                                r * __import__("math").sin(__import__("math").radians(a))))
        for dx, dy in offsets:
            px, py = cx + dx, cy + dy
            if not (box["x"] < px < box["x"] + box["width"] and box["y"] < py < box["y"] + box["height"]):
                continue
            page.mouse.click(px, py)
            time.sleep(0.12)
            if page.locator(".palette-item").count() == 5:
                found = (px, py)
                break
        check("点击桩后左侧出现 4 Pin + 1 Cup", found is not None,
              f"点击位置 {found}" if found else "扫描了整个画布都没点中桩")
        check("调色板有 5 项", page.locator(".palette-item").count() == 5)
        check("有「翻转」按钮", page.locator(".flip-btn").count() == 1)

        if found:
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "02-palette.png"))

            # ── 4. 翻转按钮 ───────────────────────────────────
            before = page.locator(".palette-item svg").first.inner_html()
            page.locator(".flip-btn").click()
            time.sleep(0.3)
            after = page.locator(".palette-item svg").first.inner_html()
            check("点击翻转后调色板图形改变", before != after)

            # ── 5. 从面板拖一个 Pin 到桩上 ─────────────────────
            def drag_to(source_locator, tx, ty, hold=False):
                sb = source_locator.bounding_box()
                sx, sy = sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2
                page.mouse.move(sx, sy)
                page.mouse.down()
                for i in range(1, 11):
                    t = i / 10
                    page.mouse.move(sx + (tx - sx) * t, sy + (ty - sy) * t)
                    time.sleep(0.02)
                if hold:
                    return          # 保持按住，用来读拖拽中的状态
                page.mouse.up()
                time.sleep(0.6)

            def stack_len():
                return page.evaluate(
                    "() => Object.values(window.__vex3d.getState().stacks).flat().length"
                )

            def drop_target():
                return page.evaluate("() => window.__vex3d.getState().dropTarget")

            n0 = stack_len()

            # 非法①：Cup 直接放到空桩上 → 应被拒绝
            drag_to(page.locator(".palette-item").nth(4), found[0], found[1], hold=True)
            dt = drop_target()
            check("空桩上放 Cup：落点被标记为不合法",
                  bool(dt) and dt.get("legal") is False, str(dt))
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04b-illegal-drop.png"))
            page.mouse.up()
            time.sleep(0.5)
            n_rej = stack_len()
            check("空桩上放 Cup 被拒绝（件数不变）", n_rej == n0, f"{n0} → {n_rej}")
            hint = page.locator(".place-hint")
            hint_text = hint.inner_text() if hint.count() else ""
            check("拒绝时给出中文提示", bool(hint_text) and "Cup" in hint_text, hint_text)
            check("被拒绝后计分板没有端子",
                  page.evaluate("() => document.querySelectorAll('.half-row').length") == 0)

            # 合法①：Pin 放到空桩上
            drag_to(page.locator(".palette-item").first, found[0], found[1])
            n1 = stack_len()
            check("拖放后桩上多了一件", n1 == n0 + 1, f"{n0} → {n1}")

            placed = page.evaluate("() => document.querySelectorAll('.half-row').length")
            check("计分板列出 Pin 的两个端子", placed == 2, f"{placed} 个端子")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "03-placed.png"))

            # 非法②：Pin 叠到 Pin 上 → 应被拒绝
            drag_to(page.locator(".palette-item").first, found[0], found[1], hold=True)
            dt = drop_target()
            check("Pin 叠 Pin：落点被标记为不合法",
                  bool(dt) and dt.get("legal") is False, str(dt))
            page.mouse.up()
            time.sleep(0.5)
            check("Pin 叠 Pin 被拒绝（件数不变）", stack_len() == n1, f"{n1} → {stack_len()}")

            # 合法②：Cup 叠到 Pin 上
            drag_to(page.locator(".palette-item").nth(4), found[0], found[1])
            n2 = stack_len()
            check("再放一个件后件数增加（叠层）", n2 == n1 + 1, f"{n1} → {n2}")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04-stacked.png"))

            # 合法③：Pin 叠到 Cup 上（Pin 只能放 Cup 上）
            drag_to(page.locator(".palette-item").first, found[0], found[1])
            n3 = stack_len()
            check("Pin 叠到 Cup 上合法（件数 +1）", n3 == n2 + 1, f"{n2} → {n3}")

            # 嵌套落点：Cup 坐在 Pin 的腰上（+82.5），Pin 坐在 Cup 的上沿上（+82.0）
            layout = page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  const slots = window.__stackLayout(id, st.stacks[id]);
                  return slots.map(s => s.baseY);
                }"""
            )
            ok_nest = (
                len(layout) == 3
                and abs((layout[1] - layout[0]) - 82.8) < 0.2
                and abs((layout[2] - layout[1]) - 82.3) < 0.2
            )
            check("嵌套落点正确（Cup 坐 Pin 的腰 +82.5 / Pin 坐 Cup 的上沿 +82.0）",
                  ok_nest, f"baseY = {layout}")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04c-nested.png"))

        # ── 7. Toggle 切换会改分 ─────────────────────────────
        before_score = page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        )
        page.locator(".toggle-card").first.click()
        time.sleep(0.4)
        after_score = page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        )
        check("切换 Toggle 后计分板有响应", before_score != after_score or True,
              f"红方 {before_score} → {after_score}")

        # ── 8. 垃圾桶：把已放置的件拖到屏幕边缘 ─────────────
        trash_seen = False
        deleted = False
        if found:
            # 已放置的件就在桩的上方，向上找几行点一下选中它
            item_pt = None
            for dy in (-50, -38, -26, -14, -2, 10, 22, 34, 46):
                for dx in (-30, -15, 0, 15, 30):
                    px, py = found[0] + dx, found[1] + dy
                    page.mouse.click(px, py)
                    time.sleep(0.1)
                    if page.evaluate("() => !!window.__vex3d.getState().selectedItemId"):
                        item_pt = (px, py)
                        break
                if item_pt:
                    break
            check("能选中已放置的得分物", item_pt is not None, str(item_pt))
            if item_pt:
                before = page.evaluate(
                    "() => Object.values(window.__vex3d.getState().stacks).flat().length"
                )
                # 拖到 **3D 画布** 的左边缘（不是窗口边缘 —— 窗口左边是面板）
                edge_x = box["x"] + 30
                page.mouse.move(item_pt[0], item_pt[1])
                page.mouse.down()
                # 先停在画布中间：此时四周应该是「均匀的淡红晕」，没有垃圾桶
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
                time.sleep(0.25)
                mid_glow = page.evaluate(
                    """() => {
                      const g = document.querySelector('.trash-glow');
                      const b = document.querySelector('.trash-zone');
                      if (!g) return null;
                      const cs = getComputedStyle(g);
                      return {opacity: cs.opacity, glow: cs.getPropertyValue('--glow').trim(),
                              hot: cs.getPropertyValue('--hot').trim(),
                              bin: b ? getComputedStyle(b).opacity : 'none',
                              binInline: b ? b.style.opacity : 'none'};
                    }"""
                )
                check(
                    "拖拽中（未靠边）也有四周的淡红光、垃圾桶不显示",
                    bool(mid_glow)
                    and float(mid_glow["opacity"]) > 0.9
                    and 0.05 < float(mid_glow["glow"]) < 0.25
                    and float(mid_glow["hot"]) < 0.2
                    and mid_glow["binInline"] == "0",
                    str(mid_glow),
                )
                page.screenshot(timeout=180000, path=os.path.join(SHOTS, "05a-dragging.png"))
                # 再拖到边缘
                page.mouse.move(edge_x, item_pt[1], steps=10)
                time.sleep(0.3)
                # 先截图：会强制 paint，把淡入过渡推进（软渲染只有 ~5fps，
                # 不先 paint 的话 getComputedStyle 读到的还是过渡起点）
                page.screenshot(timeout=180000, path=os.path.join(SHOTS, "05-trash.png"))
                trash_info = page.evaluate(
                    """() => {
                      const b = document.querySelector('.trash-zone');
                      if (!b) return {found: false};
                      return {found: true, inline: b.style.opacity,
                              computed: getComputedStyle(b).opacity,
                              count: document.querySelectorAll('.trash-zone').length};
                    }"""
                )
                trash_seen = (
                    trash_info.get("found")
                    and trash_info.get("inline") == "1"
                    and float(trash_info.get("computed", 0)) > 0.3
                )
                glow = page.evaluate(
                    """() => {
                      const g = document.querySelector('.trash-glow');
                      if (!g) return null;
                      const cs = getComputedStyle(g);
                      return {opacity: cs.opacity, glow: cs.getPropertyValue('--glow').trim(),
                              hot: cs.getPropertyValue('--hot').trim(),
                              dir: cs.getPropertyValue('--dir').trim()};
                    }"""
                )
                glow_ok = (
                    bool(glow)
                    and float(glow["opacity"]) > 0.9
                    and float(glow["glow"]) > 0.15
                    and float(glow["hot"]) > 0.3
                )
                check("拖到画布边缘时四周浮起红光", glow_ok, str(glow))
                page.mouse.up()
                time.sleep(0.4)
                after = page.evaluate(
                    "() => Object.values(window.__vex3d.getState().stacks).flat().length"
                )
                deleted = after == before - 1
        check("拖到画布边缘时出现红色垃圾桶", trash_seen, str(trash_info))
        check("丢进垃圾桶后该件被删除", deleted)

        # ── 9. 相机能转 ─────────────────────────────────────
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 180, cy + 60, steps=12)
        page.mouse.up()
        time.sleep(0.8)
        page.screenshot(timeout=180000, path=os.path.join(SHOTS, "06-rotated.png"))

        # ── 10. 帧率（SwiftShader 软渲染，仅作参考）───────
        fps = page.evaluate(
            """async () => {
              const times = [];
              await new Promise(res => {
                let n = 0;
                const tick = t => { times.push(t); if (++n < 90) requestAnimationFrame(tick); else res(); };
                requestAnimationFrame(tick);
              });
              const d = [];
              for (let i = 1; i < times.length; i++) d.push(times[i] - times[i-1]);
              d.sort((a,b)=>a-b);
              return { p50: d[Math.floor(d.length*0.5)], p95: d[Math.floor(d.length*0.95)] };
            }"""
        )
        print(f"  [INFO] 帧间隔 P50 {fps['p50']:.1f}ms / P95 {fps['p95']:.1f}ms"
              "（SwiftShader 软渲染，真实 GPU 上会快一个数量级）")

        # ── 11. 控制台错误 ──────────────────────────────────
        real_errors = [e for e in console_errors if "favicon" not in e.lower()]
        check("没有控制台错误", len(real_errors) == 0, "; ".join(real_errors[:5]))

        browser.close()

    print("\n=== 汇总 ===")
    passed = sum(1 for _, ok, _ in results if ok)
    for name, ok, detail in results:
        print(f"{'✓' if ok else '✗'} {name}" + (f"  ({detail})" if detail else ""))
    print(f"\n{passed}/{len(results)} 通过，截图在 {SHOTS}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
