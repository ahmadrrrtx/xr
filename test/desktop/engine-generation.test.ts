import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createEngineSupervisor } from '../../desktop/src/engine/supervisor';

test('all boot phases share a monotonic deadline; an old generation cannot publish', async () => {
  let now = 0; const s = createEngineSupervisor(() => now);
  const boot = s.begin(30); const scope = s.scope(boot, 30);
  await scope.run(async () => { now = 12; });
  expect(scope.remaining()).toBe(18);
  const catalog = s.scope(boot, 30); expect(catalog.remaining()).toBe(18);
  now = 31; await expect(catalog.run(async () => 'late')).rejects.toThrow('deadline');
  s.begin(30); expect(boot.signal.aborted).toBe(true); expect(scope.current()).toBe(false);
});
for (const scenario of ['late-refresh-after-restart', 'late-catalog', 'stale-on-loss', 'boot-deadline', 'restart-ipc-timeout', 'diagnostics-timeout']) {
  test(`engine generation: ${scenario}`, () => {
    const res = Bun.spawnSync([process.execPath, 'run', './test/desktop/fixtures/engine-generation.fixture.ts', scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 5000,
    });
    expect({ exit: res.exitCode, error: res.exitCode ? res.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(res.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
