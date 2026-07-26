/**
 * XR 4.4 — Capability-aware provider/model catalog.
 * Built from the existing provider registry + presets; does not own adapters.
 */

import type { XRConfig } from "../config/config.ts";
import { registry } from "../providers/registry.ts";
import { PRESETS, type ProviderPreset } from "../providers/presets.ts";
import { getSecret } from "../security/secrets.ts";
import {
  descriptorFromPreset,
  modelsFromPreset,
  modelKey,
} from "./capability.ts";
import type {
  ModelClass,
  ModelDescriptor,
  ProviderDescriptor,
} from "./types.ts";

export interface IntelligenceCatalog {
  providers: ProviderDescriptor[];
  models: ModelDescriptor[];
  builtAt: number;
}

function credentialAvailable(preset: ProviderPreset): boolean {
  if (!preset.apiKeyEnv) return true;
  return !!(process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv));
}

/**
 * Build a fresh catalog from registry (built-ins + custom) and optional config
 * overlays (providerCapabilities, local runtime health).
 */
export function buildCatalog(config?: XRConfig): IntelligenceCatalog {
  const presets = new Map<string, ProviderPreset>();

  // Built-in presets
  for (const p of Object.values(PRESETS)) {
    presets.set(p.id, p);
  }
  // Registry may have custom + overrides
  for (const p of registry.list()) {
    presets.set(p.id, p);
  }

  // Sync custom from config if provided
  if (config) {
    try {
      registry.syncCustom(config);
      for (const p of registry.list()) {
        presets.set(p.id, p);
      }
    } catch {
      /* registry may be empty in unit tests */
    }
  }

  const providers: ProviderDescriptor[] = [];
  const models: ModelDescriptor[] = [];

  for (const preset of presets.values()) {
    const cred = credentialAvailable(preset);
    const pd = descriptorFromPreset(preset, cred);

    // Overlay local runtime health from config when present
    if (config?.localModels?.runtimes && preset.kind === "local") {
      const rt = (config.localModels.runtimes as Record<string, any>)[preset.id];
      if (rt) {
        pd.health = {
          ok: !!rt.healthy,
          authOk: true,
          available: rt.running !== false && rt.healthy !== false,
          detail: rt.detail,
          checkedAt: rt.lastCheckedAt ? Date.parse(rt.lastCheckedAt) || Date.now() : Date.now(),
          stale: true,
        };
      }
    }

    // Optional per-provider capability overrides from config
    const override = config?.providerEngine?.providerCapabilities?.[preset.id];
    if (override && typeof override === "object") {
      applyCapabilityOverride(pd, override);
    }

    providers.push(pd);
    const ms = modelsFromPreset(preset, cred);
    for (const m of ms) {
      if (pd.health) m.health = pd.health;
      // Apply model-level overrides when present: providerCapabilities[id].models[modelId]
      if (override?.models?.[m.modelId]) {
        applyModelOverride(m, override.models[m.modelId]);
      }
      models.push(m);
    }
  }

  return { providers, models, builtAt: Date.now() };
}

function applyCapabilityOverride(pd: ProviderDescriptor, override: any): void {
  // Only accept explicit tri-state or boolean fields we know
  const capKeys = [
    "chat",
    "reasoning",
    "toolUse",
    "jsonMode",
    "streaming",
    "vision",
    "embeddings",
    "functionCalling",
  ] as const;
  for (const k of capKeys) {
    if (override[k] === true) (pd.capabilities as any)[k] = "supported";
    else if (override[k] === false) (pd.capabilities as any)[k] = "unsupported";
    else if (override[k] === "supported" || override[k] === "unsupported" || override[k] === "unknown") {
      (pd.capabilities as any)[k] = override[k];
    }
  }
}

function applyModelOverride(m: ModelDescriptor, override: any): void {
  if (!override || typeof override !== "object") return;
  applyCapabilityOverride({ capabilities: m.capabilities } as ProviderDescriptor, override);
  if (typeof override.contextWindow === "number") {
    m.context.contextWindow = override.contextWindow;
  }
}

export function findModel(
  catalog: IntelligenceCatalog,
  providerId: string,
  modelId?: string,
): ModelDescriptor | undefined {
  if (modelId) {
    const exact = catalog.models.find(
      (m) => m.providerId === providerId && m.modelId === modelId,
    );
    if (exact) return exact;
  }
  // Default model for provider
  const def = catalog.models.find((m) => m.providerId === providerId && m.isDefault);
  if (def) return def;
  return catalog.models.find((m) => m.providerId === providerId);
}

export function findProvider(
  catalog: IntelligenceCatalog,
  providerId: string,
): ProviderDescriptor | undefined {
  return catalog.providers.find((p) => p.providerId === providerId);
}

export function modelsForClass(
  catalog: IntelligenceCatalog,
  modelClass: ModelClass,
): ModelDescriptor[] {
  if (modelClass === "unknown") return catalog.models;
  return catalog.models.filter(
    (m) =>
      m.classes.includes(modelClass) ||
      (modelClass === "chat" && m.capabilities.chat === "supported") ||
      (modelClass === "tool_use" && m.capabilities.toolUse === "supported") ||
      (modelClass === "structured_output" &&
        (m.capabilities.structuredOutput === "supported" ||
          m.capabilities.jsonMode === "supported")) ||
      (modelClass === "vision" && m.capabilities.vision === "supported") ||
      (modelClass === "embeddings" && m.capabilities.embeddings === "supported") ||
      (modelClass === "reasoning" && m.capabilities.reasoning === "supported"),
  );
}

export function listProviderIds(catalog: IntelligenceCatalog): string[] {
  return catalog.providers.map((p) => p.providerId);
}

export { modelKey };
