/**
 * XR 4.2 — Resource Policy Helpers
 *
 * Clamp/validate resource limits so a caller cannot request unbounded time,
 * memory, or output. If a platform cannot enforce a limit, the environment
 * backend documents it and the policy layer blocks action classes that
 * require that guarantee.
 */
import { TRUST_BOUNDS, type ResourcePolicy } from "./types.ts";

export function clampResources(r: ResourcePolicy): ResourcePolicy {
  return {
    wallClockMs: clamp(r.wallClockMs, 1, TRUST_BOUNDS.MAX_WALL_CLOCK_MS, TRUST_BOUNDS.DEFAULT_WALL_CLOCK_MS),
    cpuSeconds: r.cpuSeconds === undefined ? undefined : clamp(r.cpuSeconds, 1, 3600, TRUST_BOUNDS.DEFAULT_CPU_SECONDS),
    memoryBytes: r.memoryBytes === undefined ? undefined : clamp(r.memoryBytes, 16 * 1024 * 1024, 8 * 1024 * 1024 * 1024, TRUST_BOUNDS.DEFAULT_MEMORY_BYTES),
    maxOutputBytes: clamp(r.maxOutputBytes, 1024, TRUST_BOUNDS.MAX_MAX_OUTPUT_BYTES, TRUST_BOUNDS.DEFAULT_MAX_OUTPUT_BYTES),
    maxTempBytes: r.maxTempBytes === undefined ? undefined : clamp(r.maxTempBytes, 1024 * 1024, 4 * 1024 * 1024 * 1024, 64 * 1024 * 1024),
    maxFiles: r.maxFiles === undefined ? undefined : clamp(r.maxFiles, 1, 1_000_000, 4096),
  };
}

function clamp(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, min), max);
}

export interface ResourceEnforcement {
  wallClock: boolean;
  cpu: boolean;
  memory: boolean;
  output: boolean;
  temp: boolean;
  processTree: boolean;
}

/**
 * What a backend can actually enforce. Honesty here prevents false "secure
 * sandbox" claims. Backends override this with their real capabilities.
 */
export const NO_ENFORCEMENT: ResourceEnforcement = {
  wallClock: false,
  cpu: false,
  memory: false,
  output: false,
  temp: false,
  processTree: false,
};
