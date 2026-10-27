/** Real loopback TCP SSE -> shipped adapter -> canonical envelope/accounting ->
 * actual desktop SSE parser + usage reducer. Deterministic provider bytes;
 * NOT live-vendor/native-IPC/billing or GUI evidence. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store";
import {
  assembleEnvelope,
  newEvidence,
} from "../../src/core/execution/envelope";
import { runEnvelope } from "../../src/core/execution/runner";
import { ToolRegistryService } from "../../src/tools/registry-service";
import { OpenAICompatProvider } from "../../src/providers/openai-compat";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker";
import { clearSecretMemo } from "../../src/security/secrets";
import { UsageAccumulator } from "../../desktop/src/engine/usage";
import { readSse } from "../../desktop/src/engine/sse";
let dir: string,
  store: WorkspaceStore,
  restore: Record<string, string | undefined>,
  unregister: () => void;
let server: ReturnType<typeof Bun.serve> | undefined;
const realFetch = globalThis.fetch;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-stream-settlement-"));
  restore = Object.fromEntries(
    ["XR_HOME", "XR_SECRET_BACKEND", "XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER"].map(
      (k) => [k, process.env[k]],
    ),
  );
  process.env.XR_HOME = join(dir, "home");
  process.env.XR_SECRET_BACKEND = "file";
  process.env.XR_DANGEROUS_ALLOW_PRIVATE_PROVIDER = "1";
  clearSecretMemo();
  globalThis.fetch = realFetch;
  store = new WorkspaceStore("default", join(dir, "store.db"));
  unregister = registerRuntimeSecretResolver(() => "fixture-only-no-real-key");
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  store.close();
  unregister();
  clearSecretMemo();
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(restore)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});
const encode = (x: unknown) =>
  new TextEncoder().encode(`data: ${JSON.stringify(x)}\r\n\r\n`);
async function fixture(
  kind: "final" | "partial-usage" | "abort" | "disconnect",
) {
  let calls = 0,
    closed = false;
  const events: any[] = [],
    controller = new AbortController();
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      calls++;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(
            encode({
              choices: [
                {
                  index: 0,
                  delta: { content: "streamed fixture answer" },
                  finish_reason: null,
                },
              ],
            }),
          );
          if (kind === "abort") return;
          if (kind === "disconnect") {
            setTimeout(() => {
              try {
                c.error(new Error("fixture upstream disconnect"));
              } catch {
                /* already cancelled */
              }
            }, 25);
            return;
          }
          c.enqueue(
            encode({
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage:
                kind === "final"
                  ? {
                      prompt_tokens: 13,
                      completion_tokens: 7,
                      total_tokens: 20,
                    }
                  : { prompt_tokens: 13 },
            }),
          );
          c.enqueue(new TextEncoder().encode("data: [DONE]\r\n\r\n"));
          c.close();
        },
        cancel() {
          closed = true;
        },
      });
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
  const p = new OpenAICompatProvider({
    id: "stream-fixture",
    label: "loopback fixture, not live",
    model: "stream-model",
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    apiKeyEnv: "FIXTURE_ONLY_KEY",
    capabilities: { streaming: true, functionCalling: true, toolUse: true, jsonMode: false },
  });
  const registry = new ToolRegistryService();
  const envelope = assembleEnvelope({
    intent: {
      task: "one bounded streaming response",
      mode: "ask",
      surface: "test",
      cwd: dir,
    },
    plan: { provider: p, providerId: p.id, modelId: p.modelId, maxSteps: 2 },
    policy: {
      budget: { maxUsd: 1, maxTokens: 20_000 },
      pricing: {
        inPerMTok: 1,
        outPerMTok: 1,
        source: "synthetic integration fixture tariff",
      },
      egressAllowlist: [],
      toolsAllow: [],
      dryRun: false,
      approve: async () => false,
    },
    placement: { placement: "in_process", registry, tools: [], collisions: [] },
    observation: { say() {} },
    evidence: newEvidence(),
  });
  const result = await runEnvelope(
    envelope,
    { store },
    {
      signal: controller.signal,
      onStreamEvent: (event: any) => {
        events.push(event);
        if (kind === "abort" && event.type === "token") controller.abort();
      },
    },
  );
  const rows = store
    .prepare(
      "SELECT provider,model,in_tokens,out_tokens,usd,usage_source FROM cost_events WHERE session_id=?",
    )
    .all(result.sessionId) as any[];
  // Exercise actual client SSE framing/reduction with emitted engine events;
  // the relay itself is a fixture, not a claimed native IPC integration.
  const bytes = new TextEncoder().encode(
    events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join(""),
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 7)
        c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
  const accumulator = new UsageAccumulator();
  let settlements = 0;
  await readSse(new Response(stream), (payload) => {
    const event = JSON.parse(payload);
    if (event.type === "usage") {
      settlements++;
      accumulator.add(event);
    }
  });
  return {
    result,
    rows,
    events,
    calls,
    closed: () => closed,
    settlements,
    accumulator,
  };
}
test("late final usage settles exactly once and desktop done summary never double charges", async () => {
  const r = await fixture("final");
  expect(r.result.stopped).toBe("done");
  expect(r.calls).toBe(1);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0]).toMatchObject({
    provider: "stream-fixture",
    model: "stream-model",
    in_tokens: 13,
    out_tokens: 7,
    usage_source: "provider",
  });
  expect(r.settlements).toBe(1);
  expect(r.accumulator.summary({ inTokens: 13, outTokens: 7 })).toEqual({
    inTokens: 13,
    outTokens: 7,
    usdEstimate: 0.00002,
  });
  expect(store.verifyChain().valid).toBe(true);
});
test("actually aborted in-flight TCP stream is cancelled and conservatively settled, never zero/free", async () => {
  const r = await fixture("abort");
  expect(r.result.stopped).toBe("cancelled");
  expect(r.calls).toBe(1);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].usage_source).toBe("estimated");
  expect(r.rows[0].usd).toBeGreaterThan(0);
  expect(r.rows[0].out_tokens).toBeGreaterThan(0);
  expect(r.accumulator.summary(undefined, false).usdEstimate).toBeNull();
  for (let i = 0; i < 20 && !r.closed(); i++) await Bun.sleep(10);
  expect(r.closed()).toBe(true);
});
test("upstream stream failure settles the real attempt once and is not displayed as completion", async () => {
  const r = await fixture("disconnect");
  expect(r.result.stopped).toBe("error");
  expect(r.calls).toBe(1);
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].usage_source).toBe("estimated");
  expect(r.rows[0].usd).toBeGreaterThan(0);
  expect(r.accumulator.summary(undefined, false).usdEstimate).toBeNull();
});
test("incomplete provider counters stay estimated rather than silently inventing missing zero tokens", async () => {
  const r = await fixture("partial-usage");
  expect(r.result.stopped).toBe("done");
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].usage_source).toBe("estimated");
  expect(r.rows[0].out_tokens).toBeGreaterThan(0);
  expect(r.rows[0].usd).toBeGreaterThan(0);
});
