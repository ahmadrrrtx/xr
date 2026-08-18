/** XR Daemon — system, dashboard, overview, audit, sessions, research, config routes. */

import { basename } from "node:path";
import { CORE_VERSION, DISPLAY_VERSION, PKG, versionInfo } from "../../core/version.ts";
import { configCacheStats, isMemoryEnabled } from "../../config/config.ts";
import { isLocal } from "../../cost/pricing.ts";
import { runLab } from "../../security/lab.ts";
import { fingerprint } from "../../context/memory/rag.ts";
import { IsolatedMemoryStore } from "../../context/isolated-store.ts";
import { inspectMemoryEngine } from "../../context/engine.ts";
import { dashboardHtml, dashboardCssAsset, dashboardScriptAsset } from "../dashboard.ts";
import { AUTH_PAGE_SCRIPT } from "../auth-page.ts";
import { gitSummaryCached } from "../state/cache.ts";
import { assetResponse, route, type DaemonRoute } from "./router.ts";

async function gitSummary(cwd: string): Promise<{ branch: string; dirty: boolean }> {
  // Phase 01 — cached 5 s so dashboard polling never re-runs git per request.
  return (await gitSummaryCached(cwd)) ?? { branch: "no git", dirty: false };
}

export function systemRoutes(): DaemonRoute[] {
  return [
    route({
      id: "health.get",
      path: "/api/health",
      method: "GET",
      handle: ({ json, host }) => json({
        ok: true,
        name: "xr",
        version: versionInfo(),
        host,
        binding: "localhost-only",
        auth: "required-except-health",
        ts: Date.now(),
        configCache: configCacheStats(),
      }),
    }),
    route({
      id: "dashboard.get",
      path: "/",
      method: "GET",
      handle: ({ html, token }) => html(dashboardHtml(token)),
    }),
    route({
      id: "dashboard.alias.get",
      path: "/dashboard",
      method: "GET",
      handle: ({ html, token }) => html(dashboardHtml(token).replace('<body data-route="home">', '<body data-route="dashboard">')),
    }),
    // Phase 4 · T5 — external dashboard assets under strict CSP
    // (script-src 'self'; the client app is never inline).
    route({
      id: "dashboard.css.get",
      path: "/assets/dashboard.css",
      method: "GET",
      handle: () => assetResponse(dashboardCssAsset(), "text/css; charset=utf-8"),
    }),
    route({
      id: "dashboard.js.get",
      path: "/assets/dashboard.js",
      method: "GET",
      handle: () => assetResponse(dashboardScriptAsset(), "application/javascript; charset=utf-8"),
    }),
    // Phase 8 · T3 — the sign-in page's behaviour script. Reachable WITHOUT
    // authentication (server.ts exempts this exact path): the page needs it
    // before any session exists. Static bytes, no data, no secrets.
    route({
      id: "auth.js.get",
      path: "/assets/auth.js",
      method: "GET",
      handle: () => assetResponse(AUTH_PAGE_SCRIPT, "application/javascript; charset=utf-8"),
    }),
    route({
      id: "chat.page.get",
      path: "/chat",
      method: "GET",
      handle: ({ html, token }) => html(dashboardHtml(token).replace('<body data-route="home">', '<body data-route="chat">')),
    }),
    route({
      id: "overview.get",
      path: "/api/overview",
      method: "GET",
      handle: async ({ json, state, config }) => {
        const store = state.store;
        const project = basename(process.cwd());
        const memory = new IsolatedMemoryStore(store);
        const git = await gitSummary(process.cwd());
        return json({
          version: versionInfo(),
          constants: { coreVersion: CORE_VERSION, displayVersion: DISPLAY_VERSION, package: PKG.name },
          project,
          workspace: state.workspaceManager.getActiveId(),
          cwd: process.cwd(),
          fingerprint: fingerprint(process.cwd()),
          provider: {
            active: config.defaults.provider,
            model: config.defaults.model,
            fallback: config.defaults.fallbackProvider ?? null,
            fallbackModel: config.defaults.fallbackModel ?? null,
            local: isLocal(config.defaults.provider),
          },
          audit: { count: store.auditCount(), chain: store.verifyChain() },
          skills: { learned: store.skillCount(), frozen: store.frozenCount() },
          ragChunks: store.ragCount(project),
          memory: { enabled: isMemoryEnabled(), count: memory.count(), health: memory.health(), engine: inspectMemoryEngine(store) },
          research: { count: store.researchCount(), recent: store.listResearch(4) },
          git,
          budget: {
            perTaskUsd: config.budget.perTaskUsd,
            perTaskTokens: config.budget.perTaskTokens,
            egressAllowlist: config.security.egressAllowlist,
          },
        });
      },
    }),
    route({ id: "cost.get", path: "/api/cost", method: "GET", handle: ({ json, state }) => json(state.store.costSummary()) }),
    route({
      id: "audit.get",
      path: "/api/audit",
      method: "GET",
      handle: ({ json, url, state }) => {
        const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
        return json({ entries: state.store.recentAudit(limit), chain: state.store.verifyChain() });
      },
    }),
    route({
      id: "security.get",
      path: "/api/security",
      method: "GET",
      handle: ({ json, config }) => {
        const report = runLab({ egressAllowlist: config.security.egressAllowlist });
        return json({
          ...report,
          egressAllowlist: config.security.egressAllowlist?.map((d) => d.replace(/^https?:\/\//, "")) ?? [],
        });
      },
    }),
    route({
      id: "sessions.list",
      path: "/api/sessions",
      method: "GET",
      handle: ({ json, state }) => {
        const store = state.store;
        const sessions = store.recentSessions(50);
        const countsByStatus = Object.fromEntries(store.sessionStatusCounts().map((row) => [row.status, row.c]));
        return json({
          sessions,
          research: store.listResearch(10),
          counts: {
            sessions: Object.values(countsByStatus).reduce((sum, value) => sum + Number(value || 0), 0),
            research: store.researchCount(),
            running: countsByStatus.running ?? 0,
            done: countsByStatus.done ?? 0,
            error: countsByStatus.error ?? 0,
            stopped: countsByStatus.stopped ?? 0,
          },
        });
      },
    }),
    route({
      id: "sessions.get",
      prefix: "/api/sessions/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/sessions/".length));
        const store = state.store;
        const session = store.getSession(id);
        if (!session) return json({ error: "session not found" }, 404);
        const steps = store.sessionSteps(id).map((step) => ({
          ...step,
          parsedDetail: (() => { try { return JSON.parse(step.detail); } catch { return null; } })(),
        }));
        const audit = store.recentAudit(200).filter((entry) => entry.session_id === id).slice(0, 20);
        return json({ session, steps, audit });
      },
    }),
    route({
      id: "research.list",
      path: "/api/research",
      method: "GET",
      handle: ({ json, state }) => {
        try {
          const latestRow = state.store.latestResearch();
          let latest: unknown = null;
          if (latestRow) { try { latest = JSON.parse(latestRow.data); } catch { latest = null; } }
          return json({ count: state.store.researchCount(), recent: state.store.listResearch(20), latest });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    }),
    route({
      id: "research.get",
      prefix: "/api/research/",
      method: "GET",
      handle: ({ json, path, state }) => {
        const id = decodeURIComponent(path.slice("/api/research/".length));
        const row = state.store.getResearch(id);
        if (!row) return json({ error: "research session not found" }, 404);
        try { return json({ session: JSON.parse(row.data) }); }
        catch { return json({ error: "research session data is invalid" }, 500); }
      },
    }),
    route({
      id: "recovery.status.get",
      path: "/api/recovery",
      method: "GET",
      handle: ({ json, state }) => {
        try {
          // The standalone daemon does not braid the kernel registry into
          // DaemonState; an embedding host may attach it. One typed carrier
          // instead of repeated `any` (A-6 seam); response shape narrowed to
          // exactly the two fields this summary reads.
          const carrier = state as typeof state & {
            registry?: { tryResolve?: (token: unknown) => unknown; Tokens?: { Execution?: unknown } };
          };
          const execService = carrier.registry?.tryResolve?.(carrier.registry?.Tokens?.Execution) as
            | {
                getRecoveryPending(workspaceId: string): unknown;
                checkpoints?: { getMaintenanceMeta(key: string): string | null };
              }
            | undefined;
          /**
           * Phase 06 · Steps 34/35 — HONEST RPO/RTO. We report the model we
           * actually implement and the MEASURED last recovery duration — we do
           * NOT claim zero data loss, because a crash between two checkpoint
           * boundaries loses the work done since the last boundary.
           *
           *  RPO (data loss on crash): one lifecycle boundary. Checkpoints are
           *      written at task-accept/plan/policy/env/step/model-turn/tool,
           *      so worst-case loss = work since the last boundary.
           *  RTO (time to recover): startup discovery+classification, measured.
           */
          const readMeta = (key: string): number | null => {
            try {
              const raw = execService?.checkpoints?.getMaintenanceMeta(key);
              const n = raw == null ? NaN : Number.parseInt(raw, 10);
              return Number.isFinite(n) ? n : null;
            } catch {
              return null;
            }
          };
          const rpoRto = {
            rpo: {
              model: "checkpoint_per_lifecycle_boundary",
              boundary: "task_accepted/plan/policy/env/step/model_turn/tool_call",
              worstCaseLoss: "work performed since the last checkpoint boundary",
              zeroDataLoss: false,
            },
            rto: {
              model: "startup_recovery_discovery_and_classification",
              budgetMs: 5000,
              lastMeasuredMs: readMeta("startup_recovery_last_duration_ms"),
              lastRecoveredCount: readMeta("startup_recovery_last_count"),
              lastRunAt: readMeta("startup_recovery_last_at"),
            },
          };
          if (!execService || typeof execService.getRecoveryPending !== "function") {
            return json({
              recovery: [],
              summary: { pending: 0, blocked: 0, safeToResume: 0, needsApproval: 0 },
              rpoRto,
            });
          }
          const pending = execService.getRecoveryPending(state.workspaceManager.getActiveId()) as
            Array<{ recoveryState?: unknown; safeToResume?: unknown }>;
          return json({
            recovery: pending,
            summary: {
              pending: pending.length,
              blocked: pending.filter((r) => r.recoveryState === "recovery_blocked").length,
              safeToResume: pending.filter((r) => r.safeToResume).length,
              needsApproval: pending.filter((r) => r.recoveryState === "startup_recovery_pending").length,
            },
            rpoRto,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    }),
    route({
      id: "config.safe.get",
      path: "/api/config",
      method: "GET",
      handle: ({ json, config }) => json({
        provider: config.defaults.provider,
        model: config.defaults.model,
        mode: config.defaults.mode,
        fallbackProvider: config.defaults.fallbackProvider ?? null,
        fallbackModel: config.defaults.fallbackModel ?? null,
        localEnabled: config.localModels.enabled,
        routing: config.localModels.routing,
        budget: config.budget,
        memory: {
          enabled: config.memory.enabled,
          injectInChat: config.memory.injectInChat,
          recallLimit: config.memory.recallLimit,
        },
        // Phase E · E-2 — non-secret voice pipeline detail so the dashboard
        // can show the real local backends and the offline-capable note.
        voice: {
          enabled: config.voice.enabled,
          mode: config.voice.mode,
          sttBackend: config.voice.sttBackend ?? "auto",
          ttsBackend: config.voice.ttsBackend ?? "auto",
          wakeWord: config.voice.wakeWord ?? null,
          microphonePermission: config.voice.microphonePermission ?? "unknown",
        },
        security: {
          requireApproval: config.security.requireApproval,
          egressAllowlist: config.security.egressAllowlist,
        },
        plugins: { enabled: config.plugins.enabled, requireTrust: config.plugins.requireTrust },
      }),
    }),
  ];
}
