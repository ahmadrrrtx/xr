#!/usr/bin/env bun
/**
 * XR Phase 8 · T1 — typed client generation + drift gate.
 *
 *   bun run scripts/generate-client.ts [--write] [--check]
 *
 * Emits src/clients/daemon-client.generated.ts from the LIVE route registry
 * (paths/methods) + contract schemas (request/response types inferred from
 * the SAME zod schemas that validate at runtime). --check is the CI gate:
 * fails if the committed file is stale.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { listDaemonRoutes } from "../src/daemon/routes/index.ts";
import { apiRegistry, type ApiOperation } from "../src/daemon/routes/registry.ts";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const OUT = join(ROOT, "src/clients/daemon-client.generated.ts");
const check = args.includes("--check");

/** operationId → method name: "providers.set" → providersSet */
function methodName(op: ApiOperation, used: Set<string>): string {
  const parts = op.id.split(/[.]/).filter(Boolean);
  let name = parts[0].replace(/[^a-zA-Z0-9_$]/g, "");
  for (const p of parts.slice(1)) name += p.charAt(0).toUpperCase() + p.slice(1).replace(/[^a-zA-Z0-9_$]/g, "");
  if (used.has(name)) name += "Op";
  used.add(name);
  return name;
}

/** zod schema name (from schemas.ts) for a given zod object identity. */
const KNOWN_SCHEMAS = new Map<unknown, string>([
  // Populated below from the contract meta by inspection against the schema module exports.
]);

async function schemaExportNames(): Promise<Map<unknown, string>> {
  const schemas = (await import("../src/daemon/routes/schemas.ts")) as Record<string, unknown>;
  const map = new Map<unknown, string>();
  for (const [k, v] of schemas ? Object.entries(schemas) : []) {
    if (v && typeof v === "object" && "safeParse" in (v as object)) map.set(v, k);
  }
  return map;
}

function extractParams(path: string): string[] {
  const out: string[] = [];
  for (const m of path.matchAll(/\{([^}]+)\}/g)) out.push(m[1]);
  return out;
}

