/**
 * XR Phase 2 · T3 — `RoutingService`: THE single routing authority.
 *
 * Constitution Art. III.2 (one source of truth per concern) and Art. VI.3
 * ("one provider/model plane").
 *
 * ── The two authorities this replaces ───────────────────────────────────────
 *
 * `src/providers/routing.ts` (`ProviderRouter`) already delegated model
 * SELECTION to `IntelligenceRouter`, so it looked like a facade. It was not:
 * it retained two independent behaviours that could contradict the router.
 *
 *   1. ITS OWN, NARROWER LOCALITY DERIVATION (routing.ts:126-138). It forced
 *      `local_only` for exactly three conditions and recognised NEITHER
 *      `private_only` NOR `no_cloud`, both of which `intelligence/router.ts`
 *      (L49-132) does honour. A workspace configured `no_cloud` therefore got
 *      no locality constraint at all on this path.
 *
 *   2. AN UNGUARDED EXHAUSTION FALLBACK (routing.ts:147-155). When the router
 *      reported `unavailable`, it constructed `config.defaults.provider`
 *      DIRECTLY:
 *
 *          const primaryId = overrides?.provider ?? this.config.defaults.provider;
 *          const primary = registry.createProvider(primaryId, …);
 *
 *      That bypasses the locality decision entirely. A `no_cloud` or
 *      `local_only` workspace whose local runtime was momentarily unavailable
 *      would be handed the configured default — commonly a CLOUD provider —
 *      with no policy check and no error. Data leaves the machine in exactly
 *      the configuration that forbade it.
 *
 * Both are closed here. This service is the ONLY place that turns a routing
 * decision into a `Provider`, and it FAILS CLOSED: if the policy forbids the
 * only reachable target, it raises `LocalityPolicyViolation` rather than
 * silently downgrading the user's guarantee (Art. IV.4).
 *
 * ── Preserved behaviour ─────────────────────────────────────────────────────
 *
 * · Legacy `RoutingStrategy` names keep working (`strategyToMode`).
 * · Manual provider/model pins still win.
 * · Phase 0 · T11 fallback-diversity: a fallback must change the destination
 *   (different provider, or at minimum a different model). Carried over intact
 *   and re-tested.
 * · `FallbackProvider` keeps its legible label and its runtime behaviour.
 */

import type { Provider } from "../core/types.ts";
import { ProviderAbortError } from "../providers/request-guard.ts";
import type { XRConfig } from "../config/config.ts";
import { registry } from "../providers/registry.ts";
import { PRESETS } from "../providers/presets.ts";
import { IntelligenceRouter } from "./router.ts";
import type {
  Locality,
  RouteRequest,
  RoutingDecision,
  RoutingMode,
  TaskRequirements,
} from "./types.ts";

/** Legacy strategy vocabulary, preserved for config and CLI compatibility. */
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
  requirements?: Partial<TaskRequirements>;
  mode?: RoutingMode;
  decisionOnly?: boolean;
}

export interface ResolveWithDecision {
  provider: Provider;
  decision: RoutingDecision;
}

/**
 * Raised when the only reachable target would violate the workspace's locality
 * policy. FAIL CLOSED — never silently satisfied by a cloud provider.
 */
export class LocalityPolicyViolation extends Error {
  constructor(
    readonly policy: string,
    readonly attemptedProviderId: string,
    readonly attemptedLocality: Locality | "unknown",
  ) {
    super(
      `routing refused: workspace locality policy "${policy}" forbids provider ` +
        `"${attemptedProviderId}" (locality: ${attemptedLocality}). ` +
        `No compliant provider is available. Start a local runtime (e.g. \`ollama serve\`), ` +
        `or change intelligencePlane.localityPolicy if this workspace may use it.`,
    );
    this.name = "LocalityPolicyViolation";
  }
}

/** Map legacy strategy names onto intelligence-plane modes. */
export function strategyToMode(
  strategy: RoutingStrategy | string | undefined,
): RoutingMode | undefined {
  switch (strategy) {
    case "primary":
      return "preferred_with_fallback";
    case "localFirst":
    case "cloudFirst":
    case "hybrid":
      return "automatic";
    case "cheapest":
      return "cost_constrained";
    case "fastest":
      return "latency_constrained";
    default:
      return undefined;
  }
}

