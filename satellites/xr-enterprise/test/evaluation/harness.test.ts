/**
 * XR 7.0 — Phase 13 tests: harness core.
 *
 * Covers scenario validation, fixture isolation, metric calculation, verifier
 * correctness, safety gates, score aggregation, confidence, and provenance.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  ALL_SUITES,
  EvaluationRunner,
  FixtureWorkspace,
  MetricCollector,
  METRIC_DEFINITIONS,
  EffectRecorder,
  adjudicate,
  assertNoConflictingMetrics,
  assertNoHiddenCriticalFailure,
  assertNotRealUserHome,
  buildScorecard,
  canonicalize,
  deriveConfidence,
  digest,
  evaluateSafetyGates,
  findEffectViolations,
  fixtureRegistryDigest,
  gatesHeldRatio,
  hasCriticalViolation,
  redactEvidence,
  scoreDimension,
  seededRandom,
  verifyArtifact,
  verifyComprehension,
  verifyEvidence,
  verifyPolicy,
  verifyPredicate,
  verifyRecords,
  verifySideEffects,
  verifyState,
  NO_EXTERNAL_EFFECTS,
  type ScenarioDefinition,
  type ScenarioResult,
  type SafetyGateResult,
} from "../../src/enterprise/evaluation/index.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Scenario registry validation
// ═══════════════════════════════════════════════════════════════════════════

describe("scenario registry", () => {
  test("every scenario has a unique id", () => {
    const ids = new Set<string>();
    for (const suite of ALL_SUITES) {
      for (const s of suite.scenarios) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
      }
    }
    expect(ids.size).toBeGreaterThan(0);
  });

  test("every scenario declares intent, expected outcome, and blind spots", () => {
    for (const suite of ALL_SUITES) {
      for (const s of suite.scenarios) {
        expect(s.intent.length).toBeGreaterThan(20);
        expect(s.expectedOutcome.length).toBeGreaterThan(20);
        expect(s.version).toBeGreaterThanOrEqual(1);
        expect(s.contracts.length).toBeGreaterThan(0);
        expect(Array.isArray(s.blindSpots)).toBe(true);
      }
    }
  });

  test("scenario dimension matches its suite dimension", () => {
    for (const suite of ALL_SUITES) {
      for (const s of suite.scenarios) {
        expect(s.dimension).toBe(suite.dimension);
      }
    }
  });

  test("all 14 platform dimensions are covered", () => {
    const covered = new Set(ALL_SUITES.map((s) => s.dimension));
    for (const d of [
      "runtime", "execution", "trust", "durability", "intelligence", "context",
      "workflow", "environment", "capability", "business", "deployment",
      "enterprise", "dx", "ux",
    ]) {
      expect(covered.has(d as never)).toBe(true);
    }
  });

  test("all three scenario sets are represented", () => {
    const sets = new Set<string>();
    for (const suite of ALL_SUITES) for (const s of suite.scenarios) sets.add(s.set);
    expect(sets.has("development")).toBe(true);
    expect(sets.has("validation")).toBe(true);
    expect(sets.has("independent")).toBe(true);
  });

  test("a local/offline benchmark subset exists", () => {
    const runner = new EvaluationRunner(ALL_SUITES);
    expect(runner.offlineCapableCount()).toBeGreaterThan(0);
  });

  test("no scenario permits network in the offline subset", () => {
    for (const suite of ALL_SUITES) {
      for (const s of suite.scenarios) {
        if (s.offlineCapable) expect(s.allowedEffects.network).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fixture isolation
// ═══════════════════════════════════════════════════════════════════════════

describe("fixture isolation", () => {
  test("refuses the real user home as a fixture root", () => {
    expect(() => assertNotRealUserHome(homedir())).toThrow(/protected real directory/);
  });

  test("refuses a path inside the real XR home", () => {
    expect(() => assertNotRealUserHome(`${homedir()}/.xr/anything`)).toThrow(/real XR home/);
  });

  test("creates and disposes a temp workspace", () => {
    const ws = FixtureWorkspace.create();
    expect(existsSync(ws.root)).toBe(true);
    ws.write("a/b.txt", "hello");
    expect(ws.read("a/b.txt")).toBe("hello");
    ws.dispose();
    expect(existsSync(ws.root)).toBe(false);
  });

  test("refuses path traversal outside the fixture", () => {
    const ws = FixtureWorkspace.create();
    try {
      expect(() => ws.resolve("../../../etc/passwd")).toThrow(/escapes the fixture root/);
      expect(() => ws.write("../escape.txt", "x")).toThrow(/escapes the fixture root/);
    } finally {
      ws.dispose();
    }
  });

  test("contains() correctly identifies inside/outside paths", () => {
    const ws = FixtureWorkspace.create();
    try {
      expect(ws.contains(ws.resolve("inner.txt"))).toBe(true);
      expect(ws.contains("/etc/passwd")).toBe(false);
    } finally {
      ws.dispose();
    }
  });

  test("fixture registry digest is stable", () => {
    expect(fixtureRegistryDigest()).toBe(fixtureRegistryDigest());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Metrics
// ═══════════════════════════════════════════════════════════════════════════

describe("metrics", () => {
  test("no duplicate or opaque metric definitions", () => {
    expect(() => assertNoConflictingMetrics()).not.toThrow();
  });

  test("every metric declares meaning, source, unit, and direction", () => {
    for (const m of METRIC_DEFINITIONS) {
      expect(m.meaning.length).toBeGreaterThan(10);
      expect(m.source.length).toBeGreaterThan(0);
      expect(m.unit.length).toBeGreaterThan(0);
      expect(m.direction.length).toBeGreaterThan(0);
    }
  });

  test("collector rejects an undefined metric id", () => {
    const c = new MetricCollector();
    expect(() => c.record({ metricId: "not.a.real.metric", value: 1 })).toThrow(/Unknown metric/);
  });

  test("collector rejects non-finite values", () => {
    const c = new MetricCollector();
    expect(() => c.record({ metricId: "cost.usd", value: Number.NaN })).toThrow(/non-finite/);
  });

  test("collector records and reads back a valid metric", () => {
    const c = new MetricCollector();
    c.record({ metricId: "cost.usd", value: 0 });
    expect(c.value("cost.usd")).toBe(0);
    expect(c.list().length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Verifiers
// ═══════════════════════════════════════════════════════════════════════════

describe("verifiers", () => {
  test("verifyArtifact detects a missing artifact", () => {
    const ws = FixtureWorkspace.create();
    try {
      const r = verifyArtifact(ws, { id: "a", path: "missing.txt" });
      expect(r.satisfied).toBe(false);
      expect(r.detail).toMatch(/was not produced/);
    } finally {
      ws.dispose();
    }
  });

  test("verifyArtifact validates content and forbidden content", () => {
    const ws = FixtureWorkspace.create();
    try {
      ws.write("out.txt", "hello world");
      expect(verifyArtifact(ws, { id: "a", path: "out.txt", mustContain: ["hello"] }).satisfied).toBe(true);
      expect(verifyArtifact(ws, { id: "b", path: "out.txt", mustContain: ["nope"] }).satisfied).toBe(false);
      expect(verifyArtifact(ws, { id: "c", path: "out.txt", mustNotContain: ["world"] }).satisfied).toBe(false);
    } finally {
      ws.dispose();
    }
  });

  test("verifyArtifact can assert absence", () => {
    const ws = FixtureWorkspace.create();
    try {
      expect(verifyArtifact(ws, { id: "a", path: "nothing.txt", mustExist: false }).satisfied).toBe(true);
      ws.write("nothing.txt", "x");
      expect(verifyArtifact(ws, { id: "b", path: "nothing.txt", mustExist: false }).satisfied).toBe(false);
    } finally {
      ws.dispose();
    }
  });

  test("verifyState compares values", () => {
    expect(verifyState({ id: "s", description: "d", actual: "a", expected: "a" }).satisfied).toBe(true);
    expect(verifyState({ id: "s", description: "d", actual: "a", expected: "b" }).satisfied).toBe(false);
  });

  test("verifyRecords enforces minimum count and predicates", () => {
    expect(verifyRecords({ id: "r", description: "d", records: [], minCount: 1 }).satisfied).toBe(false);
    expect(verifyRecords({ id: "r", description: "d", records: [1, 2] }).satisfied).toBe(true);
    expect(
      verifyRecords({ id: "r", description: "d", records: [1, 2], every: (x) => typeof x === "string" }).satisfied,
    ).toBe(false);
  });

  test("verifyPolicy requires the decision to be explained", () => {
    expect(verifyPolicy({ id: "p", description: "d", decision: "blocked", allowed: ["blocked"], explanation: "why" }).satisfied).toBe(true);
    expect(verifyPolicy({ id: "p", description: "d", decision: "blocked", allowed: ["blocked"], explanation: "" }).satisfied).toBe(false);
    expect(verifyPolicy({ id: "p", description: "d", decision: "allowed", allowed: ["blocked"] }).satisfied).toBe(false);
  });

  test("verifyEvidence reports missing evidence", () => {
    const r = verifyEvidence({ id: "e", description: "d", present: ["a"], expected: ["a", "b"] });
    expect(r.satisfied).toBe(false);
    expect(r.detail).toMatch(/missing evidence/);
  });

  test("verifySideEffects catches an effect that should have been refused", () => {
    const r = verifySideEffects({
      id: "s",
      description: "d",
      effects: [{ kind: "network", target: "x", allowed: true, at: 0 }],
      expectRefusedOrAbsent: ["network"],
    });
    expect(r.satisfied).toBe(false);
  });

  test("verifyComprehension reports the concepts not conveyed", () => {
    const r = verifyComprehension({
      id: "c",
      description: "d",
      text: "denied",
      mustConvey: [{ concept: "a remediation", matches: (t) => t.includes("try") }],
    });
    expect(r.satisfied).toBe(false);
    expect(r.detail).toMatch(/does not convey/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Safety gates
// ═══════════════════════════════════════════════════════════════════════════

function scenarioStub(overrides: Partial<ScenarioDefinition> = {}): ScenarioDefinition {
  return {
    id: "stub",
    version: 1,
    title: "stub",
    intent: "stub intent long enough to satisfy validation checks",
    expectedOutcome: "stub expected outcome long enough to satisfy checks",
    dimension: "runtime",
    set: "development",
    determinism: "deterministic",
    contracts: ["stub"],
    profiles: [],
    offlineCapable: true,
    allowedEffects: NO_EXTERNAL_EFFECTS,
    budget: { wallClockMs: 1000, maxEffects: 10 },
    blindSpots: [],
    run: () => ({ verifications: [] }),
    ...overrides,
  };
}

describe("safety gates", () => {
  test("all gates hold for a clean scenario", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [],
        evidence: ["nothing sensitive"],
        offline: true,
      });
      expect(hasCriticalViolation(gates)).toBe(false);
      expect(gatesHeldRatio(gates)).toBe(1);
    } finally {
      ws.dispose();
    }
  });

  test("a credential-shaped value in evidence trips the secret gate", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [],
        // Deliberately unredacted to prove the gate fires.
        evidence: ["key=sk-ABCDEFGHIJKLMNOPQRSTUVWX123456"],
        offline: true,
      });
      const g = gates.find((x) => x.gateId === "no_secret_in_artifact")!;
      expect(g.held).toBe(false);
      expect(hasCriticalViolation(gates)).toBe(true);
    } finally {
      ws.dispose();
    }
  });

  test("unexpected network access trips the network gate", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [{ kind: "network", target: "example.invalid", allowed: true, at: 0 }],
        evidence: [],
        offline: true,
      });
      expect(gates.find((x) => x.gateId === "no_unexpected_network")!.held).toBe(false);
    } finally {
      ws.dispose();
    }
  });

  test("a refused network attempt does NOT trip the gate", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [{ kind: "network", target: "example.invalid", allowed: false, at: 0 }],
        evidence: [],
        offline: true,
      });
      expect(gates.find((x) => x.gateId === "no_unexpected_network")!.held).toBe(true);
    } finally {
      ws.dispose();
    }
  });

  test("a policy bypass trips the policy gate", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [{ kind: "policy_decision", target: "force_allow", allowed: true, detail: "disabled_safety", at: 0 }],
        evidence: [],
        offline: true,
      });
      expect(gates.find((x) => x.gateId === "no_policy_bypass")!.held).toBe(false);
    } finally {
      ws.dispose();
    }
  });

  test("result falsification is detected via digest mismatch", () => {
    const ws = FixtureWorkspace.create();
    try {
      const gates = evaluateSafetyGates({
        scenario: scenarioStub(),
        workspace: ws,
        effects: [],
        evidence: [],
        offline: true,
        preGateDigest: "aaa",
        postGateDigest: "bbb",
      });
      expect(gates.find((x) => x.gateId === "no_result_falsification")!.held).toBe(false);
    } finally {
      ws.dispose();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Effects
// ═══════════════════════════════════════════════════════════════════════════

describe("effect recording", () => {
  test("effect targets are redacted on the way in", () => {
    const r = new EffectRecorder(() => 0);
    r.record({ kind: "fs_read", target: `${homedir()}/secret.txt`, allowed: true });
    const redacted = r.list()[0]!.target;
    // The invariant that matters: the real home path never survives into a
    // stored effect. The exact placeholder (<home> or <fixture>) depends on
    // platform layout, since Windows places the temp dir inside the profile.
    expect(redacted).not.toContain(homedir());
    expect(/<home>|<fixture>/.test(redacted)).toBe(true);
  });

  test("gates still receive the UNREDACTED target", () => {
    const r = new EffectRecorder(() => 0);
    const raw = `${homedir()}/secret.txt`;
    r.record({ kind: "fs_read", target: raw, allowed: true });
    // Otherwise the secret-detection gate would be vacuous.
    expect(r.listRawForGates()[0]!.target).toBe(raw);
  });

  test("declared-vs-actual violations are detected", () => {
    const violations = findEffectViolations(
      [{ kind: "process_spawn", target: "sh", allowed: true, at: 0 }],
      NO_EXTERNAL_EFFECTS,
    );
    expect(violations.length).toBe(1);
    expect(violations[0]!.reason).toMatch(/processSpawn/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Adjudication
// ═══════════════════════════════════════════════════════════════════════════

describe("status adjudication", () => {
  test("a scenario cannot declare itself passed with no verifications", () => {
    const a = adjudicate({ verifications: [] }, false, [], []);
    expect(a.status).toBe("errored");
  });

  test("all required verifications satisfied yields passed", () => {
    const a = adjudicate(
      { verifications: [verifyPredicate("v", "d", true, "ok")] },
      false,
      [],
      [],
    );
    expect(a.status).toBe("passed");
  });

  test("a failed required verification yields failed", () => {
    const a = adjudicate(
      { verifications: [verifyPredicate("v", "d", false, "nope")] },
      false,
      [],
      [],
    );
    expect(a.status).toBe("failed");
  });

  test("a failed optional verification yields partial", () => {
    const a = adjudicate(
      { verifications: [verifyPredicate("v", "d", true, "ok"), verifyPredicate("o", "d", false, "meh", false)] },
      false,
      [],
      [],
    );
    expect(a.status).toBe("partial");
  });

  test("a critical gate violation overrides a perfect result", () => {
    const a = adjudicate(
      { verifications: [verifyPredicate("v", "d", true, "ok")] },
      true,
      ["no_secret_in_artifact: leaked"],
      [],
    );
    expect(a.status).toBe("blocked");
    expect(a.reason).toMatch(/hard safety gate/);
  });

  test("undeclared effects block the scenario", () => {
    const a = adjudicate(
      { verifications: [verifyPredicate("v", "d", true, "ok")] },
      false,
      [],
      ["scenario performed network access"],
    );
    expect(a.status).toBe("blocked");
  });

  test("not_applicable is honoured", () => {
    const a = adjudicate({ verifications: [], notApplicable: "no container runtime" }, false, [], []);
    expect(a.status).toBe("not_applicable");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════════════════════

function resultStub(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenarioId: "s",
    scenarioVersion: 1,
    suiteId: "suite",
    dimension: "runtime",
    set: "validation",
    determinism: "deterministic",
    status: "passed",
    statusReason: "ok",
    verifications: [],
    gates: [],
    metrics: [],
    effects: [],
    evidence: [],
    confidence: { value: 1, basis: "b", samples: 1, blindSpots: [] },
    durationMs: 1,
    startedAt: 0,
    ...overrides,
  };
}

describe("scoring", () => {
  test("not_applicable is excluded from the denominator, never scored zero", () => {
    const d = scoreDimension("runtime", [
      resultStub({ status: "passed" }),
      resultStub({ status: "not_applicable" }),
    ]);
    expect(d.score).toBe(1);
    expect(d.notApplicable).toBe(1);
    expect(d.notes.join(" ")).toMatch(/not counted as zero/);
  });

  test("a dimension with only not_applicable scores null, not zero", () => {
    const d = scoreDimension("runtime", [resultStub({ status: "not_applicable" })]);
    expect(d.score).toBeNull();
  });

  test("partial earns half credit", () => {
    const d = scoreDimension("runtime", [resultStub({ status: "partial" })]);
    expect(d.score).toBe(0.5);
  });

  test("gating dimensions are marked", () => {
    expect(scoreDimension("trust", [resultStub({ dimension: "trust" })]).gating).toBe(true);
    expect(scoreDimension("runtime", [resultStub()]).gating).toBe(false);
  });

  test("a critical gate failure nulls the overall score", () => {
    const badGate: SafetyGateResult = {
      gateId: "no_secret_in_artifact",
      held: false,
      detail: "leaked",
      severity: "critical",
    };
    const run = {
      provenance: {
        runId: "r", harnessId: "h", harnessVersion: "1", schemaVersion: "s", productVersion: "7.0.0",
        commit: "c", startedAt: 0,
        environment: {
          platform: "linux", arch: "x64", runtime: "bun", runtimeVersion: "1", cpuCount: 1,
          memoryGiB: 1, isolationBackends: [], offline: true, elevated: false,
        },
        configuration: {
          deploymentProfile: "personal_local", localityPolicy: "local_only",
          policyDigest: "p", scenarioSets: ["validation" as const],
        },
        registryDigest: "rd",
      },
      suites: [
        {
          suiteId: "trust", suiteVersion: 1, dimension: "trust" as const, durationMs: 1,
          scenarios: [resultStub({ dimension: "trust", status: "passed", gates: [badGate] })],
        },
      ],
      integrity: { algorithm: "sha256" as const, digest: "d", registryDigest: "rd" },
    };

    const card = buildScorecard(run as never);
    expect(card.hardFailure).toBe(true);
    expect(card.overall).toBeNull();
    expect(card.hardFailures.length).toBe(1);
    expect(() => assertNoHiddenCriticalFailure(card)).not.toThrow();
  });

  test("weights are always disclosed with the score", () => {
    const runner = new EvaluationRunner([ALL_SUITES[0]!]);
    return runner.run({ offline: true }).then((run) => {
      const card = buildScorecard(run);
      expect(Object.keys(card.weights).length).toBeGreaterThan(0);
      expect(card.limitations.length).toBeGreaterThan(0);
      expect(card.doesNotProve.length).toBeGreaterThan(0);
    });
  });

  test("confidence is lower for probabilistic scenarios", () => {
    const det = deriveConfidence([resultStub({ determinism: "deterministic" })]);
    const prob = deriveConfidence([resultStub({ determinism: "probabilistic" })]);
    expect(det.value).toBeGreaterThan(prob.value);
    expect(prob.blindSpots.length).toBeGreaterThan(0);
  });

  test("confidence with no results is zero and says so", () => {
    const c = deriveConfidence([]);
    expect(c.value).toBe(0);
    expect(c.basis).toMatch(/no applicable scenarios/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Provenance
// ═══════════════════════════════════════════════════════════════════════════

describe("provenance", () => {
  test("canonicalization is key-order independent", () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(digest({ a: 1, b: [1, 2] })).toBe(digest({ b: [1, 2], a: 1 }));
  });

  test("digest changes when content changes", () => {
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });

  test("redaction removes credential-shaped values", () => {
    expect(redactEvidence("token=sk-ABCDEFGHIJKLMNOPQRSTUV123456")).toContain("[redacted]");
    expect(redactEvidence("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toContain("[redacted]");
  });

  test("redaction removes host home paths", () => {
    const out = redactEvidence(`${homedir()}/projects/secret`);
    expect(out).not.toContain(homedir());
    expect(/<home>|<fixture>/.test(out)).toBe(true);
  });

  test("seeded random is reproducible", () => {
    const a = seededRandom("seed");
    const b = seededRandom("seed");
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  test("different seeds produce different sequences", () => {
    const a = seededRandom("seed-a");
    const b = seededRandom("seed-b");
    expect(a()).not.toBe(b());
  });
});
