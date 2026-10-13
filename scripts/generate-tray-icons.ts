#!/usr/bin/env bun
/*
 * Tray icons, generated from the app's master icon (Phase 27).
 *
 * Why generate instead of committing hand-drawn PNGs: a tray mark has to agree
 * with the app icon, and it has to exist in five formats at four sizes across
 * three platforms. Deriving all of them from one source means the mark cannot
 * drift, and the parameters (threshold, crop, dot size) are reviewable numbers
 * in this file instead of decisions buried in a binary.
 *
 * What it writes into desktop/src-tauri/icons/tray/:
 *
 *   tray-mac-template.png / @2x    22 px + 44 px, pure black + alpha, no colour.
 *                                  macOS Template images are masked by the OS,
 *                                  so colour here would either be ignored or
 *                                  (worse) rendered as a muddy grey blob.
 *   tray-linux-<size>.png          22/24/32/48/64/128 px. AppIndicator picks the
 *                                  size it needs; the set covers every panel.
 *   tray-linux-<size>-badge.png    the same mark with a larger cyan dot, shown
 *                                  while approvals are pending (the count itself
 *                                  is in the menu, not in 16 pixels).
 *   tray-win.ico                   16 + 32 px entries in one .ico.
 *   tray-win-badge.ico             the pending-approvals variant.
 *
 * Aesthetic rules it keeps to (from the phase brief):
 *   · one cyan accent, never two, never a glow;
 *   · monochrome body in the platform's foreground colour, never a gradient;
 *   · nothing that forces the app's dark theme onto a light OS — the mark is
 *     drawn in the *icon*'s own ink, and macOS gets pure black so the OS can
 *     invert it.
 *
 * Usage:  bun run scripts/generate-tray-icons.ts [--inspect] [--out <dir>]
 *
 * Zero dependencies on purpose: this runs in CI, in a fresh container, and on a
 * machine with no image libraries installed.
 */
import { deflateSync, inflateSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const MASTER = join(ROOT, "desktop/src-tauri/icons/icon.png");
const DEFAULT_OUT = join(ROOT, "desktop/src-tauri/icons/tray");

/** Ink + accent. The accent is the product's cyan, used exactly once. */
const INK_RGBA = { r: 11, g: 15, b: 20 };
const ACCENT_RGBA = { r: 34, g: 211, b: 238 };

/**
 * Luminance thresholds for the alpha mask. The master icon is a dark mark on a
 * near-white background, so "how dark" is "how opaque". These numbers come from
 * `--inspect` on the committed master (background ≈ 250+, ink ≈ 20–60).
 */
const INK_THRESHOLD = 0.55;
const INK_SOFTNESS = 0.35;

/** Ink coverage a pixel needs before it counts as subject (not shadow, not paper). */
const SUBJECT_COVERAGE = 0.5;
/** Air around the mark, as a fraction of its own size.
 *
 *  Measured, not guessed: the master's head has a soft drop shadow to its right,
 *  and at 8% padding the 22 px render leaves that shadow 0–5% opacity along the
 *  right edge — enough that a 1 px threshold sees haze in the icon's last
 *  column. 12% clears it, and the head still fills 70% of the frame. */
const CROP_PADDING = 0.12;

interface Png {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
}

// ─── PNG decode ─────────────────────────────────────────────────────────────

export function decodePng(bytes: Uint8Array): Png {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error("not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16]!;
      colorType = bytes[offset + 17]!;
      interlace = bytes[offset + 20]!;
    } else if (type === "PLTE") {
      palette = body.slice();
    } else if (type === "tRNS") {
      transparency = body.slice();
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`only 8-bit PNGs are supported (got ${bitDepth})`);
  if (interlace !== 0) throw new Error("interlaced PNGs are not supported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);

  let cursor = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[cursor++]!;
    current.set(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    unfilter(filter, current, previous, channels);
    // Expand to RGBA.
    for (let x = 0; x < width; x++) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;
      switch (colorType) {
        case 0:
          r = g = b = current[src]!;
          break;
        case 2:
          r = current[src]!;
          g = current[src + 1]!;
          b = current[src + 2]!;
          break;
        case 3: {
          const index = current[src]! * 3;
          r = palette?.[index] ?? 0;
          g = palette?.[index + 1] ?? 0;
          b = palette?.[index + 2] ?? 0;
          a = colorType === 3 ? (transparency?.[current[src]!] ?? 255) : 255;
          break;
        }
        case 4:
          r = g = b = current[src]!;
          a = current[src + 1]!;
          break;
        default:
          r = current[src]!;
          g = current[src + 1]!;
          b = current[src + 2]!;
          a = current[src + 3]!;
      }
      out[dst] = r;
      out[dst + 1] = g;
      out[dst + 2] = b;
      out[dst + 3] = a;
    }
    previous.set(current);
  }
  return { width, height, data: out };
}

function unfilter(
  filter: number,
  line: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
): void {
  const length = line.length;
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bytesPerPixel; i < length; i++) line[i] = (line[i]! + line[i - bytesPerPixel]!) & 0xff;
      return;
    case 2:
      for (let i = 0; i < length; i++) line[i] = (line[i]! + previous[i]!) & 0xff;
      return;
    case 3:
      for (let i = 0; i < length; i++) {
        const left = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
        line[i] = (line[i]! + ((left + previous[i]!) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < length; i++) {
        const a = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
        const b = previous[i]!;
        const c = i >= bytesPerPixel ? previous[i - bytesPerPixel]! : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i]! + predictor) & 0xff;
      }
      return;
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

// ─── PNG encode ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const payload = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(body)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
}

