/**
 * XR Phase 03 — Daemon Agent Executor (the daemon's AgentService boundary)
 *
 * Phase 03 · T3.4–T3.14, T3.22. The architectural invariant this module enforces:
 *
 *   CLI   → AgentService.runTask()
 *   daemon→ AgentService.runTask()   (NOT provider.chat() directly)
 *
 * The daemon server is deliberately a thin HTTP shell (see server.ts). It does
 * not boot the kernel eagerly so that `serve` stays a fast path (Commandment
 * 11). Instead, this executor lazily bootstraps the SAME canonical composition
 * root the CLI uses — an `XRApp` with the `agent` boot profile (providerClosure
 * ["agent"] = state, config, providers, intelligence, budget, plugins, mcp,
 * skills, execution) — and routes every chat task through the ONE AgentService.
 *
 * Because the boot profile is identical to the CLI `run`/`ask`/`plan` profiles,
 * the daemon chat inherits the exact same:
 *   Task / envelope model · Runner · Execution Fabric · Provider abstraction ·
 *   Tool Registry · Policy · Memory · Audit · Checkpoints · Recovery · State.
 *
 * The lane queue (ExecutionLaneQueue, src/execution/lane.ts) serializes tasks
 * that share a workspace/session key while letting independent sessions run
 * concurrently (Phase 03 · T3.11). Cancellation flows via AbortSignal.
 *
 * All interface-specific concerns (SSE formatting, request parsing) stay in the
 * route layer; this module only orchestrates the kernel.
 */

import { randomUUID } from "node:crypto";
import type { XRApp } from "../core/app.ts";
import { providerClosure } from "../core/boot-profile.ts";
import { Tokens } from "../core/tokens.ts";
import type { AgentResult } from "../core/agent.ts";
import type { Mode } from "../core/types.ts";
import type { AgentRunOverrides } from "../services/agent-service.ts";
import { ExecutionLaneQueue, LANE_DEFAULT_TIMEOUT_MS, type LaneRelease } from "../execution/lane.ts";
import { checkProviderHealthCached, HEALTH_BOUND_MS } from "../providers/health.ts";
import { bounded } from "../util/concurrency.ts";
import type { SurfaceId } from "../core/execution/envelope.ts";

/** Thrown when the effective provider chain (primary → fallback) is offline.
 * The HTTP edge maps this to a 503 (Phase 01 contract). */
export class ProviderOfflineError extends Error {
  readonly retryable = false;
  constructor(detail: string) {
    super(detail);
    this.name = "ProviderOfflineError";
  }
}

/** Options accepted for a single chat/agent task routed through the daemon. */
export interface AgentExecutorOptions extends AgentRunOverrides {
  /** Lane key used for serialization (workspace id or session id). */
  laneKey?: string;
  /** Bound for how long a queued task waits behind a busy lane. */
  laneTimeoutMs?: number;
  /** Session id, surfaced in the acknowledgement/status events. */
  sessionId?: string;
}

