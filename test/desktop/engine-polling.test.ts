/*
 * XR-REL-05 — the engine link is polled for the whole app, not just the shell.
 *
 * The only `startPolling()` caller used to be `<EngineDownBanner/>`, which
 * lives inside the app shell. Everything before it — the splash, the
 * onboarding wizard — saw the store's initial `starting` with `providers: null`.
 * Onboarding step 4 reads exactly that, so it always rendered its hardcoded
 * five-provider fallback while the engine was up and serving 26.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DESKTOP_SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
const read = (rel: string): string => readFileSync(join(DESKTOP_SRC, rel), 'utf8');

describe('XR-REL-05 · engine polling starts at app boot', () => {
  test('App.tsx starts the engine poll before any route renders', () => {
    const src = read('App.tsx');
    expect(src).toContain('startPolling()');
    // It must be an effect in the App component (boot), not a route child.
    const effectAt = src.indexOf('useEngineStore.getState().startPolling()');
    const routerAt = src.indexOf('<RouterProvider');
    expect(effectAt).toBeGreaterThan(-1);
    expect(routerAt).toBeGreaterThan(-1);
    // The effect registration appears before the render tree in source order.
    expect(effectAt).toBeLessThan(src.lastIndexOf('<RouterProvider'));
  });

  test('onboarding no longer substitutes a hardcoded provider list', () => {
    const src = read('screens/Onboarding/StepModelSetup.tsx');
    // The five-vendor fallback is gone…
    for (const gone of [
      "label: 'Anthropic'",
      "label: 'Google Gemini'",
      "label: 'Groq'",
      "label: 'OpenRouter'",
    ]) {
      expect(src).not.toContain(gone);
    }
    // …replaced by explicit resolving / unavailable states.
    expect(src).toContain('setup-provider-loading');
    expect(src).toContain('setup-provider-unavailable');
    expect(src).toContain("engineStatus === 'starting'");
  });

  test('effectiveProviderId never invents a provider id', () => {
    const src = read('screens/Onboarding/StepModelSetup.tsx');
    expect(src).not.toContain("cloudProviders[0]?.id ?? 'openai'");
  });
});
