"""Raw-text STEP assembly resolver -- INDEPENDENT cross-check for the OCP path.

Resolves the assembly tree + local transforms straight from the DATA section,
without OCCT, so that tools/extract_field.py's XCAF walk can be validated
against a second implementation.

Entity chain (AP214, SwSTEP 2.0):

  PRODUCT(id, name)                                   -- 92
  PRODUCT_DEFINITION(id, name, desc, ctx, product)     -- 92
  SHAPE_REPRESENTATION(id, name, items, ctx)           -- 92 (one per product)
  SHAPE_DEFINITION_REPRESENTATION(pds, sr)             -- 92
  PRODUCT_DEFINITION_SHAPE(id, name, desc, definition) -- 654
        definition -> PRODUCT_DEFINITION (leaf)  or  NAUO (occurrence)
  NEXT_ASSEMBLY_USAGE_OCCURRENCE(id, id, name, desc, relating_pd, related_pd)
  CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(rep1_sr, rel)  -- 562
  #N =( REPRESENTATION_RELATIONSHIP(name, desc, rep_1, rep_2)
        REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(idt)
        SHAPE_REPRESENTATION_RELATIONSHIP() )          -- 562
  ITEM_DEFINED_TRANSFORMATION(id, name, desc, item_1, item_2) -- 562
  AXIS2_PLACEMENT_3D(id, name, location, axis, ref_dir)

Writes tools/_cache/raw_tree.json
"""
import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEP = os.path.join(ROOT, "fieldcad", "276-9250-000 (2026-04-26).STEP")
CACHE = os.path.join(ROOT, "tools", "_cache")


def unescape(s):
    return s.replace("''", "'")


def nums(s):
    return [float(x) for x in s.replace(",", " ").split()]


R_PRODUCT = re.compile(r"#(\d+)\s*=\s*PRODUCT\s*\(\s*'((?:[^']|'')*)'", re.S)
R_PD = re.compile(
    r"#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'"
    r"\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)",
    re.S,
)
R_PDS = re.compile(
    r"#(\d+)\s*=\s*PRODUCT_DEFINITION_SHAPE\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'"
    r"\s*,\s*#(\d+)\s*\)",
    re.S,
)
R_SDR = re.compile(r"#(\d+)\s*=\s*SHAPE_DEFINITION_REPRESENTATION\s*\(\s*#(\d+)\s*,\s*#(\d+)\s*\)", re.S)
R_SR = re.compile(
    r"#(\d+)\s*=\s*(?:ADVANCED_BREP_SHAPE_REPRESENTATION|MANIFOLD_SURFACE_SHAPE_REPRESENTATION"
    r"|SHAPE_REPRESENTATION)\s*\(\s*'((?:[^']|'')*)'\s*,\s*\(([^)]*)\)\s*,\s*#(\d+)\s*\)",
    re.S,
)
R_NAUO = re.compile(
    r"#(\d+)\s*=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*'((?:[^']|'')*)'"
    r"\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'"
    r"\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,",
    re.S,
)
R_CDSR = re.compile(r"#(\d+)\s*=\s*CONTEXT_DEPENDENT_SHAPE_REPRESENTATION\s*\(\s*#(\d+)\s*,\s*#(\d+)\s*\)", re.S)
R_RRWT = re.compile(
    r"#(\d+)\s*=\s*\(\s*REPRESENTATION_RELATIONSHIP\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'"
    r"\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)\s*REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)",
    re.S,
)
R_IDT = re.compile(
    r"#(\d+)\s*=\s*ITEM_DEFINED_TRANSFORMATION\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'"
    r"\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)",
    re.S,
)
R_A2P = re.compile(
    r"#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\(\s*'((?:[^']|'')*)'\s*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)",
    re.S,
)
R_CART = re.compile(r"#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'((?:[^']|'')*)'\s*,\s*\(([^)]*)\)\s*\)", re.S)
R_DIR = re.compile(r"#(\d+)\s*=\s*DIRECTION\s*\(\s*'((?:[^']|'')*)'\s*,\s*\(([^)]*)\)\s*\)", re.S)
R_DIRT = re.compile(r"#(\d+)\s*=\s*DIRECTION\s*\(\s*'((?:[^']|'')*)'\s*,\s*\((\d+)\s*,\s*(\d+)\s*\)", re.S)


