/** XR Daemon — chat routes.
 *
 * Phase 03 · T3.4–T3.10, T3.13–T3.18, T3.22–T3.23.
 *
 * Previously this route orchestrated the provider directly:
 *
 *   request → buildProvider() → provider.chat() → fullText → SSE
 *
 * That bypassed AgentService / the Runner / Execution Fabric / Policy / Memory
 * / Audit / Checkpoints — a separate "dashboard agent" (the exact divergence the
 * forensic audit and Phase 03 forbid).
 *
 * Now this route is an HTTP ADAPTER over the SAME canonical execution path the
 * CLI uses:
 *
 *   HTTP request → validate → authenticate (server) → acquire execution lane →
 *   AgentService.runTask() → Runner → Provider · Tools · Policy · Memory ·
 *   Audit · Checkpoints → streamed result
 *
 * The route owns HTTP concerns (parsing, SSE framing, status codes) only; it
 * never builds a provider or runs an agent loop itself.
 */

import { randomUUID } from "node:crypto";
import type { Mode } from "../../core/types.ts";
import { LaneBusyError } from "../../execution/lane.ts";
import { ProviderOfflineError } from "../agent-executor.ts";
import { route, type DaemonRoute } from "./router.ts";
import { chatSpan as makeChatSpan, endChatSpan as endGenAiSpan } from "../../observability/instrument.ts";
import { withSpan as runInSpan } from "../../observability/tracer.ts";
import { xrMetrics } from "../../observability/metrics.ts";

/** Chat request body (typed, minimal surface). */
interface ChatBody {
  message?: string;
  /** Legacy continuity field. The canonical loop maintains continuity via the
   * session store, so history is accepted for compatibility and passed along
   * as context metadata rather than replayed through a provider directly. */
  history?: Array<{ role: string; content: string }>;
  mode?: "agent" | "ask" | "plan";
  /** Explicit execution mode gate. Default is the SAFE read-only `ask` mode. */
  stream?: boolean;
  provider?: string;
  model?: string;
  budget?: number;
  maxTokens?: number;
  maxSteps?: number;
  sessionId?: string;
  toolsAllow?: string[];
  toolsDeny?: string[];
}

/** Strip ANSI control sequences from a CLI say() line for the dashboard. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "").replace(/^\s+|\s+$/g, "");
}

export function chatRoutes(): DaemonRoute[] {
  return [
    route({
      id: "chat.stream.post",
      path: "/api/chat",
      method: "POST",
      handle: async ({ req, json, sse, state }) => {
        try {
          const body = (await req.json()) as ChatBody;
          if (!body?.message || typeof body.message !== "string") {
            return json({ error: "expected { message: string }" }, 400);
          }

          // Phase 03 — explicit execution mode. Default is the SAFE read-only
          // mode; `agent` mode is granted tools per policy (dangerous tools
          // still require approval — never auto-allowed).
          const mode: Mode =
            body.mode === "agent" || body.mode === "plan" ? body.mode : "ask";

          const executor = state.agentExecutor;
          if (!executor) {
            return json({ error: "agent executor unavailable" }, 503);
          }

          // Lane key: serialize per workspace/session so concurrent runs cannot
          // corrupt transcript/checkpoint state (Phase 03 · T3.11).
          const laneKey =
            body.sessionId ??
            state.workspaceManager.getActiveId() ??
            "default";

          // Backward-compatibility guard (Phase 01 contract, preserved by T3.22):
          // the executor's bounded, SHARED-health pre-flight answers 503
          // "Provider offline" when the effective provider chain is unreachable,
          // BEFORE the SSE stream is opened.
          await executor.preflight();

          // A busy lane returns a retryable 429 BEFORE the SSE stream is opened,
          // instead of a doomed 200 stream that immediately reports busy.
          const release = await executor.acquireLane(laneKey, {
            timeoutMs: 30_000,
          });

          // Cooperative cancellation: the client dropping the stream aborts the
          // run's signal, and the loop wraps up honestly at its next checkpoint.
          const runController = new AbortController();
          let released = false;
          const releaseOnce = () => {
            if (released) return;
            released = true;
            release();
          };

          const stream = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder();
              let done = false;
              const send = (data: object) => {
                if (done) return;
                controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
              };
              const close = () => {
                if (done) return;
                done = true;
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
                releaseOnce();
                controller.close();
              };

              // Immediate acknowledgement (Phase 03 · T3.9) — never wait for the
              // provider's complete response before acknowledging.
              const runId = `dash_${randomUUID().slice(0, 8)}`;
              send({ acknowledged: true, runId, mode });

              const started = Date.now();
              const span = makeChatSpan({ model: body.model ?? "unknown", provider: body.provider ?? "unknown", prompt: body.message! });

              await runInSpan(span, async () => {
                try {
                  const result = await executor.runHeld(body.message!, mode, {
                    runId,
                    laneKey,
                    sessionId: body.sessionId,
                    provider: body.provider,
                    model: body.model,
                    budget: body.budget,
                    maxTokens: body.maxTokens,
                    maxSteps: body.maxSteps,
                    toolsAllow: body.toolsAllow,
                    toolsDeny: body.toolsDeny,
                    surface: "daemon",
                    signal: runController.signal,
                    // Streaming (Phase 03 · T3.8): the loop's incremental output
                    // is forwarded as text events as it is produced.
                    say: (line) => send({ text: stripAnsi(line) }),
                    // Approval (Phase 03 · T3.6): dangerous tools always surface
                    // an approval event and are DENIED by default (safe default;
                    // a dashboard approval UI can upgrade this later). Policy is
                    // never weakened for HTTP.
                    approve: async (req) => {
                      send({ approval_required: { tool: req.tool, reason: req.reason, args: req.args } });
                      return false;
                    },
                  });

                  endGenAiSpan(span, {
                    ok: result.stopped === "done",
                    outTokens: undefined,
                    finishReason: result.stopped,
                  });
                  xrMetrics.llmDuration.observe({ provider: body.provider ?? "unknown", model: body.model ?? "unknown" }, Date.now() - started);

                  if (result.stopped === "cancelled") {
                    send({ cancelled: true, finalMessage: result.finalMessage, steps: result.steps });
                  } else {
                    send({ done: true, finalMessage: result.finalMessage, steps: result.steps, stopped: result.stopped });
                  }
                  state.store.audit("chat.message", {
                    mode,
                    stopped: result.stopped,
                    steps: result.steps,
                    input: body.message!.slice(0, 200),
                    output: result.finalMessage.slice(0, 200),
                  });
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  endGenAiSpan(span, { ok: false, errorType: (e as Error)?.name ?? "Error" });
                  send({ error: msg });
                } finally {
                  close();
                }
              });
            },
            cancel() {
              // Client dropped the stream → cooperative cancellation.
              runController.abort();
              releaseOnce();
            },
          });

          return sse(stream);
        } catch (e) {
          if (e instanceof ProviderOfflineError) {
            // Phase 01 contract: fast, honest 503 when the provider is offline.
            return json({ error: `Provider offline: ${e.message}` }, 503);
          }
          if (e instanceof LaneBusyError) {
            // Retryable: the same workspace/session is already executing.
            return json({ error: e.message, retryable: true, lane: e.key }, 429);
          }
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
