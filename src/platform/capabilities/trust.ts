/**
 * XR Phase 7 · T3 — Evidence-based capability trust scorer.
 *
 * Constitution Art. XV.4 / §10.2: marketplace trust = signatures + provenance
 * + tests + permissions + maintenance + outcomes — **never popularity**.
 *
 * This scorer is the single "why does this capability rank?" answer:
 *
 *   final = evidenceScore × (0.95 + 0.05 × popularityFactor)
 *
 * - The evidence score is a weighted blend of seven verifiable signals.
 * - Popularity (downloads/stars) contributes at most a 5% multiplicative
 *   nudge, log-scaled, so it can NEVER dominate: a high-download but
 *   unsigned/low-evidence capability always ranks below a signed, tested one.
 * - `explain()` returns the ordered, human-readable reason list for UI/CLI.
 *
 * Scores are computed off the hot path (discovery/ranking commands, not per
 * tool call) or cached by callers.
 */

import type { CapabilityDescriptor } from "./types.ts";
import { certificationEvidenceScore } from "./certification.ts";

export const TRUST_WEIGHTS = {
  signatures: 0.25,
  publisher: 0.15,
  provenance: 0.15,
  tests: 0.25,
  permissions: 0.1,
  maintenance: 0.05,
  outcomes: 0.05,
} as const;

/** Popularity is bounded to a 5% multiplicative nudge — never a rank driver. */
export const POPULARITY_MAX_WEIGHT = 0.05;

export interface TrustComponents {
  signatures: number;
  publisher: number;
  provenance: number;
  tests: number;
  permissions: number;
  maintenance: number;
  outcomes: number;
}

export interface EvidenceScoreResult {
  score: number;
  evidenceScore: number;
  popularityFactor: number;
  components: TrustComponents;
  reasons: string[];
}

