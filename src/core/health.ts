/**
 * XR 4.0 — Kernel Health & Readiness Model
 *
 * Provides a structured, inspectable, serializable snapshot of the runtime's
 * health state. Designed for use by tests, CLI `doctor`/`status`, daemon
 * health endpoints, and internal diagnostics.
 *
 * Health categories:
 *   - liveness:    Runtime process is responding.
 *   - readiness:   All required kernel services are usable.
 *   - degraded:    Optional/noncritical service is unavailable.
 *   - failed:      Required service or invariant has failed.
 *   - stopped:     Runtime intentionally inactive.
 *
 * Rules:
 *   - Health never exposes secret values.
 *   - Health is cheap to compute (no disk scans or network calls).
 *   - Health is consumed in human and JSON formats.
 *   - Health must not claim the system is ready when a required store/service
 *     is unavailable.
 */

import type { RuntimeState } from "./lifecycle.ts";
import type { KernelErrorContext } from "./errors.ts";

/** Overall health status of the runtime. */
export type HealthStatus = "healthy" | "degraded" | "failed" | "stopped" | "starting" | "switching";

/** Readiness of a single service. */
export type ServiceReadiness = "ready" | "degraded" | "failed" | "not_registered" | "pending";

/** A single service's health entry. */
export interface ServiceHealthEntry {
  /** Service token ID. */
  id: string;
  /** Human-readable description. */
  description?: string;
  /** Current readiness. */
  readiness: ServiceReadiness;
  /** Service scope classification. */
  scope?: string;
  /** Whether the service participates in lifecycle. */
  lifecycle?: boolean;
  /** Whether the service is currently resolved (instantiated). */
  resolved?: boolean;
  /** Optional detail message (no secrets). */
  detail?: string;
}

/** Background job health entry. */
export interface BackgroundJobHealthEntry {
  /** Job ID. */
  id: string;
  /** Human-readable job name. */
  name: string;
  /** Whether the job's timer is currently active. */
  active: boolean;
  /** Interval in milliseconds. */
  intervalMs: number;
  /** Optional owner identifier. */
  owner?: string;
  /** Optional workspace association. */
  workspaceId?: string;
  /** Failure count since last start. */
  failureCount?: number;
}

/** Workspace health summary. */
export interface WorkspaceHealthEntry {
  /** Active workspace ID. */
  activeId: string;
  /** Whether the store is open and usable. */
  storeOpen: boolean;
  /** Number of open database connections. */
  connectionCount: number;
  /** Store file path (inside XR_HOME). */
  dbPath?: string;
}

/** Configuration health. */
export interface ConfigHealthEntry {
  /** Whether the config loaded successfully. */
  loaded: boolean;
  /** Config version number. */
  version?: number;
  /** Number of non-fatal warnings. */
  warningCount: number;
  /** Warning messages (no secrets). */
  warnings?: string[];
}

/** Complete kernel health snapshot. */
export interface KernelHealth {
  /** Timestamp of the snapshot. */
  timestamp: number;
  /** Overall health status. */
  status: HealthStatus;
  /** Runtime lifecycle state name. */
  runtimeState: string;
  /** Version information. */
  version: {
    version: string;
    codename: string;
    display: string;
  };
  /** Whether the runtime has been bootstrapped. */
  bootstrapped: boolean;
  /** Whether the runtime has been started. */
  started: boolean;
  /** Service readiness entries. */
  services: ServiceHealthEntry[];
  /** Background job entries. */
  backgroundJobs: BackgroundJobHealthEntry[];
  /** Workspace summary. */
  workspace: WorkspaceHealthEntry;
  /** Configuration summary. */
  config?: ConfigHealthEntry;
  /** Optional errors (safe, no secrets). */
  errors?: KernelErrorContext[];
  /** Optional human-readable summary. */
  summary?: string;
}

/**
 * Build a health snapshot from the current runtime state.
 * This is a pure function — it reads state but does not mutate anything.
 */