/**
 * Is this provider id a LOCAL runtime, per the preset catalogue?
 *
 * Exported as a pure function (Phase 2 · T7/T8): it was a private method, which
 * made the local-runtime classification reachable only through a code path that
 * the current catalogue makes practically unreachable — so a mutation of the
 * comparison went undetected. A pure, exported predicate is both better design
 * and directly testable.
 */
export function isLocalPreset(id: string): boolean {
  return registry.getPreset(id)?.kind === "local" || PRESETS[id]?.kind === "local";
}

/**
 * Pick the best local runtime for a workspace, preferring the configured one.
 * Pure and exported for the same reason as `isLocalPreset`.
 */
export function findBestLocalTarget(
  localCfg: Record<string, string | undefined>,
  defaultProvider: string,
  defaultModel?: string,
): { id: string; model: string } | undefined {
  const configuredProvider = localCfg.provider ?? localCfg.runtime ?? defaultProvider;
  const preset = registry.getPreset(configuredProvider) ?? PRESETS[configuredProvider];
  if (preset?.kind === "local") {
    return { id: preset.id, model: localCfg.selected ?? defaultModel ?? preset.defaultModel };
  }
  for (const id of [
    "ollama", "lmstudio", "llamacpp", "jan", "localai",
    "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang",
  ]) {
    const p = registry.getPreset(id) ?? PRESETS[id];
    if (p?.kind === "local") return { id: p.id, model: localCfg.selected ?? p.defaultModel };
  }
  return undefined;
}

/**
 * Decide whether a legacy fallback target may be wired.
 *
 * Two independent conditions, both required (Phase 0 · T11 + Phase 2 · T3):
 *   1. DIVERSITY  — the fallback must change the destination: a different
 *      provider, or at minimum a different model on the same provider. The
 *      shipped defaults made same-provider/same-model the common case, which
 *      is how "falling back to ollama" came to describe retrying a dead
 *      endpoint against itself.
 *   2. LOCALITY   — the fallback must satisfy the workspace's locality policy,
 *      so a fallback can never be the egress bypass the primary path forbids.
 *
 * Pure and exported so both conditions are directly testable.
 */
export function legacyFallbackAllowed(params: {
  fallbackId?: string;
  fallbackModel?: string;
  primaryId: string;
  primaryModel: string;
  policy: "any" | "local_only" | "private_only" | "no_cloud";
}): boolean {
  const { fallbackId, primaryId, primaryModel, policy } = params;
  if (!fallbackId) return false;
  const resolvedModel = params.fallbackModel ?? primaryModel;
  const isDifferentTarget = fallbackId !== primaryId || resolvedModel !== primaryModel;
  return isDifferentTarget && localityAllowed(policy, localityOf(fallbackId));
}

/**
 * Locality of a provider id, from the preset catalogue.
 * Exported (Phase 5 · T3/T5): the ONLY locality derivation for provider ids —
 * the resilient executor's per-hop guard uses this same function (Art. III:
 * one derivation, no second opinion).
 */
export function localityOf(providerId: string): Locality | "unknown" {
  const preset = registry.getPreset(providerId) ?? PRESETS[providerId];
  if (!preset) return "unknown";
  switch (preset.kind) {
    case "local":
      return "local";
    case "hosted":
      return "cloud";
    default:
      // `custom`/self-hosted endpoints are not provably local, so they are
      // treated as `private` — permitted under `private_only`/`no_cloud`,
      // refused under `local_only`.
      return "private";
  }
}

/**
 * Is `locality` permitted under `policy`? Unknown locality is refused under any
 * restrictive policy — ambiguity denies (Art. IV.4).
 */
export function localityAllowed(
  policy: "any" | "local_only" | "private_only" | "no_cloud",
  locality: Locality | "unknown",
): boolean {
  switch (policy) {
    case "any":
      return true;
    case "local_only":
      return locality === "local";
    case "private_only":
      return locality === "local" || locality === "private";
    case "no_cloud":
      return locality !== "cloud" && locality !== "unknown" && locality !== "hybrid";
  }
}

export class RoutingService {
  private lastDecision: RoutingDecision | null = null;
  private readonly router = new IntelligenceRouter();

  constructor(private readonly config: XRConfig) {}

  getLastDecision(): RoutingDecision | null {
    return this.lastDecision;
  }

