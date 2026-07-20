/**
 * XR — Kernel bootstrap integration test (0.2 Storage Unification + 0.6 DI).
 *
 * Boots a REAL kernel in a hermetic child process (XR_HOME pointed at a temp
 * directory) and verifies the guarantees Stage 0 was built around:
 *   - exactly one WorkspaceStore connection, shared by every repo and service
 *   - legacyStore alias is the SAME instance (migration compatibility)
 *   - all 0.6 DI service ids resolve
 *   - switching workspaces closes the old store, opens a fresh isolated one
 *   - shutdown closes the store
 *
 * The fixture lives in ./fixtures/kernel-fixture.ts (not a *.test.ts file, so
 * bun does not execute it directly).
 */

import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "fixtures", "kernel-fixture.ts");

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

describe("XRKernel bootstrap (hermetic)", () => {
  test("kernel boots with a single unified store and switches workspaces cleanly", async () => {
    home = mkdtempSync(join(tmpdir(), "xr-kernel-"));

    const proc = Bun.spawn(["bun", FIXTURE], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, XR_HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Exit code + markers are the contract; stderr must at least not carry
    // a fixture FAIL line (warnings from config/services are tolerated).
    expect(stderr).not.toContain("FAIL ");
    expect(exitCode).toBe(0);

    // Structural assertions on the fixture's progress markers.
    const expectedSteps = [
      "kernel-version-unified",
      "bootstrap-event-emitted",
      "store-is-workspace-store",
      "legacy-alias-is-same-instance",
      "service-registered:app",
      "service-registered:shield",
      "service-registered:business",
      "service-registered:agent",
      "service-registered:workflowStore",
      "shield-rides-unified-store",
      "repos-are-views-over-one-store",
      "single-connection",
      "repo-writes-share-connection",
      "audit-chain-intact",
      "switch-emits-events",
      "switch-installs-new-store",
      "switch-fresh-db-is-empty",
      "old-store-closed-single-connection",
      "switched-writes-isolated",
      "stopped-event-emitted",
      "shutdown-closes-store",
    ];
    for (const step of expectedSteps) {
      expect(stdout).toContain(`CHECK ${step}`);
    }
    expect(stdout).toContain("ALL CHECKS PASSED");
  }, 30_000);

  test("fixture fails honestly when XR_HOME is not provided", async () => {
    const proc = Bun.spawn(["bun", FIXTURE], {
      cwd: join(import.meta.dir, "..", ".."),
      env: { ...process.env, XR_HOME: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("XR_HOME must be set");
  }, 30_000);
});
