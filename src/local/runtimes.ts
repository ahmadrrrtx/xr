/** XR Stage 4 — local runtime detection, health checks, and safe setup helpers. */
import { spawn } from "node:child_process";
import { loadConfig } from "../config/config.ts";
import { commandExists } from "../util/process.ts";
import { Semaphore } from "../util/concurrency.ts";
import { TtlCache } from "../util/ttl-cache.ts";
import { xrMetrics } from "../observability/metrics.ts";
import {
  LOCAL_RUNTIMES,
  type LocalRuntimeDefinition,
  type LocalRuntimeId,
  getRuntimeDefinition,
  validateLocalModelId,
} from "./registry.ts";

export interface LocalRuntimeStatus {
  id: LocalRuntimeId;
  providerId: string;
  label: string;
  baseUrl: string;
  installed: boolean;
  running: boolean;
  configured: boolean;
  healthy: boolean;
  models: string[];
  version?: string;
  detail: string;
  docsUrl: string;
  installSupport: LocalRuntimeDefinition["installSupport"];
  modelManagement: LocalRuntimeDefinition["modelManagement"];
}

export interface LocalModelHealth {
  ok: boolean;
  runtime: LocalRuntimeId;
  model: string;
  latencyMs?: number;
  detail: string;
}

// ── Phase 01 · runtime detection performance ────────────────────────────────
//
// The previous implementation probed every runtime SEQUENTIALLY (11 × up to
// ~2.5 s = ~25–29 s when endpoints hang) and used a blocking spawnSync
// command-exists check. This module now:
//   · probes runtimes with BOUNDED PARALLELISM (Semaphore, default 5) —
//     never a blind Promise.all over everything, never sequential;
//   · runs the CLI-presence check and the API probe CONCURRENTLY per runtime
//     so a single runtime is bounded by max(command check, probe) ≈ 2.5 s;
//   · caches results keyed by the effective CONFIGURATION fingerprint
//     (base URLs, cli commands, localModels, defaults) so a config change
//     invalidates automatically (TTL 60 s, stale-while-revalidate 30 s);
//   · deduplicates concurrent callers onto ONE detection (request A starts,
//     B/C await the same in-flight promise);
//   · uses the shared async commandExists (60 s memo) from util/process.ts.
//
// Rollback: XR_RUNTIME_CACHE=0|false disables the CACHE ONLY — detection
// stays bounded-parallel (never the old unbounded sequential loop).
// Tuning: XR_RUNTIME_CACHE_TTL_MS overrides the TTL (config-cache precedent).

const RUNTIME_DETECTION_CONCURRENCY = 5;
const RUNTIME_CACHE_TTL_MS =
  Number(process.env.XR_RUNTIME_CACHE_TTL_MS ?? 60_000) > 0
    ? Number(process.env.XR_RUNTIME_CACHE_TTL_MS ?? 60_000)
    : 60_000;
const RUNTIME_CACHE_SWR_MS = 30_000;
const DETECT_TIMEOUT_MS = 2500;

export function runtimeCacheEnabled(): boolean {
  const raw = process.env.XR_RUNTIME_CACHE;
  return raw === undefined || raw === "" || !/^(0|false|off|no)$/i.test(raw);
}

/** Bounded global concurrency for runtime probes (never unbounded). */
const runtimeProbeLimit = new Semaphore(RUNTIME_DETECTION_CONCURRENCY);

const runtimeCache = new TtlCache<LocalRuntimeStatus[]>({
  ttlMs: RUNTIME_CACHE_TTL_MS,
  staleWhileRevalidateMs: RUNTIME_CACHE_SWR_MS,
  maxEntries: 8,
  onStats: (event) => {
    if (event === "hit") xrMetrics.runtimeCacheHits.inc();
    else if (event === "miss") xrMetrics.runtimeCacheMisses.inc();
    else if (event === "dedup") xrMetrics.deduplicatedRequests.inc({ resource: "runtimes" });
    else xrMetrics.runtimeCacheRefreshes.inc();
  },
});

/** Test/ops hooks: TTL, stats, eviction. */
export function runtimeCacheStats() {
  return { ...runtimeCache.stats(), enabled: runtimeCacheEnabled(), ttlMs: RUNTIME_CACHE_TTL_MS };
}
export function invalidateRuntimeCache(): void {
  runtimeCache.clear();
}

/**
 * Configuration fingerprint for the runtime cache key.
 *
 * The detection result depends on: per-runtime effective base URLs (config
 * providers/localModels.runtimes overrides), the cliCommands probed, the
 * selected local runtime, and the default provider (drives `configured`).
 * Any change to those inputs changes the fingerprint → automatic invalidation.
 */
