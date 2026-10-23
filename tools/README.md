# VEX3D field extraction (STEP -> glTF / JSON)

Turns `fieldcad/276-9250-000 (2026-04-26).STEP` (AP214, millimetres, written
by SolidWorks 2024) into the assets the 3D web app loads.

```
tools/
  extract_field.py    the pipeline: STEP -> public/assets/*.glb + *.json
  inspect_step.py     quick probe: entity counts, assembly tree, bboxes, goals
  build_cache.py      one-off: read the STEP once and cache it
  validate_assets.py  check the exported GLBs and cross-check field.json
  steplib.py          STEP/XCAF reading, tree walking, cache I/O, measurement
  field_analysis.py   the field-frame solver, goal/half/toggle measurement
  tessellate.py       OCCT shape -> numpy triangle soup
  decimate.py         QEM edge-collapse decimation (the scoring-object halves)
  gltfwriter.py       minimal glTF 2.0 / GLB writer
  raw_tree.py         independent (non-OCCT) STEP parser, used as a cross-check
  raw_world.py        resolves the assembly with the raw parser only
  requirements.txt

  # --- not part of the pipeline: browser-side checks (need the dev server) ---
  verify_ui.py        Playwright end-to-end checks (stacking rules, scoring, trash…)
  perf_ui.py          performance baseline (draw calls / triangles / frame time)
  shot_stack.py       close-up screenshot of a Pin/Cup nest, for eyeballing
  shots.py            screenshots after the CAD assets have finished loading
  test_scoring.ts     scoring-engine regression tests (`npm test`)

  # --- probes: the measurements behind the decimation budget ---
  probe_tess.py       how many triangles a half costs, and why deflection won't help
  probe_decimate.py   triangles vs. error budget (incl. silhouette error) per half
  probe_dev.py        resolution vs. error table (reference mesh vs. coarser one)
  probe_scene.py      where the triangles go in the running app
  shot_tess.py        before/after close-up screenshots of the decimated halves
  compare_shots.py    pixel-diff two screenshots (before vs. after decimation)
```

## Running

All commands are run from the project root.

```bash
# 1. build the cache (only needed once; ~8 min, ~2 GB RAM)
./tools/.venv/Scripts/python.exe tools/build_cache.py

# 2. run the pipeline -> public/assets/   (~15 s once cached)
./tools/.venv/Scripts/python.exe tools/extract_field.py

# 2b. same, but with every machined bracket in field.glb (~90 MB instead of 13 MB)
./tools/.venv/Scripts/python.exe tools/extract_field.py --full-detail

# 2c. also include the perimeter wall's base trim / lower panel
#     (276-7596-350_*, 351_*, 014, 015) -- without them the perimeter
#     only has the four 700 mm wall sections at the edge midpoints
./tools/.venv/Scripts/python.exe tools/extract_field.py --with-wall-trim

# 3. quick probe of the CAD
./tools/.venv/Scripts/python.exe tools/inspect_step.py

# 4. validate the exported assets
./tools/.venv/Scripts/python.exe tools/validate_assets.py
```

`extract_field.py` builds the cache automatically if it is missing, so step 1
is optional.  The pipeline uses the **OCCT/OCP** path
(`STEPCAFControl_Reader` + the XCAF assembly walk) -- there is no pure-python
STEP parser in the final pipeline; `raw_tree.py` is a *cross-check* only.

## Outputs

| file | what it is |
|---|---|
| `public/assets/field.glb` | the static field as a **node tree mirroring the STEP product tree** (so the assembly product names appear as nodes too).  11.6 MB, 291 k triangles, 94 meshes / 104 nodes.  Field extent 3673 x 3673 mm |
| `public/assets/field_slim.glb` | the same scene without the floor panels and with a coarser tessellation: **6.7 MB**.  The web app's procedural mat has to stay visible for this one |

**One mesh per instance.**  Merging every instance of a part into a single
mesh makes the mesh span the whole field (the perimeter wall's trim pieces
alone would become one 3668 mm plate), so only the mat and the tape -- which
really are continuous surfaces -- are merged.  Every other part is one mesh
per instance.
| `public/assets/field.json` | the scene manifest: the 9 goals, the 4 toggles, the half specs, the 119 start-of-match objects, and the `parts` name -> merged-buffer range map |
| `public/assets/field_report.json` | every measured dimension against the game manual, plus the field-frame solution and the layout comparison |
| `public/assets/half_{red,blue,yellow,clear,gray}.glb` | the 5 scoring-object half templates |
| `public/assets/goal_{neutral-tall,neutral-short,alliance-red,alliance-blue}.glb` | the 4 goal variants, **one child node per source PRODUCT** |

