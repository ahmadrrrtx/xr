/**
 * XR Cloud — the Hono application.
 *
 * Composition order matters and is the whole content of this file:
 *
 *   1. request id      — so every later log line and error body carries one
 *   2. client meta     — IP, needed by the rate limiters
 *   3. security headers
 *   4. CORS
 *   5. body limit
 *   6. resolve auth    — never rejects; sets a principal when one exists
 *   7. CSRF            — decided after auth, because it depends on how the
 *                        caller authenticated
 *   8. routes
 *   9. error handler
 *
 * Health routes are mounted **before** the body limit and CSRF middleware so a
 * monitoring probe is never slowed down or asked for a token.
 */

import { Hono } from "hono";

import type { AppDeps } from "./deps.ts";
import { errorHandler } from "./middleware/error-handler.ts";
import { resolveAuth } from "./middleware/auth.ts";
import { bodyLimit, clientMeta, cors, requestId, securityHeaders } from "./middleware/security.ts";
import { csrfProtection } from "./middleware/csrf.ts";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { teamRoutes } from "./routes/teams.ts";
import { policyRoutes } from "./routes/policies.ts";
import { memoryRoutes } from "./routes/memory.ts";
import { auditRoutes } from "./routes/audit.ts";
import { billingRoutes } from "./routes/billing.ts";
import { ssoRoutes } from "./routes/sso.ts";
import { apiKeyRoutes } from "./routes/keys.ts";
import { modelRoutes } from "./routes/models.ts";
import { relayRoutes } from "./routes/relay.ts";

export interface CloudApp {
  hono: Hono;
  deps: AppDeps;
}

export function createApp(deps: AppDeps): CloudApp {
  const app = new Hono();

  app.onError(errorHandler);

  // Health and well-known files first: no auth, no body limit, no CSRF.
  app.route("/", healthRoutes(deps));

  app.use("*", requestId());
  app.use("*", clientMeta(deps));
  app.use("*", securityHeaders(deps));
  app.use("*", cors(deps));
  app.use("*", bodyLimit(1_048_576));
  app.use("*", resolveAuth(deps));
  app.use("*", csrfProtection(deps));

  app.route("/", authRoutes(deps));
  app.route("/", ssoRoutes(deps));
  app.route("/", teamRoutes(deps));
  app.route("/", policyRoutes(deps));
  app.route("/", memoryRoutes(deps));
  app.route("/", auditRoutes(deps));
  app.route("/", billingRoutes(deps));
  app.route("/", apiKeyRoutes(deps));
  app.route("/", modelRoutes(deps));
  app.route("/", relayRoutes(deps));

  // Anything unmatched gets JSON, not a branded 404 page. A client parsing this
  // API should never have to handle HTML.
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found" as const,
          message: `No route for ${c.req.method} ${new URL(c.req.url).pathname}.`,
          repair: "Check the path and method. The full surface is documented in docs/business/SELF-HOST.md.",
          requestId: c.get("requestId"),
        },
      },
      404,
    ),
  );

  return { hono: app, deps };
}