export function runtimeFingerprint(): string {
  const { config } = loadConfig();
  const runtimes = (config.localModels as any)?.runtimes ?? {};
  const baseUrls: Record<string, string> = {};
  for (const def of LOCAL_RUNTIMES) {
    const rt = runtimes[def.id];
    const provider = (config.providers as any)?.[def.providerId];
    baseUrls[def.id] = String(rt?.baseUrl ?? provider?.baseUrl ?? def.defaultBaseUrl).replace(/\/$/, "");
  }
  return JSON.stringify({
    baseUrls,
    cli: LOCAL_RUNTIMES.map((d) => d.cliCommands.join(",")),
    localRuntime: (config.localModels as any)?.runtime ?? null,
    defaultProvider: config.defaults.provider,
  });
}

function configuredBaseUrl(def: LocalRuntimeDefinition): string {
  const { config } = loadConfig();
  const provider = (config.providers as any)?.[def.providerId];
  const localRuntime = (config.localModels as any)?.runtimes?.[def.id];
  const raw = localRuntime?.baseUrl ?? provider?.baseUrl ?? def.defaultBaseUrl;
  return String(raw).replace(/\/$/, "");
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/v1$/, "");
}

async function fetchJson(url: string, timeoutMs = DETECT_TIMEOUT_MS): Promise<any | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    return await res.json().catch(() => ({}));
  } catch {
    return undefined;
  }
}

function normalizeModels(json: any): string[] {
  if (!json) return [];
  if (Array.isArray(json.data)) return json.data.map((m: any) => String(m.id ?? m.name ?? "")).filter(Boolean);
  if (Array.isArray(json.models)) return json.models.map((m: any) => String(m.name ?? m.id ?? "")).filter(Boolean);
  return [];
}

async function detectOllama(def: LocalRuntimeDefinition, baseUrl: string): Promise<Partial<LocalRuntimeStatus>> {
  const root = apiRoot(baseUrl);
  // Phase 01 — the two probes run CONCURRENTLY so one runtime is bounded by
  // max(1.5 s, 2.5 s), not their sum (was 1.5 s + 2.5 s = 4 s).
  const [versionJson, tags] = await Promise.all([
    fetchJson(`${root}/api/version`, 1500),
    fetchJson(`${root}/api/tags`, DETECT_TIMEOUT_MS),
  ]);
  const models = normalizeModels(tags);
  return {
    running: Boolean(tags || versionJson),
    healthy: Boolean(tags || versionJson),
    version: versionJson?.version ? String(versionJson.version) : undefined,
    models,
    detail: tags || versionJson ? "Ollama API is reachable" : "Ollama API is not reachable",
  };
}

/**
 * Detect one runtime. Per-operation bound ≈ max(CLI check 1.5 s, API probe
 * 2.5 s) because the two probes run CONCURRENTLY. Never throws for probe
 * failures — every runtime gets a deterministic status row.
 */
export async function detectRuntime(id: LocalRuntimeId): Promise<LocalRuntimeStatus> {
  const def = getRuntimeDefinition(id);
  if (!def) throw new Error(`unknown local runtime: ${id}`);
  const baseUrl = configuredBaseUrl(def);
  const started = Date.now();
  // CLI presence and API reachability are independent — probe in parallel so
  // one runtime is bounded by the slower of the two, not their sum.
  const installedPromise = def.cliCommands.length
    ? commandExists(def.cliCommands[0]!)
    : Promise.resolve(false);

  let installed = false;
  let running = false;
  let healthy = false;
  let models: string[] = [];
  let version: string | undefined;
  let detail = "not detected";

  if (id === "ollama") {
    const [installedFlag, o] = await Promise.all([installedPromise, detectOllama(def, baseUrl)]);
    installed = installedFlag;
    running = Boolean(o.running);
    healthy = Boolean(o.healthy);
    models = o.models ?? [];
    version = o.version;
    detail = o.detail ?? detail;
  } else {
    const [installedFlag, modelJson] = await Promise.all([
      installedPromise,
      fetchJson(`${baseUrl}/models`, DETECT_TIMEOUT_MS),
    ]);
    installed = installedFlag;
    models = normalizeModels(modelJson);
    running = Boolean(modelJson);
    healthy = running;
    detail = running ? "OpenAI-compatible /models endpoint is reachable" : "local API endpoint is not reachable";
  }

  const { config } = loadConfig();
  const configured = (config.localModels as any)?.runtime === id || Boolean((config.localModels as any)?.runtimes?.[id]) || (config.defaults.provider === def.providerId);
  xrMetrics.runtimeDetectionDuration.observe({ runtime: id }, Date.now() - started);

  return {
    id,
    providerId: def.providerId,
    label: def.label,
    baseUrl,
    installed,
    running,
    configured,
    healthy,
    models,
    version,
    detail,
    docsUrl: def.docsUrl,
    installSupport: def.installSupport,
    modelManagement: def.modelManagement,
  };
}

