/**
 * XR Stage 5 — CLI Terminal Helpers
 *
 * Single source of truth for all terminal output formatting in CLI mode.
 * Wraps the theme system with high-level output helpers.
 *
 * Changes from previous version:
 *  - All ANSI codes now route through src/ui/theme.ts tokens
 *  - banner() shows the full XR logo with subtitle
 *  - Added: success(), tip(), code(), progress()
 *  - Masked password input via Writable stream (unchanged, working)
 *  - approvePrompt() redesigned to show full context before confirming
 *  - overBudgetPrompt() redesigned with clear current vs proposed display
 */

import type { ApprovalRequest } from "../core/types.ts";
import { createInterface }      from "node:readline";
import { A, xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, SYM } from "../ui/theme.ts";
import { banner as layoutBanner, divider, kv, notify } from "../ui/layout.ts";

// ── Public Banner ─────────────────────────────────────────────────────────────

export function banner(subtitle?: string): void {
  layoutBanner(subtitle);
}

// ── Output Primitives ─────────────────────────────────────────────────────────

export function info(line: string):    void { console.log(xrDim(line)); }
export function warn(line: string):    void { console.log(`  ${SYM.warn} ${xrAmber(line)}`); }
export function ok(line: string):      void { console.log(`  ${SYM.ok} ${xrGreen(line)}`); }
export function error(line: string):   void { console.log(`  ${SYM.error} ${xrRed(line)}`); }
export function success(line: string): void { console.log(`  ${SYM.ok} ${xrBold(xrGreen(line))}`); }
export function tip(line: string):     void { console.log(`  ${xrCyan("›")} ${xrDim(line)}`); }

/** Print an inline code reference */
export function code(cmd: string, description?: string): void {
  const desc = description ? `  ${xrDim(description)}` : "";
  console.log(`  ${xrCyan(cmd)}${desc}`);
}

/** Print a section heading */
export function heading(title: string): void {
  console.log(`\n  ${xrBold(title)}`);
  console.log(`  ${xrDim("─".repeat(title.length + 2))}`);
}

// ── Readline ──────────────────────────────────────────────────────────────────

async function readLine(promptText: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(promptText, answer => { rl.close(); resolve(answer.trim()); });
  });
}

/** Ask a question and return a string response. */
export async function ask(promptText: string, options?: { default?: string }): Promise<string> {
  const suffix = options?.default ? ` ${xrDim(`(${options.default})`)}` : "";
  return (await readLine(`  ${xrCyan("?")} ${promptText}${suffix} `)) || options?.default || "";
}

/** Masked input for API keys / passwords. */
export async function password(promptText: string): Promise<string> {
  const { Writable } = await import("node:stream");

  const mutableOut = new Writable({
    write(chunk, encoding, cb) {
      if (!(this as any).muted) process.stdout.write(chunk, encoding as BufferEncoding);
      cb();
    },
  });

  const rl = createInterface({
    input:    process.stdin,
    output:   mutableOut,
    terminal: true,
  });

  process.stdout.write(`  ${xrCyan("🔑")} ${promptText} `);
  (mutableOut as any).muted = true;

  return new Promise(resolve => {
    rl.question("", answer => {
      (mutableOut as any).muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Yes/No confirmation — defaults shown clearly. */
export async function confirm(promptText: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? xrDim(" [Y/n]") : xrDim(" [y/N]");
  const result = await readLine(`  ${xrCyan("?")} ${promptText}${suffix} `);
  if (!result) return defaultYes;
  return result.toLowerCase().startsWith("y");
}

// ── Approval Prompt ───────────────────────────────────────────────────────────

/**
 * Interactive approval prompt — shown before any action that requires consent.
 * Never bypasses security policy. Shows the full context of the request.
 */
export async function approvePrompt(req: ApprovalRequest): Promise<boolean> {
  console.log();
  console.log(`  ${xrAmber("⚠")}  ${xrBold("Action requires your approval")}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrDim("Tool:")}    ${xrBold(req.tool)}`);
  console.log(`  ${xrDim("Reason:")}  ${req.reason}`);
  if (req.args) {
    const argsPreview = JSON.stringify(req.args).slice(0, 120);
    console.log(`  ${xrDim("Args:")}    ${xrDim(argsPreview)}${argsPreview.length >= 120 ? "…" : ""}`);
  }
  console.log(`  ${xrDim("─".repeat(46))}`);

  const approved = await confirm("Approve this action?", true);
  console.log(approved ? `  ${SYM.ok} ${xrGreen("Approved")}` : `  ${SYM.error} ${xrRed("Denied")}`);
  console.log();
  return approved;
}

// ── Budget Overrun Prompt ─────────────────────────────────────────────────────

/**
 * Called when the next step would exceed the spend ceiling.
 * Returns additional budget to grant, or null to stop the task.
 * Fails closed: null = stop.
 */
export async function overBudgetPrompt(
  meter:  string,
  reason: string,
): Promise<{ usd?: number; tokens?: number } | null> {
  console.log();
  console.log(`  ${SYM.budget}  ${xrBold(xrAmber("Budget ceiling reached"))}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrDim("Reason:")} ${reason}`);
  console.log(`  ${xrDim("Meter:")}  ${meter}`);
  console.log(`  ${xrDim("─".repeat(46))}`);
  console.log(`  ${xrDim("The agent will stop here. You can raise the ceiling for this run.")}`);

  const raise = await confirm("Raise the budget for this task?", false);
  if (!raise) {
    console.log(`  ${SYM.ok} ${xrGreen("Stopped safely. Budget respected.")}`);
    return null;
  }

  const usd    = await ask("Extra USD to add (0 = skip)", { default: "0" });
  const tokens = await ask("Extra tokens to add (0 = skip)", { default: "0" });
  const extra  = {
    usd:    Number.parseFloat(usd)    || 0,
    tokens: Number.parseInt(tokens, 10) || 0,
  };

  if (extra.usd > 0 || extra.tokens > 0) {
    console.log(`  ${SYM.ok} Budget raised by ${xrGreen("$" + extra.usd.toFixed(4))} / ${xrGreen(extra.tokens.toLocaleString() + " tokens")}`);
    return extra;
  }

  console.log(`  ${SYM.ok} ${xrGreen("No change. Stopping safely.")}`);
  return null;
}

// ── Re-export theme colors for convenience ────────────────────────────────────

export const colors = {
  cyan:    xrCyan,
  green:   xrGreen,
  amber:   xrAmber,
  yellow:  xrAmber,
  red:     xrRed,
  dim:     xrDim,
  bold:    xrBold,
  reset:   A.reset,
} as const;
