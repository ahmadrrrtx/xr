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
  ];
}
