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
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
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
  /** Timeout for the download + canary, ms. */
  timeoutMs?: number;
  /** Override the canary (tests inject a fake). */
  canary?: (binaryPath: string) => { healthy: boolean; reason?: string };
  /**
   * Phase 9 · T5/Part-20 — integrity is MANDATORY for binary updates.
   * Default true: the updater fetches SHA256SUMS from the release and refuses
   * a candidate whose hash is absent or mismatched (no unsigned distribution).
   * Do not disable outside tests that explicitly assert the refusal behavior.
   */
  requireChecksums?: boolean;
  /** Override the checksum fetch (tests inject a local server/fixture). */
  fetchSums?: (url: string) => Promise<{ ok: boolean; text: string }>;
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

/** Parse a SHA256SUMS body: "<hex>  <name>" lines → name → digest. */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out.set(m[2]!.replace(/^\.\//, ""), m[1]!.toLowerCase());
  }
  return out;
}

async function fetchText(url: string): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(url);
  return res.ok ? { ok: true, text: await res.text() } : { ok: false, text: "" };
}

export function createBinaryUpdatePlan(opts: BinaryUpdateOptions): UpdatePlan<string> | null {
  const current = binaryPathForPackage(opts.packageRoot);
  if (!current) return null;
  const file = binaryFileName();
  const baseUrl =
    opts.baseUrl ?? `https://github.com/ahmadrrrtx/xr/releases/download/v${opts.version}`;
  const url = `${baseUrl}/${file}`;
  const sumsUrl = `${baseUrl}/SHA256SUMS`;
  const requireChecksums = opts.requireChecksums ?? true;
  const stagingDir = join(opts.packageRoot, "dist", ".staging");
  const candidate = join(stagingDir, `xr-${opts.version}`);

  return {
    current,
    candidate,
    install: async () => {
      mkdirSync(stagingDir, { recursive: true });

      // Phase 9 · T5 — fetch the release checksums FIRST (integrity authority
      // for every asset in the release; Part 20: no unsigned distribution).
      const fetcher = opts.fetchSums ?? fetchText;
      const sumsRes = await fetcher(sumsUrl);
      if (requireChecksums && !sumsRes.ok) {
        throw new Error(
          `release checksums unavailable (HTTP failure): ${sumsUrl}. ` +
            `Refusing an integrity-unverified update. Retry, or install manually per docs/release/INSTALLATION.md.`,
        );
      }
      const expected = sumsRes.ok ? parseSha256Sums(sumsRes.text).get(file) : undefined;
      if (requireChecksums && !expected) {
        throw new Error(`no SHA256SUMS entry for ${file} in ${sumsUrl} — refusing (tamper-evidence)`);
      }

      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed (HTTP ${res.status}): ${url}`);
      const buf = new Uint8Array(await res.arrayBuffer());

      if (expected) {
        const actual = createHash("sha256").update(buf).digest("hex");
        if (actual !== expected) {
          throw new Error(
            `checksum mismatch for ${file}: SHA256SUMS=${expected.slice(0, 12)}… actual=${actual.slice(0, 12)}… — refusing (tamper-evidence)`,
          );
        }
      }

      await Bun.write(candidate, buf);
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
  version?: string;
  git?: GitUpdateOptions;
  npm?: NpmUpdateOptions;
  binary?: BinaryUpdateOptions;
}): Promise<UpdateResult<string>> {
  const layout = detectInstallLayout(opts.packageRoot);
  let plan: UpdatePlan<string> | null = null;
  let noPlanReason = "already up to date or update source unreachable";

  if (layout === "binary") {
    const version = opts.version ?? opts.binary?.version;
    if (!version) {
      return { ok: false, keptCurrent: "", reason: "binary layout update requires a target version (release manifest missing)" };
    }
    plan = createBinaryUpdatePlan({
      packageRoot: opts.packageRoot,
      version,
      ...(opts.binary ?? {}),
    });
    noPlanReason = "binary update skipped (no current binary found)";
  } else if (layout === "git") {
    plan = createGitUpdatePlan({ packageRoot: opts.packageRoot, ...opts.git });
    noPlanReason = "already up to date or fetch failed";
  } else {
    plan = createNpmUpdatePlan(opts.npm);
    noPlanReason = "already up to date or registry unreachable";
  }

  if (!plan) {
    return { ok: false, keptCurrent: "", reason: noPlanReason };
  }
  return applyUpdate(plan);
}
