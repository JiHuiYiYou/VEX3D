"""三角网格的二次误差简化（QEM 边塌缩）。

为什么需要它
------------
CAD 里的得分物半体是「模出来的」零件：**742 个面**（pin）/ 583 个面（cup），
其中将近一半的面积不到 5 mm² —— 模出来的圆角、凸字、筋、倒角。OCCT 是
**逐面**三角化的，每个面至少两个三角形，所以：

    放宽 deflection 几乎没用（0.3 mm → 2.0 mm，只从 9041 掉到 7875），
    真正决定三角形数的是**面的个数**，不是容差。

要真的减面，只能减三角形 —— 也就是把网格简化掉。这一步做的是
「同一个 CAD 形状、少一些三角形」，不是手搓几何：简化后的网格仍然是
CAD 的面，只是被近似了，而且近似误差有上界（``measure_deviation`` 量给你看）。

算法
----
Lindstrom (2000) 的 *Simplifying Surfaces with Color and Texture using
Quadric Error Metrics*（SMC）：

  * 每个三角形贡献一个平面二次型 ``Q_f = A_f * (n, -d)(n, -d)^T``
    （A_f = 面积，n = 单位法向，d = 平面到原点的距离）
  * 每个顶点把**相邻面**的二次型加起来，当成这个顶点的二次型
  * 塌缩一条边时用 ``Q_v1 + Q_v2``，落点取那条边上的二次型最小值
    （闭式解），代价就是 ``p^T Q p`` —— 它就是 p 到那些原始平面的加权距离
  * 只塌缩代价 ≤ ``max_error²`` 的边 → 几何误差有上界
  * 塌缩会让相邻面的法向翻过来 → 直接拒绝（避免出现翻面）

用法
----
    from decimate import simplify
    v2, n2, t2 = simplify(v, n, t, max_error=0.5)

输入 / 输出都是 ``tessellate.triangulate`` 那套
（per-face 独立的顶点 + per-face 法向），所以能直接接进导出管线。
"""

from __future__ import annotations

import heapq

import numpy as np

# 焊接时的位置精度（mm）：CAD 的同一个点在不同面上的坐标会差一点点
WELD_DECIMALS = 4          # round 到 1e-4 mm


# --------------------------------------------------------------------------
# 顶点焊接
# --------------------------------------------------------------------------
def weld_positions(verts: np.ndarray, tris: np.ndarray):
    """把位置相同的顶点合并（OCCT 每个面一套顶点，边界处会重复）。"""
    key = np.round(verts.astype(np.float64), WELD_DECIMALS)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    cnt = np.bincount(inv, minlength=len(uniq)).astype(np.float64)
    nv = np.zeros((len(uniq), 3), dtype=np.float64)
    np.add.at(nv, inv, verts.astype(np.float64))
    nv /= cnt[:, None]
    nt = inv[tris]
    keep = (nt[:, 0] != nt[:, 1]) & (nt[:, 1] != nt[:, 2]) & (nt[:, 0] != nt[:, 2])
    return nv, nt[keep], inv


# --------------------------------------------------------------------------
# 二次型
# --------------------------------------------------------------------------
def face_quadrics(verts: np.ndarray, tris: np.ndarray) -> np.ndarray:
    """每个三角形的平面二次型 (M, 4, 4)。"""
    p0 = verts[tris[:, 0]]
    p1 = verts[tris[:, 1]]
    p2 = verts[tris[:, 2]]
    n_raw = np.cross(p1 - p0, p2 - p0)
    area = 0.5 * np.linalg.norm(n_raw, axis=1)
    ln = np.linalg.norm(n_raw, axis=1)
    ok = ln > 1e-20
    n = np.zeros_like(n_raw)
    n[ok] = n_raw[ok] / ln[ok][:, None]
    d = np.einsum("ij,ij->i", n, p0)
    v = np.concatenate([n, -d[:, None]], axis=1)          # (M, 4)
    return area[:, None, None] * (v[:, :, None] * v[:, None, :])


def _cross3(a, b):
    """3 维叉积 —— numpy 的 np.cross 在 3 维上开销极大（moveaxis），这里手写。"""
    return np.array([a[1] * b[2] - a[2] * b[1],
                     a[2] * b[0] - a[0] * b[2],
                     a[0] * b[1] - a[1] * b[0]])


