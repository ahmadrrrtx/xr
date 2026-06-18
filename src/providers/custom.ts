/**
 * XR — Custom Provider (OpenAI-compatible universal adapter)
 * Any OpenAI-compatible endpoint the user configures. First-class feature.
 */

import { OpenAICompatProvider } from "./openai-compat.ts";

export interface CustomProviderOptions {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  extraHeaders?: Record<string, string>;
  apiKey?: string;
}

export class CustomProvider extends OpenAICompatProvider {
  constructor(opts: CustomProviderOptions) {
    super({
      id: opts.id,
      label: opts.label,
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKeyEnv: opts.apiKeyEnv,
      extraHeaders: opts.extraHeaders,
      apiKey: opts.apiKey,
    });
  }
}
