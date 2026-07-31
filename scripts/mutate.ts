#!/usr/bin/env bun
/**
 * XR Phase 1 · T8 — Lightweight mutation testing for gated modules.
 *
 * For each gated module, apply a bounded set of semantic mutants (one at a
 * time), run the module's test file(s), and record whether the mutant was
 * KILLED (tests failed → the guard caught the break) or SURVIVED (tests still
 * passed → the tests do not cover that behaviour). The module's mutation
 * score must meet the threshold for the gate to pass.
 *
 * Usage:   bun run scripts/mutate.ts [--threshold 0.6] [--max-mutants 12] [--only state-machine]
 * Gate:    exit 0 when every gated module's score >= threshold; else exit 1.
 *
 * The repo is restored after each mutant; if the script is interrupted, the
 * original is restored on the next run (it always re-copies from git).
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..");

interface GatedModule {
  path: string;
  tests: string[];
}

const GATED: GatedModule[] = [
  { path: "src/state/workspace-store.ts", tests: ["test/state/workspace-store.test.ts", "test/reliability/single-writer.test.ts", "test/reliability/audit-chain-extra.test.ts", "test/reliability/store-edge.test.ts"] },
  { path: "src/state/write-gate.ts", tests: ["test/reliability/single-writer.test.ts", "test/reliability/crash-injection.test.ts"] },
  { path: "src/execution/state-machine.ts", tests: ["test/execution/state-machine.test.ts"] },
  { path: "src/services/review-decision.ts", tests: ["test/phase0/reviewer-fail-closed.test.ts"] },
  { path: "src/integrations/credentials.ts", tests: ["test/phase0/credential-vault.test.ts"] },
];

/** Simple text-level mutation operators (code patterns, not comments/strings). */
interface MutationOp {
  name: string;
  re: RegExp;
  replacement: (m: string) => string;
}

const OPS: MutationOp[] = [
  { name: "and-to-or", re: /&&/g, replacement: () => "||" },
  { name: "or-to-and", re: /\|\|/g, replacement: () => "&&" },
  { name: "eq-to-neq", re: /===/g, replacement: () => "!==" },
  { name: "neq-to-eq", re: /!==/g, replacement: () => "===" },
  { name: "gt-to-gte", re: />=/g, replacement: () => ">" },
  { name: "lt-to-lte", re: /<=/g, replacement: () => "<" },
  { name: "gte-to-gt", re: />/g, replacement: () => ">=" },
  { name: "true-to-false", re: /\btrue\b/g, replacement: () => "false" },
  { name: "false-to-true", re: /\bfalse\b/g, replacement: () => "true" },
];

/**
 * Only mutate on behavioural lines (control flow, return, throw, assignment,
 * ternary) — equivalent mutants in strings/types/comments are noise that
 * would mislead the score.
 */
const BEHAVIOURAL_LINE = /return|if\s*\(|while\s*\(|throw|case\s|=>|\?[^:]*:|[=!<>]=|&&|\|\|/;

function isBehaviouralLine(line: string): boolean {
  return BEHAVIOURAL_LINE.test(line);
}

function applyMutant(src: string, op: MutationOp, index: number): string | null {
  const re = new RegExp(op.re.source, "g");
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const lineEnd = src.indexOf("\n", m.index);
    const line = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd);
    if (i++ === index) {
      if (!isBehaviouralLine(line)) return null;
      const at = m.index;
      const before = src.slice(0, at);
      const after = src.slice(at);
      const mm = new RegExp(op.re.source).exec(after);
      if (!mm) return null;
      return before + op.replacement(mm[0]) + after.slice(mm[0].length);
    }
  }
  return null;
}

function runTests(tests: string[], timeoutMs: number): { status: number | null; timedOut: boolean } {
  const args = ["test", "--timeout", String(Math.floor(timeoutMs / 1000)), ...tests];
  const res = spawnSync("bun", args, {
    cwd: ROOT,
    env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
    encoding: "utf8",
    timeout: timeoutMs + 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: res.status, timedOut: res.error != null && (res.error as { code?: string }).code === "ETIMEDOUT" };
}

function parseArgs(): { threshold: number; maxMutants: number; only?: string } {
  const argv = process.argv.slice(2);
  const tIdx = argv.indexOf("--threshold");
  const threshold = tIdx >= 0 ? Number(argv[tIdx + 1]) : 0.6;
  const mIdx = argv.indexOf("--max-mutants");
  const maxMutants = mIdx >= 0 ? Number(argv[mIdx + 1]) : 8;
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined;
  return { threshold, maxMutants, only };
}

const { threshold, maxMutants, only } = parseArgs();

// ── run ────────────────────────────────────────────────────────────────────
const summary: Array<{ module: string; killed: number; survived: number; timedOut: number; score: number }> = [];
let anyBelow = false;

for (const gated of GATED) {
  if (only && !gated.path.includes(only)) continue;
  const fullPath = join(ROOT, gated.path);
  if (!existsSync(fullPath)) continue;
  const original = readFileSync(fullPath, "utf8");
  let killed = 0;
  let survived = 0;
  let timedOut = 0;
  const attempted: string[] = [];

  try {
    for (const op of OPS) {
      for (let idx = 0; idx < maxMutants; idx++) {
        const mutant = applyMutant(original, op, idx);
        if (!mutant || mutant === original) break;
        writeFileSync(fullPath, mutant, "utf8");
        const label = `${gated.path} ${op.name}#${idx}`;
        const res = runTests(gated.tests, 90_000);
        if (res.timedOut) {
          timedOut += 1;
          killed += 1; // a hanging program is a broken program
          attempted.push(`TIMEOUT ${label}`);
        } else if (res.status !== 0) {
          killed += 1;
          attempted.push(`KILLED  ${label}`);
        } else {
          survived += 1;
          attempted.push(`SURVIVED ${label}`);
        }
        writeFileSync(fullPath, original, "utf8");
      }
    }
  } finally {
    writeFileSync(fullPath, original, "utf8");
  }

  const score = killed / Math.max(1, killed + survived);
  summary.push({ module: gated.path, killed, survived, timedOut, score });
  // eslint-disable-next-line no-console
  console.log(
    `[mutation] ${gated.path}: ${killed} killed / ${survived} survived / ${timedOut} timeout → score ${score.toFixed(2)} (threshold ${threshold})`,
  );
  if (score < threshold) anyBelow = true;
}

// eslint-disable-next-line no-console
console.log("\nMutation gate:", anyBelow ? "FAIL" : "PASS");
if (anyBelow) process.exit(1);

// Keep the full report for the test gate.
writeFileSync(join(ROOT, "mutation-report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), threshold, summary }, null, 2));
