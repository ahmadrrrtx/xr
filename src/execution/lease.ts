/**
 * XR 4.3 — Lease Manager
 *
 * Durable ownership/lease mechanism that prevents duplicate local execution
 * and detects stale ownership after process crashes.
 *
 * This is a LOCAL crash/restart safety guard, not a distributed consensus
 * mechanism. It prevents two concurrent XR processes from executing the
 * same work, and enables safe takeover of work abandoned by a dead process.
 *
 * Design:
 *   - Leases are keyed by (targetType, targetId) — UNIQUE constraint.
 *   - Acquisition is atomic via INSERT OR IGNORE / ON CONFLICT.
 *   - Stale detection: if owner PID no longer exists, lease is stale.
 *   - Release is explicit; crash leaves lease unreleased → stale on next check.
 */

import { randomUUID } from "node:crypto";
import type { ExecutionDb } from "./repository.ts";
import { DURABILITY_BOUNDS, type ExecutionLease, type LeaseTargetType } from "./types.ts";

const TABLE = "execution_leases";

// ── Lease Manager ──────────────────────────────────────────────────────────

export class LeaseManager {
  private readonly instanceId: string = `xr_${randomUUID().slice(0, 10)}`;
  private readonly pid: number;

  constructor(private readonly db: ExecutionDb) {
    this.pid = getPid();
  }

  /** The unique ID for this XR process instance. */
  get instanceIdentity(): string {
    return this.instanceId;
  }