function buildClient(ops: ApiOperation[], schemaNames: Map<unknown, string>): string {
  const lines: string[] = [];
  const used = new Set<string>();
  const schemaImports = new Set<string>();

  interface GenMethod {
    name: string;
    source: string;
  }
  const methods: GenMethod[] = [];

  for (const op of ops) {
    if (op.path.includes("{path}")) continue; // wildcard adapters: raw-fetch targets, not typed methods
    if (op.method === "ANY") continue;
    const params = extractParams(op.path);
    const name = methodName(op, used);
    const reqName = op.meta.request ? schemaNames.get(op.meta.request) ?? KNOWN_SCHEMAS.get(op.meta.request) : undefined;
    const resName = op.meta.response ? schemaNames.get(op.meta.response) : undefined;
    if (reqName) schemaImports.add(reqName);
    if (resName) schemaImports.add(resName);
    const resType = resName ? `z.infer<typeof S.${resName}>` : "Record<string, unknown>";

    const paramSig = params.map((p) => `${p.replace(/[^a-zA-Z0-9_$]/g, "_")}: string`).join(", ");
    const bodySig = reqName ? `${paramSig ? ", " : ""}body: z.infer<typeof S.${reqName}>` : "";
    const sig = `${paramSig}${bodySig}`;
    const pathExpr = params.length > 0
      ? "`" + op.path.replace(/\{([^}]+)\}/g, (_, p) => `\${encodeURIComponent(${p.replace(/[^a-zA-Z0-9_$]/g, "_")})}`) + "`"
      : JSON.stringify(op.path);

    if (op.meta.sse) {
      methods.push({
        name,
        source:
          `  /** ${op.meta.summary} (SSE stream — returns the raw Response). */\n` +
          `  async ${name}(${sig.replace(/^, /, "")}): Promise<Response> {\n` +
          `    return await this.raw("POST", ${pathExpr}, body);\n` +
          `  }`,
      });
      continue;
    }

    methods.push({
      name,
      source:
        `  /** ${op.meta.summary} */\n` +
        `  async ${name}(${sig.replace(/^, /, "")}): Promise<${resType}> {\n` +
        `    return await this.call("${op.method}", ${pathExpr}${reqName ? ", body" : ""});\n` +
        `  }`,
    });
  }

  lines.push("/**");
  lines.push(" * XR Daemon API v1 — typed client (GENERATED — do not edit).");
  lines.push(" *");
  lines.push(" * Source: live route registry + contract schemas.");
  lines.push(" * Regenerate: bun run client:generate · Drift gate: bun run client:check");
  lines.push(" */");
  lines.push("");
  lines.push('import type { z } from "zod/v4";');
  lines.push('import * as S from "../daemon/routes/schemas.ts";');
  lines.push("");
  lines.push("export interface XRDaemonClientOptions {");
  lines.push("  /** Daemon base URL, e.g. http://127.0.0.1:3141 (no trailing slash). */");
  lines.push("  baseUrl: string;");
  lines.push("  /** Local daemon bearer token (printed by `xr serve`). */");
  lines.push("  token: string;");
  lines.push("  /** Fetch implementation override (tests). */");
  lines.push("  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;");
  lines.push("}");
  lines.push("");
  lines.push("/** Structured API error (problem+json envelope + legacy `error`). */");
  lines.push("export class XRApiError extends Error {");
  lines.push("  constructor(");
  lines.push("    readonly status: number,");
  lines.push("    readonly problem: { error?: string; title?: string; detail?: string; errors?: Array<{ path: string; message: string }> } | null,");
  lines.push("  ) {");
  lines.push('    super(problem?.error ?? problem?.detail ?? `XR API error ${status}`);');
  lines.push('    this.name = "XRApiError";');
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push("/** Typed client for the versioned daemon API (/api/v1). */");
  lines.push("export class XRDaemonClient {");
  lines.push("  private readonly base: string;");
  lines.push("  private readonly token: string;");
  lines.push("  private readonly fetcher: (input: string | URL, init?: RequestInit) => Promise<Response>;");
  lines.push("");
  lines.push("  constructor(opts: XRDaemonClientOptions) {");
  lines.push('    this.base = opts.baseUrl.replace(/\\/+$/, "");');
  lines.push("    this.token = opts.token;");
  lines.push('    this.fetcher = opts.fetchImpl ?? ((globalThis as { fetch: typeof fetch }).fetch);');
  lines.push("  }");
  lines.push("");
  lines.push("  async raw(method: string, path: string, body?: unknown): Promise<Response> {");
  lines.push("    return await this.fetcher(`${this.base}${path}`, {");
  lines.push("      method,");
  lines.push("      headers: {");
  lines.push('        authorization: `Bearer ${this.token}`,');
  lines.push('        "content-type": "application/json",');
  lines.push("      },");
  lines.push("      body: body === undefined ? undefined : JSON.stringify(body),");
  lines.push("    });");
  lines.push("  }");
  lines.push("");
  lines.push("  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {");
  lines.push("    const res = await this.raw(method, path, body);");
  lines.push("    if (!res.ok) {");
  lines.push("      let problem: ConstructorParameters<typeof XRApiError>[1] = null;");
  lines.push("      try {");
  lines.push("        const parsed = (await res.json()) as NonNullable<typeof problem>;");
  lines.push('        problem = parsed && typeof parsed === "object" ? parsed : null;');
  lines.push("      } catch {");
  lines.push("        problem = null;");
  lines.push("      }");
  lines.push("      throw new XRApiError(res.status, problem);");
  lines.push("    }");
  lines.push("    return (await res.json()) as T;");
  lines.push("  }");
  lines.push("");
  for (const m of methods) lines.push(m.source, "");
  lines.push("}");
  lines.push("");
  lines.push("/** Convenience factory. */");
  lines.push("export function createDaemonClient(opts: XRDaemonClientOptions): XRDaemonClient {");
  lines.push("  return new XRDaemonClient(opts);");
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

const ops = apiRegistry(listDaemonRoutes());
const doc = buildClient(ops, await schemaExportNames());

if (check) {
  if (!existsSync(OUT)) {
    console.error(`[client-check] FAIL — ${OUT} does not exist. Run: bun run client:generate`);
    process.exit(1);
  }
  const committed = readFileSync(OUT, "utf8");
  if (committed !== doc) {
    console.error("[client-check] FAIL — typed client is stale. Regenerate: bun run client:generate");
    process.exit(1);
  }
  console.log("[client-check] OK — typed client matches the live route registry");
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, doc);
console.log(`[client-generate] wrote ${OUT} (${doc.split("\n").length} lines)`);
