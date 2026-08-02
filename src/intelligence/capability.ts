/**
 * XR 4.4 — Capability helpers and preset → descriptor mapping.
 * Unknown is never treated as supported.
 */

import type { ProviderCapabilities } from "../providers/capabilities.ts";
import type { ProviderPreset } from "../providers/presets.ts";
import type {
  CapabilitySupport,
  CostProfile,
  CostTier,
  LocalityProfile,
  ModelCapabilities,
  ModelClass,
  ModelDescriptor,
  Modality,
  ProviderDescriptor,
  QualityProfile,
} from "./types.ts";

export function supported(): CapabilitySupport {
  return "supported";
}
export function unsupported(): CapabilitySupport {
  return "unsupported";
}
export function unknown(): CapabilitySupport {
  return "unknown";
}

export function isSupported(v: CapabilitySupport | undefined): boolean {
  return v === "supported";
}

export function isKnownUnsupported(v: CapabilitySupport | undefined): boolean {
  return v === "unsupported";
}

/** Convert legacy boolean | undefined → tri-state. undefined = unknown. */
export function fromBool(v: boolean | undefined, whenTrue: CapabilitySupport = "supported"): CapabilitySupport {
  if (v === true) return whenTrue;
  if (v === false) return "unsupported";
  return "unknown";
}

export function emptyCapabilities(chat: CapabilitySupport = "unknown"): ModelCapabilities {
  return {
    chat,
    completion: "unknown",
    reasoning: "unknown",
    code: "unknown",
    toolUse: "unknown",
    structuredOutput: "unknown",
    jsonMode: "unknown",
    functionCalling: "unknown",
    streaming: "unknown",
    vision: "unknown",
    imageUnderstanding: "unknown",
    imageGeneration: "unsupported",
    speechToText: "unsupported",
    textToSpeech: "unsupported",
    embeddings: "unknown",
    reranking: "unsupported",
    multimodal: "unknown",
  };
}

/** Map legacy ProviderCapabilities (booleans) into tri-state ModelCapabilities. */
export function fromLegacyCapabilities(caps: ProviderCapabilities | undefined): ModelCapabilities {
  const c = caps ?? { chat: true };
  const out = emptyCapabilities(fromBool(c.chat, "supported"));
  // chat defaults true in legacy; if explicitly false mark unsupported
  if (c.chat === false) out.chat = "unsupported";
  else out.chat = "supported";

  out.reasoning = fromBool(c.reasoning);
  out.vision = fromBool(c.vision);
  out.imageUnderstanding = fromBool(c.vision);
  out.embeddings = fromBool(c.embeddings);
  out.toolUse = fromBool(c.toolUse);
  out.jsonMode = fromBool(c.jsonMode);
  out.structuredOutput = fromBool(c.jsonMode);
  out.functionCalling = fromBool(c.functionCalling ?? c.toolUse);
  out.streaming = fromBool(c.streaming);
  // Infer multimodal when vision is supported
  if (out.vision === "supported") out.multimodal = "supported";
  // completion tracks chat for current adapters
  out.completion = out.chat;
  // code: unknown unless we have a static hint later
  return out;
}

export function localityForKind(kind: ProviderPreset["kind"], id?: string): LocalityProfile {
  if (kind === "local") {
    return { locality: "local", leavesMachine: false, requiresCredential: false };
  }
  if (id === "bedrock") {
    return { locality: "private", leavesMachine: true, requiresCredential: true, region: "aws" };
  }
  if (kind === "custom") {
    // Custom endpoints may be private; treat as private when URL looks local, else cloud.
    return { locality: "cloud", leavesMachine: true, requiresCredential: true };
  }
  return { locality: "cloud", leavesMachine: true, requiresCredential: true };
}

export function costProfileFor(tier: CostTier, kind: ProviderPreset["kind"]): CostProfile {
  return {
    tier,
    free: kind === "local" || tier === "free",
  };
}

export function qualityFor(tier: CostTier, caps: ModelCapabilities): QualityProfile {
  if (tier === "premium" || tier === "enterprise") {
    return {
      class: "high",
      staticScore: tier === "enterprise" ? 0.9 : 0.85,
      reasoningBias: caps.reasoning === "supported" ? 0.2 : 0.1,
      codeBias: 0.1,
    };
  }
  if (tier === "cheap") {
    return { class: "standard", staticScore: 0.65, reasoningBias: 0.05, codeBias: 0.05 };
  }
  if (tier === "free" && caps.reasoning === "supported") {
    return { class: "standard", staticScore: 0.6, reasoningBias: 0.15 };
  }
  return { class: "basic", staticScore: 0.5 };
}

