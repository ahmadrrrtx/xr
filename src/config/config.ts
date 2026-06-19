/**
 * XR — config loader.
 * Schema-validated, versioned, self-healing: never crashes on bad config.
 * (TRD §3.4 / "Never Breaks" doctrine rule #6.)
 *
 * Now with FULL provider support: Ollama, Groq, Google Gemini, DeepSeek,
 * Together, OpenRouter, Cerebras, Mistral, OpenAI, Anthropic Claude,
 * Cohere, xAI, Perplexity, Fireworks, SambaNova, Hugging Face, LM Studio,
 * Jan, LocalAI, vLLM, AWS Bedrock, and custom OpenAI-compatible endpoints.
 */
import { z } from "zod";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { getSecret } from "../security/secrets.ts";
import { PRESETS } from "../providers/presets.ts";

export const CONFIG_VERSION = 10; // Stage 4 Local AI runtime manager

const ConfigSchema = z.object({
  version: z.number().default(CONFIG_VERSION),
  defaults: z
    .object({
      mode: z.enum(["agent", "plan", "ask"]).default("agent"),
      provider: z.string().regex(/^[a-z0-9_-]+$/i).default("ollama"),
      model: z.string().min(1).max(200).default("qwen2.5:7b"),
      fallbackProvider: z.string().regex(/^[a-z0-9_-]+$/i).optional(),
      fallbackModel: z.string().min(1).max(200).optional(),
    })
    .default({}),
  budget: z
    .object({
      perTaskUsd: z.number().default(0.25),
      perTaskTokens: z.number().default(250_000),
    })
    .default({}),
  security: z
    .object({
      // Sensible defaults so web tools work out-of-the-box without leaving a hole.
      // Users can tighten this to their own allow-list in config.json.
      egressAllowlist: z.array(z.string()).default(["searx.be", "api.github.com", "registry.npmjs.org", "pypi.org", "crates.io"]),
      requireApproval: z
        .array(z.string())
        .default(["write_file", "delete", "shell", "send"]),
    })
    .default({}),
  providers: z
    .object({
      // OpenAI-compatible provider overrides
      ollama: z
        .object({ baseUrl: z.string().url().refine((v) => v.startsWith("http://") || v.startsWith("https://"), "must be http(s)").default("http://localhost:11434/v1") })
        .default({}),
      groq: z
        .object({ baseUrl: z.string().url().default("https://api.groq.com/openai/v1") })
        .default({}),
      together: z
        .object({ baseUrl: z.string().url().default("https://api.together.xyz/v1") })
        .default({}),
      openrouter: z
        .object({ baseUrl: z.string().url().default("https://openrouter.ai/api/v1") })
        .default({}),
      deepseek: z
        .object({ baseUrl: z.string().url().default("https://api.deepseek.com/v1") })
        .default({}),
      // Native providers don't need baseUrl (use their own API endpoints)
    })
    .passthrough()
    .default({}),
  // ── Stage 3: Universal Provider Engine ─────────────────────────────────────
  providerEngine: z
    .object({
      routingStrategy: z
        .enum([
          "primary",
          "localFirst",
          "cloudFirst",
          "hybrid",
          "cheapest",
          "fastest",
        ])
        .default("hybrid"),
      customProviders: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9_-]+$/i),
            label: z.string(),
            baseUrl: z.string().url(),
            apiKeyEnv: z.string().optional(),
            defaultModel: z.string(),
            headers: z.record(z.string()).optional(),
            capabilities: z
              .object({
                chat: z.boolean().default(true),
                reasoning: z.boolean().default(false),
                vision: z.boolean().default(false),
                embeddings: z.boolean().default(false),
                toolUse: z.boolean().default(false),
                jsonMode: z.boolean().default(false),
                functionCalling: z.boolean().default(false),
                streaming: z.boolean().default(false),
              })
              .default({}),
          }),
        )
        .default([]),
      providerCapabilities: z.record(z.any()).default({}),
    })
    .default({}),
  localModels: z
    .object({
      runtime: z.enum(["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang", "custom-openai"]).default("ollama"),
      provider: z.string().regex(/^[a-z0-9_-]+$/i).default("ollama"),
      enabled: z.boolean().default(false),
      selected: z.string().min(1).max(200).optional(),
      recommended: z.string().min(1).max(200).optional(),
      recommendationReason: z.string().max(1000).optional(),
      installedAt: z.string().datetime().optional(),
      routing: z.enum(["local-only", "hybrid", "cloud-first"]).default("hybrid"),
      useCase: z.enum(["general", "coding", "reasoning", "summarization", "research", "embeddings", "voice"]).default("general"),
      runtimes: z.record(z.object({
        providerId: z.string().optional(),
        baseUrl: z.string().url().optional(),
        installed: z.boolean().optional(),
        running: z.boolean().optional(),
        configured: z.boolean().optional(),
        healthy: z.boolean().optional(),
        lastCheckedAt: z.string().optional(),
        detail: z.string().optional(),
      })).default({}),
      installed: z.array(z.object({
        id: z.string(),
        runtime: z.string(),
        providerId: z.string(),
        model: z.string(),
        family: z.array(z.string()).default([]),
        source: z.string().default("unknown"),
        sizeGb: z.number().optional(),
        quantization: z.string().optional(),
        downloaded: z.boolean().default(false),
        configured: z.boolean().default(false),
        healthy: z.boolean().default(false),
        baseUrl: z.string().optional(),
        installedAt: z.string().optional(),
        lastCheckedAt: z.string().optional(),
        detail: z.string().optional(),
      })).default([]),
    })
    .default({}),
  // Block 8: MCP servers to consume tools from.
  mcpServers: z
    .array(
      z.object({
        id: z.string(),
        url: z.string(),
        apiKeyEnv: z.string().optional(),
      }),
    )
    .default([]),
  // Block 8: outbound webhooks for events.
  webhooks: z
    .object({
      url: z.string().optional(),
      events: z.array(z.string()).default(["task.done", "security", "budget.pause"]),
    })
    .default({}),
  // Auto-select free provider when available
  preferFreeProviders: z.boolean().default(true),
  // Voice interaction settings (opt-in; STT/TTS endpoints come from env).
  voice: z
    .object({
      /** Keep listening continuously (wake-word) vs push-to-talk. */
      alwaysListen: z.boolean().default(false),
    })
    .default({}),
  // v0.9 — durable memory system (long-term preferences, project context,
  // facts). Local-first and EXPLICIT by default: XR only stores what the user
  // asks it to. `autoSuggest` offers to remember things found in chat/voice,
  // but still requires user confirmation — never a silent auto-save.
  memory: z
    .object({
      enabled: z.boolean().default(true),
      /** Offer to remember "remember …" phrases in chat/voice (asks first). */
      autoSuggest: z.boolean().default(true),
      /** Inject relevant memory into chat/research prompts (conservative). */
      injectInChat: z.boolean().default(true),
      /** Max entries surfaced into any single prompt. */
      recallLimit: z.number().int().min(0).max(20).default(5),
      /**
       * Use embeddings-based semantic recall (Ollama nomic-embed-text) with an
       * automatic lexical fallback. Set false to force deterministic lexical
       * recall everywhere.
       */
      semanticRecall: z.boolean().default(true),
    })
    .default({}),
  // v0.8: Computer control (safe desktop automation).  Disabled by default —
  // the user must opt in via `xr control start` or by setting `enabled: true`.
  control: z
    .object({
      enabled: z.boolean().default(false),
      defaultMode: z.enum(["auto", "step", "dry-run"]).default("auto"),
      /** ms between actions in a plan; gives the user time to cancel. */
      stepDelayMs: z.number().int().min(0).max(10_000).default(250),
      // v0.8.2 — plan memory (cache successful plans to skip the LLM next time).
      memory: z
        .object({
          enabled: z.boolean().default(true),
          /** Maximum entries to keep (oldest pruned on overflow — informational). */
          maxEntries: z.number().int().min(1).max(10_000).default(500),
        })
        .default({}),
    })
    .default({}),
  // XR 1.0 — plugin ecosystem. Local-first and explicit by design. The plugin
  // SYSTEM is always available (so `xr plugins …` works), but whether enabled
  // plugins are LOADED into the agent's tool list is governed here.
  plugins: z
    .object({
      /** Load enabled plugins' tools into the agent. Set false to hard-disable. */
      enabled: z.boolean().default(true),
      /**
       * Require entrypoint hash to match the value recorded at install. When
       * true (default), a tampered/changed plugin is refused as "untrusted".
       */
      requireTrust: z.boolean().default(true),
      /**
       * Permissions XR will never grant to any plugin, regardless of manifest /
       * user approval (enterprise policy hook). Empty by default.
       */
      deniedPermissions: z.array(z.string()).default([]),
    })
    .default({}),
});

