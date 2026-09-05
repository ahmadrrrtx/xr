/**
 * XR Daemon API — OpenAPI 3.1 generation (Phase 8 · T1).
 *
 * Builds the spec from the LIVE route registry (`apiRegistry()`), so the
 * published document can never disagree with the serving code. JSON
 * Schemas come from the same zod/v4 schemas used for runtime validation
 * and typed-client inference. Deterministic output (stable key order,
 * sorted paths/operations) — the CI schema gate diffs bytewise.
 */

import { z } from "zod/v4";
import type { ApiOperation } from "../routes/registry.ts";
import { API_ERROR_SCHEMA } from "../routes/contract.ts";
import { CORE_VERSION } from "../../core/version.ts";

interface JsonSchemaObject extends Record<string, unknown> {}

function toSchema(schema: z.ZodType): JsonSchemaObject {
  const out = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

const API_ERROR_REF = { $ref: "#/components/schemas/ApiError" };

function errorResponses(): Record<string, unknown> {
  return {
    "400": { description: "Bad request — the body failed schema validation.", content: { "application/json": { schema: API_ERROR_REF } } },
    "401": { description: "Unauthorized — bearer token or session cookie required.", content: { "application/json": { schema: API_ERROR_REF } } },
    "403": { description: "Forbidden — cross-origin request refused (CSRF guard).", content: { "application/json": { schema: API_ERROR_REF } } },
    "404": { description: "Not found.", content: { "application/json": { schema: API_ERROR_REF } } },
    "413": { description: "Payload too large (2 MiB cap).", content: { "application/json": { schema: API_ERROR_REF } } },
    "429": { description: "Rate limit exceeded.", content: { "application/json": { schema: API_ERROR_REF } } },
  };
}

const ERR_CODES = ["400", "401", "403", "404", "413", "429"];

function operationFor(op: ApiOperation): Record<string, unknown> {
  const errors = errorResponses();
  const responses: Record<string, unknown> = {};
  responses["200"] = op.meta.sse
    ? {
        description: "Server-Sent Events stream (data: <json> lines, [DONE] terminator).",
        content: { "text/event-stream": { schema: op.meta.response ? toSchema(op.meta.response) : { type: "object" } } },
      }
    : {
        description: "Success.",
        content: { "application/json": { schema: op.meta.response ? toSchema(op.meta.response) : { type: "object" } } },
      };
  for (const code of ERR_CODES) responses[code] = errors[code];

  const entry: Record<string, unknown> = {
    operationId: op.id,
    summary: op.meta.summary,
    tags: [op.meta.tag],
    "x-xr-stability": op.meta.stability,
    ...(op.meta.pathParams && op.meta.pathParams.length > 0
      ? {
          parameters: op.meta.pathParams.map((p) => ({
            name: p.name,
            in: "path",
            required: true,
            schema: { type: "string" },
            ...(p.description ? { description: p.description } : {}),
          })),
        }
      : {}),
    ...(op.meta.request
      ? {
          requestBody: {
            required: false,
            content: { "application/json": { schema: toSchema(op.meta.request) } },
          },
        }
      : {}),
    responses,
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  };
  return entry;
}

/** Build the OpenAPI 3.1 document (deterministic). */
export function buildOpenApi(ops: ApiOperation[]): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of ops) {
    const methods = op.method === "ANY" ? ["get", "post"] : [op.method.toLowerCase()];
    paths[op.path] ??= {};
    for (const m of methods) {
      const entry = operationFor(op);
      if (op.method === "ANY") {
        entry["x-xr-any-method"] = true;
        entry.summary = `${op.meta.summary} (adapter routes by method)`;
        entry.operationId = `${op.id}.${m}`;
      }
      paths[op.path][m] = entry;
    }
  }

  const sortedPaths: Record<string, unknown> = {};
  for (const key of Object.keys(paths).sort()) {
    const methods = paths[key];
    const sortedMethods: Record<string, unknown> = {};
    for (const m of Object.keys(methods).sort()) sortedMethods[m] = methods[m];
    sortedPaths[key] = sortedMethods;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "XR Daemon API",
      version: CORE_VERSION,
      summary: "The local-first daemon API of the XR AI agent runtime.",
      description:
        "Versioned surface mounted at /api/v1. Legacy /api/* mounts serve during the deprecation " +
        "window with Deprecation/Sunset headers and are removed no earlier than XR 2.0.0. " +
        "Compatibility policy: docs/api/COMPATIBILITY.md. " +
        "Authentication: local bearer token (x-session bootstrap cookie for browsers).",
      license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    },
    servers: [{ url: "http://127.0.0.1:3141", description: "Local daemon (default bind)." }],
    tags: [...new Set(ops.map((o) => o.meta.tag))].sort().map((name) => ({ name })),
    paths: sortedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Local daemon token (printed once at `xr serve` startup)." },
        cookieAuth: { type: "apiKey", in: "cookie", name: "xr_session", description: "HttpOnly SameSite=Strict session cookie (browser bootstrap)." },
      },
      schemas: { ApiError: toSchema(API_ERROR_SCHEMA) },
    },
    "x-xr-contract": {
      apiVersion: "v1",
      generatedFrom: "src/daemon/routes/contract.ts (live route registry)",
      legacySunset: "no-earlier-than XR 2.0.0",
      compatibility: "docs/api/COMPATIBILITY.md",
    },
  };
}

/** Stable serialization (2-space indent + trailing newline). */
export function serializeOpenApi(doc: Record<string, unknown>): string {
  return JSON.stringify(doc, null, 2) + "\n";
}
