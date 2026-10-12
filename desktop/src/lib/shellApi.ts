/*
 * shellApi.ts — typed IPC for the Phase 27 shell commands.
 *
 * The rules `lib/settingsApi.ts` established, applied to the shell surface:
 *
 *   · every command returns `T | null` — a missing command (browser, older
 *     shell) is not an exception the UI has to catch;
 *   · no command ever returns a secret, and nothing here logs a payload;
 *   · types mirror the Rust serde structs exactly, so a field rename is a
 *     compile error on one side and a test failure on the other.
 */
import { isTauri } from '@/lib/tauri';
import type { RecoveryChoice, TraySnapshot, UpdateState } from '@/lib/native';

/** Invoke a host command, or resolve null where there is no host. */
export async function invokeShell<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

/* ── Recovery ─────────────────────────────────────────────────────────────── */

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

export interface ReportTicket {
  path: string;
  subject: string;
  bytes: number;
  preview: string;
  included: string[];
  mailto: string;
}

export function crashState(): Promise<RecoveryInfo | null> {
  return invokeShell<RecoveryInfo>('crash_state');
}

export function crashResolve(action: 'resume' | 'fresh'): Promise<RecoveryInfo | null> {
  return invokeShell<RecoveryInfo>('crash_resolve', { action });
}

export function crashStartWithoutEngine(): Promise<RecoveryInfo | null> {
  return invokeShell<RecoveryInfo>('crash_start_without_engine');
}

export function crashReport(): Promise<ReportTicket | null> {
  return invokeShell<ReportTicket>('crash_report');
}

/** Dev-only: mark the session dirty and exit(1). Refused outside dev builds. */
export function crashSimulate(): Promise<void | null> {
  return invokeShell<void>('crash_simulate');
}

/* ── Shortcuts ────────────────────────────────────────────────────────────── */

export interface ShortcutRow {
  id: 'hud' | 'orb' | 'ptt' | 'theater' | 'screenshot' | string;
  label: string;
  shortcut: string;
  fallbackUsed: boolean;
  conflict: boolean;
  defaultShortcut: string;
  canRebind: boolean;
  platformNote: string | null;
  noteAction: string | null;
}

/** What the OS actually holds for every global chord (one round trip). */
export function shellShortcutInventory(): Promise<ShortcutRow[] | null> {
  return invokeShell<ShortcutRow[]>('shell_shortcut_inventory');
}

/** Drop every override and re-register platform defaults. */
export function shellResetShortcuts(): Promise<ShortcutRow[] | null> {
  return invokeShell<ShortcutRow[]>('shell_reset_shortcuts');
}

/* ── Screenshot-and-ask ───────────────────────────────────────────────────── */

export interface CaptureSupport {
  available: boolean;
  tool: string | null;
  wayland: boolean;
  help: string | null;
}

export function screenshotSupport(): Promise<CaptureSupport | null> {
  return invokeShell<CaptureSupport>('screenshot_ask_support');
}

/** Capture a region now (tray item, Settings "Try it"). */
export function screenshotCapture(): Promise<{
  path: string | null;
  tool: string;
  cancelled: boolean;
  error: string | null;
} | null> {
  return invokeShell('screenshot_ask_capture');
}

/** Delete a capture once the message it belongs to exists. */
export function screenshotDiscard(path: string): Promise<boolean | null> {
  return invokeShell<boolean>('screenshot_ask_discard', { path });
}

/* ── Tray / theme ─────────────────────────────────────────────────────────── */

export function pushTrayState(snapshot: TraySnapshot): Promise<TraySnapshot | null> {
  return invokeShell<TraySnapshot>('tray_update_state', { snapshot });
}

export interface ThemeSnapshot {
  theme: 'light' | 'dark' | null;
  known: boolean;
  platform: string;
}

/** Current OS appearance, for first paint before any `xr-os-theme` event. */
export function subscribeOsTheme(): Promise<ThemeSnapshot | null> {
  return invokeShell<ThemeSnapshot>('subscribe_os_theme');
}

/* ── Updates (re-exported so the tab has one import) ──────────────────────── */

export type { UpdateState };
