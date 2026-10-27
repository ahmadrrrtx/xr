/** OpenAI Responses transport. Stateless, bounded; no implicit server-side conversation storage.
 * Encrypted reasoning items/function-call ids survive exact-model continuations.
 * No built-in remote tools are enabled: every XR tool still passes the shared policy gate.
 */
import type {
  ChatOptions,
  Message,
  ModelTurn,
  Provider,
  Tool,
} from "../../core/types.ts";
import { guardedRequest } from "../request-guard.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";
import {
  malformedProviderResponseError,
  normalizeProviderError,
} from "../errors.ts";
import { toolParameters } from "./schemas.ts";
import {
  assistantCalls,
  assistantText,
  chunksOfTurn,
  nativeBlocks,
  objectArgs,
  outputLimit,
  usagePair,
} from "./history.ts";
export class OpenAIResponsesProvider implements Provider {
  readonly capabilities = {
    streaming: false,
    toolUse: true,
    functionCalling: true,
    jsonMode: false,
  };
  readonly id = "openai";
  readonly label = "OpenAI (Responses)";
  constructor(
    private opts: { model: string; baseUrl?: string; apiKeyEnv?: string },
  ) {}
  get modelId(): string {
    return this.opts.model;
  }
  private get baseUrl(): string {
    return (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
  }
  private headers(): Record<string, string> {
    const key = secretBrokerSync(this.opts.apiKeyEnv ?? "OPENAI_API_KEY");
    if (!key)
      throw new Error(
        "OpenAI API key unavailable through the credential broker",
      );
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
  }
  async chat(
    messages: Message[],
    tools: Tool[],
    options?: ChatOptions,
  ): Promise<ModelTurn> {
    const input: unknown[] = [];
    const pending = new Set<string>();
    for (const m of messages) {
      if (m.role === "assistant") {
        const blocks = nativeBlocks(
          m,
          this.id,
          this.modelId,
          "openai-responses",
        );
        if (blocks) {
          input.push(...blocks);
          for (const b of blocks as any[])
            if (b.type === "function_call" && typeof b.call_id === "string")
              pending.add(b.call_id);
        } else {
          const text = assistantText(m);
          if (text) input.push({ role: "assistant", content: text });
          for (const c of assistantCalls(m))
            if (c.id) {
              input.push({
                type: "function_call",
                call_id: c.id,
                name: c.tool,
                arguments: JSON.stringify(c.args),
              });
              pending.add(c.id);
            }
        }
      } else if (
        m.role === "tool" &&
        m.toolCallId &&
        pending.has(m.toolCallId)
      ) {
        input.push({
          type: "function_call_output",
          call_id: m.toolCallId,
          output: m.content,
        });
        pending.delete(m.toolCallId);
      } else
        input.push({
          role: m.role === "tool" ? "user" : m.role,
          content:
            m.role === "tool" ? `[tool:${m.name}] ${m.content}` : m.content,
        });
    }
    try {
      const res = await guardedRequest(this.id, options, (signal) =>
        fetch(`${this.baseUrl}/responses`, {
          method: "POST",
          signal,
          redirect: "error",
          headers: this.headers(),
          body: JSON.stringify({
            model: this.modelId,
            input,
            instructions:
              "Use native function calls for supplied tools, not JSON tool envelopes. Final answers are text. XR independently authorizes every tool.",
            store: false,
            include: ["reasoning.encrypted_content"],
            max_output_tokens: outputLimit(options?.maxOutputTokens),
            ...(tools.length
              ? {
                  tools: tools.map((t) => ({
                    type: "function",
                    name: t.name,
                    description: t.description,
                    parameters: toolParameters(t.parameters),
                    strict: false,
                  })),
                  tool_choice: "auto",
                }
              : {}),
          }),
        }),
      );
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`OpenAI API HTTP ${res.status}`);
      }
      let j: any;
      try {
        j = await res.json();
      } catch (e) {
        if ((e as Error).name === "ProviderAbortError") throw e;
        throw malformedProviderResponseError(
          this.id,
          "invalid JSON",
          this.modelId,
        );
      }
      if (!Array.isArray(j.output))
        throw malformedProviderResponseError(
          this.id,
          "missing output[]",
          this.modelId,
        );
      const toolCalls: ModelTurn["toolCalls"] = [];
      let message = "";
      const ids = new Set<string>();
      for (const b of j.output) {
        if (b.type === "message")
          for (const c of b.content ?? []) {
            if (c.type === "output_text") message += c.text ?? "";
            if (c.type === "refusal") message += c.refusal ?? "";
          }
        if (b.type === "function_call") {
          if (
            typeof b.call_id !== "string" ||
            !b.call_id ||
            ids.has(b.call_id) ||
            typeof b.name !== "string"
          )
            throw malformedProviderResponseError(
              this.id,
              "invalid/duplicate function call id",
              this.modelId,
            );
          ids.add(b.call_id);
          let args: Record<string, unknown>;
          try {
            args = objectArgs(JSON.parse(b.arguments));
          } catch {
            throw malformedProviderResponseError(
              this.id,
              "invalid function arguments",
              this.modelId,
            );
          }
          toolCalls.push({ id: b.call_id, tool: b.name, args });
        }
      }
      if (toolCalls.length > 64)
        throw malformedProviderResponseError(
          this.id,
          "too many tool calls",
          this.modelId,
        );
      const usage = usagePair(j.usage?.input_tokens, j.usage?.output_tokens);
      const complete = j.status === "completed";
      return {
        message,
        toolCalls,
        done: complete && !toolCalls.length,
        ...(!complete
          ? {
              error:
                "Responses request did not complete (output/refusal/transport limit); no tools executed",
            }
          : {}),
        usage,
        ...(usage ? { usageSource: "provider" as const } : {}),
        executing: { providerId: this.id, modelId: this.modelId },
        native: {
          providerId: this.id,
          modelId: this.modelId,
          format: "openai-responses",
          blocks: j.output,
        },
        status: message || toolCalls.length ? "parsed" : "empty",
      };
    } catch (e) {
      throw normalizeProviderError(e, this.id, this.modelId);
    }
  }
  async *chatStream(messages: Message[], tools: Tool[], options?: ChatOptions) {
    yield* chunksOfTurn(
      await this.chat(messages, tools, options),
      this.id,
      this.modelId,
    );
  }
  async health() {
    const start = Date.now();
    try {
      const res = await guardedRequest(this.id, { timeoutMs: 8000 }, (signal) =>
        fetch(`${this.baseUrl}/models/${encodeURIComponent(this.modelId)}`, {
          signal,
          redirect: "error",
          headers: this.headers(),
        }),
      );
      await res.body?.cancel();
      return {
        ok: res.ok,
        latencyMs: Date.now() - start,
        detail: res.ok
          ? "Model endpoint reachable; agent compatibility not validated"
          : `HTTP ${res.status}`,
      };
    } catch {
      return {
        ok: false,
        detail: "Credential/endpoint probe failed; no generation requested",
      };
    }
  }
}
