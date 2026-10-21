"""
从官方示意图 `study/VEX/image/2D俯视示意图.png` 抠出开局布局，生成
`src/data/presets.ts`。

    C:/Users/liuzhen/miniconda3/python.exe tools/extract_setup.py

标定：用图里 4 根**黄色 toggle** 当基准 —— 它们在场地坐标 (0, ±1817.04) 与 (±1817.04, 0)。

图元：
  · **pin**（立着）= 俯视看到的六边形，被中间那条缝分成上下两半 → 两块颜色斑
  · **cup**（立着）= 俯视看到的圆，上半白、下半灰
  · 场上散件 = 站在垫子上的 cup（有的里面插着 pin）
  · 墙边 = 北/南墙内侧的 (cup, pin, cup) 三件组
  · 装填区 = 场地外红/蓝胶带里的 10 行 (cup + pin)，另有几个**躺平**的 pin
"""

import io
import numpy as np
from PIL import Image

SRC = r"C:/Users/liuzhen/Desktop/coding/study/VEX/image/2D俯视示意图.png"
OUT = r"C:/Users/liuzhen/Desktop/coding/projects/VEX3D/src/data/presets.ts"

# ── 标定（4 根黄色 toggle）──
CX, CY, S = 464.5, 422.5, 0.1585  # 场地中心(px) + 比例(px/mm)

# 5 个 goal 上各插一根黄/黄 pin（逐个放大读图确认）
GOAL_PINS = {
    "g-n1": (-598, 1196),
    "g-n2": (-1196, 598),
    "g-n3": (1196, -598),
    "g-n4": (598, -1196),
    "g-center": (0, 0),
}

# 装填区：红方在西、蓝方在东，10 行，行距 ~172mm
STAGE_ROWS_Y = [860, 689, 517, 343, 172, 0, -173, -346, -517, -689]
RED_STAGE_X = -2445  # 红/黄 pin
RED_STAGE_CUP_X = -2632  # cup
BLUE_STAGE_X = 2436  # 蓝/黄 pin
BLUE_STAGE_CUP_X = 2608  # cup
# 装填区里另外散放的几根 pin（**立着**，俯视看到的还是六边形）
STAGE_LOOSE_PINS = [
    (-2200, 1177),
    (-2200, 0),
    (-2200, -1159),
    (2180, 26),
    (2180, -1100),
]


def to_field(px, py):
    return round((px - CX) / S), round((CY - py) / S)


def blobs(mask, min_px=25, max_px=20000):
    m = mask.copy()
    seen = np.zeros_like(m)
    H, W = m.shape
    out = []
    ys, xs = np.where(m)
    for y0, x0 in zip(ys, xs):
        if seen[y0, x0]:
            continue
        stack = [(y0, x0)]
        seen[y0, x0] = True
        pts = []
        while stack:
            y, x = stack.pop()
            pts.append((y, x))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if min_px <= len(pts) <= max_px:
            pa = np.array(pts)
            out.append(
                {
                    "n": len(pts),
                    "cx": pa[:, 1].mean(),
                    "cy": pa[:, 0].mean(),
                    "w": pa[:, 1].max() - pa[:, 1].min() + 1,
                    "h": pa[:, 0].max() - pa[:, 0].min() + 1,
                }
            )
    return out


def extract():
    im = Image.open(SRC).convert("RGB")
    a = np.array(im).astype(int)
    R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    sat = (np.max(a, axis=2) - np.min(a, axis=2)) > 70

    red = sat & (R > 130) & (G < 95) & (B < 110)
    blue = sat & (B > 110) & (R < 120) & (G < 160)
    yellow = sat & (R > 150) & (G > 130) & (B < 120)

    # pin 的上下两半
    halves = []
    for name, mask in (("red", red), ("blue", blue), ("yellow", yellow)):
        for b in blobs(mask, 25, 400):
            if 8 <= b["w"] <= 27 and 4 <= b["h"] <= 13:
                halves.append({**b, "color": name})

    pins = []
    used = set()
    for i, h1 in enumerate(halves):
        if i in used:
            continue
        for j, h2 in enumerate(halves):
            if j <= i or j in used:
                continue
            if abs(h1["cx"] - h2["cx"]) < 3 and 4 < abs(h1["cy"] - h2["cy"]) < 12:
                top, bot = (h1, h2) if h1["cy"] < h2["cy"] else (h2, h1)
                fx, fy = to_field((top["cx"] + bot["cx"]) / 2, (top["cy"] + bot["cy"]) / 2)
                pins.append({"x": fx, "y": fy, "top": top["color"], "bot": bot["color"]})
                used.add(i)
                used.add(j)
                break

    # cup：上半白 + 下半灰
    white = (R > 200) & (G > 200) & (B > 200)
    cups = []
    for b in blobs(white, 40, 500):
        if not (8 <= b["w"] <= 30 and 4 <= b["h"] <= 18):
            continue
        below = (
            a[int(b["cy"]) + 6: int(b["cy"]) + 10, int(b["cx"]) - 2: int(b["cx"]) + 3]
            .reshape(-1, 3)
            .mean(axis=0)
        )
        if not (abs(below[0] - below[1]) < 20 and abs(below[1] - below[2]) < 20 and below[0] < 200):
            continue
        fx, fy = to_field(b["cx"], b["cy"])
        cups.append({"x": fx, "y": fy})
    return pins, cups


