/*
 * Provider catalog for the desktop (2026-11-01).
 *
 * The ENGINE is the source of truth for which providers exist — 26 presets
 * (hosted + local runtimes) plus any custom providers declared in its
 * config. The desktop used to hardcode a 12-entry subset, which is why the
 * app showed a fraction of what the engine supports. This module derives
 * the "Add a provider" catalog from the engine's live provider list
 * (GET /api/v1/providers, enriched 2026-11-01 with description / docsUrl /
 * baseUrl / authType / keyless), so:
 *
 *   - presence, health and credential state come from the engine, live;
 *   - a new engine preset appears in the desktop without a code change;
 *   - keys still go straight to the engine secret broker
 *     (engine/providers.ts), because every id below is engine-known.
 *
 * Presentation only (icon + curated tagline/keysUrl overrides) lives here;
 * when the engine is offline a small fallback keeps the Settings dialog
 * usable and is flagged as such by `degraded`.
 */
import {
  Activity,
  Bot,
  Boxes,
  Brain,
  CircuitBoard,
  Cloud,
  Cpu,
  Database,
  Flame,
  Flower2,
  Ghost,
  Globe,
  Heart,
  Laptop,
  Link as LinkIcon,
  Monitor,
  Mountain,
  PenLine,
  Rocket,
  Search,
  Server,
  Sparkles,
  Triangle,
  Users,
  Wind,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import type { EngineProvider } from '@/engine/types';
import type { ProviderKind } from '@/stores/settingsStore';

export interface ProviderCatalogEntryUi {
  id: string;
  name: string;
  kind: ProviderKind;
  tagline: string;
  baseUrl: string;
  keyless?: boolean;
  keysUrl?: string;
  icon: LucideIcon;
  /** From the engine: local runtimes vs hosted APIs. */
  engineKind: 'local' | 'cloud' | 'hosted' | 'custom';
  /** Live engine state for badges (never fabricated). */
  hasKey: boolean;
  healthy: boolean;
}

/* ── Presentation map (icons + optional tagline/keysUrl overrides) ────── */

const ICONS: Record<string, LucideIcon> = {
  openai: Sparkles,
  anthropic: Brain,
  google: Flower2,
  openrouter: Boxes,
  ollama: Cpu,
  mistral: Wind,
  groq: Zap,
  together: Rocket,
  xai: Bot,
  deepseek: Globe,
  cohere: LinkIcon,
  lmstudio: Monitor,
  jan: Laptop,
  localai: Server,
  vllm: Triangle,
  llamacpp: Mountain,
  gpt4all: Users,
  koboldcpp: Ghost,
  textgenwebui: PenLine,
  sglang: CircuitBoard,
  cerebras: Activity,
  fireworks: Flame,
  sambanova: Heart,
  huggingface: Boxes,
  perplexity: Search,
  bedrock: Database,
};

const KEYS_URL: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  groq: 'https://console.groq.com/keys',
  together: 'https://api.together.ai/settings/api-keys',
  xai: 'https://console.x.ai',
  deepseek: 'https://platform.deepseek.com/api_keys',
  cohere: 'https://dashboard.cohere.com/api-keys',
  perplexity: 'https://www.perplexity.ai/settings/api',
  huggingface: 'https://huggingface.co/settings/tokens',
  fireworks: 'https://fireworks.ai/account/api-keys',
  cerebras: 'https://cloud.cerebras.ai',
  sambanova: 'https://cloud.sambanova.ai/apis',
  bedrock: 'https://console.aws.amazon.com/iam',
};

const TAGLINE: Record<string, string> = {
  openai: 'Current GPT models and manual legacy choices.',
  anthropic: 'Claude models.',
  google: 'Gemini models.',
  openrouter: 'One key, every model.',
  ollama: 'Local models on this machine — no key needed.',
  mistral: 'Mistral and Codestral models.',
  groq: 'Fast inference for open models.',
  together: 'Open models, hosted.',
  xai: 'Grok models.',
  deepseek: 'DeepSeek chat and reasoner.',
  cohere: 'Command models.',
};

