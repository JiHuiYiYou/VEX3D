"""两张截图的逐像素对比（减面前 / 减面后）。

    C:/Users/liuzhen/miniconda3/python.exe tools/compare_shots.py before after

对 tools/shots/tess-<tag>-*.png 逐张比：
  · 不同的像素比例
  · 差异的最大 / 平均幅度（0..255）
  · 差异热力图（存成 diff-<name>.png，方便肉眼看差异集中在哪）
"""

import os
import sys

import numpy as np
from PIL import Image

SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")


def main():
    a_tag = sys.argv[1] if len(sys.argv) > 1 else "before"
    b_tag = sys.argv[2] if len(sys.argv) > 2 else "after"
    names = [n for n in os.listdir(SHOTS)
             if n.startswith(f"tess-{a_tag}-") and n.endswith(".png")]
    for name in names:
        other = name.replace(f"tess-{a_tag}-", f"tess-{b_tag}-")
        pa = os.path.join(SHOTS, name)
        pb = os.path.join(SHOTS, other)
        if not os.path.exists(pb):
            print(f"{name}: no counterpart")
            continue
        A = np.asarray(Image.open(pa).convert("RGB"), dtype=np.int16)
        B = np.asarray(Image.open(pb).convert("RGB"), dtype=np.int16)
        if A.shape != B.shape:
            print(f"{name}: size differs {A.shape} vs {B.shape}")
            continue
        d = np.abs(A - B).max(axis=2)
        n_diff = int((d > 2).sum())
        print(f"{name:28s} pixels={d.size:8d}  changed(>2)={n_diff:8d} "
              f"({100.0*n_diff/d.size:6.3f}%)  max={d.max():3d} "
              f"mean={d.mean():6.3f}")
        # 差异热力图
        heat = np.clip(d * 6, 0, 255).astype(np.uint8)
        rgb = np.stack([heat, heat, heat], axis=-1)
        out = os.path.join(SHOTS, f"diff-{name.replace(f'tess-{a_tag}-','')}")
        Image.fromarray(rgb).save(out)
        print(f"    -> {out}")


if __name__ == "__main__":
    main()
