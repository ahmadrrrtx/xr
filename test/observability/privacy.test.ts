/**
 * XR Phase 8 · T2 — THE PRIVACY GATE (merge-blocking; Art. XXI).
 *
 * Proves, against live behavior:
 *   1. Telemetry defaults to DISABLED and a disabled plane performs ZERO
 *      network operations (instrumented fetch proof).
 *   2. No prompt/tool content is captured by default — in spans, in logs,
 *      in metrics, and in exported OTLP payloads.
 *   3. The redactor removes PII/secrets from EVERY signal (pre-export,
 *      non-bypassable — the Span itself enforces it in set()/addEvent()).
 *   4. Content opt-in flags work but STILL redact secrets.
 *   5. Cardinality budgets fold overflow into xr_other.
 *
 * If any of these regress, Phase 8 is NOT done (no exceptions).
 */

import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import {
  resetObservability,
  initObservability,
  shutdownObservability,
  setTelemetryConfig,
  defaultTelemetryConfig,
  telemetry,
  resetTracerState,
  resetMetrics,
  chatSpan,
  endChatSpan,
  startSpan,
  onSpanRecorded,
  redactString,
  redactAttributes,
  structuredLog,
  setLogWriter,
  renderPrometheus,
  registerMetric,
  Counter,
  OtlpExporter,
  GENAI,
  type SpanData,
  type LogRecord,
} from "../../src/observability/index.ts";

beforeEach(async () => {
  await resetObservability();
  setTelemetryConfig(defaultTelemetryConfig());
  resetTracerState();
  resetMetrics();
  setLogWriter(() => {});
});

afterEach(async () => {
  await shutdownObservability();
  await resetObservability();
});

const SECRET = "sk-live-abcdef0123456789SECRETKEY";
const USER_PROMPT = `Refactor the auth module. My key is ${SECRET} and email dev@example.com`;

test("1a — telemetry config defaults to DISABLED (opt-in)", () => {
  expect(defaultTelemetryConfig().enabled).toBe(false);
  expect(defaultTelemetryConfig().content.prompt).toBe(false);
  expect(defaultTelemetryConfig().content.toolArgs).toBe(false);
  expect(telemetry().enabled).toBe(false);
});

