/**
 * XR Phase 10 — research job registry tests (offline, deterministic).
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { defaultResearchLimits, ResearchJobRegistry } from "../../src/research/jobs.ts";
import type { ResearchRequest } from "../../src/research/provider-types.ts";

function registry(store: Store | null) {
  return new ResearchJobRegistry(store, "ws1");
}

test("create assigns a stable id, workspace, queued state, and persists", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-jobs-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    const reg = registry(store);
    const job = reg.create({ intent: "search", query: "hello", source: "cli" }, defaultResearchLimits());
    expect(job.id).toMatch(/^rj_/);
    expect(job.workspaceId).toBe("ws1");
    expect(job.state).toBe("queued");
    expect(job.limits.maxPages).toBe(20);

    const loaded = reg.load(job.id);
    expect(loaded?.id).toBe(job.id);

    const listed = reg.listPersisted(10);
    expect(listed.some((r) => r.id === job.id)).toBe(true);
  } finally {
    store.close();
  }
});

test("cancel aborts the job and records a truthful cancelled state", () => {
  const reg = registry(null);
  const job = reg.create({ intent: "crawl", urls: ["https://example.com"], source: "cli" }, defaultResearchLimits());
  const signal = reg.signal(job.id);
  expect(signal?.aborted).toBe(false);
  const result = reg.cancel(job.id);
  expect(result.ok).toBe(true);
  expect(signal?.aborted).toBe(true);
  expect(job.state).toBe("cancelled");
  // Cancelling a terminal job is refused.
  expect(reg.cancel(job.id).ok).toBe(false);
});

test("load marks an unfinished persisted job recovery_pending (honest recovery)", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-jobs2-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    const reg = registry(store);
    const job = reg.create({ intent: "crawl", urls: ["https://example.com"], source: "cli" }, defaultResearchLimits());
    reg.update(job.id, { state: "crawling" });
    // Simulate restart: new registry instance, load from store.
    const reg2 = new ResearchJobRegistry(store, "ws1");
    const loaded = reg2.load(job.id);
    expect(loaded?.state).toBe("recovery_pending");
    expect(loaded?.progress.message).toContain("interrupted");
  } finally {
    store.close();
  }
});

test("terminal jobs load with their terminal state preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-jobs3-"));
  const store = new Store(join(dir, "xr.db"));
  try {
    const reg = registry(store);
    const job = reg.create({ intent: "search", query: "q", source: "cli" }, defaultResearchLimits());
    reg.update(job.id, { state: "completed" });
    const reg2 = new ResearchJobRegistry(store, "ws1");
    expect(reg2.load(job.id)?.state).toBe("completed");
  } finally {
    store.close();
  }
});

test("default limits are bounded — a missing limit never means infinite", () => {
  const l = defaultResearchLimits({ maxPages: undefined as never });
  expect(l.maxPages).toBeGreaterThan(0);
  expect(l.maxDepth).toBeGreaterThanOrEqual(0);
  expect(l.maxDurationMs).toBeGreaterThan(0);
  expect(l.maxRequests).toBeGreaterThan(0);
  expect(defaultResearchLimits({ maxPages: 3 }).maxPages).toBe(3);
});

test("event buffer is bounded and isTerminal is truthful", () => {
  const reg = registry(null);
  const job = reg.create({ intent: "search", query: "q", source: "cli" }, defaultResearchLimits());
  for (let i = 0; i < 600; i++) reg.appendEvent(job.id, { type: "source_found", jobId: job.id, sourceId: `s${i}`, url: `https://x/${i}` });
  expect(reg.events(job.id).length).toBeLessThanOrEqual(500);
  expect(reg.isTerminal(job.id)).toBe(false);
  reg.update(job.id, { state: "completed" });
  expect(reg.isTerminal(job.id)).toBe(true);
});
