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
/** Raw URLs already handled this session (a cold-start URL can also arrive as an event). */
const handled = new Set<string>();

function deliver(urls: readonly string[] | null | undefined, onCallback: (cb: OAuthCallback) => void): void {
  for (const raw of urls ?? []) {
    if (handled.has(raw)) continue;
    const parsed = parseOAuthCallback(raw);
    if (!parsed) continue;
    handled.add(raw);
    if (handled.size > 64) handled.delete(handled.values().next().value as string);
    onCallback(parsed);
  }
}

/**
 * Subscribes once. Safe to call from app boot and again after a reload.
 *
 * XR-LAUNCH-013: on Windows/Linux the browser hands the callback to a NEW
 * process; the Rust single-instance plugin (built with its `deep-link`
 * feature) forwards it to this running instance, where `onOpenUrl` fires.
 * When XR was NOT running, the callback URL is the one that launched it —
 * `getCurrent()` returns it (cold start). Both paths share one dedupe set.
 */
export async function registerOAuthCallbackListener(onCallback: (cb: OAuthCallback) => void): Promise<void> {
  if (registered) return;
  registered = true;
  if (!isTauri()) return;
  try {
    const plugin = await import('@tauri-apps/plugin-deep-link');
    await plugin.onOpenUrl((urls) => deliver(urls, onCallback));
    try {
      deliver(await plugin.getCurrent?.(), onCallback);
    } catch {
      // No launch URL (the normal case) or the platform cannot report one.
    }
  } catch {
    // Deep links unavailable (for example, an unsupported platform). The screen says so when a sign-in starts.
    registered = false;
  }
}
