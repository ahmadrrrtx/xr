/*
 * Typed bridge to the Phase 8 Rust commands (src-tauri/src/commands/settings.rs).
 * Every helper degrades to a harmless no-op/fallback in the plain browser
 * preview so the same bundle runs everywhere (lib/tauri.ts convention).
 */
import { isTauri } from '@/lib/tauri';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}

/* ── Cross-window broadcast ─────────────────────────────────────────── */

/** Tell the Rust host a settings group changed (broadcast to HUD + Orb). */
export async function settingsChanged(
  key: string,
  value: unknown
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('settings_changed', { key, value });
  } catch {
    /* broadcast is best-effort — never block the UI */
  }
}

/* ── Keychain (OS) ──────────────────────────────────────────────────── */

export type KeychainResult =
  | { status: 'ok'; secret: string | null }
  | { status: 'unavailable'; message: string };

export async function keychainGet(
  service: string,
  account: string
): Promise<KeychainResult> {
  if (!isTauri()) return { status: 'unavailable', message: 'browser' };
  try {
    const secret = await invoke<string | null>('keychain_get', {
      service,
      account,
    });
    return { status: 'ok', secret };
  } catch (message) {
    return { status: 'unavailable', message: String(message) };
  }
}

export async function keychainSet(
  service: string,
  account: string,
  secret: string
): Promise<KeychainResult> {
  if (!isTauri()) return { status: 'unavailable', message: 'browser' };
  try {
    await invoke('keychain_set', { service, account, secret });
    return { status: 'ok', secret };
  } catch (message) {
    return { status: 'unavailable', message: String(message) };
  }
}

export async function keychainDelete(
  service: string,
  account: string
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('keychain_delete', { service, account });
  } catch {
    /* deleting a missing entry is fine */
  }
}

/* ── Data folder / files ────────────────────────────────────────────── */

export async function revealDataFolder(): Promise<void> {
  if (!isTauri()) return;
  await invoke('reveal_data_folder').catch(() => undefined);
}

export async function revealPath(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('reveal_path', { path }).catch(() => undefined);
}

/** Open an external URL (http/https only — validated Rust-side too). */
export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_url', { url }).catch(() => undefined);
}

export interface StorageStats {
  conversations: number;
  attachments: number;
  models: number;
  cache: number;
  settings: number;
  total: number;
}

export async function storageStats(): Promise<StorageStats | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<StorageStats>('storage_stats');
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    return await invoke<number>('clear_cache');
  } catch {
    return 0;
  }
}

/** Zip the data dir; returns the chosen destination path or null (cancel). */
export async function exportAllData(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('export_all_data');
  } catch {
    return null;
  }
}

/** Pick a previously exported zip and restore it. True = restored. */
export async function importAllData(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('import_all_data');
  } catch {
    return false;
  }
}

/* ── Destructive / lifecycle ────────────────────────────────────────── */

/** Wipe settings (and optionally conversations) then restart. Never returns. */
export async function resetApp(wipeConversations: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke('reset_app', { wipeConversations }).catch(() => undefined);
}

export async function restartApp(): Promise<void> {
  if (!isTauri()) return;
  await invoke('restart_app').catch(() => undefined);
}

export async function setDevtoolsEnabled(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  await invoke('set_devtools_enabled', { enabled }).catch(() => undefined);
}

/* ── Autostart ──────────────────────────────────────────────────────── */

export async function getAutostart(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>('get_autostart');
  } catch {
    return false;
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke('set_autostart', { enabled });
    return true;
  } catch {
    return false;
  }
}

/* ── Providers ──────────────────────────────────────────────────────── */

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  models: string[];
}

export async function testProviderConnection(
  kind: string,
  baseUrl: string | null,
  apiKey: string | null
): Promise<ProviderTestResult | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ProviderTestResult>('test_provider_connection', {
      kind,
      baseUrl,
      apiKey,
    });
  } catch (message) {
    return { ok: false, message: String(message), latencyMs: 0, models: [] };
  }
}

/* ── Global shortcuts (runtime re-registration) ─────────────────────── */

export interface ShortcutRegistration {
  shortcut: string;
  conflict: boolean;
}

export async function hudSetShortcut(
  chord: string
): Promise<ShortcutRegistration | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ShortcutRegistration>('hud_set_shortcut', { chord });
  } catch {
    return null;
  }
}

export async function orbSetShortcut(
  chord: string
): Promise<ShortcutRegistration | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ShortcutRegistration>('orb_set_shortcut', { chord });
  } catch {
    return null;
  }
}

export async function pttSetShortcut(
  chord: string
): Promise<ShortcutRegistration | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<ShortcutRegistration>('ptt_set_shortcut', { chord });
  } catch {
    return null;
  }
}

export async function hudShortcutInfo(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<{ shortcut: string }>('hud_shortcut_info');
    return info?.shortcut ?? null;
  } catch {
    return null;
  }
}

export async function orbShortcutInfo(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('orb_shortcut_info');
  } catch {
    return null;
  }
}

export async function pttShortcutInfo(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<{ shortcut: string }>('ptt_shortcut_info');
    return info?.shortcut ?? null;
  } catch {
    return null;
  }
}

/* ── System / Ollama ────────────────────────────────────────────────── */

export interface SystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  cpuBrand: string;
  cpuCores: number;
  totalMemoryGb: number;
}

export async function detectSystem(): Promise<SystemInfo | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<SystemInfo>('detect_system');
  } catch {
    return null;
  }
}

export interface OllamaModelInfo {
  name: string;
  sizeGb: number;
}

export interface OllamaInfo {
  installed: boolean;
  version: string | null;
  models: OllamaModelInfo[];
}

export async function ollamaDetect(): Promise<OllamaInfo> {
  if (!isTauri()) return { installed: false, version: null, models: [] };
  try {
    return await invoke<OllamaInfo>('detect_ollama');
  } catch {
    return { installed: false, version: null, models: [] };
  }
}

/**
 * Start an Ollama pull on a worker thread. Returns the pull id immediately;
 * progress flows over the `ollama://pull-progress` event, filtered by id.
 */
export async function ollamaPull(model: string): Promise<number> {
  if (!isTauri()) throw new Error('browser');
  return invoke<number>('ollama_pull', { model });
}

export interface PullProgressPayload {
  id: number;
  status: 'pulling' | 'verifying' | 'success' | 'error';
  completed: number | null;
  total: number | null;
  detail: string | null;
}

/* ── Data dir ───────────────────────────────────────────────────────── */

export async function getDataDir(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('get_data_dir');
  } catch {
    return null;
  }
}
