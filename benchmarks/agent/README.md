# Governed agent fixture benchmark — v1

**Scope:** executable deterministic regression, not model intelligence, vendor
availability, comparative quality, native desktop lifecycle or billing proof.
Reuses the shipped execution envelope/agent loop, registry and real core tools,
file authority, SQLite ledger/audit and authenticated route handler. Scripted
turns deliberately include unauthorized actions; passing depends on actual
bytes, denial receipts, exit codes and persisted evidence, **not** a model's
“done” message. Real Linux isolation effects have their own security gate.

```bash
bun install --frozen-lockfile --ignore-scripts
bun run benchmark:agent --out agent-benchmark.json          # all15 categories
bun run benchmark:agent:smoke --out agent-smoke.json        # 5/15, never called full coverage
bun test test/reliability/agent-benchmark.test.ts
```

Fixture authority: [`v1/suite.json`](v1/suite.json), schema1/fixture1.0.0.
Runner: `scripts/agent-benchmark.ts` (home/env bootstrap) and
`agent-benchmark-runner.ts` (actual production path plus effect verifiers).
Fifteen stable task IDs cover code repair with a real before-fail/after-pass
code test, documentation, injected context, same-name tool correlation,
approval denial, traversal, symlink disclosure, capability/egress denial,
required-sandbox absence, in-flight cancellation, token/unknown-price admission,
retry accounting, reopen/tamper detection, pin/privacy, offline secret onboarding.
A12 exercises the existing **conversational** empty-catalog retry; autonomous
agent mode deliberately keeps an empty answer as an honest failure.

## Isolation and output contract

The entrypoint creates a private temporary bootstrap home **before importing
production modules** (legacy paths resolve at import time). Every fixture lives
under it. Only OS/runtime process necessities are retained; owner keys/proxy or
trust opt-outs are not benchmark inputs. No global CLI install, real repository
edits, model download, external network or actual OS keychain is used. The
fixture verifier is a bounded child of the current Bun binary; its purpose is
testing produced code, not claiming an agent shell was kernel-isolated.
Cleanup runs in `finally`. A regression also pins a simulated owner home and
asserts it stays byte-identical. Unknown/live flags reject before product imports.

`--out` writes an atomic JSON report, refuses symlinks/unrelated existing files,
and may replace an earlier report from this benchmark. Runtime diagnostics may
precede the final JSON on stdout; use the report file for machine consumption.
Nonzero exit means FAIL or BLOCKED, or a nonzero/unknown monitored unauthorized
effect count. Missing platform fixture prerequisites are not converted to PASS.

### Metric meanings

* Task success/coverage and executed assertion pass rate are separate. Smoke's
  coverage is5/15; nonexecuted categories are not successful.
* Denial correctness requires a real denial receipt plus unchanged monitored
  effects, with positive controls where needed (eligible hosted pin/code test).
* Unauthorized effects count actual changes to the disposable workspace outside
  each task's allowed paths and to its sibling canary tree. It is **not** proof
  of no effects anywhere on a host; authorized engine metadata stays in the
  temporary bootstrap home.
* Model calls/retries are actual **scripted adapter invocations** and audit retry
  events. Tokens are the engine's heuristic estimates over those real messages,
  not provider-reported tokens or tokenizer ground truth.
* `syntheticGovernorUsd` uses an explicit1/1 fixture tariff to exercise admission
  and settlement. `billedUsd` is **null/unavailable**. No provider fees, prices,
  hardware/power costs or dollar invoice ceiling are inferred.
* Approvals requested/granted/denied count actual callbacks with predetermined
  fixture decisions. Actual human interventions are **null/unmeasured**.
* Wall time excludes initial module/bootstrap startup and outer cleanup. Peak
  process RSS includes module loading, not aggregate child peak. Commit, dirty
  flag, product version, fixture/runner/entrypoint digests, OS/arch/Bun/Node and
  machine memory/CPU count identify the environment. Do not compare these times
  with live model latency or sum overlapping test-suite counts.

## Optional bounded live protocol (separate evidence)

The deterministic runner intentionally has **no `--live` switch**. For an
owner-authorized compatibility canary, use the existing governed implementation:

```bash
# Use a dedicated home and explicitly entered credentials, NEVER a key in argv.
# Register/select exactly one target and an operator tariff if pricing is unknown.
xr providers measure --live --provider <provider> --model <exact-id> --json
```

This existing entrypoint requires explicit live opt-in plus an exact provider
and model; honors workspace locality and the shared budget/reservation ledger;
limits the suite to10 model requests,1024 output tokens/request,15s/request and
60s total, and estimated USD admission to the smaller positive owner per-task
cap or$0.25. Unknown/non-finite tariffs are refused for governed requests, including when USD thresholds are disabled. These are
admission/request bounds, **not an absolute provider invoice cap**. Review
`test/providers/probe-boundary.test.ts` and the recorded report. Never mark
`agentValidated`/recommended from credential presence or these small probes.
No live result was executed for this candidate without owner keys.

For **live task quality**, the owner may run the five smoke fixture goals with
one pinned target using the canonical engine in a dedicated temporary workspace,
with explicit budget/request/output/deadline and no cross-provider failover.
Reuse v1's exact byte/exit/audit verifiers; record prompt, model snapshot, adapter,
sampling settings, usage source, tool grants, retries, cost availability and all
failures. Keep network-tool egress empty and shell isolation mandatory. Start
with at most one task; do not turn this manual protocol into an unlimited retry
loop. This is NOT a claimed automated/live15-task result.

## Competitor comparison protocol (optional, unexecuted)

No competitor was installed or measured and no superiority claim is supported.
An owner can run the same versioned disposable fixtures and independent
verifiers, at least3 repetitions in randomized order on the same hardware, with
the same exact model/snapshot, prompt/context, output/request/time/token limits,
network policy and approval opportunities. Declare any tool/API mismatch and
price source, include setup/manual interventions and all failed/blocked runs,
and distinguish warm/cold caches and latency distributions. Publish raw
machine-readable evidence, artifact digests and permissions; never normalize
away denials, missing costs or undocumented assistance. A product unable to
exercise a category is NOT APPLICABLE/BLOCKED with a reason, not a fake success.
