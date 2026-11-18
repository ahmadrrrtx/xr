/**
 * XR — Custom Provider (OpenAI-compatible universal adapter)
 * Any OpenAI-compatible endpoint the user configures. First-class feature.
 */

import { assertHeaderReferences, resolveCustomHeaders } from "./header-secrets.ts";
import { OpenAICompatProvider } from "./openai-compat.ts";
import { validateProviderUrlSync, validateProviderUrl } from "./provider-url-guard.ts";
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
  private headerReferences: Record<string, string>;
  constructor(opts: CustomProviderOptions) {
    // A5 — fail closed at construction, even if a caller bypassed the
    // registry and the add path: a custom baseUrl that fails the SSRF
    // guard never gets a transport. (Built-in local presets do not use
    // this class and stay exempt.)
    const check = validateProviderUrlSync(opts.baseUrl);
    if (!check.ok) {
      throw new Error(`Custom provider "${opts.id}" refused: ${check.reason}`);
    }
    assertHeaderReferences(opts.id, opts.baseUrl, opts.extraHeaders);
    super({
      id: opts.id,
      label: opts.label,
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKeyEnv: opts.apiKeyEnv,
      extraHeaders: {},
      apiKey: opts.apiKey,
      capabilities: opts.capabilities,
    });
    this.headerReferences = opts.extraHeaders ?? {};
  }
  protected override async observationRequest(url: string, init: RequestInit): Promise<Response> {
    const check = await validateProviderUrl(this.baseUrl);
    if (!check.ok) throw new Error("Custom provider URL refused by runtime guard");
    init.signal?.throwIfAborted();
    return super.observationRequest(url, init);
  }
  protected override headers(): Record<string, string> {
    const headers = new Headers(super.headers());
    for (const [name, value] of Object.entries(resolveCustomHeaders(this.id, this.baseUrl, this.headerReferences))) headers.set(name, value);
    return Object.fromEntries(headers.entries());
  }
}
