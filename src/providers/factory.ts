/**
 * XR — build a Provider from config + a known registry of provider presets.
 * PURE BYOK: keys are read from env vars the USER sets. We ship none.
 * 
 * Providers are organized by COST TIER:
 *   TIER 0 (FREE):    ollama (local) — $0, no API key needed
 *   TIER 1 (FREE):    groq, google (Gemini free tier), deepseek — $0 or very cheap
 *   TIER 2 (CHEAP):   together, openrouter, cerebras — cents per task
 *   TIER 3 (PREMIUM): openai, anthropic, mistral, cohere — quality at cost
 * 
 * Smart selection: when budget is tight, prefer free tiers.
 * The XR_HOME/config.json can override any preset.
 */
import type { XRConfig } from "../config/config.ts";
import type { Message, ModelTurn, Provider, Tool } from "../core/types.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";
import { 
  AnthropicProvider, 
  GoogleProvider, 
  MistralProvider, 
  CohereProvider, 
  BedrockProvider, 
  CerebrasProvider 
} from "./native/index.ts";

/** Cost tier for smart provider selection */
export type CostTier = "free" | "cheap" | "premium";

/** Provider preset with all metadata */
export interface ProviderPreset {
  id: string;
  label: string;
  tier: CostTier;
  /** For OpenAI-compatible providers */
  baseUrl?: string;
  /** Environment variable for the API key */
  apiKeyEnv?: string;
  /** Default model if none specified */
  defaultModel?: string;
  /** Known good models for this provider */
  knownModels?: string[];
  /** Is this provider always available (no key needed)? */
  local?: boolean;
}

/** All known provider presets */
export const PRESETS: Record<string, ProviderPreset> = {
  // ── TIER 0: FREE LOCAL ──────────────────────────────────────────────────────
  ollama: {
    id: "ollama",
    label: "Ollama (Local, FREE)",
    tier: "free",
    baseUrl: "http://localhost:11434/v1",
    apiKeyEnv: undefined,
    defaultModel: "qwen2.5:7b",
    knownModels: ["qwen2.5:3b", "phi3:mini", "qwen2.5:7b", "llama3.1:8b", "qwen2.5:14b", "qwen2.5:32b", "mistral:7b", "codellama:7b", "gemma2:9b"],
    local: true,
  },

  // ── TIER 1: FREE CLOUD ──────────────────────────────────────────────────────
  groq: {
    id: "groq",
    label: "Groq (Free Tier)",
    tier: "free",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    knownModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768", "gemma2-9b-it"],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek (Affordable)",
    tier: "free",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
    knownModels: ["deepseek-chat", "deepseek-coder"],
  },
  google: {
    id: "google",
    label: "Google Gemini (Free Tier)",
    tier: "free",
    apiKeyEnv: "GOOGLE_API_KEY",
    defaultModel: "gemini-1.5-flash",
    knownModels: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro", "gemini-pro", "gemini-pro-vision"],
  },

  // ── TIER 2: CHEAP ──────────────────────────────────────────────────────────
  together: {
    id: "together",
    label: "Together AI (Cheap)",
    tier: "cheap",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    knownModels: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-3.1-8B-Instruct-Turbo", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter (Aggregated)",
    tier: "cheap",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-3.5-sonnet",
    knownModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-2.0-flash-exp", "meta-llama/llama-3.3-70b-instruct"],
  },
  cerebras: {
    id: "cerebras",
    label: "Cerebras (Fastest)",
    tier: "cheap",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    defaultModel: "cerebras/csm-8b",
    knownModels: ["cerebras/csm-8b"],
  },
  mistral: {
    id: "mistral",
    label: "Mistral AI (Coding)",
    tier: "cheap",
    apiKeyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
    knownModels: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest", "open-mixtral-8x7b"],
  },

  // ── TIER 3: PREMIUM ────────────────────────────────────────────────────────
  openai: {
    id: "openai",
    label: "OpenAI (GPT-4/ChatGPT)",
    tier: "premium",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    knownModels: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-preview", "o1-mini"],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude (Best Quality)",
    tier: "premium",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-20241022",
    knownModels: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307"],
  },
  cohere: {
    id: "cohere",
    label: "Cohere (Long Context)",
    tier: "premium",
    apiKeyEnv: "COHERE_API_KEY",
    defaultModel: "command-r-plus-08-2024",
    knownModels: ["command-r-plus-08-2024", "command-r-08-2024", "command"],
  },
  bedrock: {
    id: "bedrock",
    label: "AWS Bedrock (Enterprise)",
    tier: "premium",
    apiKeyEnv: undefined, // Uses AWS SDK (IAM roles, env vars, etc.)
    defaultModel: "claude-3-sonnet",
    knownModels: ["claude-3-sonnet", "claude-3-opus", "claude-3-haiku", "llama-3-70b", "mistral-large", "command-r-plus"],
  },
};

/**
 * Build a Provider instance from config + optional override.
 * 
 * @param config - XR config object
 * @param override - Optional provider/model override
 * @returns Provider instance
 */
