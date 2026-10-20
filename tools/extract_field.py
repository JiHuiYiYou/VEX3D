#!/usr/bin/env python
"""CAD -> glTF/JSON pipeline for the VEX3D 3D field analyser.

Reads  fieldcad/276-9250-000 (2026-04-26).STEP  (AP214, millimetres) with
STEPCAFControl_Reader, walks the XCAF assembly while chaining every
instance's world transform all the way to the root, measures the scoring
geometry, and writes:

    public/assets/field.glb          merged static field, per-part node names
    public/assets/half_*.glb         the 5 scoring-object half templates
    public/assets/goal_*.glb         the 4 goal variants
    public/assets/field.json         the scene manifest the web app loads
    public/assets/field_report.json  measured-vs-expected comparison table

The expensive STEP read is cached in tools/_cache, so re-running is cheap.

    ./tools/.venv/Scripts/python.exe tools/extract_field.py
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import field_analysis as fa  # noqa: E402
import gltfwriter  # noqa: E402
import steplib  # noqa: E402
import tessellate  # noqa: E402
from field_analysis import (  # noqa: E402
    EXPECT, HALF_PARTS, MANUAL_GOALS, MANUAL_TOGGLES, Model, TOGGLE_PARTS,
)

ASSETS = steplib.ASSET_DIR
LOG = steplib.plan_log

# Tessellation deflections (mm).  The goals and the scoring-object halves
# are gameplay-critical and are meshed finely; the field furniture is meshed
# coarsely because a uniform 0.8 mm pass produces a ~330 MB field GLB.
DEFL_GOAL = 0.5
DEFL_HALF = 0.3
ANG = 0.5

# ---------------------------------------------------------------------------
# field.glb content profile
#
# The field GLB is a browser asset, so it holds only what is visible at
# field scale: the tape, the perimeter walls, the alliance-station walls,
# the four loaders, the nine goals (with their AprilTags) and the toggle
# bars.  The fine hardware -- thousands of 3 mm screws, standoffs and
# bumper-tape tubes -- is dropped: it is invisible at field scale and it
# was 60 % of the triangles.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# field.glb content: the CAD product tree, pruned.
#
# The export mirrors the STEP assembly hierarchy, so the *assembly* product
# names appear as nodes too (276-9250-120_Red Alliance Side, the loaders,
# ...).  The web app looks for a node whose name contains "276-9250-120"
# and for a mat-ish node, so both have to be present as node names.
#
# The goal parts are NOT in field.glb: the web app renders the nine goals
# from the goal_*.glb files (placed with field.json), so including them
# here as well would draw every goal twice and z-fight.
INCLUDE_GOALS_IN_FIELD = False

# Seven small machined brackets carry ~85 % of the field's triangles (they
# have sub-millimetre features -- threads, knurls, dense hole patterns --
# so even a 12 mm deflection leaves 9k triangles each).  At field scale
# they are invisible, so they are left out of the browser asset; pass
# --full-detail to keep them (that build is ~90 MB).
FIELD_DROP_DENSE = {
    "276-7596-005", "276-7596-006", "276-7596-008", "276-7596-009",
    "276-7596-010", "276-8354-404", "276-9250-024",
}

FIELD_CLASSES = {
    # goal + fiducial parts
    # the toggle bar (656.2 x 51.6 mm, one per field edge)
    "276-9250-023_GREY": "toggle",
    # the white tape on the mat
    "Tape- Corner Zone_Blue Loader Zone": "tape",
    "Tape- Corner Zone_Red Loader Zone": "tape",
    "Tape- Toggle Zones_Diamond Center- Divided Zones": "tape",
    # the four corner elements
    "276-8354-404": "corner",
    "SBT0832_276-4993-001": "corner",
    "SBT0832_276-8016-001": "corner",
    # the loaders
    "276-9250-031_Blue Loader": "loader",
    "276-9250-031_Red Loader": "loader",
    "276-9250-032": "loader",
    # the perimeter + alliance-station walls
    "276-6904-001": "wall",
    "276-7596-005": "wall",
    "276-7596-006": "wall",
    "276-7596-008": "wall",
    "276-7596-009": "wall",
    "276-7596-010": "wall",
    "276-7596-014": "wall",
    "276-7596-015": "wall",
    "276-7596-316": "wall",
    "276-7596-317_Corner": "wall",
    "276-7596-350_276-7596-301": "wall",
    "276-7596-350_276-7596-302": "wall",
    "276-7596-350_276-7596-303": "wall",
    "276-7596-350_276-7596-304": "wall",
    "276-7596-350_276-7596-305": "wall",
    "276-7596-350_276-7596-306": "wall",
    "276-7596-350_276-7596-307": "wall",
    "276-7596-350_276-7596-308": "wall",
    "276-7596-350_276-7596-309": "wall",
    "276-9250-021": "wall",
    "276-9250-022": "wall",
    "276-9250-024": "wall",
    "Wall Alliance Stations_PMS 199c - Bright Red": "wall",
    "Wall Alliance Stations_PMS 299c - Bright Blue": "wall",
}

# ---------------------------------------------------------------------------
# field_slim.glb -- the browser build.
#
# Same part-name nodes as field.glb, but only the parts that read as field
# elements: the mat, the tape, the perimeter wall structure, the alliance
# walls, the loaders, the goals and the toggles.  The micro-hardware
# (screws, standoffs, bumper-tape tubes) and the dense machined brackets
# are left out.
# ---------------------------------------------------------------------------
SLIM_KEEP = {
    # the mat (618 x 618 mm floor panels, 6 x 6 on the 598.06 mm grid)
    "276-6904-001": "mat",
    # the white tape
    "Tape- Corner Zone_Blue Loader Zone": "tape",
    "Tape- Corner Zone_Red Loader Zone": "tape",
    "Tape- Toggle Zones_Diamond Center- Divided Zones": "tape",
    # the perimeter wall structure
    "276-7596-014": "wall",
    "276-7596-015": "wall",
    "276-7596-316": "wall",
    "276-7596-317_Corner": "wall",
    "276-7596-350_276-7596-301": "wall",
    "276-7596-350_276-7596-302": "wall",
    "276-7596-350_276-7596-303": "wall",
    "276-7596-350_276-7596-304": "wall",
    "276-7596-350_276-7596-305": "wall",
    "276-7596-350_276-7596-306": "wall",
    "276-7596-350_276-7596-307": "wall",
    "276-7596-350_276-7596-308": "wall",
    "276-7596-350_276-7596-309": "wall",
    "276-7596-351_276-7596-313": "wall",
    "276-7596-351_276-7596-314": "wall",
    "276-7596-351_276-7596-315": "wall",
    # the four alliance-side wall sections (the toggle bar is part of these)
    "276-9250-021": "wall",
    "276-9250-022": "wall",
    "276-9250-023_GREY": "toggle",
    "Wall Alliance Stations_PMS 199c - Bright Red": "wall",
    "Wall Alliance Stations_PMS 299c - Bright Blue": "wall",
    # the four loaders
    "276-9250-031_Blue Loader": "loader",
    "276-9250-031_Red Loader": "loader",
    "276-9250-032": "loader",
    # the nine goals (with their fiducials and legs)
    "276-9250-003_Master": "goal",
    "276-9250-004": "goal",
    "276-9250-005": "goal",
    "276-9250-006_AprilTag 0": "goal",
    "276-9250-006_AprilTag 1": "goal",
    "276-9250-006_AprilTag 2": "goal",
    "276-9250-006_AprilTag 3": "goal",
    "276-9250-006_AprilTag 4": "goal",
    "276-4847-011": "goal",
    "SBT0832_276-5006-001": "goal",
    "SBT0832_276-5007-001": "goal",
    "THF0832-0250_275-1014-001": "goal",
    "THF0832-0250_275-1020-001": "goal",
    "THF0832-0250_275-1023-001": "goal",
    # the four corner elements
    "SBT0832_276-4993-001": "corner",
    "SBT0832_276-8016-001": "corner",
}

SLIM_DEFLECTION = {
    "mat": (2.0, 0.9),
    "tape": (1.0, 0.6),
    "wall": (3.0, 0.8),
    "toggle": (1.0, 0.6),
    "loader": (1.5, 0.8),
    "goal": (1.5, 0.9),
    "corner": (1.5, 0.8),
}

# The slim field also carries the nine goals.  The web app renders the goals
# from the goal_*.glb files as well, so loading both would draw every goal
# twice; set this to False if the app should draw the goals only once.
INCLUDE_GOALS_IN_SLIM = "--slim-goals" in sys.argv

# The 276-7596-350_* / -351_* products are the perimeter wall's base trim
# and lower panel (1187.79 mm strips along each edge) -- NOT the scoring
# objects.  They are excluded by default because they make the wall read as
# a handful of field-spanning plates; pass --with-wall-trim to include them.
WITH_WALL_TRIM = "--with-wall-trim" in sys.argv

# leaf products that end up in field.glb
FIELD_KEEP_LEAVES = {
    # the mat: 36 floor panels, 618.06 x 16 mm, a 6 x 6 grid
    "276-6904-001",
    # the perimeter wall: the corner/mid posts
    "276-7596-316", "276-7596-317_Corner",
    # the four alliance-side wall sections (they carry the toggle bars)
    "276-9250-021", "276-9250-022", "276-9250-023_GREY", "276-9250-024",
    "276-9250-027",
    # the alliance-station walls
    "Wall Alliance Stations_PMS 199c - Bright Red",
    "Wall Alliance Stations_PMS 299c - Bright Blue",
    # the white tape on the mat
    "Tape- Toggle Zones_Diamond Center- Divided Zones",
    "Tape- Corner Zone_Red Loader Zone",
    "Tape- Corner Zone_Blue Loader Zone",
    # the four loaders
    "276-9250-031_Red Loader", "276-9250-031_Blue Loader", "276-9250-032",
    # the four corner elements
    "276-8354-404", "SBT0832_276-4993-001", "SBT0832_276-8016-001",
}

# the class each kept leaf belongs to (drives the tessellation density)
FIELD_LEAF_CLASS = {
    "276-6904-001": "mat",
    "276-9250-023_GREY": "toggle",
    "276-9250-031_Red Loader": "loader",
    "276-9250-031_Blue Loader": "loader",
    "276-9250-032": "loader",
}
for _n in ("276-7596-014", "276-7596-015", "276-7596-316", "276-7596-317_Corner",
           "276-7596-350_276-7596-301", "276-7596-350_276-7596-302",
           "276-7596-350_276-7596-303", "276-7596-350_276-7596-304",
           "276-7596-350_276-7596-305", "276-7596-350_276-7596-306",
           "276-7596-350_276-7596-307", "276-7596-350_276-7596-308",
           "276-7596-350_276-7596-309",
    "276-7596-350_276-7596-310",
    "276-7596-350_276-7596-311",
    "276-7596-350_276-7596-312", "276-7596-351_276-7596-313",
           "276-7596-351_276-7596-314", "276-7596-351_276-7596-315",
           "276-9250-021", "276-9250-022", "276-9250-024", "276-9250-027"):
    FIELD_LEAF_CLASS[_n] = "wall"
for _n in ("Wall Alliance Stations_PMS 199c - Bright Red",
           "Wall Alliance Stations_PMS 299c - Bright Blue"):
    FIELD_LEAF_CLASS[_n] = "wall"
for _n in ("Tape- Toggle Zones_Diamond Center- Divided Zones",
           "Tape- Corner Zone_Red Loader Zone",
           "Tape- Corner Zone_Blue Loader Zone"):
    FIELD_LEAF_CLASS[_n] = "tape"
for _n in ("276-8354-404", "SBT0832_276-4993-001", "SBT0832_276-8016-001"):
    FIELD_LEAF_CLASS[_n] = "corner"

if WITH_WALL_TRIM:
    for _i in range(301, 313):
        FIELD_KEEP_LEAVES.add("276-7596-350_276-7596-%d" % _i)
        FIELD_LEAF_CLASS["276-7596-350_276-7596-%d" % _i] = "wall"
    for _n in ("276-7596-351_276-7596-313", "276-7596-351_276-7596-314",
               "276-7596-351_276-7596-315", "276-7596-014", "276-7596-015"):
        FIELD_KEEP_LEAVES.add(_n)
        FIELD_LEAF_CLASS[_n] = "wall"

# Parts that are one continuous surface and may stay a single mesh; every
# other part is emitted as one mesh per instance so that no mesh spans the
# whole field.
FIELD_MERGE_AS_ONE = {
    "276-6904-001",
    "Tape- Corner Zone_Blue Loader Zone",
    "Tape- Corner Zone_Red Loader Zone",
    "Tape- Toggle Zones_Diamond Center- Divided Zones",
}

FIELD_DEFLECTION = {
    "goal": (0.8, 0.6),
    "toggle": (0.8, 0.8),
    "tape": (1.0, 0.8),
    "loader": (1.5, 1.0),
    "corner": (2.0, 1.2),
    "wall": (3.0, 1.2),
    "mat": (2.0, 1.2),
}

# The scoring objects that are *not* part of the static field.
SCORING_KINDS = ("276-9250-81x", "276-9250-80x_")


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def file_sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def fmt(v, n=2):
    return "(" + ", ".join(f"{x:.{n}f}" for x in v) + ")"


# --------------------------------------------------------------------------
# field frame
# --------------------------------------------------------------------------
class Frame:
    """The normalised field frame: X = east, Y = north, Z = up, origin = centre."""

    def __init__(self, X, Y, Z, origin):
        self.X = X
        self.Y = Y
        self.Z = Z
        self.origin = np.asarray(origin, float)
        self.R = np.stack([X, Y, Z], axis=1)      # world -> frame rotation

    def point(self, p):
        return self.R.T @ (np.asarray(p, float) - self.origin)

    def matrix(self, M):
        """4x4 world transform -> 4x4 field-frame transform."""
        out = np.eye(4)
        out[:3, :3] = self.R.T @ M[:3, :3]
        out[:3, 3] = self.R.T @ (M[:3, 3] - self.origin)
        return out


def solve_frame(model: Model, goal_nodes, up_world):
    """Find the horizontal rotation + origin that put the goals on the manual grid.

    The vertical axis comes from the CAD (the goals' symmetry axis).  The
    horizontal rotation is solved by matching the *azimuth* of the eight
    outer goals against the game manual's 25-inch grid -- matching on angle
    rather than on position keeps the solve stable even if the CAD's radial
    spacing differs from the manual.
    """
    # the midfield goal defines the field centre
    centre_node = None
    for g in goal_nodes:
        if "Neutral Goal 0" in g["name"]:
            centre_node = g
    if centre_node is None:
        raise RuntimeError("midfield goal not found")
    centre = model.mat(centre_node)[:3, 3]

    a = np.array([1.0, 0.0, 0.0])
    if abs(np.dot(a, up_world)) > 0.9:
        a = np.array([0.0, 1.0, 0.0])
    e1 = a - np.dot(a, up_world) * up_world
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up_world, e1)
    e2 /= np.linalg.norm(e2)

    # manual slots (excluding midfield) with their azimuth
    manual = {gid: (mx, my) for gid, (mx, my, *_) in MANUAL_GOALS.items()
              if gid != "g-center"}
    man_ang = sorted(math.atan2(my, mx) for mx, my in manual.values())

    pts = [(g["name"], model.mat(g)[:3, 3]) for g in goal_nodes]

    best = None
    for k in range(4):
        th = k * math.pi / 2
        c, s = math.cos(th), math.sin(th)
        for flip in (1, -1):
            X = flip * (c * e1 + s * e2)
            Y = flip * (-s * e1 + c * e2)
            angs = []
            for name, p in pts:
                if "Neutral Goal 0" in name:
                    continue
                d = np.asarray(p, float) - centre
                angs.append(math.atan2(float(d @ Y), float(d @ X)))
            angs.sort()
            if len(angs) != len(man_ang):
                continue
            # best circular alignment
            n_ang = len(man_ang)
            err = min(
                sum(abs(_wrap(a - man_ang[(j + s0) % n_ang]))
                    for j, a in enumerate(angs))
                for s0 in range(n_ang))
            if best is None or err < best[0]:
                best = (err, X, Y, k, flip)
    err, X, Y, k, flip = best
    Z = np.cross(X, Y)
    if np.dot(Z, up_world) < 0:
        raise RuntimeError("field frame is left-handed -- up-axis sign is wrong")
    return Frame(X, Y, Z, centre), {"angleErrorDeg": math.degrees(err),
                                    "rotationIndex": k, "flip": flip}


def _wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


# --------------------------------------------------------------------------
# goals
# --------------------------------------------------------------------------
def goal_local_frame(model: Model, goal_node):
    """The goal's own frame: origin + local up axis (the funnel's axis).

    The axis is taken from the moulded funnel "276-9250-003_Master" (it is
    present in every goal and is a body of revolution), and its sign is
    chosen so that the funnel points away from the pedestal, i.e. so that
    the local +Y is "up".
    """
    M = model.mat(goal_node)
    Mi = np.linalg.inv(M)
    best = None
    for c in goal_node.get("children", []):
        if not c.get("is_leaf"):
            continue
        if "Master" not in c["name"] and best is not None:
            continue
        shp = model.brep(c["proto"])
        if shp is None:
            continue
        cen = fa._dominant_axis(shp)
        if cen is None:
            continue
        if best is None or "Master" in c["name"]:
            best = (c, cen)
    if best is None:
        return M, Mi, np.array([0.0, 1.0, 0.0])
    child, cen = best
    Mrel = Mi @ model.mat(child)
    axis = Mrel[:3, :3] @ cen["axis"]
    axis = axis / np.linalg.norm(axis)
    # the funnel sits above the goal origin: force the sign accordingly
    info = model.part_info(child["proto"])
    l = np.array(info["bbox_lo"])
    h = np.array(info["bbox_hi"])
    c = (l + h) / 2
    p = Mrel[:3, :3] @ c + Mrel[:3, 3]
    if float(p @ axis) < 0:
        axis = -axis
    return M, Mi, axis


def measure_goal(model: Model, goal_node):
    """Measure one goal instance in its own local frame.

    A goal is a moulded funnel ("276-9250-003_Master", 82.5 mm tall) that
    optionally sits on a pedestal ("276-9250-004" for the short neutral
    goals, "276-9250-005" for the tall midfield one).  The *game* height is
    funnel + pedestal; the corner posts, the drain bolt and the AprilTags
    are accessories that stick out beyond it and are therefore excluded.
    """
    M, Mi, axis = goal_local_frame(model, goal_node)

    # per-child extent along the goal's own axis
    children = []
    for leaf in model.leaves([goal_node]):
        info = model.part_info(leaf["proto"])
        l = np.array(info["bbox_lo"])
        h = np.array(info["bbox_hi"])
        Mrel = Mi @ model.mat(leaf)
        c = np.array([[x, y, z] for x in (l[0], h[0]) for y in (l[1], h[1])
                      for z in (l[2], h[2])])
        w = (Mrel[:3, :3] @ c.T).T + Mrel[:3, 3]
        s = w @ axis
        children.append({"leaf": leaf, "name": leaf["name"],
                         "s_min": float(s.min()), "s_max": float(s.max()),
                         "extent": float(s.max() - s.min())})

    master = max((c for c in children if "Master" in c["name"]),
                 key=lambda c: c["extent"], default=None)
    if master is None:
        master = max(children, key=lambda c: c["extent"])
    top_s = master["s_max"]

    # The pedestal is the single body part that lies entirely below the
    # origin.  The four corner legs (THF0832-*) also hang below it but
    # appear four times, so they are excluded by the "appears once" rule.
    names = [c["name"] for c in children]
    below = [c for c in children
             if c is not master and c["s_max"] <= 0.5 and c["extent"] > 20
             and names.count(c["name"]) == 1]
    pedestal = max(below, key=lambda c: c["extent"], default=None)
    base_s = pedestal["s_min"] if pedestal else master["s_min"]
    height = top_s - base_s

    # the goal's origin sits on the symmetry axis (the funnel's bounding box
    # is symmetric about x=z=0), so the base centre is the origin projected
    # onto the base plane.
    base_centre = axis * base_s

    socket = find_bore(model, goal_node, axis, base_s)
    plan = plan_size(model, goal_node, axis)
    return {"node": goal_node, "M": M, "Mi": Mi, "axis": axis,
            "height": height, "base_s": base_s, "top_s": top_s,
            "master": master["name"], "pedestal": pedestal["name"] if pedestal else None,
            "base_centre_local": base_centre, "socket": socket, "plan": plan}


def goal_local_bbox(model: Model, goal_node):
    M = model.mat(goal_node)
    Mi = np.linalg.inv(M)
    lo = np.full(3, 1e30)
    hi = np.full(3, -1e30)
    for leaf in model.leaves([goal_node]):
        info = model.part_info(leaf["proto"])
        l = np.array(info["bbox_lo"])
        h = np.array(info["bbox_hi"])
        Mrel = Mi @ model.mat(leaf)          # part frame -> goal frame
        c = np.array([[x, y, z] for x in (l[0], h[0]) for y in (l[1], h[1])
                      for z in (l[2], h[2])])
        w = (Mrel[:3, :3] @ c.T).T + Mrel[:3, 3]
        lo = np.minimum(lo, w.min(axis=0))
        hi = np.maximum(hi, w.max(axis=0))
    return lo, hi


def find_bore(model: Model, goal_node, axis, base_s):
    """Find the scoring-object bore in a goal.

    The goal is a moulded funnel ("276-9250-003_Master"), so the socket is
    the funnel's throat rather than a plain cylinder.  We build the radius
    profile of the funnel along its own axis and report:

      radius  the bore's radius at the rim (where the object enters)
      z       the rim's height above the goal's base
      depth   rim down to the throat (the narrowest point of the bore)
      throatRadius / throatHeight  the narrowest point of the bore

    Everything is in the goal's own local frame; x/y are the offsets from
    the goal's axis (zero, the bore is coaxial).
    """
    Mi = np.linalg.inv(model.mat(goal_node))
    funnel = None
    for leaf in goal_node.get("children", []):
        if leaf.get("is_leaf") and "Master" in leaf["name"]:
            funnel = leaf
            break
    if funnel is None:
        return None
    shp = model.brep(funnel["proto"])
    if shp is None:
        return None
    Mrel = Mi @ model.mat(funnel)            # funnel frame -> goal frame
    cen = fa._dominant_axis(shp)
    if cen is None:
        return None
    ax_m = np.asarray(cen["axis"], float)
    ax_m = ax_m / np.linalg.norm(ax_m)
    ax_g = Mrel[:3, :3] @ ax_m
    ax_g = ax_g / np.linalg.norm(ax_g)
    offset = float(Mrel[:3, 3] @ ax_g)       # s_goal = s_funnel + offset

    prof = fa.axial_profile(shp, ax_m)
    faces = []
    for p in prof:
        if p["kind"] not in ("cyl", "cone"):
            continue
        if not (8.0 <= p["r_max"] <= 60.0):
            continue
        faces.append(p)
    if not faces:
        return None

    rim = max(faces, key=lambda f: f["s_max"])
    below = [f for f in faces if f["s_max"] <= rim["s_max"] + 1.0]
    throat = min(below, key=lambda f: min(f["r_min"], f["r_max"]))
    throat_r = min(throat["r_min"], throat["r_max"])
    throat_s = (throat["s_min"] if throat.get("r_at_smin", throat["r_min"])
                <= throat.get("r_at_smax", throat["r_max"]) else throat["s_max"])
    rim_r = rim.get("r_at_smax", rim["r_max"])
    return {"x": 0.0, "y": 0.0,
            "z": round(float(rim["s_max"] + offset - base_s), 2),
            "radius": round(float(rim_r), 2),
            "depth": round(float(rim["s_max"] - throat_s), 2),
            "throatRadius": round(float(throat_r), 2),
            "throatHeight": round(float(throat_s + offset - base_s), 2),
            "rimRadius": round(float(rim_r), 2),
            "rimLocal": round(float(rim["s_max"] + offset), 2)}


def _faces_of(shp):
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS

    out = []
    ex = TopExp_Explorer(shp, TopAbs_FACE)
    while ex.More():
        out.append(TopoDS.Face_s(ex.Current()))
        ex.Next()
    return out


def plan_size(model: Model, goal_node, axis):
    """Across-corners / across-flats of the goal's octagonal plan."""
    M = model.mat(goal_node)
    Mi = np.linalg.inv(M)
    # the plan is set by the funnel: use the biggest radius of the largest
    # revolved part of the goal
    best = 0.0
    for leaf in goal_node.get("children", []):
        if not leaf.get("is_leaf") or "Master" not in leaf["name"]:
            continue
        shp = model.brep(leaf["proto"])
        if shp is None:
            continue
        cen = fa._dominant_axis(shp)
        if cen is None:
            continue
        prof = fa.axial_profile(shp, cen["axis"])
        b = fa.profile_bounds(prof)
        if b:
            best = max(best, b["rMax"])
    if not best:
        return {}
    return {"acrossCorners": round(2 * best, 2),
            "acrossFlats": round(2 * best * math.cos(math.radians(22.5)), 2),
            "circumradius": round(best, 2),
            "apothem": round(best * math.cos(math.radians(22.5)), 2)}


