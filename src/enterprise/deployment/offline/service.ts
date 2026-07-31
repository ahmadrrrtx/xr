/**
 * XR 6.0 — Offline Mode Service
 *
 * Ensures local-only XR continues to operate when disconnected:
 *   - Run eligible local tasks
 *   - Inspect local state
 *   - Preserve checkpoints/audit
 *   - Queue permitted work for later sync
 *   - Clearly mark unavailable remote work
 *   - Resynchronize safely when connectivity returns
 */

import type {
  SyncState,
  TaskCapsule,
  DeploymentProfileKind,
} from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Offline Mode Service
// ═══════════════════════════════════════════════════════════════════════════

export interface OfflineServiceDeps {
  /** Check if the runtime is currently connected. */
  isConnected: () => boolean;
  /** Callback when connectivity is lost. */
  onDisconnect?: () => void;
  /** Callback when connectivity is restored. */
  onReconnect?: () => void;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export interface OfflineQueuedTask {
  readonly taskId: string;
  readonly capsuleId: string;
  readonly queuedAt: number;
  readonly priority: "low" | "normal" | "high" | "critical";
  readonly reason: string;
  readonly eligibleWhenOnline: boolean;
  readonly canRunLocally: boolean;
}

export interface OfflineStatus {
  readonly isOffline: boolean;
  readonly offlineSince?: number;
  readonly durationMs: number;
  readonly queuedTasks: number;
  readonly availableLocalTasks: number;
  readonly blockedRemoteTasks: number;
  readonly checkpointPreserved: boolean;
  readonly auditPreserved: boolean;
}

export class OfflineService {
  private offlineSince?: number;
  private readonly queuedTasks: OfflineQueuedTask[] = [];
  private readonly deps: OfflineServiceDeps;
  private connectivityCheckTimer?: ReturnType<typeof setInterval>;

  constructor(deps: OfflineServiceDeps) {
    this.deps = deps;
  }

  // ── Connectivity Monitoring ──────────────────────────────────────────

  /**
   * Start monitoring connectivity.
   */
  startMonitoring(intervalMs: number = 30_000): void {
    if (this.connectivityCheckTimer) return;

    this.connectivityCheckTimer = setInterval(() => {
      const connected = this.deps.isConnected();
      const wasOffline = this.offlineSince !== undefined;

      if (!connected && !wasOffline) {
        this.goOffline();
      } else if (connected && wasOffline) {
        this.goOnline();
      }
    }, intervalMs);
  }

  /**
   * Stop connectivity monitoring.
   */
  stopMonitoring(): void {
    if (this.connectivityCheckTimer) {
      clearInterval(this.connectivityCheckTimer);
      this.connectivityCheckTimer = undefined;
    }
  }

  /**
   * Transition to offline mode.
   */
  goOffline(): void {
    if (this.offlineSince !== undefined) return; // Already offline

    this.offlineSince = Date.now();
    this.deps.onDisconnect?.();
    this.deps.audit?.("offline.mode_entered", {
      at: this.offlineSince,
      queuedTasks: this.queuedTasks.length,
    });
  }

  /**
   * Transition back to online mode.
   */
  goOnline(): void {
    if (this.offlineSince === undefined) return; // Already online

    const durationMs = Date.now() - this.offlineSince;
    this.offlineSince = undefined;
    this.deps.onReconnect?.();
    this.deps.audit?.("offline.mode_exited", {
      durationMs,
      queuedTasks: this.queuedTasks.length,
    });
  }

  // ── Task Queuing ─────────────────────────────────────────────────────

  /**
   * Queue a task for execution when connectivity is restored.
   * The task is evaluated for local eligibility.
   */
  queueTask(capsule: TaskCapsule, reason: string): OfflineQueuedTask {
    const canRunLocally = this.isCapsuleEligibleLocal(capsule);

    const task: OfflineQueuedTask = {
      taskId: capsule.executionId.runId,
      capsuleId: capsule.capsuleId,
      queuedAt: Date.now(),
      priority: this.inferPriority(capsule),
      reason,
      eligibleWhenOnline: true,
      canRunLocally,
    };

    this.queuedTasks.push(task);

    this.deps.audit?.("offline.task_queued", {
      taskId: task.taskId,
      capsuleId: task.capsuleId,
      canRunLocally,
      priority: task.priority,
    });

    return task;
  }

  /**
   * Get all queued tasks that can run locally (even offline).
   */
  getLocallyEligibleTasks(): OfflineQueuedTask[] {
    return this.queuedTasks.filter(t => t.canRunLocally);
  }

  /**
   * Get all queued tasks that require online connectivity.
   */
  getRemoteOnlyTasks(): OfflineQueuedTask[] {
    return this.queuedTasks.filter(t => !t.canRunLocally);
  }

  /**
   * Get all queued tasks sorted by priority.
   */
  getQueuedTasksSorted(): OfflineQueuedTask[] {
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    return [...this.queuedTasks].sort(
      (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
    );
  }

  /**
   * Remove a task from the queue (e.g., after successful sync or cancellation).
   */
  dequeueTask(taskId: string): boolean {
    const idx = this.queuedTasks.findIndex(t => t.taskId === taskId);
    if (idx >= 0) {
      this.queuedTasks.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Clear all queued tasks (e.g., after full synchronization).
   */
  clearQueue(): number {
    const count = this.queuedTasks.length;
    this.queuedTasks.length = 0;
    return count;
  }

  // ── Status ───────────────────────────────────────────────────────────

  getStatus(): OfflineStatus {
    const isOffline = this.offlineSince !== undefined;
    const durationMs = isOffline ? Date.now() - this.offlineSince! : 0;

    return {
      isOffline,
      offlineSince: this.offlineSince,
      durationMs,
      queuedTasks: this.queuedTasks.length,
      availableLocalTasks: this.getLocallyEligibleTasks().length,
      blockedRemoteTasks: this.getRemoteOnlyTasks().length,
      checkpointPreserved: true, // Checkpoints are always local
      auditPreserved: true, // Audit is always local
    };
  }

  isOffline(): boolean {
    return this.offlineSince !== undefined;
  }

  // ── Eligibility ──────────────────────────────────────────────────────

  /**
   * Determine if a capsule can run locally (without remote connectivity).
   */
  private isCapsuleEligibleLocal(capsule: TaskCapsule): boolean {
    // Must allow local placement
    if (!capsule.placement.allowLocal) return false;

    // If it REQUIRES remote (no local allowed), it can't run locally
    if (!capsule.placement.allowLocal && capsule.placement.allowRemote) return false;

    // If data must not leave origin and origin is local, it's fine
    if (capsule.residency.mustNotLeaveOrigin) return true;

    // Check if any required capabilities need remote
    const remoteOnlyCaps = capsule.requirements.capabilities.filter(
      c => c.startsWith("remote:") || c.startsWith("cloud:")
    );
    if (remoteOnlyCaps.length > 0) return false;

    // Check GPU requirements — may need remote if not available locally
    // For now, assume local can handle all non-explicitly-remote requirements
    return true;
  }

  private inferPriority(capsule: TaskCapsule): OfflineQueuedTask["priority"] {
    // Business actions and approvals are high priority
    if (capsule.intent.mode === "business" || capsule.intent.mode === "control") {
      return "high";
    }
    // Agent tasks are normal
    if (capsule.intent.mode === "agent") {
      return "normal";
    }
    // Research/plan are lower
    if (capsule.intent.mode === "research" || capsule.intent.mode === "plan") {
      return "low";
    }
    return "normal";
  }
}
