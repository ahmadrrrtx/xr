/**
 * XR Phase 9 — trigger spec validation, quiet-hours math, cron matching.
 *
 * Pure functions: no I/O, no store, no timers. The scheduler loop (triggers.ts)
 * is the only thing that decides to fire; this module answers "is this a legal
 * trigger?" and "would it be due at `now` if it were enabled?".
 */
import { isDue, parseSchedule, type Schedule } from "./cron.ts";

export type TriggerKind = "cron" | "event" | "watch";
export type ApprovalMode = "inherit" | "require";

export interface QuietHours {
  /** "HH:MM" 24h local clock. */
  start: string;
  /** "HH:MM" 24h local clock. If start > end the window wraps midnight. */
  end: string;
}

export interface TriggerBudget {
  maxUsd?: number;
  maxTokens?: number;
}

export type CronSpec = { kind: "cron"; expr?: string; nl?: string };
export type EventSpec = { kind: "event"; event: string };
export type WatchSpec = { kind: "watch"; path: string; glob?: string };
export type TriggerSpec = CronSpec | EventSpec | WatchSpec;

export interface TriggerInput {
  id?: string;
  kind: TriggerKind;
  spec: TriggerSpec;
  /** Task text / template interpolated at fire time. */
  taskTemplate: string;
  budget: TriggerBudget;
  approvalMode?: ApprovalMode;
  quietHours?: QuietHours;
  enabled?: boolean;
  /** Explicit consent token (approval id, "cli:user:<ts>", …). Required to create. */
  consentRef: string;
}

