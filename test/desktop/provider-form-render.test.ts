/** Real React form interactions; each renderer runs in isolation to contain module mocks. */
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

for (const scenario of ['keyed', 'keyless', 'edit', 'rotate', 'invalid-url', 'offline', 'degraded', 'selection-failure', 'register-rejected', 'test-through-engine', 'discover-from-draft', 'discovery-failure-preserves-model', 'no-auto-discovery', 'capability-through-engine']) {
  test(`custom provider Settings form: ${scenario}`, () => {
    const result = Bun.spawnSync([process.execPath, 'run', './test/desktop/fixtures/provider-form.fixture.tsx', scenario], {
      cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    expect({ exit: result.exitCode, error: result.exitCode ? result.stderr.toString() : '' }).toEqual({ exit: 0, error: '' });
    expect(result.stdout.toString()).toContain(JSON.stringify({ scenario, ok: true }));
  });
}
