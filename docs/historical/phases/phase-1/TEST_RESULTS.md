# Phase 1 — Test Results (STEP 7/8)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


All results captured on 2026-07-31 against the Phase-1 implementation.

## Full suite (final, after CI review fix)

```
2033 pass / 0 fail  (baseline before Phase 1: 1980 pass / 0 fail)
Ran 2032 tests across 136 files. [~31s]
```

53 new reliability tests added (test/reliability/*). Verified clean with
`CI=true` on consecutive full-suite runs and 5 consecutive
concurrency-stress runs.

## Cross-platform review round 4 (Windows golden path)

After round 3, Linux/macOS are green and the Windows unit suite passes; only
the Windows **golden-path** step failed. Root cause (by analysis): the golden
path spawned the install wizard with the bare command `"bun"`, which is not
reliably resolved via PATH/PATHEXT when spawned from inside bun on Windows —
every subsequent step depends on that spawn, so the whole step failed. Fixes
in scripts/golden-path.ts:
- spawn uses `process.execPath` (absolute bun binary path) instead of `"bun"`;
- `FAIL <step>: <reason>` is printed to stdout as well as stderr, so GitHub
  Actions surfaces the exact failing step in the truncated step output;
- the whole script is wrapped in a top-level try/catch so any thrown error
  becomes a clean FAIL line instead of an uncaught stack;
- install-wizard failures include the child's stdout/stderr/exit code;
- wizard timeout raised to 240s (Windows bun cold-start is slower).

## Cross-platform review round 3 (Windows EBUSY)

After the macOS policy fix, only Windows failed: `helpers.ts:24` — the `rmrf`
retry threw after exhausting attempts. Root cause: the first version used a
spin-loop backoff that blocked the event loop, so bun never got a chance to
finalize/close the SQLite handles before the directory delete. Fixed: `rmrf`
is async with `setTimeout` backoff — exactly the pattern proven on the Windows
CI job by the existing `test/state/workspace-store.test.ts`. All Phase-1 tests
now `await rmrf(...)` in async callbacks. Also pre-fixed a latent Windows
golden-path bug (launcher hardcoded `xr`; `resolveUninstallPaths` uses
`xr.cmd` on win32).

## Cross-platform review (PR #32 second CI run)

macOS + Windows exposed real platform issues (annotations pulled from CI):

1. **macOS policy bypass (real security gap):** on macOS `realpath("/etc/passwd")`
   = `/private/etc/passwd`, which escaped the guard's `^/etc/…` patterns —
   `checkAction` allowed reading a system credential file. Fixed in
   `src/security/guard.ts` (additive `/private/etc/…` patterns) + regression
   test. This is exactly the kind of defect T7's cross-platform CI exists to
   surface.
2. **Windows EBUSY in Phase-1 test cleanup:** plain `rmSync` in `finally`
   blocks throws `EBUSY: resource busy or locked` on Windows while SQLite
   handles release. Fixed: shared `test/reliability/helpers.ts` `rmrf`
   (retry-based, same pattern as the repo's `rmrfWithRetry`).
3. **Windows POSIX-only Phase-0 corpora:** `policy-gate-adversarial.test.ts`
   (isAbsolute("/etc/…") is false on Windows) and `cli-spine.test.ts`
   (doctor --json not Windows-verified) are skipped on win32 with
   documentation — the same honest discipline the repo already applies in
   doctor.test.ts / shield.test.ts.
4. **macOS golden path lacked HOME/XR_HOME env** — fixed in cross-platform.yml.

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
| `helpers.ts` | — | shared retry-based `rmrf` (Windows EBUSY-safe test cleanup; async `setTimeout` backoff so bun can release handles) |

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
