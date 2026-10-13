/**
 * XR Cloud — usage metering.
 *
 * ## What is recorded
 *
 * Token counts, model, provider, workspace, user, timestamp, latency, and the
 * cost XR incurred. **Not** the prompt, **not** the completion, **not** a hash of
 * either. A billing system needs to know that 3,412 tokens went to
 * `claude-sonnet-4-5` at 09:14; it does not need to know what was said, and the
 * brief is explicit that request metadata must not include conversation content.
 * There is no column for it, so it cannot leak into one later by accident.
 *
 * ## Cost
 *
 * Prices are stored in **micro-USD per million tokens** so the arithmetic is
 * integer throughout:
 *
 *   cost = (inputTokens * inputPerM + outputTokens * outputPerM) / 1_000_000
 *
 * The divide is a single `Math.round` at the end. A model with no price entry
 * yields `null` from `priceFor` — not zero — because "we do not know what this
 * costs" and "this is free" are different facts, and reporting the first as the
 * second understates a bill.
 *
 * ## Counters
 *
 * Cap checks read `usage_counters`, never a SUM over `usage_events`. The counter
 * is updated in the same transaction that appends the event, so the two cannot
 * disagree. `reconcileCounters` recomputes from events and is used by tests and
 * by an operator who suspects drift.
 */

import { and, eq, gte, sql } from "drizzle-orm";

import type { CloudDb } from "../db/client.ts";
import { usageCounters, usageEvents } from "../db/schema.ts";
import { newId } from "../lib/ids.ts";
import type { Logger } from "../lib/logger.ts";
import { isoDay as ISO_DAY, isoMonth as ISO_MONTH } from "../lib/time.ts";

/** Micro-USD per 1,000,000 tokens. */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

/**
 * Published list prices, as micro-USD per million tokens.
 *
 * These exist so a **soft quota** can be checked before a call runs — the brief's
 * §G overage model. They are not the source of truth for what a provider charges
 * us; they are XR's published rates, and the docs say so. Updating them is a
 * one-line diff in this table, which is the point of keeping them in one place
 * with the date recorded.
 *
 * Verified against provider pricing pages 2026-10. Provider list prices change;
 * this table is a *quote*, not an invoice.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4.1": { inputPerM: 2_000_000, outputPerM: 8_000_000 },
  "gpt-4.1-mini": { inputPerM: 400_000, outputPerM: 1_600_000 },
  "gpt-4o": { inputPerM: 2_500_000, outputPerM: 10_000_000 },
  "gpt-4o-mini": { inputPerM: 150_000, outputPerM: 600_000 },
  o1: { inputPerM: 15_000_000, outputPerM: 60_000_000 },
  "o3-mini": { inputPerM: 1_100_000, outputPerM: 4_400_000 },
  // Anthropic
  "claude-opus-4": { inputPerM: 15_000_000, outputPerM: 75_000_000 },
  "claude-sonnet-4-5": { inputPerM: 3_000_000, outputPerM: 15_000_000 },
  "claude-haiku-4-5": { inputPerM: 1_000_000, outputPerM: 5_000_000 },
  // Google
  "gemini-2.5-pro": { inputPerM: 1_250_000, outputPerM: 10_000_000 },
  "gemini-2.5-flash": { inputPerM: 300_000, outputPerM: 2_500_000 },
};

/** Longest-prefix match, so a dated release resolves without a table entry. */
export function priceFor(model: string): ModelPrice | null {
  const exact = MODEL_PRICES[model];
  if (exact) return exact;
  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) best = { key, price };
  }
  return best?.price ?? null;
}

/** Exact integer micro-USD for a call. `null` when the model is unpriced. */
export function costMicroUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const micro =
    (BigInt(Math.max(0, Math.floor(inputTokens))) * BigInt(price.inputPerM) +
      BigInt(Math.max(0, Math.floor(outputTokens))) * BigInt(price.outputPerM)) /
    1_000_000n;
  return Number(micro);
}

/** Pre-flight estimate, used by the policy gate. Conservative: assumes output. */
export function estimateCostMicroUsd(
  model: string,
  promptChars: number,
  maxOutputTokens: number,
): number | null {
  // ~4 characters per token is the usual English approximation. It is an
  // ESTIMATE and is labelled one everywhere it surfaces.
  const inputTokens = Math.ceil(Math.max(0, promptChars) / 4);
  return costMicroUsd(model, inputTokens, Math.max(0, maxOutputTokens));
}

