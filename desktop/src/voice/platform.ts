/*
 * Native helpers for voice (Phase 15) — no-ops in the browser preview.
 */
import { isTauri } from '@/lib/tauri';

/** Open the OS microphone privacy pane (macOS / Windows); false elsewhere. */
export async function openMicrophoneSettings(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_microphone_settings');
    return true;
  } catch {
    return false;
  }
}