async function detectAllRuntimesUncached(): Promise<LocalRuntimeStatus[]> {
  const statuses = await Promise.all(
    LOCAL_RUNTIMES.map((def) => runtimeProbeLimit.run(() => detectRuntime(def.id))),
  );
  return statuses;
}

/**
 * Detect all local runtimes with bounded parallelism, cached results, and
 * request deduplication. Cache key is configuration-aware (see
 * runtimeFingerprint). Cache disabled via XR_RUNTIME_CACHE=0 — detection then
 * remains bounded-parallel (the old sequential loop is gone for good).
 */
export async function detectAllRuntimes(): Promise<LocalRuntimeStatus[]> {
  if (!runtimeCacheEnabled()) return detectAllRuntimesUncached();
  const key = runtimeFingerprint();
  const result = await runtimeCache.getOrStart(key, detectAllRuntimesUncached);
  return result.value;
}

export async function chooseBestDetectedRuntime(preferred?: LocalRuntimeId): Promise<LocalRuntimeStatus | undefined> {
  const all = await detectAllRuntimes();
  if (preferred) {
    const p = all.find((r) => r.id === preferred && (r.healthy || r.installed || r.configured));
    if (p) return p;
  }
  return all.find((r) => r.healthy && r.models.length > 0)
    ?? all.find((r) => r.healthy)
    ?? all.find((r) => r.installed && r.id === "ollama")
    ?? all.find((r) => r.installed)
    ?? all.find((r) => r.id === "ollama");
}

export async function pullOllamaModel(model: string): Promise<boolean> {
  if (!validateLocalModelId(model)) throw new Error(`unsafe or invalid model id: ${model}`);
  if (!(await commandExists("ollama"))) throw new Error("Ollama CLI is not installed.");
  return await new Promise<boolean>((resolve) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function removeOllamaModel(model: string): Promise<boolean> {
  if (!validateLocalModelId(model)) throw new Error(`unsafe or invalid model id: ${model}`);
  if (!(await commandExists("ollama"))) throw new Error("Ollama CLI is not installed.");
  return await new Promise<boolean>((resolve) => {
    const child = spawn("ollama", ["rm", model], { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function testLocalModel(runtime: LocalRuntimeId, model: string, baseUrl?: string): Promise<LocalModelHealth> {
  if (!validateLocalModelId(model)) return { ok: false, runtime, model, detail: "invalid model id" };
  const def = getRuntimeDefinition(runtime);
  if (!def) return { ok: false, runtime, model, detail: "unknown runtime" };
  const url = (baseUrl ?? configuredBaseUrl(def)).replace(/\/$/, "");
  const start = Date.now();
  try {
    if (runtime === "ollama") {
      const root = apiRoot(url);
      const res = await fetch(`${root}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ model, prompt: "Reply with exactly: OK", stream: false, options: { temperature: 0, num_predict: 8 } }),
      });
      if (!res.ok) return { ok: false, runtime, model, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`, latencyMs: Date.now() - start };
      const json: any = await res.json();
      return { ok: true, runtime, model, detail: String(json.response ?? "model responded").trim().slice(0, 80), latencyMs: Date.now() - start };
    }

    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with exactly: OK" }], temperature: 0, max_tokens: 8, stream: false }),
    });
    if (!res.ok) return { ok: false, runtime, model, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`, latencyMs: Date.now() - start };
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content ?? json?.choices?.[0]?.text ?? "model responded";
    return { ok: true, runtime, model, detail: String(text).trim().slice(0, 80), latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, runtime, model, detail: (e as Error).message, latencyMs: Date.now() - start };
  }
}

export async function installOllamaCommand(): Promise<{ command: string; args: string[]; shell?: boolean } | undefined> {
  if (process.platform === "darwin" && (await commandExists("brew"))) return { command: "brew", args: ["install", "ollama"] };
  if (process.platform === "linux" && (await commandExists("curl"))) return { command: "sh", args: ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], shell: false };
  return undefined;
}

export async function runOllamaInstaller(): Promise<boolean> {
  const cmd = await installOllamaCommand();
  if (!cmd) return false;
  return await new Promise<boolean>((resolve) => {
    const child = spawn(cmd.command, cmd.args, { stdio: "inherit", shell: Boolean(cmd.shell) });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
