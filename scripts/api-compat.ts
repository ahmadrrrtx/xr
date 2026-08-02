#!/usr/bin/env bun
/**
 * XR Phase 8 · T1 — API compatibility checker (breaking-change detection).
 *
 *   bun run scripts/api-compat.ts [--base <old.json>] [--candidate <new.json>]
 *
 * Defaults: --base docs/api/openapi.json (committed contract), candidate =
 * freshly generated from the live registry. Exits 1 on BREAKING changes
 * (Art. XVIII: breaking changes require a deprecation cycle; silent breaks
 * are defects). Compatible (additive) evolution passes with a report.
 *
 * Classification:
 *   BREAKING  operation removed · request property removed · request
 *             property becomes required · property type narrowed/changed ·
 *             response property removed · response property type changed ·
 *             (on the stable envelope — loose-object properties are exempt
 *             until individually declared stable)
 *   COMPATIBLE operation added · optional request field added · response
 *             property added · stability upgraded experimental → stable
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildOpenApi, serializeOpenApi } from "../src/daemon/api/openapi.ts";
import { listDaemonRoutes } from "../src/daemon/routes/index.ts";
import { apiRegistry } from "../src/daemon/routes/registry.ts";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export interface SchemaNode {
  type?: string;
  properties?: Record<string, SchemaNode>;
  required?: string[];
  items?: SchemaNode;
  enum?: unknown[];
  anyOf?: SchemaNode[];
  additionalProperties?: boolean | SchemaNode;
}

interface OperationSnapshot {
  operationId: string;
  requestProperties: Record<string, SchemaNode>;
  requestRequired: Set<string>;
  responseProperties: Record<string, SchemaNode>;
}

export interface CompatFinding {
  level: "breaking" | "compatible";
  operation: string;
  change: string;
}

function schemaOf(op: unknown, kind: "request" | "response"): SchemaNode {
  const o = op as Record<string, unknown>;
  const holder = kind === "request"
    ? (o.requestBody as Record<string, unknown> | undefined)
    : (o.responses as Record<string, unknown> | undefined)?.["200"];
  const content = ((holder as Record<string, unknown> | undefined)?.content ?? {}) as Record<string, unknown>;
  const media = (content["application/json"] ?? content["text/event-stream"]) as Record<string, unknown> | undefined;
  return ((media?.schema ?? {}) as SchemaNode);
}

function typeOf(node: SchemaNode | undefined): string {
  if (!node) return "any";
  if (node.type) return Array.isArray(node.type) ? [...node.type].sort().join("|") : node.type;
  if (node.anyOf) return node.anyOf.map(typeOf).sort().join("|");
  if (node.enum) return "enum";
  if (node.properties) return "object";
  if (node.items) return "array";
  return "any";
}

function snapshot(doc: Record<string, unknown>): Map<string, OperationSnapshot> {
  const out = new Map<string, OperationSnapshot>();
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const o = op as Record<string, unknown>;
      const key = `${method.toUpperCase()} ${path}`;
      const req = schemaOf(o, "request");
      const res = schemaOf(o, "response");
      out.set(key, {
        operationId: (o.operationId as string) ?? key,
        requestProperties: req.properties ?? {},
        requestRequired: new Set(req.required ?? []),
        responseProperties: res.properties ?? {},
      });
    }
  }
  return out;
}

export function compareContracts(oldDoc: Record<string, unknown>, newDoc: Record<string, unknown>): CompatFinding[] {
  const findings: CompatFinding[] = [];
  const before = snapshot(oldDoc);
  const after = snapshot(newDoc);

  for (const [key, oldOp] of before) {
    const newOp = after.get(key);
    if (!newOp) {
      findings.push({ level: "breaking", operation: key, change: "operation removed" });
      continue;
    }
    // Request: removed property / narrowed type / newly-required are breaking.
    for (const [prop, oldNode] of Object.entries(oldOp.requestProperties)) {
      const newNode = newOp.requestProperties[prop];
      if (newNode === undefined && Object.keys(oldOp.requestProperties).length > 0 && !loose(oldOp.requestProperties)) {
        findings.push({ level: "breaking", operation: key, change: `request property "${prop}" removed` });
      } else if (newNode && !typeCompatible(typeOf(oldNode), typeOf(newNode))) {
        findings.push({ level: "breaking", operation: key, change: `request property "${prop}" type changed ${typeOf(oldNode)} → ${typeOf(newNode)}` });
      }
      if (newNode && !oldOp.requestRequired.has(prop) && newOp.requestRequired.has(prop)) {
        findings.push({ level: "breaking", operation: key, change: `request property "${prop}" became required` });
      }
    }
    // Response: removed property / changed declared type are breaking.
    for (const [prop, oldNode] of Object.entries(oldOp.responseProperties)) {
      const newNode = newOp.responseProperties[prop];
      if (newNode === undefined) {
        findings.push({ level: "breaking", operation: key, change: `response property "${prop}" removed` });
      } else if (!typeCompatible(typeOf(oldNode), typeOf(newNode))) {
        findings.push({ level: "breaking", operation: key, change: `response property "${prop}" type changed ${typeOf(oldNode)} → ${typeOf(newNode)}` });
      }
    }
    // Compatible additions (reported, not blocking).
    for (const prop of Object.keys(newOp.requestProperties)) {
      if (!(prop in oldOp.requestProperties)) {
        findings.push({ level: newOp.requestRequired.has(prop) ? "breaking" : "compatible", operation: key, change: `request property "${prop}" added` });
      }
    }
    for (const prop of Object.keys(newOp.responseProperties)) {
      if (!(prop in oldOp.responseProperties)) {
        findings.push({ level: "compatible", operation: key, change: `response property "${prop}" added` });
      }
    }
  }

  for (const [key] of after) {
    if (!before.has(key)) findings.push({ level: "compatible", operation: key, change: "operation added" });
  }
  return findings;
}

/** A loose object (additionalProperties !== false and no declared props) has no per-prop contract yet. */
function loose(props: Record<string, SchemaNode>): boolean {
  return Object.keys(props).length === 0;
}

