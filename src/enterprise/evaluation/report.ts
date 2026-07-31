/**
 * XR 7.0 — Evaluation reporting (Phase 13).
 *
 * Produces three things:
 *   - a scorecard (dimension results + hard gates + disclosed weights),
 *   - a raw report (every metric, effect, and verification), and
 *   - an evidence bundle (hash-verifiable export).
 *
 * Explicitly NOT a marketing score page. Every rendering shows what was
 * measured, under what configuration, what failed, and what the result does
 * not prove.
 */

import { canonicalize, digest, redactEvidence } from "./provenance.ts";
import { buildScorecard } from "./scoring.ts";
import { summarizeEffects } from "./effects.ts";
import { METRIC_DEFINITIONS } from "./metrics.ts";
import {
  EVALUATION_REPORT_VERSION,
  type ComparisonResult,
  type EvaluationRun,
  type Scorecard,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Raw report
// ═══════════════════════════════════════════════════════════════════════════

export interface RawReport {
  readonly reportVersion: string;
  readonly provenance: EvaluationRun["provenance"];
  readonly integrity: EvaluationRun["integrity"];
  readonly invalidation?: EvaluationRun["invalidation"];
  readonly metricDefinitions: typeof METRIC_DEFINITIONS;
  readonly suites: readonly {
    readonly suiteId: string;
    readonly dimension: string;
    readonly durationMs: number;
    readonly scenarios: readonly {
      readonly scenarioId: string;
      readonly scenarioVersion: number;
      readonly set: string;
      readonly determinism: string;
      readonly status: string;
      readonly statusReason: string;
      readonly durationMs: number;
      readonly confidence: unknown;
      readonly verifications: unknown;
      readonly gates: unknown;
      readonly metrics: unknown;
      readonly effectSummary: unknown;
      readonly evidence: readonly string[];
      readonly error?: string;
    }[];
  }[];
}

/** Build the full raw report. Nothing is summarised away. */
export function buildRawReport(run: EvaluationRun): RawReport {
  return Object.freeze({
    reportVersion: EVALUATION_REPORT_VERSION,
    provenance: run.provenance,
    integrity: run.integrity,
    ...(run.invalidation ? { invalidation: run.invalidation } : {}),
    metricDefinitions: METRIC_DEFINITIONS,
    suites: run.suites.map((s) => ({
      suiteId: s.suiteId,
      dimension: s.dimension,
      durationMs: s.durationMs,
      scenarios: s.scenarios.map((sc) => ({
        scenarioId: sc.scenarioId,
        scenarioVersion: sc.scenarioVersion,
        set: sc.set,
        determinism: sc.determinism,
        status: sc.status,
        statusReason: sc.statusReason,
        durationMs: sc.durationMs,
        confidence: sc.confidence,
        verifications: sc.verifications,
        gates: sc.gates,
        metrics: sc.metrics,
        // Effect targets stay in the run record; the report publishes counts.
        effectSummary: summarizeEffects(sc.effects),
        evidence: sc.evidence,
        ...(sc.error ? { error: sc.error } : {}),
      })),
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Evidence bundle
// ═══════════════════════════════════════════════════════════════════════════

export interface EvidenceBundle {
  readonly bundleVersion: string;
  readonly generatedAt: number;
  readonly runId: string;
  readonly productVersion: string;
  readonly commit: string;
  readonly scorecard: Scorecard;
  readonly raw: RawReport;
  /** Digest over the canonical bundle body, so an exported file is verifiable. */
  readonly bundleDigest: string;
  readonly verificationInstructions: string;
}

/**
 * Export a self-verifying evidence bundle.
 *
 * Public reports must redact infrastructure detail (§11), so host paths and
 * secrets are scrubbed on the way out.
 */
export function buildEvidenceBundle(run: EvaluationRun, now = Date.now()): EvidenceBundle {
  const scorecard = buildScorecard(run, { now });
  const raw = buildRawReport(run);
  const body = { runId: run.provenance.runId, scorecard, raw };
  const redactedBody = JSON.parse(redactEvidence(canonicalize(body))) as typeof body;

  return Object.freeze({
    bundleVersion: EVALUATION_REPORT_VERSION,
    generatedAt: now,
    runId: run.provenance.runId,
    productVersion: run.provenance.productVersion,
    commit: run.provenance.commit,
    scorecard: redactedBody.scorecard,
    raw: redactedBody.raw,
    bundleDigest: digest(redactedBody),
    verificationInstructions:
      "Recompute the bundle digest by canonicalising {runId, scorecard, raw} (recursively sorting object keys, " +
      "then JSON.stringify) and taking its SHA-256. It must equal bundleDigest. To reproduce the run itself, " +
      "check out the recorded commit and execute the recorded suites with the recorded deployment profile and " +
      "scenario versions. Deterministic scenarios must reproduce exactly; scenarios marked 'probabilistic' may not.",
  });
}

/** Verify an exported bundle has not been altered. */
export function verifyEvidenceBundle(bundle: EvidenceBundle): { valid: boolean; detail: string } {
  const recomputed = digest({ runId: bundle.runId, scorecard: bundle.scorecard, raw: bundle.raw });
  return recomputed === bundle.bundleDigest
    ? { valid: true, detail: "bundle digest matches" }
    : {
        valid: false,
        detail: `BUNDLE ALTERED: stored ${bundle.bundleDigest.slice(0, 16)}…, recomputed ${recomputed.slice(0, 16)}…`,
      };
}

// ═══════════════════════════════════════════════════════════════════════════
// Human-readable rendering
// ═══════════════════════════════════════════════════════════════════════════

function bar(score: number | null, width = 20): string {
  if (score === null) return "─".repeat(width);
  const filled = Math.round(score * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function pct(score: number | null): string {
  return score === null ? "  n/a" : `${(score * 100).toFixed(0).padStart(4)}%`;
}

/**
 * Render the scorecard for humans.
 *
 * Deliberately leads with what was measured and under which configuration,
 * and always ends with limitations and what the result does not prove.
 */
export function renderScorecard(run: EvaluationRun, scorecard?: Scorecard): string {
  const card = scorecard ?? buildScorecard(run);
  const p = run.provenance;
  const lines: string[] = [];

  lines.push("XR EVALUATION SCORECARD");
  lines.push("═".repeat(78));
  lines.push(`Product version   : ${p.productVersion}`);
  lines.push(`Commit            : ${p.commit}`);
  lines.push(`Run id            : ${p.runId}`);
  lines.push(`Started           : ${new Date(p.startedAt).toISOString()}`);
  lines.push(`Deployment profile: ${p.configuration.deploymentProfile}`);
  lines.push(`Locality policy   : ${p.configuration.localityPolicy}`);
  lines.push(`Scenario sets     : ${p.configuration.scenarioSets.join(", ") || "none"}`);
  lines.push(
    `Environment       : ${p.environment.runtime} ${p.environment.runtimeVersion} on ${p.environment.platform}/${p.environment.arch}, ` +
      `${p.environment.cpuCount} cpu, ${p.environment.memoryGiB} GiB${p.environment.offline ? ", OFFLINE" : ""}` +
      `${p.environment.elevated ? ", ELEVATED (root)" : ""}`,
  );
  lines.push(`Isolation backends: ${p.environment.isolationBackends.join(", ")}`);
  lines.push(`Result digest     : ${run.integrity.digest.slice(0, 32)}…`);
  if (run.invalidation) {
    lines.push("");
    lines.push(`!! THIS RUN WAS INVALIDATED: ${run.invalidation.reason}`);
    lines.push(`   (original digest preserved: ${run.invalidation.originalDigest.slice(0, 32)}…)`);
  }
  lines.push("");

  // Hard gates first — they can never be buried under a quality number.
  if (card.hardFailure) {
    lines.push("HARD SAFETY GATE FAILURES");
    lines.push("─".repeat(78));
    for (const f of card.hardFailures) lines.push(`  ✗ ${f}`);
    lines.push("");
    lines.push("  No overall score is published while a critical safety gate is failing.");
    lines.push("");
  } else {
    lines.push("Hard safety gates : all held");
    lines.push("");
  }

  lines.push("DIMENSIONS");
  lines.push("─".repeat(78));
  lines.push(
    `${"dimension".padEnd(14)}${"score".padStart(6)}  ${"".padEnd(20)}  ${"pass".padStart(5)}${"part".padStart(5)}${"fail".padStart(5)}${"blk".padStart(5)}${"n/a".padStart(5)}${"err".padStart(5)}  conf  gate`,
  );
  for (const d of card.dimensions) {
    lines.push(
      `${d.dimension.padEnd(14)}${pct(d.score)}  ${bar(d.score)}  ` +
        `${String(d.passed).padStart(5)}${String(d.partial).padStart(5)}${String(d.failed).padStart(5)}` +
        `${String(d.blocked).padStart(5)}${String(d.notApplicable).padStart(5)}${String(d.errored).padStart(5)}  ` +
        `${d.confidence.value.toFixed(2)}  ${d.gating ? (d.hardFailure ? "FAIL" : "ok") : "—"}`,
    );
  }
  lines.push("");
  lines.push(`Overall quality   : ${card.overall === null ? "not published (see hard gate failures)" : `${(card.overall * 100).toFixed(1)}%`}`);
  lines.push("");

  lines.push("WEIGHTS (disclosed)");
  lines.push("─".repeat(78));
  lines.push(
    Object.entries(card.weights)
      .map(([k, v]) => `${k}=${v}`)
      .join("  "),
  );
  lines.push("");

  if (card.blindSpots.length > 0) {
    lines.push("KNOWN BLIND SPOTS");
    lines.push("─".repeat(78));
    for (const b of card.blindSpots) lines.push(`  • ${b}`);
    lines.push("");
  }

  lines.push("LIMITATIONS");
  lines.push("─".repeat(78));
  for (const l of card.limitations) lines.push(`  • ${l}`);
  lines.push("");

  lines.push("WHAT THIS DOES NOT PROVE");
  lines.push("─".repeat(78));
  for (const d of card.doesNotProve) lines.push(`  • ${d}`);

  return lines.join("\n");
}

/** Render a per-scenario breakdown for a suite or the whole run. */
export function renderScenarioDetail(run: EvaluationRun, suiteId?: string): string {
  const lines: string[] = [];
  for (const suite of run.suites) {
    if (suiteId && suite.suiteId !== suiteId) continue;
    lines.push(`\n${suite.suiteId.toUpperCase()} (${suite.dimension}) — ${suite.durationMs}ms`);
    lines.push("─".repeat(78));
    for (const s of suite.scenarios) {
      const mark =
        s.status === "passed" ? "✓" : s.status === "partial" ? "~" : s.status === "not_applicable" ? "·" : "✗";
      lines.push(`  ${mark} [${s.status}] ${s.scenarioId} v${s.scenarioVersion} (${s.set}, ${s.determinism}, ${s.durationMs}ms)`);
      lines.push(`      ${s.statusReason}`);
      for (const v of s.verifications) {
        if (!v.satisfied) lines.push(`      · unmet${v.required ? "" : " (optional)"}: ${v.detail}`);
      }
      for (const g of s.gates) {
        if (!g.held) lines.push(`      ! GATE ${g.gateId} (${g.severity}): ${g.detail}`);
      }
      for (const b of s.confidence.blindSpots) lines.push(`      ? blind spot: ${b}`);
    }
  }
  return lines.join("\n");
}

/** Render a release-over-release comparison. */
export function renderComparison(comparison: ComparisonResult): string {
  const lines: string[] = [];
  lines.push("XR EVALUATION COMPARISON");
  lines.push("═".repeat(78));
  lines.push(`Baseline : ${comparison.baselineRunId}`);
  lines.push(`Candidate: ${comparison.candidateRunId}`);
  lines.push(`Comparable: ${comparison.comparable ? "yes" : "NO"}`);
  lines.push("");

  if (comparison.incomparableReasons.length > 0) {
    lines.push("COMPARABILITY WARNINGS");
    lines.push("─".repeat(78));
    for (const r of comparison.incomparableReasons) lines.push(`  • ${r}`);
    lines.push("");
  }

  if (comparison.regressions.length > 0) {
    lines.push("REGRESSIONS");
    lines.push("─".repeat(78));
    for (const r of [...comparison.regressions].sort((a, b) => (a.severity === "critical" ? -1 : 1))) {
      lines.push(`  ${r.severity === "critical" ? "✗✗" : "✗ "} [${r.severity}/${r.kind}] ${r.scenarioId} (${r.dimension})`);
      lines.push(`      ${r.detail}`);
    }
    lines.push("");
  } else {
    lines.push("No regressions detected.");
    lines.push("");
  }

  if (comparison.improvements.length > 0) {
    lines.push("IMPROVEMENTS");
    lines.push("─".repeat(78));
    for (const i of comparison.improvements) {
      lines.push(`  ✓ ${i.scenarioId} (${i.dimension}): ${i.baselineStatus} → ${i.candidateStatus}`);
    }
    lines.push("");
  }

  lines.push(`Unchanged: ${comparison.unchanged}`);
  if (comparison.onlyInBaseline.length > 0) {
    lines.push(`Only in baseline (coverage removed): ${comparison.onlyInBaseline.join(", ")}`);
  }
  if (comparison.onlyInCandidate.length > 0) {
    lines.push(`Only in candidate (new coverage): ${comparison.onlyInCandidate.join(", ")}`);
  }
  if (comparison.overfittingSuspected) {
    lines.push("");
    lines.push(`!! OVERFITTING SUSPECTED: ${comparison.overfittingDetail}`);
  }

  return lines.join("\n");
}

/** Machine-readable scorecard for `--json` consumers. */
export function scorecardJson(run: EvaluationRun): Record<string, unknown> {
  const card = buildScorecard(run);
  return {
    reportVersion: card.reportVersion,
    runId: card.runId,
    productVersion: card.productVersion,
    commit: run.provenance.commit,
    generatedAt: card.generatedAt,
    environment: run.provenance.environment,
    configuration: run.provenance.configuration,
    integrity: run.integrity,
    overall: card.overall,
    hardFailure: card.hardFailure,
    hardFailures: card.hardFailures,
    weights: card.weights,
    dimensions: card.dimensions,
    limitations: card.limitations,
    blindSpots: card.blindSpots,
    doesNotProve: card.doesNotProve,
    ...(run.invalidation ? { invalidation: run.invalidation } : {}),
  };
}
