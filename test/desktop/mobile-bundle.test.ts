import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

test('desktop resources include the built PWA and do not enable LAN', () => {
  const conf = JSON.parse(read('desktop/src-tauri/tauri.conf.json'));
  expect(conf.bundle.resources['../../mobile/dist/']).toBe('mobile/');
  const engine = read('desktop/src-tauri/src/engine.rs');
  expect(engine).toContain('cmd.env("XR_MOBILE_DIST", path)');
  expect(engine).not.toContain('.arg("--lan")');
});

test('native and offline Flatpak builds stage the mobile app from its lockfile', () => {
  const workflow = read('.github/workflows/desktop-app.yml');
  expect(workflow.match(/npm --prefix mobile ci --ignore-scripts/g)?.length).toBe(3);
  expect(workflow).toContain('Copy-Item "mobile/dist" "$dir/mobile" -Recurse');
  expect(read('desktop/package.json')).toContain('npm --prefix ../mobile run build');
  expect(read('.github/workflows/windows-preview-test.yml')).toContain('npm --prefix mobile ci --ignore-scripts');
  expect(read('scripts/prepare-flatpak-sources.sh')).toContain('npm --prefix mobile ci --ignore-scripts');
  expect(read('packaging/flatpak/ai.rrrtx.xr-desktop.yml')).toContain('/app/share/xr/mobile');
  const journey = read('scripts/journey/desktop-journey.ts');
  expect(journey).toContain('installed mobile PWA assets missing');
});
