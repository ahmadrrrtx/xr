/**
 * Launch audit XR-LAUNCH-007 — `xr update` for the npm / bun global layout.
 *
 * Before: `xr update` read `release.manifest.json` unconditionally (it is not
 * in the npm tarball → ENOENT), and the npm plan asked `npm view
 * @rrrtx/xr@installed` (not a valid spec → empty → "already up to date"), then
 * canaried the candidate with repo-only scripts that the tarball does not
 * contain. npm users could never update, and were told they were current.
 *
 * Now the npm layout delegates to the package manager that owns the install:
 *   current   = the running package's stamped CORE_VERSION
 *   candidate = the registry's dist-tags.latest (only if strictly newer)
 *   install   = resolve the candidate's registry metadata (integrity + bin)
 *   selfTest  = metadata names this package, this version, and an `xr` bin
 *   activate  = `npm install -g` or `bun add -g` <pkg>@<candidate>, then the
 *               installed `xr --version` must report the candidate; otherwise
 *               the previous version is re-installed (rollback) and it fails.
 */
import { spawnSync } from "node:child_process";
import { compareSemver } from "../skills/semver.ts";
import type { UpdatePlan } from "./selfheal.ts";

export const NPM_PACKAGE = "@rrrtx/xr";
export const NPM_REGISTRY = "https://registry.npmjs.org";

/** An endpoint override is honored only for https or loopback http (XR-LAUNCH-011 journeys, mirrors). */
export function endpointOverride(value: string | undefined): string | null {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/\S+$/.test(v) || /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/\S*)?$/.test(v) ? v : null;
}

/** The registry `npm install -g` will use (npm's own env var), so check and install agree. */
export function npmRegistry(env: Record<string, string | undefined> = process.env): string {
  // npm's own precedence for a scoped package: `@scope:registry`, then `registry`.
  return endpointOverride(env["npm_config_@rrrtx:registry"] ?? env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY) ?? NPM_REGISTRY;
}

export type GlobalManager = "npm" | "bun";

export type RegistryFetcher = (url: string) => Promise<{ status: number; json: () => Promise<unknown> }>;

export interface RegistryRelease {
  version: string;
  integrity: string | null;
  tarball: string | null;
  hasXrBin: boolean;
}

/** Which package manager owns a global install rooted at `packageRoot`. */
export function detectGlobalManager(packageRoot: string): GlobalManager {
  return /[\\/]\.bun[\\/]install[\\/]global[\\/]/.test(packageRoot) ? "bun" : "npm";
}

export function globalInstallCommand(manager: GlobalManager, pkg: string, version: string): string[] {
  return manager === "bun" ? ["bun", "add", "-g", `${pkg}@${version}`] : ["npm", "install", "-g", `${pkg}@${version}`];
}

const defaultFetcher: RegistryFetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  return { status: res.status, json: () => res.json() };
};

/** The registry's `latest` for `pkg`, with what we need to verify it. Null when unreachable. */
export async function fetchRegistryLatest(
  pkg: string = NPM_PACKAGE,
  fetcher: RegistryFetcher = defaultFetcher,
): Promise<RegistryRelease | null> {
  let res: Awaited<ReturnType<RegistryFetcher>>;
  try {
    res = await fetcher(`${npmRegistry()}/${pkg.replace("/", "%2F")}`);
  } catch {
    return null;
  }
  if (res.status !== 200) return null;
  const doc = (await res.json()) as {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, { version?: string; bin?: Record<string, string> | string; dist?: { integrity?: string; tarball?: string } }>;
  };
  const latest = doc["dist-tags"]?.latest;
  if (!latest) return null;
  const meta = doc.versions?.[latest];
  const bin = meta?.bin;
  return {
    version: latest,
    integrity: meta?.dist?.integrity ?? null,
    tarball: meta?.dist?.tarball ?? null,
    hasXrBin: typeof bin === "string" || Boolean(bin && typeof bin === "object" && "xr" in bin),
  };
}

export interface UpdateCheck {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  /** Human sentence for the CLI. */
  message: string;
}

export function describeUpdate(current: string, latest: string | null): UpdateCheck {
  if (!latest) {
    return { current, latest, updateAvailable: false, message: "could not reach the update source" };
  }
  const cmp = compareSemver(latest, current);
  if (cmp > 0) return { current, latest, updateAvailable: true, message: `update available: ${current} → ${latest}` };
  if (cmp === 0) return { current, latest, updateAvailable: false, message: `up to date (${current})` };
  return {
    current,
    latest,
    updateAvailable: false,
    message: `running ${current}, newer than the published ${latest} (development build); nothing to update`,
  };
}

export interface NpmPlanOptions {
  packageRoot: string;
  currentVersion: string;
  latest: RegistryRelease;
  pkg?: string;
  manager?: GlobalManager;
  /** Command runner (tests inject). */
  run?: (cmd: string[]) => { status: number | null; stdout: string; stderr: string };
}

const defaultRun = (cmd: string[]) => {
  const r = spawnSync(cmd[0]!, cmd.slice(1), { encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.error ? String(r.error.message) : (r.stderr ?? "") };
};

/** Null when there is nothing newer to install. */
export function createNpmChannelPlan(opts: NpmPlanOptions): UpdatePlan<string> | null {
  const pkg = opts.pkg ?? NPM_PACKAGE;
  const run = opts.run ?? defaultRun;
  const manager = opts.manager ?? detectGlobalManager(opts.packageRoot);
  const { latest } = opts;
  if (compareSemver(latest.version, opts.currentVersion) <= 0) return null;

  const installedVersion = (): string | null => {
    const r = run(["xr", "--version"]);
    return r.status === 0 ? (r.stdout.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1] ?? null) : null;
  };

  return {
    current: opts.currentVersion,
    candidate: latest.version,
    // Nothing is staged on disk: the package manager verifies the tarball
    // against the registry's integrity hash during activation.
    install: () => {
      if (!latest.integrity || !latest.tarball) {
        throw new Error(`registry metadata for ${pkg}@${latest.version} has no integrity/tarball`);
      }
    },
    selfTest: () => latest.hasXrBin,
    activate: (v: string) => {
      const res = run(globalInstallCommand(manager, pkg, v));
      if (res.status !== 0) {
        throw new Error(`${manager} global install of ${pkg}@${v} failed: ${res.stderr.trim().slice(0, 300)}`);
      }
      const now = installedVersion();
      if (now !== v) {
        // Roll back to exactly what was running before.
        run(globalInstallCommand(manager, pkg, opts.currentVersion));
        throw new Error(
          `installed xr reports ${now ?? "nothing"} instead of ${v}; re-installed ${opts.currentVersion} (rollback)`,
        );
      }
    },
  };
}
