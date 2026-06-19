/** XR Stage 4 — local runtime and model registry.
 *
 * This registry is intentionally broader than Ollama, but conservative: XR only
 * marks a runtime as usable when it can detect a running local endpoint or a
 * supported CLI. Runtime/model download support is explicit per runtime.
 */

export type LocalRuntimeId =
  | "ollama"
  | "lmstudio"
  | "llamacpp"
  | "jan"
  | "localai"
  | "vllm"
  | "gpt4all"
  | "koboldcpp"
  | "textgenwebui"
  | "sglang"
  | "custom-openai";

export type LocalRoutingMode = "local-only" | "hybrid" | "cloud-first";
export type LocalUseCase = "general" | "coding" | "reasoning" | "summarization" | "research" | "embeddings" | "voice";
export type ModelFamily = "general" | "coding" | "reasoning" | "small" | "medium" | "large" | "embedding" | "multimodal";

export interface LocalRuntimeDefinition {
  id: LocalRuntimeId;
  providerId: string;
  label: string;
  defaultBaseUrl: string;
  openAICompatible: boolean;
  ollamaCompatible?: boolean;
  modelManagement: "automatic" | "runtime-ui" | "external" | "custom";
  installSupport: "automatic" | "guided" | "manual";
  cliCommands: string[];
  commonPorts: number[];
  docsUrl: string;
  nonTechnicalFit: "excellent" | "good" | "power-user";
  notes: string;
}

export interface LocalModelSpec {
  id: string;
  label: string;
  family: ModelFamily[];
  useCases: LocalUseCase[];
  runtimeIds: LocalRuntimeId[];
  ollamaId?: string;
  huggingFaceSearch?: string;
  paramsB: number;
  minRamGb: number;
  recommendedRamGb: number;
  minVramGb?: number;
  estimatedDiskGb: number;
  cpuUsable: boolean;
  quantization?: string;
  strengths: string[];
  notes: string;
}

export interface RegisteredLocalModel {
  id: string;
  runtime: LocalRuntimeId;
  providerId: string;
  model: string;
  family: ModelFamily[];
  source: string;
  sizeGb?: number;
  quantization?: string;
  downloaded: boolean;
  configured: boolean;
  healthy: boolean;
  baseUrl?: string;
  installedAt?: string;
  lastCheckedAt?: string;
  detail?: string;
}

