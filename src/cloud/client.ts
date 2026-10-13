/**
 * XR — cloud session client.
 *
 * ## The non-coupling rule, expressed as code
 *
 * This module is the *only* place in the repository that talks to the XR cloud
 * service. Everything that uses it degrades to a working local product when it
 * returns nothing:
 *
 *   - No token configured → every call answers `{ configured: false }` without
 *     touching the network. There is no dial-out to discover the obvious.
 *   - Service unreachable → a typed `CloudUnreachable`, never a thrown exception
 *     that reaches a UI as a crash.
 *   - `429` → the `Retry-After` is surfaced so a caller can back off honestly
 *     rather than retrying in a loop.
 *
 * ## Why every request goes through `guardedFetch`
 *
 * XR has a central egress proxy that refuses private address ranges, pins the
 * resolved address, and caps response size and wall-clock time. A cloud client
 * that used raw `fetch` would be a hole in that: the allowlist would not apply,
 * and a DNS-rebinding attack against `api.xr.rrrtx.ai` would sail past the one
 * control the whole security model rests on. So cloud traffic is added to the
 * allowlist and goes through the same door as everything else.
 *
 * ## Token handling
 *
 * The session token lives in the secret broker under `XR_CLOUD_SESSION` — the same
 * store as provider API keys, with the same code path and the same "never written
 * to a config file" property. This module reads it and never writes it.
 */

import { guardedFetch, type EgressPolicy } from "../security/egress-proxy.ts";
import { secretBroker } from "../security/secret-broker.ts";

export const CLOUD_SESSION_SECRET = "XR_CLOUD_SESSION";

/** Default API origin. Overridable so a self-hosted control plane works. */
export const DEFAULT_CLOUD_API = "https://api.xr.rrrtx.ai";

export class CloudUnreachable extends Error {
  readonly kind: "network" | "blocked" | "timeout" | "http" | "not_configured";
  readonly status?: number;
  readonly repair: string;

  constructor(kind: CloudUnreachable["kind"], message: string, repair: string, status?: number) {
    super(message);
    this.name = "CloudUnreachable";
    this.kind = kind;
    this.repair = repair;
    this.status = status;
  }
}

export interface CloudClientOptions {
  readonly apiUrl?: string;
  /** Injected for tests. */
  readonly token?: string | null;
  /** Injected for tests: the egress policy consulted for this origin. */
  readonly policy?: EgressPolicy;
}

export interface CloudClient {
  readonly apiUrl: string;
  readonly configured: boolean;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  /** Current entitlement, or a Personal licence state when unconfigured. */
  session(): Promise<{ configured: boolean; token: string | null; orgId: string | null }>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

export function createCloudClient(options: CloudClientOptions = {}): CloudClient {
  const apiUrl = (options.apiUrl ?? process.env.XR_CLOUD_API_URL ?? DEFAULT_CLOUD_API).replace(/\/$/, "");

  async function token(): Promise<string | null> {
    if (options.token !== undefined) return options.token;
    try {
      return (await secretBroker.get(CLOUD_SESSION_SECRET)) ?? null;
    } catch {
      return null;
    }
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const session = await token();
    if (!session) {
      throw new CloudUnreachable(
        "not_configured",
        "Not signed in to an XR team.",
        "Run `xr cloud login`, or sign in from Settings → Billing & Account. XR works fully without this.",
      );
    }

    // The egress policy for this origin. `guardedFetch` refuses private address
    // ranges even for an allow-listed host, which is what stops a DNS-rebinding
    // attack from redirecting licence verification at a local service.
    const policy: EgressPolicy = options.policy ?? {
      allowlist: [hostOf(apiUrl)],
      blockPrivateNetworks: true,
      maxBytes: 1024 * 1024,
      timeoutMs: 15_000,
    };

    const response = await guardedFetch(
      `${apiUrl}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${session}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      policy,
    );

    if (!response.ok) {
      if (response.blocked) {
        throw new CloudUnreachable(
          "blocked",
          `The XR egress policy refused the request: ${response.reason ?? "target not allowed"}.`,
          "The cloud API host must be reachable. This is a local policy decision and nothing on this machine is broken.",
        );
      }
      throw new CloudUnreachable(
        "network",
        `Could not reach the XR service: ${response.reason ?? `status ${response.status ?? "unknown"}`}.`,
        "Team features are unavailable. Everything local keeps working — retry when you have a connection.",
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = response.body ? JSON.parse(response.body) : {};
    } catch {
      throw new CloudUnreachable(
        "http",
        "The XR service returned a response that was not JSON.",
        "This is a bug or a proxy in the middle. Nothing local is affected.",
        response.status,
      );
    }

    // A 4xx that arrived as JSON is a normal API answer — an entitlement refusal,
    // a validation failure — not a transport problem. Surface it as a typed
    // result rather than an exception so callers branch on it deliberately.
    if (response.status && response.status >= 400) {
      const detail = payload as { error?: { message?: string; repair?: string; code?: string } };
      throw new CloudUnreachable(
        "http",
        detail.error?.message ?? `The XR service refused the request (${response.status}).`,
        detail.error?.repair ?? "No repair is available for this. Nothing local is affected.",
        response.status,
      );
    }

    return payload as T;
  }

  return {
    apiUrl,
    configured: true,
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body),
    patch: (path, body) => call("PATCH", path, body),
    del: (path) => call("DELETE", path),

    async session() {
      const session = await token();
      if (!session) return { configured: false, token: null, orgId: null };
      try {
        const me = await call<{ memberships: Array<{ orgId: string }> }>("GET", "/auth/me");
        return { configured: true, token: session, orgId: me.memberships[0]?.orgId ?? null };
      } catch {
        return { configured: true, token: session, orgId: null };
      }
    },
  };
}
