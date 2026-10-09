/*
 * Skills Store (Phase 20) — engine client. Every call goes through the paired
 * engine link (`engineFetch`, base …/api/v1); nothing here talks to the web.
 *
 * Routes (src/daemon/skills-api.ts, mcp.routes.ts, plugin-api.ts):
 *   GET  /skills/marketplace            merged listing + updates + featured
 *   POST /skills/marketplace/sync       registry refresh
 *   POST /skills/install                202 {jobId} — quarantine-first install
 *   GET  /skills/install/:job/stream    SSE step events (replay + live)
 *   POST /skills/install-from-url       validate + signature preview
 *   GET  /skills/:id/inspect            permissions + dependencies report
 *   POST /skills/:id/promote            exit quarantine (engine-side lift)
 *   POST /skills/:id/permissions        {grant, revoke}
 *   POST /skills/:id/settings           validated per-skill settings
 *   POST /skills/:id/uninstall          remove + revoke
 *   POST /skills/:id/enable|disable
 *   GET/POST /mcp/*                     server registry, health, pins/drift
 *   GET  /plugins · /plugins/catalog ·  plugin host management
 */
import { engineFetch, engineJson, EngineHttpError, enginePost } from '@/engine/transport';
import { readSse } from '@/engine/sse';

import type {
  DependencyReport,
  FromUrlPreview,
  InstallEvent,
  MarketplaceResponse,
  McpPinDrift,
  McpServer,
  PermissionReport,
  RegistryEndpoint,
  SkillRecord,
  SkillUpdate,
} from './core';

export interface ListResponse {
  health: Record<string, unknown>;
  skills: SkillRecord[];
}

export function fetchMarketplace(query?: string, signal?: AbortSignal): Promise<MarketplaceResponse> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  return engineJson<MarketplaceResponse>(`/skills/marketplace${qs}`, { signal });
}

export function fetchSkills(query?: string, signal?: AbortSignal): Promise<ListResponse> {
  const qs = query ? `?q=${encodeURIComponent(query)}` : '';
  return engineJson<ListResponse>(`/skills${qs}`, { signal });
}

export function syncMarketplace(): Promise<{ results: Array<{ endpoint: RegistryEndpoint; ok: boolean; error?: string }> }> {
  return enginePost('/skills/marketplace/sync', {});
}

export function checkUpdates(): Promise<{ updates: SkillUpdate[] }> {
  return engineJson<{ updates: SkillUpdate[] }>('/skills/marketplace/updates');
}

export interface InspectResponse {
  skill: SkillRecord;
  permissions: PermissionReport;
  dependencies: DependencyReport;
  quarantineCopy: { summary: string; limits: string[]; promoteHint: string };
}

export function inspect(id: string, signal?: AbortSignal): Promise<InspectResponse> {
  return engineJson<InspectResponse>(`/skills/${encodeURIComponent(id)}/inspect`, { signal });
}

export interface InstallInput {
  id: string;
  registryId?: string;
  versionRange?: string;
  fromUrl?: string;
  localPath?: string;
  quarantine: boolean;
  grantPermissions?: string[];
  enable?: boolean;
  pin?: boolean;
}

export interface InstallJobRef {
  jobId: string;
  skillId: string;
  quarantine: boolean;
  quarantineEnforced: boolean;
}

export function startInstall(input: InstallInput): Promise<InstallJobRef> {
  return enginePost<InstallJobRef>('/skills/install', input);
}

