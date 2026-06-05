/**
 * XR — config loader.
 * Schema-validated, versioned, self-healing: never crashes on bad config.
 * (TRD §3.4 / "Never Breaks" doctrine rule #6.)
 * 
 * Now with FULL provider support: Ollama, Groq, Google Gemini, DeepSeek,
 * Together, OpenRouter, Cerebras, Mistral, OpenAI, Anthropic Claude,
 * Cohere, and AWS Bedrock.
 */
import { z } from "zod";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const CONFIG_VERSION = 4; // Bumped for XR v0.5 local model intelligence

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
  localModels: z
    .object({
      runtime: z.literal("ollama").default("ollama"),
      enabled: z.boolean().default(false),
      selected: z.string().min(1).max(200).optional(),
      recommended: z.string().min(1).max(200).optional(),
      recommendationReason: z.string().max(1000).optional(),
      installedAt: z.string().datetime().optional(),
      routing: z.enum(["local-only", "hybrid", "cloud-first"]).default("hybrid"),
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

  // OS-backed secrets if available (macOS Keychain / Linux Secret Service).
  for (const envName of PROVIDER_KEY_ENVS) {
    if (!process.env[envName]) {
      const value = getOsSecret(envName);
      if (value) process.env[envName] = value;
    }
  }
}

/** Get environment status for all known providers */
export function getProviderEnvStatus(): Array<{ id: string; label: string; hasKey: boolean; tier: string }> {
  const providers = [
    { id: "ollama", label: "Ollama (Local)", keyEnv: null, tier: "free" },
    { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", tier: "free" },
    { id: "google", label: "Google Gemini", keyEnv: "GOOGLE_API_KEY", tier: "free" },
    { id: "deepseek", label: "DeepSeek", keyEnv: "DEEPSEEK_API_KEY", tier: "free" },
    { id: "anthropic", label: "Anthropic Claude", keyEnv: "ANTHROPIC_API_KEY", tier: "premium" },
    { id: "openai", label: "OpenAI (GPT)", keyEnv: "OPENAI_API_KEY", tier: "premium" },
    { id: "mistral", label: "Mistral AI", keyEnv: "MISTRAL_API_KEY", tier: "cheap" },
    { id: "cohere", label: "Cohere", keyEnv: "COHERE_API_KEY", tier: "premium" },
    { id: "together", label: "Together AI", keyEnv: "TOGETHER_API_KEY", tier: "cheap" },
    { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", tier: "cheap" },
    { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY", tier: "cheap" },
    { id: "bedrock", label: "AWS Bedrock", keyEnv: "AWS_ACCESS_KEY_ID", tier: "premium" },
  ];

  return providers.map(p => ({
    id: p.id,
    label: p.label,
    hasKey: p.keyEnv ? Boolean(process.env[p.keyEnv]) : false, // Ollama doesn't need a key
    tier: p.tier,
  }));
}
