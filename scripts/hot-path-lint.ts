#!/usr/bin/env bun
/**
 * XR Phase 3 · T3 — Hot-path sync-I/O lint.
 *
 * Enforces "no synchronous FS/process I/O on hot paths" (Article XII · Rule 4)
 * for the CLI FAST PATH: `--version`, `--help`, `xr <cmd> --help`, `shell`
 * and `serve` route through these modules, and every command boot passes
 * through them. Zero sync calls are permitted here.
 *
 * Tier-2 (informational): the kernel-boot files are inventoried and counted,
 * with the owned exceptions documented in docs/perf/PERF-BUDGETS.md (config
 * substrate single-file read, workspace-state sync fallback for standalone
 * consumers, scan-cache payload read, SQLite substrate). The hard
 * enforcement for those paths is the event-loop stall detector
 * (src/core/stall-detector.ts) + the golden-path stall test.
 *
 * Exit code 1 on any Tier-1 violation. Runs in CI.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const SYNC_FS = /\b(readFileSync|writeFileSync|appendFileSync|existsSync|statSync|lstatSync|readdirSync|mkdirSync|rmSync|copyFileSync|renameSync|unlinkSync|chmodSync|realpathSync|readlinkSync|truncateSync|opendirSync|createReadStream|createWriteStream)\b/;
const SYNC_PROC = /\b(spawnSync|execSync|execFileSync|forkSync)\b/;

/**
 * Tier-1: the CLI fast path + route decision + lazy-loading glue. These
 * modules must never perform synchronous FS/process I/O — they are the hot
 * path every invocation pays, and the measurable zero-claim.
 */
export const FAST_PATH_FILES: string[] = [
  "src/index.ts",
  "src/cli/router.ts",
  "src/cli/flags.ts",
  "src/cli/output.ts",
  "src/cli/errors.ts",
  "src/cli/catalog.ts",
  "src/cli/help.ts",
  "src/cli/route-decision.ts",
  "src/cli/command-loaders.ts",
  "src/cli/kernel-boot.ts",
  "src/core/version.ts",
  "src/core/boot-trace.ts",
  "src/core/stall-detector.ts",
];

/**
 * Tier-2: kernel boot modules. Inventoried + counted; owned exceptions are
 * documented and enforced indirectly via stall detection.
 */
export const BOOT_PATH_FILES: string[] = [
  "src/core/app.ts",
  "src/core/kernel.ts",
  "src/core/workspace.ts",
  "src/core/provider-modules.ts",
  "src/core/providers/state.ts",
  "src/core/providers/config.ts",
  "src/core/providers/llm.ts",
  "src/core/providers/intelligence.ts",
  "src/core/providers/budget.ts",
  "src/core/providers/plugins.ts",
  "src/core/providers/mcp.ts",
  "src/core/providers/skills.ts",
  "src/core/providers/capabilities.ts",
  "src/core/providers/trust.ts",
  "src/core/providers/execution.ts",
  "src/core/providers/context.ts",
  "src/core/providers/agent.ts",
  "src/core/providers/multi-agents.ts",
  "src/core/providers/shield.ts",
  "src/core/providers/business.ts",
  "src/config/config.ts",
  "src/state/workspace-store.ts",
  "src/state/write-gate.ts",
  "src/util/scan-cache.ts",
  "src/skills/loader-runtime.ts",
  "src/skills/marketplace.ts",
  "src/skills/marketplace-store.ts",
  "src/plugins/manager.ts",
  "src/security/shield.ts",
];

export interface LintFinding {
  file: string;
  line: number;
  call: string;
}

export function scanFile(rel: string): LintFinding[] {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  const findings: LintFinding[] = [];
  const lines = readFileSync(abs, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comment lines (documentation of exceptions is allowed).
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const re of [SYNC_FS, SYNC_PROC]) {
      const m = re.exec(line);
      if (m) findings.push({ file: rel, line: i + 1, call: m[0] });
    }
  }
  return findings;
}

export function lintFastPath(): LintFinding[] {
  const all: LintFinding[] = [];
  for (const f of FAST_PATH_FILES) all.push(...scanFile(f));
  return all;
}

export function inventoryBootPath(): { file: string; count: number }[] {
  return BOOT_PATH_FILES.map((f) => ({ file: f, count: scanFile(f).length })).filter((x) => x.count > 0);
}

if (import.meta.main) {
  const findings = lintFastPath();
  if (findings.length > 0) {
    console.error(`❌ HOT-PATH SYNC I/O VIOLATIONS (${findings.length}):`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.call}`);
    console.error("\nFast-path modules must perform zero synchronous FS/process I/O (Article XII).");
    process.exit(1);
  }
  console.log("✅ fast path: 0 sync FS/process calls across the hot-path modules.");
  const inv = inventoryBootPath();
  const total = inv.reduce((a, b) => a + b.count, 0);
  console.log(`boot-path sync-call inventory (owned exceptions, see docs/perf/PERF-BUDGETS.md): ${total}`);
  for (const i of inv) console.log(`  ${i.file}: ${i.count}`);
}
