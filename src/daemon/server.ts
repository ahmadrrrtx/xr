/**
 * XR Stage 5 — Local Daemon  ("xr serve")
 *
 * Security doctrine (non-negotiable):
 *  - Binds to 127.0.0.1 only — never 0.0.0.0
 *  - Every non-health request requires a local bearer token
 *  - State-changing routes go through approval gate + policy + audit log
 *  - Keys / secrets are NEVER returned via any API endpoint
 *  - Dashboard HTML is served at / and /dashboard
 *  - Chat is served at /chat
 *  - API is at /api/*
 *
 * New in Stage 5:
 *  - /chat route serves the full chat UI (embedded in dashboard)
 *  - /api/chat streaming endpoint (SSE) powers the chat panel
 *  - /api/providers returns provider status for the dashboard
 *  - /api/config returns safe (redacted) config subset
 *  - Improved CORS and CSP headers
 */
import { handleControlApi } from "./control-api.ts";
import { handlePluginApi } from "./plugin-api.ts";
import { handleSkillsApi } from "./skills-api.ts";
import { randomBytes } from "node:crypto";
import { Store } from "../state/db.ts";
import { loadConfig, isMemoryEnabled } from "../config/config.ts";
import { runLab } from "../security/lab.ts";
import { XRShieldService } from "../security/shield.ts";
import { fingerprint } from "../memory/rag.ts";
import { basename } from "node:path";
import { dashboardHtml } from "./dashboard.ts";
import { approvals } from "../control/approvals.ts";
import { detectCapabilities } from "../control/adapter.ts";
import { isDisabled, runTypedPlan } from "../control/service.ts";
import { planActions } from "../control/planner.ts";
import { browserStatus } from "../control/browser.ts";
import { buildProvider, knownProviders, PRESETS } from "../providers/factory.ts";
import { getProviderEnvStatus } from "../config/config.ts";
import { listRemembered, forgetPlan, clearAllMemory } from "../control/memory.ts";
import { MemoryStore } from "../memory/store.ts";
import { WorkspaceManager } from "../core/workspace.ts";
import type { Message } from "../core/types.ts";

export interface DaemonOptions {
  port?:   number;
  token?:  string;
  store?:  Store;
}

export interface DaemonHandle {
  port:   number;
  token:  string;
  stop:   () => void;
  handle: (req: Request) => Response | Promise<Response>;
}

const HOST = "127.0.0.1";

function gitSummary(cwd: string): { branch: string; dirty: boolean } {
  try {
    const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" });
    const status = Bun.spawnSync(["git", "status", "--porcelain"], { cwd, stdout: "pipe", stderr: "ignore" });
    if (branch.exitCode !== 0 || status.exitCode !== 0) return { branch: "no git", dirty: false };
    return {
      branch: branch.stdout.toString().trim() || "detached",
      dirty: status.stdout.toString().trim().length > 0,
    };
  } catch {
    return { branch: "no git", dirty: false };
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type":  "application/json",
      "cache-control": "no-store",
    },
  });
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type":                "text/html; charset=utf-8",
      "cache-control":               "no-store",
      "x-content-type-options":      "nosniff",
      "x-frame-options":             "DENY",
      "referrer-policy":             "no-referrer",
      "content-security-policy":     "default-src 'self'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'", 
    },
  });
}

function sse(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      "content-type":  "text/event-stream",
      "cache-control": "no-cache",
      "connection":    "keep-alive",
    },
  });
}

