/*
 * XR-REL-06 — the model picker tells the truth about why a model is greyed out.
 *
 * Two distinct defects met here:
 *
 *  1. Opening the picker called `loadCatalog()` WITHOUT `discoverLocal`, so the
 *     engine never probed its local runtimes. Every local model then rendered
 *     as "not discovered" and was unclickable even when the runtime was
 *     installed and healthy — the "models are all greyed out" report.
 *  2. A provider with a SAVED key but an unverified probe also rendered as
 *     "Configure API key", which is simply false; the key is what was stored.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('XR-REL-06 · model picker', () => {
  const picker = read('screens/Chat/components/ModelPicker.tsx');

  test('opening the picker discovers local models', () => {
    // The open-effect must pass discoverLocal: true.
    const open = picker.slice(picker.indexOf('if (open)'), picker.indexOf('}, [open])'));
    expect(open).toContain('discoverLocal: true');
  });

  test('a saved-but-unverified provider is not described as missing a key', () => {
    expect(picker).toContain('providerHasKey');
    expect(picker).toContain('Key saved — not verified yet');
    // `hasKey` comes from the engine's provider snapshot, not a guess.
    expect(picker).toContain('.hasKey ?? false');
  });

  test('discovery is a real engine capability, not a local filter', () => {
    const store = read('stores/engineStore.ts');
    expect(store).toMatch(/loadCatalog[\s\S]{0,400}discoverLocal/);
  });
});

describe('XR-REL-06 · custom endpoints are reachable from the app', () => {
  test('onboarding offers an OpenAI-compatible endpoint path', () => {
    const step = read('screens/Onboarding/StepModelSetup.tsx');
    expect(step).toContain('Any OpenAI-compatible endpoint');
    expect(step).toContain('setup-custom-url');
    expect(step).toContain('setup-custom-model');
    expect(step).toContain('addCustomProviderToEngine');
    // Failure must surface the engine's own words (it names the refused range).
    expect(step).toContain('setup-custom-error');
  });

  test('the client helper targets the documented routes', () => {
    const providers = read('engine/providers.ts');
    expect(providers).toContain("'/providers/custom'");
    expect(providers).toContain("'/providers/custom/remove'");
    // A successful add must refresh the catalog, or the new models never appear.
    const add = providers.slice(providers.indexOf('addCustomProviderToEngine'));
    expect(add.slice(0, 900)).toContain('loadCatalog({ force: true })');
  });
});
