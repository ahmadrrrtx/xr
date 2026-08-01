/**
 * XR Phase 4 · T6 — license compliance check.
 *
 * Reads the LOCKED dependency set (bun.lock) and, for each installed package,
 * reads its `license` field from node_modules (installed tree, not registry
 * claims). Forbidden licenses (copyleft / source-available / non-commercial)
 * fail CI; unknown licenses are reported and require an explicit allowlist
 * entry. Runs in CI after `bun install --frozen-lockfile`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Copyleft / source-available / non-commercial licenses that block the
 *  MIT release pipeline unless explicitly waived in the allowlist below. */
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
  status: "ok" | "forbidden" | "unknown" | "missing";
}

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

export function runLicenseCheck(): { results: LicenseResult[]; ok: boolean } {
  const lock = JSON.parse(
    readFileSync("bun.lock", "utf8").replace(/,([\t\r\n ]*[}\]])/g, "$1"),
  ) as { packages: Record<string, unknown[]> };
  const results: LicenseResult[] = [];
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const spec = String(entry[0]);
    const at = spec.lastIndexOf("@");
    const version = at > 0 ? spec.slice(at + 1) : "";
    const pkgDir = join("node_modules", name);
    const license = licenseOf(pkgDir);
    const key = `${name}@${version}`;
    let status: LicenseResult["status"] = "ok";
    if (license === "") {
      status = ALLOWLIST[key] ? "ok" : "missing";
    } else if (FORBIDDEN.some((re) => re.test(license))) {
      status = ALLOWLIST[key] ? "ok" : "forbidden";
    } else if (license === "UNKNOWN" || /^(see|view)/i.test(license)) {
      status = ALLOWLIST[key] ? "ok" : "unknown";
    }
    results.push({ name, version, license: license || "(none)", status });
  }
  return { results, ok: results.every((r) => r.status === "ok") };
}

if (import.meta.main) {
  const { results, ok } = runLicenseCheck();
  const bad = results.filter((r) => r.status !== "ok");
  for (const r of results) {
    if (r.status === "ok") continue;
    console.log(`[license] ${r.status.toUpperCase()}: ${r.name}@${r.version} — ${r.license}`);
  }
  console.log(`${results.length} packages checked; ${bad.length} not clean`);
  process.exit(ok ? 0 : 1);
}
