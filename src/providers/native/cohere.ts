import { outputLimit, usagePair } from "./history.ts";
/**
 * XR — Native Cohere Provider
 * 
 * Supports ALL Cohere models: Command R+, Command R, Command, etc.
 * Great for long context tasks (up to 128K tokens).
 * 
 * API Docs: https://docs.cohere.com/
 * 
 * Cost: Has free tier (1000 API calls/month on trial).
 *       Command R+ is excellent for RAG and long documents.
 */
import type { Message, ModelTurn, Provider, Tool, ChatOptions, ProviderStreamChunk } from "../../core/types.ts";
import { guardedRequest, ProviderAbortError } from "../request-guard.ts";
import { normalizeProviderError } from "../errors.ts";
import { repairToTurn } from "../../reliability/repair.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";

interface CohereOptions {
  model?: string;
  apiKeyEnv?: string;
}

export class CohereProvider implements Provider {
  id = "cohere";
  label = "Cohere";
  private apiKeyEnv: string;
  private model: string;
  private get apiKey(): string {
    return secretBrokerSync(this.apiKeyEnv) ?? "";
  }

  get modelId(): string {
    return this.model;
  }
  private baseUrl = "https://api.cohere.ai/v2";

  constructor(opts: CohereOptions = {}) {
    this.apiKeyEnv = opts.apiKeyEnv ?? "COHERE_API_KEY";
    this.model = opts.model ?? "command-r-plus-08-2024";
  }

  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new Error(
        `Cohere API key not found. Set COHERE_API_KEY in your environment.\n` +
        `Get your key at: https://dashboard.cohere.com/api-keys`
      );
    }

    // Convert messages to Cohere format
    const cohereMessages: Array<{ role: string; content: string | Array<{ type: string; text?: string; tool?: { name: string; input: Record<string, unknown> }; tool_result?: { name: string; json: Record<string, unknown> } }> }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        cohereMessages.push({ role: "system", content: msg.content });
        continue;
      }

      if (msg.role === "tool") {
        cohereMessages.push({
          role: "tool",
          content: [{
            type: "tool_result",
            tool_result: {
              name: msg.name ?? "unknown",
              json: { output: msg.content },
            },
          }],
        });
      } else if (msg.role === "assistant") {
        // Cohere uses tool_calls format
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            const content: Array<{ type: string; text?: string; tool?: { name: string; input: Record<string, unknown> } }> = [];
            
            if (parsed.message) {
              content.push({ type: "text", text: parsed.message });
            }
            
            for (const tc of parsed.tool_calls) {
              content.push({
                type: "tool_call",
                tool: { name: tc.tool, input: tc.args ?? {} },
              });
            }
            
            cohereMessages.push({ role: "assistant", content });
          } else {
            cohereMessages.push({ role: "assistant", content: parsed.message ?? msg.content });
          }
        } catch {
          cohereMessages.push({ role: "assistant", content: msg.content });
        }
      } else {
        cohereMessages.push({ role: msg.role === "user" ? "user" : "user", content: msg.content });
      }
    }

    // Build tools for Cohere (Agents API)
    const toolsList = tools.length > 0 ? tools.map(t => ({
      name: t.name,
      description: t.description,
      parameter: {
        type: "object",
        properties: t.parameters,
        required: [],
      },
    })) : undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: outputLimit(options?.maxOutputTokens),
      messages: cohereMessages,
      temperature: 0.3,
    };

    if (toolsList) {
      body.tools = toolsList;
    }

    try {
      // GAP-001 — bounded + cancellable (was: no signal, no timeout).
      const res = await guardedRequest(this.id, options, (signal) =>
        fetch(`${this.baseUrl}/chat`, {
          method: "POST", redirect: "error",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "X-Client-Name": "xr-agent",
          },
          body: JSON.stringify(body),
          signal,
        }),
      );

      if (!res.ok) { await res.body?.cancel(); throw new Error(`${this.id} API HTTP ${res.status}`); }

      const json: any = await res.json();
      
      let message = json.text ?? "";
      const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

      // Check for tool calls in response
      if (json.tool_calls) {
        for (const tc of json.tool_calls) {
          if (tc.name) {
            toolCalls.push({
              tool: tc.name,
              args: tc.parameters ?? tc.input ?? {},
            });
          }
        }
      }

      // Also check message content blocks
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === "tool_use" && block.name) {
            toolCalls.push({
              tool: block.name,
              args: block.input ?? {},
            });
          }
          if (block.type === "text" && block.text) {
            message = block.text;
          }
        }
      }

      const usage = json.meta?.tokens
        ? usagePair(json.meta.tokens.inputTokens, json.meta.tokens.outputTokens)
        : undefined;

      return {
        message,
        toolCalls,
        done: toolCalls.length === 0,
        usage,
      };
    } catch (e) {
      if (e instanceof ProviderAbortError) throw e;
      // No hidden API-version/account/request fallback. A distinct transport
      // must be explicitly configured and metered as its own attempt.
      throw normalizeProviderError(e, this.id, this.model);
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
    const apiKey = this.apiKey;
    if (!apiKey) {
      return { ok: false, detail: "COHERE_API_KEY not set" };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET", redirect: "error",
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
