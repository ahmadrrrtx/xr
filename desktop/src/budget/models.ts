/*
 * Model registry (Phase 13) — the one table of models, prices and traits the
 * Budget screen, the chat model picker, the Brain mock and the governor
 * share. Prices are list prices per 1M tokens (approximate 2026 market
 * rates; a provider's own invoice is the only truth, so the UI calls every
 * number an estimate). Local models cost $0 in cash — "local", never "free!".
 *
 * Mirrored in src-tauri/src/budget/governor.rs (PRICES) — keep both in step.
 */

export type ModelProvider =
  'openai' | 'anthropic' | 'google' | 'xai' | 'ollama' | 'other';

/** Chart family → `--chart-*` token (Phase 11). */
export type ModelFamily = 'openai' | 'anthropic' | 'google' | 'local' | 'other';

export type ModelLatency = 'fast' | 'medium' | 'slow';
export type ModelQuality = 'good' | 'great' | 'best';
export type ModelStrength = 'chat' | 'coding' | 'reasoning' | 'vision';

export interface ModelInfo {
  id: string;
  name: string;
  provider: ModelProvider;
  family: ModelFamily;
  /** USD per 1M input tokens. */
  inPer1M: number;
  /** USD per 1M output tokens. */
  outPer1M: number;
  /** Context window in thousands of tokens. */
  contextK: number;
  latency: ModelLatency;
  quality: ModelQuality;
  strengths: ModelStrength[];
  local: boolean;
  /** Minimum RAM for a comfortable local run (GB). */
  ramGb?: number;
  /** Download size (GB) for local models. */
  sizeGb?: number;
  /** Pricing is a mid-tier guess (unknown model) — the UI labels it. */
  estimate?: boolean;
}

const cloud = (
  id: string,
  name: string,
  provider: Exclude<ModelProvider, 'ollama'>,
  inPer1M: number,
  outPer1M: number,
  contextK: number,
  latency: ModelLatency,
  quality: ModelQuality,
  strengths: ModelStrength[]
): ModelInfo => ({
  id,
  name,
  provider,
  family:
    provider === 'openai'
      ? 'openai'
      : provider === 'anthropic'
        ? 'anthropic'
        : provider === 'google'
          ? 'google'
          : 'other',
  inPer1M,
  outPer1M,
  contextK,
  latency,
  quality,
  strengths,
  local: false,
});

const local = (
  id: string,
  name: string,
  contextK: number,
  ramGb: number,
  sizeGb: number,
  quality: ModelQuality,
  strengths: ModelStrength[]
): ModelInfo => ({
  id,
  name,
  provider: 'ollama',
  family: 'local',
  inPer1M: 0,
  outPer1M: 0,
  contextK,
  latency: ramGb >= 48 ? 'slow' : 'fast',
  quality,
  strengths,
  local: true,
  ramGb,
  sizeGb,
});

