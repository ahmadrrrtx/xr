/*
 * Billing & Account (Phase 30) — engine client.
 *
 * The desktop never talks to the cloud service directly. It asks the daemon,
 * which owns the session token (in the SecretBroker, like every other
 * credential), verifies the licence offline, and answers in one shape whether or
 * not a team exists.
 *
 * That indirection is the whole reason this screen can promise what it promises:
 * every response has the same shape, so there is no code path in the renderer
 * that behaves differently because a network call failed. `signedIn: false` is a
 * normal state, not a degraded one.
 *
 * Routes (src/daemon/routes/cloud.routes.ts):
 *   GET    /cloud/license            licence state, computed locally
 *   POST   /cloud/license/verify     verify a pasted token
 *   GET    /cloud/license/feature/:f is one Business feature available?
 *   GET    /cloud/session            signed in?
 *   DELETE /cloud/session            sign out
 *   GET    /cloud/teams              teams (degrades when offline)
 *   GET    /cloud/usage              managed-model usage
 */
import { engineJson, EngineHttpError } from '@/engine/transport';

export type LicenseStatus =
  | 'none'
  | 'valid'
  | 'grace'
  | 'expired'
  | 'invalid'
  | 'stale';

export type BusinessFeature =
  | 'team'
  | 'team-workspaces'
  | 'sso-admin'
  | 'managed-models'
  | 'relay'
  | 'memory-sync'
  | 'audit-export'
  | 'admin-console';

export interface LicenseView {
  status: LicenseStatus;
  entitled: boolean;
  plan: string;
  orgId: string | null;
  orgName: string | null;
  seats: number | null;
  features: BusinessFeature[];
  expiresAt: string | null;
  daysRemaining: number | null;
  reason: string | null;
  localUnaffected: true;
  allFeatures: BusinessFeature[];
}

export interface SessionView {
  signedIn: boolean;
  orgId?: string | null;
  note?: string;
}

export interface TeamView {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
  seats: number;
  businessActive: boolean;
}

export interface TeamsView {
  available: boolean;
  reason?: string;
  repair?: string;
  teams?: TeamView[];
  hasTeams?: boolean;
}

export interface UsageView {
  available: boolean;
  reason?: string;
  repair?: string;
  usage?: {
    periodKey: string;
    spentMicroUsd: number;
    includedMicroUsd: number;
    byModel: Array<{ model: string; requests: number; spentMicroUsd: number }>;
  };
}

/** Licence state. Never throws: an engine that is not running is `none`. */
export async function license(): Promise<LicenseView | null> {
  try {
    return await engineJson<LicenseView>('/cloud/license');
  } catch (error) {
    if (error instanceof EngineHttpError) return null;
    return null;
  }
}

export async function session(): Promise<SessionView> {
  try {
    return await engineJson<SessionView>('/cloud/session');
  } catch {
    // The engine link being down is the same user-visible state as being signed
    // out, so it is reported as one. Inventing a third state would put a red
    // banner in front of someone who has simply never created an account.
    return { signedIn: false, note: 'XR is running without a team. Every local feature is fully available.' };
  }
}

export function teams(): Promise<TeamsView> {
  return engineJson<TeamsView>('/cloud/teams');
}

export function usage(): Promise<UsageView> {
  return engineJson<UsageView>('/cloud/usage');
}

export function verifyToken(token: string): Promise<{
  valid: boolean;
  status: LicenseStatus;
  plan: string;
  seats: number | null;
  reason: string | null;
}> {
  return engineJson('/cloud/license/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function signOut(): Promise<{ ok: boolean; note: string }> {
  return engineJson('/cloud/session', { method: 'DELETE' });
}

/** Micro-USD → the shortest string that is still exact. */
export function usd(microUsd: number | null | undefined): string {
  if (microUsd == null) return '—';
  const value = microUsd / 1_000_000;
  if (value === 0) return '$0';
  if (value < 0.01) return `$${value.toFixed(5).replace(/0+$/, '').replace(/\.$/, '')}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
