/**
 * Approval TTL countdown — pure helpers (Phase 1 · approval countdown UI).
 *
 * The ENGINE owns the deadline: every approval carries `requestedAt` + `ttlMs`
 * (and `expiresAt`) from the ApprovalStore, whose TTL default-deny settles an
 * unanswered request no matter what the UI does. The renderer only counts the
 * engine's number down; it never extends, guesses or invents one. A missing
 * TTL renders as "no deadline reported", not as a made-up timer.
 */

export interface Deadline {
  requestedAt?: number;
  ttlMs?: number;
  expiresAt?: number;
}

/** The engine's deadline in epoch ms, or null when the payload has none. */
export function deadlineOf(d: Deadline): number | null {
  if (typeof d.expiresAt === "number" && Number.isFinite(d.expiresAt)) return d.expiresAt;
  if (typeof d.requestedAt === "number" && typeof d.ttlMs === "number" && Number.isFinite(d.requestedAt + d.ttlMs)) {
    return d.requestedAt + d.ttlMs;
  }
  return null;
}

/** Milliseconds left at `now` (never negative), or null without a deadline. */
export function remainingMs(d: Deadline, now: number): number | null {
  const at = deadlineOf(d);
  return at === null ? null : Math.max(0, at - now);
}

export type Urgency = "calm" | "soon" | "critical" | "expired";

/** <10 s is critical, <60 s is soon — thresholds a human can act within. */
export function urgencyOf(ms: number | null): Urgency | null {
  if (ms === null) return null;
  if (ms <= 0) return "expired";
  if (ms < 10_000) return "critical";
  if (ms < 60_000) return "soon";
  return "calm";
}

/** `4:32` / `0:07` — whole seconds, rounded UP so "1s" never shows at 0.4 s. */
export function formatRemaining(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
