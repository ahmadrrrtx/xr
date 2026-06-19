/**
 * XR — Provider Management Interface
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { 
  loadConfig, 
  configPath, 
  XR_HOME, 
  getProviderEnvStatus 
} from "../config/config.ts";
import { setSecret, removeSecret } from "../security/secrets.ts";
import { 
  knownProviders, 
  PRESETS, 
  buildProvider 
} from "../providers/factory.ts";
import { 
  banner, info, ok, warn, ask, confirm, password, colors as C 
} from "./cli.ts";

export async function handleProvidersCommand(args: string[]): Promise<void> {
  const sub = args[0] || "list";
  const target = args[1];

  switch (sub) {
    case "list":
      await listProviders();
      break;
    case "set":
      await setProvider(target);
      break;
    case "add":
      await addProviderKey(target);
      break;
    case "remove":
      await removeProviderKey(target);
      break;
    case "test":
      await testProviders();
      break;
    default:
      warn(`Unknown providers subcommand: ${sub}`);
      console.log(`Usage: xr providers [list|set|add|remove|test]`);
  }
}

async function listProviders() {
  banner();
  const status = getProviderEnvStatus();
  const { config } = loadConfig();

  console.log(`${C.bold("Available Providers")}`);
  console.log(`${C.dim("Primary:")} ${C.green(config.defaults.provider)} ${C.dim("(" + config.defaults.model + ")")}`);
  if (config.defaults.fallbackProvider) {
    console.log(`${C.dim("Fallback:")} ${C.yellow(config.defaults.fallbackProvider)} ${C.dim("(" + (config.defaults.fallbackModel || "default") + ")")}`);
  }
  console.log();

  for (const p of status) {
    const isDefault = p.id === config.defaults.provider;
    const isFallback = p.id === config.defaults.fallbackProvider;
    const marker = isDefault ? C.green(" ● ") : isFallback ? C.yellow(" ○ ") : "   ";
    
    const keyStatus = p.hasKey ? C.green("configured") : (PRESETS[p.id]?.kind === "local" ? C.dim("local") : C.red("missing key"));
    
    console.log(`${marker}${C.bold(p.id.padEnd(12))} ${C.dim(p.tier.padEnd(8))} ${keyStatus.padEnd(20)} ${C.dim(p.label)}`);
  }
  console.log(`\n${C.green("●")} Primary  ${C.yellow("○")} Fallback`);
}

async function setProvider(target?: string) {
  const { config } = loadConfig();
  const providers = knownProviders();

  console.log(`${C.bold("Switch Default Provider")}`);
  const id = target || await ask("Select provider ID", { default: config.defaults.provider });
  
  if (!providers.includes(id)) {
    warn(`Unknown provider: ${id}`);
    return;
  }

  const preset = PRESETS[id];
  const model = await ask(`Select model for ${id}`, { default: preset.defaultModel });

  config.defaults.provider = id;
  config.defaults.model = model;

  const useFallback = await confirm("Configure a fallback provider?", true);
  if (useFallback) {
    const fid = await ask("Select fallback provider ID", { default: "ollama" });
    if (providers.includes(fid)) {
      config.defaults.fallbackProvider = fid;
      config.defaults.fallbackModel = await ask(`Select model for fallback ${fid}`, { default: PRESETS[fid].defaultModel });
    }
  } else {
    config.defaults.fallbackProvider = undefined;
    config.defaults.fallbackModel = undefined;
  }

  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  ok(`Default provider set to ${C.bold(id)} (${model})`);
}

async function addProviderKey(target?: string) {
  const status = getProviderEnvStatus();
  
  console.log(`${C.bold("Add Provider API Key")}`);
  const id = target || await ask("Provider ID");
  const preset = PRESETS[id];

  if (!preset || !preset.apiKeyEnv) {
    warn(`Provider ${id} does not use an API key or is unknown.`);
    return;
  }

  const key = await password(`Enter API key for ${id}:`);
  if (!key) return;

  const backend = setSecret(preset.apiKeyEnv, key);
  process.env[preset.apiKeyEnv] = key;
  if (backend === "file") {
    warn(`Secure OS secret store not available; key saved to ${join(XR_HOME, ".env")} with chmod 600.`);
  } else {
    ok(`API key for ${id} saved in ${backend}.`);
  }
}

async function removeProviderKey(target?: string) {
  console.log(`${C.bold("Remove Provider API Key")}`);
  const id = target || await ask("Provider ID");
  const preset = PRESETS[id];

  if (!preset || !preset.apiKeyEnv) {
    warn(`Provider ${id} is unknown.`);
    return;
  }

  removeSecret(preset.apiKeyEnv);
  ok(`API key for ${id} removed.`);
}

async function testProviders() {
  banner();
  const { config } = loadConfig();
  const providers = getProviderEnvStatus().filter(p => p.hasKey || PRESETS[p.id]?.kind === "local");

  console.log(`${C.bold("Testing Provider Health...")}\n`);

  for (const p of providers) {
    process.stdout.write(`  ${p.id.padEnd(12)} ... `);
    try {
      const provider = buildProvider(config, { provider: p.id, model: PRESETS[p.id].defaultModel });
      const h = await provider.health();
      if (h.ok) {
        console.log(`${C.green("ONLINE")} ${C.dim("(" + (h.latencyMs || "?") + "ms)")}`);
      } else {
        console.log(`${C.red("OFFLINE")} ${C.dim(h.detail || "unknown error")}`);
      }
    } catch (e) {
      console.log(`${C.red("ERROR")} ${C.dim((e as Error).message)}`);
    }
  }
}