function typeCompatible(before: string, after: string): boolean {
  if (before === after) return true;
  // unknown/any→anything is always compatible (declaring more detail is additive).
  if (before === "any") return true;
  // Widening a union is compatible; narrowing is not.
  const b = new Set(before.split("|"));
  const a = new Set(after.split("|"));
  return [...b].every((t) => a.has(t));
}

async function main(): Promise<void> {
  const basePath = opt("--base") ?? join(ROOT, "docs/api/openapi.json");
  if (!existsSync(basePath)) {
    console.error(`[api-compat] FAIL — base contract not found: ${basePath}`);
    process.exit(1);
  }
  const oldDoc = JSON.parse(readFileSync(basePath, "utf8")) as Record<string, unknown>;
  const candidateArg = opt("--candidate");
  const newDoc = candidateArg
    ? (JSON.parse(readFileSync(candidateArg, "utf8")) as Record<string, unknown>)
    : buildOpenApi(apiRegistry(listDaemonRoutes()));
  void serializeOpenApi;

  const findings = compareContracts(oldDoc, newDoc);
  const breaking = findings.filter((f) => f.level === "breaking");
  const compatible = findings.filter((f) => f.level === "compatible");

  for (const f of compatible) console.log(`[api-compat] compatible  ${f.operation} — ${f.change}`);
  for (const f of breaking) console.error(`[api-compat] BREAKING    ${f.operation} — ${f.change}`);

  if (breaking.length > 0) {
    console.error(
      `[api-compat] FAIL — ${breaking.length} breaking change(s) detected.\n` +
        `  Breaking changes follow the deprecation cycle (docs/api/COMPATIBILITY.md):\n` +
        `  keep the old shape behind a deprecation window, or bump the major API version.`,
    );
    process.exit(1);
  }
  console.log(`[api-compat] OK — no breaking changes (${compatible.length} compatible change(s), ${afterSize(newDoc)} operations)`);
}

function afterSize(doc: Record<string, unknown>): number {
  return snapshot(doc).size;
}

if (import.meta.main) {
  await main();
}
