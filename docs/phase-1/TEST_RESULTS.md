# Phase 1 — Test Results (STEP 7/8)

All results captured on 2026-07-31 against the Phase-1 implementation.

## Full suite (final, after CI review fix)

```
2032 pass / 0 fail  (baseline before Phase 1: 1980 pass / 0 fail)
Ran 2032 tests across 136 files. [~31s]
```

52 new reliability tests added (test/reliability/*). Verified clean with
`CI=true` on 3 consecutive full-suite runs and 5 consecutive
concurrency-stress runs.

## CI review fix (cross-process migration race)

The first CI run (PR #32) failed the concurrency stress on the 4-vCPU runner.
Root causes and fix are recorded in AUDIT_REPORT.md §4b: a
`schema_migrations` UNIQUE race in `runMigrationsUp` and `busy_timeout` being
set after `journal_mode=WAL`. Both fixed; regression covered by
`test/reliability/migration-race.test.ts`.

## Reliability suite (test/reliability/)

| File | Tests | Asserts |
|---|---|---|
| `concurrency-stress.test.ts` | 3 | 8×50 → 0 locked/0 lost/chain valid; 12×120 → intact; mixed workload survives |
| `single-writer.test.ts` | 4 | unsafe-write count = 0; max-1 RW per file; no second `new Database` in src/; transaction passthrough atomic |
| `crash-injection.test.ts` | 7 | audit/session+step/workflow/vault/migration/idempotency/`kill -9` mid-stream |
| `idempotency.test.ts` | 7 | claim-first; interrupted non-idempotent never re-run; ExecutionService integration |
| `migrations.test.ts` | 4 | up/down round-trip; downgrade readability; idempotent up |
| `rpo-rto.test.ts` | 4 | real backup/restore + chain verify; pre-restore safety; RPO-0 restart; RTO budget |
| `audit-chain-extra.test.ts` | 5 | fail-closed append; repair semantics; chainStatus; WAL checkpoint; boundary predicates |
| `store-edge.test.ts` | 5 | legacy constructor; embedding/expiry/provenance semantics; dedup |
| `golden-path.test.ts` | 1 | full journey: install → answer → restart → resume → answer → uninstall |
| `update-uninstall.test.ts` | 11 | applyUpdate state machine; git blue-green swap + rollback; uninstall per mode |
| `artifact-e2e.test.ts` | 1 | pack → install → drive the artifact (identity + audit + durability) |
| `migration-race.test.ts` | 1 | 16 processes open one fresh DB concurrently → 0 migration races, 0 lost writes |

## Concurrency reproduction (before → after)

| Metric | Before fix | After fix |
|---|---|---|
| 8 writers × 50 writes | 394/400 written, 6× "database is locked", **chain broken @ 138** | 400/400, 0 locked, chain valid |
| 24 writers × 200 writes | — (would be worse) | 4,800/4,800, 0 locked, chain valid |

## Mutation gate (scripts/mutate.ts, threshold 0.6)

| Module | Score | Gate |
|---|---|---|
| src/state/workspace-store.ts | 0.74 | PASS |
| src/state/write-gate.ts | 1.00 | PASS |
| src/execution/state-machine.ts | 0.75 | PASS |
| src/services/review-decision.ts | 0.84 | PASS |
| src/integrations/credentials.ts | 1.00 | PASS |

## Phase-0 gates (unchanged, still green)

- `release:check` — all 6 surfaces in sync at 7.0.1.
- `claim-lint` — ✓ no unsupported claims · 8 evidenced claims.
- `bunx tsc --noEmit` — clean.
