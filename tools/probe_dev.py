#!/usr/bin/env python
"""半体的「分辨率 ↔ 误差」对照表。

    ./tools/.venv/Scripts/python.exe -u tools/probe_dev.py

参考网格 = 当前导出用的 0.3 mm / 0.5 rad。
每一行给出：三角形数、参考网格顶点到粗网格的最大 / 平均偏差（mm）。

⚠️ 每次都用**重新载入的 shape**：OCCT 的 BRepMesh_IncrementalMesh 不会重画
已经画过三角化的 shape，所以同一个 shape 对象改 deflection 是没用的
（这就是 tools/tessellate.py 里要补 Clean 的原因）。
"""

from __future__ import annotations

import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import field_analysis as fa  # noqa: E402
import steplib  # noqa: E402
import tessellate  # noqa: E402

REF_LIN, REF_ANG = 0.3, 0.5


def _seg_dist(p, p0, p1):
    u = p - p0
    w = p1 - p0
    denom = np.maximum(np.einsum("ptj,ptj->pt", w, w), 1e-20)
    t = np.clip(np.einsum("ptj,ptj->pt", u, w) / denom, 0.0, 1.0)
    q = p0 + t[:, :, None] * w
    return np.linalg.norm(p - q, axis=2)


def _point_tri_dist(pts, tri):
    a, b, c = tri[0][None, :, :], tri[1][None, :, :], tri[2][None, :, :]

    def _d(x, y):
        return np.einsum("ptj,ptj->pt", x, y)

    ab, ac = b - a, c - a
    ap = pts[:, None, :] - a
    d1, d2 = _d(ab, ap), _d(ac, ap)
    bp = pts[:, None, :] - b
    d3, d4 = _d(ab, bp), _d(ac, bp)
    cp = pts[:, None, :] - c
    d5, d6 = _d(ab, cp), _d(ac, cp)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = va + vb + vc
    denom = np.where(np.abs(denom) < 1e-20, 1e-20, denom)
    v = np.clip(vb / denom, 0.0, 1.0)
    w = np.clip(vc / denom, 0.0, 1.0)
    q = a + v[:, :, None] * (b - a) + w[:, :, None] * (c - a)
    d = np.linalg.norm(pts[:, None, :] - q, axis=2)
    d = np.minimum(d, _seg_dist(pts[:, None, :], a, b))
    d = np.minimum(d, _seg_dist(pts[:, None, :], a, c))
    d = np.minimum(d, _seg_dist(pts[:, None, :], b, c))
    return d.min(axis=1)


def deviation(ref_v, coarse_v, coarse_t, sample=6000):
    """参考网格的顶点到粗网格的最大 / 99% / 平均偏差（mm）。"""
    if len(ref_v) > sample:
        ref_v = ref_v[::int(np.ceil(len(ref_v) / sample))]
    tri = coarse_v[coarse_t]
    d = np.empty(len(ref_v))
    for i in range(0, len(ref_v), 512):
        d[i:i + 512] = _point_tri_dist(ref_v[i:i + 512], tri.transpose(1, 0, 2))
    return float(d.max()), float(np.percentile(d, 99)), float(d.mean())


def main():
    model = fa.Model()
    parts = {}
    for name, colour in fa.HALF_PARTS.items():
        for k, v in model.parts.items():
            if v["name"] == name:
                parts[colour] = v["index"]

    grid = []
    for lin in (0.3, 0.6, 1.0, 1.5, 2.0):
        for ang in (0.35, 0.5, 0.65, 0.8, 1.0):
            grid.append((lin, ang))

    for colour in ("red", "clear"):
        idx = parts[colour]
        ref_shape = steplib.load_brep("%03d" % idx)
        rv, _rn, _rt = tessellate.triangulate(ref_shape, REF_LIN, REF_ANG)
        print(f"\n=== half_{colour}: reference {REF_LIN} mm / {REF_ANG} rad "
              f"= {len(_rt)} tris ===", flush=True)
        print(f"    {'lin':>5s} {'ang':>5s} {'tris':>7s} {'max':>7s} {'p99':>7s} "
              f"{'mean':>7s}", flush=True)
        for lin, ang in grid:
            shp = steplib.load_brep("%03d" % idx)
            t0 = time.time()
            cv, _cn, ct = tessellate.triangulate(shp, lin, ang)
            dmax, d99, dmean = deviation(rv, cv, ct)
            print(f"    {lin:5.2f} {ang:5.2f} {len(ct):7d} {dmax:7.3f} "
                  f"{d99:7.3f} {dmean:7.3f}  ({time.time()-t0:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
