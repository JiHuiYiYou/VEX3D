"""Shared STEP/XCAF helpers for the VEX3D field pipeline.

Everything in here is pure OCCT/OCP + numpy. No third-party deps beyond
``OCP`` and ``numpy`` (both already in tools/.venv).

Key concepts
------------
XCAF tree
    The STEP assembly becomes a tree of *labels* in a TDocStd_Document:

        free shape (root prototype)
          └── component labels (references, one per instance)
                └── referred prototype (assembly or leaf)

    A component label carries a ``TopLoc_Location`` = the placement of the
    referred prototype *inside the parent assembly's frame*.  The world
    transform of an instance is therefore the **product** of every
    ``TopLoc_Location`` from the root down to that instance.

    Getting this wrong silently misplaces everything, so this module
    composes 4x4 matrices with numpy (unambiguous order) instead of relying
    on ``TopLoc_Location`` multiplication semantics, and
    ``tools/extract_field.py`` cross-checks the result against the game
    manual's goal table.

Caching
    Reading + transferring the 126 MB STEP takes ~11 minutes and several GB
    of RAM.  The transferred XCAF document is therefore cached to disk with
    ``BinXCAFDrivers`` so that later runs (measurement, export) take seconds.
"""

from __future__ import annotations

import json
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEP_REL = os.path.join("fieldcad", "276-9250-000 (2026-04-26).STEP")
STEP_PATH = os.path.join(ROOT, STEP_REL)
CACHE_DIR = os.path.join(ROOT, "tools", "_cache")
XCAF_CACHE = os.path.join(CACHE_DIR, "field.xcaf")
ASSET_DIR = os.path.join(ROOT, "public", "assets")


# --------------------------------------------------------------------------
# document loading / caching
# --------------------------------------------------------------------------
def _new_doc():
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDocStd import TDocStd_Document
    from OCP.XCAFApp import XCAFApp_Application

    doc = TDocStd_Document(TCollection_ExtendedString("BinXCAF"))
    app = XCAFApp_Application.GetApplication_s()
    app.NewDocument(TCollection_ExtendedString("BinXCAF"), doc)
    return doc


def read_step(path: str = STEP_PATH, progress=print):
    """Read + transfer the STEP into an XCAF document (slow: ~11 min)."""
    from OCP.STEPCAFControl import STEPCAFControl_Reader

    t0 = time.time()
    doc = _new_doc()

    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    reader.SetLayerMode(True)
    reader.SetMatMode(True)
    reader.SetPropsMode(True)

    t = time.time()
    status = reader.ReadFile(path)
    progress(f"  ReadFile  {time.time()-t:7.1f}s  status={status}")
    from OCP.IFSelect import IFSelect_RetDone

    if status != IFSelect_RetDone:
        raise RuntimeError(f"STEP read failed: {status}")

    t = time.time()
    ok = reader.Transfer(doc)
    progress(f"  Transfer  {time.time()-t:7.1f}s  ok={ok}")
    if not ok:
        raise RuntimeError("STEP transfer failed")
    progress(f"  total     {time.time()-t0:7.1f}s")
    return doc


def save_doc(doc, path: str = XCAF_CACHE):
    """Persist the XCAF document so later runs skip the 11-minute read."""
    from OCP.BinXCAFDrivers import BinXCAFDrivers
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDocStd import TDocStd_Application

    os.makedirs(os.path.dirname(path), exist_ok=True)
    app = TDocStd_Application.GetApplication_s()
    BinXCAFDrivers.DefineFormat_s(app)
    ok = app.Save(doc, TCollection_ExtendedString(path))
    if not ok:
        raise RuntimeError(f"failed to save XCAF cache to {path}")
    return path


def restore_doc(path: str = XCAF_CACHE):
    """Reload a cached XCAF document (fast)."""
    from OCP.BinXCAFDrivers import BinXCAFDrivers
    from OCP.TCollection import TCollection_ExtendedString
    from OCP.TDocStd import TDocStd_Application

    app = TDocStd_Application.GetApplication_s()
    BinXCAFDrivers.DefineFormat_s(app)
    doc = TDocStd_Application.Open(TCollection_ExtendedString(path), app)
    return doc


