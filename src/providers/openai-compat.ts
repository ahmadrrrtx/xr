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
 *
 * Phase 1 · Turn Contract & Provider Integrity (F-02/M-02/M-03/M-06/F-03/F-04):
 *   - `chat()` parses native `message.tool_calls` when the provider declares
 *     `functionCalling` (or defensively whenever they are present).
 *   - `chatStream()` DETECTS a non-SSE body (a provider answering a
 *     `stream:true` request with a normal JSON completion) and consumes it
 *     once instead of discarding every line → no fake completion.
 *   - A turn with zero content AND zero tool calls surfaces an honest
 *     `status:"empty"/"undecodable"` + `done:false` (never a fabricated done).
 *   - `buildChatBody` sends native OpenAI `tools` + `tool_choice` for
 *     `functionCalling:true` profiles; the JSON-in-content envelope is kept
 *     only for local/weak profiles.
 */

import type { ChatOptions, Message, ModelTurn, Provider, Tool, ProviderStreamChunk, ProviderCapabilitiesFlags, ToolCall } from "../core/types.ts";
import { sseData } from "./sse.ts";
import { assistantCalls, assistantText, nativeBlocks, outputLimit, usagePair } from "./native/history.ts";
import { guardedRequest } from "./request-guard.ts";
import { secretBrokerSync } from "../security/secret-broker.ts";
import { buildEnvelopeGBNF } from "../reliability/grammar.ts";
import { repairToTurn } from "../reliability/repair.ts";
import { profileFor, type ModelProfile } from "../reliability/profiles.ts";
import { normalizeProviderError, malformedProviderResponseError } from "./errors.ts";
import { toOpenAITools, parseOpenAIToolCalls, isChatCompletionObject } from "./native/schemas.ts";

export interface OpenAICompatOptions {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  /** Declared transport capabilities (resolver-owned, Phase 1). */
  capabilities?: ProviderCapabilitiesFlags;
}

/** A non-SSE chat-completion body or stream chunk, normalized for parsing. */
interface NormalizedCompletion {
  content: string;
  toolCalls: ToolCall[];
  usage?: { inTokens: number; outTokens: number };
  finishReason?: string;
}

/** Read `message.tool_calls` (non-stream) AND `delta.tool_calls` (stream) and normalize. */
function normalizedCompletionOf(json: any, extra?: { usage?: { inTokens: number; outTokens: number } }): NormalizedCompletion {
  const choice = json?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const delta = choice.delta ?? {};
  let content: string = "";
  if (typeof delta.content === "string" && delta.content) content += delta.content;
  else if (typeof message.content === "string") content = message.content;
  const rawTcs = Array.isArray(message.tool_calls) ? message.tool_calls : Array.isArray(delta.tool_calls) ? delta.tool_calls : undefined;
  const toolCalls = rawTcs ? parseOpenAIToolCalls(rawTcs) : [];
  let usage = extra?.usage;
  if (!usage && json?.usage) {
    usage = {
      inTokens: json.usage.prompt_tokens ?? NaN,
      outTokens: json.usage.completion_tokens ?? NaN,
    };
  }
  if (usage) usage = usagePair(usage.inTokens, usage.outTokens);
  return { content, toolCalls, usage, finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined };
}

/** Compose a ModelTurn from a normalized completion (Phase 1 turn contract). */
function turnFromCompletion(c: NormalizedCompletion, defaultUsage?: { inTokens: number; outTokens: number }): ModelTurn {
  const usage = c.usage ?? defaultUsage;
  // Native tool calls present ⇒ model wants to act; content may be empty/null.
  if (c.toolCalls.length > 0) {
    return {
      message: c.content ?? "",
      toolCalls: c.toolCalls,
      done: false,
      status: "parsed",
      usage,
    };
  }
  // Otherwise the body follows the envelope protocol (or is a plain answer).
  const turn = repairToTurn(c.content ?? "");
  if (turn.status !== "parsed" && c.content.trim()) return { message: c.content, toolCalls: [], done: c.finishReason === "stop", status: "parsed", usage };
  return { ...turn, usage };
}

export class OpenAICompatProvider implements Provider {
  id: string;
  label: string;
  protected baseUrl: string;
  protected model: string;
  protected apiKeyEnv?: string;
  protected apiKeyExplicit?: string;
  protected extraHeaders: Record<string, string>;
  protected profile: ModelProfile;
  /** Declared transport capabilities (resolver-owned). */
  capabilities?: ProviderCapabilitiesFlags;

  constructor(opts: OpenAICompatOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    // Phase 8 — do NOT cache the raw key on the instance. Explicit override
    // (tests) is stored; otherwise headers() resolves lazily via the broker
    // on every request so a rotated/revoked key is picked up and the value
    // never lives as a long-lived field.
    this.apiKeyExplicit = opts.apiKey;
    this.apiKeyEnv = opts.apiKeyEnv;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.profile = profileFor(opts.id, opts.model);
    this.capabilities = opts.capabilities;
  }

