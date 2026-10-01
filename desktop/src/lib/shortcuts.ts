/*
 * Shortcut registry + resolution (Phase 8).
 *
 * One place that knows every chord XR ships:
 *   - in-app shortcuts consumed by hooks/useHotkeys (combo strings like
 *     "mod+shift+k"; "mod" = Cmd on macOS, Ctrl elsewhere);
 *   - global shortcuts owned by the Rust host (HUD / Orb / push-to-talk),
 *     registered through tauri-plugin-global-shortcut with per-OS fallback
 *     and persisted override keys in the settings store.
 *
 * The Settings → Keyboard Shortcuts tab records new chords here; AppShell
 * re-resolves combos reactively so overrides apply without a restart.
 */

/**
 * Platform guess, inlined from lib/tauri's detectPlatform (minus the
 * platform-API enrichment) so this module stays dependency-free and runs
 * under the root bun test lane (orbCore pattern). Every exported resolver
 * also accepts an explicit platform for deterministic tests.
 */
export type Platform =
  | 'macos'
  | 'windows'
  | 'linux'
  | 'android'
  | 'ios'
  | 'web';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('mac')
    ? 'macos'
    : ua.includes('win')
      ? 'windows'
      : ua.includes('linux')
        ? 'linux'
        : 'web';
}

export type ShortcutScope = 'app' | 'chat' | 'global';
export type GlobalOwner = 'hud' | 'orb' | 'ptt';

export interface ShortcutDef {
  id: string;
  label: string;
  scope: ShortcutScope;
  /** Default in useHotkeys combo format (in-app rows). */
  combo: string;
  /** Global rows: which Rust-owned registration this belongs to. */
  global?: GlobalOwner;
}

/** Every in-app chord XR registers today (harvested from Phases 1–7). */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'palette', label: 'Toggle command palette', scope: 'app', combo: 'mod+k' },
  { id: 'sidebar', label: 'Toggle sidebar', scope: 'app', combo: 'mod+b' },
  { id: 'new-chat', label: 'New chat', scope: 'app', combo: 'mod+n' },
  { id: 'settings', label: 'Open Settings', scope: 'app', combo: 'mod+,' },
  { id: 'cycle-theme', label: 'Cycle theme', scope: 'app', combo: 'mod+shift+t' },
  { id: 'focus-composer', label: 'Focus composer', scope: 'chat', combo: 'mod+l' },
  { id: 'hud', label: 'Toggle HUD (global)', scope: 'global', combo: 'mod+space', global: 'hud' },
  { id: 'orb', label: 'Toggle Orb (global)', scope: 'global', combo: 'alt+mod+o', global: 'orb' },
  { id: 'ptt', label: 'Push-to-talk (global)', scope: 'global', combo: 'mod+.', global: 'ptt' },
] as const;

export function shortcutById(id: string): ShortcutDef | undefined {
  return SHORTCUTS.find((shortcut) => shortcut.id === id);
}

/* ── Resolution ─────────────────────────────────────────────────────── */

/** Effective in-app combo for a shortcut given the user's overrides. */
export function effectiveCombo(
  id: string,
  overrides: Record<string, string>
): string {
  return overrides[id] ?? shortcutById(id)?.combo ?? '';
}

/** All in-app hotkeys (globals are excluded — the OS owns those). */
export function inAppHotkeys(
  overrides: Record<string, string>
): Array<{ id: string; combo: string }> {
  return SHORTCUTS.filter((shortcut) => shortcut.scope !== 'global').map(
    (shortcut) => ({
      id: shortcut.id,
      combo: effectiveCombo(shortcut.id, overrides),
    })
  );
}

/* ── Formatting (display + Tauri parse formats) ─────────────────────── */

const MAC: Record<Platform, boolean> = {
  macos: true,
  windows: false,
  linux: false,
  android: false,
  ios: false,
  web: false,
};

const GLYPH = { mod: '⌘', alt: '⌥', shift: '⇧' } as const;