export type XRConfig = z.infer<typeof ConfigSchema>;

export const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
const CONFIG_PATH = join(XR_HOME, "config.json");

function ensureHome(): void {
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
}

/** Ordered migrations: key = from-version, transforms raw object. */
const MIGRATIONS: Record<number, (raw: any) => any> = {
  // 0 -> 1: example placeholder
  0: (raw) => ({ ...raw, version: 1 }),
  // 1 -> 2: add provider-specific settings, preferFreeProviders
  1: (raw) => ({
    ...raw,
    version: 2,
    preferFreeProviders: raw.preferFreeProviders ?? true,
  }),
  // 2 -> 3: add fallback settings
  2: (raw) => ({
    ...raw,
    version: 3,
    defaults: {
      ...raw.defaults,
      fallbackProvider: raw.defaults?.fallbackProvider ?? "ollama",
      fallbackModel: raw.defaults?.fallbackModel ?? "qwen2.5:7b",
    },
  }),
  // 3 -> 4: add local model intelligence config
  3: (raw) => ({
    ...raw,
    version: 4,
    localModels: raw.localModels ?? {
      runtime: "ollama",
      enabled: raw.defaults?.provider === "ollama" || raw.defaults?.fallbackProvider === "ollama",
      selected: raw.defaults?.provider === "ollama" ? raw.defaults?.model : raw.defaults?.fallbackModel,
      recommended: raw.defaults?.fallbackModel ?? "qwen2.5:7b",
      routing: raw.defaults?.provider === "ollama" ? "local-only" : "hybrid",
    },
  }),
  // 4 -> 5: add v0.8 computer control block (off by default — opt-in).
  4: (raw) => ({
    ...raw,
    version: 5,
    control: raw.control ?? { enabled: false, defaultMode: "auto", stepDelayMs: 250 },
  }),
  // 5 -> 6: add v0.8.2 control.memory block (on by default; gated by safety).
  5: (raw) => ({
    ...raw,
    version: 6,
    control: {
      ...(raw.control ?? { enabled: false, defaultMode: "auto", stepDelayMs: 250 }),
      memory: raw.control?.memory ?? { enabled: true, maxEntries: 500 },
    },
  }),
  // 6 -> 7: add v0.9 durable memory block (explicit, local-first by default).
  6: (raw) => ({
    ...raw,
    version: 7,
    memory: raw.memory ?? {
      enabled: true,
      autoSuggest: true,
      injectInChat: true,
      recallLimit: 5,
    },
  }),
  // 7 -> 8: add XR 1.0 plugin ecosystem block (enabled, trust-checked).
  7: (raw) => ({
    ...raw,
    version: 8,
    plugins: raw.plugins ?? {
      enabled: true,
      requireTrust: true,
      deniedPermissions: [],
    },
  }),
  // 8 -> 9: Stage 3 Universal Provider Engine — routing, custom providers, capabilities.
  8: (raw) => {
    const oldRouting = raw.localModels?.routing ?? "hybrid";
    const routingStrategy =
      oldRouting === "local-only"
        ? "localFirst"
        : oldRouting === "cloud-first"
        ? "cloudFirst"
        : "hybrid";
    return {
      ...raw,
      version: 9,
      providerEngine: {
        routingStrategy,
        customProviders: [],
        providerCapabilities: {},
      },
    };
  },
  // 9 -> 10: Stage 4 Local AI runtime manager — broaden local runtimes and model registry.
  9: (raw) => {
    const runtime = raw.localModels?.runtime ?? "ollama";
    const provider = runtime === "ollama" ? "ollama" : runtime;
    return {
      ...raw,
      version: 10,
      localModels: {
        ...(raw.localModels ?? {}),
        runtime,
        provider: raw.localModels?.provider ?? provider,
        useCase: raw.localModels?.useCase ?? "general",
        runtimes: raw.localModels?.runtimes ?? {},
        installed: raw.localModels?.installed ?? [],
      },
    };
  },

};

