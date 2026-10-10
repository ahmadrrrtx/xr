/**
 * XR coder CLI — ANSI styling and terminal helpers.
 *
 * No chalk/ink. Colors are on only for a TTY stdout, and are off when
 * NO_COLOR is set or --no-color was passed (the flag parser sets NO_COLOR).
 * Call `initStyle()` once at startup; the default is off so importing this
 * module never changes output.
 */

let enabled = false;

export function initStyle(opts: { isTTY: boolean; noColor: boolean }): void {
  enabled = opts.isTTY && !opts.noColor && !process.env.NO_COLOR;
}

export function colorEnabled(): boolean {
  return enabled;
}

function wrap(open: string, close: string): (s: string) => string {
  return (s: string) => (enabled ? `${open}${s}${close}` : s);
}

export const style = {
  bold: wrap("\x1b[1m", "\x1b[22m"),
  dim: wrap("\x1b[2m", "\x1b[22m"),
  cyan: wrap("\x1b[36m", "\x1b[39m"),
  green: wrap("\x1b[32m", "\x1b[39m"),
  red: wrap("\x1b[31m", "\x1b[39m"),
  yellow: wrap("\x1b[33m", "\x1b[39m"),
  gray: wrap("\x1b[90m", "\x1b[39m"),
  codeBg: wrap("\x1b[48;5;235m", "\x1b[49m"),
};

/** Terminal width clamped to a readable range (80 when unknown). */
export function termWidth(): number {
  const cols = process.stdout.columns ?? 80;
  return Math.max(40, Math.min(cols, 160));
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Write to stdout without a trailing newline. */
export function out(s: string): void {
  process.stdout.write(s);
}

/** Write a line to stderr (status/progress; keeps stdout clean for pipes). */
export function err(s: string): void {
  process.stderr.write(`${s}\n`);
}