export function classesFromCapabilities(caps: ModelCapabilities): ModelClass[] {
  const classes: ModelClass[] = [];
  if (caps.chat === "supported") classes.push("chat");
  if (caps.completion === "supported") classes.push("completion");
  if (caps.reasoning === "supported") classes.push("reasoning");
  if (caps.code === "supported") classes.push("code");
  if (caps.toolUse === "supported") classes.push("tool_use");
  if (caps.structuredOutput === "supported" || caps.jsonMode === "supported") {
    classes.push("structured_output");
  }
  if (caps.vision === "supported" || caps.imageUnderstanding === "supported") {
    classes.push("vision");
    classes.push("image_understanding");
  }
  if (caps.imageGeneration === "supported") classes.push("image_generation");
  if (caps.speechToText === "supported") classes.push("speech_to_text");
  if (caps.textToSpeech === "supported") classes.push("text_to_speech");
  if (caps.embeddings === "supported") classes.push("embeddings");
  if (caps.reranking === "supported") classes.push("reranking");
  if (caps.multimodal === "supported") classes.push("multimodal");
  if (!classes.length) classes.push("unknown");
  return classes;
}

export function modalitiesFromCapabilities(caps: ModelCapabilities): Modality[] {
  const m: Modality[] = [];
  if (caps.chat === "supported" || caps.completion === "supported") m.push("text");
  if (caps.vision === "supported" || caps.imageUnderstanding === "supported" || caps.imageGeneration === "supported") {
    m.push("image");
  }
  if (caps.speechToText === "supported" || caps.textToSpeech === "supported") m.push("audio");
  if (caps.embeddings === "supported") m.push("embedding");
  if (!m.length) m.push("text");
  return m;
}

/** Static context window hints for well-known models (conservative). */
const CONTEXT_HINTS: Array<{ match: RegExp; window: number }> = [
  { match: /gpt-4o|gpt-4\.1|o1|claude-3|claude-3-5|claude-3-7|gemini-1\.5|gemini-2/i, window: 128_000 },
  { match: /sonnet|opus|gpt-4-turbo/i, window: 128_000 },
  { match: /haiku|gpt-4o-mini|flash/i, window: 128_000 },
  { match: /llama-3\.3|llama-3\.1|qwen2\.5:32b|qwen2\.5:14b/i, window: 32_000 },
  { match: /qwen2\.5:7b|llama3\.1:8b|mistral:7b/i, window: 16_000 },
  { match: /embed/i, window: 8_192 },
];

export function contextHintFor(modelId: string): { contextWindow?: number } {
  for (const h of CONTEXT_HINTS) {
    if (h.match.test(modelId)) return { contextWindow: h.window };
  }
  return {};
}

export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

export function capabilityRequired(
  caps: ModelCapabilities,
  field: keyof ModelCapabilities,
  opts: { allowUnknown?: boolean } = {},
): { ok: boolean; support: CapabilitySupport } {
  const raw = caps[field];
  // `extensions` holds a record, not a tri-state — unknown by definition here.
  const support: CapabilitySupport =
    raw === "supported" || raw === "unsupported" || raw === "unknown" ? raw : "unknown";
  if (support === "supported") return { ok: true, support };
  if (support === "unknown" && opts.allowUnknown) return { ok: true, support };
  return { ok: false, support };
}

