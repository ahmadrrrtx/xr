/**
 * XR Phase 8 · T1 — OpenAPI generation: deterministic, complete, valid
 * structure, and in lockstep with the committed artifact.
 */

import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApi, serializeOpenApi } from "../../src/daemon/api/openapi.ts";
import { listDaemonRoutes } from "../../src/daemon/routes/index.ts";
import { apiRegistry } from "../../src/daemon/routes/registry.ts";
import { API_CONTRACT } from "../../src/daemon/routes/contract.ts";

function doc(): Record<string, any> {
  return buildOpenApi(apiRegistry(listDaemonRoutes()));
}

test("spec contains every registered operation under /api/v1 paths", () => {
  const ops = apiRegistry(listDaemonRoutes());
  const d = doc();
  const got = new Set<string>();
  for (const [path, methods] of Object.entries<any>(d.paths)) {
    for (const method of Object.keys(methods)) got.add(`${method.toUpperCase()} ${path}`);
  }
  for (const op of ops) {
    if (op.method === "ANY") {
      expect(got.has(`GET ${op.path}`)).toBe(true);
    } else {
      const key = `${op.method.toUpperCase()} ${op.path}`;
      expect(got.has(key)).toBe(true);
    }
  }
});

test("all paths are versioned; operationIds are unique; required fields present", () => {
  const d = doc();
  const ids = new Set<string>();
  for (const [path, methods] of Object.entries<any>(d.paths)) {
    expect(path.startsWith("/api/v1")).toBe(true);
    for (const [method, op] of Object.entries<any>(methods)) {
      expect(op.operationId).toBeTruthy();
      expect(op.summary.length).toBeGreaterThan(8);
      expect(op.tags.length).toBe(1);
      expect(op.responses["200"]).toBeDefined();
      expect(op.responses["400"]).toBeDefined();
      expect(op.security).toBeDefined();
      const id = `${op.operationId}`;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      void method;
    }
  }
});

test("generation is deterministic (byte-identical across runs)", () => {
  const a = serializeOpenApi(doc());
  const b = serializeOpenApi(doc());
  expect(a).toBe(b);
});

test("committed artifact matches the live registry (drift gate equivalent)", () => {
  const committed = join(import.meta.dir, "../../docs/api/openapi.json");
  expect(existsSync(committed)).toBe(true);
  expect(readFileSync(committed, "utf8")).toBe(serializeOpenApi(doc()));
});

test("request validation schemas appear as JSON-Schema request bodies", () => {
  const d = doc();
  const chat = d.paths["/api/v1/chat"].post;
  expect(chat.requestBody.content["application/json"].schema.properties.message.type).toBe("string");
  const approve = d.paths["/api/v1/control/approve"].post;
  expect(approve.requestBody.content["application/json"].schema.required).toContain("id");
});

test("stability levels are declared per operation (experimental ≠ stable)", () => {
  const d = doc();
  const levels = new Set<string>();
  for (const methods of Object.values<any>(d.paths)) {
    for (const op of Object.values<any>(methods)) levels.add(op["x-xr-stability"]);
  }
  expect(levels.has("stable")).toBe(true);
  expect(levels.has("experimental")).toBe(true);
});

test("versioning policy is embedded (contract extension block)", () => {
  const d = doc();
  expect(d["x-xr-contract"].apiVersion).toBe("v1");
  expect(d["x-xr-contract"].legacySunset).toContain("8.0.0");
});

// ── Phase 02 · Task 2.7 — route metadata completeness (anti-drift gate) ──────
//
// These assertions make it fail loudly when a future route is added to the
// serving registry without contract metadata, or when contract metadata
// describes something the router never serves. The route registry is the
// single source of truth: served routes ↔ contract ↔ generated schema.

test("Phase 02: every served route id has contract metadata (no undocumented routes)", () => {
  const missing: string[] = [];
  for (const r of listDaemonRoutes()) {
    if (!API_CONTRACT[r.id]) missing.push(`${r.id} (${r.methodLabel()} ${r.pathLabel()})`);
  }
  expect(missing).toEqual([]);
});

test("Phase 02: every contract entry maps to a route the router actually serves", () => {
  const servedIds = new Set(listDaemonRoutes().map((r) => r.id));
  const orphaned = Object.keys(API_CONTRACT).filter((id) => !servedIds.has(id));
  expect(orphaned).toEqual([]);
});

test("Phase 02: every public API operation carries complete metadata", () => {
  const incomplete: string[] = [];
  for (const op of apiRegistry(listDaemonRoutes())) {
    if (!op.id) incomplete.push(`${op.path}: missing route id`);
    if (!op.method) incomplete.push(`${op.id}: missing method`);
    if (!op.path.startsWith("/api/v1")) incomplete.push(`${op.id}: path not versioned (${op.path})`);
    if (!op.meta.summary || op.meta.summary.length < 8) incomplete.push(`${op.id}: summary too short`);
    if (!op.meta.tag) incomplete.push(`${op.id}: missing tag`);
    if (op.meta.stability !== "stable" && op.meta.stability !== "experimental") {
      incomplete.push(`${op.id}: invalid stability`);
    }
  }
  expect(incomplete).toEqual([]);
});

test("Phase 02: prefix-matched routes declare a template, and every {param} is documented", () => {
  const problems: string[] = [];
  for (const op of apiRegistry(listDaemonRoutes())) {
    const params = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    if (params.length === 0) continue;
    if (!op.meta.template) {
      problems.push(`${op.id}: templated path without meta.template`);
      continue;
    }
    const declared = new Set((op.meta.pathParams ?? []).map((p) => p.name));
    for (const p of params) {
      if (!declared.has(p)) problems.push(`${op.id}: path param {${p}} is not declared in pathParams`);
    }
    for (const d of declared) {
      if (!params.includes(d)) problems.push(`${op.id}: pathParams declares {${d}} which is not in the template`);
    }
  }
  expect(problems).toEqual([]);
});

test("Phase 02: the skills and plugins sub-APIs are represented in the contract", () => {
  for (const id of ["skills.api", "plugins.api"]) {
    const meta = API_CONTRACT[id];
    expect(meta).toBeDefined();
    expect(meta.surface).toBeUndefined(); // public contract, not an HTML surface
    expect(meta.template).toBeTruthy();
    expect(meta.pathParams?.length).toBeGreaterThan(0);
  }
  expect(API_CONTRACT["skills.api"].template).toBe("/api/skills/{path}");
  expect(API_CONTRACT["plugins.api"].template).toBe("/api/plugins/{path}");

  // …and they reach the generated document under the v1 mount.
  const d = doc();
  expect(d.paths["/api/v1/skills/{path}"]).toBeDefined();
  expect(d.paths["/api/v1/plugins/{path}"]).toBeDefined();
});
