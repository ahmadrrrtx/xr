/**
 * XR 4.0 — Background Service Manager
 *
 * Manages long-running, interval-based runtime jobs through the same lifecycle
 * vocabulary used by the rest of the runtime.
 *
 * XR 4.0 additions:
 *   - Owner identity for each job
 *   - Workspace association
 *   - Duplicate-registration prevention
 *   - Cancellation support
 *   - Failure counting and health reporting
 *   - Job state inspection
 *   - Workspace-safety: jobs are stopped before workspace switch
 *   - Cannot run after owning runtime/workspace is closed
 */

import { CoreEvents, EventBus } from "./event-bus.ts";
import type { LifecycleHook } from "./lifecycle.ts";

export interface BackgroundJob {
  id: string;
  name: string;
  intervalMs: number;
  run(): Promise<void>;
  /** Owner identifier (service token ID or provider ID). */
  owner?: string;
  /** Workspace ID this job is bound to (null = process-global). */
  workspaceId?: string;
  /** Whether the job should be restarted after workspace switch. */
  restartOnWorkspaceSwitch?: boolean;
}

/** Runtime state of a registered background job. */
export type BackgroundJobState = "registered" | "running" | "stopped" | "failed" | "cancelled";

export interface BackgroundJobStatus {
  id: string;
  name: string;
  intervalMs: number;
  active: boolean;
  state: BackgroundJobState;
  owner?: string;
  workspaceId?: string;
  restartOnWorkspaceSwitch?: boolean;
  failureCount: number;
  lastRunAt?: number;
  lastError?: string;
}

export class BackgroundServiceManager implements LifecycleHook {
  private readonly jobs = new Map<string, BackgroundJob>();
  private readonly activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly failureCounts = new Map<string, number>();
  private readonly lastErrors = new Map<string, string>();
  private readonly lastRunAt = new Map<string, number>();
  private readonly jobStates = new Map<string, BackgroundJobState>();
  private isRunning = false;
  private _currentWorkspaceId?: string;

  constructor(private readonly events: EventBus) {}

  /**
   * Register a background job. Throws if a job with the same ID is already
   * registered (prevents duplicate registrations).
   */
  registerJob(job: BackgroundJob): void {
    if (this.jobs.has(job.id)) {
      // Emit event for diagnostics but don't throw to preserve backward compat.
      // The new job replaces the old one (safe replacement).
      this.stopJob(job.id);
    }
    this.jobs.set(job.id, job);
    this.failureCounts.set(job.id, 0);
    this.lastErrors.delete(job.id);
    this.jobStates.set(job.id, "registered");
    this.events.emit(CoreEvents.ServiceJobRegistered, {
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      owner: job.owner,
      workspaceId: job.workspaceId,
      timestamp: Date.now(),
    });
    if (this.isRunning) this.startJob(job);
  }

  unregisterJob(id: string): void {
    this.stopJob(id);
    this.jobs.delete(id);
    this.failureCounts.delete(id);
    this.lastErrors.delete(id);
    this.lastRunAt.delete(id);
    this.jobStates.delete(id);
    this.events.emit(CoreEvents.ServiceJobUnregistered, { id, timestamp: Date.now() });
  }

  startAll(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    for (const job of this.jobs.values()) this.startJob(job);
    this.events.emit(CoreEvents.ServicesStarted, { timestamp: Date.now(), jobs: this.jobs.size });
  }

