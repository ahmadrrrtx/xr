# Phase 1 — Audit Report (STEP 1)

**Audit date:** 2026-07-31
**Checked out:** `main` @ `d2e84c0` (Phase 0 commit), release identity `7.0.1`
**Baseline test suite:** 1980 pass / 0 fail (124 files) — Phase 0 floor is green.

---

## 1. Phase-0 re-verification (do not assume — verified against current code)

| # | Phase-0 item | Hypothesis | Verdict | Evidence |
|---|---|---|---|---|
| 1 | Unified version identity 7.0.1 | present | **VERIFIED** | `package.json` `7.0.1`; `src/core/version.ts`; `release.manifest.json`; `release:check` script enforces all six stamped surfaces. |
| 2 | Vault envelope encryption in `src/integrations/credentials.ts` (persisted per-record salt) | present | **VERIFIED** | `v2:<salt>:<iv>:<tag>:<wrappedDEK>:<dekIv>:<dekTag>:<ciphertext>` envelope; `migrateLegacyRecords()` refuses legacy `iv:tag:ciphertext` and forwards only when plaintext is recoverable. |
| 3 | Workflow executor delegation in `src/workflow/engine.ts` | present | **VERIFIED** | Engine delegates node execution through an executor; Phase 0 · T6 fixed the "advance on failure" defect (see line 753 comment). |
| 4 | Stub tools removed in `src/computer/system-control.ts` (`SYSTEM_TOOLS` vs `REMOVED_STUB_TOOLS`) | present | **VERIFIED** | `REMOVED_STUB_TOOLS` exported and asserted in `test/phase0/stub-tools.test.ts`. |
| 5 | Shell `extraTools` bridge in `src/interfaces/shell/app.ts` | present | **VERIFIED** | `extraTools: extensibility.extraTools` wired into the shell tool list. |
| 6 | Canonical policy gate in `src/security/guard.ts` (`realpath`/`new URL`/`normalizeHost`) | present | **VERIFIED** | `realpathSync` canonicalization, `normalizeHost()`, `new URL()` candidate parsing. |
| 7 | Container-aware bind in `src/daemon/server.ts` | present | **VERIFIED** | `resolveBindHost()`: `127.0.0.1` bare metal, `0.0.0.0` in container; loopback-only publish guidance in compose. |
| 8 | Fail-closed reviewer in `src/services/review-decision.ts` | present | **VERIFIED** | `failClosed()` on empty/ambiguous/parse-failure sources; tests in `test/phase0/reviewer-fail-closed.test.ts`. |

**No Phase-0 regression found.** All eight items verified present and green.

---

## 2. Phase-1 surface audit (hypotheses → current reality)

### 2.1 Audit hash-chain append — the headline hypothesis
> Hypothesis: `lastHash()` → insert with no surrounding transaction, breakable under concurrency.

**VERIFIED — hazard is real and was REPRODUCED.**

- `src/state/workspace-store.ts` `audit()`:
  `const prev = this.lastHash(); … hash = sha256(payload); INSERT …` — **no transaction**, no `IMMEDIATE`, no busy-timeout, no lock.
- `verifyChain()` recomputes and reports the first broken index.
- **Reproduction (before fix):** 8 child processes × 50 writes against one DB file:

  ```
  totalAttempted 400 → totalWritten 394
  lockedErrors    6   ("database is locked")
  chainValid      false, brokenAt 138
  ```

  i.e. **6 lost writes + a forked/broken audit chain**. The "tamper-evident" flagship claim is falsifiable under concurrency.

- A second, independent read-modify-write gap exists in `src/business/core/audit.ts`
  (`AuditTrail.log`: `SELECT hash … ORDER BY timestamp DESC` then `INSERT`, no transaction) — same defect class on the Business OS `biz_audit` chain.

### 2.2 SQLite configuration
| Setting | Current | Phase-1 requirement |
|---|---|---|
| `journal_mode` | `WAL` ✅ | WAL |
| `busy_timeout` | **not set (default 0 → instant SQLITE_BUSY)** ❌ | ≥ 3000 ms |
| `synchronous` | **default FULL** (not set) ❌ | NORMAL |
| `foreign_keys` | `ON` ✅ | ON |
| `wal_autocheckpoint` | **not set (default 1000)** — works but undocumented | explicit 1000 |
| `wal_checkpoint(RESTART)` | **absent** ❌ | periodic, bounded |
| read/write connection separation | one connection per `WorkspaceStore` instance; **no max-1-RW enforcement**; `connectionCount()` is a counter only ❌ | max-1 RW + read connections |
| `IMMEDIATE` locking | **absent** — `db.transaction()` (DEFERRED) in `saveWorkflow` ❌ | IMMEDIATE for multi-statement writes |
| retry/backoff | **absent** ❌ | retry/backoff with jitter |

