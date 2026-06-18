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
 */
import type { Message, ModelTurn, Provider, Tool } from "../core/types.ts";
import { buildEnvelopeGBNF } from "../reliability/grammar.ts";
import { repairToTurn } from "../reliability/repair.ts";
import { profileFor, type ModelProfile } from "../reliability/profiles.ts";

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

  async chat(messages: Message[], tools: Tool[]): Promise<ModelTurn> {
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
      stream: false,
    };

    if (this.profile.structure === "grammar") {
      body.format = "json";
      (body as any).options = {
        grammar: buildEnvelopeGBNF(tools.map((t) => t.name)),
        temperature: 0,
      };
    } else if (this.profile.structure === "json_mode") {
      body.response_format = { type: "json_object" };
    }
    if (this.profile.disableThinking) {
      (body as any).options = {
        ...(body as any).options,
        think: false,
      };
      (body as any).reasoning = { effort: "none" };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
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
