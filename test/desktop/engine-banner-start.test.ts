/*
 * NEW-22: an engine that is down must be startable from where the user sees it.
 *
 * The owner's first Preview 5 launch honoured a leftover "start without the engine" choice from an earlier build
 * (one-shot since XR-REL-04). The banner read "Engine crashed. recovery: starting without the local engine" and
 * offered only Retry, which probes again and starts nothing. Start/Restart in the banner and in the chat's turn
 * error card required `endpoint.via === 'sidecar'`, which only a live, paired sidecar has, so in the packaged app
 * neither ever appeared while the engine was down. Settings → Diagnostics was the only way back.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  bannerCopy,
  canStartEngine,
  ENGINE_SKIPPED_REASON,
} from '../../desktop/src/components/engine/engineBanner.ts';

const REPO = resolve(import.meta.dir, '..', '..');
const read = (rel: string): string => readFileSync(join(REPO, rel), 'utf8');
const BOOT = 30_000;

describe('NEW-22 · Start is offered whenever the engine is down', () => {
  test('the packaged app always offers Start/Restart; a plain browser build cannot spawn anything', () => {
    expect(canStartEngine({ dev: false, tauri: true })).toBe(true);
    expect(canStartEngine({ dev: true, tauri: false })).toBe(true);
    expect(canStartEngine({ dev: false, tauri: false })).toBe(false);
  });

  test('neither the banner nor the chat error card gates Start on an existing pairing', () => {
    for (const file of [
      'desktop/src/components/engine/EngineDownBanner.tsx',
      'desktop/src/screens/Chat/components/TurnErrorCard.tsx',
    ]) {
      const src = read(file);
      const gate = src.split('\n').find((l) => l.includes('const canStart ='));
      expect({ file, gate: gate?.trim() }).toEqual({
        file,
        gate: "const canStart = canStartEngine({ dev: import.meta.env.DEV, tauri: isTauri() });",
      });
    }
  });
});

describe('NEW-22 · a deliberate skip is not reported as a crash', () => {
  test('the skip reason the shell reports reads "Engine not started", and says how to fix it', () => {
    const copy = bannerCopy('failed', 'crashed', ENGINE_SKIPPED_REASON, BOOT);
    expect(copy.title).toBe('Engine not started.');
    expect(copy.detail).toContain('Start it to chat');
    expect(copy.detail).not.toContain(ENGINE_SKIPPED_REASON);
  });

  test('a real spawn failure is still a crash, with the shell\'s reason', () => {
    const copy = bannerCopy('failed', 'crashed', 'spawn failed: Permission denied (os error 13)', BOOT);
    expect(copy).toEqual({ title: 'Engine crashed.', detail: 'spawn failed: Permission denied (os error 13)' });
    expect(bannerCopy('failed', 'timeout', null, BOOT).detail).toContain('No answer within 30 s.');
  });

  test('the skip reason is the exact literal the Rust shell passes to skip_spawn', () => {
    const lib = read('desktop/src-tauri/src/lib.rs');
    expect(lib).toContain(`engine::skip_spawn(&engine_setup, ${JSON.stringify(ENGINE_SKIPPED_REASON)});`);
  });
});
