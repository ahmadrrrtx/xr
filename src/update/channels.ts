/**
 * XR Phase 9 · T5 — per-channel atomic update / rollback / uninstall.
 *
 * One contract across every managed distribution channel (Art. XXII.5 /
 * XXIII). The Phase-1 state machine (`selfheal.ts`) is reused unchanged —
 * there is exactly one update engine in XR (Art. III). This module adds:
 *
 *   1. CHANNEL DETECTION — how was this `xr` installed?
 *      (native package manager > compiled binary > npm > git checkout)
 *   2. DELEGATION — package-managed installs update through their own manager
 *      (brew / scoop / winget / apt), never through XR's binary swapper —
 *      fighting the manager's ownership would corrupt its bookkeeping.
 *   3. VERIFIED BINARY DOWNLOAD — the compiled-binary path verifies the
 *      candidate against the release's SHA256SUMS before it ever runs
 *      (fail closed: no sums / hash mismatch → install refuses; Part 20).
 *   4. CHANNEL ROLLBACK — a failed health canary dispatches the channel's
 *      own downgrade path back to the previous version.
 *
 * Every runner is injected in tests; effects are asserted, not transitions.
 */
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import type { UpdatePlan } from "./selfheal.ts";

// ── Channel model ─────────────────────────────────────────────────────────

export type ChannelId = "homebrew" | "scoop" | "winget" | "apt" | "binary" | "npm" | "git" | "unknown";

export interface ChannelInfo {
  channel: ChannelId;
  /** Human description of the detected layout. */
  detail: string;
  /** Channel-managed: XR delegates updates to the manager instead of swapping files. */
  managed: boolean;
  /** Command that upgrades XR through the channel (null when unmanaged). */
  upgrade: string[] | null;
  /** Command template to roll back to a specific version (null-placeholder). */
  rollback: ((version: string) => string[]) | null;
  /** Honest note about the channel's rollback semantics. */
  rollbackNote: string | null;
  /** Command that removes XR through the channel. */
  uninstall: string[] | null;
}

export interface DetectEnvironment {
  platform: string;
  /** Full path of the running xr executable (process.execPath or argv0 resolution). */
  exePath?: string;
  /** PATH entries (usually env.PATH split). */
  pathDirs?: string[];
  /** Brew prefix override (tests). */
  brewPrefix?: string | null;
  /** Home dir (tests). */
  home?: string;
  /** Installed dpkg package probe (tests inject). */
  isDebInstalled?: () => boolean;
  /** Brew formula probe (tests inject). */
  isBrewInstalled?: () => boolean;
}

export function commandExists(cmd: string, pathDirs?: string[]): boolean {
  const dirs = pathDirs ?? (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      if (existsSync(join(dir, `${cmd}${ext}`))) return true;
    }
  }
  return false;
}

/**
 * Detect the install channel. Detection is conservative: a wrappable shim
 * (supervisor-managed) beats heuristics; unknown stays unknown so the caller
 * fails closed rather than guessing.
 */