export function encodePng(image: Png): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none (tray icons are tiny; ratio is fine)
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

// ─── ICO (PNG-compressed entries) ───────────────────────────────────────────

/**
 * An .ico holding PNG entries. Windows has accepted PNG payloads in icons since
 * Vista, and every icon in this set is authored at exactly the sizes listed, so
 * there is nothing to gain from re-encoding BMP/DIB here.
 */
function encodeIco(entries: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    directory[at] = entry.size >= 256 ? 0 : entry.size; // 0 means 256
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
    directory[at + 2] = 0; // palette
    directory[at + 3] = 0; // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

// ─── The mark ───────────────────────────────────────────────────────────────

/**
 * Alpha for one master pixel: opaque where the artwork is dark, transparent on
 * the paper. Alpha carried by the PNG itself always wins (a future master with
 * a real transparent background must not be thresholded).
 */
export function inkAlpha(r: number, g: number, b: number, a: number): number {
  if (a < 250) return a / 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const t = (INK_THRESHOLD - luminance) / INK_SOFTNESS;
  return Math.max(0, Math.min(1, t));
}

export interface Mask {
  width: number;
  height: number;
  /** 0–1 coverage per pixel. */
  coverage: Float32Array;
}

/** A grayscale coverage mask of the whole master. */
export function buildMask(master: Png): Mask {
  const coverage = new Float32Array(master.width * master.height);
  for (let i = 0; i < coverage.length; i++) {
    coverage[i] = inkAlpha(
      master.data[i * 4]!,
      master.data[i * 4 + 1]!,
      master.data[i * 4 + 2]!,
      master.data[i * 4 + 3]!,
    );
  }
  return { width: master.width, height: master.height, coverage };
}

/** Bounding box of everything above `minCoverage` in a horizontal band. */
export function inkBounds(
  mask: Mask,
  fromY = 0,
  toY = mask.height,
  minCoverage = 0.5,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = mask.width;
  let y0 = mask.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = Math.max(0, Math.floor(fromY)); y < Math.min(mask.height, Math.ceil(toY)); y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.coverage[y * mask.width + x]! >= minCoverage) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { x0: 0, y0: 0, x1: mask.width - 1, y1: mask.height - 1 };
  return { x0, y0, x1, y1 };
}

/**
 * Where the subject is: the visor's region of the master, as fractions of the
 * image. This window is the only hand-set number in the derivation, and it is
 * deliberately generous — everything inside it is measured.
 *
 * Why a window at all: the master is head-and-shoulders with a flowing cape, and
 * a tray icon wants the head. Tracing the figure row by row cannot separate them
 * here — the artwork's bright eyes break the ink run into pieces and the
 * shoulders are wider than the head — so the crop is anchored instead: the head
 * lives in the top half of the artwork, the cape fills the rest.
 *
 * The numbers were placed with `--inspect`, which prints the bounds of the bright
 * eye pair inside the window. If a future master moves the face, the eyes leave
 * the crop and `--inspect` says so (see the eye check below) instead of shipping
 * a tray icon of a shoulder.
 */
const SUBJECT_WINDOW = { x0: 0.27, y0: 0.09, x1: 0.73, y1: 0.52 };

/** Bright-pixel bounds inside a box — the eye pair plus specular highlights. */
export function brightBounds(
  master: Png,
  box: { x0: number; y0: number; x1: number; y1: number },
  minLuminance = 0.8,
): { x0: number; y0: number; x1: number; y1: number; count: number } {
  let x0 = master.width;
  let y0 = master.height;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = box.y0; y < Math.min(master.height, box.y1); y++) {
    for (let x = box.x0; x < Math.min(master.width, box.x1); x++) {
      const at = (y * master.width + x) * 4;
      const luminance =
        (0.2126 * master.data[at]! + 0.7152 * master.data[at + 1]! + 0.0722 * master.data[at + 2]!) / 255;
      if (luminance < minLuminance) continue;
      count++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1, count };
}

