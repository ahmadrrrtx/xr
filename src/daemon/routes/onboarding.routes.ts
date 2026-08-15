/**
 * XR Daemon — onboarding routes (Phase B · B-1).
 *
 * The GUI first-run flow is a THIN ORCHESTRATOR over the same engines the CLI
 * wizard (`src/interfaces/onboard.ts`) uses — one authority, no duplicated
 * logic:
 *   · status   → getProviderEnvStatus() + buildProvider().health() +
 *                detectAllRuntimes() + best-effort internet probe
 *   · provider → setSecret() (OS keychain / sealed file) + defaults write
 *                via saveConfig() + advisory health probe (save never fails
 *                on probe outcome — mirrors the CLI's F-1 behavior)
 *   · complete → audit-recorded completion (append-only, verifiable)
 *
 * No new capability is invented: the routes only expose what the runtime
 * already does. Keys are never returned; the provider list is the same one
 * the Providers panel shows.
 */

import { loadConfig, saveConfig, getProviderEnvStatus } from "../../config/config.ts";
import { PRESETS, buildProvider } from "../../providers/factory.ts";
import { checkProviderHealthCached, invalidateProviderHealthCache } from "../../providers/health.ts";
import { detectAllRuntimes } from "../../local/runtimes.ts";
import { setSecretAsync, clearSecretMemo, getSecretSyncCached } from "../../security/secrets.ts";
import { checkInternetCached } from "../state/cache.ts";
import { route, type DaemonRoute } from "./router.ts";

export function onboardingRoutes(): DaemonRoute[] {
  return [
    route({
      id: "onboarding.status",
      path: "/api/onboarding/status",
      method: "GET",
      handle: async ({ json, config }) => {
        const status = getProviderEnvStatus();
        // Only HOSTED presets with a stored key count as configured — local
        // presets never need a key (getProviderEnvStatus marks them hasKey),
        // and they are covered by the local-runtime health below.
        const configured = Object.values(PRESETS)
          .filter((p) => p.apiKeyEnv && Boolean(process.env[p.apiKeyEnv] || getSecretSyncCached(p.apiKeyEnv)))
          .map((p) => p.id);
        // Health probes run IN PARALLEL, are bounded (~2.5 s each), and are
        // served from the shared health cache (60 s positive / 15 s negative):
        // the status call is an advisory "is anything ready" check and must
        // never take 8 s × N providers or re-probe the same provider on every
        // dashboard poll.
        const ready: string[] = [];
        await Promise.all(
          configured.map(async (id) => {
            try {
              const health = await checkProviderHealthCached(config, id);
              if (health.ok) ready.push(id);
            } catch {
              // checkProviderHealthCached already reports failure internally;
              // never break status.
            }
          }),
        );
        // Phase 01 — runtime detection and the internet probe are independent;
        // run them concurrently (was sequential: detection + up to 2 s probe).
        const [runtimes, internet] = await Promise.all([
          detectAllRuntimes(),
          checkInternetCached(),
        ]);
        const localRuntime = config.localModels.runtime ?? "ollama";
        const localInfo = runtimes.find((r) => r.id === localRuntime);
        const localHealthy = localInfo?.healthy === true;
        const reasons: string[] = [];
        if (configured.length === 0 && !localHealthy) {
          reasons.push("No provider key is stored and no local model is running yet.");
        } else if (ready.length === 0 && !localHealthy) {
          reasons.push("Your configured route(s) are not reachable and no local model is running.");
        } else if (ready.length === 0) {
          reasons.push("Your configured route(s) are not reachable right now.");
        }
        return json({
          needsSetup: configured.length === 0 && !localHealthy,
          reasons,
          cloud: { configured: configured.length, ready: ready.length, count: status.length },
          local: {
            runtime: localRuntime,
            healthy: localHealthy,
            running: localInfo?.running ?? false,
            installed: (localInfo?.models ?? []).length,
          },
          internet,
          config: {
            provider: config.defaults.provider,
            model: config.defaults.model,
            memory: config.memory.enabled,
            voice: config.voice.enabled,
            approval: (config.security.requireApproval?.length ?? 0) > 0,
          },
        });
      },
    }),
    route({
      id: "onboarding.provider",
      path: "/api/onboarding/provider",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = (await req.json()) as {
            providerId?: string;
            apiKey?: string;
            model?: string;
            probe?: boolean;
          };
          const providerId = body.providerId ?? "";
          const allowed = new Set(getProviderEnvStatus().map((p) => p.id));
          if (!allowed.has(providerId)) return json({ error: "valid provider is required" }, 400);
          const preset = PRESETS[providerId];
          const envName = preset?.apiKeyEnv;
          if (!envName) return json({ error: "this provider does not take an API key" }, 400);
          const key = body.apiKey?.trim() ?? "";
          if (!key) return json({ error: "apiKey is required" }, 400);
          if (key.length > 2048) return json({ error: "apiKey is unreasonably long" }, 400);

          const backend = await setSecretAsync(envName, key);
          clearSecretMemo();
          // Phase 01 — a stored key must invalidate the health cache (and the
          // catalog fingerprint, which includes key presence) so the advisory
          // probe and the next status/list call are FRESH — never a stale
          // "API key not set" negative from before the key existed.
          invalidateProviderHealthCache(providerId);
          const next = loadConfig().config;
          next.defaults.provider = providerId;
          if (body.model?.trim()) next.defaults.model = body.model.trim();
          saveConfig(next);
          state.store.audit("onboarding.provider", {
            provider: providerId,
            model: next.defaults.model,
            secretBackend: backend,
          });

          // Advisory probe — the key is saved regardless of its outcome
          // (mirrors the CLI onboarding F-1 contract). Bounded + cached
          // (Phase 01): a hanging endpoint cannot stall the save flow.
          let health: { ok: boolean; detail: string | null; latencyMs: number | null } | null = null;
          if (body.probe !== false) {
            try {
              const h = await checkProviderHealthCached(next, providerId);
              health = { ok: h.ok, detail: h.detail ?? null, latencyMs: h.latencyMs ?? null };
            } catch (e) {
              health = { ok: false, detail: (e as Error).message, latencyMs: null };
            }
          }
          return json({ ok: true, provider: providerId, model: next.defaults.model, secretBackend: backend, health });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "onboarding.complete",
      path: "/api/onboarding/complete",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          await req.clone().json();
        } catch {
          // empty/absent body is fine — completion is the audit event.
        }
        state.store.audit("onboarding.complete", { source: "dashboard", ts: Date.now() });
        return json({ ok: true });
      },
    }),
  ];
}
