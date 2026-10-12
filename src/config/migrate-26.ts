/**
 * XR — config shape for Phase 26 (Discord + WhatsApp chat surfaces).
 *
 * Additive and fully defaulted, like Phase 24's Telegram block: an existing
 * `config.json` gains the two blocks on the next save, every field has a
 * conservative default, and no value changes meaning. CONFIG_VERSION therefore
 * stays 22 — a bump is reserved for migrations that REINTERPRET existing
 * values (the Phase 9 → 22 migration for Telegram rate limits was one).
 *
 * Secrets never live here: the Discord bot token is in the SecretBroker, and
 * the WhatsApp session blob is in `~/.xr/whatsapp/` sealed with AES-256-GCM.
 */
import { z } from "zod";

/** Discord snowflake ids are 17–20 digits; keep slack for future formats. */
const SNOWFLAKE = z.string().regex(/^\d{5,25}$/);

const chatBudgetsShape = z
  .object({
    maxUsd: z.number().min(0).optional(),
    maxTokens: z.number().int().min(0).optional(),
  })
  .default({});

const rateLimitShape = z
  .object({
    /** Burst size. */
    tokens: z.number().positive().default(20),
    /** Sustained refill per second (default 20 messages a minute, as Telegram). */
    refillPerSec: z.number().min(0).default(20 / 60),
  })
  .default({});

export const phase26ConfigShape = {
  discord: z
    .object({
      /** The user wants the bot running. Set by Start/Stop and Connect/Disconnect. */
      enabled: z.boolean().default(false),
      /** Start on daemon boot when enabled and a token is present. */
      autoStart: z.boolean().default(true),
      rateLimit: rateLimitShape,
      chatBudgets: chatBudgetsShape,
      /**
       * Paired Discord user ids (snowflakes). Written by the `/xr pair <code>`
       * flow only; never preconfigured by hand — there is no env allow-list for
       * Discord, by design (the brief deleted it for Phase 24 too).
       */
      pairedUserIds: z.array(SNOWFLAKE).max(50).default([]),
      /**
       * Guild channels XR may answer in. Default empty = DMs only. A channel is
       * added from the Integrations settings popover or by redeeming a channel
       * code with `/xr pairchannel <code>` inside that channel.
       */
      allowedChannels: z
        .array(z.object({ guildId: SNOWFLAKE, channelId: SNOWFLAKE }))
        .max(100)
        .default([]),
      /** Documents are capped here; photos stay capped at 2 MB. */
      maxAttachmentBytes: z
        .number()
        .int()
        .min(64 * 1024)
        .max(20 * 1024 * 1024)
        .default(5 * 1024 * 1024),
      /**
       * The application's Ed25519 public key (64 hex chars) from the Discord
       * Developer Portal. Only needed for interactions-webhook mode, where it
       * verifies every request Discord sends.
       */
      publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
      /**
       * Optional public HTTPS URL for interactions-webhook mode. Discord
       * requires HTTPS and the user brings their own reverse proxy (same
       * no-built-in-tunnel rule as Telegram). Gateway mode is the default.
       */
      webhookUrl: z.string().url().startsWith("https://").max(2048).optional(),
      /**
       * When set, slash commands are registered in this one guild instead of
       * globally. Guild commands update instantly; global commands can take up
       * to an hour to propagate. This keeps the honest promise in the docs.
       */
      devGuildId: SNOWFLAKE.optional(),
    })
    .default({}),
  whatsapp: z
    .object({
      /** The user wants the linked device running. */
      enabled: z.boolean().default(false),
      /** Reconnect on daemon boot when credentials exist. */
      autoStart: z.boolean().default(true),
      rateLimit: rateLimitShape,
      chatBudgets: chatBudgetsShape,
      /**
       * Contacts XR will answer, as digits with country code (no `+`).
       * Default empty = nobody. Pairing with the phone does NOT allow anyone:
       * the QR links the device, the allow-list decides who may talk to XR.
       */
      allowedContacts: z.array(z.string().regex(/^\d{6,15}$/)).max(200).default([]),
      /**
       * When true, a contact the user messages first is added to the allow-list
       * automatically (outbox whitelist). Default false — the most conservative
       * setting, per the fail-closed rule.
       */
      respondToOutbox: z.boolean().default(false),
      /** Documents are capped here; photos stay capped at 2 MB. */
      maxAttachmentBytes: z
        .number()
        .int()
        .min(64 * 1024)
        .max(20 * 1024 * 1024)
        .default(5 * 1024 * 1024),
      /**
       * The account's own number, discovered when the device links. Read-only
       * mirror for the UI ("Linked as …"); never used to message anyone.
       */
      selfJid: z.string().max(64).optional(),
    })
    .default({}),
};
