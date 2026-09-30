import { useEffect } from 'react';

import { useThemeStore } from '@/stores/theme';

/**
 * Global theme-cycling shortcut: Cmd/Ctrl+Shift+T.
 * XR Native → Graphite → Midnight → Paper → Arctic → XR Native.
 */
export function useThemeShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.shiftKey && (event.metaKey || event.ctrlKey))) return;
      if (event.key.toLowerCase() !== 't') return;
      event.preventDefault();
      useThemeStore.getState().cycleTheme();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
