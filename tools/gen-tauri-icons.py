#!/usr/bin/env python3
"""Regenerate the Tauri app-icon set from the avatar master.

The desktop shell's icon family (desktop/src-tauri/icons) is derived from the
front-facing avatar artwork — same master as desktop/src/assets/xr-avatar*
(see tools/gen-avatar.py). The 2026-11-01 correction applies here too: the
icons must come from the ORIGINAL avatar, not the rejected 1772380044 render.

Composition follows the repo's icon convention (tools/gen-icons.mjs): the
subject is centred on the XR void (#03070D) with a maskable-style safe
margin; apart from that framing, every pixel is from the master — no derived
geometry, no recolouring.

Usage:
  python3 tools/gen-tauri-icons.py [master]    # default: assets/avatar.png

Writes (and only these — tray marks + MSIX tiles have their own generators,
scripts/generate-tray-icons.ts + scripts/generate-msix-assets.ts, which must
be re-run after this):
  icon.png 512 — the MARK MASTER for the tray/MSIX pipeline: the avatar's
    silhouette in solid white on transparency (the real avatar art is dark,
    so the generators' brightness-ramp mask cannot lift a mark from it; the
    silhouette is every pixel of the figure — no invented geometry).
  128x128.png · 128x128@2x.png 256 · 64x64.png · 32x32.png (avatar on void)
  Square{30,44,71,89,107,142,150,284,310}Logo.png · StoreLogo.png 50
  icon.ico (16-256) · icon.icns (real container: ic11..ic10, not a renamed
  PNG like the file it replaces)

Afterwards: bun run scripts/generate-tray-icons.ts
            bun run scripts/generate-msix-assets.ts
            bun run scripts/desktop-brand-check.ts --write
"""
import struct
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "desktop" / "src-tauri" / "icons"
BG = (3, 7, 13, 255)  # XR void
ART = 0.80  # subject occupies this fraction of the canvas (maskable-safe)


def subject(master: Image.Image) -> Image.Image:
    """Crop to the artwork's alpha bounding box plus a small margin, then
    pad to square with transparency. No scaling, no distortion."""
    a = np.asarray(master)
    ys, xs = np.where(a[:, :, 3] > 12)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    m = round(0.03 * max(x1 - x0, y1 - y0)) + 4
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(master.width - 1, x1 + m), min(master.height - 1, y1 + m)
    crop = master.crop((x0, y0, x1 + 1, y1 + 1))
    side = max(crop.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2), crop)
    return sq


def mark_master(art: Image.Image, size: int = 512) -> Image.Image:
    """The avatar silhouette in white, alpha-antialiased at the figure edge.

    Feeds generate-tray-icons.ts / generate-msix-assets.ts: their inkAlpha()
    multiplies a luminance ramp by alpha, so a white figure gives coverage
    exactly where the avatar's alpha says the figure is — the mark IS the
    avatar's own shape, nothing else.
    """
    a = np.asarray(art, dtype=np.float32)[:, :, 3]
    # Smooth 32→96 ramp keeps the figure edge antialiased; above 96 solid.
    alpha = np.clip((a - 32.0) / 64.0, 0.0, 1.0)
    inner = round(size * ART)
    small = Image.fromarray((alpha * 255).astype(np.uint8), "L").resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    solid = Image.new("RGBA", (inner, inner), (255, 255, 255, 255))
    solid.putalpha(small)
    out.paste(solid, ((size - inner) // 2, (size - inner) // 2), solid)
    return out


def tile(art: Image.Image, size: int) -> Image.Image:
    """The avatar subject centred on the void square at `size`."""
    inner = round(size * ART)
    a = art.resize((inner, inner), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), BG)
    canvas.paste(a, ((size - inner) // 2, (size - inner) // 2), a)
    return canvas


def icns_bytes(tiles: dict[int, bytes]) -> bytes:
    """A real Apple ICNS container: one PNG-payload chunk per size."""
    # chunk types per size (iconutil-compatible set)
    types = {
        32: b"ic11", 64: b"ic12", 128: b"ic07", 256: b"ic08",
        512: b"ic09", 1024: b"ic10",
    }
    body = b""
    for size in sorted(tiles):
        t = types[size]
        body += t + struct.pack(">I", len(tiles[size]) + 8) + tiles[size]
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def main() -> None:
    master_path = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "assets" / "avatar.png")
    if not master_path.is_absolute():
        master_path = ROOT / master_path
    master = Image.open(master_path).convert("RGBA")
    art = subject(master)
    print(f"master: {master_path.name} {master.size} -> subject {art.size}")

    # The mark master (icon.png) is the white silhouette; every other file
    # is the avatar artwork composited on the XR void.
    mark_master(art, 512).save(OUT / "icon.png", "PNG", optimize=True)
    print("  icon.png                   512 (mark master: white silhouette)")

    png_sizes = {
        "64x64.png": 64, "32x32.png": 32,
        "Square30x30Logo.png": 30, "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71, "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107, "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150, "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310, "StoreLogo.png": 50,
    }
    for name, size in png_sizes.items():
        tile(art, size).save(OUT / name, "PNG", optimize=True)
        print(f"  {name:26s} {size}")

    # .ico — multi-size with 256 for Vista+ large views
    ico_sizes = [16, 20, 24, 32, 48, 64, 128, 256]
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    images = [tile(art, s) for s in ico_sizes]
    images[-1].save(OUT / "icon.ico", sizes=[(s, s) for s in ico_sizes])
    print(f"  icon.ico                    {ico_sizes}")

    # .icns — real container this time (the old file was a renamed PNG)
    payload = {}
    for size in [32, 64, 128, 256, 512, 1024]:
        buf = BytesIO()
        tile(art, size).save(buf, "PNG", optimize=True)
        payload[size] = buf.getvalue()
    (OUT / "icon.icns").write_bytes(icns_bytes(payload))
    print("  icon.icns                   32,64,128,256,512,1024 (container)")

    # Read-back verification: the formats must parse and agree.
    chk = Image.open(OUT / "icon.icns")
    chk.load()
    assert chk.format == "ICNS", "icns did not parse as a container"
    ico = Image.open(OUT / "icon.ico")
    ico.load()
    assert ico.format == "ICO"
    print("verified: icns parses as ICNS, ico parses as ICO")


if __name__ == "__main__":
    main()
