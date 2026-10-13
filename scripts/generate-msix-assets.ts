#!/usr/bin/env bun
/*
 * MSIX tile assets (Phase 27).
 *
 * The MSIX package manifest names six PNGs and MakeAppx fails the whole package
 * if any is missing, so they are generated here from the same master icon the
 * tray set uses — which is the point: an app whose tile art drifted from its
 * icon is a bug nobody notices until it is in a store.
 *
 *   StoreLogo.png         50×50
 *   Square44x44Logo.png   44×44
 *   Square150x150Logo.png 150×150
 *   SmallTile.png         71×71
 *   Wide310x150Logo.png   310×150   (square mark, centred, transparent margin)
 *   SplashScreen.png      620×300   (same)
 *
 * The tiles are transparent-background PNGs with the mark drawn in its own ink
 * plus the one cyan accent dot — the same visual language as the Windows tray
 * icon, so the taskbar and the Start tile agree.
 *
 * Usage: bun run scripts/generate-msix-assets.ts [--check] [--out <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildMask,
  decodePng,
  encodePng,
  markCrop,
  renderMask,
  resampleRegion,
  type Png,
} from './generate-tray-icons.ts';

const ROOT = join(import.meta.dir, '..');
const MASTER = join(ROOT, 'desktop/src-tauri/icons/icon.png');
const DEFAULT_OUT = join(ROOT, 'packaging/windows/msix/Assets');

const INK = { r: 11, g: 15, b: 20 };
const ACCENT = { r: 34, g: 211, b: 238 };

/** name → [width, height]; squares use the mark, wide assets centre it. */
const TARGETS: Array<{ name: string; width: number; height: number }> = [
  { name: 'StoreLogo.png', width: 50, height: 50 },
  { name: 'Square44x44Logo.png', width: 44, height: 44 },
  { name: 'Square150x150Logo.png', width: 150, height: 150 },
  { name: 'SmallTile.png', width: 71, height: 71 },
  { name: 'Wide310x150Logo.png', width: 310, height: 150 },
  { name: 'SplashScreen.png', width: 620, height: 300 },
];

/** The mark rendered into a `size`×`size` square (ink + accent dot). */
export function renderSquare(master: Png, size: number): Png {
  const mask = buildMask(master);
  const crop = markCrop(mask);
  const coverage = resampleRegion(mask, crop, size);
  const image = renderMask(coverage, size, INK);
  return stampAccent(image);
}

/** The one cyan accent: a dot in the lower-right, sized to the icon. */
function stampAccent(image: Png): Png {
  const size = image.width;
  const radius = Math.max(1.5, size * 0.115);
  const cx = size - radius - size * 0.02 - 0.5;
  const cy = size - radius - size * 0.02 - 0.5;
  const data = image.data.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const edge = Math.max(0, Math.min(1, radius - distance + 0.5));
      const at = (y * size + x) * 4;
      data[at] = Math.round(ACCENT.r * edge + data[at]! * (1 - edge));
      data[at + 1] = Math.round(ACCENT.g * edge + data[at + 1]! * (1 - edge));
      data[at + 2] = Math.round(ACCENT.b * edge + data[at + 2]! * (1 - edge));
      data[at + 3] = Math.max(data[at + 3]!, Math.round(edge * 255));
    }
  }
  return { width: size, height: size, data };
}

/** Centre a square mark inside a wider canvas, leaving the rest transparent. */
function centre(image: Png, width: number, height: number): Png {
  const data = new Uint8Array(width * height * 4);
  const offsetX = Math.floor((width - image.width) / 2);
  const offsetY = Math.floor((height - image.height) / 2);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4;
      const to = ((y + offsetY) * width + (x + offsetX)) * 4;
      data[to] = image.data[from]!;
      data[to + 1] = image.data[from + 1]!;
      data[to + 2] = image.data[from + 2]!;
      data[to + 3] = image.data[from + 3]!;
    }
  }
  return { width, height, data };
}

export function generateAll(master: Png): Array<{ name: string; png: Png }> {
  return TARGETS.map((target) => {
    const square = Math.min(target.width, target.height);
    // Wide assets keep the mark at the height (minus a margin) rather than
    // stretching it: a stretched visor is the kind of thing that ships because
    // nobody looked.
    const markSize = target.width === target.height ? square : Math.round(square * 0.72);
    const inner = renderSquare(master, markSize);
    const png =
      target.width === target.height ? inner : centre(inner, target.width, target.height);
    return { name: target.name, png };
  });
}

function main(argv: string[]): number {
  const outIndex = argv.indexOf('--out');
  const outDir = outIndex >= 0 ? argv[outIndex + 1]! : DEFAULT_OUT;
  const check = argv.includes('--check');
  if (!existsSync(MASTER)) {
    console.error(`master icon missing: ${MASTER}`);
    return 1;
  }
  const master = decodePng(new Uint8Array(readFileSync(MASTER)));
  const files = generateAll(master);
  if (check) {
    let drifted = 0;
    for (const file of files) {
      const path = join(outDir, file.name);
      if (!existsSync(path)) {
        console.error(`missing ${file.name}`);
        drifted++;
      }
    }
    return drifted === 0 ? 0 : 1;
  }
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const path = join(outDir, file.name);
    writeFileSync(path, encodePng(file.png));
    console.log(`${file.name.padEnd(24)} ${file.png.width}×${file.png.height}`);
  }
  console.log(`\n${files.length} assets → ${outDir}`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