# --------------------------------------------------------------------------
# halves
# --------------------------------------------------------------------------
def measure_half(model: Model, name):
    """Measure one scoring-object half part.

    Both the pin half and the cup half are moulded parts: a tapered funnel
    with a wider collar at the end that mates with the other half.  We
    report the funnel's two radii, the collar's height and the overall
    maximum radius, plus the transform that puts the wide ("base") end at
    the origin with the axis along +Z so the app can stack two halves.
    """
    idx = None
    for k, v in model.parts.items():
        if v["name"] == name:
            idx = v["index"]
            break
    if idx is None:
        return None
    shp = model.brep(idx)
    info = model.part_info(idx)
    lo = np.array(info["bbox_lo"])
    hi = np.array(info["bbox_hi"])
    cen = fa._dominant_axis(shp)
    if cen is None:
        return None
    axis = np.asarray(cen["axis"], float)
    axis = axis / np.linalg.norm(axis)
    prof = fa.axial_profile(shp, axis)
    b = fa.profile_bounds(prof)
    s_min = min(p["s_min"] for p in prof)
    s_max = max(p["s_max"] for p in prof)
    r_max = max(p["r_max"] for p in prof)

    # the main funnel wall: the widest cone with a real taper
    cones = [p for p in prof if p["kind"] == "cone"
             and (p["s_max"] - p["s_min"]) > 15.0]
    main = max(cones, key=lambda p: max(p["r_min"], p["r_max"])) if cones else None
    if main is None:
        r_top = r_bot = 0.0
    else:
        r_top = float(min(main["r_min"], main["r_max"]))
        r_bot = float(max(main["r_min"], main["r_max"]))

    # which end is the wide ("base") end?
    def end_radius(s_end):
        near = [p for p in prof if abs(p["s_min"] - s_end) < 15.0
                or abs(p["s_max"] - s_end) < 15.0]
        return max((p["r_max"] for p in near), default=0.0)

    r_at_min = end_radius(s_min)
    r_at_max = end_radius(s_max)
    base_at_max = r_at_max >= r_at_min

    # collar height: the band where the radius is within 2 % of r_max
    collar = [p for p in prof if p["r_max"] >= r_max * 0.98]
    flange = (max(p["s_max"] for p in collar) - min(p["s_min"] for p in collar)
              if collar else 0.0)

    return {"name": name, "index": idx, "axis": axis,
            "axisPoint": np.asarray(cen["point"], float).tolist(),
            "bbox_lo": lo.tolist(), "bbox_hi": hi.tolist(),
            "height": round(float(b["height"]), 2),
            "rMax": round(float(r_max), 2),
            "rTop": round(r_top, 2), "rBottom": round(r_bot, 2),
            "flange": round(float(flange), 2),
            "baseAtMax": base_at_max,
            "sMin": round(float(s_min), 2), "sMax": round(float(s_max), 2),
            "profile": prof}


