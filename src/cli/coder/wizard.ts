/**
 * First-run setup for the coder CLI: pick a provider, a model, and (for hosted
 * providers) an API key. The key goes to the SecretBroker (OS keychain, or the
 * encrypted file store), never to cli.json. Runs only in an interactive TTY.
 */

import { setSecretAsync } from "../../security/secrets.ts";
import { style, out } from "./style.ts";
import { type CoderConfig, providerChoices, saveCliConfig } from "./config.ts";
import { readChoice, readLine, readSecret, type Terminal } from "./tty.ts";

export async function runWizard(term: Terminal, cfgPath: string): Promise<CoderConfig | null> {
  const choices = providerChoices();
  out(`${style.bold("xr coding agent · first run")}\n`);
  out(`${style.dim("No model configured yet. Pick a provider:")}\n`);
  choices.forEach((c, i) => {
    const note = c.keyless ? "local, no key" : `key: ${c.keyEnv}`;
    out(`  ${i + 1}) ${c.label}  ${style.dim(`(${note})`)}\n`);
  });
  out(`${style.cyan("> ")}`);
  const pick = await readChoice(term, choices.map((_, i) => String(i + 1)));
  if (pick === "interrupt") return null;
  const choice = choices[Number(pick) - 1];
  if (!choice) return null;

  const modelAnswer = await readLine(term, style.dim(`Model [${choice.defaultModel}]: `), []);
  if (modelAnswer.kind !== "line") return null;
  const model = modelAnswer.text.trim() || choice.defaultModel;

  if (choice.keyEnv) {
    const key = await readSecret(term, `${choice.keyEnv}: `);
    if (!key || !key.trim()) {
      out(style.red("✕ No key entered; setup cancelled.\n"));
      return null;
    }
    const backend = await setSecretAsync(choice.keyEnv, key.trim());
    out(style.dim(`› key stored (${backend}); it is never written to ${cfgPath}\n`));
  }

  const cfg: CoderConfig = { provider: choice.id, model, ...(choice.baseUrl ? { baseUrl: choice.baseUrl } : {}) };
  saveCliConfig(cfgPath, cfg);
  out(style.dim(`› saved ${cfgPath}\n`));
  return cfg;
}
