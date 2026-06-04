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
import type { Message, ModelTurn, Provider, Tool } from "../../core/types.ts";
import { repairToTurn } from "../../reliability/repair.ts";

interface CerebrasOptions {
  model?: string;
  apiKeyEnv?: string;
}

export class CerebrasProvider implements Provider {
  id = "cerebras";
  label = "Cerebras (Fastest AI)";
  private apiKey: string;
  private model: string;
  private baseUrl = "https://api.cerebras.ai/v1";

  constructor(opts: CerebrasOptions = {}) {
    const envKey = opts.apiKeyEnv ?? "CEREBRAS_API_KEY";
    this.apiKey = process.env[envKey] ?? "";
    this.model = opts.model ?? "cerebras/csm-8b";
  }

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
    const apiKey = this.apiKey;
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
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

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

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const apiKey = this.apiKey;
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
