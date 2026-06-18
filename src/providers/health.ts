/**
 * XR — Provider Health Check Engine
 * Tests connectivity, auth, and model availability for any provider.
 * Safe for diagnostics: never prints raw API keys.
 */

import type { XRConfig } from "../config/config.ts";
import { registry } from "./registry.ts";
import { getSecret } from "../security/secrets.ts";

export interface ProviderHealthReport {
  id: string;
  ok: boolean;
  latencyMs?: number;
  detail: string;
  authOk: boolean;
  modelAvailable?: boolean;
  timestamp: string;
}

export class ProviderHealthChecker {
  constructor(private config: XRConfig) {}

  async check(id: string, model?: string): Promise<ProviderHealthReport> {
    const preset = registry.getPreset(id);
    const timestamp = new Date().toISOString();

    if (!preset) {
      return {
        id,
        ok: false,
        detail: "Unknown provider",
        authOk: false,
        timestamp,
      };
    }

    // Auth check (never reveals the key value)
    let authOk = false;
    if (preset.apiKeyEnv) {
      authOk = !!(
        process.env[preset.apiKeyEnv] || getSecret(preset.apiKeyEnv)
      );
    } else {
      authOk = true; // local or no-key provider
    }

    if (!authOk) {
      return {
        id,
        ok: false,
        detail: preset.apiKeyEnv
          ? `API key ${preset.apiKeyEnv} not set`
          : "No authentication required",
        authOk: false,
        timestamp,
      };
    }

    // Connectivity + model availability via provider health()
    try {
      const provider = registry.createProvider(
        id,
        this.config,
        model ?? preset.defaultModel,
      );
      const start = Date.now();
      const h = await provider.health();
      const latency = Date.now() - start;
      return {
        id,
        ok: h.ok,
        latencyMs: h.latencyMs ?? latency,
        detail: h.detail ?? (h.ok ? "healthy" : "unhealthy"),
        authOk,
        modelAvailable: h.ok,
        timestamp,
      };
    } catch (e) {
      return {
        id,
        ok: false,
        detail: (e as Error).message,
        authOk,
        timestamp,
      };
    }
  }

  async checkAll(): Promise<ProviderHealthReport[]> {
    const reports: ProviderHealthReport[] = [];
    for (const preset of registry.list()) {
      reports.push(await this.check(preset.id));
    }
    return reports;
  }

  async checkActive(): Promise<ProviderHealthReport> {
    return this.check(
      this.config.defaults.provider,
      this.config.defaults.model,
    );
  }
}
