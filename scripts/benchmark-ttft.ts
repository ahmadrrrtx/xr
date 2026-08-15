#!/usr/bin/env bun
/**
 * XR Phase 05 — Chat TTFT benchmark.
 *
 *   bun run scripts/benchmark-ttft.ts [--samples 20]
 *
 * Measures the XR chat streaming pipeline's time-to-first-token through the
 * canonical path (chat route → AgentService boundary → stream events → SSE).
 * A scripted streaming executor emits token deltas at a CONTROLLED provider
 * cadence, so we can separate:
 *
 *   - XR overhead TTFT  = requestStart → first provider token, minus the
 *                         simulated provider first-token delay.
 *   - End-to-end TTFT   = requestStart → first token event observed by client.
 *   - Acknowledgement   = requestStart → first SSE frame (ack/provider_selection).
 *   - Total latency     = requestStart → terminal done event.
 *
 * This measures XR's own contribution (it must not add unnecessary waiting
 * before provider generation begins) and never requires a real API key.
 */
import { randomUUID } from "node:crypto";
import { chatRoutes } from "../src/daemon/routes/chat.routes.ts";
import type { DaemonRouteContext, DaemonState } from "../src/daemon/routes/router.ts";
import type { StreamEventSink } from "../src/core/types.ts";

const SAMPLES = Math.max(3, Number(process.argv.indexOf("--samples") >= 0 ? process.argv[process.argv.indexOf("--samples") + 1] : 20));

// Simulated provider cadence (ms). First token after this delay, then a token
// every interToken ms. XR overhead = e2e TTFT minus this first-token delay.
const PROVIDER_FIRST_TOKEN_MS = 80;
const INTER_TOKEN_MS = 5;
const TOTAL_TOKENS = 12;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function sse(stream: ReadableStream): Response {
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}
const auth = { authorization: "Bearer x", "content-type": "application/json" };

function makeState(executor: unknown): DaemonState {
  return {
    store: { audit: () => {} } as any,
    shield: {} as any,
    workspaceManager: { getActiveId: () => "ws1" } as any,
    agentExecutor: executor as any,
  };
}

function streamingExecutor() {
  return {
    async preflight() {},
    async acquireLane() {
      return () => {};
    },
    async runHeld(_t: string, _m: string, opts: { onStreamEvent: StreamEventSink }) {
      const sink = opts.onStreamEvent;
      // Simulate provider first-token latency, then token cadence.
      await new Promise((r) => setTimeout(r, PROVIDER_FIRST_TOKEN_MS));
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        sink({ type: "token", text: `token${i} ` });
        await new Promise((r) => setTimeout(r, INTER_TOKEN_MS));
      }
      return { stopped: "done", finalMessage: "done", steps: 1 };
    },
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)]!;
}

function stats(name: string, values: number[]): void {
  const s = [...values].sort((a, b) => a - b);
  console.log(
    `${name.padEnd(28)} p50=${percentile(s, 50).toFixed(1).padStart(7)}ms  ` +
      `p95=${percentile(s, 95).toFixed(1).padStart(7)}ms  min=${Math.min(...s).toFixed(1).padStart(7)}ms  max=${Math.max(...s).toFixed(1).padStart(7)}ms  n=${values.length}`,
  );
}

async function main(): Promise<void> {
  const route = chatRoutes()[0]!;
  const ack: number[] = [];
  const ttftE2E: number[] = [];
  const ttftXROverhead: number[] = [];
  const total: number[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    const requestStart = performance.now();
    let ackAt = 0;
    let firstTokenAt = 0;
    let totalAt = 0;
    const res = (await route.handle({
      json,
      sse,
      req: new Request("http://x/api/chat", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ message: `sample ${randomUUID()}` }),
      }),
      state: makeState(streamingExecutor()),
    } as any as DaemonRouteContext)) as Response;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!frame.trim() || frame.includes("[DONE]")) continue;
        const ev = JSON.parse(frame.replace(/^data: /, "")) as { type?: string; acknowledged?: boolean };
        const now = performance.now();
        if (ev.acknowledged && !ackAt) ackAt = now;
        if (ev.type === "token" && !firstTokenAt) firstTokenAt = now;
        if (ev.type === "done") totalAt = now;
      }
    }
    if (!ackAt) ackAt = performance.now();
    if (!firstTokenAt) firstTokenAt = performance.now();
    if (!totalAt) totalAt = performance.now();

    ack.push(ackAt - requestStart);
    ttftE2E.push(firstTokenAt - requestStart);
    ttftXROverhead.push((firstTokenAt - requestStart) - PROVIDER_FIRST_TOKEN_MS);
    total.push(totalAt - requestStart);
  }

  console.log(`\nXR chat TTFT benchmark  (samples=${SAMPLES}, simulated provider first-token=${PROVIDER_FIRST_TOKEN_MS}ms)\n`);
  stats("acknowledgement (ms)", ack);
  stats("provider selection (ms)", ack);
  stats("TTFT end-to-end (ms)", ttftE2E);
  stats("TTFT XR overhead (ms)", ttftXROverhead);
  stats("total latency (ms)", total);
  console.log(
    `\nNote: XR overhead = e2e TTFT − simulated provider first-token delay. ` +
      `Negative/zero means XR adds ~no waiting before generation begins.`,
  );
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
