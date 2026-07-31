/**
 * Phase 1 · T6 — Golden path test (nightly + CI).
 *
 * Runs scripts/golden-path.ts as a child process with hermetic XR_HOME/HOME
 * and asserts every reported effect. The same script is the payload of the
 * nightly workflow (Linux + container).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, "..", "..", "scripts", "golden-path.ts");

function runGolden(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), "xr-golden-"));
    const home = join(dir, "home");
    const xrHome = join(dir, "data");
    const child = spawn("bun", ["run", GOLDEN], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`,
        HOME: home,
        XR_HOME: xrHome,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", (code) => {
      rmSync(dir, { recursive: true, force: true });
      resolve({ code, stdout, stderr });
    });
  });
}

describe("Phase 1 · golden path (install → answer → restart → resume → answer → uninstall)", () => {
  test("full journey passes every effect assertion", async () => {
    const r = await runGolden();
    expect(r.code).toBe(0);
    if (r.code !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
    }
    const lines = r.stdout.trim().split("\n");
    const checkLines = lines.filter((l) => l.startsWith("CHECK "));
    // Every CHECK step executed.
    expect(checkLines.length).toBeGreaterThanOrEqual(10);
    for (const expected of [
      "install-wizard-exit-0",
      "install-creates-config",
      "first-answer-succeeded",
      "chain-intact-after-first",
      "restart-preserves-audit",
      "chain-intact-after-restart",
      "recovery-runs",
      "second-answer-succeeded",
      "chain-intact-final",
      "uninstall-launcher-removed",
      "uninstall-data-kept",
    ]) {
      expect(checkLines).toContain(`CHECK ${expected}`);
    }
    const report = lines.find((l) => l.startsWith("{"))!;
    const parsed = JSON.parse(report) as {
      ok: boolean;
      auditEntries: number;
      chainValid: boolean;
      firstOutcome: string;
      secondOutcome: string;
      recoveryCount: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.chainValid).toBe(true);
    expect(parsed.firstOutcome).toBe("succeeded");
    expect(parsed.secondOutcome).toBe("succeeded");
    expect(parsed.auditEntries).toBeGreaterThan(1);
  }, 240_000);
});