def get_doc(step_path: str = STEP_PATH, cache_path: str = XCAF_CACHE,
            use_cache: bool = True, progress=print):
    """Return (doc, from_cache)."""
    if use_cache and os.path.exists(cache_path):
        progress(f"  restoring XCAF cache {os.path.relpath(cache_path, ROOT)}")
        t = time.time()
        doc = restore_doc(cache_path)
        progress(f"  restored in {time.time()-t:.1f}s")
        return doc, True
    doc = read_step(step_path, progress=progress)
    if cache_path:
        progress("  saving XCAF cache ...")
        save_doc(doc, cache_path)
    return doc, False


# --------------------------------------------------------------------------
# our own cache format
#
# OCCT's TDocStd_Application::Save is broken in this build (PCDM_SS_Failure),
# so the cache is written by hand:
#
#   tree.json        placed tree: every node's name, world matrix, parent
#   parts.json       per-prototype metadata: bbox, face census, mesh file
#   meshes.npz       per-prototype tessellation (verts / normals / tris)
#   brep/<i>.brep    per-prototype BRep, for face-level analysis
# --------------------------------------------------------------------------
CACHE_TREE = "tree.json"
CACHE_PARTS = "parts.json"
CACHE_MESH = "meshes.npz"
CACHE_BREP = "brep"


def _safe_key(name: str, i: int) -> str:
    return f"{i:03d}"


