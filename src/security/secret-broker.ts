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
 *
 * ─── Phase 10 deprecation timeline (review item #4) ───────────────────
 * The provider plane already routes through this broker — every native
 * adapter (anthropic, mistral, google, cohere, cerebras, bedrock) and
 * openai-compat calls `secretBrokerSync(envName)`, NOT `process.env[name]`
 * directly. The remaining item is deprecating the compat flag itself:
 *
 *   · v1.x  — XR_SECRETS_ENV_COMPAT opt-in (default OFF); hydrateProviderEnv
 *             is a no-op when off; boot emits a loud warning when on.
 *   · v2.0  — flag removed; ambient process.env hydration eliminated;
 *             KNOWN_LIMITATIONS #4 closes with a test that grep-asserts no
 *             `process.env[API_KEY]` reads in src/providers.
 *
 * Until 2.0, the compat flag is preserved for users who export keys in
 * their shell profile, but every release narrows its surface.
 * ──────────────────────────────────────────────────────────────────────
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

/**
 * Memory-only resolvers consulted before the durable store. Phase 22 uses one for
 * integration tokens, which live in the Integrations CredentialVault. A resolver
 * returns undefined for names it does not own. Values are never written anywhere.
 */
export type RuntimeSecretResolver = (name: string) => string | undefined;
const runtimeResolvers: RuntimeSecretResolver[] = [];

/** Registers a resolver. Returns an unregister function. */
export function registerRuntimeSecretResolver(resolver: RuntimeSecretResolver): () => void {
  runtimeResolvers.push(resolver);
  return () => {
    const i = runtimeResolvers.indexOf(resolver);
    if (i >= 0) runtimeResolvers.splice(i, 1);
  };
}

function fromRuntimeResolvers(name: string): string | undefined {
  for (const r of runtimeResolvers) {
    let value: string | undefined;
    try {
      value = r(name);
    } catch {
      value = undefined;
    }
    if (value) return value;
  }
  return undefined;
}

// ─── Audit hook (review item #4) ───────────────────────────────────────────
//
// An optional, never-blocking observer that fires whenever a key is read
// through the broker. Subscribers receive the key NAME and context only —
// never the value. The default subscriber (wired by the daemon at boot)
// emits a `secret.read` structured-log line so operators can see when
// keys are accessed, without leaking the key material.
export interface SecretReadEvent {
  /** The env-style name of the secret (e.g. "OPENAI_API_KEY"). */
  name: string;
  /** Where the read came from (e.g. "provider", "mcp", "integration"). */
  context?: string;
  /** Which backend served the value. */
  source: "runtime" | "env-compat" | "durable" | "absent";
  /** Sync (`secretBrokerSync`) or async (`secretBroker.get`). */
  path: "sync" | "async";
}

export type SecretReadAuditor = (event: SecretReadEvent) => void;

let secretReadAuditor: SecretReadAuditor | null = null;

/**
 * Install the audit hook. Call this once at daemon boot. Passing `null`
 * uninstalls. The auditor must never throw — exceptions are swallowed to
 * protect the hot path.
 */
export function setSecretReadAuditor(auditor: SecretReadAuditor | null): void {
  secretReadAuditor = auditor;
}

function notifyAuditor(event: SecretReadEvent): void {
  if (!secretReadAuditor) return;
  try {
    secretReadAuditor(event);
  } catch {
    // Auditor failures must never break key resolution.
  }
}

export const secretBroker: SecretBrokerLike = {
  async get(name: string, opts?: SecretGetOptions): Promise<string | undefined> {
    const runtime = fromRuntimeResolvers(name);
    if (runtime) {
      notifyAuditor({ name, context: opts?.context, source: "runtime", path: "async" });
      return runtime;
    }
    if (envSecretCompatEnabled()) {
      const ambient = process.env[name];
      if (ambient) {
        notifyAuditor({ name, context: opts?.context, source: "env-compat", path: "async" });
        return ambient;
      }
    }
    try {
      const { getSecretAsync } = await import("./secrets.ts");
      const stored = await getSecretAsync(name);
      notifyAuditor({
        name,
        context: opts?.context,
        source: stored ? "durable" : "absent",
        path: "async",
      });
      return stored ?? undefined;
    } catch {
      notifyAuditor({ name, context: opts?.context, source: "absent", path: "async" });
      return undefined;
    }
  },
};

/**
 * Sync variant for hot paths (provider selection, key status). Never spawns:
 * process.env (compat-gated) + the sync cached/file lookup only.
 */
export function secretBrokerSync(name: string): string | undefined {
  const runtime = fromRuntimeResolvers(name);
  if (runtime) {
    notifyAuditor({ name, context: "sync-hot-path", source: "runtime", path: "sync" });
    return runtime;
  }
  if (envSecretCompatEnabled()) {
    const ambient = process.env[name];
    if (ambient) {
      notifyAuditor({ name, context: "sync-hot-path", source: "env-compat", path: "sync" });
      return ambient;
    }
  }
  try {
    const v = getSecretSyncCached(name);
    notifyAuditor({
      name,
      context: "sync-hot-path",
      source: v ? "durable" : "absent",
      path: "sync",
    });
    return v;
  } catch {
    notifyAuditor({ name, context: "sync-hot-path", source: "absent", path: "sync" });
    return undefined;
  }
}

/**
 * Hydrate a stored key into process.env ONLY while the compat flag is on.
 * Call sites that store keys must go through this helper so the seam is
 * the one gate. Phase 8 default: no-op.
 *
 * Phase 10 deprecation: this function is the SEAM — when the flag is
 * removed in v2.0, this becomes a literal no-op (or is deleted). All
 * callers already go through it, so the v2.0 change is one commit here.
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