/** Build a ProviderDescriptor from a preset + credential availability. */
export function descriptorFromPreset(
  preset: ProviderPreset,
  credentialAvailable: boolean,
): ProviderDescriptor {
  const caps = fromLegacyCapabilities(preset.capabilities);
  const locality = localityForKind(preset.kind, preset.id);
  // Custom baseUrl localhost → treat as local-ish private
  if (preset.kind === "custom" && preset.baseUrl) {
    try {
      const u = new URL(preset.baseUrl);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname.endsWith(".local")) {
        locality.locality = "local";
        locality.leavesMachine = false;
      } else {
        locality.locality = "private";
      }
    } catch {
      /* keep default */
    }
  }
  return {
    providerId: preset.id,
    label: preset.label,
    kind: preset.kind,
    tier: preset.tier,
    locality,
    defaultModelId: preset.defaultModel,
    auth: {
      type: preset.authType ?? (preset.apiKeyEnv ? "bearer" : "none"),
      apiKeyEnv: preset.apiKeyEnv,
      credentialAvailable: preset.apiKeyEnv ? credentialAvailable : true,
    },
    baseUrl: preset.baseUrl,
    docsUrl: preset.docsUrl,
    description: preset.description,
    capabilities: caps,
  };
}

/** Expand a provider preset into model descriptors (default + knownModels). */
export function modelsFromPreset(
  preset: ProviderPreset,
  credentialAvailable: boolean,
): ModelDescriptor[] {
  const provider = descriptorFromPreset(preset, credentialAvailable);
  const ids = new Set<string>([preset.defaultModel, ...(preset.knownModels ?? [])]);
  const models: ModelDescriptor[] = [];
  for (const modelId of ids) {
    if (!modelId) continue;
    const caps = { ...provider.capabilities };
    // Per-model refinements for known families
    refineModelCapabilities(modelId, caps);
    const classes = classesFromCapabilities(caps);
    const modalities = modalitiesFromCapabilities(caps);
    models.push({
      key: modelKey(preset.id, modelId),
      providerId: preset.id,
      modelId,
      label: `${preset.label} / ${modelId}`,
      classes,
      modalities,
      capabilities: caps,
      context: contextHintFor(modelId),
      cost: costProfileFor(preset.tier, preset.kind),
      latency: {
        class: preset.kind === "local" ? "standard" : preset.tier === "free" ? "fast" : "standard",
      },
      quality: qualityFor(preset.tier, caps),
      locality: { ...provider.locality },
      limitations: buildLimitations(caps, provider),
      isDefault: modelId === preset.defaultModel,
      tags: [preset.kind, preset.tier],
    });
  }
  return models;
}

function refineModelCapabilities(modelId: string, caps: ModelCapabilities): void {
  if (/o1|o3|reason|r1|deepseek-reasoner/i.test(modelId)) {
    caps.reasoning = "supported";
  }
  if (/embed|e5-|bge-|nomic-embed/i.test(modelId)) {
    caps.embeddings = "supported";
    caps.chat = "unsupported";
    caps.toolUse = "unsupported";
  }
  if (/vision|gpt-4o|claude-3|gemini|grok-2-vision/i.test(modelId)) {
    if (caps.vision === "unknown") caps.vision = "supported";
    if (caps.imageUnderstanding === "unknown") caps.imageUnderstanding = "supported";
  }
  if (/code|codestral|codellama|deepseek-coder/i.test(modelId)) {
    caps.code = "supported";
  }
  if (/whisper|tts|speech/i.test(modelId)) {
    // Not chat models — leave speech flags; chat unknown/unsupported
    if (/whisper|stt/i.test(modelId)) caps.speechToText = "supported";
    if (/tts|tts-/i.test(modelId)) caps.textToSpeech = "supported";
  }
}

function buildLimitations(caps: ModelCapabilities, provider: ProviderDescriptor): string[] {
  const lim: string[] = [];
  if (caps.toolUse === "unknown") lim.push("tool-use support not verified");
  if (caps.vision === "unknown") lim.push("vision support not verified");
  if (provider.locality.leavesMachine) lim.push("data leaves local machine");
  if (provider.kind === "local") lim.push("quality depends on installed weights");
  return lim;
}

/** Labels for UX. */
export function capabilitySummary(caps: ModelCapabilities): string[] {
  const labels: string[] = [];
  const add = (k: keyof ModelCapabilities, label: string) => {
    if (caps[k] === "supported") labels.push(label);
  };
  add("chat", "chat");
  add("reasoning", "reasoning");
  add("toolUse", "tool-use");
  add("jsonMode", "json");
  add("vision", "vision");
  add("embeddings", "embeddings");
  add("streaming", "streaming");
  add("functionCalling", "functions");
  add("speechToText", "stt");
  add("textToSpeech", "tts");
  add("imageGeneration", "image-gen");
  add("reranking", "rerank");
  return labels;
}
