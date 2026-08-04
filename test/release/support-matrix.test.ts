/**
 * XR Phase 9 · T4 (Part 10/11) — the support matrix is GENERATED, current,
 * and backed by CI evidence. A support claim without a matching CI job is a
 * false claim (Art. IX.4).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest } from "../../scripts/release-manifest.ts";
import { renderSupportMatrix, type MinimalManifest } from "../../scripts/distribution-model.ts";

const ROOT = join(import.meta.dir, "..", "..");
const manifest = loadManifest();
const onDisk = readFileSync(join(ROOT, "docs", "release", "SUPPORT_MATRIX.md"), "utf8");
const cross = readFileSync(join(ROOT, ".github", "workflows", "cross-platform.yml"), "utf8");
const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
const nightly = readFileSync(join(ROOT, ".github", "workflows", "nightly.yml"), "utf8");

describe("Phase 9 · support matrix truth", () => {
  test("the stamped file equals the generator output (fresh, never hand-edited)", () => {
    expect(onDisk.replace(/\r\n/g, "\n")).toBe(renderSupportMatrix(manifest as unknown as MinimalManifest));
  });

  test("every manifest target + channel appears with its tier", () => {
    for (const t of manifest.distribution!.supportTiers) {
      expect(onDisk).toContain(`${t.os} | ${t.arch}`);
    }
    for (const c of manifest.distribution!.channels) {
      if (c.id === "git-checkout") continue;
      expect(onDisk).toContain(`\`${c.id}\``);
    }
    expect(onDisk).toContain(manifest.distribution!.stabilityLabel);
  });

  test("tier-1 rows name CI evidence, and the CI files actually back them", () => {
    for (const t of manifest.distribution!.supportTiers) {
      if (t.tier === "unsupported") continue;
      expect(t.evidence, `${t.os}/${t.arch}`).toMatch(/\.github\/workflows\//);
    }
    // linux-x64 parity: main ci.yml runs the full suite + reliability
    expect(ci).toContain("bun test");
    // cross-platform jobs exist for every tier-1 row
    expect(cross).toContain("ubuntu-24.04-arm"); // linux arm64
    expect(cross).toContain("macos-latest"); // macos arm64
    expect(cross).toContain("macos-13"); // macos x64
    expect(cross).toContain("windows-latest"); // windows x64
    // golden path runs nightly (support claim evidence)
    expect(nightly).toContain("golden-path");
  });

  test("windows arm64 is honestly 'unsupported' (no false tier claim)", () => {
    const winArm = manifest.distribution!.supportTiers.find((s) => s.os === "windows" && s.arch === "arm64");
    expect(winArm).toBeDefined();
    expect(winArm!.tier).toBe("unsupported");
    // and no binary target exists for it (the claim is real)
    expect(manifest.distribution!.targets.some((t) => t.os === "windows" && t.arch === "arm64")).toBe(false);
  });

  test("prerelease channel semantics are stated (beta ≠ stable)", () => {
    expect(onDisk).toContain("v*-*");
    expect(onDisk).toContain("prerelease");
  });
});
