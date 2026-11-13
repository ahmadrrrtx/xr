# XR Mobile — security model & threat model

Local-first means the threat model is *your house*, not the internet. This page
states what Phase 28 trusts, what it doesn't, and where every assumption can
break.

## 1. Invariants (non-negotiable)

1. **LAN access is opt-in.** `xr serve` binds `127.0.0.1`. Only `--lan`
   (or `XR_DAEMON_LAN=1`) binds `0.0.0.0`, and it says so loudly on stdout.
2. **Fail closed.** No session ⇒ no API. Wrong pairing code ⇒ generic 401 that
   reveals nothing (not even that LAN mode is on).
3. **No bearer tokens in web storage.** Auth is an HttpOnly, Secure,
   SameSite session cookie. Nothing sensitive is ever readable from JS.
4. **Mobile is not a coding surface.** Sessions carry `kind: 'mobile'`;
   `/files`, `/terminal`, `/shell`, `/git`, `/mcp` return 403 for them.
5. **Zero telemetry.** The only outbound connections are (a) your daemon,
   (b) browser push-service endpoints, (c) model providers the daemon already
   used. No analytics, no CDN after first load (the SW serves local assets).
6. **Push payloads are unreadable to Google/Apple.** Double encryption (§5).

## 2. Trust boundaries

```
 phone (PWA)  ──TLS (peer trust required)──▶  daemon (your machine)  ──▶ model providers
      │                                      │
      └──Web Push (ciphertext)──▶ FCM/APNS ──┘  (relay only; cannot decrypt)
```

- The **phone** relies on the browser/OS to authenticate the TLS peer; an
  app-reported fingerprint is not an independently verified certificate.
- The **daemon** trusts: its bearer token (desktop/CLI), paired-device cookies,
  and nothing else. `Origin: null` is accepted only with a valid paired cookie.
- **FCM/APNS** are untrusted couriers: they get ciphertext and metadata
  (endpoint, TTL) — never titles, bodies or approval ids in clear.

## 3. TLS identity: unresolved blocker

The LAN daemon generates a self-signed certificate. Browser JavaScript cannot
read the actual TLS peer certificate. The fingerprint endpoint and app code
come over the same connection and can be controlled by an impersonator. The
IndexedDB comparison detects changes to a *reported string* only; it is not
certificate pinning, and matching values do not authenticate the connection.

Do not bypass browser TLS warnings based on the app's displayed value. A
trusted certificate/independent verification mechanism and a complete threat
review are required before this flow can be claimed secure. Packaged-desktop
LAN and phone pairing are not yet implemented or verified.

## 4. Pairing

- 6-digit code, 10-minute TTL, single use, generated on demand (nothing sits
  waiting at boot).
- Rate-limited: 10 attempts/minute per source address.
- Wrong/expired code ⇒ 401 with a constant body. No oracle.
- Pairing binds a device record: name, pairing time, last seen, push
  subscription, the device's AES-GCM push key, and a recorded fingerprint (not TLS pinning).
- Session tokens are stored **hashed** (SHA-256) in `~/.xr/devices.json`
  (0600). A stolen registry cannot be replayed.
- Revocation rotates the stored hash, so the phone's cookie matches nothing on
  its very next request.

### Cookie deviation note

The brief specified `SameSite=None; Secure`. We ship `SameSite=Strict`:
strictly stronger, and correct here because the PWA and the API share an origin
(`https://<lan-ip>:3141/mobile/` → `/api/...`), including service-worker fetches.
`None` would only matter for cross-site contexts, which v1 never creates.

## 5. Push encryption (two layers)

1. **RFC 8291 / RFC 8188** (`aes128gcm`): ephemeral ECDH against the browser's
   `p256dh`, HKDF-SHA-256 key/nonce derivation, single record with the `0x02`
   delimiter. Cross-validated against the reference `web-push` package
   (`tools/test-web-push.mjs`).
2. **AES-GCM (AES-256)** with a key generated *on the phone* at pairing and sent
   once over the paired HTTPS channel. The inner plaintext
   `{title, body, approvalId, ts}` never exists in clear outside the two ends.

VAPID (ES256 JWT, 12h expiry) authenticates the daemon to the push service.
TTL 600s; the service worker additionally re-checks the approval and suppresses
notifications for anything already resolved or older than the TTL.

Subscription endpoints are validated against an allowlist
(`*.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`,
`web.push.apple.com`) so a compromised phone can't turn the daemon into an SSRF
proxy.

## 6. Endpoint gating

`mobileGate()` denies mobile sessions on:

```
/api/v1/files  /api/v1/terminal  /api/v1/shell  /api/v1/git  /api/v1/mcp
/files         /terminal         /shell         /git         /mcp
```

Desktop/CLI bearer sessions are unaffected. Gating is by session kind, not by
path guessing in the UI — the UI hiding a button is decoration, the daemon is
the control.

## 7. CSP served with the PWA

```
default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
media-src 'self' blob:; script-src 'self';
connect-src 'self' wss: https://*.googleapis.com https://*.push.apple.com
            https://updates.push.services.mozilla.com;
worker-src 'self'; manifest-src 'self'; font-src 'self' data:;
base-uri 'none'; form-action 'none'
```

Plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`frame-ancestors 'none'` (header). No eval, no remote scripts, no third-party
fonts. Production builds ship **no source maps**.

## 8. Residual risks (accepted, documented)

- **LAN impersonation:** the browser app cannot bind a server-reported
  fingerprint to the TLS peer. A malicious endpoint can repeat the reported
  value and serve malicious code; the existing comparison does not prevent it.
  This is an unresolved blocker, not an accepted mitigation.
- **Router-level clients see metadata:** SSID, IPs, ports, TLS handshake.
  Payloads remain encrypted; approval text never appears in clear on the wire.
- **Awake-desktop requirement:** push and chat need the daemon up. Chosen
  honestly over running a relay we'd have to trust.
- **Shared device risk:** the session cookie lives in the browser profile.
  Lock your phone; revoke from desktop if it's lost.

## 9. Audit checklist (run before merging)

- [ ] `xr serve` without `--lan` → loopback only (`ss -ltnp | grep 3141`).
- [ ] `--lan` binds 0.0.0.0 **with TLS**, prints warning + fingerprint.
- [ ] Pairing: single-use, 10-min TTL, 10/min rate limit, generic 401.
- [ ] Revoke ⇒ next request 401; device gone from the list.
- [ ] Mobile session ⇒ 403 on files/terminal/git/mcp; desktop ⇒ not 403.
- [ ] Cookie flags: HttpOnly, Secure, SameSite.
- [ ] Push payload ciphertext-only to the vendor (test asserts this).
- [ ] No telemetry endpoints in `grep -ri "analytics\|telemetry" mobile/src`.
- [ ] `dist/` has no `.map` files.
