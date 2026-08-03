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
 *   · keeps the Phase-4 security contract exactly: the ONLY authentication
 *     path remains `GET <path>?token=…` → one-time bootstrap → HttpOnly
 *     SameSite=Strict session cookie. This page merely GETs the current URL
 *     with the token parameter. No token is ever stored in the HTML, and the
 *     JSON 401 contract for non-browser clients is unchanged
 *     (test/daemon/security tests pin both).
 */

/** Accessible 401 sign-in page (no external assets; CSP allows inline style only). */
export function authPageHtml(returnPath = "/"): string {
  // The form GETs the URL the user originally asked for, preserving deep links.
  const action = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Sign in — XR Control Center</title>
<style>
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
    This dashboard is local-only and protected by the access token XR printed
    when the daemon started (run <code>xr serve</code> to see it again, or
    copy it from the terminal). Paste it below — you can paste from the
    clipboard (Ctrl+V / ⌘V); paste is never blocked.
  </p>
  <div class="error" role="alert">
    A valid access token is required to continue. If you followed an old
    link, the one-time token may already have been exchanged for a session —
    paste the token again below.
  </div>
  <form method="get" action="${escapeAttr(action)}">
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

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

/** Content-Security-Policy for the sign-in page: no inline scripts, self-only assets. */
export const AUTH_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
