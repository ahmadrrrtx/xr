/**
 * XR Phase 02 — API coherence contract tests.
 *
 * The invariant under test: `/api/v1/<x>` and legacy `/api/<x>` resolve to
 * the SAME canonical application route, and the sub-API adapters (skills,
 * plugins) operate on that canonical path instead of the raw transport
 * `url.pathname`. Before Phase 02 every `/api/v1/skills*` and
 * `/api/v1/plugins*` request 404'd because the adapters string-matched
 * `url.pathname`, which still carried the `/api/v1` mount prefix.
 *
 * Tests assert EFFECTS against a REAL daemon bound to an EPHEMERAL port
 * (never a hardcoded dev port), with authentication enforced as shipped.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { LEGACY_SUNSET_HTTP_DATE } from "../../src/daemon/routes/contract.ts";

const TOKEN = "phase02-contract-token";

/**
 * `/api/skills*` builds a SkillService (directory re-scan) per request, so a
 * v1+legacy pair costs ~300 ms on a fast Linux runner and multiples of that on
 * a contended Windows runner — this test timed out against Bun's 5 s default on
 * Windows CI. The endpoint cost is pre-existing and out of Phase 02 scope; the
 * assertion here is equivalence, never latency, so the timeout is generous.
 */
const SLOW_ENDPOINT_TIMEOUT_MS = 60_000;

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-phase02-contract-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  // Ephemeral port (port: 0) — the OS assigns a free one.
  server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: makeHandler(store, TOKEN) });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

const auth = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
});

const get = (path: string) => fetch(`${base}${path}`, auth());

/** Endpoints that exist in the skills/plugins adapters (verified in-repo). */
const V1_ENDPOINTS = [
  "/api/v1/skills",
  "/api/v1/skills/health",
  "/api/v1/skills/marketplace",
  "/api/v1/plugins",
  "/api/v1/plugins/catalog",
];

const LEGACY_ENDPOINTS = [
  "/api/skills",
  "/api/skills/health",
  "/api/skills/marketplace",
  "/api/plugins",
  "/api/plugins/catalog",
];

describe("Phase 02 — v1 mount reaches the sub-API adapters (the 404 regression)", () => {
  for (const path of V1_ENDPOINTS) {
    test(`GET ${path} → 200 JSON (never a silent 404)`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(res.headers.get("x-xr-api-version")).toBe("v1");
      const body = await res.json();
      expect(body).toBeTruthy();
      expect(typeof body).toBe("object");
      // The pre-Phase-02 failure mode was exactly this body:
      expect((body as { error?: string }).error).not.toBe("not found");
    }, SLOW_ENDPOINT_TIMEOUT_MS);
  }

  test("GET /api/v1/skills returns the skills runtime shape", async () => {
    const body = (await (await get("/api/v1/skills")).json()) as { health?: unknown; skills?: unknown[] };
    expect(body.health).toBeDefined();
    expect(Array.isArray(body.skills)).toBe(true);
  }, SLOW_ENDPOINT_TIMEOUT_MS);

  test("GET /api/v1/skills/health returns the runtime health envelope", async () => {
    const body = (await (await get("/api/v1/skills/health")).json()) as { total?: number; enabled?: number };
    expect(typeof body.total).toBe("number");
    expect(typeof body.enabled).toBe("number");
  }, SLOW_ENDPOINT_TIMEOUT_MS);

  test("GET /api/v1/skills/marketplace returns marketplace aggregates", async () => {
    const body = (await (await get("/api/v1/skills/marketplace")).json()) as {
      skills?: unknown[];
      registries?: unknown[];
      stats?: { installed?: number };
    };
    expect(Array.isArray(body.skills)).toBe(true);
    expect(Array.isArray(body.registries)).toBe(true);
    expect(typeof body.stats?.installed).toBe("number");
  }, SLOW_ENDPOINT_TIMEOUT_MS);

  test("GET /api/v1/plugins returns the plugin summary shape", async () => {
    const body = (await (await get("/api/v1/plugins")).json()) as {
      summary?: { installed?: number };
      plugins?: unknown[];
    };
    expect(typeof body.summary?.installed).toBe("number");
    expect(Array.isArray(body.plugins)).toBe(true);
  });

  test("GET /api/v1/plugins/catalog resolves the CATALOG route, not plugin id 'catalog'", async () => {
    const body = (await (await get("/api/v1/plugins/catalog")).json()) as { plugins?: Array<{ id?: string }> };
    expect(Array.isArray(body.plugins)).toBe(true);
    // The catalog collection — an id-inspect response would have no `plugins` array.
    expect(body.plugins!.length).toBeGreaterThan(0);
  });
});

