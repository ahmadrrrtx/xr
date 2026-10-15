/*
 * Tray icon artefacts (Phase 27).
 *
 * The tray icons are generated, not hand-drawn, and this file is what keeps that
 * honest. Three things are checked:
 *
 *   · **Every file the shell looks for exists, at the right size, with the right
 *     format.** `tray.rs::icon_spec` names them by string; a rename here that
 *     misses there would show a tray with the app icon fallback and nobody would
 *     notice until a screenshot.
 *   · **The macOS icon is a Template image**: pure black, alpha only. Colour in
 *     a Template image is either ignored or rendered as mud — the brief calls
 *     this out specifically.
 *   · **The committed bytes are the generator's output.** Running the generator
 *     in-process and comparing to disk means a master-icon change cannot leave
 *     stale PNGs behind, and the derivation stays reviewable (the parameters are
 *     in the script, not in the binaries).
 */
import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LINUX_SIZES,
  MAC_SIZES,
  WINDOWS_SIZES,
  decodePng,
  generateAll,
  inkAlpha,
} from '../../scripts/generate-tray-icons.ts';

const ROOT = join(import.meta.dir, '..', '..');
const TRAY = join(ROOT, 'desktop/src-tauri/icons/tray');
const MASTER = join(ROOT, 'desktop/src-tauri/icons/icon.png');

interface DecodedPng {
  width: number;
  height: number;
  /** RGBA rows, unfiltered. */
  pixels: Uint8Array;
}

/** Minimal PNG reader for assertions (the generator has the full decoder). */
function readPng(bytes: Uint8Array): DecodedPng {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect(bytes[offset + 16]).toBe(8); // bit depth
      expect(bytes[offset + 17]).toBe(6); // RGBA
      expect(bytes[offset + 20]).toBe(0); // not interlaced
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]!;
    // The generator writes filter 0 rows only; anything else would mean the
    // encoder changed and this reader is out of date.
    expect(filter).toBe(0);
    out.set(raw.subarray(cursor, cursor + stride), y * stride);
    cursor += stride;
  }
  return { width, height, pixels: out };
}

function readFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

describe('tray icons: the files the shell looks for', () => {
  test('macOS template set exists at 1x and 2x', () => {
    const one = readPng(readFile(join(TRAY, 'tray-mac-template.png')));
    expect([one.width, one.height]).toEqual([MAC_SIZES[0], MAC_SIZES[0]]);
    const two = readPng(readFile(join(TRAY, 'tray-mac-template@2x.png')));
    expect([two.width, two.height]).toEqual([MAC_SIZES[1], MAC_SIZES[1]]);
  });

  test('every Linux size the panels ask for is present, plain and badged', () => {
    for (const size of LINUX_SIZES) {
      for (const name of [`tray-linux-${size}.png`, `tray-linux-${size}-badge.png`]) {
        const path = join(TRAY, name);
        expect(existsSync(path)).toBe(true);
        const png = readPng(readFile(path));
        expect([png.width, png.height]).toEqual([size, size]);
      }
    }
  });

  test('Windows gets one .ico per state, with both shell sizes inside', () => {
    for (const name of ['tray-win.ico', 'tray-win-badge.ico']) {
      const bytes = readFile(join(TRAY, name));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      expect(view.getUint16(0, true)).toBe(0); // reserved
      expect(view.getUint16(2, true)).toBe(1); // ICO
      const count = view.getUint16(4, true);
      expect(count).toBe(WINDOWS_SIZES.length);

      const sizes: number[] = [];
      for (let index = 0; index < count; index++) {
        const at = 6 + index * 16;
        const declared = bytes[at]! === 0 ? 256 : bytes[at]!;
        sizes.push(declared);
        const length = view.getUint32(at + 8, true);
        const offset = view.getUint32(at + 12, true);
        const payload = bytes.subarray(offset, offset + length);
        // PNG-in-ICO: the payload must be a real PNG of the declared size.
        expect(payload[0]).toBe(0x89);
        expect(payload[1]).toBe(0x50);
        const png = readPng(payload);
        expect([png.width, png.height]).toEqual([declared, declared]);
      }
      expect(sizes).toEqual([...WINDOWS_SIZES]);
    }
  });
});

