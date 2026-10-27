/** Versioned, offline model facts. Official documentation ≠ live account or agent validation.
 * Updating this data never changes a saved configuration or downloads weights.
 */
import data from "./model-facts.json";
export const MODEL_REGISTRY_VERSION = data.version;
export const MODEL_FACTS_VERIFIED_AT = data.verifiedAt;
export type ModelTransport =
  | "responses"
  | "chat-completions"
  | "anthropic-messages"
  | "gemini-generate-content";
export interface ModelFact {
  providerId: string;
  modelId: string;
  lifecycle: "active" | "deprecated" | "legacy";
  source: string;
  transport: ModelTransport;
  contextWindow?: number;
  maxOutputTokens?: number;
  tools: boolean;
  reasoning?: boolean;
  /** Standard text-token base rate only; not a provider invoice ceiling. */
  price?: {
    input: number;
    output: number;
    source: string;
    until?: string;
    then?: { input: number; output: number };
  };
  notes: string[];
}
export const MODEL_FACTS: readonly ModelFact[] = data.models as ModelFact[];
export function modelFact(
  providerId: string,
  modelId: string,
): ModelFact | undefined {
  return MODEL_FACTS.find(
    (m) => m.providerId === providerId && m.modelId === modelId,
  );
}
export function modelFactsFresh(now = Date.now()): boolean {
  return now <= Date.parse(data.staleAt);
}
