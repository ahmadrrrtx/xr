/**
 * XR Cloud — request plumbing: request id, security headers, CORS.
 *
 * CORS deserves a note because it is the single most commonly-misconfigured part
 * of a service like this. There is **no wildcard, no origin reflection, and no
 * `Access-Control-Allow-Origin: *` fallback**. Exactly one origin is permitted —
 * `APP_URL` — and anything else gets no CORS headers at all. Origin *reflection*
 * (echoing back whatever `Origin` the caller sent) is indistinguishable from a
 * wildcard once credentials are involved, and is the bug that turns a
 * credentialed API into an open one.
 *
 * Security headers are applied centrally so a new route cannot forget them.
 */

import type { MiddlewareHandler } from "hono";

import type { AppDeps, RequestMeta } from "../deps.ts";
import { newId } from "../lib/ids.ts";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    meta: RequestMeta;
  }
}

export const requestId = (): MiddlewareHandler => async (c, next) => {
  // Honour an inbound id only if it is a plausible opaque token — never echo an
  // arbitrary client string into a response header.
  const inbound = c.req.header("x-request-id");
  const id = inbound && /^[A-Za-z0-9._-]{8,128}$/.test(inbound) ? inbound : newId("request");
  c.set("requestId", id);
  c.header("x-request-id", id);
  await next();
};

/**
 * Client IP. Trusts `X-Forwarded-For` **only** when the operator has declared a
 * proxy exists (`TRUST_PROXY=1`). Otherwise a caller could set their own
 * forwarded address and walk straight through every IP-based rate limit, which
 * would make `magicLink`'s per-IP half decorative.
 */
export const clientMeta = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  // Peer address, as the runtime sees it. This is the only value that cannot be
  // forged by the caller, so it is the floor in every case.
  const server = (c.env as { requestIP?: (req: Request) => { address: string } | null } | undefined)
    ?.requestIP;
  const peer = server ? server(c.req.raw)?.address : undefined;

  // Forwarded headers are honoured ONLY behind a proxy we were told to trust.
  // An earlier revision read `x-real-ip` unconditionally, which meant a caller
  // could send a fresh value on every request and walk straight through every
  // IP-scoped rate limit — the exact attack the surrounding comment described
  // while the code did the opposite. Header names are not a trust signal; the
  // deployment topology is, and only `TRUST_PROXY` states it.
  const ip = deps.env.TRUST_PROXY
    ? (c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? peer ?? "unknown")
    : (peer ?? "unknown");

  c.set("meta", { ip, userAgent: c.req.header("user-agent") ?? "unknown" });
  await next();
};

export const securityHeaders = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-site");
  c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  // API responses are never documents; a CSP here is belt-and-braces for the
  // error pages and the relay's HTML fallback.
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

  if (deps.env.NODE_ENV === "production") {
    // HSTS only in production — pinning localhost in a dev browser is a footgun.
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
};

export const cors = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = deps.env.APP_URL;

  if (origin && origin === allowed) {
    c.header("Access-Control-Allow-Origin", allowed);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    c.header(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-CSRF-Token,X-Request-Id,X-XR-Device-Id",
    );
    c.header("Access-Control-Max-Age", "600");
  }

  if (c.req.method === "OPTIONS") {
    // Preflight for a disallowed origin gets a bare 204 with no CORS headers,
    // which the browser correctly refuses.
    return c.body(null, 204);
  }
  await next();
};

/**
 * Body size ceiling. Applied before parsing so a 2 GB JSON body is refused at
 * the edge rather than buffered and then rejected (Art. XII · Rule 3).
 */
export const bodyLimit = (bytes = 1_048_576): MiddlewareHandler => async (c, next) => {
  const declared = c.req.header("content-length");
  if (declared) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > bytes) {
      return c.json(
        {
          error: {
            code: "bad_request" as const,
            message: `Request body exceeds ${Math.floor(bytes / 1024)} KB.`,
            repair: "Send a smaller payload. Team memory bodies and policy documents are both well under this limit.",
          },
        },
        413,
      );
    }
  }
  await next();
};
