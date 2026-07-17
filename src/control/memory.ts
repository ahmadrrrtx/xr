/**
 * XR v0.8.2 — Computer Control: plan memory.
 *
 * After a plan succeeds end-to-end the planner can "remember" it: a deterministic
 * fingerprint of the task is the cache key, the validated Action[] is the
 * value, and everything rides on the existing `frozen_baselines` table so the
 * tamper-evident audit chain and dashboard keep working with zero new schema.
 *
 * Memory is a CACHE, not a source of truth:
 *   • Recalled plans still flow through classify → approve → execute → audit.
 *   • A cached plan can never bypass safety. The classifier runs again.
 *   • The user can list, inspect, forget, or wipe everything from the CLI
 *     and the dashboard.
 *
 * Hard gates BEFORE freezing a plan:
 *   • opts.allowMemory must be true (the service enables this only when the
 *     full plan ran successfully and the user wasn't using --dry-run / --step).
 *   • No action in the plan may be `sensitive: true` (no remembering secrets).
 *   • No action may be classified `destructive` (a plan that asked for
 *     dangerous actions stays one-shot; we never auto-replay it).
 *   • The plan must have at least one action and at most 20.
 *
 * Hard gates BEFORE recalling a plan:
 *   • Memory must be enabled in config.
 *   • The fingerprinted task must match exactly.
 *   • Every cached action is re-validated against the current Zod schema
 *     (catches schema drift after upgrades).
 *   • Every cached action is re-classified — if any are now destructive the
 *     cached plan is invalidated and dropped.
 */

import { randomUUID, createHash } from "node:crypto";
import type { Store } from "../state/workspace-store.ts";
import { ActionSchema, type Action, type Plan } from "./types.ts";
import { classify } from "./classify.ts";

/** Skill-id prefix so control plans don't collide with other learned skills. */
const SKILL_PREFIX = "control:";

/** Maximum actions we will EVER cache. Anything bigger is a workflow that
 *  the user probably wants to script properly, not a quick task to memoize. */
const MAX_CACHED_ACTIONS = 20;

// ── Fingerprint ──────────────────────────────────────────────────────────────

/**
 * Normalise a natural-language task into a stable cache key.
 *   "Open GitHub!"  →  "open github"
 *   "  Open   GitHub  "  →  "open github"
 * We deliberately do NOT do stemming / synonyms — those would create
 * false-positive cache hits and let the user lose track of what's cached.
 */
