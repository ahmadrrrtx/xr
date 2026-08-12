/**
 * XR — Provider Factory
 * Facade over the Universal Provider Engine. Backward-compatible exports.
 * PURE BYOK: keys are read from env vars the USER sets. We ship none.
 *
 * All presets are registered into the ProviderRegistry at module load time.
 * New presets should be added in presets.ts, not here.
 */
import type { XRConfig } from "../config/config.ts";
import type { Provider } from "../core/types.ts";
import { registry } from "./registry.ts";
import { RoutingService } from "../intelligence/routing-service.ts";
import { PRESETS } from "./presets.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";
import {
  AnthropicProvider,
  GoogleProvider,
  MistralProvider,
  CohereProvider,
  BedrockProvider,
  CerebrasProvider,
} from "./native/index.ts";
import { getSecret } from "../security/secrets.ts";
import { setConfiguredRequestTimeout } from "./request-guard.ts";

export type CostTier = "free" | "cheap" | "premium" | "enterprise";

export type { ProviderPreset } from "./presets.ts";
export { PRESETS } from "./presets.ts";

/**
 * One narrowing point for provider-map overrides (A-6 seam).
 * `config.providers` is a zod-passthrough object: arbitrary ids are typed
 * `unknown`, so callers previously silenced access with `as any` and then
 * trusted the result blindly. Here the entry is narrowed to the only shape
 * this factory consumes — with an actual runtime type check.
 */
function providerOverrideBaseUrl(config: XRConfig, id: string): string | undefined {
  const entry = config.providers[id] as { baseUrl?: unknown } | undefined;
  return typeof entry?.baseUrl === "string" ? entry.baseUrl : undefined;
}

// ── Register built-in presets ────────────────────────────────────────────────

function registerBuiltins(): void {
  // Local providers (OpenAI-compatible)
  const localPresets = ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"];
  for (const id of localPresets) {
    const preset = PRESETS[id];
    if (!preset) continue;
    registry.register(preset, (config, model, _preset) => {
      // localModels.runtimes is fully typed in the schema; providers-map
      // entries go through the validated narrowing helper.
      const cfgRuntime = config.localModels.runtimes?.[id];
      return new OpenAICompatProvider({
        id: preset.id,
        label: preset.label,
        baseUrl: cfgRuntime?.baseUrl ?? providerOverrideBaseUrl(config, id) ?? preset.baseUrl!,
        model,
        apiKeyEnv: preset.apiKeyEnv,
      });
    });
  }

  // Hosted providers (OpenAI-compatible)
  const openaiCompatHosted = [
    "groq",
    "deepseek",
    "openrouter",
    "together",
    "fireworks",
    "sambanova",
    "xai",
    "perplexity",
    "huggingface",
    "cerebras",
  ];
  for (const id of openaiCompatHosted) {
    const preset = PRESETS[id];
    if (!preset) continue;
    registry.register(preset, (config, model, _preset) => {
      const baseUrl = providerOverrideBaseUrl(config, id) ?? preset.baseUrl!;
      return new OpenAICompatProvider({
        id: preset.id,
        label: preset.label,
        baseUrl,
        model,
        apiKeyEnv: preset.apiKeyEnv,
      });
    });
  }

  // Native providers (non-OpenAI-compatible)
  registry.register(
    PRESETS["anthropic"],
    (_config, model, preset) =>
      new AnthropicProvider({ model, apiKeyEnv: preset.apiKeyEnv }),
  );
  registry.register(
    PRESETS["google"],
    (_config, model, preset) =>
      new GoogleProvider({ model, apiKeyEnv: preset.apiKeyEnv }),
  );
  registry.register(
    PRESETS["mistral"],
    (_config, model, preset) =>
      new MistralProvider({ model, apiKeyEnv: preset.apiKeyEnv }),
  );
  registry.register(
    PRESETS["cohere"],
    (_config, model, preset) =>
      new CohereProvider({ model, apiKeyEnv: preset.apiKeyEnv }),
  );
  registry.register(
    PRESETS["bedrock"],
    (_config, model, _preset) => new BedrockProvider({ model }),
  );
  registry.register(
    PRESETS["openai"],
    (config, model, preset) => {
      const baseUrl = providerOverrideBaseUrl(config, "openai") ?? preset.baseUrl!;
      return new OpenAICompatProvider({
        id: preset.id,
        label: preset.label,
        baseUrl,
        model,
        apiKeyEnv: preset.apiKeyEnv,
      });
    },
  );
}

registerBuiltins();

// ── Factory functions ────────────────────────────────────────────────────────

export function buildProvider(
  config: XRConfig,
  override?: {
    provider?: string;
    model?: string;
    strategy?: import("../intelligence/routing-service.ts").RoutingStrategy;
    requirements?: Partial<import("../intelligence/types.ts").TaskRequirements>;
    mode?: import("../intelligence/types.ts").RoutingMode;
  },
): Provider {
  // GAP-001 — publish the configured request ceiling before any adapter is
  // built, so the guard's default reflects the user's config rather than only
  // the compiled-in fallback.
  setConfiguredRequestTimeout(config.providerEngine?.requestTimeoutMs);
  const router = new RoutingService(config);
  return router.resolve(override);
}

/** XR 4.4 — resolve provider + routing decision (for diagnostics / durable records). */
export function buildProviderWithDecision(
  config: XRConfig,
  override?: {
    provider?: string;
    model?: string;
    strategy?: import("../intelligence/routing-service.ts").RoutingStrategy;
    requirements?: Partial<import("../intelligence/types.ts").TaskRequirements>;
    mode?: import("../intelligence/types.ts").RoutingMode;
  },
) {
  const router = new RoutingService(config);
  return router.resolveWithDecision(override);
}

/** List all known provider IDs (built-in only). */
export function knownProviders(): string[] {
  return Object.keys(PRESETS);
}

/** List providers by cost tier. */
export function providersByTier(
  tier: CostTier,
): typeof PRESETS[string][] {
  return Object.values(PRESETS).filter((p) => p.tier === tier);
}

/** Get the best FREE provider that's currently configured/available. */
export function suggestFreeProvider(config: XRConfig): string {
  // Local first: zero cost, no key needed
  for (const id of ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"]) {
    const preset = PRESETS[id];
    if (preset && preset.kind === "local") return id;
  }
  // Free hosted tiers
  for (const id of ["groq", "google", "deepseek", "cerebras"]) {
    const preset = PRESETS[id];
    if (preset?.apiKeyEnv && (process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv))) {
      return id;
    }
  }
  return "ollama";
}

/** Get a display-friendly list of all providers. */
export function providerList(): string {
  return Object.entries(PRESETS)
    .map(([k, p]) => {
      const tierBadge =
        p.tier === "free"
          ? "🆓"
          : p.tier === "cheap"
          ? "💰"
          : p.tier === "premium"
          ? "💎"
          : "🏢";
      const kindBadge = p.kind === "local" ? "🏠" : "☁️";
      return `  ${k.padEnd(12)} ${tierBadge} ${kindBadge} ${p.label.padEnd(28)} default: ${p.defaultModel}`;
    })
    .join("\n");
}
