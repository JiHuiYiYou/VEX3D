"""Measure the CAD and derive the normalised field coordinate system.

Output frame:  X = east, Y = north, Z = up, origin = field centre, mm.
The CAD's own up-axis is *not* assumed -- it is recovered from the goal
frusta (a goal is a cone standing on the mat) and then the horizontal
rotation is solved by matching the 9 goal positions against the game
manual's 25-inch grid.
"""

from __future__ import annotations

import math
import re

import numpy as np

# --------------------------------------------------------------------------
# ground truth: the 2026-2027 game manual + photogrammetry of a field photo
# --------------------------------------------------------------------------
IN = 25.4
G = 25 * IN  # 635 mm -- the 25-inch grid pitch

MANUAL_GOALS = {
    "g-n1":    (-G,  2 * G, "neutral-short", "top",     None),
    "g-n2":    (-2 * G,  G, "neutral-short", "left",    None),
    "g-n3":    (2 * G, -G,      "neutral-short", "right",  None),
    "g-n4":    (G,  -2 * G,     "neutral-short", "bottom", None),
    "g-center": (0.0,   0.0,    "neutral-tall",  "midfield", None),
    "g-r1":    (-2 * G, -G,     "alliance-red",  "left",    "red"),
    "g-r2":    (-G,  -2 * G,    "alliance-red",  "bottom",  "red"),
    "g-b1":    (G,   2 * G,    "alliance-blue", "top",     "blue"),
    "g-b2":    (2 * G,  G,      "alliance-blue", "right",   "blue"),
}

MANUAL_TOGGLES = {
    # id, position (mm), rotationZ (rad)
    "top":    ((0.0,  1828.8), 0.0),
    "right":  ((1828.8, 0.0),  math.pi / 2),
    "bottom": ((0.0, -1828.8), 0.0),
    "left":   ((-1828.8, 0.0), math.pi / 2),
}

EXPECT = {
    "fieldSize": 3657.6,
    "goalHeightTall": 222.7,
    "goalHeightShort": 146.5,
    "goalHeightAlliance": 82.5,
    "goalPlanSize": 162.6,      # octagon across flats
    "pinHeight": 165.0,
    "pinMaxDiameter": 40.0,
    "cupHeight": 164.5,
    "cupMaxDiameter": 80.0,
    "toggleLength": 656.2,
    "toggleWidth": 52.2,
}

# part-name prefixes / exact names
GOAL_PREFIX = "276-9250-840_"
CUP_NAME = "276-9250-81x"
PIN_PREFIX = "276-9250-80x_"
HALF_PARTS = {
    "276-9250-001_PMS 199c (Bright Red)": "red",
    "276-9250-001_PMS 299c (Bright Blue)": "blue",
    "276-9250-001_Yellow": "yellow",
    "276-9250-002_Clear": "clear",
    "276-9250-002_PMS 425c - Dark Gray": "gray",
}
# the parts that make up the 4 perimeter toggles
TOGGLE_PARTS = {
    "SBT0832_276-8016-001",
    "276-8354-404",
    "NNY_Imperial_275-1027-001",
}

# which half colours each pin/cup assembly product is built from
# (filled in from the actual tree, this is only the expected shape)


def rot2(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s], [s, c]])


# --------------------------------------------------------------------------
# classification
# --------------------------------------------------------------------------
def classify(roots):
    """Split the placed tree into logical buckets."""
    out = {
        "goals": [],        # leaf nodes named 276-9250-840_*
        "cups": [],         # assembly nodes named 276-9250-81x
        "pins": [],         # assembly nodes named 276-9250-80x_*
        "toggle_parts": [],  # leaf nodes belonging to the 4 perimeter toggles
        "other_leaves": [],
        "other_assemblies": [],
    }
    for r in roots:
        for node in r.walk():
            if node.is_leaf:
                if node.name.startswith(GOAL_PREFIX):
                    out["goals"].append(node)
                elif node.name in TOGGLE_PARTS:
                    out["toggle_parts"].append(node)
                else:
                    out["other_leaves"].append(node)
            else:
                if node.name == CUP_NAME:
                    out["cups"].append(node)
                elif node.name.startswith(PIN_PREFIX):
                    out["pins"].append(node)
                elif node.name != (r.name):
                    out["other_assemblies"].append(node)
    return out