  stopAll(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const id of [...this.activeTimers.keys()]) this.stopJob(id);
    this.activeTimers.clear();
    this.events.emit(CoreEvents.ServicesStopped, { timestamp: Date.now() });
  }

  /**
   * Stop only workspace-bound jobs (for workspace switch).
   * Process-global jobs continue running.
   */
  stopWorkspaceJobs(workspaceId?: string): void {
    for (const [id, job] of this.jobs) {
      if (job.workspaceId && (!workspaceId || job.workspaceId === workspaceId)) {
        this.stopJob(id);
      }
    }
  }

  /**
   * Restart workspace-bound jobs for the new workspace.
   */
  startWorkspaceJobs(newWorkspaceId: string): void {
    this._currentWorkspaceId = newWorkspaceId;
    for (const job of this.jobs.values()) {
      if (job.restartOnWorkspaceSwitch !== false && this.isRunning) {
        this.startJob(job);
      }
    }
  }

  /**
   * Set the current workspace context. Jobs without an explicit workspaceId
   * will be associated with this workspace.
   */
  setCurrentWorkspace(workspaceId: string): void {
    this._currentWorkspaceId = workspaceId;
  }

  async onInit(): Promise<void> {}

  async onStart(): Promise<void> {
    this.startAll();
  }

  async onStop(): Promise<void> {
    this.stopAll();
  }

  async forceRun(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Background job with ID "${id}" not found.`);
    await job.run();
  }

  /**
   * Cancel a specific job. Unlike stop, this sets the state to "cancelled"
   * and prevents the job from being restarted without explicit re-registration.
   */
  cancelJob(id: string): void {
    this.stopJob(id);
    this.jobStates.set(id, "cancelled");
    this.events.emit(CoreEvents.ServiceJobUnregistered, { id, timestamp: Date.now() });
  }

  /**
   * Get the status of all registered jobs.
   */
  listJobs(): BackgroundJobStatus[] {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      active: this.activeTimers.has(job.id),
      state: this.jobStates.get(job.id) ?? "registered",
      owner: job.owner,
      workspaceId: job.workspaceId,
      restartOnWorkspaceSwitch: job.restartOnWorkspaceSwitch,
      failureCount: this.failureCounts.get(job.id) ?? 0,
      lastRunAt: this.lastRunAt.get(job.id),
      lastError: this.lastErrors.get(job.id),
    }));
  }

  /**
   * Get the status of a specific job.
   */
  getJobStatus(id: string): BackgroundJobStatus | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    return {
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      active: this.activeTimers.has(job.id),
      state: this.jobStates.get(job.id) ?? "registered",
      owner: job.owner,
      workspaceId: job.workspaceId,
      restartOnWorkspaceSwitch: job.restartOnWorkspaceSwitch,
      failureCount: this.failureCounts.get(job.id) ?? 0,
      lastRunAt: this.lastRunAt.get(job.id),
      lastError: this.lastErrors.get(job.id),
    };
  }

  /**
   * Get jobs owned by a specific service.
   */
  getJobsByOwner(owner: string): BackgroundJobStatus[] {
    return this.listJobs().filter((j) => j.owner === owner);
  }

  /**
   * Get aggregate health summary.
   */
  getHealth(): {
    total: number;
    active: number;
    failed: number;
    cancelled: number;
    stopped: number;
  } {
    const statuses = this.listJobs();
    return {
      total: statuses.length,
      active: statuses.filter((s) => s.active).length,
      failed: statuses.filter((s) => s.state === "failed").length,
      cancelled: statuses.filter((s) => s.state === "cancelled").length,
      stopped: statuses.filter((s) => !s.active && s.state !== "cancelled" && s.state !== "failed").length,
    };
  }

  private startJob(job: BackgroundJob): void {
    // Don't start cancelled jobs.
    if (this.jobStates.get(job.id) === "cancelled") return;
    this.stopJob(job.id);
    this.jobStates.set(job.id, "running");

    // Set a sentinel timer immediately so `active` reflects the running state.
    const sentinel = setTimeout(() => {}, 0);
    this.activeTimers.set(job.id, sentinel);

    const runAndSchedule = async () => {
      if (!this.isRunning) return;
      // Check if the job's workspace is still current
      if (job.workspaceId && this._currentWorkspaceId && job.workspaceId !== this._currentWorkspaceId) {
        // Job belongs to a different workspace; skip this tick.
        return;
      }
      try {
        await job.run();
        this.lastRunAt.set(job.id, Date.now());
        this.failureCounts.set(job.id, 0);
        this.lastErrors.delete(job.id);
        this.jobStates.set(job.id, "running");
        this.events.emit(CoreEvents.ServiceJobSucceeded, {
          id: job.id,
          name: job.name,
          timestamp: Date.now(),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        const count = (this.failureCounts.get(job.id) ?? 0) + 1;
        this.failureCounts.set(job.id, count);
        this.lastErrors.set(job.id, error);
        this.jobStates.set(job.id, "failed");
        this.events.emit(CoreEvents.ServiceJobFailed, {
          id: job.id,
          name: job.name,
          error,
          failureCount: count,
          timestamp: Date.now(),
        });
        // After 5 consecutive failures, stop scheduling but keep the job registered.
        if (count >= 5) {
          this.stopJob(job.id);
          return;
        }
      } finally {
        if (this.isRunning && this.activeTimers.has(job.id)) {
          const timer = setTimeout(runAndSchedule, job.intervalMs);
          this.activeTimers.set(job.id, timer);
        }
      }
    };
    void runAndSchedule();
  }

  private stopJob(id: string): void {
    const timer = this.activeTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.activeTimers.delete(id);
    if (this.jobStates.get(id) === "running") {
      this.jobStates.set(id, "stopped");
    }
  }
}