export function fingerprintTask(task: string): string {
  const norm = task
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")  // strip punctuation but keep unicode letters
    .replace(/\s+/g, " ")
    .trim();
  // We hash so the skill_id is short + database-friendly. The raw task is
  // stored in `skills.why` so users can read what they remembered.
  const hash = createHash("sha256").update(norm).digest("hex").slice(0, 16);
  return `${SKILL_PREFIX}${hash}`;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface RememberedPlan {
  /** Skill id (with the "control:" prefix). */
  skillId: string;
  /** Frozen baseline id (the actual row in frozen_baselines). */
  baselineId: string;
  /** The original task string, for display. */
  task: string;
  /** Cached actions. Already re-validated when returned from `recall()`. */
  actions: Action[];
  /** Schema version of this cache entry. */
  cacheVersion: number;
  /** When it was first remembered (ms). */
  rememberedAt: number;
  /** How many times we've reused this plan. */
  hits: number;
}

export interface RememberInput {
  task: string;
  plan: Plan;
  /** Caller must set true ONLY when the plan ran successfully end-to-end. */
  allowMemory: boolean;
}

export type RememberOutcome =
  | { ok: true; baselineId: string; reason: "stored" | "updated" }
  | { ok: false; reason: string };

// ── Internal helpers ────────────────────────────────────────────────────────

const CACHE_SCHEMA_VERSION = 1;

interface BaselineRow {
  steps_json: string;
  verifier_json: string;
}

/** Wrapped payload stored in `frozen_baselines.steps_json`. */
interface CachePayload {
  cacheVersion: number;
  task: string;
  actions: Action[];
  rememberedAt: number;
  hits: number;
}

function packPayload(p: Omit<CachePayload, "cacheVersion">): string {
  return JSON.stringify({ cacheVersion: CACHE_SCHEMA_VERSION, ...p });
}

function unpackPayload(steps_json: string): CachePayload | null {
  try {
    const obj = JSON.parse(steps_json);
    if (typeof obj !== "object" || obj == null) return null;
    if (obj.cacheVersion !== CACHE_SCHEMA_VERSION) return null;
    if (typeof obj.task !== "string") return null;
    if (!Array.isArray(obj.actions)) return null;
    return obj as CachePayload;
  } catch {
    return null;
  }
}

// ── Pre-freeze safety check ─────────────────────────────────────────────────

/** Pure: decide whether a plan is safe to remember. Returns reason on refusal. */
export function isPlanRememberable(plan: Plan): { ok: true } | { ok: false; reason: string } {
  if (!plan.actions.length) return { ok: false, reason: "empty plan" };
  if (plan.actions.length > MAX_CACHED_ACTIONS) {
    return { ok: false, reason: `plan too long (${plan.actions.length} > ${MAX_CACHED_ACTIONS})` };
  }
  for (const a of plan.actions) {
    if ((a as any).sensitive === true) {
      return { ok: false, reason: "plan contains a sensitive value — refusing to memoize" };
    }
    const risk = classify(a);
    if (risk.level === "destructive") {
      return { ok: false, reason: `plan contains a destructive action (${a.type}) — refusing to memoize` };
    }
  }
  return { ok: true };
}

// ── Remember ────────────────────────────────────────────────────────────────

/**
 * Store a successful plan as a frozen baseline. Idempotent: if a baseline for
 * the same task fingerprint already exists, we update it in place rather than
 * creating a duplicate. We never delete history through this path — the audit
 * chain remains append-only.
 */
export function rememberPlan(store: Store, input: RememberInput): RememberOutcome {
  if (!input.allowMemory) return { ok: false, reason: "memory not allowed for this run" };

  const safe = isPlanRememberable(input.plan);
  if (!safe.ok) {
    store.audit("control.memory.refused", { task: input.task, reason: safe.reason });
    return { ok: false, reason: safe.reason };
  }

  const skillId = fingerprintTask(input.task);
  const existing = findExisting(store, skillId);

  if (existing) {
    // Reuse the same baseline row; bump hits + refresh actions.
    const merged: Omit<CachePayload, "cacheVersion"> = {
      task: input.task,
      actions: input.plan.actions,
      rememberedAt: existing.rememberedAt,
      hits: existing.hits, // bumped only by recall(), not by re-remember
    };
    updateBaseline(store, existing.baselineId, packPayload(merged));
    store.audit("control.memory.updated", { skillId, baselineId: existing.baselineId, task: input.task, steps: input.plan.actions.length });
    return { ok: true, baselineId: existing.baselineId, reason: "updated" };
  }

  // Fresh entry: insert skill row + frozen baseline.
  const version = store.latestSkillVersion(skillId) + 1;
  const baselineId = `cm_${randomUUID().slice(0, 8)}`;
  const payload = packPayload({
    task: input.task,
    actions: input.plan.actions,
    rememberedAt: Date.now(),
    hits: 0,
  });
  // The verifier is a stub ("user_approved") — we don't run automatic
  // regression on browser/desktop plans, because side effects on the real
  // computer aren't safe to replay autonomously. The plan still rides the
  // frozen-baselines table for storage / tamper evidence / dashboard.
  const verifierJson = JSON.stringify({ kind: "user_approved" });
  store.insertSkill(skillId, version, "learned", input.task);
  store.setActiveSkillVersion(skillId, version);
  store.freezeBaseline(baselineId, skillId, version, payload, verifierJson);
  store.audit("control.memory.stored", { skillId, baselineId, task: input.task, steps: input.plan.actions.length });
  return { ok: true, baselineId, reason: "stored" };
}

// ── Recall ──────────────────────────────────────────────────────────────────

/**
 * Look up a remembered plan for this task. Returns null on:
 *   • cache miss
 *   • schema drift (payload from an older cache version)
 *   • re-validation failure (an action no longer matches the Zod schema)
 *   • re-classification flagged something as destructive
 *
 * Any of those silently invalidate the entry so the planner falls back to the
 * LLM. We never throw from this function — a cache must never break a run.
 */
export function recallPlan(store: Store, task: string): RememberedPlan | null {
  const skillId = fingerprintTask(task);
  const row = findExisting(store, skillId);
  if (!row) return null;

  // Re-validate every cached action against the current schema.
  const validated: Action[] = [];
  for (const a of row.actions) {
    const result = ActionSchema.safeParse(a);
    if (!result.success) {
      store.audit("control.memory.invalidated", { skillId, reason: "schema drift" });
      return null;
    }
    const risk = classify(result.data);
    if (risk.level === "destructive") {
      store.audit("control.memory.invalidated", { skillId, reason: "now-destructive action" });
      return null;
    }
    validated.push(result.data);
  }

  // Bump the hit counter (best-effort; failures here must not break recall).
  try {
    const bumped: Omit<CachePayload, "cacheVersion"> = {
      task: row.task,
      actions: row.actions,
      rememberedAt: row.rememberedAt,
      hits: row.hits + 1,
    };
    updateBaseline(store, row.baselineId, packPayload(bumped));
  } catch { /* ignore */ }

  store.audit("control.memory.hit", { skillId, baselineId: row.baselineId, task });

  return {
    skillId,
    baselineId: row.baselineId,
    task: row.task,
    actions: validated,
    cacheVersion: CACHE_SCHEMA_VERSION,
    rememberedAt: row.rememberedAt,
    hits: row.hits + 1,
  };
}

// ── List / forget ───────────────────────────────────────────────────────────

export function listRemembered(store: Store): RememberedPlan[] {
  // We need a way to enumerate frozen baselines whose skill_id starts with our
  // prefix. The existing Store has no such helper, so we go through the raw
  // SQLite handle on a tiny ad-hoc query. This keeps the Store API minimal.
  const rows = (store as any).db
    .query(
      `SELECT id, skill_id, steps_json, frozen_at
         FROM frozen_baselines
        WHERE skill_id LIKE ?
        ORDER BY frozen_at DESC`,
    )
    .all(`${SKILL_PREFIX}%`) as Array<{
      id: string;
      skill_id: string;
      steps_json: string;
      frozen_at: number;
    }>;

  const out: RememberedPlan[] = [];
  for (const r of rows) {
    const p = unpackPayload(r.steps_json);
    if (!p) continue;
    out.push({
      skillId: r.skill_id,
      baselineId: r.id,
      task: p.task,
      actions: p.actions,
      cacheVersion: p.cacheVersion,
      rememberedAt: p.rememberedAt,
      hits: p.hits,
    });
  }
  return out;
}

export function forgetPlan(store: Store, baselineIdOrTask: string): { ok: boolean; reason: string } {
  const db = (store as any).db;
  // Allow forgetting by exact baseline id, by skill id, or by task string.
  let skillId = baselineIdOrTask.startsWith(SKILL_PREFIX) ? baselineIdOrTask : fingerprintTask(baselineIdOrTask);
  const byBaseline = db.query(`SELECT skill_id FROM frozen_baselines WHERE id=?`).get(baselineIdOrTask) as { skill_id?: string } | undefined;
  if (byBaseline?.skill_id) skillId = byBaseline.skill_id;

  const before = db.query(`SELECT COUNT(*) c FROM frozen_baselines WHERE skill_id=?`).get(skillId)?.c ?? 0;
  if (!before) return { ok: false, reason: "no remembered plan matches" };

  db.query(`DELETE FROM regression_cases WHERE skill_id=?`).run(skillId);
  db.query(`DELETE FROM frozen_baselines WHERE skill_id=?`).run(skillId);
  db.query(`DELETE FROM skills WHERE id=?`).run(skillId);
  store.audit("control.memory.forgotten", { skillId, removed: before });
  return { ok: true, reason: `forgot ${before} entr${before === 1 ? "y" : "ies"}` };
}

export function clearAllMemory(store: Store): number {
  const db = (store as any).db;
  const rows = db.query(`SELECT id FROM skills WHERE id LIKE ?`).all(`${SKILL_PREFIX}%`) as Array<{ id: string }>;
  if (!rows.length) return 0;
  for (const r of rows) {
    db.query(`DELETE FROM regression_cases WHERE skill_id=?`).run(r.id);
    db.query(`DELETE FROM frozen_baselines WHERE skill_id=?`).run(r.id);
    db.query(`DELETE FROM skills WHERE id=?`).run(r.id);
  }
  store.audit("control.memory.cleared", { removed: rows.length });
  return rows.length;
}

// ── Internal: find existing entry by skill id ───────────────────────────────

interface InternalRow {
  baselineId: string;
  task: string;
  actions: Action[];
  rememberedAt: number;
  hits: number;
}

function findExisting(store: Store, skillId: string): InternalRow | null {
  const row = (store as any).db
    .query(
      `SELECT id, steps_json FROM frozen_baselines
        WHERE skill_id=? ORDER BY frozen_at DESC LIMIT 1`,
    )
    .get(skillId) as { id: string; steps_json: string } | undefined;
  if (!row) return null;
  const payload = unpackPayload(row.steps_json);
  if (!payload) return null;
  return {
    baselineId: row.id,
    task: payload.task,
    actions: payload.actions,
    rememberedAt: payload.rememberedAt,
    hits: payload.hits,
  };
}

function updateBaseline(store: Store, baselineId: string, newStepsJson: string): void {
  (store as any).db
    .query(`UPDATE frozen_baselines SET steps_json=? WHERE id=?`)
    .run(newStepsJson, baselineId);
}
