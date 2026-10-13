/*
 * Theme store — the single source of truth for XR's 5 canonical themes.
 *
 * Persistence (Phase 1): write-through — Tauri Store (`settings.json`) is the
 * durable source inside the native shell; the localStorage copy stays in sync
 * so the pre-paint `public/theme-init.js` applies the theme before React
 * mounts (no flash) and the browser preview keeps working.
 *
 * Phase 8 adds "Match system": the persisted preference may be `system`
 * (resolved via prefers-color-scheme → xr-native / arctic, re-resolved when
 * the OS flips). The broadcast always carries the RESOLVED ThemeId so
 * events.rs validation and the HUD/orb listeners stay unchanged. Legacy
 * values from early Phase 1 builds (dark/light/void) migrate on read.
 */
import { create } from 'zustand';

import { writeSettingRaw } from '@/lib/persistent-store';
import { emitThemeChanged } from '@/lib/tauri';

export const THEMES = [
  'xr-native',
  'graphite',
  'midnight',
  'paper',
  'arctic',
] as const;

export type ThemeId = (typeof THEMES)[number];

/** What the user picked — a concrete theme, or `system`. */
export type ThemePreference = ThemeId | 'system';

export const THEME_LABELS: Record<ThemeId, string> = {
  'xr-native': 'XR Native',
  graphite: 'Graphite',
  midnight: 'Midnight',
  paper: 'Paper',
  arctic: 'Arctic',
};

const STORAGE_KEY = 'xr.theme';

/** Early Phase-1 builds persisted these — migrate them on read. */
const LEGACY_THEME: Record<string, ThemeId> = {
  dark: 'xr-native',
  light: 'arctic',
  void: 'xr-native',
};

function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === 'string' && (THEMES as readonly string[]).includes(value)
  );
}

function isThemePreference(value: unknown): value is ThemePreference {
  return isThemeId(value) || value === 'system';
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'xr-native';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const migrated = isThemeId(stored)
      ? stored
      : (stored !== null && LEGACY_THEME[stored]) || null;
    return isThemePreference(migrated) ? migrated : 'xr-native';
  } catch {
    return 'xr-native';
  }
}

/** Resolve the `system` preference to a concrete theme. */
export function resolveSystemTheme(): ThemeId {
  if (typeof window === 'undefined' || !window.matchMedia) return 'xr-native';
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'arctic'
      : 'xr-native';
  } catch {
    return 'xr-native';
  }
}

export function resolveTheme(preference: ThemePreference): ThemeId {
  return preference === 'system' ? resolveSystemTheme() : preference;
}

function persistPreference(preference: ThemePreference): void {
  // Raw string — `public/theme-init.js` reads this exact format pre-paint.
  writeSettingRaw(STORAGE_KEY, preference);
}

/** Apply a resolved theme id to the document root (`html[data-theme]`). */
export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  /** The resolved, active theme (never `system`). */
  theme: ThemeId;
  /** What the user picked (may be `system`). */
  preference: ThemePreference;
  setTheme: (theme: ThemeId) => void;
  setPreference: (preference: ThemePreference) => void;
  cycleTheme: () => ThemeId;
  /**
   * The OS appearance changed (Phase 27: `xr-os-theme` from the shell, and
   * `prefers-color-scheme` on the web). Applies the new theme *only* while the
   * preference is `system` and never rewrites the preference — someone who
   * picked "Midnight" keeps Midnight when the OS flips to light.
   */
  refreshSystemTheme: (theme?: ThemeId) => void;
}

function activate(theme: ThemeId, preference: ThemePreference, set: (partial: Partial<ThemeState>) => void): void {
  applyTheme(theme);
  persistPreference(preference);
  void emitThemeChanged(theme);
  set({ theme, preference });
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: resolveTheme(readStoredPreference()),
  preference: readStoredPreference(),

  setTheme: (theme) => {
    if (!isThemeId(theme) || theme === get().theme) return;
    activate(theme, theme, set);
  },

  setPreference: (preference) => {
    if (!isThemePreference(preference) || preference === get().preference) {
      return;
    }
    activate(resolveTheme(preference), preference, set);
  },

  cycleTheme: () => {
    const current = get().theme;
    const index = THEMES.indexOf(current);
    const next = THEMES[(index + 1) % THEMES.length] ?? 'xr-native';
    get().setTheme(next);
    return next;
  },

  refreshSystemTheme: (theme) => {
    if (get().preference !== 'system') return;
    const next = theme ?? resolveSystemTheme();
    if (next === get().theme) return;
    activate(next, 'system', set);
  },
}));

// Live system-theme tracking: when the preference is `system`, follow the OS.
if (typeof window !== 'undefined' && window.matchMedia) {
  try {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => {
      // `setPreference('system')` returns early when the preference already is
      // `system` (it is a no-change write), so the re-resolve goes through
      // `refreshSystemTheme`: that is the action whose job is "the OS moved".
      useThemeStore.getState().refreshSystemTheme();
    };
    query.addEventListener?.('change', onChange);
  } catch {
    /* matchMedia unavailable — system preference stays boot-resolved */
  }
}

/** Re-sync the DOM with the persisted theme (called once at startup). */
export function initTheme(): void {
  applyTheme(useThemeStore.getState().theme);
}
