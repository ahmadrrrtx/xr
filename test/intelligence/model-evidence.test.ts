/*
 * XR-REL-07 — evidence about a model comes from the register, never from a
 * model-id list written into the code.
 *
 * `capability.ts` used to decide "contract-tested" like this:
 *
 *     compatible: fact && ["gpt-6.1-sol","claude-sonnet-5-5","gemini-3.8-flash"]
 *       .includes(modelId) ? "contract-tested" : "unknown"
 *
 * Three ids hardcoded as evidence — and when checked, only ONE of the three is
 * actually driven through a real adapter by a test. The other two appear in
 * tests only as ledger strings. A literal in a condition cannot be evidence,
 * so the register carries a `contractTest` path instead and the gate resolves
 * it (scripts/model-facts-lint.ts).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MODEL_FACTS, modelFact } from '../../src/core/model-registry.ts';

const REPO = resolve(import.meta.dir, '..', '..');

describe('XR-REL-07 · model evidence is data, not a literal list', () => {
  test('capability.ts contains no model-id evidence list', () => {
    const src = readFileSync(join(REPO, 'src/intelligence/capability.ts'), 'utf8');
    expect(src).not.toContain('"gpt-6.1-sol", "claude-sonnet-5-5", "gemini-3.8-flash"');
    // …and the verdict is read from the fact.
    expect(src).toContain('fact?.contractTest ? "contract-tested" : "unknown"');
    expect(src).toContain('agentValidated: fact?.agentValidated === true');
  });

  test('a "contract-tested" fact names a test file that exists', () => {
    const claimed = MODEL_FACTS.filter((f) => f.contractTest);
    expect(claimed.length).toBeGreaterThan(0);
    for (const f of claimed) {
      // Resolving the path is the whole point: a claim you cannot follow is a
      // claim you cannot check.
      const abs = join(REPO, f.contractTest!);
      expect(() => readFileSync(abs)).not.toThrow();
    }
  });

  test('agent validation is never implied by documentation', () => {
    // Nothing in the register claims an end-to-end validated agent run today.
    // If that changes, it must be a deliberate edit with evidence, not a default.
    for (const f of MODEL_FACTS) {
      if (f.agentValidated) {
        expect(f.notes?.length ?? 0).toBeGreaterThan(0);
      }
    }
    // And the ONLY model that claims adapter coverage is the one the test
    // really exercises.
    const tested = MODEL_FACTS.filter((f) => f.contractTest);
    expect(tested.map((f) => `${f.providerId}/${f.modelId}`)).toEqual([
      'openai/gpt-6.1-sol',
    ]);
  });

  test('the register is dated and in date', () => {
    const raw = JSON.parse(
      readFileSync(join(REPO, 'src/core/model-facts.json'), 'utf8')
    ) as { verifiedAt: string; staleAt: string; version: string };
    const verified = Date.parse(raw.verifiedAt);
    const stale = Date.parse(raw.staleAt);
    expect(Number.isFinite(verified)).toBe(true);
    expect(Number.isFinite(stale)).toBe(true);
    expect(stale).toBeGreaterThan(verified);
    // The shipped register must not already be stale on the day it ships.
    expect(Date.now()).toBeLessThan(stale);
    expect(raw.version).toMatch(/^\d{4}-\d{2}-\d{2}(\.\d+)?$/);
  });

  test('facts that exist carry a source, and prices carry their own', () => {
    for (const f of MODEL_FACTS) {
      expect(f.source).toBeTruthy();
      if (f.price) expect(f.price.source).toBeTruthy();
    }
  });

  test('an unknown model yields no fact — and therefore no verified claim', () => {
    expect(modelFact('openai', 'not-a-real-model')).toBeUndefined();
    expect(modelFact('openai', 'gpt-6.1-sol')?.contractTest).toBe(
      'test/providers/governed-attempts.test.ts'
    );
  });
});
