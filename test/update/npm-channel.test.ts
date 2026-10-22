/**
 * Launch audit XR-LAUNCH-007 — `xr update` on the npm / bun global layout.
 * Fixture tests: fake registry + fake command runner, no network, no global installs.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAtomicUpdate } from "../../src/update/atomic-updater.ts";
import { installerCommand, isCompiledBinary, latestCompleteRelease, runningVersion, standaloneBinary } from "../../src/update/check.ts";
import {
  createNpmChannelPlan,
  describeUpdate,
  detectGlobalManager,
  fetchRegistryLatest,
  globalInstallCommand,
  type RegistryFetcher,
  type RegistryRelease,
} from "../../src/update/npm-channel.ts";
import { applyUpdate } from "../../src/update/selfheal.ts";

const ROOT = join(import.meta.dir, "..", "..");

const registry = (latest: string, extra: Record<string, unknown> = {}): RegistryFetcher => async (url) => {
  expect(url).toBe("https://registry.npmjs.org/@rrrtx%2Fxr");
  return {
    status: 200,
    json: async () => ({
      "dist-tags": { latest },
      versions: {
        [latest]: {
          version: latest,
          bin: { xr: "./bin/xr" },
          dist: { integrity: "sha512-REDACTED-test", tarball: `https://registry.npmjs.org/@rrrtx/xr/-/xr-${latest}.tgz` },
          ...extra,
        },
      },
    }),
  };
};

const release = (version: string): RegistryRelease => ({
  version,
  integrity: "sha512-REDACTED-test",
  tarball: `https://registry.npmjs.org/@rrrtx/xr/-/xr-${version}.tgz`,
  hasXrBin: true,
});

/** A fake machine: the global install changes what `xr --version` prints. */
function fakeMachine(start: string, opts: { failInstall?: boolean; brokenInstall?: boolean } = {}) {
  let installed = start;
  const calls: string[][] = [];
  const run = (cmd: string[]) => {
    calls.push(cmd);
    if (cmd[0] === "xr" && cmd[1] === "--version") return { status: 0, stdout: `v${installed} (Truth)\n`, stderr: "" };
    if ((cmd[0] === "npm" && cmd[1] === "install") || (cmd[0] === "bun" && cmd[1] === "add")) {
      if (opts.failInstall) return { status: 1, stdout: "", stderr: "EACCES: permission denied" };
      const v = cmd[3]!.split("@").pop()!;
      installed = opts.brokenInstall && v !== start ? "0.0.0" : v;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 127, stdout: "", stderr: "unexpected" };
  };
  return { run, calls, installed: () => installed };
}

describe("XR-LAUNCH-007 · the npm tarball carries what `xr update` reads", () => {
  test("package.json files[] ships release.manifest.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files: string[] };
    expect(pkg.files).toContain("release.manifest.json");
  });

  test("the running version no longer needs the manifest (falls back to CORE_VERSION)", async () => {
    const { CORE_VERSION } = await import("../../src/core/version.ts");
    expect(await runningVersion("/nonexistent-package-root")).toBe(CORE_VERSION);
    expect(await runningVersion(ROOT)).toBe(JSON.parse(readFileSync(join(ROOT, "release.manifest.json"), "utf8")).identity.version);
  });

  test("binary/git --check ignores pre-releases and releases without SHA256SUMS", async () => {
    const releases = [
      { tag_name: "v1.1.0", prerelease: false, assets: [{ name: "XR_1.1.0_x64-setup.exe" }] }, // desktop-only (withdrawn)
      { tag_name: "v1.2.0-beta.1", prerelease: true, assets: [{ name: "SHA256SUMS" }] },
      { tag_name: "v1.0.0", prerelease: false, assets: [{ name: "SHA256SUMS" }, { name: "xr-linux-x64" }] },
      { tag_name: "v0.9.0", prerelease: false, assets: [{ name: "SHA256SUMS" }] },
    ];
    const ok = (async () => new Response(JSON.stringify(releases), { status: 200 })) as never;
    expect(await latestCompleteRelease(ok)).toBe("1.0.0");
    expect(await latestCompleteRelease((async () => new Response("", { status: 403 })) as never)).toBeNull();
  });
});

describe("XR-LAUNCH-007 · registry + version logic", () => {
  test("fetchRegistryLatest reads dist-tags.latest with integrity and bin", async () => {
    const r = await fetchRegistryLatest(undefined, registry("1.0.1"));
    expect(r).toEqual({
      version: "1.0.1",
      integrity: "sha512-REDACTED-test",
      tarball: "https://registry.npmjs.org/@rrrtx/xr/-/xr-1.0.1.tgz",
      hasXrBin: true,
    });
  });

  test("an unreachable registry is null, never 'up to date'", async () => {
    expect(await fetchRegistryLatest(undefined, async () => ({ status: 503, json: async () => ({}) }))).toBeNull();
    expect(await fetchRegistryLatest(undefined, async () => { throw new Error("offline"); })).toBeNull();
    expect(describeUpdate("1.0.0", null).message).toBe("could not reach the update source");
  });

  test("describeUpdate distinguishes newer, equal and development builds", () => {
    expect(describeUpdate("1.0.0", "1.0.1").updateAvailable).toBe(true);
    expect(describeUpdate("1.0.0", "1.0.0").message).toBe("up to date (1.0.0)");
    expect(describeUpdate("1.1.0", "1.0.0").message).toContain("development build");
    expect(describeUpdate("1.0.0-beta.1", "1.0.0").updateAvailable).toBe(true);
  });

  test("the owning manager is detected from the install path", () => {
    expect(detectGlobalManager("/usr/lib/node_modules/@rrrtx/xr")).toBe("npm");
    expect(detectGlobalManager("/home/u/.bun/install/global/node_modules/@rrrtx/xr")).toBe("bun");
    expect(globalInstallCommand("bun", "@rrrtx/xr", "1.0.1")).toEqual(["bun", "add", "-g", "@rrrtx/xr@1.0.1"]);
    expect(globalInstallCommand("npm", "@rrrtx/xr", "1.0.1")).toEqual(["npm", "install", "-g", "@rrrtx/xr@1.0.1"]);
  });
});

