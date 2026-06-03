/**
 * XR — model pricing table (USD per 1M tokens).
 * Local providers (ollama) are always $0. Unknown models default to $0 so we
 * never over-charge the user in the meter — better to under-report than scare.
 * Users can override in config later (Phase 2).
 */
import type { Pricing } from "./governor.ts";

const FREE: Pricing = { inPerMTok: 0, outPerMTok: 0 };

/** providerId -> (modelMatch -> pricing). */
const TABLE: Record<string, Array<{ match: RegExp; price: Pricing }>> = {
  ollama: [{ match: /.*/, price: FREE }],
  groq: [
    { match: /llama-3\.3-70b/i, price: { inPerMTok: 0.59, outPerMTok: 0.79 } },
    { match: /llama-3\.1-8b/i, price: { inPerMTok: 0.05, outPerMTok: 0.08 } },
    { match: /.*/, price: { inPerMTok: 0.3, outPerMTok: 0.5 } },
  ],
  openai: [
    { match: /gpt-4o-mini|gpt-5-mini/i, price: { inPerMTok: 0.15, outPerMTok: 0.6 } },
    { match: /gpt-4o|gpt-5/i, price: { inPerMTok: 2.5, outPerMTok: 10 } },
    { match: /.*/, price: { inPerMTok: 1, outPerMTok: 3 } },
  ],
  deepseek: [{ match: /.*/, price: { inPerMTok: 0.27, outPerMTok: 1.1 } }],
  together: [{ match: /.*/, price: { inPerMTok: 0.6, outPerMTok: 0.6 } }],
  openrouter: [{ match: /.*/, price: { inPerMTok: 0.5, outPerMTok: 1.5 } }],
};

export function priceFor(providerId: string, model: string): Pricing {
  const rules = TABLE[providerId];
  if (!rules) return FREE; // unknown provider → assume free in the meter
  for (const r of rules) if (r.match.test(model)) return r.price;
  return FREE;
}

export function isLocal(providerId: string): boolean {
  return providerId === "ollama";
}
