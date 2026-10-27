/** Gemini API only. Vertex/ADC fallback is deliberately NOT inferred from ambient
 * GCP state. A different endpoint/account needs an explicit provider selection.
 * API keys are headers, never URL parameters; raw upstream errors are not reflected.
 */
import type { ChatOptions, Message, ModelTurn, Provider, Tool } from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";
import { malformedProviderResponseError, normalizeProviderError } from "../errors.ts";
import { toolParameters } from "./schemas.ts";
import { assistantCalls, assistantText, chunksOfTurn, nativeBlocks, objectArgs, outputLimit, usagePair } from "./history.ts";
export class GoogleProvider implements Provider {
  readonly capabilities = { streaming: false, toolUse: true, functionCalling: true, jsonMode: false };
  readonly id = "google";
  readonly label = "Google Gemini";
  private readonly model: string;
  private readonly apiKeyEnv: string;
  private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta";
  constructor(opts: { model?: string; apiKeyEnv?: string } = {}) { this.model = opts.model ?? "gemini-3.8-flash"; this.apiKeyEnv = opts.apiKeyEnv ?? "GOOGLE_API_KEY"; }
  get modelId() { return this.model; }
  private headers() {
    const key = secretBrokerSync(this.apiKeyEnv);
    if (!key) throw new Error("Google API key unavailable through the credential broker");
    return { "Content-Type": "application/json", "x-goog-api-key": key };
  }
  async chat(messages: Message[], tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
    const contents: Array<{ role: "user" | "model"; parts: any[] }> = [];
    let system = "";
    const append = (role: "user" | "model", parts: any[]) => {
      if (!parts.length) return;
      const last = contents.at(-1);
      if (last?.role === role) last.parts.push(...parts); else contents.push({ role, parts: [...parts] });
    };
    for (const m of messages) {
      if (m.role === "system") { system += m.content + "\n"; continue; }
      if (m.role === "assistant") {
        const native = nativeBlocks(m, this.id, this.model, "gemini-content");
        if (native) append("model", native);
        else {
          const text = assistantText(m);
          append("model", [...(text ? [{ text }] : []), ...assistantCalls(m).map(c => ({ functionCall: { name: c.tool, args: c.args, ...(c.id ? { id: c.id } : {}) } }))]);
        }
      } else if (m.role === "tool") append("user", [{ functionResponse: { name: m.name ?? "unknown", ...(m.toolCallId ? { id: m.toolCallId } : {}), response: { output: m.content } } }]);
      else append("user", [{ text: m.content }]);
    }
    system += "\nUse native function calls when tools are supplied, not tool JSON in text. XR independently authorizes tool execution. Final answers are text.";
    try {
      const res = await guardedRequest(this.id, options, signal => fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST", signal, redirect: "error", headers: this.headers(),
        body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: system }] }, generationConfig: { maxOutputTokens: outputLimit(options?.maxOutputTokens) }, ...(tools.length ? { tools: [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: toolParameters(t.parameters) })) }] } : {}) }),
      }));
      if (!res.ok) { await res.body?.cancel(); throw new Error(`Google API HTTP ${res.status}`); }
      let j: any;
      try { j = await res.json(); } catch (e) { if ((e as Error).name === "ProviderAbortError") throw e; throw malformedProviderResponseError(this.id, "invalid JSON", this.model); }
      const candidate = j.candidates?.[0];
      if (!candidate || !Array.isArray(candidate.content?.parts)) throw malformedProviderResponseError(this.id, "missing candidate parts (possibly refused)", this.model);
      const parts: any[] = candidate.content.parts;
      let message = "";
      const toolCalls: ModelTurn["toolCalls"] = [], ids = new Set<string>();
      for (const p of parts) {
        // Do not display provider reasoning. Retain signatures in native state.
        if (typeof p.text === "string" && !p.thought) message += p.text;
        if (p.functionCall) {
          const c = p.functionCall;
          if (typeof c.name !== "string" || (c.id !== undefined && (typeof c.id !== "string" || ids.has(c.id)))) throw malformedProviderResponseError(this.id, "invalid/duplicate function id", this.model);
          if (c.id) ids.add(c.id);
          try { toolCalls.push({ ...(c.id ? { id: c.id } : {}), tool: c.name, args: objectArgs(c.args ?? {}) }); } catch { throw malformedProviderResponseError(this.id, "invalid function arguments", this.model); }
        }
      }
      if (toolCalls.length > 64) throw malformedProviderResponseError(this.id, "too many tool calls", this.model);
      const u = j.usageMetadata;
      // candidatesTokenCount excludes thought tokens. Do NOT lose billable reasoning.
      const usage = usagePair(u?.promptTokenCount, u ? (u.candidatesTokenCount ?? NaN) + (u.thoughtsTokenCount ?? 0) : undefined);
      const complete = candidate.finishReason === "STOP";
      return { message, toolCalls, done: complete && !toolCalls.length, ...(!complete ? { error: "Gemini turn incomplete/refused (output limit or finish reason); no tools executed" } : {}), usage, ...(usage ? { usageSource: "provider" as const } : {}), executing: { providerId: this.id, modelId: this.model }, native: { providerId: this.id, modelId: this.model, format: "gemini-content", blocks: parts }, status: message || toolCalls.length ? "parsed" : "empty" };
    } catch (e) { throw normalizeProviderError(e, this.id, this.model); }
  }
  async *chatStream(messages: Message[], tools: Tool[], options?: ChatOptions) { yield* chunksOfTurn(await this.chat(messages, tools, options), this.id, this.model); }
  async health() {
    const start = Date.now();
    try {
      const res = await guardedRequest(this.id, { timeoutMs: 8000 }, signal => fetch(`${this.baseUrl}/models/${encodeURIComponent(this.model)}`, { signal, redirect: "error", headers: this.headers() }));
      await res.body?.cancel();
      return { ok: res.ok, latencyMs: Date.now() - start, detail: res.ok ? "Model endpoint reachable; agent compatibility not validated" : `HTTP ${res.status}` };
    } catch { return { ok: false, detail: "Credential/endpoint probe failed; no generation requested" }; }
  }
}
