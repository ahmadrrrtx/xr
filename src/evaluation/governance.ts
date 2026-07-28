/**
 * XR 7.0 — Evaluation governance (Phase 13).
 *
 * Two jobs:
 *
 *  1. Benchmark change control. A scenario's meaning must not change without a
 *     version bump, because silently editing a scenario invalidates every
 *     historical comparison. `detectUnversionedChanges` makes that detectable.
 *
 *  2. Architecture protection (§7.9). When evaluation discovers a gap, it must
 *     be classified and owned, so measurement cannot quietly become an
 *     unbounded roadmap.
 */

import { digest } from "./provenance.ts";
import {
  type DiscoveredGap,
  type GapClassification,
  type ScenarioChangeRecord,
  type ScenarioDefinition,
  type SuiteDefinition,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Scenario change control
// ═══════════════════════════════════════════════════════════════════════════

/** The semantic fingerprint of a scenario — what makes results comparable. */
export interface ScenarioFingerprint {
  readonly scenarioId: string;
  readonly version: number;
  readonly dimension: string;
  readonly set: string;
  readonly determinism: string;
  /** Hash over the parts that define what the scenario MEANS. */
  readonly semanticDigest: string;
}

/**
 * Fingerprint a scenario.
 *
 * Deliberately excludes the function body: implementation may be refactored,
 * but intent, expected outcome, dimension, set, determinism, allowed effects,
 * and profile applicability define comparability.
 */
export function fingerprintScenario(s: ScenarioDefinition): ScenarioFingerprint {
  return Object.freeze({
    scenarioId: s.id,
    version: s.version,
    dimension: s.dimension,
    set: s.set,
    determinism: s.determinism,
    semanticDigest: digest({
      intent: s.intent,
      expectedOutcome: s.expectedOutcome,
      dimension: s.dimension,
      set: s.set,
      determinism: s.determinism,
      profiles: [...s.profiles].sort(),
      offlineCapable: s.offlineCapable,
      allowedEffects: s.allowedEffects,
      contracts: [...s.contracts].sort(),
    }),
  });
}

export function fingerprintSuites(suites: readonly SuiteDefinition[]): ScenarioFingerprint[] {
  const out: ScenarioFingerprint[] = [];
  for (const suite of suites) for (const s of suite.scenarios) out.push(fingerprintScenario(s));
  return out.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
}

export interface ChangeFinding {
  readonly scenarioId: string;
  readonly kind: "added" | "removed" | "versioned_change" | "unversioned_change";
  readonly detail: string;
  /** True when this change invalidates prior results for comparison. */
  readonly invalidatesHistory: boolean;
}

/**
 * Compare two scenario registries.
 *
 * An `unversioned_change` is a governance VIOLATION: the scenario's meaning
 * changed while its version stayed the same, which silently corrupts every
 * historical trend that includes it.
 */
export function detectUnversionedChanges(
  previous: readonly ScenarioFingerprint[],
  current: readonly ScenarioFingerprint[],
): ChangeFinding[] {
  const prev = new Map(previous.map((f) => [f.scenarioId, f]));
  const curr = new Map(current.map((f) => [f.scenarioId, f]));
  const findings: ChangeFinding[] = [];

  for (const [id, c] of curr) {
    const p = prev.get(id);
    if (!p) {
      findings.push({
        scenarioId: id,
        kind: "added",
        detail: `new scenario at version ${c.version}`,
        invalidatesHistory: false,
      });
      continue;
    }
    if (p.semanticDigest === c.semanticDigest) {
      if (p.version !== c.version) {
        findings.push({
          scenarioId: id,
          kind: "versioned_change",
          detail: `version bumped ${p.version} → ${c.version} with no semantic change (harmless but unnecessary)`,
          invalidatesHistory: true,
        });
      }
      continue;
    }
    if (p.version === c.version) {
      findings.push({
        scenarioId: id,
        kind: "unversioned_change",
        detail:
          `GOVERNANCE VIOLATION: the scenario's meaning changed but its version is still ${c.version}. ` +
          `Historical results for this scenario are no longer comparable and would be silently misleading.`,
        invalidatesHistory: true,
      });
    } else {
      findings.push({
        scenarioId: id,
        kind: "versioned_change",
        detail: `meaning changed, version correctly bumped ${p.version} → ${c.version}`,
        invalidatesHistory: true,
      });
    }
  }

  for (const [id, p] of prev) {
    if (!curr.has(id)) {
      findings.push({
        scenarioId: id,
        kind: "removed",
        detail: `scenario removed (was version ${p.version}) — coverage decreased`,
        invalidatesHistory: true,
      });
    }
  }

  return findings;
}

/** Throw when any unversioned semantic change is present. */
export function assertNoUnversionedChanges(findings: readonly ChangeFinding[]): void {
  const violations = findings.filter((f) => f.kind === "unversioned_change");
  if (violations.length > 0) {
    throw new Error(
      `Benchmark governance violation: ${violations.length} scenario(s) changed meaning without a version bump:\n` +
        violations.map((v) => `  - ${v.scenarioId}: ${v.detail}`).join("\n"),
    );
  }
}

export function recordScenarioChange(params: {
  scenarioId: string;
  fromVersion: number | null;
  toVersion: number;
  reason: string;
  approvedBy: string;
  invalidatesPriorResults: boolean;
  at?: number;
}): ScenarioChangeRecord {
  return Object.freeze({
    scenarioId: params.scenarioId,
    fromVersion: params.fromVersion,
    toVersion: params.toVersion,
    reason: params.reason,
    approvedBy: params.approvedBy,
    at: params.at ?? Date.now(),
    invalidatesPriorResults: params.invalidatesPriorResults,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Architecture protection (§7.9)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classifications that MAY be fixed inside a measurement phase.
 *
 * Everything else is future product work and must not expand the phase.
 */
const FIXABLE_IN_PHASE: readonly GapClassification[] = Object.freeze([
  "correctness_defect",
  "security_defect",
  "performance_reliability_defect",
  "documentation_ux_defect",
]);

export function classifyGap(params: {
  id: string;
  summary: string;
  classification: GapClassification;
  owner: string;
  detail: string;
}): DiscoveredGap {
  if (!params.owner.trim()) {
    throw new Error(`Gap "${params.id}" has no owner. Every discovered gap must be owned (§7.9).`);
  }
  return Object.freeze({
    id: params.id,
    summary: params.summary,
    classification: params.classification,
    owner: params.owner,
    fixableInPhase: FIXABLE_IN_PHASE.includes(params.classification),
    detail: params.detail,
  });
}

/**
 * Assert that no gap classified as future product work is being treated as
 * in-scope. This is the executable form of "this phase must not become a
 * hidden Phase 14".
 */
export function assertNoScopeCreep(gaps: readonly DiscoveredGap[]): void {
  const creeping = gaps.filter((g) => g.classification === "future_product_work" && g.fixableInPhase);
  if (creeping.length > 0) {
    throw new Error(
      `Scope violation: ${creeping.length} gap(s) classified as future product work are marked fixable in this phase: ` +
        creeping.map((g) => g.id).join(", "),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// The gaps Phase 13 itself discovered
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gaps found by building and running the XR 7.0 evaluation harness.
 *
 * Recorded here so the record is executable and reviewable rather than a
 * paragraph in a document that drifts.
 */
export const PHASE13_DISCOVERED_GAPS: readonly DiscoveredGap[] = Object.freeze([
  classifyGap({
    id: "gap.workflow-content-hash-too-narrow",
    summary: "Published workflow definitions were not tamper-evident for their executable content.",
    classification: "security_defect",
    owner: "workflow",
    detail:
      "hashDefinition() covered only definitionId, version, node id+kind, and entryNodeIds. A published " +
      "definition's tool inputs, target capability, riskTier, and requiresApproval flag could all be modified " +
      "while verifyIntegrity() still returned true — and WorkflowEngine.publishDefinition/getDefinition rely on " +
      "that check. FIXED IN PHASE 13: the hash now covers full node content plus definition metadata, with " +
      "hashDefinitionLegacyV1 retained so pre-7.0 definitions still load.",
  }),
  classifyGap({
    id: "gap.readme-provider-count-inconsistent",
    summary: "README stated both '20+ providers' and '12+ providers'.",
    classification: "documentation_ux_defect",
    owner: "docs",
    detail:
      "Two contradictory provider counts appeared in README.md. Provider count is explicitly not a success " +
      "metric under Phase 13, but a self-contradictory public number is a documentation defect. FIXED IN " +
      "PHASE 13: counted from PRESETS in src/providers/presets.ts (26 = 16 hosted + 10 local) and stated " +
      "consistently, with an explicit note that the count is not a quality measure.",
  }),
  classifyGap({
    id: "gap.business-command-missing-from-catalog",
    summary: "`xr business` was functional but absent from the CLI help catalog.",
    classification: "documentation_ux_defect",
    owner: "docs",
    detail:
      "The Phase 10 business operating layer registered `business`/`biz` commands on the kernel, but neither " +
      "appeared in src/cli/catalog.ts, so `xr help --all` never listed them and users could not discover the " +
      "feature. Found by the Phase 13 CLI compatibility contract test. FIXED IN PHASE 13: a catalog entry with " +
      "subcommands, examples, and topics was added.",
  }),
  classifyGap({
    id: "gap.cancellation-cannot-abort-uncooperative-work",
    summary: "Cancellation stops XR waiting, but cannot abort JavaScript that ignores the signal.",
    classification: "future_product_work",
    owner: "execution",
    detail:
      "runWithGuards() races a cancellation watchdog and stops waiting, but the underlying action may continue " +
      "in the background. XR is already honest about this and records side-effect uncertainty. True preemption " +
      "would require worker/process-level execution for all adapters — a runtime change, explicitly OUT of scope " +
      "for a measurement phase.",
  }),
  classifyGap({
    id: "gap.no-independent-third-party-evaluation",
    summary: "All benchmark evidence is self-generated by XR.",
    classification: "future_product_work",
    owner: "governance",
    detail:
      "Phase 13 separates development/validation/independent scenario SETS and detects overfitting, but every " +
      "run is still executed by XR itself. Genuinely independent evaluation requires an external party and is " +
      "out of scope for this phase. Disclosed as a standing limitation on every scorecard.",
  }),
  classifyGap({
    id: "gap.ux-metrics-are-structural-proxies",
    summary: "UX comprehension metrics are structural proxies, not human studies.",
    classification: "future_product_work",
    owner: "ux",
    detail:
      "Approval and failure comprehension are measured by checking that required information is present and " +
      "structured. That is a proxy. A real comprehension claim needs a sampled user study with documented " +
      "methodology, which this phase does not attempt and does not claim.",
  }),
]);
