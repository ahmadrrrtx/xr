/**
 * XR — per-model capability profiles.
 * Detects the model and tunes how we ask for tool calls:
 *   - grammar   : pass GBNF (local llama.cpp/Ollama) → 100% valid
 *   - json_mode : provider-native JSON object mode (OpenAI/Groq/Gemini/Claude)
 *   - text      : last resort, rely on prompt + auto-repair
 * Also flags quirks (e.g. Gemma routes JSON to reasoning unless thinking off).
 * 
 * Updated for v0.2 with ALL major providers:
 * - Local: Ollama (grammar)
 * - Free: Groq, Google Gemini, DeepSeek (json_mode)
 * - Premium: Anthropic Claude, OpenAI GPT, Mistral, Cohere (json_mode)
 * - Cheap: Together, OpenRouter, Cerebras, AWS Bedrock
 */
export interface ProviderProfile {
  /** How to enforce structure. */
  structure: "grammar" | "json_mode" | "text";
  /** Disable "thinking"/reasoning so JSON isn't swallowed (Gemma, some Qwen, DeepSeek R1). */
  disableThinking: boolean;
  /** Supports vision (image input) */
  supportsVision?: boolean;
  /** Default max tokens for this provider */
  defaultMaxTokens?: number;
}

/** Back-compat alias used by the provider adapters. */
export type ModelProfile = ProviderProfile;

/**
 * Get the capability profile for a provider/model combination.
 * @param providerId  e.g. "anthropic", "groq", "ollama", "google"
 * @param model       model id string
 */
export function profileFor(providerId: string, model: string): ProviderProfile {
  const m = model.toLowerCase();

  // ── LOCAL PROVIDERS → Grammar path (strongest guarantee) ──────────────────
  if (providerId === "ollama") {
    return {
      structure: "grammar",
      disableThinking: /gemma|qwen3|deepseek-r1|reason|phi-3/i.test(m),
      supportsVision: /vision|llava|bakllava/i.test(m),
      defaultMaxTokens: 2048,
    };
  }

  // ── ANTHROPIC CLAUDE → Native tool calling ─────────────────────────────────
  if (providerId === "anthropic") {
    return {
      structure: "json_mode", // We use Anthropic's native tool_use format
      disableThinking: false,
      supportsVision: true,
      defaultMaxTokens: 4096,
    };
  }

  // ── GOOGLE GEMINI → Function calling (native) ──────────────────────────────
  if (providerId === "google") {
    return {
      structure: "json_mode", // Uses Gemini's function_calling format
      disableThinking: false,
      supportsVision: true,
      defaultMaxTokens: 8192, // Gemini supports large outputs
    };
  }

  // ── MISTRAL → Tool calling support ─────────────────────────────────────────
  if (providerId === "mistral") {
    return {
      structure: "json_mode",
      disableThinking: false,
      supportsVision: false,
      defaultMaxTokens: 32768,
    };
  }

  // ── COHERE → Tool use format ───────────────────────────────────────────────
  if (providerId === "cohere") {
    return {
      structure: "json_mode",
      disableThinking: false,
      supportsVision: false,
      defaultMaxTokens: 32768, // Command R+ has 128K context
    };
  }

  // ── CEREBRAS → Tool calling (fast!) ────────────────────────────────────────
  if (providerId === "cerebras") {
    return {
      structure: "json_mode",
      disableThinking: false,
      supportsVision: false,
      defaultMaxTokens: 2048,
    };
  }

  // ── OPENAI-COMPATIBLE CLOUD PROVIDERS → JSON mode ──────────────────────────
  if (["openai", "groq", "deepseek", "together", "openrouter", "bedrock"].includes(providerId)) {
    const isDeepSeekR1 = m.includes("deepseek-r1") || m.includes("r1");
    const isReasoningModel = /reason|thinking|chain/i.test(m);
    
    return {
      structure: "json_mode",
      // DeepSeek R1 and reasoning models need thinking disabled for reliable JSON
      disableThinking: isDeepSeekR1 || isReasoningModel,
      supportsVision: /vision|gpt-4-vision|4o-mini/i.test(m) && providerId === "openai",
      defaultMaxTokens: providerId === "groq" ? 4096 : 2048,
    };
  }

  // ── UNKNOWN → Safest portable path ─────────────────────────────────────────
  return { structure: "text", disableThinking: false, defaultMaxTokens: 2048 };
}

/**
 * Get the system prompt tailoring for a provider/model.
 * Different providers need different prompting strategies.
 */
export function systemPromptTweak(providerId: string, model: string): string {
  const m = model.toLowerCase();

  if (providerId === "anthropic") {
    return "You are Claude, an AI assistant by Anthropic. ";
  }

  if (providerId === "google") {
    return "You are Gemini, an AI assistant by Google. ";
  }

  if (providerId === "ollama") {
    if (/qwen/i.test(m)) {
      return "You are Qwen, a helpful AI assistant. ";
    }
    if (/llama/i.test(m)) {
      return "You are Llama, an AI assistant. ";
    }
    return "";
  }

  if (providerId === "groq") {
    return "You are a fast, helpful AI assistant. ";
  }

  if (providerId === "deepseek") {
    if (m.includes("coder")) {
      return "You are DeepSeek Coder, an expert programming assistant. ";
    }
    return "You are DeepSeek Chat, a helpful AI assistant. ";
  }

  if (providerId === "mistral") {
    if (m.includes("codestral")) {
      return "You are Codestral, an expert coding assistant by Mistral AI. ";
    }
    return "You are Mistral AI's assistant. ";
  }

  return ""; // Default behavior
}

/** Known reasoning/thinking models that need special handling */
export const THINKING_MODELS: Record<string, string[]> = {
  anthropic: ["claude-3.7-sonnet", "claude-3.7-opus"],
  deepseek: ["deepseek-r1", "deepseek-r1-671b"],
  openai: ["o1-preview", "o1-mini", "o3"],
  google: ["gemini-2.0-flash-thinking"],
};

export function isThinkingModel(providerId: string, model: string): boolean {
  const models = THINKING_MODELS[providerId];
  if (!models) return false;
  const m = model.toLowerCase();
  return models.some(rm => m.includes(rm.toLowerCase()));
}
