/*
 * Integrations (Phase 22) — pure UI logic. No I/O and no React, so it can be tested
 * directly. The engine decides the connection state; this file only maps that state
 * to what a card shows and how the list is filtered.
 */
import type { IntegrationStatus, IntegrationView } from './api';

export type CardState =
  | 'coming_soon'
  | 'setup_required'
  | 'connect'
  | 'connecting'
  | 'connected'
  | 'reauth';

/** Which footer a card shows. `connecting` is local UI state (a browser sign-in is in progress). */
export function deriveCardState(view: Pick<IntegrationView, 'support' | 'status' | 'needsAppCredentials' | 'hasAppCredentials'>, connecting = false): CardState {
  if (view.support === 'coming_soon') return 'coming_soon';
  if (view.status === 'expired' || view.status === 'error') return 'reauth';
  if (view.status === 'connected') return 'connected';
  if (connecting) return 'connecting';
  if (view.needsAppCredentials && !view.hasAppCredentials) return 'setup_required';
  return 'connect';
}

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  disconnected: 'Not connected',
  connected: 'Connected',
  expired: 'Re-auth needed',
  error: 'Re-auth needed',
};

export const AUTH_LABEL: Record<IntegrationView['authType'], string> = {
  oauth2: 'OAuth',
  api_key: 'API key',
  basic: 'Password',
  bearer: 'Token',
  bot_token: 'Bot token',
  none: 'No sign-in',
};

export const CATEGORY_CHIPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'communication', label: 'Communication' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'development', label: 'Development' },
  { id: 'storage', label: 'Storage' },
  { id: 'crm_erp', label: 'CRM / ERP' },
  { id: 'automation', label: 'Automation' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'payments', label: 'Payments' },
  { id: 'commerce', label: 'Commerce' },
  { id: 'design', label: 'Design' },
  { id: 'infrastructure', label: 'Infrastructure' },
];

export function categoryLabel(id: string): string {
  return CATEGORY_CHIPS.find((c) => c.id === id)?.label ?? id;
}

export function countByCategory(list: ReadonlyArray<Pick<IntegrationView, 'category'>>): Record<string, number> {
  const counts: Record<string, number> = { all: list.length };
  for (const item of list) counts[item.category] = (counts[item.category] ?? 0) + 1;
  return counts;
}

/**
 * Search: every whitespace-separated term must appear (case-insensitively) in the
 * name, description, category label, or a capability. This is substring matching
 * on terms, not a ranked fuzzy search. The PR says so.
 */
export function filterIntegrations<T extends Pick<IntegrationView, 'category' | 'name' | 'description' | 'capabilities'>>(
  list: readonly T[],
  opts: { category: string; query: string },
): T[] {
  const terms = opts.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((item) => {
    if (opts.category !== 'all' && item.category !== opts.category) return false;
    if (terms.length === 0) return true;
    const haystack = [item.name, item.description, categoryLabel(item.category), ...item.capabilities]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

interface Brand {
  monogram: string;
  /** Muted brand hue for the tile background. Chosen to sit on the dark and light themes. */
  color: string;
}

/**
 * Brand monograms. Only the first two connectors are connectable in this build;
 * the others use a deterministic colour from their id, so the grid stays stable
 * and no logo is claimed without permission.
 */
const KNOWN_BRANDS: Record<string, Brand> = {
  github: { monogram: 'GH', color: '#4b5563' },
  coolify: { monogram: 'CF', color: '#6d4aff' },
  gmail: { monogram: 'G', color: '#b4483f' },
  slack: { monogram: 'S', color: '#6b4c9a' },
  google_calendar: { monogram: 'GC', color: '#2f6fb0' },
  google_drive: { monogram: 'GD', color: '#3f8f5b' },
  stripe: { monogram: 'St', color: '#5b5fc7' },
  linear: { monogram: 'Li', color: '#5e6ad2' },
};

export function brandFor(id: string, name: string): Brand {
  const known = KNOWN_BRANDS[id];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { monogram: name.trim().charAt(0).toUpperCase() || '?', color: `hsl(${hue} 22% 38%)` };
}

/** "Connected 3 days ago" / "Connected on 2 Oct 2026". Relative within a week, otherwise a date. */
export function connectedSince(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((now - t) / 86_400_000);
  if (days < 1) return 'Connected today';
  if (days < 7) return `Connected ${days} ${days === 1 ? 'day' : 'days'} ago`;
  return `Connected on ${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function lastSyncLabel(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Not synced yet';
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return 'Not synced yet';
  if (minutes < 1) return 'Synced just now';
  if (minutes < 60) return `Synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Synced ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Lines shown under "Will access" / "Will NOT access" for connectors without engine copy. */
export function requestedScopeLines(view: Pick<IntegrationView, 'scopes' | 'scopeCopy'>): { willAccess: string[]; willNotAccess: string[] } {
  if (view.scopeCopy) return { willAccess: [...view.scopeCopy.willAccess], willNotAccess: [...view.scopeCopy.willNotAccess] };
  return { willAccess: view.scopes.map((s) => `Scope requested: ${s}`), willNotAccess: [] };
}

/** A parsed xr://oauth/callback. */
export type OAuthCallback =
  | { kind: 'success'; code: string; state: string }
  | { kind: 'denied'; state: string };

/** Parses xr://oauth/callback?code=…&state=… (or ?error=…&state=…). Anything else returns null. */
export function parseOAuthCallback(raw: string): OAuthCallback | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'xr:') return null;
  // xr://oauth/callback → host "oauth", pathname "/callback"
  if (url.host !== 'oauth' || url.pathname.replace(/\/+$/, '') !== '/callback') return null;
  const state = url.searchParams.get('state') ?? '';
  if (!state || state.length > 256) return null;
  if (url.searchParams.has('error')) return { kind: 'denied', state };
  const code = url.searchParams.get('code') ?? '';
  if (!code || code.length > 512) return null;
  return { kind: 'success', code, state };
}
