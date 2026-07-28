# XR 7.0 — Evaluation Architecture

**Phase:** 13 — XR OS Supremacy
**Version:** XR 7.0.0 (Supremacy)
**Subsystem:** `src/evaluation/`

---

## 1. What this subsystem is, and what it is not

XR 7.0 adds a **measurement layer**. It measures the platform; it does not
extend it.

**It is:**

- an outcome-based benchmark harness with versioned scenarios;
- a set of hard safety gates that can fail a run outright;
- an append-only, integrity-protected result store;
- a longitudinal comparison and regression detector;
- an evidence-backed certification and compatibility system;
- a machine-checkable claim → evidence matrix.

**It is deliberately NOT:**

- a second runtime, workflow engine, or policy system;
- a telemetry pipeline or distributed analytics platform;
- a marketing score page;
- a competitor comparison (XR executes no competitor, so it makes no
  comparative claim).

The governing rule of the phase:

> Every strategic claim about XR must be backed by reproducible evidence, and
> every benchmark must measure useful outcomes rather than superficial
> activity.

---

## 2. Module map

| File | Responsibility |
|---|---|
| `types.ts` | The versioned evaluation model: scenarios, results, provenance, scores, certification, compatibility, claims, governance |
| `provenance.ts` | Run identity, environment capture, canonical hashing, redaction, seeded randomness |
| `metrics.ts` | The metric registry — every metric declares meaning, unit, direction, source, and limitations |
| `fixtures.ts` | Disposable fixture workspaces + the synthetic fixture library. Refuses real user directories |
| `effects.ts` | Effect recording and declared-vs-actual comparison |
| `verifiers.ts` | Outcome verifiers: artifact, state, record, policy, evidence, side-effect, comprehension |
| `gates.ts` | Nine hard safety invariants, evaluated by the runner |
| `scoring.ts` | Dimension scoring, gating dimensions, confidence, disclosed weights |
| `runner.ts` | Executes scenarios, adjudicates status, enforces budgets, checks reproducibility |
| `repository.ts` | Append-only SQLite result storage with recompute-on-read integrity |
| `comparison.ts` | Comparability rules, regression classification, overfitting detection |
| `certification.ts` | Evidence-backed, expirable, revocable certification for five targets |
| `compatibility.ts` | Contract tests over public API, CLI, and data schemas |
| `claims.ts` | The public claim register and its audit |
| `governance.ts` | Scenario change control and architecture-protection gap classification |
| `report.ts` | Scorecard, raw report, and hash-verifiable evidence bundle |
| `suites/` | The 14 benchmark suites |

---

## 3. The evaluation model

### 3.1 Scenario

A scenario is a realistic task with a verifiable outcome. It declares:

```
id, version, title, intent, expectedOutcome,
dimension, set, determinism, contracts, profiles,
offlineCapable, allowedEffects, budget, blindSpots,
run(ctx) -> ScenarioOutcome
```

Two properties matter most:

- **`version`** — bumping it is mandatory when the scenario's meaning changes.
  `governance.ts` detects unversioned semantic changes and refuses them,
  because silently editing a scenario corrupts every historical trend.
- **`set`** — `development` | `validation` | `independent`. Separating these
  makes benchmark overfitting *detectable*: if development improves while the
  held-out independent set does not, the comparison says so.

### 3.2 A scenario cannot pass itself

A scenario returns **verifications**, not a verdict. The runner adjudicates:

```
critical gate violated      -> blocked
undeclared effects produced -> blocked
notApplicable declared      -> not_applicable
no verifications returned   -> errored
a required verification unmet -> failed
partial declared / optional unmet -> partial
otherwise                   -> passed
```

This is why `blocked` beats a perfect verification list: a scenario that
produces a correct artifact while leaking a credential is not a success.

### 3.3 Outcome verification, never response text

Verifiers inspect reality:

| Verifier | Checks |
|---|---|
| `verifyArtifact` | the file exists on disk, contains what it should, and does not contain what it must not |
| `verifyState` | an observed state equals the expected state |
| `verifyRecords` | durable records were actually written and are well-formed |
| `verifyPolicy` | the decision is acceptable **and** was explained |
| `verifyEvidence` | the expected evidence chain is complete |
| `verifySideEffects` | the effects produced match the effects that should have occurred |
| `verifyComprehension` | user-facing text conveys the required concepts (an explicit structural proxy) |

---

## 4. Hard safety gates

Nine invariants, evaluated by the **runner** over recorded evidence. The system
under test cannot skip, weaken, or disable them.

| Gate | Invariant |
|---|---|
| `no_real_user_data` | no filesystem effect touched a real user home |
| `no_secret_in_artifact` | no credential-shaped value reached artifacts or evidence |
| `no_unexpected_network` | no network access beyond what the scenario declared |
| `no_unexpected_process_spawn` | no process spawning beyond what was declared |
| `no_policy_bypass` | no safety policy was bypassed to score better |
| `no_isolation_downgrade` | isolation was never silently downgraded |
| `no_untrusted_instruction_promotion` | benchmark content never became a trusted instruction |
| `no_workspace_escape` | all writes stayed inside the disposable fixture |
| `no_result_falsification` | the recorded result did not change during gate evaluation |

**Redaction subtlety.** Gates inspect the *unredacted* evidence, while
everything persisted or exported is *redacted*. If gates saw only redacted
text, the secret-leak gate would be vacuous — redaction would erase the very
thing it must detect. `EffectRecorder` therefore keeps both views, and only
the redacted one is ever stored.

