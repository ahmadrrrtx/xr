/** XR Phase 0 — local baseline status helpers.
 *
 * These helpers are deliberately small and local-only. They do not introduce a
 * telemetry pipeline or change runtime semantics; they provide stable summary
 * contracts used by doctor, validation scripts, and tests.
 *
 * ── Phase 5 repatriation (ADR-0028) ─────────────────────────────────────────
 * This module lived at `src/enterprise/baseline/status.ts` until Phase 5. It
 * was never enterprise code: it is the health/readiness contract behind
 * `xr doctor`, `src/install/system.ts`, and four baseline scripts. Leaving it
 * in the extracted `xr-enterprise` satellite would have given the single most
 * important honesty command in the product a hard dependency on an optional
 * package — an inversion of the whole point of the shrink. It is L-surface
 * install/health code and now lives with the installer it serves.
 */

import { existsSync, statSync } from "node:fs";
import { arch, platform, release, totalmem, freemem } from "node:os";
import type { HealthCheck } from "./system.ts";
import type { VersionInfo } from "../core/version.ts";

export type BaselineState = "ok" | "warn" | "fail" | "skip";

export interface BaselineSummary {
  ok: boolean;
  state: "ok" | "warn" | "fail";
  exitCode: 0 | 1;
  requiredFailures: string[];
  warnings: string[];
  skipped: string[];
  /**
   * Phase 0 · T4 — can XR actually complete a task right now?
   *
   * Installation health and task readiness are different questions, and XR
   * previously answered only the first while reporting it as the second: with
   * zero reachable providers `doctor` printed `ok: true` and exited 0.
   * `runnable` answers the question a user actually asks, and `ok` is now
   * conjoined with it so no caller can read success from a system that cannot
   * execute work (Commandment 2 — no success without a verified effect).
   */
  runnable: boolean;
  /** Human-readable explanation of the runnable verdict, always populated. */
  runnableReason: string;
}

export interface RuntimeEnvironment {
  bun: string;
  node: string;
  os: NodeJS.Platform;
  arch: NodeJS.Architecture;
  release: string;
  cpu: string;
  memory: {
    totalBytes: number;
    freeBytes: number;
  };
  ci: boolean;
  tty: boolean;
}

export interface WorkspaceStatus {
  id: string;
  rootDir: string;
  configPath: string;
  dbPath: string;
  dbExists: boolean;
  dbSizeBytes: number | null;
  connectionCount: number;
}

export interface SafeConfigStatus {
  path: string;
  warnings: string[];
  defaults: {
    mode: string;
    provider: string;
    model: string;
    fallbackProvider: string | null;
    fallbackModel: string | null;
  };
  budget: {
    perTaskUsd: number;
    perTaskTokens: number;
  };
  memory: {
    enabled: boolean;
    injectInChat: boolean;
    recallLimit: number;
  };
  security: {
    requireApproval: string[];
    egressAllowlistCount: number;
  };
  localModels: {
    enabled: boolean;
    runtime: string;
    routing: string;
    selected: string | null;
  };
  secrets: Record<string, "set" | "unset">;
}

export interface BaselineDoctorReport {
  schemaVersion: 1;
  generatedAt: string;
  version: VersionInfo;
  environment: RuntimeEnvironment;
  platform: unknown;
  workspace: WorkspaceStatus;
  config: SafeConfigStatus;
  summary: BaselineSummary;
  checks: HealthCheck[];
}

export const REQUIRED_HEALTH_CHECK_IDS = ["platform", "bun", "package-manager", "config", "audit"] as const;

/** Health-check ids that carry provider reachability, by convention `provider-<id>`. */
export const PROVIDER_CHECK_PREFIX = "provider-";

/**
 * Determine whether XR can complete a task right now.
 *
 * Readiness requires BOTH:
 *   1. no required installation check failed, and
 *   2. at least one provider is actually usable (`state === "ok"`).
 *
 * A provider in `warn` is explicitly NOT runnable: warn means "configured but
 * unreachable / unauthenticated", which is precisely the state that produced a
 * false green before. Fail closed (Commandment 13).
 *
 * When no provider check was performed at all (e.g. a probe-less summary), the
 * verdict is unknown rather than assumed-good, and unknown resolves to not
 * runnable.
 */
export function evaluateRunnable(
  checks: HealthCheck[],
  requiredFailures: string[],
): { runnable: boolean; runnableReason: string } {
  if (requiredFailures.length > 0) {
    return {
      runnable: false,
      runnableReason: `required check(s) failed: ${requiredFailures.join(", ")}`,
    };
  }

  const providerChecks = checks.filter((check) => check.id.startsWith(PROVIDER_CHECK_PREFIX));
  if (providerChecks.length === 0) {
    return {
      runnable: false,
      runnableReason: "no provider was probed — run `xr doctor` to evaluate provider readiness",
    };
  }

  const usable = providerChecks.filter((check) => check.state === "ok");
  if (usable.length === 0) {
    const configured = providerChecks.filter((check) => check.state === "warn").length;
    return {
      runnable: false,
      runnableReason:
        configured > 0
          ? `no provider is reachable (${configured} configured but unavailable) — check credentials or start a local runtime`
          : "no provider is configured — run `xr config` or set a provider API key",
    };
  }

  return {
    runnable: true,
    runnableReason: `${usable.length} provider(s) ready: ${usable
      .map((check) => check.id.slice(PROVIDER_CHECK_PREFIX.length))
      .join(", ")}`,
  };
}