export interface OutcomeStats {
  uses: number;
  successes: number;
  failures: number;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function popularityFactor(downloads: number | undefined): number {
  if (!downloads || downloads <= 0) return 0;
  return clamp01(Math.log1p(downloads) / Math.log1p(1_000_000));
}

export class EvidenceTrustScorer {
  /** Score one descriptor. `outcomes` may come from the provenance graph. */
  score(descriptor: CapabilityDescriptor, opts: { downloads?: number; outcomes?: OutcomeStats } = {}): EvidenceScoreResult {
    const d = descriptor;
    const reasons: string[] = [];

    // 1. Signatures (package integrity + signature validity).
    let signatures = 0;
    if (d.package.signatureStatus === "valid") {
      signatures = 1;
      reasons.push("package signature valid (ed25519 envelope over package digest)");
    } else if (d.package.signatureStatus === "unverified") {
      signatures = 0.5;
      reasons.push("package has a hash but signature is unverified");
    } else if (d.package.signatureStatus === "invalid") {
      signatures = 0;
      reasons.push("package signature INVALID — treated as untrusted");
    } else if (d.trust.signedPackage) {
      signatures = 0.75;
      reasons.push("package claims a signature (status not independently verified)");
    } else {
      reasons.push("package is unsigned");
    }

    // 2. Publisher verification.
    let publisher = 0;
    if (d.publisher.verified) {
      publisher = 1;
      reasons.push(`publisher ${d.publisher.name} is verified`);
    } else {
      publisher = 0.25;
      reasons.push(`publisher ${d.publisher.name} is NOT verified`);
    }

    // 3. Provenance completeness.
    let provenance = 0;
    const p = d.provenance;
    const knownSource = p.source !== "unknown";
    const hasUrl = Boolean(p.sourceUrl || p.registry || p.ref);
    const hasTimes = Boolean(p.installedAt || p.observedAt);
    provenance = (knownSource ? 0.5 : 0) + (hasUrl ? 0.3 : 0) + (hasTimes ? 0.2 : 0);
    if (!knownSource) reasons.push("provenance source unknown");
    if (!hasUrl) reasons.push("no source URL/registry/ref recorded");

    // 4. Tests / certification (the independent evaluator).
    const certScore = certificationEvidenceScore(d.certification);
    const tests = certScore;
    if (d.certification.status === "verified") reasons.push("certification: verified (publisher + contract evidence)");
    else if (d.certification.status === "xr-tested") reasons.push("certification: xr-tested (contract tests passed)");
    else if (d.certification.status === "self-tested") reasons.push("certification: self-tested only (author-declared tests)");
    else if (d.certification.status === "quarantined") reasons.push("certification: QUARANTINED");
    else reasons.push("certification: unknown (no independent evidence yet)");

    // 5. Permissions — least privilege is evidence of care.
    const effective = d.permissions.effective.effective;
    const tier2 = new Set(["shell", "control", "browser", "secrets", "computer:act", "credential"]);
    const dangerous = effective.filter((p) => tier2.has(p)).length;
    const declared = d.permissions.declared.length;
    const permissions = clamp01(1 - dangerous * 0.45 - Math.min(declared, 12) * 0.05);
    if (dangerous) reasons.push(`${dangerous} dangerous permission(s) in effective authority`);
    if (d.permissions.effective.undetermined) reasons.push("effective authority undetermined — fail-closed by policy");
    if (!d.permissions.effective.undetermined && effective.length === 0) reasons.push("least privilege: no effective permissions");

    // 6. Maintenance.
    let maintenance = 0;
    switch (d.support.maintenance) {
      case "active": maintenance = 1; reasons.push("maintenance: active"); break;
      case "unknown": maintenance = 0.5; break;
      case "deprecated": maintenance = 0.2; reasons.push("maintenance: deprecated"); break;
      case "abandoned": maintenance = 0; reasons.push("maintenance: abandoned"); break;
    }
    if (d.trust.vulnerabilityStatus === "flagged") reasons.push("vulnerability status: FLAGGED");
    if (d.trust.vulnerabilityStatus === "quarantined") reasons.push("vulnerability status: QUARANTINED");

    // 7. Outcomes — measured use, log-scaled, failure-penalized.
    let outcomes = 0;
    const o = opts.outcomes;
    if (o && o.uses > 0) {
      const successRate = o.successes / o.uses;
      const volume = clamp01(Math.log1p(o.uses) / Math.log1p(100));
      outcomes = clamp01(successRate * volume);
      reasons.push(`${o.uses} recorded use(s): ${o.successes} ok / ${o.failures} failed`);
    } else {
      reasons.push("no recorded outcomes yet (absence of evidence, not evidence of absence)");
    }

    const components: TrustComponents = { signatures, publisher, provenance, tests, permissions, maintenance, outcomes };
    const evidenceScore = clamp01(
      signatures * TRUST_WEIGHTS.signatures +
        publisher * TRUST_WEIGHTS.publisher +
        provenance * TRUST_WEIGHTS.provenance +
        tests * TRUST_WEIGHTS.tests +
        permissions * TRUST_WEIGHTS.permissions +
        maintenance * TRUST_WEIGHTS.maintenance +
        outcomes * TRUST_WEIGHTS.outcomes,
    );

    // Popularity: log-scaled, bounded to 5% multiplicative — never dominates.
    const pop = popularityFactor(opts.downloads);
    if (opts.downloads && opts.downloads > 0) {
      reasons.push(`popularity (${opts.downloads} downloads) contributes at most ${(POPULARITY_MAX_WEIGHT * 100).toFixed(0)}% — evidence decides rank`);
    }
    let score = clamp01(evidenceScore * (1 - POPULARITY_MAX_WEIGHT + POPULARITY_MAX_WEIGHT * pop));

    // Hard floors: quarantined/flagged states cap the score regardless of
    // any other evidence or popularity (fail-closed trust, Art. XIV).
    if (d.lifecycle.state === "quarantined" || d.trust.vulnerabilityStatus === "quarantined") {
      score = Math.min(score, 0.1);
      reasons.push("capability is QUARANTINED — score capped at 10% pending review");
    } else if (d.trust.vulnerabilityStatus === "flagged") {
      score = Math.min(score, 0.3);
      reasons.push("vulnerability FLAGGED — score capped at 30% pending review");
    }

    return { score, evidenceScore, popularityFactor: pop, components, reasons };
  }

  /**
   * Rank descriptors by evidence. `downloadsOf` supplies popularity data
   * (capped by the scorer); `outcomesOf` supplies provenance outcomes.
   */
  rank(
    descriptors: CapabilityDescriptor[],
    opts: { downloadsOf?: (d: CapabilityDescriptor) => number | undefined; outcomesOf?: (d: CapabilityDescriptor) => OutcomeStats | undefined } = {},
  ): Array<{ descriptor: CapabilityDescriptor; result: EvidenceScoreResult }> {
    return descriptors
      .map((d) => ({ descriptor: d, result: this.score(d, { downloads: opts.downloadsOf?.(d), outcomes: opts.outcomesOf?.(d) }) }))
      .sort((a, b) => b.result.score - a.result.score || a.descriptor.name.localeCompare(b.descriptor.name));
  }
}

export const evidenceTrustScorer = new EvidenceTrustScorer();
