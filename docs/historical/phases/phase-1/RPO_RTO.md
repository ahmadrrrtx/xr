# XR Phase 1 — RPO / RTO (single-node scope)

> **FROZEN — HISTORICAL RECORD.** This document is preserved as a record of work already completed. It is **not** current guidance: no code imports it, no CI gate reads it, and no release claim depends on it. For the living tree start at [`docs/README.md`](../../../README.md); for what changed since, see [`docs/HISTORY.md`](../../../HISTORY.md).


**Scope:** single node, one XR_HOME, local-first. Full HA / multi-node
durability is Phase 10 — this document does not claim it.

## Stated objectives

| Objective | Value | Basis |
|---|---|---|
| **RPO (process crash / restart)** | **0** — every committed transaction survives a process crash or `kill -9` | WAL redo log: committed transactions are durable to the WAL before the commit returns; the crash matrix (T4) and RPO drill assert this. |
| **RPO (OS power loss)** | **≤ last WAL checkpoint window** (bounded; `wal_autocheckpoint=1000` pages, plus the 15-minute maintenance checkpoint) | `synchronous=NORMAL` does not fsync the WAL on every commit; on power loss the tail of the WAL may be lost. The `wal_checkpoint` maintenance job (15 min) + backup cadence bound this. |
| **RPO (backup)** | ≤ 15 minutes by default (operator-configurable) | The backup service takes a crash-consistent `VACUUM INTO` snapshot; a scheduled backup cadence of ≤ 15 min bounds data loss on catastrophic loss of the primary file. |
| **RTO (cold restart)** | **< 2 s** measured (open + migrate + verify) for single-node scope | Measured in the drill: 2 ms in CI sandbox; budget 2 s absorbs slow disks. |
| **RTO (restore)** | ≤ 60 s for a single-node workspace DB | File replace + reopen + chain verify; dominated by DB size. |

## Guarantees & honest limits

- **Process crash → RPO 0.** Every audit/state/execution write is a committed
  `IMMEDIATE` transaction; WAL replay restores it exactly. Verified by
  `test/reliability/crash-injection.test.ts` (SIGKILL at every persisted
  transition) and `test/reliability/rpo-rto.test.ts`.
- **Power loss → RPO bounded by the checkpoint window**, not 0. If you need
  power-loss RPO 0, run `synchronous=FULL` — not the Phase-1 default (this is
  a documented trade-off per Phase 1 spec: `synchronous=NORMAL`).
- **Backup/restore is real.** `xr` backup snapshots are `VACUUM INTO`
  crash-consistent files with real record counts and SHA-256 integrity;
  restore replaces the DB, reopens, and **verifies the audit chain** as the
  acceptance check (no "simulated durability").
- **Single-node only.** This is not a distributed durability claim.

## Drill

`test/reliability/rpo-rto.test.ts`:
1. seed → snapshot → mutate → restore → assert chain valid + state matches;
2. pre-restore safety snapshot is created;
3. restart RPO-0 check (25 committed audits + session survive restart);
4. cold-restart timing against the RTO budget.
