/**
 * V1-P5-001 (Phase 5 defect repair) — mobile companion read/act API.
 *
 * The shipped PWA speaks a companion contract (models list, cents budget,
 * approvals list + decide) that previously existed ONLY in the reference
 * harness, so the production app could not function against the real daemon.
 * These routes implement that contract against the SAME stores and services
 * the desktop surface uses — one approval store, one budget authority, one
 * model config — and live under /api/mobile/* so the existing session wall,
 * CSRF/origin checks and the mobile 403 gate apply unchanged. Off-LAN the
 * group answers 404 exactly like the other mobile ops.
 */

import { route, type DaemonRoute, type DaemonRouteContext } from "./router.ts";
import { getApprovalStore } from "../../control/approval-store.ts";
import { renderPreviewText } from "../../control/preview.ts";
import { BudgetService } from "../../services/budget-service.ts";
import { decideApproval } from "./approvals.routes.ts";
import { chatRoutes } from "./chat.routes.ts";
import { appendMessage, createChat, listChats, listMessages } from "../mobile-chats.ts";
import { extname, join, normalize, resolve, sep } from "node:path";
import { readFile, stat } from "node:fs/promises";

/** Session wall: companion ops need a paired mobile session or a privileged
 * desktop caller; anonymous gets the same 401 the rest of the API gives. */
function requireSession(ctx: DaemonRouteContext): Response | null {
  if (!ctx.mobile) return ctx.json({ error: "LAN mode is off" }, 404);
  const s = ctx.mobile.session;
  if (!s.device && !s.privileged) return ctx.json({ error: "Not paired" }, 401);
  return null;
}

/** ModelInfo as the companion types it: {id, label, provider, local?}. */
function companionModels(ctx: DaemonRouteContext) {
  const local = ctx.config.localModels;
  const models = (local.installed ?? []).map((m) => ({
    id: m.model,
    label: m.model,
    provider: m.providerId,
    local: true,
  }));
  // The effective selection (same resolution order as the desktop models
  // route) is always listed, so the picker can never be empty by construction.
  const selectedId = local.selected ?? ctx.config.defaults.fallbackModel ?? ctx.config.defaults.model;
  if (!models.some((m) => m.id === selectedId)) {
    const provider = local.enabled ? (local.provider ?? ctx.config.defaults.provider) : ctx.config.defaults.provider;
    models.unshift({ id: selectedId, label: selectedId, provider, local: local.enabled });
  }
  return models;
}

