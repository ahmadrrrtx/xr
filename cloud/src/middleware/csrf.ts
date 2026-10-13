/**
 * XR Cloud — CSRF protection.
 *
 * ## The rule
 *
 * A mutation authenticated by a **cookie** must also present the CSRF token from
 * the `xr_csrf` cookie in the `x-csrf-token` header. A mutation authenticated by
 * a **bearer token** does not need it, because a browser cannot be tricked into
 * adding an `Authorization` header to a cross-site form post — which is precisely
 * the threat CSRF describes.
 *
 * ## Why double-submit and not a token store
 *
 * Because the JWT is already `sameSite=lax`, so cross-site POSTs do not carry the
 * session cookie at all in any current browser. Double-submit is the second lock
 * for the cases `sameSite` does not cover (older engines, same-site-but-different-
 * origin subdomains, a future `sameSite=none` for an embed), and it costs one
 * extra cookie instead of a server-side token table.
 *
 * ## Why not `Origin`-only
 *
 * It is checked too — and a mismatched `Origin` is an immediate reject — because
 * defence in depth is cheap here. But `Origin` alone is not sufficient: it is
 * absent on some legitimate same-origin requests, and treating "absent" as
 * "trusted" would be exactly the wrong default.
 *
 * Safe methods pass through untouched. `GET /auth/magic/callback` is a state
 * change reached by navigation, and it is protected differently: the token in the
 * URL is single-use and short-lived, which is the correct control for an emailed
 * link (an emailed link cannot carry a header).
 */

import type { MiddlewareHandler } from "hono";

import type { AppDeps } from "../deps.ts";
import { csrfFailed } from "../lib/errors.ts";
import { randomToken } from "../lib/crypto.ts";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "./auth.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Paths that mutate but are exempt, each for a stated reason. An allowlist of
 * two is reviewable; a prefix rule would not be.
 */
const EXEMPT_PATHS = new Set([
  // Stripe signs the body; a browser is not the caller. Verified by HMAC.
  "/billing/webhooks/stripe",
  // IdP-initiated POST back to the ACS. Verified by SAML signature.
  "/auth/sso/saml/acs",
]);

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export const csrfProtection = (deps: AppDeps): MiddlewareHandler => async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Always make sure a CSRF cookie exists so the client's JS can read one, even
  // on a plain GET. `SameSite=Lax` (not Strict) so top-level navigations from
  // the marketing site still land signed in.
  if (!readCookie(c.req.header("cookie"), CSRF_COOKIE) && c.req.method === "GET") {
    const token = randomToken(24);
    c.header(
      "Set-Cookie",
      `${CSRF_COOKIE}=${token}; Path=/; Max-Age=86400; SameSite=Lax${deps.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      { append: true },
    );
  }

  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  if (EXEMPT_PATHS.has(path)) {
    await next();
    return;
  }

  const cookieHeader = c.req.header("cookie");
  const hasCookieSession = readCookie(cookieHeader, SESSION_COOKIE) !== null;
  const hasBearer = /^Bearer\s+/i.test(c.req.header("authorization") ?? "");

  // Bearer-authenticated and unauthenticated requests do not go through CSRF.
  // An unauthenticated request has no ambient authority to steal.
  if (hasBearer || !hasCookieSession) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  if (origin && origin !== deps.env.APP_URL) throw csrfFailed();

  const cookieToken = readCookie(cookieHeader, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) throw csrfFailed();

  await next();
};
