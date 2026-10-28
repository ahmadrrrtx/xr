/**
 * XR Phase 4 · T6 — license compliance check.
 *
 * Checks installed metadata for every locked dependency. A missing optional Bun
 * platform package is exempt only when it cannot apply to the current target;
 * installed packages and missing applicable packages are still checked. Bun's
 * package.json says MIT, but the runtime embeds additional licensed libraries:
 * that separate review is a release-blocking result until the repository owner
 * records an explicit policy decision in
 * licenses/bun-v<version>-REVIEW-ACK.json — an owner acknowledgement with
 * provenance, version-pinned (any Bun version change requires a fresh review,
 * per licenses/README.md). No ack, a malformed ack, or a version mismatch
 * fails closed as review-required; this is a recorded decision, never a
 * silent waiver.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Copyleft / source-available / non-commercial licenses block the MIT
 * release pipeline unless explicitly waived in the allowlist below. */
const FORBIDDEN = [/^GPL/, /^AGPL/, /^LGPL/, /^SSPL/, /^CC-BY-NC/, /^BUSL/, /^Elastic/i, /^MongoDB/i, /^PolyForm/i, /^Commons-Clause/i];

/** Explicit waivers (name@version → reason) — owned, dated. */
const ALLOWLIST: Record<string, string> = {
  // fsevents 2.x: MIT-licensed, but its package.json (2.3.2) omits the
  // license field; macOS-only optional dep (noop on Linux/Windows).
  "fsevents@2.3.2": "MIT per upstream repository; package.json omits the field; optional macOS dep",
};

interface LicenseResult {
  name: string;
  version: string;
  license: string;
  status: "ok" | "forbidden" | "unknown" | "missing" | "not-applicable" | "review-required";
}
interface Target { platform: string; arch: string; libc: "glibc" | "musl" | null }

function licenseOf(pkgDir: string): string {
  const pj = join(pkgDir, "package.json");
  if (!existsSync(pj)) return "";
  try {
    const j = JSON.parse(readFileSync(pj, "utf8"));
    const lic = j.license ?? j.licenses?.[0]?.type;
    if (typeof lic === "string") return lic;
    if (lic && typeof lic === "object") return String(lic.type ?? "");
    return "";
  } catch {
    return "";
  }
}

function hostTarget(): Target {
  let libc: Target["libc"] = null;
  if (process.platform === "linux") {
    try {
      const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string }; sharedObjects?: string[] } | undefined;
      if (report?.header?.glibcVersionRuntime) libc = "glibc";
      else if ((report?.sharedObjects ?? []).some((p) => /musl/i.test(p))) libc = "musl";
      else {
        const cpu = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : "";
        if (cpu && existsSync(`/lib/ld-musl-${cpu}.so.1`)) libc = "musl";
      }
    } catch { /* Unknown libc means neither Linux variant can be waived. */ }
  }
  return { platform: process.platform, arch: process.arch, libc };
}

// Only recognized, directly declared platform-specific Bun packages may be
// marked not-applicable. A bad/missing manifest or an unknown target fails closed.
function incompatibleOptionalRuntime(name: string, version: string, optional: Record<string, string>, target: Target): boolean {
  const m = /^@oven\/bun-(darwin|linux|windows)-(x64|aarch64)(-musl)?$/.exec(name);
  if (!m || optional[name] !== version || (m[3] && m[1] !== "linux")) return false;
  const platform = m[1] === "windows" ? "win32" : m[1];
  const arch = m[2] === "aarch64" ? "arm64" : "x64";
  if (platform !== target.platform || arch !== target.arch) return true;
  return platform === "linux" && target.libc !== null && (m[3] ? "musl" : "glibc") !== target.libc;
}

export function runLicenseCheck(options: { root?: string; target?: Target } = {}): { results: LicenseResult[]; ok: boolean } {
  const root = options.root ?? ".";
  const target = options.target ?? hostTarget();
  const lock = JSON.parse(
    readFileSync(join(root, "bun.lock"), "utf8").replace(/,([\t\r\n ]*[}\]])/g, "$1"),
  ) as { packages: Record<string, unknown[]>; workspaces?: Record<string, { optionalDependencies?: Record<string, string> }> };
  const optional = lock.workspaces?.[""]?.optionalDependencies ?? {};
  const results: LicenseResult[] = [];
  const bunVersions = new Set<string>();
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const spec = String(entry[0]);
    const at = spec.lastIndexOf("@");
    const version = at > 0 ? spec.slice(at + 1) : "";
    if (/^@oven\/bun-(?:darwin|linux|windows)-(?:x64|aarch64)(?:-musl)?$/.test(name)) bunVersions.add(version);
    const pkgDir = join(root, "node_modules", name);
    const license = licenseOf(pkgDir);
    const key = `${name}@${version}`;
    let status: LicenseResult["status"] = "ok";
    if (!existsSync(pkgDir) && incompatibleOptionalRuntime(name, version, optional, target)) {
      status = "not-applicable";
    } else if (license === "") {
      status = ALLOWLIST[key] ? "ok" : "missing";
    } else if (FORBIDDEN.some((re) => re.test(license))) {
      status = ALLOWLIST[key] ? "ok" : "forbidden";
    } else if (license === "UNKNOWN" || /^(see|view)/i.test(license)) {
      status = ALLOWLIST[key] ? "ok" : "unknown";
    }
    results.push({ name, version, license: license || "(none)", status });
  }
  for (const version of bunVersions) {
    // Owner acknowledgement of the LGPL embedded components — fail closed:
    // only a present, well-formed, version-matching ack with an explicit
    // acknowledge decision turns this row ok. Anything else (missing file,
    // parse error, wrong version, different decision) stays review-required.
    let ack: { version?: string; decision?: string; decidedBy?: string; decidedAt?: string } | null = null;
    try {
      ack = JSON.parse(readFileSync(join(root, "licenses", `bun-v${version}-REVIEW-ACK.json`), "utf8"));
    } catch {
      ack = null;
    }
    const acknowledged =
      ack !== null &&
      ack.version === version &&
      ack.decision === "acknowledged-for-redistribution" &&
      typeof ack.decidedBy === "string" && ack.decidedBy !== "" &&
      typeof ack.decidedAt === "string" && ack.decidedAt !== "";
    results.push({
      name: "Bun embedded components", version,
      license: acknowledged
        ? `LGPL JavaScriptCore/WebKit and tinycc; owner review acknowledged ${ack!.decidedAt} by ${ack!.decidedBy} — see licenses/bun-v${version}-REVIEW-ACK.json and licenses/bun-v${version}-LICENSE.md`
        : `LGPL JavaScriptCore/WebKit and tinycc; see licenses/bun-v${version}-LICENSE.md and obtain legal/policy review (record it as licenses/bun-v${version}-REVIEW-ACK.json)`,
      status: acknowledged ? "ok" : "review-required",
    });
  }
  return { results, ok: results.every((r) => r.status === "ok" || r.status === "not-applicable") };
}

if (import.meta.main) {
  const { results, ok } = runLicenseCheck();
  const bad = results.filter((r) => r.status !== "ok" && r.status !== "not-applicable");
  for (const r of bad) console.log(`[license] ${r.status.toUpperCase()}: ${r.name}@${r.version} — ${r.license}`);
  const skipped = results.filter((r) => r.status === "not-applicable").length;
  console.log(`${results.length} entries reviewed; ${skipped} inapplicable optional platforms; ${bad.length} not clean`);
  process.exit(ok ? 0 : 1);
}
