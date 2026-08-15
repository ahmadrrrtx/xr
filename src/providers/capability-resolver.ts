/**
 * XR Phase 04 — Provider Capability Model
 *
 * Providers differ. Gateway must represent this explicitly.
 * Never lie about provider capabilities, return typed unsupported-capability error.
 */

import type { ProviderPreset } from "./presets.ts";
import type { ProviderCapabilities } from "./capabilities.ts";
import { supportsTask } from "./capabilities.ts";

export type ProviderCapability =
  | "streaming"
  | "toolCalling"
  | "vision"
  | "structuredOutput"
  | "embeddings"
  | "reasoning"
  | "audio"
  | "imageGeneration"
  | "localExecution"
  | "functionCalling"
  | "jsonMode"
  | "chat"
  | "speechToText"
  | "textToSpeech"
  | "reranking";

export interface NormalizedCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  functionCalling: boolean;
  vision: boolean;
  structuredOutput: boolean;
  embeddings: boolean;
  reasoning: boolean;
  audio: boolean;
  imageGeneration: boolean;
  localExecution: boolean;
  jsonMode: boolean;
  chat: boolean;
  speechToText: boolean;
  textToSpeech: boolean;
  reranking: boolean;
  // Optional hints
  contextWindow?: number;
}

export function normalizeCapabilities(preset: ProviderPreset): NormalizedCapabilities {
  const c = preset.capabilities;
  return {
    streaming: Boolean(c.streaming ?? c.chat),
    toolCalling: Boolean(c.toolUse ?? c.functionCalling),
    functionCalling: Boolean(c.functionCalling ?? c.toolUse),
    vision: Boolean(c.vision),
    structuredOutput: Boolean(c.jsonMode),
    embeddings: Boolean(c.embeddings),
    reasoning: Boolean(c.reasoning),
    audio: false,
    imageGeneration: Boolean(c.imageGeneration),
    localExecution: preset.kind === "local",
    jsonMode: Boolean(c.jsonMode),
    chat: Boolean(c.chat),
    speechToText: Boolean(c.speechToText),
    textToSpeech: Boolean(c.textToSpeech),
    reranking: Boolean(c.reranking),
    contextWindow: c.contextWindow,
  };
}

export function hasCapability(preset: ProviderPreset, cap: ProviderCapability): boolean {
  const normalized = normalizeCapabilities(preset);
  return Boolean((normalized as any)[cap]);
}

export function capabilityFromTask(
  preset: ProviderPreset,
  task: "chat" | "reasoning" | "vision" | "embeddings" | "toolUse" | "jsonMode" | "functionCalling" | "streaming" | "reranking" | "speechToText" | "textToSpeech" | "imageGeneration",
): boolean {
  return supportsTask(preset.capabilities, task);
}

/**
 * CapabilityResolver — resolves modelClass/toolUse etc based on preset capabilities
 * + measured contracts behavioralView fidelity etc, not just static.
 * For Phase04, we keep it simple but explicit and extensible.
 */
export class CapabilityResolver {
  /**
   * Check if a provider preset supports a given capability.
   * Returns true/false based on static preset + optional dynamic overrides.
   */
  supports(preset: ProviderPreset, capability: ProviderCapability): boolean {
    return hasCapability(preset, capability);
  }

  /**
   * Resolve required capabilities for a task into a list of providers that support them.
   */
  filterByCapabilities(presets: ProviderPreset[], required: ProviderCapability[]): ProviderPreset[] {
    return presets.filter((p) => required.every((cap) => this.supports(p, cap)));
  }

  /**
   * Get a normalized capability map for UI/display.
   */
  getCapabilities(preset: ProviderPreset): NormalizedCapabilities {
    return normalizeCapabilities(preset);
  }

  /**
   * Check if a provider supports a given ModelClass (from intelligence plane).
   */
  supportsModelClass(preset: ProviderPreset, modelClass: string): boolean {
    const mapping: Record<string, ProviderCapability[]> = {
      chat: ["chat"],
      tool_use: ["toolCalling"],
      structured_output: ["structuredOutput", "jsonMode"],
      vision: ["vision"],
      embeddings: ["embeddings"],
      reasoning: ["reasoning"],
      image_generation: ["imageGeneration"],
      speech_to_text: ["speechToText"],
      text_to_speech: ["textToSpeech"],
      reranking: ["reranking"],
    };
    const caps = mapping[modelClass] ?? ["chat"];
    // At least one of the mapped caps must be supported
    return caps.some((c) => this.supports(preset, c));
  }
}

export const capabilityResolver = new CapabilityResolver();