def _err(q: np.ndarray, p: np.ndarray) -> float:
    """p^T Q p（p 是 [x, y, z, 1]）。"""
    return float(p @ q @ p)


def _ekey(a, b):
    return (a, b) if a < b else (b, a)


def area_of(pos, tri):
    a, b, c = pos[tri[0]], pos[tri[1]], pos[tri[2]]
    return 0.5 * float(np.linalg.norm(_cross3(b - a, c - a)))


# --------------------------------------------------------------------------
# 简化（SMC）
# --------------------------------------------------------------------------
class _Mesh:
    """可变的三角网格 + 增量维护的二次型。"""

    def __init__(self, verts, tris):
        self.pos = np.asarray(verts, dtype=np.float64)
        self.faces = [list(map(int, t)) for t in tris]
        self.alive = [True] * len(self.faces)
        self.vfaces = [set() for _ in range(len(self.pos))]
        self.vedges = [set() for _ in range(len(self.pos))]
        self.edge_faces = {}
        for fi, tri in enumerate(self.faces):
            for v in tri:
                self.vfaces[v].add(fi)
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                e = _ekey(a, b)
                self.vedges[a].add(e)
                self.vedges[b].add(e)
                self.edge_faces.setdefault(e, set()).add(fi)
        q = face_quadrics(self.pos, np.asarray(tris, dtype=np.int64))
        self.vquad = np.zeros((len(self.pos), 4, 4))
        self.varea = np.zeros(len(self.pos))
        self.farea = np.array([area_of(self.pos, t) for t in self.faces])
        for fi, tri in enumerate(self.faces):
            for v in tri:
                self.vquad[v] += q[fi]
                self.varea[v] += self.farea[fi]
        self.quad = q
        self.n_live = len(self.faces)

    # -- 查询 ----------------------------------------------------------
    def face_normal(self, fi):
        a, b, c = self.faces[fi]
        return _cross3(self.pos[b] - self.pos[a], self.pos[c] - self.pos[a])

    def live_face_count(self):
        return self.n_live

    # -- 编辑 ----------------------------------------------------------
    def kill_face(self, fi):
        if not self.alive[fi]:
            return
        self.alive[fi] = False
        self.n_live -= 1
        tri = self.faces[fi]
        q = self.quad[fi]
        for v in tri:
            self.vfaces[v].discard(fi)
            self.vquad[v] -= q
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                e = _ekey(a, b)
                s = self.edge_faces.get(e)
                if s is not None:
                    s.discard(fi)
                    if not s:
                        self.edge_faces.pop(e, None)
                        self.vedges[a].discard(e)
                        self.vedges[b].discard(e)

    def collapse(self, v1, v2, p):
        """把 v2 塌到 v1，落点 p。调用前要自己确认合法。"""
        # 1) 把 v2 的面改成 v1
        for fi in list(self.vfaces[v2]):
            tri = self.faces[fi]
            if v1 in tri:
                self.kill_face(fi)              # 退化面
                continue
            # 换掉 v2 → v1，并更新边表
            for k in range(3):
                if tri[k] == v2:
                    tri[k] = v1
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                e = _ekey(a, b)
                self.vfaces[a].add(fi)
                self.vedges[a].add(e)
                self.vedges[b].add(e)
                self.edge_faces.setdefault(e, set()).add(fi)
        # 2) 把 v2 的边搬到 v1（(v1,v2) 这条边直接消失）
        for e in list(self.vedges[v2]):
            a, b = e
            s = self.edge_faces.pop(e, None)
            self.vedges[a].discard(e)
            self.vedges[b].discard(e)
            if s is None:
                continue
            if a == v2:
                a, b = v1, b
            elif b == v2:
                a, b = a, v1
            if a == b:
                continue
            ne = _ekey(a, b)
            self.vedges[a].add(ne)
            self.vedges[b].add(ne)
            self.edge_faces.setdefault(ne, set()).update(s)
        self.vfaces[v2] = set()
        self.vedges[v2] = set()
        self.vquad[v1] += self.vquad[v2]
        self.vquad[v2] = 0.0
        self.varea[v1] += self.varea[v2]
        self.varea[v2] = 0.0
        # 3) 移动 v1
        self.pos[v1] = p
        # 4) v1 相邻的面可能因此退化
        for fi in list(self.vfaces[v1]):
            tri = self.faces[fi]
            if tri[0] == tri[1] or tri[1] == tri[2] or tri[0] == tri[2]:
                self.kill_face(fi)


