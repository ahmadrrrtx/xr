# Phase 26 — Phone & social remotes: Telegram, Discord, WhatsApp

The phase brief asks for two new chat surfaces (Discord and WhatsApp) beside the Phase 24
Telegram bot, under one architecture rule: **one framework, three adapters**.

The phase ships in four staged PRs (`docs/phases/26-bots-plan.md`):

| PR | Scope | Branch | State |
| --- | --- | --- | --- |
| 1 | Shared `src/bots/` chat runtime | `phase/26-bots-shared` | merged (#169) |
| 2 | Discord surface — this document's main subject | `phase/26-discord-surface` | PR #172 |
| 3 | WhatsApp surface (Baileys, QR pairing) | `phase/26-whatsapp` | PR #173 (stacked on PR 2) |
| 4 | Desktop Integrations UI (Discord + WhatsApp dialogs, cards, mockup set) | `phase/26-desktop` | **this PR** (stacked on PR 3) |

> The remote already had a branch named `phase/26-discord` (an unrelated Discord
> implementation, no PR) when PR 2 was pushed, so this work went up as
> `phase/26-discord-surface` rather than over the top of it. Nothing was
> force-pushed; which branch to keep is the maintainer's call.

Telegram is not rewritten. PR 2 extends the shared layer only where Discord genuinely needs
it, and keeps every Phase 24 behavior intact (the Phase 24 suite is the regression gate).

---

## 1 · What the shared layer owns

`src/bots/` was already merged in PR 1: `BotSurface<Msg>`, `BotRuntime<Msg>` (rate limit,
one task per chat with `AbortController`, spend ledger, 20-turn reply ring, typing pulse,
the durable approval bridge), media policy, voice-note transcription and prefix parsing.

PR 2 extracted the last three shared pieces out of `src/telegram/`, because Discord needs the
identical policy and a second copy would drift:

| module | what it owns | Telegram's wrapper |
| --- | --- | --- |
| `src/bots/chunk.ts` | fence-aware text splitting with a `…(continued)` marker | `telegram/markdown.ts` |
| `src/bots/media.ts` | size caps, classification, text decode, PDF/text extraction, `wrapUntrusted` tags | `telegram/attachments.ts` |
| `src/bots/voice-note.ts` | Ogg → STT for cloud and local backends, temp-dir cleanup | `telegram/voice.ts` |
| `src/bots/parse.ts` | inline `$budget` extraction, `/xr`-style prefix parsing | `telegram/commands.ts` |

The Telegram files are now thin re-exports, so the Phase 24 tests exercise the shared code
paths without a line of test change. `ChatSettings` moved to `src/bots/types.ts` and is
re-exported from `telegram/state.ts` for the same reason.

## 2 · The Discord surface

```
src/discord/
  client.ts       REST over fetch + the gateway WebSocket (injectable for tests)
  types.ts        API v10 shims: intents, opcodes, callback/button/channel enums
  auth.ts         fail-closed allow-lists + the pairing book
  pairing -> auth.ts  6-digit, 10-minute, single-use codes; 5 failures close the window
  state.ts        ~/.xr/discord/state.json (0600): gateway session, chat settings, labels
  commands.ts     text vocabulary + the /xr slash tree + invite URL
  render.ts       embeds, buttons, 2000-char splits, plain-language status
  verify.ts       Ed25519 signature check for interactions-webhook mode
  attachments.ts  CDN-only downloads, caps, voice notes
  tasks.ts        one task turn: budget, guard, typing pulse, delivery
  bot.ts          product rules: who may talk to XR, and what happens next
  manager.ts      lifecycle owner: token, pairing, settings, logs, webhook registration
```

### Decisions worth recording

1. **No `discord.js`.** XR needs five REST calls and four gateway events. A structure library
   would add megabytes of caches and builders the bot never touches and would own the
   reconnect policy anyway. `client.ts` is ~500 lines with an injected `fetch` and an injected
   WebSocket factory, so the same class is driven by a fake socket in unit tests and by a real
   local WebSocket server in the integration test.
2. **Gateway is the default; the webhook is opt-in.** Webhook mode needs a public HTTPS
   endpoint and a reverse proxy the user runs (XR still opens no tunnel of its own). When it
   is configured, `verify.ts` checks Discord's Ed25519 signature over
   `timestamp + raw body` before the payload is parsed, and refuses anything older than five
   minutes. `/api/discord/webhook` is the only daemon path that skips the bearer check —
   the signature **is** the authentication.
3. **MESSAGE_CONTENT is privileged and announced.** The intent is required for a bot to read
   message text; without it Discord delivers empty content and DMs are filtered out. The
   dialog (PR 4) and this document say so in plain words, with the Developer Portal path.
4. **Fail-closed, in three layers.** DMs: only paired user ids. Guilds: only allow-listed
   channels, and even there only `/`-commands and explicit @mentions. Everything else is
   ignored **in silence** and audited — an unknown user learns nothing, not even that a bot
   is listening. The one exception is a pairing command, whose code was minted by the owner
   in the XR app, is single-use and expires in ten minutes.
5. **Pairing runs the other way round from Telegram.** Telegram mints the code and the user
   types it into the desktop. Discord's desktop dialog mints the code and the user types it
   into Discord (`/xr pair <code>`), because the bot cannot DM a user who has never spoken to
   it. Codes are shown in `/api/discord/status` **on purpose** — the dialog has to display
   them, the API is bearer-protected and local, and the code is single-use and expires with
   the window. (Telegram keeps codes out of its status payload; that asymmetry is correct,
   not an oversight.)
6. **Channel allow-list, two ways in.** `/xr pairchannel <code>` inside the channel (minted by
   the dialog), or the picker: `GET /api/discord/guilds` → `GET /api/discord/channels?guildId=`
   → `POST /api/discord/channels/add`. Both are supported; the picker is a read-only lookup
   through the bot's own token.
7. **`/xr ask` answers privately.** In a guild every slash command defers and answers
   ephemerally, including task output, because a channel is a shared room. Long tasks cannot
   edit an interaction forever, so the deferred reply carries the answer in chunks: first
   chunk via the interaction's original message, the rest as ephemeral follow-ups.
8. **Slash commands register guild-first when asked.** `discord.devGuildId` registers the
   same tree into one server, which propagates instantly; global registration can take up to
   an hour, and the dialog says so rather than pretending otherwise.
9. **The invite URL asks for five permissions, not six.** `commands.ts` exports
   `INVITE_PERMISSIONS = 117760` — View Channel, Send Messages, Embed Links, Attach Files,
   Read Message History. The brief's number (`274877925376`) also contains
   MODERATE_MEMBERS (`1 << 38`, Discord's "timeout members"); XR has no business holding a
   moderation permission, so the number was reduced deliberately and a test pins it.
10. **Attachments come from Discord's CDN only.** `attachments.ts` refuses any host other
    than `cdn.discordapp.com` / `media.discordapp.net`, so a crafted attachment URL cannot
    turn the bot into an SSRF primitive. Size caps are checked from metadata **before** the
    download; voice notes go through the shared transcription path with Telegram's caps.
11. **Ed25519 without a dependency.** `node:crypto` verifies Ed25519; a raw 32-byte public key
    is wrapped in the fixed SPKI prefix Discord documents (`verify.ts`). Tests generate a real
    key pair and sign real bodies.
12. **Typing arrives every 5 s, not every 4.** Discord shows the indicator for ~10 s and the
    brief's throttle is ≤5 s; a 10 s task therefore costs two calls, not twenty-five.
13. **Runs and budgets.** Discord work executes through `executeOnSurface({ surface: "discord" })`,
    so the Control Room shows it beside CLI, Telegram and voice runs, and the same
    `chatBudgets` envelope caps a channel.

### Egress

The bot talks only to `discord.com` (REST), `gateway.discord.gg` (gateway, or the
`resume_gateway_url` Discord hands out) and `cdn.discordapp.com` /
`media.discordapp.net` (attachments). No telemetry, no analytics, no relay.

## 3 · The WhatsApp surface

```
src/whatsapp/
  client.ts       linked-device socket (Baileys, lazy) + QR → PNG + normalization
  types.ts        structural socket view, normalized incoming message, disconnect codes
  creds.ts        sealed credential blob (~/.xr/whatsapp/creds.sealed, AES-256-GCM)
  state.ts        ~/.xr/whatsapp/state.json (0600): link label, chats, outbox
  auth.ts         phone normalization, masking, the fail-closed admission gate
  commands.ts     the text vocabulary + the numbered approval menu
  render.ts       WhatsApp dialect, 1500-char splits, the disclosure text
  attachments.ts  media caps before download, quarantine tag, voice notes
  tasks.ts        one task turn: budget, guard, typing presence, delivery
  bot.ts          product rules: who is answered, what happens next
  manager.ts      lifecycle: connection, QR window, contacts, settings, logs
```

WhatsApp is the only surface with no HTTP API to talk to. It is a *linked
device*, so the adapter speaks the multi-device protocol over a WebSocket the
same way the phone does. That shapes everything else:

1. **QR is the pairing, not a code.** WhatsApp pairs by scanning. So the pairing
   surface is `/api/whatsapp/qr`: server-sent events carrying a PNG data URL
   each time WhatsApp rotates the code, then a terminal `{"state":"open"}`,
   `timeout`, `closed` or `error`. The window is three minutes and closes itself.
   Without a session on disk, `pair` is refused while a device is already linked.
2. **Linking trusts nobody.** The QR proves the device; it authorizes no contact.
   The allow-list is a separate, explicit step (default: empty = nobody), with the
   honest alternative of the outbox switch: when `respondToOutbox` is on, a number
   the *user* writes to first — seen live by the linked device, never scraped from
   history — is answered too. Everything else is ignored in silence.
3. **Credentials are sealed, not stored.** `creds.sealed` is the whole device
   blob, sealed with AES-256-GCM through the same per-install vault key that
   guards API keys (`src/security/secrets.ts`, `sealVaultValue`), written 0600 in
   a 0700 directory, atomically. A tampered blob is an error, not an empty
   session: XR refuses to start rather than silently re-registering the device.
   WhatsApp's `loggedOut` (401) wipes it; every other close reconnects with
   backoff and never asks for a QR again.
4. **No history, ever.** `syncFullHistory: false`, and `messaging-history.set`
   payloads are counted and dropped. The status card shows the count, so the
   claim is inspectable rather than rhetorical.
5. **1:1 only, one message a second.** Groups, broadcasts and status traffic are
   dropped (audited, never answered). Outbound messages are paced at one per
   second per chat by construction, and the inbound rate limiter is clamped to
   the same ceiling whatever the configured value says.
6. **No buttons, no edits.** Risky actions arrive as a numbered menu —
   `[1] Approve [2] Deny [3] View details` — answered with `1`/`2`/`3` or the
   words. The menu is only consulted while an approval in that chat is pending,
   so a bare "1" is otherwise just a message. Because messages cannot be edited,
   the resolution arrives as a follow-up (`✅ Approved from desktop · tool`), which
   is also how cross-surface sync shows up here.
7. **Bare `stop` unsubscribes.** `/xr stop` cancels the running task like every
   other surface; a bare `stop` is the sender asking to be forgotten, and XR
   removes their number from the allow-list after saying so. The help text spells
   both out.
8. **Baileys is optional and lazy.** It is in `optionalDependencies` and imported
   inside the socket factory, so a user who never links WhatsApp never loads it,
   and a missing package is a sentence, not a stack trace. The pinned line is
   `6.7.24` (upstream's `legacy` tag) rather than `7.0.0-rc`: 7.x pulls a native
   `whatsapp-rust-bridge`, and a CLI that installs cleanly on a user's machine
   matters more than tracking a release candidate.

### Egress

Only WhatsApp's own endpoints (`web.whatsapp.com` / `*.whatsapp.net` and the
media CDN the message itself points at). No telemetry, no relay, and the media
download closure belongs to the incoming message — there is no URL to allow-list
because there is no URL XR can be pointed at.

## 4 · Deviations from the brief, restated

1. **No live Discord verification.** This environment has no bot token, so the adapter is
   verified against a mock REST server, a fake gateway socket and one real local WebSocket
   gateway; the live gateway check stays open until a token is supplied. Everything a token
   would exercise is asserted: identify payload, READY/resume handling, 4004 as fatal,
   429 `retry-after`, command registration, message send/edit/typing.
2. **`bot.ts` is 782 lines, not 150–200.** The same deviation PR 1 recorded: the remainder is
   Discord-specific product surface (access rules, command handling, delivery). The
   surface-independent parts are in `src/bots/`, and the attachment/task halves are separate
   modules (`attachments.ts`, `tasks.ts`), so the file stays under the 800-line module gate
   rather than needing a waiver. WhatsApp's `bot.ts` is 517 lines by the same split.
3. **Pairing codes appear in the status payload** (see decision 5). Nothing else does: the
   bot token never appears in a response, a log line, an audit row or an error message, and
   tests assert that for the status payload, the log tail and the connect/disconnect routes.
4. **Webhook mode is implemented but unproven live** — it needs a public HTTPS endpoint.
   Signature verification, PING/PONG and the dispatch path are unit-tested with real
   Ed25519 keys.
5. **"Details" opens the local dashboard, not a handoff deep link.** The brief's
   `xr://approval/<id>` deep link with a `?token=<shortHandoff>&approval=<id>` fallback is not
   built: Discord carries the full record in an ephemeral message instead, and the optional
   link button points at the local dashboard. Putting a one-time bearer token in a message
   component was the part worth rejecting; the desktop-side routing of `xr://` approval URLs
   stays a follow-up.
6. **The credentials container deviates from the brief's CredentialVault, on
   purpose.** The brief said "CredentialVault (AES-256-GCM)". The vault's record
   API is bound to the business-tier store, and the linked-device blob is
   hundreds of KB of signal keys — not a `NAME=value` line. So the *key and the
   algorithm* are the vault's (`sealVaultValue` in `src/security/secrets.ts`,
   same per-install key, same fail-closed handling) and the *container* is a
   dedicated sealed file under `~/.xr/whatsapp/`, 0600, atomic, wiped on
   `loggedOut`. Nothing plaintext is ever written, and a test asserts the sealed
   file contains neither the string `noiseKey` nor the raw key material.
7. **Busy-reply and budget behavior is deliberate.** A second task in a chat is
   refused in words (one task per chat, `/xr stop` cancels), and a chat that has
   spent its cap is told so before any model call — both are asserted in tests.
8. **The repo's tree ceiling moved twice: 160,000 → 164,000 (PR 2) → 168,000 (PR 3)** — each
   raise lands in its own diff with its measured number in `scripts/size-gate.ts`. Measured at
   each step: `main` 159,870, Discord PR head 163,856, WhatsApp PR head 166,968 (99.4% of the
   new ceiling). This is the deliberate mechanism Phase 24 used for Telegram, and PR 2's note
   said PR 3 would measure rather than estimate; the alternative — moving the chat surfaces to
   a satellite package — remains the recorded follow-up. The generated-client waiver was
   bumped in the same spirit (1304 → 1369 lines) because the new routes are part of it.

## 5 · Acceptance criteria (phase brief)

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Telegram zero-regression (`bun test` green, Phase 24 suite untouched) | ✅ 4017 pass / 19 skip / 0 fail |
| 2 | Discord DM from a paired user runs a task | ✅ (mock transport; live check pending token) |
| 3 | Slash commands `/xr ask budget model stop approve deny help pair pairchannel` | ✅ registered at READY; parsed in tests |
| 4 | Approve/Deny buttons decide; Details shows the full record | ✅ |
| 5 | Ephemeral replies for private data | ✅ (all guild interactions) |
| 6 | 2000-char splits with `…(continued)` | ✅ |
| 7 | Typing throttle ≤5 s | ✅ 5 s pulse |
| 8 | Attachment caps (doc 5 MB / image 2 MB / audio 10 MB) before download | ✅ shared policy |
| 9 | 429 `retry-after` backoff (global and per-route) | ✅ |
| 10 | DMs-only default; guild channels require the allow-list; unknown → silent | ✅ |
| 11 | `author.bot` / `webhook_id` ignored | ✅ |
| 12 | Invite URL surfaced; dev-guild instant registration | ✅ |
| 13 | Cross-surface approval sync, both directions, actor labels | ✅ Discord edits its message on any-surface decisions; button tests both ways |
| 14 | No secrets in logs or API responses | ✅ asserted |
| 15 | QR pairing streamed as SSE frames, then a terminal state | ✅ `/api/whatsapp/qr`; tests read real frames from a real PNG render |
| 16 | Credentials encrypted at rest, never plaintext; reconnect without a QR | ✅ sealed blob, 0600, tamper = error; resume path tested |
| 17 | `loggedOut` deletes credentials | ✅ (401 close) |
| 18 | Text, voice (`[🎤 Voice note]`), images, documents; caps 5 MB / 2 MB / 10 MB before download | ✅ shared policy |
| 19 | Numbered approve/deny/details fallback accepting `1`/`2`/`3`/words | ✅ |
| 20 | 1500-char splits; quote-original; no edits (follow-ups instead) | ✅ |
| 21 | ≤1 message/second per chat | ✅ pacer + clamped limiter |
| 22 | Fail-closed allow-list + outbox whitelist; unknown numbers silent | ✅ |
| 23 | Groups dropped; 1:1 only | ✅ |
| 24 | Unofficial-client disclosure in the UI and README | ✅ one constant, `UNOFFICIAL_CLIENT_NOTICE`, surfaced by `/status` and the README |
| 25 | No history scraping on connect | ✅ `syncFullHistory: false`; drops counted and shown |
| 26 | Desktop dialogs, status dots, settings popovers | ✅ `DiscordDialogs.tsx`, `WhatsAppDialogs.tsx`, `statusDots.ts`, cards wired through `chatSurfaceOf` |
| 27 | Screenshots to `previews/implementation/phase-26/` | ✅ six self-contained HTML mockups (see §7 — no live account exists to screenshot; the QR images are real) |

## 6 · Verification

```bash
bun test test/discord/          # 39 tests, offline: mock REST + fake socket + one real local WS
bun test test/whatsapp/         # 35 tests, offline: fake socket, stub downloaders, real QR render
bun test                        # 4053 pass / 19 skip / 0 fail (baseline main: 3978 / 19 / 0)
bun run typecheck               # root + desktop, strict
bun run ci                      # every gate, including api:schema:check + client:check after regen
bun run scripts/phase26-mockups.ts /home/user/previews/implementation/phase-26   # PR 4 mockups
```

The Discord suite covers: command parsing (text and slash), renders/splits, fail-closed
access, pairing mint→redeem→unpair, buttons (approve, deny, details, double-tap, wrong chat),
cross-surface decisions from the desktop side, rate limiting, 429 handling, gateway
identify/READY/RESUME/4004, a real local WebSocket round-trip with heartbeats, Ed25519
signature verification, state persistence, settings validation and every route (including the
unsigned webhook rejection).

## 7 · Desktop Integrations UI (PR 4)

The two new surfaces are drawn with the Phase 22 components and the Phase 24 dialog shell —
no new design language, no new dependency. Files:

| file | what it is |
| --- | --- |
| `desktop/src/integrations/discord.ts` | engine client + `useDiscordStatus` (4 s poll) + `discordCardStatus` / `discordDot` |
| `desktop/src/integrations/whatsapp.ts` | engine client + `useWhatsAppStatus` + `useWhatsAppQr` (SSE reader over the authenticated engine fetch, not `EventSource`) |
| `desktop/src/integrations/statusDots.ts` | the one green/yellow/red vocabulary every surface card uses |
| `desktop/src/screens/Integrations/components/DiscordDialogs.tsx` | `DiscordConnectDialog` (token → invite URL → pairing code → done) and `DiscordSettingsDialog` |
| `desktop/src/screens/Integrations/components/WhatsAppDialogs.tsx` | `WhatsAppConnectDialog` (risk ack → 300×300 QR → linked → contacts) and `WhatsAppSettingsDialog` |

Three routing rules keep the generic vault path away from these cards:

1. `src/integrations/registry.ts` gives Discord the Phase 26 description, an empty
   `configFields` and the new `qr_link` auth type for WhatsApp (labelled “QR link”).
2. `src/integrations/service.ts` marks the chat surfaces `support: "available"` — that is
   what turns their cards from *Coming soon* into *Connect*. Nothing else changes: they still
   have no `configFields`, no OAuth app credentials, and the generic connect/disconnect routes
   still refuse them, so a token can never be stored twice.
3. `desktop/src/integrations/core.ts` exports `chatSurfaceOf()`, and both the store's
   `connect()` and the card's settings button route to the surface's own dialog. An unknown
   surface falls through to the existing behavior.

Copy and behavior that the brief called out, and where it lives:

- **Pairing code.** 24 px mono, copy button, live countdown (`PairingCode` in
  `DiscordDialogs.tsx`). The desktop mints the code and the user types it into Discord, so the
  code proves the person on the other end saw this screen.
- **Invite URL.** Copy *and* open-in-browser, with the exact permission set stated in words
  (“five permissions only: view channels, send messages, embed links, attach files, read
  history. No moderation, no administrator”).
- **MESSAGE_CONTENT warning** on the token step: the one privileged intent the user must
  switch on in the Developer Portal, named there because that is where they will look.
- **QR area** is exactly 300×300, seeded from `/api/whatsapp/qr`, with the “New code in Ns”
  countdown and a *Try again* affordance once the stream reports `timeout`/`closed`/`error`.
  The disclosure checkbox gates the button that mints a code.
- **Settings** per surface: allowed channels with a build/live guild+channel picker (Discord),
  allowed contacts by country code, the outbox switch and the history-dropped counter
  (WhatsApp), rate limits, caps, auto-start, a 100-line log tail and disconnect/unpair.
- **Status dots** are `ix-dot--green|yellow|red` with the label in the title and `aria-label`,
  never colour alone.

### The mockup set — why not screenshots

No Discord bot token and no WhatsApp account exist in the environment that built this phase, so
there is nothing to photograph. Instead, `scripts/phase26-mockups.ts` renders six
**self-contained HTML mockups** (no scripts, no external stylesheets, no network — the theme
tokens are inlined) into `previews/implementation/phase-26/` and, kept with the app, in
`desktop/previews/implementation/phase-26/`:

| file | what it shows |
| --- | --- |
| `01-integrations-cards.html` | the grid with Discord connected (green dot), WhatsApp linked-but-stopped (yellow), Telegram and GitHub |
| `02-discord-connect.html` | the three connect steps: token, invite URL, pairing code |
| `03-discord-settings.html` | accounts, channels + picker, limits, webhook, dev-guild, logs, disconnect |
| `04-whatsapp-connect.html` | disclosure, the 300×300 QR, a second rotated frame, and the linked state |
| `05-whatsapp-settings.html` | contacts, outbox switch, limits, auto-reconnect, redacted log, unpair |
| `06-approvals-and-runs.html` | one approval decided once, the actor labels, and the Runs surface badges |

The markup, class names and copy mirror the real components, and the QR images are genuine —
generated by the same `qrcode` dependency the engine uses, from two different payloads so the
“frame rotated” pair is honestly two different codes. These are mockups and say so in their
own captions; the real components are the TypeScript beside them.

## 8 · What is left in the phase

- **PR 2 / PR 3** are open (#172, #173) and not merged by the agent, per the brief.
- **Live verification** remains the honest gap: Discord has never been pointed at
  discord.com and WhatsApp has never been paired to a real phone from here. Everything that
  can be proven offline is proven offline, and the document says which is which.
