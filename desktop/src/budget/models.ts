/* Model facts and standard price estimates come from the SAME offline registry
 * as the engine. Documentation is not measured latency/quality, availability,
 * live account compatibility or an invoice ceiling. Saved choices are retained. */
import {
  MODEL_FACTS,
  modelFact,
  type ModelFact,
} from '../../../src/intelligence/model-registry';
import { priceFor, pricingAvailable } from '../../../src/cost/pricing';

export type ModelProvider =
  'openai' | 'anthropic' | 'google' | 'xai' | 'ollama' | 'other';
export type ModelFamily = 'openai' | 'anthropic' | 'google' | 'local' | 'other';
export type ModelLatency = 'fast' | 'medium' | 'slow' | 'unknown';
export type ModelQuality = 'good' | 'great' | 'best' | 'unknown';
export type ModelStrength =
  'chat' | 'coding' | 'reasoning' | 'vision' | 'tools';
export interface ModelInfo {
  id: string;
  name: string;
  provider: ModelProvider;
  family: ModelFamily;
  /** NaN means unavailable (JSON null), never an invented free/mid-tier rate. */
  inPer1M: number;
  outPer1M: number;
  pricingKnown?: boolean;
  rateSource?: string;
  contextK: number;
  latency: ModelLatency;
  quality: ModelQuality;
  strengths: ModelStrength[];
  local: boolean;
  ramGb?: number;
  sizeGb?: number;
  estimate?: boolean;
  lifecycle?: ModelFact['lifecycle'];
}
const LOCAL_IDS = new Set([
  'ollama',
  'lmstudio',
  'llamacpp',
  'jan',
  'localai',
  'vllm',
  'gpt4all',
  'koboldcpp',
  'textgenwebui',
  'sglang',
]);
export function qualifiedModelId(provider: string, model: string): string {
  return `${provider}::${model}`;
}
/** :: is unambiguous even for model IDs containing vendor/path namespaces. */
export function splitModelId(id: string): { provider?: string; model: string } {
  const index = id.indexOf('::');
  if (index > 0 && /^[a-zA-Z0-9_-]+$/.test(id.slice(0, index)))
    return { provider: id.slice(0, index), model: id.slice(index + 2) };
  const legacy =
    /^(openai|anthropic|google|xai|ollama|lmstudio|llamacpp|groq|openrouter)\/(.+)$/.exec(
      id
    );
  if (legacy) return { provider: legacy[1], model: legacy[2] };
  return { model: id };
}
function inferredProvider(model: string): string | undefined {
  if (/^gpt-|^o[134](?:-|$)/.test(model)) return 'openai';
  if (/^claude-/.test(model)) return 'anthropic';
  if (/^gemini-/.test(model)) return 'google';
  if (/^grok-/.test(model)) return 'xai';
  if (/^(?:ollama\/|[\w./-]+:(?:[\w.-]+)$)/.test(model)) return 'ollama';
  return undefined;
}
const localRows: ModelInfo[] = [
  { id: 'qwen2.5:3b', name: 'Qwen 2.5 3B', ramGb: 8, sizeGb: 1.9 },
  { id: 'qwen2.5-coder:3b', name: 'Qwen 2.5 Coder 3B', ramGb: 8, sizeGb: 1.9 },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', ramGb: 8, sizeGb: 2 },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', ramGb: 16, sizeGb: 4.7 },
  { id: 'deepseek-r1:7b', name: 'DeepSeek R1 7B', ramGb: 16, sizeGb: 4.7 },
  { id: 'llama3.1:70b', name: 'Llama 3.1 70B', ramGb: 48, sizeGb: 40 },
].map((m) => ({
  ...m,
  provider: 'ollama',
  family: 'local',
  inPer1M: 0,
  outPer1M: 0,
  pricingKnown: true,
  contextK: 0,
  latency: 'unknown',
  quality: 'unknown',
  strengths: ['chat'],
  local: true,
}));
function fromFact(f: ModelFact): ModelInfo {
  const p = priceFor(f.providerId, f.modelId);
  const provider: ModelProvider = [
    'openai',
    'anthropic',
    'google',
    'xai',
    'ollama',
  ].includes(f.providerId)
    ? (f.providerId as ModelProvider)
    : 'other';
  return {
    id: f.modelId,
    name: f.modelId,
    provider,
    family:
      provider === 'ollama'
        ? 'local'
        : ['openai', 'anthropic', 'google'].includes(provider)
          ? (provider as ModelFamily)
          : 'other',
    inPer1M: p.inPerMTok,
    outPer1M: p.outPerMTok,
    pricingKnown: pricingAvailable(p),
    rateSource: p.source,
    contextK: (f.contextWindow ?? 0) / 1000,
    latency: 'unknown',
    quality: 'unknown',
    strengths: [
      'chat',
      ...(f.reasoning ? ['reasoning' as const] : []),
      ...(f.tools ? ['tools' as const] : []),
    ],
    local: provider === 'ollama',
    estimate: true,
    lifecycle: f.lifecycle,
  };
}
export const MODEL_REGISTRY: readonly ModelInfo[] = [
  ...MODEL_FACTS.map(fromFact),
  ...localRows,
];
const BY_ID = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));
export const UNKNOWN_IN_PER_1M = NaN;
export const UNKNOWN_OUT_PER_1M = NaN;
export function modelInfo(
  id: string,
  options: { now?: number; inputTokens?: number } = {}
): ModelInfo {
  const ref = splitModelId(id);
  const providerId = ref.provider ?? inferredProvider(ref.model);
  const known = BY_ID.get(ref.model);
  const local = !!providerId && LOCAL_IDS.has(providerId);
  const fact = providerId ? modelFact(providerId, ref.model) : undefined;
  const rates = priceFor(providerId ?? 'unknown', ref.model, options);
  const base =
    known &&
    (!ref.provider || known.provider === ref.provider || (local && known.local))
      ? known
      : undefined;
  return {
    id,
    name: base?.name ?? ref.model,
    provider:
      base?.provider ??
      (local
        ? 'ollama'
        : ['openai', 'anthropic', 'google', 'xai'].includes(providerId ?? '')
          ? (providerId as ModelProvider)
          : 'other'),
    family: base?.family ?? (local ? 'local' : 'other'),
    contextK: (fact?.contextWindow ?? 0) / 1000,
    latency: 'unknown',
    quality: 'unknown',
    strengths: base?.strengths ?? ['chat'],
    ramGb: base?.ramGb,
    sizeGb: base?.sizeGb,
    local,
    estimate: !local,
    lifecycle: fact?.lifecycle ?? 'legacy',
    inPer1M: rates.inPerMTok,
    outPer1M: rates.outPerMTok,
    pricingKnown: pricingAvailable(rates),
    rateSource: rates.source,
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
export function estimateCost(
  id: string,
  tokensIn: number,
  tokensOut: number,
  now = Date.now()
): number {
  const m = modelInfo(id, { now, inputTokens: tokensIn });
  return round6((tokensIn * m.inPer1M + tokensOut * m.outPer1M) / 1_000_000);
}
export function perOutputToken(id: string): number {
  return modelInfo(id).outPer1M / 1_000_000;
}
export function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
export function priceBand(
  m: ModelInfo
): 'cheap' | 'mid' | 'expensive' | 'local' {
  if (m.local) return 'local';
  if (!Number.isFinite(m.outPer1M)) return 'expensive'; // never imply an unavailable price is cheap
  return m.outPer1M <= 2.5 ? 'cheap' : m.outPer1M <= 15 ? 'mid' : 'expensive';
}
export const PROVIDER_LABEL: Record<ModelProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  xai: 'xAI',
  ollama: 'Ollama · local',
  other: 'Other',
};
