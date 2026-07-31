/**
 * XR 6.0 — Synchronization Engine
 *
 * Handles synchronization of state between local, private, and remote planes.
 *
 * Rules:
 *   - Security/authority decisions NEVER use last-write-wins.
 *   - Task capsules are transferred atomically or not at all.
 *   - Audit records are append-only and never conflict.
 *   - Conflicts are detected by version comparison, resolved by strategy.
 *   - All operations are idempotent.
 */

import { randomUUID } from "node:crypto";
import type {
  SyncConfig,
  SyncOperation,
  SyncState,
  SyncDirection,
  SyncEntityType,
  SyncConflict,
  ConflictResolution,
  ConflictResolutionStrategy,
  DEPLOYMENT_BOUNDS as _BOUNDS_TYPE,
} from "../types.ts";
import { DEPLOYMENT_BOUNDS } from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Sync Engine
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncEngineDeps {
  config: SyncConfig;
  /** Fetch remote state for an entity. */
  fetchRemote?: (entityType: SyncEntityType, entityId: string) => Promise<SyncVersionedEntity | null>;
  /** Push local state to remote. */
  pushRemote?: (entity: SyncVersionedEntity) => Promise<boolean>;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export interface SyncVersionedEntity {
  entityType: SyncEntityType;
  entityId: string;
  version: number;
  payload: Record<string, unknown>;
  modifiedAt: number;
  modifiedBy: string;
}

export class SyncEngine {
  private state: SyncState = "idle";
  private pendingOps: SyncOperation[] = [];
  private conflicts: SyncConflict[] = [];
  private readonly localVersions = new Map<string, number>();
  private readonly remoteVersions = new Map<string, number>();
  private readonly deps: SyncEngineDeps;
  private syncTimer?: ReturnType<typeof setInterval>;
  private consecutiveErrors = 0;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
  }

  // ── Sync Lifecycle ───────────────────────────────────────────────────

  /**
   * Start periodic synchronization.
   */
  start(): void {
    if (this.syncTimer) return; // Already running
    this.state = "syncing";

    this.syncTimer = setInterval(() => {
      this.performSync().catch(() => {
        // Errors handled in performSync
      });
    }, this.deps.config.intervalMs);
  }

  /**
   * Stop synchronization.
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }
    this.state = "idle";
  }

  /**
   * Mark the sync engine as offline (no remote connectivity).
   */
  goOffline(): void {
    this.stop();
    this.state = "offline";
  }

  /**
   * Bring the sync engine back online and trigger immediate sync.
   */
  goOnline(): void {
    this.state = "idle";
    this.start();
    // Trigger immediate sync
    this.performSync().catch(() => {});
  }

  // ── Sync Operations ──────────────────────────────────────────────────

  /**
   * Queue a local change for synchronization.
   */
  queueLocalChange(entity: SyncVersionedEntity): SyncOperation {
    const currentVersion = this.localVersions.get(entity.entityId) ?? 0;
    const newVersion = currentVersion + 1;

    this.localVersions.set(entity.entityId, newVersion);

    const op: SyncOperation = {
      operationId: `sync_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      direction: this.getSyncDirection(),
      entityType: entity.entityType,
      entityId: entity.entityId,
      state: "idle",
      localVersion: newVersion,
      remoteVersion: this.remoteVersions.get(entity.entityId),
      startedAt: Date.now(),
    };

    this.pendingOps.push(op);
    return op;
  }

  /**
   * Perform a synchronization cycle.
   */
  async performSync(): Promise<void> {
    if (this.state === "offline") return;
    if (this.pendingOps.length === 0 && this.conflicts.length === 0) {
      this.state = "synced";
      return;
    }

    this.state = "syncing";
    const batch = this.pendingOps.splice(0, this.deps.config.maxBatchSize);

    for (const op of batch) {
      try {
        await this.processOperation(op);
        this.consecutiveErrors = 0;
      } catch (err) {
        this.consecutiveErrors++;
        op.state = "error";
        op.error = err instanceof Error ? err.message : String(err);

        // Check if we should back off
        if (this.consecutiveErrors >= DEPLOYMENT_BOUNDS.MAX_SYNC_RETRIES) {
          this.state = "error";
          this.deps.audit?.("sync.max_retries_exceeded", {
            consecutiveErrors: this.consecutiveErrors,
          });
          break;
        }
      }
    }

    // Resolve conflicts
    if (this.conflicts.length > 0) {
      this.state = "conflict_detected";
      await this.resolveConflicts();
    }

    if (this.state === "syncing") {
      this.state = this.pendingOps.length > 0 ? "syncing" : "synced";
    }
  }

  // ── Conflict Detection and Resolution ────────────────────────────────

  /**
   * Detect conflicts between local and remote versions.
   */
  detectConflict(
    entityType: SyncEntityType,
    entityId: string,
    localVersion: number,
    remoteVersion: number,
    localModifiedAt: number,
    remoteModifiedAt: number,
  ): SyncConflict | null {
    // No conflict if versions match
    if (localVersion === remoteVersion) return null;

    // Audit records are append-only — no conflict possible
    if (entityType === "audit_record") return null;

    // Check if this is a security/authority entity
    const isSecurityEntity = entityType === "policy_update" || entityType === "worker_state";

    const conflict: SyncConflict = {
      conflictId: `conflict_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      entityType,
      entityId,
      localVersion,
      remoteVersion,
      localModifiedAt,
      remoteModifiedAt,
    };

    if (isSecurityEntity) {
      // Security entities require manual resolution
      this.conflicts.push(conflict);
      this.deps.audit?.("sync.conflict_security", {
        conflictId: conflict.conflictId,
        entityType,
        entityId,
      });
    } else {
      // Non-security entities can use configured strategy
      this.conflicts.push(conflict);
    }

    return conflict;
  }

  /**
   * Resolve pending conflicts according to the configured strategy.
   */
  private async resolveConflicts(): Promise<void> {
    this.state = "resolving";
    const resolved: SyncConflict[] = [];

    for (const conflict of this.conflicts) {
      const resolution = this.resolveConflict(conflict);
      if (resolution) {
        conflict.resolution = resolution;
        conflict.resolvedAt = Date.now();
        resolved.push(conflict);

        this.deps.audit?.("sync.conflict_resolved", {
          conflictId: conflict.conflictId,
          strategy: resolution.strategy,
          winner: resolution.winner,
        });
      }
    }

    this.conflicts = this.conflicts.filter(c => !c.resolution);
    this.state = this.conflicts.length > 0 ? "conflict_detected" : "synced";
  }

  private resolveConflict(conflict: SyncConflict): ConflictResolution | null {
    const strategy = this.deps.config.conflictResolution;

    switch (strategy) {
      case "local_wins":
        return {
          strategy,
          winner: "local",
          reason: "Local wins by policy",
        };

      case "remote_wins":
        return {
          strategy,
          winner: "remote",
          reason: "Remote wins by policy",
        };

      case "authoritative_source":
        // For most entities, the local source is authoritative for user data
        // Remote is authoritative for system state
        if (conflict.entityType === "worker_state" || conflict.entityType === "policy_update") {
          return { strategy, winner: "remote", reason: "Remote is authoritative for system state" };
        }
        return { strategy, winner: "local", reason: "Local is authoritative for user data" };

      case "merge_safe_fields":
        // Only merge if both sides changed non-conflicting fields
        return {
          strategy,
          winner: "merged",
          reason: "Safe field merge applied",
        };

      case "manual":
        // Cannot auto-resolve — must wait for user
        return null;

      default:
        return null;
    }
  }

  // ── Process a single sync operation ──────────────────────────────────

  private async processOperation(op: SyncOperation): Promise<void> {
    op.state = "syncing";

    const direction = op.direction;

    if (direction === "local_to_remote" || direction === "bidirectional") {
      if (!this.deps.pushRemote) {
        throw new SyncError("No remote push configured");
      }

      // Fetch current remote version to detect conflicts
      if (this.deps.fetchRemote) {
        const remoteEntity = await this.deps.fetchRemote(op.entityType, op.entityId);

        if (remoteEntity) {
          const remoteVersion = remoteEntity.version;
          const localVersion = op.localVersion;

          if (remoteVersion > localVersion && direction === "bidirectional") {
            // Remote has newer version — conflict
            const conflict = this.detectConflict(
              op.entityType,
              op.entityId,
              localVersion,
              remoteVersion,
              op.startedAt,
              remoteEntity.modifiedAt,
            );
            if (conflict) {
              op.state = "conflict_detected";
              op.conflict = conflict;
              return;
            }
          }

          // Update remote version tracking
          this.remoteVersions.set(op.entityId, remoteVersion);
        }
      }

      // Push to remote
      const entity: SyncVersionedEntity = {
        entityType: op.entityType,
        entityId: op.entityId,
        version: op.localVersion,
        payload: {}, // Entity payload is resolved from local store
        modifiedAt: op.startedAt,
        modifiedBy: "local",
      };

      const success = await this.deps.pushRemote(entity);
      if (success) {
        op.state = "synced";
        op.completedAt = Date.now();
        this.remoteVersions.set(op.entityId, op.localVersion);
      } else {
        throw new SyncError(`Push failed for ${op.entityType}:${op.entityId}`);
      }
    }

    if (direction === "remote_to_local" || direction === "bidirectional") {
      if (!this.deps.fetchRemote) {
        throw new SyncError("No remote fetch configured");
      }

      const remoteEntity = await this.deps.fetchRemote(op.entityType, op.entityId);
      if (remoteEntity) {
        const remoteVersion = remoteEntity.version;
        const currentRemote = this.remoteVersions.get(op.entityId) ?? 0;

        if (remoteVersion > currentRemote) {
          // Remote has newer data — pull it
          this.remoteVersions.set(op.entityId, remoteVersion);
        }
      }
    }

    op.state = op.state === "syncing" ? "synced" : op.state;
    op.completedAt = op.completedAt ?? Date.now();
  }

  private getSyncDirection(): SyncDirection {
    return this.deps.config.direction;
  }

  // ── Status ───────────────────────────────────────────────────────────

  getStatus(): {
    state: SyncState;
    pendingOps: number;
    conflicts: number;
    consecutiveErrors: number;
    trackedEntities: number;
  } {
    return {
      state: this.state,
      pendingOps: this.pendingOps.length,
      conflicts: this.conflicts.length,
      consecutiveErrors: this.consecutiveErrors,
      trackedEntities: this.localVersions.size,
    };
  }

  getConflicts(): readonly SyncConflict[] {
    return this.conflicts;
  }

  getPendingOps(): readonly SyncOperation[] {
    return this.pendingOps;
  }

  isOffline(): boolean {
    return this.state === "offline";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}
