# Public Beta — Feedback → Acceptance Loop

XR is in **Public Beta** (see `release.manifest.json → distribution.stability`).
A beta that collects feedback without closing the loop is marketing; this
document is the loop, and it closes in code.

## The loop

```
user feedback (issue: beta_feedback.yml / false_claim.yml)
        │
        ▼
triage (every patch cycle: weekly at minimum during beta)
        │
        ├─ reproducible defect ──────────► failing test lands in test/ …… fix ⇒ test green ⇒ next patch
        ├─ claim that is not true ───────► corrected text + claim-lint stays green (priority: same as a crash)
        ├─ platform/channel gap ─────────► support-tiers/register entry NOW + scheduled work, with owner
        └─ not actionable / out of scope ► recorded rejection with rationale (kept public in the issue)
        │
        ▼
acceptance: the fix ships with an updated test or register entry in the next
patch release; the issue is closed by linking the commit, never by comment alone.
```

## Triage SLA (beta)

- **False-claim reports** (`false_claim.yml`): acknowledged within **2 working
  days** and fixed before the next tag — the register's review policy treats an
  untrue claim as a defect of crash severity.
- **Install/channel defects** (an installer path exits non-zero, a checksum
  fails, update/rollback misbehaves): reproduced on the platform's CI family;
  the nightly `beta-install` job is updated to cover the failing case where a
  case can exist in CI, so the metric proves the fix.
- **Everything else**: triaged within **7 days** into the buckets above.

## How the >99% install bar stays honest

`scripts/beta-metric.ts` aggregates one JSON line per install attempt, recorded
by the nightly matrix on three OS families. The gate:

- requires a **full rolling window** (30 recorded attempts) before a rate is
  even *reportable* as meeting the bar — partial windows print `PROVISIONAL`
  and are not a claim;
- never drops a failed attempt;
- fails the nightly job once a full window is below the threshold.

A user-visible "install success ≥ 99%" statement may exist only while the gate
is green over a full window. (See Constitution ADR-10: evidence before claim.)

## Where feedback lands

| Kind | Template | Destination |
|---|---|---|
| Something untrue | `false_claim.yml` | immediate correction + lint evidence |
| Beta behavior/packaging | `beta_feedback.yml` | this loop; acceptance criteria linked |
| Security | `SECURITY.md` | the security disclosure path (never a public issue first) |

## What beta feedback is NOT for

- Enterprise identity/SSO, HA, remote execution fleets, compliance programs —
  these are Phase 10 scope; report them as interest, they are not beta defects.