/** Desktop modal kinds: only the protocol actually changes the form. */
function desktopKind(p: EngineProvider): ProviderKind {
  if (p.id === 'anthropic') return 'anthropic';
  if (p.id === 'google') return 'gemini';
  if (p.id === 'ollama') return 'ollama';
  if (p.kind === 'custom') return 'custom';
  return 'openai-compatible';
}

function fromEngine(p: EngineProvider): ProviderCatalogEntryUi {
  return {
    id: p.id,
    name: p.label ?? p.id,
    kind: desktopKind(p),
    tagline: TAGLINE[p.id] ?? p.description ?? '',
    baseUrl: p.baseUrl ?? '',
    keyless: p.keyless ?? p.kind === 'local',
    keysUrl: KEYS_URL[p.id] ?? p.docsUrl ?? undefined,
    icon: ICONS[p.id] ?? (p.kind === 'local' ? Cpu : Cloud),
    engineKind: p.kind,
    hasKey: p.hasKey,
    healthy: p.healthy,
  };
}

/* ── Offline fallback (engine unreachable — flagged as degraded) ──────── */

const FALLBACK_IDS = [
  'openai', 'anthropic', 'google', 'groq', 'openrouter', 'mistral',
  'together', 'xai', 'deepseek', 'cohere',
];

const FALLBACK: ProviderCatalogEntryUi[] = FALLBACK_IDS.map((id) => ({
  id,
  name: id === 'google' ? 'Google Gemini' : id.charAt(0).toUpperCase() + id.slice(1),
  kind: desktopKind({ id, kind: 'hosted' } as EngineProvider),
  tagline: TAGLINE[id] ?? '',
  baseUrl: '',
  keysUrl: KEYS_URL[id],
  icon: ICONS[id] ?? Cloud,
  engineKind: 'hosted',
  hasKey: false,
  healthy: false,
}));

/* ── Builder ──────────────────────────────────────────────────────────── */

export interface ProviderCatalog {
  entries: ProviderCatalogEntryUi[];
  /** True when the engine list was unavailable and the fallback is shown. */
  degraded: boolean;
  counts: { hosted: number; local: number };
}

export const CUSTOM_ENDPOINT_ENTRY: ProviderCatalogEntryUi = {
  id: 'custom',
  name: 'Custom Endpoint',
  kind: 'custom',
  tagline: 'Any OpenAI-compatible base URL.',
  baseUrl: '',
  icon: Wrench,
  engineKind: 'custom',
  hasKey: false,
  healthy: false,
};

/**
 * Derive the catalog from the engine's provider list. Pure: pass the array
 * from the engine store; `null`/empty → degraded fallback.
 */
export function buildProviderCatalog(
  engineProviders: EngineProvider[] | null | undefined
): ProviderCatalog {
  const list = (engineProviders ?? []).filter((p) => p.id !== 'custom');
  if (list.length === 0) {
    return {
      entries: [...FALLBACK, CUSTOM_ENDPOINT_ENTRY],
      degraded: true,
      counts: { hosted: FALLBACK.length, local: 0 },
    };
  }
  const mapped = list.map(fromEngine);
  // Local runtimes last within their group; hosted/cloud first, then local,
  // then the engine's own custom providers, then the desktop custom endpoint.
  const rank = (e: ProviderCatalogEntryUi) =>
    e.engineKind === 'local' ? 1 : e.engineKind === 'custom' ? 2 : 0;
  const hosted = mapped.filter((e) => rank(e) === 0).sort((a, b) => a.name.localeCompare(b.name));
  const local = mapped.filter((e) => rank(e) === 1).sort((a, b) => a.name.localeCompare(b.name));
  const customs = mapped.filter((e) => rank(e) === 2).sort((a, b) => a.name.localeCompare(b.name));
  return {
    entries: [...hosted, ...local, ...customs, CUSTOM_ENDPOINT_ENTRY],
    degraded: false,
    counts: { hosted: hosted.length + customs.length, local: local.length },
  };
}