export interface Trigger extends TriggerInput {
  id: string;
  approvalMode: ApprovalMode;
  enabled: boolean;
  createdAt: number;
  lastFiredAt?: number;
  lastEnvelopeId?: string;
  spentUsd: number;
  spentTokens: number;
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVENT_NAME = /^[a-z][a-z0-9._-]{1,80}$/i;
const ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;

export function parseHhMm(s: string): { h: number; m: number } | null {
  const m = HHMM.exec((s ?? "").trim());
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** Minutes from local midnight. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Quiet-hours membership. A window that wraps midnight (22:00–07:00) is
 * inside if `now` is ≥ start OR < end. Empty/invalid windows never quiet.
 */
export function inQuietHours(qh: QuietHours | undefined, now: Date): boolean {
  if (!qh) return false;
  const start = parseHhMm(qh.start);
  const end = parseHhMm(qh.end);
  if (!start || !end) return false;
  const s = start.h * 60 + start.m;
  const e = end.h * 60 + end.m;
  const n = minutesOfDay(now);
  if (s === e) return false; // zero-width = never quiet
  if (s < e) return n >= s && n < e;
  return n >= s || n < e;
}

/** 5-field cron (m h dom mon dow). Supports *, n, a-b, a,b, star/n, a-b/n. */
export function cronMatches(expr: string, date: Date): boolean {
  const parts = (expr ?? "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  return (
    fieldMatches(min!, date.getMinutes(), 0, 59) &&
    fieldMatches(hour!, date.getHours(), 0, 23) &&
    fieldMatches(dom!, date.getDate(), 1, 31) &&
    fieldMatches(mon!, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dow!, date.getDay(), 0, 6)
  );
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const tok of field.split(",")) {
    const stepSplit = tok.split("/");
    const range = stepSplit[0]!;
    const step = stepSplit[1] ? Number(stepSplit[1]) : 1;
    if (!Number.isFinite(step) || step < 1) return false;
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = hi = Number(range);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
  }
  return false;
}

export type FireSkip = "paused" | "disabled" | "quiet" | "not-due" | "already-fired";

export interface FireDecision {
  fire: boolean;
  reason?: FireSkip;
}

/**
 * Pause-all + quiet-hours + due-check. In-flight tasks are NOT this function's
 * concern — the scheduler tracks those separately and never cancels them here.
 */
export function shouldFire(
  trigger: Trigger,
  ctx: { pausedAll: boolean; now: Date },
): FireDecision {
  if (ctx.pausedAll) return { fire: false, reason: "paused" };
  if (!trigger.enabled) return { fire: false, reason: "disabled" };
  if (inQuietHours(trigger.quietHours, ctx.now)) return { fire: false, reason: "quiet" };
  if (!isDueAt(trigger, ctx.now)) return { fire: false, reason: "not-due" };
  return { fire: true };
}

export function isDueAt(trigger: Trigger, now: Date): boolean {
  const spec = trigger.spec;
  if (spec.kind === "event") return false; // events fire only via notify()
  if (spec.kind === "watch") {
    // Watch due-check is I/O (mtime); the scheduler does it. Spec-level: always
    // "maybe" — the loop supplies an override. Treat as not-due here.
    return false;
  }
  if (spec.expr && cronMatches(spec.expr, now)) {
    return !firedThisMinute(trigger.lastFiredAt, now);
  }
  if (spec.nl) {
    const parsed = parseSchedule(`${spec.nl}: ${trigger.taskTemplate}`, trigger.id);
    if (!parsed) return false;
    const sched: Schedule = { ...parsed, lastRun: trigger.lastFiredAt, enabled: true };
    return isDue(sched, now);
  }
  return false;
}

export function firedThisMinute(lastFiredAt: number | undefined, now: Date): boolean {
  if (!lastFiredAt) return false;
  return Math.floor(lastFiredAt / 60_000) === Math.floor(now.getTime() / 60_000);
}

export type Validation = { ok: true } | { ok: false; error: string };

export function validateTriggerInput(input: TriggerInput): Validation {
  if (!input.kind || !["cron", "event", "watch"].includes(input.kind)) {
    return { ok: false, error: "kind must be cron | event | watch" };
  }
  if (!input.taskTemplate || !input.taskTemplate.trim()) {
    return { ok: false, error: "taskTemplate is required" };
  }
  if (!input.consentRef || !input.consentRef.trim()) {
    return { ok: false, error: "creating a trigger requires explicit consent (consentRef)" };
  }
  if (input.id && !ID_RE.test(input.id)) {
    return { ok: false, error: "id must match /^[a-z0-9][a-z0-9_-]{1,63}$/i" };
  }
  if (input.approvalMode && input.approvalMode !== "inherit" && input.approvalMode !== "require") {
    return { ok: false, error: "approvalMode must be inherit | require" };
  }
  const budgetErr = validateBudget(input.budget);
  if (!budgetErr.ok) return budgetErr;
  if (input.quietHours) {
    if (!parseHhMm(input.quietHours.start) || !parseHhMm(input.quietHours.end)) {
      return { ok: false, error: "quietHours.start/end must be HH:MM" };
    }
  }
  return validateSpec(input.kind, input.spec);
}

export function validateBudget(budget: TriggerBudget): Validation {
  if (!budget || (budget.maxUsd == null && budget.maxTokens == null)) {
    return { ok: false, error: "budget declaration required (maxUsd and/or maxTokens)" };
  }
  if (budget.maxUsd != null && (!Number.isFinite(budget.maxUsd) || budget.maxUsd < 0)) {
    return { ok: false, error: "budget.maxUsd must be a finite number ≥ 0" };
  }
  if (budget.maxTokens != null && (!Number.isFinite(budget.maxTokens) || budget.maxTokens < 0)) {
    return { ok: false, error: "budget.maxTokens must be a finite number ≥ 0" };
  }
  return { ok: true };
}

export function validateSpec(kind: TriggerKind, spec: TriggerSpec): Validation {
  if (!spec || spec.kind !== kind) {
    return { ok: false, error: `spec.kind must equal trigger kind (${kind})` };
  }
  if (spec.kind === "cron") {
    if (!spec.expr && !spec.nl) return { ok: false, error: "cron spec needs expr or nl" };
    if (spec.expr) {
      const parts = spec.expr.trim().split(/\s+/);
      if (parts.length !== 5) return { ok: false, error: "cron expr must have 5 fields (m h dom mon dow)" };
      const fieldOk = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?|\d+(,\d+)*)$/;
      if (!parts.every((p) => fieldOk.test(p))) {
        return { ok: false, error: "cron expr has invalid fields" };
      }
    }
    if (spec.nl && !parseSchedule(`${spec.nl}: task`, "tmp")) {
      return { ok: false, error: `could not parse natural-language schedule: ${spec.nl}` };
    }
    return { ok: true };
  }
  if (spec.kind === "event") {
    if (!spec.event || !EVENT_NAME.test(spec.event)) {
      return { ok: false, error: "event spec needs a name like session.done" };
    }
    return { ok: true };
  }
  if (!spec.path || spec.path.length > 4096) {
    return { ok: false, error: "watch spec needs a path" };
  }
  return { ok: true };
}

export function interpolateTask(template: string, ctx: Record<string, string> = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}