def build():
    pins, cups = extract()

    goal_pos = [(v[0], v[1]) for v in GOAL_PINS.values()]
    items = []          # 散件
    seen_pin = set()

    def near_goal(x, y, tol=90):
        for gx, gy in goal_pos:
            if abs(x - gx) < tol and abs(y - gy) < tol:
                return True
        return False

    def near_staging(x, y):
        return abs(x) > 2000

    def near_wall_group(x, y):
        return abs(y) > 1500 and abs(x) < 1000

    # ① 墙边的 (cup, pin, cup) 三件组：pin 在中间，cup 左右各 ~198mm
    for p in pins:
        if near_goal(p["x"], p["y"]) or near_staging(p["x"], p["y"]):
            continue
        if not near_wall_group(p["x"], p["y"]):
            continue
        items.append({"kind": "pin", "halves": [p["top"], p["bot"]], "x": p["x"], "y": p["y"]})
        seen_pin.add((p["x"], p["y"]))

    # ② 场地上的 cup（里面插着 pin 的，把 pin 放到 cup 的位置）
    for c in cups:
        if near_staging(c["x"], c["y"]):
            continue
        if near_wall_group(c["x"], c["y"]):
            continue
        items.append({"kind": "cup", "halves": ["clear", "gray"], "x": c["x"], "y": c["y"]})
        # 找最近的 pin（<= 250mm）→ 插在这个 cup 里
        best, bd = None, 1e9
        for p in pins:
            if (p["x"], p["y"]) in seen_pin:
                continue
            if near_goal(p["x"], p["y"]) or near_staging(p["x"], p["y"]):
                continue
            d = (p["x"] - c["x"]) ** 2 + (p["y"] - c["y"]) ** 2
            if d < bd and d < 250**2:
                best, bd = p, d
        if best:
            # 插在 cup 里：尖端落进 cup 的细腰，翻边架在 cup 的上沿 → 底端 164.5
            items.append({"kind": "pin", "halves": [best["top"], best["bot"]],
                          "x": c["x"], "y": c["y"], "z": 164})
            seen_pin.add((best["x"], best["y"]))

    # ③ 装填区：红方 10 行 (cup + 红/黄 pin)，蓝方 10 行 (蓝/黄 pin + cup)
    for y in STAGE_ROWS_Y:
        items.append({"kind": "cup", "halves": ["clear", "gray"], "x": RED_STAGE_CUP_X, "y": y})
        items.append({"kind": "pin", "halves": ["red", "yellow"], "x": RED_STAGE_X, "y": y})
        items.append({"kind": "pin", "halves": ["blue", "yellow"], "x": BLUE_STAGE_X, "y": y})
        items.append({"kind": "cup", "halves": ["clear", "gray"], "x": BLUE_STAGE_CUP_X, "y": y})

    # ④ 装填区里另外散放的几根 pin
    for x, y in STAGE_LOOSE_PINS:
        halves = ["red", "yellow"] if x < 0 else ["blue", "yellow"]
        items.append({"kind": "pin", "halves": halves, "x": x, "y": y})

    return items


def emit(items):
    lines = []
    lines.append("/**")
    lines.append(" * 官方开局布局（「摆场」预设）")
    lines.append(" * ")
    lines.append(" * 数据来自官方手册的俯视示意图 `2D俯视示意图.png`，用图里 4 根黄色 toggle")
    lines.append(" * 标定后逐个读出来的 —— 抠图脚本：`tools/extract_setup.py`。")
    lines.append(" * ")
    lines.append(" * · goal 上：4 个中立 goal + 中场 goal 各插一根黄/黄 pin，4 个联盟 goal 空着")
    lines.append(" * · 场地散件：站在垫子上的 cup（有的里面插着 pin）")
    lines.append(" * · 墙边：北/南墙内侧各 2 组 (cup, pin, cup)")
    lines.append(" * · 装填区：红/蓝胶带里各 10 行 (cup + pin)，外加几个躺平的 pin")
    lines.append(" *")
    lines.append(" * 散件**不参与计分**（手册只算 goal 里的 pin 和中场的机器人）。")
    lines.append(" */")
    lines.append("import type { LooseItem } from '@/state/store'")
    lines.append("import type { StackItem } from '@/state/scoring'")
    lines.append("")
    lines.append("export const INITIAL_SETUP_BUILD = 'override-0.1-2026-04-28'")
    lines.append("")
    lines.append("/** goal 上开局就有的得分物 */")
    lines.append("export const INITIAL_GOAL_STACKS: Record<string, StackItem[]> = {")
    for gid in GOAL_PINS:
        lines.append(
            f"  '{gid}': [{{ id: '{gid}-0', kind: 'pin', halves: ['yellow', 'yellow'] }}],"
        )
    lines.append("}")
    lines.append("")
    lines.append("/** 场上所有不在 goal 里的得分物 */")
    lines.append("export const INITIAL_LOOSE: LooseItem[] = [")
    for n, it in enumerate(items):
        lying = ", lying: true" if it.get("lying") else ""
        z = f", z: {it['z']}" if it.get("z") else ""
        lines.append(
            f"  {{ id: 'loose-{n}', kind: '{it['kind']}', halves: {it['halves']}, "
            f"x: {it['x']}, y: {it['y']}{z}{lying} }},"
        )
    lines.append("]")
    io.open(OUT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print(f"写出 {OUT}：{len(items)} 个散件")


if __name__ == "__main__":
    items = build()
    emit(items)
