/**
 * XR 3.1C — Professional CLI output layer
 *
 * Shares design language with Shell: tokens, glyphs, status vocabulary.
 * Human-readable by default; machine-readable with --json.
 *
 * Spec: docs/xr-3.1/XR-3.1-DESIGN-SYSTEM.md
 *       docs/xr-3.1/XR-3.1-COMPONENT-STANDARDS.md
 *       docs/xr-3.1/XR-3.1-ACCESSIBILITY-STANDARDS.md §4
 */

import {
  A,
  xrCyan,
  xrGreen,
  xrAmber,
  xrRed,
  xrDim,
  xrBold,
  xrViolet,
  getColorMode,
  SYM,
} from "../ui/theme.ts";
import { icon, statusMark, glyph } from "../ui/icons.ts";
import { banner as layoutBanner, miniBanner, divider as layoutDivider, section as layoutSection, kv as layoutKv, table as layoutTable, emptyState as layoutEmpty, errorState as layoutError } from "../ui/layout.ts";
import { Spinner, ProgressBar } from "../ui/spinner.ts";
import type { GlobalFlags, OutputFormat } from "./flags.ts";
import { isInteractive } from "./flags.ts";

// ── Session context ───────────────────────────────────────────────────────────

let _flags: GlobalFlags = {
  args: [],
  help: false,
  version: false,
  quiet: false,
  verbose: false,
  debug: false,
  json: false,
  yaml: false,
  format: "text",
  noColor: false,
  yes: false,
  dryRun: false,
  raw: [],
};

export function setOutputFlags(flags: GlobalFlags): void {
  _flags = flags;
  if (flags.noColor) process.env.NO_COLOR = "1";
  if (flags.debug) process.env.XR_DEBUG = "1";
}

export function getOutputFlags(): GlobalFlags {
  return _flags;
}

export function isJsonMode(): boolean {
  return _flags.json || _flags.format === "json";
}

export function isQuiet(): boolean {
  return _flags.quiet;
}

export function isVerbose(): boolean {
  return _flags.verbose || _flags.debug;
}

function useColor(): boolean {
  if (_flags.noColor) return false;
  if (!process.stdout.isTTY) return false;
  return getColorMode() !== "none";
}

// ── Core writers ──────────────────────────────────────────────────────────────

export function write(line = ""): void {
  if (isQuiet() && !isJsonMode()) return;
  console.log(line);
}

export function writeErr(line = ""): void {
  console.error(line);
}

export function writeStdout(data: string): void {
  process.stdout.write(data);
}

// ── Semantic lines (Shell-aligned) ────────────────────────────────────────────

export function ok(message: string, detail?: string): void {
  if (isJsonMode()) return;
  if (isQuiet()) return;
  console.log(`  ${statusMark("ok")} ${message}${detail ? xrDim("  " + detail) : ""}`);
}

export function warn(message: string, detail?: string): void {
  if (isJsonMode()) return;
  console.error(`  ${statusMark("warn")} ${xrAmber(message)}${detail ? xrDim("  " + detail) : ""}`);
}

export function error(message: string, detail?: string): void {
  if (isJsonMode()) return;
  console.error(`  ${statusMark("error")} ${xrRed(message)}${detail ? "\n    " + xrDim(detail) : ""}`);
}

export function info(message: string): void {
  if (isJsonMode() || isQuiet()) return;
  console.log(`  ${statusMark("info")} ${xrDim(message)}`);
}

export function success(message: string): void {
  if (isJsonMode() || isQuiet()) return;
  console.log(`  ${statusMark("ok")} ${xrBold(xrGreen(message))}`);
}

export function tip(message: string): void {
  if (isJsonMode() || isQuiet()) return;
  console.log(`  ${xrCyan("›")} ${xrDim(message)}`);
}

export function code(cmd: string, description?: string): void {
  if (isJsonMode() || isQuiet()) return;
  const desc = description ? `  ${xrDim(description)}` : "";
  console.log(`  ${xrCyan(cmd)}${desc}`);
}

export function heading(title: string): void {
  if (isJsonMode() || isQuiet()) return;
  console.log(`\n  ${xrBold(title)}`);
  console.log(`  ${xrDim("─".repeat(Math.min(title.length + 2, 46)))}`);
}

export function section(label: string): void {
  if (isJsonMode() || isQuiet()) return;
  layoutSection(label);
}

export function divider(label?: string): void {
  if (isJsonMode() || isQuiet()) return;
  layoutDivider(label);
}

export function kv(key: string, value: string, status?: "ok" | "warn" | "error" | "dim" | "cyan"): void {
  if (isJsonMode() || isQuiet()) return;
  layoutKv(key, value, status);
}

export function empty(entity: string, tipText?: string): void {
  if (isJsonMode() || isQuiet()) return;
  layoutEmpty(entity, tipText);
}

// ── Brand / banners ───────────────────────────────────────────────────────────

export function banner(subtitle?: string): void {
  if (isJsonMode() || isQuiet()) return;
  if (!isInteractive() && !process.stdout.isTTY) {
    console.log(`XR — ${subtitle ?? "The AI Agent You Can Actually Trust"}`);
    return;
  }
  layoutBanner(subtitle);
}

export function mini(): void {
  if (isJsonMode() || isQuiet()) return;
  miniBanner();
}

/**
 * One-line status header for interactive CLI (IA §10 / Navigation §6).
 * ● workspace  mode  provider/model
 */
