/**
 * XR Phase 9 · T5 — distribution channels for update/rollback/uninstall.
 *
 * ONE updater (src/update/) serves every channel; this module is the mapping —
 * never a second updater (Constitution Art. III.2).
 *
 * Ownership model (Art. XXIII reversibility):
 *   - XR-owned channels (github-releases binary, npm, git-checkout): XR performs
 *     the atomic blue-green update with a health canary + automatic rollback
 *     (Phase 1 · T11 contract), now with release-checksum verification (Phase 9).
 *   - Package-manager-owned channels (homebrew, scoop, winget, deb, rpm,
 *     docker): the PM owns atomicity + rollback. `xr update` NEVER half-edits a
 *     PM-owned install — it prints the exact update command AND the exact
 *     rollback command, and exits 0 when already instructed (docs:
 *     docs/release/CHANNELS.md). The mapping below is validated against the
 *     release manifest channels by test/release/channel-update.test.ts.
 *
 * Channel detection precedence:
 *   1. $XR_HOME/install.json `channel` (written by install.sh/install.ps1/brew
 *      wrapper); 2. executable path heuristics (cheap, no shell-outs beyond
 *      the paths themselves); 3. the legacy binary/git/npm layout detection.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export type ChannelId =
  | "github-releases"
  | "homebrew"
  | "scoop"
  | "winget"
  | "deb"
  | "rpm"
  | "npm"
  | "docker"
  | "git-checkout";

export type UpdateOwner = "xr" | "channel";

export interface ChannelDef {
  id: ChannelId;
  owner: UpdateOwner;
  /** For PM-owned channels: the exact commands printed by `xr update`. */
  update?: string;
  rollback?: string;
  /** For PM-owned channels: uninstall command (XR-owned channels use `xr uninstall`). */
  uninstall?: string;
}

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  "github-releases": { id: "github-releases", owner: "xr" },
  npm: { id: "npm", owner: "xr" },
  "git-checkout": { id: "git-checkout", owner: "xr" },
  homebrew: {
    id: "homebrew",
    owner: "channel",
    update: "brew upgrade ahmadrrrtx/tap/xr",
    rollback: "brew switch xr <previous-version>   # brew keeps prior Cellar versions",
    uninstall: "brew uninstall xr && xr uninstall --purge   # removes the formula + XR data",
  },
  scoop: {
    id: "scoop",
    owner: "channel",
    update: "scoop update xr",
    rollback: "scoop reset xr@<previous-version>",
    uninstall: "scoop uninstall xr",
  },
  winget: {
    id: "winget",
    owner: "channel",
    update: "winget upgrade ahmadrrrtx.XR",
    rollback: "winget install ahmadrrrtx.XR --version <previous-version> --force",
    uninstall: "winget uninstall ahmadrrrtx.XR",
  },
  deb: {
    id: "deb",
    owner: "channel",
    update: "sudo dpkg -i xr_<new-version>-1_<arch>.deb   # from the GitHub release",
    rollback: "sudo dpkg -i xr_<previous-version>-1_<arch>.deb",
    uninstall: "sudo dpkg -r xr   # XR data under ~/.xr stays unless purged",
  },
  rpm: {
    id: "rpm",
    owner: "channel",
    update: "sudo rpm -Uvh xr-<new-version>-1.<arch>.rpm",
    rollback: "sudo rpm -Uvh --oldpackage xr-<previous-version>-1.<arch>.rpm",
    uninstall: "sudo rpm -e xr",
  },
  docker: {
    id: "docker",
    owner: "channel",
    update: "docker pull ghcr.io/ahmadrrrtx/xr:latest",
    rollback: "docker pull ghcr.io/ahmadrrrtx/xr:<previous-version>   # immutable version tags",
    uninstall: "docker rmi ghcr.io/ahmadrrrtx/xr   # data volume persists until removed",
  },
};

// ── Install record ($XR_HOME/install.json) ───────────────────────────────────

