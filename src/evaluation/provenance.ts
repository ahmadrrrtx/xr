/**
 * XR 7.0 — Evaluation provenance (Phase 13).
 *
 * A benchmark number without provenance is an opinion. This module captures
 * the environment, configuration, and identity of every run, and provides the
 * canonical hashing used to make results tamper-evident.
 *
 * Privacy rules:
 *   - No hostname, username, home path, IP, or serial is captured.
 *   - Memory is bucketed, not exact, to avoid host fingerprinting.
 *   - Public reports redact infrastructure detail (§11).
 */

import { createHash, randomUUID } from "node:crypto";
import { cpus, totalmem, platform, arch } from "node:os";
import { execFileSync } from "node:child_process";
import { CORE_VERSION } from "../core/version.ts";
import {
  EVALUATION_HARNESS_ID,
  EVALUATION_HARNESS_VERSION,
  EVALUATION_SCHEMA_VERSION,
  type EvaluationConfiguration,
  type EvaluationEnvironment,
  type ResultIntegrity,
  type RunProvenance,
  type ScenarioSet,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Canonical serialization
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deterministic JSON: object keys sorted recursively so that two structurally
 * identical results always hash identically regardless of construction order.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    // Normalize -0 to 0 and reject non-finite numbers (they break JSON).
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return String(value);
      return value === 0 ? 0 : value;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sortValue);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

/** SHA-256 of the canonical form. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// Redaction
// ═══════════════════════════════════════════════════════════════════════════

const SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
  /(?<=(?:api[_-]?key|secret|token|password|passwd|pwd|bearer)["'\s:=]{1,8})[A-Za-z0-9/+_-]{12,}/gi,
]);

/**
 * Redact secrets and host-identifying paths from any evidence string.
 *
 * This runs on EVERY evidence note and effect target before persistence, so a
 * scenario cannot accidentally write a credential into a benchmark artifact.
 */
