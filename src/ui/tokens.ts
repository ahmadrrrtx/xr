/**
 * XR 3.1 — Canonical Design Tokens
 *
 * Single source of truth for color, spacing, radius, motion, typography,
 * layout, and elevation across ALL surfaces:
 *   - Shell (TUI) via ANSI mapping in theme.ts
 *   - Control Center (web) via CSS_VARS
 *   - Website via Tailwind / CSS custom properties
 *
 * Spec: docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md
 * Rule: never hardcode hex/spacing in product chrome; import from here.
 */

// ── Color: Core palette ───────────────────────────────────────────────────────

export const COLOR = {
  bg:        "#0A0A0F",
  bg2:       "#0D1117",
  surface:   "#111827",
  surface2:  "#1A2234",
  border:    "#1F2937",
  border2:   "#2D3748",
  text:      "#F9FAFB",
  textDim:   "#9CA3AF",
  muted:     "#6B7280",

  primary:   "#00D4FF",
  cyan:      "#00D4FF",
  violet:    "#A855F7",
  success:   "#00FF88",
  green:     "#00FF88",
  warning:   "#F59E0B",
  amber:     "#F59E0B",
  error:     "#FF4D4D",
  red:       "#FF4D4D",

  // Extended data colors (charts only)
  data1: "#00D4FF",
  data2: "#A855F7",
  data3: "#00FF88",
  data4: "#F59E0B",
  data5: "#60A5FA",
  data6: "#F472B6",

  // Near-black text on cyan primary buttons
  onPrimary: "#001018",
} as const;

export type ColorToken = keyof typeof COLOR;

// ── RGB tuples (for ANSI truecolor) ───────────────────────────────────────────

export const RGB = {
  primary:  [0, 212, 255] as const,
  cyan:     [0, 212, 255] as const,
  violet:   [168, 85, 247] as const,
  success:  [0, 255, 136] as const,
  green:    [0, 255, 136] as const,
  warning:  [245, 158, 11] as const,
  amber:    [245, 158, 11] as const,
  error:    [255, 77, 77] as const,
  red:      [255, 77, 77] as const,
  text:     [249, 250, 251] as const,
  textDim:  [156, 163, 175] as const,
  muted:    [107, 114, 128] as const,
  border:   [31, 41, 55] as const,
  border2:  [45, 55, 72] as const,
  bg:       [10, 10, 15] as const,
  bg2:      [13, 17, 23] as const,
  surface:  [17, 24, 39] as const,
  surface2: [26, 34, 52] as const,
  onPrimary:[0, 16, 24] as const,
} as const;

// ── 16-color ANSI fallback codes ──────────────────────────────────────────────

export const ANSI16 = {
  primary:  36,  // bright cyan (we use 36 + bold for primary)
  cyan:     36,
  violet:   35,  // magenta
  success:  32,  // green
  green:    32,
  warning:  33,  // yellow
  amber:    33,
  error:    31,  // red
  red:      31,
  text:     37,  // white
  textDim:  37,  // white + dim
  muted:    90,  // bright black / gray
  border:   90,
} as const;

// ── Spacing (4px grid — web; character cells for TUI) ─────────────────────────

export const SPACE = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
  24: 96,
} as const;

// ── Radius ────────────────────────────────────────────────────────────────────

export const RADIUS = {
  sm:   4,
  md:   8,
  lg:   12,
  xl:   16,
  full: 999,
} as const;

// ── Motion ────────────────────────────────────────────────────────────────────

export const MOTION = {
  fastMs:  80,
  baseMs:  120,
  slowMs:  200,
  spinnerFrameMs: 120,
  cursorBlinkMs:  530,
  startupFrameMs: 110,
  startupFrames:  6,
  easingStandard: "cubic-bezier(.4,0,.2,1)",
  easingEntrance: "cubic-bezier(.22,1,.36,1)",
} as const;

// ── Typography ────────────────────────────────────────────────────────────────

export const TYPE = {
  fontMono:  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', ui-monospace, monospace",
  fontSans:  "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  fontDisplay: "'Syne', 'Inter', system-ui, sans-serif",
  // Web type scale (px)
  display: 48,
  h1: 24,
  h2: 18,
  h3: 14,
  body: 13,
  small: 12,
  xs: 11,
  mono: 12,
  composer: 14,
} as const;

// ── Elevation / shadows (web) ─────────────────────────────────────────────────

export const SHADOW = {
  sm:   "0 1px 2px rgba(0,0,0,.4)",
  md:   "0 4px 24px rgba(0,0,0,.4)",
  lg:   "0 12px 44px rgba(0,0,0,.5)",
  glowCyan:  "0 0 20px rgba(0,212,255,.15)",
  glowGreen: "0 0 20px rgba(0,255,136,.12)",
  glowAmber: "0 0 20px rgba(245,158,11,.15)",
  glowRed:   "0 0 24px rgba(255,77,77,.2)",
  focus:     "0 0 0 1px rgba(0,212,255,.4), 0 0 20px rgba(0,212,255,.15)",
} as const;

// ── Gradients ─────────────────────────────────────────────────────────────────

export const GRADIENT = {
  brand: "linear-gradient(90deg, #00D4FF, #7AA7FF, #A855F7)",
  shield: "radial-gradient(circle, rgba(0,212,255,.22), transparent 60%)",
} as const;