export interface SummarizeOptions {
  /**
   * Whether task-readiness gates `ok`/`exitCode`.
   *
   * `true`  — the caller is answering "can XR do work?" (`xr doctor`). A system
   *           with no reachable provider is NOT ok and exits non-zero.
   * `false` — the caller is answering "is XR installed correctly?"
   *           (`xr status`, installer probes). Provider reachability is still
   *           reported via `runnable`, but does not fail the command.
   *
   * Defaults to `true`: the safe answer is the strict one, and a caller that
   * wants the weaker question must ask for it explicitly (fail closed).
   */
  requireRunnable?: boolean;
}

export function summarizeHealthChecks(
  checks: HealthCheck[],
  requiredIds: readonly string[] = REQUIRED_HEALTH_CHECK_IDS,
  options: SummarizeOptions = {},
): BaselineSummary {
  const requireRunnable = options.requireRunnable ?? true;
  const required = new Set(requiredIds);
  const requiredFailures = checks
    .filter((check) => required.has(check.id) && check.state === "fail")
    .map((check) => check.id);
  const warnings = checks.filter((check) => check.state === "warn").map((check) => check.id);
  const skipped = checks.filter((check) => check.state === "skip").map((check) => check.id);

  const { runnable, runnableReason } = evaluateRunnable(checks, requiredFailures);

  // `ok` means "installed correctly AND (when asked) able to do work". Reporting
  // ok:true for a system that cannot execute a single task is the exact defect
  // Phase 0 exists to remove, so for readiness callers the two conditions are
  // conjoined rather than reported apart.
  const runnableBlocks = requireRunnable && !runnable;
  const ok = requiredFailures.length === 0 && !runnableBlocks;
  const state: BaselineSummary["state"] =
    requiredFailures.length > 0 || runnableBlocks ? "fail" : warnings.length > 0 ? "warn" : "ok";

  return {
    ok,
    state,
    exitCode: ok ? 0 : 1,
    requiredFailures,
    warnings,
    skipped,
    runnable,
    runnableReason,
  };
}

const SECRETISH = /(api[_-]?key|token|secret|password|bearer|credential|private[_-]?key)/i;

export function redactValue(key: string, value: unknown): unknown {
  if (SECRETISH.test(key)) {
    if (value == null || value === "") return value;
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item, idx) => redactValue(`${key}[${idx}]`, item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      out[childKey] = redactValue(childKey, childValue);
    }
    return out;
  }
  return value;
}

export function runtimeEnvironment(): RuntimeEnvironment {
  return {
    bun: typeof Bun !== "undefined" ? Bun.version : "unavailable",
    node: process.version,
    os: platform(),
    arch: arch(),
    release: release(),
    cpu: `${platform()}/${arch()}`,
    memory: {
      totalBytes: totalmem(),
      freeBytes: freemem(),
    },
    ci: Boolean(process.env.CI || process.env.GITHUB_ACTIONS),
    tty: Boolean(process.stdout.isTTY),
  };
}

export function workspaceStatus(input: {
  id: string;
  rootDir: string;
  configPath: string;
  dbPath: string;
  connectionCount: number;
}): WorkspaceStatus {
  let dbSizeBytes: number | null = null;
  const dbExists = existsSync(input.dbPath);
  if (dbExists) {
    try {
      dbSizeBytes = statSync(input.dbPath).size;
    } catch {
      dbSizeBytes = null;
    }
  }
  return { ...input, dbExists, dbSizeBytes };
}

export function safeConfigStatus(input: {
  path: string;
  warnings: string[];
  config: any;
  providerKeyEnvs: string[];
}): SafeConfigStatus {
  const cfg = input.config;
  const secrets: Record<string, "set" | "unset"> = {};
  for (const envName of input.providerKeyEnvs) {
    secrets[envName] = process.env[envName] ? "set" : "unset";
  }
  return {
    path: input.path,
    warnings: input.warnings,
    defaults: {
      mode: cfg.defaults?.mode ?? "agent",
      provider: cfg.defaults?.provider ?? "ollama",
      model: cfg.defaults?.model ?? "unknown",
      fallbackProvider: cfg.defaults?.fallbackProvider ?? null,
      fallbackModel: cfg.defaults?.fallbackModel ?? null,
    },
    budget: {
      perTaskUsd: Number(cfg.budget?.perTaskUsd ?? 0),
      perTaskTokens: Number(cfg.budget?.perTaskTokens ?? 0),
    },
    memory: {
      enabled: Boolean(cfg.memory?.enabled),
      injectInChat: Boolean(cfg.memory?.injectInChat),
      recallLimit: Number(cfg.memory?.recallLimit ?? 0),
    },
    security: {
      requireApproval: Array.isArray(cfg.security?.requireApproval) ? cfg.security.requireApproval : [],
      egressAllowlistCount: Array.isArray(cfg.security?.egressAllowlist) ? cfg.security.egressAllowlist.length : 0,
    },
    localModels: {
      enabled: Boolean(cfg.localModels?.enabled),
      runtime: String(cfg.localModels?.runtime ?? "ollama"),
      routing: String(cfg.localModels?.routing ?? "hybrid"),
      selected: cfg.localModels?.selected ?? null,
    },
    secrets,
  };
}
