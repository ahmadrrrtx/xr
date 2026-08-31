/**
 * XR — Provider Factory
 * Facade over the Universal Provider Engine. Backward-compatible exports.
 * PURE BYOK: keys are read from env vars the USER sets. We ship none.
 *
 * All presets are registered into the ProviderRegistry at module load time.
 * New presets should be added in presets.ts, not here.
 *
 * Phase 04 — Backward-compatible wrapper over ProviderGateway.
 * When XR_PROVIDER_GATEWAY=0, falls back to direct registry path.
 */

import type { XRConfig } from "../config/config.ts";
import type { Provider } from "../core/types.ts";
import { registry } from "./registry.ts";
import { resolveProvider, resolveProviderSync, type ResolveOptions } from "./resolver.ts";
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

function providerOverrideBaseUrl(config: XRConfig, id: string): string | undefined {
  const entry = config.providers[id] as { baseUrl?: unknown } | undefined;
  return typeof entry?.baseUrl === "string" ? entry.baseUrl : undefined;
}

// ── Register built-in presets ────────────────────────────────────────────────

function registerBuiltins(): void {
  const localPresets = ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"];
  for (const id of localPresets) {
    const preset = PRESETS[id];
    if (!preset) continue;
    registry.register(preset, (config, model, _preset) => {
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
//
// Phase 1 · Step 5 — these are now thin delegating aliases over the single
// provider resolver (src/providers/resolver.ts). The resolver is the ONLY owner
// of custom-provider registration and capability association. Kept as aliases
// so existing in-tree call sites compile; deprecated in 2.0.

export function buildProvider(config: XRConfig, override?: ResolveOptions): Provider {
  return resolveProviderSync(config, override);
}

export function buildProviderWithDecision(config: XRConfig, override?: ResolveOptions) {
  return resolveProvider(config, override);
}

export function knownProviders(): string[] {
  // Phase 04 — authoritative list is registry.list() when available, but PRESETS is stable fallback
  // Custom providers are included via registry.syncCustom in service layer.
  try {
    const list = registry.list();
    if (list.length > 0) return list.map((p) => p.id);
  } catch {}
  return Object.keys(PRESETS);
}

export function providersByTier(
  tier: CostTier,
): typeof PRESETS[string][] {
  return Object.values(PRESETS).filter((p) => p.tier === tier);
}

export function suggestFreeProvider(config: XRConfig): string {
  for (const id of ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"]) {
    const preset = PRESETS[id];
    if (preset && preset.kind === "local") return id;
  }
  for (const id of ["groq", "google", "deepseek", "cerebras"]) {
    const preset = PRESETS[id];
    if (preset?.apiKeyEnv && (process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv))) {
      return id;
    }
  }
  return "ollama";
}

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
