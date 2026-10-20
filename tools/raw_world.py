"""Independent cross-check: goal world positions straight from the raw STEP.

Uses only tools/_cache/raw_occurrences.json (parsed without OCCT) so the
result is completely independent of the XCAF walk in tools/extract_field.py.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_cache", "raw_occurrences.json")

G = 25 * 25.4
MANUAL = {
    "276-9250-840_Neutral Goal 0": ("g-center", 0, 0),
    "276-9250-840_Neutral Goal 1": ("g-n1", -G, 2 * G),
    "276-9250-840_Neutral Goal 4": ("g-n2", -2 * G, G),
    "276-9250-840_Red 2": ("g-r1", -2 * G, -G),
    "276-9250-840_Red 3": ("g-r2", -G, -2 * G),
    "276-9250-840_Blue 2": ("g-b1", G, 2 * G),
    "276-9250-840_Blue 3": ("g-b2", 2 * G, G),
}

# the "Neutral Goal 1"/"Neutral Goal 4" products are used 2x each, so the
# instance order decides which of the two manual slots it is; the matching is
# done by nearest position after the frame is solved.


def main():
    with open(CACHE, encoding="utf-8") as fh:
        data = json.load(fh)
    occ = data["occurrences"]
    pd_name = data["pdName"]
    for o in occ:
        o["parent_pd"] = str(o["parent_pd"])
        o["child_pd"] = str(o["child_pd"])

    # index occurrences by (parent_pd, child_pd)
    by_parent = {}
    for o in occ:
        by_parent.setdefault(o["parent_pd"], []).append(o)

    # find the root: the pd that is nobody's child
    children_pd = {o["child_pd"] for o in occ}
    roots = [pd for pd in pd_name if pd not in children_pd]
    print("root candidates:", [(r, pd_name[r]) for r in roots])
    root = [r for r in roots if pd_name[r] == "276-9250-000 (2026-04-26)"][0]

    M = np.eye(4)

    def mul(A, B):
        return A @ B

    world = {}

    def walk(pd, Mparent, path):
        for o in by_parent.get(pd, []):
            loc = np.array(o["local"]) if o["local"] else np.eye(4)
            Mw = Mparent @ loc
            cname = o["child"]
            world.setdefault(cname, []).append((Mw, path + [cname]))
            walk(o["child_pd"], Mw, path + [cname])

    walk(root, M, [pd_name[root]])

    print("\n--- goal instances (raw STEP) ---")
    goal_pos = []
    for name, lst in world.items():
        if "840" not in name:
            continue
        for Mw, path in lst:
            p = Mw[:3, 3]
            goal_pos.append((name, p))
            print(f"  {name:32s} pos=({p[0]:9.2f},{p[1]:9.2f},{p[2]:9.2f})")

    # --- solve the horizontal frame against the manual ---------------------
    print("\n--- frame solve ---")
    best = None
    for k in range(4):
        th = k * math.pi / 2
        c, s = math.cos(th), math.sin(th)
        # try all 4 sign/axis choices of (X, Y) in the CAD XY plane
        for ax in range(2):
            for sx in (1, -1):
                for sy in (1, -1):
                    e1 = np.array([1.0, 0, 0]) if ax == 0 else np.array([0, 1.0, 0])
                    e2 = np.array([0, 1.0, 0]) if ax == 0 else np.array([1.0, 0, 0])
                    X = sx * (c * e1 + s * e2)
                    Y = sy * (-s * e1 + c * e2)
                    # origin = the tall goal
                    centre = None
                    for name, p in goal_pos:
                        if name == "276-9250-840_Neutral Goal 0":
                            centre = p
                    if centre is None:
                        continue
                    pts = []
                    for name, p in goal_pos:
                        d = p - centre
                        pts.append((name, float(d @ X), float(d @ Y)))
                    # greedy match each point to the nearest manual slot
                    slots = {v[0]: (v[1], v[2]) for v in MANUAL.values()}
                    used = set()
                    err = 0.0
                    ok = True
                    for name, px, py in pts:
                        if name not in MANUAL:
                            continue
                        cands = [(math.hypot(px - mx, py - my), gid)
                                 for gid, (mx, my) in slots.items() if gid not in used]
                        if not cands:
                            ok = False
                            break
                        cands.sort()
                        d, gid = cands[0]
                        if d > 5 * G:
                            ok = False
                            break
                        used.add(gid)
                        err = max(err, d)
                    if ok and (best is None or err < best[0]):
                        best = (err, X, Y, k, ax, sx, sy, centre, sorted(used))
    if best is None:
        print("  no frame matched")
        return 1
    err, X, Y, k, ax, sx, sy, centre, used = best
    print(f"  best rotation {k*90} deg, axis {ax}, signs {sx},{sy}, max err {err:.2f} mm")
    print(f"  used slots: {used}")
    print(f"  X={np.round(X,4)}  Y={np.round(Y,4)}  Z={np.round(np.cross(X,Y),4)}")
    print(f"  origin (tall goal) = {np.round(centre,3)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
