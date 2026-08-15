/**
 * XR Phase 02 — dashboard ↔ route-registry coverage (Task 2.12).
 *
 * The dashboard is the primary API consumer, and it is served as a template
 * literal rather than compiled code, so a typo or a renamed endpoint cannot be
 * caught by `tsc`. This suite parses the ACTUAL served client script, extracts
 * every `api("/api/...")` call site, applies the same `v1()` rewrite the client
 * applies at runtime, and asserts the router really serves that path+method.
 *
 * A failure here means the dashboard would 404 in the browser — which is
 * exactly the class of defect Phase 02 exists to eliminate.
 */

import { describe, expect, test } from "bun:test";
import { DASHBOARD_SCRIPT } from "../../src/daemon/dashboard/client-script.ts";
import { listDaemonRoutes, matchRouteId } from "../../src/daemon/routes/index.ts";

interface CallSite {
  raw: string;
  path: string;
  method: string;
}

/**
 * Extract `api(<path expr>, { method: "X" })` call sites.
 *
 * Dynamic segments (`+ encodeURIComponent(id) +`, `+ action`) are substituted
 * with a placeholder token, which is what a real request would put there.
 */
function extractCallSites(script: string): CallSite[] {
  const re =
    /api\(\s*"(\/api\/[^"]*)"((?:\s*\+\s*(?:encodeURIComponent\([^)]*\)|"[^"]*"|[A-Za-z_$][\w$.]*))*)\s*(?:,\s*\{([^}]*)\})?/g;
  const seen = new Map<string, CallSite>();

  for (const m of script.matchAll(re)) {
    let path = m[1];
    for (const t of (m[2] ?? "").matchAll(/\+\s*(encodeURIComponent\([^)]*\)|"([^"]*)"|[A-Za-z_$][\w$.]*)/g)) {
      // A literal string concat is kept verbatim; an expression becomes a value.
      path += t[2] !== undefined ? t[2] : "sample-id";
    }
    const method = (m[3]?.match(/method\s*:\s*"([A-Z]+)"/)?.[1] ?? "GET").toUpperCase();
    const raw = path;
    path = path.split("?")[0]; // query strings are not part of route matching
    const key = `${method} ${path}`;
    if (!seen.has(key)) seen.set(key, { raw, path, method });
  }
  return [...seen.values()].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/** The exact rewrite `client-core.ts` performs before every fetch. */
function v1(path: string): string {
  return path.startsWith("/api/") && !path.startsWith("/api/v1") ? "/api/v1" + path.slice("/api".length) : path;
}

/** What the router canonicalizes a versioned path back to (`resolveMount`). */
function canonical(path: string): string {
  return path.startsWith("/api/v1") ? "/api" + path.slice("/api/v1".length) : path;
}

/**
 * PRE-EXISTING dashboard call sites with no daemon route — documented, frozen.
 *
 * These were already dead before Phase 02 (verified against the Phase 00
 * baseline commit) and are NOT caused by canonical path propagation. MCP is
 * CLI-only (`src/commands/mcp.ts`); no `/api/mcp*` route has ever existed, and
 * `/api/control/stop` is not part of `control.routes.ts`. Every one of these
 * call sites is wrapped in `try/catch` in the client, so the panels degrade
 * gracefully rather than breaking the dashboard.
 *
 * Wiring up new endpoints is out of Phase 02 scope (no new API surface). This
 * list is a QUARANTINE, not a licence: the test below asserts it never grows,
 * so any newly-broken dashboard call fails the build.
 */
const KNOWN_UNROUTED = new Set(["GET /api/mcp", "POST /api/mcp/add", "POST /api/control/stop"]);

const CALL_SITES = extractCallSites(DASHBOARD_SCRIPT);

describe("dashboard route coverage", () => {
  test("the parser actually found the dashboard's call sites", () => {
    // Guards against the extraction silently breaking and the suite passing vacuously.
    expect(CALL_SITES.length).toBeGreaterThan(40);
    const paths = CALL_SITES.map((c) => c.path);
    expect(paths).toContain("/api/overview");
    expect(paths).toContain("/api/skills/marketplace");
    expect(paths).toContain("/api/plugins");
  });

  test("every dashboard call site resolves to a served route (no dashboard 404s)", () => {
    const routes = listDaemonRoutes();
    const unmatched: string[] = [];

    for (const site of CALL_SITES) {
      // Simulate the real request the browser makes: v1() rewrite, then the
      // daemon's mount canonicalization, then route matching.
      const requested = v1(site.path);
      const id = matchRouteId(canonical(requested), site.method, routes);
      if (id === "unmatched" && !KNOWN_UNROUTED.has(`${site.method} ${site.path}`)) {
        unmatched.push(`${site.method} ${requested} (source: ${site.raw})`);
      }
    }

    expect(unmatched).toEqual([]);
  });

  test("the pre-existing unrouted allowlist never grows, and every entry is still real", () => {
    const routes = listDaemonRoutes();
    const stale: string[] = [];
    for (const key of KNOWN_UNROUTED) {
      const [method, path] = key.split(" ");
      // If someone wires up the endpoint later, the allowlist entry must be deleted.
      if (matchRouteId(canonical(path), method, routes) !== "unmatched") stale.push(key);
    }
    expect(stale).toEqual([]);
    expect(KNOWN_UNROUTED.size).toBe(3);
  });

  test("every dashboard call site ALSO works on the legacy mount (compat safety net)", () => {
    const routes = listDaemonRoutes();
    const unmatched = CALL_SITES.map((s) => ({ s, key: `${s.method} ${s.path}` }))
      .filter(({ s, key }) => matchRouteId(canonical(s.path), s.method, routes) === "unmatched" && !KNOWN_UNROUTED.has(key))
      .map(({ key }) => key);
    expect(unmatched).toEqual([]);
  });

  test("the dashboard only calls /api paths (no absolute or cross-origin URLs)", () => {
    const foreign = [...DASHBOARD_SCRIPT.matchAll(/api\(\s*"([^"]*)"/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith("/api/"));
    expect(foreign).toEqual([]);
  });

  test("the client's v1() rewrite is idempotent and never double-prefixes", () => {
    for (const site of CALL_SITES) {
      const once = v1(site.path);
      expect(once.startsWith("/api/v1/")).toBe(true);
      expect(v1(once)).toBe(once);
      expect(once).not.toContain("/api/v1/v1");
      expect(canonical(once)).toBe(site.path);
    }
  });

  test("skills and plugins call sites specifically resolve under the v1 mount", () => {
    const routes = listDaemonRoutes();
    const extension = CALL_SITES.filter((s) => /^\/api\/(skills|plugins)\b/.test(s.path));
    // These are the endpoints that were 404ing before Phase 02.
    expect(extension.length).toBeGreaterThan(5);
    for (const site of extension) {
      const id = matchRouteId(canonical(v1(site.path)), site.method, routes);
      expect(id).not.toBe("unmatched");
      expect(id.startsWith("skills.") || id.startsWith("plugins.")).toBe(true);
    }
  });
});
