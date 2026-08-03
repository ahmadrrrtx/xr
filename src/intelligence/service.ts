/**
 * XR 4.4 — Intelligence Service
 * Platform facade: catalog + route + explain + metrics + provider construction.
 * Does not own trust, budget, or durable execution — consumes them via contracts.
 */

import type { XRConfig } from "../config/config.ts";
import type { Provider } from "../core/types.ts";
import { ServiceRegistry } from "../core/service-registry.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import { Tokens } from "../core/tokens.ts";
import { registry as providerRegistry } from "../providers/registry.ts";
import { localityAllowed, localityOf } from "./routing-service.ts";
import { BehavioralStore, behavioralView, BehavioralEvaluator, type BehavioralContract } from "./behavioral.ts";
import { RoutingHealth, healthView } from "./health.ts";
import { RoutingSlo } from "./slo.ts";
import {
  DEFAULT_RETRY_POLICY,
  ResilientProvider,
  outcomeSampleFor,
  type DegradationLevel,
  type FailoverRecord,
  type ProviderOutcome,
} from "./degradation.ts";
import {
  buildCatalog,
  findModel,
  findProvider,
  type IntelligenceCatalog,
} from "./catalog.ts";
import {
  getDefaultMetrics,
  IntelligenceMetrics,
  type MetricsStoreOptions,
} from "./metrics.ts";
import { IntelligenceRouter, policyFromConfig } from "./router.ts";
import { mayFallbackOnTrigger, type FallbackTrigger } from "./fallback.ts";
import { priceFor } from "../cost/pricing.ts";
import { routingSpan, endRoutingSpan } from "../observability/instrument.ts";
import { xrMetrics } from "../observability/metrics.ts";
import type {
  FallbackStep,
  ModelClass,
  ModelDescriptor,
  OutcomeSample,
  ProviderDescriptor,
  RouteRequest,
  RouteResult,
  RoutingDecision,
  RoutingDecisionRecord,
  TaskRequirements,
} from "./types.ts";

export interface ResolveProviderResult {
  provider: Provider;
  decision: RoutingDecision;
  record: RoutingDecisionRecord;
}

export class IntelligenceService implements LifecycleHook {
  private router: IntelligenceRouter;
  private metrics: IntelligenceMetrics;
  private catalogCache: { catalog: IntelligenceCatalog; at: number; key: string } | null = null;
  private readonly catalogTtlMs = 5_000;
  /** Phase 5 · T3 — rolling health + circuit breakers. */
  readonly health: RoutingHealth;
  /** Phase 5 · T2 — measured behavioral contracts (offline-evaluated). */
  readonly behavioral: BehavioralStore;
  /** Phase 5 · T6 — routing SLO collector. */
  readonly slo: RoutingSlo;

  constructor(
    private services: ServiceRegistry,
    metricsOpts?: MetricsStoreOptions,
    stores?: { health?: RoutingHealth; behavioral?: BehavioralStore; slo?: RoutingSlo },
  ) {
    this.metrics = metricsOpts ? new IntelligenceMetrics(metricsOpts) : getDefaultMetrics();
    this.health = stores?.health ?? new RoutingHealth();
    this.behavioral = stores?.behavioral ?? new BehavioralStore();
    this.slo = stores?.slo ?? new RoutingSlo();
    this.router = new IntelligenceRouter({
      metrics: this.metrics,
      behavioral: behavioralView(this.behavioral),
      health: healthView(this.health),
    });
  }

  /** Breaker/retry configuration from the workspace config (Phase 5). */
  private breakerPolicy(config: XRConfig): {
    retry: import("./degradation.ts").RetryPolicy;
  } {
    // The schema's intelligencePlane.retry defaults ARE the tuned defaults.
    // Partial-config tolerant: raw fixtures (tests) may omit the section.
    const retry = config.intelligencePlane?.retry;
    return { retry: retry ? { ...retry } : { ...DEFAULT_RETRY_POLICY } };
  }

  private config(): XRConfig {
    try {
      return this.services.resolve(Tokens.Config).get();
    } catch {
      // Early init / tests without config service — lazy static import avoided for cycles
      // Callers in production always have Config registered.
      throw new Error("IntelligenceService requires Tokens.Config");
    }
  }

  /** Apply workspace breaker/retry tuning (idempotent per config load). */
  private applyRuntimeConfig(config: XRConfig): void {
    const breaker = config.intelligencePlane?.breaker;
    if (breaker) this.health.configure(breaker);
  }