export function redactEvidence(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");

  // Home directories and user names → stable placeholder.
  out = out.replace(/\/(?:home|Users)\/[^/\s"']+/g, "/<home>");
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, "<home>");
  // Temp fixture roots → placeholder (keeps the tail for readability).
  out = out.replace(/\/(?:tmp|var\/folders)\/[^\s"']*?xr-eval-[A-Za-z0-9]+/g, "<fixture>");
  // IPv4 literals other than loopback.
  out = out.replace(/\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>");
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Environment capture
// ═══════════════════════════════════════════════════════════════════════════

export interface CaptureEnvironmentOptions {
  readonly offline?: boolean;
  /** Injected for tests / for hosts where probing is undesirable. */
  readonly isolationBackends?: readonly string[];
}

/**
 * Detect which isolation backends are actually usable here.
 *
 * This matters because a `trust` result on a host with no sandbox is NOT
 * comparable to one on a host with containers. The harness records it rather
 * than pretending the environment is uniform.
 */
export function detectIsolationBackends(): string[] {
  const found: string[] = ["in_process"];
  if (platform() === "linux" || platform() === "darwin") {
    found.push("restricted_process");
  }
  for (const [bin, label] of [
    ["bwrap", "namespace_sandbox"],
    ["docker", "container"],
    ["podman", "container"],
  ] as const) {
    try {
      execFileSync("command", ["-v", bin], { stdio: "ignore", shell: "/bin/sh", timeout: 2000 });
      if (!found.includes(label)) found.push(label);
    } catch {
      /* backend not present — this is information, not an error */
    }
  }
  return found;
}

export function captureEnvironment(opts: CaptureEnvironmentOptions = {}): EvaluationEnvironment {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const bunVersion = (globalThis as { Bun?: { version?: string } }).Bun?.version;
  return Object.freeze({
    platform: platform(),
    arch: arch(),
    runtime: isBun ? "bun" : "node",
    runtimeVersion: isBun ? (bunVersion ?? "unknown") : process.version,
    cpuCount: cpus().length,
    // Bucketed to the nearest GiB — enough to explain perf, not to fingerprint.
    memoryGiB: Math.round(totalmem() / 1024 ** 3),
    isolationBackends: Object.freeze([...(opts.isolationBackends ?? detectIsolationBackends())]),
    offline: opts.offline ?? false,
    elevated: typeof process.getuid === "function" ? process.getuid() === 0 : false,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Commit discovery
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Best-effort commit discovery. Returns `"unknown"` rather than fabricating.
 * An honest `unknown` is required by §5 ("no fabricated historical metrics").
 */
export function discoverCommit(cwd: string = process.cwd()): string {
  const fromEnv = process.env.XR_EVAL_COMMIT;
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.toLowerCase();
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{40}$/i.test(out) ? out.toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}

/** True when the working tree has uncommitted changes (affects reproducibility). */
export function workingTreeDirty(cwd: string = process.cwd()): boolean | null {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Provenance assembly
// ═══════════════════════════════════════════════════════════════════════════

export interface BuildProvenanceOptions {
  readonly runId?: string;
  readonly productVersion?: string;
  readonly commit?: string;
  readonly now?: number;
  readonly environment: EvaluationEnvironment;
  readonly configuration: EvaluationConfiguration;
  readonly registryDigest: string;
}

export function buildProvenance(opts: BuildProvenanceOptions): RunProvenance {
  return Object.freeze({
    runId: opts.runId ?? `evalrun_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    harnessId: EVALUATION_HARNESS_ID,
    harnessVersion: EVALUATION_HARNESS_VERSION,
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    productVersion: opts.productVersion ?? CORE_VERSION,
    commit: opts.commit ?? discoverCommit(),
    startedAt: opts.now ?? Date.now(),
    environment: opts.environment,
    configuration: opts.configuration,
    registryDigest: opts.registryDigest,
  });
}

export function buildConfiguration(params: {
  deploymentProfile: string;
  localityPolicy?: string;
  providerId?: string;
  modelId?: string;
  policy?: unknown;
  scenarioSets: readonly ScenarioSet[];
}): EvaluationConfiguration {
  const base: Record<string, unknown> = {
    deploymentProfile: params.deploymentProfile,
    localityPolicy: params.localityPolicy ?? "local_only",
    policy: params.policy ?? null,
  };
  const config: EvaluationConfiguration = {
    deploymentProfile: params.deploymentProfile,
    localityPolicy: params.localityPolicy ?? "local_only",
    policyDigest: digest(base),
    scenarioSets: Object.freeze([...params.scenarioSets]),
    ...(params.providerId ? { providerId: params.providerId } : {}),
    ...(params.modelId ? { modelId: params.modelId } : {}),
  };
  return Object.freeze(config);
}

// ═══════════════════════════════════════════════════════════════════════════
// Integrity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute the integrity record for a run body.
 *
 * The `integrity` and `invalidation` fields are excluded from the hash so that
 * marking a run invalid does not retroactively break its original digest —
 * transparency requires the original hash stay verifiable.
 */
export function computeIntegrity(
  body: { readonly provenance: RunProvenance; readonly suites: unknown },
  registryDigest: string,
): ResultIntegrity {
  return Object.freeze({
    algorithm: "sha256" as const,
    digest: digest({ provenance: body.provenance, suites: body.suites }),
    registryDigest,
  });
}

/** Verify a stored run's integrity by recomputation. */
export function verifyIntegrity(run: {
  readonly provenance: RunProvenance;
  readonly suites: unknown;
  readonly integrity: ResultIntegrity;
}): { valid: boolean; expected: string; actual: string } {
  const actual = digest({ provenance: run.provenance, suites: run.suites });
  return {
    valid: actual === run.integrity.digest,
    expected: run.integrity.digest,
    actual,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic randomness
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Seeded PRNG (mulberry32) so "random" choices inside a scenario are
 * reproducible across runs. Reproducibility is a Phase 13 requirement.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
