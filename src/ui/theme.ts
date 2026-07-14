/**
 * XR 3.1 — Theme / ANSI token layer
 *
 * Compiles design tokens (tokens.ts) into terminal-safe ANSI helpers.
 * Supports truecolor (24-bit), 256-color, 16-color, monochrome, and NO_COLOR.
 *
 * Spec: docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md §2.6
 */

import {
  COLOR,
  RGB,
  ANSI16,
  CSS_VARS as TOKEN_CSS,
  BRAND_META,
  TERM,
  MOTION,
  type StatusKind,
  STATUS_COLOR,
} from "./tokens.ts";

// Re-export brand palette for consumers that expect BRAND
export const BRAND = {
  primary: COLOR.primary,
  success: COLOR.success,
  warning: COLOR.warning,
  error: COLOR.error,
  muted: COLOR.muted,
  bg: COLOR.bg,
  surface: COLOR.surface,
  border: COLOR.border,
  text: COLOR.text,
  textDim: COLOR.textDim,
  violet: COLOR.violet,
  name: BRAND_META.name,
  tagline: BRAND_META.tagline,
} as const;

export { COLOR, RGB, TERM, MOTION, BRAND_META };

// ── Capability detection ──────────────────────────────────────────────────────

export type ColorMode = "truecolor" | "256" | "16" | "mono" | "none";

let _colorMode: ColorMode | null = null;
let _reducedMotion = false;
let _textOnly = false;

export function detectColorMode(): ColorMode {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return "none";
  if (process.env.FORCE_COLOR === "0") return "none";
  if (process.env.XR_COLOR === "mono") return "mono";
  if (process.env.XR_COLOR === "16") return "16";
  if (process.env.XR_COLOR === "256") return "256";
  if (process.env.XR_COLOR === "truecolor" || process.env.FORCE_COLOR === "3") return "truecolor";

  const ct = (process.env.COLORTERM || "").toLowerCase();
  if (ct === "truecolor" || ct === "24bit") return "truecolor";

  const term = (process.env.TERM || "").toLowerCase();
  if (term === "dumb") return "none";
  if (term.includes("256color") || term.includes("xterm") || term.includes("screen") || term.includes("tmux")) {
    // Prefer truecolor when modern terminals advertise it
    if (process.env.TERM_PROGRAM === "iTerm.app" ||
        process.env.TERM_PROGRAM === "Apple_Terminal" ||
        process.env.WT_SESSION ||
        process.env.KITTY_WINDOW_ID ||
        process.env.WEZTERM_EXECUTABLE ||
        process.env.GHOSTTY ||
        term.includes("direct") ||
        process.env.COLORTERM) {
      return "truecolor";
    }
    return "256";
  }
  if (term) return "16";
  return process.stdout.isTTY ? "16" : "none";
}

export function getColorMode(): ColorMode {
  if (_colorMode == null) _colorMode = detectColorMode();
  return _colorMode;
}

export function setColorMode(mode: ColorMode): void {
  _colorMode = mode;
}

export function setReducedMotion(on: boolean): void {
  _reducedMotion = on;
}

export function isReducedMotion(): boolean {
  if (_reducedMotion) return true;
  if (process.env.XR_REDUCED_MOTION === "1") return true;
  return false;
}

export function setTextOnly(on: boolean): void {
  _textOnly = on;
}

export function isTextOnly(): boolean {
  return _textOnly || process.env.XR_TEXT_ONLY === "1";
}

// ── ANSI escape primitives ────────────────────────────────────────────────────

