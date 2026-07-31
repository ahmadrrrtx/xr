/**
 * XR 6.0 — Worker Registry
 *
 * Manages secure worker registration, identity, attestation, health tracking,
 * admission, revocation, and drain operations.
 *
 * Workers are registered through an authenticated process with attestation.
 * They must maintain heartbeats to remain active. The registry tracks
 * worker state and enforces lifecycle rules.
 *
 * Uses existing execution/trust/durable contracts — does NOT create
 * worker-specific semantics.
 */

import { randomUUID } from "node:crypto";
import type {
  WorkerIdentity,
  WorkerRegistration,
  WorkerHeartbeat,
  WorkerState,
  WorkerAttestation,
  WorkerHealthReport,
  DeploymentProfileKind,
} from "../types.ts";
import { DEPLOYMENT_BOUNDS } from "../types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Worker Registry
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkerRegistryDeps {
  /** Maximum workers per profile. */
  maxWorkersPerProfile?: number;
  /** Attestation validity check. */
  attestationVerifier?: (attestation: WorkerAttestation) => Promise<boolean>;
  /** Audit callback. */
  audit?: (event: string, detail: Record<string, unknown>) => void;
}

export class WorkerRegistry {
  private readonly workers = new Map<string, WorkerIdentity>();
  private readonly heartbeats = new Map<string, WorkerHeartbeat>();
  private readonly deps: WorkerRegistryDeps;
  private readonly maxWorkers: number;

  constructor(deps: WorkerRegistryDeps = {}) {
    this.deps = deps;
    this.maxWorkers = deps.maxWorkersPerProfile ?? DEPLOYMENT_BOUNDS.MAX_WORKERS_PER_PROFILE;
  }

  // ── Registration ─────────────────────────────────────────────────────

