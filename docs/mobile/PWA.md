# XR Mobile PWA — setup, pairing, LAN mode

> **Preview candidate:** The packaged desktop has an opt-in mobile listener
> implementation, but native packaging CI and a real phone journey remain
> unverified. A CA-issued certificate whose hostname is trusted by the phone
> is required. Never bypass browser TLS warnings based on the app's displayed
> fingerprint: it is not certificate pinning. See [security model](SECURITY.md).

XR on your phone is a **companion**, not a second desktop: chat, push-to-talk,
approvals and budget. It talks to the XR daemon running on your computer over
your own WiFi. There is no XR cloud, no relay, no sync server.

> The v1 promise: *if your phone is on the same WiFi as your running XR desktop,
> XR is a tap away. Otherwise XR is offline, and honest about it.*

---

## 1. What ships

| Piece | Where |
| --- | --- |
| Mobile PWA (React 18 + Vite + Workbox) | `mobile/` — its own package.json, its own build |
| Daemon LAN mode (`xr serve --lan`) | `src/cli/serve-lan.ts`, `src/daemon/lan-tls.ts` |
| Pairing, sessions, endpoint gating | `src/daemon/mobile-pairing.ts`, `src/daemon/mobile-devices.ts` |
| Companion API (models / budget / approvals / chats / chat SSE) | `src/daemon/routes/mobile-companion.routes.ts` — one wire-form adapter over the desktop surfaces |
| Companion chat store (mobile-scoped sync) | `src/daemon/mobile-chats.ts` (`~/.xr/mobile-chats.json`, 0600, bounded) |
| PWA static serving (`/mobile/`) | `src/daemon/routes/mobile-companion.routes.ts` (LAN mode; `XR_MOBILE_DIST` overrides the `mobile/dist` location for packaged layouts) |
| Web Push (VAPID + double encryption) | `src/daemon/web-push.ts` |
| Desktop Settings → Mobile | Explicit opt-in candidate; trusted TLS setup required |
| Reference daemon (test harness) | `tools/reference-daemon.mjs` |

The daemon serves the built PWA from `/mobile/` when in LAN mode, so the phone
needs nothing but a browser and your WiFi. The shell is static and loads
before pairing; every data endpoint (`/api/mobile/*`) requires a paired
session. Chat sends run through the same execution path as the desktop
(`/api/chat` — preflight, lane serialization, durable approvals), and a
provider that is offline answers 503 honestly on the phone.

## 2. Build & run

```bash
# mobile app
npm --prefix mobile install
npm --prefix mobile run build          # → mobile/dist, no source maps
npm --prefix mobile run typecheck      # strict TS, no any

# daemon, loopback only (unchanged default — nothing new happens)
xr serve

# daemon, opt-in LAN mode
xr serve --lan                         # or XR_DAEMON_LAN=1
```

On first `--lan` start the daemon:

1. generates an ECDSA P-256 self-signed cert (`~/.xr/certs/lan.{key,crt}`) valid
   for your LAN IPs, hostname and `.local` name — reused on later runs;
2. generates VAPID keys once (`~/.xr/vapid.json`);
3. binds **0.0.0.0:3141 over TLS** and prints a loud warning, the LAN URL and
   the certificate fingerprint.

Without the flag the daemon binds `127.0.0.1` exactly as before. There is no
code path that opens the LAN listener silently.

## 3. Packaged desktop: pairing candidate

1. Provision a CA-issued server certificate and private key for an address
   that your phone resolves to this computer. Configure the phone to trust its
   CA through an independent, secure process. XR does **not** provision or
   install a CA, certificate or DNS record, and cannot tell if your phone trusts it.
2. Open **Settings → Mobile → Allow mobile access**. The screen shows the
   desktop-specific directory; put the PEM certificate chain in `cert.pem`
   and its private key in `key.pem`. On Unix the key must be owner-only
   (`chmod 600`). Enter the certificate's matching hostname or IPv4 address,
   confirm the trust prerequisite and select **Enable mobile access**.
3. XR validates the key, validity and hostname, rejects self-signed leaves,
   and starts a separate TLS listener. Only private/link-local/loopback IPv4
   peers are accepted; other reachable private networks or VPNs may also
   reach it. Do not port-forward the listener.
