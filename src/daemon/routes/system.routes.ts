/** XR Daemon — system, dashboard, overview, audit, sessions, research, config routes. */

import { basename } from "node:path";
import { CORE_VERSION, DISPLAY_VERSION, PKG, versionInfo } from "../../core/version.ts";
import { configCacheStats, isMemoryEnabled } from "../../config/config.ts";
import { isLocal } from "../../cost/pricing.ts";
import { runLab } from "../../security/lab.ts";
import { fingerprint } from "../../memory/rag.ts";
import { MemoryStore } from "../../memory/store.ts";
import { dashboardHtml } from "../dashboard.ts";
import { route, type DaemonRoute } from "./router.ts";

async function gitSummary(cwd: string): Promise<{ branch: string; dirty: boolean }> {
  try {
    const { runCommand } = await import("../../util/process.ts");
    const [branch, status] = await Promise.all([
      runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeoutMs: 3000 }),
      runCommand("git", ["status", "--porcelain"], { cwd, timeoutMs: 3000 }),
    ]);
    if (!branch.ok || !status.ok) return { branch: "no git", dirty: false };
    return { branch: branch.stdout.trim() || "detached", dirty: status.stdout.trim().length > 0 };
  } catch {
    return { branch: "no git", dirty: false };
  }
}

export function systemRoutes(): DaemonRoute[] {
  return [
    route({
      id: "health.get",
      path: "/api/health",
      method: "GET",
      handle: ({ json, host }) => json({ ok: true, name: "xr", host, ts: Date.now(), configCache: configCacheStats() }),
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
      handle: ({ html, token }) => html(dashboardHtml(token)),
    }),
    route({
      id: "chat.page.get",
      path: "/chat",
      method: "GET",
      handle: ({ html, token }) => html(dashboardHtml(token).replace("loadDashboard();", "navigateTo('chat'); loadDashboard();")),
    }),
    route({
      id: "overview.get",
      path: "/api/overview",
      method: "GET",
      handle: async ({ json, state, config }) => {
        const store = state.store;
        const project = basename(process.cwd());
        const memory = new MemoryStore(store);
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
          memory: { enabled: isMemoryEnabled(), count: memory.count(), health: memory.health() },
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
        voice: { enabled: config.voice.enabled, mode: config.voice.mode },
        security: {
          requireApproval: config.security.requireApproval,
          egressAllowlist: config.security.egressAllowlist,
        },
        plugins: { enabled: config.plugins.enabled, requireTrust: config.plugins.requireTrust },
      }),
    }),
  ];
}
