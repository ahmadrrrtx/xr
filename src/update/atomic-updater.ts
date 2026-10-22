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
import { shimSafe } from "../util/win-spawn.ts";
import { applyUpdate, type UpdatePlan, type UpdateResult } from "./selfheal.ts";

// ── Install layout detection ──────────────────────────────────────────────

export type InstallLayout = "git" | "npm" | "binary";

/**
 * Phase 3 · T2 — standard compiled-binary name per platform, relative to the
 * package root's dist/ directory (or $XR_BINARY override).
 */
export function binaryFileName(platform: string = process.platform, arch: string = process.arch): string {
  const map: Record<string, string> = {
    "linux-x64": "xr-linux-x64",
    "linux-arm64": "xr-linux-arm64",
    "darwin-arm64": "xr-darwin-arm64",
    "darwin-x64": "xr-darwin-x64",
    "win32-x64": "xr-windows-x64.exe",
  };
  return map[`${platform}-${arch}`] ?? `xr-${platform}-${arch}`;
}

export function binaryPathForPackage(packageRoot: string): string | null {
  if (process.env.XR_BINARY) return process.env.XR_BINARY;
  const p = join(packageRoot, "dist", binaryFileName());
  return existsSync(p) ? p : null;
}

export function detectInstallLayout(packageRoot: string): InstallLayout {
  // The compiled binary is the default distribution path (Phase 3 · T2);
  // git/npm checkouts remain the contributor path.
  if (binaryPathForPackage(packageRoot)) return "binary";
  return existsSync(join(packageRoot, ".git")) ? "git" : "npm";
}

// ── Binary layout (Phase 3 · T2) ──────────────────────────────────────────

export interface BinaryUpdateOptions {
  /** Path of the installed package root (dist/ lives here). */
  packageRoot: string;
  /** Target version to install (from the release manifest). */
  version: string;
  /** Download base URL template; {version}/{file} placeholders. */
  baseUrl?: string;
  /** URL of the release SHA256SUMS (default: `${baseUrl}/SHA256SUMS`). */
  sumsUrl?: string;
  /** Timeout for the download + canary, ms. */
  timeoutMs?: number;
  /** Override the canary (tests inject a fake). */
  canary?: (binaryPath: string) => { healthy: boolean; reason?: string };
  /** Test-only: skip SHA256SUMS verification (never set by production paths). */
  verify?: boolean;
  /** Fetch implementation (tests inject). */
  fetchImpl?: typeof fetch;
}

