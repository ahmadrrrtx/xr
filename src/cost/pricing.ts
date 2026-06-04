/**
 * XR — model pricing table (USD per 1M tokens).
 * 
 * Organized by cost tier:
 * - FREE:    ollama (local), groq (free tier), google (Gemini free), deepseek
 * - CHEAP:   together, openrouter, cerebras, mistral  
 * - PREMIUM: openai, anthropic, cohere, bedrock
 * 
 * Local providers (ollama) are always $0. Unknown models default to $0 so we
 * never over-charge the user in the meter — better to under-report than scare.
 * 
 * All prices are based on public pricing as of 2024. Check each provider's
 * current pricing at their respective documentation pages.
 */
import type { Pricing } from "./governor.ts";

const FREE: Pricing = { inPerMTok: 0, outPerMTok: 0 };

/** providerId -> (modelMatch -> pricing). */
const TABLE: Record<string, Array<{ match: RegExp; price: Pricing; label?: string }>> = {
  // ── TIER 0: FREE ─────────────────────────────────────────────────────────
  ollama: [
    { match: /.*/, price: FREE, label: "Local (FREE)" },
  ],
  
  groq: [
    // Groq free tier: very generous limits
    { match: /llama-3\.3-70b/i, price: { inPerMTok: 0, outPerMTok: 0 }, label: "Free tier" },
    { match: /llama-3\.1-8b/i, price: { inPerMTok: 0, outPerMTok: 0 }, label: "Free tier" },
    { match: /mixtral-8x7b/i, price: { inPerMTok: 0, outPerMTok: 0 }, label: "Free tier" },
    { match: /gemma2-9b/i, price: { inPerMTok: 0, outPerMTok: 0 }, label: "Free tier" },
    { match: /.*/, price: FREE, label: "Free tier (assumed)" },
  ],

  google: [
    // Gemini free tier: 15 requests/min, 1500 requests/day on 1.5 Flash
    { match: /gemini-1\.5-flash/i, price: FREE, label: "Free tier (15 req/min)" },
    { match: /gemini-1\.5-flash-8b/i, price: FREE, label: "Free tier (15 req/min)" },
    { match: /gemini-2\.0-flash/i, price: FREE, label: "Free tier (15 req/min)" },
    { match: /gemini-1\.5-pro/i, price: { inPerMTok: 1.25, outPerMTok: 5.0 }, label: "Paid tier" },
    { match: /.*/, price: FREE, label: "Free tier (assumed)" },
  ],

  deepseek: [
    // DeepSeek Chat: $0.27/M input, $1.10/M output (very cheap)
    // DeepSeek Coder: similar pricing
    { match: /deepseek-chat/i, price: { inPerMTok: 0.27, outPerMTok: 1.1 }, label: "$0.27/$1.10 per 1M" },
    { match: /deepseek-coder/i, price: { inPerMTok: 0.27, outPerMTok: 1.1 }, label: "$0.27/$1.10 per 1M" },
    { match: /.*/, price: { inPerMTok: 0.27, outPerMTok: 1.1 }, label: "$0.27/$1.10 per 1M" },
  ],

  // ── TIER 1: CHEAP ─────────────────────────────────────────────────────────
  together: [
    { match: /llama-3\.3-70b/i, price: { inPerMTok: 0.88, outPerMTok: 0.88 }, label: "$0.88/$0.88 per 1M" },
    { match: /llama-3\.1-8b/i, price: { inPerMTok: 0.2, outPerMTok: 0.2 }, label: "$0.20/$0.20 per 1M" },
    { match: /mixtral/i, price: { inPerMTok: 0.6, outPerMTok: 0.6 }, label: "$0.60/$0.60 per 1M" },
    { match: /.*/, price: { inPerMTok: 0.6, outPerMTok: 0.8 }, label: "$0.60/$0.80 per 1M" },
  ],

  openrouter: [
    // OpenRouter aggregates many providers — prices vary by route
    // Default to mid-range estimates
    { match: /claude/i, price: { inPerMTok: 3.0, outPerMTok: 15.0 }, label: "Anthropic via OpenRouter" },
    { match: /gpt-4o/i, price: { inPerMTok: 2.5, outPerMTok: 10.0 }, label: "OpenAI via OpenRouter" },
    { match: /gemini/i, price: { inPerMTok: 0.5, outPerMTok: 1.5 }, label: "Google via OpenRouter" },
    { match: /llama-3\.3-70b/i, price: { inPerMTok: 0.65, outPerMTok: 0.65 }, label: "Meta via OpenRouter" },
    { match: /.*/, price: { inPerMTok: 1.0, outPerMTok: 2.0 }, label: "Mixed via OpenRouter" },
  ],

  cerebras: [
    // Cerebras: very cheap, especially CSM-8B
    // Free tier available, then very low pricing
    { match: /csm-8b/i, price: { inPerMTok: 0, outPerMTok: 0.6 }, label: "CSM-8B (free in + $0.60 out)" },
    { match: /.*/, price: { inPerMTok: 0, outPerMTok: 1.0 }, label: "Cerebras pricing" },
  ],

  mistral: [
    // Mistral pricing
    { match: /large/i, price: { inPerMTok: 2.0, outPerMTok: 6.0 }, label: "Mistral Large: $2/$6 per 1M" },
    { match: /medium/i, price: { inPerMTok: 1.2, outPerMTok: 3.6 }, label: "Mistral Medium: $1.20/$3.60 per 1M" },
    { match: /small/i, price: { inPerMTok: 0.3, outPerMTok: 0.9 }, label: "Mistral Small: $0.30/$0.90 per 1M" },
    { match: /codestral/i, price: { inPerMTok: 1.0, outPerMTok: 3.0 }, label: "Codestral: $1/$3 per 1M" },
    { match: /.*/, price: { inPerMTok: 0.5, outPerMTok: 1.5 }, label: "Mistral default" },
  ],

  // ── TIER 2: PREMIUM ───────────────────────────────────────────────────────
  openai: [
    { match: /o1-preview/i, price: { inPerMTok: 15.0, outPerMTok: 60.0 }, label: "o1-preview: $15/$60 per 1M" },
    { match: /o1-mini/i, price: { inPerMTok: 3.0, outPerMTok: 12.0 }, label: "o1-mini: $3/$12 per 1M" },
    { match: /gpt-4o/i, price: { inPerMTok: 2.5, outPerMTok: 10.0 }, label: "GPT-4o: $2.50/$10 per 1M" },
    { match: /gpt-4o-mini/i, price: { inPerMTok: 0.15, outPerMTok: 0.6 }, label: "GPT-4o mini: $0.15/$0.60 per 1M" },
    { match: /gpt-4-turbo/i, price: { inPerMTok: 10.0, outPerMTok: 30.0 }, label: "GPT-4 Turbo: $10/$30 per 1M" },
    { match: /gpt-3\.5-turbo/i, price: { inPerMTok: 0.5, outPerMTok: 1.5 }, label: "GPT-3.5: $0.50/$1.50 per 1M" },
    { match: /.*/, price: { inPerMTok: 1.0, outPerMTok: 3.0 }, label: "OpenAI default" },
  ],

  anthropic: [
    // Anthropic Claude pricing
    { match: /claude-3\.5-sonnet/i, price: { inPerMTok: 3.0, outPerMTok: 15.0 }, label: "Claude 3.5 Sonnet: $3/$15 per 1M" },
    { match: /claude-3-opus/i, price: { inPerMTok: 15.0, outPerMTok: 75.0 }, label: "Claude 3 Opus: $15/$75 per 1M" },
    { match: /claude-3-sonnet/i, price: { inPerMTok: 3.0, outPerMTok: 15.0 }, label: "Claude 3 Sonnet: $3/$15 per 1M" },
    { match: /claude-3-haiku/i, price: { inPerMTok: 0.8, outPerMTok: 4.0 }, label: "Claude 3 Haiku: $0.80/$4 per 1M" },
    { match: /.*/, price: { inPerMTok: 5.0, outPerMTok: 25.0 }, label: "Claude default" },
  ],

  cohere: [
    // Cohere pricing
    { match: /command-r-plus/i, price: { inPerMTok: 3.0, outPerMTok: 15.0 }, label: "Command R+: $3/$15 per 1M" },
    { match: /command-r/i, price: { inPerMTok: 0.5, outPerMTok: 1.5 }, label: "Command R: $0.50/$1.50 per 1M" },
    { match: /command/i, price: { inPerMTok: 0.5, outPerMTok: 1.5 }, label: "Command: $0.50/$1.50 per 1M" },
    { match: /.*/, price: { inPerMTok: 1.0, outPerMTok: 3.0 }, label: "Cohere default" },
  ],

  bedrock: [
    // AWS Bedrock uses AWS pricing (varies by region and model)
    // On-demand pricing approximation
    { match: /claude-3-opus/i, price: { inPerMTok: 15.0, outPerMTok: 75.0 }, label: "Claude 3 Opus via Bedrock" },
    { match: /claude-3-sonnet/i, price: { inPerMTok: 3.0, outPerMTok: 15.0 }, label: "Claude 3 Sonnet via Bedrock" },
    { match: /claude-3-haiku/i, price: { inPerMTok: 0.8, outPerMTok: 4.0 }, label: "Claude 3 Haiku via Bedrock" },
    { match: /llama-3-70b/i, price: { inPerMTok: 0.65, outPerMTok: 0.65 }, label: "Llama 3 70B via Bedrock" },
    { match: /mistral-large/i, price: { inPerMTok: 2.0, outPerMTok: 6.0 }, label: "Mistral Large via Bedrock" },
    { match: /.*/, price: { inPerMTok: 2.0, outPerMTok: 10.0 }, label: "Bedrock default" },
  ],
};

