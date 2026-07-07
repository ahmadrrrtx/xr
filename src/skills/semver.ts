/** XR 2.1C — small dependency-free semver helpers for Skill version resolution. */
export interface SemverParts { major: number; minor: number; patch: number; prerelease?: string }

export function parseSemver(version: string): SemverParts | null {
  const m = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (const key of ["major", "minor", "patch"] as const) {
    const diff = pa[key] - pb[key];
    if (diff !== 0) return diff;
  }
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  return (pa.prerelease ?? "").localeCompare(pb.prerelease ?? "");
}

function cmp(version: string, op: string, target: string): boolean {
  const n = compareSemver(version, target);
  if (op === ">") return n > 0;
  if (op === ">=") return n >= 0;
  if (op === "<") return n < 0;
  if (op === "<=") return n <= 0;
  if (op === "=" || op === "") return n === 0;
  return false;
}

export function satisfiesSemver(version: string, range?: string): boolean {
  const r = (range ?? "*" ).trim();
  if (!r || r === "*" || r.toLowerCase() === "latest") return true;
  if (r.includes("||")) return r.split("||").some((part) => satisfiesSemver(version, part.trim()));
  const parts = r.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.every((part) => satisfiesSemver(version, part));
  const one = parts[0] ?? r;
  if (/^\d+\.x$/i.test(one)) return version.startsWith(one.slice(0, -1));
  if (/^\d+\.\d+\.x$/i.test(one)) return version.startsWith(one.slice(0, -1));
  if (one.startsWith("^")) {
    const base = one.slice(1);
    const p = parseSemver(base);
    if (!p) return false;
    return cmp(version, ">=", base) && cmp(version, "<", `${p.major + 1}.0.0`);
  }
  if (one.startsWith("~")) {
    const base = one.slice(1);
    const p = parseSemver(base);
    if (!p) return false;
    return cmp(version, ">=", base) && cmp(version, "<", `${p.major}.${p.minor + 1}.0`);
  }
  const m = one.match(/^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (m) return cmp(version, m[1] ?? "=", m[2]);
  return version === one;
}

export function maxSatisfying(versions: string[], range?: string): string | undefined {
  return versions
    .filter((version) => satisfiesSemver(version, range))
    .sort((a, b) => compareSemver(b, a))[0];
}
