import { test } from "node:test";
import assert from "node:assert/strict";
import { DaemonClient, DaemonHttpError, parseChatEvent, type ChatEvent } from "../src/daemon/client";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A fetch stand-in that records calls and answers from a routing table. */
function fakeFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const call: Call = { url, method: init?.method ?? "GET", headers, body: init?.body as string | undefined };
    calls.push(call);
    const route = routes[`${call.method} ${path}`] ?? routes[path];
    if (!route) return new Response(JSON.stringify({ error: `no route ${path}` }), { status: 404 });
    return route(call);
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("health reads the version from the nested version object", async () => {
  const { impl } = fakeFetch({ "/api/health": () => json({ ok: true, version: { version: "1.0.0" } }) });
  const client = new DaemonClient("http://127.0.0.1:3141", "t", impl);
  assert.deepEqual(await client.health(), { ok: true, version: "1.0.0" });
});

test("requests carry the bearer token and never a query-string token", async () => {
  const { impl, calls } = fakeFetch({ "/api/budget": () => json({ usage: { dayUsd: 0.25, monthUsd: 1, totalUsd: 2 } }) });
  const client = new DaemonClient("http://127.0.0.1:3141", "secret-token", impl);
  const b = await client.budget();
  assert.equal(b.usage.dayUsd, 0.25);
  assert.equal(calls[0].headers.authorization, "Bearer secret-token");
  assert.ok(!calls[0].url.includes("secret-token"));
});

test("setProvider reads the current fallback and passes it back", async () => {
  const { impl, calls } = fakeFetch({
    "/api/providers/fallback": () =>
      json({
        allowed: true,
        explanation: "",
        steps: [
          { kind: "primary", providerId: "groq", modelId: "a" },
          { kind: "fallbackProvider", providerId: "openrouter", modelId: "b" },
        ],
      }),
    "POST /api/providers/set": () => json({ ok: true }),
  });
  const client = new DaemonClient("http://127.0.0.1:3141", "t", impl);
  await client.setProvider("groq", "llama-3.1-8b-instant");
  const post = calls.find((c) => c.method === "POST");
  assert.ok(post?.body);
  assert.deepEqual(JSON.parse(post.body), {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    fallbackProvider: "openrouter",
    fallbackModel: "b",
  });
});

test("setProvider sends null fallback when none is configured", async () => {
  const { impl, calls } = fakeFetch({
    "/api/providers/fallback": () => json({ allowed: true, explanation: "", steps: [{ kind: "primary", providerId: "x", modelId: "y" }] }),
    "POST /api/providers/set": () => json({ ok: true }),
  });
  await new DaemonClient("http://127.0.0.1:3141", "t", impl).setProvider("groq", "m");
  const body = JSON.parse(calls.find((c) => c.method === "POST")!.body!);
  assert.equal(body.fallbackProvider, null);
  assert.equal(body.fallbackModel, null);
});

test("approval decisions go to the decision route with the approved flag", async () => {
  const { impl, calls } = fakeFetch({
    "POST /api/approvals/a%2F1/decision": () => json({ ok: true, decision: "approved" }),
  });
  await new DaemonClient("http://127.0.0.1:3141", "t", impl).decideApproval("a/1", true);
  assert.equal(calls[0].url, "http://127.0.0.1:3141/api/approvals/a%2F1/decision");
  assert.equal(JSON.parse(calls[0].body!).approved, true);
});

test("HTTP errors carry the status and the daemon's message", async () => {
  const { impl } = fakeFetch({ "/api/budget": () => json({ error: "token expired" }, 401) });
  const client = new DaemonClient("http://127.0.0.1:3141", "t", impl);
  await assert.rejects(
    () => client.budget(),
    (err: unknown) => err instanceof DaemonHttpError && err.status === 401 && err.message === "token expired",
  );
});

test("chat streams events and stops at [DONE]", async () => {
  const frames = [
    'data: {"type":"status","status":"provider_ready","provider":"groq","model":"m"}\n\n',
    ": keepalive\n\n",
    'data: {"type":"token","text":"Hi"}\n\n',
    'data: {"type":"done","fullText":"Hi","finishReason":"stop"}\n\n',
    "data: [DONE]\n\n",
    'data: {"type":"token","text":"after done"}\n\n',
  ];
  const { impl } = fakeFetch({
    "POST /api/chat": () => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const f of frames) controller.enqueue(enc.encode(f));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  const client = new DaemonClient("http://127.0.0.1:3141", "t", impl);
  const events: ChatEvent[] = [];
  for await (const e of client.chat({ message: "x", mode: "ask" }, new AbortController().signal)) events.push(e);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["status", "token", "done"],
  );
  const done = events[2];
  assert.ok(done.kind === "done" && done.finishReason === "stop");
});

test("chat survives a frame split across chunks", async () => {
  const { impl } = fakeFetch({
    "POST /api/chat": () => {
      const enc = new TextEncoder();
      const parts = ['data: {"type":"tok', 'en","text":"split"}\n', "\ndata: [DONE]\n\n"];
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const p of parts) controller.enqueue(enc.encode(p));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    },
  });
  const client = new DaemonClient("http://127.0.0.1:3141", "t", impl);
  const texts: string[] = [];
  for await (const e of client.chat({ message: "x", mode: "ask" }, new AbortController().signal)) {
    if (e.kind === "token") texts.push(e.text);
  }
  assert.deepEqual(texts, ["split"]);
});

test("parseChatEvent maps the nested approval object and the done finish reason", () => {
  const approval = parseChatEvent({
    type: "approval_required",
    approval_required: { id: "x1", tool: "shell", reason: "why", riskTier: "high", preview: "rm -rf build" },
  });
  assert.ok(approval && approval.kind === "approval");
  assert.equal(approval.id, "x1");
  assert.equal(approval.tool, "shell");
  assert.equal(approval.reason, "why");
  assert.deepEqual(parseChatEvent({ type: "done", fullText: "f", finishReason: "error" }), {
    kind: "done",
    fullText: "f",
    finishReason: "error",
  });
});

test("parseChatEvent: untyped frames are narration, unknown types are dropped", () => {
  assert.deepEqual(parseChatEvent({ text: "▸ think (step 1/12)" }), { kind: "narration", text: "▸ think (step 1/12)" });
  assert.equal(parseChatEvent({ type: "mystery", text: "x" }), null);
  assert.equal(parseChatEvent("not an object"), null);
});