/**
 * Get pricing for a provider/model combination.
 * @param providerId - e.g. "anthropic", "groq", "ollama"
 * @param model - e.g. "claude-3-5-sonnet", "llama-3.3-70b"
 */
export function priceFor(providerId: string, model: string): Pricing {
  const rules = TABLE[providerId];
  if (!rules) return FREE; // unknown provider → assume free in the meter
  
  for (const r of rules) {
    if (r.match.test(model)) {
      return r.price;
    }
  }
  return FREE;
}

/** Check if a provider is free (always $0) */
export function isFreeProvider(providerId: string): boolean {
  const rules = TABLE[providerId];
  if (!rules) return false;
  
  return rules.every(r => r.price.inPerMTok === 0 && r.price.outPerMTok === 0);
}

/** Check if a provider is local (runs on user's machine) */
export function isLocal(providerId: string): boolean {
  return providerId === "ollama";
}

/** Get pricing label for display */
export function pricingLabel(providerId: string, model: string): string {
  const rules = TABLE[providerId];
  if (!rules) return "unknown";
  
  for (const r of rules) {
    if (r.match.test(model)) {
      return r.label ?? "default pricing";
    }
  }
  return "default pricing";
}

/** Get all free providers that are configured */
export function availableFreeProviders(): string[] {
  const free: string[] = [];
  
  // Ollama is always "available" (will fail at runtime if not running)
  free.push("ollama");
  
  // Check API keys for other free providers
  const freeProviders: Array<{ id: string; keyEnv: string }> = [
    { id: "groq", keyEnv: "GROQ_API_KEY" },
    { id: "google", keyEnv: "GOOGLE_API_KEY" },
    { id: "deepseek", keyEnv: "DEEPSEEK_API_KEY" },
  ];
  
  for (const p of freeProviders) {
    if (process.env[p.keyEnv]) {
      free.push(p.id);
    }
  }
  
  return free;
}
