/**
 * XR Phase 2 · F-11/M-10 — Durable approval store.
 *
 * Replaces the in-memory `ApprovalQueue` with SQLite-backed consent records:
 *
 *   • Every approval request is a durable row (survives restarts; a killed
 *     process can never orphan a task into an unanswered prompt forever).
 *   • TTL default-deny on EVERY surface: an unanswered approval becomes a
 *     DENIED action (`timed_out`), never a stuck process. The old Telegram
 *     5-minute behavior is now a special case of the global TTL.
 *   • Cross-process resolution: the requesting side awaits a store watcher
 *     (in-process promise bridge with a DB poll fallback), so a daemon
 *     process can decide an approval raised by a CLI process (and vice
 *     versa) — both share the same workspace SQLite file (WAL).
 *   • Every transition is audited: approval.requested / approval.decided /
 *     approval.timed_out (plus the legacy telegram.approval.* events kept by
 *     the Telegram surface for backward-compatible reporting).
 *
 * The in-process fast path: `decide()` resolves the local waiter synchronously
 * (sub-ms), so interactive CLI latency is unchanged; the poller is only the
 * cross-process bridge.
 */

import { createHash, randomUUID } from "node:crypto";
import type { WorkspaceStore, ApprovalRow } from "../state/workspace-store.ts";
import type { StructuredPreview } from "./preview.ts";

export const DEFAULT_APPROVAL_TTL_MS = 300_000; // 5 min — same default Telegram had
export const APPROVAL_POLL_MS = 150;

export type ApprovalDecisionValue = "approved" | "denied" | "timed_out";

export interface ApprovalIdentity {
  taskId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}

export interface ApprovalRequestInput extends ApprovalIdentity {
  tool: string;
  /** Model-shaped reason text. UNTRUSTED: rendered as data, never authority. */
  reason: string;
  /** Raw arguments (hashed for the record; never stored verbatim). */
  args?: Record<string, unknown>;
  /** Structured preview (diff / command breakdown). */
  preview?: StructuredPreview;
  riskTier?: string;
  surface: string;
  /** Per-request override; falls back to perSurface config then the default. */
  ttlMs?: number;
}

export interface ApprovalOutcome {
  approved: boolean;
  timedOut: boolean;
  decision: ApprovalDecisionValue | null;
  decidedBy?: { channel: string; userId?: string | null };
  latencyMs?: number;
}

export interface ApprovalRecord {
  id: string;
  taskId: string | null;
  runId: string | null;
  sessionId: string | null;
  tool: string;
  argsHash: string;
  reason: string;
  preview: StructuredPreview | null;
  riskTier: string;
  surface: string;
  requestedAt: number;
  ttlMs: number;
  decision: ApprovalDecisionValue | null;
  decidedBy: { channel: string; userId: string | null } | null;
  decidedAt: number | null;
  latencyMs: number | null;
}

export interface ApprovalHandle {
  id: string;
  record: ApprovalRecord;
  /** Resolves when the approval is decided or times out (never hangs). */
  outcome: Promise<ApprovalOutcome>;
}

export interface ApprovalStoreConfig {
  defaultTtlMs?: number;
  /** Per-surface TTL overrides (e.g. { telegram: 300000, daemon: 60000 }). */
  perSurface?: Record<string, number>;
}

