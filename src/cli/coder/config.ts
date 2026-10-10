/**
 * Coder CLI configuration.
 *
 * Non-secret preferences live in `<XR_HOME>/cli.json` (default ~/.xr/cli.json),
 * separate from the engine's versioned, schema-validated `config.json`, so the
 * coder can never corrupt the desktop app's settings. API keys never go in
 * either file: they live in the SecretBroker (OS keychain, or the encrypted
 * file store). Environment keys are read in memory only, through the broker's
 * runtime resolver, and are never persisted.
 *
 * Precedence for provider/model: flag > env (XR_PROVIDER / XR_MODEL) > cli.json.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { PRESETS } from "../../providers/presets.ts";
import { registerRuntimeSecretResolver, secretBrokerSync } from "../../security/secret-broker.ts";
import type { PermissionRules } from "./permissions.ts";

export interface CoderConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
  theme?: "auto" | "dark" | "light";
  /** Approval rules: `shell:npm test*`, `edit:src/*`, `network:https://docs.*`. Deny beats ask beats allow. */
  permissions?: PermissionRules;
}

export function xrHome(): string {
  return process.env.XR_HOME ?? join(homedir(), ".xr");
}

export function cliConfigPath(override?: string): string {
  return override ?? process.env.XR_CLI_CONFIG ?? join(xrHome(), "cli.json");
}

export function historyPath(): string {
  if (process.env.XDG_DATA_HOME) return join(process.env.XDG_DATA_HOME, "xr", "cli-history");
  return join(xrHome(), "cli-history");
}

export function loadCliConfig(path: string): CoderConfig {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const cfg: CoderConfig = {};
    if (typeof raw.provider === "string") cfg.provider = raw.provider;
    if (typeof raw.model === "string") cfg.model = raw.model;
    if (typeof raw.baseUrl === "string") cfg.baseUrl = raw.baseUrl;
    if (raw.theme === "auto" || raw.theme === "dark" || raw.theme === "light") cfg.theme = raw.theme;
    if (raw.permissions && typeof raw.permissions === "object") {
      const p = raw.permissions as Record<string, unknown>;
      const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
      cfg.permissions = { allow: list(p.allow), ask: list(p.ask), deny: list(p.deny) };
    }
    return cfg;
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Write a file readable only by the owner (config holds no secrets, but keep it private). */
export function writePrivate(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function saveCliConfig(path: string, cfg: CoderConfig): void {
  writePrivate(path, `${JSON.stringify(cfg, null, 2)}\n`);
}

export interface ProviderChoice {
  id: string;
  label: string;
  keyEnv?: string;
  defaultModel: string;
  baseUrl?: string;
  keyless: boolean;
}

/** Providers the coder offers. Built from the engine presets so names and URLs never drift. */
export function providerChoices(): ProviderChoice[] {
  const pick = (id: string): ProviderChoice | null => {
    const p = (PRESETS as Record<string, { label: string; apiKeyEnv?: string; defaultModel: string; baseUrl?: string }>)[id];
    if (!p) return null;
    return {
      id,
      label: p.label,
      ...(p.apiKeyEnv ? { keyEnv: p.apiKeyEnv } : {}),
      defaultModel: p.defaultModel,
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      keyless: !p.apiKeyEnv,
    };
  };
  return ["anthropic", "openai", "groq", "ollama"]
    .map(pick)
    .filter((c): c is ProviderChoice => c !== null);
}

/** Environment keys the coder recognizes, mapped to provider ids. */
const ENV_KEY_PROVIDERS: ReadonlyArray<{ env: string; provider: string }> = [
  { env: "ANTHROPIC_API_KEY", provider: "anthropic" },
  { env: "OPENAI_API_KEY", provider: "openai" },
  { env: "GROQ_API_KEY", provider: "groq" },
  { env: "XR_API_KEY", provider: "" },
];

/** Keys in the environment are readable in memory only (never copied to disk). */
export function registerEnvSecrets(): () => void {
  const names = new Set(ENV_KEY_PROVIDERS.map((e) => e.env));
  return registerRuntimeSecretResolver((name) => {
    if (!names.has(name)) return undefined;
    const v = process.env[name];
    return v && v.length > 0 ? v : undefined;
  });
}

/** Provider whose key is available: an env key, or a stored key in the broker. */
export function providerWithKey(): string | null {
  for (const { env, provider } of ENV_KEY_PROVIDERS) {
    if (provider && process.env[env]) return provider;
  }
  for (const choice of providerChoices()) {
    if (choice.keyEnv && secretBrokerSync(choice.keyEnv)) return choice.id;
  }
  return null;
}

export interface ResolvedSettings {
  provider: string | undefined;
  model: string | undefined;
  source: string;
}

export function resolveSettings(flags: { provider?: string; model?: string }, cfg: CoderConfig): ResolvedSettings {
  const provider = flags.provider ?? process.env.XR_PROVIDER ?? cfg.provider;
  let model = flags.model ?? process.env.XR_MODEL ?? cfg.model;
  let source = flags.model || flags.provider ? "flags" : process.env.XR_PROVIDER || process.env.XR_MODEL ? "env" : "config";
  if (!model && provider) {
    const choice = providerChoices().find((c) => c.id === provider);
    model = choice?.defaultModel;
    source = `${source}, default model`;
  }
  return { provider, model, source };
}
