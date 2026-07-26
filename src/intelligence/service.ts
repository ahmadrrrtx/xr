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
import { FallbackProvider } from "../providers/routing.ts";
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
import type {
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

  constructor(
    private services: ServiceRegistry,
    metricsOpts?: MetricsStoreOptions,
  ) {
    this.metrics = metricsOpts ? new IntelligenceMetrics(metricsOpts) : getDefaultMetrics();
    this.router = new IntelligenceRouter({ metrics: this.metrics });
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
    const catalog = this.catalog(config);
    const router = new IntelligenceRouter({
      catalog,
      metrics: this.metrics,
    });
    return router.route(config, request);
  }

  /**
   * Resolve a concrete Provider for execution using the intelligence plane.
   * Preserves FallbackProvider wrapping when a fallback chain exists and fallback is allowed.
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

    const primary = this.construct(
      config,
      decision.selected.providerId,
      decision.selected.modelId,
    );

    let provider: Provider = primary;
    if (
      decision.fallbackChain.length > 0 &&
      (decision.requirements.allowFallback ?? decision.constraints.allowFallback)
    ) {
      const step = decision.fallbackChain[0]!;
      try {
        const fb = this.construct(config, step.providerId, step.modelId);
        provider = new FallbackProvider(primary, fb);
      } catch {
        // Fallback construction failed — primary only
        provider = primary;
      }
    }

    return { provider, decision, record };
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
