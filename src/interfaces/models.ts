/** XR Stage 4 — local AI model and runtime management CLI. */
import { loadConfig, saveConfig } from "../config/config.ts";
import { banner, ask, confirm, ok, warn, colors as C } from "./cli.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalAI } from "../local/recommend.ts";
import {
  LOCAL_MODEL_REGISTRY,
  LOCAL_RUNTIMES,
  findLocalModel,
  getRuntimeDefinition,
  isLocalRuntimeId,
  modelNameForRuntime,
  providerIdForRuntime,
  type LocalRuntimeId,
  type LocalUseCase,
  validateLocalModelId,
} from "../local/registry.ts";
import {
  detectAllRuntimes,
  detectRuntime,
  pullOllamaModel,
  removeOllamaModel,
  runOllamaInstaller,
  testLocalModel,
} from "../local/runtimes.ts";

function usage(): void {
  console.log(`Usage: xr models [status|list|runtimes|recommend|install|remove|set|test]\n` +
    `  xr models                         local AI status\n` +
    `  xr models list                    list recommended model families\n` +
    `  xr models runtimes                detect local runtimes and API servers\n` +
    `  xr models recommend [use-case]    recommend runtime/model for this machine\n` +
    `  xr models install [model]         install/pull via the selected runtime when supported\n` +
    `  xr models remove [model]          remove Ollama model when supported\n` +
    `  xr models set <runtime> <model>   select local runtime/model\n` +
    `  xr models test [model]            run a local inference smoke test\n` +
    `\nUse cases: general, coding, reasoning, summarization, research, embeddings, voice`);
}

function symbol(okState: boolean, warnState = false): string {
  return okState ? C.green("✓") : warnState ? C.amber("!") : C.red("✗");
}

function parseUseCase(v?: string): LocalUseCase {
  const allowed = ["general", "coding", "reasoning", "summarization", "research", "embeddings", "voice"];
  return (allowed.includes(String(v)) ? v : "general") as LocalUseCase;
}

export async function handleModelsCommand(args: string[]): Promise<void> {
  const sub = args[0] || "status";
  switch (sub) {
    case "status":
      await statusModels();
      break;
    case "list":
    case "ls":
      await listModels();
      break;
    case "runtimes":
      await listRuntimes();
      break;
    case "recommend":
      await recommendModel(parseUseCase(args[1]));
      break;
    case "install":
      await installModel(args[1], args);
      break;
    case "remove":
    case "rm":
      await removeModel(args[1]);
      break;
    case "set":
      await setModel(args[1], args[2]);
      break;
    case "test":
      await testModel(args[1]);
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      warn(`Unknown models subcommand: ${sub}`);
      usage();
  }
}

async function statusModels(): Promise<void> {
  banner();
  const { config } = loadConfig();
  const local: any = config.localModels;
  const runtime = (local.runtime ?? "ollama") as LocalRuntimeId;
  const status = await detectRuntime(runtime);
  const selected = local.selected ?? config.defaults.model;
  const installed = Array.isArray(local.installed) ? local.installed : [];
  const selectedRecord = installed.find((m: any) => m.runtime === runtime && m.model === selected);

  console.log(`${C.bold("Local AI Status")}`);
  console.log(`  enabled .......... ${local.enabled ? C.green("yes") : C.dim("no")}`);
  console.log(`  routing .......... ${C.cyan(local.routing ?? "hybrid")}`);
  console.log(`  runtime .......... ${C.cyan(status.label)} (${status.id})`);
  console.log(`  provider ......... ${C.cyan(local.provider ?? status.providerId)}`);
  console.log(`  endpoint ......... ${C.dim(status.baseUrl)}`);
  console.log(`  selected model ... ${selected ? C.green(selected) : C.yellow("none")}`);
  if (local.recommendationReason) console.log(`  reason ........... ${C.dim(String(local.recommendationReason).slice(0, 240))}`);
  console.log(`  installed ........ ${symbol(status.installed, status.id !== "ollama")} ${status.installed ? "CLI/app found" : "CLI/app not found"}`);
  console.log(`  running .......... ${symbol(status.running, !local.enabled)} ${status.detail}`);
  console.log(`  configured ....... ${status.configured ? C.green("yes") : C.dim("no")}`);
  console.log(`  model known ...... ${selectedRecord?.downloaded || status.models.includes(selected) ? C.green("yes") : C.yellow("not verified")}`);
  if (status.models.length) console.log(`  runtime models ... ${C.dim(status.models.slice(0, 8).join(", ") + (status.models.length > 8 ? " …" : ""))}`);
  if (!status.running && local.enabled) {
    console.log(`\n${C.bold("Next step")}`);
    if (status.id === "ollama") console.log(`  Start Ollama, or run ${C.cyan("xr models install")} to let XR guide setup.`);
    else console.log(`  Start ${status.label} and enable its local API server, then run ${C.cyan("xr models runtimes")}.`);
  }
}

