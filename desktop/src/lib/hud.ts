/*
 * HUD window IPC bridge (Phase 5).
 *
 * Thin, typed wrappers around the Rust `hud_*` commands so palette code never
 * imports Tauri directly. Every helper degrades to a no-op in the browser
 * preview (there is no HUD window there — the shared palette still works
 * in-app against the router).
 */
import { isTauri } from '@/lib/tauri';

async function invokeHud<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Leave the HUD for a route in the main window (Rust shows+focuses main). */
export function hudNavigate(route: string): Promise<void> {
  return invokeHud<void>('hud_navigate', { route }).then(() => undefined);
}

/** Hide the HUD window (Escape / click-away from the HUD context). */
export function hudClose(): Promise<void> {
  return invokeHud<void>('hud_hide').then(() => undefined);
}

/** Run a main-window command from the HUD (e.g. `toggle-sidebar`). */
export function hudRunMainCommand(command: string): Promise<void> {
  return invokeHud<void>('hud_run_main_command', { command }).then(() => undefined);
}

/** Tell the main window its session sidebar is stale (HUD wrote chat data). */
export function hudNotifySessionsChanged(): Promise<void> {
  return invokeHud<void>('hud_notify_sessions_changed').then(() => undefined);
}

export interface HudShortcutInfo {
  shortcut: string;
  fallbackUsed: boolean;
  conflict: boolean;
}

/** What global shortcut actually registered (conflict warning in the palette). */
export function hudShortcutInfo(): Promise<HudShortcutInfo | null> {
  return invokeHud<HudShortcutInfo>('hud_shortcut_info');
}

/** True when this webview IS the HUD (hud.html entry). */
export function isHudWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.endsWith('/hud.html');
}
