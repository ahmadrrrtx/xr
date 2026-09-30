/*
 * Thin, typed bridge to the Tauri v2 host.
 *
 * Every helper degrades gracefully in a plain browser (Vite dev preview),
 * so the same bundle runs inside the native shell and on the web.
 */
import type { ThemeId } from '@/stores/theme';

/** True when running inside a Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export type Platform =
  'macos' | 'windows' | 'linux' | 'android' | 'ios' | 'web';

let cachedPlatform: Platform | null = null;

/**
 * Synchronous platform guess from the userAgent — accurate for the three
 * desktop OSes both inside Tauri (the webview UA carries the OS) and in a
 * plain browser. Never wrong enough to misplace window controls.
 */
export function detectPlatform(): Platform {
  if (cachedPlatform) return cachedPlatform;
  const ua = navigator.userAgent.toLowerCase();
  const guess: Platform = ua.includes('mac')
    ? 'macos'
    : ua.includes('win')
      ? 'windows'
      : ua.includes('linux')
        ? 'linux'
        : 'web';
  cachedPlatform = guess;
  return guess;
}

/**
 * Authoritative platform probe via `@tauri-apps/plugin-os` when hosted;
 * falls back to the userAgent in a browser. Cached after first resolution.
 */
export async function resolvePlatform(): Promise<Platform> {
  if (cachedPlatform && !isTauri()) return cachedPlatform;
  if (isTauri()) {
    try {
      const { platform } = await import('@tauri-apps/plugin-os');
      const p = await platform();
      const valid: readonly Platform[] = [
        'macos',
        'windows',
        'linux',
        'android',
        'ios',
      ];
      cachedPlatform = valid.includes(p as Platform)
        ? (p as Platform)
        : detectPlatform();
      return cachedPlatform;
    } catch {
      /* fall through to the userAgent guess */
    }
  }
  return detectPlatform();
}

async function invokeWindowCommand(command: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command);
}

export const minimizeWindow = (): Promise<void> =>
  invokeWindowCommand('minimize_window');

export const toggleMaximize = (): Promise<void> =>
  invokeWindowCommand('toggle_maximize');

export const closeWindow = (): Promise<void> =>
  invokeWindowCommand('close_window');

/** Notify the Rust host (tray/telemetry) that the theme changed. */
export async function emitThemeChanged(theme: ThemeId): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('theme_changed', { theme }).catch(() => {
    /* event is best-effort; never block the UI on it */
  });
}
