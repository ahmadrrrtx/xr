/**
 * XR — Custom Provider (OpenAI-compatible universal adapter)
 * Any OpenAI-compatible endpoint the user configures. First-class feature.
 */

import { OpenAICompatProvider } from "./openai-compat.ts";
import { validateProviderUrlSync } from "./provider-url-guard.ts";
import type { ProviderCapabilitiesFlags } from "../core/types.ts";

export interface CustomProviderOptions {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  extraHeaders?: Record<string, string>;
  apiKey?: string;
  /** Declared transport capabilities (resolver-owned, Phase 1). */
  capabilities?: ProviderCapabilitiesFlags;
}

export class CustomProvider extends OpenAICompatProvider {
  constructor(opts: CustomProviderOptions) {
    // A5 — fail closed at construction, even if a caller bypassed the
    // registry and the add path: a custom baseUrl that fails the SSRF
    // guard never gets a transport. (Built-in local presets do not use
    // this class and stay exempt.)
    const check = validateProviderUrlSync(opts.baseUrl);
    if (!check.ok) {
      throw new Error(`Custom provider "${opts.id}" refused: ${check.reason}`);
    }
    super({
      id: opts.id,
      label: opts.label,
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKeyEnv: opts.apiKeyEnv,
      extraHeaders: opts.extraHeaders,
      apiKey: opts.apiKey,
      capabilities: opts.capabilities,
    });
  }
}
