# XR RUNTIME — MASTER IMPLEMENTATION PLAN

**Derived from:** `XR_RUNTIME_DEEP_AUDIT.md` + `XR_RUNTIME_GAP_REGISTER.md` at commit `3308aff`.
**Governing constraints:** no big-bang rewrite · no casual deletion · no hardcoded demos ·
no claim without evidence · no silent scope expansion · preserve XR Agent Runtime direction.

## Phase ordering rationale

The audit found a **sound foundation with a short, specific defect list**. Therefore the
original 14-phase program is **not justified by the evidence** — most phases would be
make-work on subsystems that already function. Per the mission's own rule ("You may
add/remove phases only if the actual repository evidence proves that doing so is necessary"),
this plan collapses to **6 evidence-driven phases**, ordered so foundations precede dependents.

```
PHASE A  Provider I/O correctness (GAP-001)          ← blocks everything reliability-related
   ↓
PHASE B  Untrusted tool output (GAP-003)             ← security, independent
   ↓
PHASE C  CLI contracts (GAP-004, GAP-005)            ← automation + future UI
   ↓
PHASE D  Architecture hygiene (GAP-006, GAP-007)     ← depends on nothing; low risk
   ↓
PHASE E  Claim accuracy (GAP-008, GAP-002 docs)      ← must follow all behavior changes
   ↓
PHASE F  Final red-team re-audit + readiness report
```

Deferred with justification: GAP-009 (needs A's plumbing; scoped as follow-on),
GAP-010/011/012 (documentation/classification only — no code change warranted).

---

## PHASE A — Bound and cancel provider I/O

**Objective:** No model call can hang forever; caller cancellation reaches the transport.

- **Prerequisites:** none.
- **Files:** `src/core/types.ts` (chat options), `src/providers/openai-compat.ts`,
  `src/providers/native/*.ts` (6), `src/core/agent.ts` (thread `deps.signal`),
  `src/config/config.ts` (`providers.requestTimeoutMs`).
- **Exact changes:**
  1. Add optional `ChatOptions { signal?: AbortSignal; timeoutMs?: number }` to the provider contract (backwards-compatible optional 3rd arg).
  2. In each adapter, build an effective signal = `AbortSignal.any([callerSignal, AbortSignal.timeout(effectiveTimeout)])` (guarding for older runtimes) and pass it to `fetch`.
  3. Convert abort/timeout rejections into honest, typed errors distinguishing *cancelled* from *timed out*.
  4. Thread the loop's `deps.signal` into every `provider.chat()` call site.
  5. Config default 120000ms, env-overridable; never zero/unbounded.
- **Risks:** over-aggressive default breaking slow local models → mitigate with a generous
  120s default and explicit config. `AbortSignal.any` availability → feature-detect.
- **Tests:** slow-provider bounded-termination test; abort-propagation test; existing provider
  suite must stay green.
- **Acceptance:** slow provider terminates with a timeout error; SIGINT during in-flight call
  exits 130 (not 124); 0 regressions.
- **Rollback:** options are optional; revert adapters individually.
- **Verify:** `bun test`, `bun run typecheck`, live slow-provider + SIGINT reproduction.

## PHASE B — Treat tool output as untrusted

**Objective:** Tool results are scanned, labelled and delimited before entering context.

- **Prerequisites:** none (independent of A).
- **Files:** `src/core/agent.ts`, reuse `src/security/guard.ts#scanUntrusted`.
- **Exact changes:** wrap tool results in an explicit untrusted-data envelope with a
  "data, not instructions" preamble; run `scanUntrusted`; on hits emit a
  `security.untrusted_content` audit event and annotate the message. **Non-blocking by
  default** — label + audit, never silently drop tool output (no functionality deleted).
- **Risks:** prompt-shape change could affect model behavior → keep the wrapper minimal and
  deterministic; verify the full suite.
- **Tests:** poisoned output → audit event emitted + content delimited; clean output → no event.
- **Acceptance:** injection signature in tool output is detected and recorded; loop still works.
- **Rollback:** single localized function; revert in one commit.

## PHASE C — Honor CLI contracts

**Objective:** `agents run` obeys the documented exit-code and `--json` contracts.

- **Prerequisites:** none.
- **Files:** `src/commands/agents.ts`.
- **Exact changes:** map terminal status → exit code (completed 0 / blocked·failed 1 /
  cancelled 130); implement `--json` in the `run` branch (suppress banner + progress, emit one
  record: workflowId, status, kind, durationMs, tasks[], finalOutput, errors[]).
- **Risks:** scripts relying on the old always-0 behavior → this *is* the fix; documented.
- **Tests:** exit codes for completed/blocked; `--json` output parses and carries required keys.
- **Acceptance:** blocked workflow exits 1; `agents run --json | jq` works.

## PHASE D — Architecture hygiene

**Objective:** Remove verified dead code; stop core→extension leakage.

- **Prerequisites:** A–C green (avoid mixing risky edits with behavior fixes).
- **Files:** `src/security/policies.ts`, `src/integrations/oauth.ts`, `.dependency-cruiser.cjs`.
- **Exact changes:** follow the deletion protocol (identify → check usage → trace refs →
  confirm obsolete → document → remove). Both modules are Business-OS residue with **zero**
  importers. Add a boundary rule forbidding `src/ → extensions/` for *value* imports.
- **Risks:** hidden dynamic import → grep for string paths before removal; suite must stay green.
- **Acceptance:** `bun run boundaries` → 0 warnings; typecheck + full suite green.
- **Rollback:** files restorable from git.

## PHASE E — Claim accuracy

**Objective:** Every surface's numbers and install instructions match reality.

- **Prerequisites:** D (counts must reflect final tree).
- **Files:** skills counting authority + call sites; README install/status notes.
- **Exact changes:** one exported counting function; label the distinct numbers honestly.
  For GAP-002, since publishing to npm is outside this workspace's authority: state the true
  published version per channel in the docs and recommend a CI gate comparing manifest vs live
  npm dist-tag. **Do not** silently soften the claim — state the divergence.
- **Acceptance:** `claim-lint` green; no surface asserts an unverified number.

## PHASE F — Final independent red-team re-audit

Re-run everything as a fresh adversary: full suite, all gates, live agent/tool/approval/
traversal/tamper/daemon/offline/multi-agent reproductions, plus **re-attack the specific fixes**
(slow provider, SIGINT, poisoned tool output, blocked-workflow exit code). Compare INITIAL →
IMPLEMENTATION → FINAL and produce `XR_RUNTIME_FINAL_READINESS_REPORT.md` with explicit
statuses and remaining limitations.

---

## Release gate (unchanged from mission)

Build · typecheck · lint/boundaries · unit · integration · E2E · security checks · onboarding ·
provider flow · agent loop · tools · recovery · config · offline · **no known P0** · claims
matrix accurate · docs match implementation · repo clean.
