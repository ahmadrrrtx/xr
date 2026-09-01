/**
 * XR Daemon — base route registry (leaf module; Phase 8 · T1).
 *
 * Owns the base route-group composition and the API registry derivation.
 * Meta routes (OpenAPI/metrics/traces) are composed by ./index.ts — this
 * module deliberately does NOT import them (acyclic dependency graph:
 * index → meta → openapi → registry).
 */

import { agentsRoutes } from "./agents.routes.ts";
import { approvalRoutes } from "./approvals.routes.ts";
import { budgetRoutes } from "./budget.routes.ts";
import { chatRoutes } from "./chat.routes.ts";
import { capabilityRoutes } from "./capabilities.routes.ts";
import { controlRoutes } from "./control.routes.ts";
import { environmentRoutes } from "./environment.routes.ts";
import { extensionRoutes } from "./extensions.routes.ts";
import { businessRoutes } from "./business.routes.ts";
import { memoryRoutes } from "./memory.routes.ts";
import { contextRoutes } from "./context.routes.ts";
import { providersRoutes } from "./providers.routes.ts";
import { shieldRoutes } from "./shield.routes.ts";
import { systemRoutes } from "./system.routes.ts";
import { onboardingRoutes } from "./onboarding.routes.ts";
import { filesRoutes } from "./files.routes.ts";
import { trustRoutes } from "./trust.routes.ts";
import { researchRoutes } from "./research.routes.ts";
import type { DaemonRoute } from "./router.ts";
import { API_CONTRACT, V1_PREFIX, type ApiOperationMeta } from "./contract.ts";

/** Base daemon routes (everything except the Phase-8 meta routes). */
export function listBaseRoutes(): DaemonRoute[] {
  return [
    // Phase 10 — research routes precede system routes so job paths resolve
    // before the `research.get` prefix route (GET /api/research/{id}).
    ...researchRoutes(),
    ...systemRoutes(),
    // Phase 2 · F-11 — durable approval endpoints (before control routes so
    // /api/approvals/* resolves before the control prefix routes).
    ...approvalRoutes(),
    ...onboardingRoutes(),
    ...filesRoutes(),
    ...chatRoutes(),
    ...agentsRoutes(),
    ...budgetRoutes(),
    ...shieldRoutes(),
    ...trustRoutes(),
    ...capabilityRoutes(),
    ...providersRoutes(),
    ...extensionRoutes(),
    ...controlRoutes(),
    ...environmentRoutes(),
    ...memoryRoutes(),
    ...contextRoutes(),
    ...businessRoutes(),
  ];
}

export interface ApiOperation {
  id: string;
  method: string;
  /** Versioned public path (template for prefix routes), e.g. /api/v1/chat. */
  path: string;
  meta: ApiOperationMeta;
}

/**
 * Derive the public API registry from a serving route list. Every consumer
 * (OpenAPI generator, typed client, compat checker, meta routes) passes the
 * SAME list it serves, so the contract can never drift from runtime truth.
 */
export function apiRegistry(routes: DaemonRoute[] = listBaseRoutes()): ApiOperation[] {
  const ops: ApiOperation[] = [];
  for (const r of routes) {
    const meta = API_CONTRACT[r.id];
    if (!meta || meta.surface) continue;
    const canonical = meta.template ?? r.pathLabel();
    for (const method of r.methodLabel().split(",")) {
      ops.push({ id: r.id, method, path: v1Path(canonical), meta });
    }
  }
  return ops;
}

/** Map an unversioned canonical path to its /api/v1 mount. */
export function v1Path(canonical: string): string {
  if (canonical === "/api" || canonical === "/api/") return V1_PREFIX;
  if (canonical.startsWith("/api/")) return V1_PREFIX + canonical.slice("/api".length);
  return canonical;
}
