/**
 * Phase 23 — first-run setup and the two terminal confirmations the coder needs.
 *
 *   - The wizard picks a provider and model, and stores any API key through the
 *     engine's ProviderService.storeKey (OS keychain, or the encrypted file when
 *     no keychain exists). Keys never reach config.json, history or the audit log.
 *   - `typedYes` gates `--approve-all` when there is no interactive terminal:
 *     the user must type `yes`, read from /dev/tty so piped input cannot answer.
 *   - Provider and model end up in the engine's config (defaults.provider /
 *     defaults.model). The coder keeps no second config file.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";
import { Writable } from "node:stream";
import type { Painter } from "./ansi.ts";

/** XR home. Mirrors the engine: XR_HOME, else ~/.xr (config.ts reads the same value). */
export function xrHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.XR_HOME || join(homedir(), ".xr");
}

const MARKER = "coder-setup.json";

export function isOnboarded(home: string): boolean {
  return existsSync(join(home, MARKER));
}

export function markOnboarded(home: string, detail: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, MARKER), `${JSON.stringify({ onboardedAt: new Date().toISOString(), ...detail }, null, 2)}\n`, { mode: 0o600 });
}

/** Reads the marker for diagnostics; tolerant of corruption. */
export function readMarker(home: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(home, MARKER), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * One line from the terminal. `secret` hides what is typed. Resolves to "" on EOF.
 * Uses its own readline interface and closes it before returning, so the raw key
 * listener (KeyInput) can take stdin afterwards.
 */
export function promptText(question: string, opts: { secret?: boolean; input?: NodeJS.ReadableStream } = {}): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({
      write(chunk, enc, cb) {
        if (!muted) process.stdout.write(chunk, enc as BufferEncoding);
        cb();
      },
    });
    const input = opts.input ?? process.stdin;
    const rl = readline.createInterface({ input, output: out, terminal: Boolean((input as NodeJS.ReadStream).isTTY) });
    let answered = false;
    rl.on("close", () => {
      if (!answered) {
        answered = true;
        process.stdout.write("\n");
        resolve("");
      }
    });
    process.stdout.write(question);
    muted = Boolean(opts.secret);
    rl.question("", (answer) => {
      muted = false;
      answered = true;
      process.stdout.write(opts.secret ? "\n" : "");
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask the human to type exactly `yes`. Reads /dev/tty when stdin is not a terminal,
 * so a pipe cannot answer on the user's behalf. Resolves false when no terminal is
 * reachable.
 */
export async function typedYes(question: string, p: Painter): Promise<boolean> {
  const input = await controllingTerminal();
  if (!input) return false;
  const answer = await promptText(`  ${p.bold(question)} ${p.dim("(type yes to continue)")} `, { input });
  (input as { destroy?: () => void }).destroy?.();
  return answer === "yes";
}

/** stdin when it is a terminal, else /dev/tty, else null. */
function controllingTerminal(): Promise<NodeJS.ReadableStream | null> {
  if (process.stdin.isTTY) return Promise.resolve(process.stdin);
  return new Promise((resolve) => {
    const tty = createReadStream("/dev/tty");
    tty.once("open", () => resolve(tty));
    tty.once("error", () => resolve(null));
  });
}

/** Preset list the wizard offers. Models are defaults the user can override. */
export const WIZARD_PROVIDERS = [
  { id: "ollama", label: "Ollama (local, no key)", envName: undefined, defaultModel: "qwen2.5:7b", needsKey: false },
  { id: "openai", label: "OpenAI", envName: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini", needsKey: true },
  { id: "anthropic", label: "Anthropic", envName: "ANTHROPIC_API_KEY", defaultModel: "claude-3-5-sonnet-20241022", needsKey: true },
  { id: "custom", label: "Custom OpenAI-compatible endpoint", envName: "XR_CODER_API_KEY", defaultModel: "", needsKey: true },
] as const;

/** The subset of ProviderService the wizard needs. */
export interface WizardProviders {
  storeKey(envName: string, value: string): Promise<string>;
  addCustomProvider(def: {
    id: string;
    label: string;
    baseUrl: string;
    apiKeyEnv?: string;
    defaultModel: string;
    capabilities?: Record<string, boolean>;
  }): Promise<void>;
  setActiveProvider(id: string, model?: string): Promise<void>;
}

export interface WizardResult {
  provider: string;
  model: string;
}

/** Interactive setup. Returns the chosen provider and model, or null if the user quit. */
export async function runWizard(providers: WizardProviders, p: Painter, log: (s: string) => void): Promise<WizardResult | null> {
  log(p.bold("First-run setup"));
  log(p.dim("Pick a provider. Keys are stored in the OS keychain, never in config.json. Ctrl+C quits."));
  WIZARD_PROVIDERS.forEach((w, i) => log(`  ${i + 1}) ${w.label}`));
  const pick = (await promptText(`  ${p.cyan("?")} Provider [1-${WIZARD_PROVIDERS.length}] (1): `)) || "1";
  const idx = Number(pick) - 1;
  const choice = WIZARD_PROVIDERS[idx];
  if (!choice) {
    log(p.yellow(`  not a choice: ${pick}`));
    return null;
  }

  let providerId: string = choice.id;
  let defaultModel: string = choice.defaultModel;
  let baseUrl: string | null = null;

  if (choice.id === "custom") {
    baseUrl = await promptText(`  ${p.cyan("?")} Base URL (for example https://host/v1): `);
    if (!/^https?:\/\//.test(baseUrl)) {
      log(p.yellow("  the base URL must start with http:// or https://"));
      return null;
    }
    providerId = "custom";
    defaultModel = await promptText(`  ${p.cyan("?")} Model id: `);
    if (!defaultModel) return null;
  }

  // The key first: the provider's apiKeyEnv is set only when a key is really stored,
  // because a provider that names a missing key is treated as unavailable by the router.
  let keyEnv: string | undefined;
  if (choice.needsKey && choice.envName) {
    const key = await promptText(`  ${p.cyan("?")} API key for ${choice.label} (hidden): `, { secret: true });
    if (key) {
      const backend = await providers.storeKey(choice.envName, key);
      keyEnv = choice.envName;
      log(`  ${p.green("✓")} key stored in ${backend}`);
    } else {
      log(p.yellow(`  no key entered. Add one later with /setup, or set ${choice.envName} in the environment.`));
    }
  }

  if (baseUrl) {
    // The coder needs tool calls and streaming from its provider; without them the router skips it.
    const capabilities = { chat: true, streaming: true, toolUse: true, functionCalling: true };
    await providers.addCustomProvider({ id: providerId, label: "Custom endpoint", baseUrl, apiKeyEnv: keyEnv, defaultModel, capabilities });
  }

  // A custom endpoint was asked for its model id above; presets offer their default.
  const model = baseUrl ? defaultModel : (await promptText(`  ${p.cyan("?")} Model (${defaultModel}): `)) || defaultModel;
  if (!model) return null;
  await providers.setActiveProvider(providerId, model);
  log(`  ${p.green("✓")} ${choice.label} · ${model}`);
  return { provider: providerId, model };
}