/** Ink bounds inside [`SUBJECT_WINDOW`], falling back to the whole image. */
export function subjectBounds(mask: Mask, minCoverage = 0.5): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.floor(mask.width * SUBJECT_WINDOW.x0);
  const x1 = Math.ceil(mask.width * SUBJECT_WINDOW.x1);
  const y0 = Math.floor(mask.height * SUBJECT_WINDOW.y0);
  const y1 = Math.ceil(mask.height * SUBJECT_WINDOW.y1);

  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = y0; y < Math.min(mask.height, y1); y++) {
    for (let x = x0; x < Math.min(mask.width, x1); x++) {
      if (mask.coverage[y * mask.width + x]! < minCoverage) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return inkBounds(mask);
  return { x0: minX, y0: minY, x1: maxX, y1: maxY };
}

/** The square crop the mark is taken from: the visor, padded, centred. */
export function markCrop(mask: Mask): { x: number; y: number; size: number } {
  const band = subjectBounds(mask);
  const centreX = (band.x0 + band.x1) / 2;
  const centreY = (band.y0 + band.y1) / 2;
  const extent = Math.max(band.x1 - band.x0, band.y1 - band.y0);
  const size = Math.round(extent * (1 + CROP_PADDING * 2));
  return {
    x: Math.round(centreX - size / 2),
    y: Math.round(centreY - size / 2),
    size,
  };
}

/** Area-average downscale of a mask region to `size` (anti-aliased by construction). */
export function resampleRegion(mask: Mask, crop: { x: number; y: number; size: number }, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const scale = crop.size / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = crop.x + x * scale;
      const sy = crop.y + y * scale;
      let sum = 0;
      let samples = 0;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(Math.ceil(sx + scale), mask.width);
      const y1 = Math.min(Math.ceil(sy + scale), mask.height);
      for (let py = Math.max(0, y0); py < y1; py++) {
        for (let px = Math.max(0, x0); px < x1; px++) {
          sum += mask.coverage[py * mask.width + px]!;
          samples++;
        }
      }
      out[y * size + x] = samples > 0 ? sum / samples : 0;
    }
  }
  return out;
}

/** A coverage mask rendered to RGBA in one ink colour. */
export function renderMask(coverage: Float32Array, size: number, rgba: { r: number; g: number; b: number }): Png {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < coverage.length; i++) {
    const alpha = Math.max(0, Math.min(1, coverage[i]!));
    data[i * 4] = rgba.r;
    data[i * 4 + 1] = rgba.g;
    data[i * 4 + 2] = rgba.b;
    data[i * 4 + 3] = Math.round(alpha * 255);
  }
  return { width: size, height: size, data };
}

/**
 * The single cyan accent: one filled dot in the lower-right of a transparent
 * icon, sized as a fraction of the icon. `badged` draws the larger dot the menu
 * uses to say "approvals are waiting".
 */
export function addAccentDot(
  image: Png,
  badged: boolean,
): Png {
  const size = image.width;
  const radius = Math.max(1.5, size * (badged ? 0.19 : 0.115));
  const cx = size - radius - size * 0.02 - 0.5;
  const cy = size - radius - size * 0.02 - 0.5;
  const data = image.data.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      // One pixel of feathering so a 16 px icon does not ship a jagged dot.
      const edge = Math.max(0, Math.min(1, radius - distance + 0.5));
      const at = (y * size + x) * 4;
      const existing = data[at + 3]! / 255;
      const coverage = Math.max(existing, edge);
      data[at] = Math.round(ACCENT_RGBA.r * edge + data[at]! * (1 - edge));
      data[at + 1] = Math.round(ACCENT_RGBA.g * edge + data[at + 1]! * (1 - edge));
      data[at + 2] = Math.round(ACCENT_RGBA.b * edge + data[at + 2]! * (1 - edge));
      data[at + 3] = Math.round(coverage * 255);
    }
  }
  return { width: size, height: size, data };
}

// ─── What gets written ──────────────────────────────────────────────────────

/** macOS: 22 pt at 1x and 2x, pure black, no colour (the OS tints it). */
export const MAC_SIZES = [22, 44] as const;
/** Linux panels: AppIndicator scales to fit, so cover the range it asks for. */
export const LINUX_SIZES = [22, 24, 32, 48, 64, 128] as const;
/** Windows tray: one .ico with both sizes the shell asks for. */
export const WINDOWS_SIZES = [16, 32] as const;

export interface GeneratedFile {
  name: string;
  bytes: Buffer;
  note: string;
}

