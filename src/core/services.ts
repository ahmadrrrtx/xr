/**
 * XR — Background Service Manager
 * Manages long-running, interval-based runtime jobs through the same lifecycle
 * vocabulary used by the rest of the runtime.
 */

import { CoreEvents, EventBus } from "./event-bus.ts";
import type { LifecycleHook } from "./lifecycle.ts";

export interface BackgroundJob {
  id: string;
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

export class BackgroundServiceManager implements LifecycleHook {
  private readonly jobs = new Map<string, BackgroundJob>();
  private readonly activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private isRunning = false;

  constructor(private readonly events: EventBus) {}

  registerJob(job: BackgroundJob): void {
    this.jobs.set(job.id, job);
    this.events.emit(CoreEvents.ServiceJobRegistered, {
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      timestamp: Date.now(),
    });
    if (this.isRunning) this.startJob(job);
  }

  unregisterJob(id: string): void {
    this.stopJob(id);
    this.jobs.delete(id);
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

  listJobs(): Array<{ id: string; name: string; intervalMs: number; active: boolean }> {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      name: job.name,
      intervalMs: job.intervalMs,
      active: this.activeTimers.has(job.id),
    }));
  }

  private startJob(job: BackgroundJob): void {
    this.stopJob(job.id);
    const runAndSchedule = async () => {
      if (!this.isRunning) return;
      try {
        await job.run();
        this.events.emit(CoreEvents.ServiceJobSucceeded, {
          id: job.id,
          name: job.name,
          timestamp: Date.now(),
        });
      } catch (err) {
        this.events.emit(CoreEvents.ServiceJobFailed, {
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
    void runAndSchedule();
  }

  private stopJob(id: string): void {
    const timer = this.activeTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.activeTimers.delete(id);
  }
}
