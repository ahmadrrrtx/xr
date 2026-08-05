#!/usr/bin/env bun
/**
 * XR Phase 9 · T4 — cross-platform test parity computation (single authority).
 *
 * "Supported" means validated (Art. XX.4): each OS runs typecheck + its full
 * unit suite + the golden path from ONE computation. This script resolves the
 * suite per OS as:
 *
 *   suite(os) = (every `test` glob `.test.ts`) − (exclusions named for os)
 *
 * so a test can never vanish silently: exclusions live in ONE manifest, each
 * with a reason and `since` tag. Linux (reference) runs everything.
 *
 *   bun run scripts/platform-parity.ts --os win32 --args   # files to run
 *   bun run scripts/platform-parity.ts --os darwin --json  # machine report
 *   bun run scripts/platform-parity.ts --validate          # CI gate
 *
 * --validate (CI): every exclusion must (1) match ≥1 existing file, (2) carry
 * a reason, (3) not exclude on every OS (a test excluded everywhere is dead
 * weight — delete it or fix it). Fails closed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "./release-manifest.ts";

export type SupportedOs = "linux" | "darwin" | "win32";
export const SUPPORTED_OSES: SupportedOs[] = ["linux", "darwin", "win32"];

export interface Exclusion {
  pattern: string;
  excludeOn: SupportedOs[];
  since: string;
  reason: string;
}

export interface ExclusionsManifest {
  exclusions: Exclusion[];
}

export function loadExclusions(root: string = ROOT): ExclusionsManifest {
  const path = join(root, "test", "platform", "exclusions.json");
  if (!existsSync(path)) throw new Error(`exclusions manifest missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ExclusionsManifest;
  if (!Array.isArray(parsed.exclusions)) throw new Error("exclusions.manifest must be an array");
  return parsed;
}

export function listTestFiles(root: string = ROOT): string[] {
  const testDir = join(root, "test");
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (["fixtures", "helpers", "platform"].includes(entry)) continue;
        walk(full);
      } else if (entry.endsWith(".test.ts")) {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(testDir);
  return out.sort();
}

function matches(file: string, pattern: string): boolean {
  if (pattern.endsWith("/")) return file.startsWith(pattern);
  return file === pattern;
}

export function resolveSuite(os: SupportedOs, root: string = ROOT): { included: string[]; excluded: Array<{ pattern: string; reason: string }> } {
  const manifest = loadExclusions(root);
  const files = listTestFiles(root);
  const excluded: Array<{ pattern: string; reason: string }> = [];
  const activePatterns: string[] = [];
  for (const ex of manifest.exclusions) {
    if (ex.excludeOn.includes(os)) {
      activePatterns.push(ex.pattern);
      excluded.push({ pattern: ex.pattern, reason: ex.reason });
    }
  }
  const included = files.filter((f) => !activePatterns.some((p) => matches(f, p)));
  return { included, excluded };
}

export interface ParityReport {
  total: number;
  perOs: Record<SupportedOs, { run: number; excluded: number }>;
}

export function parityReport(root: string = ROOT): ParityReport {
  const files = listTestFiles(root);
  const perOs = {} as ParityReport["perOs"];
  for (const os of SUPPORTED_OSES) {
    const suite = resolveSuite(os, root);
    perOs[os] = { run: suite.included.length, excluded: suite.excluded.length };
  }
  return { total: files.length, perOs };
}

/** CI gate: fail closed on any malformed or OS-dead exclusion. */
export function validateExclusions(root: string = ROOT): string[] {
  const manifest = loadExclusions(root);
  const files = listTestFiles(root);
  const problems: string[] = [];
  for (const ex of manifest.exclusions) {
    if (!ex.reason || ex.reason.trim().length < 20) {
      problems.push(`${ex.pattern}: exclusion needs a real reason (≥20 chars) — no silent skips (Art. XX.5)`);
    }
    if (!Array.isArray(ex.excludeOn) || ex.excludeOn.length === 0) {
      problems.push(`${ex.pattern}: excludeOn must name at least one OS`);
    }
    for (const os of ex.excludeOn ?? []) {
      if (!SUPPORTED_OSES.includes(os)) problems.push(`${ex.pattern}: unknown OS "${os}"`);
    }
    if (Array.isArray(ex.excludeOn) && ex.excludeOn.length >= SUPPORTED_OSES.length) {
      problems.push(`${ex.pattern}: excluded on every OS — fix or delete the test instead of hiding it`);
    }
    const hits = files.filter((f) => matches(f, ex.pattern));
    if (hits.length === 0) {
      problems.push(`${ex.pattern}: matches no test file — stale exclusion (delete it)`);
    }
  }
  return problems;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  if (process.argv.includes("--validate")) {
    const problems = validateExclusions();
    if (problems.length > 0) {
      for (const p of problems) console.error(`[platform-parity] FAIL — ${p}`);
      process.exit(1);
    }
    const report = parityReport();
    console.log(
      `[platform-parity] ok — ${report.total} test files · ` +
        SUPPORTED_OSES.map((os) => `${os}:${report.perOs[os].run}`).join(" · "),
    );
    return;
  }
  const os = arg("--os") as SupportedOs | undefined;
  if (!os || !SUPPORTED_OSES.includes(os)) {
    console.error(`usage: --os ${SUPPORTED_OSES.join("|")} [--args|--json] | --validate`);
    process.exit(2);
  }
  const suite = resolveSuite(os);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ os, run: suite.included.length, excludedFiles: suite.excluded }, null, 2));
    return;
  }
  if (process.argv.includes("--args")) {
    console.log(suite.included.join(" "));
    return;
  }
  console.log(suite.included.join("\n"));
}

if (import.meta.main) {
  main();
}
