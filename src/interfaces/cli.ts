/**
 * XR — terminal UI helpers (banner, colored output, approval prompt).
 * No heavy TUI deps yet (keeping the dependency tree tiny — TRD dep policy).
 */
import type { ApprovalRequest } from "../core/types.ts";

const C = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function banner(): void {
  console.log(
    C.cyan(`
   ▀▄▀ █▀█
   █░█ █▀▄   ${C.dim("the AI agent you can actually trust · by rrrtx")}
`),
  );
}

export function say(line: string): void {
  console.log(line);
}

export function info(line: string): void {
  console.log(C.dim(line));
}

export function warn(line: string): void {
  console.log(C.amber("! " + line));
}

export function ok(line: string): void {
  console.log(C.green("✓ " + line));
}

/** Read one line from stdin. */
async function readLine(promptText: string): Promise<string> {
  process.stdout.write(promptText);
  for await (const line of (console as any)) {
    return String(line).trim();
  }
  return "";
}

/** 
 * Ask a question and get a string response.
 */
export async function ask(promptText: string, options?: { default?: string }): Promise<string> {
  const suffix = options?.default ? ` ${C.dim(`(${options.default})`)}` : "";
  const result = await readLine(`${C.cyan(promptText)}${suffix} `);
  return result || options?.default || "";
}

/**
 * Masked input for sensitive keys.
 */
export async function password(promptText: string): Promise<string> {
  // Since perfect terminal masking is tricky without dependencies in Bun,
  // we use a simple approach: warn the user.
  process.stdout.write(C.cyan(promptText) + " " + C.dim("(input visible) ") );
  for await (const line of (console as any)) {
    return String(line).trim();
  }
  return "";
}

/**
 * Yes/No confirmation.
 */
export async function confirm(promptText: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const result = await readLine(`${C.cyan(promptText)}${C.dim(suffix)} `);
  if (!result) return defaultYes;
  return result.toLowerCase().startsWith("y");
}

/**
 * Over-budget prompt (the Cost Governor moment).
 * Returns extra budget to add, or null to stop.
 */
export async function overBudgetPrompt(
  meter: string,
  reason: string,
): Promise<{ usd?: number; tokens?: number } | null> {
  console.log("");
  console.log(C.amber("⏸ PAUSED — budget guard"));
  console.log("   " + meter);
  console.log("   " + C.dim(reason));
  console.log(`   ${C.amber("[c]")}ontinue (raise ceiling)   ${C.amber("[s]")}top here`);
  const ans = (await readLine(C.amber("   ? "))).toLowerCase();
  if (ans === "c" || ans === "continue") {
    const amt = (await readLine(C.cyan("   raise spend ceiling by $ (default 0.25): "))).trim();
    const usd = Number(amt) || 0.25;
    console.log(C.green(`   → ceiling raised by $${usd}`));
    // Also grant a generous token headroom so token-capped tasks can continue.
    return { usd, tokens: 250_000 };
  }
  console.log(C.red("   → stopping"));
  return null;
}

export { C as colors };