async function listRuntimes(): Promise<void> {
  banner();
  const statuses = await detectAllRuntimes();
  console.log(`${C.bold("Local Runtime Detection")}\n`);
  for (const r of statuses) {
    const state = r.healthy ? C.green("ready") : r.running ? C.amber("running") : r.installed ? C.amber("installed") : C.dim("not found");
    console.log(`${C.bold(r.id.padEnd(13))} ${state.padEnd(18)} ${r.label}`);
    console.log(`  endpoint: ${C.dim(r.baseUrl)}  models: ${r.models.length ? C.dim(r.models.slice(0, 5).join(", ")) : C.dim("none detected")}`);
    console.log(`  setup: ${r.installSupport}, model management: ${r.modelManagement}`);
  }
}

async function listModels(): Promise<void> {
  banner();
  const { config } = loadConfig();
  const selected = (config.localModels as any).selected;
  console.log(`${C.bold("Recommended Local Model Families")}\n`);
  for (const m of LOCAL_MODEL_REGISTRY) {
    const mark = selected === m.ollamaId || selected === m.id ? C.green("●") : " ";
    const runtimeNames = m.runtimeIds.slice(0, 5).join(", ") + (m.runtimeIds.length > 5 ? " …" : "");
    console.log(`${mark} ${C.bold((m.ollamaId ?? m.id).padEnd(22))} ${String(m.paramsB + "B").padEnd(7)} RAM ${String(m.minRamGb + "/" + m.recommendedRamGb + "GB").padEnd(10)} disk ~${String(m.estimatedDiskGb + "GB").padEnd(6)}`);
    console.log(`    ${C.dim(m.notes)}`);
    console.log(`    ${C.dim("use: " + m.useCases.join(", ") + " | runtimes: " + runtimeNames)}`);
  }
}

async function recommendModel(useCase: LocalUseCase): Promise<void> {
  banner();
  const specs = detectHardwareSpecs();
  const runtimes = await detectAllRuntimes();
  const rec = recommendLocalAI(specs, { useCase, runtimes });
  console.log(`${C.bold("Hardware Detection")}`);
  console.log(`  ${formatHardwareSummary(specs)}`);
  console.log(`  ${C.dim(specs.suitability.reason)}\n`);
  console.log(`${C.bold("Recommendation")}`);
  console.log(`  runtime .......... ${C.green(getRuntimeDefinition(rec.runtime)?.label ?? rec.runtime)} (${rec.runtime})`);
  console.log(`  model ............ ${C.green(rec.runtimeModel)} (${rec.model.label})`);
  console.log(`  use case ......... ${C.cyan(useCase)}`);
  console.log(`  confidence ....... ${rec.confidence === "high" ? C.green(rec.confidence) : C.yellow(rec.confidence)}`);
  console.log(`  requirements ..... RAM ${rec.model.minRamGb}GB min / ${rec.model.recommendedRamGb}GB recommended, disk ~${rec.model.estimatedDiskGb}GB`);
  console.log(`  why .............. ${rec.reason}`);
  console.log(`  next ............. ${rec.nextAction}\n`);

  if (await confirm("Save this local AI recommendation to XR config?", true)) {
    const { config } = loadConfig();
    const local: any = config.localModels;
    local.enabled = true;
    local.runtime = rec.runtime;
    local.provider = rec.providerId;
    local.selected = rec.runtimeModel;
    local.recommended = rec.runtimeModel;
    local.recommendationReason = rec.reason;
    local.useCase = useCase;
    local.runtimes = local.runtimes ?? {};
    const status = runtimes.find((r) => r.id === rec.runtime);
    local.runtimes[rec.runtime] = { providerId: rec.providerId, baseUrl: status?.baseUrl, installed: status?.installed, running: status?.running, configured: true, healthy: status?.healthy, lastCheckedAt: new Date().toISOString(), detail: status?.detail };
    config.defaults.fallbackProvider = rec.providerId;
    config.defaults.fallbackModel = rec.runtimeModel;
    saveConfig(config);
    ok(`Saved ${rec.runtimeModel} on ${rec.runtime}.`);
  }
}

