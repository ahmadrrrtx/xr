/** XR v0.5 — local model management CLI. */
import { writeFileSync } from "node:fs";
import { loadConfig, configPath, saveConfig } from "../config/config.ts";
import { banner, ask, confirm, info, ok, warn, colors as C } from "./cli.ts";
import { detectHardwareSpecs, formatHardwareSummary } from "../local/hardware.ts";
import { recommendLocalModel } from "../local/recommend.ts";
import { LOCAL_MODEL_REGISTRY, findLocalModel, validateOllamaModelId } from "../local/registry.ts";
import { ollamaStatus, pullOllamaModel, removeOllamaModel, testOllamaModel } from "../local/ollama.ts";

function usage(): void {
  console.log(`Usage: xr models [list|recommend|install|remove|set|test]\n` +
    `  xr models                 local model status\n` +
    `  xr models list            list supported Ollama models\n` +
    `  xr models recommend       detect hardware and recommend a model\n` +
    `  xr models install [id]    pull a model with Ollama and save it\n` +
    `  xr models remove [id]     remove a pulled Ollama model\n` +
    `  xr models set [id]        select local model and routing\n` +
    `  xr models test [id]       run a local inference smoke test`);
}

export async function handleModelsCommand(args: string[]): Promise<void> {
  const sub = args[0] || "status";
  const target = args[1];
  switch (sub) {
    case "status":
      await statusModels();
      break;
    case "list":
      await listModels();
      break;
    case "recommend":
      await recommendModel();
      break;
    case "install":
      await installModel(target);
      break;
    case "remove":
    case "rm":
      await removeModel(target);
      break;
    case "set":
      await setModel(target);
      break;
    case "test":
      await testModel(target);
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
  const selected = config.localModels.selected ?? config.defaults.fallbackModel ?? config.defaults.model;
  const status = await ollamaStatus(selected);

  console.log(`${C.bold("Local Model Status")}`);
  console.log(`  runtime .......... ${C.cyan(config.localModels.runtime)}`);
  console.log(`  enabled .......... ${config.localModels.enabled ? C.green("yes") : C.dim("no")}`);
  console.log(`  routing .......... ${C.cyan(config.localModels.routing)}`);
  console.log(`  selected ......... ${C.green(selected)}`);
  if (config.localModels.recommendationReason) console.log(`  reason ........... ${C.dim(config.localModels.recommendationReason)}`);
  console.log(`  ollama cli ....... ${status.installed ? C.green("installed") : C.red("missing")}`);
  console.log(`  ollama server .... ${status.running ? C.green("running") : C.red("not running")}`);
  console.log(`  model pulled ..... ${status.models.includes(selected) ? C.green("yes") : C.yellow("no")}`);
  if (status.models.length) console.log(`  pulled models .... ${C.dim(status.models.join(", "))}`);
  if (!status.installed) console.log(`\n${C.dim("Install Ollama from https://ollama.com, then run: xr models install")}`);
}

async function listModels(): Promise<void> {
  banner();
  const { config } = loadConfig();
  const status = await ollamaStatus();
  console.log(`${C.bold("Supported Local Models (Ollama)")}\n`);
  for (const m of LOCAL_MODEL_REGISTRY) {
    const selected = m.id === config.localModels.selected ? C.green("●") : " ";
    const pulled = status.models.includes(m.id) ? C.green("pulled") : C.dim("not pulled");
    console.log(`${selected} ${C.bold(m.id.padEnd(14))} ${String(m.paramsB + "B").padEnd(6)} RAM ${String(m.minRamGb + "/" + m.recommendedRamGb + "GB").padEnd(10)} disk ~${String(m.estimatedDiskGb + "GB").padEnd(6)} ${pulled}`);
    console.log(`    ${C.dim(m.notes)}`);
  }
}

async function recommendModel(): Promise<void> {
  banner();
  const specs = detectHardwareSpecs();
  const rec = recommendLocalModel(specs);
  console.log(`${C.bold("Hardware Detection")}`);
  console.log(`  ${formatHardwareSummary(specs)}\n`);
  console.log(`${C.bold("Recommendation")}`);
  console.log(`  model ............ ${C.green(rec.model.id)} (${rec.model.label})`);
  console.log(`  confidence ....... ${rec.confidence === "high" ? C.green(rec.confidence) : C.yellow(rec.confidence)}`);
  console.log(`  requirements ..... RAM ${rec.model.minRamGb}GB min / ${rec.model.recommendedRamGb}GB recommended, disk ~${rec.model.estimatedDiskGb}GB`);
  console.log(`  why .............. ${rec.reason}\n`);

  if (await confirm("Save this recommendation to XR config?", true)) {
    const { config } = loadConfig();
    config.localModels.enabled = true;
    config.localModels.selected = rec.model.id;
    config.localModels.recommended = rec.model.id;
    config.localModels.recommendationReason = rec.reason;
    if (!config.defaults.fallbackProvider) {
      config.defaults.fallbackProvider = "ollama";
      config.defaults.fallbackModel = rec.model.id;
    }
    saveConfig(config);
    ok(`Saved ${rec.model.id} as local model.`);
  }
}

async function installModel(target?: string): Promise<void> {
  banner();
  const { config } = loadConfig();
  const specs = detectHardwareSpecs();
  const rec = recommendLocalModel(specs);
  const model = target || config.localModels.selected || rec.model.id;
  if (!validateOllamaModelId(model)) {
    warn(`Invalid model id: ${model}`);
    return;
  }

  const known = findLocalModel(model);
  if (known) {
    console.log(`${C.bold("Install Local Model")}`);
    console.log(`  model ............ ${C.green(model)} (${known.label})`);
    console.log(`  requirements ..... RAM ${known.minRamGb}GB min / ${known.recommendedRamGb}GB recommended, disk ~${known.estimatedDiskGb}GB`);
  } else {
    warn(`${model} is not in XR's registry. XR can pull custom Ollama model IDs, but support is not guaranteed.`);
  }

  const status = await ollamaStatus(model);
  if (!status.installed) {
    warn("Ollama CLI is not installed. XR will not run installer scripts automatically.");
    console.log(`  Install from: ${C.cyan("https://ollama.com")}`);
    return;
  }
  if (status.models.includes(model)) ok(`${model} is already pulled.`);
  else {
    if (!await confirm(`Download ${model} with 'ollama pull'?`, true)) return;
    const success = await pullOllamaModel(model);
    if (!success) {
      warn(`Failed to pull ${model}. Try manually: ollama pull ${model}`);
      return;
    }
  }

  config.localModels.enabled = true;
  config.localModels.selected = model;
  config.localModels.installedAt = new Date().toISOString();
  config.localModels.recommended = rec.model.id;
  config.localModels.recommendationReason = known ? rec.reason : `User selected custom Ollama model ${model}.`;
  config.defaults.fallbackProvider = "ollama";
  config.defaults.fallbackModel = model;
  if (config.defaults.provider === "ollama") config.defaults.model = model;
  saveConfig(config);
  ok(`Configured ${model} as local model and Ollama fallback.`);

  if (await confirm("Run a quick model test now?", true)) await testModel(model);
}

async function removeModel(target?: string): Promise<void> {
  const { config } = loadConfig();
  const model = target || config.localModels.selected || await ask("Model to remove");
  if (!model || !validateOllamaModelId(model)) {
    warn("Invalid model id.");
    return;
  }
  if (!await confirm(`Remove local model ${model} with 'ollama rm'?`, false)) return;
  const okRm = await removeOllamaModel(model);
  if (!okRm) {
    warn(`Could not remove ${model}.`);
    return;
  }
  if (config.localModels.selected === model) {
    config.localModels.selected = undefined;
    config.localModels.installedAt = undefined;
    if (config.defaults.provider === "ollama") config.defaults.model = config.localModels.recommended ?? "qwen2.5:7b";
    if (config.defaults.fallbackModel === model) config.defaults.fallbackModel = config.localModels.recommended ?? "qwen2.5:7b";
    saveConfig(config);
  }
  ok(`Removed ${model}.`);
}

async function setModel(target?: string): Promise<void> {
  const { config } = loadConfig();
  const rec = recommendLocalModel(detectHardwareSpecs());
  const model = target || await ask("Local Ollama model", { default: config.localModels.selected || rec.model.id });
  if (!validateOllamaModelId(model)) {
    warn("Invalid model id.");
    return;
  }

  console.log(`\n${C.bold("Routing")}`);
  console.log(`  [1] local-only  — use Ollama as primary, no cloud keys required`);
  console.log(`  [2] hybrid      — use selected primary, local fallback enabled`);
  console.log(`  [3] cloud-first — keep cloud primary, local fallback enabled`);
  const choice = await ask("Select routing", { default: config.defaults.provider === "ollama" ? "1" : "2" });
  const routing = choice === "1" ? "local-only" : choice === "3" ? "cloud-first" : "hybrid";

  config.localModels.enabled = true;
  config.localModels.selected = model;
  config.localModels.routing = routing;
  if (routing === "local-only") {
    config.defaults.provider = "ollama";
    config.defaults.model = model;
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel = undefined;
  } else {
    config.defaults.fallbackProvider = "ollama";
    config.defaults.fallbackModel = model;
  }
  saveConfig(config);
  ok(`Local model set to ${model} (${routing}).`);
}

async function testModel(target?: string): Promise<void> {
  const { config } = loadConfig();
  const model = target || config.localModels.selected || config.defaults.fallbackModel || config.defaults.model;
  if (!model || !validateOllamaModelId(model)) {
    warn("Invalid model id.");
    return;
  }
  const status = await ollamaStatus(model);
  console.log(`${C.bold("Local Model Test")}`);
  console.log(`  ollama cli ....... ${status.installed ? C.green("installed") : C.red("missing")}`);
  console.log(`  ollama server .... ${status.running ? C.green("running") : C.red("not running")}`);
  console.log(`  model pulled ..... ${status.models.includes(model) ? C.green("yes") : C.yellow("no")}`);
  if (!status.running) {
    warn("Start Ollama first: ollama serve");
    return;
  }
  const res = await testOllamaModel(model);
  if (res.ok) ok(`${model} responded in ${res.latencyMs}ms: ${res.detail}`);
  else warn(`${model} test failed: ${res.detail}`);
}
