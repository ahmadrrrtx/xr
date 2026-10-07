/*
 * Research (Phase 18) — engine client. Every call goes through the paired
 * engine link (`engineFetch`, base …/api/v1); nothing here talks to the web.
 *
 * Routes (src/daemon/routes/research-run.routes.ts):
 *   POST /research/run                → 202 {runId, …}
 *   GET  /research/run/{id}/stream    → SSE replay + live, ends with stream_end + [DONE]
 *   POST /research/run/{id}/cancel    → {ok} | 409 {ok:false,error}
 *   POST /research/upload-pdf         → {name, bytes, pages, chars, text, truncated}
 *   GET/PATCH /research/settings      → network posture + depth budgets
 *   GET  /research · GET /research/{id} · POST /research/{id}/remember
 */
import { engineFetch, engineJson, EngineHttpError } from '@/engine/transport';
import { readSse } from '@/engine/sse';

import { parseRunEvent, type Budgets, type EngineDepth, type EngineMode, type RunEvent, type RunResult, type StoredSession } from './core';

export interface RunDocument {
  name: string;
  text: string;
  kind: 'pdf' | 'local';
}

export interface StartRunInput {
  query: string;
  depth: EngineDepth;
  mode: EngineMode;
  documents?: RunDocument[];
  allowPublicWeb?: boolean;
}

export interface StartRunResponse {
  runId: string;
  state: string;
  provider: string;
  model: string;
  searchAvailable: boolean;
  publicWeb: boolean;
  depth: EngineDepth;
  mode: EngineMode;
  documents: number;
}

export function startRun(input: StartRunInput, signal?: AbortSignal): Promise<StartRunResponse> {
  return engineJson<StartRunResponse>('/research/run', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

/** Pump the run stream; resolves when the engine closes it. */
export async function streamRun(runId: string, onEvent: (e: RunEvent) => void, signal: AbortSignal): Promise<void> {
  const res = await engineFetch(`/research/run/${encodeURIComponent(runId)}/stream`, {
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
    throw new EngineHttpError(res.status, '/research/run/stream', body);
  }
  await readSse(
    res,
    (payload) => {
      const e = parseRunEvent(payload);
      if (e) onEvent(e);
    },
    signal,
  );
}

export interface RunRecord {
  id: string;
  state: 'queued' | 'running' | 'done' | 'stopped' | 'cancelled' | 'error';
  topic: string;
  sessionId: string | null;
  createdAt: number;
  updatedAt: number;
  result: RunResult | null;
  error: { code: string; message: string } | null;
}

export async function getRun(runId: string, signal?: AbortSignal): Promise<RunRecord> {
  const body = await engineJson<{ run: RunRecord }>(`/research/run/${encodeURIComponent(runId)}`, { signal });
  return body.run;
}

export async function cancelRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await engineFetch(`/research/run/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  try {
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: res.ok };
  }
}

export interface PdfUpload {
  name: string;
  bytes: number;
  pages: number;
  pagesRead: number;
  chars: number;
  text: string;
  truncated: boolean;
}

export const PDF_MAX_BYTES = 20 * 1024 * 1024;

export async function uploadPdf(file: File, signal?: AbortSignal): Promise<PdfUpload> {
  // Raw body + filename header (engineFetch pins Content-Type for bodies, so
  // a multipart boundary would be lost; the route accepts both forms).
  const bytes = await file.arrayBuffer();
  const res = await engineFetch('/research/upload-pdf', {
    method: 'POST',
    body: bytes,
    headers: { 'Content-Type': 'application/pdf', 'x-xr-filename': encodeURIComponent(file.name) },
    signal,
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new EngineHttpError(res.status, '/research/upload-pdf', body);
  return body as unknown as PdfUpload;
}

export interface ResearchSettings {
  allowPublicWeb: boolean;
  searchAvailable: boolean;
  searchHost: string;
  egressAllowlist: string[];
  budgets: Record<EngineDepth, Budgets>;
  provider: string;
  model: string;
}

export function getSettings(signal?: AbortSignal): Promise<ResearchSettings> {
  return engineJson<ResearchSettings>('/research/settings', { signal });
}

export function setAllowPublicWeb(allowPublicWeb: boolean): Promise<ResearchSettings> {
  return engineJson<ResearchSettings>('/research/settings', {
    method: 'PATCH',
    body: JSON.stringify({ allowPublicWeb }),
  });
}

export interface SessionSummary {
  id: string;
  topic: string;
  depth: EngineDepth;
  status: string;
  updated_at: number;
}

export async function listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  const body = await engineJson<{ count: number; recent: SessionSummary[] }>('/research', { signal });
  return body.recent ?? [];
}

export async function getSession(id: string, signal?: AbortSignal): Promise<StoredSession> {
  const body = await engineJson<{ session: StoredSession }>(`/research/${encodeURIComponent(id)}`, { signal });
  return body.session;
}

export type RememberResult =
  | { ok: true; memoryId: string; duplicate: boolean; linkedSources: number }
  | { ok: false; reason: 'memory_disabled' | 'not_saved'; detail?: string };

export async function rememberSession(id: string): Promise<RememberResult> {
  const res = await engineFetch(`/research/${encodeURIComponent(id)}/remember`, { method: 'POST' });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (!res.ok && res.status !== 409 && res.status !== 400) throw new EngineHttpError(res.status, '/research/remember', body);
  return body as unknown as RememberResult;
}