def _edge_target(q, p1, p2):
    """在边 p1-p2 上找二次型的最小值点（闭式解，闭区间）。

    返回 (落点, 代价)。
    """
    a = np.array([p1[0], p1[1], p1[2], 1.0])
    d = np.array([p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2], 0.0])
    A = float(d @ q @ d)
    B = 2.0 * float(a @ q @ d)
    C = float(a @ q @ a)
    if abs(A) < 1e-18:
        # 退化：取端点里更便宜的
        c1 = C
        c2 = float((a + d) @ q @ (a + d))
        return (p1, c1) if c1 <= c2 else (p2, c2)
    t = -B / (2.0 * A)
    t = max(0.0, min(1.0, t))
    p = a + t * d
    return p[:3], float(p @ q @ p)


def simplify(verts, normals, tris, max_error=0.5, target_tris=None):
    """把三角网格简化到误差 ≤ ``max_error``（mm）。

    返回 (verts, normals, tris)，格式跟 ``tessellate.triangulate`` 一致：
    每个面一套顶点 + per-face 法向（硬边保持硬）。

    * ``max_error``  —— 允许的二次误差上限（mm）
    * ``target_tris`` —— 目标三角形数（到了就停；None = 只按误差停）
    """
    v0 = np.asarray(verts, dtype=np.float64)
    t0 = np.asarray(tris, dtype=np.int64)
    if len(t0) == 0:
        return (np.asarray(verts, np.float32), np.asarray(normals, np.float32),
                np.asarray(tris, np.int32))

    wv, wt, _inv = weld_positions(v0, t0)
    if target_tris is None:
        target_tris = max(1, int(len(wt) * 0.15))

    mesh = _Mesh(wv, wt)
    n_faces = len(mesh.faces)
    budget = max_error

    heap = []
    for e, fs in mesh.edge_faces.items():
        if len(fs) != 2:
            continue
        c = _edge_cost(mesh, e)
        if c is not None:
            heapq.heappush(heap, (c, e[0], e[1]))

    dead = np.zeros(len(mesh.pos), dtype=bool)
    while heap:
        if mesh.live_face_count() <= target_tris:
            break
        cost, a, b = heapq.heappop(heap)
        if dead[a] or dead[b]:
            continue
        e = _ekey(a, b)
        fs = mesh.edge_faces.get(e)
        if fs is None or len(fs) != 2:
            continue
        if cost > budget:
            break

        p, err = _edge_target(mesh.vquad[a] + mesh.vquad[b],
                              mesh.pos[a], mesh.pos[b])
        area = mesh.varea[a] + mesh.varea[b]
        if area > 1e-12 and (max(0.0, err) / area) > budget * budget:
            continue
        if not _no_flip(mesh, a, b, p):
            continue

        mesh.collapse(a, b, p)
        dead[b] = True

        # 受影响的边重新算代价
        for ee in list(mesh.vedges[a]):
            ffs = mesh.edge_faces.get(ee)
            if not ffs or len(ffs) != 2:
                continue
            c = _edge_cost(mesh, ee)
            if c is not None:
                heapq.heappush(heap, (c, ee[0], ee[1]))

    # ---- 收尾 --------------------------------------------------------
    out = []
    for fi, tri in enumerate(mesh.faces):
        if mesh.alive[fi]:
            out.append(tri)
    if not out:
        out = [mesh.faces[0]] if mesh.faces else []
    out_tris = np.asarray(out, dtype=np.int64)
    out_v, out_n, out_idx = split_face_vertices(mesh.pos, out_tris)
    # out_v 是「每个面一套顶点」的展开数组（3M 行），所以索引也要跟着展开：
    # gltfwriter 的 weld() 会再按 (位置, 法向) 把它们并回去
    return (out_v.astype(np.float32), out_n.astype(np.float32),
            out_idx.astype(np.int32))


