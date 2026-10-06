/*
 * Engine transport (Phase 14) — the ONE place the desktop learns where the XR
 * engine daemon is and how to authenticate to it.
 *
 * Resolution (same rule as the previous generation's api/client.ts):
 *   · packaged Tauri app → the Rust shell spawned the compiled sidecar with
 *     `serve --port 0` and parsed port + token off its banner; `engine_link`
 *     hands them over (the token never touches disk or logs);
 *   · everything else (vite dev, `tauri dev`, Playwright) → relative `/api/v1`;
 *     the Vite proxy attaches the bearer server-side (vite.config.ts).
 *
 * Nothing here computes policy, risk or budget — it moves bytes and turns
 * network failure into one honest error type the UI can render.
 */
import { isTauri } from '@/lib/tauri';

export type EngineVia = 'sidecar' | 'dev-proxy';

export interface EngineEndpoint {
  /** Absolute or relative API base, no trailing slash (…/api/v1). */
  base: string;
  token: string | null;
  via: EngineVia;
  port: number | null;
  /** Rust shell's reason when the packaged app fell back (dev build, spawn failure). */
  reason: string | null;
}

interface EngineLink {
  reachable?: boolean;
  spawned?: boolean;
  port?: number | null;
  token?: string | null;
  reason?: string | null;
}

/** The engine could not be reached (or refused the session). */
export class EngineDown extends Error {
  readonly kind: 'unreachable' | 'unauthorized';
  constructor(kind: 'unreachable' | 'unauthorized', message?: string) {
    super(message ?? (kind === 'unauthorized' ? 'Engine rejected the session token' : 'Engine unreachable'));
    this.name = 'EngineDown';
    this.kind = kind;
  }
}

/** A non-2xx answer with the engine's own JSON error body. */
export class EngineHttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  constructor(status: number, path: string, body: Record<string, unknown> | null) {
    const msg =
      body && typeof body.error === 'string' ? body.error : `${status} ${path}`;
    super(msg);
    this.name = 'EngineHttpError';
    this.status = status;
    this.body = body;
  }
  /** The engine marks lane-busy / rate-limit answers as retryable. */
  get retryable(): boolean {
    return this.status === 429 || this.body?.retryable === true;
  }
}

const DEV_SESSION_KEY = 'xr.dev.session';

function devSession(): string | null {
  try {
    return window.localStorage.getItem(DEV_SESSION_KEY);
  } catch {
    return null;
  }
}

/** Exposed-dev pairing (vite.config.ts SEC-DEV-01): `#pair=<code>` once. */
export async function pairFromUrl(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const m = /(?:^|[#&])pair=([A-Za-z0-9]+)/.exec(window.location.hash);
  if (!m) return false;
  try {
    const res = await fetch(`/__xr/pair?code=${encodeURIComponent(m[1])}`);
    if (!res.ok) return false;
    const j = (await res.json()) as { session?: string | null };
    if (!j.session) return false;
    window.localStorage.setItem(DEV_SESSION_KEY, j.session);
    history.replaceState(null, '', window.location.pathname + window.location.search);
    linkPromise = null;
    return true;
  } catch {
    return false;
  }
}

let linkPromise: Promise<EngineEndpoint> | null = null;

async function resolveEndpoint(): Promise<EngineEndpoint> {
  let reason: string | null = null;
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // The sidecar handshake lands ~1–3 s after launch; poll, bounded.
      for (let i = 0; i < 40; i++) {
        const link = (await invoke<EngineLink>('engine_link')) ?? {};
        if (link.reachable && link.port && link.token) {
          return {
            base: `http://127.0.0.1:${link.port}/api/v1`,
            token: link.token,
            via: 'sidecar',
            port: link.port,
            reason: null,
          };
        }
        if (link.spawned === false) {
          reason = link.reason ?? 'no sidecar in this build';
          break;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!reason) reason = 'the sidecar did not pair within 20 s';
    } catch (e) {
      reason = `engine_link failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { base: '/api/v1', token: null, via: 'dev-proxy', port: null, reason };
}

/** Resolve (once) where the engine lives. `force` re-runs the handshake. */
export function engineEndpoint(force = false): Promise<EngineEndpoint> {
  if (force || !linkPromise) linkPromise = resolveEndpoint();
  return linkPromise;
}

/** Forget the cached link (after a sidecar restart). */
export function resetEngineLink(): void {
  linkPromise = null;
}

function authHeaders(ep: EngineEndpoint): Record<string, string> {
  const h: Record<string, string> = {};
  if (ep.token) h.Authorization = `Bearer ${ep.token}`;
  const s = devSession();
  if (s) h['x-xr-dev-session'] = s;
  return h;
}

/**
 * Raw fetch against the engine. Network failure → `EngineDown('unreachable')`,
 * 401 → `EngineDown('unauthorized')`. Other statuses are returned as-is so
 * callers can read the engine's JSON reason.
 */
export async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const ep = await engineEndpoint();
  let res: Response;
  try {
    res = await fetch(`${ep.base}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(ep),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new EngineDown('unreachable');
  }
  if (res.status === 401) throw new EngineDown('unauthorized');
  // The Vite proxy answers 503 + x-xr-proxy when the daemon itself is down.
  if (res.status === 503 && res.headers.get('x-xr-proxy') === 'engine-unreachable') {
    throw new EngineDown('unreachable');
  }
  return res;
}

/** JSON helper: 2xx → body, otherwise `EngineHttpError` with the engine's reason. */
export async function engineJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await engineFetch(path, init);
  if (!res.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error body */
    }
    throw new EngineHttpError(res.status, path, body);
  }
  return (await res.json()) as T;
}

export function enginePost<T>(path: string, body: unknown): Promise<T> {
  return engineJson<T>(path, { method: 'POST', body: JSON.stringify(body) });
}
