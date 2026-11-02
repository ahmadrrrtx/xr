/*
 * Engine link state (Phase 14; readiness truth XR-P01) — the single store
 * every surface reads to know whether the XR engine daemon is usable,
 * which engine it is, and what it offers (providers, local models).
 *
 * Readiness vocabulary (D-008, exactly these five):
 *   starting | ready | degraded | disconnected | failed(reason)
 * with reason ∈ unauthorized | incompatible | crashed | timeout | unreachable.
 *
 * No state is entered on optimism: `nextEngineState` — the ONE function
 * that computes the next state — reads only the last observed probe, the
 * elapsed time since the current link attempt began, and the observed
 * contract handshake. `starting` is bounded by ENGINE_BOOT_DEADLINE_MS;
 * past it, a silent engine is `failed(timeout)` and the sidecar stderr
 * tail is captured for diagnosis, never an infinite spinner.
 *
 * D-008 mapping from the pre-P01 vocabulary:
 *   unknown → starting · checking → starting · up → ready ·
 *   down → disconnected · unauthorized → failed(unauthorized)
 *
 * Polling is adaptive: 15 s while ready/degraded, 3 s otherwise, paused
 * when the tab is hidden.
 */
import { create } from 'zustand';

import { qualifiedModelId } from '@/budget/models';
import { modelOptions, type EngineCatalog } from '@/engine/catalog';
export type { EngineModelOption } from '@/engine/catalog';
import {
  EngineDown,
  EngineIncompatible,
  engineEndpoint,
  engineFetch,
  engineHandshake,
  engineJson,
  enginePost,
  resetEngineHandshake,
  resetEngineLink,
  type EngineEndpoint,
  type HandshakeOutcome,
} from '@/engine/transport';
import type {
  EngineHealth,
  EngineModelsResponse,
  EngineProvidersResponse,
} from '@/engine/types';
import { isTauri } from '@/lib/tauri';

export type EngineStatus =
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'disconnected'
  | 'failed';

export type EngineFailureReason =
  | 'unauthorized'
  | 'incompatible'
  | 'crashed'
  | 'timeout'
  | 'unreachable';

/** XR-P01 — `starting` may not outlive this bound (sidecar pairs in ~1–3 s). */
export const ENGINE_BOOT_DEADLINE_MS = 30_000;

/** One observed probe of the engine link (health and/or handshake). */
export interface EngineProbe {
  outcome:
    | 'pending'
    | 'ok'
    | 'unauthorized'
    | 'incompatible'
    | 'unreachable'
    | 'timeout'
    | 'crashed';
  error?: string | null;
}

export interface EngineReadiness {
  status: EngineStatus;
  failureReason: EngineFailureReason | null;
}

/**
 * THE readiness transition function (XR-P01). Pure: (last observed probe,
 * elapsed since this link attempt began, observed handshake) → next state.
 * Nothing else in the app may invent a readiness value.
 *
 *  · `ready`/`degraded` require an `ok` probe AND an observed handshake —
 *    a 200 from the open `/health` alone is only ever `starting`.
 *  · legacy handshake (engine predates contract reporting) ⇒ `degraded`:
 *    reachable, explicitly unverified, never `ready`.
 *  · a probe that never resolves (`pending`/`timeout`) past the boot
 *    deadline ⇒ `failed(timeout)`; the same probe after a link WAS
 *    established ⇒ `disconnected` (the engine went away).
 *  · `unreachable` during the boot window ⇒ still `starting` (the sidecar
 *    is pairing); after it, or after an established link ⇒ `disconnected`.
 */
