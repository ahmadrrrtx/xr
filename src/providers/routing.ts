/**
 * XR — Provider Routing Engine
 * Supports primary, fallback, local-first, cloud-first, hybrid,
 * and cheapest-available strategies. Keeps fallback logic in one place.
 */

import type { Provider } from "../core/types.ts";
import type { XRConfig } from "../config/config.ts";
import { registry } from "./registry.ts";
import { PRESETS } from "./presets.ts";
import { getSecret } from "../security/secrets.ts";

export type RoutingStrategy =
  | "primary"
  | "localFirst"
  | "cloudFirst"
  | "hybrid"
  | "cheapest"
  | "fastest";

export class ProviderRouter {
  constructor(private config: XRConfig) {}

  resolve(overrides?: {
    provider?: string;
    model?: string;
    strategy?: RoutingStrategy;
  }): Provider {
    const strategy =
      overrides?.strategy ??
      this.config.providerEngine?.routingStrategy ??
      "hybrid";

    let primaryId = overrides?.provider ?? this.config.defaults.provider;
    let primaryModel = overrides?.model ?? this.config.defaults.model;

    // Apply routing strategy
    if (strategy === "localFirst") {
      const local = this.findBestLocal();
      if (local) {
        primaryId = local.id;
        primaryModel = local.model;
      }
    } else if (strategy === "cloudFirst") {
      if (this.isLocal(primaryId)) {
        const cloud = this.findBestCloud();
        if (cloud) {
          primaryId = cloud.id;
          primaryModel = cloud.model;
        }
      }
    } else if (strategy === "cheapest") {
      const cheapest = this.findCheapestAvailable();
      if (cheapest) {
        primaryId = cheapest.id;
        primaryModel = cheapest.model;
      }
    }

    const primary = registry.createProvider(primaryId, this.config, primaryModel);

    // Determine fallback
    let fallbackId: string | undefined =
      this.config.defaults.fallbackProvider;
    let fallbackModel: string | undefined =
      this.config.defaults.fallbackModel;

    if (
      (strategy === "hybrid" || strategy === "localFirst" || strategy === "cloudFirst") &&
      !fallbackId &&
      this.config.localModels?.enabled &&
      !this.isLocal(primaryId)
    ) {
      const local = this.findBestLocal();
      fallbackId = local?.id ?? "ollama";
      fallbackModel = local?.model ?? this.config.defaults.fallbackModel ?? "qwen2.5:7b";
    }

    if (fallbackId && fallbackId !== primaryId) {
      try {
        const fallback = registry.createProvider(
          fallbackId,
          this.config,
          fallbackModel ?? primaryModel,
        );
        return new FallbackProvider(primary, fallback);
      } catch {
        // Fallback broken; proceed with primary only
      }
    }

    return primary;
  }

  private isLocal(id: string): boolean {
    return (
      registry.getPreset(id)?.kind === "local" ||
      PRESETS[id]?.kind === "local"
    );
  }

  private findBestLocal(): { id: string; model: string } | undefined {
    const localCfg: any = this.config.localModels ?? {};
    const configuredProvider = localCfg.provider ?? localCfg.runtime ?? this.config.defaults.provider;
    const preset = registry.getPreset(configuredProvider) ?? PRESETS[configuredProvider];
    if (preset?.kind === "local") {
      return { id: preset.id, model: localCfg.selected ?? this.config.defaults.model ?? preset.defaultModel };
    }

    for (const id of ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"]) {
      const p = registry.getPreset(id) ?? PRESETS[id];
      if (p?.kind === "local") return { id: p.id, model: localCfg.selected ?? p.defaultModel };
    }
    return undefined;
  }

  private findBestCloud(): { id: string; model: string } | undefined {
    const candidates = registry
      .listByKind("hosted")
      .filter(
        (p) => p.apiKeyEnv && (process.env[p.apiKeyEnv] || getSecret(p.apiKeyEnv)),
      );
    if (candidates.length) {
      // Prefer cheapest available
      const tierOrder = { free: 0, cheap: 1, premium: 2, enterprise: 3, custom: 4 };
      const sorted = candidates.sort(
        (a, b) =>
          (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99),
      );
      return { id: sorted[0].id, model: sorted[0].defaultModel };
    }
    return undefined;
  }

  private findCheapestAvailable(): { id: string; model: string } | undefined {
    const all = registry.list().filter((p) => {
      if (p.kind === "local") return true;
      if (p.apiKeyEnv && (process.env[p.apiKeyEnv] || getSecret(p.apiKeyEnv))) return true;
      return false;
    });
    if (!all.length) return undefined;
    const tierOrder = { free: 0, cheap: 1, premium: 2, enterprise: 3, custom: 4 };
    const sorted = all.sort(
      (a, b) => (tierOrder[a.tier] ?? 99) - (tierOrder[b.tier] ?? 99),
    );
    return { id: sorted[0].id, model: sorted[0].defaultModel };
  }
}

/**
 * Wrapper that automatically tries a secondary provider if the primary fails.
 */
export class FallbackProvider implements Provider {
  constructor(
    public primary: Provider,
    public fallback: Provider,
  ) {}

  get id() {
    return this.primary.id;
  }
  get label() {
    return `${this.primary.label} → fallback ${this.fallback.label}`;
  }

  async chat(messages: any[], tools: any[]): Promise<any> {
    try {
      return await this.primary.chat(messages, tools);
    } catch (e) {
      console.warn(
        `\x1b[33m! Primary provider (${this.primary.id}) failed: ${(e as Error).message}. Falling back to ${this.fallback.id}...\x1b[0m`,
      );
      return await this.fallback.chat(messages, tools);
    }
  }

  async health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }> {
    const h = await this.primary.health();
    if (h.ok) return h;
    return await this.fallback.health();
  }
}
