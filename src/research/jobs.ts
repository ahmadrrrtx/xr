/**
 * XR Phase 10 — research job registry.
 *
 * Durable, cancellable research jobs (search/scrape/crawl/map/extract).
 *  - In-memory index for live jobs (with an AbortController each).
 *  - Persisted through the ONE workspace store (research_jobs table) so jobs
 *    survive a process restart as `recovery_pending` — no second store.
 *  - Secrets are never persisted: `request` carries no credentials (the
 *    Firecrawl key lives in the OS keychain / env, resolved at run time).
 */

import { randomUUID } from "node:crypto";
import type { Store } from "../state/workspace-store.ts";
import type { ResearchJob, ResearchJobState, ResearchLimits, ResearchProgress, ResearchRequest, ResearchStreamEvent } from "./provider-types.ts";

/** Safe, bounded defaults — a missing limit never means infinite. */
export function defaultResearchLimits(overrides?: Partial<ResearchLimits>): ResearchLimits {
  const clean = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined));
  return {
    maxPages: 20,
    maxDepth: 2,
    maxConcurrency: 3,
    maxBytes: 4 * 1024 * 1024,
    maxRequests: 50,
    maxDurationMs: 120_000,
    allowedDomains: [],
    blockedDomains: [],
    sameDomainOnly: false,
    includeSubdomains: true,
    ...clean,
  };
}

function initialProgress(kind: ResearchRequest["intent"]): ResearchProgress {
  return { state: "queued", discovered: 0, completed: 0, failed: 0, elapsedMs: 0, updatedAt: Date.now() };
}

export class ResearchJobRegistry {
  private readonly jobs = new Map<string, ResearchJob>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly eventBuffers = new Map<string, ResearchStreamEvent[]>();

  constructor(
    private readonly store: Store | null,
    private readonly workspaceId: string,
  ) {}

  /** Append a progress event to a job's bounded ring buffer. */
  appendEvent(id: string, event: ResearchStreamEvent): void {
    const arr = this.eventBuffers.get(id) ?? [];
    arr.push(event);
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    this.eventBuffers.set(id, arr);
  }

  /** Snapshot of buffered events (for SSE replay). */
  events(id: string): ResearchStreamEvent[] {
    return [...(this.eventBuffers.get(id) ?? [])];
  }

  /** True when a job reached a terminal state (or is unknown). */
  isTerminal(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return true;
    const terminal: ResearchJobState[] = ["completed", "partial", "cancelled", "failed", "budget_exhausted"];
    return terminal.includes(job.state);
  }

  create(request: ResearchRequest, limits: ResearchLimits, workspaceIdOverride?: string): ResearchJob {
    const id = `rj_${randomUUID().slice(0, 10)}`;
    const now = Date.now();
    const job: ResearchJob = {
      id,
      workspaceId: workspaceIdOverride ?? this.workspaceId,
      kind: request.intent,
      state: "queued",
      request,
      progress: initialProgress(request.intent),
      limits,
      budget: { pages: 0, requests: 0, bytes: 0, tokens: 0, startedAt: now, lastAt: now, exhausted: false, providerUsage: {} },
      sources: [],
      citations: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    this.controllers.set(id, new AbortController());
    this.persist(job);
    return job;
  }

  get(id: string): ResearchJob | undefined {
    const live = this.jobs.get(id);
    if (live) return live;
    return this.load(id);
  }

  list(): ResearchJob[] {
    return [...this.jobs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  signal(id: string): AbortSignal | undefined {
    return this.controllers.get(id)?.signal;
  }

  cancel(id: string): { ok: boolean; reason?: string } {
    const job = this.jobs.get(id);
    if (!job) return { ok: false, reason: "job not found" };
    const terminal: ResearchJobState[] = ["completed", "partial", "cancelled", "failed", "budget_exhausted"];
    if (terminal.includes(job.state)) {
      return { ok: false, reason: `job already ${job.state}` };
    }
    this.controllers.get(id)?.abort();
    job.state = "cancelled";
    job.progress = { ...job.progress, state: "cancelled", message: "cancelled by user", updatedAt: Date.now() };
    this.touch(job);
    this.persist(job);
    return { ok: true };
  }

  update(id: string, patch: Partial<Pick<ResearchJob, "state" | "provider" | "sources" | "citations" | "result" | "report" | "error" | "progress" | "budget">>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    this.touch(job);
    this.persist(job);
  }

  touch(job: ResearchJob): void {
    job.updatedAt = Date.now();
    job.progress = { ...job.progress, elapsedMs: Date.now() - job.createdAt, updatedAt: Date.now() };
  }

  /** Finalize + persist a job's terminal state. */
  finish(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.touch(job);
    this.persist(job);
    this.controllers.delete(id);
  }

  persist(job: ResearchJob): void {
    if (!this.store) return;
    try {
      this.store.saveResearchJob(job.id, job.workspaceId, job.kind, job.state, JSON.stringify(job.request), JSON.stringify(job));
    } catch {
      /* persistence is best-effort; the live job remains authoritative */
    }
  }

  /** Load a persisted job (e.g. after a process restart). */
  load(id: string): ResearchJob | undefined {
    if (!this.store) return undefined;
    const row = this.store.getResearchJob(id);
    if (!row) return undefined;
    try {
      const job = JSON.parse(row.data) as ResearchJob;
      // Honest recovery: an unfinished job found at startup is recovery_pending.
      const terminal: ResearchJobState[] = ["completed", "partial", "cancelled", "failed", "budget_exhausted"];
      if (!terminal.includes(job.state)) {
        job.state = "recovery_pending";
        job.progress = { ...job.progress, state: "recovery_pending", message: "interrupted — needs manual resume/cancel" };
      }
      return job;
    } catch {
      return undefined;
    }
  }

  listPersisted(limit = 50): Array<{ id: string; kind: string; status: string; updated_at: number }> {
    return this.store ? this.store.listResearchJobs(limit) : [];
  }
}
