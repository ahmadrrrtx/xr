/**
 * XR Phase 9 · T1/T2/T3/T4 (Part 10) — workflow contract tests.
 *
 * These read the REAL workflow files and assert the contract points that were
 * broken or missing before Phase 9 (audit R1/R2/P3/P4). They are deliberately
 * textual: the workflow is the artifact under test (its YAML is validated by
 * the CI yaml parser on every PR; these assertions guard the *wiring*).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WF = join(import.meta.dir, "..", "..", ".github", "workflows");
const release = readFileSync(join(WF, "release.yml"), "utf8");
const cross = readFileSync(join(WF, "cross-platform.yml"), "utf8");
const nightly = readFileSync(join(WF, "nightly.yml"), "utf8");

describe("Phase 9 · release.yml contract", () => {
  test("triggers on v* tags (release-from-tag)", () => {
    expect(release).toMatch(/tags:\s*\n\s*- "v\*"/);
  });

  test("gate job: release:check + claim-lint + tag==manifest + prerelease suffix rule", () => {
    expect(release).toContain("bun run release:check");
    expect(release).toContain("bun run claim-lint");
    expect(release).toContain("!= release.manifest.json version");
    expect(release).toContain("must carry an alpha|beta|rc suffix");
  });

  test("five-target matrix + packages + checksums + SBOM in one authority script", () => {
    expect(release).toContain("scripts/release-build.ts");
    expect(release).toContain("XR_REQUIRE_RPM");
  });

  test("SLSA subjects wiring is real (the Phase-4 bug cannot regress)", () => {
    // build job declares outputs.digests from subjects.b64…
    expect(release).toMatch(/outputs:\s*\n\s*digests: \$\{\{ steps\.subjects\.outputs\.digests \}\}/);
    // …and the provenance job consumes exactly that output
    expect(release).toContain('base64-subjects: "${{ needs.build.outputs.digests }}"');
    // pinned generator + asset naming honesty
    expect(release).toContain("slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.1.0");
    expect(release).toContain('provenance-name: "provenance.intoto.jsonl"');
    expect(release).toContain("upload-tag-name:");
  });

  test("cosign keyless signs every asset with sigstore bundles", () => {
    expect(release).toContain("sigstore/cosign-installer@v3");
    expect(release).toContain("cosign sign-blob --yes");
    expect(release).toContain("--bundle");
  });

  test("release is marked prerelease for beta tags; changelog feeds the body", () => {
    expect(release).toContain("prerelease: ${{ needs.gate.outputs.prerelease }}");
    expect(release).toContain("scripts/changelog.ts");
    expect(release).toMatch(/action-gh-release@v2/);
  });

  test("npm: OIDC trusted publishing, no long-lived token (R4)", () => {
    expect(release).toContain("npm publish --provenance");
    expect(release).toContain("id-token: write");
    // the old contradiction (comment promising keyless, env carrying a token) is gone
    expect(release).not.toContain("secrets.NPM_TOKEN");
  });

  test("GHCR: digest signing + attestations; :latest only for stable", () => {
    expect(release).toContain("docker/build-push-action@v6");
    expect(release).toContain('cosign sign --yes "ghcr.io/${{ github.repository }}@');
    expect(release).toContain("stable only moves :latest");
  });

  test("channels fail loudly when their token is absent (never silently skip)", () => {
    expect(release).toContain("TAP_TOKEN SCOOP_TOKEN");
    expect(release).toContain("WINGET_TOKEN not configured");
  });

  test("release completeness: every publish stage must succeed", () => {
    expect(release).toContain("any failed stage fails the workflow");
    expect(release).toContain("publish-winget");
    expect(release).toContain("publish-channels");
    expect(release).toContain("publish-container");
    expect(release).toContain("publish-npm");
  });
});

describe("Phase 9 · cross-platform.yml full parity", () => {
  const jobs = ["linux-arm64", "macos", "macos-intel", "windows"];

  function jobBlock(job: string): string {
    const start = cross.indexOf(`  ${job}:`);
    expect(start, job).toBeGreaterThan(-1);
    // next top-level job key (two-space indent) or EOF
    const rest = cross.slice(start + job.length + 3);
    const next = rest.search(/\n  [a-zA-Z0-9_-]+:/);
    return `  ${job}:` + (next === -1 ? rest : rest.slice(0, next));
  }

  test("every tier-1 OS job runs the FULL suite (no directory subset)", () => {
    for (const job of jobs) {
      const block = jobBlock(job);
      expect(block, job).toContain("bun test");
      expect(block, job).not.toMatch(/bun test test\//); // full suite — no subsets
      expect(block, job).toContain("tsc --noEmit");
      expect(block, job).toContain("golden-path");
    }
  });

  test("runners are real per-OS machines incl. arm arches", () => {
    expect(cross).toContain("runs-on: ubuntu-24.04-arm");
    expect(cross).toContain("runs-on: macos-latest");
    expect(cross).toContain("runs-on: macos-13");
    expect(cross).toContain("runs-on: windows-latest");
  });
});

describe("Phase 9 · nightly beta metric wiring", () => {
  test("3-OS installer matrix records attempts + rolling gate", () => {
    expect(nightly).toContain("matrix:");
    expect(nightly).toContain("ubuntu-latest, macos-latest, windows-latest");
    expect(nightly).toContain("beta-metric.ts record");
    expect(nightly).toContain("beta-metric.ts gate --file .beta-metrics/metrics.jsonl --threshold 0.99 --window 30");
    expect(nightly).toContain("--channel installer");
  });
});
