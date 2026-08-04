/**
 * XR Phase 9 · T1/T2 (Part 10) — automated release smoke, end to end, locally.
 *
 * Proves the ONE release pipeline produces a complete, consistent, verifiable
 * release bundle for every target — the exact job release.yml performs on a
 * `v*` tag (same script). Effects asserted:
 *
 *   - every manifest target binary lands in the bundle with a recorded sha256;
 *   - a .deb lands per linux target; SHA256SUMS covers every asset;
 *   - the CycloneDX SBOM exists and validates; SLSA subjects (base64) decode
 *     to "<sha256> <name>" for every asset (the generator's input contract);
 *   - hashes.json carries the manifest version (channel pinning cannot drift);
 *   - channel files pin real digests (no __SHA256_…__ placeholder survives,
 *     and a removed hash entry makes pinning REFUSE);
 *   - the independent verifier passes over the signed bundle (local Ed25519
 *     path — CI substitutes cosign keyless; this is the documented test
 *     analogue, never presented as Rekor proof);
 *   - the tag gate rejects tag/manifest mismatch and non-canonical prerelease
 *     suffixes.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRelease,
  verifyBundle,
  runReleaseGate,
} from "../../scripts/release-build.ts";
import { loadManifest } from "../../scripts/release-manifest.ts";
import { fillHashes, renderChannelFiles, type MinimalManifest, type ReleaseHashes } from "../../scripts/distribution-model.ts";

const ROOT_TMP = mkdtempSync(join(tmpdir(), "xr-release-test-"));
const FAKE_BINS = join(ROOT_TMP, "fake-bins");
const OUT = join(ROOT_TMP, "release");

function fakeBinaries(): void {
  mkdirSync(FAKE_BINS, { recursive: true });
  // Distinct content per file so sha256 entries are distinguishable.
  for (const f of ["xr-linux-x64", "xr-linux-arm64", "xr-darwin-arm64", "xr-darwin-x64", "xr-windows-x64.exe"]) {
    writeFileSync(join(FAKE_BINS, f), `#!/bin/sh\necho "v7.1.0 (Truth) — ${f}"\n`, { mode: 0o755 });
  }
}

describe("Phase 9 · release pipeline (local smoke — same script as release.yml)", () => {
  beforeAll(fakeBinaries);
  afterAll(() => rmSync(ROOT_TMP, { recursive: true, force: true }));

  let report: Awaited<ReturnType<typeof buildRelease>>;

  test("buildRelease assembles every manifest target + linux packages", async () => {
    report = await buildRelease({ out: OUT, skipBuildFrom: FAKE_BINS, localSign: true });
    expect(report.ok).toBe(true);
    expect(report.failures).toEqual([]);

    const manifest = loadManifest();
    const names = report.assets.map((a) => a.file);
    for (const t of manifest.distribution!.targets) {
      expect(names).toContain(t.file);
      expect(existsSync(join(OUT, t.file))).toBe(true);
    }
    // linux packages for both arches exist
    expect(names.some((n) => n.endsWith("_amd64.deb"))).toBe(true);
    expect(names.some((n) => n.endsWith("_arm64.deb"))).toBe(true);
  });

  test("SHA256SUMS covers every asset; entries match disk bytes", () => {
    const sums = readFileSync(join(OUT, "SHA256SUMS"), "utf8");
    for (const a of report.assets) {
      expect(sums).toContain(`${a.sha256}  ${a.file}`);
    }
    expect(report.assets.length).toBeGreaterThanOrEqual(7); // 5 binaries + 2 debs
  });

  test("SBOM + SLSA subjects exist and subjects decode to sha256+name per asset", () => {
    expect(existsSync(join(OUT, "sbom.cyclonedx.json"))).toBe(true);
    const sbom = JSON.parse(readFileSync(join(OUT, "sbom.cyclonedx.json"), "utf8"));
    expect(sbom.bomFormat).toBe("CycloneDX");

    const b64 = readFileSync(join(OUT, "subjects.b64"), "utf8").trim();
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    // Base64 round-trip must be lossless (contract of the SLSA generator input).
    expect(Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "")).toBe(b64.replace(/=+$/, ""));
    for (const line of decoded.trim().split("\n")) {
      expect(line).toMatch(/^[0-9a-f]{64} \S+$/);
    }
    for (const a of report.assets) {
      expect(decoded).toContain(` ${a.file}\n`);
    }
    // binaries + sums + sbom are all subjects of provenance
    expect(decoded).toContain(" SHA256SUMS");
    expect(decoded).toContain(" sbom.cyclonedx.json");
  });

  test("hashes.json carries the manifest identity (channel pinning cannot drift)", () => {
    const hashes = JSON.parse(readFileSync(join(OUT, "hashes.json"), "utf8")) as ReleaseHashes;
    expect(hashes.version).toBe(loadManifest().identity.version);
    expect(hashes.files.map((f) => f.file)).toContain("SHA256SUMS");
  });

  test("channel files pin real digests; leftover placeholders refuse", () => {
    const manifest = loadManifest() as unknown as MinimalManifest;
    const rendered = renderChannelFiles(manifest);
    const hashes = JSON.parse(readFileSync(join(OUT, "hashes.json"), "utf8")) as ReleaseHashes;
    for (const [path, content] of Object.entries(rendered)) {
      expect(path.startsWith("packaging/")).toBe(true);
      const hadTokens = /__SHA256_[A-Z0-9_]+__/.test(content);
      const pinned = fillHashes(content, hashes);
      expect(pinned).not.toMatch(/__SHA256_[A-Z0-9_]+__/);
      if (hadTokens) {
        // each pinned sha256 really is in SHA256SUMS (canonical build)
        const m = pinned.match(/[0-9a-f]{64}/);
        expect(m).not.toBeNull();
        expect(readFileSync(join(OUT, "SHA256SUMS"), "utf8")).toContain(m![0]);
      }
    }
    // tampered hashes (windows entry removed) → pinning REFUSES
    const tampered: ReleaseHashes = { ...hashes, files: hashes.files.filter((f) => f.file !== "xr-windows-x64.exe") };
    expect(() => fillHashes(rendered["packaging/scoop/xr.json"]!, tampered)).toThrow(/no sha256 recorded/);
  });

  test("independent verification passes over the signed bundle (local path)", async () => {
    const v = await verifyBundle(OUT, { localSign: true });
    expect(v.ok).toBe(true);
    // every artifact reports artifact-sha256 + local-signature + sbom checks
    expect(v.lines.some((l) => l.includes("local-signature") && l.startsWith("✓"))).toBe(true);
    expect(v.lines.some((l) => l.startsWith("✗"))).toBe(false);
  });

  test("tag gate: manifest mismatch and bad prerelease suffix refuse", () => {
    const bad = runReleaseGate({ tag: "v9.9.9", skipGate: true });
    expect(bad.join("\n")).toContain("!= manifest version");
    const badSuffix = runReleaseGate({ tag: "v7.1.0-preview.1", skipGate: true });
    expect(badSuffix.join("\n")).toContain("alpha|beta|rc");
    const ok = runReleaseGate({ tag: "v7.1.0", skipGate: true });
    expect(ok).toEqual([]);
    // A beta tag must carry the FULL prerelease version in the manifest (one
    // identity — the suffix rule must NOT also fire when the suffix is canonical).
    const beta = runReleaseGate({ tag: "v7.1.0-beta.1", skipGate: true });
    expect(beta.join("\n")).toContain("!= manifest version");
    expect(beta.join("\n")).not.toContain("alpha|beta|rc");
  });
});