// ── Terminal layout constants (character cells) ───────────────────────────────

export const TERM = {
  MIN_COLS: 80,
  MIN_ROWS: 24,
  COMFORT_COLS: 120,
  SIDEBAR_W: 22,
  INSPECTOR_W: 32,
  INSPECTOR_W_NARROW: 26,
  STATUS_H: 1,
  COMPOSER_H: 3,
  HEADER_H: 2,
  ICON_RAIL_W: 4,
  COMPACT_COLS: 96,
} as const;

// ── Density (row heights for web lists; TUI uses character rows) ───────────────

export const DENSITY = {
  compact: { rowH: 28, pad: 8 },
  default: { rowH: 36, pad: 12 },
  cozy:    { rowH: 44, pad: 16 },
} as const;

// ── Brand identity ────────────────────────────────────────────────────────────

export const BRAND_META = {
  name: "XR",
  tagline: "The AI Agent You Can Actually Trust",
  productLine: "AI Operating System",
  logoPath: "assets/logo.png",
  avatarPath: "assets/avatar.png",
  asciiWordmark: ["▀▄▀ █▀█", "█░█ █▀▄"] as const,
  voice: "precise, concise, technical-warm",
} as const;

// ── Status semantics ──────────────────────────────────────────────────────────

export type StatusKind = "ok" | "warn" | "error" | "info" | "active" | "idle" | "local" | "cloud";

export const STATUS_COLOR: Record<StatusKind, keyof typeof RGB> = {
  ok:     "success",
  warn:   "warning",
  error:  "error",
  info:   "primary",
  active: "primary",
  idle:   "muted",
  local:  "success",
  cloud:  "warning",
};

// ── CSS custom properties (Control Center + website) ──────────────────────────

export function cssVarsBlock(): string {
  return `:root {
  --xr-bg: ${COLOR.bg};
  --xr-bg-2: ${COLOR.bg2};
  --xr-surface: ${COLOR.surface};
  --xr-surface-2: ${COLOR.surface2};
  --xr-border: ${COLOR.border};
  --xr-border-2: ${COLOR.border2};
  --xr-text: ${COLOR.text};
  --xr-text-dim: ${COLOR.textDim};
  --xr-muted: ${COLOR.muted};
  --xr-primary: ${COLOR.primary};
  --xr-cyan: ${COLOR.cyan};
  --xr-violet: ${COLOR.violet};
  --xr-success: ${COLOR.success};
  --xr-green: ${COLOR.green};
  --xr-warning: ${COLOR.warning};
  --xr-amber: ${COLOR.amber};
  --xr-error: ${COLOR.error};
  --xr-red: ${COLOR.red};
  --xr-on-primary: ${COLOR.onPrimary};
  --xr-data-1: ${COLOR.data1};
  --xr-data-2: ${COLOR.data2};
  --xr-data-3: ${COLOR.data3};
  --xr-data-4: ${COLOR.data4};
  --xr-data-5: ${COLOR.data5};
  --xr-data-6: ${COLOR.data6};
  --xr-radius-sm: ${RADIUS.sm}px;
  --xr-radius: ${RADIUS.md}px;
  --xr-radius-lg: ${RADIUS.lg}px;
  --xr-radius-xl: ${RADIUS.xl}px;
  --xr-radius-full: ${RADIUS.full}px;
  --xr-space-1: ${SPACE[1]}px;
  --xr-space-2: ${SPACE[2]}px;
  --xr-space-3: ${SPACE[3]}px;
  --xr-space-4: ${SPACE[4]}px;
  --xr-space-5: ${SPACE[5]}px;
  --xr-space-6: ${SPACE[6]}px;
  --xr-space-8: ${SPACE[8]}px;
  --xr-space-12: ${SPACE[12]}px;
  --xr-dur-fast: ${MOTION.fastMs}ms;
  --xr-dur-base: ${MOTION.baseMs}ms;
  --xr-dur-slow: ${MOTION.slowMs}ms;
  --xr-font-mono: ${TYPE.fontMono};
  --xr-font-sans: ${TYPE.fontSans};
  --xr-font-display: ${TYPE.fontDisplay};
  --xr-fs-display: ${TYPE.display}px;
  --xr-fs-h1: ${TYPE.h1}px;
  --xr-fs-h2: ${TYPE.h2}px;
  --xr-fs-h3: ${TYPE.h3}px;
  --xr-fs-body: ${TYPE.body}px;
  --xr-fs-small: ${TYPE.small}px;
  --xr-fs-xs: ${TYPE.xs}px;
  --xr-fs-mono: ${TYPE.mono}px;
  --xr-fs-composer: ${TYPE.composer}px;
  --xr-shadow-sm: ${SHADOW.sm};
  --xr-shadow: ${SHADOW.md};
  --xr-shadow-lg: ${SHADOW.lg};
  --xr-glow-cyan: ${SHADOW.glowCyan};
  --xr-glow-green: ${SHADOW.glowGreen};
  --xr-glow-amber: ${SHADOW.glowAmber};
  --xr-glow-red: ${SHADOW.glowRed};
  --xr-focus: ${SHADOW.focus};
  --xr-gradient-brand: ${GRADIENT.brand};
  --xr-gradient-shield: ${GRADIENT.shield};
}`;
}

/** @deprecated Prefer cssVarsBlock(); kept for existing imports. */
export const CSS_VARS = cssVarsBlock();
