/**
 * Phase 09 — Memory Engine lifecycle + truthful status.
 *
 * Extends existing MemoryStore / ContextService. Does NOT create a second
 * store, retrieval pipeline, or lifecycle for items.
 *
 * Engine states (distinct from item lifecycle verbatim/summary/condensed):
 *
 *   INIT → READY → ACTIVE → COMPACTING → DEGRADED → DISABLED → RECOVERING
 *
 * Failures are truthful. "Memory unavailable" is never reported as "enabled".
 */

import { isKnowledgeEnabled, isMemoryEnabled, loadConfig } from "../config/config.ts";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import { IsolatedMemoryStore } from "./isolated-store.ts";
import { MemoryStore, type MemoryHealth } from "./memory/store.ts";
import { CONTEXT_POLICY_VERSION } from "./types.ts";

export const ENGINE_STATES = [
  "init",
  "ready",
  "active",
  "compacting",
  "degraded",
  "disabled",
  "recovering",
] as const;

export type EngineState = (typeof ENGINE_STATES)[number];

export type ComponentHealth = "healthy" | "degraded" | "error" | "disabled";

export interface MemoryEngineReport {
  /** Config+env intent. */
  configuredEnabled: boolean;
  /** True only when configured enabled AND the store actually answers. */
  enabled: boolean;
  state: EngineState;
  store: ComponentHealth;
  retrieval: ComponentHealth;
  index: ComponentHealth;
  isolation: "verified" | "unverified";
  integrity: "valid" | "invalid" | "unknown";
  memoryCount: number;
  indexCount: number;
  lastCompactionAt: number | null;
  lastRetrievalLatencyMs: number | null;
  health: MemoryHealth;
  workspaceId: string;
  knowledgeEnabled: boolean;
  policyVersion: string;
  /** Human detail — never contains secrets or memory bodies. */
  detail: string;
  reasons: string[];
}

/** Process-local observations (never durable, never cross-workspace). */
const observations = {
  lastRetrievalLatencyMs: null as number | null,
  lastCompactionAt: null as number | null,
  compacting: false,
  lastFailure: null as string | null,
};

export function recordRetrievalLatency(ms: number): void {
  if (Number.isFinite(ms) && ms >= 0) observations.lastRetrievalLatencyMs = ms;
}

export function recordCompaction(at: number = Date.now()): void {
  observations.lastCompactionAt = at;
  observations.compacting = false;
}

export function markCompacting(on = true): void {
  observations.compacting = on;
}

/**
 * Inspect the memory engine against a live store.
 *
 * `store` omitted → INIT (or DISABLED if the off-switch is set). Never claims
 * enabled when the store is unavailable.
 */
export function inspectMemoryEngine(store?: WorkspaceStore | null): MemoryEngineReport {
  const reasons: string[] = [];
  let configuredEnabled = false;
  try {
    configuredEnabled = isMemoryEnabled();
  } catch {
    configuredEnabled = false;
    reasons.push("config probe failed");
  }

  const knowledgeEnabled = safe(isKnowledgeEnabled, false);
  const envOff = process.env.XR_MEMORY_DISABLED === "1";
  if (envOff) reasons.push("XR_MEMORY_DISABLED=1");
  if (!configuredEnabled && !envOff) {
    try {
      if (loadConfig().config.memory.enabled === false) reasons.push("config.memory.enabled=false");
    } catch {
      /* already recorded */
    }
  }

  if (!configuredEnabled) {
    return baseReport({
      configuredEnabled: false,
      enabled: false,
      state: "disabled",
      store: store ? "healthy" : "disabled",
      retrieval: "disabled",
      index: "disabled",
      isolation: "unverified",
      integrity: "unknown",
      memoryCount: 0,
      indexCount: 0,
      health: emptyHealth("memory disabled"),
      workspaceId: store?.workspaceId ?? "unknown",
      knowledgeEnabled,
      detail: reasons[0] ?? "memory disabled",
      reasons,
    });
  }

  if (!store) {
    return baseReport({
      configuredEnabled: true,
      enabled: false,
      state: observations.lastFailure ? "recovering" : "init",
      store: "error",
      retrieval: "disabled",
      index: "disabled",
      isolation: "unverified",
      integrity: "unknown",
      memoryCount: 0,
      indexCount: 0,
      health: emptyHealth("store unavailable"),
      workspaceId: "unknown",
      knowledgeEnabled,
      detail: "Memory Engine configured enabled but store is unavailable",
      reasons: [...reasons, "store unavailable"],
    });
  }

  let health: MemoryHealth;
  let storeHealth: ComponentHealth = "healthy";
  try {
    const mem = new IsolatedMemoryStore(store);
    health = mem.health();
    if (!health.ok) {
      storeHealth = "error";
      reasons.push(health.error ?? "store.health failed");
    }
  } catch (e) {
    storeHealth = "error";
    health = emptyHealth(e instanceof Error ? e.message : String(e));
    reasons.push("store probe threw");
  }

  let indexCount = 0;
  let indexHealth: ComponentHealth = "healthy";
  try {
    const row = store
      .query(`SELECT COUNT(*) AS c FROM user_memory WHERE embedding IS NOT NULL AND index_state='indexed'`)
      .get() as { c: number } | null;
    indexCount = row?.c ?? 0;
  } catch {
    indexHealth = "degraded";
    reasons.push("index probe failed");
  }

  const retrieval: ComponentHealth = storeHealth === "error" ? "error" : "healthy";

  let integrity: MemoryEngineReport["integrity"] = "unknown";
  try {
    const chain = store.verifyChain();
    integrity = chain.valid ? "valid" : "invalid";
    if (!chain.valid) reasons.push("audit chain invalid");
  } catch {
    integrity = "unknown";
  }

  let state: EngineState;
  if (storeHealth === "error") {
    state = observations.lastFailure ? "recovering" : "degraded";
    observations.lastFailure = health.error ?? "store error";
  } else if (observations.compacting) {
    state = "compacting";
  } else if (observations.lastRetrievalLatencyMs != null) {
    state = "active";
  } else {
    state = "ready";
  }

  const enabled = storeHealth !== "error";
  if (!enabled) reasons.push("store unhealthy — not reporting enabled");

  return baseReport({
    configuredEnabled: true,
    enabled,
    state,
    store: storeHealth,
    retrieval,
    index: indexHealth,
    isolation: "unverified",
    integrity,
    memoryCount: health.total,
    indexCount,
    health,
    workspaceId: store.workspaceId,
    knowledgeEnabled,
    detail: enabled
      ? `${health.total} entries · store ${storeHealth} · retrieval ${retrieval}`
      : reasons[0] ?? "degraded",
    reasons,
  });
}

