# Browser Sessions and Actions (XR 5.1)

Governed browser automation. Uses the existing hardened Playwright integration —
no new browser harness was added.

## Two paths, one security posture

| Path | Entry | Context |
|---|---|---|
| Legacy/shared | `xr control browser …`, agent tools | Single shared context (XR ≤5.0 behavior, unchanged) |
| **Governed session** | `runEnvironmentAction` with `environment: "browser"` | **One isolated Playwright browser+context per environment session** |

Governed sessions are the default whenever actions go through the environment
layer. They never share cookies, storage, or downloads with other sessions or
with the legacy context.

## Session policy (per session)

```jsonc
// config.json → environment.browser (defaults shown)
{
  "allowedDomains": [],          // non-empty = strict allowlist (subdomains match)
  "blockedDomains": [],          // always refused (subdomains match)
  "blockPrivateNetworks": true,  // fail closed: localhost/RFC1918/link-local/.local
  "maxDownloadBytes": 52428800   // oversized downloads are deleted, never kept
}
```

Enforcement is layered and cannot be weakened by page content:

1. **Navigation:** `validateBrowserUrl` — protocol http/https only; private-network
   hostnames refused; allow/block lists applied.
2. **Redirects:** after `goto` settles, the FINAL url is re-validated; a redirect
   that escapes policy is reverted (`about:blank`) and the action fails.
3. **Sub-resources:** `context.route("**/*")` aborts requests to blocked/private
   hosts (trackers, beacons) — not just top-level navigation.
4. **Downloads:** saved into the session's own downloads root
   (`~/.xr/browser/<sessionId>/downloads`) only; a post-download size check
   deletes oversized files and records it.

## Sandbox and root behavior (unchanged, verified)

- Chromium launches with `--enable-sandbox` and `chromiumSandbox: true`.
- `--no-sandbox` requires explicit opt-ins: `XR_BROWSER_DISABLE_SANDBOX=1` +
  `XR_BROWSER_UNSAFE_ACK=1` (and `XR_BROWSER_ALLOW_ROOT=1` when running as root).
- Running as root without those flags fails closed with a secure message.
- `ignoreHTTPSErrors: false`, `bypassCSP: false`, no permissions granted.

## Credentials

XR 5.1 **never injects credentials** into browsers: no cookie import/export, no
HTTP credentials, no profile-state copying (`credentialMode: "none"` in every
session policy). Sites you log into manually in a headed session remain scoped
to that session and are destroyed on close.

## Semantic-first interaction

Browser actions use Playwright selectors — CSS, `text=…`, or role-based — which
are semantic, stable DOM interactions. Coordinate browser actions do not exist
in the governed contract at all (coordinate interaction is a desktop concern
with stronger gates). Extraction results are typed `untrusted_external`
evidence — they are data, never instructions.

## Observations, crash, and cleanup

- Every session navigation/mutation can be observed via
  `observeEnvironment({ source: "browser", sessionId })` → `{url, title, tabs, at}`
  with `confidence: "high"` (engine-sourced, not inferred).
- Renderer crashes mark the session `failed`; later actions fail closed.
  Crash + irreversible/unknown action ⇒ outcome `uncertain` (side effect unknown).
- `closeEnvironmentSession()` closes context + browser; cleanup state is recorded;
  cleanup defects quarantine the session.

## Limits

`maxActive` sessions (default 5), ≤8 tabs/session, ≤200 actions/session (then the
session auto-closes), idle sessions close after 5 minutes. All values come from
`environment.sessions` config and hard caps in `ENVIRONMENT_BOUNDS`.

## Failure handling

- Playwright missing → capability probe reports honestly; actions fail with the
  install remediation (`bun install && bunx playwright install chromium`).
- Selector timeouts/navigation timeouts → classified `retryable_reobserve` →
  at most ONE retry after a mandatory re-observation (see RECOVERY.md).
- Circuit breaker: 3 consecutive session failures → open for 60 s.