export function nextEngineState(
  probe: EngineProbe,
  elapsedMs: number,
  handshake: HandshakeOutcome | null,
): EngineReadiness {
  const established = handshake !== null; // a contract was observed on this link
  switch (probe.outcome) {
    case 'unauthorized':
      return { status: 'failed', failureReason: 'unauthorized' };
    case 'incompatible':
      return { status: 'failed', failureReason: 'incompatible' };
    case 'crashed':
      return { status: 'failed', failureReason: 'crashed' };
    case 'ok': {
      if (!handshake) return { status: 'starting', failureReason: null };
      if (handshake.kind === 'legacy') return { status: 'degraded', failureReason: null };
      if (handshake.kind === 'incompatible')
        return { status: 'failed', failureReason: 'incompatible' };
      return { status: 'ready', failureReason: null };
    }
    case 'timeout':
    case 'pending': {
      if (established) return { status: 'disconnected', failureReason: null };
      if (elapsedMs >= ENGINE_BOOT_DEADLINE_MS)
        return { status: 'failed', failureReason: 'timeout' };
      return { status: 'starting', failureReason: null };
    }
    case 'unreachable': {
      if (!established && elapsedMs < ENGINE_BOOT_DEADLINE_MS)
        return { status: 'starting', failureReason: null };
      return { status: 'disconnected', failureReason: null };
    }
  }
}

/** Reachable AND identified enough to work with (ready, or legacy-degraded). */
export function isEngineUsable(status: EngineStatus): boolean {
  return status === 'ready' || status === 'degraded';
}

interface EngineState {
  status: EngineStatus;
  /** Set iff status === 'failed'. */
  failureReason: EngineFailureReason | null;
  endpoint: EngineEndpoint | null;
  health: EngineHealth | null;
  /** XR-P01: the observed contract handshake for the current link. */
  handshake: HandshakeOutcome | null;
  /** XR-P01: sidecar stderr tail captured on failed(timeout|crashed). */
  stderrTail: string[];
  /** When the current link attempt began (boot-deadline anchor). */
  attemptStartedAt: number | null;
  latencyMs: number | null;
  lastChecked: number | null;
  /** Consecutive failed polls (drives the banner only after the first). */
  failures: number;
  lastError: string | null;
  /** When the link first came up this session (uptime for Diagnostics). */
  upSince: number | null;
  providers: EngineProvidersResponse | null;
  models: EngineModelsResponse | null;
  catalog: EngineCatalog | null;
  catalogLoadedAt: number | null;
  catalogError: string | null;
  restarting: boolean;

  refresh: () => Promise<boolean>;
  loadCatalog: (opts?: {
    force?: boolean;
    discoverLocal?: boolean;
  }) => Promise<void>;
  /** Set the engine's default provider/model (`POST /providers/set`). */
  setEngineDefault: (modelId: string) => Promise<void>;
  /** Dev: ask the Vite plugin to launch the engine. Packaged: Rust restart. */
  startOrRestart: () => Promise<{ ok: boolean; message: string }>;
  startPolling: () => () => void;
}

const POLL_UP_MS = 15_000;
const POLL_DOWN_MS = 3_000;
const CATALOG_TTL_MS = 60_000;

let pollTimer: number | null = null;
let polling = 0; // ref count (several surfaces may ask)
let inflight: Promise<boolean> | null = null;

/** The shell's existing stderr tail (Rust `engine_logs_tail`); [] outside Tauri. */
async function fetchStderrTail(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('engine_logs_tail', { lines: 40 });
  } catch {
    return [];
  }
}

