/**
 * XR Daemon — onboarding routes (Phase B · B-1).
 *
 * The GUI first-run flow is a THIN ORCHESTRATOR over the same engines the CLI
 * wizard (`src/interfaces/onboard.ts`) uses — one authority, no duplicated
 * logic:
 *   · status   → getProviderEnvStatus() + cached bounded provider health +
 *                offline runtime/internet cache inspection
 *   · provider → setSecret() (OS credential backend / reported file backend) + defaults write
 *                via saveConfig() + explicit opt-in advisory health probe (save never fails
 *                on probe outcome — mirrors the CLI's F-1 behavior)
 *   · complete → audit-recorded completion (append-only, verifiable)
 *
 * No new capability is invented: the routes only expose what the runtime
 * already does. Keys are never returned; the provider list is the same one
 * the Providers panel shows.
 */

import { loadConfig, saveConfig, getProviderEnvStatus } from "../../config/config.ts";
import { PRESETS } from "../../providers/factory.ts";
import { inspectProviderHealth, checkProviderHealthCached, invalidateProviderHealthCache } from "../../providers/health.ts";
import { inspectDetectedRuntimes } from "../../local/runtimes.ts";
import { setSecretAsync, removeSecretAsync } from "../../security/secrets.ts";
import { inspectInternetCache } from "../state/cache.ts";
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
        const configured = status.filter(p => PRESETS[p.id]?.apiKeyEnv && p.hasKey).map(p => p.id);
        // Inspection is offline. Explicit diagnostics populate these caches;
        // saving a key never implies authentication/reachability/agent proof.
        const ready = configured.filter(id => inspectProviderHealth(config, id)?.ok === true);
        const runtimes = inspectDetectedRuntimes();
        const internet = inspectInternetCache();
        const localRuntime = config.localModels.runtime ?? "ollama";
        const localInfo = runtimes.find((r) => r.id === localRuntime);
        const localHealthy = localInfo?.healthy === true;
        const reasons: string[] = [];
        if (configured.length === 0 && !localHealthy) {
          reasons.push("No provider key is stored; a local runtime has not been verified. Configure a provider or run an explicit local diagnostic.");
        } else if (ready.length === 0 && !localHealthy) {
          reasons.push("Configured routes have no fresh successful reachability evidence. Run an explicit diagnostic or select another target.");
        } else if (ready.length === 0) {
          reasons.push("Configured cloud routes have no fresh successful reachability evidence.");
        }
        return json({
          needsSetup: configured.length === 0 && !localHealthy,
          reasons,
          cloud: { configured: configured.length, ready: ready.length, count: status.filter(p => PRESETS[p.id]?.apiKeyEnv).length },
          local: {
            runtime: localRuntime,
            healthy: localHealthy,
            healthState: localInfo ? (localHealthy ? "reachable" : "unreachable") : "unknown",
            running: localInfo?.running ?? false,
            installed: (localInfo?.models ?? []).length,
          },
          internet: internet ?? false, // legacy boolean; unknown is explicit below
          internetState: internet === undefined ? "unknown" : internet ? "reachable" : "unreachable",
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
            /** Phase 14 — the desktop stores keys without switching the default provider. */
            setDefault?: boolean;
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

          const next = loadConfig().config;
          const setDefault = body.setDefault !== false;
          // Never pair a newly selected vendor with the previous vendor's model.
          const targetModel = body.model?.trim() || (next.defaults.provider === providerId ? next.defaults.model : preset.defaultModel);
          if (setDefault && !targetModel) return json({ error: "an explicit model is required for this provider" }, 400);
          state.store.audit("onboarding.provider.requested", { provider: providerId, model: setDefault ? targetModel : null, setDefault });
          const backend = await setSecretAsync(envName, key);
          // No clearSecretMemo() here: setSecretAsync sets the memo to the latest
          // written value on EVERY backend (keychain/secret-service/dpapi AND
          // file), so there is no stale memo to clear — and a blanket clear would
          // discard the just-stored value on OS backends, which are not readable
          // through the sync hot-path used by onboarding.status below. This is what
          // kept `cloud.configured` at 0 right after a successful key save on
          // macOS (cross-platform onboarding contract).
          // Phase 01 — a stored key must invalidate the health cache (and the
          // catalog fingerprint, which includes key presence) so the advisory
          // probe and the next status/list call are FRESH — never a stale
          // "API key not set" negative from before the key existed.
          invalidateProviderHealthCache(providerId);
          if (setDefault) {
            next.defaults.provider = providerId;
            next.defaults.model = targetModel;
            saveConfig(next);
          }
          state.store.audit("onboarding.provider", {
            provider: providerId,
            model: setDefault ? next.defaults.model : null,
            setDefault,
            secretBackend: backend,
          });

          // Advisory probe — the key is saved regardless of its outcome
          // (mirrors the CLI onboarding F-1 contract). Bounded + cached
          // (Phase 01): a hanging endpoint cannot stall the save flow.
          let health: { ok: boolean; detail: string | null; latencyMs: number | null } | null = null;
          if (body.probe === true) {
            try {
              const h = await checkProviderHealthCached(next, providerId);
              health = { ok: h.ok, detail: h.detail ?? null, latencyMs: h.latencyMs ?? null };
            } catch (e) {
              health = { ok: false, detail: (e as Error).message, latencyMs: null };
            }
          }
          return json({
            ok: true,
            provider: providerId,
            model: setDefault ? next.defaults.model : null,
            setDefault,
            secretBackend: backend,
            health,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }
      },
    }),
    route({
      id: "onboarding.provider.remove",
      path: "/api/onboarding/provider/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        try {
          const body = await req.json() as { providerId?: string };
          const provider = PRESETS[body.providerId ?? ""];
          if (!provider?.apiKeyEnv) return json({ error: "a keyed provider preset is required; custom credential changes use the configured engine broker" }, 400);
          state.store.audit("onboarding.provider.remove.requested", { provider: provider.id });
          const backend = await removeSecretAsync(provider.apiKeyEnv);
          invalidateProviderHealthCache(provider.id);
          state.store.audit("onboarding.provider.removed", { provider: provider.id, secretBackend: backend, externalCredentialMayRemain: true });
          return json({ ok: true, provider: provider.id, secretBackend: backend, notice: "Known engine credential storage cleared. Environment variables, other installations and backups may still hold a key. Revoke it at the provider for full revocation." });
        } catch (e) { return json({ error: (e as Error).message }, 400); }
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
