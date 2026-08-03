#!/usr/bin/env bun
/**
 * XR Phase 8 · T1 — OpenAPI generation + drift gate.
 *
 *   bun run scripts/generate-openapi.ts [--write] [--check] [--out docs/api/openapi.json]
 *
 * --write regenerates the committed artifact from the LIVE route registry.
 * --check (CI gate) regenerates in-memory and fails if the committed file
 * differs — the spec can never silently drift from the serving code.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildOpenApi, serializeOpenApi } from "../src/daemon/api/openapi.ts";
import { listDaemonRoutes } from "../src/daemon/routes/index.ts";
import { apiRegistry } from "../src/daemon/routes/registry.ts";

const ROOT = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, "docs/api/openapi.json");
const check = args.includes("--check");
const write = args.includes("--write") || !check;

const ops = apiRegistry(listDaemonRoutes());
const serialized = serializeOpenApi(buildOpenApi(ops));
// Count actual HTTP operations emitted in the document (a registry entry may
// emit two, e.g. GET+POST on one path), so the report matches the artifact.
const doc = JSON.parse(serialized) as { paths: Record<string, Record<string, unknown>> };
const opCount = Object.values(doc.paths).reduce(
  (n, item) => n + Object.keys(item).filter((m) => ["get", "post", "put", "delete", "patch"].includes(m)).length,
  0,
);

if (check) {
  if (!existsSync(OUT)) {
    console.error(`[api-schema] FAIL — ${OUT} does not exist. Run: bun run api:schema:generate`);
    process.exit(1);
  }
  const committed = readFileSync(OUT, "utf8");
  if (committed !== serialized) {
    console.error(
      `[api-schema] FAIL — committed OpenAPI document is stale.\n` +
        `  Regenerate: bun run api:schema:generate\n` +
        `  (${OUT} differs from the live route registry)`,
    );
    process.exit(1);
  }
  console.log(`[api-schema] OK — ${OUT} matches the live route registry (${opCount} operations)`);
  process.exit(0);
}

if (write) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serialized);
  console.log(`[api-schema] wrote ${OUT} (${ops.length} operations, ${Buffer.byteLength(serialized)} bytes)`);
}