  private catalog(config?: XRConfig): IntelligenceCatalog {
    const cfg = config ?? this.config();
    try {
      providerRegistry.syncCustom(cfg);
    } catch {
      /* ignore */
    }
    const key = `${cfg.defaults?.provider}:${cfg.defaults?.model}:${(cfg.providerEngine?.customProviders ?? []).length}:${cfg.providerEngine?.routingStrategy}`;
    const now = Date.now();
    if (this.catalogCache && this.catalogCache.key === key && now - this.catalogCache.at < this.catalogTtlMs) {
      return this.catalogCache.catalog;
    }
    const catalog = buildCatalog(cfg);
    this.catalogCache = { catalog, at: now, key };
    return catalog;
  }

  /** Invalidate cached catalog (after provider add/remove). */
  invalidateCatalog(): void {
    this.catalogCache = null;
  }

  getCatalog(): IntelligenceCatalog {
    return this.catalog();
  }

  listProviders(): ProviderDescriptor[] {
    return this.catalog().providers;
  }

  listModels(modelClass?: ModelClass): ModelDescriptor[] {
    const cat = this.catalog();
    if (!modelClass) return cat.models;
    return cat.models.filter((m) => m.classes.includes(modelClass));
  }

  getModel(providerId: string, modelId?: string): ModelDescriptor | undefined {
    return findModel(this.catalog(), providerId, modelId);
  }

  getProviderDescriptor(providerId: string): ProviderDescriptor | undefined {
    return findProvider(this.catalog(), providerId);
  }

  /** Compute a routing decision without constructing a provider. */
  route(request: RouteRequest = {}): RouteResult {
    const config = this.config();
    this.applyRuntimeConfig(config);
    const catalog = this.catalog(config);
    const router = new IntelligenceRouter({
      catalog,
      metrics: this.metrics,
      behavioral: behavioralView(this.behavioral),
      health: healthView(this.health),
    });
    const t0 = performance.now();
    // Phase 8 · T2 — routing is observable: one span per selection with the
    // structural decision (target, reason, availability) — never the task.
    const span = routingSpan();
    const result = router.route(config, request);
    const ms = performance.now() - t0;
    endRoutingSpan(span, {
      provider: result.decision.selected?.providerId,
      model: result.decision.selected?.modelId,
      reason: result.decision.mode,
      unavailable: result.decision.unavailable,
      selectionMs: Math.round(ms * 100) / 100,
    });
    try {
      xrMetrics.routingLatency.observe({}, Math.round(ms * 100) / 100);
      xrMetrics.routingDecisions.inc({
        provider: result.decision.selected?.providerId ?? "none",
        mode: result.decision.manual ? "manual" : result.decision.mode,
        outcome: result.decision.unavailable ? "unavailable" : "selected",
      });
    } catch {
      // Metrics never break routing.
    }
    // Phase 5 · T6 — the selection-latency SLO is measured here, at the
    // single choke point every decision passes through (Art. III).
    try {
      this.slo.record({
        kind: "selection",
        at: Date.now(),
        ms: Math.round(ms * 100) / 100,
        mode: result.decision.mode,
        manual: result.decision.manual,
        unavailable: result.decision.unavailable,
      });
    } catch {
      // SLO recording never breaks routing.
    }
    return result;
  }

