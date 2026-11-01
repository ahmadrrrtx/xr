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
import { APP_VERSION } from '@/lib/appMeta';
import { isTauri } from '@/lib/tauri';

export type EngineVia = 'sidecar' | 'dev-proxy';

/**
 * XR-P01 — every engine request is bounded. The bound covers the wait for
 * response HEADERS (connect + first byte); once headers arrive the timer is
 * cleared, so long-lived SSE streams (chat, builder events) are governed by
 * their caller's own AbortSignal, never guillotined mid-stream by this bound.
 * 10 s is generous for a loopback daemon and far inside the store's boot
 * deadline, so a hung probe surfaces as a distinct timeout, not an eternity.
 */
export const ENGINE_REQUEST_TIMEOUT_MS = 10_000;

/** XR-P01 — the engine contract range this desktop can negotiate (inclusive). */
export const DESKTOP_MIN_ENGINE_CONTRACT = 1;
export const DESKTOP_MAX_ENGINE_CONTRACT = 1;

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
  readonly kind: 'unreachable' | 'unauthorized' | 'timeout';
  constructor(kind: 'unreachable' | 'unauthorized' | 'timeout', message?: string) {
    super(
      message ??
        (kind === 'unauthorized'
          ? 'Engine rejected the session token'
          : kind === 'timeout'
            ? `Engine did not answer within ${Math.round(ENGINE_REQUEST_TIMEOUT_MS / 1000)} s`
            : 'Engine unreachable')
    );
    this.name = 'EngineDown';
    this.kind = kind;
  }
}

/** XR-P01 — why an engine's contract handshake was refused. */
export type EngineIncompatibleReason =
  | 'missing-contract-version'
  | 'contract-too-old'
  | 'contract-too-new'
  | 'desktop-too-old';

/**
 * XR-P01 — the engine answered and identified itself, but its contract is
 * not one this desktop can speak. Distinct from `EngineDown`: the engine is
 * UP; pairing with it would be the silent-wrong failure this phase exists
 * to eliminate. `detail` is user-presentable and carries no credential.
 */
