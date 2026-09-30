/*
 * Theme store — the single source of truth for XR's 5 canonical themes.
 *
 * Persistence: localStorage for now (Phase 8 moves it to the Tauri Store,
 * encrypted via Stronghold). The pre-paint `public/theme-init.js` reads the
 * same key before React mounts, so there is no flash of the wrong theme.
 */
import { create } from 'zustand';

import { emitThemeChanged } from '@/lib/tauri';

export const THEMES = [
  'xr-native',
  'graphite',
  'midnight',
  'paper',
  'arctic',
] as const;

export type ThemeId = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeId, string> = {
  'xr-native': 'XR Native',
  graphite: 'Graphite',
  midnight: 'Midnight',
  paper: 'Paper',
  arctic: 'Arctic',
};

const STORAGE_KEY = 'xr.theme';

function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' && (THEMES as readonly string[]).includes(value)
  );
}

function readStoredTheme(): ThemeId {
  if (typeof window === 'undefined') return 'xr-native';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : 'xr-native';
  } catch {
    return 'xr-native';
  }
}

function persistTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode etc.) — theme still applies for the session */
  }
}

/** Apply a theme id to the document root (`html[data-theme]`). */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  cycleTheme: () => ThemeId;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme(),

  setTheme: (theme) => {
    if (!isThemeId(theme) || theme === get().theme) return;
    applyTheme(theme);
    persistTheme(theme);
    void emitThemeChanged(theme);
    set({ theme });
  },

  cycleTheme: () => {
    const current = get().theme;
    const index = THEMES.indexOf(current);
    const next = THEMES[(index + 1) % THEMES.length] ?? 'xr-native';
    get().setTheme(next);
    return next;
  },
}));

/** Re-sync the DOM with the persisted theme (called once at startup). */
export function initTheme(): void {
  applyTheme(useThemeStore.getState().theme);
}
