/**
 * XR Stage 5 — Terminal Layout Primitives
 *
 * Provides: banner, dividers, boxes, status lines, panels, tables, badges,
 * and help surfaces — all built from the theme design system.
 *
 * Philosophy:
 *  - Every visual element traces back to a theme token
 *  - Graceful wrap at 80 cols
 *  - Accessible text-only fallback when !isTTY
 *  - No emoji in structural chrome (only in content labels where meaningful)
 */

import { A, xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, SYM, BRAND } from "./theme.ts";

const W = 80; // terminal width target

// ── XR ASCII Logo ─────────────────────────────────────────────────────────────

const LOGO_LINES = [
  `  ${A.fgRgb(0,212,255)}▀▄▀ █▀█${A.reset}`,
  `  ${A.fgRgb(0,212,255)}█░█ █▀▄${A.reset}`,
];

export function banner(subtitle?: string): void {
  const sub = subtitle ?? `${xrDim("by @rrrtx · local-first · BYOK · spend-capped · secure")}`;
  console.log(`
${LOGO_LINES[0]}  ${xrBold("XR")} ${xrCyan("—")} ${xrBold("The AI Agent You Can Actually Trust")}
${LOGO_LINES[1]}  ${sub}
`);
}

// ── Compact One-Line Banner ───────────────────────────────────────────────────

export function miniBanner(): void {
  // Shows both logo lines inline as a compact prefix
  process.stdout.write(`${A.fgRgb(0,212,255)}▀▄▀ █▀█${A.reset}  ${xrBold("XR")} ${xrCyan("—")} ${xrDim("local-first · secure · spend-capped")}\n`);
  process.stdout.write(`${A.fgRgb(0,212,255)}█░█ █▀▄${A.reset}\n`);
}

// ── Dividers ──────────────────────────────────────────────────────────────────

export function divider(label?: string): void {
  if (!label) {
    console.log(`  ${xrDim("─".repeat(W - 4))}`);
    return;
  }
  const inner  = ` ${label} `;
  const total  = W - 4;
  const sides  = Math.max(0, total - inner.length);
  const left   = Math.floor(sides / 2);
  const right  = sides - left;
  console.log(`  ${xrDim("─".repeat(left))}${xrCyan(inner)}${xrDim("─".repeat(right))}`);
}

export function section(label: string): void {
  console.log(`\n  ${xrBold(xrCyan(label))}`);
  console.log(`  ${xrDim("─".repeat(Math.min(label.length + 2, W - 4)))}`);
}

// ── Status Line ───────────────────────────────────────────────────────────────

interface StatusPart {
  label: string;
  value: string;
  color?: string;
}

export function statusLine(parts: StatusPart[]): void {
  const segments = parts.map(p => {
    const val = p.color === "green"  ? xrGreen(p.value)
              : p.color === "amber"  ? xrAmber(p.value)
              : p.color === "red"    ? xrRed(p.value)
              : p.color === "cyan"   ? xrCyan(p.value)
              : xrDim(p.value);
    return `${xrDim(p.label + ":")} ${val}`;
  });
  console.log(`  ${segments.join("  │  ")}`);
}

// ── Key-Value Row ─────────────────────────────────────────────────────────────

export function kv(
  key:    string,
  value:  string,
  status?: "ok" | "warn" | "error" | "dim" | "cyan",
): void {
  const padded = key.padEnd(22, " ");
  const val    = status === "ok"    ? xrGreen(value)
               : status === "warn"  ? xrAmber(value)
               : status === "error" ? xrRed(value)
               : status === "cyan"  ? xrCyan(value)
               : xrDim(value);
  console.log(`  ${xrDim(padded)} ${val}`);
}

// ── Box ───────────────────────────────────────────────────────────────────────

export function box(title: string, lines: string[], color: "cyan" | "green" | "amber" | "red" = "cyan"): void {
  const colFn = color === "green" ? xrGreen : color === "amber" ? xrAmber : color === "red" ? xrRed : xrCyan;
  const inner  = W - 6;
  const top    = colFn("┌") + colFn("─".repeat(2)) + ` ${xrBold(title)} ` + colFn("─".repeat(Math.max(0, inner - title.length - 2))) + colFn("┐");
  const bottom = colFn("└") + colFn("─".repeat(inner + 2)) + colFn("┘");
  console.log(`  ${top}`);
  for (const line of lines) {
    const truncated = line.length > inner ? line.slice(0, inner - 1) + "…" : line;
    const pad       = " ".repeat(Math.max(0, inner - stripAnsi(line).length));
    console.log(`  ${colFn("│")} ${truncated}${pad} ${colFn("│")}`);
  }
  console.log(`  ${bottom}`);
}

