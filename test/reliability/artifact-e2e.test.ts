/**
 * Phase 1 · T9 — Hermetic black-box E2E from a published artifact.
 *
 * Packs the npm artifact, installs the tarball into a clean dir, and drives
 * the ARTIFACT's own launcher + sources (doctor identity, audit surface,
 * durability driver). Green only when every effect on the artifact holds.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { PKG } from "../../src/core/version.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "..", "scripts", "e2e-artifact.ts");

describe("Phase 1 · hermetic artifact E2E", () => {
  test("pack → install → drive artifact (identity + audit + durability)", async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn("bun", ["run", SCRIPT], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (err += String(d)));
      child.on("close", (code) => resolve({ code, stdout: out, stderr: err }));
    });
    // Print BEFORE asserting: a failed expect() throws, so the stderr (the only
    // diagnostic) would otherwise never reach the CI log.
    if (result.code !== 0) console.error(`[artifact-e2e] exit ${result.code}\nstdout:\n${result.stdout.slice(-4000)}\nstderr:\n${result.stderr.slice(-4000)}`);
    expect(result.code).toBe(0);
    const report = result.stdout.trim().split("\n").find((l) => l.startsWith("{"));
    expect(report).toBeDefined();
    const parsed = JSON.parse(report!) as { ok: boolean; doctorVersion: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.doctorVersion).toBe(PKG.version);
  }, 300_000);
});