def main():
    with open(STEP, "r", encoding="utf-8", errors="replace") as fh:
        data = fh.read()
    print(f"read {len(data)/1e6:.1f} MB", flush=True)

    products = {int(m.group(1)): unescape(m.group(2)) for m in R_PRODUCT.finditer(data)}
    pd = {}
    for m in R_PD.finditer(data):
        # PRODUCT_DEFINITION(id, name, desc, formation, context)
        pd[int(m.group(1))] = {"name": unescape(m.group(2)),
                               "formation": int(m.group(4))}
    sdr = {int(m.group(1)): (int(m.group(2)), int(m.group(3))) for m in R_SDR.finditer(data)}
    sdr_by_pds = {v[0]: v[1] for v in sdr.values()}
    pds = {}
    for m in R_PDS.finditer(data):
        pds[int(m.group(1))] = int(m.group(4))
    sr = {}
    for m in R_SR.finditer(data):
        sr[int(m.group(1))] = {"name": unescape(m.group(2)), "items": m.group(3)}
    nauo = {}
    for m in R_NAUO.finditer(data):
        nauo[int(m.group(1))] = {
            "id": unescape(m.group(2)),
            "name": unescape(m.group(3)),
            "relating": int(m.group(5)),
            "related": int(m.group(6)),
        }
    cdsr = {int(m.group(1)): (int(m.group(2)), int(m.group(3))) for m in R_CDSR.finditer(data)}
    rrwt = {}
    for m in R_RRWT.finditer(data):
        rrwt[int(m.group(1))] = {
            "rep1": int(m.group(4)),
            "rep2": int(m.group(5)),
            "idt": int(m.group(6)),
        }
    idt = {}
    for m in R_IDT.finditer(data):
        idt[int(m.group(1))] = (int(m.group(4)), int(m.group(5)))
    a2p = {}
    for m in R_A2P.finditer(data):
        a2p[int(m.group(1))] = (int(m.group(3)), int(m.group(4)), int(m.group(5)))
    cart = {int(m.group(1)): nums(m.group(3)) for m in R_CART.finditer(data)}
    dirs = {int(m.group(1)): nums(m.group(3)) for m in R_DIR.finditer(data)}

    print(f"products={len(products)} pd={len(pd)} pds={len(pds)} sdr={len(sdr)} sr={len(sr)}")
    print(f"nauo={len(nauo)} cdsr={len(cdsr)} rrwt={len(rrwt)} idt={len(idt)} a2p={len(a2p)}")
    print(f"cart={len(cart)} dirs={len(dirs)}")

    # PRODUCT_DEFINITION(id, name, desc, formation, context)
    #   -> PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(id, name, desc, product)
    R_FORM = re.compile(
        r"#(\d+)\s*=\s*PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE\s*\(\s*'((?:[^']|'')*)'"
        r"\s*,\s*'((?:[^']|'')*)'\s*,\s*#(\d+)\s*,",
        re.S,
    )
    form = {}
    for m in R_FORM.finditer(data):
        form[int(m.group(1))] = int(m.group(4))

    # pd -> product name ; pd -> SR (via PDS->SDR)
    pd_name = {}
    for k, v in pd.items():
        prod_id = form.get(v["formation"])
        pd_name[k] = products.get(prod_id, f"#{prod_id}") if prod_id else f"#{v['product']}"
    pd_sr = {}
    for pdsid, defid in pds.items():
        if defid in nauo:
            continue
        if pdsid in sdr_by_pds:
            pd_sr[defid] = sdr_by_pds[pdsid]
    # PDS whose definition is a NAUO -> that NAUO's related pd -> that pd's SR
    for pdsid, defid in pds.items():
        if defid in nauo:
            rel_pd = nauo[defid]["related"]
            if rel_pd in pd_sr:
                pd_sr[nauo[defid]["relating"]] = pd_sr[rel_pd]

    # SR -> containing product name (via SHAPE_DEFINITION_REPRESENTATION)
    sr_product = {}
    for sdr_id, (pdsid, srid) in sdr.items():
        defid = pds.get(pdsid)
        if defid is not None:
            sr_product[srid] = pd_name.get(defid, f"#{defid}")

    # which shape representation owns each axis placement
    a2p_owner = {}
    for srid, v in sr.items():
        for tok in re.findall(r"#(\d+)", v["items"]):
            a2p_owner.setdefault(int(tok), srid)

    # Build occurrence edges: NAUO -> (parent_pd, child_pd)
    # And the local transform for each occurrence via CDSR/RRWT/IDT.
    # CDSR: rep1 = child SR, rel -> RRWT (rep1, rep2 = parent SR, idt)
    sr_to_cdsr = defaultdict(list)
    for cid, (rep, rel) in cdsr.items():
        sr_to_cdsr[rep].append(cid)

    def matrix_of_a2p(aid):
        if aid not in a2p:
            return None
        loc, axis, ref = a2p[aid]
        o = cart.get(loc)
        if o is None:
            return None
        z = dirs.get(axis) or [0, 0, 1]
        x = dirs.get(ref)
        if x is None:
            x = [1, 0, 0]
        # orthonormalise
        import math

        def norm(v):
            n = math.sqrt(sum(c * c for c in v))
            return [c / n for c in v] if n else v

        z = norm(z)
        x = norm(x)
        d = sum(x[i] * z[i] for i in range(3))
        x = norm([x[i] - d * z[i] for i in range(3)])
        y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
        return [[x[0], y[0], z[0], o[0]],
                [x[1], y[1], z[1], o[1]],
                [x[2], y[2], z[2], o[2]],
                [0, 0, 0, 1]]

    def mat_mul(A, B):
        return [[sum(A[i][k] * B[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

    def mat_inv(R):
        # rigid transform inverse (rotation transpose + -R^T t)
        Rm = [row[:3] for row in R[:3]]
        t = [R[0][3], R[1][3], R[2][3]]
        Rt = [[Rm[j][i] for j in range(3)] for i in range(3)]
        ti = [-sum(Rt[i][k] * t[k] for k in range(3)) for i in range(3)]
        return [[Rt[i][0], Rt[i][1], Rt[i][2], ti[i]] for i in range(3)] + [[0, 0, 0, 1]]

    occurrences = []
    # SwSTEP writes CONTEXT_DEPENDENT_SHAPE_REPRESENTATION as
    #   (representation_relationship, product_definition_shape)
    # so the transform hangs off arg 1 and the NAUO off arg 2.
    for cid, (rel_id, pds_id) in cdsr.items():
        r = rrwt.get(rel_id)
        if not r:
            continue
        def_id = pds.get(pds_id)
        n = nauo.get(def_id)
        if not n:
            continue
        parent_pd, child_pd = n["relating"], n["related"]
        t = idt.get(r["idt"])
        local = None
        oa = ob = None
        if t:
            a, b = t
            ma, mb = matrix_of_a2p(a), matrix_of_a2p(b)
            if ma is not None and mb is not None:
                oa, ob = a2p_owner.get(a), a2p_owner.get(b)
                # item_1 lives in the child SR (rep_1), item_2 in the parent SR.
                # child placement in the parent = mb * ma^-1
                local = mat_mul(mb, mat_inv(ma))
        occurrences.append({
            "cdsr": cid,
            "nauo": def_id,
            "parent_pd": parent_pd,
            "child_pd": child_pd,
            "parent": pd_name.get(parent_pd, f"#{parent_pd}"),
            "child": pd_name.get(child_pd, f"#{child_pd}"),
            "child_sr": r["rep1"],
            "parent_sr": r["rep2"],
            "local": local,
            "item1_sr": oa,
            "item2_sr": ob,
        })

    with open(os.path.join(CACHE, "raw_occurrences.json"), "w", encoding="utf-8") as fh:
        json.dump({"occurrences": occurrences,
                   "pdName": {str(k): v for k, v in pd_name.items()},
                   "srProduct": {str(k): v for k, v in sr_product.items()},
                   "products": {str(k): v for k, v in products.items()}},
                  fh, indent=1)

    # print instance counts per (parent -> child)
    from collections import Counter

    cnt = Counter((o["parent"], o["child"]) for o in occurrences)
    print("\n--- parent -> child (instance count) ---")
    for (p, c), k in sorted(cnt.items(), key=lambda kv: -kv[1]):
        print(f"{k:5d}  {p}  ->  {c}")
    nlocal = sum(1 for o in occurrences if o["local"] is None)
    print(f"\noccurrences without resolvable local transform: {nlocal}/{len(occurrences)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
