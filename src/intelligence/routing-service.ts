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

import type { ChatOptions, Message, Provider, ProviderStreamChunk, Tool } from "../core/types.ts";
import { ProviderAbortError } from "../providers/request-guard.ts";
import { chatAttempt, streamAttempt } from "../providers/attempts.ts";
import { ProviderError, normalizeProviderError, isRetryableProviderError } from "../providers/errors.ts";
import { buildCatalog, findModel } from "./catalog.ts";
import { localityAllowed } from "./locality.ts";
import { localityForKind } from "./capability.ts";
import { evaluateCandidate } from "./evaluator.ts";
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
export function localityOf(providerId: string, config?: XRConfig): Locality | "unknown" {
  const preset = registry.getPreset(providerId) ?? PRESETS[providerId];
  if (!preset) return "unknown";
  switch (preset.kind) {
    case "local": {
      const url = config?.localModels?.runtimes?.[providerId]?.baseUrl ?? (config?.providers?.[providerId] as { baseUrl?: string } | undefined)?.baseUrl ?? preset.baseUrl;
      return localityForKind("local", providerId, url).locality;
    }
    case "hosted":
      return "cloud";
    default:
      if (preset.baseUrl) return localityForKind("local", providerId, preset.baseUrl).locality;
      // `custom`/self-hosted endpoints are not provably local, so they are
      // treated as `private` — permitted under `private_only`/`no_cloud`,
      // refused under `local_only`.
      return "cloud";
  }
}

/**
 * Is `locality` permitted under `policy`? Unknown locality is refused under any
 * restrictive policy — ambiguity denies (Art. IV.4).
 */
export { localityAllowed } from "./locality.ts";

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
      mode: overrides?.mode,
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
    const configSnapshot = JSON.stringify(this.config);

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
      const primaryLocality = localityOf(primaryId, this.config);

      if (!localityAllowed(policy, primaryLocality)) {
        throw new LocalityPolicyViolation(policy, primaryId, primaryLocality);
      }

      if (!registry.has(primaryId)) throw new Error(`Unknown provider "${primaryId}"`);
      throw new ProviderError("unsupported_capability", primaryId, `Provider selection refused: ${decision.explanation}`, { modelId: primaryModel });
    }

    const selected = decision.selected;

    // Defence in depth: the router already filtered by locality, but the
    // provider construction path must never be able to disagree with the
    // decision it was handed.
    const selectedLocality = localityOf(selected.providerId, this.config);
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
          localityAllowed(policy, localityOf(candidate.providerId, this.config)),
      );
      if (step) {
        try {
          const fallback = registry.createProvider(step.providerId, this.config, step.modelId);
          const canFallback = () => {
            if (JSON.stringify(this.config) !== configSnapshot) return false;
            const consent = this.config.intelligencePlane;
            if (!(decision.requirements.allowFallback ?? consent?.allowFallback)) return false;
            if (step.providerId !== selected.providerId && !(decision.requirements.allowCrossProviderFallback ?? consent?.allowCrossProviderFallback)) return false;
            if (localityOf(selected.providerId, this.config) !== "cloud" && localityOf(step.providerId, this.config) === "cloud" && !(decision.requirements.allowCloudFallback ?? consent?.allowCloudFallback)) return false;
            if (!localityAllowed(policy, localityOf(step.providerId, this.config))) return false;
            const m = findModel(buildCatalog(this.config), step.providerId, step.modelId);
            return !!m && evaluateCandidate(m, { ...decision.requirements, pin: undefined }, decision.constraints).compatible;
          };
          return { provider: new FallbackProvider(primary, fallback, { canFallback }), decision };
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
  readonly managesAttempts = true;
  private active: Provider;
  constructor(public primary: Provider, public fallback: Provider, private consent?: { canFallback: () => boolean }) { this.active = primary; }
  get id() { return this.active.id; }
  get modelId() { return this.active.modelId; }
  get capabilities() { return this.active.capabilities; }
  get fallbackId() { return this.fallback.id; }
  private sameTarget() {
    const a=this.primary.modelId ?? (this.primary as Provider & {model?:string}).model;
    const b=this.fallback.modelId ?? (this.fallback as Provider & {model?:string}).model;
    return this.primary===this.fallback || (this.primary.id===this.fallback.id && typeof a==="string" && a.length>0 && a===b);
  }
  get label() {
    if(this.sameTarget()) return this.primary.label;
    if (this.active === this.fallback) return `${this.fallback.label} (${this.fallback.modelId ?? "model unknown"}; explicit fallback)`;
    return this.primary.label === this.fallback.label ? `${this.primary.label} (${this.primary.modelId ?? (this.primary as any).model ?? "?"}) → fallback ${this.fallback.label} (${this.fallback.modelId ?? (this.fallback as any).model ?? "?"})` : `${this.primary.label} → fallback ${this.fallback.label}`;
  }
  private allowed(error: unknown, options?: ChatOptions): boolean {
    // Cancellation/auth/malformed/unknown failures never replay. Deadlines may
    // fail over only with explicit fresh consent and another admitted request.
    return !this.sameTarget() && !["ProviderBudgetAdmissionError", "ProviderAccountingError"].includes((error as Error)?.name) && !(error instanceof ProviderAbortError && error.kind === "cancelled") && isRetryableProviderError(normalizeProviderError(error, this.primary.id, this.primary.modelId)) && !!options?.beforeAttempt && this.consent?.canFallback() === true;
  }
  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<import("../core/types.ts").ModelTurn> {
    this.active = this.primary;
    try { return await chatAttempt(this.primary, messages, tools, options); }
    catch (error) { if (!this.allowed(error, options)) throw error; }
    this.active = this.fallback;
    return chatAttempt(this.fallback, messages, tools, options, true);
  }
  async *chatStream(messages: Message[], tools: Tool[], options?: ChatOptions): AsyncGenerator<ProviderStreamChunk> {
    this.active = this.primary;
    let emitted = false;
    try {
      for await (const c of streamAttempt(this.primary, messages, tools, options)) { if (c.text || c.toolCall) emitted = true; yield c; }
      return;
    } catch (error) { if (emitted || !this.allowed(error, options)) throw error; }
    this.active = this.fallback;
    yield* streamAttempt(this.fallback, messages, tools, options, true);
  }
  async health() { this.active = this.primary; return this.primary.health(); }
}
