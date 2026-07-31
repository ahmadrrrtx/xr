/**
 * XR Phase 1 · T11 — Atomic update / rollback.
 *
 * ONE contract across both install layouts (git checkout and npm global):
 *
 *   backup config → install candidate into a parallel slot →
 *   health canary (boot + doctor + version identity) →
 *   atomic swap (blue-green) on success → automatic rollback on failure →
 *   discard the loser.
 *
 * Version identity stays unified (Phase 0 invariant): the canary requires the
 * candidate's stamped version surfaces to match its release manifest, and the
 * active version is asserted after the swap. This module does NOT claim
 * "signed" releases — signing is Phase 9.
 *
 * `applyUpdate` (the install→self-test→activate→rollback state machine) lives
 * in ./selfheal.ts and is reused here.
 */

import { existsSync, mkdirSync, rmSync, renameSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { applyUpdate, type UpdatePlan, type UpdateResult } from "./selfheal.ts";

// ── Install layout detection ──────────────────────────────────────────────

export type InstallLayout = "git" | "npm";

export function detectInstallLayout(packageRoot: string): InstallLayout {
  return existsSync(join(packageRoot, ".git")) ? "git" : "npm";
}

// ── Health canary ─────────────────────────────────────────────────────────

export interface CanaryOptions {
  /** Extra XR_HOME for the canary process (isolated). */
  xrHome?: string;
  /** Timeout ms for the canary subprocess. */
  timeoutMs?: number;
}

/**
 * Health canary: boots the candidate with an isolated XR_HOME, runs the
 * doctor probe, and verifies the stamped version identity matches the release
 * manifest. Returns the reason when the candidate is NOT healthy.
 */
export function runHealthCanary(
  candidateRoot: string,
  opts: CanaryOptions = {},
): { healthy: boolean; reason?: string } {
  const xrHome = opts.xrHome ?? join(tmpdir(), `xr-canary-${randomUUID().slice(0, 8)}`);
  mkdirSync(xrHome, { recursive: true });

  const timeoutMs = opts.timeoutMs ?? 120_000;

  // 1. Version identity (Phase 0 invariant): release:check must pass.
  const releaseCheck = spawnSync("bun", ["run", "scripts/release-manifest.ts", "--check"], {
    cwd: candidateRoot,
    env: { ...process.env, XR_HOME: xrHome },
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (releaseCheck.status !== 0) {
    return {
      healthy: false,
      reason: `release identity check failed: ${(releaseCheck.stderr ?? "").trim().slice(0, 400)}`,
    };
  }

  // 2. Boot + doctor probe (isolated home).
  const doctor = spawnSync("bun", ["run", "src/index.ts", "doctor", "--json"], {
    cwd: candidateRoot,
    env: { ...process.env, XR_HOME: xrHome },
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (doctor.status !== 0) {
    return {
      healthy: false,
      reason: `doctor probe failed (exit ${doctor.status}): ${(doctor.stderr ?? "").trim().slice(0, 400)}`,
    };
  }

  // 3. A minimal durable round trip: open the store, write + verify an audit
  //    entry through the CLI's own stack.
  const probe = spawnSync(
    "bun",
    ["run", "src/index.ts", "audit", "verify", "--json"],
    { cwd: candidateRoot, env: { ...process.env, XR_HOME: xrHome }, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (probe.status !== 0) {
    return {
      healthy: false,
      reason: `audit probe failed (exit ${probe.status}): ${(probe.stderr ?? "").trim().slice(0, 400)}`,
    };
  }

  return { healthy: true };
}

// ── Git layout (install.sh clones the repository) ─────────────────────────

export interface GitUpdateOptions {
  /** Path of the installed checkout. */
  packageRoot: string;
  /** Remote to fetch from (default origin). */
  remote?: string;
  /** Branch to track (default main). */
  branch?: string;
  /** Override the canary (tests inject a fake). */
  canary?: (candidateRoot: string) => { healthy: boolean; reason?: string };
  /** Install dependencies before the canary (default true). */
  installDeps?: boolean;
  /** Keep the previous version dir after a successful swap (for inspection). */
  keepPrevious?: boolean;
}

export function createGitUpdatePlan(opts: GitUpdateOptions): UpdatePlan<string> | null {
  const { packageRoot, remote = "origin", branch = "main" } = opts;

  const run = (args: string[], cwd = packageRoot) =>
    spawnSync("git", args, { cwd, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });

  const current = run(["rev-parse", "HEAD"]).stdout.trim();
  if (!current) return null;

  // Fetch to learn the candidate head (fetch never touches the working tree).
  const fetch = run(["fetch", remote, branch]);
  if (fetch.status !== 0) return null;
  const candidate = run(["rev-parse", `${remote}/${branch}`]).stdout.trim();
  if (!candidate || candidate === current) return null; // already up to date

  const slot = join(tmpdir(), `xr-update-${randomUUID().slice(0, 8)}`);
  const previous = join(tmpdir(), `xr-prev-${randomUUID().slice(0, 8)}`);
  const canary = opts.canary ?? ((root) => runHealthCanary(root));

  return {
    current,
    candidate,
    install: async (v: string) => {
      // Blue-green: clone the candidate into a fully independent parallel
      // slot (a clone has no git-worktree metadata coupling, so the swap is a
      // plain directory rename and the moved repo stays self-contained).
      const url =
        run(["remote", "get-url", remote]).stdout.trim() || packageRoot;
      const clone = run(["clone", "--quiet", "--branch", branch, "--", url, slot]);
      if (clone.status !== 0) throw new Error(`clone failed: ${(clone.stderr ?? "").trim()}`);
      if (opts.installDeps ?? true) {
        const deps = spawnSync("bun", ["install"], {
          cwd: slot,
          encoding: "utf8",
          timeout: 300_000,
          stdio: ["ignore", "pipe", "pipe"],
        });
        if (deps.status !== 0) throw new Error(`dependency install failed in candidate`);
      }
    },
    selfTest: async () => canary(slot).healthy,
    activate: async () => {
      // Atomic swap: current → previous, candidate → current. If the swap
      // fails midway, roll the old installation back into place.
      renameSync(packageRoot, previous);
      try {
        renameSync(slot, packageRoot);
      } catch (e) {
        try {
          renameSync(previous, packageRoot);
        } catch {
          /* leave previous in place for manual recovery */
        }
        throw e;
      }
      if (opts.keepPrevious) {
        try {
          rmSync(join(packageRoot, ".prev"), { recursive: true, force: true });
          renameSync(previous, join(packageRoot, ".prev"));
        } catch {
          /* best-effort */
        }
      } else {
        try {
          rmSync(previous, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    },
    discard: async () => {
      try {
        rmSync(slot, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

// ── npm global layout ─────────────────────────────────────────────────────

export interface NpmUpdateOptions {
  /** Package name to update (default @rrrtx/xr). */
  packageName?: string;
  /** Override the canary (tests inject a fake). */
  canary?: (candidateRoot: string) => { healthy: boolean; reason?: string };
  /** npm command (default npm). */
  npm?: string;
}

export function createNpmUpdatePlan(opts: NpmUpdateOptions = {}): UpdatePlan<string> | null {
  const packageName = opts.packageName ?? "@rrrtx/xr";
  const npm = opts.npm ?? "npm";
  const canary = opts.canary ?? ((root) => runHealthCanary(root));

  const run = (args: string[]) =>
    spawnSync(npm, args, { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });

  const current = run(["view", `${packageName}@installed`, "version"]).stdout.trim();
  const candidate = run(["view", packageName, "version"]).stdout.trim();
  if (!current || !candidate || current === candidate) return null;

  const staged = join(tmpdir(), `xr-npm-${randomUUID().slice(0, 8)}`);

  return {
    current,
    candidate,
    install: async (v: string) => {
      mkdirSync(staged, { recursive: true });
      const pack = run(["pack", `${packageName}@${v}`, "--pack-destination", staged]);
      if (pack.status !== 0) throw new Error(`npm pack failed`);
      const tarball = readdirSync(staged).find((f) => f.endsWith(".tgz"));
      if (!tarball) throw new Error("no tarball produced");
      const extract = spawnSync("tar", ["-xzf", join(staged, tarball), "-C", staged], {
        encoding: "utf8",
        timeout: 120_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (extract.status !== 0) throw new Error("tarball extraction failed");
    },
    selfTest: async () => canary(join(staged, "package")).healthy,
    activate: async (v: string) => {
      const install = run(["install", "-g", `${packageName}@${v}`]);
      if (install.status !== 0) throw new Error("global install failed");
    },
    discard: async () => {
      try {
        rmSync(staged, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

// ── Facade used by `xr update` ────────────────────────────────────────────

export async function runAtomicUpdate(opts: {
  packageRoot: string;
  git?: GitUpdateOptions;
  npm?: NpmUpdateOptions;
}): Promise<UpdateResult<string>> {
  const layout = detectInstallLayout(opts.packageRoot);
  const plan =
    layout === "git"
      ? createGitUpdatePlan({ packageRoot: opts.packageRoot, ...opts.git })
      : createNpmUpdatePlan(opts.npm);

  if (!plan) {
    return {
      ok: false,
      keptCurrent: "",
      reason: layout === "git" ? "already up to date or fetch failed" : "already up to date or registry unreachable",
    };
  }
  return applyUpdate(plan);
}
