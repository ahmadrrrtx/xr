/*
 * XR-REL-04 — "start without the local engine" must not be forever.
 *
 * The crash-recovery screen offers an escape hatch when the sidecar will not
 * boot. That choice used to be written to settings.json and honoured by every
 * later launch, and the only command that cleared it (`crash_detach_external`)
 * was never called by the desktop — so a user who clicked it once, or attached
 * to a hand-started engine once (whose token dies with that process), saw
 * "engine not connected" on every subsequent launch with no way back.
 *
 * These assertions are source-level because the behaviour lives in Rust and in
 * the IPC surface; the Rust side is unit-tested in
 * desktop/src-tauri/src/engine.rs (`detach_external_*`).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '..', '..');
const TAURI = join(REPO, 'desktop', 'src-tauri');

const rust = (rel: string): string => readFileSync(join(TAURI, rel), 'utf8');
const desktop = (rel: string): string =>
  readFileSync(join(REPO, 'desktop', 'src', rel), 'utf8');

describe('XR-REL-04 · the engine-skip preference is one-shot', () => {
  test('started_without_engine consumes the flag instead of only reading it', () => {
    const src = rust('src/commands/recovery.rs');
    const fn = src.slice(src.indexOf('pub fn started_without_engine'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('store.delete(KEY_WITHOUT_ENGINE)');
    expect(body).toContain('store.save()');
    // …and says so, so the next reader does not "restore" the old behaviour.
    expect(src).toContain('ONE-SHOT read');
  });

  test('engine_restart clears the flag and detaches an external link', () => {
    const src = rust('src/engine.rs');
    const fn = src.slice(src.indexOf('pub fn engine_restart'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('xr.engine.withoutLocal');
    expect(body).toContain('detach_external');
    expect(body).toContain('spawn_sidecar');
  });

  test('crash_detach_external actually re-spawns the local engine', () => {
    const src = rust('src/commands/recovery.rs');
    const fn = src.slice(src.indexOf('pub fn crash_detach_external'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('engine::detach_external');
    expect(body).toContain('engine::spawn_sidecar');
  });

  test('the desktop exposes the way back and it is ACL-granted', () => {
    const api = desktop('lib/shellApi.ts');
    expect(api).toContain('crash_detach_external');

    const tab = desktop('screens/Settings/tabs/DiagnosticsTab.tsx');
    expect(tab).toContain('crashDetachExternal');
    expect(tab).toContain('Use the local engine');

    const acl = JSON.parse(
      readFileSync(join(TAURI, 'capabilities', 'ipc-main.json'), 'utf8')
    ) as { permissions: unknown[] };
    const flat = JSON.stringify(acl.permissions);
    expect(flat).toContain('crash-detach-external');
  });

  test('the recovery screen no longer promises a control that did not exist', () => {
    const src = desktop('components/shell/CrashRecovery.tsx');
    // It used to say "You can attach to a running engine later in Settings."
    expect(src).not.toContain('You can attach to a running engine later in Settings.');
    expect(src).toContain('Use the local engine');
  });
});