export function generateAll(master: Png): GeneratedFile[] {
  const mask = buildMask(master);
  const crop = markCrop(mask);
  const files: GeneratedFile[] = [];

  const render = (size: number, rgba: { r: number; g: number; b: number }): Png =>
    renderMask(resampleRegion(mask, crop, size), size, rgba);

  // macOS Template: pure black ink; the OS handles light/dark.
  MAC_SIZES.forEach((size) => {
    files.push({
      name: size === 22 ? "tray-mac-template.png" : "tray-mac-template@2x.png",
      bytes: encodePng(render(size, { r: 0, g: 0, b: 0 })),
      note: `macOS Template ${size}px`,
    });
  });

  // Linux: ink + one cyan accent; badge variant for pending approvals.
  LINUX_SIZES.forEach((size) => {
    const base = render(size, INK_RGBA);
    files.push({
      name: `tray-linux-${size}.png`,
      bytes: encodePng(addAccentDot(base, false)),
      note: `Linux ${size}px`,
    });
    files.push({
      name: `tray-linux-${size}-badge.png`,
      bytes: encodePng(addAccentDot(render(size, INK_RGBA), true)),
      note: `Linux ${size}px, approvals pending`,
    });
  });

  // Windows: one .ico per state, containing both tray sizes.
  (["tray-win.ico", "tray-win-badge.ico"] as const).forEach((name) => {
    const badged = name.includes("badge");
    const entries = WINDOWS_SIZES.map((size) => ({
      size,
      png: encodePng(addAccentDot(render(size, INK_RGBA), badged)),
    }));
    files.push({ name, bytes: encodeIco(entries), note: `Windows .ico (${WINDOWS_SIZES.join("+")}px)` });
  });

  return files;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function inspect(master: Png): void {
  const mask = buildMask(master);
  const visor = subjectBounds(mask);
  const whole = inkBounds(mask);
  console.log(`master: ${master.width}×${master.height}`);
  console.log(`ink bbox (whole):  x ${whole.x0}–${whole.x1}, y ${whole.y0}–${whole.y1}`);
  console.log(`mark bbox (head):   x ${visor.x0}–${visor.x1}, y ${visor.y0}–${visor.y1}`);
  const crop = markCrop(mask);
  const eyes = brightBounds(master, {
    x0: Math.floor(master.width * 0.28),
    y0: Math.floor(master.height * 0.16),
    x1: Math.ceil(master.width * 0.72),
    y1: Math.ceil(master.height * 0.45),
  });
  const eyeCentreX = (eyes.x0 + eyes.x1) / 2;
  const cropCentreX = crop.x + crop.size / 2;
  console.log(
    `eye pair: x ${eyes.x0}–${eyes.x1} (centre ${eyeCentreX.toFixed(0)}, ${eyes.count} bright px)`,
  );
  const offset = Math.abs(eyeCentreX - cropCentreX) / crop.size;
  console.log(
    offset <= 0.06
      ? `eye check: centred (offset ${(offset * 100).toFixed(1)}% of the crop)`
      : `eye check: WARNING — the eye pair is ${(offset * 100).toFixed(1)}% off the crop centre; re-place SUBJECT_WINDOW`,
  );
  console.log(`crop: x ${crop.x}, y ${crop.y}, size ${crop.size}`);
  let covered = 0;
  for (const value of mask.coverage) if (value >= 0.5) covered++;
  console.log(`opaque coverage: ${((covered / mask.coverage.length) * 100).toFixed(1)}% of the master`);
  for (const size of [...MAC_SIZES, ...WINDOWS_SIZES]) {
    const region = resampleRegion(mask, crop, size);
    let ink = 0;
    for (const value of region) ink += value;
    console.log(`  ${size}px: ${((ink / region.length) * 100).toFixed(1)}% ink`);
  }
}

export function main(argv: string[]): number {
  const outIndex = argv.indexOf("--out");
  const outDir = outIndex >= 0 ? argv[outIndex + 1] : DEFAULT_OUT;
  if (!existsSync(MASTER)) {
    console.error(`master icon missing: ${MASTER}`);
    return 1;
  }
  const master = decodePng(new Uint8Array(readFileSync(MASTER)));

  if (argv.includes("--inspect")) {
    inspect(master);
    return 0;
  }

  if (!outDir) {
    console.error("--out needs a directory");
    return 1;
  }
  mkdirSync(outDir, { recursive: true });
  const files = generateAll(master);
  for (const file of files) {
    const path = join(outDir, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes);
    console.log(`${file.name.padEnd(30)} ${String(file.bytes.length).padStart(7)} B  ${file.note}`);
  }
  console.log(`\n${files.length} files → ${outDir}`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