def build_cache(doc, cache_dir: str = CACHE_DIR, lin=0.8, ang=0.35,
                progress=print, do_mesh=True) -> str:
    """Walk the STEP document and write the on-disk cache.

    Written in two stages so a failure late in the run does not throw away
    the expensive STEP read:
      1. tree.json + parts.json + brep/<i>.brep   (fast)
      2. meshes.npz                                (slower)
    """
    from OCP.BRepTools import BRepTools
    from OCP.XCAFDoc import XCAFDoc_DocumentTool

    os.makedirs(os.path.join(cache_dir, CACHE_BREP), exist_ok=True)
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    protos, roots = build_tree(shape_tool, progress=progress)
    progress(f"  prototypes: {len(protos)}")

    # stable prototype ordering.  NB: two distinct prototypes can share the
    # same product NAME (the file really contains two "276-9250-80x_Neutral-
    # Neutral" products), so prototypes are keyed by label tag, never by name.
    proto_list = sorted(protos.values(), key=lambda p: (p.name, p.label.Tag()))
    for i, p in enumerate(proto_list):
        p.index = i

    # ---- stage 1: tree + breps -----------------------------------------
    parts = {}
    for i, p in enumerate(proto_list):
        shape = p.shape
        key = _safe_key(p.name, i)
        loc_mat = loc_to_mat(shape.Location()) if shape is not None else np.eye(4)
        lo, hi = shape_bbox(shape)
        brep_rel = os.path.join(CACHE_BREP, f"{key}.brep")
        if shape is not None and not shape.IsNull():
            BRepTools.Write_s(shape, os.path.join(cache_dir, brep_rel))
        parts[key] = {
            "index": i,
            "name": p.name,
            "instances": p.n_instances,
            "bbox_lo": [float(x) for x in lo],
            "bbox_hi": [float(x) for x in hi],
            "loc": loc_mat.tolist(),
            "brep": brep_rel.replace("\\", "/"),
            "triangles": 0,
            "vertices": 0,
        }

    def node_rec(n):
        return {
            "name": n.name,
            "M": n.M.tolist(),
            "path": n.path,
            "depth": n.depth,
            "is_leaf": n.is_leaf,
            "proto": (n.proto.index if (n.is_leaf and n.proto is not None) else None),
            "children": [node_rec(c) for c in n.children],
        }

    tree = {"roots": [node_rec(r) for r in roots]}
    with open(os.path.join(cache_dir, CACHE_TREE), "w", encoding="utf-8") as fh:
        json.dump(tree, fh)
    with open(os.path.join(cache_dir, CACHE_PARTS), "w", encoding="utf-8") as fh:
        json.dump({"parts": parts, "order": [p.name for p in proto_list]}, fh)
    progress(f"  stage 1 done (tree + {len(parts)} breps)")

    if not do_mesh:
        return cache_dir

    # ---- stage 2: tessellation -----------------------------------------
    import tessellate

    meshes = {}
    for i, p in enumerate(proto_list):
        key = _safe_key(p.name, i)
        shape = p.shape
        loc_mat = np.array(parts[key]["loc"])
        try:
            v, n, t = tessellate.triangulate(shape, lin, ang)
            if not np.allclose(loc_mat, np.eye(4)):
                v, n, t = tessellate.transform_mesh(v, n, t, loc_mat)
        except Exception as exc:  # pragma: no cover
            progress(f"  !! mesh failed for {p.name}: {exc}")
            v = np.zeros((0, 3), np.float32)
            n = np.zeros((0, 3), np.float32)
            t = np.zeros((0, 3), np.int32)
        meshes[f"v{key}"] = v
        meshes[f"n{key}"] = n
        meshes[f"t{key}"] = t
        parts[key]["triangles"] = int(len(t) // 3)
        parts[key]["vertices"] = int(len(v))
        progress(f"    [{i+1}/{len(proto_list)}] {p.name}  {len(t)//3} tris  "
                 f"bbox {np.round(parts[key]['bbox_lo'],1)}..{np.round(parts[key]['bbox_hi'],1)}")

    np.savez_compressed(os.path.join(cache_dir, CACHE_MESH), **meshes)
    with open(os.path.join(cache_dir, CACHE_PARTS), "w", encoding="utf-8") as fh:
        json.dump({"parts": parts, "order": [p.name for p in proto_list]}, fh)
    progress(f"  cache written to {cache_dir}")
    return cache_dir


def load_cache(cache_dir: str = CACHE_DIR):
    """Load the cached tree + meshes.  Returns (tree, parts, meshes)."""
    with open(os.path.join(cache_dir, CACHE_TREE), encoding="utf-8") as fh:
        tree = json.load(fh)
    with open(os.path.join(cache_dir, CACHE_PARTS), encoding="utf-8") as fh:
        parts_meta = json.load(fh)
    meshes = np.load(os.path.join(cache_dir, CACHE_MESH))
    return tree, parts_meta, meshes


def cache_is_complete(cache_dir: str = CACHE_DIR) -> bool:
    return all(os.path.exists(os.path.join(cache_dir, f))
               for f in (CACHE_TREE, CACHE_PARTS, CACHE_MESH))


def mesh_cache_file(lin: float, ang: float, cache_dir: str = CACHE_DIR) -> str:
    return os.path.join(cache_dir, f"meshes_l{lin:g}_a{ang:g}.npz")


_MESH_STORES = {}


def mesh_at(model, proto_index: int, lin: float, ang: float = 0.5,
            cache_dir: str = CACHE_DIR):
    """Mesh a prototype at an arbitrary deflection, with an on-disk cache.

    The default cache is built at 0.8 mm, which is right for the goals but
    makes the whole field GLB ~330 MB.  The field is therefore re-meshed at
    a coarser deflection, cached separately so it is only paid once.
    """
    import tessellate

    key = f"{proto_index:03d}"
    path = mesh_cache_file(lin, ang, cache_dir)
    if path not in _MESH_STORES:
        store = {}
        if os.path.exists(path):
            try:
                with np.load(path) as z:
                    for k in z.files:
                        store[k] = z[k]
            except Exception:
                store = {}
        _MESH_STORES[path] = store
    store = _MESH_STORES[path]
    if f"v{key}" in store:
        return (store[f"v{key}"], store[f"n{key}"], store[f"t{key}"])

    shp = model.brep(proto_index)
    if shp is None:
        z3 = np.zeros((0, 3), np.float32)
        store[f"v{key}"] = z3
        store[f"n{key}"] = z3
        store[f"t{key}"] = np.zeros((0, 3), np.int32)
        return (z3, z3, np.zeros((0, 3), np.int32))
    v, n, t = tessellate.triangulate(shp, lin, ang)
    info = model.part_info(proto_index)
    loc_mat = np.array(info["loc"])
    if not np.allclose(loc_mat, np.eye(4)):
        v, n, t = tessellate.transform_mesh(v, n, t, loc_mat)
    store[f"v{key}"] = v
    store[f"n{key}"] = n
    store[f"t{key}"] = t
    np.savez_compressed(path, **store)
    return (v, n, t)


def load_brep(key: str, cache_dir: str = CACHE_DIR):
    """Load a cached prototype BRep (for face-level analysis)."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools
    from OCP.TopoDS import TopoDS_Shape

    path = os.path.join(cache_dir, CACHE_BREP, f"{key}.brep")
    if not os.path.exists(path):
        return None
    shape = TopoDS_Shape()
    builder = BRep_Builder()
    BRepTools.Read_s(shape, path, builder)
    return shape



# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def trsf_to_mat(trsf) -> np.ndarray:
    """gp_Trsf -> 4x4 homogeneous matrix (row-major, applied to column vectors)."""
    m = np.eye(4)
    m[0, :3] = (trsf.Value(1, 1), trsf.Value(1, 2), trsf.Value(1, 3))
    m[1, :3] = (trsf.Value(2, 1), trsf.Value(2, 2), trsf.Value(2, 3))
    m[2, :3] = (trsf.Value(3, 1), trsf.Value(3, 2), trsf.Value(3, 3))
    m[0, 3] = trsf.Value(1, 4)
    m[1, 3] = trsf.Value(2, 4)
    m[2, 3] = trsf.Value(3, 4)
    return m


def loc_to_mat(loc) -> np.ndarray:
    return trsf_to_mat(loc.Transformation())


def mat_to_trsf(m: np.ndarray):
    from OCP.gp import gp_Trsf

    t = gp_Trsf()
    t.SetValues(
        m[0, 0], m[0, 1], m[0, 2], m[0, 3],
        m[1, 0], m[1, 1], m[1, 2], m[1, 3],
        m[2, 0], m[2, 1], m[2, 2], m[2, 3],
    )
    return t


def label_name(label) -> str:
    """TDataStd_Name of a label, or ''."""
    from OCP.TDataStd import TDataStd_Name

    a = TDataStd_Name()
    if label.FindAttribute(TDataStd_Name.GetID_s(), a):
        return a.Get().ToExtString()
    return ""


def rot_yaw_pitch_roll(m: np.ndarray):
    """Return (rx, ry, rz) Euler angles (radians) for a 4x4 rigid transform.

    Convention matches the ``rotation`` field in field.json: intrinsic
    X->Y->Z applied to column vectors, i.e. R = Rz @ Ry @ Rx.
    """
    R = m[:3, :3]
    sy = -R[2, 0]
    sy = max(-1.0, min(1.0, sy))
    ry = float(np.arcsin(sy))
    if abs(sy) < 0.99999:
        rx = float(np.arctan2(R[2, 1], R[2, 2]))
        rz = float(np.arctan2(R[1, 0], R[0, 0]))
    else:  # gimbal lock
        rx = float(np.arctan2(-R[1, 2], R[1, 1]))
        rz = 0.0
    return (rx, ry, rz)


def rot_about_axis(m: np.ndarray, axis: np.ndarray) -> float:
    """Angle (rad) of the rotation part of ``m`` about ``axis``."""
    axis = axis / np.linalg.norm(axis)
    R = m[:3, :3]
    # project onto the plane perpendicular to axis
    P = np.eye(3) - np.outer(axis, axis)
    Rp = P @ R @ P + np.outer(axis, axis)
    c = (np.trace(Rp) - 1.0) / 2.0
    c = max(-1.0, min(1.0, c))
    ang = float(np.arccos(c))
    # sign from the axial component
    v = R @ axis
    s = np.cross(axis, v)
    if np.dot(s, axis) < 0:
        ang = -ang
    return ang


# --------------------------------------------------------------------------
# assembly tree
# --------------------------------------------------------------------------
class Proto:
    """A unique part (leaf) in the STEP file."""

    __slots__ = ("label", "name", "shape", "n_instances", "index")

    def __init__(self, label, name, shape):
        self.label = label
        self.name = name
        self.shape = shape
        self.n_instances = 0
        self.index = -1


class Instance:
    """One placed occurrence of a prototype."""

    __slots__ = ("proto", "name", "M", "path", "index")

    def __init__(self, proto, name, M, path, index):
        self.proto = proto
        self.name = name
        self.M = M
        self.path = path
        self.index = index

    @property
    def pos(self):
        return self.M[:3, 3]


class Node:
    """A node of the placed assembly tree.

    Leaf nodes carry geometry (``proto.shape``); assembly nodes carry
    children.  ``M`` is the world transform of this node.
    """

    __slots__ = ("name", "M", "children", "proto", "path", "depth", "is_leaf")

    def __init__(self, name, M, path, depth, proto=None, is_leaf=False):
        self.name = name
        self.M = M
        self.path = path
        self.depth = depth
        self.proto = proto
        self.is_leaf = is_leaf
        self.children: list[Node] = []

    @property
    def pos(self):
        return self.M[:3, 3]

    def leaves(self):
        if self.is_leaf:
            yield self
        for c in self.children:
            yield from c.leaves()

    def walk(self):
        yield self
        for c in self.children:
            yield from c.walk()


def build_tree(shape_tool, progress=print):
    """Walk the XCAF assembly, returning (protos, roots).

    ``roots`` is a list of top-level :class:`Node` trees; every placed
    occurrence (assembly *and* leaf) appears exactly once, with its world
    transform already fully chained to the root.
    """
    from OCP.TDF import TDF_Label, TDF_LabelSequence

    protos: dict[int, Proto] = {}
    roots: list[Node] = []

    def proto_for(label) -> Proto:
        key = label.Tag()
        if key not in protos:
            name = label_name(label) or f"<proto#{key}>"
            shape = shape_tool.GetShape_s(label)
            protos[key] = Proto(label, name, shape)
        return protos[key]

    def visit(label, M_parent, path, depth) -> Node:
        """``label`` is a component (reference) label of the parent assembly."""
        loc = shape_tool.GetLocation_s(label)
        M = M_parent @ loc_to_mat(loc)

        if shape_tool.IsReference_s(label):
            proto_label = TDF_Label()
            shape_tool.GetReferredShape_s(label, proto_label)
        else:
            proto_label = label

        pname = label_name(proto_label) or "<unnamed>"
        here = path + [pname]

        if shape_tool.IsAssembly_s(proto_label):
            node = Node(pname, M, here, depth, proto=None, is_leaf=False)
            comps = TDF_LabelSequence()
            shape_tool.GetComponents_s(proto_label, comps)
            for i in range(1, comps.Length() + 1):
                node.children.append(visit(comps.Value(i), M, here, depth + 1))
            return node

        proto = proto_for(proto_label)
        proto.n_instances += 1
        return Node(pname, M, here, depth, proto=proto, is_leaf=True)

    free = TDF_LabelSequence()
    shape_tool.GetFreeShapes(free)
    progress(f"  free shapes: {free.Length()}")
    for i in range(1, free.Length() + 1):
        root = free.Value(i)
        M_root = loc_to_mat(shape_tool.GetLocation_s(root))
        rname = label_name(root) or "<root>"
        if shape_tool.IsAssembly_s(root):
            node = Node(rname, M_root, [rname], 0)
            comps = TDF_LabelSequence()
            shape_tool.GetComponents_s(root, comps)
            for j in range(1, comps.Length() + 1):
                node.children.append(visit(comps.Value(j), M_root, [rname], 1))
            roots.append(node)
        else:
            proto = proto_for(root)
            proto.n_instances += 1
            roots.append(Node(rname, M_root, [rname], 0, proto=proto, is_leaf=True))

    return protos, roots


def flatten(roots):
    """All nodes (assemblies + leaves) in depth-first order."""
    out = []
    for r in roots:
        out.extend(r.walk())
    return out


def leaf_instances(roots):
    """All leaf nodes in depth-first order."""
    out = []
    for r in roots:
        out.extend(r.leaves())
    return out



# --------------------------------------------------------------------------
# geometry measurement
# --------------------------------------------------------------------------
def shape_bbox(shape) -> tuple[np.ndarray, np.ndarray]:
    """Local (min, max) bounding box of a shape, location included."""
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    b = Bnd_Box()
    BRepBndLib.Add_s(shape, b, True)
    if b.IsVoid():
        return np.zeros(3), np.zeros(3)
    xmin, ymin, zmin, xmax, ymax, zmax = b.Get()
    return np.array([xmin, ymin, zmin]), np.array([xmax, ymax, zmax])


def world_bbox(shape, M) -> tuple[np.ndarray, np.ndarray]:
    """World bbox of ``shape`` placed by matrix ``M`` (transforming its 8 corners)."""
    lo, hi = shape_bbox(shape)
    corners = np.array(
        [[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    )
    w = (M[:3, :3] @ corners.T).T + M[:3, 3]
    return w.min(axis=0), w.max(axis=0)


def face_census(shape) -> list[dict]:
    """Per-face surface summary (type + key parameters) in the shape's frame."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import (
        GeomAbs_Plane, GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Sphere,
        GeomAbs_Torus, GeomAbs_BSplineSurface,
    )

    out = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)  # TopAbs_FACE
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(f)
        t = ad.GetType()
        rec = {"type": str(t).split(".")[-1], "area": None}
        try:
            from OCP.GProp import GProp_GProps
            from OCP.BRepGProp import BRepGProp

            g = GProp_GProps()
            BRepGProp.SurfaceProperties_s(f, g)
            rec["area"] = round(g.Mass(), 4)
        except Exception:
            pass
        if t == GeomAbs_Plane:
            pl = ad.Plane()
            n = np.array([pl.Axis().Direction().X(), pl.Axis().Direction().Y(),
                          pl.Axis().Direction().Z()])
            p = np.array([pl.Location().X(), pl.Location().Y(), pl.Location().Z()])
            rec["normal"] = n.tolist()
            rec["point"] = p.tolist()
        elif t == GeomAbs_Cylinder:
            cy = ad.Cylinder()
            a = np.array([cy.Axis().Direction().X(), cy.Axis().Direction().Y(),
                          cy.Axis().Direction().Z()])
            p = np.array([cy.Axis().Location().X(), cy.Axis().Location().Y(),
                          cy.Axis().Location().Z()])
            rec["axis"] = a.tolist()
            rec["axis_point"] = p.tolist()
            rec["radius"] = cy.Radius()
        elif t == GeomAbs_Cone:
            co = ad.Cone()
            a = np.array([co.Axis().Direction().X(), co.Axis().Direction().Y(),
                          co.Axis().Direction().Z()])
            p = np.array([co.Axis().Location().X(), co.Axis().Location().Y(),
                          co.Axis().Location().Z()])
            rec["axis"] = a.tolist()
            rec["axis_point"] = p.tolist()
            rec["ref_radius"] = co.RefRadius()
            rec["semi_angle"] = co.SemiAngle()
            rec["apex"] = [co.Apex().X(), co.Apex().Y(), co.Apex().Z()]
        elif t == GeomAbs_Sphere:
            sp = ad.Sphere()
            rec["radius"] = sp.Radius()
            rec["center"] = [sp.Location().X(), sp.Location().Y(), sp.Location().Z()]
        elif t == GeomAbs_Torus:
            to = ad.Torus()
            rec["major_radius"] = to.MajorRadius()
            rec["minor_radius"] = to.MinorRadius()
            rec["axis"] = [to.Axis().Direction().X(), to.Axis().Direction().Y(),
                           to.Axis().Direction().Z()]
        out.append(rec)
        exp.Next()
    return out