async function installModel(target?: string, args: string[] = []): Promise<void> {
  banner();
  const yes = args.includes("--yes") || args.includes("-y");
  const { config } = loadConfig();
  const local: any = config.localModels;
  const specs = detectHardwareSpecs();
  const runtimes = await detectAllRuntimes();
  const rec = recommendLocalAI(specs, { useCase: local.useCase ?? "general", preferredRuntime: local.runtime, runtimes });
  const runtime = (local.runtime ?? rec.runtime) as LocalRuntimeId;
  const model = target || local.selected || rec.runtimeModel;
  const status = await detectRuntime(runtime);

  if (!validateLocalModelId(model)) {
    warn(`Invalid model id: ${model}`);
    return;
  }

  console.log(`${C.bold("Install Local AI")}`);
  console.log(`  runtime .......... ${C.green(status.label)} (${runtime})`);
  console.log(`  model ............ ${C.green(model)}`);
  console.log(`  endpoint ......... ${C.dim(status.baseUrl)}`);

  if (runtime !== "ollama") {
    warn(`${status.label} model download is managed by the runtime, not by XR.`);
    console.log(`  1. Open/start ${status.label}.`);
    console.log(`  2. Download or load a model in that app/server.`);
    console.log(`  3. Enable its local OpenAI-compatible API server.`);
    console.log(`  4. Run: ${C.cyan(`xr models set ${runtime} <model-name>`)}.`);
    console.log(`  Docs: ${C.cyan(status.docsUrl)}`);
    if (status.running && status.models.length && await confirm(`Use detected model '${status.models[0]}' now?`, true)) {
      await saveSelection(runtime, status.models[0], status.baseUrl, true);
    }
    return;
  }

  if (!status.installed) {
    warn("Ollama is not installed. XR can run the official installer only with your approval.");
    if (!(yes || await confirm("Install Ollama now? This may require system permissions.", false))) {
      console.log(`  Install manually from ${C.cyan("https://ollama.com")}, then run ${C.cyan("xr models install")}.`);
      return;
    }
    const okInstall = await runOllamaInstaller();
    if (!okInstall) {
      warn("Ollama install did not complete. Install manually from https://ollama.com.");
      return;
    }
  }

  const before = await detectRuntime("ollama");
  if (!before.models.includes(model)) {
    const known = findLocalModel(model);
    if (known) console.log(`  download size .... about ${known.estimatedDiskGb}GB (${known.quantization ?? "runtime default"})`);
    if (!(yes || await confirm(`Download ${model} with 'ollama pull'?`, true))) return;
    const success = await pullOllamaModel(model);
    if (!success) {
      warn(`Failed to pull ${model}. Try manually: ollama pull ${model}`);
      return;
    }
  } else ok(`${model} is already downloaded.`);

  await saveSelection("ollama", model, "http://localhost:11434/v1", true);
  const test = await testLocalModel("ollama", model, "http://localhost:11434/v1");
  if (test.ok) ok(`Local model responded in ${test.latencyMs}ms: ${test.detail}`);
  else warn(`Model installed but smoke test failed: ${test.detail}`);
}

async function saveSelection(runtime: LocalRuntimeId, model: string, baseUrl?: string, downloaded = false): Promise<void> {
  const def = getRuntimeDefinition(runtime)!;
  const { config } = loadConfig();
  const local: any = config.localModels;
  local.enabled = true;
  local.runtime = runtime;
  local.provider = def.providerId;
  local.selected = model;
  local.installedAt = new Date().toISOString();
  local.routing = local.routing ?? "hybrid";
  local.runtimes = local.runtimes ?? {};
  local.runtimes[runtime] = { providerId: def.providerId, baseUrl: baseUrl ?? def.defaultBaseUrl, configured: true, installed: true, running: true, healthy: downloaded, lastCheckedAt: new Date().toISOString() };
  local.installed = Array.isArray(local.installed) ? local.installed : [];
  const spec = findLocalModel(model);
  const record = {
    id: spec?.id ?? model,
    runtime,
    providerId: def.providerId,
    model,
    family: spec?.family ?? ["general"],
    source: runtime,
    sizeGb: spec?.estimatedDiskGb,
    quantization: spec?.quantization,
    downloaded,
    configured: true,
    healthy: downloaded,
    baseUrl: baseUrl ?? def.defaultBaseUrl,
    installedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  };
  local.installed = local.installed.filter((m: any) => !(m.runtime === runtime && m.model === model));
  local.installed.push(record);

  if (local.routing === "local-only") {
    config.defaults.provider = def.providerId;
    config.defaults.model = model;
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel = undefined;
  } else {
    config.defaults.fallbackProvider = def.providerId;
    config.defaults.fallbackModel = model;
    if (config.defaults.provider === def.providerId) config.defaults.model = model;
  }
  (config.providers as any)[def.providerId] = { ...((config.providers as any)[def.providerId] ?? {}), baseUrl: baseUrl ?? def.defaultBaseUrl };
  saveConfig(config);
  ok(`XR will use ${model} via ${def.label}.`);
}