4. Use **Pair new device** and open the QR/link on your phone. The browser/OS
   must validate the connection without a warning. **Do not bypass a browser
   warning**: the PWA's reported fingerprint cannot authenticate TLS.
5. Disable mobile access in Settings to close the listener and invalidate an
   unused code; paired-device revocation is available on the same card. The
   listener also stops when the app-owned engine exits. Device and push data
   belong to the desktop XR home, not the separate CLI home.

This is a candidate with automated loopback TLS coverage, not a tested
installed-desktop-to-physical-phone journey. CA provisioning, local DNS,
firewall, router isolation and device-specific browser trust remain owner work.
The older standalone `xr serve --lan` self-signed flow is distinct and does
not provide independently authenticated TLS by itself.

## 4. Offline behaviour

- App shell, last 50 chats, 200 messages per chat and 200 approvals are cached
  (IndexedDB + Workbox precache); LRU-evicted past 20 MB.
- Offline: cached data renders, a red bar says *Offline — showing cached data*,
  sends and approval decisions queue locally with a ⌛ indicator.
- Back online: the outbox replays FIFO (Background Sync when the app is closed,
  foreground drain when open) and indicators resolve to delivered.
- Approvals can't be decided offline — buttons say so instead of pretending.

## 5. Push notifications

- Browser-native Web Push only. The daemon POSTs straight to FCM/APNS/Mozilla
  push endpoints; nothing of yours passes through an XR server.
- Payloads are encrypted twice: RFC 8291/8188 for transport, then AES-GCM with a
  key generated on the phone — so the push vendor relays ciphertext it cannot
  read.
- TTL is 10 minutes and the service worker re-checks the approval before
  showing anything, so already-resolved approvals stay quiet.
- Honest limitation: **push needs your desktop awake and running**. If it's
  asleep, nothing is sent — the app says so in Settings.

## 6. Known limitations (by design, v1)

- No cloud relay / cellular access. Wrong WiFi ⇒ offline mode.
- No code editing, terminal, git or MCP from mobile — those endpoints return
  403 for mobile sessions. View and copy only.
- No file attachments yet (paperclip is intentionally disabled).
- No TTS playback of replies; voice is push-to-talk → transcript → chat.
- PWA install only (Add to Home Screen / Install). No store builds yet.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| TLS warning on the phone | Stop: the app cannot authenticate the TLS peer from the displayed fingerprint. Use an independently trusted certificate/verification mechanism. |
| "Unrecognised XR certificate" | The server-reported value changed. This is not proof of the actual certificate; verify independently. |
| App stuck on pairing screen | Code expired (10 min) or was used. Generate a new one on the desktop. |
| Phone can't reach the LAN URL | Different network, client isolation on the router, or the desktop firewall. `xr serve` without `--lan` is loopback-only. |
| Push never arrives | Desktop asleep/offline, or notifications denied in phone settings. Settings → Notifications shows the state. |
| "Not available on mobile" (403) | Correct — files/terminal/git/MCP stay on desktop and CLI. |
| Chat send answers 503 "Provider offline" | Honest state — the phone never fabricates a reply. Start/configure the provider the desktop uses. |
| "mobile/dist absent" page at `/mobile/` | The PWA build isn't next to the daemon. Build it (`npm --prefix mobile run build`) or point `XR_MOBILE_DIST` at the packaged layout. |

## 8. Dev workflow

```bash
npm --prefix tools install      # once — harness deps (Node 22.12+ for puppeteer 25; never part of the shipped package)
npm --prefix mobile run dev     # Vite on 127.0.0.1:5180, proxies /api to :3141
npm run mobile:daemon:build     # bundle the daemon TS modules for the harness
bun run mobile:test             # guarded preflight (tools deps + daemon build) → web-push, lan-flow, offline suites
bun run mobile:screenshots      # evidence captures of the shipped PWA (needs the reference daemon + XR_DAEMON_TOKEN)
npm run mobile:daemon:lan       # full route surface + demo data (boot banner prints the token)
npm run mobile:test:lan         # pairing/gating/revocation assertions   (needs XR_DAEMON_TOKEN)
npm run mobile:test:push        # RFC 8291/8188 cross-check vs web-push
npm run mobile:test:offline     # SW install, offline render, queue drain (needs XR_DAEMON_TOKEN)
npm run mobile:screenshots      # → previews/implementation/phase-28/
node tools/bundle-report.mjs    # gzip budget gate
```
