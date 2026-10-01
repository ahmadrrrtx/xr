/*
 * Orb IPC bridge (Phase 6) — the hud.ts pattern: thin typed wrappers, every
 * helper a no-op in the plain browser preview.
 *
 * Who calls what:
 *   MAIN window  → orbShow/Hide/Toggle (onboarding, settings), orbSetState
 *                  (chat + quick-ask streams), useOrbIpc() reactions
 *   ORB window   → orbStartDrag, orbEmitClicked, orbOpenMain,
 *                  orbShowContextMenu, plus the orb:set-state listener
 *
 * In dev builds a DOM CustomEvent seam ("xr-orb-seam") mirrors each call so
 * the browser e2e pass can assert the wiring without the native shell —
 * the Tauri path is untouched.
 */
import type { AvatarState } from '@/components/brand/types';
import { isOrbState } from '@/lib/orbCore';
import { isTauri } from '@/lib/tauri';

export { isOrbState };

type SeamKind =
  | 'show'
  | 'hide'
  | 'toggle'
  | 'set-state'
  | 'clicked'
  | 'open-main'
  | 'context-menu';

/** Dev/e2e seam — browser only, dev builds only. */
function devSeam(kind: SeamKind, payload?: unknown): void {
  if (import.meta.env.DEV) {
    window.dispatchEvent(new CustomEvent('xr-orb-seam', { detail: { kind, payload } }));
  }
}

async function invokeOrb<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/** Show the orb at its remembered position (persists showOrb: true). */
export function orbShow(): Promise<void> {
  if (!isTauri()) {
    devSeam('show');
    return Promise.resolve();
  }
  return invokeOrb<void>('orb_show').then(() => undefined);
}

/** Hide the orb (persists showOrb: false — relaunches keep it hidden). */
export function orbHide(): Promise<void> {
  if (!isTauri()) {
    devSeam('hide');
    return Promise.resolve();
  }
  return invokeOrb<void>('orb_hide').then(() => undefined);
}

/** Global-shortcut semantics: visible → hide, hidden → show. */
export function orbToggle(): Promise<void> {
  if (!isTauri()) {
    devSeam('toggle');
    return Promise.resolve();
  }
  return invokeOrb<void>('orb_toggle').then(() => undefined);
}

/** Double-click: Rust surfaces + focuses the main window. */
export function orbOpenMain(): Promise<void> {
  if (!isTauri()) {
    devSeam('open-main');
    return Promise.resolve();
  }
  return invokeOrb<void>('orb_open_main').then(() => undefined);
}

/** Right-click: Rust pops the NATIVE OS context menu at the cursor. */
export function orbShowContextMenu(): Promise<void> {
  if (!isTauri()) {
    devSeam('context-menu');
    return Promise.resolve();
  }
  return invokeOrb<void>('orb_show_context_menu').then(() => undefined);
}

/**
 * Broadcast a state change to the orb (JS emit reaches every webview —
 * the Phase 5 event convention; no Rust hop needed).
 */
export async function orbSetState(state: AvatarState): Promise<void> {
  if (!isTauri()) {
    devSeam('set-state', { state });
    return;
  }
  const { emit } = await import('@tauri-apps/api/event');
  await emit('orb:set-state', { state });
}

/** Single-click broadcast — the main window answers with the Phase 15 toast. */
export async function orbEmitClicked(): Promise<void> {
  if (!isTauri()) {
    devSeam('clicked');
    return;
  }
  const { emit } = await import('@tauri-apps/api/event');
  await emit('orb:clicked', {});
}

/**
 * Hand the press to the OS window drag. Called only after the caller's
 * movement threshold — stationary clicks keep their normal DOM events.
 */
export async function orbStartDrag(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  } catch {
    /* the OS rejects drags that never moved — nothing to do */
  }
}

/** True when this webview IS the orb (orb.html entry). */
export function isOrbWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.endsWith('/orb.html');
}
