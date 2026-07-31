/**
 * Concurrency hazard reproduction (Phase 1, STEP 1).
 *
 * Spawns N worker processes, each opening its own SQLite connection to the
 * SAME database file (exactly what happens when N `xr` invocations, or the
 * daemon + CLI, share one XR_HOME), and hammers the audit hash-chain append
 * concurrently. Then asserts:
 *   - how many writers hit "database is locked"
 *   - whether the audit chain remains intact (0 breaks)
 *
 * Run BEFORE the Phase-1 fix to capture the broken baseline, and AFTER the
 * fix to prove it is gone:
 *   bun test/test-reliability/run-repro.ts (or directly via bun run)
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER = join(__dirname, "worker.ts");

export interface ReproResult {
  writers: number;
  writesPerWriter: number;
  totalAttempted: number;
  totalWritten: number;
  lockedErrors: number;
  otherErrors: number;
  chainValid: boolean;
  chainBrokenAt?: number;
  perWriterWritten: number[];
  errors: string[];
}

export async function runConcurrencyRepro(opts: {
  writers?: number;
  writesPerWriter?: number;
  dbPath?: string;
  workerTimeoutMs?: number;
} = {}): Promise<ReproResult> {
  const writers = opts.writers ?? 8;
  const writesPerWriter = opts.writesPerWriter ?? 50;
  const dir = opts.dbPath
    ? undefined
    : mkdtempSync(join(tmpdir(), "xr-repro-"));
  const dbPath = opts.dbPath ?? join(dir!, "xr.db");
  const workerTimeoutMs = opts.workerTimeoutMs ?? 120_000;

  const workers = Array.from({ length: writers }, (_, i) =>
    spawn("bun", ["run", WORKER, dbPath, String(writesPerWriter), String(i)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
    }),
  );

  const results = await Promise.all(
    workers.map(
      (w, i) =>
        new Promise<{ written: number; errors: string[] }>((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          const timer = setTimeout(() => {
            w.kill("SIGKILL");
            reject(new Error(`worker ${i} timed out`));
          }, workerTimeoutMs);
          w.stdout.on("data", (d) => (stdout += String(d)));
          w.stderr.on("data", (d) => (stderr += String(d)));
          w.on("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
          w.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) {
              reject(new Error(`worker ${i} exited ${code}: ${stderr.trim()}`));
              return;
            }
            try {
              resolve(JSON.parse(stdout.trim().split("\n").pop()!));
            } catch {
              reject(new Error(`worker ${i} bad output: ${stdout.slice(0, 400)}`));
            }
          });
        }),
    ),
  );

  // Verify chain + lock errors from a fresh read-only connection.
  const { verify } = await import("./verify.ts");
  const chain = verify(dbPath);

  const allErrors = results.flatMap((r) => r.errors);
  const locked = allErrors.filter((e) => e.includes("database is locked") || e.includes("SQLITE_BUSY")).length;

  return {
    writers,
    writesPerWriter,
    totalAttempted: writers * writesPerWriter,
    totalWritten: results.reduce((a, r) => a + r.written, 0),
    lockedErrors: locked,
    otherErrors: allErrors.length - locked,
    chainValid: chain.valid,
    chainBrokenAt: chain.brokenAt,
    perWriterWritten: results.map((r) => r.written),
    errors: allErrors.slice(0, 20),
  };
}

async function main(): Promise<void> {
  // CLI: <dbPath> <writers> <writesPerWriter> — used by the test suite.
  const dbPath = process.argv[2];
  const writers = process.argv[3] ? Number(process.argv[3]) : undefined;
  const writesPerWriter = process.argv[4] ? Number(process.argv[4]) : undefined;
  const result = await runConcurrencyRepro({ dbPath, writers, writesPerWriter });
  console.log(JSON.stringify(result));
  const bad = !result.chainValid || result.lockedErrors > 0 || result.totalWritten !== result.totalAttempted;
  if (bad) {
    console.error("\nREPRODUCED: concurrency hazard present (chain breaks / locked errors / lost writes).");
    process.exit(1);
  }
  console.log("\nOK: no chain breaks, no locked errors, no lost writes.");
  process.exit(0);
}

if (import.meta.main) {
  await main();
}
