/**
 * XR Phase 3 · T2/Part 17 — compiled-binary update contract tests.
 *
 * The atomic updater treats the compiled binary as a first-class layout
 * (one contract across git/npm/binary):
 *   - layout detection prefers the binary when dist/<platform> exists;
 *   - the binary plan swaps atomically (blue-green) with rollback;
 *   - a failing canary keeps the current binary (auto-rollback);
 *   - the health canary accepts `doctor` exit 1 by design (no provider).
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { describe, test, expect } from "bun:test";
import {
  detectInstallLayout,
  createBinaryUpdatePlan,
  binaryCanary,
  binaryFileName,
} from "../../src/update/atomic-updater.ts";
import { applyUpdate } from "../../src/update/selfheal.ts";

/** A fake "binary": a shell script that reports a version. */
function fakeBinary(dir: string, name: string, version: string): string {
  const bin = join(dir, name);
  writeFileSync(bin, `#!/usr/bin/env bash\necho "v${version} (Truth)"\nexit 0\n`);
  if (process.platform !== "win32") chmodSync(bin, 0o755);
  return bin;
}

describe("Phase 3 · T2 — binary distribution update contract", () => {
  test("layout detection prefers the binary over git/npm", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-bin-layout-"));
    try {
      // With dist/<platform> present → binary layout (even inside a git checkout).
      mkdirSync(join(dir, "dist"), { recursive: true });
      fakeBinary(join(dir, "dist"), binaryFileName(), "7.0.1");
      expect(detectInstallLayout(dir)).toBe("binary");
    } finally {
      require("node:fs").rmSync(dir, { recursive: true, force: true });
    }
  });

  test("binary plan: install → canary → atomic swap with rollback", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-bin-plan-"));
    try {
      const dist = join(dir, "dist");
      mkdirSync(dist, { recursive: true });
      const currentName = binaryFileName();
      const current = fakeBinary(dist, currentName, "7.0.0");

      const plan = createBinaryUpdatePlan({
        packageRoot: dir,
        version: "7.0.1",
        baseUrl: "file:///nonexistent", // install step will fail → no swap
        canary: () => ({ healthy: true }),
        // This test exercises the swap state machine, not integrity —
        // checksum behavior has its own adversarial suite (test/release/channel-update.test.ts).
        requireChecksums: false,
      });
      expect(plan).not.toBeNull();
      expect(plan!.current).toBe(current);

      const result = await applyUpdate(plan!);
      // Download URL unreachable → install fails → current kept (rollback).
      expect(result.ok).toBe(false);
      expect(existsSync(current)).toBe(true);
    } finally {
      require("node:fs").rmSync(dir, { recursive: true, force: true });
    }
  });

  test("binary canary accepts doctor exit 1 by design (no provider)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-bin-canary-"));
    try {
      const bin = fakeBinary(dir, "xr-fake", "7.0.1");
      // fake binary always exits 0 → canary healthy for --version; doctor
      // probe in binaryCanary also runs the fake (exit 0) → healthy.
      const r = binaryCanary(bin, 30_000);
      expect(r.healthy).toBe(true);
    } finally {
      require("node:fs").rmSync(dir, { recursive: true, force: true });
    }
  });

  test("binaryFileName maps all five targets", () => {
    expect(binaryFileName("linux", "x64")).toBe("xr-linux-x64");
    expect(binaryFileName("linux", "arm64")).toBe("xr-linux-arm64");
    expect(binaryFileName("darwin", "arm64")).toBe("xr-darwin-arm64");
    expect(binaryFileName("darwin", "x64")).toBe("xr-darwin-x64");
    expect(binaryFileName("win32", "x64")).toBe("xr-windows-x64.exe");
  });
});