### 2.3 Write authorities (trust-critical mutation paths)
- Single *process* discipline mostly holds via the kernel DI (one `WorkspaceStore` per workspace, `StateServiceProvider`), but:
  - `new WorkspaceStore(...)` is exported and callable anywhere (tools, commands, tests) → multiple RW connections to the same file are possible.
  - **No application-level single-writer gate** and **no atomic audit append** → the multi-process hazard (above).
  - Multi-statement writes (`saveWorkflow`, `setActiveSkillVersion`, `remember` dedup check-then-insert, `saveResearch` check-then-insert, `setBudgetConfig`) are not uniformly transactional.
- Execution fabric (`src/execution/*`) writes through `ExecutionRepo` on the same store connection; checkpoints/leases/recovery tables exist (XR 4.3). Durable-agency machinery is genuinely present.

### 2.4 Crash / idempotency
- **Checkpoints:** real (`src/execution/checkpoint.ts` — kind-based side-effect safety, `sideEffectSafe`), persisted to `execution_checkpoints`.
- **Leases:** real (`src/execution/lease.ts` — UNIQUE `(target_type,target_id)`, stale detection by PID).
- **Recovery:** real (`src/execution/recovery.ts` — discovery, classification, `recovery_blocked` for unsafe work; `startupRecovery()` in `app.ts`).
- **Idempotency:** partial. `ExecutionService.execute` checks `findCompletedByIdempotencyKey` **before** running (check-then-run), and replays cached success. **Missing: claim-first** — no INSERT-before-effect slot, so a crash between side effect and completion record can duplicate a non-idempotent effect; two concurrent same-key runs can both pass the pre-check.
- **No generic idempotency/dedup primitive** exists (`src/state/idempotency.ts` absent).

### 2.5 Lifecycle / shutdown
- `XRApp.shutdown()` stops background jobs, runs `onStop` hooks, closes the store. Executions marked interrupted on stop.
- **No WAL checkpoint on shutdown**; `WorkspaceStore.close()` just closes the handle.
- Workspace switch re-binds workspace-scoped providers; active writes during switch are not explicitly drained (switch is guarded by lifecycle state).

### 2.6 Update / uninstall / migration
- `xr update` → `updateXR` (`src/install/system.ts`): **git-only** (`git pull --ff-only` + `bun install`), rollback only on dependency-install failure; does **not** use the existing `applyUpdate` (install → self-test → activate → rollback) in `src/update/selfheal.ts`; no health canary; **npm layout unsupported**.
- **No `xr uninstall` command.** `xr reset` exists (backups + delete config/db).
- Migration: additive `CREATE TABLE IF NOT EXISTS` + fail-soft `ALTER TABLE` probes in `WorkspaceStore.migrate()`; migration guides exist in `docs/migration/`; **no reversible-migration framework, no round-trip fixtures/tests**.

### 2.7 Backup/restore (RPO/RTO prerequisite)
- `src/deployment/backup/service.ts` exists but is a **STUB with simulated durability**: manifests report `recordCount: 0`, `integrityHash: "sha256:<backupId>"`, no actual data is backed up or restored. Constitution Commandment 2 violation ("no simulated durability").

### 2.8 CI
- `.github/workflows/ci.yml` is **Linux-only** (ubuntu-latest). Jobs: typecheck, truth-gate (release:check + claim-lint), baseline, website, test, quality-gate. **No macOS/Windows jobs, no nightly, no mutation gate, no artifact E2E.**

---

## 3. Reproduced concurrency hazard — evidence (before fix)

Harness: `test/reliability/repro/concurrency-repro.ts` (8 writers × 50 writes, child processes, shared DB).
Run: `bun run test/reliability/repro/concurrency-repro.ts`

```
writers: 8, writesPerWriter: 50, totalAttempted: 400
totalWritten: 394, lockedErrors: 6, otherErrors: 0
chainValid: false, chainBrokenAt: 138
errors: ["database is locked", … (6×)]
```

**Conclusion:** the audit chain breaks and writes are lost under concurrent access to one `XR_HOME`. This is the exact defect Phase 1 must eliminate; the same harness is the post-fix regression proof.

## 4. Post-fix evidence (same harness, after T1/T2)

```
8 writers × 50  → 400/400 written, 0 locked, chainValid true
12 writers × 120 → all written, 0 locked, chainValid true
24 writers × 200 → 4,800/4,800 written, 0 locked, chainValid true
```

`test/reliability/concurrency-stress.test.ts` asserts all three in CI.


---

## 5. Other findings (Phase-1 relevant, not in hypothesis)

- `src/business/core/audit.ts` `AuditTrail.log` has the same read-then-write gap on the Business OS chain.
- `src/state/store.ts` is a deprecated re-export of `workspace-store.ts` (kept for back-compat — do not disturb).
- The `ExecutionRepo.save` is a single upsert (atomic by statement) but the *transition sequence* in `ExecutionService` interleaves multiple statements/audits without a wrapping transaction — a crash mid-sequence can leave e.g. `started` without a checkpoint. Recovery handles this via leases/classification; T4 will assert this is actually safe.