/** Windows/Linux display + registration order: Ctrl, Alt, Shift. */
const WIN_MOD_ORDER: Record<string, number> = { mod: 0, alt: 1, shift: 2 };

function sortModsForWin(mods: string[]): string[] {
  return [...mods].sort((a, b) => (WIN_MOD_ORDER[a] ?? 9) - (WIN_MOD_ORDER[b] ?? 9));
}

function keyLabel(key: string, mac: boolean): string {
  if (key === 'space') return mac ? 'Space' : 'Space';
  if (key === 'escape') return 'Esc';
  if (key === ',') return mac ? ',' : ',';
  if (key === '.') return mac ? '.' : '.';
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** 'mod+shift+t' → '⌘⇧T' (macOS) / 'Ctrl+Shift+T' (everywhere else). */
export function formatChord(combo: string, platform?: Platform): string {
  const mac = MAC[platform ?? detectPlatform()];
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const mods = parts.slice(0, -1);
  if (mac) {
    const prefix = mods
      .map((mod) => GLYPH[mod as keyof typeof GLYPH] ?? '')
      .join('');
    return `${prefix}${keyLabel(key, mac)}`;
  }
  const names = sortModsForWin(mods).map((mod) =>
    mod === 'mod' ? 'Ctrl' : mod.charAt(0).toUpperCase() + mod.slice(1)
  );
  return [...names, keyLabel(key, mac)].join('+');
}

/** 'mod+shift+o' → 'Cmd+Shift+O' / 'Ctrl+Shift+O' (Tauri Shortcut::from_str). */
export function toTauriChord(combo: string, platform?: Platform): string {
  const mac = MAC[platform ?? detectPlatform()];
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const rawMods = parts.slice(0, -1);
  const mods = (mac ? rawMods : sortModsForWin(rawMods)).map((mod) =>
    mod === 'mod' ? (mac ? 'Cmd' : 'Ctrl') : mod.charAt(0).toUpperCase() + mod.slice(1)
  );
  const keyName = key === 'space' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  return [...mods, keyName].join('+');
}

const TAURI_GLYPH: Record<string, string> = {
  Cmd: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  CommandOrControl: '⌘',
};

/**
 * 'Cmd+Space' (what Rust reports) → '⌘Space' on macOS, 'Ctrl+Space' elsewhere.
 */
export function formatTauriChord(chord: string, platform?: Platform): string {
  const mac = MAC[platform ?? detectPlatform()];
  const parts = chord.split('+');
  if (mac) {
    const key = parts[parts.length - 1] ?? '';
    const glyphs = parts
      .slice(0, -1)
      .map((part) => TAURI_GLYPH[part] ?? '')
      .join('');
    return `${glyphs}${key}`;
  }
  return parts
    .map((part) => (part === 'CommandOrControl' ? 'Ctrl' : part))
    .join('+');
}

/* ── Capture (the recorder) ─────────────────────────────────────────── */

const IGNORED_KEYS = new Set([
  'Shift',
  'Control',
  'Meta',
  'Alt',
  'CapsLock',
  'Dead',
]);

/**
 * Normalize a KeyboardEvent into a combo string, or null while the user is
 * still holding pure modifiers (or pressed something we refuse to bind).
 */
export function eventToCombo(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  if (IGNORED_KEYS.has(event.key)) return null;
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  // Printable single characters only — no F-row, no navigation churn.
  if (key.length > 1 && key !== 'space') return null;

  const mods: string[] = [];
  if (event.metaKey || event.ctrlKey) mods.push('mod');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  // A bare key with no modifier is a typing hazard — refuse it.
  if (mods.length === 0) return null;

  return [...mods, key].join('+');
}

/** Other shortcuts currently bound to the same combo (conflict detection). */
export function findConflicts(
  combo: string,
  exceptId: string,
  overrides: Record<string, string>
): Array<{ id: string; label: string }> {
  return SHORTCUTS.filter(
    (shortcut) =>
      shortcut.id !== exceptId &&
      effectiveCombo(shortcut.id, overrides) === combo
  ).map((shortcut) => ({ id: shortcut.id, label: shortcut.label }));
}
