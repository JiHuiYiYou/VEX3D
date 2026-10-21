"""
拍一张「Pin / Cup 嵌套」的特写，用来肉眼核对叠放关系。

    C:/Users/liuzhen/miniconda3/python.exe tools/shot_stack.py [url]

做法：直接往 store 里塞一个 Pin → Cup → Pin 的摞（不走拖拽，稳），
再把相机拉到那根桩跟前拍特写。
"""

import os
import sys
import time

from playwright.sync_api import sync_playwright

ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
]
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(SHOTS, exist_ok=True)

# 场地方向 → Goal id（见 src/data/fieldSpec.ts）
GOAL_ID = "g-b2"  # 东象限的蓝方桩


def main():
    # 默认用 medium 画质：dpr 1（low 是 0.5，软渲染下会糊成马赛克）
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 760, "height": 860})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")

        # 等 9 个 Goal 的 CAD 几何到位
        for _ in range(120):
            n = pg.evaluate(
                """() => {
                  const s = window.__bridge && window.__bridge.scene; if(!s) return 0;
                  let n = 0; s.traverse(o => { if (o.isMesh && /276-9250-003_Master/.test(o.name)) n++; });
                  return n;
                }"""
            )
            if n >= 9:
                print("goals ready:", n)
                break
            time.sleep(1)
        time.sleep(4)

        # 直接塞一个 Pin → Cup → Pin 的摞
        pg.evaluate(
            """(goalId) => {
              const st = window.__vex3d.getState();
              const mk = (kind, halves) => ({ id: 'x-' + Math.random().toString(36).slice(2),
                                              kind, halves });
              st.stacks[goalId] = [
                mk('pin', ['red', 'red']),
                mk('cup', ['clear', 'gray']),
                mk('pin', ['blue', 'blue']),
              ];
              st.selectGoal(goalId);
              window.__vex3d.setState({ stacks: { ...st.stacks } });
            }""",
            GOAL_ID,
        )
        time.sleep(1.5)

        # 相机拉到那根桩跟前（水平方向贴着看，最能看出嵌套）
        # g-b2 在场地坐标 (1196.12, 598.06)，three 系是 (X, Z, −Y)
        pg.evaluate(
            """([gx, gy]) => {
              const b = window.__bridge;
              const x = gx, z = -gy;
              // ★ OrbitControls 有阻尼，会把相机拽回自己的轨道 —— 必须一起改 target
              if (b.controls) { b.controls.target.set(x, 130, z); b.controls.update(); }
              b.camera.position.set(x + 620, 230, z + 320);
              b.camera.up.set(0, 1, 0);
              b.camera.lookAt(x, 140, z);
              b.camera.updateProjectionMatrix();
              b.invalidate && b.invalidate();
            }""",
            [1196.12, 598.06],
        )
        time.sleep(4)
        pg.screenshot(path=os.path.join(SHOTS, "12-nesting.png"))
        print("done ->", os.path.join(SHOTS, "12-nesting.png"))
        b.close()


if __name__ == "__main__":
    main()
