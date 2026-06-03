/**
 * XR — config loader.
 * Schema-validated, versioned, self-healing: never crashes on bad config.
 * (TRD §3.4 / "Never Breaks" doctrine rule #6.)
 */
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const CONFIG_VERSION = 1;

const ConfigSchema = z.object({
  version: z.number().default(CONFIG_VERSION),
  defaults: z
    .object({
      mode: z.enum(["agent", "plan", "ask"]).default("agent"),
      provider: z.string().default("ollama"),
      model: z.string().default("qwen2.5:7b"),
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
      egressAllowlist: z.array(z.string()).default([]),
      requireApproval: z
        .array(z.string())
        .default(["write_file", "delete", "shell", "send"]),
    })
    .default({}),
  providers: z
    .object({
      // provider id -> { baseUrl, keyEnv }
      ollama: z
        .object({ baseUrl: z.string().default("http://localhost:11434/v1") })
        .default({}),
    })
    .passthrough()
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
});

export type XRConfig = z.infer<typeof ConfigSchema>;

export const XR_HOME = process.env.XR_HOME ?? join(homedir(), ".xr");
const CONFIG_PATH = join(XR_HOME, "config.json");

function ensureHome(): void {
  if (!existsSync(XR_HOME)) mkdirSync(XR_HOME, { recursive: true });
}

/** Ordered migrations: key = from-version, transforms raw object. */
const MIGRATIONS: Record<number, (raw: any) => any> = {
  // 0 -> 1: example placeholder for future use
  0: (raw) => ({ ...raw, version: 1 }),
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