function migrate(raw: any): any {
  let cur = raw ?? {};
  let v = typeof cur.version === "number" ? cur.version : 0;
  while (v < CONFIG_VERSION && MIGRATIONS[v]) {
    cur = MIGRATIONS[v](cur);
    v = cur.version;
  }
  return cur;
}

/**
 * Load config. NEVER throws — on any problem it falls back to safe defaults
 * and reports what was wrong (self-healing).
 */
export function loadConfig(): { config: XRConfig; warnings: string[] } {
  ensureHome();

  loadLocalSecrets();

  const warnings: string[] = [];

  if (!existsSync(CONFIG_PATH)) {
    const config = ConfigSchema.parse({});
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    return { config, warnings };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    warnings.push(
      `config.json is not valid JSON (${(e as Error).message}); using defaults.`,
    );
    return { config: ConfigSchema.parse({}), warnings };
  }

  const migrated = migrate(raw);
  const parsed = ConfigSchema.safeParse(migrated);
  if (parsed.success) {
    // Persist any migration/defaults filled in.
    writeFileSync(CONFIG_PATH, JSON.stringify(parsed.data, null, 2));
    return { config: parsed.data, warnings };
  }

  // Invalid: explain exactly what's wrong, then load safe defaults.
  for (const issue of parsed.error.issues) {
    warnings.push(`config.${issue.path.join(".")}: ${issue.message}`);
  }
  warnings.push("Loaded safe defaults so XR can still run.");
  return { config: ConfigSchema.parse({}), warnings };
}

