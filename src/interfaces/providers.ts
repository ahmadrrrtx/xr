/**
 * XR Stage 5 — Provider Management Interface
 *
 * Redesigned for Stage 5:
 *  - Uses new layout/theme system
 *  - StepTracker for batch provider test
 *  - Table output for provider list
 *  - Better empty states and error messages
 *  - Explicit security notes in key management
 *  - No API keys ever printed to terminal
 */

import { writeFileSync } from "node:fs";
import { loadConfig, configPath, XR_HOME, getProviderEnvStatus } from "../config/config.ts";
import { setSecret, removeSecret } from "../security/secrets.ts";
import { knownProviders, PRESETS, buildProvider } from "../providers/factory.ts";
import { banner, info, ok, warn, ask, confirm, password, colors as C } from "./cli.ts";
import { StepTracker } from "../ui/spinner.ts";
import { xrCyan, xrGreen, xrAmber, xrRed, xrDim, xrBold, SYM } from "../ui/theme.ts";
import { section, kv, divider, table, emptyState, notify, badge } from "../ui/layout.ts";

export async function handleProvidersCommand(args: string[]): Promise<void> {
  const sub    = args[0] ?? "list";
  const target = args[1];

  switch (sub) {
    case "list":   await listProviders();           break;
    case "set":    await setProvider(target, args[2]); break;
    case "add":    await addProviderKey(target);    break;
    case "remove": await removeProviderKey(target); break;
    case "test":   await testProviders();           break;
    case "status": await listProviders();           break;
    case "help":
    case "--help":
    case "-h":
      printProvidersUsage();
      break;
    default:
      warn(`Unknown subcommand: ${sub}`);
      printProvidersUsage();
  }
}

function printProvidersUsage(): void {
  console.log(`Usage: xr providers [list|set|add|remove|test|status]

  ${xrBold("Discover")}
  xr providers list                 all providers + key status + primary
  xr providers status               same as list
  xr providers test                 health-check configured providers

  ${xrBold("Change model / provider (never stuck on default)")}
  xr providers set <id> [model]     set primary provider and model
  xr providers add [id]             store API key securely (BYOK)
  xr providers remove <id>          remove stored API key

  ${xrBold("Examples")}
  xr providers set ollama qwen2.5:7b
  xr providers set openai gpt-4o-mini
  xr providers set anthropic claude-3-5-sonnet-latest
  xr providers add openai

  ${xrBold("Also change via")}
  xr models set <runtime> <model>   local runtime selection
  Shell: Alt+P  or  /model <provider> [model]
  Control Center: xr serve → Providers / Models`);
}

// ── List Providers ────────────────────────────────────────────────────────────

async function listProviders(): Promise<void> {
  banner();
  const status = getProviderEnvStatus();
  const { config } = loadConfig();

  section("Provider Status");
  console.log();

  kv("Primary",  config.defaults.provider + " / " + config.defaults.model, "ok");
  if (config.defaults.fallbackProvider) {
    kv("Fallback", config.defaults.fallbackProvider + " / " + (config.defaults.fallbackModel ?? "default"), "dim");
  }
  kv("Routing",  (config.localModels as any)?.routing ?? "hybrid", "cyan");
  console.log();

  // Table
  table(
    ["", "Provider", "Tier", "Status", "Description"],
    status.map(p => {
      const isPrimary  = p.id === config.defaults.provider;
      const isFallback = p.id === config.defaults.fallbackProvider;
      const marker     = isPrimary ? xrGreen("●") : isFallback ? xrAmber("○") : " ";
      const keyStatus  = p.hasKey ? xrGreen("configured")
                       : PRESETS[p.id]?.kind === "local" ? xrDim("local (no key)")
                       : xrRed("missing key");
      return [marker, xrBold(p.id), xrDim(p.tier), keyStatus, xrDim(p.label)];
    }),
    { widths: [3, 14, 10, 18, 30] },
  );

  console.log();
  console.log(`  ${xrGreen("●")} Primary  ${xrAmber("○")} Fallback  ${xrDim("  Tip: xr providers test — test all live")}`);
  console.log();
  console.log(`  ${xrBold("Change model")}`);
  console.log(`    ${xrCyan("xr providers set <id> [model]")}   e.g. xr providers set ollama llama3.2`);
  console.log(`    ${xrCyan("xr models set <runtime> <model>")} local runtime selection`);
  console.log(`    Shell: ${xrCyan("Alt+P")} · ${xrCyan("/model <provider> [model]")}`);
  console.log(`    Control Center: ${xrCyan("xr serve")} → Providers / Models → Change model`);
  console.log();
}

// ── Set Provider ──────────────────────────────────────────────────────────────

