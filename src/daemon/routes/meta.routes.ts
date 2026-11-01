/**
 * XR Daemon — Phase 8 meta routes: API index, OpenAPI document, Prometheus
 * metrics, and the local recent-traces view (structural only).
 *
 * Dependency direction (acyclic): this module imports the LEAF registry
 * (./registry.ts) and the OpenAPI builder (../api/openapi.ts); both are
 * composed upward by ./index.ts. Nothing here imports ./index.ts.
 */

import { route, type DaemonRoute } from "./router.ts";
import { buildOpenApi, serializeOpenApi } from "../api/openapi.ts";
import { ENGINE_CONTRACT_VERSION, LEGACY_SUNSET_ISO, MIN_DESKTOP_VERSION, V1_PREFIX } from "./contract.ts";
import { apiRegistry, listBaseRoutes } from "./registry.ts";
import { renderPrometheus } from "../../observability/metrics.ts";
import { recentSpans } from "../../observability/tracer.ts";
import { telemetry } from "../../observability/config.ts";
import { versionInfo } from "../../core/version.ts";
import { LATEST_SCHEMA_VERSION } from "../../state/migrations.ts";

let cachedDoc: string | null = null;

/**
 * XR-P01 — served operation ids, derived ONCE from the same registry the
 * OpenAPI document is built from (`fullApiOps()`), sorted and de-duplicated.
 * Never a hand-kept list: registering/unregistering an operation changes
 * this automatically. Cost is O(registry) once per process; the per-request
 * handler only replays the cached array.
 */
let cachedCapabilities: string[] | null = null;
function engineCapabilities(): string[] {
  cachedCapabilities ??= [...new Set(fullApiOps().map((op) => op.id))].sort();
  return cachedCapabilities;
}

/** The full operation list (base + these meta routes) — one composition site. */
export function fullApiOps(): ReturnType<typeof apiRegistry> {
  return apiRegistry([...listBaseRoutes(), ...metaRoutes()]);
}

function openApiDoc(): string {
  cachedDoc ??= serializeOpenApi(buildOpenApi(fullApiOps()));
  return cachedDoc;
}

/** Test hook: drop the cached document (registry changed in-process). */
export function invalidateOpenApiCache(): void {
  cachedDoc = null;
}

export function metaRoutes(): DaemonRoute[] {
  return [
    route({
      id: "meta.apiRoot.get",
      path: "/api",
      method: "GET",
      handle: ({ json }) =>
        json({
          name: "XR Daemon API",
          apiVersion: "v1",
          version: versionInfo(),
          mount: V1_PREFIX,
          operations: fullApiOps().length,
          openapi: `${V1_PREFIX}/openapi.json`,
          metrics: `${V1_PREFIX}/metrics`,
          traces: `${V1_PREFIX}/traces/recent`,
          legacy: {
            status: "deprecated",
            sunset: LEGACY_SUNSET_ISO,
            policy: "docs/api/COMPATIBILITY.md",
          },
        }),
    }),
    route({
      id: "meta.version.get",
      path: "/api/meta/version",
      method: "GET",
      // V1-P5-001 — the mobile companion's reachability probe. Session-gated
      // like the rest of the API (anonymous → 401): the app uses a 401 here to
      // detect a revoked pairing, so it must NOT be public. `lan` mirrors the
      // LAN runtime (mobile plumbing present), not the bind address.
      // XR-P01 — also the desktop's contract handshake. The four XR-P01
      // fields are ADDITIVE; the legacy four keep their names/types. This
      // identity lives behind the session wall on purpose: the open health
      // probes stay exactly {ok, ts} (P2-21 — a loopback service must not be
      // fingerprintable pre-auth).
      handle: ({ json, url, mobile }) =>
        json({
          version: versionInfo().version,
          host: `${url.protocol}//${url.host}`,
          lan: Boolean(mobile),
          deviceName: "XR desktop",
          contractVersion: ENGINE_CONTRACT_VERSION,
          minDesktopVersion: MIN_DESKTOP_VERSION,
          schemaVersion: LATEST_SCHEMA_VERSION,
          capabilities: engineCapabilities(),
        }),
    }),
    route({
      id: "meta.openapi.get",
      path: "/api/openapi.json",
      method: "GET",
      handle: () =>
        new Response(openApiDoc(), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        }),
    }),
    route({
      id: "meta.metrics.get",
      path: "/api/metrics",
      method: "GET",
      handle: () =>
        new Response(renderPrometheus(), {
          headers: {
            "content-type": "text/plain; version=0.0.4; charset=utf-8",
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        }),
    }),
    route({
      id: "meta.traces.get",
      path: "/api/traces/recent",
      method: "GET",
      handle: ({ json, url }) => {
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") ?? 100)));
        const { spans, dropped } = recentSpans(limit);
        return json({
          telemetry: {
            enabled: telemetry().enabled,
            structuralOnly: true,
            contentCapture: {
              prompt: telemetry().content.prompt,
              toolArgs: telemetry().content.toolArgs,
              note: "prompt/tool content is never captured unless explicitly opted in (config telemetry.content.*)",
            },
          },
          dropped,
          spans: spans.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId ?? null,
            name: s.name,
            kind: s.kind,
            startMs: s.startMs,
            durationMs: s.durationMs ?? null,
            status: s.status ?? null,
            attributes: s.attributes,
          })),
        });
      },
    }),
  ];
}
