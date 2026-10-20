"""Minimal glTF 2.0 / GLB writer (no external deps).

Emits a binary .glb with one mesh per named group.  Every group gets its
**own** bufferViews (vertex + index), so the metadata is unambiguous for any
consumer -- a shared bufferView per mesh is legal glTF but confuses tools
that assume a 1:1 mesh/bufferView relationship.

Two levels of structure are supported:

  * a flat scene: one node per group, geometry baked in world space
    (used for field.glb)
  * a hierarchy: a parent node per product with one child node per source
    part, each child carrying the part's local transform
    (used for the goal_*.glb files)

The caller also gets, for every group, the vertex/triangle range inside the
merged buffers, so the app can build geometry groups without re-parsing the
GLB.
"""

from __future__ import annotations

import json
import os
import struct

import numpy as np

COMP_FLOAT = 5126
COMP_UINT = 5125

TARGET_ARRAY_BUFFER = 34962
TARGET_ELEMENT_ARRAY_BUFFER = 34963

STRIDE = 24  # 3 floats position + 3 floats normal


class Group:
    """One named mesh group (a part name)."""

    def __init__(self, name: str, verts: np.ndarray, normals: np.ndarray,
                 indices: np.ndarray):
        self.name = name
        self.verts = np.ascontiguousarray(verts, dtype=np.float32)
        self.normals = np.ascontiguousarray(normals, dtype=np.float32)
        # the index array is flat: 3 entries per triangle
        self.indices = np.ascontiguousarray(indices, dtype=np.uint32).reshape(-1)
        self.vtx_start = 0      # vertex range inside the merged vertex buffer
        self.vtx_count = 0
        self.idx_start = 0      # index range inside the merged index buffer
        self.idx_count = 0
        self.instances = []

    def summary(self):
        return {
            "name": self.name,
            "node": None,       # filled in by write_glb
            "mesh": None,
            "vertexStart": int(self.vtx_start),
            "vertexCount": int(self.vtx_count),
            "indexStart": int(self.idx_start),
            "indexCount": int(self.idx_count),
            "triStart": int(self.idx_start // 3),
            "triCount": int(self.idx_count // 3),
            "instances": len(self.instances),
        }


def weld(verts, normals, indices, mode="pos_normal"):
    """Merge duplicated vertices.

    OCCT keeps a separate vertex list per face, so a mesh has ~3 vertices
    per triangle.  ``pos_normal`` merges the duplicates that share both
    position and normal (coplanar neighbours) and keeps every hard edge.
    ``pos`` merges by position alone and averages the normals, which
    roughly halves the vertex count at the cost of shading the sharp
    edges of the machined parts smoothly.
    """
    if len(verts) == 0:
        return verts, normals, indices
    if mode == "none":
        return verts, normals, indices
    key = np.round(verts, 5)
    if mode == "pos":
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        cnt = np.bincount(inv, minlength=len(uniq)).astype(np.float32)
        new_v = np.zeros((len(uniq), 3), dtype=np.float32)
        np.add.at(new_v, inv, verts)
        new_v /= cnt[:, None]
        new_n = np.zeros((len(uniq), 3), dtype=np.float32)
        np.add.at(new_n, inv, normals)
        ln = np.linalg.norm(new_n, axis=1, keepdims=True)
        ln[ln == 0] = 1.0
        return (new_v.astype(np.float32),
                (new_n / ln).astype(np.float32),
                inv[indices].astype(np.uint32))
    # pos_normal
    key = np.round(np.concatenate([verts, normals], axis=1), 5)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    cnt = np.bincount(inv, minlength=len(uniq)).astype(np.float32)
    new_v = np.zeros((len(uniq), 3), dtype=np.float32)
    np.add.at(new_v, inv, verts)
    new_v /= cnt[:, None]
    new_n = np.zeros((len(uniq), 3), dtype=np.float32)
    np.add.at(new_n, inv, normals)
    ln = np.linalg.norm(new_n, axis=1, keepdims=True)
    ln[ln == 0] = 1.0
    return (new_v.astype(np.float32), (new_n / ln).astype(np.float32),
            inv[indices].astype(np.uint32))


class GNode:
    """A glTF node: a name, an optional mesh, an optional local transform
    and optional children."""

    def __init__(self, name: str, group: Group | None = None,
                 matrix: np.ndarray | None = None, children=None):
        self.name = name
        self.group = group
        self.matrix = matrix
        self.children = list(children or [])


def _node_matrix(node) -> list[float] | None:
    if node.matrix is None:
        return None
    m = np.asarray(node.matrix, dtype=float)
    # glTF matrices are column-major
    return [float(x) for x in m.T.reshape(-1)]


def write_glb(path: str, groups: list[Group], roots: list[GNode],
              scene_name: str = "field",
              generator: str = "VEX3D tools/extract_field.py",
              extra: dict | None = None, weld_mode: str = "none") -> dict:
    """Write ``roots`` (a node tree) to ``path`` as a .glb."""
    used = [g for g in groups if len(g.indices) > 0 and len(g.verts) > 0]
    used.sort(key=lambda g: g.name)

    if weld_mode != "none":
        for g in used:
            g.verts, g.normals, g.indices = weld(g.verts, g.normals, g.indices,
                                                 weld_mode)

    # ---- record where each group lives in the shared buffers -------------
    # g.indices holds GLOBAL vertex indices (so the caller can still
    # concatenate the groups into one big mesh); the writer converts them
    # back to group-local indices when it emits the accessors, because
    # three.js indexes into the accessor's own array.
    v_off = 0
    i_off = 0
    for g in used:
        # 注意：**不要**改写 g.indices。write_glb 可能会拿同一批 group 调用多次
        # （field.glb / field_slim.glb），改写会让偏移累加、索引越界。
        # glb 里写的是**组内局部索引**；全局范围只体现在下面的 summary 里。
        g.vtx_start = v_off
        g.vtx_count = len(g.verts)
        g.idx_start = i_off
        g.idx_count = len(g.indices)
        v_off += len(g.verts)
        i_off += len(g.indices)
    n_verts = v_off
    n_indices = i_off

    # ---- one bufferView pair per group ----------------------------------
    vbytes = b""
    ibytes = b""
    buffer_views = []
    accessors = []
    meshes = []
    group_index = {}
    index_bv_offsets = []
    for g in used:
        v_off = len(vbytes)
        gv = g.verts
        gn = g.normals
        inter = np.zeros((len(gv), 6), dtype=np.float32)
        inter[:, 0:3] = gv
        inter[:, 3:6] = gn
        data = inter.tobytes()
        data += b"\0" * ((-len(data)) % 4)
        vbytes += data
        # the vertex data is interleaved (position, normal) -- glTF needs
        # byteStride on the bufferView or the NORMAL accessor would read
        # the wrong bytes
        buffer_views.append({"buffer": 0, "byteOffset": v_off,
                             "byteLength": len(data), "byteStride": STRIDE,
                             "target": TARGET_ARRAY_BUFFER})
        bv = len(buffer_views) - 1

        i_off = len(ibytes)
        # 每个 mesh 的 POSITION accessor 只覆盖**本组**的顶点，所以写进 glb 的
        # 索引必须是**组内局部索引**。写成全局索引会让 three.js 读到越界的顶点
        # → 三角形全废（而且 Raycaster 会返回 NaN 距离）。
        idata = g.indices.tobytes()
        idata += b"\0" * ((-len(idata)) % 4)
        ibytes += idata
        # The index data is appended *after* the vertex data in the BIN
        # chunk, so its offset inside buffer 0 is len(vbytes) + i_off --
        # without this the index accessors read the vertex bytes and the
        # mesh draws nothing.
        buffer_views.append({"buffer": 0,
                             "byteOffset": 0,   # 稍后统一修正（见下面的 index_bv_offsets）
                             "byteLength": len(idata),
                             "target": TARGET_ELEMENT_ARRAY_BUFFER})
        bi = len(buffer_views) - 1
        index_bv_offsets.append((bi, i_off))

        pa = {"bufferView": bv, "byteOffset": 0, "componentType": COMP_FLOAT,
              "count": int(g.vtx_count), "type": "VEC3"}
        if g.vtx_count:
            pa["min"] = [float(x) for x in g.verts.min(axis=0)]
            pa["max"] = [float(x) for x in g.verts.max(axis=0)]
        na = {"bufferView": bv, "byteOffset": 12, "componentType": COMP_FLOAT,
              "count": int(g.vtx_count), "type": "VEC3"}
        ia = {"bufferView": bi, "byteOffset": 0, "componentType": COMP_UINT,
              "count": int(g.idx_count), "type": "SCALAR"}
        base = len(accessors)
        accessors += [pa, na, ia]
        meshes.append({"name": g.name,
                       "primitives": [{"attributes": {"POSITION": base,
                                                     "NORMAL": base + 1},
                                       "indices": base + 2, "mode": 4}]})
        group_index[id(g)] = len(meshes) - 1

    # The BIN chunk is written as *all* the vertex data followed by *all* the
    # index data, so every index bufferView's offset is the final vertex
    # length plus its own offset into the index blob.  Getting this wrong
    # makes the index accessor read the vertex bytes -> garbage triangles.
    total_vbytes = len(vbytes)
    for bi, i_off in index_bv_offsets:
        buffer_views[bi]["byteOffset"] = total_vbytes + i_off

    # ---- node tree ------------------------------------------------------
    nodes = []
    scene_nodes = []

    def emit(node) -> int:
        entry = {"name": node.name}
        if node.group is not None and id(node.group) in group_index:
            mi = group_index[id(node.group)]
            entry["mesh"] = mi
            node.group.index = mi
        m = _node_matrix(node)
        if m is not None:
            entry["matrix"] = m
        idx = len(nodes)
        nodes.append(entry)
        if node.children:
            entry["children"] = []
            for c in node.children:
                entry["children"].append(emit(c))
        return idx

    for r in roots:
        scene_nodes.append(emit(r))

    gltf = {
        "asset": {"version": "2.0", "generator": generator},
        "scene": 0,
        "scenes": [{"name": scene_name, "nodes": scene_nodes}],
        "nodes": nodes,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": len(vbytes) + len(ibytes)}],
    }
    if extra:
        gltf["extras"] = extra

    json_data = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_data += b" " * ((-len(json_data)) % 4)
    bin_data = vbytes + ibytes

    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    total = 12 + 8 + len(json_data) + 8 + len(bin_data)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(json_data), 0x4E4F534A))   # JSON chunk
        fh.write(json_data)
        fh.write(struct.pack("<II", len(bin_data), 0x004E4942))   # BIN chunk
        fh.write(bin_data)

    return {
        "path": path,
        "bytes": os.path.getsize(path),
        "groups": len(used),
        "vertices": int(n_verts),
        "triangles": int(n_indices // 3),
        "nodes": len(nodes),
    }
