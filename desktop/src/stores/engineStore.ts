/*
 * Engine link state (Phase 14) — the single store every surface reads to
 * know whether the XR engine daemon is reachable, which provider/model it
 * will run, and what it offers (providers, local models).
 *
 *   status    unknown → checking → up | down | unauthorized
 *   health    `/api/v1/health` body (version) + measured latency
 *   providers `/api/v1/providers` (primary/model, keys, health)
 *   models    `/api/v1/models` (local runtime, installed models, hardware)
 *
 * Polling is adaptive: 15 s while up, 3 s while down (so a restart is
 * noticed quickly), paused when the tab is hidden. Nothing here fabricates
 * a state — `up` means a real 200 arrived.
 */
import { create } from 'zustand';

import { MODEL_REGISTRY, modelInfo } from '@/budget/models';
import { EngineDown, engineEndpoint, engineFetch, engineJson, enginePost, resetEngineLink, type EngineEndpoint } from '@/engine/transport';
import type { EngineHealth, EngineModelsResponse, EngineProvidersResponse } from '@/engine/types';
import { isTauri } from '@/lib/tauri';

export type EngineStatus = 'unknown' | 'checking' | 'up' | 'down' | 'unauthorized';

export interface EngineModelOption {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  kind: 'local' | 'cloud';
  /** Usable right now (key present / runtime running). */
  available: boolean;
  /** Why not (shown as the disabled row's hint). */
  unavailableReason?: string;
  /** Local runtime detail (parameter size, quantization) when known. */
  detail?: string;
  /** The engine's current default. */
  isDefault: boolean;
}

interface EngineState {
  status: EngineStatus;
  endpoint: EngineEndpoint | null;
  health: EngineHealth | null;
  latencyMs: number | null;
  lastChecked: number | null;
  /** Consecutive failed polls (drives the banner only after the first). */
  failures: number;
  lastError: string | null;
  /** When the link first came up this session (uptime for Diagnostics). */
  upSince: number | null;
  providers: EngineProvidersResponse | null;
  models: EngineModelsResponse | null;
  catalogLoadedAt: number | null;
  catalogError: string | null;
  restarting: boolean;