export const useEngineStore = create<EngineState>()((set, get) => ({
  status: 'starting',
  failureReason: null,
  endpoint: null,
  health: null,
  handshake: null,
  stderrTail: [],
  attemptStartedAt: null,
  latencyMs: null,
  lastChecked: null,
  failures: 0,
  lastError: null,
  upSince: null,
  providers: null,
  models: null,
  catalog: null,
  catalogLoadedAt: null,
  catalogError: null,
  restarting: false,

  refresh: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      // Anchor the boot deadline at the first attempt of a link cycle: any
      // refresh with no observed handshake and no anchor IS that attempt.
      // (Never invent elapsed time — an unanchored attempt starts now.)
      if (get().attemptStartedAt === null && get().handshake === null) {
        set({ attemptStartedAt: Date.now() });
      }
      const elapsed = (): number => {
        const t0 = get().attemptStartedAt;
        return t0 === null ? 0 : Date.now() - t0;
      };
      const started = performance.now();
      try {
        const endpoint = await engineEndpoint();
        const res = await engineFetch('/health');
        if (!res.ok) throw new Error(`health ${res.status}`);
        const health = (await res.json()) as EngineHealth;
        // Identity comes ONLY from the session-gated handshake (XR-P01):
        // /health proved "something answered", nothing more.
        const handshake = await engineHandshake();
        const next = nextEngineState({ outcome: 'ok' }, elapsed(), handshake);
        const wasUsable = isEngineUsable(get().status);
        set({
          status: next.status,
          failureReason: next.failureReason,
          endpoint,
          health,
          handshake,
          latencyMs: Math.round(performance.now() - started),
          lastChecked: Date.now(),
          failures: 0,
          lastError:
            handshake.kind === 'legacy'
              ? `Engine ${handshake.engineVersion ?? '(unknown version)'} does not report a contract version — running degraded. Restart with the bundled engine or update the engine.`
              : null,
          stderrTail: [],
          attemptStartedAt: null,
          upSince: wasUsable ? get().upSince : Date.now(),
        });
        // A fresh link: (re)load what it offers.
        if (!wasUsable) void get().loadCatalog({ force: true });
        return isEngineUsable(next.status);
      } catch (e) {
        const endpoint = await engineEndpoint().catch(() => null);
        let probe: EngineProbe;
        if (e instanceof EngineIncompatible) {
          probe = { outcome: 'incompatible', error: e.message };
        } else if (e instanceof EngineDown && e.kind === 'unauthorized') {
          probe = { outcome: 'unauthorized', error: 'The engine rejected this session token.' };
        } else if (
          (e instanceof EngineDown && e.kind === 'timeout') ||
          (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'TimeoutError'))
        ) {
          probe = { outcome: 'timeout', error: e instanceof Error ? e.message : null };
        } else if (endpoint?.reason) {
          // The shell observed the spawn itself fail — that is a crash,
          // not a network guess.
          probe = { outcome: 'crashed', error: endpoint.reason };
        } else {
          probe = {
            outcome: 'unreachable',
            error:
              e instanceof Error && e.message !== 'Engine unreachable'
                ? e.message
                : 'No engine answered on the local port.',
          };
        }
        const prevHandshake = get().handshake;
        const next = nextEngineState(probe, elapsed(), prevHandshake);
        // A lost/refused link invalidates the observed contract: the next
        // successful probe must re-negotiate before `ready` again.
        const linkLost = next.status === 'disconnected' || next.status === 'failed';
        if (linkLost) resetEngineHandshake();
        const stderrTail =
          next.status === 'failed' &&
          (next.failureReason === 'timeout' || next.failureReason === 'crashed')
            ? await fetchStderrTail()
            : get().stderrTail;
        set((st) => ({
          status: next.status,
          failureReason: next.failureReason,
          endpoint,
          handshake: linkLost ? null : prevHandshake,
          stderrTail,
          latencyMs: null,
          lastChecked: Date.now(),
          failures: st.failures + 1,
          lastError: probe.error ?? st.lastError,
          upSince: null,
        }));
        return false;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  loadCatalog: async (opts) => {
    const st = get();
    if (
      !opts?.force &&
      !opts?.discoverLocal &&
      st.catalogLoadedAt &&
      Date.now() - st.catalogLoadedAt < CATALOG_TTL_MS
    )
      return;
    try {
      // Catalog inspection is offline, including startup. /models performs
      // runtime probes and is ONLY called after an explicit discovery action.
      const [providers, catalog, discovered] = await Promise.all([
        engineJson<EngineProvidersResponse>('/providers'),
        engineJson<EngineCatalog>('/providers/catalog'),
        opts?.discoverLocal
          ? engineJson<EngineModelsResponse>('/models')
          : Promise.resolve(undefined),
      ]);
      set({
        providers,
        catalog,
        models: discovered ?? st.models,
        catalogLoadedAt: Date.now(),
        catalogError: null,
      });
    } catch (e) {
      set({
        catalogError:
          e instanceof Error
            ? e.message
            : 'Could not load the model catalogue.',
      });
    }
  },

  setEngineDefault: async (modelId) => {
    const { resolveEngineModel } = await import('@/engine/wire');
    const t = resolveEngineModel(modelId);
    const provider = t.provider ?? get().providers?.primary;
    if (!provider || !t.model) return;
    await enginePost('/providers/set', { provider, model: t.model });
    await get().loadCatalog({ force: true });
  },

  startOrRestart: async () => {
    // An observed operator action starts a new, deadline-bounded attempt.
    set({ restarting: true, status: 'starting', failureReason: null, attemptStartedAt: Date.now() });
    try {
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const r = await invoke<{ ok: boolean; message?: string }>(
          'engine_restart'
        );
        resetEngineLink();
        const up = await waitForEngine(20_000);
        return {
          ok: up,
          message: up
            ? 'Engine restarted.'
            : (r?.message ?? 'The engine did not come back within 20 s.'),
        };
      }
      if (!import.meta.env.DEV) {
        return {
          ok: false,
          message: 'Start the engine with `xr serve` and retry.',
        };
      }
      const res = await fetch('/__xr/engine/start', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        started?: boolean;
        reason?: string;
      };
      if (!res.ok || !j.started) {
        return {
          ok: false,
          message:
            j.reason ?? 'Could not start the engine from the dev server.',
        };
      }
      const up = await waitForEngine(25_000);
      return {
        ok: up,
        message: up
          ? 'Engine started.'
          : 'Started the engine, but it has not answered yet.',
      };
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof Error ? e.message : 'Could not restart the engine.',
      };
    } finally {
      set({ restarting: false });
    }
  },

  startPolling: () => {
    polling += 1;
    const tick = async (): Promise<void> => {
      if (document.visibilityState !== 'hidden') await get().refresh();
      schedule();
    };
    const schedule = (): void => {
      if (polling <= 0) return;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(
        () => void tick(),
        isEngineUsable(get().status) ? POLL_UP_MS : POLL_DOWN_MS
      );
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void tick();
    };
    if (polling === 1) {
      document.addEventListener('visibilitychange', onVisible);
      void tick();
    }
    return () => {
      polling -= 1;
      if (polling <= 0) {
        polling = 0;
        document.removeEventListener('visibilitychange', onVisible);
        if (pollTimer !== null) window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };
  },
}));

