/** XR 3.1.6 Phase 0 — local baseline status helpers.
 *
 * These helpers are deliberately small and local-only. They do not introduce a
 * telemetry pipeline or change runtime semantics; they provide stable summary
 * contracts used by doctor, validation scripts, and tests.
 */

import { existsSync, statSync } from "node:fs";
import { arch, platform, release, totalmem, freemem } from "node:os";
import type { HealthCheck } from "../install/system.ts";
import type { VersionInfo } from "../core/version.ts";

export type BaselineState = "ok" | "warn" | "fail" | "skip";

export interface BaselineSummary {
  ok: boolean;
  state: "ok" | "warn" | "fail";
  exitCode: 0 | 1;
  requiredFailures: string[];
  warnings: string[];
  skipped: string[];
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

export function summarizeHealthChecks(
  checks: HealthCheck[],
  requiredIds: readonly string[] = REQUIRED_HEALTH_CHECK_IDS,
): BaselineSummary {
  const required = new Set(requiredIds);
  const requiredFailures = checks
    .filter((check) => required.has(check.id) && check.state === "fail")
    .map((check) => check.id);
  const warnings = checks.filter((check) => check.state === "warn").map((check) => check.id);
  const skipped = checks.filter((check) => check.state === "skip").map((check) => check.id);
  const state: BaselineSummary["state"] = requiredFailures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "ok";
  return {
    ok: requiredFailures.length === 0,
    state,
    exitCode: requiredFailures.length === 0 ? 0 : 1,
    requiredFailures,
    warnings,
    skipped,
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
