/**
 * XR 1.0 — plugin compatibility checker.
 *
 * A tiny, dependency-free semver + range matcher. We only need the subset that
 * plugin manifests use:
 *   "*"                 any version
 *   ">=1.0.0"           comparator
 *   ">=1.0.0 <2.0.0"    space-joined AND
 *   "^1.2.0"            caret (compatible-with: same major, >= given)
 *   "~1.2.0"            tilde (same major.minor, >= given)
 *   "1.x" / "1.*"       wildcard minor/patch
 *   "a || b"            OR of ranges
 *
 * Deterministic and fully unit-tested. Pre-release tags are ignored for the
 * comparison (a 1.0.0-rc.1 core is treated as 1.0.0 for plugin matching).
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(v: string): SemVer | null {
  const cleaned = String(v).trim().replace(/^[v=]+/, "");
  const core = cleaned.split(/[-+]/)[0]; // drop pre-release / build metadata
  const m = core.match(/^(\d+)\.(\d+)\.(\d+)$/) ?? core.match(/^(\d+)\.(\d+)$/) ?? core.match(/^(\d+)$/);
  if (!m) return null;
  return {
    major: Number(m[1] ?? 0),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
  };
}

export function compareSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function satisfiesComparator(version: SemVer, comparator: string): boolean {
  const token = comparator.trim();
  if (!token || token === "*" || token === "x" || token === "X") return true;

  // Caret: ^1.2.3 → >=1.2.3 <2.0.0 (or for 0.x, narrower — keep it simple & safe)
  if (token.startsWith("^")) {
    const base = parseSemver(token.slice(1));
    if (!base) return false;
    if (compareSemver(version, base) < 0) return false;
    if (base.major > 0) return version.major === base.major;
    if (base.minor > 0) return version.major === 0 && version.minor === base.minor;
    return version.major === 0 && version.minor === 0;
  }

  // Tilde: ~1.2.3 → >=1.2.3 <1.3.0
  if (token.startsWith("~")) {
    const base = parseSemver(token.slice(1));
    if (!base) return false;
    if (compareSemver(version, base) < 0) return false;
    return version.major === base.major && version.minor === base.minor;
  }

  // Comparators
  const m = token.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!m) return false;
  const op = m[1] ?? "=";
  const target = parseSemver(m[2]);
  if (!target) {
    // Wildcards like 1.x / 1.* — match the fixed leading parts.
    const wm = m[2].trim().match(/^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/);
    if (!wm) return false;
    if (Number(wm[1]) !== version.major) return false;
    if (wm[2] && wm[2] !== "x" && wm[2] !== "*" && Number(wm[2]) !== version.minor) return false;
    if (wm[3] && wm[3] !== "x" && wm[3] !== "*" && Number(wm[3]) !== version.patch) return false;
    return true;
  }
  const cmp = compareSemver(version, target);
  switch (op) {
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    default:
      return cmp === 0;
  }
}

/** Does `version` satisfy `range`? Range may use spaces (AND) and `||` (OR). */
export function satisfies(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const r = String(range ?? "*").trim();
  if (!r || r === "*") return true;

  // OR groups
  return r.split("||").some((group) => {
    const comparators = group.trim().split(/\s+/).filter(Boolean);
    if (comparators.length === 0) return true;
    return comparators.every((c) => satisfiesComparator(v, c));
  });
}

export interface CompatResult {
  ok: boolean;
  reason?: string;
}

/**
 * Check a plugin against the running core. Validates both the semver range and
 * the host ABI version. Returns a precise reason on failure.
 */
export function checkCompatibility(
  coreVersion: string,
  pluginApiVersion: number,
  hostApiVersion: number,
  compatibilityRange: string,
): CompatResult {
  if (pluginApiVersion > hostApiVersion) {
    return {
      ok: false,
      reason: `plugin needs host API v${pluginApiVersion}, this XR provides v${hostApiVersion} (upgrade XR)`,
    };
  }
  if (!satisfies(coreVersion, compatibilityRange)) {
    return {
      ok: false,
      reason: `XR ${coreVersion} is outside the plugin's supported range "${compatibilityRange}"`,
    };
  }
  return { ok: true };
}
