/** XR Stage 4 — local runtime detection, health checks, and safe setup helpers. */
import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "../config/config.ts";
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

function commandExists(cmd: string): boolean {
  if (!cmd) return false;
  const probe = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  const res = spawnSync(probe, args, { stdio: "ignore", shell: process.platform !== "win32", timeout: 1500 });
  return res.status === 0;
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

async function fetchJson(url: string, timeoutMs = 2500): Promise<any | undefined> {
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
  const versionJson = await fetchJson(`${root}/api/version`, 1500);
  const tags = await fetchJson(`${root}/api/tags`, 2500);
  const models = normalizeModels(tags);
  return {
    running: Boolean(tags || versionJson),
    healthy: Boolean(tags || versionJson),
    version: versionJson?.version ? String(versionJson.version) : undefined,
    models,
    detail: tags || versionJson ? "Ollama API is reachable" : "Ollama API is not reachable",
  };
}

export async function detectRuntime(id: LocalRuntimeId): Promise<LocalRuntimeStatus> {
  const def = getRuntimeDefinition(id);
  if (!def) throw new Error(`unknown local runtime: ${id}`);
  const baseUrl = configuredBaseUrl(def);
  const installed = def.cliCommands.some(commandExists);

  let running = false;
  let healthy = false;
  let models: string[] = [];
  let version: string | undefined;
  let detail = "not detected";

  if (id === "ollama") {
    const o = await detectOllama(def, baseUrl);
    running = Boolean(o.running);
    healthy = Boolean(o.healthy);
    models = o.models ?? [];
    version = o.version;
    detail = o.detail ?? detail;
  } else {
    const modelJson = await fetchJson(`${baseUrl}/models`, 2500);
    models = normalizeModels(modelJson);
    running = Boolean(modelJson);
    healthy = running;
    detail = running ? "OpenAI-compatible /models endpoint is reachable" : "local API endpoint is not reachable";
  }

  const { config } = loadConfig();
  const configured = (config.localModels as any)?.runtime === id || Boolean((config.localModels as any)?.runtimes?.[id]) || (config.defaults.provider === def.providerId);

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

export async function detectAllRuntimes(): Promise<LocalRuntimeStatus[]> {
  const statuses: LocalRuntimeStatus[] = [];
  for (const def of LOCAL_RUNTIMES) statuses.push(await detectRuntime(def.id));
  return statuses;
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
  if (!commandExists("ollama")) throw new Error("Ollama CLI is not installed.");
  return await new Promise<boolean>((resolve) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function removeOllamaModel(model: string): Promise<boolean> {
  if (!validateLocalModelId(model)) throw new Error(`unsafe or invalid model id: ${model}`);
  if (!commandExists("ollama")) throw new Error("Ollama CLI is not installed.");
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

export function installOllamaCommand(): { command: string; args: string[]; shell?: boolean } | undefined {
  if (process.platform === "darwin" && commandExists("brew")) return { command: "brew", args: ["install", "ollama"] };
  if (process.platform === "linux" && commandExists("curl")) return { command: "sh", args: ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], shell: false };
  return undefined;
}

export async function runOllamaInstaller(): Promise<boolean> {
  const cmd = installOllamaCommand();
  if (!cmd) return false;
  return await new Promise<boolean>((resolve) => {
    const child = spawn(cmd.command, cmd.args, { stdio: "inherit", shell: Boolean(cmd.shell) });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