describe('tray icons: platform rules', () => {
  test('the macOS icon is pure black + alpha (a real Template image)', () => {
    for (const name of ['tray-mac-template.png', 'tray-mac-template@2x.png']) {
      const png = readPng(readFile(join(TRAY, name)));
      let opaque = 0;
      for (let i = 0; i < png.width * png.height; i++) {
        const r = png.pixels[i * 4]!;
        const g = png.pixels[i * 4 + 1]!;
        const b = png.pixels[i * 4 + 2]!;
        const a = png.pixels[i * 4 + 3]!;
        if (a === 0) continue;
        // No colour, anywhere: macOS tints the mask itself.
        expect([r, g, b]).toEqual([0, 0, 0]);
        opaque++;
      }
      expect(opaque).toBeGreaterThan(0);
    }
  });

  test('Windows/Linux icons carry the cyan accent, macOS carries none', () => {
    const countAccent = (name: string): number => {
      const png = readPng(readFile(join(TRAY, name)));
      let count = 0;
      for (let i = 0; i < png.width * png.height; i++) {
        const [r, g, b, a] = [
          png.pixels[i * 4]!,
          png.pixels[i * 4 + 1]!,
          png.pixels[i * 4 + 2]!,
          png.pixels[i * 4 + 3]!,
        ];
        if (a > 128 && b > 150 && g > 120 && r < 120) count++;
      }
      return count;
    };
    expect(countAccent('tray-linux-64.png')).toBeGreaterThan(20);
    // The badged state is a bigger dot, never a second dot.
    expect(countAccent('tray-linux-64-badge.png')).toBeGreaterThan(countAccent('tray-linux-64.png'));
    expect(countAccent('tray-mac-template.png')).toBe(0);
  });

  test('small icons keep their alpha edges (no hard-clipped square)', () => {
    const png = readPng(readFile(join(TRAY, 'tray-linux-22.png')));
    const size = png.width;
    const alphaAt = (x: number, y: number): number => png.pixels[(y * size + x) * 4 + 3]!;
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(size - 1, 0)).toBe(0);
    // Partially transparent pixels exist (anti-aliasing survived the downscale).
    let partial = 0;
    for (let i = 0; i < size * size; i++) {
      const a = png.pixels[i * 4 + 3]!;
      if (a > 8 && a < 248) partial++;
    }
    expect(partial).toBeGreaterThan(2);
  });
});

describe('tray icons: the committed bytes are the generator output', () => {
  test('regenerating from the master reproduces every file byte for byte', () => {
    const master = decodePng(readFile(MASTER));
    const generated = generateAll(master);
    expect(generated.length).toBeGreaterThan(0);
    for (const file of generated) {
      const onDisk = readFile(join(TRAY, file.name));
      expect(Buffer.from(onDisk).equals(file.bytes)).toBe(true);
    }
  });

  test('the generator is deterministic across runs', () => {
    const master = decodePng(readFile(MASTER));
    const once = generateAll(master);
    const twice = generateAll(decodePng(readFile(MASTER)));
    for (let i = 0; i < once.length; i++) {
      expect(once[i]!.name).toBe(twice[i]!.name);
      expect(once[i]!.bytes.equals(twice[i]!.bytes)).toBe(true);
    }
  });
});

describe('tray icons: the ink rule', () => {
  test('bright artwork becomes ink and the badge face becomes transparent', () => {
    // Bucket F v2 rule: coverage = brightness above the badge face × alpha.
    // Blade silver (lum ≈ 0.98) is full coverage; the badge face (7,15,27,
    // lum ≈ 0.06) and the badge rim (≤ 0.30) are none.
    expect(inkAlpha(250, 250, 250, 255)).toBe(1);
    expect(inkAlpha(7, 15, 27, 255)).toBe(0);
    expect(inkAlpha(10, 20, 35, 255)).toBe(0);
    // Mid-silver lands between: the ramp is what keeps the blades'
    // gradient from turning into a hard posterised edge. The ramp runs
    // 0.30 → 0.60 luminance, so 0.42 (≈107) is inside it.
    const mid = inkAlpha(107, 107, 107, 255);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(inkAlpha(190, 190, 190, 255)).toBe(1);
  });

  test('alpha in the master scales artwork coverage, never creates it', () => {
    expect(inkAlpha(250, 250, 250, 0)).toBe(0);
    // Bright art at half alpha is half coverage (anti-aliased edges) …
    expect(inkAlpha(250, 250, 250, 128)).toBeCloseTo(128 / 255, 5);
    // … but the badge's dark semi-transparent fringe (α≈239) is not art.
    expect(inkAlpha(10, 20, 35, 239)).toBe(0);
  });
});
