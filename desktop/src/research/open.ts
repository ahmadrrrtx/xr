/*
 * Research (Phase 18) — open-in-browser + copy-link helpers shared by the
 * source cards and the report (kept out of component files for fast refresh).
 */
import { toast } from 'sonner';

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast("Couldn't copy the link");
  }
}

export async function openExternal(url: string): Promise<void> {
  try {
    const { isTauri } = await import('@/lib/tauri');
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    }
  } catch {
    /* fall through to the browser */
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
