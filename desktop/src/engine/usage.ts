/** Actual-attempt settlement, not repricing under the currently selected model.
 * A final done.usage is a summary, NEVER another billable attempt. Older engines
 * or interrupted transports can lack settlement; unknown money stays null. */
export interface AttemptUsage {
  usage: { inTokens: number; outTokens: number };
  provider?: string;
  model?: string;
  source?: 'provider' | 'estimated';
  usdEstimate?: number | null;
  rateSource?: string;
}
const validUsage = (
  u: AttemptUsage['usage'] | undefined
): u is AttemptUsage['usage'] =>
  !!u &&
  [u.inTokens, u.outTokens].every((n) => Number.isSafeInteger(n) && n >= 0);
export class UsageAccumulator {
  readonly attempts: AttemptUsage[] = [];
  private invalid = false;
  add(attempt: AttemptUsage): void {
    if (!validUsage(attempt.usage)) {
      this.invalid = true;
      return;
    }
    this.attempts.push({ ...attempt, usage: { ...attempt.usage } });
  }
  summary(
    doneUsage?: AttemptUsage['usage'],
    complete = true
  ): { inTokens: number; outTokens: number; usdEstimate: number | null } {
    const total = this.attempts.reduce(
      (t, a) => ({
        inTokens: t.inTokens + a.usage.inTokens,
        outTokens: t.outTokens + a.usage.outTokens,
      }),
      { inTokens: 0, outTokens: 0 }
    );
    if (!this.attempts.length && validUsage(doneUsage))
      return { ...doneUsage, usdEstimate: null };
    const incomplete =
      validUsage(doneUsage) &&
      (doneUsage.inTokens > total.inTokens ||
        doneUsage.outTokens > total.outTokens);
    const known =
      complete &&
      !this.invalid &&
      !incomplete &&
      this.attempts.length > 0 &&
      this.attempts.every(
        (a) =>
          typeof a.usdEstimate === 'number' &&
          Number.isFinite(a.usdEstimate) &&
          a.usdEstimate >= 0 &&
          typeof a.provider === 'string' &&
          !!a.provider &&
          typeof a.model === 'string' &&
          !!a.model &&
          (a.source === 'provider' || a.source === 'estimated')
      );
    return {
      ...total,
      usdEstimate: known
        ? this.attempts.reduce((s, a) => s + a.usdEstimate!, 0)
        : null,
    };
  }
}
