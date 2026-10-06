/*
 * Builder ↔ engine client (Phase 17).
 *
 * Reads are JSON. Every write is a consent stream: the engine answers with
 * `approval_required` first, this module bridges it into the Phase 7
 * approval modal (`bridgeEngineApproval` — remembered rules, Shield policy,
 * Stop withdraws), then resolves with the engine's `applied` payload or
 * throws `BuilderDenied` / `Error`. Nothing here touches disk; the engine
 * writes only after a human decision it recorded.
 */
import { bridgeEngineApproval } from '@/engine/approvals';
import { readSse } from '@/engine/sse';
import { EngineHttpError, engineFetch, engineJson } from '@/engine/transport';
import type { EngineApprovalRequired } from '@/engine/types';
import type { TreeEntry } from '@/lib/builderCore';

export type GitBadge = 'modified' | 'staged' | 'untracked' | 'added' | 'deleted' | 'renamed';

export interface BuilderProject {
  id: string;
  name: string;
  root: string;
  git: { branch: string | null; dirty: boolean; isRepo: boolean };
}

export interface BuilderGit {
  branch: string | null;
  dirty: boolean;
  isRepo: boolean;
  files: Record<string, GitBadge>;
}

export interface BuilderTree {
  root: string;
  name: string;
  entries: TreeEntry[];
  truncated: boolean;
  git: BuilderGit;
}

export interface BuilderFile {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
  isText: boolean;
  truncated: boolean;
}

export interface DevServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'exited';
  installing: boolean;
  kind: string | null;
  cmd: string | null;
  pid: number | null;
  port: number | null;
  url: string | null;
  startedAt: number | null;
  readyMs: number | null;
  exit: { code: number | null; signal: string | null } | null;
}

export interface DetectedDevServer {
  kind: string;
  label: string;
  argv: string[] | null;
  cmd: string | null;
  pm: string;
  needsInstall: boolean;
  installArgv: string[] | null;
  hint: string;
}

export interface DevServerLogLine {
  seq: number;
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}

export interface DevServerInfo {
  detected: DetectedDevServer;
  status: DevServerStatus | null;
  log: DevServerLogLine[];
}

export interface Diagnostic {
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code?: number;
}

export type BuilderEvent =
  | { type: 'hello'; projectId: string; watching: boolean; status: DevServerStatus | null }
  | { type: 'ping'; ts: number }
  | { type: 'dev-server:log'; projectId: string; entry: DevServerLogLine }
  | { type: 'dev-server:ready'; projectId: string; port: number; url: string; ms: number }
  | { type: 'dev-server:exit'; projectId: string; code: number | null; signal: string | null; job: 'server' | 'install' }
  | { type: 'dev-server:status'; projectId: string; status: DevServerStatus }
  | { type: 'fs:changed'; projectId: string; paths: string[] };

export class BuilderDenied extends Error {
  /** XR Shield answered by policy — no human was asked (Phase 12 gate). */
  readonly blocked: boolean;
  /** The gate's or the human's stated reason, when one exists. */
  readonly reason: string | undefined;
  constructor(
    readonly decision: string | null,
    readonly timedOut: boolean,
    outcome?: { blocked?: boolean; reason?: string },
  ) {
    super(outcome?.blocked && outcome.reason ? outcome.reason : timedOut ? 'Approval timed out' : 'Not approved');
    this.name = 'BuilderDenied';
    this.blocked = outcome?.blocked === true;
    this.reason = outcome?.reason;
  }
}

/** 409 with `stale`/`conflict`/`needsInstall` — the caller decides what to show. */
export class BuilderConflict extends Error {
  constructor(
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BuilderConflict';
  }
}

const P = (id: string, tail: string) => `/builder/projects/${encodeURIComponent(id)}/${tail}`;

export function openProject(path: string, name?: string): Promise<BuilderProject> {
  return engineJson<BuilderProject>('/builder/projects', { method: 'POST', body: JSON.stringify({ path, ...(name ? { name } : {}) }) });
}

export function fetchTree(id: string): Promise<BuilderTree> {
  return engineJson<BuilderTree>(P(id, 'tree'));
}

export function fetchGit(id: string): Promise<BuilderGit> {
  return engineJson<BuilderGit>(P(id, 'git'));
}

export function readFile(id: string, path: string): Promise<BuilderFile> {
  return engineJson<BuilderFile>(P(id, `file?path=${encodeURIComponent(path)}`));
}