/** Pump the install stream; resolves when the engine sends [DONE]. */
export async function streamInstall(jobId: string, onEvent: (e: InstallEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await engineFetch(`/skills/install/${encodeURIComponent(jobId)}/stream`, {
    headers: { accept: 'text/event-stream' },
    signal,
  });
  if (!res.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    throw new EngineHttpError(res.status, '/skills/install/stream', body);
  }
  await readSse(
    res,
    (payload) => {
      if (payload === '[DONE]') return;
      try {
        onEvent(JSON.parse(payload) as InstallEvent);
      } catch {
        /* skip malformed frames — never crash the install view */
      }
    },
    signal,
  );
}

export function installFromUrl(source: { url?: string; localPath?: string }): Promise<FromUrlPreview> {
  return enginePost<FromUrlPreview>('/skills/install-from-url', source);
}

export interface PromoteResponse {
  ok: true;
  id: string;
  promoted: boolean;
  grantedPermissions: string[];
  quarantine: SkillRecord['quarantine'];
}

export function promote(id: string): Promise<PromoteResponse> {
  return enginePost<PromoteResponse>(`/skills/${encodeURIComponent(id)}/promote`, {});
}

export function uninstall(id: string): Promise<{ ok: boolean; id: string }> {
  return enginePost(`/skills/${encodeURIComponent(id)}/uninstall`, {});
}

export function setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean }> {
  return enginePost(`/skills/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, {});
}

export interface PermissionsMutationResponse {
  ok: true;
  granted?: string[];
  revoked?: string[];
  parkedInQuarantine?: string[];
  report: PermissionReport;
  quarantine: SkillRecord['quarantine'];
}

export function mutatePermissions(id: string, grant: string[] = [], revoke: string[] = []): Promise<PermissionsMutationResponse> {
  return enginePost<PermissionsMutationResponse>(`/skills/${encodeURIComponent(id)}/permissions`, { grant, revoke });
}

export function fetchSettings(id: string): Promise<{ id: string; values: Record<string, unknown> }> {
  return engineJson(`/skills/${encodeURIComponent(id)}/settings`);
}

export function saveSettings(id: string, settings: Record<string, unknown>): Promise<{ ok: true; values: Record<string, unknown> }> {
  return enginePost(`/skills/${encodeURIComponent(id)}/settings`, { settings });
}

export function pinSkill(id: string, pinned: boolean): Promise<{ ok: boolean }> {
  return enginePost('/skills/pin', { id, pinned });
}

// ─── MCP (existing daemon routes — reused verbatim) ─────────────────────────

export function listMcp(signal?: AbortSignal): Promise<{ servers: McpServer[] }> {
  return engineJson('/mcp', { signal });
}

export interface AddMcpInput {
  id: string;
  name: string;
  transport: McpServer['transport'];
  cmd?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export function addMcp(input: AddMcpInput): Promise<{ ok: true; server: { id: string } }> {
  return enginePost('/mcp/add', input);
}

export function removeMcp(id: string): Promise<{ ok: true }> {
  return enginePost('/mcp/remove', { id });
}

export function setMcpEnabled(id: string, enabled: boolean): Promise<{ ok: true }> {
  return enginePost(`/mcp/${enabled ? 'enable' : 'disable'}`, { id });
}

export interface McpHealthReport {
  id: string;
  state: string;
  detail?: string;
  tools?: number;
}

/** Probe one server by id (bounded engine-side) or all enabled servers when omitted. */
export function mcpHealth(opts: { id?: string; signal?: AbortSignal } = {}): Promise<{ reports: McpHealthReport[] }> {
  const qs = opts.id ? `?id=${encodeURIComponent(opts.id)}` : '';
  return engineJson(`/mcp/health${qs}`, { signal: opts.signal });
}

export function mcpPins(signal?: AbortSignal): Promise<{ servers: Record<string, { pinnedAt: number; by: string; tools: Record<string, unknown> }> }> {
  return engineJson('/mcp/pins', { signal });
}

export function mcpPin(serverId: string): Promise<{ ok: true; pinnedTools: number; pinnedAt: number }> {
  return enginePost('/mcp/pin', { serverId, actor: 'skills-store' });
}

export function mcpUnpin(serverId: string): Promise<{ ok: boolean }> {
  return enginePost('/mcp/unpin', { serverId });
}

export function mcpPinDiff(serverId: string): Promise<{ serverId: string; drift: McpPinDrift }> {
  return engineJson(`/mcp/pins/diff/${encodeURIComponent(serverId)}`);
}

// ─── Plugins (existing daemon routes) ───────────────────────────────────────

export interface PluginRow {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  loaded: boolean;
  /** Only set when the engine reports it; never assumed. */
  sandboxed?: boolean;
  health?: string;
  trustLevel?: string;
  source?: string;
  permissions?: Array<{ scope: string; granted: boolean; dangerous?: boolean }>;
  errors?: string[];
}

/** Shape the engine actually returns from GET /api/plugins (plugin-api.ts). */
interface EnginePluginRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  loaded: boolean;
  status?: string;
  detail?: string;
  /** The engine sends an object ({ state, checkedAt }), not a string. */
  health?: { state?: string } | string;
  /** Manifest-declared scopes: plain strings from the engine. */
  permissions?: string[];
  grantedPermissions?: string[];
  trustLevel?: string;
  source?: string;
}

/**
 * Normalise engine rows into `PluginRow`. The engine sends manifest scopes as
 * strings plus a separate granted list; the UI wants one `{scope, granted}`
 * entry per scope. Nothing is inferred here (no "dangerous" guess): the engine
 * does not classify plugin scopes, so `dangerous` stays unset.
 */
function toPluginRow(raw: EnginePluginRow): PluginRow {
  const granted = new Set(raw.grantedPermissions ?? []);
  return {
    id: raw.id,
    name: raw.name,
    version: raw.version,
    description: raw.description ?? '',
    enabled: raw.enabled,
    loaded: raw.loaded,
    health: typeof raw.health === 'string' ? raw.health : (raw.health?.state ?? raw.status),
    trustLevel: raw.trustLevel,
    source: raw.source,
    errors: raw.detail && raw.status === 'error' ? [raw.detail] : undefined,
    permissions: (raw.permissions ?? []).map((scope) => ({ scope, granted: granted.has(scope) })),
  };
}

export async function listPlugins(signal?: AbortSignal): Promise<{ summary: Record<string, number>; plugins: PluginRow[] }> {
  const res = await engineJson<{ summary: Record<string, number>; plugins: EnginePluginRow[] }>('/plugins', { signal });
  return { summary: res.summary, plugins: (res.plugins ?? []).map(toPluginRow) };
}

/**
 * The engine answers 200 with `{ ok: false, reason }` for refusals (plugin-api.ts),
 * so callers must check `ok`, not just the HTTP status.
 */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; reason?: string }> {
  return enginePost(`/plugins/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, {});
}

/**
 * POST /plugins/:id/permissions REPLACES the granted set (PluginManager.setPermissions),
 * so the caller sends the complete next set, not a single-scope delta.
 */
export async function setPluginPermissions(id: string, permissions: string[]): Promise<{ ok: boolean; reason?: string; granted?: string[] }> {
  return enginePost(`/plugins/${encodeURIComponent(id)}/permissions`, { permissions });
}

// ─── Shared error copy ──────────────────────────────────────────────────────

export function describeEngineError(e: unknown): string {
  if (e instanceof EngineHttpError) {
    const body = e.body ?? {};
    if (typeof body.error === 'string' && body.error) return body.error;
    if (typeof body.detail === 'string' && body.detail) return body.detail;
    return `Engine answered ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