export const A = {
  reset:          "\x1b[0m",
  bold:           "\x1b[1m",
  dim:            "\x1b[2m",
  italic:         "\x1b[3m",
  underline:      "\x1b[4m",
  reverse:        "\x1b[7m",
  // Standard foreground
  black:          "\x1b[30m",
  red:            "\x1b[31m",
  green:          "\x1b[32m",
  yellow:         "\x1b[33m",
  blue:           "\x1b[34m",
  magenta:        "\x1b[35m",
  cyan:           "\x1b[36m",
  white:          "\x1b[37m",
  gray:           "\x1b[90m",
  // Bright foreground
  brightRed:      "\x1b[91m",
  brightGreen:    "\x1b[92m",
  brightYellow:   "\x1b[93m",
  brightBlue:     "\x1b[94m",
  brightMagenta:  "\x1b[95m",
  brightCyan:     "\x1b[96m",
  brightWhite:    "\x1b[97m",
  // Background
  bgBlack:        "\x1b[40m",
  bgRed:          "\x1b[41m",
  bgGreen:        "\x1b[42m",
  bgBlue:         "\x1b[44m",
  bgCyan:         "\x1b[46m",
  bgGray:         "\x1b[100m",
  // Cursor & screen
  clearScreen:    "\x1b[2J\x1b[H",
  clearLine:      "\x1b[2K\x1b[G",
  eraseLine:      "\x1b[2K",
  eraseToEnd:     "\x1b[K",
  cursorHide:     "\x1b[?25l",
  cursorShow:     "\x1b[?25h",
  saveCursor:     "\x1b[s",
  restoreCursor:  "\x1b[u",
  altScreenEnter: "\x1b[?1049h",
  altScreenLeave: "\x1b[?1049l",
  mouseOn:        "\x1b[?1000h\x1b[?1002h\x1b[?1006h",
  mouseOff:       "\x1b[?1006l\x1b[?1002l\x1b[?1000l",
  bracketedPasteOn:  "\x1b[?2004h",
  bracketedPasteOff: "\x1b[?2004l",
  moveUp:         (n: number) => `\x1b[${n}A`,
  moveDown:       (n: number) => `\x1b[${n}B`,
  moveRight:      (n: number) => `\x1b[${n}C`,
  moveLeft:       (n: number) => `\x1b[${n}D`,
  moveCol:        (n: number) => `\x1b[${n}G`,
  moveTo:         (row: number, col: number) => `\x1b[${row};${col}H`,
  fg256:          (n: number) => `\x1b[38;5;${n}m`,
  bg256:          (n: number) => `\x1b[48;5;${n}m`,
  fgRgb:          (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb:          (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
} as const;

// ── Color application ─────────────────────────────────────────────────────────

function paint(rgb: readonly [number, number, number], ansi16: number, s: string, dim = false): string {
  const mode = getColorMode();
  if (mode === "none" || mode === "mono") {
    return dim ? `${A.dim}${s}${A.reset}` : s;
  }
  if (mode === "16") {
    const code = dim ? `\x1b[2;${ansi16}m` : `\x1b[${ansi16}m`;
    return `${code}${s}${A.reset}`;
  }
  // 256 and truecolor: prefer truecolor when available
  if (mode === "truecolor") {
    return `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${dim ? A.dim : ""}${s}${A.reset}`;
  }
  // 256 approximate
  return `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${s}${A.reset}`;
}

export const xrCyan  = (s: string) => paint(RGB.primary, ANSI16.primary, s);
export const xrViolet = (s: string) => paint(RGB.violet, ANSI16.violet, s);
export const xrGreen = (s: string) => paint(RGB.success, ANSI16.success, s);
export const xrAmber = (s: string) => paint(RGB.warning, ANSI16.warning, s);
export const xrRed   = (s: string) => paint(RGB.error, ANSI16.error, s);
export const xrDim   = (s: string) => {
  const mode = getColorMode();
  if (mode === "none" || mode === "mono") return s;
  return `${A.dim}${s}${A.reset}`;
};
export const xrBold  = (s: string) => {
  const mode = getColorMode();
  if (mode === "none") return s;
  return `${A.bold}${s}${A.reset}`;
};
export const xrMuted = (s: string) => paint(RGB.muted, ANSI16.muted, s);
export const xrText  = (s: string) => paint(RGB.text, ANSI16.text, s);

/** Paint by semantic status */
export function xrStatus(kind: StatusKind, s: string): string {
  const key = STATUS_COLOR[kind];
  const rgb = RGB[key];
  const a16 = (ANSI16 as Record<string, number>)[key] ?? 37;
  return paint(rgb, a16, s);
}

/** Soft background tint (truecolor only; no-op otherwise) */
export function xrBgTint(rgb: readonly [number, number, number], s: string): string {
  if (getColorMode() !== "truecolor") return s;
  // 8% opacity approximation: blend toward surface
  const r = Math.round(rgb[0] * 0.12 + RGB.surface[0] * 0.88);
  const g = Math.round(rgb[1] * 0.12 + RGB.surface[1] * 0.88);
  const b = Math.round(rgb[2] * 0.12 + RGB.surface[2] * 0.88);
  return `${A.bgRgb(r, g, b)}${s}${A.reset}`;
}

export function xrSelected(s: string): string {
  if (getColorMode() === "truecolor") {
    return xrBgTint(RGB.primary, xrCyan(s));
  }
  return xrBold(xrCyan(s));
}

// ── Status symbols (static strings for CLI/layout compatibility) ──────────────
// For text-only / a11y mode, use icons.ts glyph() helpers instead.

export const SYM = {
  ok:       xrGreen("✓"),
  warn:     xrAmber("!"),
  error:    xrRed("✗"),
  info:     xrCyan("·"),
  arrow:    xrCyan("›"),
  dot:      xrCyan("•"),
  running:  xrCyan("⟳"),
  local:    xrGreen("⬡"),
  cloud:    xrAmber("☁"),
  secure:   xrGreen("🔒"),
  budget:   xrAmber("◈"),
  memory:   xrCyan("◉"),
  voice:    xrCyan("🎤"),
  plugin:   xrCyan("⌁"),
  research: xrCyan("◆"),
} as const;

/** Alias kept for callers that imported SYM_STATIC */
export const SYM_STATIC = SYM;

// ── Spinner frames ────────────────────────────────────────────────────────────

export const SPINNER_FRAMES = ["·", "✻", "✽", "✶", "✳", "✢", "·"] as const;
export const DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const BAR_FILLED  = "█";
export const BAR_EMPTY   = "░";
export const BAR_HEAD    = "▓";

// ── Layout constants (legacy + TERM) ──────────────────────────────────────────

export const LAYOUT = {
  termWidth:    80,
  panelWidth:   76,
  divider:      "─".repeat(76),
  thinDivider:  "·".repeat(76),
  boxTop:       "┌" + "─".repeat(74) + "┐",
  boxBottom:    "└" + "─".repeat(74) + "┘",
  boxSide:      "│",
  ...TERM,
} as const;

// ── CSS Variables ─────────────────────────────────────────────────────────────

export const CSS_VARS = TOKEN_CSS;
