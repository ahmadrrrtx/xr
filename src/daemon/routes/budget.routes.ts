/** XR Daemon — budget routes. */

import { loadConfig, saveConfig } from "../../config/config.ts";
import { BudgetService } from "../../services/budget-service.ts";
import { route, type DaemonRoute } from "./router.ts";

export function budgetRoutes(): DaemonRoute[] {
  return [
    route({
      id: "budget.get",
      path: "/api/budget",
      method: "GET",
      handle: ({ json, state, config }) => {
        const store = state.store;
        const now = Date.now();
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const persisted = BudgetService.managerForStore(store).getConfig();
        const cost = store.costSummary();
        return json({
          config: {
            perTaskUsd: config.budget.perTaskUsd,
            perTaskTokens: config.budget.perTaskTokens,
          },
          persisted,
          accounting: "standard/declared token-cost estimates, not a provider invoice ceiling",
          usage: {
            totalUsd: cost.totalUsd,
            totalTokens: cost.totalTokens,
            dayUsd: store.getSpendForPeriod(startOfDay.getTime()),
            monthUsd: store.getSpendForPeriod(startOfMonth.getTime()),
          },
          // Phase 4 · Trust Center burn bar: the ENGINE computes the percentage
          // (SEC-07 — the shell never derives budget math for display).
          burn: {
            monthUsd: store.getSpendForPeriod(startOfMonth.getTime()),
            monthlyCap: (persisted?.monthly_cap ?? 0) || 0,
            burnPct:
              ((persisted?.monthly_cap ?? 0) || 0) > 0
                ? Math.min(100, Math.round((100 * store.getSpendForPeriod(startOfMonth.getTime())) / ((persisted?.monthly_cap ?? 0) || 1)))
                : null,
          },
          byModel: cost.byModel,
          byProvider: store.providerCostSummary(),
          recent: cost.recent,
          generatedAt: now,
        });
      },
    }),
    route({
      id: "budget.set",
      path: "/api/budget/set",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as {
            perTaskUsd?: number;
            monthlyCap?: number;
            dailyCap?: number | null;
            warningsEnabled?: boolean;
            autoFallback?: boolean;
            tightenOnly?: boolean;
          };
          for (const key of ['perTaskUsd', 'monthlyCap', 'dailyCap'] as const) {
            const value = body[key];
            if (value === undefined || (key === 'dailyCap' && value === null)) continue;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return json({ error: `${key} must be a finite nonnegative number` }, 400);
          }
          for (const key of ['warningsEnabled', 'autoFallback', 'tightenOnly'] as const) if (body[key] !== undefined && typeof body[key] !== 'boolean') return json({ error: `${key} must be a boolean` }, 400);
          const next = loadConfig().config;
          const store = state.store;
          const intent = { perTaskUsd: body.perTaskUsd ?? null, monthlyCap: body.monthlyCap ?? null, dailyCap: body.dailyCap ?? null, warningsEnabled: body.warningsEnabled ?? null, autoFallback: body.autoFallback ?? null, tightenOnly: body.tightenOnly === true };
          // Only declared scalar fields, never arbitrary user payloads/secrets.
          store.audit("budget.update.requested", intent);
          if (!body.tightenOnly && typeof body.perTaskUsd === "number") {
            next.budget.perTaskUsd = body.perTaskUsd;
            saveConfig(next);
          }
          // Serialized with the SAME write gate used by reservations. A stale
          // client cannot raise a concurrently lowered monthly/daily limit.
          store.write(() => {
            const existing = BudgetService.managerForStore(store).getConfig();
            const monthly = body.monthlyCap ?? existing.monthly_cap;
            const daily = body.dailyCap === undefined ? existing.daily_cap : body.dailyCap;
            store.setBudgetConfig({
              monthly_cap: body.tightenOnly ? Math.min(existing.monthly_cap, monthly) : monthly,
              daily_cap: body.tightenOnly ? (existing.daily_cap === null ? daily : daily === null ? existing.daily_cap : Math.min(existing.daily_cap, daily)) : daily,
              warnings_enabled: body.tightenOnly ? existing.warnings_enabled : body.warningsEnabled ?? existing.warnings_enabled,
              auto_fallback: body.tightenOnly ? existing.auto_fallback : body.autoFallback ?? existing.auto_fallback,
            });
            store.audit("budget.update", { ...intent, perTaskUsd: next.budget.perTaskUsd });
          });
          return json({ ok: true, perTaskUsd: next.budget.perTaskUsd, persisted: store.getBudgetConfig() });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
