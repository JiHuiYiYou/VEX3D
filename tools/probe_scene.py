"""量一下场景里的三角形都花在哪了（摆场之后）。

    C:/Users/liuzhen/miniconda3/python.exe tools/probe_scene.py [url]

输出：renderer.info 的三角形 / draw call 总数，以及按「几何名」分组
的三角形明细（把 228 个半体按名字归并，看一眼谁最贵）。
"""

import json
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


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5173/?quality=medium"
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=ARGS)
        pg = b.new_page(viewport={"width": 1400, "height": 900})
        pg.goto(url, wait_until="networkidle", timeout=180000)
        pg.wait_for_selector("canvas")

        # 等资产到位
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

        def stats(label):
            d = pg.evaluate(
                """() => {
                  const b = window.__bridge;
                  const r = b.renderer;
                  r.info.reset();
                  r.render(b.scene, b.camera);
                  const info = r.info;
                  const byName = {};
                  b.scene.traverse(o => {
                    if (!o.isMesh || !o.geometry) return;
                    const g = o.geometry;
                    const tris = g.index ? g.index.count/3 : (g.attributes.position ? g.attributes.position.count/3 : 0);
                    const key = o.name || o.type;
                    byName[key] = byName[key] || {tris: 0, meshes: 0};
                    byName[key].tris += tris;
                    byName[key].meshes += 1;
                  });
                  return {triangles: info.render.triangles, calls: info.render.calls,
                          geometries: info.memory.geometries, textures: info.memory.textures,
                          byName};
                }"""
            )
            print(f"\n=== {label} ===")
            print(f"  rendered triangles : {d['triangles']:,}")
            print(f"  draw calls         : {d['calls']:,}")
            print(f"  geometries         : {d['geometries']:,}")
            rows = sorted(d["byName"].items(), key=lambda kv: -kv[1]["tris"])
            tot = sum(v["tris"] for v in d["byName"].values())
            print(f"  scene triangles (all meshes, incl. hidden): {tot:,}")
            for k, v in rows[:25]:
                print(f"    {k[:44]:44s} {v['tris']:9,d} tris  x{v['meshes']:4d} meshes")
            return d

        stats("empty field")

        # 摆场
        pg.evaluate(
            """() => {
              const b = document.querySelector('button');
              const btns = [...document.querySelectorAll('button')];
              const t = btns.find(x => x.textContent.includes('摆场'));
              if (t) t.click();
              return !!t;
            }"""
        )
        print("\nclicked 摆场, waiting for the scene to settle...")
        time.sleep(45)
        stats("after 摆场")
        pg.screenshot(path=os.path.join(SHOTS, "probe-top.png"))
        print("shot ->", os.path.join(SHOTS, "probe-top.png"))
        b.close()


if __name__ == "__main__":
    main()
