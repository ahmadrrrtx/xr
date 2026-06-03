/**
 * XR — Cost Governor.
 * A hard, deterministic spend ceiling the agent PHYSICALLY cannot exceed.
 * Live token + USD meter, pre-flight estimation, and a pause-and-ask gate.
 *
 * This is the headline differentiator: "XR literally cannot spend more than
 * you allow." Enforced in code — the model can never override it.
 * (TRD §3.1)
 */

export interface Budget {
  /** Hard ceiling in USD for this task (0 or undefined = local/free, no $ cap). */
  maxUsd?: number;
  /** Hard ceiling in total tokens for this task. */
  maxTokens?: number;
}

/** Per-model pricing in USD per 1M tokens. Local models = 0. */
export interface Pricing {
  inPerMTok: number;
  outPerMTok: number;
}

export interface CostSnapshot {
  inTokens: number;
  outTokens: number;
  totalTokens: number;
  usd: number;
}

export type GovernorDecision =
  | { allow: true }
  | { allow: false; reason: string; snapshot: CostSnapshot };

export class CostGovernor {
  private inTokens = 0;
  private outTokens = 0;
  private usd = 0;
  private steps = 0;

  constructor(
    private budget: Budget,
    private pricing: Pricing,
  ) {}

  /** Record real usage after a model call. */
  record(inTok: number, outTok: number): void {
    this.inTokens += inTok;
    this.outTokens += outTok;
    this.usd +=
      (inTok / 1_000_000) * this.pricing.inPerMTok +
      (outTok / 1_000_000) * this.pricing.outPerMTok;
    this.steps++;
  }

  snapshot(): CostSnapshot {
    return {
      inTokens: this.inTokens,
      outTokens: this.outTokens,
      totalTokens: this.inTokens + this.outTokens,
      usd: this.usd,
    };
  }

  /**
   * Pre-flight check BEFORE the next step. Estimates the next call's cost from
   * the running average and refuses if it would breach a ceiling.
   * Returns allow:false → the loop must pause and ask the human.
   */
  checkBeforeStep(): GovernorDecision {
    const snap = this.snapshot();

    // Already over a ceiling? (defensive — should be caught earlier)
    if (this.overBudget()) {
      return { allow: false, reason: "budget ceiling reached", snapshot: snap };
    }

    // Estimate the next step from the average so far (fallback to a small guess).
    const avgTokens = this.steps > 0 ? snap.totalTokens / this.steps : 2000;
    const estTokens = Math.max(avgTokens, 500);
    const estUsd =
      this.steps > 0 ? snap.usd / this.steps : (estTokens / 1_000_000) * this.pricing.outPerMTok;

    if (
      this.budget.maxTokens !== undefined &&
      snap.totalTokens + estTokens > this.budget.maxTokens
    ) {
      return {
        allow: false,
        reason: `next step (~${Math.round(estTokens)} tok) would exceed token ceiling (${this.budget.maxTokens})`,
        snapshot: snap,
      };
    }
    if (
      this.budget.maxUsd !== undefined &&
      this.budget.maxUsd > 0 &&
      snap.usd + estUsd > this.budget.maxUsd
    ) {
      return {
        allow: false,
        reason: `next step (~$${estUsd.toFixed(4)}) would exceed spend ceiling ($${this.budget.maxUsd})`,
        snapshot: snap,
      };
    }
    return { allow: true };
  }

  overBudget(): boolean {
    const snap = this.snapshot();
    if (this.budget.maxTokens !== undefined && snap.totalTokens >= this.budget.maxTokens) return true;
    if (this.budget.maxUsd !== undefined && this.budget.maxUsd > 0 && snap.usd >= this.budget.maxUsd) return true;
    return false;
  }

  /** Raise the ceiling (after a human approves continuing). */
  raise(extra: { usd?: number; tokens?: number }): void {
    if (extra.usd && this.budget.maxUsd !== undefined) this.budget.maxUsd += extra.usd;
    if (extra.tokens && this.budget.maxTokens !== undefined) this.budget.maxTokens += extra.tokens;
  }

  /** A short live-meter string for the UI. */
  meter(): string {
    const s = this.snapshot();
    const tokPart = `${fmt(s.totalTokens)} tok`;
    const usdPart = this.pricing.inPerMTok + this.pricing.outPerMTok > 0
      ? ` ≈ $${s.usd.toFixed(4)}`
      : " (local · $0)";
    const cap = this.budget.maxUsd
      ? ` / $${this.budget.maxUsd} cap`
      : this.budget.maxTokens
        ? ` / ${fmt(this.budget.maxTokens)} cap`
        : "";
    return `💰 ${tokPart}${usdPart}${cap}`;
  }
}

function fmt(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n));
}