  /** Compute a routing decision without constructing a provider. */
  decide(overrides?: ResolveOptions): RoutingDecision {
    const strategy =
      overrides?.strategy ?? this.config.providerEngine?.routingStrategy ?? "hybrid";

    // The strategy overlay is the ONLY legacy translation retained; locality is
    // derived exclusively by `policyFromConfig` inside IntelligenceRouter, so
    // there is no second derivation to disagree with.
    const configForRoute: XRConfig = {
      ...this.config,
      providerEngine: {
        ...(this.config.providerEngine as Record<string, unknown>),
        routingStrategy: strategy,
      },
    } as XRConfig;

    const request: RouteRequest = {
      ...(overrides?.provider !== undefined ? { provider: overrides.provider } : {}),
      ...(overrides?.model !== undefined ? { model: overrides.model } : {}),
      mode: overrides?.mode ?? strategyToMode(strategy),
      requirements: { modelClass: "chat", ...overrides?.requirements },
    };

    const { decision } = this.router.route(configForRoute, request);
    this.lastDecision = decision;
    return decision;
  }

  resolve(overrides?: ResolveOptions): Provider {
    return this.resolveWithDecision(overrides).provider;
  }

  /**
   * Resolve to a concrete provider, honouring the locality policy on EVERY
   * path — including exhaustion.
   */
  resolveWithDecision(overrides?: ResolveOptions): ResolveWithDecision {
    const decision = this.decide(overrides);
    const policy = decision.constraints.localityPolicy;

    if (decision.unavailable || !decision.selected) {
      /**
       * EXHAUSTION PATH — the locality bypass that Phase 2 · T3 closes.
       *
       * Backward-compatible behaviour is preserved (fall back to constructing
       * the configured primary so an explicit pin still throws the familiar
       * "unknown provider" error) but ONLY when the target actually satisfies
       * the workspace's locality policy. Otherwise we fail closed.
       */
      const primaryId = overrides?.provider ?? this.config.defaults.provider;
      const primaryModel = overrides?.model ?? this.config.defaults.model;
      const primaryLocality = localityOf(primaryId);

      if (!localityAllowed(policy, primaryLocality)) {
        throw new LocalityPolicyViolation(policy, primaryId, primaryLocality);
      }

      const primary = registry.createProvider(primaryId, this.config, primaryModel);
      return {
        provider: this.wrapFallbackLegacy(primary, primaryId, primaryModel, policy),
        decision,
      };
    }

    const selected = decision.selected;

    // Defence in depth: the router already filtered by locality, but the
    // provider construction path must never be able to disagree with the
    // decision it was handed.
    const selectedLocality = localityOf(selected.providerId);
    if (!localityAllowed(policy, selectedLocality)) {
      throw new LocalityPolicyViolation(policy, selected.providerId, selectedLocality);
    }

    const primary = registry.createProvider(selected.providerId, this.config, selected.modelId);

    if (
      decision.fallbackChain.length > 0 &&
      (decision.requirements.allowFallback ?? decision.constraints.allowFallback)
    ) {
      /**
       * Phase 0 · T11 — a fallback step is only useful if it changes the
       * destination: a different provider, or at minimum a different model.
       * Preserved verbatim, and now ALSO locality-filtered so a fallback can
       * never be the bypass the primary path forbids.
       */
      const step = decision.fallbackChain.find(
        (candidate) =>
          (candidate.providerId !== selected.providerId ||
            candidate.modelId !== selected.modelId) &&
          localityAllowed(policy, localityOf(candidate.providerId)),
      );
      if (step) {
        try {
          const fallback = registry.createProvider(step.providerId, this.config, step.modelId);
          return { provider: new FallbackProvider(primary, fallback), decision };
        } catch {
          // A fallback that cannot be constructed is simply absent; the primary
          // is still valid and policy-compliant.
          return { provider: primary, decision };
        }
      }
      // Every candidate resolved to the same target (or was refused by policy)
      // — run without a fallback rather than advertising one that cannot help.
      return { provider: primary, decision };
    }

    return { provider: primary, decision };
  }