  /**
   * Resolve a concrete Provider for execution using the intelligence plane.
   *
   * Phase 5 · T3/T4 — the selected provider is wrapped in a ResilientProvider
   * that executes the decision's fallback chain with: rolling-health gating,
   * a jittered retry budget, three-tier error classification, target-diverse
   * hops, defined degradation levels, full-conversation forwarding (context
   * preservation), and an honest RoutingEscalationError when the chain
   * exhausts. Fallback is never silent: every hop emits a visible notice AND
   * a recorded SLO event.
   *
   * Phase 0 · T11 (no same-target fallback) is preserved: construction skips
   * chain steps identical to the selected target.
   */
  resolveProvider(request: RouteRequest = {}): ResolveProviderResult {
    const config = this.config();
    const result = this.route(request);
    const { decision, record } = result;

    if (decision.unavailable || !decision.selected) {
      const msg =
        decision.humanHandoff?.reason ??
        decision.explanation ??
        "No compatible intelligence candidate";
      throw new IntelligenceRoutingError(msg, decision);
    }

    const selected = decision.selected;
    const primary = this.construct(config, selected.providerId, selected.modelId);

    const fallbackAllowed =
      decision.fallbackChain.length > 0 &&
      (decision.requirements.allowFallback ?? decision.constraints.allowFallback);

    if (!fallbackAllowed) {
      return { provider: primary, decision, record };
    }

    // Level each chain step: L1 when its fidelity is measured-equivalent (or
    // static-class equivalent when unmeasured), else L2 (reduced capability).
    const catalog = this.catalog(config);
    const leveledSteps: Array<FallbackStep & { level?: DegradationLevel }> = [];
    for (const step of decision.fallbackChain) {
      // Phase 0 · T11 — skip steps identical to the selected target.
      if (step.providerId === selected.providerId && step.modelId === selected.modelId) continue;
      if (leveledSteps.some((s) => s.providerId === step.providerId && s.modelId === step.modelId)) continue;
      leveledSteps.push({
        ...step,
        level: this.degradationLevelFor(selected, step, catalog),
      });
    }

    const policy = decision.constraints.localityPolicy;
    const { retry } = this.breakerPolicy(config);
    const service = this;

    const provider = new ResilientProvider(primary, selected.modelId, leveledSteps, {
      health: this.health,
      metrics: this.metrics,
      modelClass: decision.requirements.modelClass,
      decisionId: decision.decisionId,
      retry,
      construct(step) {
        return service.construct(config, step.providerId, step.modelId);
      },
      // Defense-in-depth (Phase 2 · T3 rule): each hop re-verifies locality.
      localityGuard(providerId) {
        return localityAllowed(policy, localityOf(providerId));
      },
      onFailover(rec) {
        service.recordFailover(rec);
      },
      onTrip(event) {
        try {
          service.slo.record({
            kind: "breaker",
            at: event.at,
            target: event.key,
            state: "open",
            reason: event.reason,
          });
        } catch { /* SLO best-effort */ }
      },
      onDegradation(level, reason) {
        try {
          service.slo.record({ kind: "degradation", at: Date.now(), level, reason });
        } catch { /* SLO best-effort */ }
      },
      onOutcome(outcome) {
        service.recordProviderOutcome(outcome, decision);
      },
    });

    return { provider, decision, record };
  }

  /** L1 vs L2: measured fidelity first, static quality class as prior. */
  private degradationLevelFor(
    selected: { providerId: string; modelId: string },
    step: FallbackStep,
    catalog: IntelligenceCatalog,
  ): DegradationLevel {
    const selContract = this.behavioral.contract(selected.providerId, selected.modelId);
    const stepContract = this.behavioral.contract(step.providerId, step.modelId);
    if (selContract?.source === "measured" && stepContract?.source === "measured") {
      return stepContract.overallFidelity >= selContract.overallFidelity - 0.1
        ? "L1_equivalent_fallback"
        : "L2_reduced_fallback";
    }
    const rank: Record<string, number> = { basic: 1, standard: 2, high: 3, frontier: 4, unknown: 0 };
    const selModel = findModel(catalog, selected.providerId, selected.modelId);
    const stepModel = findModel(catalog, step.providerId, step.modelId);
    if (selModel && stepModel) {
      return (rank[stepModel.quality.class] ?? 0) >= (rank[selModel.quality.class] ?? 0)
        ? "L1_equivalent_fallback"
        : "L2_reduced_fallback";
    }
    return "L2_reduced_fallback";
  }

  /** Record one failover hop: SLO event (context evidence rides the record). */
  private recordFailover(rec: FailoverRecord): void {
    try {
      this.slo.record({
        kind: "fallback",
        at: rec.at,
        from: `${rec.from.providerId}/${rec.from.modelId}`,
        to: `${rec.to.providerId}/${rec.to.modelId}`,
        trigger: rec.trigger,
        level: rec.level,
        ...(rec.context.anchors.length ? { cpr: rec.context.cpr } : {}),
      });
    } catch { /* SLO best-effort */ }
  }

  /**
   * Wire measured outcomes back into routing (G2 closure): historical stats
   * (confidence-gated) + cost-per-quality SLO. This is the runtime feed the
   * audit found missing — `recordOutcome` was never called in production.
   */
  private recordProviderOutcome(outcome: ProviderOutcome, decision: RoutingDecision): void {
    try {
      this.metrics.record(
        outcomeSampleFor(decision.requirements.modelClass, outcome),
      );
      if (outcome.success && outcome.usage) {
        const pricing = priceFor(outcome.providerId, outcome.modelId);
        const costUsd =
          (outcome.usage.inTokens / 1e6) * pricing.inPerMTok +
          (outcome.usage.outTokens / 1e6) * pricing.outPerMTok;
        const contract = this.behavioral.contract(outcome.providerId, outcome.modelId);
        const fidelity = contract?.source === "measured" ? contract.overallFidelity : 0.5;
        this.slo.record({
          kind: "cpq",
          at: Date.now(),
          target: `${outcome.providerId}/${outcome.modelId}`,
          costUsd,
          fidelity,
        });
      }
    } catch {
      // Outcome recording never breaks the turn.
    }
  }