export function binaryCanary(binaryPath: string, timeoutMs = 120_000): { healthy: boolean; reason?: string } {
  const xrHome = join(tmpdir(), `xr-canary-${randomUUID().slice(0, 8)}`);
  mkdirSync(xrHome, { recursive: true });
  const env = { ...process.env, XR_HOME: xrHome, XR_NONINTERACTIVE: "1" };
  const version = spawnSync(binaryPath, ["--version"], { env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  if (version.status !== 0) {
    return { healthy: false, reason: `binary --version failed (exit ${version.status})` };
  }
  const doctor = spawnSync(binaryPath, ["doctor", "--json"], { env, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
  if (doctor.status !== 0 && doctor.status !== 1) {
    // doctor exits 1 BY DESIGN without a reachable provider (Phase 0 · T4);
    // anything else is an unhealthy candidate.
    return { healthy: false, reason: `binary doctor probe failed (exit ${doctor.status}): ${(doctor.stderr ?? "").trim().slice(0, 300)}` };
  }
  return { healthy: true };
}

export function createBinaryUpdatePlan(opts: BinaryUpdateOptions): UpdatePlan<string> | null {
  const current = binaryPathForPackage(opts.packageRoot);
  if (!current) return null;
  const file = binaryFileName();
  const baseUrl =
    opts.baseUrl ?? `https://github.com/ahmadrrrtx/xr/releases/download/v${opts.version}`;
  const url = `${baseUrl}/${file}`;
  const stagingDir = join(opts.packageRoot, "dist", ".staging");
  const candidate = join(stagingDir, `xr-${opts.version}`);

  return {
    current,
    candidate,
    install: async () => {
      mkdirSync(stagingDir, { recursive: true });
      // Phase 9 · Part 20 — verified-only distribution: the candidate is
      // checked against the release's SHA256SUMS before it is ever written
      // to disk (fails closed when the sums are missing/mismatched).
      if (opts.verify === false) {
        // Explicit, test-only escape hatch — the production path (updateXR)
        // never sets this. DSC/CI installers use it to inject fixtures.
        const res = await fetch(url);
        if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        await Bun.write(candidate, buf);
      } else {
        const { downloadVerified } = await import("./channels.ts");
        await downloadVerified(
          {
            url,
            sumsUrl: opts.sumsUrl ?? `${baseUrl}/SHA256SUMS`,
            expectedFile: file,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
          },
          async (bytes) => {
            await Bun.write(candidate, bytes);
          },
        );
      }
      if (process.platform !== "win32") {
        spawnSync("chmod", ["+x", candidate], { encoding: "utf8" });
      }
    },
    selfTest: (bin) => (opts.canary ?? binaryCanary)(bin).healthy,
    activate: async () => {
      // Atomic blue-green swap: rename current aside, move candidate in,
      // roll back on any failure (Phase 1 · T11 contract).
      const backup = `${current}.prev`;
      try {
        if (existsSync(backup)) rmSync(backup, { force: true });
        renameSync(current, backup);
        renameSync(candidate, current);
        try {
          spawnSync("chmod", ["+x", current], { encoding: "utf8" });
        } catch {
          /* non-fatal on win32 */
        }
        rmSync(backup, { force: true });
      } catch (e) {
        // Roll back: restore the previous binary if the swap failed midway.
        if (!existsSync(current) && existsSync(backup)) renameSync(backup, current);
        throw e;
      }
    },
    discard: async (bin) => {
      try {
        rmSync(bin, { force: true });
      } catch {
        /* best-effort */
      }
    },
  };
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

// createNpmUpdatePlan (removed, XR-LAUNCH-007): it queried the invalid spec
// `@rrrtx/xr@installed` and canaried with repo-only scripts, so it could never
// produce a working update. The npm/bun layout is handled by ./npm-channel.ts.

// ── Facade used by `xr update` ────────────────────────────────────────────

export async function runAtomicUpdate(opts: {
  packageRoot: string;
  version?: string;
  git?: GitUpdateOptions;
  npm?: NpmUpdateOptions;
  binary?: BinaryUpdateOptions;
  /** Phase 9 · T5 — channel detection override (tests inject). */
  channel?: import("./channels.ts").ChannelInfo;
  /** Phase 9 · T5 — runner override for channel-managed updates (tests inject). */
  channelRun?: (cmd: string[]) => { ok: boolean; error?: string };
  /** Phase 9 · T5 — canary override for channel-managed updates (tests inject). */
  channelCanary?: () => { healthy: boolean; reason?: string };
  /** XR-LAUNCH-007 — the running package's version (CORE_VERSION). */
  currentVersion?: string;
  /** XR-LAUNCH-019 — newest complete GitHub release for the binary layout (tests inject). */
  releaseResolver?: () => Promise<string | null>;
  /** XR-LAUNCH-007 — npm/bun global layout: registry + runner overrides (tests inject). */
  npmChannel?: Partial<Pick<import("./npm-channel.ts").NpmPlanOptions, "run" | "manager">> & {
    fetcher?: import("./npm-channel.ts").RegistryFetcher;
  };
}): Promise<UpdateResult<string>> {
  // Phase 9 · T5 — channel-managed installs (Homebrew/Scoop/WinGet/apt/npm?)
  // update through their own package manager under the same atomic contract.
  const { detectChannel, createChannelUpdatePlan } = await import("./channels.ts");
  const channel =
    opts.channel ??
    detectChannel({
      platform: process.platform,
      exePath: process.execPath,
      isDebInstalled: () =>
        process.platform === "linux" && existsSync("/usr/bin/xr") && !existsSync(join(opts.packageRoot, "dist")),
      isBrewInstalled: () => {
        const prefix = process.platform === "darwin" ? "/opt/homebrew" : "/home/linuxbrew/.linuxbrew";
        return existsSync(join(prefix, "Cellar", "xr"));
      },
    });
  if (channel.managed && channel.channel !== "npm") {
    const { channelHealthCanary } = await import("./channels.ts");
    const [xc, xa, xo] = shimSafe("xr", ["--version"]); // xr.cmd for npm installs on Windows
    const current =
      spawnSync(xc, xa, { ...xo, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] })
        .stdout?.trim()
        .match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1] ?? "current";
    const plan = createChannelUpdatePlan({
      info: channel,
      currentVersion: current,
      ...(opts.version ? { targetVersion: opts.version } : {}),
      ...(opts.channelRun ? { run: opts.channelRun } : {}),
      canary: opts.channelCanary ?? channelHealthCanary,
    });
    return applyUpdate(plan);
  }

  const layout = detectInstallLayout(opts.packageRoot);
  let plan: UpdatePlan<string> | null = null;
  let noPlanReason = "already up to date or update source unreachable";

  if (layout === "binary") {
    // XR-LAUNCH-019: resolve the newest COMPLETE release (has SHA256SUMS) and
    // compare BEFORE downloading; `opts.version` is the running version here,
    // never a target. An explicit `binary.version` pins the target (tests/DSC).
    const { CORE_VERSION } = await import("../core/version.ts");
    const { describeUpdate } = await import("./npm-channel.ts");
    const current = opts.currentVersion ?? CORE_VERSION;
    const resolve = opts.releaseResolver ?? (await import("./release-feed.ts")).latestCompleteRelease;
    const target = opts.binary?.version ?? (await resolve());
    const d = describeUpdate(current, target);
    if (!target) return { ok: false, keptCurrent: current, reason: "release feed unreachable — nothing changed" };
    if (!d.updateAvailable) return { ok: false, keptCurrent: current, reason: d.message };
    plan = createBinaryUpdatePlan({ packageRoot: opts.packageRoot, ...(opts.binary ?? {}), version: target });
    if (!plan) return { ok: false, keptCurrent: current, reason: "binary update skipped (no current binary found)" };
    const res = await applyUpdate(plan); // candidate is a staging path; report the version
    return res.ok ? { ok: true, activated: target } : res;
  } else if (layout === "git") {
    plan = createGitUpdatePlan({ packageRoot: opts.packageRoot, ...opts.git });
    noPlanReason = "already up to date or fetch failed";
  } else {
    // XR-LAUNCH-007: delegate to the package manager that owns the install.
    const { fetchRegistryLatest, createNpmChannelPlan, describeUpdate } = await import("./npm-channel.ts");
    const { CORE_VERSION } = await import("../core/version.ts");
    const current = opts.currentVersion ?? CORE_VERSION;
    const latest = await fetchRegistryLatest(undefined, opts.npmChannel?.fetcher);
    if (!latest) {
      return { ok: false, keptCurrent: current, reason: "npm registry unreachable — nothing changed" };
    }
    plan = createNpmChannelPlan({
      packageRoot: opts.packageRoot,
      currentVersion: current,
      latest,
      ...(opts.npmChannel?.run ? { run: opts.npmChannel.run } : {}),
      ...(opts.npmChannel?.manager ? { manager: opts.npmChannel.manager } : {}),
    });
    noPlanReason = describeUpdate(current, latest.version).message;
    if (!plan) return { ok: false, keptCurrent: current, reason: noPlanReason };
  }

  if (!plan) {
    return { ok: false, keptCurrent: "", reason: noPlanReason };
  }
  return applyUpdate(plan);
}