# --------------------------------------------------------------------------
# up-axis
# --------------------------------------------------------------------------
def _dominant_axis(shape, M=None):
    """Axis of the largest cone/cylinder face of ``shape`` (local frame)."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Cone

    best = None
    best_area = -1.0
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(f)
        t = ad.GetType()
        if t not in (GeomAbs_Cylinder, GeomAbs_Cone):
            exp.Next()
            continue
        try:
            from OCP.BRepGProp import BRepGProp
            from OCP.GProp import GProp_GProps

            g = GProp_GProps()
            BRepGProp.SurfaceProperties_s(f, g)
            area = g.Mass()
        except Exception:
            area = 0.0
        if area > best_area:
            if t == GeomAbs_Cylinder:
                cy = ad.Cylinder()
                ax = np.array([cy.Axis().Direction().X(), cy.Axis().Direction().Y(),
                               cy.Axis().Direction().Z()])
                pt = np.array([cy.Axis().Location().X(), cy.Axis().Location().Y(),
                               cy.Axis().Location().Z()])
                info = {"kind": "cylinder", "radius": cy.Radius()}
            else:
                co = ad.Cone()
                ax = np.array([co.Axis().Direction().X(), co.Axis().Direction().Y(),
                               co.Axis().Direction().Z()])
                pt = np.array([co.Axis().Location().X(), co.Axis().Location().Y(),
                               co.Axis().Location().Z()])
                info = {"kind": "cone", "ref_radius": co.RefRadius(),
                        "semi_angle": co.SemiAngle()}
            best = {"axis": ax / np.linalg.norm(ax), "point": pt, **info,
                    "area": area}
            best_area = area
        exp.Next()
    if best is None:
        return None
    if M is not None:
        R = M[:3, :3]
        best["axis"] = R @ best["axis"]
        best["point"] = (R @ best["point"]) + M[:3, 3]
    return best


def determine_up_axis(goal_nodes):
    """Recover the world up-direction from the goal frusta."""
    axes = []
    for g in goal_nodes:
        info = _dominant_axis(g.proto.shape, g.M)
        if info is None:
            continue
        axes.append((g.name, info["axis"], info["point"], info))
    if not axes:
        raise RuntimeError("no goal axis found")
    # average (sign-normalised) directions
    ref = axes[0][1]
    acc = np.zeros(3)
    for _, ax, _, _ in axes:
        a = ax if np.dot(ax, ref) >= 0 else -ax
        acc += a
    up = acc / np.linalg.norm(acc)
    # sign: the goal's apex (for a cone) or its tall end must be "up".
    # Use the world bbox: the goal's base sits on the mat, so the axis must
    # point away from the global min of the field.
    return up, axes


# --------------------------------------------------------------------------
# field frame
# --------------------------------------------------------------------------
def solve_field_frame(goal_nodes, up):
    """Find X (east) / Y (north) so the goal positions match the manual.

    Returns (X, Y, Z, residual_max, per-goal residuals).
    """
    # two horizontal candidates
    a = np.array([1.0, 0.0, 0.0])
    if abs(np.dot(a, up)) > 0.9:
        a = np.array([0.0, 1.0, 0.0])
    e1 = a - np.dot(a, up) * up
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    e2 /= np.linalg.norm(e2)

    # goal world positions
    gpos = [(g.name, g.M[:3, 3]) for g in goal_nodes]

    best = None
    for k in range(4):
        th = k * math.pi / 2
        R = rot2(th)
        X = R[0, 0] * e1 + R[0, 1] * e2
        Y = R[1, 0] * e1 + R[1, 1] * e2
        for name, p in gpos:
            if name not in MANUAL_GOALS:
                continue
            mx, my, *_ = MANUAL_GOALS[name]
            if name == "g-center":
                continue
            # translation is fixed by the midfield goal = field centre
            pass
        # build the mapping using the midfield goal as the origin
        centre = None
        for name, p in gpos:
            if name.startswith("276-9250-840_Neutral Goal 0"):
                centre = p
        if centre is None:
            continue
        resid = []
        for name, p in gpos:
            if name not in MANUAL_GOALS:
                continue
            mx, my, *_ = MANUAL_GOALS[name]
            d = p - centre
            px = float(np.dot(d, X))
            py = float(np.dot(d, Y))
            resid.append((name, px - mx, py - my))
        rmax = max(max(abs(a), abs(b)) for _, a, b in resid)
        if best is None or rmax < best[3]:
            best = (X, Y, rmax, rmax, resid, k)

    if best is None:
        raise RuntimeError("could not solve field frame")
    X, Y, rmax, _, resid, k = best
    # Z must be up -> right-handed
    Z = np.cross(X, Y)
    if np.dot(Z, up) < 0:
        # the manual's X/Y assignment is mirrored w.r.t. the CAD frame; keep
        # Z = up and mirror Y (documented in the report)
        Y = np.cross(Z, X)
    return X, Y, Z, rmax, resid, k


def to_field(M, X, Y, Z, origin):
    """Transform a world 4x4 matrix into the normalised field frame."""
    R = np.stack([X, Y, Z], axis=1)      # columns = new axes in world space
    out = np.eye(4)
    out[:3, :3] = R.T @ M[:3, :3]
    out[:3, 3] = R.T @ (M[:3, 3] - origin)
    return out


# --------------------------------------------------------------------------
# socket detection
# --------------------------------------------------------------------------
def find_socket(shape, axis, radius_band=(12.0, 48.0)):
    """Find the scoring-object bore in a goal.

    ``axis`` is the goal's up-axis in the shape's local frame.  Returns a
    dict with the bore's centre (perpendicular offset), rim height, radius
    and depth, all in the shape's local frame.
    """
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Cone
    from OCP.TopLoc import TopLoc_Location
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    axis = np.asarray(axis, dtype=float)
    axis = axis / np.linalg.norm(axis)

    cands = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(f)
        t = ad.GetType()
        if t not in (GeomAbs_Cylinder, GeomAbs_Cone):
            exp.Next()
            continue
        if t == GeomAbs_Cylinder:
            cy = ad.Cylinder()
            ax = np.array([cy.Axis().Direction().X(), cy.Axis().Direction().Y(),
                           cy.Axis().Direction().Z()])
            pt = np.array([cy.Axis().Location().X(), cy.Axis().Location().Y(),
                           cy.Axis().Location().Z()])
            radius = cy.Radius()
            r0 = r1 = radius
        else:
            co = ad.Cone()
            ax = np.array([co.Axis().Direction().X(), co.Axis().Direction().Y(),
                           co.Axis().Direction().Z()])
            pt = np.array([co.Axis().Location().X(), co.Axis().Location().Y(),
                           co.Axis().Location().Z()])
            radius = co.RefRadius()
            r0 = r1 = radius
        if abs(abs(np.dot(ax / np.linalg.norm(ax), axis)) - 1.0) > 1e-3:
            exp.Next()
            continue
        if not (radius_band[0] <= radius <= radius_band[1]):
            exp.Next()
            continue
        # axial extent of the face
        b = Bnd_Box()
        BRepBndLib.Add_s(f, b, True)
        if b.IsVoid():
            exp.Next()
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = b.Get()
        corners = np.array([[x, y, z] for x in (xmin, xmax) for y in (ymin, ymax)
                            for z in (zmin, zmax)])
        s = corners @ axis
        # perpendicular offset of the axis line
        d = pt - np.dot(pt, axis) * axis
        cands.append({
            "kind": "cylinder" if t == GeomAbs_Cylinder else "cone",
            "radius": radius,
            "s_min": float(s.min()), "s_max": float(s.max()),
            "centre_perp": d.tolist(),
            "perp_offset": float(np.linalg.norm(d)),
            "axis_point": pt.tolist(),
        })
        exp.Next()

    if not cands:
        return None
    # the socket is the one whose rim is highest
    cands.sort(key=lambda c: -c["s_max"])
    best = cands[0]
    best["depth"] = best["s_max"] - best["s_min"]
    best["all_candidates"] = cands
    return best


def planar_top_face(shape, axis):
    """Highest planar face whose normal is parallel to ``axis``."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Plane
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    best = None
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(f)
        if ad.GetType() != GeomAbs_Plane:
            exp.Next()
            continue
        pl = ad.Plane()
        n = np.array([pl.Axis().Direction().X(), pl.Axis().Direction().Y(),
                      pl.Axis().Direction().Z()])
        if abs(abs(np.dot(n, axis)) - 1.0) > 1e-3:
            exp.Next()
            continue
        b = Bnd_Box()
        BRepBndLib.Add_s(f, b, True)
        if b.IsVoid():
            exp.Next()
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = b.Get()
        corners = np.array([[x, y, z] for x in (xmin, xmax) for y in (ymin, ymax)
                            for z in (zmin, zmax)])
        s = corners @ axis
        rec = {"s": float(s.max()), "area": None, "face": f,
               "bbox": (xmin, ymin, zmin, xmax, ymax, zmax)}
        if best is None or rec["s"] > best["s"]:
            best = rec
        exp.Next()
    return best


