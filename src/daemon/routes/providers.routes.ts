/** XR Daemon — providers, local models, and workspace routes.
 * Phase 04 — canonical provider gateway integration.
 */

import { loadConfig, saveConfig } from "../../config/config.ts";
import { getHardwareSpecs, formatHardwareSummary } from "../../local/hardware.ts";
import { providerGateway } from "../../providers/gateway.ts";
import { recommendLocalAI } from "../../local/recommend.ts";
import { detectAllRuntimes, detectRuntime, testLocalModel } from "../../local/runtimes.ts";
import { isLocalRuntimeId, providerIdForRuntime, validateLocalModelId } from "../../local/registry.ts";
import { XRShieldService } from "../../security/shield.ts";
import { Tokens } from "../../core/tokens.ts";
import { WorkspaceSwitchFailedError } from "../../core/errors.ts";
import { IntelligenceRouter } from "../../intelligence/router.ts";
import { BehavioralStore, behavioralView } from "../../intelligence/behavioral.ts";
import { RoutingHealth, healthView } from "../../intelligence/health.ts";
import { RoutingSlo } from "../../intelligence/slo.ts";
import { route, type DaemonRoute } from "./router.ts";
import type { ModelClass } from "../../intelligence/types.ts";

const MODEL_CLASSES: ReadonlySet<string> = new Set<ModelClass>([
  "chat", "completion", "reasoning", "code", "tool_use", "structured_output",
  "vision", "speech_to_text", "text_to_speech", "image_generation",
  "image_understanding", "embeddings", "reranking", "multimodal", "unknown",
]);

