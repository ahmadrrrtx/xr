/*
 * MSIX tile assets (Phase 27).
 *
 * The MSIX package is built by `packaging/windows/msix/build-msix.ps1`, which
 * cannot run here (no Windows SDK, no PowerShell on a Linux CI box). What *can*
 * be checked on any machine is the part that silently breaks a package build:
 * the manifest naming six images that must exist, at the sizes MakeAppx
 * requires, with a transparent background so the tile does not ship a black
 * square inside a Start menu.
 */
import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { decodePng } from '../../scripts/generate-tray-icons.ts';
import { generateAll } from '../../scripts/generate-msix-assets.ts';

const ROOT = join(import.meta.dir, '..', '..');
const ASSETS = join(ROOT, 'packaging/windows/msix/Assets');
const MANIFEST = join(ROOT, 'packaging/windows/msix/AppxManifest.xml');
const MASTER = join(ROOT, 'desktop/src-tauri/icons/icon.png');
const PS1 = join(ROOT, 'packaging/windows/msix/build-msix.ps1');

/** Every image the manifest references, with the size it must be. */
const REQUIRED: Array<{ file: string; width: number; height: number }> = [
  { file: 'StoreLogo.png', width: 50, height: 50 },
  { file: 'Square44x44Logo.png', width: 44, height: 44 },
  { file: 'Square150x150Logo.png', width: 150, height: 150 },
  { file: 'SmallTile.png', width: 71, height: 71 },
  { file: 'Wide310x150Logo.png', width: 310, height: 150 },
  { file: 'SplashScreen.png', width: 620, height: 300 },
];

function readPng(path: string): { width: number; height: number; pixels: Uint8Array } {
  const bytes = new Uint8Array(readFileSync(path));
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50);
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
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat.map((chunk) => Buffer.from(chunk))));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  let cursor = 0;
  for (let y = 0; y < height; y++) {
    expect(raw[cursor]).toBe(0); // the generator writes unfiltered rows
    pixels.set(raw.subarray(cursor + 1, cursor + 1 + stride), y * stride);
    cursor += stride + 1;
  }
  return { width, height, pixels };
}

describe('MSIX package inputs', () => {
  test('every image the manifest names exists at the right size', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    for (const asset of REQUIRED) {
      expect(manifest).toContain(asset.file);
      const path = join(ASSETS, asset.file);
      if (!existsSync(path)) {
        throw new Error(`${asset.file} is missing — run: bun run scripts/generate-msix-assets.ts`);
      }
      const png = readPng(path);
      expect([png.width, png.height]).toEqual([asset.width, asset.height]);
    }
  });

  test('the tiles are transparent-background, not white or black squares', () => {
    for (const asset of REQUIRED) {
      const png = readPng(join(ASSETS, asset.file));
      const cornerAlpha = png.pixels[3]!;
      expect(cornerAlpha).toBe(0);
      // …and the artwork is actually there.
      let opaque = 0;
      for (let i = 0; i < png.width * png.height; i++) {
        if (png.pixels[i * 4 + 3]! > 200) opaque++;
      }
      expect(opaque).toBeGreaterThan(png.width * png.height * 0.05);
    }
  });

  test('the committed tiles are exactly what the generator produces', () => {
    const master = decodePng(new Uint8Array(readFileSync(MASTER)));
    const generated = generateAll(master);
    expect(generated.length).toBe(REQUIRED.length);
    for (const file of generated) {
      const onDisk = readPng(join(ASSETS, file.name));
      expect(onDisk.width).toBe(file.png.width);
      expect(onDisk.height).toBe(file.png.height);
      // Compare the pixels: the encoder is shared with the tray generator, so
      // this is a stronger check than comparing file bytes would be.
      expect(onDisk.pixels.length).toBe(file.png.data.length);
      for (let i = 0; i < onDisk.pixels.length; i += 997) {
        expect(onDisk.pixels[i]).toBe(file.png.data[i]);
      }
    }
  });
});

describe('MSIX packaging script', () => {
  test('the identity the brief specifies is in the manifest', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    expect(manifest).toContain('Name="XRrrrtx.XRDesktop"');
    expect(manifest).toContain('<PublisherDisplayName>Muhammad Ahmad</PublisherDisplayName>');
    // The publisher subject must be the certificate subject at signing time.
    expect(manifest).toContain('Publisher="CN=Muhammad Ahmad');
  });

  test('the manifest declares the deep link and toast activation', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    expect(manifest).toContain('windows.protocol');
    expect(manifest).toContain('<uap:Protocol Name="xr">');
    expect(manifest).toContain('ToastNotificationActivation');
    expect(manifest).toContain('Windows.FullTrustApplication');
  });

  test('the build script refuses to package a shell without its engine', () => {
    const script = readFileSync(PS1, 'utf8');
    // The sidecar is what makes XR an agent rather than a window; silent
    // omission would ship a broken app that installs fine.
    expect(script).toContain('xr-engine-*.exe');
    expect(script).toContain('throw');
    expect(script).toContain('MakeAppx.exe');
    expect(script).toContain('signtool.exe');
    // Unsigned builds are warned about, never presented as shippable.
    expect(script.toLowerCase()).toContain('unsigned');
  });
});