export function buildHealthSnapshot(input: {
  runtimeState: RuntimeState | string;
  bootstrapped: boolean;
  started: boolean;
  version: { version: string; codename: string; display: string };
  services: ServiceHealthEntry[];
  backgroundJobs: BackgroundJobHealthEntry[];
  workspace: WorkspaceHealthEntry;
  config?: ConfigHealthEntry;
  errors?: KernelErrorContext[];
}): KernelHealth {
  const { runtimeState, bootstrapped, started, version, services, backgroundJobs, workspace, config, errors } = input;

  // Derive overall status from component states.
  let status: HealthStatus;
  const runtimeStateStr = String(runtimeState);

  if (runtimeStateStr === "STOPPED" || runtimeStateStr === "UNINITIALIZED") {
    status = "stopped";
  } else if (runtimeStateStr === "FAILED") {
    status = "failed";
  } else if (runtimeStateStr === "SWITCHING_WORKSPACE") {
    status = "switching";
  } else if (runtimeStateStr === "BOOTSTRAPPING" || runtimeStateStr === "STARTING") {
    status = "starting";
  } else {
    // Check for degraded/failed services
    const hasFailed = services.some((s) => s.readiness === "failed");
    const hasDegraded = services.some((s) => s.readiness === "degraded");

    if (hasFailed) {
      status = "failed";
    } else if (hasDegraded) {
      status = "degraded";
    } else {
      status = "healthy";
    }
  }

  // Build summary line.
  const readyCount = services.filter((s) => s.readiness === "ready").length;
  const failedCount = services.filter((s) => s.readiness === "failed").length;
  const degradedCount = services.filter((s) => s.readiness === "degraded").length;
  const activeJobCount = backgroundJobs.filter((j) => j.active).length;

  const parts = [
    `runtime=${runtimeStateStr.toLowerCase()}`,
    `services=${readyCount}/${services.length} ready`,
  ];
  if (failedCount > 0) parts.push(`${failedCount} failed`);
  if (degradedCount > 0) parts.push(`${degradedCount} degraded`);
  parts.push(`jobs=${activeJobCount}/${backgroundJobs.length} active`);
  parts.push(`workspace=${workspace.activeId}`);

  return {
    timestamp: Date.now(),
    status,
    runtimeState: runtimeStateStr,
    version,
    bootstrapped,
    started,
    services,
    backgroundJobs,
    workspace,
    config,
    errors: errors?.length ? errors : undefined,
    summary: parts.join(" · "),
  };
}

/**
 * Format a health snapshot for human-readable CLI output.
 */
export function formatHealthHuman(health: KernelHealth): string {
  const lines: string[] = [];
  const statusIcon = {
    healthy: "✓",
    degraded: "!",
    failed: "✗",
    stopped: "○",
    starting: "▸",
    switching: "⇄",
  }[health.status] ?? "?";

  lines.push(`  Runtime:     ${statusIcon} ${health.runtimeState.toLowerCase()} (${health.status})`);
  lines.push(`  Version:     ${health.version.display}`);
  lines.push(`  Bootstrapped: ${health.bootstrapped ? "yes" : "no"}`);
  lines.push(`  Started:     ${health.started ? "yes" : "no"}`);
  lines.push(`  Workspace:   ${health.workspace.activeId} (store: ${health.workspace.storeOpen ? "open" : "closed"}, connections: ${health.workspace.connectionCount})`);

  if (health.services.length > 0) {
    lines.push("");
    lines.push("  Services:");
    for (const svc of health.services) {
      const icon = svc.readiness === "ready" ? "✓" : svc.readiness === "degraded" ? "!" : svc.readiness === "failed" ? "✗" : "○";
      const scope = svc.scope ? ` [${svc.scope}]` : "";
      const detail = svc.detail ? ` — ${svc.detail}` : "";
      lines.push(`    ${icon} ${svc.id}${scope}${detail}`);
    }
  }

  if (health.backgroundJobs.length > 0) {
    lines.push("");
    lines.push("  Background Jobs:");
    for (const job of health.backgroundJobs) {
      const icon = job.active ? "▸" : "○";
      const owner = job.owner ? ` (owner: ${job.owner})` : "";
      const failures = job.failureCount ? ` [${job.failureCount} failures]` : "";
      lines.push(`    ${icon} ${job.id}: ${job.name}${owner}${failures}`);
    }
  }

  if (health.config) {
    lines.push("");
    lines.push(`  Config:      ${health.config.loaded ? "loaded" : "error"} (v${health.config.version ?? "?"}, ${health.config.warningCount} warnings)`);
  }

  if (health.errors?.length) {
    lines.push("");
    lines.push("  Errors:");
    for (const err of health.errors) {
      lines.push(`    ✗ ${err.service ?? err.detail ?? "unknown"}: ${err.detail ?? ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format a health snapshot for JSON output (daemon API, --json flags).
 * Omits internal identifiers that aren't useful externally.
 */
export function formatHealthJson(health: KernelHealth): Record<string, unknown> {
  return {
    timestamp: health.timestamp,
    status: health.status,
    runtimeState: health.runtimeState,
    version: health.version,
    bootstrapped: health.bootstrapped,
    started: health.started,
    summary: health.summary,
    workspace: health.workspace,
    config: health.config ? {
      loaded: health.config.loaded,
      version: health.config.version,
      warningCount: health.config.warningCount,
    } : undefined,
    services: health.services.map((s) => ({
      id: s.id,
      readiness: s.readiness,
      scope: s.scope,
      lifecycle: s.lifecycle,
      detail: s.detail,
    })),
    backgroundJobs: health.backgroundJobs.map((j) => ({
      id: j.id,
      name: j.name,
      active: j.active,
      owner: j.owner,
      workspaceId: j.workspaceId,
      failureCount: j.failureCount,
    })),
    errors: health.errors,
  };
}