  /** Lazy per-request key. Compat-gated env, then durable backend. */
  protected get apiKey(): string | undefined {
    return this.apiKeyExplicit ?? (this.apiKeyEnv ? secretBrokerSync(this.apiKeyEnv) : undefined);
  }

  get modelId(): string {
    return this.model;
  }

  /** Native OpenAI function calling is used ONLY when the profile declares it (conservative). */
  protected get nativeFunctionCalling(): boolean {
    return this.capabilities?.functionCalling === true;
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

  protected nativeSystemPrompt(): string {
    return [
      "You are XR, a careful, security-first AI agent.",
      "Use the provided tools to accomplish the task. Reply concisely when done.",
    ].join("\n");
  }

  protected buildChatBody(messages: Message[], tools: Tool[], stream: boolean): Record<string, unknown> {
    const mapped = messages.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content:
        m.role === "tool"
          ? `[tool:${m.name}] ${m.content}`
          : m.content,
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      temperature: 0,
      stream,
    };

    const native = this.nativeFunctionCalling;

    if (native) {
      // Native function calling: the tool catalog goes in `tools`, not the prompt.
      const nativeMessages = messages.map(m => {
        if (m.role === "assistant") {
          const state = nativeBlocks(m, this.id, this.model, "openai-chat")?.[0];
          if (state) return state;
          const calls = assistantCalls(m);
          return { role: "assistant", content: assistantText(m) || null, ...(calls.length && calls.every(c => c.id) ? { tool_calls: calls.map(c => ({ id: c.id, type: "function", function: { name: c.tool, arguments: JSON.stringify(c.args) } })) } : {}) };
        }
        if (m.role === "tool" && m.toolCallId) return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
        return { role: m.role === "tool" ? "user" : m.role, content: m.role === "tool" ? `[tool:${m.name}] ${m.content}` : m.content };
      });
      body.messages = [{ role: "system", content: this.nativeSystemPrompt() }, ...nativeMessages];
      if (tools.length > 0) {
        body.tools = toOpenAITools(tools);
        body.tool_choice = "auto";
      }
      return body;
    }

    // Envelope protocol (local/weak profiles). GBNF grammar / json_mode unchanged.
    const sys: Message = { role: "system", content: this.systemEnvelope(tools) };
    body.messages = [sys, ...mapped];

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
    body.max_tokens = outputLimit(chatOptions?.maxOutputTokens);

    try {
      const res = await guardedRequest(this.id, chatOptions, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST", redirect: "error",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal,
        }),
      );
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`provider ${this.id} HTTP ${res.status}`);
      }
      /**
       * Phase 06 · Step 29 — malformed-response handling. Invalid JSON or a
       * missing `choices` array is a STRUCTURAL provider failure: classified
       * honestly (non-retryable against this provider), never coerced into a
       * silent empty success, and never used to mutate execution state.
       */
      let json: any;
      try {
        json = await res.json();
      } catch (e) {
        if ((e as Error).name === "ProviderAbortError") throw e;
        throw malformedProviderResponseError(this.id, "response body is not valid JSON", this.model);
      }
      if (!json || typeof json !== "object" || !Array.isArray(json?.choices)) {
        throw malformedProviderResponseError(this.id, "missing required field: choices[]", this.model);
      }
      const usage = usagePair(json?.usage?.prompt_tokens, json?.usage?.completion_tokens);

      // Phase 1 · F-04 — honor native message.tool_calls (and the envelope).
      const turn = turnFromCompletion(normalizedCompletionOf(json), usage);
      turn.executing = { providerId: this.id, modelId: this.model };
      if (this.nativeFunctionCalling && json.choices?.[0]?.message) turn.native = { providerId: this.id, modelId: this.model, format: "openai-chat", blocks: [{ ...json.choices[0].message, role: "assistant" }] };
      if (json.choices?.[0]?.finish_reason === "length") turn.error = "Provider output limit reached; no tools executed";
      return turn;
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.model);
    }
  }

  /**
   * Phase 04 — streaming via SSE.
   * Yields normalized ProviderStreamChunk {text, toolCall, usage, finish}
   * Preserves cancellation via signal.
   *
   * Phase 1 · Step 3b — a provider that answers a `stream:true` request with a
   * NON-SSE JSON body (a lying/ignorant server) is detected and its real
   * content consumed ONCE instead of discarded line-by-line (F-02/M-06).
   */
  async *chatStream(
    messages: Message[],
    tools: Tool[],
    chatOptions?: ChatOptions,
  ): AsyncGenerator<ProviderStreamChunk> {
    const body = this.buildChatBody(messages, tools, true);
    body.max_tokens = outputLimit(chatOptions?.maxOutputTokens);
    body.stream_options = { include_usage: true };

    let res: Response;
    try {
      res = await guardedRequest(this.id, chatOptions, (signal) =>
        fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST", redirect: "error",
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
      await res.body?.cancel();
      throw normalizeProviderError(
        new Error(`provider ${this.id} HTTP ${res.status}`),
        this.id,
        this.model,
      );
    }

    // A stream request that gets an event-stream response proceeds below; a
    // non-SSE Content-Type is a strong signal the provider ignored `stream`.
    const contentType = res.headers.get("content-type") ?? "";
    const wantsSSE = contentType.toLowerCase().includes("text/event-stream");

    if (!res.body || !wantsSSE) {
      // Non-streaming (or bodyless) completion: consume it once. F-02/M-06.
      const json: any = await res.json().catch(() => ({}));
      if (!isChatCompletionObject(json)) {
        // Structural failure (no choices) — honest error, never a fake done.
        throw malformedProviderResponseError(
          this.id,
          "provider returned a non-SSE body with no choices[] to a stream request",
          this.model,
        );
      }
      const c = normalizedCompletionOf(json);
      if (c.content) yield { text: c.content, providerId: this.id, model: this.model };
      for (const tc of c.toolCalls) {
        yield { toolCall: tc, providerId: this.id, model: this.model };
      }
      if (c.usage) yield { usage: c.usage, providerId: this.id, model: this.model };
      const turn = turnFromCompletion(c);
      yield { finish: true, done: turn.done, status: turn.status, ...(c.finishReason === "length" ? { error: "Provider output limit reached; no tools executed" } : {}), ...(this.nativeFunctionCalling && json.choices?.[0]?.message ? { native: { providerId: this.id, modelId: this.model, format: "openai-chat" as const, blocks: [{ ...json.choices[0].message, role: "assistant" }] } } : {}), providerId: this.id, model: this.model };
      return;
    }

    let fullContent = "", reasoning = "", finished = false, finishReason: string | undefined;
    let usage: ModelTurn["usage"];
    const calls = new Map<number, { id?: string; type: "function"; function: { name: string; arguments: string } }>();
    try {
      for await (const data of sseData(res.body)) {
        if (data === "[DONE]") { finished = true; break; }
        let j: any;
        try { j = JSON.parse(data); } catch { throw malformedProviderResponseError(this.id, "invalid SSE JSON", this.model); }
        if (j.error) throw malformedProviderResponseError(this.id, "upstream SSE error", this.model);
        if (j.usage) usage = usagePair(j.usage.prompt_tokens, j.usage.completion_tokens);
        const choice = j.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) { finished = true; finishReason = choice.finish_reason; }
        const delta = choice.delta ?? choice.message ?? {};
        if (typeof delta.content === "string" && delta.content) { fullContent += delta.content; yield { text: delta.content, providerId: this.id, model: this.model }; }
        if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
        for (const tc of delta.tool_calls ?? []) {
          const index = tc.index ?? 0;
          if (!Number.isSafeInteger(index) || index < 0 || index >= 64) throw malformedProviderResponseError(this.id, "invalid tool index", this.model);
          const c = calls.get(index) ?? { type: "function", function: { name: "", arguments: "" } };
          if (tc.id) { if (c.id && c.id !== tc.id) throw malformedProviderResponseError(this.id, "tool id changed", this.model); c.id = tc.id; }
          if (tc.function?.name) c.function.name += tc.function.name;
          if (typeof tc.function?.arguments === "string") c.function.arguments += tc.function.arguments;
          calls.set(index, c);
        }
      }
      if (!finished) throw malformedProviderResponseError(this.id, "SSE EOF before completion", this.model);
      const rawCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
      let toolCalls: ToolCall[];
      try { toolCalls = parseOpenAIToolCalls(rawCalls); } catch { throw malformedProviderResponseError(this.id, "invalid streamed tool arguments", this.model); }
      if (finishReason !== "length") for (const tc of toolCalls) yield { toolCall: tc, providerId: this.id, model: this.model };
      const parsed = repairToTurn(fullContent);
      const done = toolCalls.length ? false : parsed.status === "parsed" ? parsed.done : finishReason === "stop" || finished;
      yield { usage, finish: true, done, ...(finishReason === "length" ? { error: "Provider output limit reached; no tools executed" } : {}), ...(this.nativeFunctionCalling ? { native: { providerId: this.id, modelId: this.model, format: "openai-chat" as const, blocks: [{ role: "assistant", content: fullContent || null, ...(rawCalls.length ? { tool_calls: rawCalls } : {}), ...(reasoning ? { reasoning_content: reasoning } : {}) }] } } : {}), providerId: this.id, model: this.model };
    } catch (e) { throw normalizeProviderError(e, this.id, this.model); }
  }

  async listModels(): Promise<string[]> {
    try {
      const res = await guardedRequest(this.id, { timeoutMs: 8000 }, signal => fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal, redirect: "error" }));
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
      const res = await guardedRequest(this.id, { timeoutMs: 8000 }, signal => fetch(`${this.baseUrl}/models`, { headers: this.headers(), signal, redirect: "error" }));
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
        method: "POST", redirect: "error",
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