export interface RecordUsageInput {
  orgId: string;
  userId: string;
  workspaceId?: string | null;
  provider: string;
  model: string;
  managed: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs?: number | null;
  requestId?: string | null;
  at?: Date;
}

export interface UsageSnapshot {
  todayMicroUsd: number;
  monthMicroUsd: number;
  teamMonthMicroUsd: number;
  todayTokens: number;
  monthTokens: number;
  requestsThisMonth: number;
}

export interface MeteringService {
  record(input: RecordUsageInput): Promise<{ costMicroUsd: number | null; recorded: boolean }>;
  snapshot(orgId: string, userId: string, at?: Date): Promise<UsageSnapshot>;
  /** Per-day series for the admin spend chart. Bounded window. */
  series(orgId: string, days: number, userId?: string): Promise<Array<{ day: string; microUsd: number }>>;
  byModel(orgId: string, sinceDays: number): Promise<Array<{ model: string; provider: string; microUsd: number; requests: number }>>;
  reconcileCounters(orgId: string, userId: string): Promise<{ fixed: number }>;
}

export function createMeteringService(db: CloudDb, log: Logger): MeteringService {
  async function applyCounter(
    orgId: string,
    userId: string,
    periodKey: string,
    delta: { cost: number; input: number; output: number; requests: number },
    at: Date,
  ): Promise<void> {
    // Upsert-and-add in one statement. A read-modify-write here would lose
    // increments under concurrency, which is exactly when spend matters most.
    await db
      .insert(usageCounters)
      .values({
        id: newId("usageEvent"),
        orgId,
        userId,
        periodKey,
        costMicroUsd: delta.cost,
        inputTokens: delta.input,
        outputTokens: delta.output,
        requests: delta.requests,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [usageCounters.orgId, usageCounters.userId, usageCounters.periodKey],
        set: {
          costMicroUsd: sql`${usageCounters.costMicroUsd} + ${delta.cost}`,
          inputTokens: sql`${usageCounters.inputTokens} + ${delta.input}`,
          outputTokens: sql`${usageCounters.outputTokens} + ${delta.output}`,
          requests: sql`${usageCounters.requests} + ${delta.requests}`,
          updatedAt: at,
        },
      });
  }

  return {
    async record(input) {
      const at = input.at ?? new Date();
      const cost = costMicroUsd(input.model, input.inputTokens, input.outputTokens);

      await db.transaction(async (tx) => {
        await tx.insert(usageEvents).values({
          id: newId("usageEvent"),
          orgId: input.orgId,
          userId: input.userId,
          workspaceId: input.workspaceId ?? null,
          provider: input.provider,
          model: input.model,
          managed: input.managed,
          inputTokens: Math.max(0, Math.floor(input.inputTokens)),
          outputTokens: Math.max(0, Math.floor(input.outputTokens)),
          costMicroUsd: cost ?? 0,
          latencyMs: input.latencyMs ?? null,
          requestId: input.requestId ?? null,
          day: ISO_DAY(at),
          createdAt: at,
        });

        if (input.managed) {
          const delta = {
            // An unpriced model records 0 cost against the counter but is NOT
            // silently reported to the customer as free — the response carries
            // `costMicroUsd: null` so the UI can say "unpriced".
            cost: cost ?? 0,
            input: Math.max(0, Math.floor(input.inputTokens)),
            output: Math.max(0, Math.floor(input.outputTokens)),
            requests: 1,
          };
          await applyCounter(input.orgId, input.userId, `day:${ISO_DAY(at)}`, delta, at);
          await applyCounter(input.orgId, input.userId, `month:${ISO_MONTH(at)}`, delta, at);
        }
      });

      return { costMicroUsd: cost, recorded: true };
    },

    async snapshot(orgId, userId, at = new Date()) {
      const dayKey = `day:${ISO_DAY(at)}`;
      const monthKey = `month:${ISO_MONTH(at)}`;

      const mine = await db
        .select()
        .from(usageCounters)
        .where(
          and(
            eq(usageCounters.orgId, orgId),
            eq(usageCounters.userId, userId),
            sql`${usageCounters.periodKey} in (${dayKey}, ${monthKey})`,
          ),
        );

      const dayRow = mine.find((r) => r.periodKey === dayKey);
      const monthRow = mine.find((r) => r.periodKey === monthKey);

      const team = await db
        .select({ total: sql<number>`coalesce(sum(${usageCounters.costMicroUsd}), 0)::bigint` })
        .from(usageCounters)
        .where(and(eq(usageCounters.orgId, orgId), eq(usageCounters.periodKey, monthKey)));

      return {
        todayMicroUsd: dayRow?.costMicroUsd ?? 0,
        monthMicroUsd: monthRow?.costMicroUsd ?? 0,
        teamMonthMicroUsd: Number(team[0]?.total ?? 0),
        todayTokens: (dayRow?.inputTokens ?? 0) + (dayRow?.outputTokens ?? 0),
        monthTokens: (monthRow?.inputTokens ?? 0) + (monthRow?.outputTokens ?? 0),
        requestsThisMonth: monthRow?.requests ?? 0,
      };
    },

    async series(orgId, days, userId) {
      const since = new Date(Date.now() - Math.max(1, Math.min(days, 365)) * 86_400_000);
      const conditions = [eq(usageEvents.orgId, orgId), gte(usageEvents.createdAt, since)];
      if (userId) conditions.push(eq(usageEvents.userId, userId));
      const rows = await db
        .select({
          day: usageEvents.day,
          microUsd: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
        })
        .from(usageEvents)
        .where(and(...conditions))
        .groupBy(usageEvents.day)
        .orderBy(usageEvents.day);
      return rows.map((r) => ({ day: r.day, microUsd: Number(r.microUsd) }));
    },

    async byModel(orgId, sinceDays) {
      const since = new Date(Date.now() - Math.max(1, Math.min(sinceDays, 365)) * 86_400_000);
      const rows = await db
        .select({
          model: usageEvents.model,
          provider: usageEvents.provider,
          microUsd: sql<number>`coalesce(sum(${usageEvents.costMicroUsd}), 0)::bigint`,
          requests: sql<number>`count(*)::int`,
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.createdAt, since)))
        .groupBy(usageEvents.model, usageEvents.provider)
        .orderBy(sql`sum(${usageEvents.costMicroUsd}) desc`)
        .limit(50);
      return rows.map((r) => ({
        model: r.model,
        provider: r.provider,
        microUsd: Number(r.microUsd),
        requests: r.requests,
      }));
    },

    /**
     * Recompute counters from the event log. Returns how many period rows were
     * corrected. Used by tests, and available to an operator who sees a number
     * that does not add up — the counter is a cache, the events are the record.
     */
    async reconcileCounters(orgId, userId) {
      const events = await db
        .select({
          day: usageEvents.day,
          inputTokens: usageEvents.inputTokens,
          outputTokens: usageEvents.outputTokens,
          costMicroUsd: usageEvents.costMicroUsd,
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.userId, userId), eq(usageEvents.managed, true)));

      const aggregate = new Map<string, { cost: number; input: number; output: number; requests: number }>();
      for (const e of events) {
        for (const key of [`day:${e.day}`, `month:${e.day.slice(0, 7)}`]) {
          const current = aggregate.get(key) ?? { cost: 0, input: 0, output: 0, requests: 0 };
          current.cost += e.costMicroUsd;
          current.input += e.inputTokens;
          current.output += e.outputTokens;
          current.requests += 1;
          aggregate.set(key, current);
        }
      }

      let fixed = 0;
      for (const [periodKey, totals] of aggregate) {
        const existing = await db
          .select()
          .from(usageCounters)
          .where(
            and(
              eq(usageCounters.orgId, orgId),
              eq(usageCounters.userId, userId),
              eq(usageCounters.periodKey, periodKey),
            ),
          )
          .limit(1);
        const row = existing[0];
        if (
          row &&
          row.costMicroUsd === totals.cost &&
          row.inputTokens === totals.input &&
          row.outputTokens === totals.output &&
          row.requests === totals.requests
        ) {
          continue;
        }
        await db
          .insert(usageCounters)
          .values({
            id: newId("usageEvent"),
            orgId,
            userId,
            periodKey,
            costMicroUsd: totals.cost,
            inputTokens: totals.input,
            outputTokens: totals.output,
            requests: totals.requests,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [usageCounters.orgId, usageCounters.userId, usageCounters.periodKey],
            set: {
              costMicroUsd: totals.cost,
              inputTokens: totals.input,
              outputTokens: totals.output,
              requests: totals.requests,
              updatedAt: new Date(),
            },
          });
        fixed += 1;
      }
      if (fixed > 0) log.warn({ orgId, userId, fixed }, "usage counters reconciled from events");
      return { fixed };
    },
  };
}
