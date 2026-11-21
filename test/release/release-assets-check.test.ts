/**
 * Launch-audit L-010 regression: the release asset-completeness gate must
 * fail on exactly the v1.1.0 shape (desktop bundles only, no CLI set) and
 * pass on a complete canonical set — this is the alarm that did not exist
 * when v1.1.0 shipped 5 assets and silence.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchAssetNames, missingAssets, requiredAssets } from "../../scripts/release-assets-check.ts";

// The actual v1.1.0 live asset list at audit time (GitHub Releases API, 2026-10-20).
const V110_LIVE = [
  "XR-1.1.0-1.x86_64.rpm",
  "XR.app.tar.gz",
  "XR_1.1.0_aarch64.dmg",
  "XR_1.1.0_amd64.AppImage",
  "XR_1.1.0_amd64.deb",
];

const COMPLETE_110 = [
  "xr-linux-x64", "xr-linux-arm64", "xr-darwin-arm64", "xr-darwin-x64",
  "xr-windows-x64.exe", "xr-windows-arm64.exe",
  "xr-windows-x64.zip", "xr-windows-arm64.zip",
  "xr-source.tar.gz", "xr_1.1.0_amd64.deb",
  "rrrtx-xr-1.1.0.tgz", "rrrtx-xr-1.1.0.tgz.bundle",
  "SHA256SUMS", "SHA256SUMS.bundle",
  "sbom.cyclonedx.json", "sbom.cyclonedx.json.bundle",
  "multiple.intoto.jsonl",
  // desktop bundles attach from the desktop workflow — extra is fine.
  "XR_1.1.0_aarch64.dmg",
];

describe("release asset-completeness gate (L-010)", () => {
  test("the real v1.1.0 asset set is reported incomplete, naming the CLI set", () => {
    const missing = missingAssets("v1.1.0", V110_LIVE);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.join("\n")).toContain("CLI binary windows-arm64");
    expect(missing.join("\n")).toContain("checksum manifest");
    expect(missing.join("\n")).toContain("npm tarball");
  });

  test("a full canonical set passes with zero missing", () => {
    expect(missingAssets("v1.1.0", COMPLETE_110)).toEqual([]);
  });

  test("the arm64 additions are genuinely required (v1.0.0-shaped sets now fail, loudly and precisely)", () => {
    const v100Shape = COMPLETE_110.filter(
      (a) => !a.includes("arm64") || a.includes("darwin") || a.includes("linux"),
    );
    const missing = missingAssets("v1.0.0", v100Shape);
    expect(missing.some((m) => m.includes("windows-arm64"))).toBe(true);
    expect(missing.some((m) => m.includes("windows-x64"))).toBe(false);
  });

  test("required set size is stable (any edit to the canonical list is a deliberate review event)", () => {
    expect(requiredAssets("v9.9.9")).toHaveLength(17);
  });
});

// NEW-13: GitHub's tag lookup answers 404 for a DRAFT release even with push access (checked against this repository's
// own draft releases on 2026-11-21). A tag push prepares a private draft, so the gate must still find that release and
// its assets. The fake below behaves like the API: tag lookup sees published releases only, the list shows drafts.
describe("the gate sees the private draft a tag push prepares (NEW-13)", () => {
  type Rel = { tag_name: string; draft: boolean; assets: Array<{ name: string }> };
  const calls: string[] = [];
  function fakeGitHub(releases: Rel[], tagStatus?: number) {
    calls.length = 0;
    spyOn(globalThis, "fetch").mockImplementation((async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push(url);
      if (url.includes("/releases/tags/")) {
        if (tagStatus) return new Response("{}", { status: tagStatus, statusText: "Server Error" });
        const tag = decodeURIComponent(url.split("/releases/tags/")[1]!);
        const hit = releases.find((r) => r.tag_name === tag && !r.draft);
        return hit ? Response.json(hit) : new Response('{"message":"Not Found"}', { status: 404, statusText: "Not Found" });
      }
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return Response.json(page === 1 ? releases : []);
    }) as typeof fetch);
  }
  afterEach(() => { (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.(); });
  const PREVIEW = COMPLETE_110.map((a) => a.replace("1.1.0", "1.2.0-preview.3"));

  test("a draft release is found through the release list, with every asset", async () => {
    fakeGitHub([
      { tag_name: "v1.0.0", draft: false, assets: [{ name: "xr-linux-x64" }] },
      { tag_name: "v1.2.0-preview.3", draft: true, assets: PREVIEW.map((name) => ({ name })) },
    ]);
    const names = await fetchAssetNames("owner/repo", "v1.2.0-preview.3");
    expect(names).toEqual(PREVIEW);
    expect(missingAssets("v1.2.0-preview.3", names)).toEqual([]);
    expect(calls[0]).toContain("/releases/tags/v1.2.0-preview.3");
    expect(calls.some((c) => c.includes("/releases?per_page=100&page=1"))).toBe(true);
  });

  test("an incomplete draft is still reported incomplete", async () => {
    fakeGitHub([{ tag_name: "v1.2.0-preview.3", draft: true, assets: PREVIEW.filter((a) => a !== "SHA256SUMS").map((name) => ({ name })) }]);
    const missing = missingAssets("v1.2.0-preview.3", await fetchAssetNames("owner/repo", "v1.2.0-preview.3"));
    expect(missing.join("\n")).toContain("checksum manifest");
  });

  test("a published release comes from the tag lookup alone", async () => {
    fakeGitHub([{ tag_name: "v1.0.0", draft: false, assets: [{ name: "SHA256SUMS" }] }]);
    expect(await fetchAssetNames("owner/repo", "v1.0.0")).toEqual(["SHA256SUMS"]);
    expect(calls).toHaveLength(1);
  });

  test("no release at all, published or draft, is an error; other API errors are not turned into a search", async () => {
    fakeGitHub([]);
    await expect(fetchAssetNames("owner/repo", "v9.9.9")).rejects.toThrow(/no release, published or draft/);
    fakeGitHub([], 500);
    await expect(fetchAssetNames("owner/repo", "v9.9.9")).rejects.toThrow(/GitHub API 500/);
    expect(calls).toHaveLength(1);
  });
});
