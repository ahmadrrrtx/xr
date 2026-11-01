#!/usr/bin/env python3
"""Regenerate the front-avatar derivatives from a master image.

The front-avatar family is xr-avatar.png + xr-avatar-{512,256,128}.webp (all
8:7, RGBA). Side renders (xr-avatar-side*.webp), the 9 avatar-state GIFs and
the logo/emblem/orb families are NOT touched — they have their own masters.

Usage:
  python3 tools/gen-avatar.py [master]        # default: assets/avatar.png

The master must be the front-facing avatar artwork (RGBA, roughly 8:7).
Derivatives are written to desktop/src/assets/ with the exact names and
dimensions the app imports (see desktop/src/components/brand/assets.ts):
  xr-avatar.png      256x224  (Chat welcome hero source, XR_AVATAR_PNG)
  xr-avatar-512.webp 512x448  (xl bust, AvatarBust <link>)
  xr-avatar-256.webp 256x224  (lg/md bust)
  xr-avatar-128.webp 128x112  (sm bust / 24px sidebar icon)
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "desktop" / "src" / "assets"

TARGETS = [
    ("xr-avatar.png", 256, 224, "PNG"),
    ("xr-avatar-512.webp", 512, 448, "WEBP"),
    ("xr-avatar-256.webp", 256, 224, "WEBP"),
    ("xr-avatar-128.webp", 128, 112, "WEBP"),
]


def main() -> None:
    master_path = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "assets" / "avatar.png")
    if not master_path.is_absolute():
        master_path = ROOT / master_path
    master = Image.open(master_path).convert("RGBA")
    w, h = master.size
    # Accept small aspect drift but keep the 8:7 family honest: center-crop
    # to exactly 8:7 only when the master is slightly off-ratio.
    target_ratio = 8 / 7
    if abs(w / h - target_ratio) > 0.02:
        if w / h > target_ratio:
            new_w = round(h * target_ratio)
            x = (w - new_w) // 2
            master = master.crop((x, 0, x + new_w, h))
        else:
            new_h = round(w / target_ratio)
            y = (h - new_h) // 2
            master = master.crop((0, y, w, y + new_h))
        w, h = master.size
    print(f"master: {master_path.name} {w}x{h}")

    for name, tw, th, fmt in TARGETS:
        im = master.resize((tw, th), Image.LANCZOS)
        dest = OUT / name
        if fmt == "WEBP":
            im.save(dest, "WEBP", quality=92, method=6)
        else:
            im.save(dest, "PNG", optimize=True)
        print(f"  {dest.relative_to(ROOT)}  {tw}x{th}  {dest.stat().st_size:,} B")


if __name__ == "__main__":
    main()
