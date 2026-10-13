# Phase 28 — implementation plan (as built)

## Daemon (opt-in LAN, fail closed)

| Module | Responsibility |
| --- | --- |
| `src/daemon/lan-tls.ts` | Zero-dep DER writer: ECDSA P-256 self-signed cert (SAN = LAN IPs + hostname + `.local` + localhost), stored `~/.xr/certs/lan.{key,crt,pubkey-fingerprint.sha256}`, SHA-256 fingerprint exposed. openssl-verifiable (`openssl verify -CAfile` OK). |
| `src/daemon/mobile-devices.ts` | `~/.xr/devices.json` (0600). Tokens stored hashed; revoke rotates hash; push key + subscription per device. |
| `src/daemon/mobile-pairing.ts` | 6-digit on-demand codes (10-min TTL, single use), 10/min rate limit, generic 401s, cookie mint/clear, `deviceKind` sessions, `mobileGate()` 403s, strict Origin check with `null`-origin exception for paired sessions, `handleMobileRoutes()` mount point. |
| `src/daemon/web-push.ts` | VAPID (ES256) + RFC 8291/8188 aes128gcm + inner AES-GCM layer; endpoint allowlist; 600 s TTL; fan-out helper. |
| `src/cli/serve-lan.ts` | `--lan` / `XR_DAEMON_LAN=1` parsing, `prepareLan()`, `bunTlsOptions()`, loud banner, pairing URL. Loopback path untouched. |

Routes added: `POST /api/mobile/pair`, `GET /api/mobile/cert-fingerprint`,
`GET|DELETE /api/mobile/session`, `GET /api/mobile/devices`,
`POST /api/mobile/devices/:id/revoke`, `POST .../push-test`,
`POST /api/mobile/pair-qr`, `GET /api/mobile/push/vapid-pubkey`,
`POST|DELETE /api/mobile/push/subscribe`, `POST /api/mobile/push/test`.
Static: `/mobile/*` served from `mobile/dist` with the PWA CSP.

## Mobile PWA (`mobile/`)

```
src/
  api/client.ts        fetch + SSE parser (token/tool/done/error), ApiError taxonomy
  lib/                 certpin, clipboard, format, haptics, highlight, idb, push, sync, theme
  stores/              nav (iOS stack), chats, approvals, connection, queue, settings, toasts
  components/          TabBar, Screen, Stack (swipe-to-pop), Sheet/ActionSheet,
                       PullToRefresh, Composer, MessageBubble, Markdown, CodeBlock,
                       Orb, Wordmark, Overlays (offline bar/toasts/update/install), ui primitives
  screens/             ChatList, Conversation, Voice, Approvals, Settings, Pairing
  sw.ts                Workbox precache + SWR API cache + NetworkOnly writes/probes,
                       push handler (double decrypt, TTL + resolved suppression,
                       notification click routing, app badge), Background Sync drain
  main.tsx / App.tsx   boot, SW registration with update banner, deep links
```

Navigation: 4 tabs, per-tab stacks; push slides from right; sheets slide up and
drag-to-dismiss; left-edge swipe pops. Safe areas via `env(safe-area-inset-*)`
utilities; every interactive control ≥44 px.

## Verification actually run in this sandbox

| Suite | Result |
| --- | --- |
| `tools/test-web-push.mjs` | 6/6 — web-push ciphertext decrypts with our RFC 8188/8291 reader; round-trip; double-layer; tamper → auth fail |
| `tools/test-lan-flow.mjs` | 25/25 — 401 unpaired, fingerprint public, QR+code, single-use, generic 401 on wrong code, cookie flags, reads OK, 403 on files/terminal/git/mcp, desktop not gated, endpoint allowlist, revoke→401, rate limit |
| `tools/test-offline.mjs` | 12/12 — SW install/scope/precache, IDB chat cache, offline render + red bar, cached rows, queued send + ⌛, drain on reconnect |
| `tools/bundle-report.mjs` | critical 132.5 KB gz, total 179.4 KB gz |
| `mobile` typecheck | strict, 0 errors (app + SW + config) |
| screenshots | 11 PNGs with content assertions (QR 560px rendered, sheet open, theme flip) |

## Known follow-ups (not v1)

- mDNS `_xr._tcp.local` advertisement.
- Real STT wiring in the shipping daemon (reference daemon echoes transcripts).
- TTS playback, attachments, widgets, native shells.
- Graphite token contrast fix upstream in xr-THEME-SYSTEM (mobile already compensates).
