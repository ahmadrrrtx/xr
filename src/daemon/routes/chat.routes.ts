/** XR Daemon — chat routes. */

import { buildProvider } from "../../providers/factory.ts";
import type { Message } from "../../core/types.ts";
import { route, type DaemonRoute } from "./router.ts";
import { chatSpan as makeChatSpan, endChatSpan as endGenAiSpan } from "../../observability/instrument.ts";
import { withSpan as runInSpan } from "../../observability/tracer.ts";
import { xrMetrics } from "../../observability/metrics.ts";

export function chatRoutes(): DaemonRoute[] {
  return [
    route({
      id: "chat.stream.post",
      path: "/api/chat",
      method: "POST",
      handle: async ({ req, json, sse, state, config }) => {
        try {
          const body = await req.json() as { message?: string; history?: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> };
          if (!body?.message) return json({ error: "expected { message: string }" }, 400);

          const provider = buildProvider(config, {});
          const health = await provider.health();
          if (!health.ok) return json({ error: `Provider offline: ${health.detail ?? "unreachable"}` }, 503);

          const model = (config as { defaults?: { model?: string } }).defaults?.model ?? "unknown";
          const providerName = provider.id || (config as { defaults?: { provider?: string } }).defaults?.provider || "unknown";

          let cancelled = false;
          const stream = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder();
              const send = (data: object) => {
                if (!cancelled) controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
              };
              // Phase 8 · T2 — GenAI `chat` span (structural: model/provider/
              // token counts only; prompt text requires explicit opt-in).
              const started = Date.now();
              const span = makeChatSpan({ model, provider: providerName, prompt: body.message! });
              await runInSpan(span, async () => {
                try {
                  const history = (body.history ?? []).slice(-10);
                  const messages: Message[] = [
                    ...history,
                    { role: "user", content: body.message! },
                  ];
                  const result = await provider.chat(messages, []);
                  const fullText = result.message ?? "";
                  if (fullText) send({ text: fullText });
                  endGenAiSpan(span, {
                    ok: true,
                    inTokens: result.usage?.inTokens,
                    outTokens: result.usage?.outTokens,
                    finishReason: "stop",
                  });
                  xrMetrics.llmDuration.observe({ provider: providerName, model }, Date.now() - started);
                  if (result.usage?.inTokens) xrMetrics.llmTokens.inc({ provider: providerName, model, kind: "input" }, result.usage.inTokens);
                  if (result.usage?.outTokens) xrMetrics.llmTokens.inc({ provider: providerName, model, kind: "output" }, result.usage.outTokens);
                  state.store.audit("chat.message", {
                    input: body.message!.slice(0, 200),
                    output: fullText.slice(0, 200),
                  });
                  send({ done: true });
                  controller.enqueue(enc.encode("data: [DONE]\n\n"));
                } catch (e) {
                  endGenAiSpan(span, { ok: false, errorType: (e as Error)?.name ?? "Error" });
                  send({ error: (e as Error).message });
                } finally {
                  controller.close();
                }
              });
            },
            cancel() { cancelled = true; },
          });

          return sse(stream);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