def half_export_frame(half):
    """Transform putting the half's wide (base) end at the origin.

    The tip points along -Z, which is what the app expects (it rotates every
    CAD mesh by -90 deg about X, so CAD -Z becomes three.js -Y, and the app
    authors halves "flange at the origin, tip down").

    The rotation maps the part's own axis onto the export frame's +Z, so
    the exported mesh is the half standing on its base with the tip
    pointing up -- which is how the app stacks two of them.
    """
    axis = np.asarray(half["axis"], float)
    axis = axis / np.linalg.norm(axis)
    s_min = half["sMin"]
    s_max = half["sMax"]
    # the part's axis line: it passes through the dominant face's axis point
    anchor = half.get("axisPoint")
    if anchor is None:
        anchor = np.zeros(3)
    anchor = np.asarray(anchor, float)
    # The web app authors a half "flange at the origin, tip towards -Y" and
    # flips it 180 deg about X for the upper half of a pin.  The app applies
    # a -90 deg X rotation to every CAD mesh (CAD +Z -> three +Y), so the
    # tip has to point along CAD -Z in the file.
    if half["baseAtMax"]:
        e_z = axis
        origin_s = s_max
    else:
        e_z = -axis
        origin_s = s_min
    # a perpendicular pair in the part frame
    a = np.array([1.0, 0.0, 0.0])
    if abs(np.dot(a, e_z)) > 0.9:
        a = np.array([0.0, 1.0, 0.0])
    w = a - np.dot(a, e_z) * e_z
    w /= np.linalg.norm(w)
    v = np.cross(e_z, w)
    # part frame basis -> export frame basis
    B_part = np.stack([e_z, w, v], axis=1)          # columns
    B_target = np.array([[0.0, 1.0, 0.0],
                         [0.0, 0.0, 1.0],
                         [1.0, 0.0, 0.0]])          # columns e_z, e_x, e_y
    R = B_target @ B_part.T
    # the base point on the axis (s is measured along `axis`, not e_z)
    p0 = anchor + axis * (origin_s - float(anchor @ axis))
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = -R @ p0
    return M, {"wideEnd": "max" if half["baseAtMax"] else "min",
               "rBase": half["rMax"]}


