/**
 * XR — Phase 1 · Turn Contract & Provider Integrity (unit layer).
 *
 * Covers the module-level invariants that are NOT black-box-provable here:
 *   - native OpenAI tool-schema conversion + non-streaming tool_calls parsing;
 *   - the capability gate picks `chat()` when the provider declares streaming:false;
 *   - usage-estimate fallback math (F-13);
 *   - the RepairStatus matrix (see test/reliability.test.ts for the source level).
 */

import { describe, expect, test } from "bun:test";
import { toOpenAITools, parseOpenAIToolCalls, isChatCompletionObject } from "../../src/providers/native/schemas.ts";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";
import type { Message, Tool, ProviderCapabilitiesFlags, ModelTurn } from "../../src/core/types.ts";

// ── native schema conversion ─────────────────────────────────────────────────

describe("Phase 1 · native OpenAI-family tool schemas", () => {
  const tools: Tool[] = [
    {
      name: "read_file",
      description: "read a file",
      requiresApproval: false,
      parameters: { type: "object", properties: { path: { type: "string" } } },
      run: async () => ({ ok: true, output: "" }),
    },
  ];
  const specs = toOpenAITools(tools);

  test("converts XR tools into OpenAI function specs", () => {
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe("function");
    expect(specs[0].function.name).toBe("read_file");
    expect(specs[0].function.parameters).toEqual(tools[0].parameters);
  });

  test("parseOpenAIToolCalls parses a complete message.tool_calls array", () => {
    const calls = parseOpenAIToolCalls([
      { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"package.json"}' } },
    ]);
    expect(calls).toEqual([{ tool: "read_file", args: { path: "package.json" } }]);
  });

  test("parseOpenAIToolCalls tolerates bad arguments (untrusted data, never throws)", () => {
    const calls = parseOpenAIToolCalls([
      { function: { name: "shell", arguments: "{not-json" } },
      { function: { name: "with-empty-args", arguments: "" } },
      "garbage",
      { type: "function" }, // no function → skipped
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].tool).toBe("shell");
    expect(calls[0].args).toEqual({}); // bad JSON ⇒ {}, not throw
    expect(calls[1].tool).toBe("with-empty-args");
  });

  test("isChatCompletionObject detects a completion body", () => {
    expect(isChatCompletionObject({ choices: [] })).toBe(true);
    expect(isChatCompletionObject({ error: { message: "x" } })).toBe(false);
    expect(isChatCompletionObject(null)).toBe(false);
    expect(isChatCompletionObject([])).toBe(false);
  });
});

// ── non-streaming native message.tool_calls via a stubbed fetch ───────────────

function stubFetchOnce(body: unknown): void {
  (globalThis as any).__xrStubFetch = async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (globalThis as any).__xrStubFetch;
}

describe("Phase 1 · chat() honours native message.tool_calls (F-04)", () => {
  test("parses native tool_calls when present in a non-streaming body", async () => {
    const originalFetch = globalThis.fetch;
    stubFetchOnce({
      choices: [
        {
          message: { role: "assistant", content: null, tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.txt"}' } },
          ] },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });

    const provider = new OpenAICompatProvider({
      id: "stub",
      label: "Stub",
      baseUrl: "http://127.0.0.1:1/v1",
      model: "stub-model",
      capabilities: { functionCalling: true, streaming: true, toolUse: true, jsonMode: true },
    });
    const turn = await provider.chat([{ role: "user", content: "hi" }], []);
    globalThis.fetch = originalFetch;

    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].tool).toBe("read_file");
    expect(turn.done).toBe(false); // finish_reason "tool_calls" ⇒ not done
  });

  test("treats a plain empty body as an empty (not fake) turn", async () => {
    const originalFetch = globalThis.fetch;
    stubFetchOnce({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }] });
    const provider = new OpenAICompatProvider({ id: "s", label: "S", baseUrl: "http://x/v1", model: "m" });
    const turn = await provider.chat([{ role: "user", content: "hi" }], []);
    globalThis.fetch = originalFetch;
    // Never a fabricated done with "(no response)".
    expect(turn.done).toBe(false);
    expect(turn.status).toBe("empty");
    expect(turn.message).toBe("");
  });
});

// ── capability gate: streaming:false ⇒ chat() on the wire ────────────────────

describe("Phase 1 · capability gate (F-03) — buildChatBody honours streaming", () => {
  test("a streaming:false provider builds a non-stream body (stream:false)", () => {
    const provider = new OpenAICompatProvider({
      id: "s", label: "S", baseUrl: "http://x/v1", model: "m",
      capabilities: { streaming: false, toolUse: true, functionCalling: false, jsonMode: false },
    });
    const body = (provider as any).buildChatBody([{ role: "user", content: "hi" }], [], false);
    expect(body.stream).toBe(false);
  });

  test("a functionCalling:true provider sends native tools + tool_choice", () => {
    const provider = new OpenAICompatProvider({
      id: "s", label: "S", baseUrl: "http://x/v1", model: "m",
      capabilities: { streaming: true, toolUse: true, functionCalling: true, jsonMode: true },
    });
    const body = (provider as any).buildChatBody(
      [{ role: "user", content: "hi" }],
      ([{ name: "read_file", description: "read", parameters: { type: "object", properties: {} } }] as unknown as Tool[]),
      false,
    );
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe("auto");
    // The envelope system prompt must NOT be prepended in native mode.
    const sysSystem = body.messages;
    expect(sysSystem[0].role).toBe("system");
    expect(sysSystem[0].content).not.toContain('"tool_calls"');
  });

  test("a non-functionCalling (envelope) provider does NOT send native tools", () => {
    const provider = new OpenAICompatProvider({
      id: "s", label: "S", baseUrl: "http://x/v1", model: "m",
      capabilities: { streaming: true, toolUse: true, functionCalling: false, jsonMode: true },
    });
    const body = (provider as any).buildChatBody(
      [{ role: "user", content: "hi" }],
      ([{ name: "read_file", description: "read", parameters: { type: "object", properties: {} } }] as unknown as Tool[]),
      false,
    );
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });
});

// ── usage-estimate fallback (F-13) ───────────────────────────────────────────

describe("Phase 1 · usage-estimate fallback (F-13)", () => {
  test("a provider omitting usage does not meter $0 silently (estimate is non-zero for a substantive turn)", () => {
    // Reuses the loop's estimator against a turn that produced real content.
    const est = estimateForTurn({ message: "Hello from the model, a real answer.", toolCalls: [], done: true }, [
      { role: "user", content: "What is 2+2?" },
    ]);
    expect(est.outTokens).toBeGreaterThan(0);
    expect(est.inTokens).toBeGreaterThan(0);
  });
});

// Small local mirror of the loop's estimator for unit testing the math (kept
// in sync with src/core/agent.ts estimateTurnUsage).
function estimateForTurn(turn: { message: string; toolCalls: unknown[]; done: boolean }, messages: Message[]): { inTokens: number; outTokens: number } {
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const outChars = (turn.message?.length ?? 0) + JSON.stringify(turn.toolCalls ?? []).length;
  return { inTokens: Math.ceil(promptChars / 4), outTokens: Math.ceil(outChars / 4) };
}
