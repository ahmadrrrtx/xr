/**
 * Phase 4 · T6 — supply-chain verification tests.
 *
 *   · the SBOM generator emits a valid CycloneDX 1.5 doc from the LOCKED
 *     dependency set (never ranges), with integrity hashes;
 *   · the release verifier fails on tampered artifacts and passes on
 *     untouched ones (local Ed25519 path — the honest non-keyless check);
 *   · the verifier makes NO signature claim when nothing was verified.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lockedDependencies, renderCycloneDx } from "../../scripts/sbom.ts";
import { verifyRelease } from "../../scripts/verify-release.ts";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-supply-"));
});

afterAll(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe("Phase 4 · T6 — SBOM generation", () => {
  test("the locked dependency set parses with integrity hashes", () => {
    const deps = lockedDependencies();
    expect(deps.length).toBeGreaterThan(0);
    expect(deps.every((d) => d.version.length > 0)).toBe(true);
    const withHash = deps.filter((d) => d.integrity);
    expect(withHash.length).toBe(deps.length); // every locked dep carries a hash
    expect(deps.some((d) => d.name === "zod")).toBe(true);
  });

  test("renderCycloneDx emits a valid CycloneDX 1.5 document", () => {
    const doc = renderCycloneDx({
      componentName: "@rrrtx/xr",
      componentVersion: "7.0.1",
      serialNumber: "urn:uuid:test",
      dependencies: lockedDependencies(),
    });
    expect(doc.bomFormat).toBe("CycloneDX");
    expect(doc.specVersion).toBe("1.5");
    expect(Array.isArray(doc.components)).toBe(true);
    expect((doc.components as unknown[]).length).toBeGreaterThan(0);
    // every component pins name + version + a hash
    for (const c of doc.components as Array<{ name: string; version: string; hashes?: Array<{ alg: string; content: string }> }>) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.version.length).toBeGreaterThan(0);
      expect(c.hashes?.length).toBeGreaterThan(0);
    }
  });

  test("the CLI generator runs end to end", () => {
    const out = join(tmp, "sbom.json");
    execFileSync("bun", ["run", "scripts/sbom.ts", "--out", out], { cwd: join(import.meta.dir, "..", "..") });
    const doc = JSON.parse(readFileSync(out, "utf8"));
    expect(doc.bomFormat).toBe("CycloneDX");
  });
});

describe("Phase 4 · T6 — release verification", () => {
  test("a tampered artifact FAILS the sha256 check", async () => {
    const artifact = join(tmp, "xr.tgz");
    writeFileSync(artifact, "original-content");
    const good = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    writeFileSync(join(tmp, "SHA256SUMS"), `${good}  xr.tgz\n`);
    // tamper
    writeFileSync(artifact, "tampered-content");
    const report = await verifyRelease({ artifact, sums: join(tmp, "SHA256SUMS") });
    const check = report.checks.find((c) => c.name === "artifact-sha256")!;
    expect(check.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  test("an untouched artifact PASSES integrity + a local Ed25519 signature", async () => {
    const artifact = join(tmp, "xr2.tgz");
    writeFileSync(artifact, "release-content-v1");
    const good = createHash("sha256").update(readFileSync(artifact)).digest("hex");
    writeFileSync(join(tmp, "SHA256SUMS2"), `${good}  xr2.tgz\n`);

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubPath = join(tmp, "key.pub");
    const sigPath = join(tmp, "sig.bin");
    writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
    writeFileSync(sigPath, sign(null, readFileSync(artifact), privateKey));

    const report = await verifyRelease({
      artifact,
      sums: join(tmp, "SHA256SUMS2"),
      localKey: pubPath,
      localSig: sigPath,
    });
    expect(report.ok).toBe(true);
    const sigCheck = report.checks.find((c) => c.name === "local-signature")!;
    expect(sigCheck.ok).toBe(true);
    // The honest wording: local self-check, NOT keyless/Rekor.
    expect(sigCheck.detail).toContain("NOT keyless/Rekor");
  });

  test("a wrong local signature FAILS", async () => {
    const artifact = join(tmp, "xr3.tgz");
    writeFileSync(artifact, "content");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    writeFileSync(join(tmp, "k3.pub"), publicKey.export({ type: "spki", format: "pem" }));
    // sign with a DIFFERENT key
    writeFileSync(join(tmp, "s3.bin"), sign(null, readFileSync(artifact), other.privateKey));
    const report = await verifyRelease({
      artifact,
      localKey: join(tmp, "k3.pub"),
      localSig: join(tmp, "s3.bin"),
    });
    expect(report.ok).toBe(false);
    // Sanity: the correct key verifies the same bytes.
    expect(verify(null, readFileSync(artifact), publicKey, readFileSync(join(tmp, "s3.bin")))).toBe(false);
  });

  test("no signature input → NO claim is made (fails closed)", async () => {
    const artifact = join(tmp, "xr4.tgz");
    writeFileSync(artifact, "content");
    const report = await verifyRelease({ artifact });
    const sigCheck = report.checks.find((c) => c.name === "signature")!;
    expect(sigCheck.ok).toBe(false);
    expect(sigCheck.detail).toContain("no claim made");
    expect(report.ok).toBe(false);
  });
});
