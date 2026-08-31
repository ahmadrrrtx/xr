/**
 * XR — native OpenAI-family tool schemas (Phase 1 · Step 4).
 *
 * Shared across the OpenAI-compat transport AND the native OpenAI-family
 * adapters so one shape is used everywhere function calling is native. The
 * envelope (JSON-in-content) protocol is retained ONLY for local/weak-model
 * profiles that do not declare `functionCalling`.
 *
 * These are OpenAI-function-shaped (`{"type":"function","function":{...}}`),
 * which every OpenAI-compatible host (OpenAI, Groq, DeepSeek, OpenRouter,
 * Together, Fireworks, xAI, Perplexity, SambaNova, Ollama, LM Studio, Jan,
 * vLLM, LocalAI, …) understands. The shape must match the `Tool.parameters`
 * JSON Schema in the registry.
 */
import type { Tool } from "../../core/types.ts";

/** An OpenAI-style `tools` array entry. */
export interface OpenAIToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Convert XR's internal `Tool[]` into OpenAI function-calling `tools`.
 * Provider-agnostic: the same spec is sent to every native OpenAI-family host.
 */
export function toOpenAITools(tools: Tool[]): OpenAIToolSpec[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.parameters ?? { type: "object", properties: {} }) as Record<string, unknown>,
    },
  }));
}

/**
 * Parse an OpenAI non-streaming `message.tool_calls` array (or a single
 * streaming `delta.tool_calls` entry) into XR `ToolCall[]`.
 *
 * `message.tool_calls` uses `function.arguments` (JSON string). Streaming
 * deltas may arrive split across chunks (arguments concatenated — callers
 * accumulate; here we parse one complete entry). A JSON-string `arguments`
 * that fails to parse becomes `{}` (never throws — the model's tool args are
 * untrusted data, hardened downstream).
 */
export function parseOpenAIToolCalls(
  raw: unknown,
): Array<{ tool: string; args: Record<string, unknown> }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ tool: string; args: Record<string, unknown> }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const fn = (entry as any).function;
    if (!fn || typeof fn.name !== "string" || !fn.name) continue;
    let args: Record<string, unknown> = {};
    if (typeof fn.arguments === "string" && fn.arguments.trim() !== "") {
      try {
        const parsed = JSON.parse(fn.arguments);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
      } catch {
        args = {};
      }
    } else if (fn.arguments && typeof fn.arguments === "object") {
      args = fn.arguments as Record<string, unknown>;
    }
    out.push({ tool: fn.name, args });
  }
  return out;
}

/** Heuristic: is `x` a chat-completion object (has `choices`)? */
export function isChatCompletionObject(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  return Array.isArray((x as any).choices);
}