export const LOCAL_RUNTIMES: LocalRuntimeDefinition[] = [
  {
    id: "ollama",
    providerId: "ollama",
    label: "Ollama",
    defaultBaseUrl: "http://localhost:11434",
    openAICompatible: true,
    ollamaCompatible: true,
    modelManagement: "automatic",
    installSupport: "automatic",
    cliCommands: ["ollama"],
    commonPorts: [11434],
    docsUrl: "https://github.com/ollama/ollama",
    nonTechnicalFit: "excellent",
    notes: "Best default for one-command local setup. XR can install the runtime on macOS/Linux and pull models with explicit approval.",
  },
  {
    id: "lmstudio",
    providerId: "lmstudio",
    label: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    openAICompatible: true,
    modelManagement: "runtime-ui",
    installSupport: "guided",
    cliCommands: ["lms"],
    commonPorts: [1234],
    docsUrl: "https://lmstudio.ai",
    nonTechnicalFit: "excellent",
    notes: "GUI-first local AI. XR can detect and route to its local server; model download is done in LM Studio UI/CLI.",
  },
  {
    id: "llamacpp",
    providerId: "llamacpp",
    label: "llama.cpp server",
    defaultBaseUrl: "http://localhost:8080/v1",
    openAICompatible: true,
    modelManagement: "external",
    installSupport: "manual",
    cliCommands: ["llama-server", "server"],
    commonPorts: [8080, 8081],
    docsUrl: "https://github.com/ggml-org/llama.cpp",
    nonTechnicalFit: "power-user",
    notes: "Portable and fast, but model files and server flags are power-user concerns. XR detects and routes when server is running.",
  },
  {
    id: "jan",
    providerId: "jan",
    label: "Jan",
    defaultBaseUrl: "http://localhost:1337/v1",
    openAICompatible: true,
    modelManagement: "runtime-ui",
    installSupport: "guided",
    cliCommands: ["jan"],
    commonPorts: [1337],
    docsUrl: "https://jan.ai",
    nonTechnicalFit: "good",
    notes: "Desktop local AI app. XR detects/routs to the OpenAI-compatible local server when enabled.",
  },
  {
    id: "localai",
    providerId: "localai",
    label: "LocalAI",
    defaultBaseUrl: "http://localhost:8080/v1",
    openAICompatible: true,
    modelManagement: "external",
    installSupport: "manual",
    cliCommands: ["local-ai", "localai"],
    commonPorts: [8080],
    docsUrl: "https://github.com/mudler/LocalAI",
    nonTechnicalFit: "power-user",
    notes: "OpenAI-compatible self-hosted runtime. XR detects/routs but does not silently create Docker services.",
  },
  {
    id: "vllm",
    providerId: "vllm",
    label: "vLLM OpenAI server",
    defaultBaseUrl: "http://localhost:8000/v1",
    openAICompatible: true,
    modelManagement: "external",
    installSupport: "manual",
    cliCommands: ["vllm"],
    commonPorts: [8000],
    docsUrl: "https://github.com/vllm-project/vllm",
    nonTechnicalFit: "power-user",
    notes: "High-throughput GPU server. XR detects/routs when the OpenAI-compatible server is already running.",
  },
  {
    id: "gpt4all",
    providerId: "gpt4all",
    label: "GPT4All local server",
    defaultBaseUrl: "http://localhost:4891/v1",
    openAICompatible: true,
    modelManagement: "runtime-ui",
    installSupport: "guided",
    cliCommands: ["gpt4all"],
    commonPorts: [4891],
    docsUrl: "https://github.com/nomic-ai/gpt4all",
    nonTechnicalFit: "good",
    notes: "Desktop local AI with server mode. XR detects/routs when the API server is enabled.",
  },
  {
    id: "koboldcpp",
    providerId: "koboldcpp",
    label: "KoboldCPP",
    defaultBaseUrl: "http://localhost:5001/v1",
    openAICompatible: true,
    modelManagement: "external",
    installSupport: "manual",
    cliCommands: ["koboldcpp"],
    commonPorts: [5001, 5000],
    docsUrl: "https://github.com/LostRuins/koboldcpp",
    nonTechnicalFit: "good",
    notes: "GGUF runtime with web UI and OpenAI-compatible routes on recent builds. XR detects/routs when enabled.",
  },
  {
    id: "textgenwebui",
    providerId: "textgenwebui",
    label: "Text Generation WebUI",
    defaultBaseUrl: "http://localhost:5000/v1",
    openAICompatible: true,
    modelManagement: "runtime-ui",
    installSupport: "manual",
    cliCommands: [],
    commonPorts: [5000, 5001, 7860],
    docsUrl: "https://github.com/oobabooga/text-generation-webui",
    nonTechnicalFit: "power-user",
    notes: "Power-user web UI. XR detects/routs to its OpenAI-compatible API when launched with API support.",
  },
  {
    id: "sglang",
    providerId: "sglang",
    label: "SGLang server",
    defaultBaseUrl: "http://localhost:30000/v1",
    openAICompatible: true,
    modelManagement: "external",
    installSupport: "manual",
    cliCommands: ["python", "python3"],
    commonPorts: [30000],
    docsUrl: "https://github.com/sgl-project/sglang",
    nonTechnicalFit: "power-user",
    notes: "High-performance serving stack. XR detects/routs when the OpenAI-compatible server is running.",
  },
  {
    id: "custom-openai",
    providerId: "custom-local",
    label: "Custom OpenAI-compatible local endpoint",
    defaultBaseUrl: "http://localhost:8000/v1",
    openAICompatible: true,
    modelManagement: "custom",
    installSupport: "manual",
    cliCommands: [],
    commonPorts: [],
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    nonTechnicalFit: "power-user",
    notes: "For power users who already run a local OpenAI-compatible endpoint.",
  },
];

