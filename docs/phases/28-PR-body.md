# Phase 28 — Mobile PWA companion (`phase/28-mobile-pwa` → `main`)

**XR in your pocket for the things you need away from your desk: a quick
question, an approval, a push-to-talk thought, today's spend. Not an IDE, not a
terminal, not a cloud sync service.**

@ahmadrrrtx — ready for review. Not self-merged.

## What shipped

### Daemon — LAN mode, opt-in and fail-closed
- `xr serve --lan` / `XR_DAEMON_LAN=1` binds `0.0.0.0:3141` **over TLS** with a
  self-signed ECDSA P-256 cert (SANs: LAN IPs, hostname, `.local`, localhost),
  generated once into `~/.xr/certs/`, reused after. Zero dependencies — a small
  DER writer over WebCrypto; `openssl verify -CAfile` accepts it.
- Loud cyan banner: LAN URL, fingerprint, "run without --lan to disable".
- On-demand 6-digit pairing codes (10-min TTL, single use, 10 attempts/min,
  generic 401 otherwise), QR at a desktop-only endpoint (280px in Settings),
  device registry with hashed tokens, revocation, push subscriptions.
- Mobile sessions carry `deviceKind: "mobile"`; files/terminal/shell/git/mcp →
  **403**. Strict Origin check with a `null`-origin exception only for paired
  sessions. Loopback default byte-for-byte unchanged.
- Web Push straight from daemon to FCM/APNS: VAPID + RFC 8291/8188 + an inner
  AES-GCM layer keyed on the phone, so the push vendor relays ciphertext.
  600s TTL; SW re-checks and suppresses resolved approvals.
- Serves the built PWA at `/mobile/` with the spec'd CSP; no source maps.

### Desktop
- Settings → **Mobile** card: LAN status, LAN URL + fingerprint (copy),
  pair-new-device dialog (QR + 24px mono code + countdown + fingerprint +
  manual steps), paired-device list with revoke + test push, disable LAN.

### Mobile PWA (`mobile/`, separate Vite project)
- 4 tabs (Chat / Voice / Approvals / Settings), iOS-style stacks with
  swipe-from-edge back, bottom sheets, pull-to-refresh, 44px targets, full
  safe-area handling, translucent tab bar, badges.
- Chat: list + search + new, streaming tokens with caret, markdown + tables +
  highlighted code (horizontal scroll, copy), file-ref chips (view/copy only),
  long-press sheet (copy / copy code / share / regenerate / stop), optimistic
  sends, composer with disabled paperclip ("Coming soon") and mic jump.
- Voice: 180px Orb (glossy sphere, tilted ring, cyan halo, mic-driven voice
  rings), tap-to-talk, MediaRecorder ogg→webm→mp4 fallback, live RMS rings,
  transcript → chat send → streamed reply, mic explainer + denied states,
  last-10 log, interruption handling.
- Approvals: grouped pending cards with full-width Approve/Deny, detail sheet
  with highlighted diff, collapsible resolved, cross-surface polling + push.
- Settings: connection card, 6 theme options incl. Follow-system (live),
  model pick, budget progress, push toggle with permission flow, unpair,
  about, cache size/clear/reset.
- Pairing: QR-param confirm screen with fingerprint compare, manual entry,
  TOFU pin with mismatch safety dialog, revocation → back to pairing.
- Offline: precached shell, cached chats/messages/approvals/budget, red
  offline bar, ⌛ queued sends, FIFO drain via Background Sync or foreground,
  LRU eviction at 20MB, SW never caches writes or the liveness probe.
- Install: manifest with maskable icons + screenshots, iOS splash meta,
  nudge sheet after 3 opens (twice max), update-available banner.

## Verification (all run in-sandbox, scripts included)

| Suite | Result |
| --- | --- |
| `tools/test-web-push.mjs` | 6/6 — our RFC 8188/8291 reader decrypts reference `web-push` ciphertext; double-layer round-trip; tamper → auth failure |
| `tools/test-lan-flow.mjs` | 25/25 — auth, pairing, single-use, rate limit, cookie flags, mobile 403 gating, revoke→401, SSRF allowlist |
| `tools/test-offline.mjs` | 12/12 — SW install/scope/precache, offline render + bar + cached rows, queued send + ⌛, drain on reconnect |
| typecheck (app + SW + config) | strict, 0 errors |
| `tools/bundle-report.mjs` | **critical 132.5 KB gz / total 179.4 KB gz** (budgets 140/200); markdown lazy at 46.9 KB |
| screenshots | 11 PNGs with content assertions (QR rendered 560px, sheet open, theme flip, orb present) |

Screenshots: `~/previews/implementation/phase-28/` (chat list, conversation,
voice orb, approvals, approval detail, settings dark + Arctic, pairing confirm,
desktop Mobile card, desktop QR dialog, lock-screen push illustration).

## Deviations from the brief (all documented in `docs/mobile/SECURITY.md`)

1. `SameSite=Strict` instead of `SameSite=None` — stronger, and correct here
   because PWA and API share an origin (SW fetches included).
2. Graphite theme text ramp darkened on mobile — published tokens fail 4.5:1
   for body text; the constitution's contrast rule wins. (Suggest fixing
   xr-THEME-SYSTEM upstream.)
3. Fingerprint is served by the daemon at `/api/mobile/cert-fingerprint` — a
   page can't read its own TLS cert; first confirmation stays out-of-band,
   after which the pin is authoritative.
4. mDNS auto-discovery skipped (brief allows); QR + manual entry suffice.
5. No react-router (60-line stack store, ~15 KB gz saved) and no shiki (1.5 KB
   tokenizer) — both to protect the 200 KB budget.
6. `POST /api/v1/chat` streams and later persists the assistant message; the
   reference daemon (`tools/reference-daemon.mjs`) implements the route surface
   for tests because the Phase 0–27 daemon isn't in this workspace.

## Out of scope (unchanged from brief)

Cloud relay / cellular, attachments, code editing & apply, terminal, TTS,
group/multi-account, store builds, widgets/shortcuts, watch.

## How to test on real hardware

1. `npm --prefix mobile run build`
2. `xr serve --lan` → note URL + fingerprint
3. Desktop Settings → Mobile → Pair new device → scan with phone → compare
   fingerprint → Pair
4. Chat (send/reply streams), Voice (tap-talk-stop), Approvals (approve from
   phone → desktop updates), Settings (themes, model, budget, push toggle)
5. Kill WiFi → offline bar + cached chats + queued send; restore → drain
6. Desktop → revoke device → phone returns to pairing on next navigation
7. Add to Home Screen → standalone launch, insets correct, no browser chrome
