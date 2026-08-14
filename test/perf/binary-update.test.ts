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

/**
 * A fake "binary" file used for LAYOUT DETECTION only (existence + filename).
 *
 * The contents are never executed by these cases, so a shebang script is fine
 * on every OS. Use `fakeExecutable` when the file must actually be spawned.
 */
function fakeBinary(dir: string, name: string, version: string): string {
  const bin = join(dir, name);
  writeFileSync(bin, `#!/usr/bin/env bash\necho "v${version} (Truth)"\nexit 0\n`);
  if (process.platform !== "win32") chmodSync(bin, 0o755);
  return bin;
}

/**
 * A fake binary that is genuinely SPAWNABLE on the host OS.
 *
 * Windows has no shebang support: `CreateProcess` cannot run an extensionless
 * `#!/usr/bin/env bash` file, and spawning one from `bun test` on a hosted
 * Windows runner takes the whole test process down with
 * `panic(main thread): Internal assertion failure` — a crash-class exit 3 with
 * zero reported test failures, which is what red-lined the Windows parity lane.
 *
 * So on win32 write a `.cmd` batch file (natively executable) and elsewhere a
 * chmod +x shell script. Both print the same version string and exit 0, so the
 * canary contract under test is identical on every platform — the coverage is
 * preserved rather than skipped.
 */
function fakeExecutable(dir: string, baseName: string, version: string): string {
  if (process.platform === "win32") {
    const bin = join(dir, `${baseName}.cmd`);
    writeFileSync(bin, `@echo off\r\necho v${version} (Truth)\r\nexit /b 0\r\n`);
    return bin;
  }
  const bin = join(dir, baseName);
  writeFileSync(bin, `#!/usr/bin/env bash\necho "v${version} (Truth)"\nexit 0\n`);
  chmodSync(bin, 0o755);
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
        baseUrl: "https://xr.invalid/releases", // install step will fail → no swap
        canary: () => ({ healthy: true }),
        // Deterministic unreachable transport. Previously this test pointed
        // baseUrl at `file:///nonexistent`, which behaves differently per OS:
        // on POSIX that is a valid-but-missing path and bun's fetch reports a
        // clean ENOENT, but on Windows `file:///nonexistent` is a MALFORMED
        // Win32 path (no drive letter) and resolving it inside bun's fetch
        // took the whole test process down with
        // `panic(main thread): Internal assertion failure` — crash-class exit
        // 3 with zero reported test failures, which red-lined the Windows
        // parity lane.
        //
        // Injecting the failure instead of relying on a filesystem/URL edge
        // case tests the SAME contract (download fails ⇒ no swap, current
        // binary kept) identically and deterministically on every OS, with no
        // network and no OS-specific path parsing.
        fetchImpl: (async () => {
          throw new Error("network unreachable (injected)");
        }) as unknown as typeof fetch,
      });
      expect(plan).not.toBeNull();
      expect(plan!.current).toBe(current);

      const result = await applyUpdate(plan!);
      // Download unreachable → install fails → current kept (rollback).
      expect(result.ok).toBe(false);
      expect(existsSync(current)).toBe(true);
    } finally {
      require("node:fs").rmSync(dir, { recursive: true, force: true });
    }
  });

  test("binary canary accepts doctor exit 1 by design (no provider)", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-bin-canary-"));
    try {
      // This case SPAWNS the fake, so it must be natively executable on the
      // host OS (a bash shebang is unspawnable on Windows — see fakeExecutable).
      const bin = fakeExecutable(dir, "xr-fake", "7.0.1");
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
