/**
 * XR — per-model capability profiles.
 * Detects the model and tunes how we ask for tool calls:
 *   - grammar   : pass GBNF (local llama.cpp/Ollama) → 100% valid
 *   - json_mode : provider-native JSON object mode (OpenAI/Groq/Gemini)
 *   - text      : last resort, rely on prompt + auto-repair
 * Also flags quirks (e.g. Gemma routes JSON to reasoning unless thinking off).
 */

export interface ModelProfile {
  /** How to enforce structure. */
  structure: "grammar" | "json_mode" | "text";
  /** Disable "thinking"/reasoning so JSON isn't swallowed (Gemma, some Qwen). */
  disableThinking: boolean;
}

/**
 * @param providerId  e.g. "ollama", "groq"
 * @param model       model id string
 */
export function profileFor(providerId: string, model: string): ModelProfile {
  const m = model.toLowerCase();

  // Local providers → grammar path (strongest guarantee).
  if (providerId === "ollama") {
    return {
      structure: "grammar",
      disableThinking: /gemma|qwen3|deepseek-r1|reason/.test(m),
    };
  }

  // Cloud providers that support native JSON object mode.
  if (["openai", "groq", "deepseek", "together", "openrouter"].includes(providerId)) {
    return { structure: "json_mode", disableThinking: false };
  }

  // Unknown → safest portable path.
  return { structure: "text", disableThinking: false };
}
