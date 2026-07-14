/**
 * XR 3.1 — Reusable TUI design primitives
 *
 * These are the terminal render targets for Component Standards.
 * Future interfaces (CLI banners, dashboard string builders, website)
 * should map to the same semantic structure.
 *
 * Spec: docs/xr-3.1/XR-3.1-COMPONENT-STANDARDS.md
 */

import {
  xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, xrViolet, xrSelected,
  SPINNER_FRAMES, BAR_FILLED, BAR_EMPTY, BAR_HEAD, A,
} from "./theme.ts";
import { padAnsi, clipAnsi, visibleLength, hline, boxLines, wrapAnsi } from "./ansi.ts";
import { icon, statusMark, type GlyphId } from "./icons.ts";

// ── Badge ─────────────────────────────────────────────────────────────────────

export type BadgeTone = "cyan" | "green" | "amber" | "red" | "gray" | "violet";

export function badge(text: string, tone: BadgeTone = "cyan"): string {
  const paint =
    tone === "green"  ? xrGreen :
    tone === "amber"  ? xrAmber :
    tone === "red"    ? xrRed :
    tone === "violet" ? xrViolet :
    tone === "gray"   ? xrDim :
    xrCyan;
  return paint(`[${text}]`);
}

// ── Status dot ────────────────────────────────────────────────────────────────

export function statusDot(kind: "ok" | "warn" | "error" | "active" | "idle" | "local" | "cloud"): string {
  switch (kind) {
    case "ok":
    case "local":  return xrGreen("●");
    case "warn":
    case "cloud":  return xrAmber("●");
    case "error":  return xrRed("●");
    case "active": return xrCyan("●");
    default:       return xrDim("○");
  }
}

// ── Button (TUI selection style) ──────────────────────────────────────────────

export function button(label: string, opts?: { primary?: boolean; selected?: boolean; danger?: boolean }): string {
  if (opts?.danger) {
    const inner = `[ ${label} ]`;
    return opts.selected ? xrBold(xrRed(inner)) : xrRed(inner);
  }
  if (opts?.primary || opts?.selected) {
    return xrBold(xrCyan(`[ ${label} ]`));
  }
  return xrDim(`[ ${label} ]`);
}

// ── Progress bar ──────────────────────────────────────────────────────────────

export function progressBar(pct: number, width = 24, label?: string): string {
  const p = Math.max(0, Math.min(1, pct));
  const filled = Math.floor(p * width);
  const empty = width - filled - (filled < width ? 1 : 0);
  const bar =
    xrCyan(BAR_FILLED.repeat(filled)) +
    (filled < width ? xrCyan(BAR_HEAD) : "") +
    xrDim(BAR_EMPTY.repeat(Math.max(0, empty)));
  const pctStr = xrGreen(`${Math.floor(p * 100)}%`.padStart(4));
  const lab = label ? `  ${xrDim(label)}` : "";
  return `[${bar}] ${pctStr}${lab}`;
}

// ── Spinner frame ─────────────────────────────────────────────────────────────

export function spinnerFrame(index: number, label?: string): string {
  const f = SPINNER_FRAMES[index % SPINNER_FRAMES.length] ?? "·";
  return label ? `${xrCyan(f)} ${label}` : xrCyan(f);
}

// ── Divider ───────────────────────────────────────────────────────────────────

