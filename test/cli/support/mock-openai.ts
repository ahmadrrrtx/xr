/**
 * Phase 23 — a scripted OpenAI-compatible chat server for CLI tests.
 *
 * It speaks `POST /v1/chat/completions` with SSE streaming (and plain JSON when
 * `stream` is false). Behaviour is driven by markers in the latest user message:
 *
 *   [[write path=<p> content=<c>]]   → tool call write_file
 *   [[shell cmd=<c>]]                → tool call shell
 *   [[read path=<p>]]                → tool call read_file
 *   [[fail]]                         → HTTP 500 (provider failure)
 *   anything else                    → streamed text "mock reply: <text>"
 *
 * After a tool result arrives, the server answers with a short final message that
 * quotes the result, so tests can assert the whole loop ran.
 */

export interface MockServer {
  url: string;
  port: number;
  /** Every request body the server received, in order. */
  requests: any[];
  stop(): void;
}

type Msg = { role: string; content?: string | null; tool_call_id?: string };

export function startMockOpenAI(opts: { port?: number } = {}): MockServer {
  const requests: any[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || !url.pathname.endsWith("/chat/completions")) {
        return new Response("not found", { status: 404 });
      }
      const body = (await req.json()) as { messages: Msg[]; stream?: boolean; tools?: unknown[] };
      requests.push(body);
      const plan = planFor(body.messages);
      if (plan.kind === "fail") return new Response("mock failure", { status: 500 });
      if (body.stream === false) return Response.json(completionJson(plan));
      return new Response(sse(plan), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    port: server.port!,
    requests,
    stop: () => server.stop(true),
  };
}

type Plan =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "fail" };

function lastUserText(messages: Msg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

function planFor(messages: Msg[]): Plan {
  const last = messages[messages.length - 1];
  const content = typeof last?.content === "string" ? last.content : "";
  // A tool result came back (as a tool message, or as delimited data in a user message): finish the turn.
  if (last?.role === "tool" || content.includes("XR_TOOL_DATA")) {
    const data = content.includes("<<<XR_TOOL_DATA") ? content.split("<<<XR_TOOL_DATA\n")[1]?.split("\nXR_TOOL_DATA")[0] ?? "" : content;
    return { kind: "text", text: `Done. Tool said: ${data.split("\n")[0]?.slice(0, 200) ?? ""}` };
  }
  const user = lastUserText(messages);
  if (/\[\[fail\]\]/.test(user)) return { kind: "fail" };
  const w = user.match(/\[\[write path=(\S+) content=(.*?)\]\]/s);
  if (w) return { kind: "tool", name: "write_file", args: { path: w[1], content: w[2] } };
  const s = user.match(/\[\[shell cmd=(.*?)\]\]/s);
  if (s) return { kind: "tool", name: "shell", args: { cmd: s[1]!.trim() } };
  const r = user.match(/\[\[read path=(\S+?)\]\]/);
  if (r) return { kind: "tool", name: "read_file", args: { path: r[1] } };
  return { kind: "text", text: `mock reply: ${user.replace(/\[\[[\s\S]*?\]\]/g, "").trim().slice(0, 400)}` };
}

type ModelPlan = Exclude<Plan, { kind: "fail" }>;

function chunksFor(plan: ModelPlan): string[] {
  // Split into word-sized pieces so streaming is exercised.
  return plan.kind === "text" ? plan.text.split(/(?<=\s)/).filter(Boolean) : [];
}

function sse(plan: ModelPlan): string {
  const frames: string[] = [];
  const push = (obj: unknown) => frames.push(`data: ${JSON.stringify(obj)}\n\n`);
  if (plan.kind === "text") {
    for (const piece of chunksFor(plan)) push({ choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 40 } });
  } else {
    push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: `call_${plan.name}`, type: "function", function: { name: plan.name, arguments: JSON.stringify(plan.args) } }],
          },
          finish_reason: null,
        },
      ],
    });
    push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  }
  frames.push("data: [DONE]\n\n");
  return frames.join("");
}

function completionJson(plan: ModelPlan): unknown {
  if (plan.kind === "text") {
    return {
      id: "mock",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: plan.text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    };
  }
  return {
    id: "mock",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `call_${plan.name}`, type: "function", function: { name: plan.name, arguments: JSON.stringify(plan.args) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}