export interface AgentExecutorHandle {
  /** Lazily boot the canonical kernel and return the XRApp. */
  ensureApp(): Promise<XRApp>;
  /** The booted XRApp, if any (null before first use). */
  readonly app: XRApp | null;
  /** True once the kernel has been booted. */
  readonly booted: boolean;
  /**
   * Bounded, shared-health pre-flight for a chat task. Resolves when the
   * effective provider chain (primary → fallback) is reachable; throws
   * `ProviderOfflineError` (→ 503) when it is not. Called BEFORE the SSE stream
   * is opened so an offline provider yields a fast, honest 503 rather than a
   * doomed 200 stream (Phase 01 contract preserved by T3.22).
   */
  preflight(): Promise<void>;
  /**
   * Reserve the execution lane for `laneKey` WITHOUT running the task. Lets the
   * HTTP edge answer a busy lane with a retryable 429 before opening an SSE
   * stream. Rejects with `LaneBusyError` (after `timeoutMs`) or `AbortError`.
   * The returned release MUST be called in a `finally`.
   */
  acquireLane(laneKey: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<LaneRelease>;
  /**
   * Route a task through the canonical AgentService. Idempotent boot, then
   * `AgentService.runTask(task, mode, { ...opts, surface })` under a
   * workspace/session-scoped execution lane.
   */
  runTask(task: string, mode: Mode, opts?: AgentExecutorOptions): Promise<AgentResult>;
  /**
   * Run a task that the caller has ALREADY reserved the lane for (via
   * `acquireLane`). No lane bookkeeping here — the caller releases.
   */
  runHeld(task: string, mode: Mode, opts?: AgentExecutorOptions): Promise<AgentResult>;
  /**
   * The canonical workspace-switch lifecycle. Used by the daemon's
   * /api/workspaces/switch route so it never re-implements the lifecycle
   * inline (Phase 03 · T3.2).
   */
  switchWorkspace(id: string): Promise<void>;
  /** Number of tasks currently queued/running across all lanes. */
  queueDepth(key?: string): number;
  /** Gracefully shut down the booted kernel, if any. */
  shutdown(): Promise<void>;
}

/**
 * Create a lazily-bootstrapped AgentExecutor for a daemon instance.
 *
 * The kernel is booted on first task/workspace-switch and cached for the
 * lifetime of the daemon process.
 */
export function createAgentExecutor(opts: { surface?: SurfaceId } = {}): AgentExecutorHandle {
  const surface: SurfaceId = opts.surface ?? "daemon";
  let appPromise: Promise<XRApp> | null = null;
  let appValue: XRApp | null = null;
  const lanes = new ExecutionLaneQueue();

  async function ensureApp(): Promise<XRApp> {
    if (appValue) return appValue;
    if (!appPromise) {
      appPromise = (async () => {
        const { XRApp } = await import("../core/app.ts"); // static literal — compile-safe
        const app = new XRApp();
        const profile = providerClosure(["agent"]);
        await app.bootstrap({ profile });
        await app.start();
        appValue = app;
        return app;
      })().catch((err) => {
        // A failed boot must not poison the process forever: reset so the next
        // request can retry.
        appPromise = null;
        throw err;
      });
    }
    return appPromise;
  }

  async function executeTask(
    task: string,
    mode: Mode,
    opts: AgentExecutorOptions = {},
  ): Promise<AgentResult> {
    const app = await ensureApp();
    const agent = app.registry.resolve(Tokens.Agent);
    const runId = opts.runId ?? `dash_${randomUUID().slice(0, 8)}`;

    // Cooperative cancellation: the caller's AbortSignal is threaded through
    // the AgentService run so the loop wraps up honestly at its next
    // checkpoint (Phase 03 · T3.10).
    return await agent.runTask(task, mode, {
      ...opts,
      runId,
      surface,
      signal: opts.signal,
      approve: opts.approve,
      say: opts.say,
    });
  }

  function acquireLane(laneKey: string, opts?: { timeoutMs?: number; signal?: AbortSignal }) {
    return lanes.acquire(laneKey, {
      timeoutMs: opts?.timeoutMs ?? LANE_DEFAULT_TIMEOUT_MS,
      signal: opts?.signal,
    });
  }

  async function preflight(): Promise<void> {
    const app = await ensureApp();
    const config = app.registry.resolve(Tokens.Config).get();
    const timeoutDetail = `health check timed out after ${HEALTH_BOUND_MS} ms`;
    const timeoutReport = (id: string) => ({
      id,
      ok: false,
      detail: timeoutDetail,
      authOk: true,
      timestamp: new Date().toISOString(),
      cached: false,
      stale: false,
      deduped: false,
      probeMs: HEALTH_BOUND_MS,
    } as import("../providers/health.ts").CachedProviderHealth);
    const primary = await bounded(
      checkProviderHealthCached(config, config.defaults.provider, config.defaults.model),
      HEALTH_BOUND_MS,
      timeoutReport(config.defaults.provider),
    );
    if (primary.ok) return;
    const fallback = config.defaults.fallbackProvider;
    if (!fallback) throw new ProviderOfflineError(primary.detail ?? "unreachable");
    const fb = await bounded(
      checkProviderHealthCached(config, fallback, config.defaults.fallbackModel),
      HEALTH_BOUND_MS,
      timeoutReport(fallback),
    );
    if (fb.ok) return;
    throw new ProviderOfflineError(`${primary.detail ?? "primary offline"}; fallback ${fb.detail ?? "offline"}`);
  }

  return {
    ensureApp,
    get app() {
      return appValue;
    },
    get booted() {
      return appValue !== null;
    },
    preflight,
    acquireLane,
    runTask(task: string, mode: Mode, opts: AgentExecutorOptions = {}) {
      const laneKey = opts.laneKey ?? "default";
      return lanes.runExclusive(laneKey, () => executeTask(task, mode, opts), {
        signal: opts.signal,
        timeoutMs: opts.laneTimeoutMs ?? LANE_DEFAULT_TIMEOUT_MS,
      });
    },
    runHeld: executeTask,
    async switchWorkspace(id: string) {
      const app = await ensureApp();
      await app.switchWorkspace(id);
    },
    queueDepth(key?: string) {
      if (key === undefined) return lanes.size();
      return lanes.queueDepth(key) + (lanes.isActive(key) ? 1 : 0);
    },
    async shutdown() {
      if (appValue) {
        await appValue.shutdown().catch(() => {});
        appValue = null;
        appPromise = null;
      }
    },
  };
}
