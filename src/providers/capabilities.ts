/**
 * XR — Provider Capability Schema
 * Defines what each provider can do, used for routing and UI.
 *
 * XR 4.4: retains boolean ProviderCapabilities for backward compatibility.
 * The intelligence plane uses tri-state CapabilitySupport via
 * src/intelligence/capability.ts (unknown ≠ unsupported ≠ supported).
 */

export interface ProviderCapabilities {
  chat: boolean;
  reasoning?: boolean;
  vision?: boolean;
  embeddings?: boolean;
  toolUse?: boolean;
  jsonMode?: boolean;
  functionCalling?: boolean;
  streaming?: boolean;
  /** XR 4.4 optional extensions (legacy boolean; prefer intelligence descriptors). */
  reranking?: boolean;
  speechToText?: boolean;
  textToSpeech?: boolean;
  imageGeneration?: boolean;
  /** Optional context window hint (tokens). */
  contextWindow?: number;
}

export function defaultCapabilities(): ProviderCapabilities {
  return { chat: true };
}

export function supportsTask(
  caps: ProviderCapabilities,
  task:
    | "chat"
    | "reasoning"
    | "vision"
    | "embeddings"
    | "toolUse"
    | "jsonMode"
    | "functionCalling"
    | "streaming"
    | "reranking"
    | "speechToText"
    | "textToSpeech"
    | "imageGeneration",
): boolean {
  return Boolean((caps as unknown as Record<string, unknown>)[task]);
}

export function capabilityLabels(caps: ProviderCapabilities): string[] {
  const labels: string[] = [];
  if (caps.chat) labels.push("chat");
  if (caps.reasoning) labels.push("reasoning");
  if (caps.vision) labels.push("vision");
  if (caps.embeddings) labels.push("embeddings");
  if (caps.toolUse) labels.push("tool-use");
  if (caps.jsonMode) labels.push("json-mode");
  if (caps.functionCalling) labels.push("functions");
  if (caps.streaming) labels.push("streaming");
  if (caps.reranking) labels.push("rerank");
  if (caps.speechToText) labels.push("stt");
  if (caps.textToSpeech) labels.push("tts");
  if (caps.imageGeneration) labels.push("image-gen");
  return labels;
}

/**
 * XR 4.4 — map a boolean capability bag to a safe list of *known-supported*
 * labels only. Absent/undefined fields are treated as unknown (omitted), not as false labels.
 */
export function knownSupportedLabels(caps: ProviderCapabilities): string[] {
  return capabilityLabels(caps);
}
