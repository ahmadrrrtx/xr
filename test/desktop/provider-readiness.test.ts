/*
 * S-7 — "configured" must not mean "the last health probe succeeded".
 *
 * The engine reports `healthy: health?.ok ?? false` alongside a separate
 * `healthState` *because* that boolean is false when nothing has been probed.
 * Three desktop surfaces tested `p.healthy && (kind === 'local' || hasKey)`, so
 * a hosted provider with a saved key that had not been probed yet — the normal
 * state right after putting a key in — and an installed, running local runtime
 * both rendered as "no model configured".
 *
 * This is the regression test for the affirmative direction, and equally for
 * the one thing that must NOT loosen: a provider the engine probed and found
 * unreachable stays unusable.
 */
import { describe, expect, test } from 'bun:test';
import {
  hasUsableProvider,
  localRuntimeUsable,
  providerIsUsable,
} from '../../desktop/src/engine/providerReadiness';
import type { EngineProvider } from '../../desktop/src/engine/types';

function provider(over: Partial<EngineProvider>): EngineProvider {
  return {
    id: 'p',
    label: 'P',
    kind: 'hosted',
    hasKey: false,
    healthy: false,
    ...over,
  } as EngineProvider;
}

describe('S-7 · providerIsUsable', () => {
  test('a saved key with no probe yet is usable', () => {
    // hasKey true, healthState 'unknown', healthy false — the case that broke.
    expect(providerIsUsable(provider({ hasKey: true, healthState: 'unknown', healthy: false }))).toBe(true);
  });

  test('an unprobed local preset is not evidence of installation', () => {
    expect(providerIsUsable(provider({ kind: 'local', hasKey: false, healthState: 'unknown' }))).toBe(false);
  });

  test('a probed-and-reachable provider is usable — no key needed to prove it', () => {
    expect(providerIsUsable(provider({ hasKey: false, healthState: 'reachable', healthy: true }))).toBe(true);
  });

  test('a probed-and-unreachable provider is NOT usable, keyed or local or not', () => {
    // The observation outranks the credentials: refusing here is the point.
    expect(providerIsUsable(provider({ hasKey: true, healthState: 'unreachable', healthy: false }))).toBe(false);
    expect(providerIsUsable(provider({ kind: 'local', hasKey: true, healthState: 'unreachable' }))).toBe(false);
  });

  test('a keyless hosted provider that was never probed is not usable', () => {
    expect(providerIsUsable(provider({ kind: 'hosted', hasKey: false, healthState: 'unknown' }))).toBe(false);
    expect(providerIsUsable(provider({ kind: 'custom', hasKey: false }))).toBe(false);
  });

  test('a legacy row with no healthState at all still follows its credentials', () => {
    // Older engines send `healthy` only; `undefined` healthState must not read
    // as "unreachable", or every legacy row would vanish.
    expect(providerIsUsable(provider({ hasKey: true, healthy: true }))).toBe(true);
    expect(providerIsUsable(provider({ kind: 'local', healthy: false }))).toBe(false);
    expect(providerIsUsable(provider({ kind: 'local', healthy: true }))).toBe(true);
  });
});

describe('S-7 · hasUsableProvider', () => {
  test('one usable provider among many configured-but-unprobed is enough', () => {
    const list = [
      provider({ id: 'openai', hasKey: false, healthState: 'unknown' }),
      provider({ id: 'ollama', kind: 'local', healthState: 'unknown' }),
      provider({ id: 'configured', hasKey: true, healthState: 'unknown' }),
      provider({ id: 'anthropic', hasKey: true, healthState: 'unreachable' }),
    ];
    expect(hasUsableProvider(list)).toBe(true);
  });

  test('an empty or missing list is false, never an optimistic true', () => {
    expect(hasUsableProvider([])).toBe(false);
    expect(hasUsableProvider(null)).toBe(false);
    expect(hasUsableProvider(undefined)).toBe(false);
  });
});

describe('S-7 · localRuntimeUsable', () => {
  test('installed and running counts even when the provider row said otherwise', () => {
    const current = { id: 'ollama', installed: true, running: true, models: [{ name: 'qwen2.5:3b' }] } as never;
    expect(localRuntimeUsable(current)).toBe(true);
  });

  test('installed but stopped is not running', () => {
    expect(localRuntimeUsable({ id: 'ollama', installed: true, running: false } as never)).toBe(false);
    expect(localRuntimeUsable({ id: 'ollama', installed: false, running: true } as never)).toBe(false);
    expect(localRuntimeUsable(null)).toBe(false);
  });
});

describe('S-7 · every surface uses the one predicate', () => {
  const files = [
    'stores/engineStore.ts',
    'brain/demo.ts',
    'screens/Brain/index.tsx',
    'screens/Settings/tabs/DiagnosticsTab.tsx',
  ];

  test('no surface still hand-rolls the healthy-based check', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      expect(text).not.toContain('x.healthy && (x.kind');
      expect(text).not.toContain('p.healthy && (p.kind');
      expect(text).toContain('providerReadiness');
    }
  });
});
