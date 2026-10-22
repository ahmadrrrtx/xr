/**
 * `xr update --check` and the running-version probe (launch audit XR-LAUNCH-007).
 * Split out of src/install/system.ts; `updateXR` there imports both.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { info, ok, warn } from "../interfaces/cli.ts";
import { detectInstallLayout } from "./atomic-updater.ts";

/**
 * The running package's version and, when present, the release manifest's
 * version. XR-LAUNCH-007: the npm tarball historically omitted
 * release.manifest.json, and reading it unconditionally made `xr update`
 * crash with ENOENT for every npm user. The stamped CORE_VERSION is the
 * authority for "what is running"; the manifest is optional.
 */
export async function runningVersion(rootDir: string): Promise<string> {
  const { CORE_VERSION } = await import("../core/version.ts");
  try {
    const release = JSON.parse(readFileSync(join(rootDir, "release.manifest.json"), "utf8")) as {
      identity?: { version?: string };
      version?: string;
    };
    return release.identity?.version ?? release.version ?? CORE_VERSION;
  } catch {
    return CORE_VERSION;
  }
}

/** `xr update --check`: report only, change nothing. Exit 0 when the source answered. */
export async function checkForUpdate(args: string[], rootDir: string): Promise<void> {
  const { detectChannel } = await import("./channels.ts");
  const { describeUpdate, fetchRegistryLatest, detectGlobalManager } = await import("./npm-channel.ts");
  const current = await runningVersion(rootDir);
  const json = args.includes("--json");
  const channel = detectChannel({ platform: process.platform, exePath: process.execPath });
  let source: string;
  let latest: string | null = null;
  if (channel.managed && channel.channel !== "npm") {
    source = channel.channel;
    const report = {
      current,
      latest: null,
      updateAvailable: false,
      source,
      message: `managed by ${channel.channel} (${channel.detail}); ask it: ${channel.upgrade?.join(" ") ?? "see its docs"}`,
    };
    if (json) console.log(JSON.stringify(report));
    else info(report.message);
    return;
  }
  const layout = standaloneBinary(rootDir) ? "binary" : detectInstallLayout(rootDir);
  if (layout === "npm") {
    source = `npm registry (${detectGlobalManager(rootDir)} global install)`;
    latest = (await fetchRegistryLatest())?.version ?? null;
  } else {
    // Binary and source installs come from GitHub Releases. Only a complete
    // release counts: published, not a pre-release, and carrying SHA256SUMS —
    // a desktop-only or half-published release is never "an update".
    source = `GitHub Releases (${layout} install)`;
    latest = await latestCompleteRelease();
  }
  const d = describeUpdate(current, latest);
  if (json) {
    console.log(JSON.stringify({ ...d, source }));
  } else {
    info(`Running ${current} · source: ${source}`);
    if (latest) ok(d.message);
    else warn(d.message);
    if (d.updateAvailable) info("Run `xr update` to install it (atomic, with rollback).");
  }
  if (!latest) process.exitCode = 1;
}

/** Newest published, non-pre-release GitHub release that carries SHA256SUMS. */
export async function latestCompleteRelease(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<string | null> {
  const { compareSemver } = await import("../skills/semver.ts");
  try {
    const res = await fetcher("https://api.github.com/repos/ahmadrrrtx/xr/releases?per_page=20", {
      headers: { accept: "application/vnd.github+json", "user-agent": "xr-update-check" },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: Array<{ name?: string }> }>;
    let best: string | null = null;
    for (const r of list) {
      if (r.draft || r.prerelease || !r.tag_name) continue;
      if (!r.assets?.some((a) => a.name === "SHA256SUMS")) continue;
      const v = r.tag_name.replace(/^v/, "");
      if (!best || compareSemver(v, best) > 0) best = v;
    }
    return best;
  } catch {
    return null;
  }
}

/** True inside a `bun build --compile` binary (modules live in Bun's virtual FS). */
export function isCompiledBinary(url: string = import.meta.url): boolean {
  return /\$bunfs|~BUN/.test(url);
}

/**
 * A compiled binary that is not inside a package `dist/` layout — i.e. one the
 * bootstrap installer placed on PATH. Its in-place update path is
 * XR-LAUNCH-019; until then it must never be routed to npm (it is not an npm
 * install) and `xr update` points at the verified installer instead.
 */
export function standaloneBinary(rootDir: string): boolean {
  return isCompiledBinary() && detectInstallLayout(rootDir) !== "binary";
}

export function installerCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? "iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)"
    : "curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash";
}
