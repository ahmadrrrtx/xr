# XR 7.0 — Evaluation Developer Guide

How to author scenarios, verify outcomes, certify subjects, triage regressions,
and reproduce results.

---

## 1. Authoring a scenario

Scenarios live in `src/evaluation/suites/`. A scenario is a realistic task with
a verifiable outcome.

```ts
import { NO_EXTERNAL_EFFECTS, type ScenarioDefinition } from "../types.ts";
import { verifyPredicate, verifyArtifact } from "../verifiers.ts";

const example: ScenarioDefinition = {
  id: "workflow.my-scenario",        // dimension-prefixed, stable forever
  version: 1,                        // BUMP when the MEANING changes
  title: "A short human title",
  intent:
    "Describe the realistic user situation. What is someone actually trying " +
    "to do, and why does it matter if XR gets it wrong?",
  expectedOutcome:
    "State what a correct outcome looks like, in plain language, so a reader " +
    "can dispute the scenario without reading the code.",
  dimension: "workflow",
  set: "validation",                 // development | validation | independent
  determinism: "deterministic",      // deterministic | bounded | probabilistic
  contracts: ["src/workflow/engine.ts#WorkflowEngine"],
  profiles: [],                      // empty = all deployment profiles
  offlineCapable: true,
  allowedEffects: NO_EXTERNAL_EFFECTS,
  budget: { wallClockMs: 30_000, maxEffects: 40 },
  blindSpots: [
    "State honestly what this scenario does NOT cover.",
  ],
  run: async (ctx) => {
    // ctx.fixtureRoot is a disposable temp dir. Never touch real user data.
    ctx.recordEffect({ kind: "fs_write", target: `${ctx.fixtureRoot}/out.txt`, allowed: true });
    ctx.recordMetric({ metricId: "outcome.verified", value: 1 });

    return {
      verifications: [
        verifyPredicate("id", "what was checked", true, "why it passed"),
      ],
      evidence: ["a short, redacted note for the report"],
    };
  },
};
```

### Rules

1. **A scenario cannot pass itself.** Return verifications; the runner decides.
2. **Verify reality, not text.** Inspect artifacts, records, states, policies,
   effects — never "the model said it worked".
3. **Declare your effects honestly.** Producing an effect you did not declare
   blocks the scenario.
4. **Declare your blind spots.** They are published on the scorecard.
5. **Use only public barrels** (`src/<subsystem>/index.ts`), not private files.
6. **Bump `version`** whenever intent, expected outcome, set, determinism,
   profiles, allowed effects, or contracts change. The governance check throws
   otherwise.

### Choosing a set

- `development` — while iterating.
- `validation` — the main correctness set.
- `independent` — held out. Put your *most load-bearing* checks here: this is
  what detects overfitting.

---

## 2. Fixture isolation

```ts
const ws = FixtureWorkspace.create();   // disposable temp dir
ws.apply(ADVERSARIAL_FIXTURE);          // synthetic data only
ws.write("a/b.txt", "content");
ws.resolve("../../etc/passwd");         // throws — traversal refused
ws.dispose();                           // removed
```

`assertNotRealUserHome()` refuses the real home, `~/.xr`, the repo root, and
system directories. Sensitive scenarios **must** use synthetic or redacted
fixtures; `SYNTHETIC_SECRET_FIXTURE` contains credential-*shaped* strings that
authenticate to nothing.

---

## 3. Outcome verifiers

| Use | Verifier |
|---|---|
| a file was produced correctly | `verifyArtifact(ws, {...})` |
| a value equals an expected value | `verifyState({...})` |
| an arbitrary condition, with explanation | `verifyPredicate(id, desc, ok, detail)` |
| durable records were written | `verifyRecords({...})` |
| a policy decision was right *and explained* | `verifyPolicy({...})` |
| the evidence chain is complete | `verifyEvidence({...})` |
| side effects match expectation | `verifySideEffects({...})` |
| user-facing text conveys what it must | `verifyComprehension({...})` |

