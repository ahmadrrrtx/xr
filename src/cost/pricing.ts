/** Sourced standard token-price estimates. Never an invoice/spending guarantee.
 * Unknown rates are unavailable (NaN internally, null in JSON), NEVER free.
 */
import type { Pricing } from "./pricing-types.ts";
import { MODEL_FACTS_VERIFIED_AT, modelFact, modelFactsFresh } from "../core/model-registry.ts";

const LOCAL = new Set(["ollama", "lmstudio", "llamacpp", "jan", "localai", "vllm", "gpt4all", "koboldcpp", "textgenwebui", "sglang"]);
const UNAVAILABLE: Pricing = Object.freeze({ inPerMTok: NaN, outPerMTok: NaN, known: false, source: "unavailable" });
export function priceFor(providerId: string, model: string, opts: { now?: number; inputTokens?: number; override?: unknown } = {}): Pricing {
  // Only an explicit operator declaration can price an otherwise unknown API.
  const override = opts.override as Partial<Pricing> | undefined;
  if (override?.known === false) return UNAVAILABLE;
  if (override && typeof override.source === "string" && override.source.trim() && validRate(override.inPerMTok) && validRate(override.outPerMTok)) return { inPerMTok: override.inPerMTok!, outPerMTok: override.outPerMTok!, known: true, source: `operator-declared: ${override.source}` };
  if (LOCAL.has(providerId)) return { inPerMTok: 0, outPerMTok: 0, known: true, source: "local-no-provider-token-fee" };
  const fact = modelFact(providerId, model), now = opts.now ?? Date.now();
  // B5: a calendar date must not brick paid providers. Past staleAt the last-known rates stay in force,
  // flagged `stale`; XR_STALE_PRICE_FACTS=refuse is the operator's explicit opt-in to strict refusal.
  const stale = !modelFactsFresh(now);
  if (!fact?.price || (stale && staleFactsRefused())) return UNAVAILABLE;
  let p = { input: fact.price.input, output: fact.price.output };
  if (fact.price.until && now > Date.parse(fact.price.until)) {
    if (!fact.price.then) return UNAVAILABLE;
    p = fact.price.then;
  }
  if (providerId === "openai" && model.startsWith("gpt-6") && (opts.inputTokens ?? 0) > 272_000) p = { input: p.input * 2, output: p.output * 1.5 };
  if (providerId === "xai" && model.startsWith("grok-4") && (opts.inputTokens ?? 0) >= 200_000) p = { input: p.input * 2, output: p.output * 2 };
  return { inPerMTok: p.input, outPerMTok: p.output, known: true, source: fact.price.source, verifiedAt: MODEL_FACTS_VERIFIED_AT, ...(stale && { stale: true }) };
}
/** The desktop webview imports this module and has no `process` global outside a Vite build. */
const staleFactsRefused = (): boolean => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.XR_STALE_PRICE_FACTS === "refuse";
const validRate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
export function pricingAvailable(p: Pricing): boolean { return p.known !== false && validRate(p.inPerMTok) && validRate(p.outPerMTok); }
export function isFreeProvider(providerId: string): boolean { return LOCAL.has(providerId); }
export function isLocal(providerId: string): boolean { return LOCAL.has(providerId); }
export function pricingLabel(providerId: string, model: string): string {
  const p = priceFor(providerId, model);
  if (!pricingAvailable(p)) return "price unavailable — choose sourced rates before a monetary-budgeted run";
  return LOCAL.has(providerId) ? "no provider token fee (hardware/power excluded)" : `estimated standard $${p.inPerMTok}/$${p.outPerMTok} per MTok; not a billing ceiling`;
}
/** Candidates only. This does not assert a runtime is installed or reachable. */
export function availableFreeProviders(): string[] { return [...LOCAL]; }
