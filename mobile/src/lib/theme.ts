import type { ThemeId } from '../types';

export interface ThemeOption {
  id: ThemeId;
  label: string;
  /** Light or dark — drives iOS status-bar style and the syntax palette. */
  mode: 'light' | 'dark' | 'system';
  /** Swatch preview: [background, surface, accent] */
  swatch: [string, string, string];
}

export const THEMES: readonly ThemeOption[] = [
  { id: 'system', label: 'Follow system', mode: 'system', swatch: ['#0A0F1A', '#FFFFFF', '#00E5FF'] },
  { id: 'xr-native', label: 'XR Native', mode: 'dark', swatch: ['#03070D', '#0A0F1A', '#00E5FF'] },
  { id: 'graphite', label: 'Graphite', mode: 'dark', swatch: ['#4A4A4A', '#5E5E5E', '#5B8A9E'] },
  { id: 'midnight', label: 'Midnight', mode: 'dark', swatch: ['#0D1422', '#131C2E', '#3B82F6'] },
  { id: 'paper', label: 'Paper', mode: 'light', swatch: ['#EDE6D9', '#F5F0E8', '#2A7A6F'] },
  { id: 'arctic', label: 'Arctic', mode: 'light', swatch: ['#FFFFFF', '#F8FAFC', '#06B6D4'] },
] as const;

const RESOLVED_DARK: Record<Exclude<ThemeId, 'system'>, boolean> = {
  'xr-native': true,
  graphite: true,
  midnight: true,
  paper: false,
  arctic: false,
};

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolve a (possibly 'system') theme id to a concrete theme id. */
export function resolveTheme(id: ThemeId): Exclude<ThemeId, 'system'> {
  if (id !== 'system') return id;
  return systemPrefersDark() ? 'xr-native' : 'arctic';
}

export function isDarkTheme(id: ThemeId): boolean {
  return RESOLVED_DARK[resolveTheme(id)];
}

/**
 * Apply the theme by swapping tokens on <html>. No re-render, no flash —
 * exactly the desktop behaviour.
 */
export function applyTheme(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset['theme'] = resolveTheme(id);
  root.style.colorScheme = isDarkTheme(id) ? 'dark' : 'light';

  // iOS status bar: black-translucent in dark themes, default in light.
  const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  meta?.setAttribute('content', isDarkTheme(id) ? 'black-translucent' : 'default');

  // theme-color follows the active theme so Android recents/system UI match.
  const themeColor = document.querySelector('meta[name="theme-color"]:not([media])');
  if (themeColor) themeColor.setAttribute('content', readToken('--bg-void') || '#03070D');
}

function readToken(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : null;
}

/** Subscribe to OS light/dark changes; returns an unsubscribe function. */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (event: MediaQueryListEvent): void => onChange(event.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
