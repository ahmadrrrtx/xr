/**
 * XR Phase 4 · T6 — CycloneDX SBOM generator (1.5, JSON).
 *
 * Builds the Software Bill of Materials for a release from the LOCKED
 * dependency set (bun.lock) — never from `npm ls` against a live registry,
 * and never from package.json ranges. Every component carries its integrity
 * hash from the lockfile, so the SBOM pins the exact artifacts.
 *
 * The SBOM is:
 *   · generated in CI (supply-chain.yml) and attached to every release;
 *   · consumed by SBOM-driven vulnerability scanning (grype/trivy);
 *   · signed as a cosign attestation (release.yml, keyless via GH OIDC).
 *
 * Output: sbom.cyclonedx.json in the repo root (or --out <path>).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

interface LockPackage {
  name: string;
  version: string;
  integrity?: string;
}

/** bun.lock is JSON-with-trailing-commas; strip them before parsing. */
function parseLockJson(text: string): unknown {
  // Remove a comma that is followed only by whitespace and a closing brace.
  const fixed = text.replace(/,([\t\r\n ]*[}\]])/g, "$1");
  return JSON.parse(fixed);
}

/** Parse the locked dependency set from bun.lock (JSON format). */
export function lockedDependencies(lockPath = "bun.lock"): LockPackage[] {
  const raw = parseLockJson(readFileSync(lockPath, "utf8")) as { packages?: Record<string, unknown> };
  const packages = raw?.packages;
  if (!packages || typeof packages !== "object") {
    throw new Error("bun.lock: missing packages map");
  }
  const out: LockPackage[] = [];
  for (const [name, entry] of Object.entries(packages) as Array<[string, unknown]>) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const spec = String(entry[0] ?? "");
    // bun.lock entry: ["<name>@<version>", <resolved>, <meta>, <integrity>]
    const at = spec.lastIndexOf("@");
    const specVersion = at > 0 ? spec.slice(at + 1) : "";
    const version = String(entry[1] ?? "") || specVersion;
    const integrity = typeof entry[entry.length - 1] === "string" ? String(entry[entry.length - 1]) : undefined;
    if (!version) continue;
    out.push({ name, version, integrity });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface SbomInput {
  componentName: string;
  componentVersion: string;
  serialNumber: string;
  dependencies: LockPackage[];
  /** Optional hash of the release artifact this SBOM describes. */
  artifactHash?: string;
}

/** Emit a CycloneDX 1.5 JSON document. */
export function renderCycloneDx(input: SbomInput): Record<string, unknown> {
  const bomRefs = input.dependencies.map((d) => `${d.name}@${d.version}`);
  const components = input.dependencies.map((d, i) => ({
    type: "library",
    "bom-ref": bomRefs[i],
    name: d.name,
    version: d.version,
    ...(d.integrity ? { hashes: [{ alg: d.integrity.startsWith("sha512-") ? "SHA-512" : "SHA-256", content: d.integrity.replace(/^sha(512|256)-/, "") }] } : {}),
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: input.serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "xr", name: "xr-sbom", version: input.componentVersion }],
      component: {
        type: "application",
        name: input.componentName,
        version: input.componentVersion,
        ...(input.artifactHash ? { hashes: [{ alg: "SHA-256", content: input.artifactHash }] } : {}),
      },
      properties: [
        { name: "xr:generated-from", value: "bun.lock (locked dependencies)" },
        { name: "xr:claim", value: "dependency inventory only; NOT a security certification" },
      ],
    },
    components,
    dependencies: [
      {
        ref: input.componentName,
        dependsOn: bomRefs,
      },
      ...input.dependencies.map((d, i) => ({ ref: bomRefs[i], dependsOn: [] })),
    ],
  };
}

export function buildSbom(opts: { out?: string; version?: string } = {}): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const version = opts.version ?? pkg.version;
  const serial = `urn:uuid:${randomUUID()}`;
  const doc = renderCycloneDx({
    componentName: pkg.name,
    componentVersion: version,
    serialNumber: serial,
    dependencies: lockedDependencies(),
  });
  const out = opts.out ?? "sbom.cyclonedx.json";
  writeFileSync(resolve(out), JSON.stringify(doc, null, 2));
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const verIdx = args.indexOf("--version");
  const version = verIdx >= 0 ? args[verIdx + 1] : undefined;
  const path = buildSbom({ out, version });
  console.log(`SBOM written to ${path}`);
}
