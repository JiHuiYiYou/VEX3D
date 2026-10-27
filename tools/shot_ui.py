"""
拍 UI 截图（README 用）：场上的 toggle 颜色、右栏常驻的中场机器人数。

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


def main():
    url = "http://localhost:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")
        time.sleep(12)

        # ① 场上的 toggle 颜色（围栏上那 4 根条 + 区域染色）
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
        pg.screenshot(path=os.path.join(DOCS, "toggle.png"))
        print("→ docs/toggle.png")

        # ② 中场：右栏常驻的机器人数
        pg.evaluate("() => window.__vex3d.getState().selectGoal('g-center')")
        time.sleep(0.8)
        pg.screenshot(path=os.path.join(DOCS, "midfield.png"))
        print("→ docs/midfield.png")

        b.close()


if __name__ == "__main__":
    main()