export function buildProvider(
  config: XRConfig,
  override?: { provider?: string; model?: string },
): Provider {
  const primaryId = override?.provider ?? config.defaults.provider;
  const primaryModel = override?.model ?? config.defaults.model;

  const localSelected = config.localModels?.selected ?? config.defaults.fallbackModel ?? PRESETS.ollama.defaultModel!;
  const localEnabled = Boolean(config.localModels?.enabled && localSelected);
  const routing = config.localModels?.routing ?? "hybrid";

  // Local-only means XR must work with no API keys. Force Ollama primary unless
  // the caller explicitly overrides provider/model for this one invocation.
  const effectivePrimaryId = !override?.provider && localEnabled && routing === "local-only" ? "ollama" : primaryId;
  const effectivePrimaryModel = !override?.model && effectivePrimaryId === "ollama" && localEnabled ? localSelected : primaryModel;

  const primary = buildSingleProvider(config, effectivePrimaryId, effectivePrimaryModel);

  // Deterministic fallback order:
  // 1. Explicit config fallback wins.
  // 2. Hybrid/cloud-first with local enabled falls back to selected Ollama model.
  // 3. Local-only has no fallback by default (avoid surprise cloud use).
  let fallbackId = config.defaults.fallbackProvider;
  let fallbackModel = config.defaults.fallbackModel;
  if (localEnabled && effectivePrimaryId !== "ollama" && (routing === "hybrid" || routing === "cloud-first")) {
    fallbackId = "ollama";
    fallbackModel = localSelected;
  }

  if (fallbackId && fallbackId !== effectivePrimaryId) {
    try {
      const fallback = buildSingleProvider(config, fallbackId, fallbackModel ?? effectivePrimaryModel);
      return new FallbackProvider(primary, fallback);
    } catch {
      return primary; // Fail gracefully: just use primary if fallback can't be built
    }
  }

  return primary;
}

/** Internal: build one specific provider without fallback logic. */
function buildSingleProvider(config: XRConfig, id: string, model: string): Provider {
  const preset = PRESETS[id];

  if (!preset) {
    const known = Object.keys(PRESETS).join(", ");
    throw new Error(
      `unknown provider "${id}". Known providers:\n` +
      Object.entries(PRESETS).map(([k, p]) => 
        `  ${k.padEnd(12)} — ${p.label} (${p.tier})`
      ).join("\n")
    );
  }

  // Native providers (use their own client classes)
  if (["anthropic", "google", "mistral", "cohere", "cerebras"].includes(id)) {
    return buildNativeProvider(id, model, preset);
  }

  // AWS Bedrock (special handling)
  if (id === "bedrock") {
    return new BedrockProvider({ model });
  }

  // OpenAI-compatible providers
  const cfgProvider = (config.providers as any)?.[id];
  const baseUrl = cfgProvider?.baseUrl ?? preset.baseUrl;

  if (!baseUrl) {
    throw new Error(`provider "${id}" requires a baseUrl configuration`);
  }

  return new OpenAICompatProvider({
    id,
    label: preset.label,
    baseUrl,
    model,
    apiKeyEnv: preset.apiKeyEnv,
  });
}

/** 
 * Wrapper that automatically tries a secondary provider if the primary fails.
 */
class FallbackProvider implements Provider {
  constructor(
    public primary: Provider,
    public fallback: Provider,
  ) {}

  get id() { return this.primary.id; }
  get label() { return `${this.primary.label} → fallback ${this.fallback.label}`; }

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    try {
      return await this.primary.chat(messages, tools);
    } catch (e) {
      // Don't log if it's just a health check or similar, but here it's a real chat.
      console.warn(`\x1b[33m! Primary provider (${this.primary.id}) failed: ${(e as Error).message}. Falling back to ${this.fallback.id}...\x1b[0m`);
      
      // Update the turn to indicate which provider was actually used if we had that in the type.
      // For now, we just proceed.
      return await this.fallback.chat(messages, tools);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const h = await this.primary.health();
    if (h.ok) return h;
    return await this.fallback.health();
  }
}

/** Build a native (non-OpenAI-compatible) provider */
function buildNativeProvider(id: string, model: string, preset: ProviderPreset): Provider {
  switch (id) {
    case "anthropic":
      return new AnthropicProvider({ model, apiKeyEnv: preset.apiKeyEnv });
    case "google":
      return new GoogleProvider({ model, apiKeyEnv: preset.apiKeyEnv });
    case "mistral":
      return new MistralProvider({ model, apiKeyEnv: preset.apiKeyEnv });
    case "cohere":
      return new CohereProvider({ model, apiKeyEnv: preset.apiKeyEnv });
    case "cerebras":
      return new CerebrasProvider({ model, apiKeyEnv: preset.apiKeyEnv });
    default:
      throw new Error(`native provider "${id}" not implemented`);
  }
}

/** List all known provider IDs */
export function knownProviders(): string[] {
  return Object.keys(PRESETS);
}

/** List providers by cost tier */
export function providersByTier(tier: CostTier): ProviderPreset[] {
  return Object.values(PRESETS).filter(p => p.tier === tier);
}

/** Get the best FREE provider that's currently configured/available */
export function suggestFreeProvider(config: XRConfig): string {
  const freeTier = providersByTier("free");
  
  // Priority: Ollama (local) > Groq > Google > DeepSeek
  for (const p of ["ollama", "groq", "google", "deepseek"]) {
    const preset = PRESETS[p];
    if (preset) {
      // Check if it's configured or local
      if (preset.local) return p;
      
      // Check if API key is set
      if (preset.apiKeyEnv && process.env[preset.apiKeyEnv]) {
        return p;
      }
    }
  }
  
  // Default to ollama even without key (will fail at runtime if not running)
  return "ollama";
}

/** Get a display-friendly list of all providers */
export function providerList(): string {
  return Object.entries(PRESETS).map(([k, p]) => {
    const tierBadge = p.tier === "free" ? "🆓" : p.tier === "cheap" ? "💰" : "💎";
    return `  ${k.padEnd(12)} ${tierBadge} ${p.label.padEnd(28)} default: ${p.defaultModel}`;
  }).join("\n");
}
