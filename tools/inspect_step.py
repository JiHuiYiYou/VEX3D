#!/usr/bin/env python
"""Quick probe of the VEX field STEP file.

Prints:
  * entity counts (raw text scan of the DATA section)
  * the full assembly tree with every instance's world transform
  * per-part bounding boxes
  * for the 9 goals: height, plan size and the top-face bore

The expensive STEP read is cached in tools/_cache, so this is fast after the
first run.

    ./tools/.venv/Scripts/python.exe tools/inspect_step.py
"""

from __future__ import annotations

import os
import re
import sys
import time
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import field_analysis as fa  # noqa: E402
import steplib  # noqa: E402
from field_analysis import Model  # noqa: E402

LOG = steplib.plan_log

ENTITY_TYPES = [
    "PRODUCT", "NEXT_ASSEMBLY_USAGE_OCCURRENCE", "ADVANCED_FACE",
    "MANIFOLD_SOLID_BREP", "COLOUR_RGB", "SHAPE_REPRESENTATION",
    "ADVANCED_BREP_SHAPE_REPRESENTATION", "MANIFOLD_SURFACE_SHAPE_REPRESENTATION",
    "CYLINDRICAL_SURFACE", "CONICAL_SURFACE", "PLANE", "TOROIDAL_SURFACE",
    "SPHERICAL_SURFACE", "B_SPLINE_SURFACE_WITH_KNOTS",
    "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION", "ITEM_DEFINED_TRANSFORMATION",
    "SHAPE_DEFINITION_REPRESENTATION", "PRODUCT_DEFINITION_SHAPE",
    "STYLED_ITEM", "PRESENTATION_LAYER_ASSIGNMENT",
]


def count_entities(path):
    """Count entity occurrences in the raw DATA section (single pass)."""
    counts = Counter()
    rx = re.compile(r"=\s*([A-Z_0-9]+)\s*\(")
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        data = fh.read()
    counts.update(m.group(1) for m in rx.finditer(data))
    return counts


def print_tree(model: Model, max_depth=4, show_matrix=True):
    def fmt(v):
        return "(" + ", ".join(f"{x:8.2f}" for x in v) + ")"

    def walk(node, depth):
        M = model.mat(node)
        kind = "LEAF" if node.get("is_leaf") else "ASM "
        extra = ""
        if node.get("is_leaf"):
            info = model.part_info(node["proto"])
            extra = f"  [{info['name']}]"
        LOG(f"{'  ' * depth}{kind} {node['name']}{extra}")
        if show_matrix:
            LOG(f"{'  ' * depth}     t={fmt(M[:3, 3])}  "
                f"R=[{fmt(M[0, :3])} | {fmt(M[1, :3])} | {fmt(M[2, :3])}]")
        if depth < max_depth:
            for c in node.get("children", []):
                walk(c, depth + 1)

    for r in model.roots:
        walk(r, 0)


def main():
    t0 = time.time()
    LOG("=== STEP inspection ===")
    LOG(f"file: {steplib.STEP_PATH}")
    LOG(f"size: {os.path.getsize(steplib.STEP_PATH)/1e6:.1f} MB")

    LOG("\n--- raw entity counts (DATA section) ---")
    counts = count_entities(steplib.STEP_PATH)
    for t in ENTITY_TYPES:
        LOG(f"  {t:40s} {counts.get(t, 0)}")

    if not steplib.cache_is_complete():
        LOG("\ncache missing -- reading STEP (takes ~8 minutes)")
        doc = steplib.read_step(steplib.STEP_PATH, progress=LOG)
        steplib.build_cache(doc, progress=LOG)

    model = Model()
    LOG(f"\n--- cache: {len(model.parts)} prototypes, "
        f"{len(model.leaves())} leaf instances, "
        f"{len(model.assemblies())} assembly instances ---")

    LOG("\n--- prototype part list (name | instances | local bbox) ---")
    for key, info in sorted(model.parts.items(), key=lambda kv: kv[1]["index"]):
        lo = np.round(np.array(info["bbox_lo"]), 2)
        hi = np.round(np.array(info["bbox_hi"]), 2)
        LOG(f"  {info['index']:3d} {info['name'][:44]:44s} x{info['instances']:<3d} "
            f"{str(lo):>28s} .. {str(hi):<28s} {info['triangles']:>6d} tris")

    LOG("\n--- assembly tree (depth 3) ---")
    print_tree(model, max_depth=3, show_matrix=True)

    # world bbox of everything
    lo = np.full(3, 1e30)
    hi = np.full(3, -1e30)
    for leaf in model.leaves():
        info = model.part_info(leaf["proto"])
        l = np.array(info["bbox_lo"])
        h = np.array(info["bbox_hi"])
        M = model.mat(leaf)
        corners = np.array([[x, y, z] for x in (l[0], h[0]) for y in (l[1], h[1])
                            for z in (l[2], h[2])])
        w = (M[:3, :3] @ corners.T).T + M[:3, 3]
        lo = np.minimum(lo, w.min(axis=0))
        hi = np.maximum(hi, w.max(axis=0))
    LOG(f"\n--- world bbox ---\n  min {np.round(lo,2)}\n  max {np.round(hi,2)}")
    LOG(f"  spans {np.round(hi-lo,2)}")

    # goals
    LOG("\n--- goals (height, plan, socket bore) ---")
    import extract_field as E
    goals = [n for n in model.walk() if n["name"].startswith("276-9250-840_")]
    for g in goals:
        M = model.mat(g)
        _M, _Mi, up = E.goal_local_frame(model, g)
        meas = E.measure_goal(model, g)
        LOG(f"  {g['name']:32s} world t={np.round(M[:3,3],2)}  "
            f"axis(local)={np.round(up,4)}")
        LOG(f"      height={meas['height']:.2f} mm  base at local "
            f"s={meas['base_s']:.2f}  plan={meas['plan']}")
        LOG(f"      socket={meas['socket']}")

    LOG(f"\ndone in {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
