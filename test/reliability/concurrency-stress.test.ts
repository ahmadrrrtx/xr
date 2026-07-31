/**
 * Phase 1 · T1/T2 — Concurrency stress: the audit chain must never break and
 * no write may be lost under N parallel writers against one XR_HOME.
 *
 * Before the Phase-1 fix the same harness (8 × 50) produced 6 "database is
 * locked" errors and a chain broken at entry 138 — see docs/phase-1/AUDIT_REPORT.md.
 * After the fix (WAL + busy_timeout + IMMEDIATE serialized append) it must be
 * 0 locked, 0 lost, chain valid.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { rmrf } from "./helpers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPRO = join(__dirname, "repro", "concurrency-repro.ts");

async function runRepro(writers: number, perWriter: number): Promise<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "xr-stress-"));
  const dbPath = join(dir, "xr.db");
  try {
    const res = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn("bun", ["run", REPRO, dbPath, String(writers), String(perWriter)], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => (stdout += String(d)));
        child.stderr.on("data", (d) => (stderr += String(d)));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    // Parse the compact JSON line (single line, starts with { and ends with }).
    const lines = res.stdout.trim().split("\n");
    const jsonLine = lines.find((l) => l.startsWith("{") && l.endsWith("}"));
    if (!jsonLine) throw new Error(`repro produced no JSON: ${res.stderr.slice(0, 500)}`);
    const parsed = JSON.parse(jsonLine) as Record<string, unknown>;
    // Attach worker diagnostics so a CI failure reports WHY writes were lost.
    (parsed as { __diag?: string }).__diag =
      `stderr=${res.stderr.slice(0, 400)} | errors=${JSON.stringify(parsed.errors ?? []).slice(0, 600)} | perWriter=${JSON.stringify(parsed.perWriterWritten ?? [])}`;
    return parsed;
  } finally {
    await rmrf(dir);
  }
}

describe("Phase 1 · concurrency-safe audit + SQLite", () => {
  test("8 writers × 50 writes → 0 locked, 0 lost, chain valid", async () => {
    const r = await runRepro(8, 50);
    const diag = (r as { __diag?: string }).__diag ?? "";
    expect(r.totalWritten, `totalWritten mismatch — ${diag}`).toBe(r.totalAttempted);
    expect(r.lockedErrors, `locked errors — ${diag}`).toBe(0);
    expect(r.otherErrors, `other worker errors — ${diag}`).toBe(0);
    expect(r.chainValid, `chain broke — ${diag}`).toBe(true);
  }, 120_000);

  test("12 writers × 120 writes (1440 concurrent appends) → chain intact", async () => {
    const r = await runRepro(12, 120);
    const diag = (r as { __diag?: string }).__diag ?? "";
    expect(r.totalWritten, `totalWritten mismatch — ${diag}`).toBe(r.totalAttempted);
    expect(r.lockedErrors, `locked errors — ${diag}`).toBe(0);
    expect(r.chainValid, `chain broke — ${diag}`).toBe(true);
  }, 180_000);

  test("mixed workload (sessions+steps+workflows+memory+cost) survives parallel writers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-mixed-"));
    const dbPath = join(dir, "xr.db");
    try {
      const worker = join(__dirname, "repro", "mixed-worker.ts");
      const writers = 8;
      const perWriter = 40;
      const procs = Array.from({ length: writers }, (_, i) =>
        new Promise<{ written: number; errors: string[] }>((resolve, reject) => {
          const child = spawn("bun", ["run", worker, dbPath, String(perWriter), String(i)], {
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
          });
          let out = "";
          let err = "";
          child.stdout.on("data", (d) => (out += String(d)));
          child.stderr.on("data", (d) => (err += String(d)));
          child.on("close", (code) => {
            if (code !== 0) return reject(new Error(err.slice(0, 300)));
            resolve(JSON.parse(out.trim().split("\n").pop()!));
          });
        }),
      );
      const results = await Promise.all(procs);
      const totalWritten = results.reduce((a, r) => a + r.written, 0);
      const errors = results.flatMap((r) => r.errors);
      expect(totalWritten).toBe(writers * perWriter * 5);
      expect(errors).toHaveLength(0);

      // Reopen and verify the full chain + consistency.
      const { WorkspaceStore } = await import("../../src/state/workspace-store.ts");
      const store = new WorkspaceStore("verify", dbPath);
      expect(store.verifyChain().valid).toBe(true);
      expect(store.auditCount()).toBe(writers * perWriter);
      expect(store.sessionStatusCounts().reduce((a, r) => a + r.c, 0)).toBe(writers * perWriter);
      store.close();
    } finally {
      await rmrf(dir);
    }
  }, 180_000);
});