# --------------------------------------------------------------------------
# revolved-part profile
# --------------------------------------------------------------------------
def axial_profile(shape, axis):
    """Radius profile of a revolved part: list of (s_min, s_max, r_min, r_max, kind)."""
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.TopAbs import TopAbs_FACE
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Cone, GeomAbs_Plane
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib

    axis = np.asarray(axis, float)
    axis = axis / np.linalg.norm(axis)
    out = []
    exp = TopExp_Explorer(shape, TopAbs_FACE)
    while exp.More():
        f = TopoDS.Face_s(exp.Current())
        ad = BRepAdaptor_Surface(f)
        t = ad.GetType()
        b = Bnd_Box()
        BRepBndLib.Add_s(f, b, True)
        if b.IsVoid():
            exp.Next()
            continue
        xmin, ymin, zmin, xmax, ymax, zmax = b.Get()
        corners = np.array([[x, y, z] for x in (xmin, xmax) for y in (ymin, ymax)
                            for z in (zmin, zmax)])
        s = corners @ axis
        s_min, s_max = float(s.min()), float(s.max())
        if t == GeomAbs_Cylinder:
            r = ad.Cylinder().Radius()
            out.append({"kind": "cyl", "s_min": s_min, "s_max": s_max,
                        "r_min": r, "r_max": r,
                        "r_at_smin": r, "r_at_smax": r})
        elif t == GeomAbs_Cone:
            co = ad.Cone()
            tan = abs(math.tan(co.SemiAngle()))
            ap = co.Apex()
            s_apex = float(np.array([ap.X(), ap.Y(), ap.Z()]) @ axis)
            r_lo = abs(s_min - s_apex) * tan
            r_hi = abs(s_max - s_apex) * tan
            out.append({"kind": "cone", "s_min": s_min, "s_max": s_max,
                        "r_min": min(r_lo, r_hi), "r_max": max(r_lo, r_hi),
                        "r_at_smin": r_lo, "r_at_smax": r_hi})
        elif t == GeomAbs_Plane:
            # flat annulus: radius from the bbox
            mid = corners.mean(axis=0)
            perp = mid - np.dot(mid, axis) * axis
            r = float(np.linalg.norm(perp))
            out.append({"kind": "plane", "s_min": s_min, "s_max": s_max,
                        "r_min": r, "r_max": r,
                        "r_at_smin": r, "r_at_smax": r})
        exp.Next()
    out.sort(key=lambda p: p["s_min"])
    return out


