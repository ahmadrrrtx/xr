# Phase 24 — Telegram bot: study notes

Scope: Telegram only. Discord, WhatsApp and Slack are Phase 26. Cloud relay, group
chats, inline queries, payments, video, vision and durable chat history are out of scope.

## What existed before this phase

- `src/telegram/bot.ts` was a long-poll class with an env-only allow-list
  (`XR_TELEGRAM_TOKEN`, `XR_TELEGRAM_ALLOWED`). Nothing in the daemon constructed it;
  it was only used by tests.
- Known defects: no backoff on `ok:false` (a bad token made a tight loop), no offset
  persistence, `start()` could not be stopped cleanly, `send()` used legacy `Markdown`
  with unescaped model text, and `/budget` was audit-only (it never took effect).
- Approvals already existed in the durable `ApprovalStore`
  (`request` / `decide` / `expire` / `sweepExpired`, 150 ms cross-process poll,
  `outcome` with `decidedBy.channel`). That is enough for cross-surface sync with no new
  event bus.
- Voice: `SpeechToText.transcribe(bytes, mime)`. The local backends (`whisper-cli`,
  `whispercpp`) write `input.wav` and expect PCM. Cloud backends (`groq`, `openai`) take
  the container format from the upload filename.
- Config: the `telegram` block lives in `migrate-22.ts`. Zod defaults fill new keys, so
  no config version bump is needed.
- Secrets: `SecretBroker` / `secrets.ts`. Names must match `^[A-Z][A-Z0-9_]{1,80}$`.
  The file fallback is AES-256-GCM sealed.
- Untrusted input: `wrapUntrusted()` in `src/context/injection.ts` masks secrets and
  bounds length (default 4,000 chars, so callers must pass a cap explicitly).
- PDF: `extractPdfText()` in `src/research/pdf-text.ts` (Phase 18).
- Egress: `hostAllowed()` in `src/tools/egress.ts`. The Telegram API host itself is not
  agent egress and is not gated (see "Egress" below).

## Decisions

1. **Pairing is window-gated.** `/start` from an unknown user produces a 6-digit code only
   while a pairing window is open. The window opens on Connect, or on "Add a device" in
   settings, and lasts 10 minutes. Outside it, unknown users get no reply at all, so the
   bot cannot be used to probe whether it exists. The brief's fail-closed rule is kept.
2. **The code is typed on the desktop, not shown there.** The desktop shows the requesting
   user's name and @username, and the user types the code from the Telegram message. The
   code proves that the person on the phone saw the message, and the name shows who is
   pairing. Showing the code on the desktop would make the desktop check meaningless.
   Codes are single-use, expire after 10 minutes, and five wrong attempts close the window.
3. **Token storage name.** The brief asked for `integrations.telegram.token`. The vault
   rejects dotted names, so the secret is `XR_TELEGRAM_BOT_TOKEN`. The token never goes
   to config, state, logs or audit.
4. **Runtime state split.** Non-secret settings (`enabled`, `autoStart`, `pairedUserIds`,
   `webhookUrl`, `rateLimit`, `maxAttachmentBytes`) live in the config `telegram` block.
   The fast-changing state (update offset, webhook secret, per-chat model and budget) lives
   in `XR_HOME/telegram/state.json` with mode 0600. That keeps config writes rare.
5. **Environment overrides are read-only.** `XR_TELEGRAM_TOKEN` replaces the vault copy for
   the process. `XR_TELEGRAM_ALLOWED` adds paired ids. The UI labels both as
   "Configured via environment".
6. **Webhook.** Telegram cannot send the XR bearer token. `/api/telegram/webhook` is
   excluded from the bearer check and is authenticated by Telegram's `secret_token`
   header, compared against a random per-install secret. Without the header the route
   returns 401 and audits the attempt.
7. **Voice routing.** Cloud STT takes Ogg directly, with the upload named `audio.ogg`
   (a change to `stt.ts`: the filename now follows the MIME type). Local STT needs 16 kHz
   mono WAV, so ffmpeg converts it in a private temp directory that is removed in a
   `finally`. With no speech model, or no ffmpeg for a local model, the user gets a plain
   reply. The transcript is always treated as a task. It never runs as a slash command.
8. **Attachments.** Size is checked against Telegram's metadata before download: documents
   use `maxAttachmentBytes` (default 5 MB), photos are capped at 2 MB. Text and code are
   binary-sniffed (NUL in the first 8 KB) and capped at 30 KB. PDFs use the Phase 18
   extractor. Images are noted with their size and type, and never analysed. Everything the
   model sees goes through `wrapUntrusted`.
9. **Rate limit.** 20 messages a minute per chat, through the existing token bucket. New
   configs default to 20/min. Existing stored values are left alone, since the migration
   writes them explicitly.
10. **Approval sync.** Every approval is durable. The Telegram message is edited to
    "✅ Approved from desktop", "❌ Rejected" or "⌛ Expired" from `outcome` and
    `decidedBy.channel`, and its buttons are removed. Callbacks are bound to the chat that
    received the approval. A callback from another chat is refused. 👀 Details re-sends the
    full preview with the buttons repeated.
11. **Output.** Model text is rendered as MarkdownV2 with every reserved character escaped.
    Splitting happens on raw markdown first, keeping fences balanced across chunks, and each
    chunk is rendered and checked against 4096. Buttons go on the last chunk only. A
    `can't parse entities` error falls back to plain text, so no answer is dropped.
12. **Chat budget.** The per-chat ceiling is charged from the cost-ledger delta around the
    task. This is an approximation when another surface spends at the same time.
13. **Settings are a dialog, not a popover.** The Phase 22 card opens dialogs for the setup
    and settings flows. The brief said "settings popover"; a dialog gives the same
    functions with simpler focus handling.

## Egress

The Telegram transport (`api.telegram.org`) is the bot's own channel, not agent egress, so
it is not checked against `security.egressAllowlist`. Attachment downloads use the same
host. The webhook URL is inbound, so it is validated as HTTPS only.

## Contract and generated artifacts

The eleven telegram routes are in the operation contract (`contract-telegram.ts`, schemas in
`schemas-telegram.ts`), so the completeness test passes and the OpenAPI spec and typed client are
regenerated. Request schemas are enforced fail-closed by the router, so they are deliberately
loose: each mirrors what the handler accepts and leaves semantic checks to the handler. The
webhook has no request schema because its body is a Telegram update. It is authenticated by the
secret header.

`docs/release/1.0.0/inventory.json` and `INVENTORY.md` are not refreshed in this PR. They are a
dated 1.0.0 snapshot, and `baseline:inventory` rewrites them with drift from earlier phases.

## Known limits

- Live testing needs a BotFather token. None was provided, so the live path is covered only
  by the offline suite (`test/telegram/phase24.test.ts`, 37 tests, mock Telegram API).
- No phone screenshot can be taken without a device.
- The desktop UI was type-checked and linted, but not visually checked in a running app.
- Groups and channels are ignored entirely.
- Reply context and the per-chat ring are in memory, so a restart clears them.
