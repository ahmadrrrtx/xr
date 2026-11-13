/**
 * XR-REL-06 — custom OpenAI-compatible endpoints. The engine has held these
 * since `xr providers add` (SSRF-guarded) but had no HTTP route, so the desktop
 * could not offer "any OpenAI-compatible API" at all. Own module: size gate.
 */
import { validateProviderUrl } from "../../providers/provider-url-guard.ts";
import { ProviderService } from "../../services/provider-service.ts";
import { providerGateway } from "../../providers/gateway.ts";
import { Tokens } from "../../core/tokens.ts";
import { route, type DaemonRoute, type DaemonState } from "./router.ts";
import type { XRApp } from "../../core/app.ts";

export function customProviderRoutes(): DaemonRoute[] {
  return [
    route({
      id: "providers.custom.list",
      path: "/api/providers/custom",
      method: "GET",
      handle: async ({ json, state }) => {
        const config = (await requireApp(state)).registry.resolve(Tokens.Config).get() as any;
        const list = (config.providerEngine?.customProviders ?? []) as Array<Record<string, any>>;
        // Never echo a credential — only the env-var NAME and a headers flag.
        return json({
          providers: list.map((c) => ({
            id: c.id, label: c.label ?? c.id, baseUrl: c.baseUrl, defaultModel: c.defaultModel,
            apiKeyEnv: c.apiKeyEnv ?? null, hasHeaders: Object.keys(c.headers ?? {}).length > 0,
          })),
        });
      },
    }),
    route({
      id: "providers.custom.add",
      path: "/api/providers/custom",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => null)) as {
          id?: string; label?: string; baseUrl?: string; defaultModel?: string;
          apiKey?: string; apiKeyEnv?: string; headers?: Record<string, string>;
        } | null;
        if (!body) return json({ error: "a JSON body is required" }, 400);
        const baseUrl = (body.baseUrl ?? "").trim();
        const defaultModel = (body.defaultModel ?? "").trim();
        if (!baseUrl) return json({ error: "baseUrl is required" }, 400);
        if (!defaultModel) return json({ error: "defaultModel is required" }, 400);

        // A5 — refuse a URL that could reach loopback/link-local/metadata hosts
        // BEFORE anything is persisted or fetched (addCustomProvider re-checks
        // with DNS-rebinding protection; this lets the API name the reason).
        const guard = await validateProviderUrl(baseUrl);
        if (!guard.ok) {
          (await requireApp(state)).registry.resolve(Tokens.Store)
            .audit("providers.custom.refused", { baseUrl, reason: guard.reason });
          return json({ error: `Custom provider URL refused: ${guard.reason}` }, 400);
        }

        let id = sanitiseProviderId(body.id ?? deriveProviderId(baseUrl) ?? "");
        if (!id) return json({ error: "pass `id` (lowercase letters, digits, '.', '_', '-')" }, 400);
        // Never shadow a BUILT-IN preset: `groq` from api.groq.com would replace
        // the built-in entry AND inherit GROQ_API_KEY — one service's key sent
        // to another host. Suffix instead.
        if (providerGateway.getPreset(id)) id = `${id}-compatible`.slice(0, 64);

        const registry = (await requireApp(state)).registry;
        const apiKeyEnv =
          body.apiKeyEnv ?? `${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
        // Two endpoints must never share one secret.
        const existing = (registry.resolve(Tokens.Config).get() as any)
          .providerEngine?.customProviders ?? [];
        const clash = existing.find((c: any) => c.id !== id && c.apiKeyEnv === apiKeyEnv);
        if (clash)
          return json({ error: `apiKeyEnv ${apiKeyEnv} already belongs to "${clash.id}"` }, 400);

        const label = (body.label ?? "").trim() || id;
        const service = new ProviderService(registry);
        try {
          await service.addCustomProvider({
            id, label, baseUrl: baseUrl.replace(/\/+$/, ""), defaultModel,
            apiKeyEnv, headers: body.headers, capabilities: { chat: true },
          });
          if (body.apiKey) await service.storeKey(apiKeyEnv, body.apiKey);
        } catch (e) {
          return json({ error: (e as Error).message }, 400);
        }

        registry.resolve(Tokens.Store).audit("providers.custom.added", {
          id, baseUrl, defaultModel, keyed: Boolean(body.apiKey),
        });
        return json({
          ok: true,
          provider: { id, label, baseUrl, defaultModel, apiKeyEnv, keyed: Boolean(body.apiKey) },
        });
      },
    }),
    route({
      id: "providers.custom.remove",
      path: "/api/providers/custom/remove",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => null)) as { id?: string } | null;
        if (!body) return json({ error: "a JSON body is required" }, 400);
        const id = (body.id ?? "").trim();
        if (!id) return json({ error: "id is required" }, 400);

        const registry = (await requireApp(state)).registry;
        try {
          await new ProviderService(registry).removeCustomProvider(id);
        } catch (e) {
          return json({ error: (e as Error).message }, 404);
        }
        // The stored secret is deliberately NOT deleted: another provider may
        // share the env var, and silently dropping a credential the user cannot
        // see is worse than leaving an unused one behind.
        registry.resolve(Tokens.Store).audit("providers.custom.removed", { id });
        return json({ ok: true });
      },
    }),
  ];
}

/**
 * XR-REL-06 — derive a readable provider id from the endpoint host, e.g.
 * `https://api.together.xyz/v1` → `together`. Co-located with its only caller
 * so it cannot drift from the engine's id rules.
 */
function deriveProviderId(raw: string): string | null {
  try {
    const parts = new URL(raw).hostname.toLowerCase().split(".").filter((p) => p && p !== "www" && p !== "api");
    return parts.length > 1 ? parts[parts.length - 2] ?? null : parts[0] ?? null;
  } catch {
    return null;
  }
}

function sanitiseProviderId(raw: string): string | null {
  const id = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 64);
  return id || null;
}

/** The canonical XRApp (composition root) — custom-provider writes must use the
 *  SAME registry as the agent loop, or the running engine never sees them. */
async function requireApp(state: DaemonState): Promise<XRApp> {
  const executor = state.agentExecutor;
  if (!executor) throw new Error("agent executor unavailable — engine still starting");
  return executor.ensureApp();
}