function argsHashOf(args?: Record<string, unknown>): string {
  if (args === undefined || args === null) return "sha256:none";
  try {
    const canonical = JSON.stringify(args, Object.keys(args ?? {}).sort());
    return `sha256:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
  } catch {
    return "sha256:unserializable";
  }
}

function rowToRecord(row: ApprovalRow): ApprovalRecord {
  let preview: StructuredPreview | null = null;
  try {
    preview = row.preview_json ? (JSON.parse(row.preview_json) as StructuredPreview) : null;
  } catch {
    preview = null;
  }
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    sessionId: row.session_id,
    tool: row.tool,
    argsHash: row.args_hash,
    reason: row.reason,
    preview,
    riskTier: row.risk_tier,
    surface: row.surface,
    requestedAt: row.requested_at,
    ttlMs: row.ttl_ms,
    decision: row.decision,
    decidedBy:
      row.decision !== null && row.decided_by_channel !== null
        ? { channel: row.decided_by_channel, userId: row.decided_by_user }
        : null,
    decidedAt: row.decided_at,
    latencyMs: row.latency_ms,
  };
}

/**
 * One ApprovalStore per WorkspaceStore (cached so every surface in a process
 * shares the same waiters).
 */
const instances = new Map<WorkspaceStore, ApprovalStore>();

export function getApprovalStore(
  store: WorkspaceStore,
  config?: ApprovalStoreConfig,
): ApprovalStore {
  const existing = instances.get(store);
  if (existing) {
    if (config) existing.reconfigure(config);
    return existing;
  }
  const created = new ApprovalStore(store, config);
  instances.set(store, created);
  return created;
}

/** Test seam: drop cached instances (XR_HOME switches in tests). */
export function resetApprovalStores(): void {
  instances.clear();
}

export class ApprovalStore {
  private defaultTtlMs: number;
  private perSurface: Record<string, number>;
  /** In-process waiters: id → resolve(outcome). */
  private waiters = new Map<string, (outcome: ApprovalOutcome) => void>();
  /** Timers for the local TTL enforcement. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Poll intervals for cross-process decisions. */
  private pollers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    public readonly store: WorkspaceStore,
    config?: ApprovalStoreConfig,
  ) {
    this.defaultTtlMs = config?.defaultTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
    this.perSurface = { ...(config?.perSurface ?? {}) };
  }

  reconfigure(config: ApprovalStoreConfig): void {
    this.defaultTtlMs = config.defaultTtlMs ?? this.defaultTtlMs;
    this.perSurface = { ...this.perSurface, ...(config.perSurface ?? {}) };
  }

  ttlFor(surface: string, override?: number): number {
    return Math.max(1, override ?? this.perSurface[surface] ?? this.defaultTtlMs);
  }

  /**
   * Raise a durable approval request. Resolves via decide() (any process) or
   * the TTL default-deny. NEVER hangs forever: the outcome promise always
   * settles.
   */
  request(input: ApprovalRequestInput): ApprovalHandle {
    const id = `ap_${randomUUID().slice(0, 8)}`;
    const ttlMs = this.ttlFor(input.surface, input.ttlMs);
    const requestedAt = Date.now();
    const preview = input.preview ?? null;
    const record: ApprovalRecord = {
      id,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      tool: input.tool,
      argsHash: argsHashOf(input.args),
      reason: input.reason,
      preview,
      riskTier: input.riskTier ?? "unknown",
      surface: input.surface,
      requestedAt,
      ttlMs,
      decision: null,
      decidedBy: null,
      decidedAt: null,
      latencyMs: null,
    };

    this.store.approvalInsert({
      id,
      taskId: record.taskId,
      runId: record.runId,
      sessionId: record.sessionId,
      tool: record.tool,
      argsHash: record.argsHash,
      reason: record.reason,
      previewJson: JSON.stringify(preview),
      riskTier: record.riskTier,
      surface: record.surface,
      requestedAt,
      ttlMs,
    });
    this.store.audit("approval.requested", {
      approvalId: id,
      tool: record.tool,
      surface: record.surface,
      riskTier: record.riskTier,
      ttlMs,
    });

    let resolveOutcome!: (outcome: ApprovalOutcome) => void;
    const outcome = new Promise<ApprovalOutcome>((resolve) => (resolveOutcome = resolve));
    let settled = false;
    const settle = (o: ApprovalOutcome): void => {
      if (settled) return;
      settled = true;
      this.cleanup(id);
      resolveOutcome(o);
    };

    this.waiters.set(id, settle);

    // TTL default-deny, enforced locally by every process that raised the
    // request (the DB-side sweep in expirePending covers the rest).
    this.timers.set(
      id,
      setTimeout(() => {
        this.expire(id, ttlMs);
        const finalRow = this.store.approvalGet(id);
        settle({
          approved: false,
          timedOut: true,
          decision: "timed_out",
          decidedBy: finalRow?.decided_by_channel ? { channel: finalRow.decided_by_channel } : undefined,
          latencyMs: finalRow?.latency_ms ?? ttlMs,
        });
      }, ttlMs),
    );

    // Cross-process bridge: poll the durable row so a daemon (or another
    // process) decision resolves this process's waiter.
    this.pollers.set(
      id,
      setInterval(() => {
        try {
          const row = this.store.approvalGet(id);
          if (!row || row.decision === null) return;
          this.recordDecision(id);
          settle(this.outcomeOf(row));
        } catch {
          /* store hiccups must never wedge the waiter — the TTL timer still fires */
        }
      }, APPROVAL_POLL_MS),
    );

    return { id, record, outcome };
  }

  /**
   * Decide an approval by id (any process sharing the store). Returns true
   * only when this call actually transitioned a pending record. The
   * requesting process's waiter resolves immediately (in-process fast path)
   * or within one poll interval (cross-process).
   */
  decide(
    id: string,
    approved: boolean,
    by: { channel: string; userId?: string | null },
  ): boolean {
    const ok = this.store.approvalDecide(id, approved ? "approved" : "denied", by.channel, by.userId ?? null, Date.now());
    if (ok) {
      this.store.audit("approval.decided", {
        approvalId: id,
        decision: approved ? "approved" : "denied",
        byChannel: by.channel,
        byUser: by.userId ?? null,
      });
      // In-process fast path: resolve the waiter without waiting for a poll tick.
      const settle = this.waiters.get(id);
      if (settle) {
        const row = this.store.approvalGet(id);
        if (row) this.recordDecision(id);
        settle(row ? this.outcomeOf(row) : { approved, timedOut: false, decision: approved ? "approved" : "denied", decidedBy: by });
      }
    }
    return ok;
  }

  /** Mark an expired pending approval as timed_out (idempotent, audited). */
  expire(id: string, ttlMs?: number): boolean {
    const row = this.store.approvalGet(id);
    if (!row || row.decision !== null) return false;
    if (row.requested_at + row.ttl_ms > Date.now()) return false;
    const n = this.store.approvalExpirePending(Date.now());
    if (n > 0) {
      this.store.audit("approval.timed_out", { approvalId: id, ttlMs: ttlMs ?? row.ttl_ms });
      return true;
    }
    return false;
  }

  /** TTL sweep over every pending record past its deadline. */
  sweepExpired(now: number = Date.now()): number {
    const expired = this.store
      .approvalListPending()
      .filter((r) => r.requested_at + r.ttl_ms <= now);
    for (const r of expired) {
      this.store.audit("approval.timed_out", { approvalId: r.id, ttlMs: r.ttl_ms });
    }
    return this.store.approvalExpirePending(now);
  }

  listPending(): ApprovalRecord[] {
    return this.store.approvalListPending().map(rowToRecord);
  }

  get(id: string): ApprovalRecord | null {
    const row = this.store.approvalGet(id);
    return row ? rowToRecord(row) : null;
  }

  listBySession(sessionId: string): ApprovalRecord[] {
    return this.store.approvalListBySession(sessionId).map(rowToRecord);
  }

  purgeSession(sessionId: string): number {
    return this.store.approvalPurge(sessionId);
  }

  pendingCount(): number {
    return this.store.approvalListPending().length;
  }

  /**
   * Wait for a decision on an EXISTING durable record (re-attach after a
   * restart: the record survives; the waiter is re-established and either
   * resolves within TTL or default-denies).
   */
  waitFor(id: string): Promise<ApprovalOutcome> {
    const row = this.store.approvalGet(id);
    if (!row) return Promise.resolve({ approved: false, timedOut: true, decision: "timed_out", decidedBy: { channel: "missing" } });
    if (row.decision !== null) return Promise.resolve(this.outcomeOf(row));

    const handle = new Promise<ApprovalOutcome>((resolve) => {
      this.waiters.set(id, resolve);
      const deadline = row.requested_at + row.ttl_ms;
      this.timers.set(id, setTimeout(() => {
        this.expire(id);
        const finalRow = this.store.approvalGet(id);
        resolve(finalRow && finalRow.decision !== null
          ? this.outcomeOf(finalRow)
          : { approved: false, timedOut: true, decision: "timed_out", decidedBy: { channel: "ttl" } });
      }, Math.max(0, deadline - Date.now())));
      this.pollers.set(id, setInterval(() => {
        try {
          const current = this.store.approvalGet(id);
          if (!current || current.decision === null) return;
          this.recordDecision(id);
          resolve(this.outcomeOf(current));
        } catch {
          /* TTL timer still guarantees settlement */
        }
      }, APPROVAL_POLL_MS));
    });
    return handle;
  }

  private outcomeOf(row: ApprovalRow): ApprovalOutcome {
    const approved = row.decision === "approved";
    return {
      approved,
      timedOut: row.decision === "timed_out",
      decision: row.decision,
      decidedBy:
        row.decided_by_channel !== null
          ? { channel: row.decided_by_channel, userId: row.decided_by_user }
          : undefined,
      latencyMs: row.latency_ms ?? undefined,
    };
  }

  private recordDecision(id: string): void {
    const settle = this.waiters.get(id);
    if (!settle) return;
    const row = this.store.approvalGet(id);
    if (!row || row.decision === null) return;
    this.cleanup(id);
    settle(this.outcomeOf(row));
  }

  private cleanup(id: string): void {
    this.waiters.delete(id);
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    const p = this.pollers.get(id);
    if (p) clearInterval(p);
    this.pollers.delete(id);
  }
}

/**
 * Phase 2 · F-11 — build a `ctx.approve` implementation for one surface from
 * a workspace store. Every raised approval is a durable record; the surface
 * answers through `decide()` (its UI callback), and the promise resolves via
 * the in-process fast path or the cross-process poller. If the surface never
 * answers (or the human never sees it), the TTL default-denies.
 */
export interface ApproverSurfaceOptions {
  surface: string;
  defaultTtlMs?: number;
  perSurface?: Record<string, number>;
  /**
   * Surface UI hook. Receives the durable record plus a decide function. If
   * it never calls decide, the approval times out as a denial. Optional:
   * headless surfaces (daemon) omit it and rely on HTTP decision endpoints.
   */
  prompt?: (record: ApprovalRecord, decide: (approved: boolean) => void) => void | Promise<void>;
  /** Optional identity enrichment (session/run ids) from the caller. */
  identity?: ApprovalIdentity;
}

export function makeApprover(
  store: WorkspaceStore,
  options: ApproverSurfaceOptions,
): (req: import("../core/types.ts").ApprovalRequest) => Promise<boolean> {
  const approvalStore = getApprovalStore(store, {
    defaultTtlMs: options.defaultTtlMs,
    perSurface: options.perSurface,
  });
  return async (req) => {
    const handle = approvalStore.request({
      tool: req.tool,
      reason: req.reason,
      args: req.args,
      preview: req.structuredPreview,
      riskTier: req.riskTier,
      surface: options.surface,
      taskId: req.taskId ?? options.identity?.taskId ?? null,
      runId: req.runId ?? options.identity?.runId ?? null,
      sessionId: req.sessionId ?? options.identity?.sessionId ?? null,
    });
    if (options.prompt) {
      try {
        await options.prompt(handle.record, (approved) => {
          approvalStore.decide(handle.id, approved, { channel: options.surface, userId: "local" });
        });
      } catch {
        // A broken surface prompt must not hang the task: the TTL still denies.
        approvalStore.decide(handle.id, false, { channel: "surface_error", userId: null });
      }
    }
    const outcome = await handle.outcome;
    return outcome.approved;
  };
}