def profile_bounds(profile):
    """(height, r_low, r_high, r_max) from a profile."""
    if not profile:
        return None
    s_min = min(p["s_min"] for p in profile)
    s_max = max(p["s_max"] for p in profile)
    r_max = max(p["r_max"] for p in profile)
    # radius at the low end
    lows = [p for p in profile if abs(p["s_min"] - s_min) < 1e-6]
    r_low = max(p["r_max"] for p in lows) if lows else 0.0
    highs = [p for p in profile if abs(p["s_max"] - s_max) < 1e-6]
    r_high = max(p["r_max"] for p in highs) if highs else 0.0
    return {"height": s_max - s_min, "s_min": s_min, "s_max": s_max,
            "rLow": r_low, "rHigh": r_high, "rMax": r_max}


# --------------------------------------------------------------------------
# cache-backed model
# --------------------------------------------------------------------------
class Model:
    """The placed assembly, loaded from the on-disk cache.

    Everything downstream (measurement, export) works from this, so the
    expensive STEP read happens exactly once.
    """

    def __init__(self, cache_dir=None):
        import steplib

        self.cache_dir = cache_dir or steplib.CACHE_DIR
        self.tree, self.parts_meta, self.meshes = steplib.load_cache(self.cache_dir)
        self.parts = self.parts_meta["parts"]
        self.order = self.parts_meta["order"]
        self.roots = self.tree["roots"]
        self._brep_cache = {}

    # -- tree helpers ----------------------------------------------------
    def walk(self, nodes=None):
        nodes = self.roots if nodes is None else nodes
        for n in nodes:
            yield n
            if n.get("children"):
                yield from self.walk(n["children"])

    def leaves(self, nodes=None):
        return [n for n in self.walk(nodes) if n.get("is_leaf")]

    def assemblies(self, nodes=None):
        return [n for n in self.walk(nodes) if not n.get("is_leaf")]

    def part_info(self, proto_index):
        for k, v in self.parts.items():
            if v["index"] == proto_index:
                return v
        raise KeyError(proto_index)

    def mesh(self, proto_index):
        info = self.part_info(proto_index)
        key = f"{info['index']:03d}"
        return (self.meshes[f"v{key}"], self.meshes[f"n{key}"], self.meshes[f"t{key}"])

    def brep(self, proto_index):
        if proto_index in self._brep_cache:
            return self._brep_cache[proto_index]
        import steplib

        info = self.part_info(proto_index)
        key = f"{info['index']:03d}"
        shp = steplib.load_brep(key, self.cache_dir)
        self._brep_cache[proto_index] = shp
        return shp

    # -- geometry helpers ------------------------------------------------
    @staticmethod
    def mat(node):
        return np.array(node["M"], dtype=float)

    def node_children_world(self, node):
        """World positions of a node's direct children (leaf centres)."""
        out = []
        for c in node.get("children", []):
            out.append((c, self.mat(c)[:3, 3]))
        return out

    def subtree_bbox(self, node):
        """World bbox of a node and all its descendants."""
        lo = np.full(3, 1e30)
        hi = np.full(3, -1e30)
        for leaf in self.leaves([node]):
            info = self.part_info(leaf["proto"])
            l = np.array(info["bbox_lo"])
            h = np.array(info["bbox_hi"])
            M = self.mat(leaf)
            corners = np.array([[x, y, z] for x in (l[0], h[0])
                                for y in (l[1], h[1]) for z in (l[2], h[2])])
            w = (M[:3, :3] @ corners.T).T + M[:3, 3]
            lo = np.minimum(lo, w.min(axis=0))
            hi = np.maximum(hi, w.max(axis=0))
        return lo, hi