export function configPath(): string {
  return CONFIG_PATH;
}

/**
 * Is the durable memory system enabled? A hard global off-switch via the
 * `XR_MEMORY_DISABLED=1` env var always wins (privacy escape hatch), otherwise
 * the config flag decides. Never throws.
 */
export function isMemoryEnabled(): boolean {
  if (process.env.XR_MEMORY_DISABLED === "1") return false;
  try {
    return loadConfig().config.memory.enabled;
  } catch {
    return true;
  }
}

export function saveConfig(config: XRConfig): void {
  ensureHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(ConfigSchema.parse(config), null, 2));
}

const PROVIDER_KEY_ENVS = [
  "GROQ_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPSEEK_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "MISTRAL_API_KEY",
  "COHERE_API_KEY",
  "TOGETHER_API_KEY",
  "OPENROUTER_API_KEY",
  "CEREBRAS_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "XAI_API_KEY",
  "PERPLEXITY_API_KEY",
  "FIREWORKS_API_KEY",
  "SAMBANOVA_API_KEY",
  "HF_API_KEY",
];

function hasCommand(cmd: string): boolean {
  const res = spawnSync(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [cmd] : ["-v", cmd], {
    stdio: "ignore",
    shell: process.platform !== "win32",
    timeout: 1500,
  });
  return res.status === 0;
}

function getOsSecret(name: string): string | undefined {
  if (platform() === "darwin" && hasCommand("security")) {
    const res = spawnSync("security", ["find-generic-password", "-a", name, "-s", "xr", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  if (platform() === "linux" && hasCommand("secret-tool")) {
    const res = spawnSync("secret-tool", ["lookup", "application", "xr", "name", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (res.status === 0 && res.stdout.trim()) return res.stdout.trim();
  }
  return undefined;
}

function loadLocalSecrets(): void {
  // Backward-compatible file fallback. Keys are loaded into process.env so
  // provider adapters never need to know where the secret came from.
  const envPath = join(XR_HOME, ".env");
  if (existsSync(envPath)) {
    try { chmodSync(envPath, 0o600); } catch {}
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const [key, ...val] = line.split("=");
      if (key && val.length > 0 && !process.env[key.trim()]) {
        process.env[key.trim()] = val.join("=").trim();
      }
    }
  }

  // OS-backed secrets if available (macOS Keychain / Linux Secret Service / Windows DPAPI),
  // then file fallback through the shared secret helper.
  for (const envName of PROVIDER_KEY_ENVS) {
    if (!process.env[envName]) {
      const value = getSecret(envName) ?? getOsSecret(envName);
      if (value) process.env[envName] = value;
    }
  }
}

/** Get environment status for all known providers (driven from presets). */
export function getProviderEnvStatus(): Array<{ id: string; label: string; hasKey: boolean; tier: string }> {
  return Object.values(PRESETS).map((p) => ({
    id: p.id,
    label: p.label,
    hasKey: p.apiKeyEnv ? Boolean(process.env[p.apiKeyEnv]) : true,
    tier: p.tier,
  }));
}
