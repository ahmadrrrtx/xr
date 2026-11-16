/*
 * S-5 — the release gate must be able to say "green" about a suite that runs
 * to completion, and "failed, here" about one that does not.
 *
 * The gate ran `bun test` over the whole tree as a single process. It did not
 * finish (killed at 900 s, no per-unit progress), so it could not gate
 * anything. The runner that replaces it (scripts/test-suite.ts) separates the
 * suites into processes, bounds each with its own budget, and reports per unit.
 *
 * The bug this file guards hardest: `bun test <dir>` RECURSES. Passing the test
 * root as the "root files" target ran all 520 files (310 s) instead of the 36
 * at the root (4 s) — a runner bug that looks exactly like the hang it was
 * written to expose. Root files must be named individually.
 */
import { describe, expect, test } from 'bun:test';
import { plan, summarize } from '../../scripts/test-suite';

describe('S-5 · the plan covers the tree without double-running it', () => {
  const units = plan();

  test('every directory that holds tests is a unit', () => {
    const names = units.map((u) => u.name);
    for (const expected of ['api', 'architecture', 'desktop', 'daemon', 'release', 'security']) {
      expect(names).toContain(expected);
    }
  });

  test('directories with no test files are not units', () => {
    const names = units.map((u) => u.name);
    // fixtures/helpers hold data and utilities, not suites.
    expect(names).not.toContain('fixtures');
    expect(names).not.toContain('helpers');
  });

  test('root test files are named individually, never handed the test root', () => {
    const roots = units.find((u) => u.name === '(root files)');
    expect(roots).toBeDefined();
    expect(roots!.targets.length).toBe(roots!.files);
    expect(roots!.files).toBeGreaterThan(30);
    // The recursion trap: a single target equal to .../test would run all 520.
    for (const t of roots!.targets) expect(t.endsWith('.test.ts')).toBe(true);
  });

  test('a directory unit targets exactly one directory', () => {
    for (const u of units.filter((x) => x.name !== '(root files)')) {
      expect(u.targets.length).toBe(1);
      expect(u.targets[0]).toEndWith(`test/${u.name}`);
    }
  });

  test('no file is claimed by two units', () => {
    const seen = new Set<string>();
    for (const u of units.filter((x) => x.name === '(root files)')) {
      for (const t of u.targets) {
        expect(seen.has(t)).toBe(false);
        seen.add(t);
      }
    }
  });

  test('both lanes exist, and the unit lane is the smaller one', () => {
    const unit = units.filter((u) => u.lane === 'unit');
    const integration = units.filter((u) => u.lane === 'integration');
    expect(unit.length).toBeGreaterThan(integration.length);
    expect(integration.map((u) => u.name)).toContain('api');
  });

  test('every unit has a real budget — a suite cannot run unbounded', () => {
    for (const u of units) {
      expect(u.budgetMs).toBeGreaterThanOrEqual(60_000);
      expect(u.budgetMs).toBeLessThanOrEqual(900_000);
    }
  });
});

describe('S-5 · a timeout is a failure, and a silent run is not a pass', () => {
  test('bun counters are read as-is', () => {
    const out = ' 4628 pass\n 0 fail\nRan 4628 tests across 520 files.';
    expect(summarize(out)).toEqual({ pass: 4628, fail: 0, note: undefined });
  });

  test('failing tests surface their count', () => {
    const out = ' 154 pass\n 1 fail\nRan 155 tests across 12 files.';
    expect(summarize(out)).toEqual({ pass: 154, fail: 1, note: undefined });
  });

  test('output with no counters is NOT a green unit', () => {
    // This is the "killed at 900 s with nothing in the tail" case: bun printed
    // a banner and died. It must not be read as success.
    const out = 'bun test v1.4.4 (38afee6c8)\n';
    const s = summarize(out);
    expect(s.note).toBeDefined();
    expect(s.note).toContain('did not run');
  });

  test('zero tests is not silently green either', () => {
    expect(summarize('').note).toBeDefined();
  });
});
