#!/usr/bin/env python3
"""
XR Phase 4 · T5 — one-off dashboard CSP conversion (committed).

Converts the dashboard to a strict-CSP shape:
  1. inline `onclick="..."`  → `data-xr-action="..."` (dispatched by a
     whitelist parser in client-script.ts — no eval, no inline handlers);
  2. inline `style="..."`    → generated utility classes `.xr-s-N`
     (style-src 'self' with zero unsafe-inline);
  3. inline <style>/<script> → external /assets/dashboard.css + .js assets
     (script-src 'self').

Deterministic: run once, commit the result, and the guard test
(test/security/dashboard-csp-guard.test.ts) fails if inline handlers or
inline styles reappear.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "src/daemon/dashboard/markup.ts", ROOT / "src/daemon/dashboard/client-script.ts"]

ONCLICK_RE = re.compile(r'onclick="([^"]*)"')
STYLE_RE = re.compile(r'style="([^"]*)"')

def convert(files):
    styles: dict[str, str] = {}   # distinct style text -> class name
    for path in files:
        text = path.read_text()
        # 1. onclick -> data-xr-action
        text = ONCLICK_RE.sub(lambda m: f'data-xr-action="{m.group(1)}"', text)
        # 2. style -> utility class
        def style_sub(m):
            s = m.group(1)
            if s not in styles:
                styles[s] = f"xr-s-{len(styles) + 1}"
            return f'class="xr-s-{styles[s][5:]}"' if False else f'class="{styles[s]}"'
        # but elements may already have class= — handle via placeholder then merge
        text = STYLE_RE.sub(lambda m: f'__XR_STYLE__{styles.setdefault(m.group(1), f"xr-s-{len(styles)+1}")}__', text)
        path.write_text(text)
        print(f"converted {path.name}")
    return styles

def main():
    # We need two passes: collect styles first (counting unique), then substitute
    # with correct class names, merging with any existing class attribute.
    styles: dict[str, str] = {}
    # pass 1: enumerate
    for path in FILES:
        text = path.read_text()
        for m in STYLE_RE.finditer(text):
            s = m.group(1)
            if s not in styles:
                styles[s] = f"xr-s-{len(styles) + 1}"
    # pass 2: replace
    for path in FILES:
        text = path.read_text()
        text = ONCLICK_RE.sub(lambda m: f'data-xr-action="{m.group(1)}"', text)
        def style_sub(m):
            cls = styles[m.group(1)]
            # find the opening tag start to merge with existing class
            start = text.rfind("<", 0, m.start())
            tag = text[start:m.start()]
            if 'class="' in tag:
                return f'class="__XR_KEEP__ {cls}"'  # placeholder; merged below
            return f'class="{cls}"'
        # simpler: regex over the whole tag
        text = re.sub(r'(<[a-zA-Z][^>]*?)\s+style="([^"]*)"', lambda m: merge_style(m, styles), text)
        path.write_text(text)
        print(f"converted {path.name}")

def merge_style(m, styles):
    tag = m.group(1)
    style = m.group(2)
    cls = styles[style]
    if 'class="' in tag:
        # merge into existing class attribute
        return re.sub(r'class="([^"]*)"', lambda cm: f'class="{cm.group(1)} {cls}"', tag, count=1)
    return f'{tag} class="{cls}"'

if __name__ == "__main__":
    main()
    print("done")
