/**
 * Phase 1 · T12/T2 — Migration-race stress (regression for the CI failure).
 *
 * CI exposed: with N processes opening a FRESH database concurrently, two
 * workers could both pass the "migration 1 applied?" check outside their
 * write transaction and one hit `UNIQUE constraint failed:
 * schema_migrations.version` — its constructor threw and it lost writes.
 *
 * The fix (src/state/migrations.ts): the applied-check now runs INSIDE the
 * serialized `BEGIN IMMEDIATE` transaction and the bookkeeping insert is
 * `INSERT OR IGNORE`. This test opens the same brand-new DB from many
 * processes at once and asserts EVERY worker constructs and writes cleanly.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Phase 1 · migration race under parallel construction", () => {
  test("16 processes opening one fresh DB → 0 migration races, 0 lost writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-migrace-"));
    try {
      const dbPath = join(dir, "xr.db");
      const script = join(__dirname, "migration-race-worker.ts");
      const writers = 16;
      const perWriter = 20;
      const results = await Promise.all(
        Array.from({ length: writers }, (_, i) =>
          new Promise<{ written: number; errors: string[] }>((resolve, reject) => {
            const child = spawn("bun", ["run", script, dbPath, String(perWriter), String(i)], {
              stdio: ["ignore", "pipe", "pipe"],
              env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
            });
            let out = "";
            let err = "";
            child.stdout.on("data", (d) => (out += String(d)));
            child.stderr.on("data", (d) => (err += String(d)));
            child.on("close", (code) => {
              if (code !== 0) return reject(new Error(`worker ${i} exited ${code}: ${err.slice(0, 300)}`));
              resolve(JSON.parse(out.trim().split("\n").pop()!));
            });
          }),
        ),
      );
      const totalWritten = results.reduce((a, r) => a + r.written, 0);
      const errors = results.flatMap((r) => r.errors);
      expect(totalWritten).toBe(writers * perWriter);
      expect(errors).toHaveLength(0);
      if (errors.length) console.error("worker errors:", errors.slice(0, 5));

      // The schema migration is recorded exactly once and the chain is valid.
      const { WorkspaceStore } = await import("../../src/state/workspace-store.ts");
      const store = new WorkspaceStore("verify", dbPath);
      const rows = store
        .prepare("SELECT version FROM schema_migrations")
        .all() as Array<{ version: number }>;
      expect(rows.map((r) => r.version)).toContain(1);
      expect(store.verifyChain().valid).toBe(true);
      expect(store.auditCount()).toBe(writers * perWriter);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
