/**
 * XR — Providers Command
 * Manage and inspect LLM providers: list, add, remove, set, test, status, refresh.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { ProviderService } from "../services/provider-service.ts";
import { ConfigService } from "../services/config-service.ts";
import { PRESETS } from "../providers/presets.ts";
import { capabilityLabels } from "../providers/capabilities.ts";
import {
  banner,
  ask,
  confirm,
  info,
  ok,
  warn,
  colors as C,
  password,
} from "../interfaces/cli.ts";

export class ProvidersCommand implements Command {
  name = "providers";
  description = "manage and inspect LLM providers";
  usage = "xr providers [list|add|remove|set|test|status|refresh]";

  async execute(ctx: CommandContext): Promise<void> {
    const { container, args } = ctx;
    const providerService = container.resolve<ProviderService>("providers");
    const configService = container.resolve<ConfigService>("config");
    const sub = args[0] || "status";

    switch (sub) {
      case "list":
        await listProviders(providerService, configService);
        break;
      case "add":
        await addProvider(providerService, args.slice(1));
        break;
      case "remove":
        await removeProvider(providerService, args.slice(1));
        break;
      case "set":
        await setProvider(providerService, args.slice(1));
        break;
      case "test":
        await testProvider(providerService, args.slice(1));
        break;
      case "status":
        await providerStatus(providerService, configService);
        break;
      case "refresh":
        await refreshProviders(providerService);
        break;
      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;
      default:
        warn(`Unknown providers subcommand: ${sub}`);
        printUsage();
    }
  }
}

function printUsage(): void {
  console.log(
    `Usage: xr providers [list|add|remove|set|test|status|refresh]

  ${C.bold("Discover")}
  xr providers list              show all providers and key status
  xr providers status            show active provider and routing
  xr providers test [id]         test provider health (default: all)

  ${C.bold("Change model / provider (never stuck on default)")}
  xr providers set <id> [model]  set active provider and optional model
  xr providers add               add a custom OpenAI-compatible endpoint
  xr providers remove <id>       remove a custom provider
  xr providers refresh           re-sync custom providers from config

  ${C.bold("Examples")}
  xr providers set ollama qwen2.5:7b
  xr providers set openai gpt-4o-mini
  xr providers set anthropic claude-3-5-sonnet-latest

  ${C.bold("Also change via")}
  xr models set <runtime> <model>
  Shell: Alt+P  or  /model <provider> [model]
  Control Center: xr serve → Providers / Models → Change model`,
  );
}

async function listProviders(
  ps: ProviderService,
  cs: ConfigService,
): Promise<void> {
  banner();
  const config = cs.get();
  const activeId = config.defaults.provider;
  const activeModel = config.defaults.model;

  console.log(C.bold("Providers"));
  console.log(C.dim(`  Active: ${activeId} (${activeModel})`));
  console.log(
    C.dim(`  Routing: ${config.providerEngine?.routingStrategy ?? "hybrid"}`),
  );
  console.log("");

  const all = ps.getKnownProviders();
  const custom = config.providerEngine?.customProviders ?? [];

  console.log(C.bold("Built-in Providers"));
  for (const id of all) {
    const preset = PRESETS[id];
    if (!preset) continue;
    const key = ps.getKeyStatus(id);
    const active = id === activeId ? C.green("●") : " ";
    const kind = preset.kind === "local" ? "🏠" : "☁️";
    const tier =
      preset.tier === "free"
        ? "🆓"
        : preset.tier === "cheap"
        ? "💰"
        : preset.tier === "premium"
        ? "💎"
        : "🏢";
    const keyStatus = key.required
      ? key.set
        ? C.green("key set")
        : C.red("key missing")
      : C.dim("no key");
    const caps = capabilityLabels(preset.capabilities).join(", ");
    console.log(
      `  ${active} ${id.padEnd(12)} ${kind} ${tier}  ${keyStatus}`,
    );
    console.log(`     ${C.dim(preset.label)}  [${caps}]`);
  }

  if (custom.length) {
    console.log("");
    console.log(C.bold("Custom Providers"));
    for (const c of custom) {
      const active = c.id === activeId ? C.green("●") : " ";
      console.log(
        `  ${active} ${c.id.padEnd(12)} 🔧  ${c.label}  ${C.dim(c.baseUrl)}`,
      );
    }
  }
  console.log("");
  console.log("");
  console.log(C.bold("Change model anytime"));
  console.log(`  ${C.cyan("xr providers set <id> [model]")}   e.g. xr providers set ollama llama3.2`);
  console.log(`  ${C.cyan("xr models set <runtime> <model>")} local runtime selection`);
  console.log(`  Shell: ${C.cyan("Alt+P")} · ${C.cyan("/model <provider> [model]")}`);
  console.log(`  Control Center: ${C.cyan("xr serve")} → Providers / Models`);

}

async function addProvider(
  ps: ProviderService,
  args: string[],
): Promise<void> {
  banner();
  console.log(C.bold("Add Custom Provider"));
  info(
    "Custom providers are OpenAI-compatible endpoints. You provide the base URL, model name, and optional API key.",
  );

  const id =
    args[0] ||
    (await ask("Provider ID (short, lowercase, no spaces)", {
      default: "custom",
    }));
  const label = await ask("Provider label", { default: id });
  const baseUrl = await ask("Base URL (e.g., http://localhost:8080/v1)", {
    default: "http://localhost:8080/v1",
  });
  const defaultModel = await ask("Default model name", { default: "model" });
  const useKey = await confirm("Does this provider require an API key?", false);
  let apiKeyEnv: string | undefined;
  let apiKeyValue: string | undefined;
  if (useKey) {
    apiKeyEnv = await ask("Environment variable name for the key", {
      default: `${id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_API_KEY`,
    });
    apiKeyValue = await password(
      "Enter API key (will be stored securely):",
    );
  }

  const headers: Record<string, string> = {};
  if (await confirm("Add custom headers?", false)) {
    while (true) {
      const h = await ask("Header name (blank to finish)", { default: "" });
      if (!h) break;
      const v = await ask(`Value for ${h}`);
      headers[h] = v;
    }
  }

  await ps.addCustomProvider({
    id,
    label,
    baseUrl,
    defaultModel,
    apiKeyEnv,
    headers: Object.keys(headers).length ? headers : undefined,
  });

  if (apiKeyEnv && apiKeyValue) {
    const backend = await ps.storeKey(apiKeyEnv, apiKeyValue);
    ok(`Key saved securely in ${backend}.`);
  }

  ok(`Custom provider "${id}" added.`);
  info(`Set it active with: xr providers set ${id}`);
}

async function removeProvider(
  ps: ProviderService,
  args: string[],
): Promise<void> {
  const id = args[0];
  if (!id) {
    warn("Usage: xr providers remove <id>");
    return;
  }
  await ps.removeCustomProvider(id);
  ok(`Custom provider "${id}" removed.`);
}

async function setProvider(
  ps: ProviderService,
  args: string[],
): Promise<void> {
  const id = args[0];
  const model = args[1];
  if (!id) {
    warn("Usage: xr providers set <id> [model]");
    console.log(`  ${C.dim("Examples:")}`);
    console.log(`    xr providers set ollama qwen2.5:7b`);
    console.log(`    xr providers set openai gpt-4o-mini`);
    console.log(`  ${C.dim("List:")} xr providers list`);
    return;
  }
  await ps.setActiveProvider(id, model);
  ok(
    `Active model set to ${id}${model ? ` / ${model}` : ""} (persisted).`,
  );
  console.log(`  ${C.dim("Verify:")} xr providers list · xr models`);
  console.log(`  ${C.dim("Shell:")}   Alt+P or /model ${id}${model ? ` ${model}` : ""}`);
  console.log(`  ${C.dim("Web:")}     xr serve → Providers → Change model`);
}

async function testProvider(
  ps: ProviderService,
  args: string[],
): Promise<void> {
  const id = args[0];
  banner();
  if (id) {
    console.log(C.bold(`Testing provider: ${id}`));
    const report = await ps.checkHealth(id);
    const status = report.ok ? C.green("✓ healthy") : C.red("✗ failed");
    console.log(
      `  ${status}  ${report.detail}${report.latencyMs ? ` (${report.latencyMs}ms)` : ""}`,
    );
    if (!report.ok && !report.authOk) {
      warn(`Authentication failed. Ensure ${report.id} API key is set.`);
    }
  } else {
    console.log(C.bold("Testing all providers..."));
    const reports = await ps.checkAllProviders();
    for (const r of reports) {
      const status = r.ok
        ? C.green("✓")
        : r.authOk
        ? C.amber("!")
        : C.red("✗");
      console.log(
        `  ${r.id.padEnd(12)} ${status}  ${r.detail}${r.latencyMs ? ` (${r.latencyMs}ms)` : ""}`,
      );
    }
  }
  console.log("");
}

async function providerStatus(
  ps: ProviderService,
  cs: ConfigService,
): Promise<void> {
  banner();
  const config = cs.get();
  const activeId = config.defaults.provider;
  const activeModel = config.defaults.model;
  const fallbackId = config.defaults.fallbackProvider;
  const fallbackModel = config.defaults.fallbackModel;
  const strategy = config.providerEngine?.routingStrategy ?? "hybrid";

  console.log(C.bold("Provider Status"));
  console.log(`  active ........... ${C.green(activeId)} (${activeModel})`);
  console.log(
    `  fallback ......... ${fallbackId ? `${fallbackId} (${fallbackModel ?? "default"})` : C.dim("none")}`,
  );
  console.log(`  routing .......... ${strategy}`);
  console.log(
    `  custom providers . ${(config.providerEngine?.customProviders ?? []).length}`,
  );
  console.log();
  console.log(C.bold("Change model"));
  console.log(`  ${C.cyan("xr providers set <id> [model]")}   e.g. xr providers set ollama llama3.2`);
  console.log(`  ${C.cyan("xr models set <runtime> <model>")} local runtime selection`);
  console.log(`  Shell: ${C.cyan("Alt+P")} · ${C.cyan("/model <provider> [model]")}`);
  console.log(`  Control Center: ${C.cyan("xr serve")} → Providers / Models`);

  const report = await ps.checkHealth(activeId, activeModel);
  const status = report.ok ? C.green("✓ healthy") : C.red("✗ failed");
  console.log(
    `  health ........... ${status}  ${report.detail}${report.latencyMs ? ` (${report.latencyMs}ms)` : ""}`,
  );
  console.log("");
}

async function refreshProviders(ps: ProviderService): Promise<void> {
  // Re-sync custom providers from config by touching the provider service.
  ps.getProvider();
  ok("Provider registry refreshed.");
}
