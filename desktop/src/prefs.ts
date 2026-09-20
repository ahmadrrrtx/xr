/**
 * XR Desktop — local appearance preferences (Phase 1 · audit D-05).
 *
 * BEFORE: `index.html` hardcoded `<meta name="color-scheme" content="dark">`,
 * `tokens.css` declared one palette, and there was no Appearance control at
 * all — so a user on a light OS got a dark app with no way to change it.
 *
 * AFTER: theme + density are explicit, persisted, and OS-following.
 *
 * These are CLIENT preferences (how the shell paints), not engine state — they
 * deliberately live here rather than in the engine, and nothing in the security
 * or policy path reads them. Density/theme can never change an approval
 * decision.
 */

export type Theme = "dark" | "light" | "system";
/** Alias used by Settings, where the name should read as a user choice. */
export type ThemePref = Theme;
export type Density = "compact" | "comfortable" | "spacious";

const THEME_KEY = "xr.theme";
const DENSITY_KEY = "xr.density";

/** Safe read — localStorage can throw in locked-down webviews. */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / disabled storage — preferences simply do not persist */
  }
}

/**
 * Phase 2 · F-1 — first-run default is DARK.
 *
 * The brand renders (logo, avatar) are dark-ground art; on a light OS the
 * first impression washed them out (audit F-1). Dark is the brand ground, so
 * an install with no expressed preference starts dark. The onboarding
 * "Appearance" choice and Settings can move it to light or system at any
 * time, and the choice is then persisted and respected forever after.
 */
export function getTheme(): Theme {
  const v = read(THEME_KEY);
  return v === "dark" || v === "light" || v === "system" ? v : "dark";
}

/** True until the user has expressed a theme choice (onboarding/Settings). */
export function hasThemeChoice(): boolean {
  const v = read(THEME_KEY);
  return v === "dark" || v === "light" || v === "system";
}

export function setTheme(t: Theme): void {
  write(THEME_KEY, t);
  applyTheme(t);
}

export function getDensity(): Density {
  const v = read(DENSITY_KEY);
  return v === "compact" || v === "comfortable" || v === "spacious" ? v : "comfortable";
}

export function setDensity(d: Density): void {
  write(DENSITY_KEY, d);
  applyDensity(d);
}

export function isLightActive(): boolean {
  const t = getTheme();
  if (t === "light") return true;
  if (t === "dark") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches === true;
}

/**
 * Write the RESOLVED theme to the document so the CSS token layer switches.
 *
 * Why `data-theme` is the resolved value ("dark"/"light") and not the
 * preference: the light palette otherwise had to exist twice — once for
 * `[data-theme="light"]` and again inside
 * `@media (prefers-color-scheme: light) { [data-theme="system"] { … } }`.
 * Two copies of 25 colour decisions WILL drift (they already had: a contrast
 * fix landed in one and not the other). Resolving here leaves exactly one
 * palette in the stylesheet, and the preference is still recorded in
 * `data-theme-pref` so the UI can show which option is selected.
 *
 * `colorScheme` is set inline so native form controls, scrollbars and the
 * webview background follow — something the old hardcoded <meta> could not do.
 */
export function applyTheme(t: Theme = getTheme()): void {
  const root = document.documentElement;
  const light = t === "light" || (t === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches === true);
  root.setAttribute("data-theme", light ? "light" : "dark");
  root.setAttribute("data-theme-pref", t);
  root.style.colorScheme = light ? "light" : "dark";
  // Keep the meta in sync for hosts that read it before CSS loads.
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute("content", root.style.colorScheme);
}

/** The user's expressed preference (may be "system"); the resolved value is data-theme. */
export function getResolvedTheme(): "dark" | "light" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function applyDensity(d: Density = getDensity()): void {
  document.documentElement.setAttribute("data-density", d);
}

/** Call once at boot, before first paint, to avoid a theme flash. */
export function initPrefs(): void {
  applyTheme();
  applyDensity();
}

/**
 * Follow live OS theme changes while the preference is "system".
 * Returns an unsubscribe function. Never throws when matchMedia is absent.
 */
export function watchOsTheme(onChange?: (light: boolean) => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => {
    if (getTheme() !== "system") return;
    applyTheme("system");
    onChange?.(mq.matches);
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

/* ---------- notifications ----------
 * Deliberately NOT reimplemented here. `notify.ts` owns the flag (key
 * `xr.notifications`) and the delivery path; a second copy would drift and the
 * Settings toggle, the palette command and the poller could disagree.
 * Re-exported so callers have one import surface for "preferences". */
export { notificationsEnabled, setNotificationsEnabled } from "./notify";