test("1b — disabled telemetry performs ZERO network operations", async () => {
  const calls: string[] = [];
  const fetchSpy = async (input: string | URL): Promise<Response> => {
    calls.push(String(input));
    return new Response("{}");
  };
  initObservability({
    fileConfig: { enabled: false },
    fetchImpl: fetchSpy,
  });
  // Do real work: spans record, metrics increment.
  const tmp = mkdtempSync(join(tmpdir(), "xr-priv-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const handle = makeHandler(store, "priv-token");
  await handle(new Request("http://127.0.0.1:7842/api/v1/health"));
  const span = chatSpan({ model: "m", provider: "p", prompt: USER_PROMPT });
  endChatSpan(span, { ok: true, inTokens: 3, outTokens: 4 });
  structuredLog("info", "test.event", { prompt: USER_PROMPT });
  await new Promise((r) => setTimeout(r, 50));
  expect(calls).toEqual([]);
  store.close();
});

test("2 — no prompt/tool content captured BY DEFAULT (all signals)", () => {
  const recorded: SpanData[] = [];
  onSpanRecorded((s) => recorded.push(s));
  const logs: LogRecord[] = [];
  setLogWriter((_, r) => logs.push(r));

  const span = chatSpan({ model: "m1", provider: "ollama", prompt: USER_PROMPT });
  endChatSpan(span, { ok: true, inTokens: 5, outTokens: 9 });

  // Structured fields a caller might pass to a log line are redacted.
  structuredLog("info", "llm.chat", { prompt: USER_PROMPT, model: "m1" });
  renderPrometheus();

  for (const s of recorded) {
    expect(JSON.stringify(s)).not.toContain(USER_PROMPT);
    expect(s.attributes[GENAI.CONTENT_PROMPT]).toBeUndefined();
  }
  for (const l of logs) {
    expect(JSON.stringify(l)).not.toContain(SECRET);
    expect(JSON.stringify(l)).not.toContain("dev@example.com");
  }
});

test("3 — redactor corpus: secrets/PII are removed from every pattern class", () => {
  const cases: Array<[string, string]> = [
    [`key sk-abc123XYZ-secret-value`, "api_key"],
    [`Bearer abcdef12345678token`, "credential"],
    [`token=supersecrettoken123`, "credential"],
    [`JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c`, "jwt"],
    [`aws AKIAIOSFODNN7EXAMPLE key`, "api_key"],
    [`email me at dev@example.com`, "email"],
    [`card 5234 5678 9012 3456`, "card_number"],
    [`path /home/ahmadsecret/project/x`, "home"],
    [`host on 192.168.1.44 today`, "ip"],
  ];
  for (const [input, kind] of cases) {
    const out = redactString(input);
    expect(out).toContain(`⟨redacted:${kind}⟩`);
    expect(out).not.toContain(input.slice(5, input.length - 1));
  }
  const attrs = redactAttributes({ a: `uses ${SECRET}`, n: 42, ok: true });
  expect(JSON.stringify(attrs)).toContain("⟨redacted:");
  expect(attrs.n).toBe(42);
});

test("3b — the Span itself enforces redaction (no raw path exists)", () => {
  const span = startSpan("enforced");
  span.set("note", `debugging with ${SECRET}`);
  span.addEvent("checkpoint", { value: `Bearer ${SECRET} end` });
  const data = span.end();
  expect(JSON.stringify(data)).not.toContain(SECRET);
  expect(JSON.stringify(data.attributes)).toContain("⟨redacted:");
  expect(JSON.stringify(data.events)).toContain("⟨redacted:");
});

test("4 — explicit content opt-in works BUT still redacts secrets", () => {
  const cfg = defaultTelemetryConfig();
  cfg.content.prompt = true;
  setTelemetryConfig(cfg);

  const span = chatSpan({ model: "m", provider: "p", prompt: USER_PROMPT });
  endChatSpan(span, { ok: true });
  const data = span.snapshot();
  // Opted in: the prompt attribute exists…
  const captured = String(data.attributes[GENAI.CONTENT_PROMPT] ?? "");
  expect(captured).toContain("Refactor the auth module");
  // …but secrets/PII inside were redacted by the non-bypassable pipeline.
  expect(captured).not.toContain(SECRET);
  expect(captured).not.toContain("dev@example.com");
  expect(captured).toContain("⟨redacted:");
});

test("5 — cardinality budgets fold overflow into xr_other (+ overflow counter)", () => {
  const cfg = defaultTelemetryConfig();
  cfg.cardinality = { ...cfg.cardinality, test_bounded_counter: 5 };
  setTelemetryConfig(cfg);
  const c = registerMetric(new Counter("test_bounded_counter", "bounded"));
  for (let i = 0; i < 100; i++) c.inc({ value: `user-${i}` });
  const text = renderPrometheus();
  expect(text).toContain('value="xr_other"');
  expect(text).toContain("xr_cardinality_overflow_total");
  // Budget respected: distinct user-* values NEVER exceed 5 + sentinel.
  const distinct = new Set([...text.matchAll(/value="([^"]+)"/g)].map((m) => m[1]));
  expect(distinct.has("xr_other")).toBe(true);
  expect([...distinct].filter((d) => d.startsWith("user-")).length).toBeLessThanOrEqual(5);
});

test("OTLP exporter batches spans and posts standard OTLP/HTTP+JSON", async () => {
  const cfg = defaultTelemetryConfig();
  cfg.enabled = true;
  cfg.exportMetrics = false;
  cfg.exportLogs = false;
  setTelemetryConfig(cfg);

  const posts: Array<{ url: string; body: any }> = [];
  const exporter = new OtlpExporter({
    batchMax: 100,
    fetchImpl: async (input, init) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response("", { status: 200 });
    },
  });
  exporter.start();
  const s1 = chatSpan({ model: "m", provider: "p", prompt: USER_PROMPT });
  endChatSpan(s1, { ok: true, inTokens: 2, outTokens: 3 });
  startSpan("sibling").end();
  await exporter.stop();

  expect(posts.length).toBe(1);
  expect(posts[0].url).toBe("http://127.0.0.1:4318/v1/traces");
  const spans = posts[0].body.resourceSpans[0].scopeSpans[0].spans;
  expect(spans.length).toBe(2);
  const names = spans.map((s: any) => s.name).sort();
  expect(names).toEqual(["chat m", "sibling"]);
  // OTLP payload is structural: the user's prompt content is absent.
  expect(JSON.stringify(posts[0].body)).not.toContain(USER_PROMPT);
  expect(JSON.stringify(posts[0].body)).not.toContain(SECRET);
  expect(exporter.stats.sentSpans).toBe(2);
});

test("OTLP exporter fails quiet (never throws; drops with backoff)", async () => {
  const cfg = defaultTelemetryConfig();
  cfg.enabled = true;
  setTelemetryConfig(cfg);
  const exporter = new OtlpExporter({
    backoffBaseMs: 1,
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  exporter.start();
  startSpan("doomed").end();
  // flush() must resolve, not reject.
  await exporter.flush();
  expect(exporter.stats.failedFlushes).toBeGreaterThan(0);
  await exporter.stop();
});

test("/metrics endpoint requires auth and exposes structural series only", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "xr-metrics-"));
  process.env.XR_HOME = join(tmp, "home");
  const store = new Store(join(tmp, "d.db"));
  const handle = makeHandler(store, "met-token");

  const denied = await handle(new Request("http://127.0.0.1:7842/api/v1/metrics"));
  expect(denied.status).toBe(401);

  await handle(new Request("http://127.0.0.1:7842/api/v1/overview", { headers: { authorization: "Bearer met-token" } }));
  const res = await handle(new Request("http://127.0.0.1:7842/api/v1/metrics", { headers: { authorization: "Bearer met-token" } }));
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(res.headers.get("content-type")).toContain("text/plain");
  expect(text).toContain("xr_http_requests_total");
  expect(text).toContain('route="overview.get"');
  expect(text).toContain("# EOF");
  store.close();
});