All geometry is in **millimetres** in the field frame
**X = east, Y = north, Z = up, origin = field centre on the mat** -- the
*same* frame in every file (field, goals, halves).  The web app rotates every
loaded mesh by -90 deg about X (`CAD_TO_THREE` in `src/scene/assets.ts`), so
+Z becomes three.js +Y.

**The geometry is pre-baked and every node matrix is identity.**  The node
*names* still carry the CAD product structure (so the app can colour by
name), but there is no transform left in the file: the web app can bake the
subtree once without applying any transform twice.

The goal files are rotated from the goal *product* frame (whose up is +Y) into
this frame, so `goal_neutral-tall.glb` has Z 0...222.7 like the rest.

**Index buffers.**  Every group gets its own pair of bufferViews, so the
index values are group-local (0 .. vertexCount-1) and the index bufferView's
`byteOffset` is the *total* vertex byte length plus its own offset into the
index blob.  Getting either wrong produces a file that loads without any
error but draws nothing -- `tools/validate_assets.py` and
`tools/load_test.mjs` both assert the indices are in range.

### Goal GLB node tree

Each goal variant is exported as a glTF hierarchy so the app can colour the
parts individually:

```
neutral-tall (scene)
 └─ 276-9250-840_Neutral Goal 0        the goal product, base centre at the origin
      ├─ 276-9250-003_Master             the funnel
      ├─ 276-9250-005                    the pedestal
      ├─ SBT0832_276-5007-001            the 8 octagon corner posts
      ├─ THF0832-0250_275-1023-001       the 4 legs
      ├─ 276-9250-006_AprilTag 0         the fiducials
      └─ 276-4847-011                    the base plate
```

The part nodes carry the part's placement inside the goal, so the hierarchy
is meaningful; the goal node carries the translation that puts the goal's
base centre at the origin.

### Half orientation

Each half is exported with **its wide flange at the origin and the narrow
tip along -Z** (i.e. the tip points down).  The app's -90 deg X rotation
turns that into three.js -Y, which is the convention the app authors
halves in (`src/scene/stackLayout.ts`: "翻边在原点，尖端在 -Y").

### How the two halves of a piece are joined

Measured from the CAD assembly tree — **the two kinds are NOT joined the same
way**, and getting this wrong breaks the shape, the flip and the scoring:

| piece | the two halves are joined | looks like | total height |
|---|---|---|---|
| **Pin** | **flange to flange** | a spool: narrow tips out, wide waist in the middle | 165.0 |
| **Cup** | **mouth to mouth** | an hourglass: wide open rims out, a Ø59 waist in the middle | 164.5 |

In the STEP tree the Cup's Clear half sits at `y=-85` unrotated (flange down,
mouth up) and the Dark Gray half at `y=+85` rotated 180° about Z (mouth down,
flange up) — so the two **mouths** meet in the middle.  The Pin's halves are
the other way round: the flange-to-flange joint is in the middle.

See `src/scene/stackLayout.ts` (`halfTransform`) for how the app reproduces
this, and `src/state/scoring.ts` for which half of the cup covers which half
of the pin.

## What is in field.glb / field_slim.glb

`field.glb` mirrors the CAD product tree, so the **assembly** names are nodes
as well as the parts:

```
276-9250-000 (2026-04-26)              the field root
 ├─ 276-7596-000_Fixed Version         the perimeter assembly
 │    ├─ 276-6904-001                  the mat: 36 floor panels, 618 x 16 mm
 │    ├─ 276-7596-350_*/351_*          the wall segments and corner pieces
 │    ├─ 276-7596-316, 317_Corner      the wall posts
 │    └─ 276-7596-014, 015             the wall edge strips
 ├─ 276-9250-120_Red Alliance Side     the four wall sections (one per edge)
 │    ├─ 276-9250-023_GREY             the toggle bar, 656 x 51.6 mm
 │    ├─ 276-9250-021, 022, 024, 027
 │    └─ ...
 ├─ 276-9250-120_Blue Alliance Side
 ├─ Wall Alliance Stations_PMS 199c/299c
 ├─ 276-9250-031_Red/Blue Loader
 ├─ SBT0832_276-8016-001, 276-8354-404   the corner elements
 └─ Tape- *                            the white tape
```

The web app looks for a node whose name contains `276-9250-120` and for a
mat-ish node, and both are present.

Dropped from the field export: the 63 pins + 56 cups (the app generates
them from the `half_*.glb` templates), the nine goals (the app renders them
from `goal_*.glb`), the fine hardware and the seven dense machined brackets.

Left out:

* **the nine goals** -- the app renders them from the `goal_*.glb` files
  (placed with `field.json`), so including them here too would draw every
  goal twice and z-fight;
* **the 63 pins and 56 cups** -- the app generates them as interactive
  instances from the `half_*.glb` templates;
