/**
 * XR Phase 8 · T3 — accessible sign-in page for the Control Center.
 *
 * WCAG 2.2 · 3.3.8 (Accessible Authentication, AA): authentication must not
 * rely on a cognitive-function test. The XR local-token flow qualifies via
 * the copy-paste path — the answer must never *require* transcription, so
 * this page:
 *   · uses <input type="password"> so password managers and paste both work
 *     (paste is never intercepted or blocked);
 *   · offers a show/hide toggle so the token can be verified visually;
 *   · carries full labels, instructions, and an error announced via
 *     role="alert";
 *   · XR-LAUNCH-018: the form POSTs the token in the request body to
 *     /auth/login (src/daemon/session-auth.ts), which sets the same HttpOnly
 *     SameSite=Strict session cookie as the `?token=` bootstrap and redirects
 *     back to the deep link (hidden `next` field). The token never enters the
 *     URL, history or referrers. The page tells the user where the token is
 *     (`<XR home>/daemon/token`, owner-only, written by the running daemon),
 *     so a hidden banner token is no longer a dead end. No token is ever
 *     rendered into the HTML, and the JSON 401 contract for API clients is
 *     unchanged.
 */

import { esc } from "../util/html-escape.ts";

/**
 * Generate a fresh per-response CSP nonce. 18 bytes (144 bits) base64-encoded
 * matches OWASP's recommendation (≥128 bits). Uses WebCrypto (Bun's
 * `globalThis.crypto`), which is the same source as `xr SessionToken` etc.
 * Each call returns a new nonce — never reuse a nonce across responses.
 */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  // Base64 without padding — CSP nonces tolerate either form, and trimming
  // keeps the header smaller for the inline `<style nonce="…">` mirror.
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}

/**
 * Accessible 401 sign-in page.
 *
 * Phase 31 · Bucket A follow-up: the inline `<style>` block now carries a
 * per-response `nonce` that the response's CSP also names — replacing the
 * previous `style-src 'unsafe-inline'` carve-out. The page is still
 * self-contained (no external stylesheet) and `script-src 'self'` remains
 * the only script posture (the auth behaviour is the external `/assets/auth.js`).
 *
 * @param returnPath deep link the user originally asked for
 * @param nonce      per-response CSP nonce (from `generateCspNonce()`);
 *                   REQUIRED — calling without one throws (fail-closed).
 * @param failed     true after a wrong token was submitted (different alert).
 */
