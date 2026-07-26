/**
 * XR — Provider Routing Engine
 *
 * XR 4.4: delegates selection to the Universal Intelligence Plane while
 * preserving the public ProviderRouter / FallbackProvider / buildProvider API.
 *
 * Manual provider/model pins always win (strict unless fallback explicitly allowed).
 * Automatic modes filter by capability, locality, credentials, and budget policy
 * before deterministic scoring.
 */

import type { Provider } from "../core/types.ts";
import type { XRConfig } from "../config/config.ts";
import { registry } from "./registry.ts";
import { PRESETS } from "./presets.ts";
import { getSecret } from "../security/secrets.ts";
import {
  IntelligenceRouter,
  type RouteRequest,
  type RoutingDecision,
  type RoutingMode as IntelRoutingMode,
  type TaskRequirements,
} from "../intelligence/index.ts";

export type RoutingStrategy =
  | "primary"
  | "localFirst"
  | "cloudFirst"
  | "hybrid"
  | "cheapest"
  | "fastest";

export interface ResolveOptions {
  provider?: string;
  model?: string;
  strategy?: RoutingStrategy;
  /** XR 4.4 task requirements for capability-aware routing. */
  requirements?: Partial<TaskRequirements>;
  /** XR 4.4 explicit routing mode override. */
  mode?: IntelRoutingMode;
  /** When true, return decision only (no provider construction). */
  decisionOnly?: boolean;
}

export interface ResolveWithDecision {
  provider: Provider;
  decision: RoutingDecision;
}

/** Map legacy strategy names onto intelligence-plane modes. */
export function strategyToMode(strategy: RoutingStrategy | string | undefined): IntelRoutingMode | undefined {
  switch (strategy) {
    case "primary":
      return "preferred_with_fallback";
    case "localFirst":
      return "automatic";
    case "cloudFirst":
      return "automatic";
    case "cheapest":
      return "cost_constrained";
    case "fastest":
      return "latency_constrained";
    case "hybrid":
      return "automatic";
    default:
      return undefined;
  }
}

export class ProviderRouter {
  private lastDecision: RoutingDecision | null = null;

  constructor(private config: XRConfig) {}

  /** Last decision produced by resolve / resolveWithDecision (for callers/tests). */
  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  resolve(overrides?: ResolveOptions): Provider {
    return this.resolveWithDecision(overrides).provider;
  }

  resolveWithDecision(overrides?: ResolveOptions): ResolveWithDecision {
    const strategy =
      overrides?.strategy ??
      this.config.providerEngine?.routingStrategy ??
      "hybrid";

    // Apply legacy strategy as a temporary config overlay for policyFromConfig
    const configForRoute: XRConfig = {
      ...this.config,
      providerEngine: {
        ...(this.config.providerEngine as any),
        routingStrategy: strategy as any,
      },
    };

    // localFirst with no explicit pin: set locality preference via intelligencePlane overlay
    if (strategy === "localFirst" && !overrides?.provider) {
      (configForRoute as any).intelligencePlane = {
        ...((this.config as any).intelligencePlane ?? {}),
        // prefer local via legacyStrategy; do not hard-block cloud unless local-only
      };
    }

    const request: RouteRequest = {
      provider: overrides?.provider,
      model: overrides?.model,
      mode: overrides?.mode ?? strategyToMode(strategy),
      requirements: {
        modelClass: "chat",
        ...overrides?.requirements,
        // cloudFirst: soft preference away from forcing local
        ...(strategy === "cloudFirst" && !overrides?.provider
          ? {
              preferred: {
                providerId: overrides?.requirements?.preferred?.providerId,
                modelId: overrides?.requirements?.preferred?.modelId,
              },
            }
          : {}),
      },
    };

    // When strategy is localFirst, bias locality through requirements only if
    // workspace is local-only; otherwise leave automatic with legacyStrategy.
    if (
      this.config.localModels?.routing === "local-only" ||
      (this.config as any).intelligencePlane?.localityPolicy === "local_only" ||
      (this.config as any).intelligencePlane?.mode === "local_only"
    ) {
      request.requirements = {
        ...request.requirements,
        localityPolicy: "local_only",
        allowCloudFallback: false,
      };
      request.mode = "local_only";
    }

    const router = new IntelligenceRouter();
    const { decision } = router.route(configForRoute, request);
    this.lastDecision = decision;

    if (decision.unavailable || !decision.selected) {
      // Backward-compatible behavior: fall back to direct primary construction
      // when intelligence finds nothing — preserves prior "throw on unknown provider"
      // semantics for explicit pins; for automatic, try defaults.
      const primaryId = overrides?.provider ?? this.config.defaults.provider;
      const primaryModel = overrides?.model ?? this.config.defaults.model;
      try {
        const primary = registry.createProvider(primaryId, this.config, primaryModel);
        return { provider: this.wrapFallbackLegacy(primary, primaryId, primaryModel), decision };
      } catch (e) {
        throw e;
      }
    }

    const primary = registry.createProvider(
      decision.selected.providerId,
      this.config,
      decision.selected.modelId,
    );

    if (
      decision.fallbackChain.length > 0 &&
      (decision.requirements.allowFallback ?? decision.constraints.allowFallback)
    ) {
      const step = decision.fallbackChain[0]!;
      try {
        const fallback = registry.createProvider(
          step.providerId,
          this.config,
          step.modelId,
        );
        return {
          provider: new FallbackProvider(primary, fallback),
          decision,
        };
      } catch {
        return { provider: primary, decision };
      }
    }

    return { provider: primary, decision };
  }

