# XR Mobile PWA — setup, pairing, LAN mode

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
| Web Push (VAPID + double encryption) | `src/daemon/web-push.ts` |
| Desktop Settings → Mobile card | `desktop/src/components/settings/MobileCard.tsx` |
| Reference daemon (test harness) | `tools/reference-daemon.mjs` |

The daemon serves the built PWA from `/mobile/` when in LAN mode, so the phone
needs nothing but a browser and your WiFi.

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

## 3. Pairing a phone

1. Desktop: **Settings → Mobile → Pair new device** → QR + 6-digit code +
   fingerprint (code lives 10 minutes, one use).
2. Phone: open `https://<lan-ip>:3141/mobile/` in Safari/Chrome. The browser
   warns about the certificate — expected. Compare the fingerprint the phone
   shows with the one on your desktop screen, then tap **Visit Website**.
3. The app reads `?code=&fp=` from the QR, shows the fingerprint again and asks
   you to confirm: **They match — Pair**.
4. Pairing mints a device session (HttpOnly `xr_session` cookie), registers the
   device in `~/.xr/devices.json` and pins the cert fingerprint on the phone.

Manual fallback: the pairing screen has a 3-field form (address, code,
fingerprint) if the QR won't scan.

Unpairing: desktop **Settings → Mobile → revoke** (the phone's cookie stops
working on its next request), or phone **Settings → Unpair this device**.

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
| TLS warning on the phone | Expected — self-signed. Verify the fingerprint against your desktop before pairing. |
| "Unrecognised XR certificate" | The cert changed (regen/rotate) or something is impersonating XR. Only continue if you rotated it yourself. |
| App stuck on pairing screen | Code expired (10 min) or was used. Generate a new one on the desktop. |
| Phone can't reach the LAN URL | Different network, client isolation on the router, or the desktop firewall. `xr serve` without `--lan` is loopback-only. |
| Push never arrives | Desktop asleep/offline, or notifications denied in phone settings. Settings → Notifications shows the state. |
| "Not available on mobile" (403) | Correct — files/terminal/git/MCP stay on desktop and CLI. |

## 8. Dev workflow

```bash
npm --prefix tools install      # once — harness deps (Node 18+; never part of the shipped package)
npm --prefix mobile run dev     # Vite on 127.0.0.1:5180, proxies /api to :3141
npm run mobile:daemon:build     # bundle the daemon TS modules for the harness
npm run mobile:daemon:lan       # full route surface + demo data (boot banner prints the token)
npm run mobile:test:lan         # pairing/gating/revocation assertions   (needs XR_DAEMON_TOKEN)
npm run mobile:test:push        # RFC 8291/8188 cross-check vs web-push
npm run mobile:test:offline     # SW install, offline render, queue drain (needs XR_DAEMON_TOKEN)
npm run mobile:screenshots      # → previews/implementation/phase-28/
node tools/bundle-report.mjs    # gzip budget gate
```