# --------------------------------------------------------------------------
# toggles
# --------------------------------------------------------------------------
TOGGLE_PART = "276-9250-023_GREY"


def cluster_toggles(model: Model, frame: Frame):
    """Find the 4 Toggle bars.

    The Toggle has no product of its own: it is the 656.2 x 51.6 mm bar
    "276-9250-023_GREY" that the perimeter wall assembly carries at the
    midpoint of each field edge.  (The clusters of small parts near the
    field corners are a different element.)
    """
    bars = [n for n in model.leaves() if n["name"] == TOGGLE_PART]
    clusters = [{"members": [n]} for n in bars]
    return clusters


def measure_toggle(model: Model, cluster, frame: Frame):
    """Measure one toggle bar: its own size, its place on the wall and the
    direction it runs in."""
    lo = np.full(3, 1e30)
    hi = np.full(3, -1e30)
    n = cluster["members"][0]
    info = model.part_info(n["proto"])
    l = np.array(info["bbox_lo"])
    h = np.array(info["bbox_hi"])
    # the part's own size (in its own frame)
    own = {"length": round(float(h[0] - l[0]), 2),
           "width": round(float(h[1] - l[1]), 2),
           "height": round(float(h[2] - l[2]), 2)}
    M = model.mat(n)
    c = np.array([[x, y, z] for x in (l[0], h[0]) for y in (l[1], h[1])
                  for z in (l[2], h[2])])
    w = (M[:3, :3] @ c.T).T + M[:3, 3]
    lo = w.min(axis=0)
    hi = w.max(axis=0)
    corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1])
                        for z in (lo[2], hi[2])])
    fc = np.array([frame.point(cc) for cc in corners])
    flo = fc.min(axis=0)
    fhi = fc.max(axis=0)
    centre = (flo + fhi) / 2
    # the part's own long axis, in the field frame
    ax = M[:3, 0]
    fx_ax = float(ax[0])
    fy_ax = float(-ax[2])
    yaw = math.atan2(fy_ax, fx_ax)
    # the bar runs along its edge: 0 on the north/south edges, pi/2 on the
    # east/west ones (the bar is symmetric, so only the direction modulo
    # pi matters -- pick the positive representative to match the spec)
    rotz = 0.0 if abs(math.cos(yaw)) >= abs(math.sin(yaw)) else math.pi / 2
    edge = ("top" if abs(centre[1]) > abs(centre[0]) else
            ("right" if centre[0] > 0 else "left"))
    if abs(centre[1]) > abs(centre[0]):
        edge = "top" if centre[1] > 0 else "bottom"
    return {"edge": edge, "rotationZ": rotz,
            "centreField": centre.tolist(),
            "size": (fhi - flo).tolist(),
            "product": TOGGLE_PART,
            "length": own["length"], "width": own["width"],
            "height": own["height"],
            "yawDeg": round(math.degrees(yaw), 2),
            "members": [x["name"] for x in cluster["members"]],
            "bboxWorld": [lo.tolist(), hi.tolist()]}


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
FULL_DETAIL = "--full-detail" in sys.argv


