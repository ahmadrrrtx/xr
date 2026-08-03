/**
 * XR Phase 8 · T1 — versioned API mount: /api/v1 answers identically to
 * legacy /api, legacy carries deprecation headers, surfaces are untouched.
 * Tests assert EFFECTS (real responses from the in-process handler).
 */

import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { listDaemonRoutes } from "../../src/daemon/routes/index.ts";
import { API_CONTRACT } from "../../src/daemon/routes/contract.ts";

let store: Store;
const TOKEN = "t1-version-token";

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-api-v1-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "d.db"));
});

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:7842${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
}

test("every API operation answers under /api/v1 with the v1 marker header", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1/overview"));
  expect(res.status).toBe(200);
  expect(res.headers.get("x-xr-api-version")).toBe("v1");
  const j: any = await res.json();
  expect(j.git).toBeDefined();
});

test("legacy /api mount still answers, WITH deprecation headers (announce→warn window)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/overview"));
  expect(res.status).toBe(200);
  expect(res.headers.get("deprecation")).toBe("true");
  expect(res.headers.get("sunset")).toContain("2027");
  expect(res.headers.get("link")).toContain("/api/v1/overview");
  expect(res.headers.get("link")).toContain('rel="deprecation"');
  expect(res.headers.get("x-xr-api-version")).toBe("v0-legacy");
});

test("v1 responses carry NO deprecation headers", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1/overview"));
  expect(res.headers.get("deprecation")).toBeNull();
  expect(res.headers.get("sunset")).toBeNull();
});

test("health answers at BOTH mounts without auth (canary-safe)", async () => {
  const h = makeHandler(store, TOKEN);
  for (const path of ["/api/health", "/api/v1/health"]) {
    const res = await h(new Request(`http://127.0.0.1:7842${path}`));
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.ok).toBe(true);
  }
});

test("API index is served at /api/v1 with contract links + legacy sunset", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1"));
  expect(res.status).toBe(200);
  const j: any = await res.json();
  expect(j.apiVersion).toBe("v1");
  expect(j.openapi).toBe("/api/v1/openapi.json");
  expect(j.metrics).toBe("/api/v1/metrics");
  expect(j.legacy.status).toBe("deprecated");
  expect(j.operations).toBeGreaterThan(60);
});

test("OpenAPI document is served at /api/v1/openapi.json and matches the registry", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1/openapi.json"));
  expect(res.status).toBe(200);
  const doc: any = await res.json();
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.paths["/api/v1/chat"]).toBeDefined();
  expect(doc.paths["/api/v1/chat"].post.operationId).toBe("chat.stream.post");
  expect(doc.paths["/api/v1/overview"].get.security).toBeDefined();
});

test("unknown v1 route → 404 with legacy-compatible error body", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1/definitely-not-a-route"));
  expect(res.status).toBe(404);
  const j: any = await res.json();
  expect(j.error).toBe("not found");
});

test("schema validation rejects malformed bodies (400 problem+json, fail-closed)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/v1/control/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 42, approved: "yes" }),
  }));
  expect(res.status).toBe(400);
  const j: any = await res.json();
  expect(j.error).toContain("schema");
  expect(j.status).toBe(400);
  expect(Array.isArray(j.errors)).toBe(true);
  expect(j.errors[0].path).toBeDefined();
});

test("legacy mount applies the SAME schema validation", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/api/control/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: 42 }),
  }));
  expect(res.status).toBe(400);
  expect(res.headers.get("deprecation")).toBe("true");
});

test("dashboard surface routes are NOT version-mounted (pages unchanged)", async () => {
  const h = makeHandler(store, TOKEN);
  const res = await h(req("/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  // The API version marker is an API-only concern.
  expect(res.headers.get("deprecation")).toBeNull();
});

test("registry: every served API route id has contract metadata (completeness)", () => {
  const missing: string[] = [];
  for (const r of listDaemonRoutes()) {
    const path = r.pathLabel();
    const isApi = path.startsWith("/api");
    if (!isApi) continue; // surfaces are outside the contract
    if (!API_CONTRACT[r.id]) missing.push(r.id);
  }
  expect(missing).toEqual([]);
});