describe("XR-LAUNCH-007 · the update plan delegates to the package manager", () => {
  test("no plan when the registry is not newer (no downgrade of a dev build)", () => {
    expect(createNpmChannelPlan({ packageRoot: "/x", currentVersion: "1.1.0", latest: release("1.0.0") })).toBeNull();
    expect(createNpmChannelPlan({ packageRoot: "/x", currentVersion: "1.0.0", latest: release("1.0.0") })).toBeNull();
  });

  test("npm global: installs the candidate and verifies the installed version", async () => {
    const m = fakeMachine("1.0.0");
    const plan = createNpmChannelPlan({ packageRoot: "/usr/lib/node_modules/@rrrtx/xr", currentVersion: "1.0.0", latest: release("1.0.1"), run: m.run });
    const r = await applyUpdate(plan!);
    expect(r).toEqual({ ok: true, activated: "1.0.1" });
    expect(m.calls).toContainEqual(["npm", "install", "-g", "@rrrtx/xr@1.0.1"]);
    expect(m.installed()).toBe("1.0.1");
  });

  test("bun global: uses `bun add -g`", async () => {
    const m = fakeMachine("1.0.0");
    const plan = createNpmChannelPlan({ packageRoot: "/h/.bun/install/global/node_modules/@rrrtx/xr", currentVersion: "1.0.0", latest: release("1.0.1"), run: m.run });
    expect((await applyUpdate(plan!)).ok).toBe(true);
    expect(m.calls).toContainEqual(["bun", "add", "-g", "@rrrtx/xr@1.0.1"]);
  });

  test("a failed global install leaves the current version and says why", async () => {
    const m = fakeMachine("1.0.0", { failInstall: true });
    const plan = createNpmChannelPlan({ packageRoot: "/usr/lib/node_modules/@rrrtx/xr", currentVersion: "1.0.0", latest: release("1.0.1"), run: m.run });
    const r = await applyUpdate(plan!);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.keptCurrent).toBe("1.0.0");
      expect(r.reason).toContain("EACCES");
    }
    expect(m.installed()).toBe("1.0.0");
  });

  test("an install that does not report the candidate is rolled back to the previous version", async () => {
    const m = fakeMachine("1.0.0", { brokenInstall: true });
    const plan = createNpmChannelPlan({ packageRoot: "/usr/lib/node_modules/@rrrtx/xr", currentVersion: "1.0.0", latest: release("1.0.1"), run: m.run });
    const r = await applyUpdate(plan!);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("rollback");
    expect(m.calls.at(-1)).toEqual(["npm", "install", "-g", "@rrrtx/xr@1.0.0"]);
    expect(m.installed()).toBe("1.0.0");
  });

  test("registry metadata without integrity, or without an xr bin, is refused before anything is installed", async () => {
    const m = fakeMachine("1.0.0");
    const noIntegrity = createNpmChannelPlan({ packageRoot: "/n", currentVersion: "1.0.0", latest: { ...release("1.0.1"), integrity: null }, run: m.run });
    expect((await applyUpdate(noIntegrity!)).ok).toBe(false);
    const noBin = createNpmChannelPlan({ packageRoot: "/n", currentVersion: "1.0.0", latest: { ...release("1.0.1"), hasXrBin: false }, run: m.run });
    expect((await applyUpdate(noBin!)).ok).toBe(false);
    expect(m.calls.filter((c) => c[1] === "install")).toEqual([]);
  });

  test("runAtomicUpdate on the npm layout: registry unreachable is a failure, not 'already up to date'", async () => {
    const r = await runAtomicUpdate({
      packageRoot: "/nonexistent-npm-root",
      currentVersion: "1.0.0",
      channel: { channel: "npm", managed: false } as never,
      npmChannel: { fetcher: async () => ({ status: 500, json: async () => ({}) }) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("npm registry unreachable — nothing changed");
  });

  test("runAtomicUpdate on the npm layout: newer registry version is installed through the manager", async () => {
    const m = fakeMachine("1.0.0");
    const r = await runAtomicUpdate({
      packageRoot: "/nonexistent-npm-root",
      currentVersion: "1.0.0",
      channel: { channel: "npm", managed: false } as never,
      npmChannel: { fetcher: registry("1.0.1"), run: m.run, manager: "npm" },
    });
    expect(r).toEqual({ ok: true, activated: "1.0.1" });
  });
});

describe("XR-LAUNCH-007 · an installer-placed compiled binary is never treated as npm", () => {
  test("compiled-binary detection reads Bun's virtual FS markers", () => {
    expect(isCompiledBinary("file:///$bunfs/root/xr-linux-x64")).toBe(true);
    expect(isCompiledBinary("file:///B:/~BUN/root/xr.exe")).toBe(true);
    expect(isCompiledBinary(import.meta.url)).toBe(false);
    expect(standaloneBinary(ROOT)).toBe(false); // running from source here
  });

  test("the installer command matches the platform and the README", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(installerCommand("linux").replace(" | bash", " \\| bash"));
    expect(readme).toContain(installerCommand("win32"));
  });
});
