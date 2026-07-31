/**
 * XR 6.0 — Control Plane Service
 *
 * Manages the control plane: identity verification, scheduling/placement
 * decisions, policy propagation, workflow metadata, and status aggregation.
 *
 * The control plane does NOT receive sensitive payloads automatically.
 * It operates on summaries, references, and metadata.
 */

import type {
  ControlPlaneConfig,
  PlaneIdentity,
  WorkerIdentity,
  DeploymentProfileKind,
  DeploymentStatus,
  DeploymentHealthSummary,
  DeploymentIssue,
  TaskCapsule,
} from "../types.ts";
import { WorkerRegistry } from "../workers/registry.ts";
import { PlacementEngine } from "../placement/engine.ts";
import { ResidencyPolicyEngine } from "../residency/policy.ts";
import { OfflineService } from "../offline/service.ts";
import { SyncEngine } from "../sync/engine.ts";
import type { SyncVersionedEntity } from "../sync/engine.ts";
import { redactCapsuleForControlPlane } from "../capsule.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Control Plane Service
// ═══════════════════════════════════════════════════════════════════════════

export interface ControlPlaneServiceDeps {
  config: ControlPlaneConfig;
  profile: DeploymentProfileKind;
  workerRegistry: WorkerRegistry;
  placementEngine: PlacementEngine;
  residencyEngine: ResidencyPolicyEngine;
  offlineService: OfflineService;
  syncEngine?: SyncEngine;
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class ControlPlaneService {
  private readonly deps: ControlPlaneServiceDeps;
  private readonly planeIdentity: PlaneIdentity;
  private started = false;

  constructor(deps: ControlPlaneServiceDeps) {
    this.deps = deps;
    this.planeIdentity = {
      planeId: `cp_${deps.profile}`,
      kind: "control",
      profile: deps.profile,
      endpoint: deps.config.endpoint,
      trustLevel: deps.config.trustLevel,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!this.deps.config.enabled) return;
    if (this.started) return;

    this.started = true;
    this.deps.audit?.("control_plane.started", {
      profile: this.deps.profile,
      trustLevel: this.deps.config.trustLevel,
    });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    // Drain all workers
    for (const worker of this.deps.workerRegistry.getActiveWorkers()) {
      try {
        this.deps.workerRegistry.drain(worker.workerId, "Control plane shutting down");
      } catch {
        // Best-effort drain
      }
    }

    this.deps.audit?.("control_plane.stopped", { profile: this.deps.profile });
  }

  // ── Placement ────────────────────────────────────────────────────────

  /**
   * Make a placement decision for a task capsule.
   */
  async placeTask(capsule: TaskCapsule) {
    const availableWorkers = this.deps.workerRegistry.getAvailableWorkers();
    const workerHealth = availableWorkers.map(w => {
      const health = this.deps.workerRegistry.getWorkerHealth(w.workerId);
      return health ?? { ok: false, checks: [], uptimeMs: 0 };
    });

    return this.deps.placementEngine.decide({
      capsule,
      currentProfile: this.deps.profile,
      availableWorkers,
      currentWorkerHealth: workerHealth,
    });
  }

  // ── Worker Management ────────────────────────────────────────────────

  async registerWorker(registration: Parameters<WorkerRegistry["register"]>[0]) {
    return this.deps.workerRegistry.register(registration);
  }

  async admitWorker(workerId: string) {
    return this.deps.workerRegistry.admit(workerId);
  }

  async drainWorker(workerId: string, reason: string) {
    return this.deps.workerRegistry.drain(workerId, reason);
  }

  async revokeWorker(workerId: string, reason: string) {
    return this.deps.workerRegistry.revoke(workerId, reason);
  }

  getWorkerStatus() {
    return this.deps.workerRegistry.getAllWorkers();
  }

  // ── Status ───────────────────────────────────────────────────────────

  /**
   * Build a comprehensive deployment status for CLI/daemon/dashboard.
   */
  getDeploymentStatus(): DeploymentStatus {
    const workers = this.deps.workerRegistry.getAllWorkers();
    const syncStatus = this.deps.syncEngine?.getStatus() ?? {
      state: "idle" as const,
      pendingOps: 0,
      conflicts: 0,
      consecutiveErrors: 0,
      trackedEntities: 0,
    };
    const offlineStatus = this.deps.offlineService.getStatus();

    const issues: DeploymentIssue[] = [];

    // Check worker health
    for (const worker of workers) {
      if (worker.state === "offline") {
        issues.push({
          severity: "warning",
          component: "worker",
          message: `Worker ${worker.workerId} is offline`,
          since: worker.lastSeenAt,
        });
      }
      if (worker.state === "quarantined") {
        issues.push({
          severity: "error",
          component: "worker",
          message: `Worker ${worker.workerId} is quarantined`,
          since: worker.lastSeenAt,
        });
      }
    }

    // Check sync health
    if (syncStatus.consecutiveErrors > 0) {
      issues.push({
        severity: "warning",
        component: "sync",
        message: `Sync has ${syncStatus.consecutiveErrors} consecutive errors`,
        since: Date.now(),
      });
    }
    if (syncStatus.conflicts > 0) {
      issues.push({
        severity: "warning",
        component: "sync",
        message: `${syncStatus.conflicts} sync conflicts need resolution`,
        since: Date.now(),
      });
    }

    // Check offline status
    if (offlineStatus.isOffline) {
      issues.push({
        severity: "info",
        component: "connectivity",
        message: "Operating in offline mode",
        since: offlineStatus.offlineSince ?? Date.now(),
      });
    }

    // Determine overall health
    let overall: DeploymentHealthSummary["overall"] = "healthy";
    if (issues.some(i => i.severity === "critical")) overall = "critical";
    else if (issues.some(i => i.severity === "error")) overall = "degraded";
    else if (offlineStatus.isOffline) overall = "offline";

    return {
      profile: this.deps.profile,
      profileName: this.deps.profile,
      version: "6.0.0",
      localPlane: {
        planeId: "local",
        kind: "local",
        reachable: true,
        lastHeartbeatAt: Date.now(),
      },
      controlPlane: this.deps.config.enabled ? {
        planeId: this.planeIdentity.planeId,
        kind: "control",
        reachable: this.started,
        lastHeartbeatAt: Date.now(),
      } : undefined,
      dataPlanes: [],
      workers: workers.map(w => ({
        workerId: w.workerId,
        state: w.state,
        activeTasks: 0,
        lastHeartbeatAt: w.lastSeenAt,
        healthOk: this.deps.workerRegistry.getWorkerHealth(w.workerId)?.ok ?? false,
      })),
      sync: {
        state: syncStatus.state,
        pendingOps: syncStatus.pendingOps,
        conflicts: syncStatus.conflicts,
        errors: syncStatus.consecutiveErrors,
      },
      residency: {
        policyVersion: this.deps.residencyEngine.getPolicyVersion(),
        entitiesInViolation: 0,
        lastCheckAt: Date.now(),
      },
      offline: {
        isOffline: offlineStatus.isOffline,
        offlineSince: offlineStatus.offlineSince,
        queuedTasks: offlineStatus.queuedTasks,
        availableLocalTasks: offlineStatus.availableLocalTasks,
        blockedRemoteTasks: offlineStatus.blockedRemoteTasks,
      },
      health: {
        overall,
        issues,
      },
    };
  }

  /**
   * Get a redacted view of a capsule for control plane visibility.
   */
  getRedactedCapsuleView(capsule: TaskCapsule): Record<string, unknown> {
    if (!this.deps.config.summaryOnly) {
      // Full view allowed (private deployments)
      return capsule as unknown as Record<string, unknown>;
    }
    return redactCapsuleForControlPlane(capsule);
  }
}
