/**
 * XR-LAUNCH-018 / 027 (minimal) — browser sign-in for `xr serve`.
 *
 *   · tokenEquals: every daemon-token comparison is constant-time. Both sides
 *     are SHA-256 hashed first, so timingSafeEqual always compares 32 bytes and
 *     neither the content nor the LENGTH of the real token leaks via timing.
 *   · POST /auth/login: the sign-in page POSTs the token in the request BODY
 *     (never the URL, so it stays out of history, referrers and access logs)
 *     and gets the same HttpOnly SameSite=Strict session cookie the `?token=`
 *     bootstrap sets. The cookie value is still the token itself, and the
 *     bootstrap link stays valid for the daemon's lifetime: separate session ids
 *     and single-use bootstrap are Phase 5 (XR-LAUNCH-027).
 *   · wantsSignInPage: an unauthenticated page GET (anything outside /api/ and
 *     /assets/) gets the sign-in page even from `curl /` (Accept: *\/*); API
 *     clients keep the JSON 401 contract.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { authPageCSP, authPageHtml, generateCspNonce } from "./auth-page.ts";

export const LOGIN_PATH = "/auth/login";
const LOGIN_BODY_MAX = 4096;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time string equality (content AND length independent). */
export function tokenEquals(given: string | null | undefined, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

/** True when the Cookie header carries `<name>=<token>` (each pair compared in constant time). */
export function cookieHasToken(cookieHeader: string, name: string, token: string): boolean {
  let found = false;
  for (const pair of cookieHeader.split(";")) {
    const p = pair.trim();
    // No early return: every pair is compared, so the position of a match is not observable.
    if (p.startsWith(`${name}=`) && tokenEquals(p.slice(name.length + 1), token)) found = true;
  }
  return found;
}

/** The session cookie, identical for the `?token=` bootstrap and the login POST. Secure only on LAN TLS. */
export function sessionCookie(name: string, token: string, secure: boolean): string {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`;
}

/** A same-origin, rooted return path; anything else (or the login endpoint itself) falls back to "/". */
export function safeReturnPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.length > 2048) return "/";
  try {
    const u = new URL(raw, "http://xr.invalid");
    if (u.origin !== "http://xr.invalid" || u.pathname === LOGIN_PATH) return "/";
    u.searchParams.delete("token");
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Should an unauthenticated request get the HTML sign-in page instead of the
 * JSON 401? GET page navigations only — never /api/*, never /assets/*, never
 * a mutating verb — when the client accepts HTML or expresses no preference.
 */
export function wantsSignInPage(method: string, path: string, accept: string | null): boolean {
  if (method.toUpperCase() !== "GET") return false;
  if (path.startsWith("/api/") || path === "/api" || path.startsWith("/assets/")) return false;
  const a = (accept ?? "").trim();
  return a === "" || a.includes("text/html") || a.split(",").some((part) => part.trim().split(";")[0] === "*/*");
}

/** The accessible sign-in page as a 401 response with its per-response CSP nonce. */
export function signInPageResponse(returnPath: string, failed = false): Response {
  const nonce = generateCspNonce();
  return new Response(authPageHtml(safeReturnPath(returnPath), nonce, failed), {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": authPageCSP(nonce),
      "cache-control": "no-store",
    },
  });
}

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Browsers always send Origin on a form POST; it must name this daemon (same host set as the Host gate, same port). */
function loginOriginOk(req: Request, allowedHosts: readonly string[]): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const self = new URL(req.url);
    return allowedHosts.includes(o.hostname) && o.port === self.port && o.protocol === self.protocol;
  } catch {
    return false;
  }
}

/**
 * POST /auth/login (application/x-www-form-urlencoded: token, next).
 * Success → 303 to `next` with the session cookie. Wrong token → the sign-in
 * page again (401) with an announced error. Cross-origin → 403 JSON.
 */
export async function handleLoginPost(
  req: Request,
  token: string,
  opts: { cookieName: string; secure: boolean; allowedHosts: readonly string[] },
): Promise<Response> {
  if (!loginOriginOk(req, opts.allowedHosts)) {
    return jsonError("forbidden — sign in from this dashboard's own page (cross-origin request refused)", 403);
  }
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    return jsonError("unsupported media type — the sign-in form posts application/x-www-form-urlencoded", 415);
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return jsonError("unreadable request body", 400);
  }
  if (raw.length > LOGIN_BODY_MAX) return jsonError("payload too large", 413);
  const form = new URLSearchParams(raw);
  const next = safeReturnPath(form.get("next"));
  if (!tokenEquals(form.get("token"), token)) return signInPageResponse(next, true);
  return new Response(null, {
    status: 303,
    headers: { location: next, "set-cookie": sessionCookie(opts.cookieName, token, opts.secure), "cache-control": "no-store" },
  });
}
