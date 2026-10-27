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
        # 无头环境走的是 SwiftShader 软件渲染：摆场之后 400+ 个 mesh，
        # **画一帧要 10 秒上下**。默认 30 s 的动作超时会莫名其妙地炸，
        # 所以这里放宽（真机上有 GPU，一帧几毫秒，用不着等）。
        page.set_default_timeout(120000)

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
        check("左侧面板已删除（画布变大）", page.locator(".panel-left").count() == 0)
        check("计分板存在", page.locator(".panel-score").count() == 1)
        # 右栏只有三块：实时计分 / 得分物 / 中场机器人数量
        check("右栏是三块（计分 + 调色板 + 中场机器人数）",
              page.locator(".left-col .panel").count() == 3)
        check("调色板有 6 项（4 pin + 正反 2 个 cup）",
              page.locator(".palette-item").count() == 6)
        check("中场机器人数量常驻", page.locator(".panel-midfield").count() == 1)
        check("规则说明抽屉已删除", page.locator(".rules-toggle").count() == 0)
        check("Toggle 设置面板已删除（单击 toggle 直接翻色）",
              page.locator(".toggle-color").count() == 0)
        # 视角卡片只留两个 + 一个锁定按钮
        view_labels = page.locator(".view-group").first.locator(".view-btn").all_inner_texts()
        check("视角卡片只留 45° / 俯视", view_labels == ["45°", "俯视"], str(view_labels))
        check("有视角锁定按钮", page.locator(".lock-btn").count() == 1)

        # 术语统一：页面上不该再出现「桩」「端子」「象限」
        body_text = page.evaluate("() => document.body.innerText")
        stale = [w for w in ("桩", "端子", "象限") if w in body_text]
        check("页面上没有旧词（桩/端子/象限）", not stale, f"还剩：{stale}")

        page.screenshot(timeout=300000, path=os.path.join(SHOTS, "01-overview.png"))

        # ── 2a. 默认视角朝东（相机在西侧 = 红方近场那头）────
        cam_pos = page.evaluate("() => window.__bridge.camera.position.toArray()")
        check("默认相机在西侧、朝东看（红近在前景）",
              cam_pos[0] < -3000 and abs(cam_pos[1]) > 1000, str([round(v) for v in cam_pos]))

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
        page.screenshot(timeout=300000, path=os.path.join(SHOTS, "01b-topdown.png"))
        # 视角复位（回默认的朝东视角）
        page.evaluate(
            """() => {
              const b = window.__bridge;
              b.camera.up.set(0, 1, 0);
              b.camera.position.set(-4100, 3400, 0);
              b.camera.lookAt(0, 0, 0);
              b.invalidate && b.invalidate();
            }"""
        )
        time.sleep(0.4)

        # ── 2c. 点场上的 Toggle → 直接翻一次颜色 ──────────────
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

        # ★ 循环顺序：红方半场（西墙·红近 + 南墙·红远）黄→蓝→红→黄；
        #   蓝方半场（东墙·蓝近 + 北墙·蓝远）黄→红→蓝→黄。
        for q, want in (("left", "blue"), ("bottom", "blue"), ("right", "red"), ("top", "red")):
            page.evaluate(
                """(q) => {
                  const st = window.__vex3d.getState();
                  st.setToggle('top','yellow'); st.setToggle('right','yellow');
                  st.setToggle('bottom','yellow'); st.setToggle('left','yellow');
                  st.cycleToggle(q);
                }""",
                q,
            )
            time.sleep(0.15)
            got = page.evaluate("(q) => window.__vex3d.getState().toggles[q]", q)
            check(f"toggle 循环顺序（{q} 第一次翻 → {want}）", got == want, f"得到 {got}")
        # 翻满一圈回到黄色
        for _ in range(3):
            page.evaluate("(q) => window.__vex3d.getState().cycleToggle(q)", "left")
        back = page.evaluate("() => window.__vex3d.getState().toggles.left")
        check("toggle 翻三次回到黄色（黄→蓝→红→黄）", back == "yellow", f"得到 {back}")

        if toggle_pts:
            # 只点画面内的那一个（画布太窄时有些 toggle 会投到画布外）
            inside = [p for p in toggle_pts
                      if box["x"] + 5 < p[0] < box["x"] + box["width"] - 5
                      and box["y"] + 5 < p[1] < box["y"] + box["height"] - 5]
            if inside:
                before_toggles = page.evaluate("() => JSON.stringify(window.__vex3d.getState().toggles)")
                page.mouse.click(inside[0][0], inside[0][1])
                time.sleep(0.6)
                after_toggles = page.evaluate("() => JSON.stringify(window.__vex3d.getState().toggles)")
                changed = [q for q in ("top", "right", "bottom", "left")
                           if page.evaluate("(q) => window.__vex3d.getState().toggles[q]", q) != "yellow"]
                check("单击 3D 上的 toggle → 颜色翻一次（只翻这一个）",
                      len(changed) == 1 and before_toggles != after_toggles, f"变了的是 {changed}")
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
                check("3D 上那根 toggle 的颜色跟着变",
                      after_mats.count("#ffd400") == 3, str(after_mats))
                check("单击 toggle 不再弹设置面板", page.locator(".toggle-color").count() == 0)
                page.screenshot(timeout=300000,
                               path=os.path.join(SHOTS, "02b-toggle.png"))
                # 复位
                page.evaluate(
                    """() => {
                      const st = window.__vex3d.getState();
                      st.setToggle('top','yellow'); st.setToggle('right','yellow');
                      st.setToggle('bottom','yellow'); st.setToggle('left','yellow');
                    }"""
                )
                time.sleep(0.4)

        # ── 2d. 视角锁定 ────────────────────────────────────
        page.locator(".lock-btn").click()
        time.sleep(0.4)
        locked = page.evaluate("() => window.__vex3d.getState().viewLocked")
        check("点锁定按钮 → 视角被锁住", locked is True)
        cam_before = page.evaluate("() => window.__bridge.camera.position.toArray()")
        # 拖画布左上角的空白处（那儿没有 goal / 散件，拖到的是相机）
        ox, oy = box["x"] + 60, box["y"] + 60
        page.mouse.move(ox, oy)
        page.mouse.down()
        page.mouse.move(ox + 160, oy + 40, steps=8)
        page.mouse.up()
        time.sleep(0.5)
        cam_after = page.evaluate("() => window.__bridge.camera.position.toArray()")
        check("锁住之后相机拖不动",
              abs(cam_after[0] - cam_before[0]) < 1 and abs(cam_after[1] - cam_before[1]) < 1,
              f"{[round(v) for v in cam_before]} → {[round(v) for v in cam_after]}")
        page.locator(".lock-btn").click()
        time.sleep(0.3)
        check("再点一次解锁",
              page.evaluate("() => window.__vex3d.getState().viewLocked") is False)

        # ── 3. 找出一个 Goal 并点击 ──────────────────────────
        found = None
        # ★ 直接把 9 个 goal 投影到屏幕坐标再点（比盲扫靠谱 ——
        #   goal 在屏幕上只有 ~13 px 宽，盲扫很容易点空，还会误点到围栏上的 toggle）
        goal_pts = page.evaluate(
            """() => {
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const r = b.domElement.getBoundingClientRect();
              return (window.__goalPositions || []).map(g => {
                const v = new b.camera.position.constructor(g.pos[0], g.pos[1], g.pos[2]);
                v.project(b.camera);
                return {id: g.id,
                        pt: [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height]};
              });
            }"""
        )
        for g in goal_pts:
            px, py = g["pt"]
            if not (box["x"] + 4 < px < box["x"] + box["width"] - 4
                    and box["y"] + 4 < py < box["y"] + box["height"] - 4):
                continue
            page.mouse.click(px, py)
            time.sleep(0.2)
            sel = page.evaluate("() => window.__vex3d.getState().selectedGoalId")
            if sel == g["id"]:
                found = (px, py)
                break
        check("点击场上的 goal 确实选中了它", found is not None,
              f"点击位置 {found}" if found else "一个 goal 都没点中")
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        check("右栏调色板有 6 项（4 pin + 正反 2 个 cup）",
              page.locator(".palette-item").count() == 6)
        check("有「翻转 pin」按钮", page.locator(".flip-btn").count() == 1)
        check("计分板只留两个大分数（没有逐项明细）",
              page.evaluate("() => document.querySelectorAll('.score-cell').length") == 2
              and page.evaluate("() => document.querySelectorAll('.half-row').length") == 0)

        if found:
            page.screenshot(timeout=300000, path=os.path.join(SHOTS, "02-palette.png"))

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

            def score_total():
                return page.evaluate(
                    """() => {
                      const r = document.querySelector('.score-cell.red .score-num').textContent;
                      const b = document.querySelector('.score-cell.blue .score-num').textContent;
                      return Number(r) + Number(b);
                    }"""
                )

            def drop_target():
                return page.evaluate("() => window.__vex3d.getState().dropTarget")

            n0 = stack_len()
            s0 = score_total()

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
            page.screenshot(timeout=300000, path=os.path.join(SHOTS, "04b-illegal-drop.png"))
            page.mouse.up()
            # 提示条只挂 2.4 秒 → 轮询着抓，别在「count 到还在」和「读文本」之间
            # 被它消失掉（软渲染下这两步能隔好几秒）
            hint_text = ""
            for _ in range(30):
                hint_text = page.evaluate(
                    """() => {
                      const el = document.querySelector('.place-hint');
                      return el ? el.innerText : '';
                    }"""
                )
                if hint_text:
                    break
                time.sleep(0.08)
            time.sleep(0.5)
            n_rej = stack_len()
            check("空 goal 上放 cup 被拒绝（件数不变）", n_rej == n0, f"{n0} → {n_rej}")
            check("拒绝时给出中文提示", bool(hint_text) and "cup" in hint_text.lower(), hint_text)
            check("被拒绝后分数没变", score_total() == s0, f"{s0} → {score_total()}")

            # 合法①：Pin 放到空桩上
            drag_to(page.locator(".palette-item").first, found[0], found[1])
            n1 = stack_len()
            check("拖放后 goal 上多了一件", n1 == n0 + 1, f"{n0} → {n1}")

            s1 = score_total()
            check("放上去之后实时计分加了（半个 pin = 5 分）",
                  s1 == s0 + 5, f"{s0} → {s1}")
            page.screenshot(timeout=300000, path=os.path.join(SHOTS, "03-placed.png"))

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
            page.screenshot(timeout=300000, path=os.path.join(SHOTS, "04-stacked.png"))

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
            page.screenshot(timeout=300000, path=os.path.join(SHOTS, "04c-nested.png"))

        # ── 7. 切 Toggle 会改分（黄色 pin 归该区域 toggle 的颜色）──
        # 在「红近」区域（西墙那个 toggle 管着的 g-n2）放一根黄/黄 pin，
        # 再把那个 toggle 翻成红色 → 黄半归红方（+10）。
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.setToggle('left', 'yellow');           // 先摆成「没人拥有」
              window.__vex3d.setState({ stacks: { ...st.stacks, 'g-n2': [
                { id: 'yy' + Math.random(), kind: 'pin', halves: ['yellow', 'yellow'] }
              ] } });
            }"""
        )
        time.sleep(0.4)
        red_before = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        # 西墙（红近）：黄 → 蓝 → 红
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.cycleToggle('left'); st.cycleToggle('left');
            }"""
        )
        time.sleep(0.5)
        red_after = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        check("把区域的 toggle 翻成红色 → 该区域的黄色 pin 归红方（+10）",
              red_after - red_before == 10, f"红方 {red_before} → {red_after}")
        # 复位
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.setToggle('left', 'yellow');
              window.__vex3d.setState({ stacks: { ...st.stacks, 'g-n2': [] } });
            }"""
        )
        time.sleep(0.3)

        # ── 8. 删除手势：拖到右上角那个红色小方块 ───────────
        trash_seen = False
        deleted = False
        trash_info = {"found": False}   # 找不到件时也别让脚本崩（下面要用它报错）
        if found:
            # 已放置的件就在桩的上方，向上找几行点一下选中它。
            # ★ 用 goal 的**中心**屏幕坐标（found 只是「点中了 goal 的那个点」，
            #   可能落在 goal 的边缘上，扫一圈也够不着摞在上面的件）
            goal_c = page.evaluate(
                """(gid) => {
                  const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
                  const g = (window.__goalPositions||[]).find(x => x.id === gid);
                  if (!g) return null;
                  const v = new b.camera.position.constructor(g.pos[0], g.pos[1], g.pos[2]);
                  v.project(b.camera);
                  const r = b.domElement.getBoundingClientRect();
                  return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
                }""",
                page.evaluate("() => window.__vex3d.getState().selectedGoalId"),
            )
            base = goal_c or found
            item_pt = None
            for dy in (-50, -38, -26, -14, -2, 10, 22, 34, 46):
                for dx in (-30, -15, 0, 15, 30):
                    px, py = base[0] + dx, base[1] + dy
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
                page.mouse.move(item_pt[0], item_pt[1])
                page.mouse.down()
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
                time.sleep(0.35)
                slot = page.evaluate(
                    """() => {
                      const el = document.querySelector('.trash-slot');
                      if (!el) return null;
                      const r = el.getBoundingClientRect();
                      return {left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                              w: Math.round(r.width), h: Math.round(r.height)};
                    }"""
                )
                trash_info = {"found": bool(slot), **(slot or {})}
                check("拖拽时画布右上角出现删除方块", bool(slot), str(trash_info))
                check("方块是个小正方形", bool(slot) and 40 < slot["w"] < 90
                      and 40 < slot["h"] < 90, str(slot))
                check("画布四周不再有红光（老手势已删）",
                      page.evaluate("() => document.querySelectorAll('.trash-glow').length") == 0)
                page.screenshot(timeout=300000, path=os.path.join(SHOTS, "05a-dragging.png"))
                if slot:
                    tx = (slot["left"] + slot["right"]) / 2
                    ty = (slot["top"] + slot["bottom"]) / 2
                    page.mouse.move(tx, ty, steps=10)
                    time.sleep(0.4)
                    # 先截图：会强制 paint，把过渡推进（软渲染只有 ~5fps）
                    page.screenshot(timeout=300000, path=os.path.join(SHOTS, "05-trash.png"))
                    over = page.evaluate(
                        "() => { const el = document.querySelector('.trash-slot');"
                        " return !!el && el.classList.contains('over'); }"
                    )
                    trash_seen = bool(over)
                    check("指针进方块时它会高亮", over)
                    page.mouse.up()
                    time.sleep(0.5)
                    after = page.evaluate(
                        "() => Object.values(window.__vex3d.getState().stacks).flat().length"
                    )
                    deleted = after < before
                    check("丢进方块后该件被删除", deleted, f"{before} → {after} 件")
        check("右上角的删除方块能删东西", trash_seen and deleted, str(trash_info))

        # ── 8a. 中场机器人数量（常驻在右栏）──────────────────
        page.evaluate("() => window.__vex3d.getState().selectGoal('g-center')")
        time.sleep(0.5)
        check("右栏常驻「中场机器人数量」", page.locator(".panel-midfield").count() == 1)
        # 改数量 → store 跟着变
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(1, 0)")
        time.sleep(0.3)
        counts = page.evaluate("() => JSON.stringify(window.__vex3d.getState().midfieldCounts)")
        check("中场机器人数能改", '"red":1' in counts and '"blue":0' in counts, counts)

        # 每台位于中场的机器人 8 分 → 算进总分
        red_with = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(0, 0)")
        time.sleep(0.4)
        red_without = int(page.evaluate(
            "() => document.querySelector('.score-cell.red .score-num').textContent"
        ))
        check("中场机器人的 8 分算进总分",
              red_with - red_without == 8, f"红方 {red_with} → {red_without}")
        page.evaluate("() => window.__vex3d.getState().setMidfieldCounts(1, 0)")
        time.sleep(0.3)

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

        # ── 8d. 摆场预设：还原官方开局 ─────────────────────────
        page.locator(".topbar button", has_text="摆场").click()
        time.sleep(1.5)
        setup = page.evaluate("""() => {
          const st = window.__vex3d.getState();
          const stacks = {};
          for (const [k, v] of Object.entries(st.stacks)) if (v.length) stacks[k] = v.length;
          // 官方 VEXcode VR Playground 的 20 个 pin/cup 落位
          const GPS = [[-600,1745],[600,1745],[-1200,1200],[1200,1200],
                       [-1745,600],[-600,600],[0,600],[600,600],[1745,600],
                       [-600,0],[600,0],
                       [-1745,-600],[-600,-600],[0,-600],[600,-600],[1745,-600],
                       [-1200,-1200],[1200,-1200],[-600,-1745],[600,-1745]];
          // 散件现在按**组**存：一组 = 一个整体（可能是「cup 里插着 pin」）
          const groups = st.loose;
          const all = groups.flatMap(g => g.pieces.map(p => ({...p, gx: g.x, gy: g.y})));
          const gpsHit = GPS.map(([px, py]) => {
            const d = Math.min(...groups.map(g => Math.hypot(g.x - px, g.y - py)));
            return Math.round(d * 10) / 10;
          });
          const onField = all.filter(p => Math.abs(p.gx) < 1900 && Math.abs(p.gy) < 1900);
          return {
            stacks,
            groups: groups.length,
            pieces: all.length,
            inField: groups.filter(g => Math.abs(g.x) < 1900 && Math.abs(g.y) < 1900).length,
            inStage: groups.filter(g => Math.abs(g.x) > 1900).length,
            lying: groups.filter(g => g.pieces.some(p => p.axis)).length,
            nested: groups.filter(g => g.pieces.length > 1).length,
            gpsHit,
            // 场上 pin = 散件里的 + 5 个中立 goal 上的（4 个中立 + 中场）
            pinsOnField: onField.filter(p => p.kind === 'pin').length
                          + Object.keys(stacks).length,
            cupsOnField: onField.filter(p => p.kind === 'cup').length,
          };
        }""")
        check("摆场：4 个中立 goal + 中场各一根 pin，4 个联盟 goal 空着",
              setup["stacks"] == {"g-n1": 1, "g-n2": 1, "g-n3": 1, "g-n4": 1, "g-center": 1},
              str(setup["stacks"]))
        check("摆场：官方数量 —— 场上 37 根 pin + 36 个 cup，装填区 46 件",
              setup["pinsOnField"] == 37 and setup["cupsOnField"] == 36
              and setup["pieces"] == 114 and setup["inStage"] == 46,
              f"场上 {setup['pinsOnField']} pin / {setup['cupsOnField']} cup，"
              f"散件共 {setup['pieces']} 件 / {setup['groups']} 组（装填区 {setup['inStage']}）")
        check("摆场：20 个官方 GPS 落位上都有东西（≤ 6 mm）",
              max(setup["gpsHit"]) <= 6.0,
              f"最大偏差 {max(setup['gpsHit'])} mm")
        check("摆场：16 根侧躺的 pin + 16 组「cup 里插着 pin」",
              setup["lying"] == 16 and setup["nested"] == 16,
              f"躺 {setup['lying']} / 组合 {setup['nested']}")
        page.screenshot(timeout=300000, path=os.path.join(SHOTS, "07-setup.png"))

        # 单击散件 = 选中（并端起来）：不能把它挪走，更不能删掉
        # （以前单击会被当成「丢到地面」，落点用射线打水平面算 → 件飞到天边 ✗）
        click_cands = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const r = b.domElement.getBoundingClientRect();
              const out = [];
              for (const g of st.loose) {
                // 找「孤零零」的散件组（只有一段、没侧躺；附近也没有别的组）
                if (g.pieces.length > 1) continue;
                if (g.pieces[0].axis) continue;
                if (st.loose.some(o => o !== g && Math.abs(o.x - g.x) < 60 && Math.abs(o.y - g.y) < 60)) continue;
                const v = new b.camera.position.constructor(g.x, 40, -g.y);
                v.project(b.camera);
                out.push({ id: g.id, piece: g.pieces[0].id, x: g.x, y: g.y, n: st.loose.length,
                           pt: [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height] });
                if (out.length >= 40) break;
              }
              return out;
            }"""
        )
        # 挑一个**落在画布内**的（画布只有 ~500 px 宽，摆在角落的件可能投影到面板底下）
        click_res = next(
            (
                c
                for c in click_cands
                if box["x"] + 20 < c["pt"][0] < box["x"] + box["width"] - 20
                and box["y"] + 20 < c["pt"][1] < box["y"] + box["height"] - 20
            ),
            None,
        )
        if click_res:
            page.mouse.click(click_res["pt"][0], click_res["pt"][1])
            time.sleep(0.5)
            after_click = page.evaluate(
                """(id) => {
                  const st = window.__vex3d.getState();
                  const g = st.loose.find(x => x.id === id);
                  return { n: st.loose.length, sel: st.selectedItemId,
                           loose: st.selectedLooseId,
                           x: g ? g.x : null, y: g ? g.y : null };
                }""",
                click_res["id"],
            )
            check("单击散件只是选中，不会挪走或删掉",
                  after_click["n"] == click_res["n"]
                  and after_click["sel"] == click_res["piece"]
                  and after_click["loose"] == click_res["id"]
                  and after_click["x"] == click_res["x"]
                  and after_click["y"] == click_res["y"],
                  f"{click_res['id']} @({click_res['x']:.0f},{click_res['y']:.0f}) → {after_click}")

        # 场上的得分物：点它 = 把它端起来 → 再点 goal = 放上去（**优先于**「选中 goal」）
        pick = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const r = b.domElement.getBoundingClientRect();
              const inCanvas = (pt) => pt[0] > r.left+20 && pt[0] < r.right-20
                                    && pt[1] > r.top+20 && pt[1] < r.bottom-20;
              const project = (x, y, z) => {          // 场地坐标 → 屏幕
                const v = new b.camera.position.constructor(x, z, -y);
                v.project(b.camera);
                return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
              };
              const project3 = (p) => {               // three 系坐标 → 屏幕
                const v = new b.camera.position.constructor(p[0], p[1], p[2]);
                v.project(b.camera);
                return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
              };
              // 4 个联盟 goal 开局是空的 → 挑一个**落在画布里、而且周围没有散件**的
              // （散件挡在 goal 前面的话，点到的就是散件而不是 goal）
              let goal = null;
              for (const id of ['g-r1', 'g-r2', 'g-b1', 'g-b2']) {
                const g = (window.__goalPositions||[]).find(p => p.id === id);
                if (!g) continue;
                // g.pos 是 three 系（[X, 0, -Y]），散件的坐标是场地系（x, y）
                if (st.loose.some(o => Math.abs(o.x - g.pos[0]) < 220 && Math.abs(o.y + g.pos[2]) < 220)) continue;
                const pt = project3(g.pos);
                if (inCanvas(pt)) { goal = { id, pt }; break; }
              }
              if (!goal) return null;
              for (const g of st.loose) {
                const p = g.pieces[0];
                if (g.pieces.length !== 1 || p.kind !== 'pin' || p.axis) continue;
                // 周围没有别的件 → 点到的就是这个 pin（不是被挡住的邻居）
                if (st.loose.some(o => o !== g && Math.abs(o.x - g.x) < 120 && Math.abs(o.y - g.y) < 120)) continue;
                const pt = project(g.x, g.y, 40);
                if (!inCanvas(pt)) continue;
                return { id: g.id, n: st.loose.length, pt, gpt: goal.pt, gid: goal.id };
              }
              return null;
            }"""
        )
        if pick:
            # 清掉上一个用例可能留下的「端着的件」，免得串味
            page.evaluate("() => window.__vex3d.getState().setPending(null)")
            time.sleep(0.2)
            page.mouse.click(pick["pt"][0], pick["pt"][1])
            time.sleep(0.5)
            armed = page.evaluate(
                """() => { const s = window.__vex3d.getState();
                   return s.pending ? { kind: s.pending.item.kind, loose: !!s.pending.looseId } : null }"""
            )
            check("点场上的得分物 = 把它端起来（跟面板上的件一样）",
                  armed is not None and armed["kind"] == "pin" and armed["loose"], str(armed))
            page.mouse.click(pick["gpt"][0], pick["gpt"][1])
            time.sleep(0.7)
            placed = page.evaluate(
                """(gid) => { const s = window.__vex3d.getState();
                  return { n: s.loose.length, g: (s.stacks[gid]||[]).length,
                           goal: s.selectedGoalId, pending: !!s.pending } }""",
                pick["gid"],
            )
            check("端着的场上得分物点一下 goal 就放上去（优先于「选中 goal」）",
                  placed["g"] == 1 and placed["n"] == pick["n"] - 1
                  and placed["goal"] == pick["gid"] and not placed["pending"],
                  f"{pick['gid']}: {pick['n']} → {placed}")

            # ★ goal 上**已经有**得分物时，端着的件照样放上去（叠在摞顶）
            #   面板上的 cup（cup 能放在 pin 上）
            page.evaluate("() => window.__vex3d.getState().selectGoal(null)")
            time.sleep(0.3)
            page.locator(".palette-item").nth(4).click()   # 第 5 个 = 第一个 cup
            time.sleep(0.4)
            armed2 = page.evaluate(
                "() => { const s = window.__vex3d.getState(); return s.pending ? s.pending.item.kind : null }"
            )
            check("点面板上的件 = 把它端起来（等着点 goal 放上去）", armed2 == "cup", str(armed2))
            page.mouse.click(pick["gpt"][0], pick["gpt"][1])
            time.sleep(0.7)
            placed2 = page.evaluate(
                """(gid) => { const s = window.__vex3d.getState();
                  return { g: (s.stacks[gid]||[]).length, pending: !!s.pending } }""",
                pick["gid"],
            )
            check("goal 上已经有得分物时，端着的件照样放上去（叠在摞顶）",
                  placed2["g"] == 2 and not placed2["pending"], f"{pick['gid']} → {placed2}")

        # 散件能删：拖一个到右上角的删除方块
        loose_before = page.evaluate("() => window.__vex3d.getState().loose.length")
        loose_pt = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const r = b.domElement.getBoundingClientRect();
              // 挑一个**投影落在画布里**的散件（画布只有 ~500 px 宽，边缘的件会投到面板底下）
              for (const g of st.loose) {
                if (Math.abs(g.x) > 1900 || Math.abs(g.y) > 1900) continue;
                const v = new b.camera.position.constructor(g.x, 40, -g.y);
                v.project(b.camera);
                const pt = [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
                if (pt[0] > r.left+15 && pt[0] < r.right-15 && pt[1] > r.top+15 && pt[1] < r.bottom-15) {
                  return pt;
                }
              }
              return null;
            }"""
        )
        if loose_pt:
            page.mouse.move(loose_pt[0], loose_pt[1])
            page.mouse.down()
            page.mouse.move(loose_pt[0] + 50, loose_pt[1] + 15, steps=5)
            time.sleep(0.4)
            slot = page.evaluate(
                """() => {
                  const el = document.querySelector('.trash-slot');
                  if (!el) return null;
                  const r = el.getBoundingClientRect();
                  return {x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2};
                }"""
            )
            check("拖散件时右上角出现删除方块", slot is not None, str(slot))
            if slot:
                page.mouse.move(slot["x"], slot["y"], steps=10)
                time.sleep(0.4)
                page.mouse.up()
                time.sleep(0.5)
                loose_after = page.evaluate("() => window.__vex3d.getState().loose.length")
                check("散件能拖到右上角删除", loose_after == loose_before - 1,
                      f"{loose_before} → {loose_after}")
            else:
                page.mouse.up()
                time.sleep(0.3)

        # 散件能进 goal 的摞：空的联盟 goal 能放 pin；摞顶是 pin 时 cup 放不进去
        goal_ok = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              const g = 'g-b1';                       // 开局是空的
              const before = (st.stacks[g] || []).length;
              st.placeItem(g, { id: 'test-pin', kind: 'pin', halves: ['red','red'] });
              const mid = (window.__vex3d.getState().stacks[g] || []).length;
              st.placeItem(g, { id: 'test-pin2', kind: 'pin', halves: ['red','red'] });
              const after = (window.__vex3d.getState().stacks[g] || []).length;
              st.placeItem(g, { id: 'test-cup', kind: 'cup', halves: ['clear','gray'] });
              const afterCup = (window.__vex3d.getState().stacks[g] || []).length;
              return { before, mid, after, afterCup };
            }"""
        )
        # 空 goal → 放 pin ✅ → 再放一个 pin ❌（pin 不能叠 pin）→ 放 cup ✅（cup 能放 pin 上）
        check("散件能进 goal 的摞，且守住叠放规则（pin 不能叠 pin、cup 能放 pin 上）",
              bool(goal_ok) and goal_ok["mid"] == goal_ok["before"] + 1
              and goal_ok["after"] == goal_ok["mid"]
              and goal_ok["afterCup"] == goal_ok["after"] + 1, str(goal_ok))

        # ── 8e. 散件组：手动组合 / 手动拆分 ─────────────────
        combo = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              // 找两个单独的组：一个 cup + 一个 pin（组合起来是合法的）
              const cups = st.loose.filter(g => g.pieces.length === 1
                                   && g.pieces[0].kind === 'cup' && !g.pieces[0].axis);
              const pins = st.loose.filter(g => g.pieces.length === 1
                                   && g.pieces[0].kind === 'pin' && !g.pieces[0].axis);
              if (!cups.length || !pins.length) return null;
              return {cup: cups[0].id, pin: pins[0].id, n: st.loose.length};
            }"""
        )
        if combo:
            ok = page.evaluate(
                """(ids) => {
                  const st = window.__vex3d.getState();
                  const done = st.combineLoose(ids.cup, ids.pin);
                  const after = window.__vex3d.getState();
                  const g = after.loose.find(x => x.id === ids.cup);
                  return {done, n: after.loose.length,
                          pieces: g ? g.pieces.length : 0,
                          kinds: g ? g.pieces.map(p => p.kind) : []};
                }""",
                combo,
            )
            check("手动组合：cup + pin → 合成一组（拖一个到另一个上的效果）",
                  ok["done"] and ok["n"] == combo["n"] - 1 and ok["pieces"] == 2
                  and ok["kinds"] == ["cup", "pin"], str(ok))

            # ★ 真·拖拽手势：把一个散件**拖到**另一个散件上 → 合成一组
            gesture = page.evaluate(
                """() => {
                  const st = window.__vex3d.getState();
                  const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
                  const r = b.domElement.getBoundingClientRect();
                  const project = (x, y, z) => {
                    const v = new b.camera.position.constructor(x, z, -y);
                    v.project(b.camera);
                    return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
                  };
                  const inCanvas = (pt) => pt[0] > r.left+40 && pt[0] < r.right-40
                                        && pt[1] > r.top+40 && pt[1] < r.bottom-40;
                  const goals = (window.__goalPositions||[]).map(g => [g.pos[0], -g.pos[2]]);
                  const nearGoal = (x, y) => goals.some(g => Math.hypot(g[0]-x, g[1]-y) < 260);
                  const cups = st.loose.filter(g => g.pieces.length === 1
                                       && g.pieces[0].kind === 'cup' && !g.pieces[0].axis);
                  const pins = st.loose.filter(g => g.pieces.length === 1
                                       && g.pieces[0].kind === 'pin' && !g.pieces[0].axis);
                  for (const c of cups) {
                    if (nearGoal(c.x, c.y)) continue;
                    for (const p of pins) {
                      if (nearGoal(p.x, p.y)) continue;
                      const cp = project(c.x, c.y, 40), pp = project(p.x, p.y, 40);
                      if (!inCanvas(cp) || !inCanvas(pp)) continue;
                      if (Math.hypot(cp[0]-pp[0], cp[1]-pp[1]) < 70) continue;
                      return {cup: c.id, pin: p.id, n: st.loose.length, cp, pp};
                    }
                  }
                  return null;
                }"""
            )
            if gesture:
                page.mouse.move(gesture["pp"][0], gesture["pp"][1])
                page.mouse.down()
                page.mouse.move(gesture["pp"][0] + 20, gesture["pp"][1] + 8, steps=4)
                time.sleep(0.25)
                page.mouse.move(gesture["cp"][0], gesture["cp"][1], steps=12)
                time.sleep(0.4)
                hover = page.evaluate("() => window.__vex3d.getState().hoverLooseId")
                check("拖到另一个散件上时，鼠标下的那组被认出来", hover == gesture["cup"],
                      f"hover={hover} 目标={gesture['cup']}")
                page.mouse.up()
                time.sleep(0.5)
                merged = page.evaluate(
                    """(ids) => {
                      const st = window.__vex3d.getState();
                      const g = st.loose.find(x => x.id === ids.cup);
                      return {n: st.loose.length,
                              pieces: g ? g.pieces.length : 0,
                              kinds: g ? g.pieces.map(p => p.kind) : []};
                    }""",
                    gesture,
                )
                check("把散件拖到另一个散件上 → 真的合成一组了",
                      merged["n"] == gesture["n"] - 1 and merged["pieces"] == 2
                      and merged["kinds"] == ["cup", "pin"], str(merged))
            else:
                check("把散件拖到另一个散件上 → 真的合成一组了", False, "找不到合适的两个散件")

            # 拆分：选中它 → 右栏出现「拆分」→ 点一下 → 变回两个独立的组
            page.evaluate(
                "(id) => { const st = window.__vex3d.getState(); st.selectLoose(id); }",
                combo["cup"],
            )
            time.sleep(0.5)
            check("选中的组能拆（右栏出现「拆分」）",
                  page.locator(".act-btn", has_text="拆分").count() == 1)
            n_before_split = page.evaluate("() => window.__vex3d.getState().loose.length")
            split_pos = page.evaluate(
                "(id) => { const g = window.__vex3d.getState().loose.find(x => x.id === id);"
                " return g ? [g.x, g.y] : null; }",
                combo["cup"],
            )
            page.locator(".act-btn", has_text="拆分").click()
            time.sleep(0.6)
            split = page.evaluate(
                """(arg) => {
                  const st = window.__vex3d.getState();
                  const gone = !st.loose.some(g => g.id === arg.id);
                  // 拆出来的那几段：位置要错开（不然点哪都是压在上面的那个）
                  const near = st.loose.filter(g => Math.hypot(g.x - arg.pos[0], g.y - arg.pos[1]) < 260);
                  return {n: st.loose.length, gone, xs: near.map(g => Math.round(g.x))};
                }""",
                {"id": combo["cup"], "pos": split_pos},
            )
            check("拆分：一组 → 两个各自独立的组",
                  split["n"] == n_before_split + 1 and split["gone"],
                  f"{n_before_split} → {split['n']}（原组还在吗：{not split['gone']}）")
            check("拆开的几段错开摆（拾取范围不重叠）",
                  len(set(split["xs"])) >= 2, str(split["xs"]))

        # ★ 侧躺的 pin 拖到 cup 上 = 被拾起来**插进 cup 里**（立起来）
        # 先清空场地，摆一个 cup + 一根侧躺的 pin（旁边 350 mm）
        page.locator(".topbar button", has_text="重置").click()
        time.sleep(0.8)
        lying_case = page.evaluate(
            """() => {
              const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
              const r = b.domElement.getBoundingClientRect();
              const project = (x, y, z) => {
                const v = new b.camera.position.constructor(x, z, -y);
                v.project(b.camera);
                return [r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height];
              };
              const s2 = window.__vex3d.getState();
              const before = s2.loose.length;
              s2.setLoose([
                {id: 'cup-test', x: -600, y: 0,
                 pieces: [{id: 'cup-piece', kind: 'cup', halves: ['gray', 'clear']}]},
                {id: 'lying-test', x: -250, y: 0,
                 pieces: [{id: 'lying-piece', kind: 'pin', halves: ['red', 'blue'],
                           axis: [0, -0.966, 0.2584]}]}]);
              return {cup: 'cup-test',
                      lp: project(-250, 0, 40), cp: project(-600, 0, 40),
                      before, after: window.__vex3d.getState().loose.length};
            }"""
        )
        if lying_case:
            page.mouse.move(lying_case["lp"][0], lying_case["lp"][1])
            page.mouse.down()
            page.mouse.move(lying_case["lp"][0] + 15,
                            lying_case["lp"][1] + 6, steps=4)
            time.sleep(0.25)
            page.mouse.move(lying_case["cp"][0], lying_case["cp"][1], steps=12)
            time.sleep(0.4)
            page.mouse.up()
            time.sleep(0.6)
            ins = page.evaluate(
                """(ids) => {
                  const st = window.__vex3d.getState();
                  const g = st.loose.find(x => x.id === ids.cup);
                  return {n: st.loose.length,
                          pieces: g ? g.pieces.length : 0,
                          kinds: g ? g.pieces.map(p => p.kind) : [],
                          lying: g ? g.pieces.filter(p => p.axis).length : 0};
                }""",
                lying_case,
            )
            check("侧躺的 pin 拖到 cup 上 → 被插进 cup 里（立起来，不再是躺着的那根）",
                  ins["n"] == lying_case["after"] - 1 and ins["pieces"] == 2
                  and ins["kinds"] == ["cup", "pin"] and ins["lying"] == 0, str(ins))
        else:
            check("侧躺的 pin 拖到 cup 上 → 被插进 cup 里", False, "找不到空地")

        # 没选中得分物时，「翻转 / 拆分」都不该出现
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.selectGoal(null); st.selectLoose(null); st.selectItem(null);
            }"""
        )
        time.sleep(0.5)
        check("没选中得分物时不显示「翻转 / 拆分」按钮",
              page.locator(".act-btn").count() == 0)

        # 选中一个 goal 上放的件 → 「翻转选中件」出现
        page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              window.__vex3d.setState({ stacks: { ...st.stacks, 'g-n4': [] } });
              st.placeItem('g-n4', { id: 'flipme', kind: 'pin', halves: ['red', 'blue'] });
              st.selectGoal('g-n4');
              st.selectItem('flipme');
            }"""
        )
        time.sleep(0.5)
        check("选中得分物 → 出现「翻转选中件」",
              page.locator(".act-btn", has_text="翻转选中件").count() == 1)
        page.locator(".act-btn", has_text="翻转选中件").click()
        time.sleep(0.4)
        flipped = page.evaluate(
            "() => window.__vex3d.getState().stacks['g-n4'][0].halves.join('/')"
        )
        check("「翻转选中件」把上下两半对调", flipped == "blue/red", flipped)

        # 重置：全清
        page.locator(".topbar button", has_text="重置").click()
        time.sleep(0.8)
        after_reset = page.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              return {
                stacks: Object.values(st.stacks).flat().length,
                loose: st.loose.length,
              };
            }"""
        )
        check("重置：得分物和散件都清空",
              after_reset["stacks"] == 0 and after_reset["loose"] == 0, str(after_reset))

        # ── 9. 相机能转 ─────────────────────────────────────
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 180, cy + 60, steps=12)
        page.mouse.up()
        time.sleep(0.8)
        page.screenshot(timeout=300000, path=os.path.join(SHOTS, "06-rotated.png"))

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