  /**
   * Register a new worker. Returns the worker identity.
   * Validates attestation and uniqueness.
   */
  async register(registration: WorkerRegistration): Promise<WorkerIdentity> {
    // Check capacity
    const profileWorkers = this.getWorkersByProfile(registration.profile);
    if (profileWorkers.length >= this.maxWorkers) {
      throw new WorkerRegistrationError(
        `Maximum workers (${this.maxWorkers}) reached for profile ${registration.profile}`
      );
    }

    // Verify attestation
    if (this.deps.attestationVerifier) {
      const verified = await this.deps.attestationVerifier(registration.attestation);
      if (!verified) {
        throw new WorkerRegistrationError("Worker attestation verification failed");
      }
    } else {
      // Without a verifier, only accept self-signed for private deployments
      if (registration.attestation.method !== "self_signed" &&
          registration.profile !== "personal_local") {
        throw new WorkerRegistrationError(
          "No attestation verifier configured; only self-signed attestation accepted"
        );
      }
    }

    // Check for duplicate worker ID
    if (this.workers.has(registration.workerId)) {
      throw new WorkerRegistrationError(
        `Worker ${registration.workerId} already registered`
      );
    }

    // Check attestation expiry
    if (registration.attestation.expiresAt < Date.now()) {
      throw new WorkerRegistrationError("Worker attestation has expired");
    }

    const identity: WorkerIdentity = {
      workerId: registration.workerId,
      instanceId: `inst_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      profile: registration.profile,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
      state: "attesting",
      capabilities: registration.capabilities,
      hardwareProfile: registration.hardware,
      networkEndpoint: registration.endpoint,
      attestation: registration.attestation,
    };

    this.workers.set(identity.workerId, identity);

    this.deps.audit?.("worker.registered", {
      workerId: identity.workerId,
      profile: identity.profile,
      capabilities: identity.capabilities.length,
      attestationMethod: identity.attestation?.method,
    });

    return identity;
  }

  // ── Attestation / Admission ──────────────────────────────────────────

  /**
   * Admit a registered worker to active state after successful attestation.
   */
  admit(workerId: string): WorkerIdentity {
    const worker = this.getWorker(workerId);
    if (worker.state !== "attesting" && worker.state !== "registering") {
      throw new WorkerLifecycleError(
        `Worker ${workerId} cannot be admitted from state ${worker.state}`
      );
    }

    // Verify attestation is still valid
    if (worker.attestation && !worker.attestation.verified) {
      throw new WorkerLifecycleError(`Worker ${workerId} attestation not verified`);
    }

    const updated: WorkerIdentity = { ...worker, state: "active" };
    this.workers.set(workerId, updated);

    this.deps.audit?.("worker.admitted", { workerId, profile: worker.profile });
    return updated;
  }

  // ── Heartbeat ────────────────────────────────────────────────────────

  /**
   * Process a heartbeat from a worker. Updates last-seen time and health.
   */
  heartbeat(hb: WorkerHeartbeat): WorkerIdentity {
    const worker = this.getWorker(hb.workerId);

    // Instance ID must match
    if (worker.instanceId !== hb.instanceId) {
      throw new WorkerLifecycleError(
        `Worker ${hb.workerId} instance mismatch: expected ${worker.instanceId}, got ${hb.instanceId}`
      );
    }

    // State must be active or draining
    if (worker.state !== "active" && worker.state !== "draining") {
      throw new WorkerLifecycleError(
        `Worker ${hb.workerId} cannot heartbeat from state ${worker.state}`
      );
    }

    const updated: WorkerIdentity = {
      ...worker,
      lastSeenAt: hb.at,
      state: hb.state === "active" ? "active" : worker.state,
    };
    this.workers.set(hb.workerId, updated);
    this.heartbeats.set(hb.workerId, hb);

    return updated;
  }

  // ── Health Check ─────────────────────────────────────────────────────

  /**
   * Check for stale workers (no heartbeat within timeout).
   */
  detectStaleWorkers(): WorkerIdentity[] {
    const now = Date.now();
    const stale: WorkerIdentity[] = [];

    for (const [id, worker] of this.workers) {
      if (worker.state === "active" || worker.state === "draining") {
        const elapsed = now - worker.lastSeenAt;
        if (elapsed > DEPLOYMENT_BOUNDS.WORKER_TIMEOUT_MS) {
          const updated: WorkerIdentity = { ...worker, state: "offline" };
          this.workers.set(id, updated);
          stale.push(updated);

          this.deps.audit?.("worker.stale", {
            workerId: id,
            lastSeenAt: worker.lastSeenAt,
            elapsedMs: elapsed,
          });
        }
      }
    }

    return stale;
  }

  /**
   * Get the health report for a worker.
   */
  getWorkerHealth(workerId: string): WorkerHealthReport | undefined {
    return this.heartbeats.get(workerId)?.health;
  }

  // ── Lifecycle Operations ─────────────────────────────────────────────

  /**
   * Begin draining a worker (stop accepting new tasks).
   */
  drain(workerId: string, reason: string): WorkerIdentity {
    const worker = this.getWorker(workerId);
    if (worker.state !== "active") {
      throw new WorkerLifecycleError(
        `Worker ${workerId} cannot be drained from state ${worker.state}`
      );
    }

    const updated: WorkerIdentity = { ...worker, state: "draining" };
    this.workers.set(workerId, updated);

    this.deps.audit?.("worker.drain_started", { workerId, reason });
    return updated;
  }

  /**
   * Mark a worker as fully drained (no active tasks).
   */
  markDrained(workerId: string): WorkerIdentity {
    const worker = this.getWorker(workerId);
    if (worker.state !== "draining") {
      throw new WorkerLifecycleError(
        `Worker ${workerId} cannot be marked drained from state ${worker.state}`
      );
    }

    const updated: WorkerIdentity = { ...worker, state: "drained" };
    this.workers.set(workerId, updated);

    this.deps.audit?.("worker.drain_completed", { workerId });
    return updated;
  }

  /**
   * Revoke a worker (permanently deny access).
   */
  revoke(workerId: string, reason: string): WorkerIdentity {
    const worker = this.getWorker(workerId);
    if (worker.state === "revoked") {
      return worker; // Already revoked
    }

    const updated: WorkerIdentity = {
      ...worker,
      state: "revoked",
      revokedAt: Date.now(),
      revokeReason: reason,
    };
    this.workers.set(workerId, updated);
    this.heartbeats.delete(workerId);

    this.deps.audit?.("worker.revoked", { workerId, reason });
    return updated;
  }

  /**
   * Quarantine a worker (suspicious behavior detected).
   */
  quarantine(workerId: string, reason: string): WorkerIdentity {
    const worker = this.getWorker(workerId);
    const updated: WorkerIdentity = { ...worker, state: "quarantined" };
    this.workers.set(workerId, updated);

    this.deps.audit?.("worker.quarantined", { workerId, reason });
    return updated;
  }

  // ── Queries ──────────────────────────────────────────────────────────

  getWorker(workerId: string): WorkerIdentity {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new WorkerNotFoundError(`Worker ${workerId} not found`);
    }
    return worker;
  }

  getActiveWorkers(): WorkerIdentity[] {
    return Array.from(this.workers.values()).filter(w => w.state === "active");
  }

  getWorkersByProfile(profile: DeploymentProfileKind): WorkerIdentity[] {
    return Array.from(this.workers.values()).filter(w => w.profile === profile);
  }

  getWorkersByState(state: WorkerState): WorkerIdentity[] {
    return Array.from(this.workers.values()).filter(w => w.state === state);
  }

  getAllWorkers(): WorkerIdentity[] {
    return Array.from(this.workers.values());
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Get all workers suitable for task placement (active + not quarantined).
   */
  getAvailableWorkers(): WorkerIdentity[] {
    return Array.from(this.workers.values()).filter(
      w => w.state === "active" && !w.revokedAt
    );
  }

  /**
   * Clean up expired/drained workers. Returns the number removed.
   */
  cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;

    for (const [id, worker] of this.workers) {
      if (
        (worker.state === "drained" || worker.state === "revoked") &&
        worker.lastSeenAt < cutoff
      ) {
        this.workers.delete(id);
        this.heartbeats.delete(id);
        removed++;
      }
    }

    return removed;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Errors
// ═══════════════════════════════════════════════════════════════════════════

export class WorkerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerNotFoundError";
  }
}

export class WorkerRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerRegistrationError";
  }
}

export class WorkerLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerLifecycleError";
  }
}
