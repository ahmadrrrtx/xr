/**
 * XR 5.1 — Environment lifecycle: session state machine + workspace-scoped registry.
 *
 * Sessions are per-process (matching the underlying browser/voice/desktop
 * primitives) and are scoped to a workspace (+ optional task/execution ref).
 * All transitions are validated against the §7.2 table and appended to the
 * in-session history; durable visibility comes from the env.* audit events the
 * service emits on each transition.
 */
import { randomUUID } from "node:crypto";
import {
  ENVIRONMENT_BOUNDS,
  TERMINAL_ENVIRONMENT_STATES,
  isValidEnvironmentTransition,
  type EnvironmentLifecycleState,
  type EnvironmentPolicy,
  type EnvironmentSession,
  type EnvironmentType,
} from "./types.ts";

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

/** Apply a validated lifecycle transition. Terminal states are absorbing. */
export function transitionSession(
  session: EnvironmentSession,
  to: EnvironmentLifecycleState,
  reason?: string,
): TransitionResult {
  const from = session.state;
  if (from === to) return { ok: true };
  if (TERMINAL_ENVIRONMENT_STATES.has(from)) {
    return { ok: false, reason: `session is ${from} (terminal); no further transitions` };
  }
  if (!isValidEnvironmentTransition(from, to)) {
    return { ok: false, reason: `invalid environment transition ${from} → ${to}` };
  }
  session.state = to;
  session.updatedAt = Date.now();
  if (to === "closed" || to === "quarantined") session.closedAt = Date.now();
  if (to === "quarantined" && reason) session.quarantineReason = reason;
  session.history.push({ from, to, at: session.updatedAt, reason });
  return { ok: true };
}

export class EnvironmentSessionRegistry {
  private sessions = new Map<string, EnvironmentSession>();

  constructor(
    private limits: {
      maxActive?: number;
      idleTimeoutMs?: number;
    } = {},
  ) {}

  /** Adjust limits from config (bounds-clamped; never widened above hard caps). */
  configureLimits(limits: { maxActive?: number; idleTimeoutMs?: number }): void {
    if (limits.maxActive != null) {
      this.limits.maxActive = Math.max(1, Math.min(20, Math.floor(limits.maxActive)));
    }
    if (limits.idleTimeoutMs != null) {
      this.limits.idleTimeoutMs = Math.max(30_000, Math.min(3_600_000, Math.floor(limits.idleTimeoutMs)));
    }
  }

  create(params: {
    type: EnvironmentType;
    workspaceId: string;
    policy: EnvironmentPolicy;
    taskId?: string;
    executionRef?: string;
  }): EnvironmentSession {
    this.sweepIdle();
    const active = [...this.sessions.values()].filter((s) => !TERMINAL_ENVIRONMENT_STATES.has(s.state));
    const max = this.limits.maxActive ?? ENVIRONMENT_BOUNDS.MAX_ACTIVE_SESSIONS;
    if (active.length >= max) {
      throw new Error(`environment session limit reached (${max}); close or let idle sessions expire first`);
    }
    const now = Date.now();
    const session: EnvironmentSession = {
      sessionId: `env_${params.type}_${randomUUID().slice(0, 10)}`,
      type: params.type,
      state: "discover",
      workspaceId: params.workspaceId,
      taskId: params.taskId,
      executionRef: params.executionRef,
      policy: params.policy,
      resources: {},
      actionsPerformed: 0,
      consecutiveFailures: 0,
      cleanupState: "not_required",
      createdAt: now,
      updatedAt: now,
      history: [{ from: null, to: "discover", at: now, reason: "session created" }],
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  get(sessionId: string): EnvironmentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Session must be usable for actions: ready/active. Performs lazy idle sweep. */
  requireUsable(sessionId: string): { ok: true; session: EnvironmentSession } | { ok: false; reason: string } {
    this.sweepIdle();
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: `unknown environment session ${sessionId}` };
    if (session.state === "quarantined") {
      return { ok: false, reason: `session quarantined${session.quarantineReason ? `: ${session.quarantineReason}` : ""}` };
    }
    if (TERMINAL_ENVIRONMENT_STATES.has(session.state)) return { ok: false, reason: `session ${session.state}` };
    if (session.state === "failed") return { ok: false, reason: "session failed; close it and open a new one" };
    if (session.circuitOpenUntil && Date.now() < session.circuitOpenUntil) {
      const waitS = Math.ceil((session.circuitOpenUntil - Date.now()) / 1000);
      return { ok: false, reason: `circuit breaker open after repeated failures; retry in ~${waitS}s` };
    }
    return { ok: true, session };
  }

  list(workspaceId?: string): EnvironmentSession[] {
    this.sweepIdle();
    const all = [...this.sessions.values()];
    return workspaceId ? all.filter((s) => s.workspaceId === workspaceId) : all;
  }

  /** Close idle non-terminal sessions past the idle timeout. */
  sweepIdle(now = Date.now()): string[] {
    const idleMs = this.limits.idleTimeoutMs ?? ENVIRONMENT_BOUNDS.IDLE_SESSION_TIMEOUT_MS;
    const swept: string[] = [];
    for (const s of this.sessions.values()) {
      if (TERMINAL_ENVIRONMENT_STATES.has(s.state)) continue;
      const last = s.lastActionAt ?? s.updatedAt;
      if (now - last > idleMs) {
        const t = transitionSession(s, "closing", "idle timeout");
        if (t.ok) {
          transitionSession(s, "closed", "idle timeout");
          s.cleanupState = s.cleanupState === "not_required" ? "not_required" : s.cleanupState;
          swept.push(s.sessionId);
        }
      }
    }
    return swept;
  }

  /** Remove terminal session entries (list hygiene; history lives in audit). */
  pruneTerminal(olderThanMs = 24 * 60 * 60 * 1000, now = Date.now()): number {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (TERMINAL_ENVIRONMENT_STATES.has(s.state) && s.closedAt && now - s.closedAt > olderThanMs) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }

  /** Mark every non-terminal session closed at process shutdown (best effort). */
  closeAll(reason = "process shutdown"): EnvironmentSession[] {
    const touched: EnvironmentSession[] = [];
    for (const s of this.sessions.values()) {
      if (TERMINAL_ENVIRONMENT_STATES.has(s.state)) continue;
      if (s.state !== "closing") transitionSession(s, "closing", reason);
      const t = transitionSession(s, "closed", reason);
      if (t.ok) touched.push(s);
    }
    return touched;
  }
}

/** Process-wide registry (one XR process ↔ one set of local environments). */
export const environmentSessions = new EnvironmentSessionRegistry();
