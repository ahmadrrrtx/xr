/**
 * XR Phase 31 · Bucket A (A1 + A6) — security headers + CORS for every daemon
 * HTTP response.
 *
 * Applied once, in `makeHandler`'s outer handler, so NO response can bypass
 * it: dashboard HTML, JSON APIs, SSE, static assets, redirects, the auth
 * page, and error responses all pass through here.
 *
 * Policy summary:
 *   · API (non-HTML) responses get the strict `default-src 'none'` CSP —
 *     they are never rendered as documents, so they need no script/style/img.
 *   · Dashboard HTML gets the dashboard CSP from the Phase 31 spec. Note
 *     `style-src 'unsafe-inline'` is required by the pre-auth sign-in page's
 *     inline <style>; scripts stay `'self'`-only (the dashboard client and
 *     the auth behaviour script are external assets, never inline).
 *   · HSTS is emitted ONLY for https requests (LAN mode, Phase 28) — sending
 *     it on http://127.0.0.1 would poison the loopback origin in browsers.
 *   · CORS is never `*`. An Origin is reflected only when it exactly matches
 *     the request's own host (the dashboard/PWA served from this daemon);
 *     otherwise no CORS headers are sent and browsers block cross-origin
 *     reads, which is the desired local-first posture.
 */

export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export const DASHBOARD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; " +
  "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

const API_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), interest-cohort=()";
// Camera/microphone are `self` on dashboard HTML only: the voice/vision
// panels invoke them from this origin, still behind the browser's own
// permission prompt, and the daemon binds loopback (or paired LAN) only.
const DASHBOARD_PERMISSIONS_POLICY = "camera=(self), microphone=(self), geolocation=(), interest-cohort=()";

export const SECURITY_TXT_URL = "https://xr.rrrtx.ai/.well-known/security.txt";

/** Is this request being served over HTTPS (LAN TLS mode)? */
export function isHttpsRequest(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === "https:") return true;
  } catch {
    /* fall through to the proxy header */
  }
  // LAN mode may sit behind the daemon's own TLS terminator; Bun sets the
  // URL protocol itself, so this is only a belt-and-braces fallback.
  return req.headers.get("x-forwarded-proto") === "https";
}

/**
 * Return a copy of `res` with the Phase 31 security headers applied.
 * Existing, more specific headers on the response win where the spec allows
 * variance (e.g. a binary asset's `Cache-Control: private, max-age=…`, an
 * SSE stream's `no-cache`); CSP / framing / sniffing headers always win.
 */
export function applySecurityHeaders(res: Response, req: Request): Response {
  const contentType = res.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");
  const headers = new Headers(res.headers);

  // A route-level CSP wins: the dashboard's Phase-4 CSP is stricter than
  // this floor (external assets, no 'unsafe-inline') and the sign-in page
  // carries its own tuned policy. Everything else gets the floor for its
  // class — strict 'none' for APIs, the dashboard policy for other HTML.
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", isHtml ? DASHBOARD_CSP : API_CSP);
  }
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", isHtml ? DASHBOARD_PERMISSIONS_POLICY : API_PERMISSIONS_POLICY);

  if (isHtml) {
    headers.set("cross-origin-opener-policy", "same-origin");
    headers.set("cross-origin-resource-policy", "same-origin");
  }

  // Cache: APIs and HTML are never stored. Assets/SSE keep the cache policy
  // their handlers chose (brand PNGs are explicitly cacheable; SSE is
  // already `no-cache`).
  const isSse = contentType.includes("text/event-stream");
  if (!isSse && (isHtml || contentType.includes("application/json") || !headers.has("cache-control"))) {
    headers.set("cache-control", "no-store");
  }

  if (isHttpsRequest(req)) {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }

  applyCorsHeaders(headers, req);

  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * A6 — reflect the Origin only on an exact own-host match. Exported for
 * tests; never emits `*`, never reflects a foreign origin.
 */
export function applyCorsHeaders(headers: Headers, req: Request): void {
  const origin = req.headers.get("origin");
  if (!origin) return;
  try {
    const o = new URL(origin);
    const self = new URL(req.url);
    if (o.host === self.host && (o.protocol === "http:" || o.protocol === "https:")) {
      headers.set("access-control-allow-origin", origin);
      headers.append("vary", "Origin");
    }
  } catch {
    /* unparseable Origin → omit CORS entirely (fail closed) */
  }
}