export const MODEL_REGISTRY: readonly ModelInfo[] = [
  // OpenAI
  cloud('gpt-5', 'GPT-5', 'openai', 2.5, 10, 400, 'medium', 'best', [
    'chat',
    'coding',
    'reasoning',
    'vision',
  ]),
  cloud('gpt-5-mini', 'GPT-5 mini', 'openai', 0.15, 0.6, 400, 'fast', 'great', [
    'chat',
    'coding',
    'vision',
  ]),
  cloud('gpt-4o', 'GPT-4o', 'openai', 2.5, 10, 128, 'medium', 'great', [
    'chat',
    'vision',
  ]),
  cloud(
    'gpt-4o-mini',
    'GPT-4o mini',
    'openai',
    0.15,
    0.6,
    128,
    'fast',
    'good',
    ['chat', 'vision']
  ),
  // Anthropic
  cloud(
    'claude-opus-4-6',
    'Claude Opus 4.6',
    'anthropic',
    15,
    75,
    200,
    'slow',
    'best',
    ['chat', 'coding', 'reasoning', 'vision']
  ),
  cloud(
    'claude-sonnet-4-6',
    'Claude Sonnet 4.6',
    'anthropic',
    3,
    15,
    200,
    'medium',
    'best',
    ['chat', 'coding', 'reasoning', 'vision']
  ),
  cloud(
    'claude-sonnet-4.5',
    'Claude Sonnet 4.5',
    'anthropic',
    3,
    15,
    200,
    'medium',
    'best',
    ['chat', 'coding', 'reasoning', 'vision']
  ),
  cloud(
    'claude-haiku-4-6',
    'Claude Haiku 4.6',
    'anthropic',
    0.25,
    1.25,
    200,
    'fast',
    'great',
    ['chat', 'coding']
  ),
  // Google
  cloud(
    'gemini-2.5-pro',
    'Gemini 2.5 Pro',
    'google',
    1.25,
    10,
    1000,
    'medium',
    'best',
    ['chat', 'reasoning', 'vision']
  ),
  cloud(
    'gemini-2.5-flash',
    'Gemini 2.5 Flash',
    'google',
    0.3,
    2.5,
    1000,
    'fast',
    'great',
    ['chat', 'vision']
  ),
  // xAI
  cloud('grok-4', 'Grok 4', 'xai', 3, 15, 256, 'medium', 'great', [
    'chat',
    'reasoning',
  ]),
  // Local (Ollama)
  local('qwen2.5:3b', 'Qwen 2.5 3B', 32, 8, 1.9, 'good', ['chat']),
  local('qwen2.5-coder:3b', 'Qwen 2.5 Coder 3B', 32, 8, 1.9, 'good', [
    'coding',
  ]),
  local('llama3.2:3b', 'Llama 3.2 3B', 128, 8, 2.0, 'good', ['chat']),
  local('llama3.1:8b', 'Llama 3.1 8B', 128, 16, 4.7, 'great', [
    'chat',
    'coding',
  ]),
  local('deepseek-r1:7b', 'DeepSeek R1 7B', 64, 16, 4.7, 'great', [
    'reasoning',
    'coding',
  ]),
  local('llama3.1:70b', 'Llama 3.1 70B', 128, 48, 40, 'best', [
    'chat',
    'coding',
    'reasoning',
  ]),
];

const BY_ID = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));

/** Unknown models fail "expensive": a mid-tier estimate, flagged (Art. IV.4). */
export const UNKNOWN_IN_PER_1M = 5;
export const UNKNOWN_OUT_PER_1M = 15;

export function modelInfo(id: string): ModelInfo {
  const known = BY_ID.get(id);
  if (known) return known;
  const isLocal = id.startsWith('ollama/') || /:\d+b$/i.test(id);
  return {
    id,
    name: id,
    provider: isLocal ? 'ollama' : 'other',
    family: isLocal ? 'local' : 'other',
    inPer1M: isLocal ? 0 : UNKNOWN_IN_PER_1M,
    outPer1M: isLocal ? 0 : UNKNOWN_OUT_PER_1M,
    contextK: 128,
    latency: 'medium',
    quality: 'good',
    strengths: ['chat'],
    local: isLocal,
    estimate: !isLocal,
  };
}

export function isLocalModel(id: string): boolean {
  return modelInfo(id).local;
}

export function modelFamily(id: string): ModelFamily {
  return modelInfo(id).family;
}

export function modelLabel(id: string): string {
  return modelInfo(id).name;
}

/** Estimated USD for a call — identical arithmetic to the Rust side. */
export function estimateCost(
  id: string,
  tokensIn: number,
  tokensOut: number
): number {
  const m = modelInfo(id);
  return round6((tokensIn * m.inPer1M + tokensOut * m.outPer1M) / 1_000_000);
}

/** USD per single output token (mid-stream metering). */
export function perOutputToken(id: string): number {
  return modelInfo(id).outPer1M / 1_000_000;
}

export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Cheap / mid / expensive bands for the cost row colour. */
export function priceBand(
  m: ModelInfo
): 'cheap' | 'mid' | 'expensive' | 'local' {
  if (m.local) return 'local';
  if (m.outPer1M <= 2.5) return 'cheap';
  if (m.outPer1M <= 15) return 'mid';
  return 'expensive';
}

export const PROVIDER_LABEL: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  ollama: 'Ollama · local',
  other: 'Other',
};
