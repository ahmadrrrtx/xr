/**
 * XR — OpenAI-compatible provider adapter.
 * Works with Ollama, Groq, OpenAI, Together, OpenRouter, LM Studio, Jan,
 * LocalAI, vLLM, Fireworks, SambaNova, Perplexity, xAI, Hugging Face, and
 * any user-configured custom endpoint.
 *
 * PURE BYOK: the key comes from the user's environment, never from us.
 *
 * Phase 2/3: applies per-model capability profiles +
 *   - local models → GBNF grammar (Ollama `format`) for 100% valid tool calls.
 *   - cloud models → native JSON object mode
 *   - everything → deterministic auto-repair as a final safety net.
 *
 * Phase 04: Adds chatStream() via SSE, modelId exposure, listModels(), error normalization.
 */

import type { ChatOptions, Message, ModelTurn, Provider, Tool, ProviderStreamChunk } from "../core/types.ts";
import { guardedRequest } from "./request-guard.ts";
import { buildEnvelopeGBNF } from "../reliability/grammar.ts";
import { repairToTurn } from "../reliability/repair.ts";
import { profileFor, type ModelProfile } from "../reliability/profiles.ts";
import { normalizeProviderError } from "./errors.ts";

export interface OpenAICompatOptions {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatProvider implements Provider {
  id: string;
  label: string;
  protected baseUrl: string;
  protected model: string;
  protected apiKey?: string;
  protected extraHeaders: Record<string, string>;
  protected profile: ModelProfile;

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.apiKey =
      opts.apiKey ??
      (opts.apiKeyEnv ? process.env[opts.apiKeyEnv] : undefined);
    this.extraHeaders = opts.extraHeaders ?? {};
    this.profile = profileFor(opts.id, opts.model);
  }

  get modelId(): string {
    return this.model;
  }

