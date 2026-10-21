# Phase 2.4 — DESIGN (written before code; fleshed out during build)

## 1. Data flow

```
runServeCommand(args: ["--lan"]?) ──► parseLanFlag({lan:"--lan"∈args}) (+ XR_DAEMON_LAN=1)
    │ false                                │ true
    ▼                                      ▼
serve({port}) ───────────────► serve({port, lan:true})
                                       │ prepareLan(port) → cert(PEM)+fingerprint+VAPID  (throw→non-zero)
                                       ▼
makeHandler(store, token, {lanRuntime: {fingerprint, lanUrl, port, vapidPublicKey, sendTestPush}})?
      dispatch(req):
        Host gate 421           ── extends allow-set: allowedDaemonHosts(env, lanHosts=lanAddresses())
        security.txt 308
        auth: authorizeRequest ─┬ bearer → OK (desktop/CLI; never mobile-gated)
                                ├ desktop cookie (bootstrap; Secure iff LAN-TLS) → OK
                                ├ denied ─► LAN? resolveSession(): paired-device cookie → auth.kind="mobile"
                                │           open mobile paths (fingerprint GET /api/mobile/* prefix) → anonymous mobile ctx
                                │           else → 401 (unchanged behavior)
        CSRF/origin gate: "session" kind → server rule (unchanged); "mobile" kind → mobile-pairing.originAllowed (Origin:null ok w/ device)
        rate-limit (unchanged) / STRICT_PAIRING (already contains /api/mobile/pair)
        body caps (unchanged)
        mobileGate(canonicalPath, session) → 403 wall (canonical-aware: closes /api/files… legacy hole)
        router: routes = [ ...mobileRoutes, ...listBaseRoutes(), meta ]  → createDaemonRouter
Bun.serve: lan ? {hostname:"0.0.0.0", port, tls:{key,cert}} : {hostname:resolveBindHost(), port}
  banner: lan ? printLanBanner(bound) : existing loopback banner
```

## 2. Route census (11 path×method, 8 paths; measured in mobile-pairing.ts:263-460)

| Op id | Path (canonical) | Method | Auth | v1 strict |
|---|---|---|---|---|
| mobile.certFingerprint.get | /api/mobile/cert-fingerprint | GET | public (TOFU) | (no body) |
| mobile.pair.post | /api/mobile/pair | POST | public-attempt + 10/min; cookie out | yes |
| mobile.session.delete | /api/mobile/session | DELETE | paired|bearer | yes |
| mobile.devices.list.get | /api/mobile/devices | GET | bearer/cookie only | — |
| mobile.devices.revoke.post | /api/mobile/devices/{id}/revoke | POST | bearer/cookie only | yes |
| mobile.devices.pushTest.post | /api/mobile/devices/{id}/push-test | POST | bearer/cookie only | yes |
| mobile.pairQr.post | /api/mobile/pair-qr | POST | bearer/cookie only | yes |
| mobile.push.vapidPubkey.get | /api/mobile/push/vapid-pubkey | GET | paired|bearer | — |
| mobile.push.subscribe.post | /api/mobile/push/subscribe | POST | paired device | yes |
| mobile.push.subscribe.delete | /api/mobile/push/subscribe | DELETE | paired device | yes |
| mobile.push.test.post | /api/mobile/push/test | POST | paired device | yes |

Registry ops: 272 → 283. Only certFingerprint has ` public: true` → OpenAPI `security: []`. Both mounts (`/api/v1/mobile/...`, legacy `/api/mobile/...`) dispatch to the same routes; legacy gets normal deprecation headers; mobile module still 404/401-honest when LAN is off via a route-group live-check, preserving the default-serve 404 posture.

## 3. Session matrix (LAN on)

| path | anon | bearer | desktop cookie | mobile cookie |
|---|---|---|---|---|
| cert-fingerprint GET | 200 | 200 | 200 | 200 |
| cert-fingerprint GET (LAN off) | 404 ✓ (handleMobileRoutes keeps) | same | same | same |
| pair POST | 200 + Secure cookie | 200 | 200 | 401 (code consumed) |
| pair-qr POST | 401 | 200 | 200 | 401 (desktop-only per handler) |
| chats GET (v1) | 401 | 200 | 200 | 200 truthful array shape |
| files/terminal/git/mcp (either mount) | 401 | 200/404 normal | 200/404 | **403** |
| session DELETE | 401 | 204 | 204 | 204 (self-revoke) |
| devices GET / revoke / push-test | 401 | 200 | 200 | 403 |
| vapid-pubkey GET | 401 | 200 | 200 | 200 |
| push subscribe POST/DELETE | 401 | 401 | 401 | 200 |
| push test POST | 401 | 401 | 401 | 200 (honest {ok:false} offline) |
| health GET | 200 | 200 | 200 | 200 |

## 4. Cookie matrix

- loopback HTTP bootstrap `xr_session`: `HttpOnly; SameSite=Strict; Max-Age=86400` (unchanged; **no Secure** — loopback keeps working)
- LAN TLS bootstrap: identical **+ `; Secure`** (+§15#10 fix, conditional on active TLS listener)
- paired mobile `xr_session`: `HttpOnly; Secure; SameSite=Strict` (unchanged)

## 5. Matching-deduction plan (A10; start src/ = 171,999)

Additions (estimate): mobile.routes.ts ~60 · contract-mobile.ts ~20 · schemas-mobile.ts ~16 · server.ts seam ~70 · cli ~12 · openapi/contract/registry glue ~10 · serve-lan.ts edits ±0 ⇒ **~188**
Deductions (same-area, census-backed):
- `serve-lan.ts`: outdated `startLanServer` integration example (doc, ~15), unused `printPairingUrl` (census: 0 refs, −13), `/mobile/` PWA banner line (unowned route — see PWA audit result below, −1)
- `mobile-pairing.ts`: legacy-alias entries in DANGEROUS_PREFIXES superseded by canonical gating (−1..5), dense section-banner compression (−25)
- `lan-tls.ts`, `web-push.ts`, `mobile-devices.ts`: dense comment/section-banner compression, citations kept (−60)
- `server.ts` (touched): bind/API doc compressions, Phase refs kept (−30)
Expected net ≈ **0** → end ≤ 171,999. Citation rule: never delete phase/article references, only prose density.

## PWA /mobile/ audit (OUT rule)

`tools/reference-daemon.mjs:391` serves a static `/mobile` PWA (reference-only, self-commented). No shipping route owns it (`grep -rn "'/mobile" src/daemon/routes/*.ts` = none). `printLanBanner`'s `Mobile app … /mobile/` line would therefore be a false shipping claim → **removed** (scaffolding edit); the real mobile app (mobile/ Expo project) is a separate artifact; banner instead points at the pairing URL/Desktop settings card.