* **the fine hardware** -- thousands of 3 mm screws (`SPTM3-TC-*`,
  `94629A270_*`, `NNY_Imperial_*`, `276-7596-003/004_Compressed`), bumper
  tape tubes (`SBT0832_SBT0832-*`) and standoffs: invisible at field scale
  and 60 % of the triangles;
* **seven dense machined brackets** (`276-7596-005/006/008/009/010`,
  `276-8354-404`, `276-9250-024`).  These have sub-millimetre features
  (threads, knurls, dense hole patterns): even a 12 mm deflection leaves
  9 k triangles each, and they are 85 % of the remaining geometry.  Use
  `--full-detail` to include them (that build is ~90 MB).

`field_slim.glb` goes further: it keeps only the mat, the white tape, the
perimeter + alliance wall structure, the loaders, the toggle bars and the
corner elements -- 9.6 MB.  The nine goals are *not* in it by default
because the app already renders them from `goal_*.glb`; pass
`--slim-goals` to include them as well (23.6 MB), but then every goal is
drawn twice.

Note that the mat (`276-6904-001`) is 36 floor panels whose only visible
detail is a pattern of 1 mm screw holes: 4 k vertices each, 144 of them
per panel.  That is 6 % of the slim file for something invisible at field
scale, but it is the only floor the CAD has, so it is kept.

## How the coordinate frame is found

Nothing about the frame is hard-coded:

1. The **up axis** is the axis of the goal's moulded funnel
   (`276-9250-003_Master`), taken from its largest conical face and
   transformed by the instance's world matrix.  All 9 goals agree exactly.
2. The **horizontal rotation** is solved by matching the *azimuth* of the 8
   outer goals against the game manual's 25-inch grid.  Matching on angle
   (not on position) keeps the solve stable even when the CAD's radial
   spacing differs from the manual.  The best fit has an angular error of
   1e-10 degrees.
3. The **origin** is placed at the field centre on the mat: the XY comes
   from the midfield goal, the Z from the goals' common base plane.

In this CAD the frame resolves to
`X = +CAD.x, Y = -CAD.z, Z = +CAD.y` with the origin at CAD
`(0, -294.589, 0)`.

## The Toggle

The Toggle has no product of its own: it is the **656.2 x 51.59 x 55.65 mm**
bar `276-9250-023_GREY` that the perimeter wall assembly carries at the
midpoint of each field edge -- `(0, +/-1817.04)` and `(+/-1817.04, 0)`,
331.56 mm above the mat.  The length matches the manual's 25.8 in exactly.

The clusters of small parts near the field corners (`SBT0832_276-8016-001`
strips + `276-8354-404` brackets + `NNY_Imperial_275-1027-001` screws,
67 x 44.5 x 286.3 mm each, at `(+/-1811, +/-1493)`) are a **different**
perimeter element, not the Toggle.

## Caching

Reading and transferring the 126 MB STEP takes ~8 minutes and several GB of
RAM, so the result is cached in `tools/_cache/`:

| file | what |
|---|---|
| `tree.json` | the placed assembly: every node's name, world matrix and children |
| `parts.json` | per-prototype metadata (bbox, instance count, BREP path) |
| `meshes.npz` | the default tessellation (0.8 mm) |
| `meshes_l*_a*.npz` | the per-class tessellations used by the exports |
| `brep/<i>.brep` | the raw geometry, for face-level analysis |

`tools/_cache/` is disposable -- delete it and the pipeline rebuilds it.

## Notes on the tessellation

The goals are meshed at 0.5 mm and the scoring-object halves at 0.3 mm.  The
field is meshed per class (0.8 mm for the goals/toggles, 1.0 mm for the
tape, 1.5 mm for the loaders and corner elements, 3.0 mm for the walls);
the deflections are the `FIELD_DEFLECTION` table in `extract_field.py`.
The wall panels are feature-dense, so their triangle count barely responds
to the deflection -- dropping them is what really shrinks the file.

## Cross-checking

`raw_tree.py` / `raw_world.py` parse the STEP file **without** OCCT (a
hand-rolled reader for the AP214 product/assembly entities) and resolve the
assembly independently.  It confirms the product graph (92 products, 562
occurrences, 56 cups, 63 pins, 9 goals) and the goal ring radius, but it
**flips the vertical axis** relative to the XCAF walk -- treat it as a
structural check only, not a transform reference.

The main validation is internal consistency: after the transform chain is
resolved, all 9 goal bases land on exactly the same plane (the mat), the
perimeter walls are symmetric about the origin, and the 9 goal *roles*
(neutral / red / blue) match the manual's slots exactly.  A mistake in the
location chaining breaks all of these at once.