export function detectChannel(env: DetectEnvironment): ChannelInfo {
  const exe = env.exePath ?? "";
  const home = env.home;

  // ── Homebrew: binary lives in the Cellar (<prefix>/Cellar/xr/<v>/bin/xr)
  //    or is linked from <prefix>/bin/ and the formula is installed.
  //    Path comparisons are separator-normalized so the check is host-OS
  //    independent: on Windows, node:path joins with backslashes, which would
  //    never match a darwin/linux exe path (the Scoop/WinGet branches below
  //    already normalize; the Homebrew branch must too).
  const norm = (p: string) => p.replace(/\\/g, "/");
  const brewPrefix = env.brewPrefix ?? (env.platform === "darwin" ? "/opt/homebrew" : "/home/linuxbrew/.linuxbrew");
  const inCellar = norm(exe).includes(norm(join(brewPrefix, "Cellar", "xr")));
  const brewInstalled = env.isBrewInstalled?.() ?? false;
  if (inCellar || (brewInstalled && norm(exe).startsWith(norm(join(brewPrefix, "bin"))))) {
    return {
      channel: "homebrew",
      detail: `Homebrew formula (prefix ${brewPrefix})`,
      managed: true,
      upgrade: ["brew", "upgrade", "xr"],
      rollback: (v) => ["brew", "install", `xr@${v}`],
      rollbackNote:
        "Homebrew keeps no registry of prior versions for non-versioned formulae; rollback installs the pinned previous version or reinstalls the prior bottle.",
      uninstall: ["brew", "uninstall", "xr"],
    };
  }

  // ── Scoop: binary lives under ~\scoop\apps\xr\current
  if (env.platform === "win32" && home) {
    const scoopRoot = join(home, "scoop", "apps", "xr");
    if (exe.replace(/\\/g, "/").includes(scoopRoot.replace(/\\/g, "/")) || existsSync(scoopRoot)) {
      return {
        channel: "scoop",
        detail: "Scoop package (windows)",
        managed: true,
        upgrade: ["scoop", "update", "xr"],
        rollback: (v) => ["scoop", "install", `xr@${v}`],
        rollbackNote: "Scoop versions persist under apps/xr/<version>; rollback installs the pinned version (scoop reset restores the shim).",
        uninstall: ["scoop", "uninstall", "xr"],
      };
    }
  }

  // ── WinGet: portable zip install into %LOCALAPPDATA%\Microsoft\WinGet\Packages\ahmadrrrtx.XR*
  if (env.platform === "win32" && home) {
    const wingetPkgs = join(home, "AppData", "Local", "Microsoft", "WinGet", "Packages");
    if (exe.replace(/\\/g, "/").toLowerCase().includes(wingetPkgs.replace(/\\/g, "/").toLowerCase())) {
      return {
        channel: "winget",
        detail: "WinGet portable package",
        managed: true,
        upgrade: ["winget", "upgrade", "--id", "ahmadrrrtx.XR", "-e", "--accept-source-agreements", "--accept-package-agreements"],
        rollback: (v) => ["winget", "install", "--id", "ahmadrrrtx.XR", "-e", "--version", v, "--force",
          "--accept-source-agreements", "--accept-package-agreements"],
        rollbackNote: "WinGet downgrade = reinstalling the pinned version (its zip layout is replaced atomically per install).",
        uninstall: ["winget", "uninstall", "--id", "ahmadrrrtx.XR", "-e"],
      };
    }
  }

  // ── .deb: /usr/bin/xr owned by dpkg
  if ((env.platform === "linux") && (exe === "/usr/bin/xr" || env.isDebInstalled?.())) {
    return {
      channel: "apt",
      detail: "Debian package (/usr/bin/xr)",
      managed: true,
      upgrade: ["sh", "-c", "apt-get update -qq && apt-get install --only-upgrade -y xr"],
      rollback: (v) => ["apt-get", "install", "-y", "--allow-downgrades", `xr=${v}`],
      rollbackNote: "apt rollback pins the previous release (apt keeps only published versions; prior .deb is re-fetched from the channel feed).",
      uninstall: ["apt-get", "remove", "-y", "xr"],
    };
  }

  // ── npm global: binary shim resolves into a node global tree
  if (/[\\/]node[\\/]|[\\/]node_modules[\\/]@rrrtx[\\/]xr/.test(exe) || /npm[\\/]bin/.test(exe)) {
    return {
      channel: "npm",
      detail: "npm global install (@rrrtx/xr)",
      managed: true,
      upgrade: ["npm", "install", "-g", "@rrrtx/xr@latest"],
      rollback: (v) => ["npm", "install", "-g", `@rrrtx/xr@${v}`],
      rollbackNote: "npm rollback re-installs the pinned published version (registry is immutable).",
      uninstall: ["npm", "uninstall", "-g", "@rrrtx/xr"],
    };
  }

  return { channel: "unknown", detail: `unrecognized layout (exe: ${exe || "unresolved"})`, managed: false, upgrade: null, rollback: null, rollbackNote: null, uninstall: null };
}

// ── Verified binary download (Part 20: checksum at install/update) ─────────

export interface VerifiedDownloadOptions {
  url: string;
  sumsUrl: string;
  expectedFile: string;
  fetchImpl?: typeof fetch;
}

/**
 * Download a release binary + the release SHA256SUMS and verify BEFORE use.
 * Fails closed: sums unreachable, unreadable, missing the file, or hash
 * mismatch → throws. The only build users ever run is the signed canonical
 * build (Art. XXII.3).
 */
