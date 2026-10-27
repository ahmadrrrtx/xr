/** Locked application dependency inventory. CycloneDX1.5, not a security
 * certification or an invented complete runtime/system-library inventory. */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
export interface LockPackage {
  name: string;
  version: string;
  integrity?: string;
  ecosystem?: "npm" | "cargo";
  scope?: string;
}
function parseLockJson(text: string): unknown {
  return JSON.parse(text.replace(/,([\t\r\n ]*[}\]])/g, "$1"));
}
export function lockedDependencies(lockPath = "bun.lock"): LockPackage[] {
  const raw = parseLockJson(readFileSync(lockPath, "utf8")) as {
    packages?: Record<string, unknown>;
  };
  if (!raw.packages || typeof raw.packages !== "object")
    throw new Error(`${lockPath}: missing locked packages map`);
  return Object.entries(raw.packages)
    .map(([key, entry]) => {
      if (!Array.isArray(entry)) throw new Error(`Invalid locked entry ${key}`);
      const spec = String(entry[0] ?? ""),
        at = spec.lastIndexOf("@");
      if (at <= 0 || !spec.slice(at + 1))
        throw new Error(`Missing exact locked name/version: ${key}`);
      const integrity = entry.find(
        (x, i) =>
          i > 1 && typeof x === "string" && /^sha(256|384|512)-/.test(x),
      );
      return {
        name: spec.slice(0, at),
        version: spec.slice(at + 1),
        integrity: typeof integrity === "string" ? integrity : undefined,
        ecosystem: "npm" as const,
        scope: lockPath,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );
}
export function lockedCargoDependencies(
  path = "desktop/src-tauri/Cargo.lock",
): LockPackage[] {
  const lock = Bun.TOML.parse(readFileSync(path, "utf8")) as {
    package?: Array<{ name?: unknown; version?: unknown; checksum?: unknown }>;
  };
  if (!Array.isArray(lock.package))
    throw new Error(`${path}: missing locked crates`);
  return lock.package.map((p) => {
    if (typeof p.name !== "string" || typeof p.version !== "string")
      throw new Error("Invalid locked Cargo package");
    if (
      p.checksum !== undefined &&
      (typeof p.checksum !== "string" || !/^[a-f0-9]{64}$/.test(p.checksum))
    )
      throw new Error("Invalid Cargo checksum");
    return {
      name: p.name,
      version: p.version,
      ecosystem: "cargo",
      scope: path,
      ...(p.checksum
        ? {
            integrity: `sha256-${Buffer.from(p.checksum as string, "hex").toString("base64")}`,
          }
        : {}),
    };
  });
}
/** SRI stores base64; CycloneDX hash content must be hex. Never label a
 * malformed/unavailable digest as verified package integrity. */
export function sriHash(sri: string): { alg: string; content: string } {
  const match = /^sha(256|384|512)-([A-Za-z0-9+/]+={0,2})$/.exec(sri);
  if (!match) throw new Error("Unsupported/malformed locked integrity");
  const bytes = Buffer.from(match[2]!, "base64"),
    bits = Number(match[1]);
  if (bytes.length !== bits / 8 || bytes.toString("base64") !== match[2])
    throw new Error("Malformed locked integrity length/encoding");
  return { alg: `SHA-${bits}`, content: bytes.toString("hex") };
}
export interface SbomInput {
  componentName: string;
  componentVersion: string;
  serialNumber: string;
  dependencies: LockPackage[];
  artifactHash?: string;
  scope?: string;
}
export function renderCycloneDx(input: SbomInput): Record<string, unknown> {
  const root = `application:${input.componentName}@${input.componentVersion}`,
    unique = new Map<string, LockPackage>();
  for (const dep of input.dependencies) {
    const ref = `${dep.ecosystem ?? "npm"}:${dep.name}@${dep.version}`,
      previous = unique.get(ref);
    if (previous && previous.integrity !== dep.integrity)
      throw new Error(`Conflicting locked integrity for ${ref}`);
    unique.set(ref, dep);
  }
  const components = [...unique.entries()].map(([ref, d]) => ({
    type: "library",
    "bom-ref": ref,
    name: d.name,
    version: d.version,
    purl: `pkg:${d.ecosystem ?? "npm"}/${d.name.replace(/^@/, "%40")}@${encodeURIComponent(d.version)}`,
    ...(d.integrity ? { hashes: [sriHash(d.integrity)] } : {}),
    properties: [
      { name: "xr:lock-source", value: d.scope ?? "bun.lock" },
      ...(!d.integrity
        ? [
            {
              name: "xr:integrity",
              value:
                "unavailable for local/path/git package; no digest invented",
            },
          ]
        : []),
    ],
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: input.serialNumber,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        { vendor: "xr", name: "xr-sbom", version: input.componentVersion },
      ],
      component: {
        type: "application",
        "bom-ref": root,
        name: input.componentName,
        version: input.componentVersion,
        ...(input.artifactHash
          ? { hashes: [{ alg: "SHA-256", content: input.artifactHash }] }
          : {}),
      },
      properties: [
        {
          name: "xr:generated-from",
          value: input.scope ?? "bun.lock (locked dependencies)",
        },
        {
          name: "xr:claim",
          value:
            "application lock inventory only; embedded runtime libraries and system libraries/frameworks are NOT inventoried; NOT a security certification",
        },
        {
          name: "xr:dependency-graph",
          value:
            "flat inventory; transitive edges intentionally not inferred from version ranges",
        },
      ],
    },
    components,
    dependencies: [
      { ref: root, dependsOn: components.map((c) => c["bom-ref"]) },
    ],
  };
}
export function buildSbom(
  opts: { out?: string; version?: string; scope?: "root" | "combined" } = {},
): string {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (opts.version && opts.version !== pkg.version)
    throw new Error(
      "SBOM version must match the committed derived package identity",
    );
  const combined = opts.scope === "combined",
    deps = lockedDependencies();
  if (combined)
    deps.push(
      ...lockedDependencies("desktop/bun.lock"),
      ...lockedCargoDependencies(),
    );
  const doc = renderCycloneDx({
    componentName: pkg.name,
    componentVersion: pkg.version,
    serialNumber: `urn:uuid:${randomUUID()}`,
    dependencies: deps,
    scope: combined
      ? "bun.lock + desktop/bun.lock + desktop/src-tauri/Cargo.lock (union of target lock dependencies, not runtime reachability)"
      : "bun.lock (root application + development locked dependencies)",
  });
  const out = opts.out ?? "sbom.cyclonedx.json";
  writeFileSync(resolve(out), JSON.stringify(doc, null, 2) + "\n");
  return out;
}
if (import.meta.main) {
  const args = process.argv.slice(2),
    get = (flag: string) => {
      const i = args.indexOf(flag);
      return i >= 0 ? args[i + 1] : undefined;
    };
  const scope = get("--scope") ?? "root";
  if (!["root", "combined"].includes(scope))
    throw new Error("Invalid SBOM scope");
  console.log(
    `SBOM written to ${buildSbom({ out: get("--out"), version: get("--version"), scope: scope as "root" | "combined" })}`,
  );
}
