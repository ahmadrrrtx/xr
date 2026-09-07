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
      rateLimit: z
        .object({
          tokens: z.number().positive().default(10),
          refillPerSec: z.number().min(0).default(0.2),
        })
        .default({}),
      chatBudgets: z
        .object({
          maxUsd: z.number().min(0).optional(),
          maxTokens: z.number().int().min(0).optional(),
        })
        .default({}),
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
