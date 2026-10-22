/**
 * XR-LAUNCH-018 / 027 — browser sign-in for `xr serve`.
 *
 *   · tokenEquals: every daemon-token comparison is constant-time. Both sides
 *     are SHA-256 hashed first, so timingSafeEqual always compares 32 bytes and
 *     neither the content nor the LENGTH of the real token leaks via timing.
 *   · BrowserSessions (027): the `xr_session` cookie carries a random session
 *     id, never the API token. Ids live only in this process (stored as SHA-256
 *     digests), expire after 7 days, die with the daemon and are revoked by
 *     POST /auth/logout. A leaked cookie is not a bearer token.
 *   · Bootstrap links (027): `?bootstrap=<code>` is single-use and short-lived
 *     (60 s when minted over the API, 10 min in the private banner). The old
 *     `?token=<API token>` link no longer signs anyone in; it lands on the
 *     sign-in page, which strips it from the return path.
 *   · POST /auth/login: the sign-in page POSTs the token in the request BODY
 *     (never the URL, so it stays out of history, referrers and access logs)
 *     and gets a fresh session cookie.
 *   · POST /auth/bootstrap (bearer or session): mints one bootstrap link, e.g.
 *     for the VS Code extension's "Open dashboard".
 *   · wantsSignInPage: an unauthenticated page GET (anything outside /api/ and
 *     /assets/) gets the sign-in page even from `curl /` (Accept: *\/*); API
 *     clients keep the JSON 401 contract.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { authPageCSP, authPageHtml, generateCspNonce } from "./auth-page.ts";

export const LOGIN_PATH = "/auth/login";
export const LOGOUT_PATH = "/auth/logout";
export const BOOTSTRAP_PATH = "/auth/bootstrap";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;
export const BOOTSTRAP_TTL_MS = 60_000;
export const BANNER_BOOTSTRAP_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 256;
const MAX_BOOTSTRAPS = 64;
const LOGIN_BODY_MAX = 4096;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Constant-time string equality (content AND length independent). */
export function tokenEquals(given: string | null | undefined, expected: string): boolean {
  if (typeof given !== "string" || expected.length === 0) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

const hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

/** Every value of cookie `name` in a Cookie header. */
export function cookieValues(cookieHeader: string, name: string): string[] {
  const out: string[] = [];
  for (const pair of cookieHeader.split(";")) {
    const p = pair.trim();
    if (p.startsWith(`${name}=`)) out.push(p.slice(name.length + 1));
  }
  return out;
}

/**
 * XR-LAUNCH-027 — in-memory browser sessions and single-use bootstrap codes.
 * Only SHA-256 digests are stored, so a heap dump holds no usable cookie, and
 * lookups by digest reveal nothing useful through timing. Both maps are
 * bounded (oldest evicted first).
 */
export class BrowserSessions {
  private readonly sessions = new Map<string, number>(); // digest → expiresAt (ms)
  private readonly bootstraps = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  private put(map: Map<string, number>, max: number, secret: string, ttlMs: number): string {
    const t = this.now();
    for (const [k, exp] of map) if (exp <= t) map.delete(k);
    while (map.size >= max) map.delete(map.keys().next().value as string);
    map.set(hex(secret), t + ttlMs);
    return secret;
  }

  /** A new session id (43 chars of base64url, 256 bits). */
  create(): string {
    return this.put(this.sessions, MAX_SESSIONS, randomBytes(32).toString("base64url"), SESSION_MAX_AGE_S * 1000);
  }

  isValid(id: string | null | undefined): boolean {
    if (typeof id !== "string" || id.length === 0 || id.length > 128) return false;
    const key = hex(id);
    const exp = this.sessions.get(key);
    if (exp === undefined) return false;
    if (exp > this.now()) return true;
    this.sessions.delete(key);
    return false;
  }

  /** True when any `name` cookie in the header is a live session. */
  fromCookie(cookieHeader: string, name: string): boolean {
    return cookieValues(cookieHeader, name).some((v) => this.isValid(v));
  }

  /** Revoke every `name` session id in the header; returns how many were live. */
  revokeFromCookie(cookieHeader: string, name: string): number {
    let n = 0;
    for (const v of cookieValues(cookieHeader, name)) if (v.length <= 128 && this.sessions.delete(hex(v))) n++;
    return n;
  }

  /** A single-use bootstrap code (32 chars of base64url, 192 bits). */
  mintBootstrap(ttlMs: number = BOOTSTRAP_TTL_MS): string {
    return this.put(this.bootstraps, MAX_BOOTSTRAPS, randomBytes(24).toString("base64url"), ttlMs);
  }

  /** Consume a bootstrap code: true once, while unexpired; never again. */
  consumeBootstrap(code: string | null | undefined): boolean {
    if (typeof code !== "string" || code.length === 0 || code.length > 128) return false;
    const key = hex(code);
    const exp = this.bootstraps.get(key);
    this.bootstraps.delete(key);
    return exp !== undefined && exp > this.now();
  }

  get size(): { sessions: number; bootstraps: number } {
    return { sessions: this.sessions.size, bootstraps: this.bootstraps.size };
  }
}

/** The session cookie for a session id (bootstrap and login alike). Secure only on LAN TLS. */
export function sessionCookie(name: string, sessionId: string, secure: boolean): string {
  return `${name}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_S}${secure ? "; Secure" : ""}`;
}

const clearCookie = (name: string, secure: boolean) => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;

/** A same-origin, rooted return path; anything else (or the login endpoint itself) falls back to "/". */
export function safeReturnPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.length > 2048) return "/";
  try {
    const u = new URL(raw, "http://xr.invalid");
    if (u.origin !== "http://xr.invalid" || u.pathname === LOGIN_PATH) return "/";
    u.searchParams.delete("token");
    u.searchParams.delete("bootstrap");
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
  opts: { cookieName: string; secure: boolean; allowedHosts: readonly string[]; sessions: BrowserSessions },
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
    headers: { location: next, "set-cookie": sessionCookie(opts.cookieName, opts.sessions.create(), opts.secure), "cache-control": "no-store" },
  });
}

/**
 * POST /auth/bootstrap and POST /auth/logout (reached only after the auth gate
 * and the CSRF origin wall). Bootstrap: bearer or browser session → one
 * single-use link `{ url, expiresInSeconds }` for `?next=`'s path (default "/").
 * Logout: revokes the cookie's session(s) and clears the cookie → 303 to "/".
 */
export function handleSessionPost(
  req: Request,
  path: string,
  opts: { cookieName: string; secure: boolean; sessions: BrowserSessions; privileged: boolean },
): Response {
  if (!opts.privileged) return jsonError("forbidden — this needs the daemon token or a dashboard session", 403);
  if (path === LOGOUT_PATH) {
    opts.sessions.revokeFromCookie(req.headers.get("cookie") ?? "", opts.cookieName);
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": clearCookie(opts.cookieName, opts.secure), "cache-control": "no-store" } });
  }
  const self = new URL(req.url);
  const target = new URL(safeReturnPath(self.searchParams.get("next")), self.origin);
  target.searchParams.set("bootstrap", opts.sessions.mintBootstrap(BOOTSTRAP_TTL_MS));
  return new Response(JSON.stringify({ url: target.toString(), expiresInSeconds: BOOTSTRAP_TTL_MS / 1000 }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
