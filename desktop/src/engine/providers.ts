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
import { engineGet, enginePost } from '@/engine/transport';
import { useEngineStore } from '@/stores/engineStore';

export interface EngineKeySaveResult {
  ok: boolean;
  provider: string;
  model: string | null;
  setDefault: boolean;
  /** Where the engine stored the key (`keychain`, `secret-service`, `dpapi`, `file`). */
  secretBackend: string;
  /** Advisory probe; the key is stored regardless of its outcome. */
  health: {
    ok: boolean;
    detail: string | null;
    latencyMs: number | null;
  } | null;
}

/** Desktop provider ids that the engine also knows (its presets use the same ids). */
export function engineKnowsProvider(providerId: string): boolean {
  const list = useEngineStore.getState().providers?.providers;
  if (!list) return providerId !== 'custom';
  return list.some((p) => p.id === providerId);
}

export function requireEngineReady(): void {
  if (useEngineStore.getState().status !== 'ready')
    throw new Error('Engine not ready. Start a compatible engine and retry; nothing was saved.');
}

function sameEngine(generation: number): void {
  const state = useEngineStore.getState();
  if (state.generation !== generation || state.status !== 'ready') throw new Error('Engine changed during the operation. Review its current configuration before retrying.');
}

export function saveProviderKeyToEngine(input: {
  providerId: string;
  apiKey: string;
  model?: string | null;
  setDefault?: boolean;
  probe?: boolean;
}): Promise<EngineKeySaveResult> {
  requireEngineReady();
  const generation = useEngineStore.getState().generation;
  return enginePost<EngineKeySaveResult>('/onboarding/provider', {
    providerId: input.providerId,
    apiKey: input.apiKey,
    model: input.model ?? undefined,
    probe: input.probe ?? false,
    setDefault: input.setDefault ?? false,
  }).then(result => { sameEngine(generation); return result; });
}

/**
 * XR-REL-06 — add a custom OpenAI-compatible endpoint.
 *
 * This is the promise in the README ("any OpenAI-compatible API") made
 * reachable from the app. The engine is the one that validates: it refuses
 * private/link-local/metadata hosts through its SSRF guard, derives or
 * sanitises the id, and stores the key under an env var it controls.
 */
