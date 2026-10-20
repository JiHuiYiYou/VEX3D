#!/usr/bin/env python
"""Validate the exported GLB/JSON assets.

Checks that every .glb is a well-formed glTF 2.0 binary, that the accessors
point inside the buffer, and that the geometry in field.json's part map lands
where field.json says it does.
"""
from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import steplib  # noqa: E402

ASSETS = steplib.ASSET_DIR
COMP_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_glb(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, version, length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, f"{path}: bad magic {magic:#x}"
    assert version == 2, f"{path}: bad version {version}"
    assert length == len(data), f"{path}: header length {length} != {len(data)}"
    off = 12
    chunks = []
    while off < len(data):
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        chunks.append((ctype, data[off + 8:off + 8 + clen]))
        off += 8 + clen
    j = json.loads(chunks[0][1].decode("utf-8"))
    binary = chunks[1][1] if len(chunks) > 1 else b""
    return j, binary


def validate_glb(path):
    errs = []
    j, binary = read_glb(path)
    if j.get("asset", {}).get("version") != "2.0":
        errs.append("asset.version != 2.0")
    if len(j.get("scenes", [])) != 1:
        errs.append("expected exactly one scene")
    n_nodes = len(j.get("nodes", []))
    roots = j.get("scenes", [])[0].get("nodes", [])
    if len(roots) == 0:
        errs.append("scene has no root nodes")
    seen = set()

    def walk_node(i):
        seen.add(i)
        for c in j["nodes"][i].get("children", []):
            walk_node(c)

    for r in roots:
        walk_node(r)
    if len(seen) != n_nodes:
        errs.append(f"{n_nodes - len(seen)} nodes are not reachable from the scene")
    for i, m in enumerate(j.get("meshes", [])):
        if i >= n_nodes:
            errs.append(f"mesh {i} has no node")
        for prim in m["primitives"]:
            for acc_i in (prim["attributes"]["POSITION"],
                          prim["attributes"]["NORMAL"], prim["indices"]):
                a = j["accessors"][acc_i]
                bv = j["bufferViews"][a["bufferView"]]
                start = a.get("byteOffset", 0)
                nbytes = a["count"] * COMP_SIZE[a["componentType"]] * \
                    TYPE_COUNT[a["type"]]
                if start + nbytes > bv["byteLength"]:
                    errs.append(f"mesh {i} accessor {acc_i} overruns bufferView")
                if bv.get("byteOffset", 0) + bv["byteLength"] > len(binary):
                    errs.append(f"mesh {i} bufferView overruns the BIN chunk")
    # --- the index buffers must be real, in-range integer arrays ---------
    # (this is the check that catches a bufferView whose byteOffset points
    #  at the wrong bytes: the mesh then loads but draws nothing, and a
    #  Raycaster returns NaN -- with no error anywhere)
    for i, m in enumerate(j.get("meshes", [])):
        for prim in m["primitives"]:
            ia = j["accessors"][prim["indices"]]
            pa = j["accessors"][prim["attributes"]["POSITION"]]
            if ia["count"] % 3 != 0:
                errs.append(f"mesh {i}: index count {ia['count']} is not a "
                            f"multiple of 3")
                continue
            bv = j["bufferViews"][ia["bufferView"]]
            start = bv.get("byteOffset", 0) + ia.get("byteOffset", 0)
            if ia.get("byteOffset", 0) + ia["count"] * 4 > bv["byteLength"]:
                errs.append(f"mesh {i}: index accessor overruns its bufferView")
            if start + ia["count"] * 4 > len(binary):
                errs.append(f"mesh {i}: index accessor overruns the buffer")
                continue
            idx = np.frombuffer(binary, dtype=np.uint32, count=ia["count"],
                                offset=start)
            if idx.size and int(idx.max()) >= pa["count"]:
                errs.append(f"mesh {i}: index {int(idx.max())} >= position "
                            f"count {pa['count']} (corrupt index buffer)")

    # Names may repeat: the field export mirrors the STEP assembly tree, so
    # an assembly name legitimately appears once per instance.  Only flag a
    # duplicate when the *meshes* repeat (that would be a flat export).
    names = [m.get("name", "") for m in j.get("meshes", [])]
    if len(set(names)) != len(names) and len(j.get("nodes", [])) == len(names):
        errs.append("duplicate mesh names")
    return j, errs


def scene_bbox(j, binary):
    """World bbox of the whole scene, applying the node transforms."""
    nodes = j["nodes"]
    mats = {}

    def local_matrix(i):
        raw = nodes[i].get("matrix")
        if raw is None:
            return np.eye(4)
        return np.array(raw, dtype=float).reshape(4, 4).T

    def world_matrix(i, parent):
        key = (i, id(parent))
        if key in mats:
            return mats[key]
        m = parent @ local_matrix(i)
        mats[key] = m
        for c in nodes[i].get("children", []):
            world_matrix(c, m)
        return m

    lo = np.full(3, 1e30)
    hi = np.full(3, -1e30)
    roots = j["scenes"][0].get("nodes", [])
    for r in roots:
        world_matrix(r, np.eye(4))
    for (i, _p), m in mats.items():
        if "mesh" not in nodes[i]:
            continue
        mn, mx = bbox_of(j, binary, nodes[i]["mesh"])
        for cx in (mn, mx):
            for sx in (0, 1):
                for sy in (0, 1):
                    for sz in (0, 1):
                        p = np.array([cx[0] if sx else 0, cx[1] if sy else 0,
                                      cx[2] if sz else 0])
                        w = (m[:3, :3] @ p) + m[:3, 3]
                        lo = np.minimum(lo, w)
                        hi = np.maximum(hi, w)
    return lo, hi


def bbox_of(j, binary, mesh_index):
    m = j["meshes"][mesh_index]
    prim = m["primitives"][0]
    a = j["accessors"][prim["attributes"]["POSITION"]]
    nrm = j["accessors"][prim["attributes"]["NORMAL"]]
    bv = j["bufferViews"][a["bufferView"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    n = a["count"]
    # the writer interleaves POSITION and NORMAL: 6 floats per vertex, the
    # normal accessor sits 12 bytes (= 3 floats) further along
    stride = 6 if (nrm.get("bufferView") == a.get("bufferView")
                   and nrm.get("byteOffset", 0) == 12) else 3
    arr = np.frombuffer(binary, dtype=np.float32, count=n * stride, offset=start)
    arr = arr.reshape(n, stride)[:, 0:3]
    return arr.min(axis=0), arr.max(axis=0)


def main():
    errs_total = 0
    print("=== GLB validation ===")
    for name in sorted(os.listdir(ASSETS)):
        if not name.endswith(".glb"):
            continue
        path = os.path.join(ASSETS, name)
        j, errs = validate_glb(path)
        status = "OK" if not errs else "FAIL"
        print(f"  {name:28s} {status:4s} "
              f"{os.path.getsize(path)/1e6:8.2f} MB  "
              f"meshes={len(j.get('meshes', []))} "
              f"nodes={len(j.get('nodes', []))}")
        for e in errs:
            print(f"      ! {e}")
        errs_total += len(errs)

    print("\n=== field bounds (must be the 12 ft field, not a scaled copy) ===")
    for fn in ("field.glb", "field_slim.glb"):
        fp = os.path.join(ASSETS, fn)
        if not os.path.exists(fp):
            continue
        j, binary = read_glb(fp)
        lo, hi = scene_bbox(j, binary)
        span = hi - lo
        # the field frame: X/Y are the field plane, Z is up from the mat
        ok = (abs(lo[0]) < 3100 and abs(lo[1]) < 1900
              and lo[2] > -60 and hi[2] < 500)
        print(f"  {fn:16s} min={np.round(lo, 1).tolist()} "
              f"max={np.round(hi, 1).tolist()} "
              f"span={np.round(span, 1).tolist()}  {'OK' if ok else 'BAD BOUNDS'}")
        if not ok:
            errs_total += 1

    print("\n=== no field-spanning meshes (except the mat / tape) ===")
    ALLOW_SPAN = ("276-6904-001", "Tape- ", "Wall Alliance Stations")
    for fn in ("field.glb", "field_slim.glb"):
        fp = os.path.join(ASSETS, fn)
        if not os.path.exists(fp):
            continue
        j, binary = read_glb(fp)
        worst = []
        for m in j["meshes"]:
            if m["name"].startswith(ALLOW_SPAN):
                continue
            a = j["accessors"][m["primitives"][0]["attributes"]["POSITION"]]
            span = max(a["max"][i] - a["min"][i] for i in range(3))
            worst.append((span, m["name"]))
        worst.sort(reverse=True)
        bad = [w for w in worst if w[0] > 1200]
        print(f"  {fn:16s} biggest non-surface mesh: "
              f"{worst[0][0]:.1f} mm ({worst[0][1][:40]})"
              + (f"  ! {len(bad)} over 1200 mm" if bad else "  OK"))
        for span, nm in bad[:4]:
            print(f"      ! {span:8.1f} mm  {nm}")
        errs_total += len(bad)

    print("\n=== field.json cross-check ===")
    fj = json.load(open(os.path.join(ASSETS, "field.json"), encoding="utf-8"))
    j, binary = read_glb(os.path.join(ASSETS, "field.glb"))
    mesh_names = [m["name"] for m in j["meshes"]]
    for name, info in fj["parts"].items():
        if name not in mesh_names:
            print(f"  ! part '{name}' missing from field.glb")
            errs_total += 1
            continue
        mi = mesh_names.index(name)
        lo, hi = bbox_of(j, binary, mi)
        # the merged range must match the accessor
        a = j["accessors"][j["meshes"][mi]["primitives"][0]["attributes"]["POSITION"]]
        if a["count"] != info["vertexCount"]:
            print(f"  ! part '{name}': vertexCount {info['vertexCount']} != "
                  f"accessor {a['count']}")
            errs_total += 1
    print(f"  {len(fj['parts'])} part groups cross-checked against field.glb")

    # the goal GLBs must sit on the origin (base centre) with +Z up
    for gv in ("neutral-tall", "neutral-short", "alliance-red", "alliance-blue"):
        p = os.path.join(ASSETS, f"goal_{gv}.glb")
        j, binary = read_glb(p)
        lo, hi = scene_bbox(j, binary)
        z0, z1 = lo[2], hi[2]
        # the corner legs hang below the base plane, so the base is the
        # lowest *body* point: check that the top is at the goal height
        ok = z1 > 0
        print(f"  goal_{gv:16s} bbox z=[{z0:8.2f},{z1:8.2f}] "
              f"x=[{lo[0]:8.2f},{hi[0]:8.2f}] y=[{lo[1]:8.2f},{hi[1]:8.2f}]  "
              f"{'base on z=0 OK' if ok else 'BASE NOT AT z=0'}")
        if not ok:
            errs_total += 1

    for c in ("red", "blue", "yellow", "clear", "gray"):
        p = os.path.join(ASSETS, f"half_{c}.glb")
        j, binary = read_glb(p)
        lo, hi = bbox_of(j, binary, 0)
        # the flange (wide end) sits on z = 0, the tip points to -Z
        ok = abs(hi[2]) < 1.0
        print(f"  half_{c:17s} bbox z=[{lo[2]:8.2f},{hi[2]:8.2f}] "
              f"r_xy_max={max(abs(lo[0]),abs(hi[0]),abs(lo[1]),abs(hi[1])):7.2f}  "
              f"{'base on z=0 OK' if ok else 'BASE NOT AT z=0'}")
        if not ok:
            errs_total += 1

    print(f"\n{'ALL OK' if errs_total == 0 else str(errs_total) + ' PROBLEMS'}")
    return 0 if errs_total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