  /** Legacy fallback wiring used only when decision path could not select. */
  private wrapFallbackLegacy(primary: Provider, primaryId: string, primaryModel: string): Provider {
    let fallbackId: string | undefined = this.config.defaults.fallbackProvider;
    let fallbackModel: string | undefined = this.config.defaults.fallbackModel;

    if (
      !fallbackId &&
      this.config.localModels?.enabled &&
      !this.isLocal(primaryId)
    ) {
      const local = this.findBestLocal();
      fallbackId = local?.id ?? "ollama";
      fallbackModel = local?.model ?? this.config.defaults.fallbackModel ?? "qwen2.5:7b";
    }

    if (fallbackId && fallbackId !== primaryId) {
      try {
        const fallback = registry.createProvider(
          fallbackId,
          this.config,
          fallbackModel ?? primaryModel,
        );
        return new FallbackProvider(primary, fallback);
      } catch {
        return primary;
      }
    }
    return primary;
  }

  private isLocal(id: string): boolean {
    return (
      registry.getPreset(id)?.kind === "local" ||
      PRESETS[id]?.kind === "local"
    );
  }

  private findBestLocal(): { id: string; model: string } | undefined {
    const localCfg: any = this.config.localModels ?? {};
    const configuredProvider =
      localCfg.provider ?? localCfg.runtime ?? this.config.defaults.provider;
    const preset = registry.getPreset(configuredProvider) ?? PRESETS[configuredProvider];
    if (preset?.kind === "local") {
      return {
        id: preset.id,
        model: localCfg.selected ?? this.config.defaults.model ?? preset.defaultModel,
      };
    }

    for (const id of [
      "ollama",
      "lmstudio",
      "llamacpp",
      "jan",
      "localai",
      "vllm",
      "gpt4all",
      "koboldcpp",
      "textgenwebui",
      "sglang",
    ]) {
      const p = registry.getPreset(id) ?? PRESETS[id];
      if (p?.kind === "local") {
        return { id: p.id, model: localCfg.selected ?? p.defaultModel };
      }
    }
    return undefined;
  }

  // Kept for tests / diagnostics that called private helpers indirectly via behavior
  findBestCloud(): { id: string; model: string } | undefined {
    const candidates = registry
      .listByKind("hosted")
      .filter(
        (p) => p.apiKeyEnv && (process.env[p.apiKeyEnv] || getSecret(p.apiKeyEnv)),
      );
    if (candidates.length) {
      const tierOrder = { free: 0, cheap: 1, premium: 2, enterprise: 3, custom: 4 };
      const sorted = candidates.sort(
        (a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99),
      );
      return { id: sorted[0].id, model: sorted[0].defaultModel };
    }
    return undefined;
  }
}

/**
 * Wrapper that automatically tries a secondary provider if the primary fails.
 * Model-call level only — does not replay tool side effects.
 */
export class FallbackProvider implements Provider {
  constructor(
    public primary: Provider,
    public fallback: Provider,
  ) {}

  get id() {
    return this.primary.id;
  }
  get label() {
    return `${this.primary.label} → fallback ${this.fallback.label}`;
  }

  /** Expose both sides for decision/audit consumers. */
  get fallbackId() {
    return this.fallback.id;
  }

  async chat(messages: any[], tools: any[]): Promise<any> {
    try {
      return await this.primary.chat(messages, tools);
    } catch (e) {
      console.warn(
        `\x1b[33m! Primary provider (${this.primary.id}) failed: ${(e as Error).message}. Falling back to ${this.fallback.id}...\x1b[0m`,
      );
      return await this.fallback.chat(messages, tools);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const h = await this.primary.health();
    if (h.ok) return h;
    return await this.fallback.health();
  }
}
