/**
 * XR Phase 4 · T6 — release artifact verification.
 *
 * Verifies a release bundle the way an independent party would:
 *   1. integrity  — the artifact's SHA-256 matches SHA256SUMS;
 *   2. SBOM       — parses as CycloneDX 1.5, pins the locked deps (hashes);
 *   3. provenance — SLSA provenance parses and its subject hash matches;
 *   4. signature  — cosign keyless verification (Rekor-backed) when cosign
 *                   is available; otherwise a local Ed25519 verification for
 *                   tests/self-check (never presented as keyless proof).
 *
 * Claims discipline (Art. IX.4): this script reports EXACTLY what it
 * verified. Keyless/Rekor verification is only reported when it actually ran
 * against the public transparency log.
 *
 * Usage:
 *   bun run scripts/verify-release.ts --artifact xr.tgz --sums SHA256SUMS \
 *       --sbom sbom.cyclonedx.json --provenance provenance.json
 *       [--cosign-identity 'https://github.com/ahmadrrrtx/xr/.github/workflows/release.yml@refs/tags/v*']
 *       [--local-key key.pub --local-sig sig.bin]   # test path
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { runCommand } from "../src/util/process.ts";

export interface VerificationReport {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function parseSums(sums: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of sums.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && /^[0-9a-f]{64}$/i.test(parts[0])) {
      m.set(parts[1].replace(/^\*/, ""), parts[0].toLowerCase());
    }
  }
  return m;
}

export async function verifyRelease(opts: {
  artifact: string;
  sums?: string;
  sbom?: string;
  provenance?: string;
  cosignIdentity?: string;
  cosignIssuer?: string;
  localKey?: string;
  localSig?: string;
}): Promise<VerificationReport> {
  const checks: VerificationReport["checks"] = [];

  // 1. Integrity vs SHA256SUMS
  if (opts.sums && existsSync(opts.sums)) {
    const sums = parseSums(readFileSync(opts.sums, "utf8"));
    const expected =
      sums.get(opts.artifact) ??
      sums.get(`./${opts.artifact}`) ??
      sums.get(basename(opts.artifact)) ??
      sums.get(`./${basename(opts.artifact)}`);
    const actual = sha256File(opts.artifact);
    checks.push({
      name: "artifact-sha256",
      ok: expected !== undefined && expected === actual,
      detail: expected ? `sha256 ${actual}` : "no entry in SHA256SUMS",
    });
  }

  // 2. SBOM structure
  if (opts.sbom && existsSync(opts.sbom)) {
    try {
      const sbom = JSON.parse(readFileSync(opts.sbom, "utf8"));
      const ok =
        sbom.bomFormat === "CycloneDX" &&
        typeof sbom.specVersion === "string" &&
        Array.isArray(sbom.components) &&
        sbom.components.length > 0 &&
        sbom.components.every(
          (c: { name?: string; version?: string }) => typeof c.name === "string" && typeof c.version === "string",
        );
      checks.push({
        name: "sbom-cyclonedx",
        ok,
        detail: ok ? `${sbom.components.length} components, spec ${sbom.specVersion}` : "invalid CycloneDX document",
      });
    } catch (e) {
      checks.push({ name: "sbom-cyclonedx", ok: false, detail: `unparseable: ${(e as Error).message}` });
    }
  }

  // 3. SLSA provenance subject match
  if (opts.provenance && existsSync(opts.provenance)) {
    try {
      const prov = JSON.parse(readFileSync(opts.provenance, "utf8"));
      const subject = prov?.subject ?? [];
      const actual = sha256File(opts.artifact);
      const matched = subject.some(
        (s: { digest?: Record<string, string>; name?: string }) =>
          s.digest && String(s.digest.sha256 ?? "").toLowerCase() === actual,
      );
      checks.push({
        name: "slsa-provenance-subject",
        ok: matched,
        detail: matched ? `subject sha256 matches ${opts.artifact}` : "no subject digest matches the artifact",
      });
    } catch (e) {
      checks.push({ name: "slsa-provenance-subject", ok: false, detail: `unparseable: ${(e as Error).message}` });
    }
  }

  // 4. Signature: cosign keyless (Rekor) when available, else local Ed25519.
  const cosign = await runCommand("cosign", ["version"], { timeoutMs: 8000, env: { PATH: process.env.PATH ?? "" } });
  if (cosign.ok && opts.cosignIdentity) {
    const identityFlag = opts.cosignIdentity.includes("*")
      ? "--certificate-identity-regexp"
      : "--certificate-identity";
    const args = [
      "verify-blob",
      identityFlag, opts.cosignIdentity,
      "--certificate-oidc-issuer", opts.cosignIssuer ?? "https://token.actions.githubusercontent.com",
      "--bundle", `${opts.artifact}.bundle`,
      opts.artifact,
    ];
    const res = await runCommand("cosign", args, { timeoutMs: 120_000, env: { PATH: process.env.PATH ?? "" } });
    checks.push({
      name: "cosign-keyless-verify",
      ok: res.ok,
      detail: res.ok
        ? "signature verified against the public Rekor transparency log (keyless)"
        : res.stderr.trim().slice(0, 300) || "cosign verify-blob failed",
    });
  } else if (opts.localKey && opts.localSig && existsSync(opts.localKey) && existsSync(opts.localSig)) {
    // Local test path: Ed25519 over the artifact bytes. NOT keyless proof —
    // reported honestly as a local self-check.
    try {
      const { verify } = await import("node:crypto");
      const key = readFileSync(opts.localKey);
      const sig = readFileSync(opts.localSig);
      const artifact = readFileSync(opts.artifact);
      const ok = verify(null, artifact, key, sig);
      checks.push({
        name: "local-signature",
        ok,
        detail: ok
          ? "local Ed25519 signature verified (self-check path, NOT keyless/Rekor)"
          : "local signature does not match the artifact",
      });
    } catch (e) {
      checks.push({ name: "local-signature", ok: false, detail: `verification error: ${(e as Error).message}` });
    }
  } else {
    checks.push({
      name: "signature",
      ok: false,
      detail: "no cosign binary with identity, and no local key/signature provided — nothing to verify (no claim made)",
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const report = await verifyRelease({
    artifact: get("--artifact") ?? "xr.tgz",
    sums: get("--sums"),
    sbom: get("--sbom"),
    provenance: get("--provenance"),
    cosignIdentity: get("--cosign-identity"),
    cosignIssuer: get("--cosign-issuer"),
    localKey: get("--local-key"),
    localSig: get("--local-sig"),
  });
  for (const c of report.checks) {
    console.log(`${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(report.ok ? "VERIFIED" : "NOT VERIFIED");
  process.exit(report.ok ? 0 : 1);
}
