/*
 * Budget › Models — no fabrication, engine-derived truth (AUD-002/003/005).
 *
 * The tab used to ship three invented experiences: "Test model" reported a
 * `Math.random()` latency with a toast admitting "mock round-trip";
 * downloading a local model in a browser waited 900 ms and marked it
 * installed; the provider dropdown was a hardcoded five-entry subset while
 * the engine offers 26 presets + custom endpoints. These structural tests
 * pin the honest replacements.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('Budget › Models — Test model is not fabricated', () => {
  const tab = read('screens/Budget/components/ModelsTab.tsx');

  test('local models are tested through the engine round trip', () => {
    expect(tab).toContain("pingEngineLocalModel('ollama', m.id)");
  });

  test('no random or timer-based latency is reported as a result', () => {
    expect(tab).not.toContain('Math.random()');
    expect(tab).not.toContain('mock round-trip');
    expect(tab).not.toMatch(/setTimeout\(\s*\(\) => \{\s*setTesting\(null\)/);
  });

  test('hosted models get an honest “no live probe” answer', () => {
    expect(tab).toContain('No live probe for hosted models');
  });
});

describe('Budget › Models — Downloads never mark anything installed on a timer', () => {
  const tab = read('screens/Budget/components/ModelsTab.tsx');

  test('the browser path errors out instead of installing', () => {
    expect(tab).toContain('Downloads run in the desktop app');
    expect(tab).not.toContain('window.setTimeout(r, 900)');
  });

  test('installLocal is only called from the engine-confirmed success path', () => {
    const installs = tab.split('installLocal(').length - 1;
    // one occurrence inside download() guarded by status === 'success'
    expect(installs).toBe(1);
    expect(tab).toMatch(/progress\.status === 'success'\)\s*finish\(true\)/);
    expect(tab).toMatch(/finish = \(ok: boolean/);
    // failure path must not install
    const failBranch = tab.slice(tab.indexOf("} else {\n          toast.error(`Could not download"));
    expect(failBranch).not.toContain('installLocal');
  });

  test('ollama progress errors surface as failures', () => {
    expect(tab).toMatch(/progress\.status === 'error'/);
  });
});

describe('Budget › Models — provider truth comes from the engine', () => {
  const tab = read('screens/Budget/components/ModelsTab.tsx');

  test('no hardcoded provider subset remains', () => {
    expect(tab).not.toContain('PROVIDER_ENTRIES');
    expect(tab).toContain('buildProviderCatalog(engineProviders)');
  });

  test('the configured list derives from the engine snapshot', () => {
    expect(tab).toContain('p.hasKey');
    expect(tab).toContain('p.id === enginePrimary');
    expect(tab).toContain("keyStorage: p.hasKey ? 'engine' : 'none'");
  });

  test('the mirror is only mutated through the local settings copy', () => {
    expect(tab).toMatch(/localMirror\.find/);
    expect(tab).not.toMatch(/const prev = providers\.find/);
  });

  test('the engine-unreachable catalog fallback is flagged, not silent', () => {
    expect(tab).toContain('catalog.degraded');
    expect(tab).toContain('Engine unreachable');
  });
});

describe('engineKnowsProvider fails closed', () => {
  const providers = read('engine/providers.ts');

  test('an unanswered engine vouches for no provider', () => {
    const fn = providers.slice(providers.indexOf('export function engineKnowsProvider'));
    expect(fn.slice(0, 400)).toContain('if (!list) return false');
  });
});

describe('Dead desktop-local default-model controls were removed (AUD-003)', () => {
  test('Settings → Models no longer renders capability default selects', () => {
    const tab = read('screens/Settings/tabs/ModelsTab.tsx');
    expect(tab).not.toContain('models.defaults[');
    expect(tab).not.toContain('CAPABILITIES');
    expect(tab).not.toContain('<SettingsSection title="Default models">');
  });

  test('Settings → General no longer writes settings.defaults.model/fallbackModel', () => {
    const tab = read('screens/Settings/tabs/GeneralTab.tsx');
    expect(tab).not.toContain('settings.defaults.model');
    expect(tab).not.toContain('fallbackModel');
    expect(tab).not.toContain('xr-default-model');
    expect(tab).not.toContain('xr-fallback-model');
  });
});

describe('Onboarding completion is honest about what was verified (AUD-004)', () => {
  const allSet = read('screens/Onboarding/StepAllSet.tsx');

  test('the all-set screen renders a truthful completion summary', () => {
    expect(allSet).toContain('onboarding-completion-summary');
    expect(allSet).toContain('isEngineUsable');
    expect(allSet).toContain('Engine not reachable');
    expect(allSet).toContain('Guest mode');
  });

  test('completion still depends on the engine-acknowledged key save', () => {
    const onboarding = read('stores/onboarding.ts');
    // finishOnboarding throws (and never writes complete=true) when the key
    // save was not confirmed — the all-set screen is unreachable in that case.
    const finish = onboarding.slice(onboarding.indexOf('finishOnboarding'));
    expect(finish.indexOf('writeSettingJSON(ONBOARDING_KEY, true)')).toBeGreaterThan(
      finish.indexOf('prepareModelSetup')
    );
  });
});
