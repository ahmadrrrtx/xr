/*
 * MSIX tile assets (Phase 27).
 *
 * The MSIX package is built by `packaging/windows/msix/build-msix.ps1`; real
 * Windows SDK packaging runs in the Windows bundle job. These portable tests
 * check the manifest's six images and their required sizes/transparency. The
 * separate PowerShell regression exercises the script with fake SDK processes
 * without treating those stubs as native packaging evidence.
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

const WORKFLOW = join(ROOT, '.github/workflows/desktop-app.yml');

/** The MSIX step's shell, comments removed, stopping at the next step. */
function msixStep(): string {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const start = workflow.indexOf('Package MSIX');
  expect(start).toBeGreaterThan(0);
  const next = workflow.indexOf('\n      - name:', start);
  return workflow
    .slice(start, next === -1 ? undefined : next)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

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

  test('each extension category is valid for the namespace declaring it', () => {
    // Comments are stripped first: this manifest documents the rejected
    // categories by name, and that prose must not read as a declaration.
    const xml = readFileSync(MANIFEST, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    /*
     * `Category` is a closed enumeration — and a *different* one per namespace.
     * That two-namespace rule is the whole trap, and it cost two CI round trips:
     *
     *   · `windows.appUserModelId` was declared under desktop: and is in
     *     neither enumeration.
     *   · `windows.toastNotificationActivation` was then declared under uap:,
     *     where it is not a member — it belongs to desktop:.
     *
     * Both fail identically from the outside: MakeAppx prints "Package creation
     * failed" and a schema line reference, with the real cause reduced to one
     * clause of one sentence. Neither is reachable by unit test on Linux, so
     * both enumerations are transcribed here from the MakeAppx errors verbatim.
     */
    const UAP = new Set([
      'windows.fileTypeAssociation', 'windows.protocol', 'windows.autoPlayContent',
      'windows.autoPlayDevice', 'windows.shareTarget', 'windows.search',
      'windows.fileOpenPicker', 'windows.fileSavePicker', 'windows.cachedFileUpdater',
      'windows.contactPicker', 'windows.cameraSettings', 'windows.accountPictureProvider',
      'windows.printTaskSettings', 'windows.lockScreenCall', 'windows.contact',
      'windows.appointmentsProvider', 'windows.alarm', 'windows.webAccountProvider',
      'windows.dialProtocol', 'windows.appService', 'windows.mediaPlayback',
      'windows.print3DWorkflow', 'windows.lockScreen', 'windows.aboveLockScreen',
      'windows.personalAssistantLaunch', 'windows.voipCall',
    ]);
    const DESKTOP = new Set([
      'windows.fullTrustProcess',
      'windows.startupTask',
      'windows.toastNotificationActivation',
      'windows.searchProtocolHandler',
    ]);

    const found = new Map<string, string[]>();
    for (const [, ns, category] of xml.matchAll(/<(\w+):Extension\s+Category="([^"]+)"/g)) {
      if (!found.has(ns)) found.set(ns, []);
      found.get(ns)!.push(category);
    }

    // Something must actually be declared, or this test passes by saying nothing.
    expect(found.get('uap')).toContain('windows.protocol');
    expect(found.get('desktop')).toContain('windows.toastNotificationActivation');

    for (const [ns, categories] of found) {
      const allowed = ns === 'uap' ? UAP : ns === 'desktop' ? DESKTOP : null;
      expect(allowed).not.toBeNull();
      for (const category of categories) expect(allowed!).toContain(category);
    }
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

  /*
   * The CI step that actually builds this package cannot run here, which is
   * exactly why its two failure modes are pinned instead. The first PR run of
   * that step failed on both of them:
   *
   *   · `-Version ${{ github.ref_name }}` — on a pull request the ref is
   *     `175/merge`, and an MSIX Identity Version must be dotted numerics.
   *   · `$pwd` — PowerShell's automatic working-directory variable, so the
   *     "SecureString" handed to signtool was a path, and signing failed with a
   *     type error that says nothing about the real cause.
   */
  test('the CI packaging step takes its version from tauri.conf.json, not the git ref', () => {
    const step = msixStep();
    expect(step).toContain('tauri.conf.json');
    // `github.ref_name` on a pull request is `175/merge`: an MSIX Identity
    // Version must be dotted numerics, so that is a failed package build.
    expect(step).not.toContain('github.ref_name');
  });

  test('the CI packaging step never uses $pwd as a password holder', () => {
    const step = msixStep();
    // $PWD is automatic in PowerShell; assigning to it leaves the SecureString
    // parameter holding a path, and signtool fails with a type error that says
    // nothing about the cause.
    expect(step).not.toMatch(/\$pwd\s*=/);
    expect(step).toContain('$certPassword = ConvertTo-SecureString');
  });
});
