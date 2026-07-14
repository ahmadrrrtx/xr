/**
 * XR 3.1 — ANSI text utilities
 *
 * Visible-width-aware string ops for terminal rendering.
 * All width calculations strip CSI sequences correctly.
 */

import { A } from "./theme.ts";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\r/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

export function visibleLength(input: string): number {
  return stripAnsi(input).length;
}

export function padAnsi(input: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const len = visibleLength(input);
  if (len >= width) return clipAnsi(input, width);
  const pad = width - len;
  if (align === "right") return " ".repeat(pad) + input;
  if (align === "center") {
    const l = Math.floor(pad / 2);
    return " ".repeat(l) + input + " ".repeat(pad - l);
  }
  return input + " ".repeat(pad);
}

export function clipAnsi(input: string, width: number, ellipsis = true): string {
  if (width <= 0) return "";
  if (visibleLength(input) <= width) return input;
  if (!ellipsis || width === 1) return sliceVisible(input, width);
  return sliceVisible(input, width - 1) + "…";
}

/** Slice by visible characters, preserving ANSI codes that precede content. */
export function sliceVisible(input: string, maxVisible: number): string {
  if (maxVisible <= 0) return "";
  let out = "";
  let visible = 0;
  let i = 0;
  while (i < input.length && visible < maxVisible) {
    if (input[i] === "\x1b") {
      // consume full escape sequence
      const rest = input.slice(i);
      const m = rest.match(/^\x1b\[[0-9;?]*[a-zA-Z]|^\x1b\][^\x07]*(?:\x07|\x1b\\)|^\x1b[()][0-9A-B]/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
      out += input[i];
      i++;
      continue;
    }
    out += input[i];
    visible++;
    i++;
  }
  // close open styles
  out += A.reset;
  return out;
}

export function hline(width: number, ch = "─"): string {
  return ch.repeat(Math.max(0, width));
}

export function wrapAnsi(text: string, width: number): string[] {
  if (width <= 4) return [clipAnsi(text, width)];
  const input = text.replace(/\r/g, "");
  const out: string[] = [];
  for (const rawLine of input.split("\n")) {
    const plain = stripAnsi(rawLine);
    if (plain.length === 0) {
      out.push("");
      continue;
    }
    // Prefer word wrap on plain text, then re-apply full line when short
    if (visibleLength(rawLine) <= width) {
      out.push(rawLine);
      continue;
    }
    const words = plain.split(/(\s+)/);
    let line = "";
    for (const word of words) {
      if (!word) continue;
      const next = line + word;
      if (next.length <= width) {
        line = next;
      } else {
        if (line.trim()) out.push(line.trimEnd());
        if (word.length > width) {
          for (let i = 0; i < word.length; i += width) {
            out.push(word.slice(i, i + width));
          }
          line = "";
        } else {
          line = word.trimStart();
        }
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out.length ? out : [""];
}

export function resetAnsi(): string {
  return A.reset;
}

/** Build a box panel with title. Returns array of lines (ANSI-safe). */
export function boxLines(
  title: string,
  lines: string[],
  width: number,
  opts?: { color?: (s: string) => string; focus?: boolean },
): string[] {
  const paint = opts?.color ?? ((s: string) => s);
  const inner = Math.max(8, width - 4);
  const titleVis = visibleLength(title);
  const headFill = Math.max(0, inner - titleVis - 2);
  const head = paint(`┌─ `) + title + paint(` ${"─".repeat(headFill)}┐`);
  const body = lines.map((line) => {
    const clipped = padAnsi(clipAnsi(line, inner), inner);
    return paint("│ ") + clipped + paint(" │");
  });
  const foot = paint(`└${"─".repeat(inner + 2)}┘`);
  return [head, ...body, foot];
}

/** Center a block of lines within a viewport. */
export function centerBlock(lines: string[], cols: number, rows: number): string[] {
  const contentW = Math.max(...lines.map(visibleLength), 1);
  const padLeft = Math.max(0, Math.floor((cols - contentW) / 2));
  const padTop = Math.max(0, Math.floor((rows - lines.length) / 2));
  const out: string[] = [];
  for (let i = 0; i < padTop; i++) out.push("");
  for (const line of lines) out.push(" ".repeat(padLeft) + line);
  while (out.length < rows) out.push("");
  return out.slice(0, rows);
}