async function setProvider(target?: string, modelArg?: string): Promise<void> {
  banner();
  section("Change model / provider");
  console.log(`  ${xrDim("Updates primary route immediately. Shell status bar and Control Center pick it up.")}`);
  console.log();

  const { config } = loadConfig();
  const providers  = knownProviders();

  const id = target ?? await ask("Select provider ID", { default: config.defaults.provider });
  if (!providers.includes(id)) {
    warn(`Unknown provider: ${id}`);
    console.log(`  ${xrDim("Available:")} ${providers.join(", ")}`);
    console.log(`  ${xrDim("Tip:")} xr providers list`);
    return;
  }

  const preset = PRESETS[id]!;
  const model  = modelArg
    ?? await ask(`Model for ${xrCyan(id)}`, { default: preset.defaultModel ?? config.defaults.model });

  config.defaults.provider = id;
  config.defaults.model    = model;

  // Align local selection when primary is local
  if (PRESETS[id]?.kind === "local" || id === "ollama" || id === "lmstudio" || id === "jan" || id === "localai" || id === "vllm") {
    const local: any = config.localModels ?? {};
    local.enabled = true;
    local.selected = model;
    local.provider = id;
    config.localModels = local;
  }

  if (await confirm("Configure a fallback provider?", true)) {
    const fid = await ask("Fallback provider ID", { default: config.defaults.fallbackProvider ?? "ollama" });
    if (providers.includes(fid)) {
      config.defaults.fallbackProvider = fid;
      config.defaults.fallbackModel    = await ask(
        `Model for fallback ${xrCyan(fid)}`,
        { default: config.defaults.fallbackModel ?? PRESETS[fid]?.defaultModel },
      );
    }
  } else {
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel    = undefined;
  }

  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  ok(`Active model set to ${xrCyan(id)} / ${xrBold(model)}`);
  console.log();
  console.log(`  ${xrDim("Verify:")} ${xrCyan("xr providers list")} · ${xrCyan("xr models")}`);
  console.log(`  ${xrDim("Shell:")}   Alt+P or /model ${id} ${model}`);
  console.log(`  ${xrDim("Web:")}     xr serve → Providers → Save Routing Policy`);
  console.log();
}

// ── Add Provider Key ──────────────────────────────────────────────────────────

async function addProviderKey(target?: string): Promise<void> {
  banner();
  section("Add Provider API Key");

  console.log(`  ${SYM.secure} ${xrDim("Keys are stored in your OS keychain or encrypted file.")}`);
  console.log(`  ${SYM.secure} ${xrDim("Keys are redacted from all audit logs.")}`);
  console.log(`  ${SYM.secure} ${xrDim("Keys are never sent anywhere except the provider's API.")}`);
  console.log();

  const id     = target ?? await ask("Provider ID");
  const preset = PRESETS[id];

  if (!preset || !preset.apiKeyEnv) {
    warn(`Provider ${id} does not use an API key or is unknown.`);
    return;
  }

  const key = await password(`API key for ${xrBold(id)}:`);
  if (!key) { warn("No key entered."); return; }

  const backend = setSecret(preset.apiKeyEnv, key);
  process.env[preset.apiKeyEnv] = key;

  if (backend === "file") {
    warn(`OS keychain not available — key saved to ${XR_HOME}/.env (chmod 600).`);
  } else {
    ok(`API key for ${xrCyan(id)} saved in ${backend}.`);
  }
}

// ── Remove Provider Key ───────────────────────────────────────────────────────

async function removeProviderKey(target?: string): Promise<void> {
  section("Remove Provider API Key");

  const id     = target ?? await ask("Provider ID");
  const preset = PRESETS[id];

  if (!preset || !preset.apiKeyEnv) {
    warn(`Provider ${id} is unknown.`);
    return;
  }

  if (!await confirm(`Remove API key for ${xrCyan(id)}?`, false)) return;

  removeSecret(preset.apiKeyEnv);
  delete process.env[preset.apiKeyEnv];
  ok(`API key for ${xrCyan(id)} removed.`);
}

// ── Test Providers ────────────────────────────────────────────────────────────

async function testProviders(): Promise<void> {
  banner();
  section("Provider Health Tests");

  const { config } = loadConfig();
  const candidates = getProviderEnvStatus().filter(
    p => p.hasKey || PRESETS[p.id]?.kind === "local"
  );

  if (!candidates.length) {
    emptyState("configured providers", "Run: xr providers add <id>");
    return;
  }

  const tracker = new StepTracker();
  for (const p of candidates) {
    tracker.addStep(p.id, p.id.padEnd(14) + " " + xrDim(p.label));
  }
  tracker.start();

  const results: { id: string; ok: boolean; ms?: number; detail?: string }[] = [];

  for (const p of candidates) {
    tracker.setStatus(p.id, "running");
    try {
      const provider = buildProvider(config, { provider: p.id, model: PRESETS[p.id]?.defaultModel });
      const h        = await provider.health();
      results.push({ id: p.id, ok: h.ok, ms: h.latencyMs, detail: h.detail });
      tracker.setStatus(p.id, h.ok ? "done" : "error", h.ok ? `${h.latencyMs ?? "?"}ms` : h.detail ?? "offline");
    } catch (e) {
      results.push({ id: p.id, ok: false, detail: (e as Error).message });
      tracker.setStatus(p.id, "error", (e as Error).message.slice(0, 50));
    }
  }

  tracker.finish();
  console.log();

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  if (failed === 0) {
    ok(`All ${passed} providers online.`);
  } else {
    warn(`${passed} online, ${failed} offline.`);
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  ${SYM.error} ${xrRed(r.id)} ${xrDim(r.detail ?? "")}`);
    }
    console.log(`  ${xrDim("Tip: xr providers add <id> to configure a missing key.")}`);
  }
  console.log();
}
