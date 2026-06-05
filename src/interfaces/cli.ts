/**
 * XR — professional terminal UI helpers.
 */
import type { ApprovalRequest } from "../core/types.ts";
import { createInterface } from "node:readline";

const C = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[33m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  reset: "\x1b[0m",
};

export function banner(): void {
  console.log(
    C.cyan(`
   ▀▄▀ █▀█
   █░█ █▀▄   ${C.dim("the AI agent you can actually trust · by rrrtx")}
`),
  );
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

/** Read one line from stdin with a prompt. */
async function readLine(promptText: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Ask a question and get a string response. */
export async function ask(promptText: string, options?: { default?: string }): Promise<string> {
  const suffix = options?.default ? ` ${C.dim(`(${options.default})`)}` : "";
  return await readLine(`${C.cyan(promptText)}${suffix} `) || options?.default || "";
}

/** Masked input for sensitive keys using Node's readline and a custom stream. */
export async function password(promptText: string): Promise<string> {
  const { Writable } = await import("node:stream");
  
  const mutableStdout = new Writable({
    write: function(chunk, encoding, callback) {
      if (!(this as any).muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    }
  });

  const rl = createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  });

  process.stdout.write(C.cyan(promptText) + " ");
  (mutableStdout as any).muted = true;

  return new Promise((resolve) => {
    rl.question("", (answer) => {
      (mutableStdout as any).muted = false;
      console.log(); // New line after entry
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Yes/No confirmation. */
export async function confirm(promptText: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n]" : " [y/N]";
  const result = await readLine(`${C.cyan(promptText)}${C.dim(suffix)} `);
  if (!result) return defaultYes;
  return result.toLowerCase().startsWith("y");
}


/** Budget overrun prompt: fail closed unless the user explicitly continues. */
export async function overBudgetPrompt(message: string): Promise<boolean> {
  console.log(C.amber(`💰 BUDGET CHECK: ${message}`));
  return await confirm("   Continue anyway?", false);
}

/** Interactive approval prompt. */
export async function approvePrompt(req: ApprovalRequest): Promise<boolean> {
  console.log("");
  console.log(C.amber(`🔒 ACTION REQUIRES APPROVAL`));
  console.log(`   tool:   ${C.bold(req.tool)}`);
  console.log(`   reason: ${req.reason}`);
  const ans = (await confirm("   Approve this action?", true));
  console.log(ans ? C.green("   → approved") : C.red("   → denied"));
  return ans;
}

export { C as colors };
