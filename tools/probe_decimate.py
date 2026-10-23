#!/usr/bin/env python
"""半体减面：三角形数 ↔ 误差 对照表。

    ./tools/.venv/Scripts/python.exe -u tools/probe_decimate.py

对每个半体（pin / cup）跑一串误差上限，输出：
  · 简化后的三角形数
  · 原网格顶点到新网格的偏差（max / p99 / mean，mm）
  · **轮廓误差**：新网格在各个高度上的最大半径 vs 原网格 —— 观众能看见的
    就是这一条（剪影多边形化）
  · 体积变化（sanity check）
"""

from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import decimate  # noqa: E402
import field_analysis as fa  # noqa: E402
import steplib  # noqa: E402
import tessellate  # noqa: E402

ERRORS = (0.03, 0.05, 0.08, 0.10, 0.13, 0.16, 0.20, 0.30)


def volume(v, t):
    p0 = v[t[:, 0]].astype(np.float64)
    p1 = v[t[:, 1]].astype(np.float64)
    p2 = v[t[:, 2]].astype(np.float64)
    return float(np.sum(np.einsum("ij,ij->i", np.cross(p0, p1), p2)) / 6.0)


def radius_profile(v, t, axis=2, nbins=60):
    """按高度分箱，每箱的最大半径（用来量剪影）。"""
    p = v[t].reshape(-1, 3)
    z = p[:, axis]
    r = np.linalg.norm(p[:, :2], axis=1)
    lo, hi = float(z.min()), float(z.max())
    edges = np.linspace(lo, hi, nbins + 1)
    prof = np.full(nbins, np.nan)
    for i in range(nbins):
        m = (z >= edges[i]) & (z < edges[i + 1])
        if m.any():
            prof[i] = r[m].max()
    return edges, prof


def profile_delta(v0, t0, v1, t1):
    """两个网格的半径轮廓差（mm）：正 = 新网格更胖。"""
    e0, p0 = radius_profile(v0, t0)
    e1, p1 = radius_profile(v1, t1)
    d = []
    for i in range(len(p0)):
        if np.isnan(p0[i]) or np.isnan(p1[i]):
            continue
        d.append(abs(p1[i] - p0[i]))
    return (max(d) if d else 0.0, float(np.mean(d)) if d else 0.0)


def main():
    model = fa.Model()
    parts = {}
    for name, colour in fa.HALF_PARTS.items():
        for k, v in model.parts.items():
            if v["name"] == name:
                parts[colour] = v["index"]

    for colour in ("red", "clear"):
        idx = parts[colour]
        shp = steplib.load_brep("%03d" % idx)
        v, n, t = tessellate.triangulate(shp, 0.3, 0.5)
        v0 = volume(v, t)
        print(f"\n=== half_{colour}: {len(t)} tris, volume {v0:.1f} mm^3 ===")
        print(f"    {'err':>6s} {'tris':>7s} {'%':>6s} {'maxdev':>8s} {'p99dev':>8s} "
              f"{'mean':>8s} {'silhouette':>10s} {'dVol%':>8s} {'time':>6s}", flush=True)
        for err in ERRORS:
            t0 = time.time()
            v2, n2, t2 = decimate.simplify(v, n, t, max_error=err, target_tris=1)
            dmax, d99, dmean = decimate.measure_deviation(v, v2, t2)
            smax, smean = profile_delta(v, t, v2, t2)
            v1 = volume(v2, t2)
            print(f"    {err:6.2f} {len(t2):7d} {100*len(t2)/len(t):6.1f} "
                  f"{dmax:8.3f} {d99:8.3f} {dmean:8.3f} {smax:10.3f} "
                  f"{100*(v1-v0)/v0:8.3f} {time.time()-t0:5.1f}s", flush=True)


if __name__ == "__main__":
    main()