async function removeModel(target?: string): Promise<void> {
  banner();
  const { config } = loadConfig();
  const local: any = config.localModels;
  const runtime = (local.runtime ?? "ollama") as LocalRuntimeId;
  const model = target || local.selected || await ask("Model to remove");
  if (!validateLocalModelId(model)) {
    warn(`Invalid model id: ${model}`);
    return;
  }
  if (runtime !== "ollama") {
    warn(`XR cannot safely delete models managed by ${runtime}. Remove it in that runtime's UI/storage.`);
    return;
  }
  if (!await confirm(`Remove local model ${model} with 'ollama rm'?`, false)) return;
  const success = await removeOllamaModel(model);
  if (!success) {
    warn(`Failed to remove ${model}.`);
    return;
  }
  local.installed = (local.installed ?? []).filter((m: any) => !(m.runtime === runtime && m.model === model));
  if (local.selected === model) local.selected = undefined;
  if (config.defaults.model === model && config.defaults.provider === "ollama") config.defaults.model = local.recommended ?? "qwen2.5:7b";
  if (config.defaults.fallbackModel === model) config.defaults.fallbackModel = local.recommended ?? "qwen2.5:7b";
  saveConfig(config);
  ok(`Removed ${model}.`);
}

async function setModel(runtimeArg?: string, modelArg?: string): Promise<void> {
  banner();
  const runtimeInput = runtimeArg || await ask("Local runtime", { default: "ollama" });
  if (!isLocalRuntimeId(runtimeInput)) {
    warn(`Unknown local runtime: ${runtimeInput}`);
    console.log(`Supported: ${LOCAL_RUNTIMES.map((r) => r.id).join(", ")}`);
    return;
  }
  const runtime = runtimeInput;
  const status = await detectRuntime(runtime);
  const defaultModel = modelArg || status.models[0] || modelNameForRuntime(LOCAL_MODEL_REGISTRY[2], runtime);
  const model = modelArg || await ask("Model name as shown by the runtime", { default: defaultModel });
  if (!validateLocalModelId(model)) {
    warn(`Invalid model id: ${model}`);
    return;
  }
  console.log(`\nRouting choices:`);
  console.log(`  1) Local only — no cloud fallback, no API key needed`);
  console.log(`  2) Hybrid — use your primary provider with this local model as fallback`);
  console.log(`  3) Cloud first — keep cloud primary; local only when selected/fallback`);
  const choice = await ask("Select routing", { default: "2" });
  const { config } = loadConfig();
  (config.localModels as any).routing = choice.trim() === "1" ? "local-only" : choice.trim() === "3" ? "cloud-first" : "hybrid";
  saveConfig(config);
  await saveSelection(runtime, model, status.baseUrl, status.models.includes(model));
}

async function testModel(target?: string): Promise<void> {
  banner();
  const { config } = loadConfig();
  const local: any = config.localModels;
  const runtime = (local.runtime ?? "ollama") as LocalRuntimeId;
  const model = target || local.selected || config.defaults.model;
  if (!validateLocalModelId(model)) {
    warn(`Invalid model id: ${model}`);
    return;
  }
  const status = await detectRuntime(runtime);
  console.log(`${C.bold("Local Model Smoke Test")}`);
  console.log(`  runtime .......... ${status.label}`);
  console.log(`  endpoint ......... ${C.dim(status.baseUrl)}`);
  console.log(`  model ............ ${C.green(model)}`);
  if (!status.running) {
    warn(`${status.label} is not running. Start it first, then rerun this command.`);
    return;
  }
  const result = await testLocalModel(runtime, model, status.baseUrl);
  if (result.ok) ok(`Model responded in ${result.latencyMs}ms: ${result.detail}`);
  else warn(`Model test failed: ${result.detail}`);

  const { config: latest } = loadConfig();
  const l: any = latest.localModels;
  l.installed = Array.isArray(l.installed) ? l.installed : [];
  for (const rec of l.installed) {
    if (rec.runtime === runtime && rec.model === model) {
      rec.healthy = result.ok;
      rec.lastCheckedAt = new Date().toISOString();
      rec.detail = result.detail;
    }
  }
  saveConfig(latest);
}