export function fetchDevServer(id: string): Promise<DevServerInfo> {
  return engineJson<DevServerInfo>(P(id, 'dev-server'));
}

export function stopDevServer(id: string): Promise<{ stopped: boolean; status: DevServerStatus | null }> {
  return engineJson(P(id, 'dev-server/stop'), { method: 'POST', body: '{}' });
}

export function fetchDiagnostics(id: string, path: string, content: string, signal?: AbortSignal): Promise<{ available: boolean; reason?: string; diagnostics: Diagnostic[] }> {
  return engineJson(P(id, 'diagnostics'), { method: 'POST', body: JSON.stringify({ path, content }), signal });
}

/* ── consent streams ───────────────────────────────────────────────────── */

interface ConsentFrame {
  approval_required?: EngineApprovalRequired;
  type?: 'applied' | 'denied' | 'timed_out' | 'error';
  decision?: string | null;
  error?: string;
  [k: string]: unknown;
}

export interface ConsentHooks {
  /** Fires when the engine asks; the modal is already up. */
  onApprovalRequested?: (a: EngineApprovalRequired) => void;
}

/**
 * POST a mutation and run its consent stream to completion. Non-stream
 * answers (400/404/409/413) throw `BuilderConflict` (409) or `EngineHttpError`.
 */
export async function consentStream<T extends Record<string, unknown>>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  hooks: ConsentHooks = {},
): Promise<T> {
  const res = await engineFetch(path, { method: 'POST', body: JSON.stringify(body), signal });
  if (!res.ok) {
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    if (res.status === 409 && json) throw new BuilderConflict(String(json.error ?? 'Conflict'), json);
    throw new EngineHttpError(res.status, path, json);
  }
  let result: T | null = null;
  let failure: Error | null = null;
  const bridges: Promise<void>[] = [];
  // Why the engine said no: the desktop gate (policy block) or the human.
  let lastOutcome: { blocked?: boolean; reason?: string } | undefined;
  await readSse(
    res,
    (payload) => {
      if (payload === '[DONE]') return;
      let frame: ConsentFrame;
      try {
        frame = JSON.parse(payload) as ConsentFrame;
      } catch {
        return;
      }
      if (frame.approval_required) {
        const a = frame.approval_required;
        hooks.onApprovalRequested?.(a);
        bridges.push(
          bridgeEngineApproval(a, signal).then((o) => {
            lastOutcome = { blocked: o.blocked, reason: o.reason };
          }),
        );
        return;
      }
      switch (frame.type) {
        case 'applied': {
          const { type: _t, ...rest } = frame;
          void _t;
          result = rest as unknown as T;
          return;
        }
        case 'denied':
          failure = new BuilderDenied(frame.decision ?? null, false, lastOutcome);
          return;
        case 'timed_out':
          failure = new BuilderDenied(frame.decision ?? null, true, lastOutcome);
          return;
        case 'error':
          failure = new Error(frame.error ?? 'The engine could not complete this change');
          return;
        default:
          return;
      }
    },
    signal,
  );
  await Promise.allSettled(bridges);
  // (cast: TS cannot see the assignments made inside the SSE callback)
  const outcome = failure as Error | null;
  if (outcome instanceof BuilderDenied && !outcome.reason && lastOutcome) {
    throw new BuilderDenied(outcome.decision, outcome.timedOut, lastOutcome);
  }
  if (outcome) throw outcome;
  if (!result) throw new Error(signal.aborted ? 'Cancelled' : 'The engine closed the stream without a result');
  return result;
}

export interface WriteResult extends Record<string, unknown> {
  path: string;
  bytes: number;
  mtimeMs: number;
}

export function writeFile(id: string, path: string, content: string, baseMtimeMs: number | null, signal: AbortSignal, hooks?: ConsentHooks): Promise<WriteResult> {
  return consentStream<WriteResult>(P(id, 'file/write'), { path, content, ...(baseMtimeMs != null ? { baseMtimeMs } : {}) }, signal, hooks);
}

export function createEntry(id: string, path: string, kind: 'file' | 'folder', signal: AbortSignal): Promise<{ path: string; kind: string }> {
  return consentStream(P(id, 'file/create'), { path, kind }, signal);
}

export function renameEntry(id: string, from: string, to: string, signal: AbortSignal): Promise<{ from: string; to: string }> {
  return consentStream(P(id, 'file/rename'), { from, to }, signal);
}

