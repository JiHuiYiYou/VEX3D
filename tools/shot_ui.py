"""
拍 UI 截图（README 用）：左侧的 toggle 设置面板、场上的 toggle 颜色、中场的机器人数。

    C:/Users/liuzhen/miniconda3/python.exe tools/shot_ui.py [url]
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


def toggle_points(pg):
    return pg.evaluate(
        """() => {
          const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
          const cam = b.camera; const r = b.domElement.getBoundingClientRect();
          const out = [];
          s.traverse(o => {
            if (!o.isMesh || !/9250-023/i.test(o.name || '')) return;
            o.geometry.computeBoundingBox();
            const c = o.geometry.boundingBox.getCenter(new o.position.constructor());
            const v = c.clone().project(cam);
            if (v.z < 1) out.push([r.left+(v.x+1)/2*r.width, r.top+(1-v.y)/2*r.height]);
          });
          return out;
        }"""
    )


def main():
    url = "http://127.0.0.1:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")
        time.sleep(12)

        # ① 左侧的 toggle 设置 + 场上的 toggle 颜色
        pg.evaluate(
            """() => {
              const st = window.__vex3d.getState();
              st.setToggle('top', 'red');
              st.setToggle('right', 'blue');
              st.setToggle('left', 'red');
              st.setToggle('bottom', 'yellow');
            }"""
        )
        time.sleep(1.0)
        pts = toggle_points(pg)
        if pts:
            pg.mouse.click(pts[0][0], pts[0][1])
            time.sleep(0.8)
        pg.screenshot(path=os.path.join(DOCS, "toggle.png"))
        print("→ docs/toggle.png")

        # ② 中场：左侧的机器人数
        pg.evaluate("() => window.__vex3d.getState().selectGoal('g-center')")
        time.sleep(0.8)
        pg.screenshot(path=os.path.join(DOCS, "midfield.png"))
        print("→ docs/midfield.png")

        b.close()


if __name__ == "__main__":
    main()
