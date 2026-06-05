/**
 * XR v0.5 — local model registry.
 *
 * This file only lists Ollama models XR can actually use through the existing
 * OpenAI-compatible Ollama provider. Adding a model here is a product promise:
 * it must be pullable by `ollama pull <id>` and chat-capable.
 */

export type LocalRuntime = "ollama";

export interface LocalModelSpec {
  id: string;
  runtime: LocalRuntime;
  label: string;
  family: string;
  paramsB: number;
  minRamGb: number;
  recommendedRamGb: number;
  estimatedDiskGb: number;
  cpuOnly: boolean;
  strengths: string[];
  notes: string;
}

export const LOCAL_MODEL_REGISTRY: LocalModelSpec[] = [
  {
    id: "qwen2.5:3b",
    runtime: "ollama",
    label: "Qwen 2.5 3B Instruct",
    family: "qwen2.5",
    paramsB: 3,
    minRamGb: 4,
    recommendedRamGb: 6,
    estimatedDiskGb: 2.5,
    cpuOnly: true,
    strengths: ["low RAM", "fast CPU fallback", "basic agent tasks"],
    notes: "Best minimum viable local model for 4–8GB machines.",
  },
  {
    id: "phi3:mini",
    runtime: "ollama",
    label: "Phi-3 Mini Instruct",
    family: "phi3",
    paramsB: 3.8,
    minRamGb: 4,
    recommendedRamGb: 8,
    estimatedDiskGb: 2.4,
    cpuOnly: true,
    strengths: ["very small", "general chat", "CPU-friendly"],
    notes: "Alternative small model when Qwen is not desired.",
  },
  {
    id: "qwen2.5:7b",
    runtime: "ollama",
    label: "Qwen 2.5 7B Instruct",
    family: "qwen2.5",
    paramsB: 7,
    minRamGb: 8,
    recommendedRamGb: 12,
    estimatedDiskGb: 5,
    cpuOnly: true,
    strengths: ["balanced", "agent tool use", "coding basics"],
    notes: "Default recommendation for most 8–16GB developer laptops.",
  },
  {
    id: "llama3.1:8b",
    runtime: "ollama",
    label: "Llama 3.1 8B Instruct",
    family: "llama3.1",
    paramsB: 8,
    minRamGb: 8,
    recommendedRamGb: 16,
    estimatedDiskGb: 5,
    cpuOnly: true,
    strengths: ["general reasoning", "broad ecosystem", "agent tasks"],
    notes: "Strong general fallback with broad Ollama support.",
  },
  {
    id: "qwen2.5:14b",
    runtime: "ollama",
    label: "Qwen 2.5 14B Instruct",
    family: "qwen2.5",
    paramsB: 14,
    minRamGb: 16,
    recommendedRamGb: 24,
    estimatedDiskGb: 9,
    cpuOnly: false,
    strengths: ["better reasoning", "coding", "hybrid fallback"],
    notes: "Recommended for 16–32GB machines, especially with a GPU.",
  },
  {
    id: "qwen2.5:32b",
    runtime: "ollama",
    label: "Qwen 2.5 32B Instruct",
    family: "qwen2.5",
    paramsB: 32,
    minRamGb: 32,
    recommendedRamGb: 48,
    estimatedDiskGb: 20,
    cpuOnly: false,
    strengths: ["strong local reasoning", "coding", "cloud fallback replacement"],
    notes: "Best local recommendation for high-memory workstations.",
  },
];

export function findLocalModel(id: string): LocalModelSpec | undefined {
  return LOCAL_MODEL_REGISTRY.find((m) => m.id === id);
}

export function isKnownLocalModel(id: string): boolean {
  return Boolean(findLocalModel(id));
}

export function validateOllamaModelId(id: string): boolean {
  // Allow Ollama-style names such as qwen2.5:7b, llama3.1:8b-instruct-q4_K_M,
  // hf.co/user/model:tag. Reject whitespace, shell metacharacters, paths, URLs.
  return /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,120}(:[a-zA-Z0-9._-]{1,80})?$/.test(id)
    && !id.includes("..")
    && !id.includes("//")
    && !id.startsWith("/")
    && !id.startsWith("-");
}
