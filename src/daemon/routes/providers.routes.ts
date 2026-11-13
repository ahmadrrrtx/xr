/** XR Daemon — providers, local models, and workspace routes.
 * Phase 04 — canonical provider gateway integration.
 */

import { loadConfig, saveConfig } from "../../config/config.ts";
import { getHardwareSpecs, formatHardwareSummary } from "../../local/hardware.ts";
import { providerGateway } from "../../providers/gateway.ts";
import { recommendLocalAI } from "../../local/recommend.ts";
import { detectAllRuntimes, detectRuntime, testLocalModel } from "../../local/runtimes.ts";
import { isLocalRuntimeId, providerIdForRuntime, validateLocalModelId } from "../../local/registry.ts";
import { XRShieldService } from "../../hygiene/scanner.ts";
import { Tokens } from "../../core/tokens.ts";
import { WorkspaceSwitchFailedError } from "../../core/errors.ts";
import { IntelligenceRouter } from "../../intelligence/router.ts";
import { BehavioralStore, behavioralView } from "../../intelligence/behavioral.ts";
import { RoutingHealth, healthView } from "../../intelligence/health.ts";
import { RoutingSlo } from "../../intelligence/slo.ts";
import { route, type DaemonRoute } from "./router.ts";
import { sseResponse } from "./builder-shared.ts";
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
        // Listing/configuration must work offline. Only explicit health/probe
        // actions may contact providers; a credential is not reachability.
        const presets = providerGateway.list(config);

        const catalog = providerGateway.catalog(config);
        const rows = presets.map((p) => {
          const health = providerGateway.inspectHealth(config, p.id);
          const cred = providerGateway.credentialStatus(p.id);
          return {
            id: p.id,
            label: p.label,
            tier: p.tier,
            kind: p.kind,
            locality: catalog.providers.find(d => d.providerId === p.id)?.locality.locality ?? "unknown",
            // 2026-11-01: preset metadata so clients can render the full
            // provider catalog from the engine (single source of truth)
            // instead of hardcoding a stale subset.
            description: p.description ?? null,
            docsUrl: p.docsUrl ?? null,
            baseUrl: p.baseUrl ?? null,
            authType: p.authType ?? "bearer",
            keyless: p.authType === "none",
            knownModels: p.knownModels ?? [],
            hasKey: cred.available,
            authOk: health?.authOk ?? false,
            healthy: health?.ok ?? false, // legacy pessimistic boolean; use healthState for unknown
            healthState: health ? (health.ok ? "reachable" : "unreachable") : "unknown",
            authState: health ? (health.authOk ? "verified" : "failed") : cred.available ? "unverified" : "missing_credentials",
            checkedAt: health?.timestamp ?? null,
            latencyMs: health?.latencyMs ?? null,
            detail: health?.detail ?? null,
            capabilities: p.capabilities,
            defaultModel: p.defaultModel,
            cached: health?.cached ?? false,
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
          const preset = providerGateway.getPreset(body.provider);
          const targetModel = body.model?.trim() || (next.defaults.provider === body.provider ? next.defaults.model : preset?.defaultModel);
          if (!targetModel) return json({ error: "an explicit model is required for this provider" }, 400);
          state.store.audit("providers.set.requested", { provider: body.provider, model: targetModel });
          next.defaults.provider = body.provider;
          next.defaults.model = targetModel;
          next.defaults.fallbackProvider = body.fallbackProvider || undefined;
          next.defaults.fallbackModel = body.fallbackProvider ? (body.fallbackModel?.trim() || (config.defaults.fallbackProvider === body.fallbackProvider ? next.defaults.fallbackModel : providerGateway.getPreset(body.fallbackProvider)?.defaultModel)) : undefined;
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
        const mode = params.get("mode") === "automatic" ? "automatic" as const : undefined;
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
          mode,
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
            contextWindow: m.context.contextWindow,
            locality: m.locality.locality,
            cost: m.cost,
            evidence: m.evidence,
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
          const health = providerGateway.inspectHealth(config, id) ?? null;
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
    /**
     * XR-REL-02 — real model pull, streamed.
     *
     * The desktop's download step used to fabricate its progress (a 6-second
     * `setInterval` over a made-up byte total, rendered as "real bytes, real
     * progress"), because the engine had NO pull route at all. This is that
     * route: it proxies the local runtime's own pull endpoint and forwards the
     * runtime's bytes/layers verbatim, ending on a real installed-model check.
     *
     * Honesty rules:
     *   · local runtimes only — a hosted provider has nothing to download;
     *   · the model id is validated before it reaches a URL or a process;
     *   · `status: "success"` is only emitted after the runtime reports the
     *     model as present, otherwise `error` names what is missing;
     *   · when the runtime is unreachable the stream says so immediately
     *     instead of hanging on a spinner.
     */
    route({
      id: "models.pull",
      path: "/api/models/pull",
      method: "POST",
      handle: async ({ req, json, state, config }) => {
        let body: { runtime?: string; model?: string };
        try {
          body = await req.json() as { runtime?: string; model?: string };
        } catch {
          return json({ error: "a JSON body is required" }, 400);
        }
        const runtime = (body.runtime ?? config.localModels.runtime ?? "ollama").trim();
        const model = (body.model ?? "").trim();
        if (!isLocalRuntimeId(runtime))
          return json({ error: "valid local runtime is required" }, 400);
        if (!model || !validateLocalModelId(model))
          return json({ error: "valid local model id is required" }, 400);

        // Reuse the runtime probe: it resolves the CONFIGURED base URL (a user
        // may have moved Ollama off :11434) and tells us whether it is up, so a
        // dead runtime is reported as such instead of surfacing as a fetch error.
        const status = await detectRuntime(runtime);
        const root = (status.baseUrl ?? "").replace(/\/$/, "").replace(/\/v1$/, "");
        if (!root || !status.healthy || !status.running)
          return json(
            {
              error: `${runtime} is not reachable${status.detail ? `: ${status.detail}` : ""}`,
              runtimeUnavailable: true,
            },
            409
          );

        state.store.audit("models.pull.requested", { runtime, model });

        return sseResponse(async (send, signal) => {
          const emit = (status: string, extra: Record<string, unknown> = {}): void =>
            send({ type: "pull", status, runtime, model, ...extra });

          emit("starting");
          try {
            const res = await fetch(`${root}/api/pull`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: model, stream: true }),
              signal,
            });
            if (!res.ok || !res.body) {
              emit("error", { detail: `${runtime} answered ${res.status} for /api/pull` });
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let sawSuccess = false;
            const reader = res.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              // NDJSON: one JSON object per line.
              let nl = buffer.indexOf("\n");
              while (nl !== -1) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                nl = buffer.indexOf("\n");
                if (!line) continue;
                let frame: Record<string, unknown>;
                try {
                  frame = JSON.parse(line) as Record<string, unknown>;
                } catch {
                  continue; // a partial/odd line is not progress
                }
                const err = typeof frame.error === "string" ? frame.error : null;
                if (err) {
                  emit("error", { detail: err });
                  return;
                }
                const status = typeof frame.status === "string" ? frame.status : "";
                if (status === "success") sawSuccess = true;
                const completed = typeof frame.completed === "number" ? frame.completed : undefined;
                const total = typeof frame.total === "number" ? frame.total : undefined;
                // The runtime's own wording is kept in `detail`; `pct` is only
                // present when the runtime reported a real denominator.
                emit(
                  status === "success" ? "success" : /verif|sha256|writing/i.test(status) ? "verifying" : "pulling",
                  {
                    detail: status || null,
                    digest: typeof frame.digest === "string" ? frame.digest : undefined,
                    completed,
                    total,
                    pct: completed !== undefined && total ? completed / total : undefined,
                  }
                );
                if (status === "success") break;
              }
            }

            if (!sawSuccess) {
              emit("error", { detail: "the runtime's pull stream ended without a success frame" });
              return;
            }

            // A success frame is the runtime's word; the installed list is ours.
            const after = await detectRuntime(runtime);
            // `LocalRuntimeStatus.models` is a list of model NAMES (strings).
            const present = after.models.includes(model) || after.models.includes(`${model}:latest`);
            if (!present) {
              emit("error", { detail: `${runtime} reported success but ${model} is not in its model list` });
              return;
            }
            state.store.audit("models.pull.done", { runtime, model });
            emit("done", { installed: true });
          } catch (e) {
            if (signal.aborted) return; // the client went away; not a failure
            emit("error", { detail: (e as Error).message });
          }
        });
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
