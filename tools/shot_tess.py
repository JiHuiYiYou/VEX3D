"""半体减面前后的观感对比截图。

    C:/Users/liuzhen/miniconda3/python.exe tools/shot_tess.py <tag>

拍三张：
  * tess-<tag>-top.png    摆场后的俯视图（整体）
  * tess-<tag>-pin.png    一根**站立**的 pin 的近景（红装填区 setup-38）
  * tess-<tag>-cup.png    一个**站立**的 cup 的近景（场上 setup-63）

近景的相机距离 ~330 mm（app 的 minDistance 是 300），所以一个 80 mm 的
半体在画面里大约 250 px —— 减面露不露馅，看这两张就知道。
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

# 场地坐标 (x, y) → three 坐标 (x, z, −y)
TARGETS = {
    # setup-38：一根站着的 pin（黄/红），红方装填区
    "pin": (-2350.0, -40.25, 82.0),
    # setup-63：一个站着的 cup（灰/透明），中场
    "cup": (-598.06, 0.0, 82.0),
    # g-b2：蓝方 goal（东象限），看 goal 自己的表面
    "goal": (1196.12, 598.06, 60.0),
}


def look(pg, fx, fy, fz, dist=330, azim=0.9, elev=0.55):
    """把相机放到场地坐标 (fx, fy, fz) 附近（three 系）。"""
    pg.evaluate(
        """([x, z, y, dist, azim, elev]) => {
          const b = window.__bridge;
          const tx = x, ty = z, tz = -y;
          const r = dist;
          const cx = tx + r * Math.cos(elev) * Math.sin(azim);
          const cy = ty + r * Math.sin(elev);
          const cz = tz + r * Math.cos(elev) * Math.cos(azim);
          if (b.controls) { b.controls.target.set(tx, ty, tz); b.controls.update(); }
          b.camera.position.set(cx, cy, cz);
          b.camera.up.set(0, 1, 0);
          b.camera.lookAt(tx, ty, tz);
          b.camera.updateProjectionMatrix();
          b.invalidate && b.invalidate();
        }""",
        [fx, fz, fy, dist, azim, elev],
    )
    time.sleep(3.0)


def main():
    tag = sys.argv[1] if len(sys.argv) > 1 else "cur"
    url = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 900, "height": 900})
        pg.goto(url, wait_until="networkidle", timeout=180000)
        pg.wait_for_selector("canvas")

        for _ in range(180):
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

        # 摆场
        pg.evaluate(
            """() => {
              const btns = [...document.querySelectorAll('button')];
              const t = btns.find(x => x.textContent.includes('摆场'));
              if (t) t.click();
            }"""
        )
        print("摆场 clicked; settling (软件渲染一帧要好几秒)...", flush=True)
        time.sleep(50)

        # 1) 俯视全景
        pg.evaluate(
            """() => {
              const b = window.__bridge;
              if (b.controls) { b.controls.target.set(0, 0, 0); b.controls.update(); }
              b.camera.position.set(0, 6600, 0.01);
              b.camera.up.set(0, 0, -1);
              b.camera.lookAt(0, 0, 0);
              b.camera.updateProjectionMatrix();
              b.invalidate && b.invalidate();
            }"""
        )
        time.sleep(8)
        pg.screenshot(path=os.path.join(SHOTS, f"tess-{tag}-top.png"))
        print("shot top", flush=True)

        # 2) 近景：pin / cup
        for name, (fx, fy, fz) in TARGETS.items():
            look(pg, fx, fy, fz, dist=(430 if name == "goal" else 330))
            pg.screenshot(path=os.path.join(SHOTS, f"tess-{tag}-{name}.png"))
            print("shot", name, flush=True)

        b.close()


if __name__ == "__main__":
    main()
