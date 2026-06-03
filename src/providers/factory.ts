/**
 * XR — build a Provider from config + a known registry of provider presets.
 * PURE BYOK: keys are read from env vars the USER sets. We ship none.
 */
import type { XRConfig } from "../config/config.ts";
import type { Provider } from "../core/types.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";

/** Built-in presets. base_url + which env var holds the key. */
const PRESETS: Record<
  string,
  { label: string; baseUrl: string; apiKeyEnv?: string }
> = {
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiKeyEnv: "GROQ_API_KEY" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  together: { label: "Together", baseUrl: "https://api.together.xyz/v1", apiKeyEnv: "TOGETHER_API_KEY" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
};

export function buildProvider(
  config: XRConfig,
  override?: { provider?: string; model?: string },
): Provider {
  const id = override?.provider ?? config.defaults.provider;
  const model = override?.model ?? config.defaults.model;
  const preset = PRESETS[id];
  if (!preset) {
    throw new Error(
      `unknown provider "${id}". Known: ${Object.keys(PRESETS).join(", ")}`,
    );
  }
  // Allow config to override the ollama base url, etc.
  const cfgProvider = (config.providers as any)[id];
  const baseUrl = cfgProvider?.baseUrl ?? preset.baseUrl;

  return new OpenAICompatProvider({
    id,
    label: preset.label,
    baseUrl,
    model,
    apiKeyEnv: preset.apiKeyEnv,
  });
}

export function knownProviders(): string[] {
  return Object.keys(PRESETS);
}