export function statusHeader(opts: {
  workspace?: string;
  mode?: string;
  provider?: string;
  model?: string;
  spend?: number;
}): void {
  if (isJsonMode() || isQuiet() || !process.stdout.isTTY) return;
  const ws = opts.workspace ?? "default";
  const mode = opts.mode ?? "agent";
  const pm = [opts.provider, opts.model].filter(Boolean).join("/");
  const spend = opts.spend != null ? `  ${xrDim("$" + opts.spend.toFixed(4))}` : "";
  const modeColor =
    mode === "plan" ? xrViolet(mode) :
    mode === "ask"  ? xrDim(mode) :
    xrCyan(mode);
  console.log(
    `  ${xrGreen("●")} ${xrBold(ws)}  ${modeColor}${pm ? "  " + xrDim(pm) : ""}${spend}`,
  );
}

// ── Structured output ─────────────────────────────────────────────────────────

export function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function emitYaml(data: unknown): void {
  // Minimal YAML emitter (no dependency). Good enough for flat/nested objects.
  console.log(toYaml(data, 0));
}

function toYaml(value: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    if (/[:#\n\-]|"|'|^\s|\s$/.test(value) || value === "") {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (item !== null && typeof item === "object") {
          const body = toYaml(item, indent + 1);
          return `${pad}- ${body.replace(/^\s+/, "")}`;
        }
        return `${pad}- ${toYaml(item, 0)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === "object") {
          return `${pad}${k}:\n${toYaml(v, indent + 1)}`;
        }
        return `${pad}${k}: ${toYaml(v, 0)}`;
      })
      .join("\n");
  }
  return String(value);
}

/**
 * Emit data in the requested format. Text mode uses the provided renderer.
 */
export function emit(
  data: unknown,
  textRender?: () => void,
  format?: OutputFormat,
): void {
  const fmt = format ?? _flags.format;
  if (fmt === "json" || _flags.json) {
    emitJson(data);
    return;
  }
  if (fmt === "yaml" || _flags.yaml) {
    emitYaml(data);
    return;
  }
  if (textRender) textRender();
  else if (typeof data === "string") console.log(data);
  else emitJson(data);
}

// ── Tables ────────────────────────────────────────────────────────────────────

export function table(
  headers: string[],
  rows: string[][],
  opts?: { widths?: number[]; alignRight?: number[] },
): void {
  if (isJsonMode() || isQuiet()) return;
  layoutTable(headers, rows, opts);
}

// ── Spinners / progress ───────────────────────────────────────────────────────

export function spinner(label: string): Spinner {
  const s = new Spinner();
  if (!isQuiet() && !isJsonMode()) s.start(label);
  return s;
}

export function progress(total: number, label: string): ProgressBar {
  const p = new ProgressBar(total);
  if (!isQuiet() && !isJsonMode()) p.start(label);
  return p;
}

// ── Error display (What / Why / How) ──────────────────────────────────────────

export interface CliErrorShape {
  /** Short what-happened title. */
  what: string;
  /** Why it happened. */
  why?: string;
  /** How to fix it (one or more steps). */
  fix?: string | string[];
  /** Related command(s). */
  related?: string[];
  /** Exit code. */
  code?: number;
  /** Machine code (stable string id). */
  id?: string;
  /** Optional raw detail (only with --verbose/--debug). */
  detail?: string;
}

export function printError(err: CliErrorShape): void {
  if (isJsonMode()) {
    emitJson({
      ok: false,
      error: {
        id: err.id ?? "error",
        message: err.what,
        why: err.why,
        fix: err.fix,
        related: err.related,
        code: err.code ?? 1,
        detail: isVerbose() ? err.detail : undefined,
      },
    });
    return;
  }

  console.error();
  console.error(`  ${statusMark("error")} ${xrBold(err.what)}`);
  if (err.why) {
    console.error(`  ${xrDim("Why")}   ${err.why}`);
  }
  if (err.fix) {
    const fixes = Array.isArray(err.fix) ? err.fix : [err.fix];
    console.error(`  ${xrDim("Fix")}   ${fixes[0]}`);
    for (const f of fixes.slice(1)) console.error(`         ${f}`);
  }
  if (err.related?.length) {
    console.error(`  ${xrDim("See")}   ${err.related.map((c) => xrCyan(c)).join(xrDim(" · "))}`);
  }
  if (isVerbose() && err.detail) {
    console.error(`  ${xrDim("Detail")} ${err.detail}`);
  }
  console.error();
}

// ── Did-you-mean ──────────────────────────────────────────────────────────────

/** Levenshtein distance for typo correction. */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

export function didYouMean(input: string, candidates: string[], max = 3): string[] {
  const q = input.toLowerCase();
  return candidates
    .map((c) => ({ c, d: editDistance(q, c.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}

export function printDidYouMean(input: string, candidates: string[]): void {
  const suggestions = didYouMean(input, candidates);
  if (!suggestions.length || isJsonMode()) return;
  console.error(`  ${xrDim("Did you mean")}`);
  for (const s of suggestions) {
    console.error(`    ${xrCyan("xr " + s)}`);
  }
}

// ── First-run hint ────────────────────────────────────────────────────────────

export function firstRunHint(): void {
  if (isJsonMode() || isQuiet() || !process.stdout.isTTY) return;
  console.log();
  console.log(`  ${xrDim("New here?")}  ${xrCyan("xr onboarding")}  ${xrDim("·")}  ${xrCyan("xr doctor")}  ${xrDim("·")}  ${xrCyan("xr help")}`);
  console.log();
}

// ── Re-exports for command authors ────────────────────────────────────────────

export {
  xrCyan,
  xrGreen,
  xrAmber,
  xrRed,
  xrDim,
  xrBold,
  xrViolet,
  SYM,
  A,
  icon,
  statusMark,
  glyph,
};

export const colors = {
  cyan: xrCyan,
  green: xrGreen,
  amber: xrAmber,
  yellow: xrAmber,
  red: xrRed,
  dim: xrDim,
  bold: xrBold,
  violet: xrViolet,
  reset: A.reset,
} as const;
