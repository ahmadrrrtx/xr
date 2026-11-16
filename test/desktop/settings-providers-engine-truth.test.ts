/*
 * S-6 — "configured providers" is an engine fact, not a desktop opinion.
 *
 * Settings → Models read the list from `settings.models.providers`, which
 * initialises to `[]` and is only ever written by that same screen's own
 * add/remove. A provider configured in the onboarding wizard, added as a custom
 * endpoint, or present before a reinstall therefore rendered as "No providers
 * configured yet." while the engine was happily using it — two sources of truth
 * for one question, and the desktop held the wrong one.
 *
 * The list now derives from GET /providers (hasKey + the primary/local
 * selection), and the local settings object only carries presentation the
 * engine does not own: when the row was added and the last connection test.
 *
 * These are structural tests on purpose: the defect is "which object does this
 * screen read", and that question is answered by the source, not by mounting
 * the component.
 */
import { describe, expect, test } from 'bun:test';
import { configuredProviderRows } from '../../desktop/src/engine/providerCatalog.ts';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = join(resolve(import.meta.dir, '..', '..'), 'desktop', 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('S-6 · ModelsTab reads the engine, not a local mirror', () => {
  const tab = read('screens/Settings/tabs/ModelsTab.tsx');

  test('the configured list is derived from the engine provider snapshot', () => {
    expect(tab).toContain('engineProviders');
    expect(tab).toMatch(/const providers = useMemo<ProviderConfig\[\]>/);
    // The old direct read is what showed an empty list.
    expect(tab).not.toMatch(/const providers = models\.providers;/);
  });

  test('a provider with a key is configured even with no local entry', () => {
    expect(tab).toContain('configuredProviderRows(engineProviders ?? [], enginePrimary)');
    const rows = configuredProviderRows([
      { id: 'keyed', label: 'Keyed', kind: 'cloud', hasKey: true, healthy: false },
      { id: 'local', label: 'Local', kind: 'local', hasKey: false, healthy: false },
      { id: 'unset', label: 'Unset', kind: 'cloud', hasKey: false, healthy: false },
    ], 'local');
    expect(rows.map(p => p.id)).toEqual(['keyed', 'local']);
  });

  test('the row status comes from the engine verdict before any local note', () => {
    expect(tab).toContain('healthState');
    expect(tab).toContain('checkedAt');
  });

  test('key location is reported from the engine, never guessed', () => {
    expect(tab).toContain("keyStorage: p.hasKey ? 'engine' : 'none'");
    // The insecure-store scan still only fires on real local-insecure entries.
    expect(tab).toContain("provider.keyStorage === 'local-insecure'");
  });

  test('"no providers" is not claimed while the engine has not answered yet', () => {
    expect(tab).toContain('Waiting for the engine');
    expect(tab).toMatch(/engineIssue[\s\S]{0,200}No providers configured yet/);
  });

  test('desktopKind stays private — a `use*`-free export keeps the hook lint quiet', () => {
    const catalog = read('engine/providerCatalog.ts');
    // `export function desktopKind` would read as a hook in some configs; the
    // exported wrapper is deliberately named for what it returns.
    expect(catalog).toContain('export function desktopKindFor');
    expect(catalog).not.toMatch(/export function desktopKind\(/);
  });
});

describe('S-6 · the engine shape the list relies on', () => {
  test('hasKey and healthState are part of the provider contract', () => {
    const types = read('engine/types.ts');
    const provider = types.slice(types.indexOf('interface EngineProvider'));
    expect(provider.slice(0, 1500)).toContain('hasKey: boolean');
    expect(provider.slice(0, 1500)).toContain('healthState?');
  });
});