export interface InstallRecord {
  channel: ChannelId;
  layout: "binary" | "git" | "npm" | "package-manager";
  version: string;
  installedAt: string;
  installer: string;
}

export function installRecordPath(xrHome: string = process.env.XR_HOME ?? ""): string {
  return join(xrHome, "install.json");
}

/** Read the install record; returns null when absent/malformed (fail open to legacy detection). */
export function readInstallRecord(dir: string): InstallRecord | null {
  try {
    const raw = readFileSync(installRecordPath(dir), "utf8");
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.channel !== "string" || !(o.channel in CHANNELS)) return null;
    return {
      channel: o.channel as ChannelId,
      layout: (o.layout as InstallRecord["layout"]) ?? "binary",
      version: typeof o.version === "string" ? o.version : "",
      installedAt: typeof o.installedAt === "string" ? o.installedAt : "",
      installer: typeof o.installer === "string" ? o.installer : "unknown",
    };
  } catch {
    return null; // no record yet (pre-7.1.0 installs) — legacy detection below
  }
}

/**
 * The installer writes install.json to the runtime data home AND next to the
 * installation (package root), because the two directories legitimately differ
 * (default: ~/.xr data vs ~/.xr-agent install root).
 */
export function readInstallRecordAny(dirs: string[]): InstallRecord | null {
  for (const d of dirs) {
    const r = readInstallRecord(d);
    if (r) return r;
  }
  return null;
}

// ── Path heuristics (cheap probes; no package-manager shell-outs per call) ───

export function channelFromExecutablePath(exePath: string): ChannelId | null {
  const p = exePath.replace(/\\/g, "/");
  if (/\/Cellar\/xr\//.test(p) || p.includes("/homebrew/") || p.includes("/linuxbrew/")) return "homebrew";
  if (p.includes("/scoop/apps/xr/")) return "scoop";
  if (/\/usr\/bin\/xr$/.test(p) || /\/usr\/local\/bin\/xr$/.test(p)) {
    // Owned by a .deb/.rpm payload exactly when NOT inside a user-managed dist dir.
    return "deb"; // rpm payload path is identical; see disambiguateSystemPackage()
  }
  return null;
}

/**
 * Resolve the channel for THIS running installation.
 * `opts.packageRoot` is the installation root (for layout detection fallback),
 * `opts.exePath` the running executable (process.execPath or $XR_BINARY).
 */
export function detectChannel(opts: {
  xrHome: string;
  packageRoot: string;
  exePath?: string;
  legacyLayout: "binary" | "git" | "npm";
}): { channel: ChannelId; via: "install.json" | "path" | "legacy" } {
  const record = readInstallRecordAny([opts.xrHome, opts.packageRoot]);
  if (record) return { channel: record.channel, via: "install.json" };

  if (opts.exePath) {
    const fromPath = channelFromExecutablePath(opts.exePath);
    if (fromPath) return { channel: fromPath, via: "path" };
  }

  // Legacy (pre-7.1.0) installs carry no record: map the Phase-1/3 layouts.
  const legacy: Record<"binary" | "git" | "npm", ChannelId> = {
    binary: "github-releases",
    git: "git-checkout",
    npm: "npm",
  };
  return { channel: legacy[opts.legacyLayout], via: "legacy" };
}

/**
 * The rollback guidance attached to EVERY update response (Art. XXIII — a user
 * must never be left without a rollback path, per channel).
 */
export function rollbackHintFor(channel: ChannelId): string {
  const def = CHANNELS[channel];
  if (def.owner === "xr") {
    switch (channel) {
      case "npm":
        return "npm i -g @rrrtx/xr@<previous-version>";
      case "git-checkout":
        return "git checkout <previous-tag> && bun install";
      default:
        return "re-run xr update targeting the previous version — the updater swaps atomically and keeps the prior binary";
    }
  }
  return def.rollback ?? "unknown channel — see docs/release/CHANNELS.md";
}
