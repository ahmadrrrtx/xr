/**
 * XR — S0 boot splash decision logic (Phase 1 · D-V3-5, pure).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HONESTY RULES (09-DESIGN-RETHINK-v3 §Boot splash, Apple HIG "Onboarding")
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Every line on the splash is a REAL boot fact the shell is waiting on —
 *     the engine link, the first health answer, the first-run question. There
 *     are no decorative lines, no invented steps, no fake progress.
 *  2. A warm boot shows NO splash. If every fact settles inside the grace
 *     window the shell mounts directly; a splash that would only be visible
 *     for a beat is a delay dressed up as a moment.
 *  3. A failure shows the splash IMMEDIATELY with the engine's own reason
 *     (and its stderr tail when the sidecar wrote one — W-5), never a generic
 *     "something went wrong".
 *  4. Nothing is held artificially: no minimum display time, no animation the
 *     facts have to wait for. "Skippable" is satisfied by construction.
 *
 * This module is DOM-free so the rules are unit-tested (test/desktop/boot.test.ts).
 */

export type BootKey = "link" | "health" | "setup";
export type BootState = "pending" | "ok" | "fail";

export interface BootFact {
  key: BootKey;
  state: BootState;
  /** What the engine actually said (port, version, reason). Never invented. */
  detail?: string;
  /** Milliseconds after boot start when the fact settled. */
  atMs?: number;
  /** W-5: the sidecar's own stderr tail, when the shell has one. */
  stderr?: string[];
}

/** Below this, a splash would only be perceived as a delay (HIG). */
export const SPLASH_GRACE_MS = 300;

export const BOOT_LABEL: Record<BootKey, string> = {
  link: "engine link",
  health: "engine health",
  setup: "first-run check",
};

export const INITIAL_FACTS: BootFact[] = [
  { key: "link", state: "pending" },
  { key: "health", state: "pending" },
  { key: "setup", state: "pending" },
];

export function settle(facts: BootFact[], key: BootKey, patch: Omit<BootFact, "key">): BootFact[] {
  return facts.map((f) => (f.key === key ? { ...f, ...patch, key } : f));
}

export function allOk(facts: BootFact[]): boolean {
  return facts.every((f) => f.state === "ok");
}

export function anyFailed(facts: BootFact[]): boolean {
  return facts.some((f) => f.state === "fail");
}

/**
 * Whether the splash should be on screen right now.
 *   · everything ok            → never (the shell mounts)
 *   · something failed         → yes, immediately (the failure explains itself)
 *   · still pending            → only once the grace window has passed
 */
export function shouldShowSplash(facts: BootFact[], elapsedMs: number): boolean {
  if (allOk(facts)) return false;
  if (anyFailed(facts)) return true;
  return elapsedMs >= SPLASH_GRACE_MS;
}

/** One terminal-style line per fact: `engine link      412ms  sidecar :52341`. */
export function formatBootLine(f: BootFact): { label: string; timing: string; detail: string; state: BootState } {
  return {
    label: BOOT_LABEL[f.key],
    timing: f.state === "pending" ? "…" : `${Math.max(0, Math.round(f.atMs ?? 0))}ms`,
    detail: f.detail ?? (f.state === "pending" ? "waiting" : ""),
    state: f.state,
  };
}
