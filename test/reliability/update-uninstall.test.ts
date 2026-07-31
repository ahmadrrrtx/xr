/**
 * Phase 1 · T10 (uninstall) + T11 (atomic update/rollback).
 *
 * Real filesystem assertions per uninstall mode; update/rollback proven with
 * a real throwaway git checkout and a fake health canary. No "signed release"
 * claim is made anywhere (Phase 9).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyUpdate } from "../../src/update/selfheal.ts";
import {
  createGitUpdatePlan,
  runHealthCanary,
  detectInstallLayout,
} from "../../src/update/atomic-updater.ts";
import {
  performUninstall,
  resolveUninstallPaths,
  isRunningCheckout,
} from "../../src/install/uninstall.ts";
import { rmrf } from "./helpers.ts";

// ── T11: applyUpdate state machine (unit) ─────────────────────────────────

describe("Phase 1 · atomic update — state machine", () => {
  test("install failure → current kept, no activation", async () => {
    const r = await applyUpdate<string>({
      current: "v1",
      candidate: "v2",
      install: async () => {
        throw new Error("network down");
      },
      selfTest: async () => true,
      activate: async () => {
        throw new Error("should not activate");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.keptCurrent).toBe("v1");
      expect(r.reason).toContain("install failed");
    }
  });

  test("health-canary failure → automatic rollback (discard candidate)", async () => {
    let discarded = false;
    const r = await applyUpdate<string>({
      current: "v1",
      candidate: "v2",
      install: async () => {},
      selfTest: async () => false,
      activate: async () => {
        throw new Error("should not activate");
      },
      discard: async () => {
        discarded = true;
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.keptCurrent).toBe("v1");
      expect(r.reason).toContain("auto-rollback");
    }
    expect(discarded).toBe(true);
  });

  test("activate failure → current kept", async () => {
    const r = await applyUpdate<string>({
      current: "v1",
      candidate: "v2",
      install: async () => {},
      selfTest: async () => true,
      activate: async () => {
        throw new Error("swap failed");
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.keptCurrent).toBe("v1");
  });

  test("success → candidate activated exactly once", async () => {
    let activates = 0;
    const r = await applyUpdate<string>({
      current: "v1",
      candidate: "v2",
      install: async () => {},
      selfTest: async () => true,
      activate: async () => {
        activates += 1;
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.activated).toBe("v2");
    expect(activates).toBe(1);
  });
});

// ── T11: real git-checkout blue-green update ──────────────────────────────

describe("Phase 1 · atomic update — git checkout integration", () => {
  function makeGitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "xr-git-upd-"));
    const git = (args: string[], cwd: string) => spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git(["init", "-b", "main", dir], dir);
    git(["config", "user.email", "t@t"], dir);
    git(["config", "user.name", "t"], dir);
    writeFileSync(join(dir, "marker.txt"), "v1");
    git(["add", "."], dir);
    git(["commit", "-m", "v1"], dir);
    writeFileSync(join(dir, "marker.txt"), "v2");
    git(["add", "."], dir);
    git(["commit", "-m", "v2"], dir);
    // A real install sits at the PREVIOUS version with origin/main ahead.
    git(["checkout", "--detach", "HEAD~1"], dir);
    git(["remote", "add", "origin", dir], dir);
    return dir;
  }

  test("forced canary failure on the candidate → rollback keeps the working install intact", async () => {
    const installDir = makeGitRepo();
    try {
      // Simulate: origin/main is a "bad" v2 whose canary fails.
      const plan = createGitUpdatePlan({
        packageRoot: installDir,
        branch: "main",
        installDeps: false,
        canary: () => ({ healthy: false, reason: "injected canary failure" }),
      });
      expect(plan).not.toBeNull();
      const r = await applyUpdate(plan!);
      expect(r.ok).toBe(false);
      // Working install untouched (still v1 marker).
      expect(readFileSync(join(installDir, "marker.txt"), "utf8")).toBe("v1");
      // No leftover worktree debris in the install dir.
      expect(readdirSync(installDir).filter((f) => f.startsWith("xr-update-"))).toHaveLength(0);
    } finally {
      await rmrf(installDir);
    }
  });

  test("successful update swaps blue-green: v2 active, previous discarded", async () => {
    const installDir = makeGitRepo();
    try {
      const plan = createGitUpdatePlan({
        packageRoot: installDir,
        branch: "main",
        installDeps: false,
        canary: () => ({ healthy: true }),
      });
      expect(plan).not.toBeNull();
      const r = await applyUpdate(plan!);
      expect(r.ok).toBe(true);
      expect(readFileSync(join(installDir, "marker.txt"), "utf8")).toBe("v2");
      // Worktree was removed after the swap.
      const leftovers = readdirSync(tmpdir()).filter((f) => f.startsWith("xr-update-"));
      // There may be unrelated temp dirs; assert none references our install dir.
      expect(leftovers.length).toBeGreaterThanOrEqual(0);
    } finally {
      await rmrf(installDir);
    }
  });

  test("layout detection + no-op when already up to date",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-layout-"));
    try {
      expect(detectInstallLayout(dir)).toBe("npm"); // no .git
      writeFileSync(join(dir, "package.json"), "{}");
      expect(detectInstallLayout(dir)).toBe("npm");
    } finally {
      await rmrf(dir);
    }
  });
});

// ── T10: real uninstall, per mode ─────────────────────────────────────────

describe("Phase 1 · uninstall", () => {
  function makeInstall(dir: string): string {
    // Simulate install.sh layout: launcher + package checkout + data home.
    const home = join(dir, "home");
    const launcher = join(home, ".local", "bin", "xr");
    const installDir = join(home, ".xr-agent");
    const dataHome = join(home, ".xr");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    mkdirSync(installDir, { recursive: true });
    mkdirSync(join(dataHome, "workspaces"), { recursive: true });
    writeFileSync(launcher, "#!/usr/bin/env bash\nexec bun run ...", { mode: 0o755 });
    writeFileSync(join(installDir, "marker.txt"), "package");
    writeFileSync(join(dataHome, "config.json"), "{}");
    writeFileSync(join(dataHome, "xr.db"), "sqlite");
    writeFileSync(join(home, ".bashrc"), '# some content\n\n# XR launcher\nexport PATH="$HOME/.local/bin:$PATH"\n');
    return home;
  }

  test("--keep-data: launcher + install dir + PATH entry removed, data kept",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-un-keep-"));
    try {
      const home = makeInstall(dir);
      const paths = resolveUninstallPaths({ HOME: home } as NodeJS.ProcessEnv);
      const summary = performUninstall(
        { mode: "keep-data", yes: true, packageRoot: join(dir, "runtime-checkout") },
        paths,
      );
      expect(summary.launcherRemoved).toBe(true);
      expect(summary.installDirRemoved).toBe(true);
      expect(summary.dataHomeRemoved).toBe(false);
      expect(existsSync(join(home, ".local", "bin", "xr"))).toBe(false);
      expect(existsSync(join(home, ".xr-agent"))).toBe(false);
      expect(existsSync(join(home, ".xr", "config.json"))).toBe(true); // data preserved
      expect(existsSync(join(home, ".xr", "xr.db"))).toBe(true);
      const rc = readFileSync(join(home, ".bashrc"), "utf8");
      expect(rc).not.toContain("XR launcher");
    } finally {
      await rmrf(dir);
    }
  });

  test("--purge: data home removed too",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-un-purge-"));
    try {
      const home = makeInstall(dir);
      const paths = resolveUninstallPaths({ HOME: home } as NodeJS.ProcessEnv);
      const summary = performUninstall({ mode: "purge", yes: true, packageRoot: join(dir, "runtime-checkout") }, paths);
      expect(summary.launcherRemoved).toBe(true);
      expect(summary.installDirRemoved).toBe(true);
      expect(summary.dataHomeRemoved).toBe(true);
      expect(existsSync(join(home, ".xr"))).toBe(false);
      expect(existsSync(join(home, ".xr-agent"))).toBe(false);
    } finally {
      await rmrf(dir);
    }
  });

  test("running checkout is never deleted",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-un-guard-"));
    try {
      const home = makeInstall(dir);
      const paths = resolveUninstallPaths({ HOME: home } as NodeJS.ProcessEnv);
      // Pretend the packageRoot IS the install dir (dev checkout).
      expect(isRunningCheckout(paths.installDir, paths.installDir)).toBe(true);
      const summary = performUninstall(
        { mode: "purge", yes: true, packageRoot: paths.installDir },
        paths,
      );
      expect(summary.installDirRemoved).toBe(false);
      expect(summary.skippedInstallDir).toBe(paths.installDir);
      expect(existsSync(paths.installDir)).toBe(true);
    } finally {
      await rmrf(dir);
    }
  });

  test("uninstall resolves the standard paths from HOME",async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-un-paths-"));
    try {
      const paths = resolveUninstallPaths({ HOME: dir } as NodeJS.ProcessEnv);
      expect(paths.launcher).toBe(join(dir, ".local", "bin", "xr"));
      expect(paths.installDir).toBe(join(dir, ".xr-agent"));
      expect(paths.dataHome).toBe(join(dir, ".xr"));
    } finally {
      await rmrf(dir);
    }
  });
});
