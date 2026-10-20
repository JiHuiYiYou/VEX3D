"""等 CAD 资产全部载入后再截图（tools/verify_ui.py 的截图在资产载入前就拍了）。"""
import os, sys, time
from playwright.sync_api import sync_playwright

ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(SHOTS, exist_ok=True)

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/?quality=low"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1280, "height": 760})
        pg.goto(url, wait_until="networkidle", timeout=120000)
        pg.wait_for_selector("canvas")
        # 等 9 个 Goal 的 CAD 几何都到位
        for _ in range(120):
            n = pg.evaluate("""() => {
              const s = window.__bridge && window.__bridge.scene; if(!s) return 0;
              let n = 0; s.traverse(o => { if (o.isMesh && /276-9250-003_Master/.test(o.name)) n++; });
              return n;
            }""")
            if n >= 9:
                print("goals ready:", n); break
            time.sleep(1)
        time.sleep(4)
        pg.screenshot(path=os.path.join(SHOTS, "10-iso.png"))

        # 放两个件上去（Pin + Cup），顺便看看叠层的样子
        # 直接把某个 Goal 的世界坐标投影到屏幕，比盲扫准
        found = None
        for cand in pg.evaluate("""() => {
          const b = window.__bridge; const s = b.scene; s.updateMatrixWorld(true);
          const cam = b.camera; const r = b.domElement.getBoundingClientRect();
          const out = [];
          s.traverse(o => {
            if (!o.isMesh || !/276-9250-003_Master/.test(o.name || '')) return;
            const v = o.getWorldPosition(new o.position.constructor());
            v.project(cam);
            if (v.z < 1) out.push([r.left + (v.x+1)/2*r.width, r.top + (1-v.y)/2*r.height]);
          });
          return out;
        }"""):
            px, py = cand
            pg.mouse.click(px, py)
            time.sleep(0.2)
            if pg.locator(".palette-item").count() == 5:
                found = (px, py)
                break
        if found:
            for idx in (0, 4):
                it = pg.locator(".palette-item").nth(idx)
                ib = it.bounding_box()
                sx, sy = ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2
                pg.mouse.move(sx, sy)
                pg.mouse.down()
                for i in range(1, 9):
                    t = i / 8
                    pg.mouse.move(sx + (found[0] - sx) * t, sy + (found[1] - sy) * t)
                    time.sleep(0.03)
                pg.mouse.up()
                time.sleep(1.2)
            time.sleep(4)
            pg.screenshot(path=os.path.join(SHOTS, "10b-placed.png"))
        # 俯视
        pg.evaluate("""() => {
          const b = window.__bridge;
          b.camera.position.set(0, 5200, 0); b.camera.up.set(0,0,-1);
          b.camera.lookAt(0,0,0); b.camera.updateProjectionMatrix(); b.invalidate();
        }""")
        time.sleep(6)
        pg.screenshot(path=os.path.join(SHOTS, "11-top.png"))
        print("done")
        b.close()

if __name__ == "__main__":
    main()
