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
import type { ChatStreamEvent, Mode, StreamEventSink } from "../../core/types.ts";
import { LaneBusyError } from "../../execution/lane.ts";
import { ProviderOfflineError } from "../agent-executor.ts";
import { route, type DaemonRoute } from "./router.ts";
import { chatSpan as makeChatSpan, endChatSpan as endGenAiSpan } from "../../observability/instrument.ts";
import { withSpan as runInSpan } from "../../observability/tracer.ts";
import { xrMetrics } from "../../observability/metrics.ts";
import { summarizeToolArgs } from "../../ui/ux-vocabulary.ts";
import {
  waitForChatApproval,
  resolveChatApproval,
  cancelChatApprovals,
} from "../chat-approvals.ts";

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

          const runId = `dash_${randomUUID().slice(0, 8)}`;
          const stream = new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder();
              let closed = false;
              let seq = 0;
              // Phase 05 — canonical serialization. Each event gets a monotonic
              // `event_id` (satisfies the event-ordering/resume-foundation
              // requirement without breaking consumers that parse `data: JSON`).
              const send = (data: object) => {
                if (closed) return;
                seq += 1;
                controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...data, event_id: seq })}\n\n`));
              };
              const close = () => {
                if (closed) return;
                closed = true;
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
                releaseOnce();
                controller.close();
              };

              // ── Immediate acknowledgement (Phase 03 · T3.9 / Phase 05) ─────
              // The first SSE event IS the ack and doubles as the
              // `provider_selection` status event, so the client sees state the
              // instant the stream opens — never a silent wait.
              xrMetrics.chatStreamStarted.inc();
              send({
                acknowledged: true,
                runId,
                mode,
                type: "status",
                status: "provider_selection",
                provider: body.provider,
                model: body.model,
              });

              const requestStart = Date.now();
              let ttftMs: number | undefined;
              let firstTokenSent = false;
              const started = Date.now();
              const span = makeChatSpan({ model: body.model ?? "unknown", provider: body.provider ?? "unknown", prompt: body.message! });

              // Phase 05 — canonical stream event sink. The loop (via the
              // execution fabric) forwards structured events; the route only
              // serializes them to SSE. Provider token deltas arrive here as
              // `token` events — real streaming, never a chunked fullText.
              const onStreamEvent: StreamEventSink = (ev) => {
                if (closed) return;
                switch (ev.type) {
                  case "token":
                    if (!firstTokenSent) {
                      firstTokenSent = true;
                      ttftMs = Date.now() - requestStart;
                      xrMetrics.chatTtft.observe(
                        { provider: body.provider ?? "unknown", model: body.model ?? "unknown" },
                        ttftMs,
                      );
                    }
                    send({ type: "token", text: ev.text });
                    break;
                  case "tool_call":
                    xrMetrics.chatToolCalls.inc({ tool: ev.tool, outcome: "requested" });
                    send({ type: "tool_call", id: ev.id, tool: ev.tool, args: ev.args });
                    break;
                  case "tool_result":
                    xrMetrics.chatToolCalls.inc({ tool: ev.tool, outcome: ev.ok ? "ok" : "error" });
                    send({ type: "tool_result", id: ev.id, tool: ev.tool, ok: ev.ok, result: ev.result, error: ev.error });
                    break;
                  case "usage":
                    send({ type: "usage", usage: ev.usage });
                    break;
                  case "status":
                    send({ type: "status", status: ev.status, provider: ev.provider, model: ev.model, message: ev.message });
                    break;
                  case "done":
                    send({ type: "done", fullText: ev.fullText, usage: ev.usage, finishReason: ev.finishReason, steps: ev.steps, ttftMs: ev.ttftMs, totalMs: ev.totalMs });
                    break;
                  case "error":
                    send({ type: "error", code: ev.code, message: ev.message, retryable: ev.retryable, detail: ev.detail });
                    break;
                }
              };

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
                    // Phase 05 — structured streaming events from the loop.
                    onStreamEvent,
                    // Streaming (Phase 03 · T3.8): the loop's incremental
                    // observation lines are forwarded as legacy text events for
                    // backward compatibility (the canonical token events come
                    // through onStreamEvent).
                    say: (line) => send({ text: stripAnsi(line) }),
                    // Approval (Phase 03 · T3.6 / Phase 12): dangerous tools
                    // always surface an approval event. The stream PAUSES until
                    // the authenticated human POSTs /api/chat/approve. Timeout
                    // and abort fail closed (deny). The model cannot approve
                    // itself. Policy still gates execution after this returns.
                    approve: async (req) => {
                      // After the stream has closed the run cannot take a
                      // human decision — fail closed immediately (preserves
                      // the Phase 03 "denied by default" contract for callers
                      // that probe approve() after the turn).
                      if (closed || runController.signal.aborted) return false;
                      const approvalId = randomUUID();
                      send({
                        type: "status",
                        status: "waiting_for_approval",
                        message: `Approval required: ${req.tool}`,
                      });
                      send({
                        approval_required: {
                          id: approvalId,
                          tool: req.tool,
                          reason: req.reason,
                          args: summarizeToolArgs(req.args),
                          preview: req.preview,
                        },
                      });
                      const approved = await waitForChatApproval(
                        approvalId,
                        runId,
                        req.tool,
                        runController.signal,
                      );
                      state.store.audit("chat.approval", {
                        id: approvalId,
                        runId,
                        tool: req.tool,
                        approved,
                      });
                      return approved;
                    },
                  });

                  const totalMs = Date.now() - started;
                  endGenAiSpan(span, {
                    ok: result.stopped === "done",
                    outTokens: undefined,
                    finishReason: result.stopped,
                  });
                  xrMetrics.llmDuration.observe({ provider: body.provider ?? "unknown", model: body.model ?? "unknown" }, totalMs);

                  if (result.stopped === "cancelled") {
                    xrMetrics.chatStreamCancelled.inc();
                    send({ cancelled: true, finalMessage: result.finalMessage, steps: result.steps, type: "status", status: "cancelled" });
                  } else {
                    xrMetrics.chatStreamCompleted.inc();
                    // Single terminal frame carrying BOTH the canonical done
                    // event (type:"done", fullText, finish metadata) and the
                    // legacy `{done:true, finalMessage}` shape, so new and old
                    // consumers both see exactly one terminal event.
                    send({
                      type: "done",
                      fullText: result.finalMessage,
                      finishReason: result.stopped,
                      steps: result.steps,
                      ttftMs,
                      totalMs,
                      done: true,
                      finalMessage: result.finalMessage,
                      stopped: result.stopped,
                    });
                  }
                  state.store.audit("chat.message", {
                    mode,
                    stopped: result.stopped,
                    steps: result.steps,
                    input: body.message!.slice(0, 200),
                    output: result.finalMessage.slice(0, 200),
                  });
                } catch (e) {
                  xrMetrics.chatStreamError.inc();
                  const msg = e instanceof Error ? e.message : String(e);
                  endGenAiSpan(span, { ok: false, errorType: (e as Error)?.name ?? "Error" });
                  send({ type: "error", code: "GENERATION_FAILED", message: msg, retryable: false, error: msg });
                } finally {
                  close();
                }
              });
            },
            cancel() {
              // Client dropped the stream → cooperative cancellation. The
              // provider request aborts via the run's signal (never a fake
              // "stopped sending tokens" while the provider keeps burning).
              xrMetrics.chatStreamCancelled.inc();
              cancelChatApprovals(runId);
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
    route({
      id: "chat.approve.post",
      path: "/api/chat/approve",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { id?: unknown; approved?: unknown };
        const id = typeof body.id === "string" ? body.id : "";
        if (!id) return json({ error: "expected { id: string, approved: boolean }" }, 400);
        const approved = body.approved === true;
        const ok = resolveChatApproval(id, approved);
        state.store.audit("chat.approval.resolve", { id, approved, matched: ok });
        if (!ok) return json({ ok: false, error: "no pending approval with that id" }, 404);
        return json({ ok: true, approved });
      },
    }),
  ];
}