export function mobileCompanionRoutes(): DaemonRoute[] {
  const P = "/api/mobile";
  return [
    route({
      id: "mobile.companion.models.get",
      path: `${P}/models`,
      method: "GET",
      handle: (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        return ctx.json({ models: companionModels(ctx) });
      },
    }),

    route({
      id: "mobile.companion.budget.get",
      path: `${P}/budget`,
      method: "GET",
      handle: (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        // Same store + config the desktop /api/budget reads — one budget
        // authority. Cents shape per the companion contract; the governed
        // budget has a PER-TASK cap and a monthly cap, not a daily cap, so
        // `dailyCapCents` is omitted (the app shows the per-task cap instead
        // of fabricating a daily ceiling).
        const store = ctx.state.store;
        const persisted = BudgetService.managerForStore(store).getConfig();
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(now);
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        return ctx.json({
          spentTodayCents: Math.round(store.getSpendForPeriod(startOfDay.getTime()) * 100),
          spentMonthCents: Math.round(store.getSpendForPeriod(startOfMonth.getTime()) * 100),
          monthCapCents: Math.round((persisted?.monthly_cap ?? 0) * 100),
          perTaskCents: Math.round(ctx.config.budget.perTaskUsd * 100),
          currency: "USD",
        });
      },
    }),

    route({
      id: "mobile.companion.approvals.get",
      path: `${P}/approvals`,
      method: "GET",
      handle: (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        // Same durable store as the desktop surface. Only pending approvals
        // are listable (decided records age out) — identical to the desktop
        // dashboard's truth; `status` is accepted for contract compatibility.
        const approvalsCfg = ctx.config?.approvals;
        const store = getApprovalStore(ctx.state.store, {
          defaultTtlMs: approvalsCfg?.defaultTtlMs,
          perSurface: approvalsCfg?.perSurface,
        });
        const approvals = store.listPending().map((r) => ({
          id: r.id,
          title: r.tool,
          summary: r.reason,
          workspace: r.surface,
          runId: r.runId ?? undefined,
          createdAt: r.requestedAt,
          status: "pending" as const,
          diff: r.preview ? renderPreviewText(r.preview) : undefined,
        }));
        return ctx.json({ approvals });
      },
    }),

    route({
      id: "mobile.companion.approvalDecide.post",
      pattern: /^\/api\/mobile\/approvals\/[\w-]+$/,
      prefix: `${P}/approvals`,
      method: "POST",
      handle: async (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        const match = ctx.path.match(/^\/api\/mobile\/approvals\/([^/]+)$/);
        if (!match) return null;
        // Companion wire form is { decision: "approve" | "deny" }; the shared
        // decide path takes the boolean. No second approval semantics — first
        // decision wins from ANY surface.
        const body = (await ctx.req.json().catch(() => ({}))) as { decision?: unknown };
        if (body?.decision !== "approve" && body?.decision !== "deny") {
          return ctx.json({ error: "expected { decision: \"approve\" | \"deny\" }" }, 400);
        }
        return decideApproval(ctx, decodeURIComponent(match[1]), body.decision === "approve");
      },
    }),

    /* ── Companion chat sync (V1-P5-001 3/5) ──────────────────────────────── */

    route({
      id: "mobile.companion.chats.get",
      path: `${P}/chats`,
      method: "GET",
      handle: async (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        const limit = Math.min(Math.max(Number(new URL(ctx.url).searchParams.get("limit") ?? 50) || 50, 1), 200);
        const chats = await listChats(limit);
        const summaries = await Promise.all(
          chats.map(async (c) => {
            const messages = await listMessages(c.id, 500);
            return {
              id: c.id,
              title: c.title,
              updatedAt: c.updatedAt,
              lastMessage: messages[messages.length - 1]?.content.slice(0, 140) ?? "",
              messageCount: messages.length,
            };
          }),
        );
        return ctx.json({ chats: summaries });
      },
    }),

    route({
      id: "mobile.companion.chats.create.post",
      path: `${P}/chats`,
      method: "POST",
      handle: async (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        const body = (await ctx.req.json().catch(() => ({}))) as { title?: unknown };
        const title = typeof body?.title === "string" ? body.title : "";
        const row = await createChat(title);
        return ctx.json({ id: row.id, title: row.title }, 201);
      },
    }),

    route({
      id: "mobile.companion.chatMessages.get",
      pattern: /^\/api\/mobile\/chats\/[\w.-]+\/messages$/,
      prefix: `${P}/chats`,
      method: "GET",
      handle: async (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        const match = ctx.path.match(/^\/api\/mobile\/chats\/([^/]+)\/messages$/);
        if (!match) return null;
        const chatId = decodeURIComponent(match[1]);
        const limit = Math.min(Math.max(Number(new URL(ctx.url).searchParams.get("limit") ?? 200) || 200, 1), 500);
        const messages = await listMessages(chatId, limit);
        return ctx.json({ messages });
      },
    }),

    route({
      id: "mobile.companion.chat.post",
      path: `${P}/chat`,
      method: "POST",
      handle: async (ctx) => {
        const denied = requireSession(ctx);
        if (denied) return denied;
        const body = (await ctx.req.json().catch(() => ({}))) as { chatId?: unknown; content?: unknown; model?: unknown };
        const chatId = typeof body?.chatId === "string" ? body.chatId.slice(0, 64) : "";
        const content = typeof body?.content === "string" ? body.content : "";
        if (!chatId || !content) {
          return ctx.json({ error: "expected { chatId: string, content: string }" }, 400);
        }
        const model = typeof body?.model === "string" && body.model ? body.model : undefined;
        // ONE execution path: the adapter translates the wire form and invokes
        // the SAME /api/chat handler (preflight, lane serialization, coop
        // cancellation, durable approvals, canonical SSE) — no second loop.
        const chatHandler = chatRoutes().find((r) => r.id === "chat.stream.post")!.handle;
        const res = await chatHandler({
          ...ctx,
          path: "/api/chat",
          req: new Request(ctx.req.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              message: content,
              mode: "ask",
              sessionId: chatId,
              ...(model ? { model } : {}),
            }),
          }),
        });
        // Honest pass-through: provider-offline 503, busy-lane 429, bad-body
        // 400 — the phone sees the real state, never a fabricated stream.
        if (!res || res.status !== 200 || !res.body) {
          return res ?? ctx.json({ error: "chat unavailable" }, 503);
        }
        // The stream is real: persist the user turn, and tee the reply through
        // a transform that captures the done frame so the assistant turn lands
        // in the store for the next sync. Persistence must never break the stream.
        void appendMessage(chatId, "user", content);
        return new Response(persistingStream(res.body, chatId), { status: 200, headers: res.headers });
      },
    }),

    /* ── PWA static serving (V1-P5-001 4/5) ──────────────────────────────── */

    route({
      id: "mobile.pwa.get",
      prefix: `/mobile`,
      method: "GET",
      handle: (ctx) => serveMobileDist(ctx),
    }),
  ];
}

