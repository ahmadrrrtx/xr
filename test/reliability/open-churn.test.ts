/**
 * CF-1 regression — connection-OPEN churn across processes.
 *
 * The hosted-runner failure was `database is locked` on the connection open
 * path (399/400 writes in the 8×50 stress test). That test keeps one
 * connection per worker alive for 50 writes, so it exercises the WriteGate
 * (write-time retries) far more than it exercises `openDatabase` (open-time
 * WAL PRAGMA). This test churns open→write→close from 8 processes so the OPEN
 * path is the contended operation, pinning the fix: a bounded busy-retry on
 * `openDatabase`'s PRAGMA sequence.
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
const WORKER = join(__dirname, "repro", "open-churn-worker.ts");

function runWorker(dbPath: string, cycles: number, tag: string): Promise<{ written: number; errors: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", WORKER, dbPath, String(cycles), tag], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`worker ${tag} timed out`));
    }, 120_000);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`worker ${tag} exited ${code}: ${err.slice(0, 400)}`));
      resolve(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

describe("CF-1 · open churn (8 processes × open→write→close)", () => {
  test("no lost writes, no busy errors, chain valid", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-churn-"));
    const dbPath = join(dir, "xr.db");
    const writers = 8;
    const cycles = 30;
    try {
      const results = await Promise.all(
        Array.from({ length: writers }, (_, i) => runWorker(dbPath, cycles, String(i))),
      );
      const totalWritten = results.reduce((a, r) => a + r.written, 0);
      const errors = results.flatMap((r) => r.errors);
      const diag = `errors=${JSON.stringify(errors.slice(0, 10))}`;
      expect(errors, diag).toHaveLength(0);
      expect(totalWritten, `lost writes — ${diag}`).toBe(writers * cycles);

      const { verify } = await import("./repro/verify.ts");
      const chain = verify(dbPath);
      expect(chain.valid, "chain broke").toBe(true);
    } finally {
      await rmrf(dir);
    }
  }, 180_000);
});
