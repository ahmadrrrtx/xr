/**
 * XR Phase 8 · F-24 — the SECRET BROKER (ADR-0010 completion).
 *
 * The broker is the ONLY sanctioned way any part of XR obtains a provider
 * credential. Phase 2 created the seam; Phase 8 makes it the path of record:
 *
 *   · XR never hydrates a key into `process.env` (default OFF — F-24 closed).
 *     A compromised plugin, an in-process extension, or a `printenv` in a
 *     spawned child can no longer enumerate provider keys that XR put there.
 *   · Providers no longer read `process.env[apiKeyEnv]` themselves. They
 *     receive an `apiKeyProvider` callback and resolve LAZILY, per request,
 *     so the value exists in a local variable for the life of one HTTP call
 *     instead of for the life of the process.
 *   · A key the USER exported is still honoured (BYOK) unless the operator
 *     asks for the sealed posture — see env-compat.ts for why those are two
 *     different questions.
 *
 * ── Resolution order, and why the durable store wins ────────────────────────
 *
 * Durable backend (OS keychain / AES-GCM file store) is consulted BEFORE the
 * ambient environment. This is the opposite of the Phase 2 seam's order and
 * the change is deliberate: `xr providers key set` is an explicit, auditable
 * act by the operator, whereas an inherited environment variable may be a
 * leftover from a parent shell, a CI runner default, or another tool's export.
 * When the two disagree, the one the user typed into XR wins, and the
 * disagreement is observable through `describe()`.
 *
 * ── Redaction ───────────────────────────────────────────────────────────────
 *
 * The broker never logs a value and never returns one from a describe/status
 * path. `redactSecret` is exported so every surface renders keys the same way.
 */

import { getSecretSyncCached } from "./secrets.ts";
import { envAmbientReadEnabled, envHydrationEnabled } from "./env-compat.ts";

export {
  envAmbientReadEnabled,
  envHydrationEnabled,
  envSecretCompatEnabled,
  secretEnvPosture,
  secretEnvPostureNote,
} from "./env-compat.ts";

/** Where a resolved secret came from — for status/doctor, never for logs. */
export type SecretSource = "durable" | "ambient-env" | "absent";

export interface SecretDescription {
  readonly name: string;
  readonly present: boolean;
  readonly source: SecretSource;
  /** Redacted preview, e.g. "sk-…4f2a". Never the value. */
  readonly preview?: string;
  /** True when a durable value and an ambient value disagree. */
  readonly shadowed: boolean;
}

export interface SecretBrokerLike {
  get(name: string): Promise<string | undefined>;
}

/**
 * Render a secret for human eyes. Short values are fully masked — showing
 * "last 4" of an 8-character token leaks half of it.
 */
export function redactSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length < 12) return "…";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

function ambient(name: string): string | undefined {
  if (!envAmbientReadEnabled()) return undefined;
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function durableSync(name: string): string | undefined {
  try {
    return getSecretSyncCached(name);
  } catch {
    return undefined;
  }
}

export const secretBroker: SecretBrokerLike = {
  /**
   * Resolve a named secret. Durable store first, ambient env second (when the
   * posture permits). Never throws; `undefined` means "no key", which callers
   * must report honestly rather than treating as an empty string.
   */
  async get(name: string): Promise<string | undefined> {
    const quick = durableSync(name);
    if (quick) return quick;
    try {
      const { getSecretAsync } = await import("./secrets.ts");
      const stored = await getSecretAsync(name);
      if (stored) return stored;
    } catch {
      /* backend unavailable — fall through to ambient */
    }
    return ambient(name);
  },
};

/**
 * Sync resolution for hot paths (provider selection, key-present checks).
 * Never spawns a keychain subprocess.
 */
export function secretBrokerSync(name: string): string | undefined {
  return durableSync(name) ?? ambient(name);
}

/**
 * Build the lazy per-request callback a provider receives instead of a raw
 * key. The provider calls this at request time; the value is never stored on
 * the provider instance, so a heap dump of a long-lived provider object does
 * not contain the credential.
 */
export function apiKeyProviderFor(name: string | undefined): () => Promise<string | undefined> {
  if (!name) return async () => undefined;
  return async () => secretBroker.get(name);
}

/** Status projection. Returns no secret material. */
export function describeSecret(name: string): SecretDescription {
  const durable = durableSync(name);
  const amb = ambient(name);
  const value = durable ?? amb;
  return {
    name,
    present: Boolean(value),
    source: durable ? "durable" : amb ? "ambient-env" : "absent",
    preview: redactSecret(value),
    shadowed: Boolean(durable && amb && durable !== amb),
  };
}

/**
 * Phase 8 · F-24 — hydrate a stored key into process.env.
 *
 * Retained as the SINGLE gate for the write direction so that the census test
 * has exactly one call site to police, but it is a NO-OP by default now: the
 * only way a provider key lands in ambient memory is an explicit
 * `XR_SECRETS_ENV_HYDRATION=1` opt-in. Removed entirely in 2.0.
 */
export function hydrateProviderEnv(name: string, value: string): void {
  if (envHydrationEnabled()) {
    process.env[name] = value;
  }
}
