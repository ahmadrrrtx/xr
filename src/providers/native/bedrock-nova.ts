import type { Message, ModelTurn, Tool } from "../../core/types.ts";
import { assistantCalls, assistantText, outputLimit, usagePair } from "./history.ts";
import { toolParameters } from "./schemas.ts";

/** Build the native `messages-v1` payload for Amazon Nova InvokeModel. */
export function buildNovaInvokePayload(
  messages: Message[],
  tools: Tool[],
  maxOutputTokens?: number,
): Record<string, unknown> {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => ({ text: message.content }));
  const conversation: Array<Record<string, unknown>> = [];

  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      conversation.push({
        role: "user",
        content: [{
          toolResult: {
            toolUseId: message.toolCallId ?? message.name ?? "unknown",
            content: [{ text: message.content }],
          },
        }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const calls = assistantCalls(message);
      conversation.push({
        role: "assistant",
        content: [
          ...(assistantText(message) ? [{ text: assistantText(message) }] : []),
          ...calls.map((call) => ({
            toolUse: {
              ...(call.id ? { toolUseId: call.id } : {}),
              name: call.tool,
              input: call.args,
            },
          })),
        ],
      });
      continue;
    }

    conversation.push({ role: "user", content: [{ text: message.content }] });
  }

  const toolSpecs = tools.length
    ? tools.map((tool) => ({
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: toolParameters(tool.parameters) },
        },
      }))
    : undefined;

  return {
    schemaVersion: "messages-v1",
    ...(system.length ? { system } : {}),
    messages: conversation,
    ...(toolSpecs ? { toolConfig: { tools: toolSpecs } } : {}),
    inferenceConfig: { maxTokens: outputLimit(maxOutputTokens), temperature: 0.3 },
  };
}

/** Parse a Nova InvokeModel response without treating an empty turn as success. */
export function parseNovaInvokeResponse(json: unknown): ModelTurn {
  const response = json && typeof json === "object" ? json as Record<string, any> : {};
  const content = Array.isArray(response.output?.message?.content)
    ? response.output.message.content
    : [];
  const message = content
    .filter((block: any) => typeof block?.text === "string")
    .map((block: any) => block.text)
    .join("");
  const toolCalls = content.flatMap((block: any) => {
    const use = block?.toolUse;
    if (!use || typeof use.name !== "string" || !use.name) return [];
    return [{
      ...(typeof use.toolUseId === "string" ? { id: use.toolUseId } : {}),
      tool: use.name,
      args: use.input && typeof use.input === "object" && !Array.isArray(use.input)
        ? use.input as Record<string, unknown>
        : {},
    }];
  });
  const stopReason = response.stopReason;
  const status = message || toolCalls.length ? "parsed" : "empty";

  return {
    message,
    toolCalls,
    done: Boolean(message) && toolCalls.length === 0 && stopReason === "end_turn",
    status,
    usage: response.usage
      ? usagePair(response.usage.inputTokens, response.usage.outputTokens)
      : undefined,
    usageSource: response.usage ? "provider" : undefined,
  };
}
