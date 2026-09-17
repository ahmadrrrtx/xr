/**
 * Typed client for the XR engine daemon API (/api/v1).
 * The shell NEVER computes risk/policy/budget — it renders engine truth and forwards decisions.
 * (Boundary law: docs/xr-rebuild/XR_SECURITY_AUDIT.md SEC-07)
 */
const BASE = "/api/v1";

export class EngineDown extends Error {}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new EngineDown("engine unreachable");
  }
  if (res.status === 401) throw new EngineDown("unauthorized — pairing required");
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

export interface Health {
  ok?: boolean;
  version?: string;
  [k: string]: unknown;
}
export interface Overview {
  [k: string]: unknown;
}
export interface SessionSummary {
  id: string;
  title?: string;
  prompt?: string;
  mode?: string;
  status?: string;
  cwd?: string;
  workspace?: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  provider?: string;
  costUsd?: number;
  tokens?: unknown;
  [k: string]: unknown;
}
export interface Approval {
  id: string;
  action?: string;
  reason?: string;
  risk?: string;
  status?: string;
  [k: string]: unknown;
}

export const api = {
  health: () => req<Health>("/health"),
  overview: () => req<Overview>("/overview"),
  sessions: () => req<SessionSummary[] | { sessions: SessionSummary[] }>("/sessions"),
  session: (id: string) => req<Record<string, unknown>>(`/sessions/${encodeURIComponent(id)}`),
  approvals: () => req<Approval[] | { approvals: Approval[] }>("/approvals"),
  /** Decide an approval — forwarded to engine; engine re-validates (display-only UI). */
  decide: (id: string, decision: "approve" | "deny") =>
    req<unknown>(`/approvals/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
};

export function asList<T>(v: T[] | { [k: string]: unknown } | undefined, ...keys: string[]): T[] {
  if (Array.isArray(v)) return v;
  if (v) for (const k of keys) if (Array.isArray((v as Record<string, unknown>)[k])) return (v as Record<string, unknown>)[k] as T[];
  return [];
}
