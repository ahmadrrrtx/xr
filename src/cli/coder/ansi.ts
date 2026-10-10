/**
 * Phase 23 — minimal ANSI styling for the coding agent. No chalk / ora / Ink:
 * plain escape codes, switched off when colour is disabled. Every string that
 * can carry meaning also carries a text marker (the design system's a11y rule).
 */

export interface Painter {
  readonly enabled: boolean;
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
  /** Code-block background: a muted 256-colour grey (readable on dark and light). */
  tint(s: string): string;
}

const RESET = "\x1b[0m";

export function makePainter(enabled: boolean): Painter {
  const wrap = (code: string) => (s: string) => (enabled ? `${code}${s}${RESET}` : s);
  return {
    enabled,
    bold: wrap("\x1b[1m"),
    dim: wrap("\x1b[2m"),
    red: wrap("\x1b[31m"),
    green: wrap("\x1b[32m"),
    yellow: wrap("\x1b[33m"),
    cyan: wrap("\x1b[36m"),
    gray: wrap("\x1b[90m"),
    tint: (s) => (enabled ? `\x1b[48;5;235m${s}\x1b[K${RESET}` : s),
  };
}

/** Strip CSI sequences (for width math and plain-text capture). */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

/** Visible width of a string (no wide-char tables: good enough for prompts). */
export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/** Collapse whitespace and shorten to `max` characters with an ellipsis. */
export function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`;
}
