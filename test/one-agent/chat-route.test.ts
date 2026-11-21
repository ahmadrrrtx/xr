/**
 * Phase 03 · T3.8/T3.9/T3.10/T3.11 + T3.24 — daemon chat route as an HTTP
 * adapter over the canonical AgentService.
 *
 * Uses a mock AgentExecutor so the test is deterministic (no kernel boot, no
 * provider): proves the route streams incremental output, acknowledges
 * immediately, defaults to the safe `ask` mode, propagates cancellation,
 * preserves the Phase-01 503 contract, and returns 429 when the lane is busy.
 */
import { test, expect } from "bun:test";
import { chatRoutes } from "../../src/daemon/routes/chat.routes.ts";
import type { DaemonRouteContext, DaemonState } from "../../src/daemon/routes/router.ts";
import { LaneBusyError } from "../../src/execution/lane.ts";
import { ProviderOfflineError } from "../../src/daemon/agent-executor.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function sse(stream: ReadableStream): Response {
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

const auth = { authorization: "Bearer x", "content-type": "application/json" };

interface RecordedCall {
  task: string;
  mode: string;
  signal: AbortSignal | null;
  say: ((line: string) => void) | null;
  approve: ((req: { tool: string }) => Promise<boolean>) | null;
}

function makeExecutor(overrides: {
  result?: { stopped: string; finalMessage: string; steps: number };
  sayLines?: string[];
  laneError?: Error | null;
  preflightError?: Error | null;
}) {
  const calls: RecordedCall[] = [];
  const executor = {
    async preflight() {
      if (overrides.preflightError) throw overrides.preflightError;
    },
    async acquireLane() {
      if (overrides.laneError) throw overrides.laneError;
      return () => {};
    },
    async runHeld(task: string, mode: string, opts: Record<string, unknown> & { say?: (l: string) => void; approve?: (r: { tool: string }) => Promise<boolean>; signal?: AbortSignal }) {
      calls.push({ task, mode, signal: opts.signal ?? null, say: opts.say ?? null, approve: opts.approve ?? null });
      for (const line of overrides.sayLines ?? []) opts.say?.(line);
      return overrides.result ?? { stopped: "done", finalMessage: "hello", steps: 1 };
    },
  };
  return { calls, executor };
}

function makeState(executor: unknown, audit: any[]): DaemonState {
  return {
    store: { audit: (e: string, d: unknown) => audit.push({ e, d }) } as any,
    shield: {} as any,
    workspaceManager: { getActiveId: () => "ws1" } as any,
    agentExecutor: executor as any,
  };
}

async function handleChat(req: Request, executor: unknown, audit: any[] = []): Promise<Response> {
  const route = chatRoutes()[0];
  const res = await route!.handle({
    json,
    sse,
    req,
    state: makeState(executor, audit),
  } as any as DaemonRouteContext);
  return res as Response;
}

async function collectSSE(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const out: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      out.push(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  return out;
}

test("chat streams incremental output: ack → text(s) → done, never one fullText", async () => {
  const { executor, calls } = makeExecutor({ sayLines: ["line one", "line two"] });
  const audit: any[] = [];
  const res = await handleChat(
    new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "hello" }) }),
    executor,
    audit,
  );
  expect(res.status).toBe(200);
  const events = (await collectSSE(res))
    .filter((f) => !f.includes("[DONE]"))
    .map((f) => JSON.parse(f.replace(/^data: /, "")));
  const types = events.map((e) => (e.acknowledged ? "ack" : e.done ? "done" : e.text ? "text" : e.error ? "error" : "other"));
  expect(types).toEqual(["ack", "text", "text", "done"]);
  expect(calls.length).toBe(1);
  expect(calls[0].mode).toBe("ask"); // safe default
  expect(calls[0].task).toBe("hello");
  expect(audit.some((a) => a.e === "chat.message" && a.d.mode === "ask")).toBe(true);
});

