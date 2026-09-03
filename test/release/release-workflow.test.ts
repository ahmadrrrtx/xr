/**
 * XR Phase 9 · T1/T2 — release pipeline structural proof.
 *
 * Tests assert against the WORKFLOW FILE ITSELF (the thing that runs): the
 * release is gated, builds all 5 targets, signs the checksums, wires SLSA to
 * REAL outputs, publishes prereleases honestly, and stamps channels from the
 * signed sums. A regression in the YAML fails this test — the Phase-4 wiring
 * bug (empty SLSA subjects) can never recur silently.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const crossPlatform = readFileSync(join(ROOT, ".github", "workflows", "cross-platform.yml"), "utf8");
const nightly = readFileSync(join(ROOT, ".github", "workflows", "nightly.yml"), "utf8");

function jobBlocks(doc: string): Map<string, number> {
  const order = new Map<string, number>();
  const re = /^  ([a-z0-9_-]+):\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) order.set(m[1]!, m.index);
  return order;
}

describe("Phase 9 · T1/T2 — release.yml is a complete signed release pipeline", () => {
  const jobs = jobBlocks(workflow);

  test("triggers on v* tags", () => {
    expect(workflow).toMatch(/tags:\s*\n\s*- "v\*"/);
  });

  test("truth gates run BEFORE any build (release:check + claim-lint + channel:check)", () => {
    expect(jobs.get("gates")!).toBeLessThan(jobs.get("build")!);
    const gatesIdx = workflow.indexOf("bun run release:check");
    expect(gatesIdx).toBeGreaterThan(-1);
    expect(workflow.indexOf("bun run claim-lint")).toBeGreaterThan(-1);
    expect(workflow.indexOf("bun run channel:check")).toBeGreaterThan(-1);
    expect(workflow.indexOf("build-matrix.ts")).toBeGreaterThan(gatesIdx);
  });

  test("builds the full 5-target canonical matrix across real OS runners", () => {
    for (const t of ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64", "windows-x64"]) {
      expect(workflow).toContain(t);
    }
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("windows-latest");
  });

  test("SLSA provenance is wired to REAL assemble outputs (the Phase-4 fix)", () => {
    expect(workflow).toContain("outputs:\n      digests: ${{ steps.subjects.outputs.base64 }}");
    expect(workflow).toContain("base64-subjects: ${{ needs.assemble.outputs.digests }}");
    expect(workflow).toContain("slsa-framework/slsa-github-generator");
    // The provenance job must depend on the job that produced the digests.
    const prov = workflow.slice(workflow.indexOf("  provenance:"));
    expect(prov).toMatch(/needs: \[assemble, release\]/);
  });

  test("cosign keyless signing covers SHA256SUMS + tarball + SBOM (public Rekor)", () => {
    expect(workflow).toContain("cosign sign-blob --yes SHA256SUMS --bundle SHA256SUMS.bundle");
    expect(workflow).toContain("sbom.cyclonedx.json");
    expect(workflow).toContain("sigstore/cosign-installer@v3");
  });

  test("release assets include all artifacts + signatures; prereleases are honest", () => {
    expect(workflow).toContain("prerelease: ${{ needs.assemble.outputs.prerelease == 'true' }}");
    expect(workflow).toContain("softprops/action-gh-release@v2");
  });

  test("npm publishes under OIDC with dist-tags (stable → latest, beta → beta)", () => {
    // The npm CLI performs the publish. Two bun commands are wrong here:
    //   - `bun pm publish` is not a bun subcommand at all (bun 1.3.14 prints
    //     the `bun pm` usage block and exits 1);
    //   - `bun publish` exists but does not implement npm's OIDC
    //     trusted-publishing handshake (oven-sh/bun#22423).
    // Either one fails the npm channel AFTER the GitHub Release is published.
    expect(workflow).toContain("npm publish --provenance --access public --tag beta");
    expect(workflow).toContain("npm publish --provenance --access public --tag latest");
    expect(workflow).toMatch(/Publish npm[\s\S]*setup-bun/);
    expect(workflow).toMatch(/Stamp \+ publish channel manifests[\s\S]*contents: write/);
    expect(workflow).toMatch(/GitHub Release \(signed assets\)[\s\S]*needs: \[assemble, sign\]/);
    expect(workflow).not.toContain("bun pm publish");
    // Match the run line: explanatory comments may name the command.
    expect(workflow).not.toMatch(/^\s*bun publish /m);
    // OIDC trusted publishing needs npm >= 11.5.1 on Node >= 22.
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("npm install -g npm@latest");
    expect(workflow).toContain("id-token: write");
    // No long-lived npm token is consumed (trusted publishing). A set OR empty
    // auth-token env makes npm skip OIDC and fall back to token auth (404).
    expect(workflow).not.toMatch(/^\s*NODE_AUTH_TOKEN:/m);
    expect(workflow).not.toContain("secrets.NPM_TOKEN");
  });

  test("docker publishes to GHCR with attestations + cosign image signature", () => {
    expect(workflow).toContain("ghcr.io/${{ github.repository }}");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("cosign sign --yes");
  });

  test("channels are stamped from the signed SHA256SUMS (no unsigned drift path)", () => {
    expect(workflow).toContain("channel-manifest.ts --stamp --sums dist/SHA256SUMS");
  });

  test("windows channel zip (winget/scoop) is part of the canonical set", () => {
    expect(workflow).toContain("xr-windows-x64.zip");
  });

  test("the .deb artifact is built from the canonical linux-x64 binary", () => {
    expect(workflow).toContain("build-deb.ts --bin dist/xr-linux-x64");
  });

  test("changelog is generated from git history at release time", () => {
    expect(workflow).toContain("scripts/changelog.ts --version");
  });
});

describe("Phase 9 · T4 — cross-platform.yml runs full parity on 3 OS families", () => {
  test("a single matrix drives Linux + macOS + Windows", () => {
    expect(crossPlatform).toContain("ubuntu-latest");
    expect(crossPlatform).toContain("macos-latest");
    expect(crossPlatform).toContain("windows-latest");
  });
  test("one parity authority computes the suite per OS (no hand-picked subsets)", () => {
    // The suite step delegates to the segmented runner script, which itself
    // asks scripts/platform-parity.ts (the single authority) for the file
    // list. The --validate step stays inline. A hand-picked subset in the
    // workflow (or a runner that stopped consulting the authority) fails.
    expect(crossPlatform).toContain("scripts/parity-suite-runner.sh");
    expect(crossPlatform).toContain("platform-parity.ts --validate");
    const runner = readFileSync(join(ROOT, "scripts", "parity-suite-runner.sh"), "utf8");
    expect(runner).toContain("platform-parity.ts --os \"$OS\" --args");
    expect(runner).toContain("executed $RAN of $EXPECTED files");
  });
  test("typecheck + golden path run on every OS", () => {
    expect(crossPlatform).toContain("bunx tsc --noEmit");
    expect(crossPlatform).toContain("bun run golden-path");
  });
});

describe("Phase 9 · T6 — nightly beta install survey on 3 OS families", () => {
  test("survey jobs exist for all three OS families with the ≥0.99 gate", () => {
    expect(nightly).toContain("beta-install-survey");
    expect(nightly).toContain("--target=0.99");
    for (const runner of ["ubuntu-latest", "macos-latest", "windows-latest"]) {
      expect(nightly).toContain(runner);
    }
    // evidence is uploaded per OS
    expect(nightly).toContain("beta-install-${{ matrix.bunOs }}");
  });
});

describe("Phase 3 — artifact truth (release.yml + nightly + dockerfile)", () => {
  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const canaries = readFileSync(join(ROOT, ".github", "workflows", "provider-canaries.yml"), "utf8");
  const supply = readFileSync(join(ROOT, ".github", "workflows", "supply-chain.yml"), "utf8");
  const consumerWf = readFileSync(join(ROOT, ".github", "workflows", "consumer-smoke.yml"), "utf8");

  test("publish jobs are tag-gated; untagged dispatch uses the manifest version", () => {
    for (const job of ["publish-npm", "release", "provenance", "publish-docker", "publish-channels", "consumer-smoke", "verify-release"]) {
      const slice = workflow.slice(workflow.indexOf(`  ${job}:`));
      const head = slice.slice(0, 400);
      expect(head).toContain("if: github.ref_type == 'tag'");
    }
    expect(workflow).toContain("untagged dispatch");
    expect(workflow).toContain('GITHUB_REF_TYPE');
  });

  test("SBOM is generated before SHA256SUMS; sums use write-sums.ts (no GNU sha256sum)", () => {
    const sbomIdx = workflow.indexOf("scripts/sbom.ts --out dist/sbom.cyclonedx.json");
    const sumsIdx = workflow.indexOf("scripts/write-sums.ts dist");
    expect(sbomIdx).toBeGreaterThan(-1);
    expect(sumsIdx).toBeGreaterThan(sbomIdx);
    expect(workflow).toContain("write-sums.ts dist --print-with-manifest");
    expect(workflow).not.toMatch(/sha256sum \*/);
    expect(workflow).toContain("cosign verify-blob");
    expect(workflow).toContain("scripts/verify-release.ts");
    expect(workflow).toContain("scripts/consumer-smoke.ts --from-npm");
    expect(workflow).toContain("Flatten artifact into dist/");
    expect(workflow).toContain("bundle/dist/SHA256SUMS");
  });

  test("nightly uses write-sums, does not overlay $PWD on /app, and notifies on failure", () => {
    expect(nightly).toContain("scripts/write-sums.ts survey-assets");
    expect(nightly).not.toMatch(/sha256sum \*/);
    expect(nightly).not.toContain('"$PWD":/app');
    expect(nightly).toContain("--entrypoint bun");
    expect(nightly).toContain("Nightly Golden Path failed");
    expect(nightly).toContain("issues: write");
  });

  test("Dockerfile copies scripts/ bin/ plugins/ so the container golden-path can run", () => {
    expect(dockerfile).toContain("COPY scripts ./scripts");
    expect(dockerfile).toContain("COPY bin ./bin");
    expect(dockerfile).toContain("COPY plugins ./plugins");
  });

  test("canaries fail closed on empty; ALLOW_EMPTY is a repo variable", () => {
    expect(canaries).toContain("XR_CANARY_ALLOW_EMPTY: ${{ vars.XR_CANARY_ALLOW_EMPTY }}");
  });

  test("supply-chain runs the 1.x tag⇔npm invariant; weekly consumer-smoke skips if unpublished", () => {
    expect(supply).toContain("tag-npm-invariant.ts");
    expect(consumerWf).toContain("--skip-if-unpublished");
    expect(consumerWf).toContain("--from-npm");
  });
});
