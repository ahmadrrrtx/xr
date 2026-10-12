# Phase 26 · Discord and WhatsApp — study notes

Written before implementation. Companion to `26-bots-plan.md` (PR 1 staging) and
`26-bots-discord-whatsapp.md` (setup + troubleshooting).

## What was read

| Area | Files | What they fixed in the design |
|------|-------|-------------------------------|
| Shared runtime (PR 1, merged) | `src/bots/{types,tasks,rate,spend,approvals,typing,context,runtime}.ts` | `BotSurface<Msg>` is deliberately three methods (`send`/`edit`/`setTyping`). Everything else is surface-owned. New surfaces must not widen it without a second caller. |
| Reference adapter | `src/telegram/{bot,manager,render,commands,auth,pairing,state,markdown,attachments,voice}.ts` | The lifecycle shape to mirror: manager owns token/pairing/settings/log ring; bot owns the wire; `state.json` (0600, atomic) holds volatile runtime state, config.json holds user intent. |
| Daemon | `src/daemon/routes/{telegram.routes,router,registry,index}.ts`, `src/daemon/server.ts` | Routes register in `registry.ts`; every route needs an `API_CONTRACT` entry (drives OpenAPI + body validation + typed client). `DaemonState` carries optional surface managers. `/api/telegram/webhook` is the one pre-auth route. |
| Approvals | `src/control/approval-store.ts` + `src/bots/approvals.ts` | Durable rows, TTL default-deny, cross-process `decide()`. The bridge edits the surface message when the outcome lands, from ANY surface. Discord gets this free (native edit); WhatsApp needs a follow-up message. |
| Secrets | `src/security/secrets.ts` (`XR_…_BOT_TOKEN`), `src/telegram/manager.ts` | Token never in config/state/logs; env override wins; logs redact token-shaped strings. |
| Credential vault | `src/integrations/credentials.ts` | `CredentialVault` is the Business-OS module: it needs a `BusinessSqlDatabase` + org id, and business routes are OFF unless `XR_BUSINESS_ROUTES=on`. Personal-tier WhatsApp session blobs therefore use a dedicated sealed file (see PR 3 deviations). |
| Execution | `src/core/execution/envelope.ts`, `src/services/surface-execution.ts` | `SurfaceId` union must grow two members; surfaces call `executeOnSurface({ surface: "discord" | "whatsapp" })` exactly like Telegram. |
| Integrations UI | `desktop/src/screens/Integrations/**`, `desktop/src/integrations/{api,core,telegram}.ts`, `src/integrations/{registry,service}.ts` | Cards render from the engine list; support is a server-side set; live per-surface status is overlaid client-side (Telegram does this). Dialogs live in `components/`. |

## Decisions taken (and why)

1. **Extract only what two surfaces actually share.** PR 2/3 add
   `src/bots/chunk.ts` (plain-text splitter), `src/bots/media.ts` (attachment
   caps/classification/decode) and `src/bots/voice-note.ts` (ogg → STT), then
   move Telegram onto them with its existing test suite as the regression gate.
   Nothing else moves: MarkdownV2 escaping, callback parsing, `getUpdates`
   polling and the Telegram pairing book stay Telegram-shaped until a third
   caller proves they are general.
2. **Discord writes its own wire, not `discord.js`.** REST over `fetch` with
   `Authorization: Bot <token>`, gateway over the runtime's native `WebSocket`.
   Both the fetch and the socket are injected, so tests drive the adapter with
   fakes and one integration test drives a real local WebSocket server.
3. **Discord channel keys are `guildId:channelId`.** Discord channel ids are
   globally unique, but keeping the guild makes the settings UI (grouped by
   server) honest and lets one stale channel id never shadow another server.
4. **In guilds the bot answers slash commands and explicit @mentions only.**
   Whitelisting a channel means "XR may act here", not "XR reads everything and
   replies to everything" — a channel where every human message triggered a run
   would burn budget and be unusable. The DM is the free-form chat surface.
5. **"View details" is an in-chat action plus a token-free dashboard link.**
   The brief suggested a URL button carrying a short-lived handoff token.
   Mailing a bearer-equivalent secret through Discord's servers is exactly what
   the Constitution forbids, and the desktop does not route `xr://` deep links
   yet (router.tsx says so). So: `👀 Details` posts the full preview ephemerally
   (same content Telegram shows) and `🖥 Open XR` is a URL button to the local
   dashboard, which authenticates with the session cookie the user already has.
6. **WhatsApp has no code pairing.** The QR *is* the pairing. Fail-closed is
   therefore about contacts: allow-list ∪ (optional) outbox, 1:1 only.
7. **Baileys and `qrcode` are optional dependencies**, imported lazily, like
   `playwright`. A user who never pairs WhatsApp should not pay for the
   dependency tree, and the daemon must boot without it.

## Open questions for review

- Should the Discord settings popover fetch the guild channel list through the
  daemon (`GET /api/discord/guilds`) or accept a pasted channel id? Implemented
  both: the picker is used when the channel read scope is granted, the paste
  field always works.
- WhatsApp group support stays out (1:1 only) — restating the out-of-scope list
  so it is not read as an oversight.
