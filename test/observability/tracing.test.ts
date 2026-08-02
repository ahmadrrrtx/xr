/**
 * XR Phase 8 · T2 — OTel trace structure: W3C ids, parent-child nesting
 * (sub-agents child naturally), daemon end-to-end server spans, and the
 * GenAI span archetypes (chat / execute_tool / invoke_agent / routing /
 * placement) with structural attributes only.
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import {
  resetObservability,
  setTelemetryConfig,
  defaultTelemetryConfig,
  startSpan,
  withSpan,
  currentSpan,
  onSpanRecorded,
  recentSpans,
  resetTracerState,
  TRACE_ID_RE,
  SPAN_ID_RE,
  chatSpan,
  endChatSpan,
  toolSpan,
  agentSpan,
  envelopeSpan,
  GENAI,
  HTTP,
} from "../../src/observability/index.ts";
import type { SpanData } from "../../src/observability/index.ts";

beforeEach(async () => {
  await resetObservability();
  const cfg = defaultTelemetryConfig();
  setTelemetryConfig(cfg);
  resetTracerState();
});

afterEach(async () => {
  await resetObservability();
});

test("spans carry W3C-shaped ids and child spans link to parents", () => {
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));

  const root = startSpan("GET /api/v1/x", { kind: "server" });
  expect(TRACE_ID_RE.test(root.traceId)).toBe(true);
  expect(SPAN_ID_RE.test(root.spanId)).toBe(true);

  withSpan(root, () => {
    const child = startSpan("chat qwen2.5:7b", { kind: "client" });
    expect(child.traceId).toBe(root.traceId); // one trace across the tree
    expect(child.parentSpanId).toBe(root.spanId);

    withSpan(child, () => {
      const grandchild = startSpan("execute_tool read_file", { kind: "internal" });
      expect(grandchild.parentSpanId).toBe(child.spanId);
      grandchild.end();
    });
    child.end();
  });
  root.end();

  expect(recorded.map((s) => s.name)).toEqual(["execute_tool read_file", "chat qwen2.5:7b", "GET /api/v1/x"]);
  // Depth: 3 nested levels in ONE trace — the sub-agent nesting shape.
  expect(new Set(recorded.map((s) => s.traceId)).size).toBe(1);
});

test("ambient context is available inside withSpan and cleared outside", () => {
  expect(currentSpan()).toBeUndefined();
  const s = startSpan("x");
  withSpan(s, () => {
    expect(currentSpan()?.spanId).toBe(s.spanId);
  });
  expect(currentSpan()).toBeUndefined();
  s.end();
});

test("GenAI chat span: structural attributes, token counts, NO content by default", () => {
  const span = chatSpan({ model: "qwen2.5:7b", provider: "ollama", prompt: "USER SECRET PROMPT CONTENT" });
  endChatSpan(span, { ok: true, inTokens: 11, outTokens: 7, finishReason: "stop" });
  const data = span.snapshot();
  expect(data.name).toBe("chat qwen2.5:7b");
  expect(data.attributes[GENAI.OPERATION_NAME]).toBe("chat");
  expect(data.attributes[GENAI.PROVIDER_NAME]).toBe("ollama");
  expect(data.attributes[GENAI.REQUEST_MODEL]).toBe("qwen2.5:7b");
  expect(data.attributes[GENAI.USAGE_INPUT_TOKENS]).toBe(11);
  expect(data.attributes[GENAI.USAGE_OUTPUT_TOKENS]).toBe(7);
  // Content opt-in is OFF — the prompt must not appear anywhere.
  expect(JSON.stringify(data)).not.toContain("USER SECRET PROMPT CONTENT");
  expect(data.attributes[GENAI.CONTENT_PROMPT]).toBeUndefined();
  expect(data.durationMs).toBeGreaterThanOrEqual(0);
});

test("GenAI tool/agent span archetypes follow {operation} {name}", () => {
  const tool = toolSpan({ name: "read_file", type: "function" });
  expect(tool.name).toBe("execute_tool read_file");
  expect(tool.snapshot().attributes[GENAI.TOOL_NAME]).toBe("read_file");
  tool.end();

  const agent = agentSpan({ name: "supervisor", id: "a1" });
  expect(agent.name).toBe("invoke_agent supervisor");
  expect(agent.snapshot().attributes[GENAI.AGENT_NAME]).toBe("supervisor");
  agent.end();
});

test("envelope span maps capability kinds to GenAI archetypes", () => {
  const tool = envelopeSpan({ capabilityKind: "mcp_tool", capabilityName: "github.search", runId: "r1" });
  expect(tool.name).toBe("execute_tool github.search");
  expect(tool.snapshot().attributes[GENAI.TOOL_TYPE]).toBe("mcp");
  tool.end();
  const chat = envelopeSpan({ capabilityKind: "model_call", capabilityName: "ollama:qwen2.5:7b" });
  expect(chat.name).toBe("chat ollama:qwen2.5:7b");
  chat.end();
});

test("daemon end-to-end: one request → root server span with route/mount/status/duration", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-obsrv-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const handle = makeHandler(store, "obs-token");
  const res = await handle(
    new Request("http://127.0.0.1:7842/api/v1/overview", { headers: { authorization: "Bearer obs-token" } }),
  );
  expect(res.status).toBe(200);

  const { spans } = recentSpans(10);
  const rootSpan = spans.find((s) => s.kind === "server" && s.name === "GET /api/overview");
  expect(rootSpan).toBeDefined();
  expect(rootSpan!.attributes[HTTP.ROUTE]).toBe("overview.get");
  expect(rootSpan!.attributes["xr.api.mount"]).toBe("v1");
  expect(rootSpan!.attributes[HTTP.STATUS_CODE]).toBe(200);
  expect(typeof rootSpan!.durationMs).toBe("number");
  store.close();
});

test("recent spans view is bounded (ring buffer drop counter)", () => {
  const cfg = defaultTelemetryConfig();
  cfg.ringBufferSize = 16;
  setTelemetryConfig(cfg);
  for (let i = 0; i < 40; i++) startSpan(`span-${i}`).end();
  const { spans, dropped } = recentSpans(100);
  expect(spans.length).toBe(16);
  expect(dropped).toBe(24);
  expect(spans[spans.length - 1].name).toBe("span-39");
});
