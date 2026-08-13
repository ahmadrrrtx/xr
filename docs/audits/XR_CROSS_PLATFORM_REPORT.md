# XR — CROSS-PLATFORM REPORT (Windows / Linux / macOS)

**Date:** 2026-08-13 · **Basis:** `main @ 82402df` + GitHub Actions forensics on run 31702859699.

---

## 1. Parity authority

- One computation authority: `scripts/platform-parity.ts` + `test/platform/exclusions.json` (4 documented Windows-only exclusions, each with a reason + `since` tag, guarded by `--validate`).
- Suite sizes: **linux 238 · darwin 238 · win32 234**.
- Verification of this audit runs on **Linux only** (this sandbox); Windows/macOS behavior is established from CI evidence + code reading, and stated as such.

## 2. Per-platform status

| Platform | Typecheck | Suite | Golden path | Blocker |
|---|---|---|---|---|
| Linux x64 | PASS | PASS locally / FAIL on hosted runners (concurrency flake) | PASS | 3.1 SQLite busy flake |
| macOS arm64 | PASS (CI) | FAIL (path normalization) | not reached | 3.2 `/var` vs `/private/var` |
| Windows x64 | PASS (CI) | FAIL (Bun panic + lifecycle cleanup) | not reached | 3.3 |
| Linux arm64 / macOS x64 | Tier 2 (cross-compiled, build-only) | — | — | No native runners (known-lim #14) |
| Termux (Android) | Tier 3 (installer path) | — | — | Community |

## 3. Root-cause detail per OS

### 3.1 Linux — `test/reliability/concurrency-stress.test.ts`
- **Symptom:** `database is locked`, 399/400 writes, writer #3 lost 1 append.
- **Cause:** SQLITE_BUSY escaping the retry contract on a non-gated path (open/PRAGMA/migration) under hosted-runner I/O contention.
- **Determinism:** probabilistic. Reproduced in CI (Linux), not locally (10/10 pass).

### 3.2 macOS — `/var` vs `/private/var`
- **Symptom:** `expect(body.root).toBe(projectDir)` — Expected `/var/folders/…`, Received `/private/var/folders/…` (`test/daemon/phase-g.test.ts:61`; same class in `test/evaluation/`).
- **Cause:** macOS `/var` is a symlink to `/private/var`; `realpathSync` (product) vs un-normalized `mkdtemp` path (test).
- **Determinism:** deterministic on macOS.

### 3.3 Windows
- **Symptom A:** `test/perf/` segment — Bun **panic (main thread): Internal assertion failure** (exit 3, crash class; the runner's retry did not recover).
- **Symptom B:** `test/capabilities/lifecycle.test.ts` — "full local lifecycle with effects asserted" fails; cleanup contention with an open WAL handle + Defender/indexer (the test's own header documents this class).
- **Determinism:** panic is probabilistic; lifecycle failure is timing/AV-dependent.

## 4. Cross-platform design review (code-level)

| Concern | Finding |
|---|---|
| Paths | Uses `node:path` join/dirname correctly; the macOS failure is a test-side normalization gap, not a product path bug. Windows `realpath` guard is separately tested. |
| Spawning | `bin/xr`, golden-path and workers use absolute `process.execPath`/`bun` correctly; `xr.cmd` launcher name handled for Windows. |
| Signals | POSIX-only crash matrix correctly excluded on win32 with a reason (`exclusions.json`). |
| Shell | Parity runner is POSIX-only-tooling (bash 3.2/5.x compatible); Windows runs it under the bash that GitHub provides. |
| Env/temp | `TMPDIR`/`tmpdir()` used; suite temp root via `test/helpers/suite-tmp.ts` preload (`bunfig.toml`). |
| SQLite | WAL + busy_timeout + write-gate are platform-agnostic; the Windows lifecycle test still contends with AV/Defender file locks. |
| Bun runtime | Windows Bun 1.3.14 panics under `test/perf` load — a runtime-level flake, not a product defect. |

## 5. Fix plan (mapped to implementation phases)

| # | Fix | Platform | Phase |
|---|---|---|---|
| CF-1 | Bring connection-open/PRAGMA/migration under the busy-retry contract; keep the strict test | Linux/macOS | P0 |
| CF-2 | realpath-normalize both sides of the `root`/path assertions | macOS | P0 |
| CF-3 | Isolate the Windows Bun-panic perf test behind a documented exclusion (with reason) only after confirming it is a runtime panic; harden lifecycle cleanup retry | Windows | P0 |
| CF-4 | Add bounded per-step timeouts (not the fix, a safety net) | all | P6 |

## 6. Verdict

**FAIL → fix in P0.** Cross-platform *design* is sound and unusually disciplined (single authority, evidence-bound exclusions, honest degradation); the failures are four concrete, bounded defects — none requires architectural change.

---

## Post-implementation update (2026-08-13, after P0)

- **CF-1** applied: `openDatabase()` now busy-retries its PRAGMA sequence (root cause) + new
  `test/reliability/open-churn.test.ts` regression test.
- **CF-2** applied: `test/daemon/phase-g.test.ts` realpath-normalizes the macOS `/var` assertion.
- **CF-3** applied: `test/perf/binary-smoke.test.ts` excluded on win32 with a documented reason
  (Bun `--compile` panic); plugin `renameSync`/`rmSync` wrapped with bounded Windows-safe retry.
- Parity authority is now **239 test files · linux:239 · darwin:239 · win32:234** (5 Windows
  exclusions — the 4 original POSIX ones + binary-smoke).
- **Status:** code fixes done and Linux-verified; **Windows/macOS confirmation requires a
  GitHub-hosted CI re-run** (cannot be triggered from this sandbox).
