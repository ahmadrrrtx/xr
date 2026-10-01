/*
 * Appearance effects (Phase 8) — one function every window calls.
 *
 * Maps the appearance settings group onto `<html>` attributes/CSS vars so
 * density, font size, glass, glow and reduced-motion apply app-wide
 * instantly (main window, HUD, orb — each applies its own copy):
 *
 *   data-density  compact | comfortable | spacious   (globals.css row hooks)
 *   --fs-body     12–16px                             (body font-size)
 *   data-glass    on | off                             (.xr-glass blur)
 *   data-glow     on | off                             (--accent-glow kill)
 *   data-motion   full | reduced                       (CSS + MotionConfig)
 */
import type { XRSettings } from '@/stores/settingsStore';

export function applyAppearanceEffects(
  appearance: XRSettings['appearance']
): void {
  const root = document.documentElement;
  root.dataset.density = appearance.density;
  root.dataset.glass = appearance.glass ? 'on' : 'off';
  root.dataset.glow = appearance.glow ? 'on' : 'off';
  root.dataset.motion = appearance.reduceMotion ? 'reduced' : 'full';
  root.style.setProperty('--fs-body', `${appearance.fontSize}px`);
}

/** Sidebar nav icon size (S/M/L → px). */
export function navIconPx(iconSize: XRSettings['appearance']['iconSize']): number {
  if (iconSize === 's') return 16;
  if (iconSize === 'l') return 20;
  return 18;
}
