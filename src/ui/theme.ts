/**
 * XR Stage 5 — Design System / Theme Token Layer
 *
 * Single source of truth for all colors, typography, spacing, and ANSI codes
 * used across CLI, TUI, and (via CSS variables) the web dashboard/chat.
 *
 * Principles:
 *  - Dark-mode first, accessible contrast ratios
 *  - XR brand: cyan (#00D4FF) primary, green (#00FF88) success, amber (#F59E0B) warn
 *  - Consistent emoji-free ASCII symbols for tool-call indicators
 *  - All ANSI codes in one place — never scattered across files
 */

// ── Brand Palette ─────────────────────────────────────────────────────────────

export const BRAND = {
  /** Primary accent — cyan neon */
  primary:  "#00D4FF",
  /** Success / local / safe */
  success:  "#00FF88",
  /** Warning / cloud / caution */
  warning:  "#F59E0B",
  /** Error / danger */
  error:    "#FF4D4D",
  /** Muted / secondary text */
  muted:    "#6B7280",
  /** Background dark */
  bg:       "#0A0A0F",
  /** Surface card */
  surface:  "#111827",
  /** Border */
  border:   "#1F2937",
  /** Text primary */
  text:     "#F9FAFB",
  /** Text secondary */
  textDim:  "#9CA3AF",
} as const;

// ── ANSI Terminal Tokens ──────────────────────────────────────────────────────

export const A = {
  // Reset
  reset:          "\x1b[0m",
  // Styles
  bold:           "\x1b[1m",
  dim:            "\x1b[2m",
  italic:         "\x1b[3m",
  underline:      "\x1b[4m",
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
  moveUp:         (n: number) => `\x1b[${n}A`,
  moveDown:       (n: number) => `\x1b[${n}B`,
  moveRight:      (n: number) => `\x1b[${n}C`,
  moveLeft:       (n: number) => `\x1b[${n}D`,
  moveCol:        (n: number) => `\x1b[${n}G`,
  moveTo:         (row: number, col: number) => `\x1b[${row};${col}H`,
  // 256-color helpers
  fg256:          (n: number) => `\x1b[38;5;${n}m`,
  bg256:          (n: number) => `\x1b[48;5;${n}m`,
  // True-color (24-bit)
  fgRgb:          (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`,
  bgRgb:          (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`,
} as const;

// ── Semantic Color Helpers ────────────────────────────────────────────────────

/** XR brand cyan — primary accent */
export const xrCyan  = (s: string) => `${A.fgRgb(0, 212, 255)}${s}${A.reset}`;
/** XR brand green — success / local / online */
export const xrGreen = (s: string) => `${A.fgRgb(0, 255, 136)}${s}${A.reset}`;
/** XR brand amber — warning / cloud */
export const xrAmber = (s: string) => `${A.fgRgb(245, 158, 11)}${s}${A.reset}`;
/** XR brand red — error / danger */
export const xrRed   = (s: string) => `${A.fgRgb(255, 77, 77)}${s}${A.reset}`;
/** Dim / muted text */
export const xrDim   = (s: string) => `${A.dim}${s}${A.reset}`;
/** Bold text */
export const xrBold  = (s: string) => `${A.bold}${s}${A.reset}`;

// ── Status Symbols ────────────────────────────────────────────────────────────

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
  budget:   xrAmber("💰"),
  memory:   xrCyan("🧠"),
  voice:    xrCyan("🎤"),
  plugin:   xrCyan("⚡"),
  research: xrCyan("🔬"),
} as const;

// ── Spinner Frames (Claude Code–style) ────────────────────────────────────────

/** Primary thinking spinner — matches Claude Code's star-burst sequence */
export const SPINNER_FRAMES = ["·", "✻", "✽", "✶", "✳", "✢", "·"] as const;

/** Dots spinner for progress bars */
export const DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Bar progress */
export const BAR_FILLED  = "█";
export const BAR_EMPTY   = "░";
export const BAR_HEAD    = "▓";

// ── Layout Constants ──────────────────────────────────────────────────────────

export const LAYOUT = {
  termWidth:    80,
  panelWidth:   76,
  divider:      "─".repeat(76),
  thinDivider:  "·".repeat(76),
  boxTop:       "┌" + "─".repeat(74) + "┐",
  boxBottom:    "└" + "─".repeat(74) + "┘",
  boxSide:      "│",
} as const;

// ── CSS Variables (for web surfaces) ─────────────────────────────────────────

export const CSS_VARS = `
  :root {
    --xr-primary:    #00D4FF;
    --xr-success:    #00FF88;
    --xr-warning:    #F59E0B;
    --xr-error:      #FF4D4D;
    --xr-muted:      #6B7280;
    --xr-bg:         #0A0A0F;
    --xr-bg-2:       #0D1117;
    --xr-surface:    #111827;
    --xr-surface-2:  #1A2234;
    --xr-border:     #1F2937;
    --xr-border-2:   #2D3748;
    --xr-text:       #F9FAFB;
    --xr-text-dim:   #9CA3AF;
    --xr-text-muted: #6B7280;
    --xr-radius:     8px;
    --xr-radius-lg:  12px;
    --xr-radius-xl:  16px;
    --xr-font-mono:  'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', monospace;
    --xr-font-sans:  'Inter', 'Segoe UI', system-ui, sans-serif;
    --xr-shadow:     0 4px 24px rgba(0,0,0,0.4);
    --xr-glow-cyan:  0 0 20px rgba(0,212,255,0.2);
    --xr-glow-green: 0 0 20px rgba(0,255,136,0.2);
  }
`;