def face_axial_extent(shape, axis: np.ndarray) -> list[dict]:
    """For every face, its extent along ``axis`` and its perpendicular offset.

    Used to find the socket bore: a cylindrical face whose axis is parallel to
    ``axis`` and whose radius is in the 15-45 mm band.
    """
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepBndLib import BRepBndLib
    from OCP.Bnd import Bnd_Box

    axis = axis / np.linalg.norm(axis)
    out = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        b = Bnd_Box()
        BRepBndLib.Add_s(f, b, True)
        rec = {"face": f}
        if not b.IsVoid():
            xmin, ymin, zmin, xmax, ymax, zmax = b.Get()
            corners = np.array(
                [[x, y, z] for x in (xmin, xmax) for y in (ymin, ymax)
                 for z in (zmin, zmax)]
            )
            s = corners @ axis
            rec["s_min"] = float(s.min())
            rec["s_max"] = float(s.max())
            mid = corners.mean(axis=0)
            rec["s_mid"] = float(np.dot(mid, axis))
            perp = mid - np.dot(mid, axis) * axis
            rec["perp_offset"] = float(np.linalg.norm(perp))
            rec["mid"] = mid.tolist()
        out.append(rec)
        exp.Next()
    return out


def plan_log(msg=""):
    print(msg, flush=True)


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)