/** Wraps the chat SSE body so the assistant reply (the done frame's fullText)
 * is appended to the mobile chat store when the stream completes. */
function persistingStream(body: ReadableStream<Uint8Array>, chatId: string): ReadableStream<Uint8Array> {
  let text = "";
  const decoder = new TextDecoder();
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        text += decoder.decode(chunk, { stream: true });
        controller.enqueue(chunk);
      },
      flush() {
        void (async () => {
          try {
            const m = /data: (\{[^\n]*"type":"done"[^\n]*\})/.exec(text);
            if (m) {
              const done = JSON.parse(m[1]) as { fullText?: string };
              if (typeof done.fullText === "string" && done.fullText) {
                await appendMessage(chatId, "assistant", done.fullText);
              }
            }
          } catch {
            /* persistence failure must never surface as a stream error */
          }
        })();
      },
    }),
  );
}

/* ── PWA static serving (V1-P5-001 4/5) ──────────────────────────────────── */

/** The mobile app's own CSP (carried over verbatim from the reference harness
 * that shipped it — same-origin everything, push-service connect targets,
 * inline styles only, no framing). */
const MOBILE_CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "script-src 'self'",
  "connect-src 'self' wss: https://*.googleapis.com https://*.push.apple.com https://updates.push.services.mozilla.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const MOBILE_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Built PWA location: packaged layouts can point XR_MOBILE_DIST at it;
 * otherwise the repo checkout's mobile/dist beside the daemon. */
function mobileDistDir(): string {
  return resolve(process.env.XR_MOBILE_DIST ?? join(process.cwd(), "mobile", "dist"));
}

/** Serve the built PWA at /mobile/ (LAN runtime only). Path-traversal guarded,
 * SPA fallback for unknown routes, honest 404 when the build is absent. */
async function serveMobileDist(ctx: DaemonRouteContext): Promise<Response> {
  if (!ctx.mobile) return ctx.json({ error: "LAN mode is off" }, 404);
  const dist = mobileDistDir();
  const relative = ctx.path.replace(/^\/mobile\/?/, "") || "index.html";
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(dist, safe);
  if (!filePath.startsWith(dist)) return new Response("Forbidden", { status: 403 });
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(dist, "index.html"); // SPA fallback (/mobile/pair?code=…)
  }
  let body: Uint8Array;
  try {
    body = new Uint8Array(await readFile(filePath));
  } catch {
    return new Response(
      "XR mobile app is not built next to this daemon (mobile/dist absent). Build it with: npm --prefix mobile run build",
      { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  return new Response(body, {
    headers: {
      "content-type": MOBILE_MIME[extname(filePath)] ?? "application/octet-stream",
      "content-length": String(body.byteLength),
      "content-security-policy": MOBILE_CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin",
      "service-worker-allowed": "/mobile/",
      // V1 CI fix (2026-10-28, PR #201 Windows lane): `join` emits backslashes
      // on win32, so a literal "/assets/" test failed there and hashed assets
      // silently got "no-cache". Decide on a separator-normalized view of the
      // FINAL served path (post directory→index.html and SPA fallback), so the
      // cache policy follows the bytes actually being served.
      "cache-control": filePath.split(sep).join("/").includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}
