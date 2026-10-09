/*
 * Memory Explorer (Phase 21) — engine client. Every call goes through the
 * paired engine link (engineJson, base …/api/v1). Nothing here decides what is
 * stored, flagged or exported: the engine does that and the screen renders it.
 *
 * Routes (src/daemon/routes/memory.routes.ts):
 *   GET    /memory?exclusions=1&expired=1   list + stats + health
 *   GET    /memory/search?q=                engine recall (semantic → lexical)
 *   POST   /memory                          explicit "remember this"
 *   PATCH  /memory/:id                      edit content/tags/importance/expiry
 *   DELETE /memory/:id | /memory/all        delete one / clear all
 *   GET    /memory/export · POST /memory/import
 *   GET    /memory/graph                    heuristic entity graph
 */
import { engineJson, EngineHttpError } from '@/engine/transport';
import type { MemoryGraphData, MemoryView, SensitiveKind } from './core';

export interface MemoryListResponse {
  enabled: boolean;
  count: number;
  stats: Array<{ category: string; c: number }>;
  health: Record<string, unknown>;
  engine: Record<string, unknown>;
  entries: MemoryView[];
}

export interface WriteResponse {
  ok: boolean;
  entry?: MemoryView | null;
  duplicate?: boolean;
  reason?: string;
  excluded?: boolean;
  sensitive?: Array<{ kind: SensitiveKind; label: string }>;
}

export interface CreateInput {
  content: string;
  category?: string;
  scope?: string;
  tags?: string[];
  importance?: number;
  expiresInDays?: number | null;
  acknowledgeSensitive?: boolean;
}

export interface ImportResponse {
  ok: boolean;
  added: number;
  skipped: number;
  errors: number;
  skippedSensitive: number;
  cleared: number;
}

export function listMemory(opts: { exclusions?: boolean; expired?: boolean } = {}): Promise<MemoryListResponse> {
  const qs = new URLSearchParams();
  if (opts.exclusions) qs.set('exclusions', '1');
  if (opts.expired) qs.set('expired', '1');
  const s = qs.toString();
  return engineJson<MemoryListResponse>(`/memory${s ? `?${s}` : ''}`);
}

export async function searchMemory(q: string, signal?: AbortSignal): Promise<Set<string>> {
  const out = await engineJson<{ results: Array<{ id: string }> }>(`/memory/search?q=${encodeURIComponent(q)}`, { signal });
  return new Set(out.results.map((r) => r.id));
}

export function fetchMemoryGraph(signal?: AbortSignal): Promise<MemoryGraphData> {
  return engineJson<MemoryGraphData>('/memory/graph', { signal });
}

/** Resolves with the engine's answer for 2xx and 409/422 (both carry a reason); throws otherwise. */
async function writeCall(path: string, init: RequestInit): Promise<WriteResponse> {
  try {
    return await engineJson<WriteResponse>(path, init);
  } catch (e) {
    if (e instanceof EngineHttpError && (e.status === 409 || e.status === 422 || e.status === 400 || e.status === 404)) {
      return { ok: false, ...(e.body ?? {}) } as WriteResponse;
    }
    throw e;
  }
}

export function createMemory(input: CreateInput): Promise<WriteResponse> {
  return writeCall('/memory', { method: 'POST', body: JSON.stringify(input) });
}

export function updateMemory(id: string, patch: Partial<CreateInput>): Promise<WriteResponse> {
  return writeCall(`/memory/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function deleteMemory(id: string): Promise<{ ok: boolean; reason?: string }> {
  return engineJson(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function clearAllMemory(): Promise<{ ok: boolean; removed: number }> {
  return engineJson('/memory/all', { method: 'DELETE' });
}

export function exportMemory(): Promise<Record<string, unknown>> {
  return engineJson('/memory/export');
}

export function importMemory(bundle: unknown, mode: 'merge' | 'replace'): Promise<ImportResponse> {
  return engineJson('/memory/import', {
    method: 'POST',
    body: JSON.stringify({ bundle, mode, acknowledgeReplace: mode === 'replace' ? true : undefined }),
  });
}

export interface MemorySettings {
  /** Always "off" in this version; the engine refuses to turn it on. */
  autoMemory: 'off';
  autoMemoryAvailable: false;
  showExpired: boolean;
}

export function fetchMemorySettings(signal?: AbortSignal): Promise<MemorySettings> {
  return engineJson<MemorySettings>('/memory/settings', { signal });
}

export function saveShowExpired(showExpired: boolean): Promise<MemorySettings> {
  return engineJson<MemorySettings>('/memory/settings', {
    method: 'PUT',
    body: JSON.stringify({ showExpired }),
  });
}

/** A short, honest message for an engine refusal or failure. */
export function describeMemoryError(e: unknown): string {
  if (e instanceof EngineHttpError) {
    const reason = e.body && typeof e.body.reason === 'string' ? e.body.reason : null;
    if (reason) return reason;
    return `Engine answered ${e.status}`;
  }
  return e instanceof Error ? e.message : String(e);
}
