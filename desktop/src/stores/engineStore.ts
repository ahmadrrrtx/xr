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
import { createEngineSupervisor, type EngineGeneration } from '@/engine/supervisor';
import { withinDeadline, requestSignal, RequestDeadlineExpired } from '@/engine/deadline';

import { qualifiedModelId } from '@/budget/models';
import { modelOptions, type EngineCatalog } from '@/engine/catalog';
export type { EngineModelOption } from '@/engine/catalog';
import { hasUsableProvider, localRuntimeUsable } from '@/engine/providerReadiness';
import {
  EngineDown,
  EngineIncompatible,
  engineEndpoint,
  engineHandshake,
  engineJson,
  enginePost,
  bootEngineLink,
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
  generation: number;
  catalogStale: boolean;
  modelsStale: boolean;
  catalogProvenance: { generation: number; observedAt: number; source: string } | null;
  modelsProvenance: { generation: number; observedAt: number; source: string } | null;
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
    signal?: AbortSignal;
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
const supervisor = createEngineSupervisor();
let generation: EngineGeneration | null = null;
let catalogSequence = 0;
let catalogAbort: AbortController | null = null;

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
  generation: 0,
  catalogStale: true,
  modelsStale: true,
  catalogProvenance: null,
  modelsProvenance: null,
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
    const initial = get();
    if (!generation || !supervisor.current(generation) || initial.generation !== generation.id ||
        (initial.attemptStartedAt === null && initial.handshake === null)) {
      generation = supervisor.begin(ENGINE_BOOT_DEADLINE_MS);
      resetEngineLink();
      catalogSequence++; catalogAbort?.abort();
      set({ generation: generation.id, attemptStartedAt: initial.attemptStartedAt ?? Date.now(),
        handshake: null, health: null, catalogStale: true, modelsStale: true });
    }
    const owner = generation;
    const scope = supervisor.scope(owner, ENGINE_BOOT_DEADLINE_MS);
    const current = () => scope.current() && get().generation === owner.id;
    const elapsed = () => Date.now() - (get().attemptStartedAt ?? Date.now());
    const started = performance.now();
    let endpoint: EngineEndpoint | null = get().endpoint;
    const attempt = scope.run(async (signal) => {
      endpoint = await (owner.booted ? engineEndpoint() : bootEngineLink());
      signal.throwIfAborted();
      if (!current()) return false;
      const health = await engineJson<EngineHealth>('/health', { signal });
      signal.throwIfAborted();
      if (!current()) return false;
      const handshake = await engineHandshake(signal);
      signal.throwIfAborted();
      if (!current()) return false;
      const next = nextEngineState({ outcome: 'ok' }, elapsed(), handshake);
      const wasUsable = isEngineUsable(get().status);
      set({ status: next.status, failureReason: next.failureReason, endpoint, health, handshake,
        latencyMs: Math.round(performance.now() - started), lastChecked: Date.now(), failures: 0,
        lastError: handshake.kind === 'legacy'
          ? `Engine ${handshake.engineVersion ?? '(unknown version)'} does not report a contract version — running degraded. Restart with the bundled engine or update the engine.` : null,
        stderrTail: [], upSince: wasUsable ? get().upSince : Date.now() });
      if (!wasUsable || get().catalogStale) await get().loadCatalog({ force: true, signal });
      signal.throwIfAborted();
      if (!current()) return false;
      owner.booted = true;
      set({ attemptStartedAt: null });
      if (next.status === 'ready')
        void import('@/voice/onboardingPreferences').then(p => { if (current()) return p.flushOnboardingVoice(); }).catch(() => {});
      return isEngineUsable(next.status);
    }).catch(async (e) => {
      if (!current()) return false;
      let probe: EngineProbe;
      if (e instanceof EngineIncompatible) probe = { outcome: 'incompatible', error: e.message };
      else if (e instanceof EngineDown && e.kind === 'unauthorized') probe = { outcome: 'unauthorized', error: 'The engine rejected this session token.' };
      else if (e instanceof RequestDeadlineExpired || (e instanceof EngineDown && e.kind === 'timeout') ||
          (e instanceof DOMException && ['AbortError', 'TimeoutError'].includes(e.name)))
        probe = { outcome: 'timeout', error: e.message };
      else if (endpoint?.reason) probe = { outcome: 'crashed', error: endpoint.reason };
      else probe = { outcome: 'unreachable', error: e instanceof Error ? e.message : 'No engine answered on the local port.' };
      const previous = get().handshake;
      const next = nextEngineState(probe, e instanceof RequestDeadlineExpired ? ENGINE_BOOT_DEADLINE_MS : elapsed(), previous);
      const lost = next.status === 'disconnected' || next.status === 'failed';
      catalogSequence++; catalogAbort?.abort();
      if (lost) { resetEngineHandshake(); resetEngineLink(); }
      // Publish failure BEFORE diagnostics. A hung native tail cannot hold the spinner.
      set(st => ({ status: next.status, failureReason: next.failureReason, endpoint,
        health: null, handshake: lost ? null : previous, catalogStale: true, modelsStale: true,
        latencyMs: null, lastChecked: Date.now(), failures: st.failures + 1, lastError: probe.error ?? st.lastError, upSince: null }));
      if (next.status === 'failed' && scope.remaining() > 0) {
        const stderrTail = await scope.run(() => fetchStderrTail()).catch(() => []);
        if (current()) set({ stderrTail });
      }
      if (current() && lost && !get().restarting) { supervisor.cancel(); generation = null; }
      return false;
    }).finally(() => { if (inflight === attempt) inflight = null; });
    inflight = attempt;
    return attempt;
  },

  loadCatalog: async (opts) => {
    const st = get();
    if (!opts?.force && !opts?.discoverLocal && !st.catalogStale && st.catalogLoadedAt && Date.now() - st.catalogLoadedAt < CATALOG_TTL_MS) return;
    const sequence = ++catalogSequence;
    catalogAbort?.abort();
    const controller = new AbortController();
    catalogAbort = controller;
    const signal = requestSignal(controller, opts?.signal);
    const current = () => sequence === catalogSequence && get().generation === st.generation && !signal.aborted;
    try {
      const [providers, catalog, discovered] = await withinDeadline(async (signal) => Promise.all([
        engineJson<EngineProvidersResponse>('/providers', { signal }),
        engineJson<EngineCatalog>('/providers/catalog', { signal }),
        opts?.discoverLocal ? engineJson<EngineModelsResponse>('/models', { signal }) : Promise.resolve(undefined),
      ]), 10_000, signal);
      if (!current()) return;
      const observedAt = Date.now();
      const provenance = { generation: st.generation, observedAt, source: get().endpoint?.base ?? '/api/v1' };
      set(s => ({ providers, catalog, models: discovered ?? s.models,
        catalogLoadedAt: observedAt, catalogError: null, catalogStale: !isEngineUsable(s.status), catalogProvenance: provenance,
        ...(discovered ? { modelsStale: !isEngineUsable(s.status), modelsProvenance: provenance } : {}) }));
    } catch (e) {
      if (current()) set({ catalogStale: true, catalogError: e instanceof Error ? e.message : 'Could not load the model catalogue.' });
    } finally { controller.abort(); if (catalogAbort === controller) catalogAbort = null; }
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
    const owner = supervisor.begin(ENGINE_BOOT_DEADLINE_MS);
    generation = owner;
    inflight = null;
    catalogSequence++; catalogAbort?.abort(); resetEngineLink();
    set({ generation: owner.id, restarting: true, status: 'starting', failureReason: null,
      attemptStartedAt: Date.now(), handshake: null, health: null, upSince: null, catalogStale: true, modelsStale: true });
    const scope = supervisor.scope(owner, ENGINE_BOOT_DEADLINE_MS);
    try {
      return await scope.run(async signal => {
        if (isTauri()) {
          const { invoke } = await import('@tauri-apps/api/core');
          signal.throwIfAborted();
          await invoke('engine_restart');
        } else if (import.meta.env.DEV) {
          const res = await fetch('/__xr/engine/start', { method: 'POST', signal });
          const body = await res.json() as { started?: boolean };
          if (!res.ok || !body.started) throw new Error('Could not start the engine from the dev server.');
        } else throw new Error('Start the engine with `xr serve` and retry.');
        signal.throwIfAborted();
        if (!scope.current()) return { ok: false, message: 'A newer restart replaced this attempt.' };
        resetEngineLink();
        for (;;) {
          signal.throwIfAborted();
          if (await get().refresh()) return { ok: true, message: 'Engine started and identified.' };
          signal.throwIfAborted();
          await new Promise(r => setTimeout(r, Math.min(1000, scope.remaining())));
          signal.throwIfAborted();
        }
      });
    } catch (e) {
      if (scope.current()) set({ status: 'failed', failureReason: e instanceof RequestDeadlineExpired ? 'timeout' : 'unreachable',
        handshake: null, health: null, lastError: e instanceof Error ? e.message : 'Could not restart the engine.' });
      return { ok: false, message: e instanceof RequestDeadlineExpired ? 'Engine startup timed out within the 30 s boot budget.' : e instanceof Error ? e.message : 'Could not restart the engine.' };
    } finally { if (scope.current()) set({ restarting: false }); }
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
  const s = useEngineStore.getState();
  if (!s.providers || s.catalogStale || !isEngineUsable(s.status)) return false;
  // S-7: one predicate (engine/providerReadiness) instead of a `healthy` test
  // that is false before the first probe. A running local runtime is usable
  // even if its provider row carried no key — it needs none.
  return hasUsableProvider(s.providers.providers) || (!s.modelsStale && localRuntimeUsable(s.models?.current));
}

/** Last-known-good engine facts survive a refresh error, never synthetic rows. */
export function engineModelOptions(
  providers: EngineProvidersResponse | null = useEngineStore.getState()
    .providers,
  models: EngineModelsResponse | null = useEngineStore.getState().models,
  catalog: EngineCatalog | null = useEngineStore.getState().catalog
) {
  const options = modelOptions(providers, models, catalog);
  const st = useEngineStore.getState();
  if (providers === st.providers && (st.catalogStale || !isEngineUsable(st.status)))
    for (const row of [...options.local, ...options.cloud]) { row.available = false; row.detail = `Stale engine snapshot · ${row.detail ?? ''}`; }
  else if (models === st.models && st.modelsStale)
    for (const row of options.local) { row.available = false; row.discovered = false; }
  return options;
}
