# Failure, Recovery, and Cleanup (XR 5.1)

**Bounded self-healing — not autonomous repair.** XR retries a narrow class of
perceptual failures once, stops on everything else, and says what it did. The
complete implementation is in `src/environment/recovery.ts` (~140 lines) plus
the cleanup/quarantine logic in the session layer.

## Failure taxonomy

`classifyFailure(message)` returns exactly one of:

| Kind | Triggers | Automatic behavior |
|---|---|---|
| `retryable_reobserve` | Perception-shaped errors: selector waits/not-found, detached/stale/not-visible elements, navigation timeouts, target closed, page crashed, detached frames | ONE automatic retry, only after a **mandatory re-observation** |
| `terminal` | Everything else: denied/permission/policy/blocked/disabled/invalid-action/schema/not-implemented, and any unrecognized failure | no automatic retry — reported |

Fail-closed default: an error message matching nothing is `terminal`.

## The retry decision (`decideRecovery`) — all five gates

An automatic re-observe retry requires ALL of:

1. failure classified `retryable_reobserve`;
2. reversibility is `reversible` or `compensatable` — **never** `irreversible`,
   **never** `unknown`;
3. `sideEffectUnknown` is false — an upload/submit/click whose effect is
   unknown is never retried, because the first attempt may have taken effect;
4. retry budget not spent — **at most 1 retry per action**
   (`environment.recovery.maxReobserveRetries`, schema-clamped 0–1);
5. session circuit breaker closed.

Any single failure → no retry, human-visible reason string explaining exactly
why ("side effect is unknown — never auto-retry; human review required").

The retry itself re-observes first (fresh observation registered), then
re-runs the action through the same full gate — including approvals where
they apply.

## Circuit breaker

Per session, `recordOutcomeOnCircuit`:

- 3 consecutive failures (`environment.recovery.circuitFailures`) → circuit
  **opens** for 60 000 ms (`circuitCooldownMs`); all actions on that session
  fail fast with the remaining cooldown shown.
- After cooldown the circuit is **half-open**: a single probe is allowed; a
  success resets the failure count, a failure reopens the cooldown.
- A circuit-open event carries a human-readable reason
  ("3 consecutive failures — circuit open for 60s; human review recommended")
  and is recorded on the action record (`recovery.circuitOpen`) and audit
  trail.

## Outcomes and uncertainty

Every action ends with one of: `succeeded` · `failed` · `denied` · `blocked` ·
`cancelled` · `uncertain`.

- `uncertain` = a side effect may or may not have happened (e.g. connection
  dropped after a submit). It is always surfaced in the record message and
  history — never folded into `succeeded` and never silently retried.
- XR never reports success it cannot verify. (5.1 audit fix: desktop `move`
  no longer routes through click execution; scroll on macOS/Windows reports
  honest `unsupported/skip` instead of faking success.)

## Cleanup and quarantine

Sessions own provider resources (browser contexts, downloads directories,
pre-image notes). `closeEnvironmentSession()` runs cleanup per provider:

| Cleanup state | Meaning |
|---|---|
| `not_required` | nothing to clean |
| `succeeded` | browser context closed, downloads swept, resources released |
| `partial` / `failed` | disclosed in the record and `xr env sessions` — never hidden |

**Cleanup failure quarantines the session** (`state: quarantined` with
`quarantineReason`): the session is taken out of circulation, its history is
kept for review, and it cannot be reused. Quarantine is terminal by design —
an operator inspects and decides; XR does not auto-revive a session whose
cleanup failed.

Unknown-side-effect failures alongside cleanup defects are quarantined rather
than retried — the session boundary is where uncertain state is contained.

## What XR will never do

- Retry loops beyond the single re-observe retry.
- Retry irreversible actions, deletes, submits, uploads, or anything whose
  side effect is unknown.
- "Self-heal" by changing the plan, widening the target, or switching to a
  more powerful mechanism (e.g. falling back to coordinate clicking when a
  selector fails, or disabling the browser sandbox after a launch failure).
- Reopen a quarantined session automatically.
- Suppress a failure record to keep a success streak.

## Configuration

| Key | Default | Range |
|---|---|---|
| `environment.recovery.maxReobserveRetries` | 1 | 0–1 (schema-clamped; cannot be raised silently) |
| `environment.recovery.circuitFailures` | 3 | ≥ 1 |
| `environment.recovery.circuitCooldownMs` | 60 000 | ≥ 1 000 |
| `environment.sessions.maxActive` | 5 | bounded |
| `environment.sessions.idleTimeoutMs` | 300 000 | idle sessions are swept closed |