  protected headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  protected systemEnvelope(tools: Tool[]): string {
    const toolDocs = tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description}\n  params: ${JSON.stringify(t.parameters)}`,
      )
      .join("\n");
    return [
      "You are XR, a careful, security-first AI agent.",
      "On each turn reply with ONLY a single JSON object, no prose, no markdown fences:",
      `{"message": string, "tool_calls": [{"tool": string, "args": object}], "done": boolean}`,
      "Set done=true and tool_calls=[] when the task is complete.",
      "Only use tools from this list:",
      toolDocs || "(no tools available)",
    ].join("\n");
  }

  protected buildChatBody(messages: Message[], tools: Tool[], stream: boolean): Record<string, unknown> {
    const sys: Message = {
      role: "system",
      content: this.systemEnvelope(tools),
    };
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [sys, ...messages].map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content:
          m.role === "tool"
            ? `[tool:${m.name}] ${m.content}`
            : m.content,
      })),
      temperature: 0,
      stream,
    };

    const options: Record<string, unknown> = {};
    if (this.profile.structure === "grammar") {
      (body as any).format = "json";
      options.grammar = buildEnvelopeGBNF(tools.map((t) => t.name));
      options.temperature = 0;
    } else if (this.profile.structure === "json_mode") {
      body.response_format = { type: "json_object" };
    }
    if (this.profile.disableThinking) {
      options.think = false;
      body.reasoning = { effort: "none" };
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    return body;
  }

  async chat(messages: Message[], tools: Tool[], chatOptions?: ChatOptions): Promise<ModelTurn> {
    const body = this.buildChatBody(messages, tools, false);

    try {
      const res = await guardedRequest(this.id, chatOptions, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        }),
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(
          `provider ${this.id} HTTP ${res.status}: ${txt.slice(0, 200)}`,
        );
      }
      const json: any = await res.json();
      const content: string =
        json?.choices?.[0]?.message?.content ?? "";
      const usage = json?.usage
        ? {
            inTokens: json.usage.prompt_tokens ?? 0,
            outTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined;

      return { ...repairToTurn(content), usage };
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.model);
    }
  }

  /**
   * Phase 04 — streaming via SSE.
   * Yields normalized ProviderStreamChunk {text, toolCall, usage, finish}
   * Preserves cancellation via signal.
   */
  async *chatStream(
    messages: Message[],
    tools: Tool[],
    chatOptions?: ChatOptions,
  ): AsyncGenerator<ProviderStreamChunk> {
    const body = this.buildChatBody(messages, tools, true);

    let res: Response;
    try {
      res = await guardedRequest(this.id, chatOptions, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            ...this.headers(),
            Accept: "text/event-stream",
          },
          body: JSON.stringify(body),
          signal,
        }),
      );
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.model);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw normalizeProviderError(
        new Error(`provider ${this.id} HTTP ${res.status}: ${txt.slice(0, 200)}`),
        this.id,
        this.model,
      );
    }

    if (!res.body) {
      // No body — fallback to non-streaming
      const json: any = await res.json().catch(() => ({}));
      const content: string = json?.choices?.[0]?.message?.content ?? "";
      const turn = repairToTurn(content);
      if (turn.message) {
        yield { text: turn.message, providerId: this.id, model: this.model };
      }
      for (const tc of turn.toolCalls) {
        yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: this.id, model: this.model };
      }
      yield { usage: turn.usage, finish: true, providerId: this.id, model: this.model };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    let usage: { inTokens: number; outTokens: number } | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        // Keep incomplete line in buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            // End of stream — parse full content for tool calls
            if (fullContent) {
              try {
                const turn = repairToTurn(fullContent);
                for (const tc of turn.toolCalls) {
                  yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: this.id, model: this.model };
                }
              } catch {
                // ignore parse errors, already yielded text
              }
            }
            yield { usage, finish: true, providerId: this.id, model: this.model };
            return;
          }
          try {
            const json: any = JSON.parse(data);
            // Handle usage
            if (json.usage) {
              usage = {
                inTokens: json.usage.prompt_tokens ?? 0,
                outTokens: json.usage.completion_tokens ?? 0,
              };
            }
            const choice = json.choices?.[0];
            if (!choice) continue;

            // Delta content (streaming)
            const delta = choice.delta ?? {};
            const content = delta.content ?? choice.message?.content ?? "";

            if (content) {
              fullContent += content;
              // Try to yield incremental text, but avoid yielding partial JSON envelope noise
              // We yield the raw content token
              yield { text: content, providerId: this.id, model: this.model };
            }

            // Tool call delta (for providers supporting native tool calling)
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const fn = tc.function;
                if (fn?.name) {
                  let args: Record<string, unknown> = {};
                  try {
                    args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : fn.arguments ?? {};
                  } catch {
                    args = {};
                  }
                  yield {
                    toolCall: { tool: fn.name, args },
                    providerId: this.id,
                    model: this.model,
                  };
                }
              }
            }
          } catch {
            // Skip malformed SSE line
            continue;
          }
        }
      }

      // Stream ended without [DONE] — finalize
      if (fullContent) {
        try {
          const turn = repairToTurn(fullContent);
          for (const tc of turn.toolCalls) {
            yield { toolCall: { tool: tc.tool, args: tc.args }, providerId: this.id, model: this.model };
          }
        } catch {
          // ignore
        }
      }
      yield { usage, finish: true, providerId: this.id, model: this.model };
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json: any = await res.json();
      if (Array.isArray(json.data)) {
        return json.data.map((m: any) => String(m.id ?? m.name ?? "")).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }

  async health(): Promise<{
    ok: boolean;
    latencyMs?: number;
    detail?: string;
  }> {
    const start = Date.now();

    // Probe 1: /models (most OpenAI-compatible servers expose it)
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        return {
          ok: true,
          latencyMs: Date.now() - start,
          detail: `models endpoint OK (HTTP ${res.status})`,
        };
      }
    } catch {
      // Fall through to probe 2
    }

    // Probe 2: minimal chat completion (covers LM Studio, vLLM, etc.)
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });
      return {
        ok: res.ok,
        latencyMs: Date.now() - start,
        detail: `chat probe ${res.ok ? "OK" : "failed"} (HTTP ${res.status})`,
      };
    } catch (e) {
      return {
        ok: false,
        detail: (e as Error).message,
      };
    }
  }
}

export { repairToTurn as parseTurn } from "../reliability/repair.ts";
