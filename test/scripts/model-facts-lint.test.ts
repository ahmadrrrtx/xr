/*
 * XR-REL-07 — the model register is a claim surface, so gate 10 must FAIL on
 * drift, not merely report. The shipped register was dated 2026-10-26 while the
 * app priced calls from it, and three model ids were hardcoded as
 * "contract-tested" in capability.ts with no evidence in the register at all.
 */
import { describe, expect, test } from 'bun:test';

import {
  lintModelFacts,
  lintRepositoryModelFacts,
  type ModelFactsFile,
} from '../../scripts/model-facts-lint.ts';

const PRESETS = [
  { id: 'openai', knownModels: ['gpt-6.1-sol', 'gpt-6-astra'] },
  { id: 'ollama', knownModels: ['qwen3.5:9b'] },
];

function register(over: Partial<ModelFactsFile> = {}): ModelFactsFile {
  return {
    version: '2026-11-13.1',
    verifiedAt: '2026-11-13',
    staleAt: '2027-02-11T00:00:00Z',
    models: [
      {
        providerId: 'openai',
        modelId: 'gpt-6.1-sol',
        lifecycle: 'active',
        source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
        tools: true,
        contractTest: 'test/providers/governed-attempts.test.ts',
        price: { input: 1, output: 4, source: 'https://openai.com/pricing' },
      },
    ],
    ...over,
  };
}

const NOW = Date.parse('2026-11-13T12:00:00Z');
const reasons = (r: { violations: Array<{ reason: string }> }) =>
  r.violations.map((v) => v.reason).join(' | ');

describe('XR-REL-07 · model-facts gate', () => {
  test('a fresh, sourced register passes', () => {
    const r = lintModelFacts(register(), PRESETS, NOW);
    expect(r.violations).toHaveLength(0);
  });

  test('a register past staleAt FAILS, and says how long ago', () => {
    const r = lintModelFacts(
      register({ verifiedAt: '2026-10-26', staleAt: '2026-10-30T00:00:00Z' }),
      PRESETS,
      NOW
    );
    expect(r.violations.length).toBeGreaterThan(0);
    expect(reasons(r)).toContain('went stale');
    expect(reasons(r)).toContain('unverified claim');
  });

  test('staleAt that is not after verifiedAt FAILS', () => {
    const r = lintModelFacts(
      register({ verifiedAt: '2026-11-13', staleAt: '2026-11-01T00:00:00Z' }),
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('not after `verifiedAt`');
  });

  test('unparseable dates FAIL closed', () => {
    const r = lintModelFacts(
      register({ verifiedAt: 'soon', staleAt: 'later' }),
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('not a parseable date');
    expect(reasons(r)).toContain('not a parseable timestamp');
  });

  test('a duplicate model id FAILS (which facts win is undefined)', () => {
    const base = register();
    const r = lintModelFacts(
      { ...base, models: [...base.models, { ...base.models[0] }] },
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('appears twice');
  });

  test('a contract test claim must name a file that exists', () => {
    const base = register();
    const r = lintModelFacts(
      { ...base, models: [{ ...base.models[0], contractTest: 'test/does-not-exist.test.ts' }] },
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('does not exist');
  });

  test('a fact with no source FAILS', () => {
    const base = register();
    const r = lintModelFacts(
      { ...base, models: [{ ...base.models[0], source: undefined }] },
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('no `source`');
  });

  test('a price without its own source FAILS (a rate is a claim too)', () => {
    const base = register();
    const r = lintModelFacts(
      { ...base, models: [{ ...base.models[0], price: { input: 1, output: 2 } }] },
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('no `price.source`');
  });

  test('a non-positive context window FAILS', () => {
    const base = register();
    const r = lintModelFacts(
      { ...base, models: [{ ...base.models[0], contextWindow: 0 }] },
      PRESETS,
      NOW
    );
    expect(reasons(r)).toContain('non-positive contextWindow');
  });

  test('thin coverage is a NOTE, never a failure', () => {
    const r = lintModelFacts(register(), PRESETS, NOW);
    expect(r.coverage.catalogued).toBe(3);
    expect(r.coverage.documented).toBe(1);
    expect(r.violations).toHaveLength(0);
    expect(r.notes.join(' ')).toContain('thin');
  });

  test('the repository register itself passes its own gate today', async () => {
    const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
    const report = await lintRepositoryModelFacts(root);
    // If this fails the build is right to fail: re-verify the register.
    expect(report.violations).toEqual([]);
    // …and we surface how much of the catalogue is actually documented.
    expect(report.coverage.catalogued).toBeGreaterThan(0);
  });
});
