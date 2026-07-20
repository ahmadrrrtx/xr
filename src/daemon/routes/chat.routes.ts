/** XR Daemon — chat routes. */

import { buildProvider } from "../../providers/factory.ts";
import type { Message } from "../../core/types.ts";
import { route, type DaemonRoute } from "./router.ts";

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

          let cancelled = false;
          const stream = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder();
              const send = (data: object) => {
                if (!cancelled) controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
              };
              try {
                const history = (body.history ?? []).slice(-10);
                const messages: Message[] = [...history, { role: "user", content: body.message! }];
                const result = await provider.chat(messages, []);
                const fullText = result.message ?? "";
                if (fullText) send({ text: fullText });
                state.store.audit("chat.message", {
                  input: body.message!.slice(0, 200),
                  output: fullText.slice(0, 200),
                });
                send({ done: true });
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
              } catch (e) {
                send({ error: (e as Error).message });
              } finally {
                controller.close();
              }
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