Pass `required: false` for a verification whose failure should yield `partial`
rather than `failed`.

---

## 4. Metrics

Every metric must be declared in `METRIC_DEFINITIONS` before use — recording an
undeclared metric id throws. Each definition states meaning, unit, direction,
source, and limitations. Duplicate ids are rejected by
`assertNoConflictingMetrics()`.

Do **not** invent a metric that duplicates an existing meaning with a different
name.

---

## 5. Safety gates

You do not write gates; the runner applies all nine to every scenario. What you
control is `allowedEffects` — declare truthfully, because the gates compare
declaration against reality.

Note that gates inspect **unredacted** evidence while storage is redacted. Do
not attempt to pre-redact inside a scenario; use `ctx.note()` and let the
harness handle both views.

---

## 6. Certification

```bash
xr evaluate certify runtime_version @rrrtx/xr
xr evaluate certify capability my.capability.id --run <runId>
```

To add a certifiable target, extend `CERTIFICATION_REQUIREMENTS` with the
scenarios that must pass. Requirements naming scenarios that never ran yield
`insufficient_evidence`, not a pass.

Certifications expire (90 days by default) and are revocable. Invalidating a run
revokes the certifications built on it.

---

## 7. Compatibility contracts

`XR_7_0_CONTRACT_BASELINE` records the exports, CLI commands, schema versions,
and deployment profiles XR promises to keep. When you intentionally change a
contract:

1. update the baseline;
2. document the change in the migration guide;
3. bump the relevant schema version.

Removing a promised export or CLI command without doing this is reported as
`breaking` and fails `xr evaluate compatibility`.

---

## 8. Regression triage

```bash
xr evaluate regressions                       # last two stored runs
xr evaluate compare <baseline> <candidate>
```

Triage order:

1. **Critical regressions first.** Any regression in a gating dimension
   (`trust`, `context`, `environment`, `capability`, `enterprise`) is critical
   and blocks release regardless of improvements elsewhere.
2. **Check comparability warnings.** A "regression" across different deployment
   profiles or isolation backends may be an environment difference, not a code
   defect.
3. **Check `onlyInBaseline`.** Scenarios that disappeared are lost coverage, not
   a clean run.
4. **Check overfitting.** Development improving while independent does not is a
   finding about the change.
5. **Classify the cause** with `classifyGap()` and assign an owner.

---

## 9. Reproducibility checklist

- [ ] Scenario uses `ctx.now()` and `ctx.random()`, never `Date.now()` or `Math.random()`
- [ ] No dependence on wall-clock time beyond declared tolerance
- [ ] No network access unless explicitly declared
- [ ] Fixture is created fresh and disposed
- [ ] `determinism` is declared honestly
- [ ] `xr evaluate reproduce <id> --runs 5` reports reproducible

---

## 10. Governance / change review

Before merging a scenario change:

- [ ] `version` bumped if the meaning changed
- [ ] `bun test test/evaluation/` passes
- [ ] `xr evaluate compatibility` reports no breaking change
- [ ] `xr evaluate claims` is clean
- [ ] any discovered gap is classified and owned
- [ ] no `future_product_work` gap is marked fixable in a measurement phase

---

## 11. Result schema and API

```ts
import {
  EvaluationRunner, ALL_SUITES, buildScorecard,
  EvaluationRepository, adaptStoreForEvaluation,
  compareRuns, certify, buildEvidenceBundle,
} from "./src/evaluation/index.ts";

const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
const card = buildScorecard(run);          // dimensions + gates + weights
const bundle = buildEvidenceBundle(run);   // redacted, hash-verifiable
```

Persisted schema version: `xr-7.0.0/evaluation-v1`.
Report version: `xr-7.0.0/evaluation-report-v1`.
Certification version: `xr-7.0.0/evaluation-certification-v1`.