/**
 * Hermetic workspace-isolation probe. Writes a canary into store A, searches
 * store B (separate file), expects NOT FOUND, then confirms A still has it.
 *
 * Safe for doctor / tests: uses the two stores the caller already opened.
 * Never prints or returns the canary body.
 */
export function verifyWorkspaceIsolation(
  storeA: WorkspaceStore,
  storeB: WorkspaceStore,
  canary = "WORKSPACE_A_SECRET",
): { verified: boolean; detail: string } {
  if (storeA.dbPath === storeB.dbPath) {
    return { verified: false, detail: "stores share a database file" };
  }
  if (storeA.workspaceId === storeB.workspaceId) {
    return { verified: false, detail: "stores share a workspace id" };
  }
  try {
    const a = new IsolatedMemoryStore(storeA);
    const b = new IsolatedMemoryStore(storeB);
    const added = a.add({
      content: canary,
      category: "fact",
      scope: `workspace:${storeA.workspaceId}`,
      source: "user",
      tags: ["isolation-probe"],
    });
    if (!added.ok || !added.entry) {
      return { verified: false, detail: added.reason ?? "failed to write canary in A" };
    }
    const inB = b.search(canary);
    const foundInB = inB.some((e) => e.content.includes(canary));
    const inA = a.search(canary);
    const foundInA = inA.some((e) => e.content.includes(canary));
    a.remove(added.entry.id);
    if (foundInB) return { verified: false, detail: "canary leaked into workspace B" };
    if (!foundInA) return { verified: false, detail: "canary missing from workspace A after write" };
    return { verified: true, detail: "A→B isolated; A retained" };
  } catch (e) {
    return { verified: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function baseReport(
  partial: Omit<MemoryEngineReport, "lastCompactionAt" | "lastRetrievalLatencyMs" | "policyVersion"> & {
    lastCompactionAt?: number | null;
    lastRetrievalLatencyMs?: number | null;
  },
): MemoryEngineReport {
  return {
    ...partial,
    lastCompactionAt: partial.lastCompactionAt ?? observations.lastCompactionAt,
    lastRetrievalLatencyMs: partial.lastRetrievalLatencyMs ?? observations.lastRetrievalLatencyMs,
    policyVersion: CONTEXT_POLICY_VERSION,
  };
}

function emptyHealth(error: string): MemoryHealth {
  return {
    ok: false,
    error,
    total: 0,
    expired: 0,
    neverAccessed: 0,
    oldestCreatedAt: null,
    byCategory: [],
  };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Doctor / dashboard label for the engine state. Never claims enabled when it is not. */
export function engineLabel(report: MemoryEngineReport): { mark: "ok" | "warn" | "fail"; text: string } {
  if (!report.configuredEnabled || report.state === "disabled") {
    return { mark: "fail", text: "disabled" };
  }
  if (!report.enabled || report.state === "degraded" || report.store === "error") {
    return { mark: "warn", text: `degraded (${report.detail})` };
  }
  if (report.state === "init" || report.state === "recovering") {
    return { mark: "warn", text: report.state };
  }
  return { mark: "ok", text: `${report.state} · ${report.memoryCount} entries` };
}
