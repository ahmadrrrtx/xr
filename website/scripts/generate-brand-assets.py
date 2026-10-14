#!/usr/bin/env python3
"""Generate the website brand assets (Phase 31 · Bucket C · C1).

    python3 scripts/generate-brand-assets.py

Writes into website/public/:
  favicon.ico          16/32/48 multi-resolution ICO (PNG payloads)
  apple-touch-icon.png 180x180
  icon-192.png         192x192 (PWA)
  icon-512.png         512x512 (PWA + maskable)
  og-image.png         1200x630 social card

The sigil per the bucket spec: solid black rounded square, centered cyan
dot. The OG card: #03070D background, XR wordmark, the tagline, one small
cyan accent. Drawn with Pillow so the assets are reproducible anywhere;
re-run after a brand change, never edit by hand.
"""
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PUBLIC.mkdir(exist_ok=True)

BLACK = (3, 7, 13, 255)        # #03070D
CYAN = (0, 229, 255, 255)      # #00E5FF
WHITE = (237, 237, 239, 255)   # site text
MUTED = (161, 161, 170, 255)   # zinc-400

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_BOOK = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def sigil(size: int) -> Image.Image:
    """Black rounded square with a centered cyan dot, on transparency."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BLACK)
    dot = int(size * 0.30)
    c = size // 2
    d.ellipse([c - dot // 2, c - dot // 2, c + dot // 2, c + dot // 2], fill=CYAN)
    return img


def save(img: Image.Image, name: str) -> None:
    img.save(PUBLIC / name)
    print(f"  {name}: {(PUBLIC / name).stat().st_size // 1024} KB")


def main() -> None:
    print(f"writing to {PUBLIC}")
    save(sigil(192), "icon-192.png")
    save(sigil(512), "icon-512.png")
    save(sigil(180), "apple-touch-icon.png")

    # favicon.ico — ICO container holding PNG payloads at 16/32/48.
    pngs = []
    for s in (16, 32, 48):
        buf = BytesIO()
        sigil(s).save(buf, format="PNG")
        pngs.append(buf.getvalue())
    header = b"\x00\x00\x01\x00" + len(pngs).to_bytes(2, "little")
    offset = 6 + 16 * len(pngs)
    entries = b""
    payload = b""
    for s, data in zip((16, 32, 48), pngs):
        entries += (
            bytes([s, s, 0, 0])
            + (1).to_bytes(2, "little")
            + (32).to_bytes(2, "little")
            + len(data).to_bytes(4, "little")
            + offset.to_bytes(4, "little")
        )
        payload += data
        offset += len(data)
    (PUBLIC / "favicon.ico").write_bytes(header + entries + payload)
    print(f"  favicon.ico: {(PUBLIC / 'favicon.ico').stat().st_size // 1024} KB")

    # og-image.png — 1200x630 social card.
    og = Image.new("RGB", (1200, 630), BLACK[:3])
    d = ImageDraw.Draw(og)
    mark = sigil(120)
    og.paste(mark, (90, 90), mark)
    d.text((90, 260), "XR", font=ImageFont.truetype(FONT_BOLD, 150), fill=WHITE[:3])
    d.text((94, 445), "The AI Agent You Can Actually Trust",
           font=ImageFont.truetype(FONT_BOLD, 52), fill=WHITE[:3])
    d.text((94, 520), "Local-first · BYOK · Secure",
           font=ImageFont.truetype(FONT_BOOK, 40), fill=MUTED[:3])
    d.rectangle([94, 585, 294, 591], fill=CYAN[:3])
    og.save(PUBLIC / "og-image.png", optimize=True)
    print(f"  og-image.png: {(PUBLIC / 'og-image.png').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
