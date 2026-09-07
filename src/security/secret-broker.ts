/**
 * XR Phase 8 — Secret broker (the ONLY path for provider credentials).
 *
 * `SecretBroker.get` resolves a named secret. Order: ambient process.env
 * (only when XR_SECRETS_ENV_COMPAT is explicitly on), then the durable
 * secret backends (OS keychain / AES-GCM file store). XR itself never
 * hydrates stored keys into process.env when compat is off.
 *
 * The broker MAY read a user-supplied process.env value (compat on, or
 * as a last-resort presence check the user exported themselves). XR must
 * not WRITE stored keys into process.env when compat is off.
 */

import { getSecretSyncCached } from "./secrets.ts";

import { envSecretCompatEnabled } from "./env-compat.ts";
export { envSecretCompatEnabled } from "./env-compat.ts";

export interface SecretGetOptions {
  /** Call-site context for audit / future policy (e.g. "provider"). */
  context?: string;
}

export interface SecretBrokerLike {
  /**
   * Resolve a named secret. Never throws; returns undefined when absent.
   * Never hydrates process.env (that is `hydrateProviderEnv`'s job, and
   * it is a no-op when compat is off).
   */
  get(name: string, opts?: SecretGetOptions): Promise<string | undefined>;
}

export const secretBroker: SecretBrokerLike = {
  async get(name: string, _opts?: SecretGetOptions): Promise<string | undefined> {
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
 * Hydrate a stored key into process.env ONLY while the compat flag is on.
 * Call sites that store keys must go through this helper so the seam is
 * the one gate. Phase 8 default: no-op.
 */
export function hydrateProviderEnv(name: string, value: string): void {
  if (envSecretCompatEnabled()) {
    process.env[name] = value;
  }
}

/**
 * Resolve a provider API key: explicit override, then the broker.
 * Natives / openai-compat use this instead of reading process.env.
 */
export function resolveProviderKey(envName: string, explicit?: string): string {
  if (explicit) return explicit;
  return secretBrokerSync(envName) ?? "";
}

/**
 * Lazy per-request key provider for OpenAI-compat (and any fetch adapter
 * that can await). Does not cache the raw key on the provider instance.
 */
export function apiKeyProvider(envName: string): () => Promise<string | undefined> {
  return () => secretBroker.get(envName, { context: "provider" });
}
