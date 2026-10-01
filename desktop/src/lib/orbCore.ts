/*
 * Orb state primitives (Phase 6) — deliberately dependency-free beyond the
 * shared brand types, so the root test tier can import them by path
 * (the paletteQuery.ts pattern, docs/phases/05-hud.plan.md §1).
 *
 * Everything algorithmic about the orb that ISN'T a Tauri call lives here:
 * state validation, the theme→glow map, interaction timings and the dev
 * override parser (localStorage flags, same family as xr.mock.errorRate).
 */
import { AVATAR_STATES, type AvatarState } from '../components/brand/types';

export type { AvatarState };

/** The 7 canonical orb states — single source: brand/types (Phase 2). */
export const ORB_STATES = AVATAR_STATES;

/** Narrow an unknown payload (IPC events arrive as plain JSON). */
export function isOrbState(value: unknown): value is AvatarState {
  return typeof value === 'string' && (ORB_STATES as readonly string[]).includes(value);
}

/*
 * Glow scaling (Phase 6 prompt / docs/THEME-SYSTEM.md): the orb keeps its
 * signature black+cyan look on EVERY theme — only the halo/eye glow
 * intensity adapts. Full on the three dark themes, dimmed on the two light
 * ones (the user's light-UI preference softens the desktop glow too).
 */
export const ORB_GLOW_FULL = 1;
export const ORB_GLOW_DIM = 0.6;

const GLOW_INTENSITY: Record<string, number> = {
  'xr-native': ORB_GLOW_FULL,
  midnight: ORB_GLOW_FULL,
  graphite: ORB_GLOW_FULL,
  paper: ORB_GLOW_DIM,
  arctic: ORB_GLOW_DIM,
};

/** Glow multiplier for a theme id — unknown ids keep the signature full glow. */
export function glowIntensityFor(theme: string): number {
  return GLOW_INTENSITY[theme] ?? ORB_GLOW_FULL;
}

/** Inactivity → sleeping (OV-3), after 30 minutes. */
export const SLEEP_MS_DEFAULT = 30 * 60_000;
/** Single click plays the listening preview locally for 2s (voice = Phase 15). */
export const CLICK_PREVIEW_MS = 2_000;
/** `error` is a finite 2s flash in the SVG — land back on idle after it. */
export const ERROR_REVERT_MS = 2_500;
/** Second press within this window is a double-click. */
export const DOUBLE_CLICK_MS = 400;
/** Presses that move further than this become native window drags. */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Parse a dev override ("xr.orb.sleepMs" and friends) — null/invalid falls
 * back; values clamp to [250ms, 1h] so a typo can neither freeze the orb
 * nor spam it.
 */
export function parseDevMs(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(3_600_000, Math.max(250, parsed));
}
