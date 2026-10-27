/** Per-attempt admission and settlement shared by primary, recovery and fallback.
 * Input-token and USD values are estimates, not absolute provider billing caps.
 * Request output, attempt count, and subsequent admissions are bounded in code.
 */
import { ProviderAbortError } from "./provider-abort.ts";
import type {
  ChatOptions,
  Message,
  ModelTurn,
  Provider,
  StreamEventSink,
  Tool,
} from "./types.ts";
import type { CostGovernor, Budget, Pricing } from "../cost/governor.ts";
import { priceFor, pricingAvailable } from "../cost/pricing.ts";
export class ProviderBudgetAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderBudgetAdmissionError";
  }
}
interface AccountingDeps {
  provider: Provider;
  pricingTarget: { id: string; model?: string };
  pricing?: Pricing;
  pricingOverrides?: Record<string, Pricing>;
  budget?: Budget;
  maxOutputTokens?: number;
  governor: CostGovernor;
  sessionId: string;
  step: number;
  messages: Message[];
  tools: Tool[];
  signal?: AbortSignal;
  sink?: StreamEventSink;
  audit: (event: string, detail: Record<string, unknown>) => unknown;
  recordCost: (
    provider: string,
    model: string,
    input: number,
    output: number,
    usd: number,
    source: "provider" | "estimated",
  ) => unknown;
}
/** Presentation must not turn a successful settlement into a paid replay. */
function present(
  sink: StreamEventSink | undefined,
  event: Parameters<StreamEventSink>[0],
): void {
  try {
    sink?.(event);
  } catch {
    /* status/usage transport only; audit stays fail-closed */
  }
}
export function attemptControls(d: AccountingDeps): ChatOptions {
  const base = d.pricingTarget;
  const promptBytes =
    Buffer.byteLength(JSON.stringify(d.messages), "utf8") +
    Buffer.byteLength(
      JSON.stringify(
        d.tools.map((t) => ({
          name: t.name,
          parameters: t.parameters,
          description: t.description,
        })),
      ),
      "utf8",
    );
  // An explicitly labelled heuristic: provider tokenizers/message framing differ.
  const inputEstimate = Math.max(1, Math.ceil(promptBytes / 3) + 128);
  let pricing: Pricing = d.pricing ?? priceFor(base.id, base.model ?? "");
  const outputBound = Math.max(
    1,
    Math.min(4096, Math.floor(d.maxOutputTokens ?? 4096)),
  );
  const controls: ChatOptions = {
    signal: d.signal,
    maxOutputTokens: outputBound,
    beforeAttempt(target) {
      if (d.signal?.aborted)
        throw new ProviderAbortError("cancelled", target.providerId);
      pricing =
        target.providerId === base.id &&
        target.modelId === base.model &&
        d.pricing &&
        !d.pricing.source?.startsWith("https://")
          ? d.pricing
          : priceFor(target.providerId, target.modelId ?? "", {
              inputTokens: inputEstimate,
              override:
                d.pricingOverrides?.[`${target.providerId}/${target.modelId}`],
            });
      // Older trusted embeddings may supply explicit pricing without a model id.
      if (
        target.providerId === base.id &&
        d.pricing &&
        target.modelId === base.model &&
        !pricingAvailable(pricing) &&
        pricingAvailable(d.pricing)
      )
        pricing = d.pricing;
      // A token-only/disabled-USD threshold does not make an unknown tariff
      // zero, nor allow an already-sent request to produce a NaN USD row.
      if (!pricingAvailable(pricing))
        throw new ProviderBudgetAdmissionError(
          "Token tariff unavailable; declare sourced/operator rates before a governed request, even with USD thresholds disabled",
        );
      if (
        !Number.isFinite(
          (inputEstimate * pricing.inPerMTok +
            outputBound * pricing.outPerMTok) /
            1e6,
        )
      )
        throw new ProviderBudgetAdmissionError(
          "Token tariff projection is non-finite; no request sent",
        );
      d.governor.setPricing(pricing);
      const snap = d.governor.snapshot();
      const remaining =
        d.budget?.maxTokens === undefined
          ? outputBound
          : Math.floor(d.budget.maxTokens - snap.totalTokens - inputEstimate);
      if (remaining < 1)
        throw new ProviderBudgetAdmissionError(
          "Estimated request input exceeds remaining token admission threshold; no request sent",
        );
      controls.maxOutputTokens = Math.min(outputBound, remaining);
      const admission = d.governor.checkBeforeStep({
        inTokens: inputEstimate,
        outTokens: controls.maxOutputTokens,
      });
      if (!admission.allow)
        throw new ProviderBudgetAdmissionError(admission.reason);
      d.audit("provider.attempt.admitted", {
        step: d.step,
        provider: target.providerId,
        model: target.modelId ?? null,
        fallback: target.fallback,
        inputTokensEstimated: inputEstimate,
        maxOutputTokens: controls.maxOutputTokens,
        rateSource: pricing.source ?? "explicit embedding rates",
        guarantee: "estimated admission; not a USD invoice ceiling",
      });
      present(d.sink, {
        type: "status",
        status: "generating",
        provider: target.providerId,
        model: target.modelId,
        message: `${target.fallback ? "Explicit fallback: " : ""}${target.providerId}/${target.modelId ?? "model unknown"}; reachability/live validation not inferred`,
      });
    },
    afterAttempt(attempt) {
      const u = attempt.turn?.usage;
      const valid =
        !attempt.error &&
        !!u &&
        [u.inTokens, u.outTokens].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        );
      const outputBytes = Buffer.byteLength(
        (attempt.turn?.message ?? "") +
          JSON.stringify(attempt.turn?.toolCalls ?? []),
      );
      // An interrupted/failed request may already have been billed. Charge the
      // reserved output allowance conservatively, labelled estimated, not zero.
      const usage = valid
        ? u!
        : {
            inTokens: inputEstimate,
            outTokens: attempt.error
              ? controls.maxOutputTokens!
              : Math.max(1, Math.ceil(outputBytes / 3)),
          };
      const source = valid
        ? (attempt.turn?.usageSource ?? "provider")
        : "estimated";
      d.governor.record(usage.inTokens, usage.outTokens);
      const usd =
        (usage.inTokens * pricing.inPerMTok +
          usage.outTokens * pricing.outPerMTok) /
        1e6;
      // Persistence failure stops the run; it must not turn into a free retry.
      d.recordCost(
        attempt.providerId,
        attempt.modelId ?? "unknown",
        usage.inTokens,
        usage.outTokens,
        usd,
        source,
      );
      d.audit("provider.attempt.settled", {
        step: d.step,
        provider: attempt.providerId,
        model: attempt.modelId ?? null,
        usage,
        usageSource: source,
        usdEstimate: usd,
        failed: !!attempt.error || !!attempt.turn?.error,
        rateSource: pricing.source ?? "explicit embedding rates",
      });
      if (!valid)
        d.audit("usage.estimated", {
          step: d.step,
          ...usage,
          failedAttempt: !!attempt.error,
        });
      present(d.sink, {
        type: "usage",
        usage,
        source,
        provider: attempt.providerId,
        model: attempt.modelId,
        usdEstimate: Number.isFinite(usd) ? usd : null,
        rateSource: pricing.source,
      });
      if (d.governor.overBudget())
        d.audit("budget.actual_overrun", {
          step: d.step,
          snapshot: d.governor.snapshot(),
          note: "Reported/estimated input, premiums and billing can exceed a pre-request estimate; no hard USD ceiling claimed",
        });
    },
  };
  return controls;
}
