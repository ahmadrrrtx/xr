/*
 * native.ts — the shell's event surface, typed (Phase 27).
 *
 * The Rust host talks to the webview in five directions. Everything about them
 * lives here so there is exactly one place to look when an event "does not
 * arrive":
 *
 *   xr-tray-action        a tray item or a macOS menu item was chosen
 *   xr-global-screenshot  ⌘⇧X captured a region (or was cancelled)
 *   xr-update:*           the updater's state, progress and errors
 *   xr-os-theme           the OS switched appearance
 *   xr-crash-*            recovery decisions, and the dev crash simulation
 *
 * Every subscription is a no-op in a browser (Vite dev, previews, tests): the
 * same bundle runs inside the shell and on the web, and a missing shell must
 * never throw during mount. `listen` is imported lazily for that reason — the
 * Tauri event API is not even present in a plain browser.
 */
import { useCallback, useEffect, useRef } from 'react';
import { isTauri } from '@/lib/tauri';

// ─── Event names (single source of truth; the Rust side uses these strings) ──

export const SHELL_EVENTS = {
  /** `{ id }` — a tray or app-menu item, ids from `tray::ids`. */
  trayAction: 'xr-tray-action',
  /** `ScreenshotPayload` — path/tool/cancelled/error. */
  screenshot: 'xr-global-screenshot',
  /** `UpdateState` — full state after any updater operation. */
  updateState: 'xr-update:state',
  /** `DownloadProgress` — 0–100 while bytes arrive. */
  updateProgress: 'xr-update:progress',
  /** `{ theme, platform }` — the OS appearance changed. */
  osTheme: 'xr-os-theme',
  /** `RecoveryChoice` — the user answered the recovery screen. */
  crashResolved: 'xr-crash-resolved',
  /** none — the dev "simulate crash" fired (the process is about to die). */
  crashSimulated: 'xr-crash-simulated',
  /** `{ port }` — attached to a user-started engine. */
  engineAttached: 'xr-engine-attached',
} as const;

export type ShellEvent = (typeof SHELL_EVENTS)[keyof typeof SHELL_EVENTS];

// ─── Payload types (mirrors of the Rust serde structs) ──────────────────────

export type TrayActionId =
  | 'xr-open'
  | 'xr-new-chat'
  | 'xr-new-workspace'
  | 'xr-toggle-hud'
  | 'xr-toggle-listening'
  | 'xr-toggle-agents'
  | 'xr-approvals'
  | 'xr-spend'
  | 'xr-engine-status'
  | 'xr-settings'
  | 'xr-check-updates'
  | 'xr-quit'
  | 'xr-about'
  | 'xr-docs'
  | 'xr-report-crash'
  | 'xr-close-window'
  | 'xr-toggle-sidebar'
  | 'xr-palette'
  | 'xr-toggle-orb'
  | 'xr-developer-tools'
  | 'xr-reload-window'
  | 'xr-simulate-crash'
  | string;

export interface TrayAction {
  id: TrayActionId;
}

export interface ScreenshotPayload {
  path: string | null;
  tool: string;
  cancelled: boolean;
  error: string | null;
}

export type UpdateChannelValue = 'stable' | 'beta' | 'nightly';

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string;
  notesTruncated: boolean;
  date: string | null;
  releaseUrl: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

export interface UpdateState {
  provisioned: boolean;
  reason: string | null;
  channel: UpdateChannelValue;
  channelOptions: UpdateChannelValue[];
  autoDownload: boolean;
  currentVersion: string;
  available: AvailableUpdate | null;
  skippedVersion: string | null;
  downloading: boolean;
  progress: DownloadProgress | null;
  readyToInstall: boolean;
  lastCheckMs: number | null;
  error: string | null;
}

export interface OsThemeEvent {
  theme: 'light' | 'dark';
  platform: string;
}

export type RecoveryChoice = 'pending' | 'resume' | 'fresh' | 'withoutEngine';

export interface RecoveryInfo {
  interrupted: boolean;
  previousVersion: string | null;
  consecutiveInterruptions: number;
  engineSpawnFailed: boolean;
  currentVersion: string;
  logFiles: number;
  shellLogBytes: number | null;
  choice: RecoveryChoice;
  withoutLocalEngine: boolean;
  attachedExternal: boolean;
  externalEngineListening: boolean;
  platform: string;
}

/** The tray's render state. Sent whole, because one of the five stores that
 *  feeds it changes at a time and a partial merge would race itself. */
export interface TraySnapshot {
  approvals: number;
  spendToday: number | null;
  agentsPaused: boolean;
  listening: boolean;
  engineUp: boolean;
  voiceAvailable: boolean;
}

// ─── Subscription ───────────────────────────────────────────────────────────

/**
 * Subscribe to one shell event. Returns an unsubscribe function; never throws,
 * even outside the shell. `handler` may be inline — the wrapper keeps a stable
 * listener and calls the latest handler, so a re-render does not drop events.
 */
export function onShellEvent<T>(
  event: ShellEvent,
  handler: (payload: T) => void
): () => void {
  if (!isTauri()) return () => {};
  let cancelled = false;
  let unlisten: (() => void) | null = null;

  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<T>(event, (message) => handler(message.payload));
      if (cancelled) stop();
      else unlisten = stop;
    } catch {
      // The shell is not available; the subscription quietly does nothing.
    }
  })();

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** React binding for [`onShellEvent`] — stable across renders. */
export function useShellEvent<T>(event: ShellEvent, handler: (payload: T) => void): void {
  const latest = useRef(handler);
  // The ref is refreshed in an effect, not during render: React 19's lint rules
  // (react-hooks/refs) forbid ref writes in render, and this ordering is what
  // they want anyway — the listener always calls the handler from the latest
  // committed render.
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => onShellEvent<T>(event, (payload) => latest.current(payload)), [event]);
}

/** Re-subscribing to a changing event name (the tray feed's five stores, say). */
export function useShellEvents<T>(
  events: readonly ShellEvent[],
  handler: (event: ShellEvent, payload: T) => void
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = events.join('|');
  useEffect(() => {
    const stops = events.map((event) =>
      onShellEvent<T>(event, (payload) => latest.current(event, payload))
    );
    return () => stops.forEach((stop) => stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the identity of `events`
  }, [key]);
}

/** A stable callback that sends a tray-action event to the host (if any). */
export function useTrayActionPublisher(): (snapshot: TraySnapshot) => void {
  return useCallback((snapshot: TraySnapshot) => {
    if (!isTauri()) return;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('tray_update_state', { snapshot });
      } catch {
        // Older shells without the command: the tray simply shows less.
      }
    })();
  }, []);
}
