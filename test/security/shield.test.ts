/**
 * XR — Shield Honesty Suite (0.3 Shield Honesty regression guard)
 *
 * Doctrine under test (from src/security/shield.ts):
 *   - Zero fabricated threats: if the system yields no data, output is EMPTY.
 *   - Heuristics are deterministic explainers, NOT AI agents.
 *   - Ad-block toggles manage Shield state only — no system file edits.
 *   - Whitelisting and quarantine are transparent + audited.
 *   - The audit hash chain survives every Shield operation.
 *
 * Runs in a hermetic child process because Shield state paths bind XR_HOME /
 * HOME at module load (fixtures/shield-fixture.ts).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "fixtures", "shield-fixture.ts");

let home: string;

async function rmrfWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code ?? "") || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

afterEach(async () => {
  if (home) await rmrfWithRetry(home);
});

describe("XR Shield — honesty doctrine (hermetic)", () => {
  if (process.platform === "win32") {
    // The shield fixture intentionally rewrites HOME/XR_HOME in a child
    // process. That path is Linux/macOS-oriented and Windows support is not
    // verified for XR 3.1.6, so keep Windows local runs green while CI still
    // exercises this hermetic suite on Ubuntu.
    test.skip("scan reality, state management, and audit integrity hold end-to-end", () => {});
    test.skip("RUNS of the full battery emit every honesty checkpoint", () => {});
    return;
  }

  test("scan reality, state management, and audit integrity hold end-to-end", async () => {
    home = mkdtempSync(join(tmpdir(), "xr-shield-"));
    const xrHome = join(home, "xr");
    const userHome = join(home, "user");

    const proc = Bun.spawn([process.execPath, FIXTURE], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, XR_HOME: xrHome, HOME: userHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).not.toContain("FAIL ");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ALL CHECKS PASSED");
  }, 60_000);

  test("RUNS of the full battery emit every honesty checkpoint", async () => {
    home = mkdtempSync(join(tmpdir(), "xr-shield-checkpoints-"));
    const xrHome = join(home, "xr");
    const userHome = join(home, "user");

    const proc = Bun.spawn([process.execPath, FIXTURE], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, XR_HOME: xrHome, HOME: userHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, _stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);

    const checkpoints = [
      "state-defaults",
      "state-path-under-xr-home",
      "processes-enum-real",
      "processes-contains-self",
      "startup-detects-miner-cmdline",
      "startup-benign-not-flagged",
      "browser-empty-when-no-profiles",
      "downloads-empty-when-no-dir",
      "downloads-double-extension-flagged",
      "telemetry-os-honest-unknown",
      "adblock-template-reference-only",
      "adblock-audited",
      "scan-threats-well-formed",
      "scan-detects-planted-startup",
      "scan-detects-planted-download",
      "scan-audited",
      "whitelist-suppresses-threat",
      "whitelist-audited",
      "quarantine-persisted",
      "restore-missing-id-honest-false",
      "heuristic-deterministic",
      "heuristic-sync-not-async",
      "analyzeThreatWithAgent-removed",
      "heuristic-unknown-uses-fallback",
      "privacy-score-bounded",
      "privacy-score-additive",
      "audit-chain-intact-e2e",
    ];
    for (const step of checkpoints) {
      expect(stdout).toContain(`CHECK ${step}`);
    }
  }, 60_000);
});
