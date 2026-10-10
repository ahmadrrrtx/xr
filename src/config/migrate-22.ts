/**
 * Config migration 21 → 22 (Phase 9 — Channel & Proactivity).
 *
 * Lives outside config.ts so the waived giant does not grow.
 * Additive: governed trigger pause-all, Telegram rate limits / per-chat
 * budgets, voice v2 flags (off by default).
 */
import { z } from "zod";

export const phase9ConfigShape = {
  triggers: z
    .object({
      /** Global kill switch. Stops NEW fires; in-flight runs keep their cancel path. */
      pauseAll: z.boolean().default(false),
      /** Daemon scheduler tick (ms). */
      tickMs: z.number().int().min(1_000).max(3_600_000).default(15_000),
    })
    .default({}),
  telegram: z
    .object({
      /** Per-chat message bucket. Default 20 messages a minute. */
      rateLimit: z
        .object({
          tokens: z.number().positive().default(20),
          refillPerSec: z.number().min(0).default(20 / 60),
        })
        .default({}),
      chatBudgets: z
        .object({
          maxUsd: z.number().min(0).optional(),
          maxTokens: z.number().int().min(0).optional(),
        })
        .default({}),
      /** The user wants the bot running. Set by Start/Stop and Connect/Disconnect. */
      enabled: z.boolean().default(false),
      /** Start on daemon boot when enabled and a token is present. */
      autoStart: z.boolean().default(true),
      /** Paired Telegram user ids. Written by the /start pairing flow; never preconfigured. */
      pairedUserIds: z.array(z.number().int().positive()).max(50).default([]),
      /** Optional public HTTPS URL. When set, Telegram pushes updates here instead of polling. */
      webhookUrl: z.string().url().startsWith("https://").max(2048).optional(),
      /** Documents are capped here; photos are capped at 2 MB regardless. */
      maxAttachmentBytes: z.number().int().min(64 * 1024).max(20 * 1024 * 1024).default(5 * 1024 * 1024),
    })
    .default({}),
};

export function migrate21to22(raw: any): any {
  return {
    ...raw,
    version: 22,
    triggers: {
      pauseAll: false,
      tickMs: 15_000,
      ...raw.triggers,
    },
    telegram: {
      rateLimit: {
        tokens: 10,
        refillPerSec: 0.2,
        ...raw.telegram?.rateLimit,
      },
      chatBudgets: {
        ...raw.telegram?.chatBudgets,
      },
    },
    voice: {
      ...raw.voice,
      streamingStt: raw.voice?.streamingStt ?? false,
      serverVad: raw.voice?.serverVad ?? false,
      sentenceTts: raw.voice?.sentenceTts ?? false,
      bargeInCancelsRun: raw.voice?.bargeInCancelsRun ?? false,
      spokenStatus: raw.voice?.spokenStatus ?? false,
    },
  };
}
