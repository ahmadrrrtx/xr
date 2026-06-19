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
import { ProviderRouter } from "./routing.ts";
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

export type CostTier = "free" | "cheap" | "premium" | "enterprise";

export type { ProviderPreset } from "./presets.ts";
export { PRESETS } from "./presets.ts";

// ── Register built-in presets ────────────────────────────────────────────────

function registerBuiltins(): void {
  // Local providers (OpenAI-compatible)
  const localPresets = ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"];
  for (const id of localPresets) {
    const preset = PRESETS[id];
    if (!preset) continue;
    registry.register(preset, (config, model, _preset) => {
      const cfgProvider = (config.providers as any)?.[id];
      const cfgRuntime = (config.localModels as any)?.runtimes?.[id];
      return new OpenAICompatProvider({
        id: preset.id,
        label: preset.label,
        baseUrl: cfgRuntime?.baseUrl ?? cfgProvider?.baseUrl ?? preset.baseUrl!,
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
      const cfgProvider = (config.providers as any)?.[id];
      const baseUrl = cfgProvider?.baseUrl ?? preset.baseUrl!;
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
      const cfgProvider = (config.providers as any)?.["openai"];
      const baseUrl = cfgProvider?.baseUrl ?? preset.baseUrl!;
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
  override?: { provider?: string; model?: string },
): Provider {
  const router = new ProviderRouter(config);
  return router.resolve(override);
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
