/**
 * XR 3.1 — Avatar rendering system
 *
 * Renders the official XR avatar for terminal and web surfaces.
 * Uses ANSI art for terminal, PNG references for web.
 *
 * States: idle, listening, thinking, speaking, working, error, complete
 *
 * Spec: XR_DESIGN_SYSTEM.md §12
 */

import { A, xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold } from "./theme.ts";
import { COLOR, RGB } from "./tokens.ts";

// ── Avatar State Types ──────────────────────────────────────────────────────

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "working" | "error" | "complete";

export interface AvatarRenderOptions {
  width?: number;       // Terminal width in chars (default: 20)
  height?: number;      // Terminal height in lines (default: 10)
  showLabel?: boolean;  // Show state label below avatar
  compact?: boolean;    // Compact mode (icon + label only)
  state: AvatarState;
}

// ── State Colors ────────────────────────────────────────────────────────────

const STATE_COLORS = {
  idle:       { fg: RGB.violet,   bg: [20, 15, 30] as const, glyph: "○" },
  listening:  { fg: RGB.primary,  bg: [0, 30, 40] as const, glyph: "◉" },
  thinking:   { fg: RGB.violet,   bg: [25, 15, 40] as const, glyph: "◌" },
  speaking:   { fg: RGB.primary,  bg: [0, 40, 50] as const, glyph: "●" },
  working:    { fg: RGB.violet,   bg: [20, 20, 40] as const, glyph: "⟳" },
  error:      { fg: RGB.error,    bg: [40, 10, 10] as const, glyph: "!" },
  complete:   { fg: RGB.success,  bg: [0, 30, 20] as const, glyph: "✓" },
} as const;

// ── Terminal Avatar Art ──────────────────────────────────────────────────────

// Compact avatar (single character + label) for sidebar/header
export function renderCompactAvatar(state: AvatarState, label?: string): string {
  const colors = STATE_COLORS[state];
  const rgb = colors.fg;
  const glyph = colors.glyph;

  const base = `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${glyph}`;
  const reset = `${A.reset}`;

  if (label) {
    return `${base} ${xrDim(label)}${reset}`;
  }

  return `${base}${reset}`;
}

// Small avatar for status bars (icon only)
export function renderIconAvatar(state: AvatarState): string {
  const colors = STATE_COLORS[state];
  const rgb = colors.fg;

  return `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${A.bgRgb(colors.bg[0], colors.bg[1], colors.bg[2])}●${A.reset}`;
}

// Medium avatar with state visual (for header area)
export function renderHeaderAvatar(state: AvatarState): string[] {
  const colors = STATE_COLORS[state];
  const rgb = colors.fg;
  const bg = colors.bg;

  // Simple 3-line avatar representation for header
  const frame = (text: string, bgOverride?: number[]) => {
    const bgColor = bgOverride ?? bg;
    return `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${A.bgRgb(bgColor[0], bgColor[1], bgColor[2])}${text}${A.reset}`;
  };

  // Avatar visual varies by state
  const visuals = {
    idle: [
      frame(" ● "),
      frame("● ●"),
      frame(" ● "),
    ],
    listening: [
      frame(" ◉ ", [0, 40, 60]),
      frame("◉ ◉", [0, 35, 55]),
      frame(" ◉ ", [0, 40, 60]),
    ],
    thinking: [
      frame(" ◈ ", [30, 15, 50]),
      frame("◈ ◈", [25, 10, 45]),
      frame(" ◈ ", [30, 15, 50]),
    ],
    speaking: [
      frame(" ● ", [0, 50, 60]),
      frame("● ●", [0, 45, 55]),
      frame(" ● ", [0, 50, 60]),
    ],
    working: [
      frame(" ⟳ ", [25, 25, 50]),
      frame("⟳⟳⟳", [20, 20, 45]),
      frame(" ⟳ ", [25, 25, 50]),
    ],
    error: [
      frame(" ! ", [50, 10, 10]),
      frame("! !", [45, 5, 5]),
      frame(" ! ", [50, 10, 10]),
    ],
    complete: [
      frame(" ✓ ", [0, 40, 25]),
      frame("✓ ✓", [0, 35, 20]),
      frame(" ✓ ", [0, 40, 25]),
    ],
  };

  const lines = (visuals[state] ?? visuals.idle);
  const label = state.charAt(0).toUpperCase() + state.slice(1);

  return [
    ...lines.slice(0, 2),
    `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${A.bgRgb(bg[0], bg[1], bg[2])} ${A.reset}${A.fgRgb(rgb[0], rgb[1], rgb[2])}${label}${A.reset}`,
    lines[2] ?? "",
  ];
}

