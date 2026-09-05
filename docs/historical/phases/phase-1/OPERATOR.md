# XR Phase 1 — Operator Guide (reliability & persistence)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


## Supported client / workload ceiling

- **One read-write connection per database file per process** is enforced.
- **Multi-process access is supported and safe**: N `xr` invocations (or the
  daemon + CLI) sharing one `XR_HOME` serialize at the SQLite level
  (`IMMEDIATE` + `busy_timeout=5000` + bounded retry). Measured:
  **24 concurrent writer processes × 200 writes each (4,800 appends) with 0
  "database is locked" errors and an intact audit chain** (CI stress suite).
- SQLite is single-writer: throughput is contention-bound. For very high write
  fan-out, prefer one long-lived process (the daemon) and let CLI invocations
  be read-mostly.

## WAL / checkpoint behaviour

- `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`,
  `foreign_keys=ON`, `wal_autocheckpoint=1000`.
- A maintenance job checkpoints the WAL every 15 minutes
  (`wal_checkpoint(RESTART)`, fallback TRUNCATE) and a checkpoint runs on
  graceful close. WAL growth is bounded; if you see a large `-wal` file it
  means long-lived readers or a long-running process between checkpoints.

## RPO / RTO

See `docs/phase-1/RPO_RTO.md`. Summary: process-crash RPO = 0; power-loss RPO
≤ the checkpoint window; cold restart < 2 s.

## Backup / restore

- `xr` backups are crash-consistent `VACUUM INTO` snapshots with real record
  counts and SHA-256 integrity (never simulated).
- Restore replaces the DB, reopens, and **verifies the audit chain** — an
  intact chain is the restore acceptance check. A pre-restore safety snapshot
  is always taken first.
- Operator verification: `BackupService.verifyBackup(id)` recomputes the hash.

## Update / rollback

- `xr update` uses the atomic updater: config backup → install candidate into
  a parallel slot → health canary (release identity + doctor + audit probe) →
  atomic blue-green swap → automatic rollback on canary failure. Both git
  checkout and npm layouts share one contract. Version identity is unified
  (Phase 0) — updates are **not** cryptographically signed (Phase 9).

## Uninstall

- `xr uninstall --keep-data`: removes the launcher, the installation, and
  PATH entries; keeps your data (~/.xr).
- `xr uninstall --purge`: additionally removes the data home (config, DBs,
  vault, memory, backups).
- The running checkout is never deleted. Deletion requires confirmation.

## Fail-closed behaviours

- Appends to a corrupted audit chain are refused with a repair path:
  `xr audit verify` → `xr audit repair --yes`.
- Interrupted non-idempotent effects are never re-run; they surface as
  reconciliation-required (see `execution` status).