  /**
   * Phase 5 · T2 — offline behavioral measurement (operator-triggered).
   * NEVER called from route()/resolveProvider() (hot path). Honors locality:
   * a provider the workspace policy could not route to is skipped, recorded,
   * not probed (no silent egress).
   */
  async measureModels(
    filter: { providerId?: string; modelId?: string } = {},
    evaluator: BehavioralEvaluator = new BehavioralEvaluator(),
  ): Promise<{ measured: BehavioralContract[]; skipped: Array<{ key: string; reason: string }> }> {
    const config = this.config();
    const catalog = this.catalog(config);
    const policy = policyFromConfig(config);
    const measured: BehavioralContract[] = [];
    const skipped: Array<{ key: string; reason: string }> = [];

    for (const model of catalog.models) {
      if (filter.providerId && model.providerId !== filter.providerId) continue;
      if (filter.modelId && model.modelId !== filter.modelId) continue;
      const key = `${model.providerId}/${model.modelId}`;
      if (!localityAllowed(policy.localityPolicy, localityOf(model.providerId))) {
        skipped.push({ key, reason: `locality policy ${policy.localityPolicy} forbids probing` });
        continue;
      }
      if (model.locality.requiresCredential) {
        const provider = catalog.providers.find((p) => p.providerId === model.providerId);
        if (provider && !provider.auth.credentialAvailable) {
          skipped.push({ key, reason: "credentials missing" });
          continue;
        }
      }
      try {
        const provider = this.construct(config, model.providerId, model.modelId);
        const contract = await evaluator.evaluate(provider, model.modelId);
        this.behavioral.save(contract);
        measured.push(contract);
      } catch (e) {
        skipped.push({ key, reason: (e as Error).message.slice(0, 120) });
      }
    }
    this.invalidateCatalog();
    return { measured, skipped };
  }

  /**
   * Explain routing for UX / CLI / daemon (safe, no secrets).
   */
  explain(request: RouteRequest = {}): {
    summary: string;
    decision: RoutingDecision;
    record: RoutingDecisionRecord;
    policy: ReturnType<typeof policyFromConfig>;
  } {
    const config = this.config();
    const { decision, record } = this.route(request);
    return {
      summary: decision.explanation,
      decision,
      record,
      policy: policyFromConfig(config),
    };
  }

  /** Record an execution outcome for future routing (bounded). */
  recordOutcome(sample: OutcomeSample): void {
    this.metrics.record(sample);
  }

  getMetrics(): IntelligenceMetrics {
    return this.metrics;
  }

  /**
   * Decide if fallback is permitted after a runtime failure.
   * Callers must still revalidate budget/privacy/authority (Phase 3/4).
   */
  canFallback(trigger: FallbackTrigger, decision: RoutingDecision): {
    allow: boolean;
    reason: string;
    next?: { providerId: string; modelId: string };
  } {
    const gate = mayFallbackOnTrigger(trigger);
    if (!gate.allow) return { allow: false, reason: gate.reason };
    if (!(decision.requirements.allowFallback ?? decision.constraints.allowFallback)) {
      return { allow: false, reason: "fallback disabled by policy/requirements" };
    }
    const next = decision.fallbackChain[0];
    if (!next) return { allow: false, reason: "fallback chain empty" };
    return { allow: true, reason: gate.reason, next };
  }

  /** Build default task requirements for agent chat loops. */
  agentRequirements(overrides: Partial<TaskRequirements> = {}): Partial<TaskRequirements> {
    return {
      modelClass: "chat",
      require: {
        toolUse: true,
        ...(overrides.require ?? {}),
      },
      summary: overrides.summary ?? "agent-task",
      ...overrides,
    };
  }

  private construct(config: XRConfig, providerId: string, modelId: string): Provider {
    return providerRegistry.createProvider(providerId, config, modelId);
  }

  async onInit(): Promise<void> {
    try {
      this.catalog();
    } catch {
      /* catalog may be empty early */
    }
  }

  async onStart(): Promise<void> {
    this.invalidateCatalog();
  }

  async onStop(): Promise<void> {
    this.invalidateCatalog();
  }
}

export class IntelligenceRoutingError extends Error {
  readonly decision: RoutingDecision;
  constructor(message: string, decision: RoutingDecision) {
    super(message);
    this.name = "IntelligenceRoutingError";
    this.decision = decision;
  }
}
