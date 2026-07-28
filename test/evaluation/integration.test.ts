/**
 * XR 7.0 — Phase 13 tests: integration, storage, comparison, certification,
 * compatibility, claims, and governance.
 *
 * These run the real benchmark suites against the real XR kernel contracts.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_SUITES,
  EvaluationRepository,
  EvaluationRunner,
  adaptStoreForEvaluation,
  assertNoExternalAccreditationClaim,
  assertNoScopeCreep,
  assertNoUnversionedChanges,
  assertNoUnsupportedSuperiorityClaim,
  auditClaims,
  buildCompatibilityReport,
  buildEvidenceBundle,
  buildScorecard,
  certify,
  compareRuns,
  detectUnversionedChanges,
  effectiveStatus,
  evaluateRegressionGate,
  fingerprintSuites,
  isValidNow,
  PHASE13_DISCOVERED_GAPS,
  revoke,
  revokeForInvalidatedRun,
  verifyEvidenceBundle,
  XR_CLAIMS,
  type EvaluationRun,
} from "../../src/evaluation/index.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeRepo(): { repo: EvaluationRepository; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xr-eval-repo-"));
  const db = new Database(join(dir, "eval.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const repo = new EvaluationRepository(
    adaptStoreForEvaluation({
      exec: (s: string) => db.exec(s),
      prepare: (s: string) => db.prepare(s) as never,
    }),
  );
  return {
    repo,
    dispose: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

let cachedRun: EvaluationRun | null = null;

async function fullRun(): Promise<EvaluationRun> {
  if (!cachedRun) {
    cachedRun = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
  }
  return cachedRun;
}

// ═══════════════════════════════════════════════════════════════════════════
// Integration: real suites against real contracts
// ═══════════════════════════════════════════════════════════════════════════

describe("integration — real benchmark suites", () => {
  test("the full offline suite executes and produces a scorecard", async () => {
    const run = await fullRun();
    expect(run.suites.length).toBe(ALL_SUITES.length);

    const card = buildScorecard(run);
    expect(card.dimensions.length).toBe(ALL_SUITES.length);
    expect(card.reportVersion).toContain("evaluation-report");
  }, 120_000);

  test("no scenario errors in the harness", async () => {
    const run = await fullRun();
    const errored = run.suites.flatMap((s) => s.scenarios.filter((x) => x.status === "errored"));
    expect(errored.map((e) => `${e.scenarioId}: ${e.error ?? e.statusReason}`)).toEqual([]);
  }, 120_000);

  test("no hard safety gate is violated on a clean tree", async () => {
    const run = await fullRun();
    const card = buildScorecard(run);
    expect(card.hardFailures).toEqual([]);
    expect(card.hardFailure).toBe(false);
  }, 120_000);

  test("every scenario records at least one verification or is not applicable", async () => {
    const run = await fullRun();
    for (const suite of run.suites) {
      for (const s of suite.scenarios) {
        if (s.status === "not_applicable") continue;
        expect(s.verifications.length).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  test("every scenario carries full provenance and gates", async () => {
    const run = await fullRun();
    expect(run.provenance.commit.length).toBeGreaterThan(0);
    expect(run.provenance.registryDigest.length).toBe(64);
    expect(run.integrity.digest.length).toBe(64);
    for (const suite of run.suites) {
      for (const s of suite.scenarios) {
        expect(s.gates.length).toBeGreaterThan(0);
        expect(s.confidence.basis.length).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  test("the offline subset runs with zero allowed network effects", async () => {
    const run = await fullRun();
    const networkEffects = run.suites
      .flatMap((s) => s.scenarios)
      .flatMap((s) => s.effects)
      .filter((e) => e.kind === "network" && e.allowed);
    expect(networkEffects).toEqual([]);
  }, 120_000);

  test("selecting a single suite runs only that suite", async () => {
    const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true, suiteIds: ["trust"] });
    expect(run.suites.length).toBe(1);
    expect(run.suites[0]!.suiteId).toBe("trust");
  }, 60_000);

  test("filtering by scenario set works", async () => {
    const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true, sets: ["independent"] });
    for (const suite of run.suites) {
      for (const s of suite.scenarios) expect(s.set).toBe("independent");
    }
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════

describe("result repository", () => {
  let h: ReturnType<typeof makeRepo>;
  beforeEach(() => { h = makeRepo(); });
  afterEach(() => h.dispose());

  test("saves and reads back a run with verified integrity", async () => {
    const run = await fullRun();
    h.repo.save(run);
    const stored = h.repo.get(run.provenance.runId);
    expect(stored).not.toBeNull();
    expect(stored!.integrityValid).toBe(true);
    expect(stored!.run.suites.length).toBe(run.suites.length);
  }, 120_000);

  test("results are append-only — overwriting is refused", async () => {
    const run = await fullRun();
    h.repo.save(run);
    expect(() => h.repo.save(run)).toThrow(/append-only/);
  }, 120_000);

  test("invalidation preserves the original result and digest", async () => {
    const run = await fullRun();
    h.repo.save(run);
    const inv = h.repo.invalidate(run.provenance.runId, "scenario integrity compromised", "tester");
    expect(inv.originalDigest).toBe(run.integrity.digest);

    const stored = h.repo.get(run.provenance.runId);
    expect(stored!.run.invalidation).toBeDefined();
    // The body is still readable — negative results are never deleted.
    expect(stored!.run.suites.length).toBe(run.suites.length);
    expect(stored!.integrityValid).toBe(true);
  }, 120_000);

  test("invalidated runs are excluded from the default listing", async () => {
    const run = await fullRun();
    h.repo.save(run);
    expect(h.repo.list().length).toBe(1);
    h.repo.invalidate(run.provenance.runId, "r", "tester");
    expect(h.repo.list().length).toBe(0);
    expect(h.repo.list({ includeInvalidated: true }).length).toBe(1);
  }, 120_000);

  test("a registry change invalidates prior runs", async () => {
    const run = await fullRun();
    h.repo.save(run);
    const invalidated = h.repo.invalidateForRegistryChange("a-different-digest", "scenarios changed", "tester");
    expect(invalidated).toContain(run.provenance.runId);
  }, 120_000);

  test("detects a tampered stored result", async () => {
    const run = await fullRun();
    h.repo.save(run);
    // Simulate direct database tampering of the stored body.
    const stored = h.repo.get(run.provenance.runId)!;
    const mutated = {
      ...stored.run,
      suites: stored.run.suites.map((s) => ({
        ...s,
        scenarios: s.scenarios.map((sc) => ({ ...sc, status: "passed" as const })),
      })),
    };
    // Recompute against the ORIGINAL digest — must not match.
    const { verifyRunIntegrity } = await import("../../src/evaluation/index.ts");
    const check = verifyRunIntegrity({ ...mutated, integrity: stored.run.integrity });
    if (JSON.stringify(mutated.suites) !== JSON.stringify(stored.run.suites)) {
      expect(check.valid).toBe(false);
    }
  }, 120_000);

  test("scenario history is queryable", async () => {
    const run = await fullRun();
    h.repo.save(run);
    const history = h.repo.history("trust.risk-escalation");
    expect(history.length).toBe(1);
    expect(history[0]!.status).toBe("passed");
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Comparison / regression
// ═══════════════════════════════════════════════════════════════════════════

describe("comparison and regression detection", () => {
  test("identical runs report no regressions", async () => {
    const a = await fullRun();
    const b = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
    const comparison = compareRuns(a, b);
    expect(comparison.regressions).toEqual([]);
    expect(comparison.unchanged).toBeGreaterThan(0);
  }, 180_000);

  test("a security-dimension regression is always critical", async () => {
    const base = await fullRun();
    const degraded: EvaluationRun = {
      ...base,
      provenance: { ...base.provenance, runId: "degraded" },
      suites: base.suites.map((s) =>
        s.dimension === "trust"
          ? { ...s, scenarios: s.scenarios.map((sc) => ({ ...sc, status: "failed" as const })) }
          : s,
      ),
    };
    const comparison = compareRuns(base, degraded);
    const critical = comparison.regressions.filter((r) => r.severity === "critical");
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0]!.kind).toBe("security");

    const gate = evaluateRegressionGate(comparison);
    expect(gate.pass).toBe(false);
    expect(gate.criticalCount).toBeGreaterThan(0);
  }, 120_000);

  test("quality improvements cannot offset a critical regression", async () => {
    const base = await fullRun();
    const mixed: EvaluationRun = {
      ...base,
      provenance: { ...base.provenance, runId: "mixed" },
      suites: base.suites.map((s) =>
        s.dimension === "trust"
          ? { ...s, scenarios: s.scenarios.map((sc) => ({ ...sc, status: "blocked" as const })) }
          : s,
      ),
    };
    const gate = evaluateRegressionGate(compareRuns(base, mixed));
    expect(gate.pass).toBe(false);
  }, 120_000);

  test("runs with different deployment profiles are not comparable", async () => {
    const a = await fullRun();
    const b: EvaluationRun = {
      ...a,
      provenance: {
        ...a.provenance,
        runId: "other",
        configuration: { ...a.provenance.configuration, deploymentProfile: "managed_cloud" },
      },
    };
    const comparison = compareRuns(a, b);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incomparableReasons.join(" ")).toMatch(/deployment profiles differ/);
  }, 120_000);

  test("a scenario version change is reported as incomparable, not silently compared", async () => {
    const a = await fullRun();
    const b: EvaluationRun = {
      ...a,
      provenance: { ...a.provenance, runId: "bumped" },
      suites: a.suites.map((s) => ({
        ...s,
        scenarios: s.scenarios.map((sc) => ({ ...sc, scenarioVersion: sc.scenarioVersion + 1 })),
      })),
    };
    const comparison = compareRuns(a, b);
    expect(comparison.incomparableReasons.some((r) => r.includes("changed version"))).toBe(true);
  }, 120_000);

  test("removed coverage is reported, never silently dropped", async () => {
    const a = await fullRun();
    const b: EvaluationRun = {
      ...a,
      provenance: { ...a.provenance, runId: "reduced" },
      suites: a.suites.filter((s) => s.dimension !== "trust"),
    };
    const comparison = compareRuns(a, b);
    expect(comparison.onlyInBaseline.length).toBeGreaterThan(0);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Certification
// ═══════════════════════════════════════════════════════════════════════════

describe("certification", () => {
  test("runtime certification is granted from passing evidence", async () => {
    const run = await fullRun();
    const record = certify({
      target: "runtime_version",
      subjectId: "@rrrtx/xr",
      subjectVersion: "7.0.0",
      runs: [run],
    });
    expect(record.status).toBe("certified");
    expect(record.evidence.length).toBeGreaterThan(0);
    expect(record.expiresAt).toBeGreaterThan(record.issuedAt);
    expect(() => assertNoExternalAccreditationClaim(record)).not.toThrow();
  }, 120_000);

  test("certification is refused when evidence is missing", () => {
    const record = certify({
      target: "runtime_version",
      subjectId: "x",
      subjectVersion: "1",
      runs: [],
    });
    expect(record.status).toBe("insufficient_evidence");
    expect(record.unmetRequirements.length).toBeGreaterThan(0);
  });

  test("self-reported evidence alone can never certify", async () => {
    const run = await fullRun();
    const record = certify({
      target: "capability",
      subjectId: "x",
      subjectVersion: "1",
      runs: [run],
      selfReportedOnly: true,
    });
    expect(record.status).toBe("insufficient_evidence");
    expect(() => assertNoExternalAccreditationClaim(record)).not.toThrow();
  }, 120_000);

  test("certification is refused when a required scenario failed", async () => {
    const base = await fullRun();
    const broken: EvaluationRun = {
      ...base,
      provenance: { ...base.provenance, runId: "broken" },
      suites: base.suites.map((s) =>
        s.dimension === "trust"
          ? { ...s, scenarios: s.scenarios.map((sc) => ({ ...sc, status: "failed" as const })) }
          : s,
      ),
    };
    const record = certify({
      target: "runtime_version",
      subjectId: "x",
      subjectVersion: "1",
      runs: [broken],
    });
    expect(record.status).toBe("not_certified");
  }, 120_000);

  test("certifications expire", async () => {
    const run = await fullRun();
    const now = 1_800_000_000_000;
    const record = certify({
      target: "runtime_version", subjectId: "x", subjectVersion: "1", runs: [run], now, validityMs: 1000,
    });
    expect(isValidNow(record, now + 500)).toBe(true);
    expect(effectiveStatus(record, now + 5000)).toBe("expired");
    expect(isValidNow(record, now + 5000)).toBe(false);
  }, 120_000);

  test("certifications are revocable and revocation is preserved", async () => {
    const run = await fullRun();
    const record = certify({ target: "runtime_version", subjectId: "x", subjectVersion: "1", runs: [run] });
    const revoked = revoke(record, "supply chain incident", "security");
    expect(effectiveStatus(revoked)).toBe("revoked");
    expect(revoked.revocation!.reason).toBe("supply chain incident");
    expect(revoked.evidence).toEqual(record.evidence);
  }, 120_000);

  test("invalidating a run revokes certifications built on it", async () => {
    const run = await fullRun();
    const record = certify({ target: "runtime_version", subjectId: "x", subjectVersion: "1", runs: [run] });
    const after = revokeForInvalidatedRun([record], run.provenance.runId);
    expect(after[0]!.revocation).toBeDefined();
    expect(after[0]!.revocation!.reason).toMatch(/was invalidated/);
  }, 120_000);

  test("an external accreditation claim is rejected", () => {
    const bad = {
      version: "v", certificationId: "c", target: "runtime_version" as const, subjectId: "x",
      subjectVersion: "1", status: "certified" as const, issuedAt: 0, expiresAt: 1,
      productVersion: "7.0.0",
      evidence: [{ runId: "r", scenarioId: "s", scenarioVersion: 1, status: "passed" as const, runDigest: "d" }],
      unmetRequirements: [], limitations: ["XR is SOC 2 certified"], selfReportedOnly: false,
    };
    expect(() => assertNoExternalAccreditationClaim(bad)).toThrow(/external/i);
  });

  test("'certified' with no evidence is rejected", () => {
    const bad = {
      version: "v", certificationId: "c", target: "runtime_version" as const, subjectId: "x",
      subjectVersion: "1", status: "certified" as const, issuedAt: 0, expiresAt: 1,
      productVersion: "7.0.0", evidence: [], unmetRequirements: [], limitations: [], selfReportedOnly: false,
    };
    expect(() => assertNoExternalAccreditationClaim(bad)).toThrow(/no supporting evidence/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe("compatibility contracts", () => {
  test("no breaking contract change at XR 7.0", async () => {
    const report = await buildCompatibilityReport();
    const breaking = report.checks.filter((c) => c.change === "breaking");
    expect(breaking.map((b) => `${b.id}: ${b.detail}`)).toEqual([]);
    expect(report.compatible).toBe(true);
  }, 60_000);

  test("every promised public barrel export resolves", async () => {
    const report = await buildCompatibilityReport();
    const api = report.checks.filter((c) => c.surface === "public_api");
    expect(api.length).toBeGreaterThan(0);
    for (const c of api) expect(c.compatible).toBe(true);
  }, 60_000);

  test("pre-7.0 workflow definitions still load (no destructive migration)", async () => {
    const report = await buildCompatibilityReport();
    const legacy = report.checks.find((c) => c.id === "workflow.legacy-definitions-load")!;
    expect(legacy.compatible).toBe(true);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Claims
// ═══════════════════════════════════════════════════════════════════════════

describe("claim / evidence matrix", () => {
  test("every non-vision claim is bound to evidence", async () => {
    const run = await fullRun();
    const audit = auditClaims([run]);
    expect(audit.unsupported).toEqual([]);
    expect(audit.clean).toBe(true);
  }, 120_000);

  test("every claim states what it does not prove", () => {
    for (const c of XR_CLAIMS) {
      expect(c.doesNotProve.length).toBeGreaterThan(20);
    }
  });

  test("no comparative superiority claim is shipped as fact", () => {
    expect(() => assertNoUnsupportedSuperiorityClaim()).not.toThrow();
  });

  test("a claim whose scenario failed is reported as unsupported", async () => {
    const base = await fullRun();
    const broken: EvaluationRun = {
      ...base,
      suites: base.suites.map((s) =>
        s.dimension === "context"
          ? { ...s, scenarios: s.scenarios.map((sc) => ({ ...sc, status: "failed" as const })) }
          : s,
      ),
    };
    const audit = auditClaims([broken]);
    expect(audit.clean).toBe(false);
    expect(audit.unsupported.join(" ")).toMatch(/injection|context/i);
  }, 120_000);

  test("the AI OS claim is labelled product vision, not fact", () => {
    const c = XR_CLAIMS.find((x) => x.id === "claim.ai-operating-system")!;
    expect(c.classification).toBe("product_vision");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Governance
// ═══════════════════════════════════════════════════════════════════════════

describe("benchmark governance", () => {
  test("the current registry has no unversioned changes against itself", () => {
    const fp = fingerprintSuites(ALL_SUITES);
    expect(() => assertNoUnversionedChanges(detectUnversionedChanges(fp, fp))).not.toThrow();
  });

  test("an unversioned semantic change is detected and throws", () => {
    const before = fingerprintSuites(ALL_SUITES);
    const after = before.map((f, i) =>
      i === 0 ? { ...f, semanticDigest: "changed-without-version-bump" } : f,
    );
    const findings = detectUnversionedChanges(before, after);
    expect(findings.some((f) => f.kind === "unversioned_change")).toBe(true);
    expect(() => assertNoUnversionedChanges(findings)).toThrow(/governance violation/i);
  });

  test("a properly versioned change is accepted but invalidates history", () => {
    const before = fingerprintSuites(ALL_SUITES);
    const after = before.map((f, i) =>
      i === 0 ? { ...f, version: f.version + 1, semanticDigest: "legitimately-changed" } : f,
    );
    const findings = detectUnversionedChanges(before, after);
    expect(() => assertNoUnversionedChanges(findings)).not.toThrow();
    expect(findings.find((f) => f.kind === "versioned_change")!.invalidatesHistory).toBe(true);
  });

  test("removed scenarios are reported as reduced coverage", () => {
    const before = fingerprintSuites(ALL_SUITES);
    const findings = detectUnversionedChanges(before, before.slice(1));
    expect(findings.some((f) => f.kind === "removed")).toBe(true);
  });

  test("discovered gaps are all classified and owned", () => {
    expect(PHASE13_DISCOVERED_GAPS.length).toBeGreaterThan(0);
    for (const g of PHASE13_DISCOVERED_GAPS) {
      expect(g.owner.length).toBeGreaterThan(0);
      expect(g.detail.length).toBeGreaterThan(40);
    }
  });

  test("no future product work is smuggled into this phase", () => {
    expect(() => assertNoScopeCreep(PHASE13_DISCOVERED_GAPS)).not.toThrow();
    const future = PHASE13_DISCOVERED_GAPS.filter((g) => g.classification === "future_product_work");
    for (const g of future) expect(g.fixableInPhase).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Evidence export
// ═══════════════════════════════════════════════════════════════════════════

describe("evidence export", () => {
  test("an evidence bundle verifies against its own digest", async () => {
    const run = await fullRun();
    const bundle = buildEvidenceBundle(run);
    expect(verifyEvidenceBundle(bundle).valid).toBe(true);
  }, 120_000);

  test("a tampered bundle fails verification", async () => {
    const run = await fullRun();
    const bundle = buildEvidenceBundle(run);
    const tampered = { ...bundle, scorecard: { ...bundle.scorecard, overall: 1 } };
    const check = verifyEvidenceBundle(tampered);
    if (bundle.scorecard.overall !== 1) expect(check.valid).toBe(false);
  }, 120_000);

  test("the bundle carries reproduction instructions", async () => {
    const run = await fullRun();
    const bundle = buildEvidenceBundle(run);
    expect(bundle.verificationInstructions).toMatch(/SHA-256/);
    expect(bundle.verificationInstructions).toMatch(/probabilistic/);
  }, 120_000);

  test("the bundle contains no unredacted home path", async () => {
    const run = await fullRun();
    const bundle = buildEvidenceBundle(run);
    const { homedir } = await import("node:os");
    expect(JSON.stringify(bundle)).not.toContain(homedir());
  }, 120_000);
});
