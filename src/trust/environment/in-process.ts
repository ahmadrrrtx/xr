/**
 * In-process / plain-child backend.
 *
 * HONEST CLAIM: this provides NO kernel boundary. It exists so Tier 1 has a
 * uniform executor when a process sandbox is unavailable (explicit, logged
 * fallback) and for tests. It strips ambient env, bounds time/output, and
 * kills the process group — but it does NOT confine filesystem or network at
 * the OS level.
 */
import {
  type BackendRunContext,
  type EnvironmentBackend,
  runChild,
} from "./backend.ts";
import { NO_ENFORCEMENT, type ResourceEnforcement } from "../resources.ts";
import type { EnvironmentExecutable, EnvironmentRunResult, PlacementGuarantees } from "../types.ts";

const GUARANTEES: PlacementGuarantees = {
  kernelBoundary: false,
  enforcedFilesystem: false,
  enforcedNetwork: false,
  enforcedProcess: false,
  noAmbientAuthority: true, // we strip ambient env before spawn
};

const ENFORCEMENT: ResourceEnforcement = {
  ...NO_ENFORCEMENT,
  wallClock: true,
  output: true,
  processTree: true, // process-group kill
};

export class InProcessBackend implements EnvironmentBackend {
  readonly id = "in-process";
  readonly placement = "in_process" as const;
  readonly guarantees = GUARANTEES;
  readonly enforcement = ENFORCEMENT;

  async detect(): Promise<boolean> {
    return true;
  }

  async run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    const env: Record<string, string> = { ...exec.env, ...ctx.envInject };
    const raw = await runChild({
      argv: exec.argv,
      cwd: exec.cwd,
      env,
      timeoutMs: exec.timeoutMs,
      maxOutputBytes: exec.maxOutputBytes,
      stdin: exec.stdin,
    });
    return {
      ok: raw.exitCode === 0 && !raw.timedOut,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: raw.timedOut,
      outputTruncated: raw.outputTruncated,
      durationMs: raw.durationMs,
      boundaryEvent: raw.outputTruncated || raw.timedOut,
      boundaryDetail: raw.outputTruncated ? "output limit reached" : raw.timedOut ? "wall-clock timeout" : undefined,
    };
  }

  describe(): string {
    return "Plain child process in the host namespace. NO filesystem/network confinement; only env stripping, time/output bounds, and process-group kill. Not a security boundary.";
  }
}
