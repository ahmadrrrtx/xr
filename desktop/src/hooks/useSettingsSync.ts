/*
 * useSettingsSync (Phase 8) — one hook, every window. Loads the durable
 * settings into the store on mount and keeps them live across windows by
 * applying the Rust-broadcast `settings:changed` events (payload
 * `{ key, value }` — key is the settings group).
 *
 * Mounted once per window root: App (main), HudApp, OrbApp. Remote applies
 * never re-broadcast, so there is no echo loop.
 */
import { useEffect } from 'react';

import { isTauri } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settingsStore';

export function useSettingsSync(): void {
  useEffect(() => {
    void useSettingsStore.getState().load();
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let alive = true;
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<{ key: string; value: unknown }>(
        'settings:changed',
        (event) => {
          useSettingsStore.getState().applyRemote(event.payload.key, event.payload.value);
        }
      );
      if (!alive) {
        stop();
        return;
      }
      unlisten = stop;
    })();
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);
}
