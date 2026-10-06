/*
 * Provider setup against the engine (Phase 14 · deliverable 8).
 *
 * The engine is the process that calls providers, so it must hold the keys:
 * `POST /onboarding/provider` stores one in the engine's secret broker
 * (OS keychain where available, encrypted file otherwise), invalidates its
 * health cache and — only when asked — makes that provider the default.
 * `POST /providers/set` switches the default; `POST /models/test` pings a
 * local model and reports real latency. Nothing here fabricates a result:
 * when the engine is down these calls reject and the caller says so.
 */
import { modelInfo } from '@/budget/models';
import { enginePost } from '@/engine/transport';
import { useEngineStore } from '@/stores/engineStore';

export interface EngineKeySaveResult {
  ok: boolean;
  provider: string;
  model: string | null;
  setDefault: boolean;
  /** Where the engine stored the key (`keychain`, `secret-service`, `dpapi`, `file`). */
  secretBackend: string;
  /** Advisory probe; the key is stored regardless of its outcome. */
  health: { ok: boolean; detail: string | null; latencyMs: number | null } | null;
}

/** Desktop provider ids that the engine also knows (its presets use the same ids). */
export function engineKnowsProvider(providerId: string): boolean {
  const list = useEngineStore.getState().providers?.providers;
  if (!list) return providerId !== 'custom';
  return list.some((p) => p.id === providerId);
}

export function saveProviderKeyToEngine(input: {
  providerId: string;
  apiKey: string;
  model?: string | null;
  setDefault?: boolean;
  probe?: boolean;
}): Promise<EngineKeySaveResult> {
  return enginePost<EngineKeySaveResult>('/onboarding/provider', {
    providerId: input.providerId,
    apiKey: input.apiKey,
    model: input.model ?? undefined,
    probe: input.probe ?? true,
    setDefault: input.setDefault ?? false,
  });
}

/** Make `provider` (and optionally `model`) the engine's default for new turns. */
export async function setEngineDefault(provider: string, model?: string | null): Promise<void> {
  await enginePost('/providers/set', { provider, model: model ?? undefined });
  await useEngineStore.getState().loadCatalog();
}

export interface EngineModelPing {
  ok: boolean;
  runtime: string;
  model: string;
  result: { ok: boolean; detail?: string | null; latencyMs?: number | null };
}

/** Ping a local model through the engine (real request, real latency). */
export function pingEngineLocalModel(runtime: string, model: string): Promise<EngineModelPing> {
  return enginePost<EngineModelPing>('/models/test', { runtime, model });
}

/**
 * Infer the provider from a pasted key's prefix — used by onboarding, whose
 * "bring your own key" card does not ask which vendor it is for. Returns
 * null when the prefix is ambiguous; the caller then asks instead of guessing.
 */
export function inferProviderFromKey(key: string): 'anthropic' | 'groq' | 'openai' | 'google' | 'openrouter' | 'xai' | null {
  const k = key.trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('xai-')) return 'xai';
  if (k.startsWith('AIza')) return 'google';
  if (k.startsWith('sk-')) return 'openai';
  return null;
}

/**
 * A sample-exchange cost for a model: 1k tokens in, 500 out, from the
 * desktop rate table. Local models are $0; a model the table does not know
 * is flagged `estimate` so the UI can say so (Constitution Art. IV.5).
 */
export function sampleExchangeUsd(model: string): { usd: number; estimate: boolean } {
  const info = modelInfo(model);
  if (info.local) return { usd: 0, estimate: false };
  return { usd: (1000 * info.inPer1M + 500 * info.outPer1M) / 1_000_000, estimate: info.estimate === true };
}
