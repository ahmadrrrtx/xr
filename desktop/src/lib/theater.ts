/*
 * Voice Theater bridge (Phase 16) — the orb.ts pattern, plus one event bus
 * that both windows share.
 *
 * Who calls what:
 *   MAIN window     → theaterOpen/Close/Toggle (settings, hotkey, orb menu,
 *                     mic button), theaterBus.emit(voice:*) from theaterLink
 *   THEATER window  → theaterBus.emit(theater:*), theaterStartDrag,
 *                     theaterShowContextMenu, theaterSetAlwaysOnTop
 *
 * Transport: Tauri events inside the shell; a BroadcastChannel in the plain
 * browser so `/theater.html` can be opened as a second tab and driven by the
 * main tab (that is also how the Playwright screenshots are made).
 */
import { THEATER_CHANNEL, THEATER_OUT } from '@/lib/theaterCore';
import { isTauri } from '@/lib/tauri';

export const THEATER_WINDOW_LABEL = 'theater';
/** Browser dev stand-in for the native window. */
const BROWSER_WINDOW_NAME = 'xr-theater';

async function invokeTheater<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/* ── Window lifecycle (main window) ─────────────────────────────────── */

let browserWindow: Window | null = null;

/** Open (or focus) the theater. In the browser: a popup on `/theater.html`. */
export async function theaterOpen(): Promise<void> {
  if (isTauri()) {
    await invokeTheater<void>('theater_open');
    return;
  }
  if (browserWindow && !browserWindow.closed) {
    browserWindow.focus();
    return;
  }
  browserWindow = window.open('/theater.html', BROWSER_WINDOW_NAME, 'width=900,height=700');
}

export async function theaterClose(): Promise<void> {
  if (isTauri()) {
    await invokeTheater<void>('theater_close');
    return;
  }
  if (browserWindow && !browserWindow.closed) browserWindow.close();
  browserWindow = null;
}

export async function theaterToggle(): Promise<void> {
  if (isTauri()) {
    await invokeTheater<void>('theater_toggle');
    return;
  }
  if (browserWindow && !browserWindow.closed) await theaterClose();
  else await theaterOpen();
}

export async function theaterIsOpen(): Promise<boolean> {
  if (isTauri()) return (await invokeTheater<boolean>('theater_is_open')) ?? false;
  return browserWindow !== null && !browserWindow.closed;
}

/* ── Theater-window helpers ─────────────────────────────────────────── */

/** True when this bundle runs inside the theater webview (or the dev tab). */
export function isTheaterWindow(): boolean {
  return window.location.pathname.endsWith('/theater.html');
}

export async function theaterStartDrag(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().startDragging();
}

export async function theaterShowContextMenu(): Promise<void> {
  await invokeTheater<void>('theater_show_context_menu');
}

export async function theaterSetAlwaysOnTop(on: boolean): Promise<void> {
  await invokeTheater<void>('theater_set_always_on_top', { on });
}

/**
 * Native window ops the stage buttons need. Closing in the shell goes through
 * Rust's CloseRequested (bounds memory + `theater:close` to main); the browser
 * tab has no shell, so it announces the close itself.
 */
export async function theaterWindowOp(op: 'minimize' | 'close' | 'toggle-maximize'): Promise<void> {
  if (!isTauri()) {
    if (op === 'close') {
      emitTheater(THEATER_OUT.close);
      window.close();
    }
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const current = getCurrentWindow();
  if (op === 'minimize') await current.minimize();
  else if (op === 'close') await current.close();
  else await current.toggleMaximize();
}

export async function theaterSetFullscreen(on: boolean): Promise<void> {
  if (!isTauri()) {
    try {
      if (on) await document.documentElement.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* browser refused (no user gesture) — the stage keeps its own flag */
    }
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on);
}

export async function theaterIsFullscreen(): Promise<boolean> {
  if (!isTauri()) return document.fullscreenElement !== null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow().isFullscreen();
}

/* ── Event bus ──────────────────────────────────────────────────────── */

type Handler = (payload: unknown) => void;

let channel: BroadcastChannel | null = null;
const browserHandlers = new Map<string, Set<Handler>>();

function browserChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(THEATER_CHANNEL);
    channel.onmessage = (event: MessageEvent<{ name?: string; payload?: unknown }>) => {
      const name = event.data?.name;
      if (!name) return;
      browserHandlers.get(name)?.forEach((handler) => handler(event.data.payload));
    };
  }
  return channel;
}

/**
 * Fire-and-forget cross-window event. Tauri: app-wide `emit` (every window,
 * including the sender). Browser: BroadcastChannel (other tabs only).
 */
export function emitTheater(name: string, payload?: unknown): void {
  if (isTauri()) {
    void import('@tauri-apps/api/event').then(({ emit }) => emit(name, payload)).catch(() => undefined);
    return;
  }
  browserChannel()?.postMessage({ name, payload });
}

/**
 * Subscribe to a cross-window event; returns a synchronous unsubscribe that
 * is safe to call before the async Tauri registration resolved.
 */
export function listenTheater(name: string, handler: Handler): () => void {
  if (isTauri()) {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void import('@tauri-apps/api/event')
      .then(({ listen }) => listen<unknown>(name, (event) => handler(event.payload)))
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }
  browserChannel();
  const set = browserHandlers.get(name) ?? new Set<Handler>();
  set.add(handler);
  browserHandlers.set(name, set);
  return () => {
    set.delete(handler);
  };
}
