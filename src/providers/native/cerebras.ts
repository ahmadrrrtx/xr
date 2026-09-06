/**
 * XR — Native Cerebras Provider
 * 
 * Supports Cerebras CSM (Cloud Service Model) - fastest inference available.
 * 8B model at ~100 tokens/second - blazing fast.
 * 
 * API Docs: https://inference.cerebras.ai/
 * 
 * Cost: Has a free tier with generous limits.
 *       Great for fast, simple tasks where speed matters.
 */
import type { Message, ModelTurn, Provider, Tool, ChatOptions, ProviderStreamChunk } from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { normalizeProviderError } from "../errors.ts";
import { repairToTurn } from "../../reliability/repair.ts";
import { secretBroker } from "../../security/secret-broker.ts";

interface CerebrasOptions {
  model?: string;
  apiKeyEnv?: string;
}

export class CerebrasProvider implements Provider {
  id = "cerebras";
  label = "Cerebras (Fastest AI)";
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
  private baseUrl = "https://api.cerebras.ai/v1";

  constructor(opts: CerebrasOptions = {}) {
    const envKey = opts.apiKeyEnv ?? "CEREBRAS_API_KEY";
    this.apiKeyEnv = envKey;
    this.model = opts.model ?? "cerebras/csm-8b";
  }

  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const apiKey = (await secretBroker.get(this.apiKeyEnv)) ?? "";
    if (!apiKey) {
      throw new Error(
        `Cerebras API key not found. Set CEREBRAS_API_KEY in your environment.\n` +
        `Get your key at: https://inference.cerebras.ai/settings/api-keys`
      );
    }

    // Convert messages to Cerebras format
    const cerebrasMessages: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        cerebrasMessages.push({ role: "system", content: msg.content });
        continue;
      }

      if (msg.role === "tool") {
        cerebrasMessages.push({
          role: "user",
          content: `[tool:${msg.name}] ${msg.content}`,
        });
      } else if (msg.role === "assistant") {
        try {
          const parsed = JSON.parse(msg.content);
          cerebrasMessages.push({ role: "assistant", content: parsed.message ?? msg.content });
        } catch {
          cerebrasMessages.push({ role: "assistant", content: msg.content });
        }
      } else {
        cerebrasMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // Cerebras has function calling support
    const toolsList = tools.length > 0 ? tools.map(t => ({
      type: "function",
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
      messages: cerebrasMessages,
      max_tokens: 2048,
      temperature: 0.3,
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
          throw new Error(`Cerebras error: ${err.error?.message ?? `HTTP ${res.status}`}`);
        } catch (e) {
          if ((e as Error).message.includes("Cerebras")) throw e;
          throw new Error(`Cerebras ${res.status}: ${txt.slice(0, 200)}`);
        }
      }

      const json: any = await res.json();
      const choice = json.choices?.[0];
      
      let message = choice?.message?.content ?? "";
      const toolCalls: { tool: string; args: Record<string, unknown> }[] = [];

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
      return { ok: false, detail: "CEREBRAS_API_KEY not set" };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      const latency = Date.now() - start;

      if (res.ok) {
        return { ok: true, latencyMs: latency, detail: this.model + " (fast ⚡)" };
      }

      return { ok: false, detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