  /** Idempotent schema migration. */
  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${TABLE} (
        lease_id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        owner_instance_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER,
        released_at INTEGER,
        release_reason TEXT,
        stale INTEGER NOT NULL DEFAULT 0,
        UNIQUE(target_type, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lease_target ON ${TABLE}(target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_lease_workspace ON ${TABLE}(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_lease_stale ON ${TABLE}(stale, acquired_at);
    `);
  }

  /**
   * Acquire a lease for the given target. Returns the lease if acquired,
   * null if another process holds a valid lease, or throws on persistence error.
   *
   * If a stale lease exists (owner process is dead), it will be taken over
   * automatically when `allowTakeover` is true.
   */
  acquire(
    targetType: LeaseTargetType,
    targetId: string,
    workspaceId: string,
    opts: { allowTakeover?: boolean; ttlMs?: number } = {},
  ): ExecutionLease | null {
    const now = Date.now();
    const leaseId = `lse_${randomUUID().slice(0, 10)}`;

    // Check for existing lease
    const existing = this.getLease(targetType, targetId);
    if (existing) {
      if (existing.releasedAt) {
        // Already released — delete the old row so we can insert a fresh one
        try {
          this.db.prepare(`DELETE FROM ${TABLE} WHERE target_type = ? AND target_id = ?`).run(targetType, targetId);
        } catch {
          // best-effort
        }
      } else if (isProcessDead(existing.ownerPid)) {
        // Stale lease — takeover if allowed
        if (opts.allowTakeover !== false) {
          /**
           * Phase 06 fix — mark stale AND remove the dead owner's row before
           * the fresh INSERT. Previously the row was only marked stale, so the
           * UNIQUE(target_type,target_id) constraint rejected the takeover
           * INSERT and work abandoned by a crashed process could never be
           * re-acquired. Marking preserves forensics in the audit trail of the
           * caller; the row itself is dead weight.
           */
          this.markStale(existing.leaseId);
          try {
            this.db.prepare(`DELETE FROM ${TABLE} WHERE lease_id = ?`).run(existing.leaseId);
          } catch {
            // best-effort; the INSERT below will surface any hard failure
          }
          // Fall through to acquire
        } else {
          return null;
        }
      } else if (existing.ownerInstanceId === this.instanceId) {
        // Already held by us — renew it
        return this.renew(existing);
      } else {
        // Held by another live process
        return null;
      }
    }

    const lease: ExecutionLease = {
      leaseId,
      targetType,
      targetId,
      workspaceId,
      ownerPid: this.pid,
      ownerInstanceId: this.instanceId,
      acquiredAt: now,
      expiresAt: opts.ttlMs ? now + opts.ttlMs : now + DURABILITY_BOUNDS.LEASE_TTL_MS,
      stale: false,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO ${TABLE} (lease_id, target_type, target_id, workspace_id,
            owner_pid, owner_instance_id, acquired_at, expires_at, stale)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          lease.leaseId,
          lease.targetType,
          lease.targetId,
          lease.workspaceId,
          lease.ownerPid,
          lease.ownerInstanceId,
          lease.acquiredAt,
          lease.expiresAt ?? null,
        );
      return lease;
    } catch {
      // Race condition — another process acquired it first
      return null;
    }
  }

  /** Release a lease voluntarily. */
  release(targetType: LeaseTargetType, targetId: string, reason = "completed"): boolean {
    const now = Date.now();
    try {
      const result = this.db
        .prepare(
          `UPDATE ${TABLE} SET released_at = ?, release_reason = ? WHERE target_type = ? AND target_id = ? AND released_at IS NULL`,
        )
        .run(now, reason, targetType, targetId);
      return true;
    } catch {
      return false;
    }
  }

  /** Check if this process holds the lease for a target. */
  holdsLease(targetType: LeaseTargetType, targetId: string): boolean {
    const lease = this.getLease(targetType, targetId);
    if (!lease) return false;
    if (lease.releasedAt) return false;
    if (lease.stale) return false;
    return lease.ownerInstanceId === this.instanceId && lease.ownerPid === this.pid;
  }

  /** Get the current lease for a target, if any. */
  getLease(targetType: LeaseTargetType, targetId: string): ExecutionLease | null {
    try {
      const row = this.db
        .prepare(`SELECT * FROM ${TABLE} WHERE target_type = ? AND target_id = ?`)
        .get<LeaseRow>(targetType, targetId);
      return row ? rowToLease(row) : null;
    } catch {
      return null;
    }
  }

  /** Get all active leases for a workspace. */
  getWorkspaceLeases(workspaceId: string): ExecutionLease[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM ${TABLE} WHERE workspace_id = ? AND released_at IS NULL ORDER BY acquired_at DESC LIMIT 200`,
        )
        .all<LeaseRow>(workspaceId);
      return rows.map(rowToLease);
    } catch {
      return [];
    }
  }

  /** Clean up stale/released leases older than the cutoff. */
  cleanup(cutoffMs?: number): number {
    const cutoff = cutoffMs ?? (Date.now() - DURABILITY_BOUNDS.LEASE_TTL_MS * 2);
    try {
      this.db
        .prepare(
          `DELETE FROM ${TABLE} WHERE (stale = 1 AND acquired_at < ?) OR (released_at IS NOT NULL AND released_at < ?)`,
        )
        .run(cutoff, cutoff);
      return 0;
    } catch {
      return 0;
    }
  }

  /** Mark a lease as stale (owner process is dead). */
  private markStale(leaseId: string): void {
    try {
      this.db.prepare(`UPDATE ${TABLE} SET stale = 1 WHERE lease_id = ?`).run(leaseId);
    } catch {
      // best-effort
    }
  }

  /** Release by lease ID (used during takeover). */
  private releaseById(leaseId: string, targetType: string, targetId: string, reason: string, now: number): void {
    try {
      this.db
        .prepare(`UPDATE ${TABLE} SET released_at = ?, release_reason = ? WHERE lease_id = ? AND target_type = ? AND target_id = ?`)
        .run(now, reason, leaseId, targetType, targetId);
    } catch {
      // best-effort
    }
  }

  /** Renew an existing lease held by this process. */
  private renew(existing: ExecutionLease): ExecutionLease {
    const now = Date.now();
    const newExpiry = now + DURABILITY_BOUNDS.LEASE_TTL_MS;
    try {
      this.db
        .prepare(`UPDATE ${TABLE} SET expires_at = ?, stale = 0 WHERE lease_id = ?`)
        .run(newExpiry, existing.leaseId);
    } catch {
      // best-effort
    }
    return { ...existing, expiresAt: newExpiry };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getPid(): number {
  try {
    return process.pid;
  } catch {
    return -1;
  }
}

/**
 * Check if a process with the given PID is still alive.
 * Platform-aware: uses `kill(pid, 0)` on POSIX, tasklist on Windows.
 */
function isProcessDead(pid: number): boolean {
  if (pid <= 0) return true;
  try {
    // process.kill(pid, 0) sends signal 0 which doesn't actually kill the
    // process but throws if the process doesn't exist (ESRCH on POSIX).
    process.kill(pid, 0);
    return false;
  } catch (err: any) {
    if (err?.code === 'ESRCH' || err?.code === 'EPERM') {
      // ESRCH: no such process — definitely dead.
      // EPERM: process exists but we don't own it — treat as alive.
      return err.code === 'ESRCH';
    }
    return true;
  }
}

// ── Internal row type ─────────────────────────────────────────────────────

interface LeaseRow {
  lease_id: string;
  target_type: string;
  target_id: string;
  workspace_id: string;
  owner_pid: number;
  owner_instance_id: string;
  acquired_at: number;
  expires_at: number | null;
  released_at: number | null;
  release_reason: string | null;
  stale: number;
}

function rowToLease(row: LeaseRow): ExecutionLease {
  return {
    leaseId: row.lease_id,
    targetType: row.target_type as ExecutionLease["targetType"],
    targetId: row.target_id,
    workspaceId: row.workspace_id,
    ownerPid: row.owner_pid,
    ownerInstanceId: row.owner_instance_id,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at ?? undefined,
    releasedAt: row.released_at ?? undefined,
    releaseReason: row.release_reason ?? undefined,
    stale: row.stale === 1,
  };
}