test("agent mode is honored and approval is denied by default (policy preserved)", async () => {
  const { executor, calls } = makeExecutor({});
  const res = await handleChat(
    new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "do work", mode: "agent" }) }),
    executor,
  );
  expect(res.status).toBe(200);
  await collectSSE(res);
  expect(calls[0].mode).toBe("agent");
  const approved = await calls[0].approve!({ tool: "write_file" });
  expect(approved).toBe(false);
});

test("cancellation: dropping the stream aborts the run's AbortSignal", async () => {
  const { executor, calls } = makeExecutor({});
  const res = await handleChat(
    new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "long task" }) }),
    executor,
  );
  const signal = calls[0]?.signal;
  await res.body!.cancel();
  expect(signal).toBeTruthy();
  expect(signal!.aborted).toBe(true);
});

test("busy lane returns a retryable 429 (never a doomed 200 stream)", async () => {
  const { executor } = makeExecutor({ laneError: new LaneBusyError("ws1", 30_000) });
  const res = await handleChat(
    new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "hello" }) }),
    executor,
  );
  expect(res.status).toBe(429);
  const body: any = await res.json();
  expect(body.retryable).toBe(true);
});

test("offline provider chain returns a fast 503 (Phase 01 contract preserved)", async () => {
  const { executor } = makeExecutor({ preflightError: new ProviderOfflineError("primary offline") });
  const res = await handleChat(
    new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify({ message: "hello" }) }),
    executor,
  );
  expect(res.status).toBe(503);
  const body: any = await res.json();
  expect(body.error).toContain("Provider offline");
});

// Hardening B13 — one terminal frame, one history bound.
const frames = async (res: Response) =>
  (await collectSSE(res)).filter((f) => !f.includes("[DONE]")).map((f) => JSON.parse(f.replace(/^data: /, "")));
const terminalFrames = (events: any[]) => events.filter((e) => e.done || e.type === "done" || e.type === "error" || e.error);
const chatReq = (body: unknown) => new Request("http://x/api/chat", { method: "POST", headers: auth, body: JSON.stringify(body) });

test("B13: a result without finalMessage ends with exactly one terminal frame, done, and is audited", async () => {
  const { executor } = makeExecutor({ result: { stopped: "done", steps: 1 } as any });
  const audit: any[] = [];
  const events = await frames(await handleChat(chatReq({ message: "hi" }), executor, audit));
  const terminal = terminalFrames(events);
  expect(terminal).toHaveLength(1);
  expect(terminal[0].type).toBe("done");
  expect(events.some((e) => e.code === "GENERATION_FAILED")).toBe(false);
  expect(audit.find((a) => a.e === "chat.message")?.d.output).toBe("");
});

test("B13: the audit is written before the terminal frame, so a failing audit can never follow a done frame", async () => {
  const { executor } = makeExecutor({});
  const failingAudit: any = { push() { throw new Error("audit chain corrupted"); } };
  const terminal = terminalFrames(await frames(await handleChat(chatReq({ message: "hi" }), executor, failingAudit)));
  expect(terminal).toHaveLength(1);
  expect(terminal[0].code).toBe("GENERATION_FAILED");
  expect(terminal[0].done).toBeUndefined();
});

test("B13: replayed history is bounded once, by the loop's own rule (newest 24 turns / 24k chars)", async () => {
  const { executor } = makeExecutor({});
  const seen: any[] = [];
  const run = executor.runHeld;
  executor.runHeld = async (task, mode, opts) => { seen.push(opts.history); return run(task, mode, opts); };
  const history = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turn ${i} ${"x".repeat(1500)}` }));
  await collectSSE(await handleChat(chatReq({ message: "next", history }), executor));
  const passed = seen[0] as Array<{ content: string }>;
  expect(passed.length).toBeLessThanOrEqual(24);
  expect(passed.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(24_000);
  expect(passed.at(-1)!.content.startsWith("turn 99 ")).toBe(true); // newest first to survive
});