async function waitForEngine(timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await useEngineStore.getState().refresh()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/* ── Derived views ─────────────────────────────────────────────────────── */

/** XR-P01: from the observed handshake — /health no longer pretends to know. */
export function engineVersion(): string | null {
  const hs = useEngineStore.getState().handshake;
  return typeof hs?.meta.version === 'string' ? hs.meta.version : null;
}

/** The engine's current default model as a desktop id (`qwen2.5:0.5b`, `gpt-4o`). */
export function engineDefaultModel(): string | null {
  const p = useEngineStore.getState().providers;
  if (!p?.model) return null;
  return qualifiedModelId(p.primary, p.model);
}

/** True when at least one provider can answer right now. */
export function engineHasProvider(): boolean {
  const p = useEngineStore.getState().providers;
  if (!p) return false;
  return p.providers.some((x) => x.healthy && (x.kind === 'local' || x.hasKey));
}

/** Last-known-good engine facts survive a refresh error, never synthetic rows. */
export function engineModelOptions(
  providers: EngineProvidersResponse | null = useEngineStore.getState()
    .providers,
  models: EngineModelsResponse | null = useEngineStore.getState().models,
  catalog: EngineCatalog | null = useEngineStore.getState().catalog
) {
  return modelOptions(providers, models, catalog);
}