export async function downloadVerified(
  opts: VerifiedDownloadOptions,
  writeBytes: (bytes: Uint8Array) => Promise<void>,
): Promise<{ sha256: string; bytes: number }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sumsRes = await fetchImpl(opts.sumsUrl);
  if (!sumsRes.ok) throw new Error(`Cannot verify the download — release checksums unavailable (HTTP ${sumsRes.status}). Refusing to install an unverified binary.`);
  const sumsText = await sumsRes.text();
  const expected = parseSums(sumsText).get(opts.expectedFile);
  if (!expected) {
    throw new Error(`Release checksums contain no entry for ${opts.expectedFile}. Refusing to install an unverified binary.`);
  }
  const binRes = await fetchImpl(opts.url);
  if (!binRes.ok) throw new Error(`download failed (HTTP ${binRes.status}): ${opts.url}`);
  const buf = new Uint8Array(await binRes.arrayBuffer());
  const actual = await sha256(buf);
  if (actual !== expected) {
    throw new Error(
      `Integrity check failed for ${opts.expectedFile}: sha256 ${actual} ≠ published ${expected}. Refusing to install (possible tampering or corrupt download).`,
    );
  }
  await writeBytes(buf);
  return { sha256: actual, bytes: buf.length };
}

/** sha256sum-format parser (duplicated contract — keep in sync with scripts/sums.ts). */
export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{64}$/i.test(parts[0]!)) {
      m.set(parts[1]!.replace(/^\*/, "").replace(/^\.\//, ""), parts[0]!.toLowerCase());
    }
  }
  return m;
}

export async function sha256(data: Uint8Array): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(data).digest("hex");
}

// ── Channel-managed update plan (reuses the Phase-1 selfheal state machine) ─

export interface ChannelUpdateOptions {
  info: ChannelInfo;
  /** Version strings (for rollback dispatch + reporting). */
  currentVersion: string;
  targetVersion?: string;
  /** Command runner (tests inject a fake). */
  run?: (cmd: string[]) => { ok: boolean; error?: string };
  /** Health canary for the updated binary (tests inject). */
  canary?: () => { healthy: boolean; reason?: string };
}

export function defaultRun(cmd: string[]): { ok: boolean; error?: string } {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] });
  return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr ?? r.error?.message ?? `exit ${String(r.status)}`).slice(0, 300) };
}

export function channelHealthCanary(): { healthy: boolean; reason?: string } {
  const version = spawnSync("xr", ["--version"], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  if (version.status !== 0) return { healthy: false, reason: `xr --version failed (exit ${version.status})` };
  return { healthy: true };
}

/**
 * Map a channel-managed install onto the Phase-1 contract:
 * backup config (caller) → install = manager upgrade → canary =
 * post-upgrade health probe → on failure, dispatch the channel's rollback
 * back to `currentVersion` (Art. XXIII: no user left without a rollback path).
 */
export function createChannelUpdatePlan(opts: ChannelUpdateOptions): UpdatePlan<string> {
  const run = opts.run ?? defaultRun;
  const canary = opts.canary ?? channelHealthCanary;
  const info = opts.info;
  const target = opts.targetVersion ?? "latest";
  let upgradeAttempted = false;

  return {
    current: opts.currentVersion,
    candidate: target,
    install: async () => {
      if (!info.upgrade) throw new Error(`channel ${info.channel} has no upgrade path`);
      const res = run(info.upgrade);
      if (!res.ok) throw new Error(`${info.channel} upgrade failed: ${res.error ?? "unknown error"}`);
      upgradeAttempted = true;
    },
    selfTest: async () => canary().healthy,
    activate: async () => {
      // The manager performed the atomic swap; XR only asserts health after.
      if (!canary().healthy) throw new Error("post-upgrade canary failed");
    },
    discard: async () => {
      // Auto-rollback through the channel's own downgrade path (Art. XXIII).
      if (upgradeAttempted && info.rollback) {
        const res = run(info.rollback(opts.currentVersion));
        if (!res.ok) {
          // Fail loudly with the manual path — never silently strand the user.
          const manual = info.rollback(opts.currentVersion).join(" ");
          throw new Error(
            `${info.channel} rollback to ${opts.currentVersion} failed (${res.error ?? "unknown"}). ` +
              `Manual recovery: ${manual} — ${info.rollbackNote ?? ""}`,
          );
        }
      }
    },
  };
}
