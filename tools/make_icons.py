"""生成 PWA 图标（manifest + apple-touch-icon）。

图案跟 index.html 里的 favicon 一致：深色圆角方块 + 青色菱形 + 中心点。

    C:/Users/liuzhen/miniconda3/python.exe tools/make_icons.py

产物在 `public/`：
    icon-192.png          manifest 里的 any 图标
    icon-512.png          manifest 里的 any 图标
    icon-maskable-512.png 可裁剪（maskable）—— 安全区留够，免得被裁掉角
    apple-touch-icon.png  iOS 的主屏图标（180×180，iOS 不吃 maskable）
"""

import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public")

BG = (14, 18, 24, 255)      # --panel 的深色
ACCENT = (58, 208, 230, 255)  # --accent 青


def rounded(size, radius_ratio=0.22):
    """圆角方块（超采样画完再缩小 → 边缘平滑）。"""
    ss = 4
    big = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    d.rounded_rectangle(
        [0, 0, size * ss - 1, size * ss - 1],
        radius=int(size * ss * radius_ratio),
        fill=BG,
    )
    return big, d, ss


def draw_mark(size, maskable=False):
    """菱形 + 中心点（跟 favicon 同一个形）。"""
    big, d, ss = rounded(size, 0.5 if maskable else 0.22)
    s = size * ss

    # maskable 的图标会被裁成一个圆/方 → 图案要缩到中间 ~62% 的安全区里
    # （普通图标的比例跟 index.html 里的 favicon 一致：菱形占 21/32）
    scale = 0.62 if maskable else 0.66
    cx = cy = s / 2
    half = s * scale / 2
    d.polygon(
        [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)],
        fill=ACCENT,
    )
    r = s * (0.075 if not maskable else 0.06)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG)
    return big.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]:
        img = draw_mark(size, maskable)
        if not maskable:
            # iOS 的 apple-touch-icon 不支持透明 → 铺一层底色
            bg = Image.new("RGB", (size, size), BG[:3])
            bg.paste(img, (0, 0), img)
            img = bg
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"  {name}  {size}×{size}  {os.path.getsize(path) / 1024:.1f} KB")


if __name__ == "__main__":
    main()
