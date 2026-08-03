/**
 * XR Phase 8 · T1 — compatibility checker: breaking changes are detected;
 * additive evolution passes. Plus the live spec vs. committed contract.
 */

import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compareContracts } from "../../scripts/api-compat.ts";
import { buildOpenApi } from "../../src/daemon/api/openapi.ts";
import { listDaemonRoutes } from "../../src/daemon/routes/index.ts";
import { apiRegistry } from "../../src/daemon/routes/registry.ts";

function miniDoc(ops: Record<string, any>): Record<string, any> {
  const paths: Record<string, any> = {};
  for (const [key, op] of Object.entries(ops)) {
    const [method, ...rest] = key.split(" ");
    const path = rest.join(" ");
    paths[path] = { [method]: op };
  }
  return { openapi: "3.1.0", paths };
}

function jsonOp(extra: any = {}): any {
  return {
    operationId: "test.op",
    responses: {
      "200": { content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } },
    },
    ...extra,
  };
}

test("BREAKING: removed operation is flagged", () => {
  const oldDoc = miniDoc({ "get /api/v1/a": jsonOp(), "get /api/v1/b": jsonOp() });
  const newDoc = miniDoc({ "get /api/v1/a": jsonOp() });
  const findings = compareContracts(oldDoc, newDoc);
  const breaking = findings.filter((f) => f.level === "breaking");
  expect(breaking.some((f) => f.change === "operation removed")).toBe(true);
});

test("BREAKING: response property removed is flagged", () => {
  const oldDoc = miniDoc({ "get /api/v1/a": jsonOp() });
  const removed = jsonOp();
  removed.responses["200"].content["application/json"].schema.properties = {};
  const newDoc = miniDoc({ "get /api/v1/a": removed });
  const findings = compareContracts(oldDoc, newDoc);
  expect(findings.some((f) => f.level === "breaking" && f.change.includes('"ok" removed'))).toBe(true);
});

test("BREAKING: request property becomes required is flagged", () => {
  const base = jsonOp({
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } },
  });
  const tightened = jsonOp({
    requestBody: { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } } },
  });
  const findings = compareContracts(miniDoc({ "post /api/v1/x": base }), miniDoc({ "post /api/v1/x": tightened }));
  expect(findings.some((f) => f.level === "breaking" && f.change.includes("became required"))).toBe(true);
});

test("BREAKING: property type change is flagged", () => {
  const oldDoc = miniDoc({ "get /api/v1/a": jsonOp() });
  const changed = jsonOp();
  changed.responses["200"].content["application/json"].schema.properties.ok = { type: "string" };
  const findings = compareContracts(oldDoc, miniDoc({ "get /api/v1/a": changed }));
  expect(findings.some((f) => f.level === "breaking" && f.change.includes("type changed"))).toBe(true);
});

test("COMPATIBLE: new operation + new optional field + new response field pass", () => {
  const oldDoc = miniDoc({ "get /api/v1/a": jsonOp() });
  const added = jsonOp();
  added.responses["200"].content["application/json"].schema.properties.newField = { type: "string" };
  const newDoc = miniDoc({
    "get /api/v1/a": added,
    "get /api/v1/b": jsonOp(),
  });
  const findings = compareContracts(oldDoc, newDoc);
  expect(findings.every((f) => f.level === "compatible")).toBe(true);
  expect(findings.some((f) => f.change === "operation added")).toBe(true);
});

test("LIVE: committed contract produces zero breaking changes against the registry", () => {
  const committed = JSON.parse(
    readFileSync(join(import.meta.dir, "../../docs/api/openapi.json"), "utf8"),
  ) as Record<string, any>;
  const live = buildOpenApi(apiRegistry(listDaemonRoutes()));
  const findings = compareContracts(committed, live);
  const breaking = findings.filter((f) => f.level === "breaking");
  expect(breaking).toEqual([]);
});