export function authPageHtml(returnPath = "/", nonce?: string, failed = false): string {
  if (!nonce) throw new Error("authPageHtml: a per-response CSP nonce is required");
  // The login POST redirects back to the URL the user originally asked for.
  const next = returnPath.startsWith("/") && !returnPath.startsWith("//") && !returnPath.startsWith("/\\") ? returnPath : "/";
  const alert = failed
    ? "That token did not match the running daemon. The token changes every time <code>xr serve</code> starts — copy it again from the token file."
    : "A valid access token is required to continue. If you followed an old link, the daemon may have restarted with a new token — paste the current one below.";
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Sign in — XR Control Center</title>
<style nonce="${nonce}">
:root { color-scheme: dark; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  background: #020817; color: #F8FAFC;
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 14px; line-height: 1.6; padding: 24px;
}
main {
  width: 100%; max-width: 420px;
  background: #0B1120; border: 1px solid #5C7194; border-radius: 16px;
  padding: 32px;
}
.logo { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 4px; }
.logo span { color: #00D4FF; }
h1 { font-size: 17px; margin-bottom: 8px; }
p.desc { color: #94A3B8; font-size: 12.5px; margin-bottom: 20px; }
p.desc code { font-family: 'JetBrains Mono', 'Fira Code', monospace; background: #151E33; padding: 1px 6px; border-radius: 4px; color: #00D4FF; }
label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94A3B8; margin-bottom: 6px; }
.field { display: flex; gap: 8px; margin-bottom: 8px; }
input[type="password"], input[type="text"] {
  flex: 1; background: #070A13; border: 1px solid #5C7194; border-radius: 8px;
  padding: 10px 12px; color: #F8FAFC; font-family: 'JetBrains Mono', monospace; font-size: 13px;
}
input:focus { border-color: #00D4FF; outline: none; box-shadow: 0 0 0 1px rgba(0,212,255,0.25); }
:focus-visible { outline: 2px solid #00D4FF; outline-offset: 2px; }
button.reveal {
  background: #151E33; color: #94A3B8; border: 1px solid #5C7194; border-radius: 8px;
  padding: 8px 12px; font-size: 12px; cursor: pointer; min-width: 64px; min-height: 24px;
}
button.reveal:hover { color: #00D4FF; border-color: #00D4FF; }
p.hint { font-size: 11.5px; color: #7A8FB0; margin-bottom: 18px; }
button.submit {
  width: 100%; background: #00D4FF; color: #001018; border: none; border-radius: 8px;
  padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; min-height: 44px;
}
button.submit:hover { filter: brightness(1.1); }
.error {
  border-left: 3px solid #FF4D4D; background: rgba(255,77,77,0.08);
  color: #FF4D4D; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; margin-bottom: 16px;
}
.footnote { margin-top: 18px; font-size: 11px; color: #7A8FB0; text-align: center; }
</style>
</head>
<body>
<main>
  <div class="logo" aria-hidden="true">▀▄▀ <span>XR</span></div>
  <h1>Sign in to Control Center</h1>
  <p class="desc">
    This dashboard is local-only and protected by the daemon's access token.
    The running daemon keeps it in a file only your user can read:
    <code>~/.xr/daemon/token</code> (or <code>$XR_HOME/daemon/token</code>) —
    run <code>cat ~/.xr/daemon/token</code>, or on Windows
    <code>type %USERPROFILE%\\.xr\\daemon\\token</code>. You can also print it on a
    private terminal with <code>XR_PRINT_TOKEN=1 xr serve</code>; the packaged
    desktop app opens its own session. Paste it below — from the clipboard
    (Ctrl+V / ⌘V); paste is never blocked.
  </p>
  <div class="error" role="alert">
    ${alert}
  </div>
  <form method="post" action="/auth/login">
    <input type="hidden" name="next" value="${escapeAttr(next)}"/>
    <label for="token">Access token</label>
    <div class="field">
      <input id="token" name="token" type="password" autocomplete="off" spellcheck="false"
             required autofocus aria-describedby="token-hint"/>
      <button type="button" class="reveal" id="reveal" aria-pressed="false" aria-label="Show access token">Show</button>
    </div>
    <p class="hint" id="token-hint">The token is case-sensitive and contains no spaces.</p>
    <button class="submit" type="submit">Sign in</button>
  </form>
  <p class="footnote">Local-first: this page is served by your own machine. Nothing is sent anywhere else.</p>
</main>
<script src="/assets/auth.js" defer></script>
</body>
</html>`;
}

// Phase 31 · A2 — attribute escaping uses the canonical esc() (it also
// covers `>` and `'`, which the hand-rolled copy here used to miss).
const escapeAttr = esc;

/**
 * Show/hide-token behaviour for the sign-in page. Served as an EXTERNAL
 * asset (script-src 'self', never inline) — the same CSP posture as the
 * Control Center assets. It is also the one asset reachable without
 * authentication (the sign-in page needs it before any session exists).
 * It contains no data, no endpoints, no secrets — static behaviour only.
 */
export const AUTH_PAGE_SCRIPT = `
(function () {
  var input = document.getElementById("token");
  var btn = document.getElementById("reveal");
  if (!input || !btn) return;
  btn.addEventListener("click", function () {
    var show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", show ? "true" : "false");
    btn.setAttribute("aria-label", (show ? "Hide" : "Show") + " access token");
    input.focus();
  });
})();
`;

/**
 * Content-Security-Policy template for the sign-in page.
 *
 * `style-src 'nonce-{NONCE}'` allows the inline `<style nonce="…">` block
 * and NOTHING else — no `unsafe-inline`, no `unsafe-hashes`. The placeholder
 * is substituted per-response by `authPageCSP(nonce)`; never ship this string
 * verbatim (a literal `{NONCE}` in a CSP header fails open in some browsers).
 *
 * No inline scripts (the auth behaviour is the external `/assets/auth.js`).
 */
export const AUTH_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'nonce-{NONCE}'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/**
 * Per-response CSP for the sign-in page. Substitutes the nonce into the
 * template; the nonce MUST match the `<style nonce="…">` attribute on the
 * rendered page (callers must use the same nonce for both).
 */
export function authPageCSP(nonce: string): string {
  if (!nonce) throw new Error("authPageCSP: a per-response nonce is required");
  // Reject any character that would break out of the CSP directive value.
  // (generateCspNonce only ever emits base64[A-Za-z0-9+/], but this guard is
  // cheap and protects against future callers that pass a hand-rolled nonce.)
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error("authPageCSP: nonce contains invalid characters");
  }
  return AUTH_PAGE_CSP.replace("{NONCE}", nonce);
}