export class EngineIncompatible extends Error {
  readonly reason: EngineIncompatibleReason;
  constructor(reason: EngineIncompatibleReason, detail: string) {
    super(detail);
    this.name = 'EngineIncompatible';
    this.reason = reason;
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

/**
 * Phase 31 · A14 — the dev-pairing session is a bearer-equivalent
 * credential, so it lives ONLY in memory for this page session. It is
 * never written to localStorage (any script on the origin could read it
 * back later); a page reload simply re-pairs. Any copy an older build
 * already stored is removed on sight.
 */
let devSessionMemory: string | null = null;

function devSession(): string | null {
  try {
    window.localStorage.removeItem(DEV_SESSION_KEY);
  } catch {
    /* storage unavailable — memory-only either way */
  }
  return devSessionMemory;
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
    devSessionMemory = j.session;
    try {
      window.localStorage.removeItem(DEV_SESSION_KEY);
    } catch {
      /* see devSession() */
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    linkPromise = null;
    handshakePromise = null; // XR-P01: a re-paired session re-negotiates.
    return true;
  } catch {
    return false;
  }
}

let linkPromise: Promise<EngineEndpoint> | null = null;
/** XR-P01: cached handshake for the current link (declared here; see below). */
let handshakePromise: Promise<HandshakeOutcome> | null = null;

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
  if (force || !linkPromise) {
    linkPromise = resolveEndpoint();
    handshakePromise = null; // XR-P01: a new link re-negotiates the contract.
  }
  return linkPromise;
}

/** Forget the cached link (after a sidecar restart). */
export function resetEngineLink(): void {
  linkPromise = null;
  handshakePromise = null;
}

/** XR-P01: forget only the negotiated contract (the link was lost/refused,
 * so the next successful probe must re-handshake before `ready`). */
export function resetEngineHandshake(): void {
  handshakePromise = null;
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
 * 401 → `EngineDown('unauthorized')`, no headers within
 * `ENGINE_REQUEST_TIMEOUT_MS` → `EngineDown('timeout')` (XR-P01: a timeout is
 * never reported as a generic unreachable). A caller-initiated abort still
 * propagates as the raw `AbortError`. Other statuses are returned as-is so
 * callers can read the engine's JSON reason.
 */
export async function engineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const ep = await engineEndpoint();
  let res: Response;
  // Combine the caller's signal with our header-wait bound. Manual
  // AbortController (not AbortSignal.any) so the timeout can be cancelled
  // once headers land — SSE bodies then stream under the caller's signal.
  const callerSignal = init.signal ?? null;
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('engine request timed out', 'TimeoutError'));
  }, ENGINE_REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${ep.base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(ep),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (e) {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    if (timedOut) throw new EngineDown('timeout');
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new EngineDown('unreachable');
  }
  clearTimeout(timer);
  if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
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

/* ── XR-P01 contract handshake ──────────────────────────────────────────────
 * Once per endpoint link, after the session exists and BEFORE any surface
 * may call the engine "ready", the desktop asks the session-gated
 * `GET /meta/version` who the engine is. The open `/health` probe can only
 * ever say "something answered" — it carries no identity on purpose
 * (P2-21) and is never used as a version source.
 */

/** The session-gated identity payload (`GET /api/v1/meta/version`). */
export interface EngineMeta {
  version?: string;
  host?: string;
  lan?: boolean;
  deviceName?: string;
  contractVersion?: number;
  minDesktopVersion?: string;
  schemaVersion?: number;
  capabilities?: string[];
}

export type HandshakeOutcome =
  | {
      kind: 'ok';
      contractVersion: number;
      engineVersion: string | null;
      schemaVersion: number | null;
      capabilities: string[];
      meta: EngineMeta;
    }
  | { kind: 'legacy'; engineVersion: string | null; meta: EngineMeta }
  | { kind: 'incompatible'; reason: EngineIncompatibleReason; detail: string; meta: EngineMeta };

/** Deterministic dotted-numeric compare (prerelease/build metadata ignored). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((seg) => Number.parseInt(seg, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Pure negotiation over an observed handshake payload. Never guesses from
 * the engine's package `version`: no `contractVersion` field at all means a
 * legacy engine (degraded — reachable, contract unknown); a present but
 * unusable/mismatched one is an incompatibility with a typed reason.
 */
export function evaluateEngineContract(payload: unknown, desktopVersion: string = APP_VERSION): HandshakeOutcome {
  const meta: EngineMeta =
    payload && typeof payload === 'object' ? (payload as EngineMeta) : ({} as EngineMeta);
  const engineVersion = typeof meta.version === 'string' ? meta.version : null;
  const cv = (meta as Record<string, unknown>).contractVersion;

  if (cv === undefined) return { kind: 'legacy', engineVersion, meta };
  if (typeof cv !== 'number' || !Number.isFinite(cv)) {
    return {
      kind: 'incompatible',
      reason: 'missing-contract-version',
      detail: 'The engine answered but did not report a usable contract version.',
      meta,
    };
  }
  if (cv < DESKTOP_MIN_ENGINE_CONTRACT) {
    return {
      kind: 'incompatible',
      reason: 'contract-too-old',
      detail: `Engine contract ${cv} is older than this desktop supports (${DESKTOP_MIN_ENGINE_CONTRACT}–${DESKTOP_MAX_ENGINE_CONTRACT}). Update the engine.`,
      meta,
    };
  }
  if (cv > DESKTOP_MAX_ENGINE_CONTRACT) {
    return {
      kind: 'incompatible',
      reason: 'contract-too-new',
      detail: `Engine contract ${cv} is newer than this desktop supports (${DESKTOP_MIN_ENGINE_CONTRACT}–${DESKTOP_MAX_ENGINE_CONTRACT}). Update the desktop app.`,
      meta,
    };
  }
  if (
    typeof meta.minDesktopVersion === 'string' &&
    compareVersions(desktopVersion, meta.minDesktopVersion) < 0
  ) {
    return {
      kind: 'incompatible',
      reason: 'desktop-too-old',
      detail: `This engine requires desktop ${meta.minDesktopVersion} or newer (this app is ${desktopVersion}). Update the desktop app.`,
      meta,
    };
  }
  return {
    kind: 'ok',
    contractVersion: cv,
    engineVersion,
    schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : null,
    capabilities: Array.isArray(meta.capabilities) ? meta.capabilities.filter((c) => typeof c === 'string') : [],
    meta,
  };
}

/**
 * Perform (once per endpoint link) the session-gated handshake. Resolves to
 * `ok` or `legacy`; throws `EngineIncompatible` on a refused contract and
 * the transport's `EngineDown` kinds (incl. `unauthorized`, `timeout`) when
 * the engine/session itself fails. Retried only when the link resets.
 */
export function engineHandshake(): Promise<HandshakeOutcome> {
  if (!handshakePromise) {
    handshakePromise = (async () => {
      const payload = await engineJson<unknown>('/meta/version');
      const outcome = evaluateEngineContract(payload);
      if (outcome.kind === 'incompatible') {
        throw new EngineIncompatible(outcome.reason, outcome.detail);
      }
      return outcome;
    })();
    // A failed handshake must not poison the cache forever: the next poll
    // (after e.g. a re-pair) re-asks. Successful outcomes stay cached.
    handshakePromise.catch(() => {
      handshakePromise = null;
    });
  }
  return handshakePromise;
}
