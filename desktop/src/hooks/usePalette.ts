/*
 * Palette lifecycle effects (Phase 5) — the cross-window glue that the
 * shared <CommandPalette> itself must stay agnostic of.
 *
 *   main window (isHud=false): listens for HUD-originated effects —
 *     palette:theme-change, palette:navigate, palette:execute-command,
 *     hud:sessions-changed — and applies them to THIS window's stores/router.
 *
 *   HUD window (isHud=true): resets palette state and re-hydrates sessions
 *     every time Rust shows the window (hud:show), focuses the input, and
 *     auto-hides on blur like Spotlight/Alfred — unless a quick-ask stream
 *     is still running (finish or stop it first).
 */
import { useEffect } from 'react';

import { isTauri } from '@/lib/tauri';
import { hudClose } from '@/lib/hud';
import { usePaletteStore } from '@/stores/paletteStore';
import { useSessionsStore } from '@/stores/sessionsStore';
import { useSidebarStore } from '@/stores/sidebar';
import { useThemeStore, type ThemeId } from '@/stores/theme';

function focusPaletteInput(): void {
  // cmdk tags its input [cmdk-input]; focus it so typing works immediately.
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>('[cmdk-input]')?.focus();
  });
}

/** Reset query/mode/quick-ask — every HUD show starts clean. */
function resetPaletteState(): void {
  usePaletteStore.setState({
    query: '',
    mode: 'commands',
    quickAsk: { question: '', answer: '', status: 'idle' },
  });
}

export function usePaletteIpc(isHud: boolean, navigate?: (route: string) => void): void {
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    const unlisten: Array<() => void> = [];
    /** Registration can resolve after unmount — detach immediately then. */
    const track = (un: () => void): void => {
      if (disposed) un();
      else unlisten.push(un);
    };

    void (async () => {
      const { listen, emit } = await import('@tauri-apps/api/event');

      // Both windows: live theme sync (Rust broadcasts on theme_changed).
      track(
        await listen<string>('palette:theme-change', (event) => {
          const theme = event.payload as ThemeId;
          if (useThemeStore.getState().theme !== theme) {
            useThemeStore.getState().setTheme(theme);
          }
        })
      );

      if (isHud) {
        // Fresh state on every show; clean slumber on hide.
        track(
          await listen('hud:show', () => {
            resetPaletteState();
            void useSessionsStore.getState().loadSessions();
            focusPaletteInput();
          })
        );
        track(
          await listen('hud:hide', () => {
            resetPaletteState();
          })
        );

        // Spotlight behavior: losing focus dismisses — but never rip the
        // window away mid-answer.
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const un = await getCurrentWindow().listen('tauri://blur', () => {
            if (usePaletteStore.getState().quickAsk.status === 'streaming') return;
            void hudClose();
          });
          track(un);
        } catch {
          /* window events unavailable — skip auto-hide */
        }

        // Ask the main window (if alive) for the current theme so a theme
        // changed while the HUD was hidden still lands.
        void emit('palette:request-theme', undefined);
      } else {
        // Main window: execute HUD-originated effects.
        if (navigate) {
          track(
            await listen<string>('palette:navigate', (event) => {
              navigate(event.payload);
            })
          );
        }
        track(
          await listen<string>('palette:execute-command', (event) => {
            if (event.payload === 'toggle-sidebar') {
              useSidebarStore.getState().toggle();
            }
          })
        );
        track(
          await listen('hud:sessions-changed', () => {
            void useSessionsStore.getState().loadSessions();
          })
        );
        // Answer the HUD's theme request (late-loaded main window edge case).
        track(
          await listen('palette:request-theme', () => {
            void emit('palette:theme-change', useThemeStore.getState().theme);
          })
        );
      }
    })();

    return () => {
      disposed = true;
      for (const un of unlisten) un();
    };
  }, [isHud, navigate]);
}
