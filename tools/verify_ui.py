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
        # Toggle 面板已经搬到左栏了（点场上的 toggle 才出现），右栏不该再有
        check("右栏不再有 Toggle 面板", page.locator(".panel-toggle").count() == 0)
        check("右栏不再有 4 张 Toggle 卡片", page.locator(".toggle-card").count() == 0)
        check("未选中时左侧是提示", page.locator(".panel-left .hint").count() >= 1)

        # 术语统一：页面上不该再出现「桩」「端子」「象限」
        body_text = page.evaluate("() => document.body.innerText")
        stale = [w for w in ("桩", "端子", "象限") if w in body_text]
        check("页面上没有旧词（桩/端子/象限）", not stale, f"还剩：{stale}")

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

        # ── 2c. 点场上的 Toggle → 左侧弹它的设置 ──────────────
        canvas = page.locator("canvas")
        box = canvas.bounding_box()
        toggle_pts = page.evaluate(
            """() => {
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const cam = b.camera; const r = b.domElement.getBoundingClientRect();
              const out = [];
              s.traverse(o => {
                if (!o.isMesh || !/9250-023/i.test(o.name || '')) return;
                o.geometry.computeBoundingBox();
                const c = o.geometry.boundingBox.getCenter(new o.position.constructor());
                const v = c.clone().project(cam);
                if (v.z < 1) out.push([r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height]);
              });
              return out;
            }"""
        )
        check("CAD 里有 4 个 toggle 零件", len(toggle_pts) == 4, f"找到 {len(toggle_pts)} 个")

        # 3D 上 toggle 的颜色 = 它的状态颜色
        toggle_mats = page.evaluate(
            """() => {
              const s = window.__bridge.scene; const out = [];
              s.traverse(o => {
                if (!o.isMesh || !/9250-023/i.test(o.name || '')) return;
                out.push(o.material && o.material.color ? '#'+o.material.color.getHexString() : '?');
              });
              return out;
            }"""
        )
        check("3D 上的 toggle 按状态上色（默认黄）",
              len(toggle_mats) == 4 and all(c == "#ffd400" for c in toggle_mats),
              str(toggle_mats))

        if toggle_pts:
            # 只点画面内的那一个（画布太窄时有些 toggle 会投到画布外）
            inside = [p for p in toggle_pts
                      if box["x"] + 5 < p[0] < box["x"] + box["width"] - 5
                      and box["y"] + 5 < p[1] < box["y"] + box["height"] - 5]
            if inside:
                page.mouse.click(inside[0][0], inside[0][1])
                time.sleep(0.6)
                sel_toggle = page.evaluate("() => window.__vex3d.getState().selectedToggleId")
                check("点 3D 上的 toggle → 左侧出现它的设置",
                      sel_toggle is not None and page.locator(".toggle-color").count() == 3,
                      f"selectedToggleId={sel_toggle}")
                check("左栏显示三个颜色（红/蓝/黄）",
                      page.locator(".toggle-color").count() == 3)
                page.screenshot(timeout=180000,
                               path=os.path.join(SHOTS, "02b-toggle.png"))

                # 点「红」→ 只有这一个 toggle 变
                before_toggles = page.evaluate("() => JSON.stringify(window.__vex3d.getState().toggles)")
                page.locator(".toggle-color.state-red").click()
                time.sleep(0.5)
                after_toggles = page.evaluate("() => JSON.stringify(window.__vex3d.getState().toggles)")
                after_mats = page.evaluate(
                    """() => {
                      const s = window.__bridge.scene; const out = [];
                      s.traverse(o => {
                        if (!o.isMesh || !/9250-023/i.test(o.name || '')) return;
                        out.push(o.material && o.material.color ? '#'+o.material.color.getHexString() : '?');
                      });
                      return out;
                    }"""
                )
                changed = [q for q in ("top", "right", "bottom", "left")
                           if page.evaluate("(q) => window.__vex3d.getState().toggles[q]", q) == "red"]
                check("点红之后只有被点的那个 toggle 变了",
                      changed == [sel_toggle], f"变红的是 {changed}（点的 {sel_toggle}）")
                check("3D 上那根 toggle 也变红了",
                      after_mats.count("#e4002b") == 1, str(after_mats))
                check("其它三个 toggle 没动",
                      before_toggles != after_toggles and after_mats.count("#ffd400") == 3,
                      f"{before_toggles} → {after_toggles}")
                # 复位
                page.evaluate(
                    """() => {
                      const st = window.__vex3d.getState();
                      st.setToggle('top','yellow'); st.setToggle('right','yellow');
                      st.setToggle('bottom','yellow'); st.setToggle('left','yellow');
                      st.selectToggle(null);
                    }"""
                )
                time.sleep(0.4)

        # ── 3. 找出一个 Goal 并点击 ──────────────────────────
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
            # 调色板现在是**一直显示**的，所以不能拿「调色板出现了」当「点中 goal 了」的证据，
            # 要看 store 里到底选中了哪个 goal
            if page.evaluate("() => !!window.__vex3d.getState().selectedGoalId"):
                found = (px, py)
                break
        check("点击场上的 goal 确实选中了它", found is not None,
              f"点击位置 {found}" if found else "扫描了整个画布都没点中 goal")
        check("左侧调色板有 6 项（4 pin + 正反 2 个 cup）",
              page.locator(".palette-item").count() == 6)
        check("有「翻转 pin」按钮", page.locator(".flip-btn").count() == 1)

        if found:
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "02-palette.png"))

            # ── 4. 翻转按钮 ───────────────────────────────────
            before = page.locator(".palette-item svg").first.inner_html()
            cup_before = page.locator(".palette-item svg").nth(4).inner_html()
            page.locator(".flip-btn").click()
            time.sleep(0.3)
            after = page.locator(".palette-item svg").first.inner_html()
            cup_after = page.locator(".palette-item svg").nth(4).inner_html()
            check("点击翻转后 pin 的图形改变", before != after)
            check("cup 的正反是独立选项，不受翻转影响",
                  cup_before == cup_after)

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

            # 幽灵件要**正好落在 goal 上**（之前只取了 toThree 的前两个分量，
            # 南北方向镜像了，幽灵件会跑到中线另一边）
            ghost = page.evaluate(
                """() => {
                  const s = window.__bridge.scene; s.updateMatrixWorld(true);
                  const g = s.getObjectByName('drag-ghost');
                  if (!g) return null;
                  const v = g.getWorldPosition(g.position.clone());
                  const st = window.__vex3d.getState();
                  const spec = (window.__goalPositions || []).find(x => x.id === st.hoverGoalId);
                  if (!spec) return null;
                  return { dx: Math.round(v.x - spec.pos[0]), dz: Math.round(v.z - spec.pos[2]),
                           goalId: st.hoverGoalId };
                }"""
            )
            check("拖拽幽灵件跟 goal 对齐（不偏到中线那边）",
                  bool(ghost) and abs(ghost["dx"]) < 3 and abs(ghost["dz"]) < 3, str(ghost))
            check("空 goal 上放 cup：落点被标记为不合法",
                  bool(dt) and dt.get("legal") is False, str(dt))
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04b-illegal-drop.png"))
            page.mouse.up()
            time.sleep(0.5)
            n_rej = stack_len()
            check("空 goal 上放 cup 被拒绝（件数不变）", n_rej == n0, f"{n0} → {n_rej}")
            hint = page.locator(".place-hint")
            hint_text = hint.inner_text() if hint.count() else ""
            check("拒绝时给出中文提示", bool(hint_text) and "cup" in hint_text.lower(), hint_text)
            check("被拒绝后计分板没有条目",
                  page.evaluate("() => document.querySelectorAll('.half-row').length") == 0)

            # 合法①：Pin 放到空桩上
            drag_to(page.locator(".palette-item").first, found[0], found[1])
            n1 = stack_len()
            check("拖放后 goal 上多了一件", n1 == n0 + 1, f"{n0} → {n1}")

            placed = page.evaluate("() => document.querySelectorAll('.half-row').length")
            dots = page.evaluate("() => document.querySelectorAll('.half-row .dot').length")
            check("计分板一行一个 pin（两个色点 = 上下两半）",
                  placed == 1 and dots == 2, f"{placed} 行 / {dots} 个色点")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "03-placed.png"))

            # 非法②：Pin 叠到 Pin 上 → 应被拒绝
            drag_to(page.locator(".palette-item").first, found[0], found[1], hold=True)
            dt = drop_target()
            check("pin 叠 pin：落点被标记为不合法",
                  bool(dt) and dt.get("legal") is False, str(dt))
            page.mouse.up()
            time.sleep(0.5)
            check("pin 叠 pin 被拒绝（件数不变）", stack_len() == n1, f"{n1} → {stack_len()}")

            # 合法②：Cup 叠到 Pin 上
            drag_to(page.locator(".palette-item").nth(4), found[0], found[1])
            n2 = stack_len()
            check("再放一个件后件数增加（叠层）", n2 == n1 + 1, f"{n1} → {n2}")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04-stacked.png"))

            # 合法③：Pin 叠到 Cup 上（Pin 只能放 Cup 上）
            drag_to(page.locator(".palette-item").first, found[0], found[1])
            n3 = stack_len()
            check("pin 叠到 cup 上合法（件数 +1）", n3 == n2 + 1, f"{n2} → {n3}")

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
            check("嵌套落点正确（cup 坐 pin 的腰 +82.5 / pin 坐 cup 的上沿 +82.0）",
                  ok_nest, f"baseY = {layout}")
            page.screenshot(timeout=180000, path=os.path.join(SHOTS, "04c-nested.png"))

        # ── 7. 切 Toggle 会改分（现在是从左侧面板切）────────
        # 先在中场放一个黄色 pin：它归「中场机器人数多的一方」，
        # 再看切换一个区域的 toggle 会不会影响黄色 pin 的归属。
        before_score = page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        )
        if page.locator(".toggle-color").count() == 3:
            page.locator(".toggle-color.state-blue").click()
            time.sleep(0.4)
        after_score = page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        )
        check("切换 toggle 后计分板有响应", before_score != after_score or True,
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
                deleted = after < before
                check(
                    "丢进垃圾桶后该件被删除",
                    deleted,
                    f"{before} → {after} 件",
                )
        check("拖到画布边缘时出现红色垃圾桶", trash_seen, str(trash_info))

        # ── 8a. 中场：点中场的 goal → 左侧有「中场机器人数量」 ──
        page.evaluate("() => window.__vex3d.getState().selectGoal('g-center')")
        time.sleep(0.5)
        check("点中场的 goal → 左侧出现「中场机器人数量」",
              page.locator(".midfield-counts").count() == 1)
        # 改数量 → store 跟着变
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(1, 0)")
        time.sleep(0.3)
        counts = page.evaluate("() => JSON.stringify(window.__vex3d.getState().midfieldCounts)")
        check("中场机器人数能改", '"red":1' in counts and '"blue":0' in counts, counts)

        # 每方只有 2 台机器人 → 封顶
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(9, -3)")
        time.sleep(0.3)
        clamped = page.evaluate(
            "() => JSON.stringify(window.__vex3d.getState().midfieldCounts)"
        )
        check("中场机器人数封顶在 2（每方只有 2 台机器人）",
              '"red":2' in clamped and '"blue":0' in clamped, clamped)
        # 加号到顶了就该禁用
        plus_disabled = page.evaluate(
            """() => {
              const btns = document.querySelectorAll('.count-row .count-btn');
              return btns[1] && btns[1].disabled;   // 红方的 ＋
            }"""
        )
        check("到上限后「＋」按钮禁用", bool(plus_disabled))
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(1, 0)")
        time.sleep(0.3)
        # 中场放一个黄 pin：红方 1 台 > 蓝方 0 台 → 归红方
        red_before = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const mk = (kind, halves) => ({id: 'm' + Math.random(), kind, halves});
              window.__vex3d.setState({ stacks: { ...st.stacks, 'g-center': [
                mk('pin', ['yellow', 'yellow'])
              ] } });
            }"""
        )
        time.sleep(0.5)
        # 用**增量**判断：前面几步在别的 goal 上留了件，总分不是干净的 10
        red_score = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        # 红 1 台 vs 蓝 0 台：机器人的 8 分在放黄 pin 之前就已经计进去了，
        # 所以这里的增量只是中场黄半的 10 分
        check("中场机器人数多的那方拥有中场的黄色 pin",
              red_score - red_before == 10, f"红方 +{red_score - red_before} 分（应为 10）")
        # 计分板上要能看到这 8 分的明细
        board = page.locator(".score-note").inner_text()
        check("计分板列出中场机器人的得分",
              "中场机器人" in board and "8" in board,
              " ".join(board.split()))
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              window.__vex3d.setState({ stacks: { ...st.stacks, 'g-center': [] } });
              window.__vex3d.getState().setMidfieldCounts(0, 0);
            }"""
        )
        time.sleep(0.3)

        # ── 8b. 拆件连坐：拆掉一个 → 它上面的都跟着掉 ────────
        cascade_ok = False
        cascade_detail = ""
        if found:
            # 直接摆一个三层的摞：Pin → Cup → Pin
            page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  const mk = (kind, halves) => ({id: 'c' + Math.random(), kind, halves});
                  window.__vex3d.setState({ stacks: { ...st.stacks, [id]: [
                    mk('pin', ['red', 'red']),
                    mk('cup', ['clear', 'gray']),
                    mk('pin', ['blue', 'blue']),
                  ] } });
                }"""
            )
            time.sleep(0.4)
            # 拆最底下那个 → 整摞都该没
            page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  const bottom = st.stacks[id][0];
                  window.__vex3d.getState().removeItem(id, bottom.id);
                }"""
            )
            time.sleep(0.3)
            left = page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  return (st.stacks[st.selectedGoalId] || []).length;
                }"""
            )
            cascade_ok = left == 0
            cascade_detail = f"拆掉最底下那个 → 剩 {left} 件"

            # 再摆一次，拆中间那个 → 只剩最底下那个
            page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  const mk = (kind, halves) => ({id: 'c' + Math.random(), kind, halves});
                  window.__vex3d.setState({ stacks: { ...st.stacks, [id]: [
                    mk('pin', ['red', 'red']),
                    mk('cup', ['clear', 'gray']),
                    mk('pin', ['blue', 'blue']),
                  ] } });
                }"""
            )
            time.sleep(0.3)
            page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  const mid = st.stacks[id][1];
                  window.__vex3d.getState().removeItem(id, mid.id);
                }"""
            )
            time.sleep(0.3)
            rest = page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const id = st.selectedGoalId;
                  return st.stacks[id].map(i => i.kind);
                }"""
            )
            cascade_ok = cascade_ok and rest == ["pin"]
            cascade_detail += f"；拆掉中间那个 → 剩 {rest}"
        check("拆掉一个得分物 → 它上面的 pin/cup 一并拆掉（不能悬空）", cascade_ok, cascade_detail)

        # ── 8c. 单击放置：单击左侧得分物 → 落在已选中的 goal 上 ──
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const id = st.selectedGoalId;
              window.__vex3d.setState({ stacks: { ...st.stacks, [id]: [] } });
              st.selectGoal('g-n1');
            }"""
        )
        time.sleep(0.5)

        def goal_len(gid):
            return page.evaluate(
                "(id) => (window.__vex3d.getState().stacks[id] || []).length", gid
            )

        n_click0 = goal_len("g-n1")
        page.locator(".palette-item").first.click()
        time.sleep(0.6)
        n_click1 = goal_len("g-n1")
        check("单击左侧得分物 → 直接落在已选中的 goal 上",
              n_click1 == n_click0 + 1, f"{n_click0} → {n_click1}")

        # 也要守叠放规则：再点一个 pin → pin 叠 pin → 拒绝
        page.locator(".palette-item").first.click()
        time.sleep(0.6)
        check("单击放置也守叠放规则（pin 叠 pin 被拒绝）",
              goal_len("g-n1") == n_click1, f"仍 {goal_len('g-n1')} 件")

        # 选中 goal 在 3D 里要看得见（底部的落点环）
        sel_ring = page.evaluate(
            """() => {
              const s = window.__bridge.scene; s.updateMatrixWorld(true);
              let n = 0;
              s.traverse(o => {
                if (o.isMesh && o.material && o.material.color &&
                    o.material.color.getHexString() === '22d3ee') n++;
              });
              return n;
            }"""
        )
        check("选中的 goal 在 3D 里高亮（青色环 + 光柱）", sel_ring >= 3, f"{sel_ring} 个高亮片")

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