export interface CustomProviderInput {
  id?: string;
  label?: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface CustomProviderSummary {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string | null;
  apiKeyEnv: string | null;
  keyed?: boolean;
  hasHeaders?: boolean;
}

export async function addCustomProviderToEngine(
  input: CustomProviderInput, signal?: AbortSignal
): Promise<{ ok: boolean; provider: CustomProviderSummary & { defaultModel: string } }> {
  requireEngineReady();
  const generation = useEngineStore.getState().generation;
  const url = new URL(input.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP(S) base URL without credentials, query parameters or a fragment.');
  if (!input.defaultModel.trim()) throw new Error('An explicit model is required.');
  const result = await enginePost<{ ok: boolean; provider: CustomProviderSummary }>(
    '/providers/custom',
    input, { signal }
  );
  sameEngine(generation);
  if (result.ok !== true || !result.provider?.id || !result.provider.defaultModel)
    throw new Error('The engine did not acknowledge an endpoint and model.');
  // The catalog must be re-read: the new provider contributes models.
  await useEngineStore.getState().loadCatalog({ force: true, signal });
  signal?.throwIfAborted();
  sameEngine(generation);
  return { ...result, provider: { ...result.provider, defaultModel: result.provider.defaultModel } };
}

export async function listCustomProviders(): Promise<CustomProviderSummary[]> {
  const result = await engineGet<{ providers: CustomProviderSummary[] }>('/providers/custom');
  return result.providers ?? [];
}

export async function removeCustomProviderFromEngine(id: string): Promise<void> {
  requireEngineReady();
  const result = await enginePost<{ ok: boolean }>('/providers/custom/remove', { id });
  if (result.ok === false) throw new Error('The engine did not remove the endpoint.');
  await useEngineStore.getState().loadCatalog({ force: true });
}

export async function removeProviderKeyFromEngine(
  providerId: string
): Promise<{ ok: boolean; notice: string }> {
  requireEngineReady();
  const result = await enginePost<{ ok: boolean; notice: string }>(
    '/onboarding/provider/remove',
    { providerId }
  );
  if (!result.ok)
    throw new Error(
      'The engine did not confirm credential removal; the entry was retained.'
    );
  await useEngineStore.getState().loadCatalog({ force: true });
  return result;
}

/** Make `provider` (and optionally `model`) the engine's default for new turns. */
export async function setEngineDefault(
  provider: string,
  model?: string | null
): Promise<void> {
  requireEngineReady();
  const generation = useEngineStore.getState().generation;
  await enginePost('/providers/set', { provider, model: model ?? undefined });
  sameEngine(generation);
  await useEngineStore.getState().loadCatalog({ force: true });
}

export interface EngineModelPing {
  ok: boolean;
  runtime: string;
  model: string;
  result: { ok: boolean; detail?: string | null; latencyMs?: number | null };
}

/** Ping a local model through the engine (real request, real latency). */
export function pingEngineLocalModel(
  runtime: string,
  model: string
): Promise<EngineModelPing> {
  return enginePost<EngineModelPing>('/models/test', { runtime, model });
}

/**
 * Infer the provider from a pasted key's prefix — used by onboarding, whose
 * "bring your own key" card does not ask which vendor it is for. Returns
 * null when the prefix is ambiguous; the caller then asks instead of guessing.
 */
export function inferProviderFromKey(
  key: string
): 'anthropic' | 'groq' | 'openai' | 'google' | 'openrouter' | 'xai' | null {
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
export function sampleExchangeUsd(model: string): {
  usd: number;
  estimate: boolean;
} {
  const info = modelInfo(model);
  if (info.local) return { usd: 0, estimate: false };
  return {
    usd: (1000 * info.inPer1M + 500 * info.outPer1M) / 1_000_000,
    estimate: info.estimate === true,
  };
}

/** Endpoint/auth observation only: no generated text, tool or billing claim. */
export interface EngineProviderProbe {
  ok: boolean; providerId: string; model: string; inferenceVerified: false;
  latencyMs: number | null; detail: string; authState: string;
}
export function probeEngineProvider(providerId: string, model?: string): Promise<EngineProviderProbe> {
  requireEngineReady();
  return enginePost('/providers/probe', { providerId, model });
}

export type { DiscoveryObservation, ValidationCapability } from '../../../src/providers/observations';
import type { DiscoveryObservation, ValidationCapability } from '../../../src/providers/observations';

/** A discovery draft is a real engine registration, but names NO model and
 * never selects a default. Its acknowledged identity survives the later save. */
export async function registerCustomProviderDraft(input: Omit<CustomProviderInput, 'defaultModel'>, signal?: AbortSignal): Promise<CustomProviderSummary> {
  requireEngineReady();
  const generation = useEngineStore.getState().generation;
  const url = new URL(input.baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP(S) base URL without credentials/query/fragment.');
  const result = await enginePost<{ ok: boolean; provider: CustomProviderSummary }>('/providers/custom', { ...input, draft: true }, { signal });
  sameEngine(generation);
  if (!result.ok || !result.provider?.id) throw new Error('Engine did not acknowledge the endpoint registration.');
  await useEngineStore.getState().loadCatalog({ force: true, signal });
  signal?.throwIfAborted();
  sameEngine(generation);
  return result.provider;
}
export function discoverEngineModels(providerId: string, signal?: AbortSignal): Promise<DiscoveryObservation> {
  requireEngineReady();
  return enginePost('/providers/discover', { providerId, optIn: true }, { signal });
}
export interface ModelValidationObservation {
  providerId: string; modelId: string; capability: ValidationCapability; checkedAt: string;
  status: string; detail: string; agentValidated: false; billingVerified: false; validation?: Record<string, string>;
}
export function validateEngineModel(providerId: string, model: string, capability: ValidationCapability, signal?: AbortSignal): Promise<ModelValidationObservation> {
  requireEngineReady();
  return enginePost('/providers/validate', { providerId, model, capability, optIn: true, allowBillable: true }, { signal });
}
