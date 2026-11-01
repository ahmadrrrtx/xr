import { afterEach, expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { OpenAIResponsesProvider } from "../../src/providers/native/openai-responses.ts";
import { AnthropicProvider } from "../../src/providers/native/anthropic.ts";
import { GoogleProvider } from "../../src/providers/native/google.ts";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";
import { toolParameters } from "../../src/providers/native/schemas.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import {
  guardedRequest,
  ProviderAbortError,
} from "../../src/providers/request-guard.ts";
import {
  priceFor,
  pricingAvailable,
  isFreeProvider,
} from "../../src/cost/pricing.ts";
import { modelFact } from "../../src/intelligence/model-registry.ts";
import type { Message, ModelTurn, Tool } from "../../src/core/types.ts";
const originalFetch = globalThis.fetch;
const unregister: (() => void)[] = [];
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const f of unregister.splice(0)) f();
  delete process.env.GCP_PROJECT_ID;
  delete process.env.ANTHROPIC_BASE_URL;
});
const schema = {
  type: "object",
  properties: { path: { type: "string" } },
  required: ["path"],
  additionalProperties: false,
};
const tool: Tool = {
  name: "read_file",
  description: "read",
  parameters: schema,
  requiresApproval: false,
  async run() {
    return { ok: true, output: "fixture" };
  },
};
function mock(responses: unknown[]) {
  unregister.push(
    registerRuntimeSecretResolver(() => "test-key-not-a-real-credential"),
  );
  const requests: Array<{ url: string; body: any; headers: Headers }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    });
    const next: any = responses.shift();
    return new Response(JSON.stringify(next?.payload ?? next), {
      status: next?.httpStatus ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as any;
  return requests;
}
function continuation(t: ModelTurn): Message[] {
  return [
    { role: "user", content: "read twice" },
    {
      role: "assistant",
      content: JSON.stringify({
        message: t.message,
        tool_calls: t.toolCalls,
        done: t.done,
      }),
      toolCalls: t.toolCalls,
      native: t.native,
    },
    ...t.toolCalls.map((c) => ({
      role: "tool" as const,
      name: c.tool,
      toolCallId: c.id,
      content: "fixture result",
    })),
  ];
}
test("native schema is retained once, including required/additionalProperties", () => {
  expect(toolParameters(schema)).toEqual(schema);
  expect(toolParameters({ path: { type: "string" } })).toEqual({
    type: "object",
    properties: { path: { type: "string" } },
  });
});

// UI-redesign 2026-10-29: legacy string property maps must become VALID JSON
// Schema — strict validators (ollama 0.40.x OpenAI-compat) reject bare string
// property values with HTTP 400, breaking every native-path chat on ollama.
test("legacy string property maps normalize to real JSON Schema objects", () => {
  expect(toolParameters({ path: "string (relative path)" })).toEqual({
    type: "object",
    properties: { path: { type: "string", description: "relative path" } },
  });
  expect(toolParameters({ name: "string" })).toEqual({
    type: "object",
    properties: { name: { type: "string" } },
  });
  expect(toolParameters({ count: "number (how many commits to show, default 10)" })).toEqual({
    type: "object",
    properties: { count: { type: "number", description: "how many commits to show, default 10" } },
  });
  // unparseable prose still degrades to a typed property, never a bare string
  expect(toolParameters({ weird: "anything at all" })).toEqual({
    type: "object",
    properties: { weird: { type: "string", description: "anything at all" } },
  });
  // object property values pass through untouched
  expect(toolParameters({ path: { type: "string", description: "kept" } })).toEqual({
    type: "object",
    properties: { path: { type: "string", description: "kept" } },
  });
});
test("unknown/account-dependent pricing is unavailable, dated standard rates change explicitly", () => {
  const now = Date.parse("2026-10-26T00:00:00Z");
  expect(pricingAvailable(priceFor("unknown", "anything", { now }))).toBe(
    false,
  );
  expect(isFreeProvider("groq")).toBe(false);
  expect(pricingAvailable(priceFor("groq", "llama", { now }))).toBe(false);
  expect(priceFor("openai", "gpt-4o-mini", { now }).inPerMTok).toBe(0.15);
  expect(modelFact("openai", "gpt-4o-mini")?.lifecycle).toBe("deprecated");
  expect(priceFor("google", "gemini-4-argon", { now }).outPerMTok).toBe(10);
  expect(
    priceFor("google", "gemini-4-argon", { now: Date.parse("2026-12-01") })
      .outPerMTok,
  ).toBe(20);
  expect(
    priceFor("google", "gemini-3.8-flash", { now: Date.parse("2027-01-01") })
      .outPerMTok,
  ).toBe(7.5);
  expect(
    pricingAvailable(
      priceFor("openai", "gpt-6.1-sol", { now: Date.parse("2028-01-01") }),
    ),
  ).toBe(false);
});
test("Responses uses native schema, preserves reasoning and distinct identical calls by id", async () => {
  const blocks = [
    {
      type: "reasoning",
      id: "rs_1",
      encrypted_content: "OPAQUE_ENCRYPTED",
      summary: [],
    },
    ...["call_A", "call_B"].map((call_id) => ({
      type: "function_call",
      id: `fc_${call_id}`,
      call_id,
      name: tool.name,
      arguments: '{"path":"fixture"}',
    })),
  ];
  const requests = mock([
    {
      status: "completed",
      output: blocks,
      usage: { input_tokens: 52, output_tokens: 13 },
    },
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
    },
  ]);
  const p = new OpenAIResponsesProvider({ model: "gpt-6.1-sol" });
  const t = await p.chat([{ role: "user", content: "read" }], [tool], {
    maxOutputTokens: 32,
  });
  expect(t.toolCalls.map((c) => c.id)).toEqual(["call_A", "call_B"]);
  expect(t.done).toBe(false);
  expect(t.usage).toEqual({ inTokens: 52, outTokens: 13 });
  await p.chat(continuation(t), [tool]);
  expect(requests[0].url).toEndWith("/responses");
  expect(requests[0].body.store).toBe(false);
  expect(requests[0].body.max_output_tokens).toBe(32);
  expect(requests[0].body.tools[0].parameters).toEqual(schema);
  expect(requests[1].body.input.slice(1, 4)).toEqual(blocks);
  expect(
    requests[1].body.input
      .filter((x: any) => x.type === "function_call_output")
      .map((x: any) => x.call_id),
  ).toEqual(["call_A", "call_B"]);
});
test("Anthropic preserves signed thinking and chronological paired tool results", async () => {
  const blocks = [
    { type: "thinking", thinking: "", signature: "SIGNED_OPAQUE" },
    ...["toolu_A", "toolu_B"].map((id) => ({
      type: "tool_use",
      id,
      name: tool.name,
      input: { path: "fixture" },
    })),
  ];
  const requests = mock([
    {
      content: blocks,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 3 },
    },
    { content: [{ type: "text", text: "done" }], stop_reason: "end_turn" },
  ]);
  const p = new AnthropicProvider();
  const t = await p.chat([{ role: "user", content: "read" }], [tool], {
    maxOutputTokens: 40,
  });
  expect(t.usage?.inTokens).toBe(13);
  await p.chat(continuation(t), [tool]);
  expect(requests[0].body.tools[0].input_schema).toEqual(schema);
  expect(requests[0].body.max_tokens).toBe(40);
  expect(requests[1].body.messages[1].content).toEqual(blocks);
  expect(
    requests[1].body.messages[2].content.map((x: any) => x.tool_use_id),
  ).toEqual(["toolu_A", "toolu_B"]);
});
test("Gemini preserves thought signatures/id; key is header; includes billable thinking", async () => {
  const parts = ["A", "B"].map((id) => ({
    functionCall: { name: tool.name, id, args: { path: "fixture" } },
    thoughtSignature: `sig_${id}`,
  }));
  const requests = mock([
    {
      candidates: [{ content: { parts }, finishReason: "STOP" }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 7,
      },
    },
    {
      candidates: [
        { content: { parts: [{ text: "done" }] }, finishReason: "STOP" },
      ],
    },
  ]);
  const p = new GoogleProvider();
  const t = await p.chat([{ role: "user", content: "read" }], [tool]);
  expect(t.usage).toEqual({ inTokens: 10, outTokens: 10 });
  await p.chat(continuation(t), [tool]);
  expect(requests[0].url).not.toContain("key=");
  expect(requests[0].headers.get("x-goog-api-key")).toBe(
    "test-key-not-a-real-credential",
  );
  expect(
    requests[0].body.tools[0].functionDeclarations[0].parametersJsonSchema,
  ).toEqual(schema);
  expect(requests[1].body.contents[1].parts).toEqual(parts);
  expect(
    requests[1].body.contents[2].parts.map((x: any) => x.functionResponse.id),
  ).toEqual(["A", "B"]);
});
test("Google auth failure never switches to ambient Vertex/ADC or reflects upstream body", async () => {
  process.env.GCP_PROJECT_ID = "should-not-be-used";
  const requests = mock([
    { httpStatus: 401, payload: { error: "UNSAFE_REFLECTED_PROMPT" } },
  ]);
  await expect(
    new GoogleProvider().chat(
      [{ role: "user", content: "private prompt" }],
      [tool],
    ),
  ).rejects.toThrow("Authentication failed");
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toStartWith(
    "https://generativelanguage.googleapis.com/",
  );
});
test("foreign-model opaque continuation is not forwarded", async () => {
  const requests = mock([
    {
      status: "completed",
      output: [
        { type: "message", content: [{ type: "output_text", text: "done" }] },
      ],
    },
  ]);
  const m: Message = {
    role: "assistant",
    content: "previous visible reply",
    native: {
      providerId: "openai",
      modelId: "different-model",
      format: "openai-responses",
      blocks: [{ type: "reasoning", encrypted_content: "DO_NOT_FORWARD" }],
    },
  };
  await new OpenAIResponsesProvider({ model: "gpt-6.1-sol" }).chat(
    [m, { role: "user", content: "continue" }],
    [],
  );
  expect(JSON.stringify(requests[0].body)).not.toContain("DO_NOT_FORWARD");
});
test("Chat Completions assembles fragmented native calls, never executes partial JSON", async () => {
  const requests = mock([]);
  const events = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "read_file", arguments: '{"pa' },
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: 'th":"fixture"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 8, completion_tokens: 4 } },
  ];
  globalThis.fetch = (async () =>
    new Response(
      events.map((x) => `data: ${JSON.stringify(x)}\r\n\r\n`).join("") +
        "data: [DONE]\r\n\r\n",
      { headers: { "Content-Type": "text/event-stream" } },
    )) as any;
  const p = new OpenAICompatProvider({
    id: "fixture",
    label: "fixture",
    model: "test",
    baseUrl: "http://fixture",
    capabilities: {
      streaming: true,
      toolUse: true,
      functionCalling: true,
      jsonMode: false,
    },
  });
  const chunks = [];
  for await (const c of p.chatStream(
    [{ role: "user", content: "read" }],
    [tool],
  ))
    chunks.push(c);
  expect(chunks.filter((c) => c.toolCall).map((c) => c.toolCall)).toEqual([
    { id: "call_1", tool: "read_file", args: { path: "fixture" } },
  ]);
  expect(chunks.at(-1)?.usage).toEqual({ inTokens: 8, outTokens: 4 });
});
test("real TCP headers-then-stalled-body obeys the SAME request deadline", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((s) => {
    sockets.add(s);
    s.once("data", () =>
      s.write(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{"co\r\n',
      ),
    );
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as any).port;
    const response = await guardedRequest(
      "socket-fixture",
      { timeoutMs: 150 },
      (signal) => originalFetch(`http://127.0.0.1:${port}`, { signal }),
    );
    expect(response.status).toBe(200); // headers really arrived before the hang
    await expect(response.text()).rejects.toBeInstanceOf(ProviderAbortError);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