export function providersRoutes(): DaemonRoute[] {
  return [
    route({
      id: "providers.list",
      path: "/api/providers",
      method: "GET",
      handle: async ({ json, config }) => {
        // Phase 04 — canonical provider gateway: ONE source of truth for listing + health
        // Uses registry.list() via gateway (includes custom), health bounded 2500ms cached, credential status central.
        // No N+1 catalog rebuilds, no 120s blocking.
        const presets = providerGateway.list(config);
        const healths = await providerGateway.healthAll(config);

        const healthMap = new Map(healths.map((h) => [h.id, h]));

        const rows = presets.map((p) => {
          const health = healthMap.get(p.id);
          const cred = providerGateway.credentialStatus(p.id);
          return {
            id: p.id,
            label: p.label,
            tier: p.tier,
            kind: p.kind,
            hasKey: cred.available,
            authOk: health?.authOk ?? cred.available,
            healthy: health?.ok ?? false,
            latencyMs: health?.latencyMs ?? null,
            detail: health?.detail ?? null,
            capabilities: p.capabilities,
            defaultModel: p.defaultModel,
            cached: (health as any)?.cached ?? false,
          };
        });

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
      handle: async ({ req, json, state, config }) => {
        try {
          const body = await req.json() as { provider?: string; model?: string; fallbackProvider?: string | null; fallbackModel?: string | null };
          // Phase 04 — use gateway for allowed list (includes custom providers), not just PRESETS
          const allowed = new Set(providerGateway.list(config).map((p) => p.id));
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
    // XR 4.4 — Intelligence plane route explain — now via gateway catalog
    route({
      id: "providers.route",
      path: "/api/providers/route",
      method: "GET",
      handle: async ({ json, config, url }) => {
        const params = url.searchParams;
        const provider = params.get("provider") ?? undefined;
        const model = params.get("model") ?? undefined;
        const rawClass = params.get("class") ?? "chat";
        const modelClass = (MODEL_CLASSES.has(rawClass) ? rawClass : "chat") as ModelClass;
        const localOnly = params.get("localOnly") === "1" || params.get("localOnly") === "true";
        const detailed = params.get("detailed") === "1" || params.get("detailed") === "true";
        const catalog = providerGateway.catalog(config);
        const router = new IntelligenceRouter({
          catalog,
          behavioral: behavioralView(new BehavioralStore()),
          health: healthView(new RoutingHealth()),
        });
        const { decision, record } = router.route(config, {
          provider,
          model,
          requirements: {
            modelClass,
            localityPolicy: localOnly ? "local_only" : undefined,
            require: modelClass === "tool_use" || modelClass === "chat" ? { toolUse: modelClass === "tool_use" ? true : undefined } : undefined,
          },
        });
        return json(detailed ? { decision, record } : { record, summary: decision.explanation });
      },
    }),
    route({
      id: "providers.slo",
      path: "/api/providers/slo",
      method: "GET",
      handle: async ({ json, url }) => {
        const windowMs = Number(url.searchParams.get("windowMs") ?? "") || undefined;
        const report = new RoutingSlo().report(windowMs);
        const breakers = new RoutingHealth().report();
        const contracts = new BehavioralStore().all().map((c) => ({
          key: c.key,
          overallFidelity: c.overallFidelity,
          toolUseFidelity: c.toolUseFidelity,
          structuredOutputFidelity: c.structuredOutputFidelity,
          contextRetention: c.contextRetention,
          refusalRate: c.refusalRate,
          samples: c.samples,
          measuredAt: c.measuredAt,
          source: c.source,
          confidence: c.confidence,
        }));
        return json({ report, breakers, measuredContracts: contracts });
      },
    }),
    route({
      id: "providers.catalog",
      path: "/api/providers/catalog",
      method: "GET",
      handle: async ({ json, config }) => {
        // Phase 04 — catalog via gateway (cached per config hash, TTL 60s)
        const catalog = providerGateway.catalog(config);
        return json({
          builtAt: catalog.builtAt,
          providers: catalog.providers.map((p) => ({
            id: p.providerId,
            label: p.label,
            kind: p.kind,
            tier: p.tier,
            locality: p.locality.locality,
            credentialAvailable: p.auth.credentialAvailable,
            defaultModel: p.defaultModelId,
            capabilities: p.capabilities,
          })),
          models: catalog.models.map((m) => ({
            providerId: m.providerId,
            modelId: m.modelId,
            isDefault: m.isDefault,
            capabilities: m.capabilities,
          })),
          modelCount: catalog.models.length,
        });
      },
    }),
    // Phase 04 — new: provider capabilities endpoint
    route({
      id: "providers.capabilities",
      path: "/api/providers/capabilities",
      method: "GET",
      handle: async ({ json, config, url }) => {
        const id = url.searchParams.get("id");
        if (id) {
          const preset = providerGateway.getPreset(id);
          if (!preset) return json({ error: `unknown provider: ${id}` }, 404);
          const caps = providerGateway.capabilities(id);
          const cred = providerGateway.credentialStatus(id);
          const health = await providerGateway.health(config, id).catch(() => null);
          return json({
            id: preset.id,
            label: preset.label,
            kind: preset.kind,
            tier: preset.tier,
            defaultModel: preset.defaultModel,
            knownModels: preset.knownModels,
            capabilities: caps,
            credential: { required: cred.required, available: cred.available },
            health: health ? { ok: health.ok, latencyMs: health.latencyMs, detail: health.detail, authOk: health.authOk } : null,
          });
        }
        // All capabilities
        const presets = providerGateway.list(config);
        return json({
          providers: presets.map((p) => ({
            id: p.id,
            label: p.label,
            kind: p.kind,
            tier: p.tier,
            capabilities: providerGateway.capabilities(p.id),
          })),
        });
      },
    }),
    // Phase 04 — new: fallback chain endpoint
    route({
      id: "providers.fallback",
      path: "/api/providers/fallback",
      method: "GET",
      handle: async ({ json, config }) => {
        const chain = await providerGateway.fallbackChain(config);
        return json({
          allowed: chain.allowed,
          explanation: chain.explanation,
          steps: chain.steps,
        });
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
          const executor = state.agentExecutor;
          if (!executor) return json({ error: "agent executor unavailable" }, 503);

          const previousId = state.workspaceManager.getActiveId();
          try {
            await executor.switchWorkspace(id);
          } catch (e) {
            if (e instanceof WorkspaceSwitchFailedError) {
              state.store.audit("workspace.switch_failed", {
                from: previousId,
                to: id,
                error: e.message,
              });
              return json({ error: e.message, workspace: { from: previousId, to: id } }, 503);
            }
            throw e;
          }

          const app = executor.app;
          if (app) {
            state.app = app;
            state.workspaceManager = app.workspaces;
            state.store = app.registry.resolve(Tokens.Store);
            state.shield = new XRShieldService(state.store);
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
          // Phase 04 — models.list now also shows gateway catalog + gateway fallback chain
          const specs = await getHardwareSpecs();
          const runtimes = await detectAllRuntimes();
          const local = config.localModels;
          const selectedRuntime = local.runtime ?? "ollama";
          const selectedModel = local.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
          const selectedStatus = isLocalRuntimeId(selectedRuntime)
            ? runtimes.find((r) => r.id === selectedRuntime)
            : undefined;
          const recommendation = recommendLocalAI(specs, { useCase: local.useCase ?? "general", preferredRuntime: isLocalRuntimeId(selectedRuntime) ? selectedRuntime : undefined, runtimes });

          // Gateway catalog info
          const catalog = providerGateway.catalog(config);
          const fallbackChain = await providerGateway.fallbackChain(config);

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
            catalog: {
              modelCount: catalog.models.length,
              providerCount: catalog.providers.length,
              builtAt: catalog.builtAt,
            },
            fallbackChain,
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
          const local = next.localModels;
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
          const providersMap = next.providers as Record<string, Record<string, unknown> | undefined>;
          const overrideId = providerIdForRuntime(runtime);
          providersMap[overrideId] = {
            ...(providersMap[overrideId] ?? {}),
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
          const runtime = body.runtime ?? config.localModels.runtime ?? "ollama";
          const model = (body.model ?? config.localModels.selected ?? config.defaults.model ?? "").trim();
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