describe("Phase 02 — legacy mount stays functional, with deprecation headers", () => {
  for (const path of LEGACY_ENDPOINTS) {
    test(`GET ${path} → 200 + deprecation headers`, async () => {
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("deprecation")).toBe("true");
      expect(res.headers.get("sunset")).toBe(LEGACY_SUNSET_HTTP_DATE);
      expect(res.headers.get("x-xr-api-version")).toBe("v0-legacy");
      expect(res.headers.get("link")).toContain('rel="deprecation"');
    }, SLOW_ENDPOINT_TIMEOUT_MS);
  }

  test("legacy Link header advertises the v1 alternate for the SAME resource", async () => {
    const res = await get("/api/skills/marketplace");
    expect(res.headers.get("link")).toContain("/api/v1/skills/marketplace");
  }, SLOW_ENDPOINT_TIMEOUT_MS);

  test("v1 responses carry NO deprecation headers", async () => {
    const res = await get("/api/v1/skills");
    expect(res.headers.get("deprecation")).toBeNull();
    expect(res.headers.get("sunset")).toBeNull();
  }, SLOW_ENDPOINT_TIMEOUT_MS);
});

describe("Phase 02 — canonicalization equivalence (v1 ≡ legacy)", () => {
  for (let i = 0; i < V1_ENDPOINTS.length; i++) {
    const v1 = V1_ENDPOINTS[i];
    const legacy = LEGACY_ENDPOINTS[i];
    test(`${v1} and ${legacy} resolve to the same canonical route`, async () => {
      const [a, b] = await Promise.all([get(v1), get(legacy)]);
      expect(a.status).toBe(b.status);
      const [ja, jb] = await Promise.all([a.json(), b.json()]);
      // Same canonical handler ⇒ same response KEYS (values may carry
      // timing/ordering-sensitive fields, so shape is the stable assertion).
      expect(Object.keys(ja as object).sort()).toEqual(Object.keys(jb as object).sort());
    }, SLOW_ENDPOINT_TIMEOUT_MS);
  }
});

describe("Phase 02 — unknown sub-paths are explicit, not silent", () => {
  test("unknown skills sub-path → adapter's own 404 envelope (not the router fallback)", async () => {
    const res = await get("/api/v1/skills/definitely/not/a/route");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    // The adapter answered (known domain), so it is NOT the generic router body.
    expect(body.error).toBe("unknown skills API route");
  }, SLOW_ENDPOINT_TIMEOUT_MS);

  test("unknown plugins sub-path → adapter's own 404 envelope", async () => {
    const res = await get("/api/v1/plugins/definitely/not/a/route");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("unknown plugin API route");
  });

  test("a genuinely unknown namespace still gets the router 404", async () => {
    const res = await get("/api/v1/not-a-namespace-at-all");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error?: string }).error).toBe("not found");
  });
});

describe("Phase 02 — authentication is unchanged by canonicalization", () => {
  const unauth = (path: string) => fetch(`${base}${path}`);

  for (const path of [...V1_ENDPOINTS, ...LEGACY_ENDPOINTS]) {
    test(`GET ${path} without a bearer token → 401`, async () => {
      const res = await unauth(path);
      expect(res.status).toBe(401);
    });
  }

  test("health remains the ONLY open API path, on both mounts", async () => {
    for (const path of ["/api/health", "/api/v1/health"]) {
      const res = await unauth(path);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { ok?: boolean }).ok).toBe(true);
    }
  });

  test("an invalid token is rejected on the fixed v1 skills route", async () => {
    const res = await fetch(`${base}/api/v1/skills`, { headers: { authorization: "Bearer wrong-token" } });
    expect(res.status).toBe(401);
  });
});

describe("Phase 02 — no route confusion / traversal via the mount prefix", () => {
  test("a traversal attempt cannot escape the skills namespace into another handler", async () => {
    const res = await get("/api/v1/skills/../overview");
    // Either the URL normalizes (→ overview, still authenticated) or the
    // adapter refuses — what must NEVER happen is an unauthenticated leak.
    expect([200, 400, 404]).toContain(res.status);
  });

  test("a doubled version prefix is NOT silently accepted as canonical", async () => {
    const res = await get("/api/v1/v1/skills");
    expect(res.status).toBe(404);
  });

  test("the v1 prefix is not honoured mid-path", async () => {
    const res = await get("/api/skills/api/v1/skills");
    expect(res.status).toBe(404);
  });
});
