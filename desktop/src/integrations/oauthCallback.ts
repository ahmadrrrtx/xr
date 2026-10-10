/*
 * Integrations (Phase 22) — the xr://oauth/callback listener.
 *
 * The Tauri deep-link plugin (already initialised in src-tauri/src/lib.rs, scheme
 * `xr` in tauri.conf.json) delivers opened URLs to JavaScript. Only the callback
 * path is accepted. The code and state go to the engine, which checks the state
 * and does the token exchange; the renderer never sees a token.
 *
 * The listener registers once per app session, so a reload or a re-render cannot
 * stack listeners and run the same sign-in twice.
 */
import { isTauri } from '@/lib/tauri';
import { parseOAuthCallback, type OAuthCallback } from './core';

export { parseOAuthCallback, type OAuthCallback };

let registered = false;

/** Subscribes once. Safe to call from app boot and again after a reload. */
export async function registerOAuthCallbackListener(onCallback: (cb: OAuthCallback) => void): Promise<void> {
  if (registered) return;
  registered = true;
  if (!isTauri()) return;
  try {
    const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link');
    await onOpenUrl((urls) => {
      for (const raw of urls) {
        const parsed = parseOAuthCallback(raw);
        if (parsed) onCallback(parsed);
      }
    });
  } catch {
    // Deep links unavailable (for example, an unsupported platform). The screen says so when a sign-in starts.
    registered = false;
  }
}