  /** Legacy fallback wiring, used only when the decision path could not select. */
  private wrapFallbackLegacy(
    primary: Provider,
    primaryId: string,
    primaryModel: string,
    policy: "any" | "local_only" | "private_only" | "no_cloud",
  ): Provider {
    let fallbackId: string | undefined = this.config.defaults.fallbackProvider;
    let fallbackModel: string | undefined = this.config.defaults.fallbackModel;

    if (!fallbackId && this.config.localModels?.enabled && !this.isLocal(primaryId)) {
      const local = this.findBestLocal();
      fallbackId = local?.id ?? "ollama";
      fallbackModel = local?.model ?? this.config.defaults.fallbackModel ?? "qwen2.5:7b";
    }

    /**
     * Phase 0 · T11 — target diversity, including the same-provider case.
     * The original guard (`fallbackId !== primaryId`) still permitted a
     * same-provider/same-model fallback whenever the model was also equal, and
     * the shipped defaults made exactly that the common case.
     */
    const resolvedFallbackModel = fallbackModel ?? primaryModel;

    if (legacyFallbackAllowed({ fallbackId, fallbackModel, primaryId, primaryModel, policy })) {
      try {
        const fallback = registry.createProvider(fallbackId!, this.config, resolvedFallbackModel);
        return new FallbackProvider(primary, fallback);
      } catch {
        return primary;
      }
    }
    return primary;
  }

  private isLocal(id: string): boolean {
    return isLocalPreset(id);
  }

  private findBestLocal(): { id: string; model: string } | undefined {
    // `localModels` mixes booleans and strings; only the string fields are read.
    const localCfg = (this.config.localModels ?? {}) as unknown as Record<string, string | undefined>;
    return findBestLocalTarget(localCfg, this.config.defaults.provider, this.config.defaults.model);
  }
}

/**
 * Wrapper that automatically tries a secondary provider if the primary fails.
 * Model-call level only — does not replay tool side effects.
 *
 * Unchanged from the pre-Phase-2 implementation apart from its home: it is a
 * provider composition primitive, so it lives with the routing authority that
 * constructs it.
 */
export class FallbackProvider implements Provider {
  constructor(
    public primary: Provider,
    public fallback: Provider,
  ) {}

  get id() {
    return this.primary.id;
  }

  /**
   * Human-visible routing reason (Phase 0 · T11).
   *
   * The label used to print only provider labels, so a genuinely diverse
   * fallback (qwen2.5:7b → codellama:7b on the same runtime) rendered as
   * "Ollama (Local) → fallback Ollama (Local)" — indistinguishable from the
   * self-fallback bug. The model is now included whenever the labels match.
   */
  get label() {
    const primaryLabel = this.primary.label;
    const fallbackLabel = this.fallback.label;
    if (primaryLabel !== fallbackLabel) {
      return `${primaryLabel} → fallback ${fallbackLabel}`;
    }
    const primaryModel = (this.primary as { model?: string }).model;
    const fallbackModel = (this.fallback as { model?: string }).model;
    if (primaryModel && fallbackModel && primaryModel !== fallbackModel) {
      return `${primaryLabel} (${primaryModel}) → fallback ${fallbackLabel} (${fallbackModel})`;
    }
    return primaryLabel;
  }

  /** Expose both sides for decision/audit consumers. */
  get fallbackId() {
    return this.fallback.id;
  }

  /** `provider/model` when the model is known, else just the provider id. */
  private describe(p: Provider): string {
    const model = (p as { model?: string }).model;
    return model ? `${p.id}/${model}` : p.id;
  }

  async chat(
    messages: Parameters<Provider["chat"]>[0],
    tools: Parameters<Provider["chat"]>[1],
    options?: Parameters<Provider["chat"]>[2],
  ): ReturnType<Provider["chat"]> {
    try {
      return await this.primary.chat(messages, tools, options);
    } catch (e) {
      // GAP-001 — failover exists for a provider that FAILED, not for a turn
      // the user cancelled or that blew the deadline. Retrying those would
      // double the latency the timeout was meant to bound and would ignore an
      // explicit stop request.
      if (e instanceof ProviderAbortError) throw e;
      // Phase 0 · T11 — name the actual fallback target, including the model,
      // so "falling back to ollama" can never describe a retry of the same
      // model on the same endpoint.
      console.warn(
        `\x1b[33m! Primary provider (${this.describe(this.primary)}) failed: ${(e as Error).message}. Falling back to ${this.describe(this.fallback)}...\x1b[0m`,
      );
      return await this.fallback.chat(messages, tools, options);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const h = await this.primary.health();
    if (h.ok) return h;
    return await this.fallback.health();
  }
}