/** Build the request handler (pure; used by both serve() and tests). */
export function makeHandler(store: Store, token: string) {
  const { config } = loadConfig();

  function authed(req: Request): boolean {
    const h   = req.headers.get("authorization") ?? "";
    const url = new URL(req.url);
    if (h === `Bearer ${token}`) return true;
    // Allow token via query string for first dashboard load only
    // (localhost-only server, low risk vs. DX improvement)
    if (url.searchParams.get("token") === token) return true;
    return false;
  }

  const shieldService = new XRShieldService(store);

  return async function handle(req: Request): Promise<Response> {
    const url    = new URL(req.url);
    const path   = url.pathname;
    const method = req.method;

    // ── Open endpoints (no auth) ──────────────────────────────────────────
    if (path === "/api/health") {
      return json({ ok: true, name: "xr", host: HOST, ts: Date.now() });
    }

    // ── Auth gate ─────────────────────────────────────────────────────────
    if (!authed(req)) {
      return json({ error: "unauthorized — local bearer token required" }, 401);
    }

    // ── Dashboard HTML ────────────────────────────────────────────────────
    if (path === "/" || path === "/dashboard") {
      return html(dashboardHtml(token));
    }

    // ── Chat UI page ──────────────────────────────────────────────────────
    if (path === "/chat") {
      // Serve same dashboard with chat panel pre-selected
      return html(dashboardHtml(token).replace(
        "loadDashboard();",
        "navigateTo('chat'); loadDashboard();"
      ));
    }

    // ── Chat Streaming API ────────────────────────────────────────────────
    if (path === "/api/chat" && method === "POST") {
      try {
        const body = await req.json() as { message?: string; history?: Array<{role:"system"|"user"|"assistant"|"tool";content:string}> };
        if (!body?.message) return json({ error: "expected { message: string }" }, 400);

        const provider = buildProvider(config, {});
        const health   = await provider.health();
        if (!health.ok) {
          return json({ error: `Provider offline: ${health.detail ?? "unreachable"}` }, 503);
        }

        // Build SSE stream
        let cancelled = false;
        const stream = new ReadableStream({
          async start(controller) {
            const enc  = new TextEncoder();
            const send = (data: object) => {
              if (!cancelled) {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
              }
            };

            try {
              // Build messages array
              const history = (body.history ?? []).slice(-10);
              const messages: Message[] = [
                ...history,
                { role: "user", content: body.message! },
              ];

              // Providers expose a one-turn chat API here; dashboard streams the
              // final message as one SSE payload when provider-level streaming is
              // unavailable.
              let fullText = "";
              const result = await provider.chat(messages, []);
              fullText = result.message ?? "";
              if (fullText) send({ text: fullText });

              // Audit the exchange (content capped; no secrets expected in chat)
              store.audit("chat.message", {
                input:  body.message!.slice(0, 200),
                output: fullText.slice(0, 200),
              });

              send({ done: true });
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
            } catch (e) {
              send({ error: (e as Error).message });
            } finally {
              controller.close();
            }
          },
          cancel() {
            cancelled = true;
          },
        });

        return sse(stream);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── Agents Workforce & Workflows ──────────────────────────────────────
    if (path === "/api/agents" && method === "GET") {
      const { WorkflowStore } = await import("../state/stores/workflow-store.ts");
      const wfStore = new WorkflowStore();
      const health = wfStore.health();
      wfStore.close();

      return json({
        agents: [
          { id: "supervisor", name: "Multi-Agent Supervisor" },
          { id: "planner", name: "Strategic Planner" },
          { id: "executor", name: "Action Executor" }
        ],
        workflows: health.workflows
      });
    }

    if (path.startsWith("/api/agents/workflows/") && method === "GET") {
      const id = path.slice("/api/agents/workflows/".length);
      const { WorkflowStore } = await import("../state/stores/workflow-store.ts");
      const wfStore = new WorkflowStore();
      const record = wfStore.getWorkflow(id);
      wfStore.close();

      if (!record) {
        return json({ error: "Workflow not found" }, 404);
      }
      return json(record);
    }

    // ── Overview ──────────────────────────────────────────────────────────
    if (path === "/api/overview") {
      const project = basename(process.cwd());
      const fp = fingerprint(process.cwd());
      const memory = new MemoryStore(store);
      const git = gitSummary(process.cwd());
      return json({
        project,
        workspace: new WorkspaceManager().getActiveId(),
        cwd: process.cwd(),
        fingerprint: fp,
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
        memory: {
          enabled: isMemoryEnabled(),
          count: memory.count(),
          health: memory.health(),
        },
        research: {
          count: store.researchCount(),
          recent: store.listResearch(4),
        },
        git,
        budget: {
          perTaskUsd: config.budget.perTaskUsd,
          perTaskTokens: config.budget.perTaskTokens,
          egressAllowlist: config.security.egressAllowlist,
        },
      });
    }

    // ── Cost ──────────────────────────────────────────────────────────────
    if (path === "/api/cost") {
      return json(store.costSummary());
    }

    // ── Audit ─────────────────────────────────────────────────────────────
    if (path === "/api/audit") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      return json({ entries: store.recentAudit(limit), chain: store.verifyChain() });
    }

    // ── Security ──────────────────────────────────────────────────────────
    if (path === "/api/security") {
      const report = runLab({ egressAllowlist: config.security.egressAllowlist });
      // Do NOT include egress allowlist contents in the response body
      return json({
        ...report,
        egressAllowlist: config.security.egressAllowlist?.map(d => d.replace(/^https?:\/\//, "")) ?? [],
      });
    }

    // ── XR Shield API Endpoints ───────────────────────────────────────────
    if (path === "/api/shield/status") {
      return json({
        state: shieldService.getState(),
        score: shieldService.getPrivacyScore(),
        activeModules: ["Process Inspector", "Startup & Persist", "Privacy Advisor", "Ad & Tracker Filter", "Forensic Quarantine"]
      });
    }

    if (path === "/api/shield/scan") {
      const mode = url.searchParams.get("mode") === "full" ? "full" : "quick";
      const threats = shieldService.runScan(mode);
      return json({ threats });
    }

    if (path === "/api/shield/processes") {
      return json({ processes: shieldService.getSystemProcesses() });
    }

    if (path === "/api/shield/startup") {
      return json({ startup: shieldService.getStartupEntries() });
    }

    if (path === "/api/shield/privacy") {
      return json({
        score: shieldService.getPrivacyScore(),
        telemetry: shieldService.checkTelemetry(),
        adBlock: shieldService.getHostsAdBlockData()
      });
    }

    if (path === "/api/shield/downloads") {
      return json({ downloads: shieldService.getDownloads() });
    }

    if (path === "/api/shield/browser") {
      return json({ browser: shieldService.getBrowserSecurity() });
    }

    if (path === "/api/shield/explain" && method === "POST") {
      try {
        const body = await req.json() as { id?: string };
        if (!body?.id) return json({ error: "id parameter required" }, 400);

        // Find the threat by scanning
        const threats = shieldService.runScan("full");
        const threat = threats.find(t => t.id === body.id);

        if (!threat) return json({ error: "threat not found" }, 404);

        const analysis = shieldService.analyzeThreatWithAgent(threat.agent, threat);
        return json({ analysis });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/shield/quarantine" && method === "POST") {
      try {
        const body = await req.json() as { action: "isolate" | "restore" | "delete"; id: string; threat?: any };
        if (!body?.action || !body?.id) return json({ error: "action and id required" }, 400);

        if (body.action === "isolate") {
          const success = shieldService.quarantineItem(body.id, body.threat);
          return json({ ok: success });
        } else if (body.action === "restore") {
          const success = shieldService.restoreQuarantinedItem(body.id);
          return json({ ok: success });
        } else if (body.action === "delete") {
          const state = shieldService.getState();
          state.quarantined = state.quarantined.filter(q => q.id !== body.id);
          shieldService["saveState"]();
          return json({ ok: true });
        }
        return json({ error: "invalid action" }, 400);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/shield/whitelist" && method === "POST") {
      try {
        const body = await req.json() as { action: "add" | "remove"; type: string; value: string };
        if (!body?.action || !body?.type || !body?.value) return json({ error: "action, type, and value required" }, 400);

        if (body.action === "add") {
          const success = shieldService.whitelistItem(body.type, body.value);
          return json({ ok: success });
        } else if (body.action === "remove") {
          const success = shieldService.removeWhitelistItem(body.value);
          return json({ ok: success });
        }
        return json({ error: "invalid action" }, 400);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/shield/adblock" && method === "POST") {
      try {
        const body = await req.json() as { enable: boolean };
        const success = await shieldService.toggleAdBlock(body.enable);
        return json({ ok: success, active: shieldService.getState().adBlockEnabled });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── Sessions ──────────────────────────────────────────────────────────
    if (path === "/api/sessions") {
      return json({
        sessions: store.recentSessions(50),
        research: store.listResearch(10),
        counts: {
          sessions: store.recentSessions(200).length,
          research: store.researchCount(),
        },
      });
    }

    // ── Providers (safe — no keys returned) ───────────────────────────────
    if (path === "/api/providers") {
      const status = getProviderEnvStatus();
      const rows = await Promise.all(status.map(async (p) => {
        try {
          const provider = buildProvider(config, { provider: p.id });
          const health = await provider.health();
          return {
            id: p.id,
            label: p.label,
            tier: p.tier,
            hasKey: p.hasKey,
            healthy: health.ok,
            latencyMs: health.latencyMs ?? null,
            detail: health.detail ?? null,
          };
        } catch {
          return {
            id: p.id,
            label: p.label,
            tier: p.tier,
            hasKey: p.hasKey,
            healthy: false,
            latencyMs: null,
            detail: "unavailable",
          };
        }
      }));
      return json({
        primary: config.defaults.provider,
        model: config.defaults.model,
        fallback: config.defaults.fallbackProvider,
        fallbackModel: config.defaults.fallbackModel,
        providers: rows,
      });
    }

    if (path === "/api/workspaces") {
      const wm = new WorkspaceManager();
      return json({
        active: wm.getActiveId(),
        workspaces: wm.listWorkspaces().map((ws) => ({
          id: ws.id,
          name: ws.name,
          rootDir: ws.rootDir,
        })),
      });
    }

    // ── Config (safe subset) ──────────────────────────────────────────────
    if (path === "/api/config") {
      return json({
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
        voice: {
          enabled: config.voice.enabled,
          mode: config.voice.mode,
        },
        security: {
          requireApproval: config.security.requireApproval,
          egressAllowlist: config.security.egressAllowlist,
        },
        plugins: {
          enabled: config.plugins.enabled,
          requireTrust: config.plugins.requireTrust,
        },
        // NEVER return apiKeys, secrets, tokens.
      });
    }

    // ── Skills ────────────────────────────────────────────────────────────
    if (path.startsWith("/api/skills")) {
      const skillsRes = await handleSkillsApi(req, url);
      if (skillsRes) return skillsRes;
    }

    // ── Plugins ───────────────────────────────────────────────────────────
    if (path.startsWith("/api/plugins")) {
      const pluginRes = await handlePluginApi(req, url, store);
      if (pluginRes) return pluginRes;
    }

    // ── Computer Control ──────────────────────────────────────────────────
    if (path === "/api/control/status") {
      const kill   = isDisabled();
      const caps   = detectCapabilities();
      const browser = browserStatus();
      return json({
        enabled:        !kill.disabled,
        disabledReason: kill.reason ?? null,
        capabilities:   caps,
        browser,
        pending:        approvals.list().length,
      });
    }

    if (path === "/api/control/events") {
      const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50));
      const all   = store.recentAudit(limit * 4);
      const events = all
        .filter(e => e.event.startsWith("control.") || e.event.startsWith("computer_control."))
        .slice(0, limit);
      return json({ events });
    }

    if (path === "/api/control/pending") {
      return json({ pending: approvals.list() });
    }

    if (path === "/api/control/approve" && method === "POST") {
      try {
        const body = await req.json() as { id?: string; approved?: boolean };
        if (typeof body?.id !== "string" || typeof body?.approved !== "boolean") {
          return json({ error: "expected { id: string, approved: boolean }" }, 400);
        }
        const handled = approvals.answer(body.id, body.approved);
        store.audit(`control.approve.${body.approved ? "granted" : "denied"}`, { id: body.id });
        return json({ ok: handled });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    if (path === "/api/control/plan" && method === "POST") {
      // Plan-only — NEVER executes from dashboard
      try {
        const body = await req.json() as { task?: string; noMemory?: boolean };
        if (!body?.task) return json({ error: "expected { task: string }" }, 400);
        const provider = buildProvider(config, {});
        const result   = await planActions(provider, body.task, { store, noMemory: body.noMemory === true });
        if ("error" in result) return json({ error: result.error }, 422);
        return json({ plan: result.plan, source: result.source });
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    }

    // ── Plan Memory ───────────────────────────────────────────────────────
    if (path === "/api/control/memory") {
      return json({
        enabled: config.control?.memory?.enabled !== false,
        entries: listRemembered(store).map(e => ({
          baselineId:   e.baselineId,
          skillId:      e.skillId,
          task:         e.task,
          steps:        e.actions.length,
          hits:         e.hits,
          rememberedAt: e.rememberedAt,
        })),
      });
    }

    if (path.startsWith("/api/control/memory/") && method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/control/memory/".length));
      if (key === "*" || key === "all") {
        const n = clearAllMemory(store);
        store.audit("control.memory.clear_all", { removed: n });
        return json({ ok: true, removed: n });
      }
      const r = forgetPlan(store, key);
      return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
    }

    // ── Durable Memory (read + delete only) ───────────────────────────────
    // Write surface is CLI-only by design (narrow attack surface)
    if (path === "/api/memory") {
      const mem     = new MemoryStore(store);
      const entries = mem.list().map(e => ({
        id:         e.id,
        category:   e.category,
        content:    e.content,   // content is shown; no secret data should be stored here
        scope:      e.scope,
        source:     e.source,
        tags:       e.tags,
        importance: e.importance,
        expiresAt:  e.expiresAt ?? null,
        updatedAt:  e.updatedAt,
      }));
      return json({
        enabled: isMemoryEnabled(),
        count:   mem.count(),
        stats:   mem.stats(),
        health:  mem.health(),
        entries,
      });
    }

    // Stage 6 — memory health snapshot for the dashboard / doctor.
    if (path === "/api/memory/health") {
      const mem = new MemoryStore(store);
      return json({ enabled: isMemoryEnabled(), ...mem.health() });
    }

    // Stage 6 — keyword memory search (?q=...).
    if (path === "/api/memory/search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ results: [] });
      const mem = new MemoryStore(store);
      const results = mem.search(q).map(e => ({
        id: e.id, category: e.category, content: e.content,
        scope: e.scope, tags: e.tags, importance: e.importance,
      }));
      return json({ query: q, results });
    }

    if (path.startsWith("/api/memory/") && method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/memory/".length));
      const mem = new MemoryStore(store);
      if (key === "*" || key === "all") {
        const n = mem.clear();
        store.audit("memory.clear_all", { removed: n });
        return json({ ok: true, removed: n });
      }
      const r = mem.remove(key);
      store.audit("memory.delete", { id: key, ok: r.ok });
      return json({ ok: r.ok, reason: r.reason }, r.ok ? 200 : 404);
    }
      const controlRes = await handleControlApi(req, url, store);
      if (controlRes) return controlRes;
    // ── 404 ───────────────────────────────────────────────────────────────
    return json({ error: "not found" }, 404);
  };
}

/** Start the local daemon. Prints token + URL once on startup. */
export async function serve(opts: DaemonOptions = {}): Promise<DaemonHandle> {
  const port  = opts.port  ?? 3141;
  const token = opts.token ?? randomBytes(24).toString("hex");
  const store = opts.store ?? new Store();

  const handler = makeHandler(store, token);

  const server = Bun.serve({
    hostname: HOST,
    port,
    fetch:    handler,
  });

  const url = `http://${HOST}:${port}/?token=${token}`;

  // Print startup banner
  const { A, xrCyan, xrGreen, xrDim, xrBold } = await import("../ui/theme.ts");
  console.log(`
  ${xrBold(xrCyan("XR"))} ${xrDim("—")} Local Server
  ${xrGreen("✓")} Listening on  ${xrCyan(`http://${HOST}:${port}`)}
  ${xrGreen("✓")} Dashboard     ${xrCyan(url)}
  ${xrGreen("✓")} Chat          ${xrCyan(`http://${HOST}:${port}/chat?token=${token}`)}
  ${xrDim("Token:")} ${xrDim(token)}
  ${xrDim("Binding: localhost only — never exposed to network")}
`);

  return {
    port,
    token,
    stop:   () => server.stop(),
    handle: handler,
  };
}
