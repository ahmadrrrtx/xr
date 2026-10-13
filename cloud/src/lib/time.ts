/**
 * XR Cloud — time and money helpers.
 *
 * Both are small; both exist because getting either wrong is expensive and
 * silent. Periods are **UTC** and **fixed-width**, so a `periodKey` is a string
 * comparison rather than a date-range query (the cap check is on the hot path of
 * every managed-model call).
 */

/** Micro-USD per US dollar. Money is integer micro-USD everywhere. */
export const MICRO_USD = 1_000_000;

export function usdToMicro(usd: number): number {
  return Math.round(usd * MICRO_USD);
}

export function microToUsd(micro: number): number {
  return micro / MICRO_USD;
}

/** `$12.34` for UI, `$0.000123` for per-call costs. Never `$12.340000001`. */
export function formatMicroUsd(micro: number, opts?: { precise?: boolean }): string {
  const usd = microToUsd(micro);
  if (opts?.precise || (usd > 0 && usd < 0.01)) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(2)}`;
}

/** `day:2026-10-14` — UTC. */
export function dayKey(at: Date): string {
  return `day:${isoDay(at)}`;
}

/** `month:2026-10` — UTC. */
export function monthKey(at: Date): string {
  return `month:${isoMonth(at)}`;
}

export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function isoMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/** Start of the current UTC day. */
export function startOfUtcDay(at: Date): Date {
  const d = new Date(at);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of the current UTC month. */
export function startOfUtcMonth(at: Date): Date {
  const d = new Date(at);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86_400_000);
}

export function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}

export function secondsUntil(target: Date, from = new Date()): number {
  return Math.max(0, Math.floor((target.getTime() - from.getTime()) / 1000));
}

export function daysUntil(target: Date, from = new Date()): number {
  return Math.max(0, Math.ceil((target.getTime() - from.getTime()) / 86_400_000));
}

/**
 * Stripe hands us `unixEpochSeconds`. Undefined is `null`, never `new Date(0)` —
 * a zero date is a lie that reads as "1970" in an admin table.
 */
export function fromUnixSeconds(value: number | null | undefined): Date | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}

/** The two period keys a cap check consults. */
export function activePeriods(at = new Date()): { day: string; month: string } {
  return { day: dayKey(at), month: monthKey(at) };
}

/** "in 12 days" / "today" / "6 hours ago" — for quiet copy, never a countdown. */
export function humanInterval(target: Date, from = new Date()): string {
  const deltaMs = target.getTime() - from.getTime();
  const abs = Math.abs(deltaMs);
  const days = Math.round(abs / 86_400_000);
  if (days >= 1) return deltaMs >= 0 ? `in ${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ago`;
  const hours = Math.round(abs / 3_600_000);
  if (hours >= 1) return deltaMs >= 0 ? `in ${hours} hour${hours === 1 ? "" : "s"}` : `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const minutes = Math.round(abs / 60_000);
  if (minutes >= 1) return deltaMs >= 0 ? `in ${minutes} min` : `${minutes} min ago`;
  return "just now";
}
