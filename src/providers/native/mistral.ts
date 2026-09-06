/**
 * XR — Native Mistral AI Provider
 * 
 * Supports ALL Mistral models: Large, Medium, Small, Nemo, Codestral, etc.
 * Direct API with full tool-calling support.
 * 
 * API Docs: https://docs.mistral.ai/api/
 * 
 * Cost: NOT free, but very affordable. $2-4/M tokens.
 *       Great for coding tasks (Codestral is excellent).
 */
import type { Message, ModelTurn, Provider, Tool, ChatOptions, ProviderStreamChunk } from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { normalizeProviderError } from "../errors.ts";
import { repairToTurn } from "../../reliability/repair.ts";
import { secretBroker } from "../../security/secret-broker.ts";

interface MistralOptions {
  model?: string;
  apiKeyEnv?: string;
}

export class MistralProvider implements Provider {
  id = "mistral";
  label = "Mistral AI";
  /**
   * Phase 8 · F-24 — the credential is NOT held on the instance. `apiKeyEnv`
   * is the NAME of the secret; the value is resolved per request through the
   * broker, so a long-lived provider object never carries key material and a
   * heap dump of it yields nothing.
   */
  private apiKeyEnv: string;
  private model: string;

  get modelId(): string {
    return this.model;
  }
  private baseUrl = "https://api.mistral.ai/v1";

  // Model configurations
  private static readonly MODELS: Record<string, {
    supportsFunctionCalling?: boolean;
    supportsVision?: boolean;
    maxTokens?: number;
    isCodingModel?: boolean;
  }> = {
    "mistral-large-latest": { supportsFunctionCalling: true, maxTokens: 32768 },
    "mistral-medium-latest": { supportsFunctionCalling: true, maxTokens: 32768 },
    "mistral-small-latest": { supportsFunctionCalling: true, maxTokens: 32768 },
    "codestral-latest": { supportsFunctionCalling: true, maxTokens: 32768, isCodingModel: true },
    "open-mistral-7b": { supportsFunctionCalling: false, maxTokens: 32768 },
    "open-mixtral-8x7b": { supportsFunctionCalling: false, maxTokens: 32768 },
    "open-mixtral-8x22b": { supportsFunctionCalling: false, maxTokens: 65536 },
  };

  constructor(opts: MistralOptions = {}) {
    const envKey = opts.apiKeyEnv ?? "MISTRAL_API_KEY";
    this.apiKeyEnv = envKey;
    this.model = opts.model ?? "mistral-small-latest";
  }

  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const apiKey = (await secretBroker.get(this.apiKeyEnv)) ?? "";
    if (!apiKey) {
      throw new Error(
        `Mistral API key not found. Set MISTRAL_API_KEY in your environment.\n` +
        `Get your key at: https://console.mistral.ai/api-key/`
      );
    }

    // Convert to Mistral format
    const mistralMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        mistralMessages.push({ role: "system", content: msg.content });
        continue;
      }

      if (msg.role === "tool") {
        mistralMessages.push({
          role: "tool",
          content: `[tool:${msg.name}] ${msg.content}`,
        });
      } else if (msg.role === "assistant") {
        // Check for JSON tool call format
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            // Send as regular message with tool call info in content
            const toolInfo = parsed.tool_calls.map((tc: any) => 
              `[CALL ${tc.tool} ${JSON.stringify(tc.args ?? {})}]`
            ).join("\n");
            
            mistralMessages.push({
              role: "assistant",
              content: parsed.message || toolInfo,
            });
          } else {
            mistralMessages.push({ role: "assistant", content: parsed.message ?? msg.content });
          }
        } catch {
          mistralMessages.push({ role: "assistant", content: msg.content });
        }
      } else {
        mistralMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Build tools for Mistral (function calling)
    const toolsList = tools.length > 0 ? tools.map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: t.parameters,
        },
      },
    })) : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: mistralMessages,
      temperature: 0.3,
      max_tokens: 2048,
    };

    if (toolsList) {
      body.tools = toolsList;
    }

    try {
      // GAP-001 — bounded + cancellable (was: no signal, no timeout).
      const res = await guardedRequest(this.id, options, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        }),
      );

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        try {
          const err = JSON.parse(txt);
          throw new Error(`Mistral API error: ${err.error?.message ?? `HTTP ${res.status}`}`);
        } catch (e) {
          if ((e as Error).message.includes("Mistral")) throw e;
          throw new Error(`Mistral ${res.status}: ${txt.slice(0, 200)}`);
        }
      }

      const json: any = await res.json();
      const choice = json.choices?.[0];
      
      let message = "";
      const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

      // Check for tool calls in the response
      const delta = choice?.delta ?? choice?.message ?? {};
      
      if (delta.content) {
        message = delta.content;
      }

      // Check tool_calls field
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.function) {
            toolCalls.push({
              tool: tc.function.name,
              args: typeof tc.function.arguments === "string" 
                ? JSON.parse(tc.function.arguments) 
                : (tc.function.arguments ?? {}),
            });
          }
        }
      }

      const usage = json.usage
        ? { inTokens: json.usage.prompt_tokens ?? 0, outTokens: json.usage.completion_tokens ?? 0 }
        : undefined;

      return {
        message,
        toolCalls,
        done: toolCalls.length === 0,
        usage,
      };
    } catch (e) {
      throw e;
    }
  }

  async *chatStream(
    messages: import("../../core/types.ts").Message[],
    tools: import("../../core/types.ts").Tool[],
    options?: import("../../core/types.ts").ChatOptions,
  ): AsyncGenerator<ProviderStreamChunk> {
    try {
      const turn = await this.chat(messages, tools, options);
      if (turn.message) {
        yield { text: turn.message, providerId: this.id, model: this.model };
      }
      for (const tc of turn.toolCalls ?? []) {
        yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: this.id, model: this.model };
      }
      yield { usage: turn.usage, finish: true, providerId: this.id, model: this.model };
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.model);
    }
  }

  
  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const apiKey = (await secretBroker.get(this.apiKeyEnv)) ?? "";
    if (!apiKey) {
      return { ok: false, detail: "MISTRAL_API_KEY not set" };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      const latency = Date.now() - start;

      if (res.ok) {
        return { ok: true, latencyMs: latency, detail: this.model };
      }

      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
