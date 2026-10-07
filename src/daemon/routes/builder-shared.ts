/**
 * Phase 17 · Builder — shared route plumbing.
 *
 *   · project lookup from `/api/builder/projects/{id}/…`
 *   · the ONE approval-gated mutation stream every Builder write uses:
 *       data: {"approval_required": {id, tool, reason, args, riskTier, preview, ttlMs}}
 *       data: {"type":"applied", …} | {"type":"denied"} | {"type":"error"}
 *       data: [DONE]
 *     Same framing as /api/chat so the desktop bridges it through the Phase 7
 *     approval modal unchanged. `args.scope` names the project so a remembered
 *     rule ("always allow · write a file · my-app") stays per project.
 */

import { getApprovalStore } from "../../control/approval-store.ts";
import { buildStructuredPreview } from "../../control/preview.ts";
import { getBuilderProjects, type BuilderProject } from "../builder-projects.ts";
import type { DaemonRouteContext } from "./router.ts";

export const BUILDER_PREFIX = "/api/builder/projects/";
export const PROJECT_ID_RE = /^\/api\/builder\/projects\/([0-9a-f]{16})(?:\/|$)/;

export function projectPattern(tail: string): RegExp {
  return new RegExp(`^\\/api\\/builder\\/projects\\/[0-9a-f]{16}\\/${tail}$`);
}

export function projectFrom(path: string): BuilderProject | null {
  const m = PROJECT_ID_RE.exec(path);
  if (!m) return null;
  return getBuilderProjects().get(m[1] ?? "") ?? null;
}

export function scopeOf(project: BuilderProject): string {
  return `${project.name} (Builder)`;
}

export type SseSend = (data: object) => void;

/**
 * Open an SSE response and run `body` against its writer; always ends with
 * [DONE]. `signal` aborts when the client disconnects (stream cancel) so
 * long-lived feeds can release their subscriptions.
 */
export function sseResponse(body: (send: SseSend, signal: AbortSignal) => Promise<void>): Response {
  const enc = new TextEncoder();
  const ac = new AbortController();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let seq = 0;
      const send: SseSend = (data) => {
        if (closed) return;
        seq += 1;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ ...data, event_id: seq })}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          /* client went away */
        }
      };
      body(send, ac.signal)
        .catch((e) => send({ type: "error", error: (e as Error).message }))
        .finally(close);
    },
    cancel() {
      closed = true; // the consumer is gone; never enqueue again
      ac.abort();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}

export interface GatedMutation {
  ctx: Pick<DaemonRouteContext, "state" | "config">;
  project: BuilderProject;
  tool: string;
  /** Args the desktop sees (rule matching + modal). Keep them small; no file bodies. */
  args: Record<string, unknown>;
  /** Args the preview is built from (may include content / patch). */
  previewArgs?: Record<string, unknown>;
  reason: string;
  riskTier: "low" | "medium" | "high";
  surface?: string;
  /** Audit event stem: `<stem>.denied` / `<stem>.applied`. */
  audit: string;
  /** Runs only after approval; whatever it returns is sent as `{type:"applied", …}`. */
  perform: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** The consent plane for every Builder write: approval first, disk second. */
export function gatedMutation(m: GatedMutation): Response {
  return sseResponse(async (send) => {
    const approvalsCfg = m.ctx.config?.approvals;
    const store = getApprovalStore(m.ctx.state.store, { defaultTtlMs: approvalsCfg?.defaultTtlMs, perSurface: approvalsCfg?.perSurface });
    const args = { ...m.args, scope: scopeOf(m.project) };
    const preview = buildStructuredPreview({ tool: m.tool, args: { ...args, ...(m.previewArgs ?? {}) }, reason: m.reason, cwd: m.project.root, riskTier: m.riskTier });
    const handle = store.request({ tool: m.tool, args: { ...args, ...(m.previewArgs ?? {}) }, reason: m.reason, preview, riskTier: m.riskTier, surface: m.surface ?? "builder" });
    send({
      approval_required: { id: handle.id, tool: m.tool, reason: m.reason, args, riskTier: handle.record.riskTier, preview, ttlMs: handle.record.ttlMs },
    });
    const outcome = await handle.outcome;
    if (!outcome.approved) {
      m.ctx.state.store.audit(`${m.audit}.denied`, { project: m.project.id, tool: m.tool, decision: outcome.decision, ...(m.args.path !== undefined ? { path: m.args.path } : {}) });
      send({ type: outcome.timedOut ? "timed_out" : "denied", approvalId: handle.id, decision: outcome.decision });
      return;
    }
    try {
      const result = await m.perform();
      m.ctx.state.store.audit(`${m.audit}.applied`, { project: m.project.id, tool: m.tool, ...(m.args.path !== undefined ? { path: m.args.path } : {}) });
      send({ type: "applied", approvalId: handle.id, ...result });
    } catch (e) {
      m.ctx.state.store.audit(`${m.audit}.failed`, { project: m.project.id, tool: m.tool, error: (e as Error).message });
      send({ type: "error", approvalId: handle.id, error: (e as Error).message });
    }
  });
}
