/** Attempt observability/admission at the provider composition seam. A fallback
 * cannot hide its identity, usage or another network request behind one turn. */
import { ProviderAbortError } from "./request-guard.ts";
class ProviderAccountingError extends Error {
  constructor(phase: "admission" | "settlement" = "settlement") {
    super(
      phase === "admission"
        ? "Attempt admission failed; no request sent; retries refused"
        : "Attempt settlement failed; further retries are refused",
    );
    this.name = "ProviderAccountingError";
  }
}
async function admit(
  options: ChatOptions | undefined,
  target: { providerId: string; modelId?: string; fallback: boolean },
): Promise<void> {
  try {
    await options?.beforeAttempt?.(target);
  } catch (error) {
    if (
      (error instanceof ProviderAbortError && error.kind === "cancelled") ||
      (error as Error)?.name === "ProviderBudgetAdmissionError"
    )
      throw error;
    // Database/audit/admission failures are not provider faults. In particular,
    // a misleading "unavailable/503" must not send a retry or a fallback.
    throw new ProviderAccountingError("admission");
  }
}
import type {
  ChatOptions,
  Message,
  ModelTurn,
  Provider,
  ProviderStreamChunk,
  Tool,
} from "../core/types.ts";
export async function chatAttempt(
  provider: Provider,
  messages: Message[],
  tools: Tool[],
  options?: ChatOptions,
  fallback = false,
): Promise<ModelTurn> {
  const target = { providerId: provider.id, modelId: provider.modelId };
  await admit(options, { ...target, fallback });
  let turn: ModelTurn;
  try {
    turn = await provider.chat(messages, tools, options);
  } catch (error) {
    try {
      await options?.afterAttempt?.({ ...target, error });
    } catch {
      throw new ProviderAccountingError();
    }
    throw error;
  }
  turn.executing = target;
  try {
    await options?.afterAttempt?.({ ...target, turn });
  } catch {
    throw new ProviderAccountingError();
  }
  return turn;
}
export async function* streamAttempt(
  provider: Provider,
  messages: Message[],
  tools: Tool[],
  options?: ChatOptions,
  fallback = false,
): AsyncGenerator<ProviderStreamChunk> {
  if (!provider.chatStream || provider.capabilities?.streaming === false) {
    const turn = await chatAttempt(
      provider,
      messages,
      tools,
      options,
      fallback,
    );
    const { chunksOfTurn } = await import("./native/history.ts");
    yield* chunksOfTurn(turn, provider.id, provider.modelId ?? "");
    return;
  }
  const target = { providerId: provider.id, modelId: provider.modelId };
  await admit(options, { ...target, fallback });
  const turn: ModelTurn = {
    message: "",
    toolCalls: [],
    done: false,
    executing: target,
  };
  let failure: unknown;
  let complete = false;
  try {
    for await (const c of provider.chatStream(messages, tools, options)) {
      if (c.text) turn.message += c.text;
      if (c.toolCall) turn.toolCalls.push(c.toolCall);
      if (c.usage) {
        turn.usage = c.usage;
        turn.usageSource = c.usageSource;
      }
      if (c.native) turn.native = c.native;
      if (c.done !== undefined) turn.done = c.done;
      if (c.error) turn.error = c.error;
      yield { ...c, providerId: target.providerId, model: target.modelId };
    }
    complete = true;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!complete && !failure)
      failure = new Error("stream consumer stopped before completion");
    try {
      await options?.afterAttempt?.({
        ...target,
        turn,
        ...(failure ? { error: failure } : {}),
      });
    } catch {
      throw new ProviderAccountingError();
    }
  }
}
