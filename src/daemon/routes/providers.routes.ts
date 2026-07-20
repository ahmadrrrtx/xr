/** XR Daemon — providers, local models, and workspace routes. */

import { loadConfig, saveConfig, getProviderEnvStatus } from "../../config/config.ts";
import { buildProvider } from "../../providers/factory.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../../local/hardware.ts";
import { recommendLocalAI } from "../../local/recommend.ts";
import { detectAllRuntimes, detectRuntime, testLocalModel } from "../../local/runtimes.ts";
import { isLocalRuntimeId, providerIdForRuntime, validateLocalModelId } from "../../local/registry.ts";
import { XRShieldService } from "../../security/shield.ts";
import { route, type DaemonRoute } from "./router.ts";

export function providersRoutes(): DaemonRoute[] {
  return [
    route({
      id: "providers.list",
      path: "/api/providers",
      method: "GET",
      handle: async ({ json, config }) => {
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
            return { id: p.id, label: p.label, tier: p.tier, hasKey: p.hasKey, healthy: false, latencyMs: null, detail: "unavailable" };
          }
        }));
        return json({
          primary: config.defaults.provider,
          model: config.defaults.model,
          fallback: config.defaults.fallbackProvider,
          fallbackModel: config.defaults.fallbackModel,
          providers: rows,
        });
      },
    }),
    route({
      id: "providers.set",
      path: "/api/providers/set",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { provider?: string; model?: string; fallbackProvider?: string | null; fallbackModel?: string | null };
          const allowed = new Set(getProviderEnvStatus().map((p) => p.id));
          if (!body.provider || !allowed.has(body.provider)) return json({ error: "valid provider is required" }, 400);
          if (body.fallbackProvider && !allowed.has(body.fallbackProvider)) return json({ error: "fallbackProvider must be a known provider" }, 400);
          const next = loadConfig().config;
          next.defaults.provider = body.provider;
          if (body.model?.trim()) next.defaults.model = body.model.trim();
          next.defaults.fallbackProvider = body.fallbackProvider || undefined;
          next.defaults.fallbackModel = body.fallbackProvider ? (body.fallbackModel?.trim() || next.defaults.fallbackModel) : undefined;
          saveConfig(next);
          state.store.audit("providers.set", {
            provider: next.defaults.provider,
            model: next.defaults.model,
            fallbackProvider: next.defaults.fallbackProvider ?? null,
            fallbackModel: next.defaults.fallbackModel ?? null,
          });
          return json({ ok: true, provider: next.defaults.provider, model: next.defaults.model, fallbackProvider: next.defaults.fallbackProvider ?? null, fallbackModel: next.defaults.fallbackModel ?? null });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "workspaces.list",
      path: "/api/workspaces",
      method: "GET",
      handle: ({ json, state }) => json({
        active: state.workspaceManager.getActiveId(),
        workspaces: state.workspaceManager.listWorkspaces().map((ws) => ({ id: ws.id, name: ws.name, rootDir: ws.rootDir })),
      }),
    }),
    route({
      id: "workspaces.create",
      path: "/api/workspaces/create",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { id?: string; name?: string };
          const id = (body.id ?? "").trim();
          if (!id || !/^[a-z0-9_-]+$/i.test(id)) return json({ error: "workspace id must match /^[a-z0-9_-]+$/i" }, 400);
          const ctx = state.workspaceManager.ensureWorkspace(id, (body.name ?? id).trim() || id);
          state.store.audit("workspace.create", { id: ctx.id, name: ctx.name });
          return json({ ok: true, workspace: { id: ctx.id, name: ctx.name, rootDir: ctx.rootDir } });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "workspaces.switch",
      path: "/api/workspaces/switch",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { id?: string };
          const id = (body.id ?? "").trim();
          if (!id) return json({ error: "workspace id is required" }, 400);
          const previousId = state.workspaceManager.getActiveId();
          if (previousId !== id) {
            const previousStore = state.store;
            state.workspaceManager.setActiveId(id);
            state.store = state.workspaceManager.getStore(id);
            state.shield = new XRShieldService(state.store);
            try { previousStore.close(); } catch {}
          }
          state.store.audit("workspace.switch", { from: previousId, to: id });
          return json({ ok: true, active: state.workspaceManager.getActiveId() });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "models.list",
      path: "/api/models",
      method: "GET",
      handle: async ({ json, config }) => {
        try {
          const specs = detectHardwareSpecs();
          const runtimes = await detectAllRuntimes();
          const local = config.localModels as any;
          const selectedRuntime = local.runtime ?? "ollama";
          const selectedModel = local.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
          const selectedStatus = isLocalRuntimeId(selectedRuntime) ? await detectRuntime(selectedRuntime) : undefined;
          const recommendation = recommendLocalAI(specs, { useCase: local.useCase ?? "general", preferredRuntime: isLocalRuntimeId(selectedRuntime) ? selectedRuntime : undefined, runtimes });
          return json({
            selected: {
              runtime: selectedRuntime,
              model: selectedModel,
              routing: local.routing ?? "hybrid",
              provider: local.provider ?? providerIdForRuntime(selectedRuntime),
              enabled: local.enabled ?? false,
            },
            current: selectedStatus ?? null,
            hardware: { summary: formatHardwareSummary(specs), specs },
            recommendation,
            runtimes,
            installed: Array.isArray(local.installed) ? local.installed : [],
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    }),
    route({
      id: "models.select",
      path: "/api/models/select",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { runtime?: string; model?: string; routing?: "local-only" | "hybrid" | "cloud-first" };
          const runtime = body.runtime ?? "";
          const model = (body.model ?? "").trim();
          if (!isLocalRuntimeId(runtime)) return json({ error: "valid local runtime is required" }, 400);
          if (!model || !validateLocalModelId(model)) return json({ error: "valid local model id is required" }, 400);
          const status = await detectRuntime(runtime);
          const next = loadConfig().config;
          const local = next.localModels as any;
          local.enabled = true;
          local.runtime = runtime;
          local.provider = providerIdForRuntime(runtime);
          local.selected = model;
          local.routing = body.routing ?? local.routing ?? "hybrid";
          local.runtimes = local.runtimes ?? {};
          local.runtimes[runtime] = {
            providerId: providerIdForRuntime(runtime),
            baseUrl: status.baseUrl,
            installed: status.installed,
            running: status.running,
            configured: true,
            healthy: status.healthy,
            lastCheckedAt: new Date().toISOString(),
            detail: status.detail,
          };
          local.installed = Array.isArray(local.installed) ? local.installed : [];
          if (!local.installed.some((m: any) => m.runtime === runtime && m.model === model)) {
            local.installed.push({
              id: model,
              runtime,
              providerId: providerIdForRuntime(runtime),
              model,
              family: ["general"],
              source: runtime,
              downloaded: status.models.includes(model),
              configured: true,
              healthy: status.healthy,
              baseUrl: status.baseUrl,
              installedAt: new Date().toISOString(),
              lastCheckedAt: new Date().toISOString(),
              detail: status.detail,
            });
          }
          if (local.routing === "local-only") {
            next.defaults.provider = providerIdForRuntime(runtime);
            next.defaults.model = model;
            next.defaults.fallbackProvider = undefined;
            next.defaults.fallbackModel = undefined;
          } else {
            next.defaults.fallbackProvider = providerIdForRuntime(runtime);
            next.defaults.fallbackModel = model;
          }
          (next.providers as any)[providerIdForRuntime(runtime)] = {
            ...((next.providers as any)[providerIdForRuntime(runtime)] ?? {}),
            baseUrl: status.baseUrl,
          };
          saveConfig(next);
          state.store.audit("models.select", { runtime, model, routing: local.routing, baseUrl: status.baseUrl });
          return json({ ok: true, runtime, model, routing: local.routing, status });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "models.test",
      path: "/api/models/test",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        try {
          const body = await req.json() as { runtime?: string; model?: string };
          const runtime = body.runtime ?? (config.localModels as any).runtime ?? "ollama";
          const model = (body.model ?? (config.localModels as any).selected ?? config.defaults.model ?? "").trim();
          if (!isLocalRuntimeId(runtime)) return json({ error: "valid local runtime is required" }, 400);
          if (!model || !validateLocalModelId(model)) return json({ error: "valid local model id is required" }, 400);
          const status = await detectRuntime(runtime);
          const result = await testLocalModel(runtime, model, status.baseUrl);
          state.store.audit("models.test", { runtime, model, ok: result.ok, detail: result.detail, latencyMs: result.latencyMs ?? null });
          return json({ ok: true, runtime, model, status, result });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
  ];
}