def main():
    t0 = time.time()
    LOG("=== VEX3D field extraction ===")
    LOG(f"STEP : {steplib.STEP_PATH}")
    LOG(f"OUT  : {ASSETS}")

    if not steplib.cache_is_complete():
        LOG("cache missing -- reading STEP (takes ~8 minutes)")
        doc = steplib.read_step(steplib.STEP_PATH, progress=LOG)
        steplib.build_cache(doc, progress=LOG)

    model = Model()
    LOG(f"cache: {len(model.parts)} prototypes, {len(model.leaves())} leaf instances")

    goals = [n for n in model.walk() if n["name"].startswith("276-9250-840_")]
    cups = [n for n in model.walk() if n["name"] == "276-9250-81x"]
    pins = [n for n in model.walk() if n["name"].startswith("276-9250-80x_")]
    LOG(f"goals={len(goals)} cups={len(cups)} pins={len(pins)}")

    # ---- up-axis -------------------------------------------------------
    axes = []
    for g in goals:
        M, _Mi, ax = goal_local_frame(model, g)
        axes.append(M[:3, :3] @ ax)
    up_cad = np.mean(axes, axis=0)
    up_cad = up_cad / np.linalg.norm(up_cad)
    spread = max(abs(float(np.dot(a, up_cad))) for a in axes)
    LOG(f"goal up axes (CAD world): {np.round(up_cad, 5).tolist()}  "
        f"agreement |dot| >= {spread:.5f}")

    # ---- goals (measured first: the frame origin needs the mat level) ---
    variants = {}
    for g in goals:
        variants.setdefault(g["name"], []).append(g)

    goal_rows = []
    for name, nodes in sorted(variants.items()):
        m = measure_goal(model, nodes[0])
        base_world = m["M"][:3, 3] + m["axis"] * m["base_s"]
        goal_rows.append({"name": name, "m": m, "pos": None,
                          "baseWorld": base_world, "nodes": nodes,
                          "variant": goal_variant(name),
                          "instances": len(nodes)})
        LOG(f"  {name:32s} h={m['height']:7.2f} x{len(nodes)} "
            f"socket={m['socket']} plan={m['plan']}")

    # ---- frame ---------------------------------------------------------
    frame, frame_info = solve_frame(model, goals, up_cad)
    # The Z origin must be the mat surface, not the goal product's origin:
    # every goal stands on the mat, so the tallest goal's base gives it.
    tall_row = max(goal_rows, key=lambda r: r["m"]["height"])
    frame.origin = frame.origin + up_cad * float(tall_row["m"]["base_s"])
    LOG(f"frame: {frame_info}")
    LOG(f"  X={np.round(frame.X,4)}  Y={np.round(frame.Y,4)}  Z={np.round(frame.Z,4)}")
    LOG(f"  origin(CAD)={np.round(frame.origin,3)}  (mat level)")

    # one entry per goal *instance* (9 in total, not 7 product variants)
    goal_instances = []
    for row in goal_rows:
        for node in row["nodes"]:
            # 每个**实例**用自己的世界变换（同一个 PRODUCT 会出现多次，
            # 用 product 的 M 会让所有实例落在同一个位置）
            Mi_, _Mi2, ax_ = goal_local_frame(model, node)
            base_world = Mi_[:3, 3] + ax_ * row["m"]["base_s"]
            goal_instances.append({"row": row, "node": node,
                                   "pos": frame.point(base_world)})

    # assign the manual ids by azimuth
    assign = assign_goal_ids(goal_instances)
    LOG("goal id assignment:")
    for inst in goal_instances:
        gid, err = assign[inst["_k"]]
        LOG(f"  {inst['row']['name']:32s} -> {gid:8s} pos={fmt(inst['pos'])}  "
            f"manualErr={err:.1f} mm")

    # ---- halves --------------------------------------------------------
    halves = {}
    for part, colour in HALF_PARTS.items():
        h = measure_half(model, part)
        if h is None:
            continue
        M, info = half_export_frame(h)
        h["exportMatrix"] = M
        h["exportInfo"] = info
        halves[colour] = h
        LOG(f"  half {colour:7s} ({part[:34]:34s}) h={h['height']:7.2f} "
            f"rMax={h['rMax']:6.2f} rBottom={h['rBottom']:6.2f} "
            f"rTop={h['rTop']:6.2f} flange={h['flange']:5.2f} "
            f"wideEnd={info['wideEnd']}")

    # ---- toggles -------------------------------------------------------
    clusters = cluster_toggles(model, frame)
    toggles = []
    for c in clusters:
        t = measure_toggle(model, c, frame)
        toggles.append(t)
        LOG(f"  toggle {t['edge']:6s} centre={fmt(t['centreField'])} "
            f"size={np.round(t['size'],1).tolist()} parts={len(t['members'])}")
    toggles.sort(key=lambda t: t["edge"])

    # ---- assembled scoring-object heights ------------------------------
    def assembled_height(nodes):
        best = None
        for n in nodes:
            lo, hi = model.subtree_bbox(n)
            h = float(hi[1] - lo[1])
            best = h if best is None else max(best, h)
        return best

    pin_h = assembled_height(pins)
    cup_h = assembled_height(cups)
    LOG(f"  assembled pin height = {pin_h:.2f} mm, cup height = {cup_h:.2f} mm")

    # ---- start objects -------------------------------------------------
    start_objects = []
    for kind, nodes in (("pin", pins), ("cup", cups)):
        for n in nodes:
            Mf = frame.matrix(model.mat(n))
            rx, ry, rz = steplib.rot_yaw_pitch_roll(Mf)
            # the object stands on the mat: report its base centre (the
            # lowest point of the assembly, on the object's axis) so the
            # app can place it like the goals
            lo, hi = model.subtree_bbox(n)
            # the object's origin is on its axis, so the base centre shares
            # its X/Y; the base height is the lowest point of the assembly
            corners = np.array([[x, y, z] for x in (lo[0], hi[0])
                                for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
            min_pz = float((corners @ frame.Z).min())
            base_z = min_pz - float(frame.origin @ frame.Z)
            pos = np.array([Mf[0, 3], Mf[1, 3], base_z])
            start_objects.append({
                "kind": kind,
                "halves": half_colours(n),
                "position": [round(float(x), 2) for x in pos],
                "rotation": [round(rx, 6), round(ry, 6), round(rz, 6)],
            })
    LOG(f"  start objects: {len(start_objects)} "
        f"({sum(1 for o in start_objects if o['kind']=='pin')} pins, "
        f"{sum(1 for o in start_objects if o['kind']=='cup')} cups)")

    # ---- exports -------------------------------------------------------
    exports = export_assets(model, frame, goal_rows, halves, toggles)
    for k, v in exports.items():
        LOG(f"  wrote {k}: {v}")

    # ---- field.json ----------------------------------------------------
    field_json = build_field_json(model, frame, goal_rows, assign, halves,
                                  toggles, start_objects, pin_h, cup_h,
                                  exports.pop("_parts", {}), goal_instances)
    out_json = os.path.join(ASSETS, "field.json")
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(field_json, fh, indent=1, ensure_ascii=False)
    LOG(f"  wrote {out_json}")

    # ---- report --------------------------------------------------------
    report = build_report(model, frame, frame_info, goal_rows, assign, halves,
                          toggles, start_objects, exports, pin_h, cup_h,
                          goal_instances)
    out_rep = os.path.join(ASSETS, "field_report.json")
    with open(out_rep, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1, ensure_ascii=False)
    LOG(f"  wrote {out_rep}")
    print_report(report)

    LOG(f"TOTAL {time.time()-t0:.1f}s")
    return 0


def half_colours(node):
    out = []
    for leaf in node.get("children", []):
        if leaf.get("is_leaf"):
            c = HALF_PARTS.get(leaf["name"])
            if c:
                out.append(c)
    return out


def goal_variant(product_name: str) -> str:
    """alliance-red | alliance-blue | neutral-short | neutral-tall."""
    if "Neutral Goal 0" in product_name:
        return "neutral-tall"
    if "Neutral Goal" in product_name:
        return "neutral-short"
    if "Red" in product_name:
        return "alliance-red"
    return "alliance-blue"


def assign_goal_ids(goal_instances):
    """Match CAD goal instances to the manual's goal ids (by azimuth)."""
    manual = {gid: (mx, my) for gid, (mx, my, *_) in MANUAL_GOALS.items()
              if gid != "g-center"}
    used = set()
    assign = {}
    # 用实例在列表里的序号做键 —— id(dict) 会在 dict 被回收后复用，不可作为长期键
    for i, r in enumerate(goal_instances):
        r["_k"] = i
    # the tallest goal is the midfield one
    tall = max(goal_instances, key=lambda r: r["row"]["m"]["height"])
    assign[tall["_k"]] = ("g-center", 0.0)
    used.add("g-center")
    rest = [r for r in goal_instances if r is not tall]
    pairs = []
    for r in rest:
        ang = math.atan2(r["pos"][1], r["pos"][0])
        for gid, (mx, my) in manual.items():
            ma = math.atan2(my, mx)
            pairs.append((abs(_wrap(ang - ma)), r, gid))
    pairs.sort(key=lambda t: t[0])
    for _d, r, gid in pairs:
        if r["_k"] in assign or gid in used:
            continue
        used.add(gid)
        err = math.hypot(r["pos"][0] - manual[gid][0], r["pos"][1] - manual[gid][1])
        assign[r["_k"]] = (gid, err)
    return assign


# --------------------------------------------------------------------------
# exports
# --------------------------------------------------------------------------
def export_assets(model: Model, frame: Frame, goal_rows, halves, toggles):
    """Write field.glb, the half templates and the goal variants."""
    out = {}
    parts_map = {}

    # ---- static field (hierarchical, mirroring the CAD product tree) ----
    def build_field(defl_scale, ang_scale, drop_mat=False):
        """Build the field as a node tree mirroring the STEP product tree.

        The *assembly* product names become nodes too, so the web app can
        find e.g. "276-9250-120_Red Alliance Side" (the perimeter wall
        section) and "276-7596-000_Fixed Version" (the assembly that carries
        the mat).  The leaf parts keep their own names, so the app can still
        colour them individually.
        """
        groups = {}

        def merged_group(name, leaves, parent_world):
            klass = FIELD_LEAF_CLASS.get(name, "wall")
            defl, dang = FIELD_DEFLECTION.get(klass, (2.0, 0.8))
            defl = defl * defl_scale
            dang = min(1.6, dang * ang_scale)
            vs, ns, ts = [], [], []
            off = 0
            for leaf in leaves:
                v, n, t = steplib.mesh_at(model, leaf["proto"], defl, dang)
                if len(t) == 0:
                    continue
                # bake straight into the normalised field frame; the node
                # transforms stay identity so the web app can bake the
                # subtree without applying any transform twice
                M = frame.matrix(model.mat(leaf))
                v, n, t = tessellate.transform_mesh(v, n, t, M)
                vs.append(v)
                ns.append(n)
                ts.append(t + off)
                off += len(v)
            if not vs:
                return None
            g = gltfwriter.Group(name, np.concatenate(vs),
                                 np.concatenate(ns), np.concatenate(ts))
            groups[id(g)] = g
            return g

        def build(node, parent_world):
            out = []
            buckets = {}
            assemblies = []
            for child in node.get("children", []):
                if child.get("is_leaf"):
                    if child["name"] not in FIELD_KEEP_LEAVES:
                        continue
                    if drop_mat and child["name"] == "276-6904-001":
                        continue
                    buckets.setdefault(child["name"], []).append(child)
                else:
                    assemblies.append(child)
            for name, leaves in buckets.items():
                if name in FIELD_MERGE_AS_ONE:
                    g = merged_group(name, leaves, parent_world)
                    if g is None:
                        continue
                    out.append(gltfwriter.GNode(name, group=g))
                else:
                    # one mesh per instance: a merged mesh would span the
                    # whole field and read as a giant plate
                    for leaf in leaves:
                        g = merged_group(name, [leaf], parent_world)
                        if g is None:
                            continue
                        out.append(gltfwriter.GNode(name, group=g))
            for child in assemblies:
                M = model.mat(child)
                kids = build(child, M)
                if not kids:
                    continue
                out.append(gltfwriter.GNode(child["name"], children=kids))
            return out

        root = model.roots[0]
        root_world = model.mat(root)
        kids = build(root, root_world)
        # the root node carries no transform: the geometry is already in the
        # normalised field frame
        roots = [gltfwriter.GNode(root["name"], children=kids)]
        return roots, list(groups.values())

    roots, glist = build_field(1.0, 1.0)
    out["field.glb"] = gltfwriter.write_glb(
        os.path.join(ASSETS, "field.glb"), glist, roots, scene_name="field",
        extra={"units": "millimetres",
               "frame": "X=east Y=north Z=up, origin=field centre"},
        weld_mode="pos_normal")
    for i, g in enumerate(glist):
        s_ = g.summary()
        s_["node"] = i
        s_["mesh"] = i
        prev = parts_map.get(g.name)
        if prev is None:
            parts_map[g.name] = s_
        else:
            # the same part under several parents: keep the ranges of each
            prev.setdefault("nodes", []).append(
                {"node": i, "mesh": i,
                 "vertexStart": s_["vertexStart"],
                 "vertexCount": s_["vertexCount"],
                 "triStart": s_["triStart"], "triCount": s_["triCount"]})
            prev["occurrences"] = prev.get("occurrences", 1) + 1
            prev["totalVertices"] = prev.get("totalVertices",
                                            prev["vertexCount"]) + s_["vertexCount"]
            prev["totalTriangles"] = prev.get("totalTriangles",
                                              prev["triCount"]) + s_["triCount"]

    # a leaner build of the same scene for very slow connections: coarser
    # tessellation and no floor panels (the app's procedural mat has to
    # stay visible for this one)
    sroots, slist = build_field(1.6, 1.3, drop_mat=True)
    out["field_slim.glb"] = gltfwriter.write_glb(
        os.path.join(ASSETS, "field_slim.glb"), slist, sroots,
        scene_name="field_slim",
        extra={"units": "millimetres",
               "frame": "X=east Y=north Z=up, origin=field centre"},
        weld_mode="pos_normal")

    # ---- half templates ------------------------------------------------
    for colour, h in halves.items():
        v, n, t = steplib.mesh_at(model, h["index"], DEFL_HALF, ANG)
        if len(t) == 0:
            continue
        v, n, t = tessellate.transform_mesh(v, n, t, h["exportMatrix"])
        g = gltfwriter.Group(colour, v, n, t)
        out[f"half_{colour}.glb"] = gltfwriter.write_glb(
            os.path.join(ASSETS, f"half_{colour}.glb"), [g],
            roots=[gltfwriter.GNode(colour, group=g)],
            scene_name=f"half_{colour}",
            extra={"units": "millimetres",
                   "convention": "origin at the wide (base) end, axis +Z"})

    # ---- goal variants -------------------------------------------------
    for row in goal_rows:
        variant = row["variant"]
        node = row["m"]["node"]
        Mi = row["m"]["Mi"]
        # one child node per source PRODUCT, so the app can colour by name
        by_part = {}
        for leaf in model.leaves([node]):
            by_part.setdefault(leaf["name"], []).append(leaf)
        gmap = {}
        part_nodes = []
        # The goal product's own frame has its up along +Y (the CAD frame).
        # Rotate it into the normalised field frame (Z up) so the goal file
        # matches field.glb and the goal_*.glb / half_*.glb convention.
        R_inst = row["m"]["M"][:3, :3]
        Mrot = np.eye(4)
        Mrot[:3, :3] = frame.R.T @ R_inst
        # the goal's base centre goes to the origin
        base_local = row["m"]["base_centre_local"]
        Mshift = Mrot.copy()
        Mshift[:3, 3] = Mrot[:3, :3] @ (-base_local)
        for part_name, leaves in by_part.items():
            vs, ns, ts = [], [], []
            off = 0
            for leaf in leaves:
                v, n, t = steplib.mesh_at(model, leaf["proto"], DEFL_GOAL, ANG)
                if len(t) == 0:
                    continue
                # bake the part into the goal's own frame, base centre at the
                # origin; the node itself carries no transform
                M = Mshift @ (Mi @ model.mat(leaf))
                v, n, t = tessellate.transform_mesh(v, n, t, M)
                vs.append(v)
                ns.append(n)
                ts.append(t + off)
                off += len(v)
            if not vs:
                continue
            g = gltfwriter.Group(part_name, np.concatenate(vs),
                                 np.concatenate(ns), np.concatenate(ts))
            gmap[part_name] = g
            part_nodes.append(gltfwriter.GNode(part_name, group=g))
        goal_node = gltfwriter.GNode(row["name"], children=part_nodes)
        out[f"goal_{variant}.glb"] = gltfwriter.write_glb(
            os.path.join(ASSETS, f"goal_{variant}.glb"), list(gmap.values()),
            roots=[goal_node], scene_name=variant,
            extra={"units": "millimetres",
                   "convention": "origin at the goal base centre, axis +Z",
                   "parts": sorted(gmap.keys())})
    out["_parts"] = parts_map
    return out


# --------------------------------------------------------------------------
# field.json
# --------------------------------------------------------------------------
def build_field_json(model, frame, goal_rows, assign, halves, toggles,
                     start_objects, pin_h=None, cup_h=None, parts_map=None,
                     goal_instances=None):
    goals = []
    for inst in (goal_instances or []):
        gid, _err = assign[inst["_k"]]
        row = inst["row"]
        m = row["m"]
        variant = row["variant"]
        if variant == "neutral-tall":
            quad, alliance = "midfield", None
        else:
            quad = MANUAL_GOALS[gid][3]
            alliance = MANUAL_GOALS[gid][4]
        socket = m["socket"] or {"x": 0, "y": 0, "z": 0, "radius": 0, "depth": 0}
        goals.append({
            "id": gid,
            "variant": variant,
            "position": [round(float(inst["pos"][0]), 2),
                         round(float(inst["pos"][1]), 2), 0.0],
            "rotationY": 0.0,
            "quadrant": quad,
            "alliance": alliance,
            "height": round(float(m["height"]), 2),
            "baseRadius": m["plan"].get("circumradius", 0),
            "topRadius": round(m["plan"].get("circumradius", 0) * 0.55, 2),
            "socket": {"x": round(float(socket.get("x", 0)), 2),
                       "y": round(float(socket.get("y", 0)), 2),
                       "z": round(float(socket.get("z", 0)), 2),
                       "radius": round(float(socket.get("radius", 0)), 2),
                       "depth": round(float(socket.get("depth", 0)), 2)},
            "sourceProduct": row["name"],
        })
    order = {"g-n1": 0, "g-n2": 1, "g-n3": 2, "g-n4": 3, "g-center": 4,
             "g-r1": 5, "g-r2": 6, "g-b1": 7, "g-b2": 8}
    goals.sort(key=lambda g: order.get(g["id"], 99))

    # The Toggle is the 656.2 x 51.6 mm bar ("276-9250-023_GREY") that sits
    # at the midpoint of each field edge, bolted to the perimeter wall.
    # The clusters at the field corners are a different element entirely.
    toggle_specs = []
    for t in toggles:
        c = t["centreField"]
        toggle_specs.append({
            "id": t["edge"],
            "position": [round(float(c[0]), 2), round(float(c[1]), 2),
                         round(float(c[2]), 2)],
            "rotationZ": t["rotationZ"],
            "length": t.get("length"),
            "width": t.get("width"),
            "height": t.get("height"),
            "product": t.get("product"),
        })
    toggle_specs.sort(key=lambda t: ["top", "right", "bottom", "left"].index(t["id"]))

    def half_spec(colour):
        h = halves.get(colour)
        if not h:
            return {}
        return {"height": round(float(h["height"]), 2),
                "rTop": h["rTop"],
                "rBottom": h["rBottom"],
                "flange": h["flange"],
                "rMax": h["rMax"]}

    pin_spec = half_spec("red")
    cup_spec = half_spec("clear")
    pin_height = pin_h if pin_h else 2 * pin_spec.get("height", 0)
    cup_height = cup_h if cup_h else 2 * cup_spec.get("height", 0)
    # the two halves overlap by their collars when stacked
    nest = 2 * pin_spec.get("height", 0) - pin_height
    return {
        "buildId": build_id(),
        "source": os.path.basename(steplib.STEP_PATH),
        "fieldSize": 3657.6,
        "goals": goals,
        "toggles": toggle_specs,
        "halves": {"pin": pin_spec, "cup": cup_spec},
        "pinHeight": round(float(pin_height), 2),
        "cupHeight": round(float(cup_height), 2),
        "nestDepth": round(float(nest), 2),
        "startObjects": start_objects,
        "startObjectsNote":
            "The CAD does NOT contain start-of-match positions for the 63 pins "
            "and 56 cups: they are laid out in a staging arrangement (rows of "
            "cups and pins outside the west wall, a packing grid inside the "
            "field, one pin on the midfield goal).  The positions below are "
            "the measured world transforms exactly as they sit in the CAD, so "
            "the app can place the objects itself if it wants a match-start "
            "layout.",
        # name -> merged-buffer range map, so the app can build one
        # geometry group per part and colour it by name
        "parts": parts_map or {},
        "fieldMesh": "field.glb",
        "halfMeshes": {"red": "half_red.glb", "blue": "half_blue.glb",
                       "yellow": "half_yellow.glb", "clear": "half_clear.glb",
                       "gray": "half_gray.glb"},
        "goalMeshes": {"neutral-tall": "goal_neutral-tall.glb",
                       "neutral-short": "goal_neutral-short.glb",
                       "alliance-red": "goal_alliance-red.glb",
                       "alliance-blue": "goal_alliance-blue.glb"},
    }


def build_id():
    h = hashlib.sha256()
    with open(steplib.STEP_PATH, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    return "2026-04-26-" + h.hexdigest()[:12]


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------
def build_report(model, frame, frame_info, goal_rows, assign, halves, toggles,
                 start_objects, exports, report_pin_h=None, report_cup_h=None,
                 goal_instances=None):
    checks = []

    def check(name, expected, measured, tol, unit="mm", note=None):
        if expected is None or measured is None:
            ok = None
            delta = None
        else:
            delta = measured - expected
            ok = bool(abs(delta) <= tol)
        rec = {"item": name, "expected": expected, "measured": measured,
               "delta": None if delta is None else round(delta, 3),
               "tolerance": tol, "unit": unit, "pass": ok}
        if note:
            rec["note"] = note
        checks.append(rec)
        return rec

    # field size: distance between the inner faces of the perimeter walls
    field_size = measure_field_size(model, frame)
    check("field size", EXPECT["fieldSize"], field_size, 25.0,
          note="perimeter wall inner faces")

    # goal heights
    heights = {}
    for row in goal_rows:
        name = row["name"]
        h = round(float(row["m"]["height"]), 2)
        if "Neutral Goal 0" in name:
            heights["neutral-tall"] = h
        elif "Neutral Goal" in name:
            heights.setdefault("neutral-short", h)
        elif "Red" in name:
            heights.setdefault("alliance-red", h)
        else:
            heights.setdefault("alliance-blue", h)
    check("goal height (neutral tall)", EXPECT["goalHeightTall"],
          heights.get("neutral-tall"), 1.0)
    check("goal height (neutral short)", EXPECT["goalHeightShort"],
          heights.get("neutral-short"), 1.0)
    check("goal height (alliance)", EXPECT["goalHeightAlliance"],
          heights.get("alliance-red"), 1.0)

    # goal plan size
    plans = {r["name"]: r["m"]["plan"] for r in goal_rows}
    tall_plan = next((p for n, p in plans.items() if "Neutral Goal 0" in n), {})
    check("goal plan size (octagon across flats)", EXPECT["goalPlanSize"],
          tall_plan.get("acrossFlats"), 15.0,
          note="across-corners %.2f" % tall_plan.get("acrossCorners", 0))

    # socket
    sockets = [r["m"]["socket"] for r in goal_rows if r["m"]["socket"]]
    if sockets:
        rmin = min(s["radius"] for s in sockets)
        rmax = max(s["radius"] for s in sockets)
        check("goal socket radius (min)", 20.0, rmin, 25.0,
              note="bore radius range %.2f..%.2f mm" % (rmin, rmax))
        # one-sided: the bore must be wide enough for a 40 mm pin
        checks.append({"item": "goal socket accepts a 40 mm pin",
                       "expected": ">= 20", "measured": rmin,
                       "delta": round(rmin - 20.0, 3), "tolerance": None,
                       "unit": "mm", "pass": bool(rmin >= 20.0),
                       "note": "one-sided check: bore radius must be >= 20 mm"})

    # pin / cup
    pin = halves.get("red")
    cup = halves.get("clear")
    if pin:
        check("pin height (assembled)", EXPECT["pinHeight"],
              report_pin_h, 3.0,
              note="2 halves x %.2f mm, collars overlap by %.2f mm"
                   % (pin["height"], 2 * pin["height"] - report_pin_h))
        check("pin max diameter (across flats)", EXPECT["pinMaxDiameter"],
              2 * pin["rMax"], 3.0,
              note="widest part of the half incl. its collar")
    if cup:
        check("cup height (assembled)", EXPECT["cupHeight"],
              report_cup_h, 3.0,
              note="2 halves x %.2f mm" % cup["height"])
        check("cup max diameter (across flats)", EXPECT["cupMaxDiameter"],
              2 * cup["rMax"], 3.0)

    # toggles
    if toggles:
        # the toggle bar's own dimensions (not the tilted world bbox)
        lengths = [t.get("length") for t in toggles if t.get("length")]
        widths = [t.get("width") for t in toggles if t.get("width")]
        heights = [t.get("height") for t in toggles if t.get("height")]
        check("toggle bar length", EXPECT["toggleLength"],
              float(np.mean(lengths)) if lengths else None, 1.0,
              note="the toggle is the 276-9250-023_GREY bar")
        check("toggle bar width", EXPECT["toggleWidth"],
              float(np.mean(widths)) if widths else None, 10.0)
        checks.append({"item": "toggle height (vertical, informational)",
                       "expected": None,
                       "measured": round(float(np.mean(heights)), 2)
                       if heights else None,
                       "delta": None, "tolerance": None, "unit": "mm",
                       "pass": None,
                       "note": "the bar is tilted on the wall, so its world "
                               "footprint is larger than its own size"})

    # goal positions
    pos_checks = []
    for inst in (goal_instances or []):
        row = inst["row"]
        gid, err = assign[inst["_k"]]
        mx, my = MANUAL_GOALS[gid][0], MANUAL_GOALS[gid][1]
        pos_checks.append({
            "id": gid, "product": row["name"],
            "cad": [round(float(x), 2) for x in inst["pos"][:2]],
            "manual": [mx, my],
            "delta": [round(float(inst["pos"][0]) - mx, 2),
                      round(float(inst["pos"][1]) - my, 2)],
            "distance": round(err, 2),
            "pass": bool(err <= 25.0),
        })

    layout = measure_layout(model, frame, goal_rows, goal_instances)
    return {
        "source": os.path.basename(steplib.STEP_PATH),
        "buildId": build_id(),
        "layout": layout,
        "frame": {
            "axes": {"X": np.round(frame.X, 6).tolist(),
                     "Y": np.round(frame.Y, 6).tolist(),
                     "Z": np.round(frame.Z, 6).tolist()},
            "originCAD": np.round(frame.origin, 4).tolist(),
            **{k: (round(v, 6) if isinstance(v, float) else v)
               for k, v in frame_info.items()},
        },
        "checks": checks,
        "goalPositions": pos_checks,
        "goalVariants": {r["name"]: {"height": round(float(r["m"]["height"]), 2),
                                     "plan": r["m"]["plan"],
                                     "socket": r["m"]["socket"]}
                         for r in goal_rows},
        "halves": {c: {"height": h["height"], "rMax": h["rMax"],
                       "rBottom": h["rBottom"], "rTop": h["rTop"],
                       "flange": h["flange"],
                       "wideEnd": h["exportInfo"]["wideEnd"],
                       "bboxLo": [round(x, 2) for x in h["bbox_lo"]],
                       "bboxHi": [round(x, 2) for x in h["bbox_hi"]]}
                   for c, h in halves.items()},
        "toggles": toggles,
        "startObjects": {
            "count": len(start_objects),
            "note": "the CAD stages the scoring objects rather than placing "
                    "them for a match start; the z histogram below is the "
                    "measured height of each object's base above the mat",
            "baseHeightHistogram": {
                str(round(z, 1)): n for z, n in sorted(
                    Counter(round(o["position"][2], 1)
                            for o in start_objects).items())},
        },
        "counts": {
            "pins": sum(1 for o in start_objects if o["kind"] == "pin"),
            "cups": sum(1 for o in start_objects if o["kind"] == "cup"),
            "goals": len(goal_rows),
            "goalInstances": sum(r["instances"] for r in goal_rows),
            "goalVariants": len(goal_rows),
            "toggles": len(toggles),
        },
        "exports": {k: {"bytes": v["bytes"], "triangles": v["triangles"],
                         "vertices": v["vertices"], "groups": v["groups"]}
                    for k, v in exports.items()},
    }


def measure_layout(model: Model, frame: Frame, goal_rows, goal_instances=None):
    """Field-layout measurements that the game manual also specifies.

    These are the numbers that let us tell a genuine CAD/game difference
    apart from a pipeline bug: the manual's field-element tolerance is
    +/-25 mm (1 in).
    """
    out = {}
    # goal ring radius (the distance of the 8 outer goals from the centre)
    # 位置在**实例**上（goal_rows 里的 pos 只是占位 None）
    pts = [(float(i["pos"][0]), float(i["pos"][1]))
           for i in (goal_instances or []) if i["row"]["m"]["height"] < 200]
    if not pts:
        pts = [(float(r["pos"][0]), float(r["pos"][1])) for r in goal_rows
               if r.get("pos") is not None and r["m"]["height"] < 200]
    radii = [float(np.hypot(x, y)) for x, y in pts]
    out["goalRingRadius"] = {"cad": round(float(np.mean(radii)), 2),
                             "manual": 1420.0,
                             "delta": round(float(np.mean(radii)) - 1420.0, 2),
                             "note": "CAD goal ring is %.1f%% of the manual's "
                                     "25-inch grid"
                                     % (100.0 * np.mean(radii) / 1420.0)}
    # midfield diamond: the tape pattern's vertices on the field axes
    tape = None
    for n in model.walk():
        if n["name"].startswith("Tape- Toggle Zones"):
            tape = n
    if tape is not None:
        v, _n, _t = model.mesh(tape["proto"])
        M = model.mat(tape)
        w = (M[:3, :3] @ v.T).T + M[:3, 3]
        fx = w[:, 0]
        fy = -w[:, 2]
        near_x = np.abs(fy) < 50
        near_y = np.abs(fx) < 50
        dx = float(np.abs(fx[near_x]).max()) if near_x.any() else None
        dy = float(np.abs(fy[near_y]).max()) if near_y.any() else None
        out["midfieldDiamondVertex"] = {"cad": [dx, dy], "manual": [635.0, 635.0],
                                        "note": "tape 'Diamond Center' vertices"}
    # perimeter wall faces
    per = None
    for c in model.roots[0].get("children", []):
        if c["name"] == "276-7596-000_Fixed Version":
            per = c
    if per is not None:
        lo, hi = model.subtree_bbox(per)
        out["perimeterWalls"] = {
            "outerFaceX": [round(float(lo[0]), 2), round(float(hi[0]), 2)],
            "outerFaceY": [round(float(-hi[2]), 2), round(float(-lo[2]), 2)],
            "fieldHalfSize": round(float((hi[0] - lo[0]) / 2), 2),
        }
    return out


def measure_field_size(model: Model, frame: Frame):
    """Distance between the inner faces of the perimeter walls (in the field frame)."""
    best = None
    for n in model.leaves():
        if "276-6904-001" not in n["name"] and "276-7596-000" not in n["name"]:
            continue
    # use the whole perimeter assembly's footprint
    for root in model.roots:
        for c in root.get("children", []):
            if c["name"] == "276-7596-000_Fixed Version":
                lo, hi = model.subtree_bbox(c)
                best = max(hi[0] - lo[0], hi[2] - lo[2])
    return float(best) if best else None


def print_report(report):
    print("\n" + "=" * 78)
    print("MEASURED vs EXPECTED")
    print("=" * 78)
    print(f"{'item':44s} {'expected':>10s} {'measured':>10s} "
          f"{'delta':>9s}  ok")
    def _num(v):
        if v is None:
            return "-"
        if isinstance(v, (int, float)):
            return f"{v:.2f}"
        return str(v)

    for c in report["checks"]:
        e = _num(c["expected"])
        m = _num(c["measured"])
        d = _num(c["delta"])
        flag = "OK " if c["pass"] else ("FAIL" if c["pass"] is False else "?")
        print(f"{c['item']:44s} {e:>10s} {m:>10s} {d:>9s}  {flag}")
        if c.get("note"):
            print(f"      note: {c['note']}")
    print("\n--- goal positions (CAD vs manual, +/-25 mm) ---")
    for p in report["goalPositions"]:
        print(f"  {p['id']:9s} {p['product']:32s} cad={p['cad']} "
              f"manual={p['manual']} d={p['distance']:8.2f}  "
              f"{'OK' if p['pass'] else 'FAIL'}")
    print("\n--- halves ---")
    for c, h in report["halves"].items():
        print(f"  {c:7s} height={h['height']:8.2f} rMax={h['rMax']:7.2f} "
              f"rBottom={h['rBottom']:7.2f} rTop={h['rTop']:7.2f} "
              f"flange={h['flange']:5.2f} wide={h['wideEnd']}")
    print("\n--- toggles ---")
    for t in report["toggles"]:
        print(f"  {t['edge']:7s} centre={np.round(t['centreField'],1).tolist()} "
              f"size={np.round(t['size'],1).tolist()} parts={len(t['members'])}")
    print()


if __name__ == "__main__":
    sys.exit(main())
