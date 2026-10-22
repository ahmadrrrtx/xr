/**
 * Launch audit XR-LAUNCH-001 — release ⇔ channel coherence.
 *
 * Fixture tests (no network) for the pieces that keep public channels honest:
 *   - release.manifest.json `channels` (publicVersion, claimed, withdrawnTags)
 *     and its validation;
 *   - the tag ⇔ npm invariant's withdrawn-tag handling;
 *   - scripts/channel-live-check.ts against a fake registry world;
 *   - scripts/channel-publish-verify.ts on stamped channel files.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiveChecks, wingetManifestDir, type Fetcher } from "../../scripts/channel-live-check.ts";
import { verifyChannelFiles, wingetFileNames } from "../../scripts/channel-publish-verify.ts";
import {
  compareSemver,
  loadManifest,
  MANIFEST_PATH,
  publicVersionOf,
  type ReleaseManifest,
} from "../../scripts/release-manifest.ts";
import { assertTagNpmInvariant } from "../../scripts/tag-npm-invariant.ts";

const ROOT = join(import.meta.dir, "..", "..");
const RAW = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Record<string, any>;
const REAL = loadManifest();

function withManifest(mutate: (m: Record<string, any>) => void): () => ReleaseManifest {
  const copy = structuredClone(RAW);
  mutate(copy);
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-manifest-"));
    try {
      const p = join(dir, "release.manifest.json");
      writeFileSync(p, JSON.stringify(copy));
      return loadManifest(p);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("release.manifest.json channels block (D1: 1.0.0 stays public)", () => {
  test("the real manifest declares a stable public version every claimed channel must serve", () => {
    expect(REAL.channels).toBeDefined();
    expect(publicVersionOf(REAL)).toBe("1.0.0");
    expect(REAL.channels?.claimed).toEqual(
      expect.arrayContaining(["github-releases", "npm", "homebrew", "winget", "scoop", "docker"]),
    );
    expect(REAL.channels?.withdrawnTags.map((w) => w.tag)).toContain("v1.1.0");
  });

  test("installers and README are stamped with the public version, not the development line", () => {
    const v = publicVersionOf(REAL);
    expect(readFileSync(join(ROOT, "install.sh"), "utf8")).toContain(`VERSION="${v}"`);
    expect(readFileSync(join(ROOT, "install.ps1"), "utf8")).toContain(`$Version = '${v}'`);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(`Install channels currently serve \`${v}\``);
    expect(readme).toContain("CHANNELS.md#public-version");
  });

  test("compareSemver orders core numerically and pre-releases before releases", () => {
    expect(compareSemver("1.0.0", "1.1.0")).toBe(-1);
    expect(compareSemver("1.10.0", "1.9.9")).toBe(1);
    expect(compareSemver("1.1.0-rc.1", "1.1.0")).toBe(-1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
  });

  test("publicVersionOf falls back to identity.version for legacy manifests", () => {
    expect(publicVersionOf({ identity: { ...REAL.identity, version: "9.9.9" }, channels: undefined })).toBe("9.9.9");
  });

  test("a public version ahead of the development line is rejected", () => {
    expect(withManifest((m) => (m.channels.publicVersion = "9.0.0"))).toThrow(/ahead of identity.version/);
  });

  test("a pre-release public version is rejected", () => {
    expect(withManifest((m) => (m.channels.publicVersion = "1.0.0-beta.1"))).toThrow(/pre-release/);
  });

  test("an unknown claimed channel is rejected", () => {
    expect(withManifest((m) => m.channels.claimed.push("snap"))).toThrow(/unknown channel "snap"/);
  });

  test("the public version cannot also be withdrawn", () => {
    expect(
      withManifest((m) => m.channels.withdrawnTags.push({ tag: "v1.0.0", reason: "contradiction under test" })),
    ).toThrow(/cannot also be a withdrawn tag/);
  });

  test("a withdrawn tag needs an evidence-backed reason", () => {
    expect(withManifest((m) => (m.channels.withdrawnTags = [{ tag: "v1.1.0", reason: "" }]))).toThrow(/reason/);
  });
});

describe("tag ⇔ npm invariant — withdrawn tags (Supply Chain gate)", () => {
  test("a withdrawn stable tag with no npm publish is excused, and reported", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0", "v1.1.0", "v7.0.0"],
      npmVersions: ["1.0.0", "1.0.0-beta.1", "3.1.5"],
      withdrawnTags: ["v1.1.0"],
    });
    expect(r.ok).toBe(true);
    expect(r.withdrawn).toEqual(["1.1.0"]);
    expect(r.missingOnNpm).toEqual([]);
  });

  test("without the declaration the same state fails closed (today's red Supply Chain run)", () => {
    const r = assertTagNpmInvariant({ gitTags: ["v1.0.0", "v1.1.0"], npmVersions: ["1.0.0"] });
    expect(r.ok).toBe(false);
    expect(r.missingOnNpm).toEqual(["1.1.0"]);
  });

  test("a withdrawn version that reaches npm is always a failure", () => {
    const r = assertTagNpmInvariant({
      gitTags: ["v1.0.0", "v1.1.0"],
      npmVersions: ["1.0.0", "1.1.0"],
      withdrawnTags: ["v1.1.0"],
    });
    expect(r.ok).toBe(false);
    expect(r.withdrawnOnNpm).toEqual(["1.1.0"]);
  });
});

// ── A fake registry world for channel-live-check ─────────────────────────────

const V = "1.0.0";
const REPO = "ahmadrrrtx/xr";
const BIN = ["xr-linux-x64", "xr-linux-arm64", "xr-darwin-arm64", "xr-darwin-x64", "xr-windows-x64.exe", "xr-windows-x64.zip", "xr-source.tar.gz"];
const SHA = Object.fromEntries(BIN.map((n) => [n, createHash("sha256").update(n).digest("hex")]));
const SUMS = BIN.map((n) => `${SHA[n]}  ${n}`).join("\n") + "\n";
const DL = `https://github.com/${REPO}/releases/download/v${V}`;

const FORMULA = `class Xr < Formula
  version "${V}"
  on_macos do
    on_arm do
      url "${DL}/xr-darwin-arm64"
      sha256 "${SHA["xr-darwin-arm64"]}"
    end
    on_intel do
      url "${DL}/xr-darwin-x64"
      sha256 "${SHA["xr-darwin-x64"]}"
    end
  end
  on_linux do
    on_arm do
      url "${DL}/xr-linux-arm64"
      sha256 "${SHA["xr-linux-arm64"]}"
    end
    on_intel do
      url "${DL}/xr-linux-x64"
      sha256 "${SHA["xr-linux-x64"]}"
    end
  end
end
`;
const WINGET_ID = "ahmadrrrtx.XR";
const WINGET_INSTALLER = `PackageIdentifier: ${WINGET_ID}
PackageVersion: ${V}
Installers:
  - Architecture: x64
    InstallerUrl: ${DL}/xr-windows-x64.zip
    InstallerSha256: ${SHA["xr-windows-x64.zip"]}
ManifestType: installer
`;
const WINGET_VERSION = `PackageIdentifier: ${WINGET_ID}\nPackageVersion: ${V}\nManifestType: version\n`;
const WINGET_LOCALE = `PackageIdentifier: ${WINGET_ID}\nPackageVersion: ${V}\nPackageLocale: en-US\nManifestType: defaultLocale\n`;
const SCOOP = JSON.stringify({
  version: V,
  architecture: { "64bit": { url: `${DL}/xr-windows-x64.zip`, hash: SHA["xr-windows-x64.zip"] } },
});

interface World {
  latestTag: string;
  v110Prerelease: boolean;
  assets: string[];
  npmLatest: string;
  npmVersions: string[];
  formula: string | null;
  winget: string | null;
  scoop: string | null;
  dockerVersion: string | null;
  dockerLatest: string | null;
}

const healthy = (): World => ({
  latestTag: `v${V}`,
  v110Prerelease: true,
  assets: ["SHA256SUMS", "SHA256SUMS.bundle", ...BIN, "xr.rb", "xr.json"],
  npmLatest: V,
  npmVersions: ["1.0.0-beta.1", V],
  formula: FORMULA,
  winget: WINGET_INSTALLER,
  scoop: SCOOP,
  dockerVersion: "sha256:aaa",
  dockerLatest: "sha256:aaa",
});

function fakeFetch(w: World): { fetch: Fetcher; seen: string[] } {
  const seen: string[] = [];
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const notFound = () => new Response("not found", { status: 404 });
  const fetch: Fetcher = async (url, init) => {
    seen.push(url);
    if (url === `https://api.github.com/repos/${REPO}/releases/tags/v${V}`) {
      return json({ draft: false, prerelease: false, assets: w.assets.map((name) => ({ name })) });
    }
    if (url === `https://api.github.com/repos/${REPO}/releases/tags/v1.1.0`) {
      return json({ draft: false, prerelease: w.v110Prerelease, assets: [] });
    }
    if (url === `https://api.github.com/repos/${REPO}/releases/latest`) return json({ tag_name: w.latestTag });
    if (url === `${DL}/SHA256SUMS`) return new Response(SUMS, { status: 200 });
    if (url === `${DL}/xr.json`) return w.scoop ? new Response(w.scoop, { status: 200 }) : notFound();
    if (url === "https://registry.npmjs.org/@rrrtx%2Fxr") {
      return json({ "dist-tags": { latest: w.npmLatest }, versions: Object.fromEntries(w.npmVersions.map((v) => [v, {}])) });
    }
    if (url === "https://raw.githubusercontent.com/ahmadrrrtx/homebrew-tap/HEAD/Formula/xr.rb") {
      return w.formula ? new Response(w.formula, { status: 200 }) : notFound();
    }
    if (url === `https://raw.githubusercontent.com/microsoft/winget-pkgs/master/${wingetManifestDir(WINGET_ID, V)}/${WINGET_ID}.installer.yaml`) {
      return w.winget ? new Response(w.winget, { status: 200 }) : notFound();
    }
    if (url.startsWith("https://ghcr.io/token")) return json({ token: "REDACTED-test-token" });
    if (url === `https://ghcr.io/v2/ahmadrrrtx/xr/manifests/${V}` && init?.method === "HEAD") {
      return w.dockerVersion ? new Response(null, { status: 200, headers: { "docker-content-digest": w.dockerVersion } }) : notFound();
    }
    if (url === "https://ghcr.io/v2/ahmadrrrtx/xr/manifests/latest" && init?.method === "HEAD") {
      return w.dockerLatest ? new Response(null, { status: 200, headers: { "docker-content-digest": w.dockerLatest } }) : notFound();
    }
    return notFound();
  };
  return { fetch, seen };
}

async function check(w: World) {
  const { fetch, seen } = fakeFetch(w);
  const results = await runLiveChecks(REAL, { fetch, version: V });
  const by = Object.fromEntries(results.map((r) => [r.channel, r]));
  return { results, by, seen };
}

describe("channel-live-check against a fake registry world", () => {
  test("a coherent world passes every claimed channel", async () => {
    const { results } = await check(healthy());
    for (const r of results) expect({ channel: r.channel, problems: r.problems }).toEqual({ channel: r.channel, problems: [] });
    expect(results.map((r) => r.channel).sort()).toEqual([...(REAL.channels?.claimed ?? [])].sort());
  });

  test("today's state: v1.1.0 is GitHub Latest and not a pre-release → github-releases FAILS", async () => {
    const w = healthy();
    w.latestTag = "v1.1.0";
    w.v110Prerelease = false;
    const { by } = await check(w);
    expect(by["github-releases"].ok).toBe(false);
    expect(by["github-releases"].problems.join("\n")).toContain('"Latest" release is v1.1.0');
    expect(by["github-releases"].problems.join("\n")).toContain("withdrawn v1.1.0 is a full");
  });

  test("a release missing installer assets fails (the v1.1.0 desktop-only release)", async () => {
    const w = healthy();
    w.assets = ["XR_1.1.0_x64-setup.exe"];
    const { by } = await check(w);
    expect(by["github-releases"].ok).toBe(false);
    expect(by["github-releases"].detail).toContain("missing assets");
  });

  test("npm latest drift and a withdrawn version on npm both fail", async () => {
    const w = healthy();
    w.npmLatest = "3.1.5";
    w.npmVersions.push("1.1.0");
    const { by } = await check(w);
    expect(by.npm.ok).toBe(false);
    expect(by.npm.problems.join("\n")).toContain("latest is 3.1.5");
    expect(by.npm.problems.join("\n")).toContain("withdrawn v1.1.0 is published on npm");
  });

  test("a missing tap (today's 404) and a formula with a wrong sha both fail homebrew", async () => {
    const missing = healthy();
    missing.formula = null;
    expect((await check(missing)).by.homebrew.detail).toContain("has no Formula/xr.rb (HTTP 404)");
    const tampered = healthy();
    tampered.formula = FORMULA.replace(SHA["xr-linux-x64"], "0".repeat(64));
    const { by } = await check(tampered);
    expect(by.homebrew.ok).toBe(false);
    expect(by.homebrew.problems.join("\n")).toContain("xr-linux-x64 does not match");
  });

  test("winget not yet merged fails with a pending message; a wrong sha fails too", async () => {
    const pending = healthy();
    pending.winget = null;
    expect((await check(pending)).by.winget.detail).toContain("submission pending or not merged");
    const wrong = healthy();
    wrong.winget = WINGET_INSTALLER.replace(SHA["xr-windows-x64.zip"], "f".repeat(64));
    expect((await check(wrong)).by.winget.ok).toBe(false);
  });

  test("scoop manifest hash drift fails", async () => {
    const w = healthy();
    w.scoop = SCOOP.replace(SHA["xr-windows-x64.zip"], "e".repeat(64));
    expect((await check(w)).by.scoop.ok).toBe(false);
  });

  test("docker :latest pointing elsewhere, or a missing version tag, fails", async () => {
    const drift = healthy();
    drift.dockerLatest = "sha256:bbb";
    expect((await check(drift)).by.docker.detail).toContain("digests differ");
    const gone = healthy();
    gone.dockerVersion = null;
    expect((await check(gone)).by.docker.ok).toBe(false);
  });

  test("the check is read-only: it only issues GET/HEAD requests and never touches unpinned branches", async () => {
    const { seen } = await check(healthy());
    for (const u of seen) {
      expect(u).not.toContain("/archive/");
      expect(u).not.toMatch(/\/main\//);
    }
  });
});

describe("channel-publish-verify (what publish-channels.yml pushes)", () => {
  const sums = new Map(Object.entries(SHA));
  const files = (): Record<string, string | undefined> => ({
    "xr.rb": FORMULA,
    "xr.json": SCOOP,
    [`${WINGET_ID}.yaml`]: WINGET_VERSION,
    [`${WINGET_ID}.installer.yaml`]: WINGET_INSTALLER,
    [`${WINGET_ID}.locale.en-US.yaml`]: WINGET_LOCALE,
  });
  const verify = (f: Record<string, string | undefined>, version = V) =>
    verifyChannelFiles({ version, packageId: WINGET_ID, repoSlug: REPO, sums, files: f });

  test("stamped, pinned files that match the signed sums are publishable", () => {
    expect(verify(files())).toEqual([]);
    expect(wingetFileNames(WINGET_ID)).toEqual([
      "ahmadrrrtx.XR.yaml",
      "ahmadrrrtx.XR.installer.yaml",
      "ahmadrrrtx.XR.locale.en-US.yaml",
    ]);
  });

  test("WinGet files land under manifests/a/ (first letter of the identifier), not r/", () => {
    expect(wingetManifestDir(WINGET_ID, V)).toBe("manifests/a/ahmadrrrtx/XR/1.0.0");
  });

  test("a formula sha that does not match SHA256SUMS blocks publication", () => {
    const f = files();
    f["xr.rb"] = FORMULA.replace(SHA["xr-darwin-arm64"], "1".repeat(64));
    expect(verify(f).join("\n")).toContain("xr.rb sha256 for xr-darwin-arm64 does not match");
  });

  test("files for a different version are refused", () => {
    expect(verify(files(), "1.1.0").length).toBeGreaterThan(0);
  });

  test("unstamped placeholders and missing manifests are refused", () => {
    const f = files();
    f[`${WINGET_ID}.installer.yaml`] = WINGET_INSTALLER.replace(SHA["xr-windows-x64.zip"], "SHA256_WINDOWS_X64_ZIP");
    delete f[`${WINGET_ID}.locale.en-US.yaml`];
    const problems = verify(f).join("\n");
    expect(problems).toContain("unstamped checksum placeholder");
    expect(problems).toContain("ahmadrrrtx.XR.locale.en-US.yaml (WinGet manifest) is missing");
  });

  test("the repository's channel workflows use the verified publisher and the correct WinGet path", () => {
    const publish = readFileSync(join(ROOT, ".github", "workflows", "publish-channels.yml"), "utf8");
    expect(publish).toContain("cosign verify-blob");
    expect(publish).toContain("scripts/channel-publish-verify.ts");
    expect(publish).toContain("wingetcreate.exe submit");
    expect(publish).not.toMatch(/manifests\/r\//);
    const release = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
    // The tag run no longer pushes the tap before the release is verified.
    expect(release).not.toContain("Push the Homebrew formula to the project tap");
    const install = readFileSync(join(ROOT, ".github", "workflows", "channel-install.yml"), "utf8");
    expect(install).not.toContain("releases/latest");
    expect(install).not.toMatch(/winget\/manifests\/r\//);
  });
});
