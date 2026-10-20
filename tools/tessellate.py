"""Tessellation of OCCT shapes into numpy triangle soups.

Per-face vertex duplication is preserved on purpose: OCCT keeps a separate
Poly_Triangulation per face, so hard edges stay hard when we accumulate
normals per face.
"""

from __future__ import annotations

import numpy as np


def triangulate(shape, lin_deflection=0.8, ang_deflection=0.35, relative=False):
    """Mesh ``shape``; return (verts[N,3], normals[N,3], tris[M,3]).

    Coordinates are in the shape's own coordinate system (the shape's own
    TopLoc_Location is *not* applied -- callers transform explicitly).
    """
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopLoc import TopLoc_Location

    BRepMesh_IncrementalMesh(shape, lin_deflection, relative, ang_deflection, True)

    verts = []
    normals = []
    tris = []
    v_off = 0

    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        face = TopoDS.Face_s(exp.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face, loc)
        if tri is None:
            exp.Next()
            continue

        trsf = loc.Transformation()
        nb_nodes = tri.NbNodes()
        nb_tris = tri.NbTriangles()
        if nb_nodes == 0 or nb_tris == 0:
            exp.Next()
            continue

        pts = np.empty((nb_nodes, 3), dtype=np.float64)
        for i in range(1, nb_nodes + 1):
            p = tri.Node(i).Transformed(trsf)
            pts[i - 1] = (p.X(), p.Y(), p.Z())

        idx = np.empty((nb_tris, 3), dtype=np.int64)
        for i in range(1, nb_tris + 1):
            t = tri.Triangle(i)
            n1, n2, n3 = t.Get()
            idx[i - 1] = (n1 - 1, n2 - 1, n3 - 1)

        if face.Orientation() == TopAbs_REVERSED:
            idx = idx[:, ::-1]

        # area-weighted vertex normals, computed per face
        p0 = pts[idx[:, 0]]
        p1 = pts[idx[:, 1]]
        p2 = pts[idx[:, 2]]
        fn = np.cross(p1 - p0, p2 - p0)
        nrm = np.zeros((nb_nodes, 3), dtype=np.float64)
        for k in range(3):
            np.add.at(nrm, idx[:, k], fn)
        ln = np.linalg.norm(nrm, axis=1)
        bad = ln < 1e-12
        if bad.any():
            nrm[bad] = fn[: bad.sum()][: len(nrm[bad])] if len(fn) >= bad.sum() else 0.0
        ln = np.linalg.norm(nrm, axis=1)
        ok = ln > 1e-12
        nrm[ok] /= ln[ok, None]
        nrm[~ok] = (0.0, 0.0, 1.0)

        verts.append(pts)
        normals.append(nrm)
        tris.append(idx + v_off)
        v_off += nb_nodes
        exp.Next()

    if not verts:
        return (np.zeros((0, 3), np.float32), np.zeros((0, 3), np.float32),
                np.zeros((0, 3), np.int32))
    return (np.concatenate(verts).astype(np.float32),
            np.concatenate(normals).astype(np.float32),
            np.concatenate(tris).astype(np.int32))


def transform_mesh(verts, normals, tris, M):
    """Apply a 4x4 rigid transform to a mesh; returns new (verts, normals, tris)."""
    R = M[:3, :3]
    t = M[:3, 3]
    v = verts @ R.T + t
    n = normals @ R.T
    ln = np.linalg.norm(n, axis=1)
    ok = ln > 1e-12
    n[ok] /= ln[ok, None]
    return v.astype(np.float32), n.astype(np.float32), tris
