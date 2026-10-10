/*
 * Integrations (Phase 22) — open a provider page in the system browser.
 *
 * Uses the existing Rust `open_url` command (http/https only, validated Rust-side),
 * not the shell plugin. The shell permission is not granted in capabilities, so the
 * shared openExternal() would fall back to window.open(), which does nothing useful
 * inside the Tauri webview. This helper also reports failure, so a card can say so
 * instead of waiting for a browser that never opened.
 */
import { isTauri } from '@/lib/tauri';

export async function openInSystemBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only https links can be opened.');
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('open_url', { url });
  } catch {
    throw new Error("Couldn't open your browser. Copy the link from the address bar of a browser and open it there.");
  }
}