export function deleteEntry(id: string, path: string, signal: AbortSignal): Promise<{ path: string; recursive: boolean }> {
  return consentStream(P(id, 'file/delete'), { path }, signal);
}

export interface ApplyResult extends Record<string, unknown> {
  path: string;
  content: string;
  mtimeMs: number;
  backupId: string | null;
  applied: number[];
  skipped: number[];
  fuzzy: number;
}

export function applyDiff(id: string, path: string, patch: string, hunks: number[] | undefined, baseMtimeMs: number | null, signal: AbortSignal, hooks?: ConsentHooks): Promise<ApplyResult> {
  return consentStream<ApplyResult>(P(id, 'apply-diff'), { path, patch, ...(hunks ? { hunks } : {}), ...(baseMtimeMs != null ? { baseMtimeMs } : {}) }, signal, hooks);
}

export function undoApply(id: string, path: string, backupId: string, signal: AbortSignal): Promise<{ path: string; content: string; mtimeMs: number }> {
  return consentStream(P(id, 'undo'), { path, backupId }, signal);
}

export function startDevServer(id: string, cmd: string | undefined, signal: AbortSignal, hooks?: ConsentHooks): Promise<{ status: DevServerStatus; detected: DetectedDevServer }> {
  return consentStream(P(id, 'dev-server/start'), cmd ? { cmd } : {}, signal, hooks);
}

export function installDeps(id: string, signal: AbortSignal, hooks?: ConsentHooks): Promise<{ code: number | null; ok: boolean; needsInstall: boolean }> {
  return consentStream(P(id, 'dev-server/install'), {}, signal, hooks);
}

/* ── live events ───────────────────────────────────────────────────────── */

/**
 * Subscribe to the project's event feed. Reconnects with backoff while the
 * returned function has not been called; a dead engine just means silence.
 */
export function subscribeEvents(id: string, onEvent: (e: BuilderEvent) => void, onState?: (connected: boolean) => void): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await engineFetch(P(id, 'events'), { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
        if (!res.ok) throw new Error(`events ${res.status}`);
        onState?.(true);
        attempt = 0;
        await readSse(
          res,
          (payload) => {
            if (payload === '[DONE]') return;
            try {
              onEvent(JSON.parse(payload) as BuilderEvent);
            } catch {
              /* skip malformed */
            }
          },
          controller.signal,
        );
      } catch {
        /* fall through to backoff */
      }
      onState?.(false);
      if (stopped) break;
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4))));
    }
  };
  void loop();
  return () => {
    stopped = true;
    controller?.abort();
  };
}

/* ── PTY (terminal pane) ───────────────────────────────────────────────── */

export interface PtyOpen {
  sessionId: string;
  pid: number;
  shell: string;
}

export type PtyFrame =
  | { type: 'status'; status: string; approvalId?: string; sessionId?: string; pid?: number; shell?: string; cwd?: string; error?: string; bytes?: number; riskTier?: string; ttlMs?: number; decision?: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number | null; signal: string | null };

/** Open a PTY in the project root; frames stream until exit. */
export async function openPty(projectId: string, cols: number, rows: number, signal: AbortSignal): Promise<Response> {
  const res = await engineFetch('/terminal/pty', { method: 'POST', body: JSON.stringify({ projectId, cols, rows }), signal });
  if (!res.ok) {
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
    throw new EngineHttpError(res.status, '/terminal/pty', json);
  }
  return res;
}

export function ptyInput(sessionId: string, data: string): Promise<unknown> {
  return engineJson(`/terminal/pty/${encodeURIComponent(sessionId)}/input`, { method: 'POST', body: JSON.stringify({ data }) });
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<unknown> {
  return engineJson(`/terminal/pty/${encodeURIComponent(sessionId)}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) });
}

export function ptyClose(sessionId: string): Promise<unknown> {
  return engineJson(`/terminal/pty/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/** Approvals raised by the PTY open stream use the terminal's own frame shape. */
export function ptyApprovalFromFrame(frame: Extract<PtyFrame, { type: 'status' }>, cwd: string): EngineApprovalRequired {
  return {
    id: frame.approvalId ?? '',
    tool: 'shell',
    reason: `Open an interactive terminal (${frame.shell ?? 'shell'}) in ${cwd}`,
    args: { cmd: frame.shell ?? 'shell', cwd, interactive: true, scope: cwd },
    riskTier: frame.riskTier,
    ttlMs: frame.ttlMs,
  };
}
