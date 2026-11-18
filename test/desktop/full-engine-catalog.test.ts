import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('real authenticated engine HTTP preserves the complete catalog and dynamic custom choices in renderer adapters', () => {
  const home = mkdtempSync(join(tmpdir(), 'xr-full-catalog-'));
  mkdirSync(home, { recursive: true });
  try {
    const child = spawnSync(process.execPath, [resolve(import.meta.dir, 'fixtures/full-engine-catalog.fixture.ts')], {
      env: { ...process.env, XR_HOME: home, XR_SECRET_BACKEND: 'file', XR_SECRETS_ENV_COMPAT: '0', XR_NETWORK_PROBES: 'off' },
      encoding: 'utf8', timeout: 15000,
    });
    expect(child.error, child.stderr + child.stdout).toBeUndefined();
    expect(child.status, child.stderr + child.stdout).toBe(0);
    const row = child.stdout.split('\n').find(line => line.includes('full-engine-catalog-loopback-passed'));
    expect(row).toBeDefined();
    const proof = JSON.parse(row!) as { providerCount: number; modelCount: number; rendererOptions: number; dynamicCustomChoice: boolean };
    expect(proof.providerCount).toBeGreaterThan(4);
    expect(proof.modelCount).toBeGreaterThanOrEqual(27);
    expect(proof.rendererOptions).toBe(proof.modelCount);
    expect(proof.dynamicCustomChoice).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 20000);
