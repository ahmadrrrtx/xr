/**
 * XR Phase 2 · F-24 — Secret broker SEAM (ADR-0010 completion lands in
 * Phase 8; this phase makes the seam exist and tested).
 *
 * The broker is the single interface through which provider credentials are
 * resolved. Today it wraps the existing env/OS-backend lookup so behavior is
 * unchanged; Phase 8 will make it the ONLY path (env hydration removed in
 * 2.0). `XR_SECRETS_ENV_COMPAT` gates the legacy process.env hydration
 * (see env-compat.ts — the single flag definition).
 */

import { getSecretSyncCached } from "./secrets.ts";

import { envSecretCompatEnabled } from "./env-compat.ts";
export { envSecretCompatEnabled } from "./env-compat.ts";

export interface SecretBrokerLike {
  /**
   * Resolve a named secret. Order: ambient process.env (only when env
   * compat is on), then the durable secret backends (OS keychain /
   * AES-GCM file store). Never throws; returns undefined when absent.
   */
  get(name: string): Promise<string | undefined>;
}

export const secretBroker: SecretBrokerLike = {
  async get(name: string): Promise<string | undefined> {
    if (envSecretCompatEnabled()) {
      const ambient = process.env[name];
      if (ambient) return ambient;
    }
    try {
      const { getSecretAsync } = await import("./secrets.ts");
      const stored = await getSecretAsync(name);
      return stored ?? undefined;
    } catch {
      return undefined;
    }
  },
};

/**
 * Sync variant for hot paths (provider selection, key status). Never spawns:
 * process.env (compat-gated) + the sync cached/file lookup only.
 */
export function secretBrokerSync(name: string): string | undefined {
  if (envSecretCompatEnabled()) {
    const ambient = process.env[name];
    if (ambient) return ambient;
  }
  try {
    return getSecretSyncCached(name);
  } catch {
    return undefined;
  }
}

/**
 * Phase 2 · F-24 — hydrate a stored key into process.env ONLY while the
 * compat flag is on. Phase 8 removes ambient hydration entirely; call sites
 * that store keys must go through this helper so the seam is the one gate.
 */
export function hydrateProviderEnv(name: string, value: string): void {
  if (envSecretCompatEnabled()) {
    process.env[name] = value;
  }
}
