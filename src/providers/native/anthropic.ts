/** Anthropic Messages. Explicit endpoint only; signed thinking and tool ids are
 * retained for exact-model continuations, never forwarded to another provider. */
import type { Message, ModelTurn, Provider, Tool, ChatOptions } from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { normalizeProviderError, malformedProviderResponseError } from "../errors.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";
import { toolParameters } from "./schemas.ts";
import { assistantCalls, assistantText, chunksOfTurn, nativeBlocks, objectArgs, outputLimit, usagePair } from "./history.ts";
export class AnthropicProvider implements Provider {
  readonly capabilities = { streaming: false, toolUse: true, functionCalling: true, jsonMode: false };
  readonly id = "anthropic";
  readonly label = "Anthropic Claude";
  private model: string;
  private apiKeyEnv: string;
  constructor(opts: { model?: string; apiKeyEnv?: string } = {}) { this.model = opts.model ?? "claude-sonnet-5-5"; this.apiKeyEnv = opts.apiKeyEnv ?? "ANTHROPIC_API_KEY"; }
  get modelId() { return this.model; }
  private headers() {
    const key = secretBrokerSync(this.apiKeyEnv);
    if (!key) throw new Error("Anthropic API key unavailable through the credential broker");
    return { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" };
  }
  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const converted: Array<{ role: "user" | "assistant"; content: any[] }> = [];
    let system = "";
    const append = (role: "user" | "assistant", blocks: any[]) => {
      if (!blocks.length) return;
      const last = converted.at(-1);
      if (last?.role === role) last.content.push(...blocks); else converted.push({ role, content: [...blocks] });
    };
    for (const m of messages) {
      if (m.role === "system") { system += m.content + "\n"; continue; }
      if (m.role === "tool") {
        if (m.toolCallId) append("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
        else append("user", [{ type: "text", text: `[tool:${m.name}] ${m.content}` }]);
      } else if (m.role === "assistant") {
        const blocks = nativeBlocks(m, this.id, this.model, "anthropic-messages");
        if (blocks) append("assistant", blocks);
        else {
          const text = assistantText(m), calls = assistantCalls(m);
          append("assistant", [...(text ? [{ type: "text", text }] : []), ...calls.filter(c => c.id).map(c => ({ type: "tool_use", id: c.id, name: c.tool, input: c.args }))]);
        }
      } else append("user", [{ type: "text", text: m.content }]);
    }
    system += "\nWhen native tools are supplied, invoke them using the API tool-use blocks, not a JSON envelope. Return the final answer as text. XR independently authorizes every tool.";
    try {
      const res = await guardedRequest(this.id, options, signal => fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal, redirect: "error", headers: this.headers(),
        body: JSON.stringify({ model: this.model, max_tokens: outputLimit(options?.maxOutputTokens), system, messages: converted, ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: toolParameters(t.parameters) })) } : {}) }),
      }));
      if (!res.ok) { await res.body?.cancel(); throw new Error(`Anthropic API HTTP ${res.status}`); }
      let j: any;
      try { j = await res.json(); } catch (e) { if ((e as Error).name === "ProviderAbortError") throw e; throw malformedProviderResponseError(this.id, "invalid JSON", this.model); }
      if (!Array.isArray(j.content)) throw malformedProviderResponseError(this.id, "missing content[]", this.model);
      let message = "";
      const toolCalls: ModelTurn["toolCalls"] = [], ids = new Set<string>();
      for (const b of j.content) {
        if (b.type === "text") message += typeof b.text === "string" ? b.text : "";
        if (b.type === "tool_use") {
          if (typeof b.id !== "string" || !b.id || ids.has(b.id) || typeof b.name !== "string") throw malformedProviderResponseError(this.id, "invalid/duplicate tool-use id", this.model);
          ids.add(b.id);
          try { toolCalls.push({ id: b.id, tool: b.name, args: objectArgs(b.input) }); } catch { throw malformedProviderResponseError(this.id, "invalid tool arguments", this.model); }
        }
      }
      if (toolCalls.length > 64) throw malformedProviderResponseError(this.id, "too many tool calls", this.model);
      // Cache read/create tokens are billable too. Base-rate estimate intentionally
      // ignores discounts and cannot represent all cache-write/region premiums.
      const u = j.usage;
      const usage = usagePair(u ? (u.input_tokens ?? NaN) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : undefined, u?.output_tokens);
      const complete = j.stop_reason === "end_turn" || j.stop_reason === "tool_use" || j.stop_reason === "stop_sequence";
      return { message, toolCalls, done: complete && !toolCalls.length, ...(!complete ? { error: "Anthropic turn incomplete/refused (output limit or unknown stop reason); no tools executed" } : {}), usage, ...(usage ? { usageSource: "provider" as const } : {}), executing: { providerId: this.id, modelId: this.model }, native: { providerId: this.id, modelId: this.model, format: "anthropic-messages", blocks: j.content }, status: message || toolCalls.length ? "parsed" : "empty" };
    } catch (e) { throw normalizeProviderError(e, this.id, this.model); }
  }
  async *chatStream(messages: Message[], tools: Tool[], options?: ChatOptions) { yield* chunksOfTurn(await this.chat(messages, tools, options), this.id, this.model); }
  async health() {
    const start = Date.now();
    try {
      const res = await guardedRequest(this.id, { timeoutMs: 8000 }, signal => fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(this.model)}`, { signal, redirect: "error", headers: this.headers() }));
      await res.body?.cancel();
      return { ok: res.ok, latencyMs: Date.now() - start, detail: res.ok ? "Model endpoint reachable; agent compatibility not validated" : `HTTP ${res.status}` };
    } catch { return { ok: false, detail: "Credential/endpoint probe failed; no generation requested" }; }
  }
}
