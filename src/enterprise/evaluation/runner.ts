/**
 * XR 7.0 — Evaluation runner (Phase 13).
 *
 * The runner is the adjudicator. A scenario reports verifications and
 * evidence; the runner decides the status, evaluates the hard safety gates,
 * enforces budgets, and stamps provenance.
 *
 * Integrity properties this file is responsible for:
 *   - a scenario cannot declare itself "passed";
 *   - a scenario cannot skip or weaken its safety gates;
 *   - a scenario cannot silently retry to inflate its score;
 *   - a scenario cannot exceed its declared effect budget unnoticed;
 *   - a scenario cannot mutate its recorded result after the fact;
 *   - every scenario runs in a fresh, disposable fixture.
 */

import { FixtureWorkspace } from "./fixtures.ts";
import { EffectRecorder, findEffectViolations } from "./effects.ts";
import { MetricCollector } from "./metrics.ts";
import { evaluateSafetyGates, gatesHeldRatio, hasCriticalViolation, violatedGates } from "./gates.ts";
import {
  buildConfiguration,
  buildProvenance,
  captureEnvironment,
  computeIntegrity,
  digest,
  redactEvidence,
  seededRandom,
} from "./provenance.ts";
import {
  allRequiredSatisfied,
  anyOptionalFailed,
} from "./verifiers.ts";
import {
  type EvaluationRun,
  type ScenarioContext,
  type ScenarioDefinition,
  type ScenarioOutcome,
  type ScenarioResult,
  type ScenarioSet,
  type ScenarioStatus,
  type SuiteDefinition,
  type SuiteResult,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════════════

export interface RunOptions {
  /** Restrict to these suites (by id). Empty = all. */
  readonly suiteIds?: readonly string[];
  /** Restrict to these scenarios (by id). Empty = all. */
  readonly scenarioIds?: readonly string[];
  /** Restrict to these scenario sets. Default: all. */
  readonly sets?: readonly ScenarioSet[];
  /** Deployment profile under test. */
  readonly deploymentProfile?: string;
  /** Locality policy under test. */
  readonly localityPolicy?: string;
  /** Run with no network permitted. Required-local subset must pass here. */
  readonly offline?: boolean;
  /** Only run scenarios that are offline-capable. */
  readonly offlineOnly?: boolean;
  /** Fixed clock for reproducible runs. */
  readonly now?: number;
  /** Product version override (defaults to CORE_VERSION). */
  readonly productVersion?: string;
  /** Commit override. */
  readonly commit?: string;
  /** Deterministic seed base. */
  readonly seed?: string;
  /** Progress callback (CLI/daemon UX). */
  readonly onScenario?: (result: ScenarioResult) => void;
  /** Injected isolation backend list (tests). */
  readonly isolationBackends?: readonly string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Status adjudication
// ═══════════════════════════════════════════════════════════════════════════

interface Adjudication {
  readonly status: ScenarioStatus;
  readonly reason: string;
}

/**
 * Decide the scenario status.
 *
 * Order matters. A critical gate violation wins over everything: a scenario
 * that produced a perfect artifact while leaking a secret is `blocked`, not
 * `passed`.
 */
export function adjudicate(
  outcome: ScenarioOutcome,
  gatesCritical: boolean,
  gateDetails: readonly string[],
  effectViolations: readonly string[],
): Adjudication {
  if (gatesCritical) {
    return {
      status: "blocked",
      reason: `hard safety gate violated: ${gateDetails.join("; ")}`,
    };
  }
  if (effectViolations.length > 0) {
    return {
      status: "blocked",
      reason: `scenario produced effects it declared it would not: ${effectViolations.join("; ")}`,
    };
  }
  if (outcome.notApplicable) {
    return { status: "not_applicable", reason: outcome.notApplicable };
  }
  if (outcome.verifications.length === 0) {
    return {
      status: "errored",
      reason: "scenario returned no verifications — an outcome cannot be asserted without verification",
    };
  }
  if (!allRequiredSatisfied(outcome.verifications)) {
    const failed = outcome.verifications.filter((v) => v.required && !v.satisfied).map((v) => v.detail);
    return { status: "failed", reason: failed.join("; ") };
  }
  if (outcome.partialReason) {
    return { status: "partial", reason: outcome.partialReason };
  }
  if (anyOptionalFailed(outcome.verifications)) {
    const failed = outcome.verifications.filter((v) => !v.required && !v.satisfied).map((v) => v.detail);
    return { status: "partial", reason: `optional verification(s) unmet: ${failed.join("; ")}` };
  }
  return {
    status: "passed",
    reason: `all ${outcome.verifications.length} verification(s) satisfied`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario execution
// ═══════════════════════════════════════════════════════════════════════════

export interface ExecuteScenarioOptions {
  readonly offline: boolean;
  readonly deploymentProfile: string;
  readonly seed: string;
  readonly now?: number;
}

/**
 * Execute one scenario in a disposable fixture and adjudicate the result.
 *
 * There is deliberately NO retry loop here. Retrying until a scenario passes
 * is score inflation; if a scenario is flaky, that is a finding, reported
 * through determinism and confidence rather than hidden.
 */
export async function executeScenario(
  scenario: ScenarioDefinition,
  suiteId: string,
  opts: ExecuteScenarioOptions,
): Promise<ScenarioResult> {
  const startedAt = opts.now ?? Date.now();
  const t0 = performance.now();

  const workspace = FixtureWorkspace.create();
  const effects = new EffectRecorder(() => opts.now ?? Date.now());
  const metrics = new MetricCollector();
  const notes: string[] = [];
  const random = seededRandom(`${opts.seed}:${scenario.id}:${scenario.version}`);


  const ctx: ScenarioContext = Object.freeze({
    fixtureRoot: workspace.root,
    recordEffect: (e: Parameters<ScenarioContext["recordEffect"]>[0]) => effects.record(e),
    recordMetric: (m: Parameters<ScenarioContext["recordMetric"]>[0]) => metrics.record(m),
    // Stored raw here; redacted below before persistence. Gates need the raw form.
    note: (text: string) => notes.push(text),
    now: () => opts.now ?? Date.now(),
    random,
    offline: opts.offline,
    deploymentProfile: opts.deploymentProfile,
  });

  let outcome: ScenarioOutcome | null = null;
  let harnessError: string | undefined;

  try {
    outcome = await withTimeout(
      Promise.resolve(scenario.run(ctx)),
      scenario.budget.wallClockMs,
      `scenario exceeded its ${scenario.budget.wallClockMs}ms budget`,
    );
  } catch (e) {
    harnessError = redactEvidence(e instanceof Error ? e.message : String(e));
  }

  const durationMs = performance.now() - t0;

  // Two views of the same evidence:
  //   rawEvidence      — what the scenario actually tried to emit. Gates
  //                      inspect this, otherwise the secret-leak gate would be
  //                      vacuous: redaction would erase the very thing it must
  //                      detect. Never persisted.
  //   evidence         — redacted. This is what is stored, exported, published.
  const rawNotes = notes.map((nRaw) => nRaw);
  const rawEvidence = [...rawNotes, ...(outcome?.evidence ?? [])];
  const evidence = rawEvidence.map(redactEvidence);

  const recordedEffects = effects.list();
  const rawEffects = effects.listRawForGates();

  // Effect-budget enforcement.
  const budgetViolations: string[] = [];
  if (recordedEffects.length > scenario.budget.maxEffects) {
    budgetViolations.push(
      `produced ${recordedEffects.length} effects, exceeding its declared budget of ${scenario.budget.maxEffects}`,
    );
  }
  const declaredViolations = findEffectViolations(recordedEffects, scenario.allowedEffects).map((v) => v.reason);

  // Digest the observable result body before and after gate evaluation so a
  // scenario cannot rewrite its own outcome while gates are running.
  const preGateDigest = digest({ verifications: outcome?.verifications ?? [], effects: recordedEffects, evidence });

  const gates = evaluateSafetyGates({
    scenario,
    workspace,
    // Gates see the UNREDACTED form so a leak attempt is detectable.
    effects: rawEffects,
    evidence: rawEvidence,
    offline: opts.offline,
    preGateDigest,
    postGateDigest: digest({ verifications: outcome?.verifications ?? [], effects: effects.list(), evidence }),
  });

  metrics.record({ metricId: "latency.wall_clock_ms", value: Math.round(durationMs) });
  metrics.record({ metricId: "safety.gates_held", value: gatesHeldRatio(gates) });

  let adjudication: Adjudication;
  if (harnessError !== undefined) {
    // A harness failure is `errored`, never a silent pass.
    const critical = hasCriticalViolation(gates);
    adjudication = critical
      ? { status: "blocked", reason: `hard safety gate violated: ${violatedGates(gates).join("; ")}` }
      : { status: "errored", reason: `harness error: ${harnessError}` };
  } else {
    adjudication = adjudicate(
      outcome!,
      hasCriticalViolation(gates),
      violatedGates(gates),
      [...declaredViolations, ...budgetViolations],
    );
  }

  workspace.dispose();

  const result: ScenarioResult = Object.freeze({
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    suiteId,
    dimension: scenario.dimension,
    set: scenario.set,
    determinism: scenario.determinism,
    status: adjudication.status,
    statusReason: adjudication.reason,
    verifications: Object.freeze([...(outcome?.verifications ?? [])]),
    gates,
    metrics: metrics.list(),
    effects: recordedEffects,
    evidence: Object.freeze(evidence),
    confidence: Object.freeze({
      value: scenario.determinism === "deterministic" ? 1 : scenario.determinism === "bounded" ? 0.8 : 0.5,
      basis:
        scenario.determinism === "deterministic"
          ? "deterministic scenario: identical fixture and configuration yield an identical verified outcome"
          : scenario.determinism === "bounded"
            ? "bounded scenario: varies within a declared tolerance (e.g. timing)"
            : "probabilistic scenario: depends on model/provider behaviour; a single run is indicative only",
      samples: 1,
      blindSpots: scenario.blindSpots,
    }),
    durationMs: Math.round(durationMs),
    startedAt,
    ...(harnessError !== undefined ? { error: harnessError } : {}),
  });

  return result;
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Suite / run execution
// ═══════════════════════════════════════════════════════════════════════════

export class EvaluationRunner {
  constructor(private readonly suites: readonly SuiteDefinition[]) {}

  /** Digest of the scenario registry — detects unversioned scenario edits. */
  registryDigest(): string {
    return digest(
      this.suites.map((s) => ({
        id: s.id,
        version: s.version,
        scenarios: s.scenarios.map((sc) => ({
          id: sc.id,
          version: sc.version,
          dimension: sc.dimension,
          set: sc.set,
          determinism: sc.determinism,
          intent: sc.intent,
          expectedOutcome: sc.expectedOutcome,
        })),
      })),
    );
  }

  private selectSuites(opts: RunOptions): SuiteDefinition[] {
    const wanted = new Set(opts.suiteIds ?? []);
    return this.suites.filter((s) => wanted.size === 0 || wanted.has(s.id));
  }

  private selectScenarios(suite: SuiteDefinition, opts: RunOptions): ScenarioDefinition[] {
    const wantedIds = new Set(opts.scenarioIds ?? []);
    const wantedSets = new Set(opts.sets ?? []);
    const profile = opts.deploymentProfile ?? "personal_local";
    return suite.scenarios.filter((sc) => {
      if (wantedIds.size > 0 && !wantedIds.has(sc.id)) return false;
      if (wantedSets.size > 0 && !wantedSets.has(sc.set)) return false;
      if (opts.offlineOnly && !sc.offlineCapable) return false;
      if (sc.profiles.length > 0 && !sc.profiles.includes(profile)) return false;
      return true;
    });
  }

  async run(opts: RunOptions = {}): Promise<EvaluationRun> {
    const offline = opts.offline ?? false;
    const deploymentProfile = opts.deploymentProfile ?? "personal_local";
    const seed = opts.seed ?? "xr-evaluation-default-seed";
    const startedAt = opts.now ?? Date.now();

    const suites = this.selectSuites(opts);
    const suiteResults: SuiteResult[] = [];
    const setsSeen = new Set<ScenarioSet>();

    for (const suite of suites) {
      const scenarios = this.selectScenarios(suite, opts);
      if (scenarios.length === 0) continue;

      const st0 = performance.now();
      const results: ScenarioResult[] = [];
      for (const scenario of scenarios) {
        setsSeen.add(scenario.set);
        const r = await executeScenario(scenario, suite.id, {
          offline,
          deploymentProfile,
          seed,
          ...(opts.now !== undefined ? { now: opts.now } : {}),
        });
        results.push(r);
        opts.onScenario?.(r);
      }

      suiteResults.push(
        Object.freeze({
          suiteId: suite.id,
          suiteVersion: suite.version,
          dimension: suite.dimension,
          scenarios: Object.freeze(results),
          durationMs: Math.round(performance.now() - st0),
        }),
      );
    }

    const registryDigest = this.registryDigest();
    const provenance = buildProvenance({
      ...(opts.productVersion !== undefined ? { productVersion: opts.productVersion } : {}),
      ...(opts.commit !== undefined ? { commit: opts.commit } : {}),
      now: startedAt,
      environment: captureEnvironment({
        offline,
        ...(opts.isolationBackends !== undefined ? { isolationBackends: opts.isolationBackends } : {}),
      }),
      configuration: buildConfiguration({
        deploymentProfile,
        ...(opts.localityPolicy !== undefined ? { localityPolicy: opts.localityPolicy } : {}),
        scenarioSets: [...setsSeen],
      }),
      registryDigest,
    });

    const finished: EvaluationRun = Object.freeze({
      provenance: Object.freeze({ ...provenance, finishedAt: opts.now ?? Date.now() }),
      suites: Object.freeze(suiteResults),
      integrity: computeIntegrity(
        { provenance: Object.freeze({ ...provenance, finishedAt: opts.now ?? Date.now() }), suites: suiteResults },
        registryDigest,
      ),
    });

    return finished;
  }

  /**
   * Re-run a scenario N times and report whether it is actually reproducible.
   *
   * This is how the harness proves (rather than asserts) determinism, and how
   * nondeterminism gets disclosed instead of hidden.
   */
  async checkReproducibility(
    scenarioId: string,
    runs = 2,
    opts: RunOptions = {},
  ): Promise<{
    scenarioId: string;
    reproducible: boolean;
    declaredDeterminism: string;
    statuses: string[];
    detail: string;
  }> {
    const scenario = this.findScenario(scenarioId);
    if (!scenario) throw new Error(`Unknown scenario "${scenarioId}"`);

    const statuses: ScenarioStatus[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await executeScenario(scenario.scenario, scenario.suiteId, {
        offline: opts.offline ?? false,
        deploymentProfile: opts.deploymentProfile ?? "personal_local",
        seed: opts.seed ?? "xr-evaluation-default-seed",
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      });
      statuses.push(r.status);
    }

    const unique = [...new Set(statuses)];
    const reproducible = unique.length === 1;
    return {
      scenarioId,
      reproducible,
      declaredDeterminism: scenario.scenario.determinism,
      statuses,
      detail: reproducible
        ? `${runs} runs produced the same status "${unique[0]}"`
        : `NONDETERMINISM DETECTED: ${runs} runs produced differing statuses [${statuses.join(", ")}] ` +
          `while the scenario declares itself "${scenario.scenario.determinism}"`,
    };
  }

  findScenario(scenarioId: string): { suiteId: string; scenario: ScenarioDefinition } | null {
    for (const suite of this.suites) {
      const scenario = suite.scenarios.find((s) => s.id === scenarioId);
      if (scenario) return { suiteId: suite.id, scenario };
    }
    return null;
  }

  listSuites(): readonly SuiteDefinition[] {
    return this.suites;
  }

  /** Count of scenarios that can run with no network at all. */
  offlineCapableCount(): number {
    return this.suites.reduce((n, s) => n + s.scenarios.filter((x) => x.offlineCapable).length, 0);
  }

  totalScenarioCount(): number {
    return this.suites.reduce((n, s) => n + s.scenarios.length, 0);
  }
}
