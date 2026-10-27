/** Verify exactly the requested facets; missing inputs fail, not silently skip.
 * --strict requires authenticated publisher + SLSA evidence. Local Ed25519
 * fixtures/parsed DSSE subjects NEVER stand in for those production checks. */
import { createHash, verify } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { runCommand } from "../src/util/process";
export interface VerificationReport {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}
export function parseSums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line);
    if (!match) throw new Error("Malformed checksum entry");
    const name = match[2]!.replace(/^\.\//, "");
    if (
      !name ||
      name.startsWith("/") ||
      /^[a-z]:/i.test(name) ||
      /[\\\x00-\x1f\x7f]/.test(name) ||
      name.split("/").some((s) => s === ".." || s === "." || !s)
    )
      throw new Error("Unsafe checksum path");
    if (result.has(name)) throw new Error("Duplicate checksum entry");
    result.set(name, match[1]!.toLowerCase());
  }
  if (!result.size) throw new Error("Empty checksum inventory");
  return result;
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function validateSbom(doc: any, expectedVersion?: string): boolean {
  if (
    doc?.bomFormat !== "CycloneDX" ||
    doc.specVersion !== "1.5" ||
    !Array.isArray(doc.components) ||
    !doc.components.length
  )
    return false;
  const root = doc.metadata?.component;
  if (
    typeof root?.["bom-ref"] !== "string" ||
    !root["bom-ref"] ||
    typeof root.version !== "string" ||
    (expectedVersion && root.version !== expectedVersion)
  )
    return false;
  const refs = new Set<string>([root["bom-ref"]]);
  for (const c of doc.components) {
    if (
      typeof c.name !== "string" ||
      !c.name ||
      typeof c.version !== "string" ||
      !c.version ||
      typeof c["bom-ref"] !== "string" ||
      refs.has(c["bom-ref"])
    )
      return false;
    refs.add(c["bom-ref"]);
    if (
      c.hashes !== undefined &&
      (!Array.isArray(c.hashes) ||
        !c.hashes.length ||
        !c.hashes.every((h: any) =>
          (
            ({
              "SHA-256": /^[a-f\d]{64}$/i,
              "SHA-384": /^[a-f\d]{96}$/i,
              "SHA-512": /^[a-f\d]{128}$/i,
            }) as Record<string, RegExp>
          )[h.alg]?.test(h.content),
        ))
    )
      return false;
    if (
      !c.hashes &&
      !c.properties?.some(
        (p: any) =>
          p.name === "xr:integrity" && p.value.startsWith("unavailable"),
      )
    )
      return false;
  }
  return (
    Array.isArray(doc.dependencies) &&
    doc.dependencies.some((d: any) => d.ref === root["bom-ref"]) &&
    doc.dependencies.every(
      (d: any) =>
        refs.has(d.ref) &&
        (!d.dependsOn || d.dependsOn.every((ref: string) => refs.has(ref))),
    )
  );
}
/** Parse one or more DSSE/statement JSONL records. This is a digest check,
 * NOT DSSE signature/builder authentication; slsa-verifier does that below. */
