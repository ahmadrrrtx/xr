/** XR v0.5 — safe Ollama runtime adapter. */
import { spawn, spawnSync } from "node:child_process";
import { validateOllamaModelId } from "./registry.ts";

export interface OllamaModelStatus {
  installed: boolean;
  running: boolean;
  models: string[];
  detail?: string;
}

export function ollamaInstalled(): boolean {
  const cmd = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? ["ollama"] : ["-v", "ollama"];
  const res = spawnSync(cmd, args, { stdio: "ignore", shell: process.platform !== "win32", timeout: 2000 });
  return res.status === 0;
}

export async function ollamaRunning(baseUrl = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(baseUrl = "http://localhost:11434"): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const json: any = await res.json();
    return Array.isArray(json.models) ? json.models.map((m: any) => String(m.name)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function ollamaStatus(model?: string): Promise<OllamaModelStatus> {
  const installed = ollamaInstalled();
  const running = await ollamaRunning();
  const models = running ? await listOllamaModels() : [];
  return {
    installed,
    running,
    models,
    detail: model ? (models.includes(model) ? `${model} is pulled` : `${model} is not pulled`) : undefined,
  };
}

export async function pullOllamaModel(model: string): Promise<boolean> {
  if (!validateOllamaModelId(model)) throw new Error(`unsafe or invalid Ollama model id: ${model}`);
  if (!ollamaInstalled()) throw new Error("Ollama CLI is not installed. Install it from https://ollama.com first.");

  return await new Promise<boolean>((resolve) => {
    const child = spawn("ollama", ["pull", model], { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function removeOllamaModel(model: string): Promise<boolean> {
  if (!validateOllamaModelId(model)) throw new Error(`unsafe or invalid Ollama model id: ${model}`);
  if (!ollamaInstalled()) throw new Error("Ollama CLI is not installed.");

  return await new Promise<boolean>((resolve) => {
    const child = spawn("ollama", ["rm", model], { stdio: "inherit", shell: false });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

export async function testOllamaModel(model: string): Promise<{ ok: boolean; detail: string; latencyMs?: number }> {
  if (!validateOllamaModelId(model)) return { ok: false, detail: "invalid model id" };
  const start = Date.now();
  try {
    const res = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model, prompt: "Reply with exactly: OK", stream: false, options: { temperature: 0 } }),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const json: any = await res.json();
    return { ok: true, detail: String(json.response ?? "").trim().slice(0, 80) || "model responded", latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, detail: (e as Error).message, latencyMs: Date.now() - start };
  }
}
