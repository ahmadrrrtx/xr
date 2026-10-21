/**
 * Launch-audit L-010 regression: the release asset-completeness gate must
 * fail on exactly the v1.1.0 shape (desktop bundles only, no CLI set) and
 * pass on a complete canonical set — this is the alarm that did not exist
 * when v1.1.0 shipped 5 assets and silence.
 */
import { describe, expect, test } from "bun:test";
import { missingAssets, requiredAssets } from "../../scripts/release-assets-check.ts";

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
