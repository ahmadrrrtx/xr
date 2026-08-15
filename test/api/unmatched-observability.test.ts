/**
 * XR Phase 02 — unmatched-route observability (Task 2.15).
 *
 * The skills/plugins 404s went unnoticed because a 404 from the router was
 * indistinguishable from a 404 from a handler: nothing counted "the daemon was
 * asked for a route it does not serve". This suite verifies the new
 * `xr_http_unmatched_routes_total` counter fires on real unmatched requests,
 * AND that its labels stay bounded and privacy-safe — a raw-URL label would let
 * any unauthenticated caller mint unbounded series or smuggle secrets into
 * telemetry.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { unmatchedCategory } from "../../src/daemon/routes/index.ts";
import { xrMetrics, renderPrometheus } from "../../src/observability/metrics.ts";

const TOKEN = "phase02-unmatched-token";
const METRIC = "xr_http_unmatched_routes_total";

let handler: (req: Request) => Promise<Response> | Response;

beforeAll(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-phase02-unmatched-"));
  process.env.XR_HOME = join(tmp, "home");
  handler = makeHandler(new Store(join(tmp, "d.db")), TOKEN);
});

afterAll(() => {
  delete process.env.XR_HOME;
});

const call = (path: string, method = "GET") =>
  Promise.resolve(
    handler(new Request(`http://127.0.0.1/${path.replace(/^\//, "")}`, { method, headers: { authorization: `Bearer ${TOKEN}` } })),
  );

/** Total across all label sets of the unmatched counter. */
function unmatchedTotal(): number {
  return xrMetrics.httpUnmatchedRoutes.snapshot().reduce((sum, s) => sum + s.value, 0);
}

function seriesFor(category: string): number {
  return xrMetrics.httpUnmatchedRoutes
    .snapshot()
    .filter((s) => s.labels.category === category)
    .reduce((sum, s) => sum + s.value, 0);
}

describe("unmatched-route counter", () => {
  test("an unmatched API request increments the counter", async () => {
    const before = unmatchedTotal();
    const res = await call("/api/v1/no-such-namespace");
    expect(res.status).toBe(404);
    expect(unmatchedTotal()).toBe(before + 1);
  });

  test("a MATCHED request does not increment it", async () => {
    const before = unmatchedTotal();
    const res = await call("/api/v1/skills");
    expect(res.status).toBe(200);
    expect(unmatchedTotal()).toBe(before);
  });

  test("a handler-level 404 (known namespace, unknown sub-path) is not counted as unmatched", async () => {
    // The route MATCHED; the sub-API answered 404. Conflating the two is what
    // hid the Phase 02 bug in the first place — they must stay distinct.
    const before = unmatchedTotal();
    const res = await call("/api/v1/skills/nope/nope");
    expect(res.status).toBe(404);
    expect(unmatchedTotal()).toBe(before);
  });

  test("unmatched requests on the legacy mount are counted too, labelled by mount", async () => {
    const before = unmatchedTotal();
    await call("/api/definitely-not-a-route");
    expect(unmatchedTotal()).toBe(before + 1);
    const mounts = new Set(xrMetrics.httpUnmatchedRoutes.snapshot().map((s) => s.labels.mount));
    expect([...mounts].every((m) => m === "v1" || m === "legacy")).toBe(true);
  });

  test("non-API surface misses (e.g. favicon) are NOT counted as API route misses", async () => {
    const before = unmatchedTotal();
    await call("/favicon.ico");
    await call("/some/random/page");
    expect(unmatchedTotal()).toBe(before);
  });
});

describe("label cardinality is bounded by construction", () => {
  test("unmatchedCategory folds unknown namespaces into a fixed set", () => {
    expect(unmatchedCategory("/api/skills/whatever/deep/path")).toBe("skills");
    expect(unmatchedCategory("/api/plugins/x")).toBe("plugins");
    expect(unmatchedCategory("/api")).toBe("root");
    expect(unmatchedCategory("/api/")).toBe("root");
    expect(unmatchedCategory("/not-an-api-path")).toBe("other");
    expect(unmatchedCategory("/api/totally-made-up")).toBe("other");
  });

  test("attacker-controlled paths cannot mint unbounded series", async () => {
    const beforeSeries = xrMetrics.httpUnmatchedRoutes.snapshot().length;
    for (let i = 0; i < 60; i++) await call(`/api/v1/attacker-namespace-${i}`);
    const after = xrMetrics.httpUnmatchedRoutes.snapshot();
    // 60 distinct URLs must collapse into the single "other" category.
    expect(after.length).toBeLessThanOrEqual(beforeSeries + 2);
    expect(seriesFor("other")).toBeGreaterThanOrEqual(60);
  });

  test("category is never the raw path, even for a known namespace", async () => {
    await call("/api/v1/skills");
    for (const s of xrMetrics.httpUnmatchedRoutes.snapshot()) {
      expect(String(s.labels.category)).not.toContain("/");
      expect(String(s.labels.category)).not.toContain("?");
    }
  });
});

describe("no secret or high-cardinality leakage into telemetry", () => {
  test("query strings, tokens and headers never reach the labels", async () => {
    await call("/api/v1/leaky-route?token=SUPER_SECRET&password=hunter2#frag");
    const rendered = renderPrometheus();
    const lines = rendered.split("\n").filter((l) => l.startsWith(METRIC));
    expect(lines.length).toBeGreaterThan(0);
    const blob = lines.join("\n");
    for (const secret of ["SUPER_SECRET", "hunter2", "token=", "password", TOKEN, "Bearer", "authorization"]) {
      expect(blob).not.toContain(secret);
    }
    expect(blob).not.toContain("leaky-route");
  });

  test("the counter is registered with only the expected label keys", () => {
    const keys = new Set<string>();
    for (const s of xrMetrics.httpUnmatchedRoutes.snapshot()) for (const k of Object.keys(s.labels)) keys.add(k);
    expect([...keys].sort()).toEqual(["category", "method", "mount"]);
  });

  test("the metric is exposed with help text in the Prometheus rendering", () => {
    const rendered = renderPrometheus();
    expect(rendered).toContain(`# TYPE ${METRIC} counter`);
    expect(rendered).toContain(`# HELP ${METRIC}`);
  });
});