export const LOCAL_MODEL_REGISTRY: LocalModelSpec[] = [
  {
    id: "qwen2.5-3b-instruct",
    label: "Qwen 2.5 3B Instruct",
    family: ["small", "general"],
    useCases: ["general", "summarization"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "gpt4all", "koboldcpp", "textgenwebui"],
    ollamaId: "qwen2.5:3b",
    huggingFaceSearch: "Qwen2.5-3B-Instruct GGUF",
    paramsB: 3,
    minRamGb: 4,
    recommendedRamGb: 6,
    minVramGb: 0,
    estimatedDiskGb: 2.5,
    cpuUsable: true,
    quantization: "Q4_K_M",
    strengths: ["low RAM", "fast CPU fallback", "basic chat"],
    notes: "Best minimum viable local model for 4–8GB machines.",
  },
  {
    id: "phi3-mini-instruct",
    label: "Phi-3 Mini Instruct",
    family: ["small", "general"],
    useCases: ["general", "summarization"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "gpt4all", "koboldcpp"],
    ollamaId: "phi3:mini",
    huggingFaceSearch: "Phi-3-mini-4k-instruct GGUF",
    paramsB: 3.8,
    minRamGb: 4,
    recommendedRamGb: 8,
    minVramGb: 0,
    estimatedDiskGb: 2.4,
    cpuUsable: true,
    quantization: "Q4_K_M",
    strengths: ["very small", "general chat", "CPU-friendly"],
    notes: "Reliable alternative for very small machines.",
  },
  {
    id: "qwen2.5-7b-instruct",
    label: "Qwen 2.5 7B Instruct",
    family: ["medium", "general", "coding"],
    useCases: ["general", "coding", "summarization", "research"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "localai", "gpt4all", "koboldcpp", "textgenwebui"],
    ollamaId: "qwen2.5:7b",
    huggingFaceSearch: "Qwen2.5-7B-Instruct GGUF",
    paramsB: 7,
    minRamGb: 8,
    recommendedRamGb: 12,
    minVramGb: 0,
    estimatedDiskGb: 5,
    cpuUsable: true,
    quantization: "Q4_K_M",
    strengths: ["balanced", "agent tool use", "coding basics"],
    notes: "Default recommendation for most 8–16GB laptops.",
  },
  {
    id: "llama3.1-8b-instruct",
    label: "Llama 3.1 8B Instruct",
    family: ["medium", "general", "reasoning"],
    useCases: ["general", "reasoning", "research", "summarization"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"],
    ollamaId: "llama3.1:8b",
    huggingFaceSearch: "Meta-Llama-3.1-8B-Instruct GGUF",
    paramsB: 8,
    minRamGb: 8,
    recommendedRamGb: 16,
    minVramGb: 0,
    estimatedDiskGb: 5,
    cpuUsable: true,
    quantization: "Q4_K_M",
    strengths: ["general reasoning", "broad ecosystem", "agent tasks"],
    notes: "Strong general-purpose local model with broad runtime support.",
  },
  {
    id: "qwen2.5-coder-7b-instruct",
    label: "Qwen 2.5 Coder 7B Instruct",
    family: ["medium", "coding"],
    useCases: ["coding", "general"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "localai", "gpt4all", "koboldcpp", "textgenwebui"],
    ollamaId: "qwen2.5-coder:7b",
    huggingFaceSearch: "Qwen2.5-Coder-7B-Instruct GGUF",
    paramsB: 7,
    minRamGb: 8,
    recommendedRamGb: 12,
    minVramGb: 0,
    estimatedDiskGb: 5,
    cpuUsable: true,
    quantization: "Q4_K_M",
    strengths: ["coding", "patches", "CLI tasks"],
    notes: "Best default when the user says XR will be used mostly for software development.",
  },
  {
    id: "qwen2.5-14b-instruct",
    label: "Qwen 2.5 14B Instruct",
    family: ["medium", "general", "reasoning", "coding"],
    useCases: ["general", "reasoning", "coding", "research"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "localai", "koboldcpp", "textgenwebui"],
    ollamaId: "qwen2.5:14b",
    huggingFaceSearch: "Qwen2.5-14B-Instruct GGUF",
    paramsB: 14,
    minRamGb: 16,
    recommendedRamGb: 24,
    minVramGb: 8,
    estimatedDiskGb: 9,
    cpuUsable: false,
    quantization: "Q4_K_M",
    strengths: ["better reasoning", "coding", "analysis"],
    notes: "Good for 16–32GB systems, especially with GPU acceleration.",
  },
  {
    id: "deepseek-r1-14b",
    label: "DeepSeek R1 Distill 14B",
    family: ["medium", "reasoning"],
    useCases: ["reasoning", "research", "coding"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "jan", "localai", "koboldcpp", "textgenwebui"],
    ollamaId: "deepseek-r1:14b",
    huggingFaceSearch: "DeepSeek-R1-Distill-Qwen-14B GGUF",
    paramsB: 14,
    minRamGb: 16,
    recommendedRamGb: 24,
    minVramGb: 8,
    estimatedDiskGb: 9,
    cpuUsable: false,
    quantization: "Q4_K_M",
    strengths: ["step-by-step reasoning", "analysis"],
    notes: "Reasoning-oriented choice for capable local machines.",
  },
  {
    id: "qwen2.5-32b-instruct",
    label: "Qwen 2.5 32B Instruct",
    family: ["large", "general", "reasoning", "coding"],
    useCases: ["general", "reasoning", "coding", "research"],
    runtimeIds: ["ollama", "lmstudio", "llamacpp", "localai", "vllm", "textgenwebui", "sglang"],
    ollamaId: "qwen2.5:32b",
    huggingFaceSearch: "Qwen2.5-32B-Instruct GGUF",
    paramsB: 32,
    minRamGb: 32,
    recommendedRamGb: 48,
    minVramGb: 16,
    estimatedDiskGb: 20,
    cpuUsable: false,
    quantization: "Q4_K_M",
    strengths: ["strong local reasoning", "coding", "cloud replacement"],
    notes: "High-end local recommendation for large-memory workstations.",
  },
  {
    id: "nomic-embed-text",
    label: "Nomic Embed Text",
    family: ["embedding", "small"],
    useCases: ["embeddings", "research"],
    runtimeIds: ["ollama", "localai", "llamacpp"],
    ollamaId: "nomic-embed-text",
    huggingFaceSearch: "nomic-embed-text GGUF",
    paramsB: 0.1,
    minRamGb: 4,
    recommendedRamGb: 6,
    estimatedDiskGb: 1,
    cpuUsable: true,
    strengths: ["embeddings", "local RAG", "private memory search"],
    notes: "Optional embedding model. XR keeps lexical fallback if it is unavailable.",
  },
];

export function getRuntimeDefinition(id: string): LocalRuntimeDefinition | undefined {
  return LOCAL_RUNTIMES.find((r) => r.id === id);
}

export function isLocalRuntimeId(id: string): id is LocalRuntimeId {
  return Boolean(getRuntimeDefinition(id));
}

export function findLocalModel(id: string): LocalModelSpec | undefined {
  return LOCAL_MODEL_REGISTRY.find((m) => m.id === id || m.ollamaId === id);
}

export function isKnownLocalModel(id: string): boolean {
  return Boolean(findLocalModel(id));
}

export function modelNameForRuntime(model: LocalModelSpec, runtime: LocalRuntimeId): string {
  if (runtime === "ollama" && model.ollamaId) return model.ollamaId;
  if (runtime === "vllm" || runtime === "sglang") return model.huggingFaceSearch?.replace(/ GGUF$/i, "") ?? model.id;
  return model.ollamaId ?? model.id;
}

export function providerIdForRuntime(runtime: LocalRuntimeId): string {
  return getRuntimeDefinition(runtime)?.providerId ?? runtime;
}

export function validateLocalModelId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._/@:+-]{0,180}$/.test(id)
    && !id.includes("..")
    && !id.includes("//")
    && !id.startsWith("/")
    && !id.startsWith("-")
    && !/[\s;&|`$<>\\]/.test(id);
}

export const validateOllamaModelId = validateLocalModelId;
