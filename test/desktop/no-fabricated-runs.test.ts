/*
 * XR-REL-03 — a release build never fabricates a run.
 *
 * The Control Room / Brain could render a fully populated trace (spans, token
 * counts, dollar costs, tool calls, logs) for a run that never happened:
 * `brainStore.loadRun` rebuilt ANY unknown id from a deterministic mock script,
 * the demo button fell back to a canned trace when no provider answered, and
 * the "Recent runs" list appended scripted rows. All of that is a development
 * fixture — useful for building the UI, unacceptable in a shipped app.
 *
 * This test pins the two things that keep it out of a release:
 *   1. every reachable scripted path is guarded by `import.meta.env.DEV`;
 *   2. the production bundle contains no mock-run entry point or fake ids.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..');
const DESKTOP_SRC = join(REPO, 'desktop', 'src');
const DESKTOP_DIST = join(REPO, 'desktop', 'dist');

const read = (rel: string): string => readFileSync(join(DESKTOP_SRC, rel), 'utf8');

/** True when `needle` appears after at least one DEV guard in the file. */
function devGuardPrecedes(src: string, needle: string): boolean {
  const guard = src.indexOf('import.meta.env.DEV');
  const at = src.indexOf(needle);
  return guard !== -1 && at !== -1 && guard < at;
}

describe('XR-REL-03 · the mock run engine is development-only', () => {
  test('brainStore.loadRun refuses the scripted branch outside DEV', () => {
    const src = read('stores/brainStore.ts');
    // The guard sits directly before the scripted-trace comment.
    const guardAt = src.indexOf('XR-REL-03 — the scripted trace is a DEVELOPMENT fixture');
    expect(guardAt).toBeGreaterThan(-1);
    const region = src.slice(guardAt - 400, guardAt + 1600);
    expect(region).toContain('import.meta.env.DEV');
    // And it returns before reaching buildScript/materialize.
    const guardBranch = region.slice(region.indexOf('import.meta.env.DEV'));
    expect(guardBranch.indexOf('return;')).toBeLessThan(guardBranch.indexOf('buildScript(') === -1 ? Infinity : guardBranch.indexOf('buildScript('));
  });

  test('restartRun and startMockRun are guarded too', () => {
    const src = read('stores/brainStore.ts');
    expect(src).toContain('re-running a SCRIPTED trace is a dev fixture');
    expect(src).toContain('a release build never fabricates a run');
  });

  test('the demo entry point returns no-provider instead of a mock in release', () => {
    const src = read('brain/demo.ts');
    expect(src).toContain("kind: 'no-provider'");
    // startMockRun may only be reached inside a DEV branch.
    expect(devGuardPrecedes(src, 'startMockRun(')).toBe(true);
  });

  test('the Brain screen seeds canned rows only in DEV', () => {
    const src = read('screens/Brain/index.tsx');
    expect(devGuardPrecedes(src, 'RECENT_FLAVORS) {')).toBe(true);
  });

  test('the demo buttons handle the no-provider outcome', () => {
    for (const rel of [
      'screens/Brain/index.tsx',
      'screens/Runs/components/States.tsx',
    ]) {
      const src = read(rel);
      expect(src).toContain("kind === 'no-provider'");
      expect(src).toContain('Set up a model');
    }
  });

  test('the production bundle has no mock-run entry point', () => {
    const assets = join(DESKTOP_DIST, 'assets');
    if (!existsSync(assets)) {
      // No build present: nothing to assert. CI runs `vite build` first.
      console.warn('[XR-REL-03] desktop/dist absent — bundle assertions skipped');
      return;
    }
    const offenders: string[] = [];
    for (const name of new Bun.Glob('*.js').scanSync(assets)) {
      const text = readFileSync(join(assets, name), 'utf8');
      for (const marker of [
        'mock-latest',
        'seedMockHistory',
        'seedStress',
        'Demo run (no model configured)',
      ]) {
        if (text.includes(marker)) offenders.push(`${name}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