  refresh: () => Promise<boolean>;
  loadCatalog: (opts?: { force?: boolean }) => Promise<void>;
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

function versionString(h: EngineHealth | null): string | null {
  if (!h) return null;
  if (typeof h.version === 'string') return h.version;
  if (h.version && typeof h.version.display === 'string') return h.version.display;
  return null;
}

export const useEngineStore = create<EngineState>()((set, get) => ({
  status: 'unknown',
  endpoint: null,
  health: null,
  latencyMs: null,
  lastChecked: null,
  failures: 0,
  lastError: null,
  upSince: null,
  providers: null,
  models: null,
  catalogLoadedAt: null,
  catalogError: null,
  restarting: false,

  refresh: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      if (get().status === 'unknown') set({ status: 'checking' });
      const started = performance.now();
      try {
        const endpoint = await engineEndpoint();
        const res = await engineFetch('/health');
        if (!res.ok) throw new Error(`health ${res.status}`);
        const health = (await res.json()) as EngineHealth;
        const wasUp = get().status === 'up';
        set({
          status: 'up',
          endpoint,
          health,
          latencyMs: Math.round(performance.now() - started),
          lastChecked: Date.now(),
          failures: 0,
          lastError: null,
          upSince: wasUp ? get().upSince : Date.now(),
        });
        // A fresh link: (re)load what it offers.
        if (!wasUp) void get().loadCatalog({ force: true });
        return true;
      } catch (e) {
        const unauthorized = e instanceof EngineDown && e.kind === 'unauthorized';
        const endpoint = await engineEndpoint().catch(() => null);
        set((st) => ({
          status: unauthorized ? 'unauthorized' : 'down',
          endpoint,
          latencyMs: null,
          lastChecked: Date.now(),
          failures: st.failures + 1,
          lastError: unauthorized
            ? 'The engine rejected this session token.'
            : endpoint?.reason
              ? endpoint.reason
              : e instanceof Error && e.message !== 'Engine unreachable'
                ? e.message
                : 'No engine answered on the local port.',
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
    if (!opts?.force && st.catalogLoadedAt && Date.now() - st.catalogLoadedAt < CATALOG_TTL_MS) return;
    try {
      const [providers, models] = await Promise.all([
        engineJson<EngineProvidersResponse>('/providers'),
        engineJson<EngineModelsResponse>('/models').catch(() => null),
      ]);
      set({ providers, models, catalogLoadedAt: Date.now(), catalogError: null });
    } catch (e) {
      set({ catalogError: e instanceof Error ? e.message : 'Could not load the model catalogue.' });
    }
  },

  setEngineDefault: async (modelId) => {
    const { resolveEngineModel } = await import('@/engine/chat');
    const t = resolveEngineModel(modelId);
    const provider = t.provider ?? get().providers?.primary;
    if (!provider || !t.model) return;
    await enginePost('/providers/set', { provider, model: t.model });
    await get().loadCatalog({ force: true });
  },

  startOrRestart: async () => {
    set({ restarting: true });
    try {
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const r = await invoke<{ ok: boolean; message?: string }>('engine_restart');
        resetEngineLink();
        const up = await waitForEngine(20_000);
        return { ok: up, message: up ? 'Engine restarted.' : (r?.message ?? 'The engine did not come back within 20 s.') };
      }
      if (!import.meta.env.DEV) {
        return { ok: false, message: 'Start the engine with `xr serve` and retry.' };
      }
      const res = await fetch('/__xr/engine/start', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { started?: boolean; reason?: string };
      if (!res.ok || !j.started) {
        return { ok: false, message: j.reason ?? 'Could not start the engine from the dev server.' };
      }
      const up = await waitForEngine(25_000);
      return { ok: up, message: up ? 'Engine started.' : 'Started the engine, but it has not answered yet.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Could not restart the engine.' };
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
      pollTimer = window.setTimeout(() => void tick(), get().status === 'up' ? POLL_UP_MS : POLL_DOWN_MS);
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

export function engineVersion(): string | null {
  return versionString(useEngineStore.getState().health);
}

/** The engine's current default model as a desktop id (`qwen2.5:0.5b`, `gpt-4o`). */
export function engineDefaultModel(): string | null {
  const p = useEngineStore.getState().providers;
  if (!p?.model) return null;
  return p.model;
}

/** True when at least one provider can answer right now. */
export function engineHasProvider(): boolean {
  const p = useEngineStore.getState().providers;
  if (!p) return false;
  return p.providers.some((x) => x.healthy && (x.kind === 'local' || x.hasKey));
}

const CLOUD_PROVIDER_IDS = new Set(['openai', 'anthropic', 'google', 'xai']);

/** Registry cloud models for a provider — a provider without a key lists them disabled. */
function cloudModelsFor(providerId: string): string[] {
  return MODEL_REGISTRY.filter((m) => m.provider === providerId && !m.local).map((m) => m.id);
}

/**
 * The model picker's rows, built from the engine's catalogue: Local group =
 * models the local runtime reports; Cloud group = providers the engine
 * knows, enabled when a key is configured. Falls back to nothing (not to a
 * fake list) when the engine is down.
 */
export function engineModelOptions(
  providers: EngineProvidersResponse | null = useEngineStore.getState().providers,
  models: EngineModelsResponse | null = useEngineStore.getState().models,
): { local: EngineModelOption[]; cloud: EngineModelOption[] } {
  const local: EngineModelOption[] = [];
  const cloud: EngineModelOption[] = [];
  if (!providers) return { local, cloud };
  const defaultId = providers.model;

  // Local: the current runtime's models (Ollama list), plus the configured
  // default when the runtime has not listed it (still selectable; the engine
  // will say "Provider offline" honestly if it is not pulled).
  const runtime = models?.current;
  const runtimeProvider = providers.providers.find((p) => p.id === (runtime?.providerId ?? 'ollama'));
  const running = runtime?.running === true || runtimeProvider?.healthy === true;
  const seen = new Set<string>();
  for (const m of runtime?.models ?? []) {
    const id = typeof m === 'string' ? m : (m.name ?? m.model ?? m.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const detail = typeof m === 'string' ? undefined : [m.parameterSize, m.quantization].filter(Boolean).join(' · ') || undefined;
    local.push({
      id,
      label: modelInfo(id).name,
      provider: runtime?.providerId ?? 'ollama',
      providerLabel: runtime?.label ?? 'Ollama',
      kind: 'local',
      available: running,
      ...(running ? {} : { unavailableReason: 'Runtime not running' }),
      ...(detail ? { detail } : {}),
      isDefault: id === defaultId,
    });
  }
  if (defaultId && !seen.has(defaultId) && providers.primary && !CLOUD_PROVIDER_IDS.has(providers.primary)) {
    const p = providers.providers.find((x) => x.id === providers.primary);
    local.push({
      id: defaultId,
      label: modelInfo(defaultId).name,
      provider: providers.primary,
      providerLabel: p?.label ?? providers.primary,
      kind: 'local',
      available: p?.healthy === true,
      ...(p?.healthy ? {} : { unavailableReason: p?.detail ?? 'Not reachable' }),
      isDefault: true,
    });
  }

  for (const p of providers.providers) {
    if (p.kind !== 'cloud' && p.kind !== 'hosted') continue;
    const ids = CLOUD_PROVIDER_IDS.has(p.id) ? cloudModelsFor(p.id) : p.defaultModel ? [p.defaultModel] : [];
    for (const id of ids) {
      cloud.push({
        id,
        label: modelInfo(id).name,
        provider: p.id,
        providerLabel: p.label,
        kind: 'cloud',
        available: p.hasKey,
        ...(p.hasKey ? {} : { unavailableReason: 'No API key' }),
        isDefault: id === defaultId && p.id === providers.primary,
      });
    }
  }
  return { local, cloud };
}