// ── Inline Badge ──────────────────────────────────────────────────────────────

export function badge(text: string, color: "cyan" | "green" | "amber" | "red" | "gray" = "cyan"): string {
  const c = color === "green" ? A.fgRgb(0,255,136)
          : color === "amber" ? A.fgRgb(245,158,11)
          : color === "red"   ? A.fgRgb(255,77,77)
          : color === "gray"  ? A.dim
          : A.fgRgb(0,212,255);
  return `${c}[${text}]${A.reset}`;
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function table(
  headers: string[],
  rows:    string[][],
  opts?: { widths?: number[]; alignRight?: number[] },
): void {
  const widths = opts?.widths ?? headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => stripAnsi(r[i] ?? "").length)) + 2
  );
  const alignRight = new Set(opts?.alignRight ?? []);

  const hdrRow = headers.map((h, i) => {
    const w = widths[i] ?? 12;
    return xrCyan(h.padEnd(w));
  }).join("  ");
  console.log(`  ${hdrRow}`);
  console.log(`  ${xrDim(widths.map(w => "─".repeat(w)).join("  "))}`);

  for (const row of rows) {
    const cells = row.map((cell, i) => {
      const w    = widths[i] ?? 12;
      const bare = stripAnsi(cell);
      const pad  = " ".repeat(Math.max(0, w - bare.length));
      return alignRight.has(i) ? pad + cell : cell + pad;
    }).join("  ");
    console.log(`  ${cells}`);
  }
}

// ── Help Panel ────────────────────────────────────────────────────────────────

export interface HelpCommand {
  name:        string;
  args?:       string;
  description: string;
  example?:    string;
  tag?:        "power" | "common" | "security" | "local";
}

export function helpPanel(title: string, commands: HelpCommand[]): void {
  section(title);
  for (const cmd of commands) {
    const args  = cmd.args ? ` ${xrDim(cmd.args)}` : "";
    const tag   = cmd.tag === "power"    ? badge("power",    "amber")
                : cmd.tag === "security" ? badge("security", "red")
                : cmd.tag === "local"    ? badge("local",    "green")
                : "";
    const tagPad = tag ? `  ${tag}` : "";
    console.log(`  ${xrCyan(cmd.name)}${args}${tagPad}`);
    console.log(`    ${xrDim(cmd.description)}`);
    if (cmd.example) {
      console.log(`    ${A.dim}e.g.  ${xrDim("$")} ${cmd.example}${A.reset}`);
    }
  }
}

// ── Notification ──────────────────────────────────────────────────────────────

export function notify(
  type:    "info" | "ok" | "warn" | "error",
  message: string,
  detail?: string,
): void {
  const icon = type === "ok"    ? SYM.ok
             : type === "warn"  ? SYM.warn
             : type === "error" ? SYM.error
             : SYM.info;
  console.log(`  ${icon} ${message}`);
  if (detail) console.log(`    ${xrDim(detail)}`);
}

// ── Confirm Prompt (visual) ───────────────────────────────────────────────────

export function promptLine(text: string): void {
  process.stdout.write(`  ${xrCyan("?")} ${text}  `);
}

// ── Tool Call Display ─────────────────────────────────────────────────────────

export function toolCallLine(
  name:   string,
  args:   Record<string, unknown>,
  status: "running" | "done" | "error" = "running",
): void {
  const statusStr = status === "done"  ? xrGreen("done")
                  : status === "error" ? xrRed("error")
                  : xrCyan("running");
  const argsStr   = Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${xrDim(k + "=")}${typeof v === "string" ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`)
    .join(" ");
  console.log(`  ${xrDim("│")} ${xrCyan("⚙")} ${xrBold(name)} ${argsStr}  ${statusStr}`);
}

// ── Empty State ───────────────────────────────────────────────────────────────

export function emptyState(entity: string, tip?: string): void {
  console.log(`\n  ${xrDim(`No ${entity} yet.`)}`);
  if (tip) console.log(`  ${xrDim(tip)}`);
}

// ── Error State ───────────────────────────────────────────────────────────────

export function errorState(message: string, recovery?: string): void {
  console.log(`\n  ${xrRed("✗")} ${xrBold(message)}`);
  if (recovery) console.log(`  ${xrDim(recovery)}`);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[mGKHABCDsufr]/g, "");
}
