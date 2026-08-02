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
