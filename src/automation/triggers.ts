/**
 * XR Phase 9 — governed trigger table + scheduler.
 *
 * Proactivity under policy: every fire assembles an envelope through the ONE
 * spine (policy, grants, audit, budget). No unbounded autonomous tasks.
 *
 *   · pause-all stops NEW fires; in-flight runs keep their own cancel path.
 *   · quiet hours + per-trigger budget + approval mode travel with the fire.
 *   · every fire audits `trigger.fired` with the envelope id.
 *   · identity is `agent:scheduler` (restricted memory scope via P7 ACLs).
 */
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import type { Store } from "../state/workspace-store.ts";
import { TriggerRepo } from "../state/repos/trigger-repo.ts";
import { mintIdentity } from "../agents/identity.ts";
import { loadConfig, saveConfig, reloadConfig } from "../config/config.ts";
import { executeOnSurface } from "../services/surface-execution.ts";
import { makeApprover } from "../control/approval-store.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { MemoryStore } from "../context/memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";
import {
  inQuietHours,
  interpolateTask,
  shouldFire,
  validateTriggerInput,
  type FireSkip,
  type Trigger,
  type TriggerInput,
} from "./trigger-spec.ts";

export type { Trigger, TriggerInput, FireSkip };
export {
  shouldFire,
  inQuietHours,
  cronMatches,
  validateTriggerInput,
  validateBudget,
  validateSpec,
} from "./trigger-spec.ts";

export interface FireResult {
  triggerId: string;
  fired: boolean;
  reason?: FireSkip | "error";
  envelopeId?: string;
  sessionId?: string;
  stopped?: string;
  inFlight?: boolean;
}

export type FireHandler = (args: {
  trigger: Trigger;
  envelopeId: string;
  now: number;
  signal: AbortSignal;
  task: string;
}) => Promise<{ sessionId?: string; stopped: string; spentUsd?: number; spentTokens?: number }>;

export interface TriggerServiceOptions {
  /** Injected fire path (tests). Default: executeOnSurface through the spine. */
  fire?: FireHandler;
  /** Clock (tests). */
  now?: () => number;
  /** Watch mtime probe (tests). */
  mtimeMs?: (path: string) => number | null;
  /** Skip disk reload on tick (tests). */
  skipReload?: boolean;
}

const SCHEDULER_ROLE = "scheduler";

export class TriggerService {
  readonly repo: TriggerRepo;
  private pausedOverride: boolean | null = null;
  private inflight = new Map<string, AbortController>();
  private loop: ReturnType<typeof setInterval> | null = null;
  private fireHandler: FireHandler;
  private nowFn: () => number;
  private mtimeMs: (path: string) => number | null;
  private skipReload: boolean;

  constructor(
    private readonly store: Store,
    opts: TriggerServiceOptions = {},
  ) {
    this.repo = new TriggerRepo(store);
    this.nowFn = opts.now ?? Date.now;
    this.mtimeMs = opts.mtimeMs ?? defaultMtime;
    this.fireHandler = opts.fire ?? ((args) => defaultFire(this.store, args));
    this.skipReload = opts.skipReload ?? false;
  }

  /** Durable pause flag (config) plus in-process override for tests. */
  isPausedAll(): boolean {
    if (this.pausedOverride !== null) return this.pausedOverride;
    if (this.skipReload) return false;
    try {
      return Boolean(loadConfig().config.triggers?.pauseAll);
    } catch {
      return false;
    }
  }

  pauseAll(actor = "operator"): void {
    this.pausedOverride = true;
    persistPause(true);
    this.store.audit("triggers.paused", { actor, inflight: this.inflight.size });
  }

  resumeAll(actor = "operator"): void {
    this.pausedOverride = false;
    persistPause(false);
    this.store.audit("triggers.resumed", { actor });
  }

  create(input: TriggerInput): Trigger {
    const v = validateTriggerInput(input);
    if (!v.ok) throw new Error(v.error);
    const trigger = this.repo.insert(input);
    this.store.audit("trigger.created", {
      triggerId: trigger.id,
      kind: trigger.kind,
      consentRef: trigger.consentRef,
      budget: trigger.budget,
      approvalMode: trigger.approvalMode,
    });
    return trigger;
  }

  list(): Trigger[] {
    return this.repo.list();
  }

