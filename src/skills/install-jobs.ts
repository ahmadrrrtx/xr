/**
 * XR Phase 20 — install job registry.
 *
 * `POST /api/skills/install` starts a job and returns `{ jobId }` immediately;
 * `GET /api/skills/install/:jobId/stream` streams its steps over SSE (replay
 * buffer first, then live — a late subscriber never misses an event). Jobs
 * are in-memory and bounded; a completed job is kept briefly so an
 * interrupted UI can reconnect and see the terminal state.
 *
 * Pattern mirrors `ResearchRunRegistry` (Phase 18): subscribe-before-replay
 * with identity de-duplication.
 */
export type InstallStep = "download" | "verify" | "install" | "validate" | "ready" | "error";

export interface InstallEvent {
  type: "step" | "progress" | "done" | "error";
  jobId: string;
  step: InstallStep;
  /** 0..100 determinate progress for the active step when byte counts exist. */
  pct: number;
  message: string;
  error?: string;
  /** Terminal outcome (install result summary) on done/error events. */
  result?: unknown;
  at: number;
}

export interface InstallJobStatus {
  jobId: string;
  skillId: string;
  done: boolean;
  ok: boolean;
  events: InstallEvent[];
}

type Listener = (event: InstallEvent) => void;

const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 64;

class InstallJob {
  readonly events: InstallEvent[] = [];
  readonly listeners = new Set<Listener>();
  done = false;
  ok = false;

  constructor(
    readonly jobId: string,
    readonly skillId: string,
    readonly createdAt: number,
  ) {}

  emit(event: InstallEvent): void {
    this.events.push(event);
    if (event.type === "done") {
      this.done = true;
      this.ok = true;
    }
    if (event.type === "error") {
      this.done = true;
      this.ok = false;
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        /* a broken subscriber must not stall the install */
      }
    }
    if (this.done) {
      // Terminal: drop listeners after one more tick so queued sends flush.
      setTimeout(() => this.listeners.clear(), 0);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class InstallJobRegistry {
  private readonly jobs = new Map<string, InstallJob>();

  private sweep(now = Date.now()): void {
    for (const [id, job] of this.jobs) {
      if (job.done && now - job.createdAt > JOB_TTL_MS) this.jobs.delete(id);
    }
    if (this.jobs.size > MAX_JOBS) {
      const oldest = [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
      for (const job of oldest.slice(0, this.jobs.size - MAX_JOBS)) {
        if (job.done) this.jobs.delete(job.jobId);
      }
    }
  }

  create(jobId: string, skillId: string): InstallJob {
    this.sweep();
    const job = new InstallJob(jobId, skillId, Date.now());
    this.jobs.set(jobId, job);
    return job;
  }

  get(jobId: string): InstallJob | undefined {
    return this.jobs.get(jobId);
  }

  status(jobId: string): InstallJobStatus | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return { jobId: job.jobId, skillId: job.skillId, done: job.done, ok: job.ok, events: [...job.events] };
  }
}

/** One registry per process (jobs are process-local by design). */
export const installJobs = new InstallJobRegistry();