export function provenanceMatches(
  text: string,
  name: string,
  digest: string,
): boolean {
  let records: any[];
  try {
    records = [JSON.parse(text)];
  } catch {
    records = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }
  return records.some((record) => {
    const statement =
      record.payload !== undefined
        ? JSON.parse(Buffer.from(record.payload, "base64").toString("utf8"))
        : record;
    return (
      Array.isArray(statement?.subject) &&
      statement.subject.some(
        (s: any) =>
          typeof s.name === "string" &&
          basename(s.name) === basename(name) &&
          s.digest?.sha256?.toLowerCase() === digest,
      )
    );
  });
}
export interface VerificationInput {
  artifact: string;
  sums?: string;
  sbom?: string;
  provenance?: string;
  expectedVersion?: string;
  cosignIdentity?: string;
  cosignIssuer?: string;
  localKey?: string;
  localSig?: string;
  slsaSourceUri?: string;
  slsaSourceTag?: string;
  strict?: boolean;
}
export async function verifyRelease(
  opts: VerificationInput,
): Promise<VerificationReport> {
  const checks: VerificationReport["checks"] = [],
    add = (name: string, ok: boolean, detail?: string) => {
      checks.push({ name, ok, ...(detail ? { detail } : {}) });
    };
  const artifactExists =
    existsSync(opts.artifact) && lstatSync(opts.artifact).isFile();
  add("artifact-exists", artifactExists);
  if (!artifactExists) return { ok: false, checks };
  const digest = sha256(opts.artifact);
  if (opts.strict)
    add(
      "complete-release-inputs",
      Boolean(
        opts.sums &&
        opts.sbom &&
        opts.provenance &&
        opts.cosignIdentity &&
        opts.expectedVersion &&
        opts.slsaSourceUri &&
        opts.slsaSourceTag,
      ),
      "strict requires sums, SBOM, exact publisher identity, expected version and authenticated SLSA inputs; local keys cannot substitute",
    );
  let sums: Map<string, string> | undefined;
  if (opts.sums) {
    try {
      sums = parseSums(readFileSync(opts.sums, "utf8"));
      const expected =
        sums.get(opts.artifact.replace(/^\.\//, "")) ??
        sums.get(basename(opts.artifact));
      add(
        "artifact-sha256",
        expected === digest,
        expected ? `sha256 ${digest}` : "artifact absent from sums",
      );
      if (opts.strict) {
        for (const [name, expectedHash] of sums) {
          const file = resolve(dirname(opts.sums), name);
          add(
            `inventory-sha256:${name}`,
            existsSync(file) &&
              lstatSync(file).isFile() &&
              sha256(file) === expectedHash,
          );
        }
      }
    } catch {
      add(
        "artifact-sha256",
        false,
        "missing/malformed/duplicate/unsafe checksum inventory",
      );
    }
  }
  if (opts.sbom) {
    try {
      const doc = JSON.parse(readFileSync(opts.sbom, "utf8")),
        ok = validateSbom(doc, opts.expectedVersion);
      add(
        "sbom-cyclonedx",
        ok,
        ok
          ? `${doc.components.length} locked components; explicitly scoped inventory`
          : "invalid CycloneDX structure/digests/refs or identity mismatch",
      );
      if (sums)
        add("sbom-sha256", sums.get(basename(opts.sbom)) === sha256(opts.sbom));
    } catch {
      add("sbom-cyclonedx", false, "missing or malformed requested SBOM");
    }
  }
  if (opts.provenance) {
    try {
      add(
        "slsa-provenance-subject",
        provenanceMatches(
          readFileSync(opts.provenance, "utf8"),
          opts.artifact,
          digest,
        ),
        "subject name/digest only; NOT builder authentication",
      );
    } catch {
      add(
        "slsa-provenance-subject",
        false,
        "missing/malformed requested provenance",
      );
    }
  }
  const commandEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "",
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
  if (opts.cosignIdentity) {
    if (
      opts.cosignIdentity.includes("*") ||
      !opts.cosignIdentity.startsWith("https://github.com/")
    ) {
      add(
        "cosign-keyless-verify",
        false,
        "require an exact GitHub workflow@tag identity, not a wildcard",
      );
    } else {
      const version = await runCommand("cosign", ["version"], {
        timeoutMs: 8000,
        env: commandEnv,
      });
      if (!version.ok)
        add(
          "cosign-keyless-verify",
          false,
          "cosign unavailable; no publisher claim made",
        );
      else {
        for (const [name, path] of [
          ["cosign-keyless-verify", opts.artifact],
          ["signed-checksum-inventory", opts.sums],
          ["signed-sbom", opts.sbom],
        ] as const) {
          if (!path) continue;
          if (!existsSync(`${path}.bundle`)) {
            add(name, false, "missing requested signature bundle");
            continue;
          }
          const result = await runCommand(
            "cosign",
            [
              "verify-blob",
              "--certificate-identity",
              opts.cosignIdentity,
              "--certificate-oidc-issuer",
              opts.cosignIssuer ??
                "https://token.actions.githubusercontent.com",
              "--bundle",
              `${path}.bundle`,
              path,
            ],
            { timeoutMs: 120_000, env: commandEnv },
          );
          add(
            name,
            result.ok,
            result.ok
              ? "cosign keyless verification executed (certificate identity + transparency bundle)"
              : "cosign verification failed; no publisher claim made",
          );
        }
      }
    }
  } else if (opts.localKey && opts.localSig) {
    try {
      const ok = verify(
        null,
        readFileSync(opts.artifact),
        readFileSync(opts.localKey),
        readFileSync(opts.localSig),
      );
      add(
        "local-signature",
        ok,
        ok
          ? "local Ed25519 signature verified (self-check path, NOT keyless/Rekor)"
          : "local signature does not match the artifact",
      );
    } catch {
      add(
        "local-signature",
        false,
        "missing/invalid local verification inputs",
      );
    }
  } else
    add(
      "signature",
      false,
      "no verification identity/key supplied — no claim made",
    );
  if (opts.slsaSourceUri || opts.slsaSourceTag) {
    if (!opts.provenance || !opts.slsaSourceUri || !opts.slsaSourceTag)
      add(
        "slsa-builder-authentication",
        false,
        "provenance/source URI/source tag all required",
      );
    else {
      const result = await runCommand(
        "slsa-verifier",
        [
          "verify-artifact",
          opts.artifact,
          "--provenance-path",
          opts.provenance,
          "--source-uri",
          opts.slsaSourceUri,
          "--source-tag",
          opts.slsaSourceTag,
        ],
        { timeoutMs: 120_000, env: commandEnv },
      );
      add(
        "slsa-builder-authentication",
        result.ok,
        result.ok
          ? "slsa-verifier authenticated builder/source tag and subject digest"
          : "slsa-verifier missing/failed; parsed subject is NOT authentication",
      );
    }
  }
  return { ok: checks.every((c) => c.ok), checks };
}
if (import.meta.main) {
  const args = process.argv.slice(2),
    values = new Map<string, string>(),
    booleans = new Set(["--strict", "--json"]),
    allowed = new Set([
      "--artifact",
      "--sums",
      "--sbom",
      "--provenance",
      "--expected-version",
      "--cosign-identity",
      "--cosign-issuer",
      "--local-key",
      "--local-sig",
      "--slsa-source-uri",
      "--slsa-source-tag",
    ]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (booleans.has(a)) continue;
    if (!allowed.has(a) || !args[i + 1] || args[i + 1]!.startsWith("--"))
      throw new Error("Unknown/missing verification argument");
    values.set(a, args[++i]!);
  }
  const get = (flag: string) => values.get(flag),
    report = await verifyRelease({
      artifact: get("--artifact") ?? "xr.tgz",
      sums: get("--sums"),
      sbom: get("--sbom"),
      provenance: get("--provenance"),
      expectedVersion: get("--expected-version"),
      cosignIdentity: get("--cosign-identity"),
      cosignIssuer: get("--cosign-issuer"),
      localKey: get("--local-key"),
      localSig: get("--local-sig"),
      slsaSourceUri: get("--slsa-source-uri"),
      slsaSourceTag: get("--slsa-source-tag"),
      strict: args.includes("--strict"),
    });
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    for (const c of report.checks)
      console.log(
        `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`,
      );
    console.log(report.ok ? "VERIFIED REQUESTED FACETS" : "NOT VERIFIED");
  }
  process.exitCode = report.ok ? 0 : 1;
}