// Large avatar for full display (welcome screen, voice mode)
export function renderLargeAvatar(state: AvatarState, customLabel?: string): string[] {
  const colors = STATE_COLORS[state];
  const rgb = colors.fg;
  const bg = colors.bg;

  const frame = (text: string, fgOverride?: number[], bgOverride?: number[]) => {
    const fg = fgOverride ?? rgb;
    const bgColor = bgOverride ?? bg;
    return `${A.fgRgb(fg[0], fg[1], fg[2])}${A.bgRgb(bgColor[0], bgColor[1], bgColor[2])}${text}${A.reset}`;
  };

  // Larger avatar representation (5 lines)
  const visuals = {
    idle: [
      frame("    ╭─────╮    "),
      frame("    │ ● │    "),
      frame("    │● ●│    "),
      frame("    │ ● │    "),
      frame("    ╰─────╯    "),
    ],
    listening: [
      frame("    ╭─────╮    ", undefined, [0, 35, 55]),
      frame("    │ ◉ │    ", undefined, [0, 40, 60]),
      frame("    │◉ ◉│    ", undefined, [0, 35, 55]),
      frame("    │ ◉ │    ", undefined, [0, 40, 60]),
      frame("    ╰─────╯    ", undefined, [0, 35, 55]),
    ],
    thinking: [
      frame("    ╭─────╮    ", undefined, [25, 10, 45]),
      frame("    │ ◌ │    ", undefined, [30, 15, 50]),
      frame("    │◌ ◌│    ", undefined, [25, 10, 45]),
      frame("    │ ◌ │    ", undefined, [30, 15, 50]),
      frame("    ╰─────╯    ", undefined, [25, 10, 45]),
    ],
    speaking: [
      frame("    ╭─────╮    ", undefined, [0, 45, 55]),
      frame("    │ ● │    ", undefined, [0, 50, 60]),
      frame("    │● ●│    ", undefined, [0, 45, 55]),
      frame("    │ ● │    ", undefined, [0, 50, 60]),
      frame("    ╰─────╯    ", undefined, [0, 45, 55]),
    ],
    working: [
      frame("    ╭─────╮    ", undefined, [15, 15, 40]),
      frame("    │ ⟳ │    ", undefined, [20, 20, 45]),
      frame("    │⟳⟳⟳│    ", undefined, [15, 15, 40]),
      frame("    │ ⟳ │    ", undefined, [20, 20, 45]),
      frame("    ╰─────╯    ", undefined, [15, 15, 40]),
    ],
    error: [
      frame("    ╭─────╮    ", undefined, [40, 5, 5]),
      frame("    │ ! │    ", undefined, [50, 10, 10]),
      frame("    │! !│    ", undefined, [40, 5, 5]),
      frame("    │ ! │    ", undefined, [50, 10, 10]),
      frame("    ╰─────╯    ", undefined, [40, 5, 5]),
    ],
    complete: [
      frame("    ╭─────╮    ", undefined, [0, 30, 15]),
      frame("    │ ✓ │    ", undefined, [0, 40, 25]),
      frame("    │✓ ✓│    ", undefined, [0, 30, 15]),
      frame("    │ ✓ │    ", undefined, [0, 40, 25]),
      frame("    ╰─────╯    ", undefined, [0, 30, 15]),
    ],
  };

  const lines = (visuals[state] ?? visuals.idle);
  const label = customLabel ?? state.charAt(0).toUpperCase() + state.slice(1);

  return [
    ...lines.slice(0, 3),
    `${A.fgRgb(rgb[0], rgb[1], rgb[2])}${label}${A.reset}`,
    ...lines.slice(3),
  ];
}

// ── Web Avatar Helpers ───────────────────────────────────────────────────────

// Returns config for web avatar rendering (used by dashboard)
export function getWebAvatarConfig(state: AvatarState): {
  emoji: string;
  color: string;
  bgColor: string;
  glowColor: string;
  label: string;
} {
  const colors = STATE_COLORS[state];
  const rgb = colors.fg;

  return {
    emoji: colors.glyph,
    color: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    bgColor: `rgb(${colors.bg[0]}, ${colors.bg[1]}, ${colors.bg[2]})`,
    glowColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.3)`,
    label: state.charAt(0).toUpperCase() + state.slice(1),
  };
}

// ── Avatar State Helpers ─────────────────────────────────────────────────────

/** Get display label for a state */
export function avatarStateLabel(state: AvatarState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/** Check if state is active (not idle) */
export function isStateActive(state: AvatarState): boolean {
  return state !== "idle";
}

/** Get animation hint for state (for web CSS) */
export function avatarAnimationHint(state: AvatarState): string | null {
  const hints: Record<AvatarState, string | null> = {
    idle: "subtle-pulse",
    listening: "listening-wave",
    thinking: "thinking-bob",
    speaking: "speaking-breathe",
    working: "working-rotate",
    error: "error-shake",
    complete: "complete-pop",
  };
  return hints[state];
}

// ── Official Avatar Reference ────────────────────────────────────────────────

/**
 * The official XR avatar is stored at:
 *   - assets/avatar.png (front-facing, primary)
 *   - assets/avatar-side.png (side angle)
 *
 * For terminal, we render stylized ANSI representations.
 * For web/dashboard, use the PNG directly with CSS overlays for state.
 *
 * The avatar should ALWAYS be recognizable as XR.
 * State is communicated through:
 *   - Color changes (subtle)
 *   - Expression/pose changes (in PNG variants)
 *   - Label text below
 *   - Animation (web only)
 */

export const AVATAR_META = {
  primaryPath: "assets/avatar.png",
  sidePath: "assets/avatar-side.png",
  fullBodyPath: "assets/avatar-fullbody.png",
  terminalFallback: "XR",
  tagline: "The AI Agent You Can Actually Trust",
} as const;