export function divider(width: number, label?: string): string {
  if (!label) return xrDim(hline(width));
  const inner = ` ${label} `;
  const sides = Math.max(0, width - visibleLength(inner));
  const left = Math.floor(sides / 2);
  const right = sides - left;
  return xrDim(hline(left)) + xrCyan(inner) + xrDim(hline(right));
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function emptyState(heading: string, sub?: string, action?: string): string[] {
  const lines = [
    "",
    xrDim(icon("info", "dim") + "  " + heading),
  ];
  if (sub) lines.push(xrDim("   " + sub));
  if (action) lines.push(xrCyan("   → " + action));
  lines.push("");
  return lines;
}

// ── Error state ───────────────────────────────────────────────────────────────

export function errorState(title: string, detail?: string, remediation?: string): string[] {
  const lines = [
    `${statusMark("error")} ${xrBold(title)}`,
  ];
  if (detail) lines.push(...wrapAnsi(xrDim(detail), 60).map((l) => "  " + l));
  if (remediation) lines.push(xrCyan("  → " + remediation));
  return lines;
}

// ── Success state ─────────────────────────────────────────────────────────────

export function successState(title: string, detail?: string): string[] {
  const lines = [`${statusMark("ok")} ${xrBold(title)}`];
  if (detail) lines.push(xrDim("  " + detail));
  return lines;
}

// ── Keyboard hint ─────────────────────────────────────────────────────────────

export function keyHint(binding: string, label: string): string {
  return `${xrCyan(binding)} ${xrDim(label)}`;
}

export function keyHintRow(hints: Array<[string, string]>, width: number): string {
  const parts = hints.map(([k, v]) => keyHint(k, v));
  return clipAnsi(parts.join(xrDim(" · ")), width);
}

// ── List row ──────────────────────────────────────────────────────────────────

export function listRow(
  label: string,
  opts: {
    selected?: boolean;
    active?: boolean;
    meta?: string;
    width: number;
    index?: number;
  },
): string {
  const marker = opts.selected ? xrCyan("›") : opts.active ? xrGreen("●") : xrDim(" ");
  const text = opts.selected ? xrBold(xrCyan(label)) : opts.active ? xrBold(label) : label;
  const meta = opts.meta ? xrDim(" " + opts.meta) : "";
  return clipAnsi(`${marker} ${text}${meta}`, opts.width);
}

// ── Section header ────────────────────────────────────────────────────────────

export function sectionHeader(label: string): string {
  return xrDim(label.toUpperCase());
}

// ── Nav item (sidebar) ────────────────────────────────────────────────────────

export function navItem(
  g: GlyphId,
  label: string,
  opts: { active?: boolean; focused?: boolean; width: number; iconOnly?: boolean },
): string {
  const gStr = icon(g, opts.active ? "cyan" : "dim");
  if (opts.iconOnly) {
    const cell = opts.active ? xrSelected(` ${gStr} `) : ` ${gStr} `;
    return padAnsi(cell, opts.width);
  }
  const marker = opts.active ? " " : opts.focused ? xrAmber("›") : " ";
  // Active: cyan left accent via selected styling
  const body = opts.active
    ? xrSelected(padAnsi(`${gStr} ${xrBold(xrCyan(label))}`, opts.width - 1))
    : padAnsi(`${gStr} ${label}`, opts.width - 1);
  return clipAnsi(`${opts.active ? xrCyan("▌") : marker}${body}`, opts.width);
}

// ── Toast line ────────────────────────────────────────────────────────────────

export function toastLine(level: "ok" | "warn" | "error" | "info", message: string, width: number): string {
  const mark = statusMark(level);
  return clipAnsi(`${mark} ${message}`, width);
}

// ── Tool call chip ────────────────────────────────────────────────────────────

export function toolCallLine(
  name: string,
  argsPreview: string,
  status: "running" | "done" | "error" | "pending",
  width: number,
  spinnerIdx = 0,
): string {
  const st =
    status === "done"    ? statusMark("ok") :
    status === "error"   ? statusMark("error") :
    status === "pending" ? statusMark("warn") :
    spinnerFrame(spinnerIdx);
  const line = `${icon("terminal", "cyan")} ${xrBold(name)} ${xrDim(argsPreview)}  ${st}`;
  return clipAnsi(line, width);
}

// ── Message prefix ────────────────────────────────────────────────────────────

export function messagePrefix(role: "user" | "assistant" | "system"): string {
  if (role === "user") return xrCyan("you");
  if (role === "assistant") return xrGreen("xr");
  return xrDim("sys");
}

// ── Card / box ────────────────────────────────────────────────────────────────

export function card(title: string, body: string[], width: number, focus = false): string[] {
  const color = focus ? xrCyan : xrDim;
  return boxLines(xrBold(title), body, width, { color });
}

// ── Composer prompt ───────────────────────────────────────────────────────────

export function composerPrompt(mode: string, busy: boolean): string {
  const modeChip = busy ? xrAmber("busy") : xrCyan(mode);
  return `${xrBold(xrCyan("xr"))} ${xrDim("[")}${modeChip}${xrDim("]")} ${xrCyan("›")}`;
}

// ── Status bar builder ────────────────────────────────────────────────────────

export interface StatusChip {
  label: string;
  value: string;
  tone?: "green" | "amber" | "red" | "cyan" | "dim";
}

export function statusBar(chips: StatusChip[], width: number, center?: string): string {
  const paint = (c: StatusChip) => {
    const v =
      c.tone === "green" ? xrGreen(c.value) :
      c.tone === "amber" ? xrAmber(c.value) :
      c.tone === "red"   ? xrRed(c.value) :
      c.tone === "cyan"  ? xrCyan(c.value) :
      c.value;
    return c.label ? `${xrDim(c.label)} ${v}` : v;
  };
  const left = chips.map(paint).join(xrDim(" · "));
  if (!center) return clipAnsi(left, width);
  const leftW = visibleLength(left);
  const centerW = visibleLength(center);
  const gap = Math.max(1, width - leftW - centerW - 1);
  return clipAnsi(left + " ".repeat(gap) + xrDim(center), width);
}

// ── Overlay frame ─────────────────────────────────────────────────────────────

export function overlayFrame(
  title: string,
  body: string[],
  cols: number,
  rows: number,
  maxWidth = 72,
): string[] {
  const contentW = Math.min(maxWidth, cols - 8);
  const boxed = boxLines(xrBold(title), body.map((l) => clipAnsi(l, contentW - 4)), contentW, { color: xrCyan });
  const padTop = Math.max(1, Math.floor((rows - boxed.length) / 2));
  const padLeft = Math.max(2, Math.floor((cols - contentW) / 2));
  const out: string[] = [];
  for (let i = 0; i < padTop; i++) out.push("");
  for (const row of boxed) out.push(" ".repeat(padLeft) + row);
  return out;
}

// ── Help overlay body ─────────────────────────────────────────────────────────

export function helpBindings(width: number): string[] {
  const rows: Array<[string, string]> = [
    ["Ctrl+K", "Command palette"],
    ["Ctrl+N", "Notifications"],
    ["Ctrl+W", "Workspace picker"],
    ["Ctrl+J", "Quick actions"],
    ["g then d/c/s/w/r/…", "Go-to navigation"],
    ["/", "Focus composer"],
    ["?", "This help"],
    ["Tab", "Cycle panels / complete"],
    ["Esc", "Dismiss / interrupt / back"],
    ["Ctrl+C", "Interrupt generation"],
    ["Ctrl+L", "Clear chat view"],
    ["Alt+P", "Model picker"],
    ["Shift+Tab", "Cycle mode (agent/plan/ask)"],
    ["Ctrl+D", "Exit (empty input)"],
  ];
  return rows.map(([k, v]) => clipAnsi(`${xrCyan(k.padEnd(22))} ${xrDim(v)}`, width));
}