  get(id: string): Trigger | null {
    return this.repo.get(id);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const ok = this.repo.setEnabled(id, enabled);
    if (ok) this.store.audit(enabled ? "trigger.enabled" : "trigger.disabled", { triggerId: id });
    return ok;
  }

  delete(id: string): boolean {
    const ok = this.repo.delete(id);
    if (ok) this.store.audit("trigger.deleted", { triggerId: id });
    return ok;
  }

  inflightCount(): number {
    return this.inflight.size;
  }

  /** Cooperative cancel of ONE in-flight fire (does not pause the table). */
  cancelInflight(triggerId: string): boolean {
    const ac = this.inflight.get(triggerId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /**
   * Scheduler tick: due cron/watch triggers fire. Event triggers never fire
   * from the tick — they fire from `notify()`.
   */
  async tick(nowMs = this.nowFn()): Promise<FireResult[]> {
    if (!this.skipReload) {
      try {
        reloadConfig();
      } catch {
        /* tests without a config file */
      }
    }
    const now = new Date(nowMs);
    const paused = this.isPausedAll();
    const out: FireResult[] = [];
    for (const t of this.repo.list()) {
      if (t.kind === "event") continue;
      out.push(await this.consider(t, now, nowMs, paused));
    }
    return out;
  }

  /** Event trigger: fire every enabled trigger whose spec.event matches. */
  async notify(event: string, ctx: Record<string, string> = {}, nowMs = this.nowFn()): Promise<FireResult[]> {
    const now = new Date(nowMs);
    const paused = this.isPausedAll();
    const out: FireResult[] = [];
    for (const t of this.repo.list()) {
      if (t.kind !== "event" || t.spec.kind !== "event" || t.spec.event !== event) continue;
      if (paused) {
        out.push({ triggerId: t.id, fired: false, reason: "paused" });
        continue;
      }
      if (!t.enabled) {
        out.push({ triggerId: t.id, fired: false, reason: "disabled" });
        continue;
      }
      if (inQuietHours(t.quietHours, now)) {
        out.push({ triggerId: t.id, fired: false, reason: "quiet" });
        continue;
      }
      out.push(await this.fireOne(t, nowMs, ctx));
    }
    return out;
  }

  private async consider(t: Trigger, now: Date, nowMs: number, paused: boolean): Promise<FireResult> {
    if (this.inflight.has(t.id)) {
      return { triggerId: t.id, fired: false, inFlight: true, reason: "already-fired" };
    }
    if (t.kind === "cron") {
      const decision = shouldFire(t, { pausedAll: paused, now });
      if (!decision.fire) return { triggerId: t.id, fired: false, reason: decision.reason };
      return this.fireOne(t, nowMs);
    }
    // watch: mtime due-check is I/O; quiet/pause/enabled still apply.
    if (paused) return { triggerId: t.id, fired: false, reason: "paused" };
    if (!t.enabled) return { triggerId: t.id, fired: false, reason: "disabled" };
    if (inQuietHours(t.quietHours, now)) return { triggerId: t.id, fired: false, reason: "quiet" };
    if (t.spec.kind !== "watch") return { triggerId: t.id, fired: false, reason: "not-due" };
    const mtime = this.mtimeMs(t.spec.path);
    if (mtime == null || (t.lastFiredAt != null && mtime <= t.lastFiredAt)) {
      return { triggerId: t.id, fired: false, reason: "not-due" };
    }
    return this.fireOne(t, nowMs);
  }

  async fireOne(trigger: Trigger, nowMs = this.nowFn(), ctx: Record<string, string> = {}): Promise<FireResult> {
    if (this.inflight.has(trigger.id)) {
      return { triggerId: trigger.id, fired: false, inFlight: true, reason: "already-fired" };
    }
    const envelopeId = `env_${randomUUID().slice(0, 12)}`;
    const ac = new AbortController();
    this.inflight.set(trigger.id, ac);
    const task = interpolateTask(trigger.taskTemplate, { ...ctx, triggerId: trigger.id, envelopeId });
    this.store.audit("trigger.fired", {
      triggerId: trigger.id,
      envelopeId,
      kind: trigger.kind,
      budget: trigger.budget,
      approvalMode: trigger.approvalMode,
      consentRef: trigger.consentRef,
    });
    try {
      const result = await this.fireHandler({
        trigger,
        envelopeId,
        now: nowMs,
        signal: ac.signal,
        task,
      });
      this.repo.recordFire(trigger.id, {
        at: nowMs,
        envelopeId,
        spentUsd: result.spentUsd,
        spentTokens: result.spentTokens,
      });
      return {
        triggerId: trigger.id,
        fired: true,
        envelopeId,
        sessionId: result.sessionId,
        stopped: result.stopped,
      };
    } catch (e) {
      this.store.audit("trigger.error", {
        triggerId: trigger.id,
        envelopeId,
        error: (e as Error).message,
      });
      this.repo.recordFire(trigger.id, { at: nowMs, envelopeId });
      return { triggerId: trigger.id, fired: false, envelopeId, reason: "error", stopped: "error" };
    } finally {
      this.inflight.delete(trigger.id);
    }
  }

  /** Daemon-hosted loop. `unref()` so tests/CLI don't hang on the timer. */
  startLoop(intervalMs = 15_000): { stop: () => void } {
    if (this.loop) this.stopLoop();
    const tick = () => {
      void this.tick().catch((e) => {
        try {
          this.store.audit("trigger.loop_error", { error: (e as Error).message });
        } catch {
          /* closed store */
        }
      });
    };
    this.loop = setInterval(tick, Math.max(1_000, intervalMs));
    const maybe = this.loop as { unref?: () => void };
    if (typeof maybe.unref === "function") maybe.unref();
    return { stop: () => this.stopLoop() };
  }

  stopLoop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }
}

function persistPause(pauseAll: boolean): void {
  try {
    const { config } = loadConfig();
    saveConfig({ ...config, triggers: { ...config.triggers, pauseAll } });
  } catch {
    /* tests without a writable XR_HOME still have the in-process override */
  }
}

function defaultMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

async function defaultFire(
  store: Store,
  args: {
    trigger: Trigger;
    envelopeId: string;
    now: number;
    signal: AbortSignal;
    task: string;
  },
): Promise<{ sessionId?: string; stopped: string; spentUsd?: number; spentTokens?: number }> {
  const { config } = loadConfig();
  const providerId = config.defaults.provider;
  const model = config.defaults.model;
  const provider = buildProvider(config, {});
  const minted = mintIdentity({
    role: SCHEDULER_ROLE,
    parentId: "system",
    taskId: args.trigger.id,
    grantRef: args.trigger.consentRef,
    parentDepth: -1,
  });
  if (minted.allowed) {
    store.audit("agent.minted", {
      agentId: minted.identity.agentId,
      role: minted.identity.role,
      taskId: minted.identity.taskId,
      depth: minted.identity.depth,
      triggerId: args.trigger.id,
    });
  }
  const approve = makeApprover(store, { surface: "scheduler" });
  const memoryEngine = new MemoryStore(store);
  const memEnabled = isMemoryEnabled();
  const outcome = await executeOnSurface({
    task: args.task,
    mode: "agent",
    surface: "scheduler",
    store,
    provider,
    modelId: model,
    cwd: process.cwd(),
    say: () => {},
    approve,
    budget: {
      maxUsd: isLocal(providerId) ? args.trigger.budget.maxUsd : (args.trigger.budget.maxUsd ?? config.budget.perTaskUsd),
      maxTokens: args.trigger.budget.maxTokens ?? config.budget.perTaskTokens,
    },
    pricing: priceFor(providerId, model),
    egressAllowlist: config.security.egressAllowlist,
    deniedPermissions: config.capabilities?.deniedPermissions,
    memory: {
      enabled: memEnabled && config.memory.injectInChat,
      recallLimit: config.memory.recallLimit,
      semantic: config.memory.semanticRecall,
    },
    memoryStore: memoryEngine,
    signal: args.signal,
    agentRole: SCHEDULER_ROLE,
  });
  store.audit("session.done", {
    envelopeId: args.envelopeId,
    surfaceEnvelopeId: outcome.envelopeId,
    triggerId: args.trigger.id,
    budgetEnvelopeId: args.envelopeId,
    stopped: outcome.stopped,
  });
  return {
    sessionId: outcome.sessionId,
    stopped: outcome.stopped,
  };
}

/** Process-wide pause helper used by CLI / daemon / Telegram. */
export function pauseAllTriggers(store: Store, actor: string): void {
  new TriggerService(store).pauseAll(actor);
}

export function resumeAllTriggers(store: Store, actor: string): void {
  new TriggerService(store).resumeAll(actor);
}
