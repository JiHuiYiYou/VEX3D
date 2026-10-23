#!/usr/bin/env python
"""Tessellation probe: how many triangles do the scoring-object halves cost,
and how much shape is lost when the deflection is relaxed?

Run from the project root:

    ./tools/.venv/Scripts/python.exe -u tools/probe_tess.py

It answers three questions:
  1. how many triangles does one half have right now (and per face)?
  2. how does the triangle count react to (linear deflection, angular
     deflection)?
  3. how far does the coarse mesh deviate from the fine one?  (the fine
     mesh's vertices are projected onto the coarse mesh -> max deviation
     in mm; that is the number that decides whether the reduction is
     visible on screen)
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

# The reference is the mesh the app loads today (0.3 mm): the question is
# "does the coarse mesh differ from what we already ship?".
REF_LIN = 0.3
REF_ANG = 0.5
MAX_REF_POINTS = 6000          # keep the comparison affordable


# --------------------------------------------------------------------------
# point -> triangle distance
# --------------------------------------------------------------------------
def _seg_dist(p, p0, p1):
    """Distance from points ``p`` to the segments p0-p1 (broadcasting)."""
    u = p - p0
    w = p1 - p0
    denom = np.maximum(np.einsum("ptj,ptj->pt", w, w), 1e-20)
    t = np.clip(np.einsum("ptj,ptj->pt", u, w) / denom, 0.0, 1.0)
    q = p0 + t[:, :, None] * w
    return np.linalg.norm(p - q, axis=2)


def _point_tri_dist(pts, tri):
    """Distance from each point to one triangle (broadcasting)."""
    a = tri[0][None, :, :]
    b = tri[1][None, :, :]
    c = tri[2][None, :, :]

    def _d(x, y):
        return np.einsum("ptj,ptj->pt", x, y)

    ab = b - a
    ac = c - a
    ap = pts[:, None, :] - a
    d1 = _d(ab, ap)
    d2 = _d(ac, ap)
    bp = pts[:, None, :] - b
    d3 = _d(ab, bp)
    d4 = _d(ac, bp)
    cp = pts[:, None, :] - c
    d5 = _d(ab, cp)
    d6 = _d(ac, cp)

    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    denom = va + vb + vc
    denom = np.where(np.abs(denom) < 1e-20, 1e-20, denom)
    v = np.clip(vb / denom, 0.0, 1.0)
    w = np.clip(vc / denom, 0.0, 1.0)
    q = a + v[:, :, None] * (b - a) + w[:, :, None] * (c - a)
    d_bary = np.linalg.norm(pts[:, None, :] - q, axis=2)

    # the closest point of a triangle is either inside it or on an edge;
    # the min over the (possibly outside) barycentric point and the three
    # edges is exact for a convex triangle.
    d = d_bary
    d = np.minimum(d, _seg_dist(pts[:, None, :], a, b))
    d = np.minimum(d, _seg_dist(pts[:, None, :], a, c))
    d = np.minimum(d, _seg_dist(pts[:, None, :], b, c))
    return d.min(axis=1)


def deviation(ref_v, coarse_v, coarse_t, band=None):
    """Max / 99th-percentile distance from the reference vertices to the
    coarse mesh (mm).

    The search is bucketed along Z: a query point can only be close to
    triangles whose Z range reaches it, so only nearby buckets are tested.
    """
    if len(ref_v) > MAX_REF_POINTS:
        step = int(np.ceil(len(ref_v) / MAX_REF_POINTS))
        ref_v = ref_v[::step]
    tri = coarse_v[coarse_t]
    zlo = tri[:, :, 2].min(axis=1)
    zhi = tri[:, :, 2].max(axis=1)
    if band is None:
        band = max(1.0, float(np.percentile(zhi - zlo, 95)) * 2.0)
    lo = float(zlo.min()) - band
    hi = float(zhi.max()) + band
    nb = max(1, int(np.ceil((hi - lo) / band)))
    edges = np.linspace(lo, hi, nb + 1)

    # bucket the triangles by the Z span they cover
    buckets = [[] for _ in range(nb)]
    for i in range(len(tri)):
        i0 = int(np.clip(np.searchsorted(edges, zlo[i], "right") - 1, 0, nb - 1))
        i1 = int(np.clip(np.searchsorted(edges, zhi[i], "right") - 1, 0, nb - 1))
        for k in range(i0, i1 + 1):
            buckets[k].append(i)

    out = np.full(len(ref_v), np.inf)
    for bi, idxs in enumerate(buckets):
        if not idxs:
            continue
        sel = np.asarray(idxs)
        zc = ref_v[:, 2]
        near = np.where((zc >= edges[bi] - band) & (zc <= edges[bi + 1] + band))[0]
        if len(near) == 0:
            continue
        d = _point_tri_dist(ref_v[near], tri[sel].transpose(1, 0, 2))
        out[near] = np.minimum(out[near], d)
    good = np.isfinite(out)
    if not good.all():
        # fall back to the full brute force for the few points that no
        # bucket covered (should not happen, but never report a wrong max)
        rest = np.where(~good)[0]
        d = _point_tri_dist(ref_v[rest], tri.transpose(1, 0, 2))
        out[rest] = d.min(axis=1)
    return float(out.max()), float(np.percentile(out, 99))


def half_parts(model):
    out = {}
    for name, colour in fa.HALF_PARTS.items():
        for k, v in model.parts.items():
            if v["name"] == name:
                out[colour] = v["index"]
                break
    return out


def face_breakdown(shp):
    """(triangles, nodes) per face of a shape, worst first."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopLoc import TopLoc_Location

    rows = []
    exp = TopExp_Explorer(shp, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(f, loc)
        if tri is not None and tri.NbTriangles():
            rows.append((tri.NbTriangles(), tri.NbNodes()))
        exp.Next()
    rows.sort(reverse=True)
    return rows


SWEEP = (
    (0.3, 0.5), (0.4, 0.5), (0.5, 0.5), (0.6, 0.5), (0.8, 0.5),
    (1.0, 0.5), (1.2, 0.5), (1.5, 0.5), (2.0, 0.5), (3.0, 0.5),
    (1.0, 0.8), (1.0, 1.2), (1.5, 0.8), (2.0, 0.8), (2.0, 1.2),
    (3.0, 1.2),
)


def main():
    t0 = time.time()
    model = fa.Model()
    parts = half_parts(model)
    print(f"half prototypes: {parts}", flush=True)

    # ---- baseline: what the app loads right now -----------------------
    print("\n=== baseline (DEFL_HALF = 0.3 mm, ANG = 0.5 rad) ===", flush=True)
    for colour, idx in parts.items():
        v, n, t = steplib.mesh_at(model, idx, 0.3, 0.5)
        print(f"  half_{colour:7s} tris={len(t)//3:7d} verts={len(v):7d}", flush=True)

    # ---- where do the triangles live? --------------------------------
    print("\n=== per-face triangle count (0.3 mm) ===", flush=True)
    for colour in ("red", "clear"):
        idx = parts[colour]
        shp = model.brep(idx)
        rows = face_breakdown(shp)
        print(f"  half_{colour}: {len(rows)} faces, {sum(r[0] for r in rows)} tris",
              flush=True)
        for ntri, nnode in rows[:12]:
            print(f"     face: {ntri:6d} tris / {nnode:6d} nodes", flush=True)

    # ---- sweep: triangle counts (fast) -------------------------------
    print("\n=== sweep: triangle count vs deflection ===", flush=True)
    for colour in ("red", "clear"):
        idx = parts[colour]
        shp = model.brep(idx)
        print(f"\n  --- half_{colour} ---", flush=True)
        for lin, ang in SWEEP:
            t1 = time.time()
            cv, cn, ct = tessellate.triangulate(shp, lin, ang)
            print(f"    lin={lin:5.2f} ang={ang:4.2f}  tris={len(ct)//3:8d} "
                  f"verts={len(cv):8d}   ({time.time()-t1:.1f}s)", flush=True)

    # ---- deviation for a few finalists -------------------------------
    print("\n=== deviation from the 0.3 mm reference ===", flush=True)
    for colour in ("red", "clear"):
        idx = parts[colour]
        shp = model.brep(idx)
        rv, _rn, _rt = tessellate.triangulate(shp, REF_LIN, REF_ANG)
        print(f"\n  --- half_{colour} ---", flush=True)
        print(f"    {'lin':>6s} {'ang':>6s} {'tris':>8s} {'maxdev':>8s} "
              f"{'p99dev':>8s} {'meandev':>8s}", flush=True)
        for lin, ang in ((0.3, 0.5), (0.8, 0.5), (1.0, 0.5), (1.2, 0.5),
                         (1.5, 0.5), (2.0, 0.5), (1.5, 0.8), (2.0, 0.8)):
            t1 = time.time()
            cv, cn, ct = tessellate.triangulate(shp, lin, ang)
            dmax, d99 = deviation(rv, cv, ct)
            print(f"    {lin:6.2f} {ang:6.2f} {len(ct)//3:8d} {dmax:8.3f} "
                  f"{d99:8.3f} {'':8s}   ({time.time()-t1:.1f}s)", flush=True)

    print(f"\nTOTAL {time.time()-t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
