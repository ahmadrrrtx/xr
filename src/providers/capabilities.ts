/**
 * XR — Provider Capability Schema
 * Defines what each provider can do, used for routing and UI.
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
}

export function defaultCapabilities(): ProviderCapabilities {
  return { chat: true };
}

export function supportsTask(
  caps: ProviderCapabilities,
  task: "chat" | "reasoning" | "vision" | "embeddings" | "toolUse" | "jsonMode" | "functionCalling" | "streaming",
): boolean {
  return Boolean((caps as any)[task]);
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
  return labels;
}
