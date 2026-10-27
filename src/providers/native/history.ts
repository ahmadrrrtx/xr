import type {
  Message,
  ModelTurn,
  ProviderStreamChunk,
  ToolCall,
  NativeContinuation,
} from "../../core/types.ts";
export function nativeBlocks(
  m: Message,
  providerId: string,
  modelId: string,
  format: NativeContinuation["format"],
): unknown[] | undefined {
  const n = m.native;
  return n?.providerId === providerId &&
    n.modelId === modelId &&
    n.format === format
    ? n.blocks
    : undefined;
}
export function assistantCalls(m: Message): ToolCall[] {
  if (Array.isArray(m.toolCalls)) return m.toolCalls;
  try {
    const j = JSON.parse(m.content);
    return Array.isArray(j.tool_calls) ? j.tool_calls : [];
  } catch {
    return [];
  }
}
export function assistantText(m: Message): string {
  if (m.role !== "assistant") return m.content;
  try {
    const j = JSON.parse(m.content);
    return typeof j.message === "string" && Array.isArray(j.tool_calls)
      ? j.message
      : m.content;
  } catch {
    return m.content;
  }
}
/** Buffered adapters honestly emit a whole turn, not fictional token deltas. */
export async function* chunksOfTurn(
  turn: ModelTurn,
  providerId: string,
  model: string,
): AsyncGenerator<ProviderStreamChunk> {
  if (turn.message) yield { text: turn.message, providerId, model };
  for (const tc of turn.toolCalls) yield { toolCall: tc, providerId, model };
  yield {
    usage: turn.usage,
    usageSource: turn.usageSource,
    native: turn.native,
    done: turn.done,
    error: turn.error,
    status: turn.status,
    finish: true,
    providerId,
    model,
  };
}
export function outputLimit(n?: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0
    ? Math.min(16_384, Math.floor(n))
    : 4096;
}
export function usagePair(input: unknown, output: unknown): ModelTurn["usage"] {
  return typeof input === "number" &&
    typeof output === "number" &&
    Number.isSafeInteger(input) &&
    Number.isSafeInteger(output) &&
    input >= 0 &&
    output >= 0
    ? { inTokens: input, outTokens: output }
    : undefined;
}
export function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("malformed native tool arguments: expected object");
  return value as Record<string, unknown>;
}
