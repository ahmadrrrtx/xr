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
import { getSecret, getSecretSyncCached } from "../security/secrets.ts";
import { PRESETS } from "../providers/presets.ts";
import {
  getCachedConfig,
  setCachedConfig,
  invalidateConfigCache,
  markSecretsLoaded,
  shouldLoadSecrets,
  cacheMeta,
} from "./cache.ts";

export const CONFIG_VERSION = 13; // Business OS feature flag

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
  // Stage 8 — Voice Stack. Disabled by default, push-to-talk by default,
  // local-first by default. Cloud STT/TTS and always-listen require explicit opt-in.
  voice: z
    .object({
      enabled: z.boolean().default(false),
      mode: z.enum(["off", "push-to-talk", "wake-word", "always-listen"]).default("push-to-talk"),
      inputDevice: z.string().min(1).max(500).optional(),
      outputDevice: z.string().min(1).max(500).optional(),
      sttBackend: z.enum(["auto", "http", "groq", "openai", "whisper-cli", "whispercpp", "disabled"]).default("auto"),
      sttUrl: z.string().url().optional(),
      sttModel: z.string().min(1).max(200).default("base.en"),
      sttLanguage: z.string().min(2).max(32).optional(),
      ttsBackend: z.enum(["auto", "http", "piper", "kokoro-cli", "system", "say", "espeak", "powershell", "disabled"]).default("auto"),
      ttsUrl: z.string().url().optional(),
      ttsVoice: z.string().min(1).max(200).default("default"),
      ttsPersona: z.enum(["calm", "fast", "detailed"]).default("calm"),
      vadBackend: z.enum(["energy", "silero-external", "none"]).default("energy"),
      wakeBackend: z.enum(["text", "openwakeword-external", "none"]).default("text"),
      wakeWord: z.string().min(2).max(80).default("hey xr"),
      pushToTalkKey: z.string().min(1).max(80).default("enter"),
      alwaysListen: z.boolean().default(false),
      interruptionPolicy: z.enum(["barge-in", "finish-sentence", "disabled"]).default("barge-in"),
      confirmationPolicy: z.enum(["always-risky", "always", "never-execute-risky"]).default("always-risky"),
      microphonePermission: z.enum(["unknown", "granted", "denied"]).default("unknown"),
      speakerPermission: z.enum(["unknown", "granted", "denied"]).default("unknown"),
      transcriptPolicy: z.enum(["off", "session", "local-private"]).default("session"),
      transcriptRetentionDays: z.number().int().min(0).max(365).default(7),
      fallbackTextMode: z.boolean().default(true),
      allowCloudStt: z.boolean().default(false),
      allowCloudTts: z.boolean().default(false),
      noiseSuppression: z.boolean().default(true),
      endpointing: z.object({
        minSilenceMs: z.number().int().min(100).max(5000).default(650),
        maxSilenceMs: z.number().int().min(250).max(10000).default(1500),
        speechPaddingMs: z.number().int().min(0).max(2000).default(250),
        maxUtteranceMs: z.number().int().min(1000).max(120000).default(15000),
        energyThreshold: z.number().min(0.001).max(0.5).default(0.012),
      }).default({}),
      deviceMetadata: z.record(z.unknown()).default({}),
      lastTestResult: z.object({
        ok: z.boolean(),
        at: z.string(),
        inputDevice: z.string().optional(),
        outputDevice: z.string().optional(),
        sttBackend: z.string().optional(),
        ttsBackend: z.string().optional(),
        transcript: z.string().optional(),
        detail: z.string().optional(),
      }).optional(),
      lastUsedAt: z.string().optional(),
    })
    .default({}),
  // v0.9 / Stage 6 — durable memory system (long-term preferences, project
  // context, facts). Local-first and EXPLICIT by default: XR only stores what
  // the user asks it to. `autoSuggest` offers to remember things found in
  // chat/voice, but still requires user confirmation — never a silent auto-save.
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
      /**
       * Stage 6 — auto-prune entries older than this many days at opportune
       * moments (e.g. on `xr doctor`). 0 = never auto-expire (explicit only).
       * This NEVER deletes high-importance (>=4) or exclusion rules.
       */
      autoExpireDays: z.number().int().min(0).max(3650).default(0),
      /**
       * Stage 6 — fold finished conversations into compact session summaries
       * (kept in a SEPARATE store, never confused with long-term facts). Off
       * by default so XR is never noisy/creepy.
       */
      saveSessionSummaries: z.boolean().default(false),
      /** Stage 6 — minimum user/assistant turns before a summary is saved. */
      sessionSummaryMinTurns: z.number().int().min(2).max(100).default(6),
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
  business: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({}),
  // Onboarding-persisted user profile (written by src/interfaces/onboard.ts).
  workspace: z
    .object({
      name: z.string().min(1).max(120).default("My Workspace"),
    })
    .default({}),
  theme: z.enum(["dark", "high-contrast", "reduced-motion"]).default("dark"),
  accessibility: z
    .object({
      largeText: z.boolean().default(false),
      screenReader: z.boolean().default(false),
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
  // 10 -> 11: Stage 6 Memory Engine — retention, session summaries, explainable recall.
  10: (raw) => ({
    ...raw,
    version: 11,
    memory: {
      ...(raw.memory ?? {}),
      autoExpireDays: raw.memory?.autoExpireDays ?? 0,
      saveSessionSummaries: raw.memory?.saveSessionSummaries ?? false,
      sessionSummaryMinTurns: raw.memory?.sessionSummaryMinTurns ?? 6,
    },
  }),
  // 12 -> 13: Business OS feature flag.
  12: (raw) => ({
    ...raw,
    version: 13,
    business: raw.business ?? { enabled: false },
  }),
  // 11 -> 12: Stage 8 Voice Stack — safe, disabled-by-default, local-first.
  11: (raw) => ({
    ...raw,
    version: 12,
    voice: {
      enabled: raw.voice?.enabled ?? false,
      mode: raw.voice?.mode ?? (raw.voice?.alwaysListen ? "wake-word" : "push-to-talk"),
      inputDevice: raw.voice?.inputDevice,
      outputDevice: raw.voice?.outputDevice,
      sttBackend: raw.voice?.sttBackend ?? "auto",
      sttUrl: raw.voice?.sttUrl,
      sttModel: raw.voice?.sttModel ?? "base.en",
      sttLanguage: raw.voice?.sttLanguage,
      ttsBackend: raw.voice?.ttsBackend ?? "auto",
      ttsUrl: raw.voice?.ttsUrl,
      ttsVoice: raw.voice?.ttsVoice ?? "default",
      ttsPersona: raw.voice?.ttsPersona ?? "calm",
      vadBackend: raw.voice?.vadBackend ?? "energy",
      wakeBackend: raw.voice?.wakeBackend ?? "text",
      wakeWord: raw.voice?.wakeWord ?? "hey xr",
      pushToTalkKey: raw.voice?.pushToTalkKey ?? "enter",
      alwaysListen: raw.voice?.alwaysListen ?? false,
      interruptionPolicy: raw.voice?.interruptionPolicy ?? "barge-in",
      confirmationPolicy: raw.voice?.confirmationPolicy ?? "always-risky",
      microphonePermission: raw.voice?.microphonePermission ?? "unknown",
      speakerPermission: raw.voice?.speakerPermission ?? "unknown",
      transcriptPolicy: raw.voice?.transcriptPolicy ?? "session",
      transcriptRetentionDays: raw.voice?.transcriptRetentionDays ?? 7,
      fallbackTextMode: raw.voice?.fallbackTextMode ?? true,
      allowCloudStt: raw.voice?.allowCloudStt ?? false,
      allowCloudTts: raw.voice?.allowCloudTts ?? false,
      noiseSuppression: raw.voice?.noiseSuppression ?? true,
      endpointing: {
        minSilenceMs: raw.voice?.endpointing?.minSilenceMs ?? 650,
        maxSilenceMs: raw.voice?.endpointing?.maxSilenceMs ?? 1500,
        speechPaddingMs: raw.voice?.endpointing?.speechPaddingMs ?? 250,
        maxUtteranceMs: raw.voice?.endpointing?.maxUtteranceMs ?? 15000,
        energyThreshold: raw.voice?.endpointing?.energyThreshold ?? 0.012,
      },
      deviceMetadata: raw.voice?.deviceMetadata ?? {},
      lastTestResult: raw.voice?.lastTestResult,
      lastUsedAt: raw.voice?.lastUsedAt,
    },
  }),

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
 *
 * Hot path: returns an in-memory singleton for the TTL window (default 5s) and
 * invalidates immediately on saveConfig() or fs.watch of config.json. Secrets
 * are loaded into process.env once and not re-probed on every request.
 */
export function loadConfig(): { config: XRConfig; warnings: string[] } {
  const cached = getCachedConfig<XRConfig>();
  if (cached) {
    // Secrets may still need a rare refresh; never block on OS keychain here.
    if (shouldLoadSecrets(false)) {
      try { loadLocalSecrets({ skipOsProbe: true }); } catch { /* ignore */ }
    }
    return { config: cached.config, warnings: cached.warnings };
  }

  ensureHome();
  loadLocalSecrets({ skipOsProbe: false });

  const warnings: string[] = [];

  if (!existsSync(CONFIG_PATH)) {
    const config = ConfigSchema.parse({});
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    setCachedConfig(config, warnings, CONFIG_PATH, "default");
    return { config, warnings };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    warnings.push(
      `config.json is not valid JSON (${(e as Error).message}); using defaults.`,
    );
    const config = ConfigSchema.parse({});
    setCachedConfig(config, warnings, CONFIG_PATH, "default");
    return { config, warnings };
  }

  const migrated = migrate(raw);
  const parsed = ConfigSchema.safeParse(migrated);
  if (parsed.success) {
    // Only rewrite disk when migration actually advanced the version or filled defaults.
    const needsWrite = (raw as any)?.version !== parsed.data.version;
    if (needsWrite) {
      writeFileSync(CONFIG_PATH, JSON.stringify(parsed.data, null, 2));
    }
    setCachedConfig(parsed.data, warnings, CONFIG_PATH, "disk");
    return { config: parsed.data, warnings };
  }

  // Invalid: explain exactly what's wrong, then load safe defaults.
  for (const issue of parsed.error.issues) {
    warnings.push(`config.${issue.path.join(".")}: ${issue.message}`);
  }
  warnings.push("Loaded safe defaults so XR can still run.");
  const config = ConfigSchema.parse({});
  setCachedConfig(config, warnings, CONFIG_PATH, "default");
  return { config, warnings };
}

/** Force a disk re-read on the next loadConfig() call. */
export function reloadConfig(): { config: XRConfig; warnings: string[] } {
  invalidateConfigCache("manual");
  return loadConfig();
}

/** Introspection for doctor / health endpoints. */
export function configCacheStats() {
  return cacheMeta();
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
  const parsed = ConfigSchema.parse(config);
  writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2));
  setCachedConfig(parsed, [], CONFIG_PATH, "save");
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

/**
 * Load provider secrets into process.env.
 * - File ~/.xr/.env is always safe and sync.
 * - OS keychain / secret-tool / DPAPI are only probed when skipOsProbe is false
 *   (first load). Subsequent loads use process.env + file only so the daemon
 *   never blocks the event loop on keychain IPC per request.
 */
function loadLocalSecrets(opts: { skipOsProbe?: boolean } = {}): void {
  const envPath = join(XR_HOME, ".env");
  if (existsSync(envPath)) {
    try { chmodSync(envPath, 0o600); } catch {}
    try {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const [key, ...val] = line.split("=");
        if (key && val.length > 0 && !process.env[key.trim()]) {
          process.env[key.trim()] = val.join("=").trim();
        }
      }
    } catch { /* ignore corrupt .env */ }
  }

  for (const envName of PROVIDER_KEY_ENVS) {
    if (process.env[envName]) continue;
    // Prefer cached secret helper (process.env / memo / file) — no spawn.
    try {
      const cached = getSecretSyncCached(envName);
      if (cached) {
        process.env[envName] = cached;
        continue;
      }
    } catch { /* ignore */ }
    if (opts.skipOsProbe) continue;
    // First-load only: may use OS keychain (sync, rare).
    try {
      const value = getSecret(envName);
      if (value) process.env[envName] = value;
    } catch { /* ignore */ }
  }

  markSecretsLoaded();
}

/** Async secret hydrate for daemon startup — never needed on hot path. */
export async function hydrateSecretsAsync(): Promise<void> {
  for (const envName of PROVIDER_KEY_ENVS) {
    if (process.env[envName]) continue;
    try {
      const { getSecretAsync } = await import("../security/secrets.ts");
      const value = await getSecretAsync(envName);
      if (value) process.env[envName] = value;
    } catch { /* ignore */ }
  }
  markSecretsLoaded();
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