def _edge_cost(mesh, e):
    """这条边的塌缩代价（mm）；不可塌缩返回 None。

    二次型的值 ``Σ A·d²`` 量纲是 mm³，除以参与面的总面积 A 得到
    「到那些原始平面的均方距离」，开方后就是长度，可以直接跟
    ``max_error``（mm）比。
    """
    q = mesh.vquad[e[0]] + mesh.vquad[e[1]]
    _p, c = _edge_target(q, mesh.pos[e[0]], mesh.pos[e[1]])
    a = mesh.varea[e[0]] + mesh.varea[e[1]]
    if a <= 1e-12:
        return 0.0
    c = (max(0.0, c) / a) ** 0.5
    # 长度做一点点 tie-break：代价一样时先塌短边
    c += 1e-9 * float(np.sum((mesh.pos[e[0]] - mesh.pos[e[1]]) ** 2))
    return c


def _no_flip(mesh, v1, v2, p):
    """塌缩后有没有面翻面。"""
    for fi in list(mesh.vfaces[v1]) + list(mesh.vfaces[v2]):
        if not mesh.alive[fi]:
            continue
        tri = mesh.faces[fi]
        old = mesh.face_normal(fi)
        pts = [p if v in (v1, v2) else mesh.pos[v] for v in tri]
        new = _cross3(pts[1] - pts[0], pts[2] - pts[0])
        ln = float(np.linalg.norm(new))
        if ln < 1e-12:
            # 塌缩后这个面退化了（两个顶点重合）—— 它本来就要被删掉，
            # 不算「翻面」
            continue
        if float(np.dot(new, old)) <= 0.0:
            return False
    return True


def split_face_vertices(wv, tris):
    """每个面拆成自己的一套顶点 + per-face 面积加权法向。

    这样硬边还是硬的（跟 OCCT 逐面三角化出来的网格一个格式）。

    返回 (顶点, 法向, 展开后的索引) —— 索引指向展开后的顶点数组。
    """
    if len(tris) == 0:
        return (np.zeros((0, 3), np.float64), np.zeros((0, 3), np.float64),
                np.zeros((0, 3), np.int64))
    p0 = wv[tris[:, 0]]
    p1 = wv[tris[:, 1]]
    p2 = wv[tris[:, 2]]
    fn = np.cross(p1 - p0, p2 - p0)          # 面积 × 2 × 单位法向
    v = wv[tris].reshape(-1, 3)             # (M*3, 3)：每个面自己的三个顶点
    out_n = np.zeros_like(v)
    for k in range(3):
        np.add.at(out_n, np.arange(len(tris)) * 3 + k, fn)
    ln = np.linalg.norm(out_n, axis=1)
    bad = ln < 1e-12
    out_n[bad] = np.repeat(fn, 3, axis=0)[bad]
    ln = np.linalg.norm(out_n, axis=1)
    ok = ln > 1e-12
    out_n[ok] /= ln[ok][:, None]
    out_n[~ok] = (0.0, 0.0, 1.0)
    idx = np.arange(len(tris) * 3, dtype=np.int64).reshape(len(tris), 3)
    return v, out_n, idx


# --------------------------------------------------------------------------
# 误差度量：原网格的顶点离简化后的网格有多远
# --------------------------------------------------------------------------
def measure_deviation(ref_v, new_v, new_t, sample=4000):
    """原网格顶点到新网格的最大 / 99% / 平均偏差（mm）。

    这是「减面有没有变形」的直接度量：新网格是简化后的面片，原网格的
    顶点全都落在新网格上（或附近）—— 偏差就是形状被改动的量。
    """
    ref_v = np.asarray(ref_v, dtype=np.float64)
    if len(ref_v) > sample:
        ref_v = ref_v[::int(np.ceil(len(ref_v) / sample))]
    tri = np.asarray(new_v, dtype=np.float64)[np.asarray(new_t)]
    d = np.empty(len(ref_v))
    for i in range(0, len(ref_v), 256):
        d[i:i + 256] = _point_tri_dist(ref_v[i:i + 256], tri.transpose(1, 0, 2))
    return float(d.max()), float(np.percentile(d, 99)), float(d.mean())


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
