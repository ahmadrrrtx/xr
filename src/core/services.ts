/**
 * XR 3.0 — Background Service Manager
 * Implements Phase 6: Service manager for long-running capabilities.
 */

import { EventBus } from "./event-bus.ts";

export interface BackgroundJob {
  id: string;
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export class BackgroundServiceManager {
  private jobs = new Map<string, BackgroundJob>();
  private activeTimers = new Map<string, any>();
  private events: EventBus;
  private isRunning: boolean = false;

  constructor(events: EventBus) {
    this.events = events;
  }

  /**
   * Register a background capability job.
   */
  registerJob(job: BackgroundJob): void {
    this.jobs.set(job.id, job);
    if (this.isRunning) {
      this.startJob(job);
    }
  }

  /**
   * Unregister/remove a background job.
   */
  unregisterJob(id: string): void {
    this.stopJob(id);
    this.jobs.delete(id);
  }

  /**
   * Start all registered background jobs.
   */
  startAll(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    for (const job of this.jobs.values()) {
      this.startJob(job);
    }
    this.events.emit("services.start_all", { timestamp: Date.now() });
  }

  /**
   * Stop all active background jobs gracefully.
   */
  stopAll(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const id of this.activeTimers.keys()) {
      this.stopJob(id);
    }
    this.activeTimers.clear();
    this.events.emit("services.stop_all", { timestamp: Date.now() });
  }

  private startJob(job: BackgroundJob): void {
    this.stopJob(job.id);
    const runAndSchedule = async () => {
      if (!this.isRunning) return;
      try {
        await job.run();
        this.events.emit(`services.job_success`, { id: job.id, name: job.name, timestamp: Date.now() });
      } catch (err) {
        this.events.emit(`services.job_error`, {
          id: job.id,
          name: job.name,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        });
      } finally {
        if (this.isRunning) {
          const timer = setTimeout(runAndSchedule, job.intervalMs);
          this.activeTimers.set(job.id, timer);
        }
      }
    };
    // Run the job immediately, then schedule subsequent runs
    runAndSchedule();
  }

  private stopJob(id: string): void {
    const timer = this.activeTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(id);
    }
  }

  /**
   * Force execution of a specific job immediately.
   */
  async forceRun(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Background job with ID "${id}" not found.`);
    await job.run();
  }

  /**
   * Get list of currently active jobs and status.
   */
  listJobs(): Array<{ id: string; name: string; intervalMs: number; active: boolean }> {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      active: this.activeTimers.has(job.id),
    }));
  }
}
