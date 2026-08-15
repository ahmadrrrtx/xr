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
import { getSecret, getSecretSyncCached, listFileSecrets } from "../security/secrets.ts";
import { PRESETS } from "../providers/presets.ts";
import {
  getCachedConfig,
  setCachedConfig,
  invalidateConfigCache,
  markSecretsLoaded,
  shouldLoadSecrets,
  cacheMeta,
} from "./cache.ts";

export const CONFIG_VERSION = 19; // Phase 04 — Provider Gateway: healthTimeoutMs separate

// Phase 04 — health vs request timeout separation
export const DEFAULT_HEALTH_TIMEOUT_MS = 2500;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

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
      /**
       * Phase 4 · T4 — explicitly permitted raw-IP / loopback destinations
       * (e.g. a local model runtime at 127.0.0.1:11434). Exact host or
       * host:port entries; the ONLY way through the private-range block.
       * Absent = raw IP literals are refused at the egress proxy.
       */
      allowedHosts: z.array(z.string()).default([]),
      requireApproval: z
        .array(z.string())
        .default(["write_file", "delete", "shell", "send"]),
      /**
       * Phase 4 · T1 — hardened mode (fail-closed). Default TRUE: high-risk
       * actions (shell/code/MCP/plugins) must run inside an enforceable OS
       * boundary or FAIL; they never silently fall back to host authority.
       * Set to false only on hosts where no isolation backend exists and the
       * operator explicitly accepts the degraded posture (logged + audited).
       * Env override: XR_TRUST_HARDENED=0|false.
       */
      hardened: z.boolean().default(true),
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
      /** GAP-001 — model-call ceiling (ms); never unbounded. Env: XR_PROVIDER_TIMEOUT_MS. */
      requestTimeoutMs: z.number().int().positive().max(3_600_000).default(120_000),
      /** Phase 04 — health check ceiling (ms); bounded separately from request. Env: XR_HEALTH_TIMEOUT_MS */
      healthTimeoutMs: z.number().int().positive().max(30_000).default(2500),
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
  // ── XR 4.4: Universal Intelligence Plane ────────────────────────────────
  // Additive routing preferences. Defaults preserve XR 4.3 behavior:
  // hybrid strategy via providerEngine, explicit pins still win.
  intelligencePlane: z
    .object({
      /** High-level routing mode. When unset, providerEngine.routingStrategy maps in. */
      mode: z
        .enum([
          "manual",
          "preferred_with_fallback",
          "local_only",
          "private_only",
          "automatic",
          "cost_constrained",
          "latency_constrained",
          "quality_constrained",
          "disabled",
        ])
        .optional(),
      localityPolicy: z
        .enum(["any", "local_only", "private_only", "no_cloud"])
        .default("any"),
      allowFallback: z.boolean().default(true),
      /** Explicit opt-in to escalate local/private work to cloud on failure. */
      allowCloudFallback: z.boolean().default(false),
      preferFree: z.boolean().default(true),
      maxCostUsd: z.number().min(0).optional(),
      latencyPreference: z
        .enum(["any", "realtime", "fast", "standard", "slow"])
        .default("any"),
      qualityPreference: z
        .enum(["any", "basic", "standard", "high", "frontier"])
        .default("any"),
      /** Opt out of historical outcome influence (safe default remains on with confidence gates). */
      disableHistorical: z.boolean().default(false),
      /** When false, automatic routing is off — only explicit/default pins. */
      enableAutomatic: z.boolean().default(true),
      /**
       * Phase 5 · T1 — difficulty-aware capability gating (RouteLLM
       * principle, deterministic): estimate task difficulty and require
       * MEASURED fidelity ≥ the implied floor. The gate rejects only measured
       * contracts below the floor; unmeasured models pass on static priors.
       */
      difficultyRouting: z.boolean().default(true),
      /** Phase 5 · T1 — explicit global fidelity floor override (0..1). */
      minOverallFidelity: z.number().min(0).max(1).optional(),
      /**
       * Phase 5 · T3 — circuit breaker tuning (rolling window trips on error
       * rate AND quality degradation; cooldown → half-open probe).
       */
      breaker: z
        .object({
          windowSize: z.number().int().min(4).max(512).default(32),
          minSamples: z.number().int().min(1).max(128).default(4),
          errorRateThreshold: z.number().min(0.05).max(1).default(0.5),
          qualityRateThreshold: z.number().min(0.05).max(1).default(0.6),
          cooldownMs: z.number().int().min(1000).default(30_000),
          cooldownMaxMs: z.number().int().min(1000).default(300_000),
          jitterRatio: z.number().min(0).max(1).default(0.2),
        })
        .default({}),
      /** Phase 5 · T3 — jittered retry budget for transient failures. */
      retry: z
        .object({
          maxInPlaceRetries: z.number().int().min(0).max(5).default(1),
          baseDelayMs: z.number().int().min(0).default(250),
          maxDelayMs: z.number().int().min(0).default(4_000),
          totalBudgetMs: z.number().int().min(0).default(8_000),
          jitterRatio: z.number().min(0).max(1).default(0.3),
        })
        .default({}),
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
  // XR 4.5 — Knowledge and Context OS. Additive: every default preserves 4.4
  // behavior, so an upgraded install behaves identically until opted in.
  knowledge: z
    .object({
      /**
       * Master switch for the context layer. When false XR falls back to the
       * 4.4 memory injection path exactly (rollback lever, §19).
       */
      enabled: z.boolean().default(true),
      /**
       * Injection mode.
       *  - "legacy"  : 4.4 behavior (single unlabelled memory block)
       *  - "context" : 4.5 typed, channel-separated context packages
       *  - "both"    : context packages, with the legacy block appended
       *                (transition aid; doubles context cost — not a default)
       */
      injectionMode: z.enum(["legacy", "context", "both"]).default("context"),
      /**
       * Enforce scope/authorization before ranking. Disabling this is UNSAFE
       * and exists only for incident diagnosis; it is logged loudly and must
       * never be used as a rollback path (§19).
       */
      enforceScope: z.boolean().default(true),
      /** Quarantine untrusted external content rather than dropping it. */
      quarantineUntrusted: z.boolean().default(true),
      /** Use the intelligence plane to route embedding/reranking models. */
      routeEmbeddings: z.boolean().default(true),
      /** Force deterministic lexical retrieval (no embedding calls at all). */
      lexicalOnly: z.boolean().default(false),
      /** Enable the deterministic reranking stage. */
      rerank: z.boolean().default(true),
      /** Hard cap on items in one assembled context package. */
      maxPackageItems: z.number().int().min(0).max(200).default(48),
      /** Hard cap on characters in one assembled context package. */
      maxPackageChars: z.number().int().min(0).max(200_000).default(24_000),
      /** Evidence-preserving compression for long tasks. */
      compression: z.boolean().default(true),
      /**
       * Refuse to compress when a required evidence invariant would be lost.
       * Turning this off permits lossy summaries — not recommended (§9.6).
       */
      compressionFailSafe: z.boolean().default(true),
      /** Persist context packages so a resumed task can revalidate them. */
      durablePackages: z.boolean().default(true),
      /** Revalidate consent/revocation/scope when a task resumes. */
      revalidateOnResume: z.boolean().default(true),
      /** Metadata verbosity in normal (non-inspection) output. */
      disclosure: z.enum(["concise", "detailed"]).default("concise"),
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
  // XR 5.1 (v16): Environment Interaction OS. Adds one governed contract over
  // browser/desktop/filesystem/application/voice/vision. Enabled by default —
  // the layer only GATES existing control/voice primitives (it cannot widen
  // them), so a local-only, control-disabled install is unaffected. Per-
  // modality switches are the supported Phase 8 rollback granularity (§17).
  environment: z
    .object({
      enabled: z.boolean().default(true),
      /** Per-modality kill switches (rollback without touching core XR). */
      modalities: z
        .object({
          browser: z.boolean().default(true),
          desktop: z.boolean().default(true),
          filesystem: z.boolean().default(true),
          application: z.boolean().default(true),
          voice: z.boolean().default(true),
          vision: z.boolean().default(true),
        })
        .default({}),
      browser: z
        .object({
          /** Session domain policy (applies to governed isolated sessions). */
          allowedDomains: z.array(z.string().max(200)).max(200).default([]),
          blockedDomains: z.array(z.string().max(200)).max(500).default([]),
          /** Governed sessions fail closed on private/localhost navigation. */
          blockPrivateNetworks: z.boolean().default(true),
          maxDownloadBytes: z.number().int().min(0).max(100 * 1024 * 1024).default(50 * 1024 * 1024),
        })
        .default({}),
      vision: z
        .object({
          /** Cloud vision model calls: explicit opt-in, default off. */
          allowCloud: z.boolean().default(false),
          maxImageBytes: z.number().int().min(262_144).max(25 * 1024 * 1024).default(5 * 1024 * 1024),
          /** Observations older than this cannot justify coordinate actions. */
          staleObservationMs: z.number().int().min(1_000).max(300_000).default(30_000),
        })
        .default({}),
      voice: z
        .object({
          /** Minimum deterministic intent confidence for voice control actions. */
          minControlConfidence: z.number().min(0).max(1).default(0.6),
        })
        .default({}),
      recovery: z
        .object({
          /** Bounded self-healing only (§7.7). Hard cap 1 re-observe retry. */
          maxReobserveRetries: z.number().int().min(0).max(1).default(1),
          circuitFailures: z.number().int().min(2).max(10).default(3),
          circuitCooldownMs: z.number().int().min(5_000).max(600_000).default(60_000),
        })
        .default({}),
      sessions: z
        .object({
          maxActive: z.number().int().min(1).max(20).default(5),
          idleTimeoutMs: z.number().int().min(30_000).max(3_600_000).default(300_000),
        })
        .default({}),
    })
    .default({}),
  // XR 5.2 (v17): Capability Ecosystem. Additive inspection/policy
  // overlay over existing plugin/skill/MCP/provider/tool/workflow systems.
  // It never grants authority by itself; it only controls verification/review
  // defaults used by installers and the common capability inspector.
  capabilities: z
    .object({
      enabled: z.boolean().default(true),
      /** Require package signatures for remote/registry installs. Local packages remain inspectable but marked unsigned. */
      requireSignedPackages: z.boolean().default(false),
      /** Require explicit review before an update can gain new effective authority. */
      updateRequiresReview: z.boolean().default(true),
      /** Quarantine capabilities on package/signature/contract verification failure. */
      quarantineOnVerificationFailure: z.boolean().default(true),
      /** Workspace-level denied permissions; denied always wins over user grants. */
      deniedPermissions: z.array(z.string()).default([]),
      /** Discovery never ranks by popularity alone; this keeps evidence-biased ranking enabled. */
      evidenceWeightedDiscovery: z.boolean().default(true),
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
  /**
   * Phase 8 · T2 — privacy-respecting telemetry (Constitution Art. XXI).
   * OPT-IN: `enabled` defaults to false (nothing is emitted or exported);
   * structural-by-default (durations, model/tool names, token counts,
   * placements, SLOs); prompt/tool CONTENT requires explicit per-flag
   * opt-in below and still passes the redactor. Endpoint defaults to the
   * LOCAL viewer (standalone OTLP dashboard); no cloud default, and there
   * is never silent egress.
   */
  telemetry: z
    .object({
      enabled: z.boolean().default(false),
      endpoint: z.string().url().default("http://127.0.0.1:4318"),
      serviceName: z.string().min(1).max(80).default("xr"),
      sampleRatio: z.number().min(0).max(1).default(1),
      content: z
        .object({
          prompt: z.boolean().default(false),
          toolArgs: z.boolean().default(false),
        })
        .default({}),
      exportMetrics: z.boolean().default(true),
      exportLogs: z.boolean().default(true),
      batchIntervalMs: z.number().int().min(500).max(600_000).default(5000),
      batchMax: z.number().int().min(1).max(1000).default(100),
      ringBufferSize: z.number().int().min(16).max(16384).default(512),
      /** Per-metric label cardinality budgets (overflow folds to xr_other). */
      cardinality: z.record(z.number().int().min(1).max(10_000)).default({}),
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
  /**
   * Explicit env-var → config-path override contract (Phase 4 · S-1 finding
   * F3). `"envOverrides": { "providers.openrouter.baseUrl": "OPENROUTER_BASE_URL" }`
   * makes the named env var override that config path at load time. Without an
   * entry, the env var does nothing (bare `*_BASE_URL` vars are NOT honored).
   * Rules: env var names must be UPPER_SNAKE; paths must start from a real
   * config root; only string-valued leaves are writable; values must pass
   * schema validation; `__proto__`/`prototype`/`constructor` segments are
   * refused. Everything overridden is reported in the loadConfig warnings.
   */
  envOverrides: z.record(z.string()).default({}),
  /** Kill-switch for automation/CI: ignore every envOverrides mapping. */
  envOverridesLocked: z.boolean().default(false),
});

export type XRConfig = z.infer<typeof ConfigSchema>;
/** Exposed for tests and tooling that need schema-validated config fixtures. */
export { ConfigSchema };

export const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
const CONFIG_PATH = join(XR_HOME, "config.json");

function ensureHome(): void {
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
}

/** Ordered migrations: key = from-version, transforms raw object. */
/** Exported for Phase 0 migration tests (test/phase0/cli-spine.test.ts). */
export const MIGRATIONS: Record<number, (raw: any) => any> = {
  // 0 -> 1: example placeholder
  0: (raw) => ({ ...raw, version: 1 }),
  // 1 -> 2: add provider-specific settings, preferFreeProviders
  1: (raw) => ({
    ...raw,
    version: 2,
    preferFreeProviders: raw.preferFreeProviders ?? true,
  }),
  /**
   * 2 -> 3: add fallback settings.
   *
   * Phase 0 · T11 — do not default the fallback to the primary target.
   *
   * This migration used to set `fallbackProvider: "ollama"` unconditionally,
   * which for the (very common) `defaults.provider === "ollama"` install made
   * the fallback identical to the primary. XR then reported
   * "Ollama (Local) → fallback Ollama (Local)" and retried a dead endpoint
   * against itself. A fallback that cannot change the outcome is not a
   * fallback, so it is now only seeded when it is genuinely a different target.
   *
   * Existing explicit user values are preserved untouched (Article XXIII).
   */
  2: (raw) => {
    const primaryProvider = raw.defaults?.provider ?? "ollama";
    const seedFallback = primaryProvider !== "ollama";
    return {
      ...raw,
      version: 3,
      defaults: {
        ...raw.defaults,
        fallbackProvider: raw.defaults?.fallbackProvider ?? (seedFallback ? "ollama" : undefined),
        fallbackModel: raw.defaults?.fallbackModel ?? (seedFallback ? "qwen2.5:7b" : undefined),
      },
    };
  },
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
  // 13 -> 14: XR 4.4 Universal Intelligence Plane (additive routing preferences).
  13: (raw) => ({
    ...raw,
    version: 14,
    intelligencePlane: raw.intelligencePlane ?? {
      localityPolicy:
        raw.localModels?.routing === "local-only" ? "local_only" : "any",
      allowFallback: true,
      allowCloudFallback: false,
      preferFree: raw.preferFreeProviders ?? true,
      latencyPreference: "any",
      qualityPreference: "any",
      disableHistorical: false,
      enableAutomatic: true,
    },
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
  // 14 -> 15: XR 4.5 Knowledge and Context OS.
  //
  // Additive and behavior-preserving:
  //   • memory.enabled / injectInChat / recallLimit / semanticRecall untouched
  //   • local-only installs stay local-only (lexicalOnly follows the existing
  //     local_only locality policy so no upgrade can introduce a cloud call)
  //   • nothing is auto-captured; consent behavior is unchanged
  14: (raw) => ({
    ...raw,
    version: 15,
    knowledge: raw.knowledge ?? {
      enabled: true,
      injectionMode: "context",
      enforceScope: true,
      quarantineUntrusted: true,
      // Respect an existing local-only posture rather than overriding it.
      routeEmbeddings: raw.intelligencePlane?.localityPolicy !== "local_only",
      lexicalOnly: false,
      rerank: true,
      maxPackageItems: 48,
      maxPackageChars: 24_000,
      compression: true,
      compressionFailSafe: true,
      durablePackages: true,
      revalidateOnResume: true,
      disclosure: "concise",
    },
  }),
  // 15 -> 16: XR 5.1 Environment Interaction OS.
  //
  // Additive and behavior-preserving:
  //   • control.enabled / voice consent flags / budget are untouched —
  //     the environment layer only gates existing primitives, never widens them.
  //   • cloud vision defaults OFF, matching the existing cloud STT/TTS posture.
  //   • governed browser sessions block private-network navigation by default
  //     (legacy shared browser path keeps its existing env-flag behavior).
  //   • per-modality switches are the supported rollback granularity (§17):
  //     disabling a modality never disables core XR or other modalities.
  15: (raw) => ({
    ...raw,
    version: 16,
    environment: raw.environment ?? {
      enabled: true,
      modalities: {
        browser: true,
        desktop: true,
        filesystem: true,
        application: true,
        voice: true,
        vision: true,
      },
      browser: {
        allowedDomains: [],
        blockedDomains: [],
        blockPrivateNetworks: true,
        maxDownloadBytes: 50 * 1024 * 1024,
      },
      vision: {
        allowCloud: false,
        maxImageBytes: 5 * 1024 * 1024,
        staleObservationMs: 30_000,
      },
      voice: {
        minControlConfidence: 0.6,
      },
      recovery: {
        maxReobserveRetries: 1,
        circuitFailures: 3,
        circuitCooldownMs: 60_000,
      },
      sessions: {
        maxActive: 5,
        idleTimeoutMs: 300_000,
      },
    },
  }),
  // 16 -> 17: XR 5.2 Capability Ecosystem.
  //
  // Additive only: the common descriptor/metadata layer does not change any
  // plugin, skill, MCP, provider, tool, workflow, memory, context, trust, or
  // execution semantics. Defaults preserve local-first operation while making
  // verification/review policy explicit for capability installers.
  16: (raw) => ({
    ...raw,
    version: 17,
    capabilities: raw.capabilities ?? {
      enabled: true,
      requireSignedPackages: false,
      updateRequiresReview: true,
      quarantineOnVerificationFailure: true,
      deniedPermissions: [],
      evidenceWeightedDiscovery: true,
    },
  }),
  // 17 -> 18: Phase 5 — measured, explainable routing quality.
  //
  // Additive and behavior-preserving:
  //   • difficultyRouting defaults ON but rejects only MEASURED-below-floor
  //     contracts, so a workspace with no measured contracts routes exactly as
  //     before; every existing intelligencePlane value is preserved.
  //   • breaker/retry get safe defaults; locality policy untouched.
  17: (raw) => ({
    ...raw,
    version: 18,
    intelligencePlane: {
      difficultyRouting: true,
      ...raw.intelligencePlane,
    },
  }),
  // 18 -> 19: Phase 04 — healthTimeoutMs separate from requestTimeoutMs.
  // Additive, preserves existing requestTimeout behavior; health bounded 2.5s.
  18: (raw) => ({
    ...raw,
    version: 19,
    providerEngine: {
      requestTimeoutMs: 120_000,
      healthTimeoutMs: 2500,
      routingStrategy: "hybrid",
      customProviders: [],
      providerCapabilities: {},
      ...raw.providerEngine,
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

/** Test/dev handle: run the raw config migration chain without touching disk. */
export function migrateRawConfig(raw: unknown): unknown {
  return migrate(raw);
}

/**
 * Load config. NEVER throws — on any problem it falls back to safe defaults
 * and reports what was wrong (self-healing).
 *
 * Hot path: returns an in-memory singleton for the TTL window (default 5s) and
 * invalidates immediately on saveConfig() or fs.watch of config.json. Secrets
 * are loaded into process.env once and not re-probed on every request.
 */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** Write a dotted path to a string leaf only. Never creates structure. */
function setDottedStringLeaf(target: Record<string, unknown>, path: string, value: string): boolean {
  const segs = path.split(".");
  if (segs.length < 2 || segs.some((s) => s === "" || FORBIDDEN_PATH_SEGMENTS.has(s))) return false;
  let node: Record<string, unknown> = target;
  for (let i = 0; i < segs.length - 1; i++) {
    const next: unknown = node[segs[i]!];
    if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    node = next as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1]!;
  if (typeof node[leaf] !== "string") return false; // string leaves only
  node[leaf] = value;
  return true;
}

/**
 * Phase 4 · T1 (+ F3) — apply operator env overrides on top of parsed config.
 * `XR_TRUST_HARDENED=0|false` disables hardened mode (fail-open degraded
 * posture for hosts without isolation backends — logged by callers); the
 * configured `config.envOverrides` map applies last and reports everything it
 * does (or refuses) through the warnings sink. `envOverridesLocked: true`
 * ignores the whole map.
 */
export function applyEnvOverrides(config: XRConfig): { config: XRConfig; warnings: string[] } {
  const warnings: string[] = [];
  let out = config;

  // 1. Legacy single-purpose override (kept for compatibility, documented inline).
  const envHardened = process.env.XR_TRUST_HARDENED;
  if (envHardened !== undefined && envHardened !== "") {
    const hardened = !/^(0|false|off|no)$/i.test(envHardened);
    if (hardened !== out.security.hardened) {
      out = { ...out, security: { ...out.security, hardened } };
      warnings.push(`env override applied: security.hardened ← XR_TRUST_HARDENED`);
    }
  }

  // 2. Configured map (explicit contract — nothing ambient is honored).
  const map = out.envOverrides ?? {};
  const entries = Object.entries(map);
  if (entries.length === 0) return { config: out, warnings };
  if (out.envOverridesLocked) {
    warnings.push(`envOverrides: ${entries.length} mapping(s) ignored — envOverridesLocked is true`);
    return { config: out, warnings };
  }
  const roots = new Set(Object.keys(ConfigSchema.shape));
  for (const [path, envName] of entries) {
    if (!ENV_NAME_RE.test(envName)) {
      warnings.push(`envOverrides["${path}"]: "${envName}" is not an UPPER_SNAKE env var name — ignored`);
      continue;
    }
    const root = path.split(".")[0]!;
    if (!roots.has(root)) {
      warnings.push(`envOverrides["${path}"]: unknown config root "${root}" — ignored`);
      continue;
    }
    const value = process.env[envName];
    if (value === undefined || value === "") continue;
    const next = structuredClone(out);
    if (!setDottedStringLeaf(next as unknown as Record<string, unknown>, path, value)) {
      warnings.push(`envOverrides["${path}"]: no writable string leaf at that path — ignored`);
      continue;
    }
    const parsed = ConfigSchema.safeParse(next);
    if (!parsed.success) {
      warnings.push(`envOverrides["${path}"] ← ${envName}: value failed schema validation (e.g. must be a valid URL) — ignored`);
      continue;
    }
    out = parsed.data;
    warnings.push(`env override applied: ${path} ← ${envName}`);
  }
  return { config: out, warnings };
}

/** Backwards-compatible wrapper: config only (warnings discarded). */
export function withEnvOverrides(config: XRConfig): XRConfig {
  return applyEnvOverrides(config).config;
}

export function loadConfig(): { config: XRConfig; warnings: string[] } {
  const out = loadConfigInner();
  const env = applyEnvOverrides(out.config);
  return { config: env.config, warnings: [...out.warnings, ...env.warnings] };
}

function loadConfigInner(): { config: XRConfig; warnings: string[] } {
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
    const needsWrite = (raw as { version?: unknown })?.version !== parsed.data.version;
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
 * XR 4.5 — is the Knowledge and Context OS active?
 * Requires BOTH memory to be enabled and the knowledge layer to be on, so the
 * existing memory off-switch keeps working exactly as it did in 4.4.
 */
export function isKnowledgeEnabled(): boolean {
  try {
    const { config } = loadConfig();
    return config.memory.enabled && config.knowledge.enabled;
  } catch {
    return false;
  }
}

/** The effective injection mode, honouring the memory/knowledge off-switches. */
export function contextInjectionMode(): "legacy" | "context" | "both" {
  try {
    const { config } = loadConfig();
    if (!config.memory.enabled) return "legacy";
    if (!config.knowledge.enabled) return "legacy";
    return config.knowledge.injectionMode;
  } catch {
    return "legacy";
  }
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
      // Route through secrets.ts: it owns the format (AES-256-GCM sealed
      // values + legacy plaintext migration). Raw-parsing here once hydrated
      // ciphertext into process.env during the launch hardening.
      for (const [key, value] of Object.entries(listFileSecrets())) {
        if (value && !process.env[key]) process.env[key] = value;
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
    hasKey: p.apiKeyEnv ? Boolean(process.env[p.apiKeyEnv] || getSecretSyncCached(p.apiKeyEnv)) : true,
    tier: p.tier,
  }));
}
