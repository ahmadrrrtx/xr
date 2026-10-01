/*
 * HUD app shell (Phase 5) — the whole window is the palette.
 *
 * Responsibilities beyond rendering <CommandPalette embedded={false} />:
 *   - hydrate sessions (same chat_db backend as the main window)
 *   - cross-window IPC effects (theme sync, reset-on-show, blur auto-hide)
 *   - a scoped toaster so stub commands (Voice/Phase 15 etc.) surface here
 */
import { useEffect } from 'react';
import { Toaster } from 'sonner';

import { CommandPalette } from '@/components/palette/CommandPalette';
import { usePaletteIpc } from '@/hooks/usePalette';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { useSessionsStore } from '@/stores/sessionsStore';
import { hydratePaletteHistory } from '@/stores/paletteStore';

export function HudApp() {
  usePaletteIpc(true);
  useSettingsSync();

  // Seed the store once at boot; every hud:show re-hydrates (usePaletteIpc).
  useEffect(() => {
    void useSessionsStore.getState().loadSessions();
    void useSessionsStore.getState().loadDefaultModel();
    void hydratePaletteHistory();
  }, []);

  return (
    <>
      <CommandPalette embedded={false} />
      <Toaster
        position="bottom-center"
        duration={4000}
        toastOptions={{
          classNames: {
            toast:
              'bg-bg-ink border-border-subtle text-text-primary rounded-lg border text-sm shadow-lg',
            title: 'text-text-primary text-sm font-medium',
            description: 'text-text-secondary text-xs',
            actionButton: 'bg-accent text-accent-contrast rounded-md text-xs font-medium',
            cancelButton: 'text-text-secondary hover:text-text-primary text-xs font-medium',
            success: 'border-l-[3px]! border-l-success',
            error: 'border-l-[3px]! border-l-danger',
            warning: 'border-l-[3px]! border-l-warning',
            info: 'border-l-[3px]! border-l-accent',
          },
        }}
      />
    </>
  );
}
