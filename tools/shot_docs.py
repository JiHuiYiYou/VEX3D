"""
拍 README 用的截图（docs/*.png）。

    C:/Users/liuzhen/miniconda3/python.exe tools/shot_docs.py [url]

拍的是**官方 CAD 场地**（这个 app 只有 CAD 一份几何来源，所以没有「兜底版」可拍）。
toggle.png / midfield.png 由 tools/shot_ui.py 拍。
"""

import os
import time

from playwright.sync_api import sync_playwright

ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
os.makedirs(DOCS, exist_ok=True)


def wait_field(pg, timeout=180):
    """等 CAD 资产（9 个 goal + 场地）都到位"""
    for _ in range(timeout):
        n = pg.evaluate(
            """() => {
              const s = window.__bridge && window.__bridge.scene; if (!s) return 0;
              let goals = 0, field = 0;
              s.traverse(o => {
                if (!o.isMesh) return;
                if (/276-9250-003_Master/.test(o.name)) goals++;
                if (o.name === '276-6904-001') field++;   // 地面垫
              });
              return goals >= 9 && field >= 1 ? 1 : 0;
            }"""
        )
        if n:
            return True
        time.sleep(1)
    return False


def camera(pg, pos, up=(0, 1, 0), target=(0, 0, 0)):
    pg.evaluate(
        """([pos, up, target]) => {
          const b = window.__bridge;
          b.camera.position.set(...pos);
          b.camera.up.set(...up);
          b.camera.lookAt(...target);
          b.camera.updateProjectionMatrix();
          if (b.controls) { b.controls.target.set(...target); b.controls.update(); }
          b.invalidate();
        }""",
        [list(pos), list(up), list(target)],
    )


def goal_screen_pos(pg, goal_id):
    """把某个 goal 的位置投影到屏幕坐标"""
    return pg.evaluate(
        """(gid) => {
          const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
          const cam = b.camera; const r = b.domElement.getBoundingClientRect();
          let out = null;
          s.traverse(o => {
            if (out || !o.isMesh) return;
            if (!/276-9250-003_Master/.test(o.name || '')) return;
            const g = window.__goalPositions.find(x => x.id === gid);
            if (!g) return;
            const v = new o.position.constructor(g.pos[0], g.pos[1], g.pos[2]);
            v.project(cam);
            if (v.z < 1) out = [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
          });
          return out;
        }""",
        goal_id,
    )


def project(pg, world):
    """世界坐标（three 系）→ 屏幕坐标"""
    return pg.evaluate(
        """(w) => {
          const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
          const cam = b.camera; const r = b.domElement.getBoundingClientRect();
          const v = new b.camera.position.constructor(...w);
          v.project(cam);
          return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
        }""",
        list(world),
    )


def shot(pg, name, scale=1, size=(1280, 760), clip=None):
    path = os.path.join(DOCS, name)
    pg.screenshot(path=path, clip=clip, timeout=180000)
    print("→ docs/" + name)


def main():
    url = "http://127.0.0.1:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1280, "height": 760})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")
        if not wait_field(pg):
            print("✗ CAD 资产没在预期时间内载入")
            b.close()
            return
        time.sleep(4)

        # ── overview：默认 45° 视角 ─────────────────────────
        shot(pg, "overview.png")

        # ── topdown：正上方俯视（北在上）─────────────────────
        camera(pg, (0, 5200, 0), (0, 0, -1))
        time.sleep(3)
        shot(pg, "topdown.png")

        # ── palette：点中一个 goal，左侧出调色板 ─────────────
        camera(pg, (4100, 3400, 0))
        time.sleep(2)
        pos = goal_screen_pos(pg, "g-n3")
        if pos:
            pg.mouse.click(pos[0], pos[1])
            time.sleep(1.2)
        shot(pg, "palette.png")

        # ── stacked / nesting：goal 上摞 pin → cup → pin ────
        pg.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.selectGoal('g-n3');
              st.placeItem('g-n3', { id: 'shot-1', kind: 'pin', halves: ['red', 'yellow'] });
              st.placeItem('g-n3', { id: 'shot-2', kind: 'cup', halves: ['clear', 'gray'] });
              st.placeItem('g-n3', { id: 'shot-3', kind: 'pin', halves: ['blue', 'yellow'] });
              st.selectItem(null);
            }"""
        )
        time.sleep(2)
        shot(pg, "stacked.png")

        # 近景：把相机拉到那个 goal 前面，裁一张竖的特写
        gp = pg.evaluate("() => window.__goalPositions.find(x => x.id === 'g-n3').pos")
        focus = (gp[0], 280, gp[2])
        camera(pg, (gp[0] + 500, 380, gp[2] + 500), (0, 1, 0), focus)
        time.sleep(3)
        px, py = project(pg, focus)
        clip = {
            "x": max(0, min(1280 - 480, int(px - 240))),
            "y": max(0, min(760 - 620, int(py - 310))),
            "width": 480,
            "height": 620,
        }
        shot(pg, "nesting.png", clip=clip)

        # ── dragging：拖着还没靠边（四周淡红光、没有垃圾桶）──
        camera(pg, (4100, 3400, 0))
        time.sleep(2)
        pg.evaluate("() => window.__vex3d.getState().selectGoal(null)")
        it = pg.locator(".palette-item").first
        ib = it.bounding_box()
        sx, sy = ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2
        pg.mouse.move(sx, sy)
        pg.mouse.down()
        for i in range(1, 9):
            pg.mouse.move(sx + (760 - sx) * i / 8, sy + (430 - sy) * i / 8)
            time.sleep(0.03)
        time.sleep(0.6)
        shot(pg, "dragging.png")

        # ── trash：拖到画布边缘 → 垃圾桶 ────────────────────
        for i in range(1, 11):
            pg.mouse.move(760 + (1240 - 760) * i / 10, 430)
            time.sleep(0.03)
        time.sleep(0.8)
        shot(pg, "trash.png")
        pg.mouse.up()
        time.sleep(0.5)

        b.close()

    # ── setup：官方开局布局（2× 像素密度）────────────────
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=2)
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")
        if not wait_field(pg):
            print("✗ CAD 资产没在预期时间内载入")
            b.close()
            return
        time.sleep(4)
        pg.click("text=摆场")
        time.sleep(6)
        pg.screenshot(path=os.path.join(DOCS, "setup.png"), timeout=180000)
        print("→ docs/setup.png")
        b.close()


if __name__ == "__main__":
    main()