---

## 5. Scoring

Six rules, all enforced in `scoring.ts`:

1. **Raw metrics are always exposed.** A score never replaces evidence.
2. **Weights are always disclosed** next to the score.
3. **A critical gate violation nulls the headline score.** `overall` becomes
   `null`, not a lower number. Quality can never compensate for a security
   failure. `assertNoHiddenCriticalFailure()` makes this executable.
4. **`not_applicable` is excluded from the denominator**, never scored zero.
5. **Confidence is reported**, derived from determinism mix and harness errors.
6. **Dimension-level results are preserved.** XR is never reduced to one number.

Gating dimensions: `trust`, `context`, `environment`, `capability`,
`enterprise`.

Status credit: `passed` = 1, `partial` = 0.5, `failed`/`blocked` = 0.
`not_applicable` and `errored` are excluded (the latter reduces confidence).

---

## 6. Provenance and reproducibility

Every run records: harness id/version, schema version, product version, commit,
timestamps, environment (platform, arch, runtime, cpu, bucketed memory,
**available isolation backends**, offline flag, elevated flag), configuration
(deployment profile, locality policy, policy digest, scenario sets), and the
**scenario registry digest**.

Privacy: no hostname, username, home path, IP, or serial is captured. Memory is
bucketed to whole GiB to avoid host fingerprinting.

Reproducibility:

- object keys are canonically sorted before hashing, so identical results hash
  identically;
- randomness is seeded per `(seed, scenarioId, version)`;
- `checkReproducibility()` re-runs a scenario and **reports** nondeterminism
  rather than hiding it.

Isolation backends are recorded because trust results are host-dependent: a
`trust` score from a machine with containers is not comparable to one without.

---

## 7. Storage

Append-only SQLite in the **existing** XR workspace database. No new datastore.

- Re-saving a run id is refused — a later run cannot quietly replace a worse one.
- Every read recomputes the digest and reports mismatch.
- Runs can be **invalidated**, never deleted. Invalidation is additive and
  preserves the original digest, so negative results cannot be erased.
- A scenario-registry change can invalidate all prior runs in one operation.

---

## 8. Comparison and regression

Runs are compared only when comparable. Blocking differences: registry digest,
deployment profile, locality policy, schema version, invalidation, and
per-scenario version mismatch. Differing isolation backends are reported as a
comparability warning.

Severity: a regression in any **gating** dimension is always `critical`.
`evaluateRegressionGate()` fails the release on any critical regression,
regardless of improvements elsewhere.

Coverage changes (`onlyInBaseline` / `onlyInCandidate`) are reported, never
silently dropped. Overfitting is flagged when the development set improves by
more than 5 points while the independent set does not.

---

## 9. Certification

Five targets: `provider`, `capability`, `workflow`, `deployment_profile`,
`runtime_version`. Each has a requirement set naming the scenarios that must
pass.

Statuses: `certified`, `provisional`, `not_certified`, `insufficient_evidence`,
`expired`, `revoked`.

Rules:

- certifications **always expire** (default 90 days);
- certifications are **revocable**, and revocation is preserved;
- invalidating a run **revokes** certifications built on it;
- self-reported evidence alone can never reach `certified`;
- capability certification reuses the **Phase 9** contract certifier rather
  than creating a competing system — a capability that fails its own contract
  tests can never be certified;
- `assertNoExternalAccreditationClaim()` guarantees XR never asserts SOC 2,
  ISO 27001, HIPAA, PCI-DSS, or FedRAMP.

---

## 10. Compatibility

`XR_7_0_CONTRACT_BASELINE` records what XR promises to keep stable: public
barrel exports, CLI command names, data schema versions, and deployment
profiles. A check reports `none`, `additive`, `breaking`, or `unknown`.

This is how XR 7.0 caught two real defects (see the validation report): a
missing CLI catalog entry, and — separately — the workflow content-hash gap.

Legacy workflow definitions published before XR 7.0 are explicitly covered by a
compatibility check, so the security fix could not silently break stored data.

---

## 11. Governance

**Scenario change control.** `fingerprintScenario()` hashes the parts that
define a scenario's *meaning* (intent, expected outcome, dimension, set,
determinism, profiles, allowed effects, contracts) — deliberately excluding the
function body, so refactoring is free but semantic drift is not.
`assertNoUnversionedChanges()` throws on a meaning change without a version bump.

**Architecture protection.** Every gap discovered by evaluation must be
classified and owned:

| Classification | May be fixed in a measurement phase? |
|---|---|
| `correctness_defect` | yes |
| `security_defect` | yes |
| `performance_reliability_defect` | yes |
| `documentation_ux_defect` | yes |
| `future_product_work` | **no** |

`assertNoScopeCreep()` makes "this phase must not become a hidden Phase 14"
executable rather than aspirational.

---

## 12. Reporting

Three outputs, no marketing surface:

- **Scorecard** — dimensions, hard gates, disclosed weights, limitations, and
  an explicit "what this does not prove" section.
- **Raw report** — every verification, gate, metric, and effect summary, plus
  the full metric definition catalog.
- **Evidence bundle** — redacted, hash-verifiable, with reproduction
  instructions embedded.

Every rendering leads with *what was measured and under which configuration*
and ends with *what the result does not establish*.
