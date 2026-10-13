/**
 * Browser-side client for the XR cloud service.
 *
 * Three deliberate properties:
 *
 *   1. **The base URL is configured, not guessed.** `NEXT_PUBLIC_XR_CLOUD_API`
 *      is baked at build time. There is no hardcoded `api.xr.rrrtx.ai` fallback,
 *      because a self-hosted console that silently calls our production API
 *      instead of the operator's own instance is a data-protection incident with
 *      a UI on top.
 *
 *   2. **Every request is relative to that base and sends credentials.** The
 *      session lives in an httpOnly cookie, so the console cannot read it — it
 *      can only present it. That is the point: an XSS in the console gets a
 *      session it can use for a few minutes rather than a refresh token it can
 *      exfiltrate.
 *
 *   3. **A deployment with no cloud API configured is a supported state.** The
 *      public site still builds and still renders; the console shows a demo
 *      dataset with a visible banner rather than an empty page or a crash. The
 *      sandbox this document was authored in has no network at all, and a
 *      screenshot tool that renders a stack trace is not useful to anyone.
 */

export const CLOUD_API: string = (process.env.NEXT_PUBLIC_XR_CLOUD_API ?? "").replace(/\/$/, "");

export const cloudConfigured = CLOUD_API.length > 0;

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  readonly repair: string | null;

  constructor(status: number, code: string, message: string, repair: string | null) {
    super(message);
    this.name = "CloudError";
    this.status = status;
    this.code = code;
    this.repair = repair;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; repair?: string };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!cloudConfigured) {
    throw new CloudError(0, "not_configured", "This deployment has no cloud API configured.", null);
  }

  const res = await fetch(`${CLOUD_API}${path}`, {
    ...init,
    // httpOnly session cookie. Without this the console is a static picture.
    credentials: "include",
    headers: {
      // Only set a content-type when there is a body: sending one on a GET makes
      // some proxies treat the request as preflighted for no reason.
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      // A non-JSON error body is itself information; fall through to the default.
    }
    throw new CloudError(
      res.status,
      body.error?.code ?? "unknown",
      body.error?.message ?? `Request failed with ${res.status}.`,
      body.error?.repair ?? null,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ── shapes the console renders ─────────────────────────────────────────── */

export interface Membership {
  orgId: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member";
  status: string;
}

export interface Me {
  user: { id: string; email: string; name: string | null; emailVerified: boolean };
  memberships: Membership[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  role: Membership["role"];
  memberStatus: string;
  joinedAt: string;
  plan: string;
  planStatus: string;
  trialEndsAt: string | null;
  seats: number;
  cancelAtPeriodEnd: boolean;
  deletionScheduledAt: string | null;
}

export interface Entitlement {
  plan: string;
  status: string;
  seats: number;
  interval: string;
  businessActive: boolean;
  features: string[];
  reason: string | null;
  trial: { active: boolean; endsAt: string | null; daysLeft: number } | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  isPastDue: boolean;
  note: string;
}

export interface PolicyView {
  includedQuotaMicroUsd: number;
  defaultDailyBudgetMicroUsd: number | null;
  defaultMonthlyBudgetMicroUsd: number | null;
  teamMonthlyBudgetMicroUsd: number | null;
  requireApprovalAboveMicroUsd: number | null;
  allowedProviders: Array<{ provider: string; models?: string[] }>;
  egressRules: Array<{ destination: string; note?: string }>;
  dataRetentionDays: number;
  auditRetentionDays: number;
  blockSensitiveMemory: boolean;
  disableByok: boolean;
  relayEnabled: boolean;
}

export interface AuditEntry {
  id: string;
  seq: number;
  action: string;
  actorKind: string;
  actorEmail: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  at: string;
  entryHash: string;
  detail: Record<string, unknown> | null;
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: Membership["role"];
  status: string;
  joinedAt: string;
  lastActiveAt: string | null;
  ssoBound: boolean;
  dailyCapMicroUsd: number | null;
  monthlyCapMicroUsd: number | null;
  byokOnly: boolean;
}

export interface Fact {
  id: string;
  workspaceId: string;
  category: string;
  visibility: string;
  body: string;
  tags: string[];
  version: number;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export const cloud = {
  me: () => request<Me>("/auth/me"),
  teams: () => request<{ teams: Team[]; hasTeams: boolean; note: string }>("/teams"),
  entitlement: () => request<Entitlement>("/license/me"),
  subscription: () =>
    request<{
      subscription: {
        plan: string;
        status: string;
        seats: number;
        interval: string;
        trialEndsAt: string | null;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
        isPastDue: boolean;
        businessActive: boolean;
        reason: string | null;
      };
      invoices: Array<{ id: string; number: string | null; totalMicroUsd: number; status: string; issuedAt: string; url: string | null }>;
    }>("/billing/subscription"),

  members: (orgId: string) => request<{ members: Member[] }>(`/teams/${orgId}/members`),
  policies: (orgId: string) => request<{ policies: PolicyView; source: string; viewerRole: string }>(`/teams/${orgId}/policies`),
  audit: (orgId: string, query = "") => request<{ entries: AuditEntry[]; nextCursor: string | null; retentionDays: number }>(`/teams/${orgId}/audit${query}`),
  memory: (orgId: string) => request<{ facts: Fact[]; workspaces: Array<{ id: string; name: string; slug: string; factCount: number }> }>(`/teams/${orgId}/memory`),
  apiKeys: (orgId: string) => request<{ keys: ApiKey[] }>(`/teams/${orgId}/api-keys`),
  sso: (orgId: string) =>
    request<{
      configured: boolean;
      kind: string | null;
      provider: string | null;
      enabled: boolean;
      enforced: boolean;
      emailDomains: string[];
      metadataUrl: string | null;
    }>(`/teams/${orgId}/sso`),

  signup: (input: { email: string; name?: string; orgName: string; password?: string }) =>
    request<{ org: { id: string; name: string; slug: string }; plan: string; trialEndsInDays: number }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  magicLink: (email: string, redirectTo?: string) =>
    request<{ ok: boolean; message: string; capturedTo?: string }>("/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, redirectTo }),
    }),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  checkout: (interval: "month" | "year", seats: number) =>
    request<{ url: string }>("/billing/checkout", { method: "POST", body: JSON.stringify({ interval, seats }) }),

  portal: () => request<{ url: string }>("/billing/portal", { method: "POST", body: JSON.stringify({}) }),

  cancel: () => request<{ ok: boolean; message: string }>("/billing/cancel", { method: "POST", body: JSON.stringify({}) }),

  reactivate: () => request<{ ok: boolean }>("/billing/reactivate", { method: "POST", body: JSON.stringify({}) }),
};

/** Micro-USD to a display string. The API never sends floats for money. */
export function usd(microUsd: number): string {
  const value = microUsd / 1_000_000;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

export function relativeDays(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
}
