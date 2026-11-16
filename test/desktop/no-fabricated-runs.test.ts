/*
 * XR-REL-03 — a release build never fabricates a run.
 *
 * Originally the Control Room / Brain could render a fully populated trace
 * (spans, tokens, dollars, tool calls, logs) for a run that never happened:
 * `loadRun` rebuilt ANY unknown id from a deterministic mock script, the demo
 * button fell back to a canned trace when no provider answered, and "Recent
 * runs" appended scripted rows.
 *
 * This test pins the GUARANTEE, not one particular mechanism, because two
 * independent fixes landed for it: this branch made every scripted path
 * `import.meta.env.DEV`-gated, and `main` (T03.b) deleted the fixtures from the
 * screens outright and filtered history to `source === 'engine'`
 * (`@/brain/recent`). Both are correct; either must keep all five properties
 * below true.
 *
 *   1. no scripted path is reachable in a release build;
 *   2. `startMockRun` cannot mint a run outside DEV;
 *   3. history shown to the user is observed engine runs only;
 *   4. a demo with no provider is an explained dead end, not a fake run;
 *   5. the production bundle carries no mock marker at all.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..');
const DESKTOP_SRC = join(REPO, 'desktop', 'src');
const DESKTOP_DIST = join(REPO, 'desktop', 'dist');

const read = (rel: string): string => readFileSync(join(DESKTOP_SRC, rel), 'utf8');

describe('XR-REL-03 · the mock run engine is development-only', () => {
  test('loadRun will not rebuild a scripted trace outside DEV', () => {
    const src = read('stores/brainStore.ts');
    const at = src.indexOf('loadRun: async');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 3000);
    // Whatever the mechanism, a release build must bail before scripting:
    // either an explicit DEV guard, or a source check that rejects non-engine
    // runs. Both are accepted because both are correct; silence is not.
    const guarded =
      body.includes('import.meta.env.DEV') ||
      body.includes("persisted.source !== 'engine'") ||
      body.includes("source === 'engine'");
    expect(guarded).toBe(true);
  });

  test('startMockRun cannot fabricate a run in a release build', () => {
    const src = read('stores/brainStore.ts');
    // The IMPLEMENTATION, not the interface declaration above it.
    const at = src.indexOf('startMockRun: (title, opts)');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 900);
    // Either it throws outside DEV or every caller is DEV-gated; the store must
    // not silently create `mock-latest-*` ids in a release binary.
    expect(body).toContain('import.meta.env.DEV');
  });

  test('history shown to the user is observed engine runs only', () => {
    const src = read('screens/Brain/index.tsx');
    // The screen must not carry a canned row set at all (main) or must gate it
    // behind DEV (this branch).
    const hasCanned = src.includes('RECENT_FLAVORS');
    if (hasCanned) {
      const guard = src.indexOf('import.meta.env.DEV');
      expect(guard).toBeGreaterThan(-1);
    } else {
      // main's shape: history comes from a filter that requires source=engine.
      expect(src).toContain('realRecentRuns');
    }
    const filter = read('brain/recent.ts');
    expect(filter).toContain("r.source !== 'engine'");
  });

  test('a demo with no provider is an explained dead end, never a fake run', () => {
    const demo = read('brain/demo.ts');
    // main returns null; this branch returns a typed no-provider outcome.
    expect(demo).toMatch(/return null|'no-provider'/);
    for (const rel of ['screens/Brain/index.tsx', 'screens/Runs/components/States.tsx']) {
      const src = read(rel);
      // The user must be told why, not left with a dead button.
      expect(src).toMatch(/configure a provider|No model configured|Add a cloud key|start a local runtime/i);
    }
  });

  test('the production bundle has no mock-run marker', () => {
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
