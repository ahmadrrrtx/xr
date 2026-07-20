/** XR Daemon — budget routes. */

import { loadConfig, saveConfig } from "../../config/config.ts";
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
        const persisted = store.getBudgetConfig();
        const cost = store.costSummary();
        return json({
          config: {
            perTaskUsd: config.budget.perTaskUsd,
            perTaskTokens: config.budget.perTaskTokens,
          },
          persisted: persisted ?? {
            monthly_cap: 0,
            daily_cap: null,
            warnings_enabled: true,
            auto_fallback: true,
          },
          usage: {
            totalUsd: cost.totalUsd,
            totalTokens: cost.totalTokens,
            dayUsd: store.getSpendForPeriod(startOfDay.getTime()),
            monthUsd: store.getSpendForPeriod(startOfMonth.getTime()),
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
          };
          const next = loadConfig().config;
          const store = state.store;
          if (typeof body.perTaskUsd === "number" && Number.isFinite(body.perTaskUsd) && body.perTaskUsd >= 0) {
            next.budget.perTaskUsd = body.perTaskUsd;
          }
          saveConfig(next);
          store.setBudgetConfig({
            monthly_cap: typeof body.monthlyCap === "number" && Number.isFinite(body.monthlyCap) ? body.monthlyCap : (store.getBudgetConfig()?.monthly_cap ?? 0),
            daily_cap: body.dailyCap === null ? null : (typeof body.dailyCap === "number" && Number.isFinite(body.dailyCap) ? body.dailyCap : store.getBudgetConfig()?.daily_cap ?? null),
            warnings_enabled: body.warningsEnabled ?? store.getBudgetConfig()?.warnings_enabled ?? true,
            auto_fallback: body.autoFallback ?? store.getBudgetConfig()?.auto_fallback ?? true,
          });
          store.audit("budget.update", {
            perTaskUsd: next.budget.perTaskUsd,
            monthlyCap: body.monthlyCap ?? null,
            dailyCap: body.dailyCap ?? null,
            warningsEnabled: body.warningsEnabled ?? null,
            autoFallback: body.autoFallback ?? null,
          });
          return json({ ok: true, perTaskUsd: next.budget.perTaskUsd, persisted: store.getBudgetConfig() });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
