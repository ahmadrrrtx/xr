import { describe, expect, test } from "bun:test";
import { buildNovaInvokePayload, parseNovaInvokeResponse } from "../../src/providers/native/bedrock-nova.ts";
import type { Message, Tool } from "../../src/core/types.ts";

const fixtureTool = {
  name: "read_file",
  description: "Read an authorized workspace file.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  requiresApproval: false,
  run: async () => ({ ok: true, output: "fixture" }),
} satisfies Tool;

describe("Amazon Nova InvokeModel adapter", () => {
  test("builds native messages-v1 payloads with tools and preserved tool-result ids", () => {
    const messages: Message[] = [
      { role: "system", content: "Follow policy." },
      { role: "user", content: "Read the file." },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tooluse-1", tool: "read_file", args: { path: "notes.txt" } }],
      },
      { role: "tool", name: "read_file", toolCallId: "tooluse-1", content: "hello" },
    ];
    const payload = buildNovaInvokePayload(messages, [fixtureTool], 512) as any;

    expect(payload.schemaVersion).toBe("messages-v1");
    expect(payload.system).toEqual([{ text: "Follow policy." }]);
    expect(payload.messages[1].content[0].toolUse).toEqual({
      toolUseId: "tooluse-1",
      name: "read_file",
      input: { path: "notes.txt" },
    });
    expect(payload.messages[2].content[0].toolResult.toolUseId).toBe("tooluse-1");
    expect(payload.toolConfig.tools[0].toolSpec.inputSchema.json.required).toEqual(["path"]);
    expect(payload.inferenceConfig).toEqual({ maxTokens: 512, temperature: 0.3 });
  });

  test("parses Nova text, tool use and provider-reported token usage", () => {
    const turn = parseNovaInvokeResponse({
      output: { message: { role: "assistant", content: [
        { text: "Checking." },
        { toolUse: { toolUseId: "tooluse-2", name: "read_file", input: { path: "a.txt" } } },
      ] } },
      stopReason: "tool_use",
      usage: { inputTokens: 21, outputTokens: 9, totalTokens: 30 },
    });

    expect(turn).toEqual({
      message: "Checking.",
      toolCalls: [{ id: "tooluse-2", tool: "read_file", args: { path: "a.txt" } }],
      done: false,
      status: "parsed",
      usage: { inTokens: 21, outTokens: 9 },
      usageSource: "provider",
    });
  });

  test("only end_turn completes; an empty or token-limited response is not success", () => {
    expect(parseNovaInvokeResponse({ output: { message: { content: [{ text: "Done." }] } }, stopReason: "end_turn" }).done).toBe(true);
    const limited = parseNovaInvokeResponse({ output: { message: { content: [{ text: "Partial" }] } }, stopReason: "max_tokens" });
    expect(limited.done).toBe(false);
    expect(limited.status).toBe("parsed");
    const empty = parseNovaInvokeResponse({ output: { message: { content: [] } }, stopReason: "end_turn" });
    expect(empty.done).toBe(false);
    expect(empty.status).toBe("empty");
  });
});
