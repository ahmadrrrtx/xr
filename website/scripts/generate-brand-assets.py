#!/usr/bin/env python3
"""Regenerate website/public brand assets from the v2 Drive pack.

Phase 31 · Bucket F v2 — the website no longer draws its own mark. Every
file in website/public/ derives from Ahmad's delivered pack, staged at
../../assets/v2/ by ../../scripts/fetch-v2-assets.sh (gitignored except
MANIFEST.json). Run fetch-v2-assets.sh first, then:

    python3 website/scripts/generate-brand-assets.py

Only cropping/resizing/compositing — the delivered geometry is never
redrawn. SVG favicons get a coordinate-precision pass (0.1 unit on a
512 grid) to keep the traced files shippable; PNG/WebP derivatives come
from the 4x masters.
"""
import os
import re
import shutil
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
V2 = os.path.join(ROOT, "assets", "v2")
PUB = os.path.join(ROOT, "website", "public")


def main() -> int:
    if not os.path.isdir(V2):
        print("assets/v2/ missing — run scripts/fetch-v2-assets.sh first", file=sys.stderr)
        return 1
    os.makedirs(PUB, exist_ok=True)

    for src, dst in (
        ("icon-family/ico/favicon.ico", "favicon.ico"),
        ("icon-family/png/app-icon/apple-touch-icon.png", "apple-touch-icon.png"),
        ("icon-family/png/app-icon/icon-192.png", "icon-192.png"),
        ("icon-family/png/app-icon/icon-512.png", "icon-512.png"),
        ("icon-family/png/app-icon/icon-maskable-512.png", "icon-maskable-512.png"),
        ("icon-family/png/emblem/XR-Emblem-512.png", "xr-emblem.png"),
    ):
        shutil.copy(os.path.join(V2, src), os.path.join(PUB, dst))

    front = Image.open(os.path.join(V2, "masters/png4x/XR-Avatar-Front-4x.png")).convert("RGBA")
    front.resize((512, round(512 * front.height / front.width)), Image.LANCZOS).save(
        os.path.join(PUB, "xr-avatar-front.webp"), "WEBP", quality=88, method=6
    )
    logo = Image.open(os.path.join(V2, "masters/png4x/XR-Logo-Transparent-4x.png")).convert("RGBA")
    logo.resize((640, round(640 * logo.height / logo.width)), Image.LANCZOS).save(
        os.path.join(PUB, "xr-wordmark.png"), optimize=True
    )

    # OG 1200x630 on XR navy: lockup left, avatar right (tagline in lockup).
    og = Image.new("RGBA", (1200, 630), (3, 7, 13, 255))
    lockup = logo.resize((540, round(540 * logo.height / logo.width)), Image.LANCZOS)
    og.alpha_composite(lockup, (44, (630 - lockup.height) // 2))
    avatar = front.resize((round(590 * front.width / front.height), 590), Image.LANCZOS)
    og.alpha_composite(avatar, (1200 - avatar.width - 16, 630 - 590))
    og.convert("RGB").save(os.path.join(PUB, "og.png"), optimize=True)

    def optimise_svg(src: str, dst: str) -> None:
        svg = open(os.path.join(V2, src), encoding="utf-8").read()
        svg = re.sub(r"(-?\d+\.\d{2,})", lambda m: str(round(float(m.group(1)), 1)), svg)
        open(os.path.join(PUB, dst), "w", encoding="utf-8").write(svg)

    optimise_svg("icon-family/svg/XR-Favicon.svg", "icon.svg")
    optimise_svg("icon-family/svg/XR-Favicon-Micro.svg", "icon-micro.svg")

    Image.open(os.path.join(V2, "icon-family/png/app-icon/XR-App-Icon-1024.png")).convert("RGBA").resize(
        (2048, 2048), Image.LANCZOS
    ).save(os.path.join(PUB, "splash-2048.png"), optimize=True)

    print("website/public regenerated from assets/v2/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
