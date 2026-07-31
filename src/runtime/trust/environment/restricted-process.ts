/**
 * Restricted-process backend (Tier 1).
 *
 * Runs the action in a separate child process with:
 *   - ambient host environment STRIPPED (only explicit, broker-approved env);
 *   - cwd confined to a granted writable root (path-checked);
 *   - wall-clock timeout with process-group kill;
 *   - bounded captured output;
 *   - sensitive host paths refused by path check.
 *
 * HONEST CLAIM: this is PROCESS RESTRICTION, not a hard security boundary.
 * Filesystem/network are constrained by path checks and policy, NOT by the OS
 * kernel. A compromised child could still read any file the XR user can read
 * or open any network socket. Use the namespace/container backend (Tier 2)
 * for a real boundary.
 */
import {
  type BackendRunContext,
  type EnvironmentBackend,
  hitsBlockedPath,
  isWithin,
  runChild,
} from "./backend.ts";
import { NO_ENFORCEMENT, type ResourceEnforcement } from "../resources.ts";
import type { EnvironmentExecutable, EnvironmentRunResult, PlacementGuarantees } from "../types.ts";

const GUARANTEES: PlacementGuarantees = {
  kernelBoundary: false,
  enforcedFilesystem: false, // path checks only
  enforcedNetwork: false,
  enforcedProcess: false,
  noAmbientAuthority: true,
};

const ENFORCEMENT: ResourceEnforcement = {
  ...NO_ENFORCEMENT,
  wallClock: true,
  output: true,
  processTree: true,
};

export class RestrictedProcessBackend implements EnvironmentBackend {
  readonly id = "restricted-process";
  readonly placement = "restricted_process" as const;
  readonly guarantees = GUARANTEES;
  readonly enforcement = ENFORCEMENT;

  async detect(): Promise<boolean> {
    // A confined child can be spawned on every supported local platform.
    return process.getuid?.() !== 0;
  }

  async run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    const grant = ctx.grant;

    // Confinement by path check (defense-in-depth; NOT a kernel boundary).
    const writable = grant.fs.writableRoots;
    const cwdAllowed = writable.length === 0 || writable.some((r) => isWithin(exec.cwd, r));
    if (!cwdAllowed) {
      return reject(`cwd ${exec.cwd} is outside granted writable roots`);
    }
    if (hitsBlockedPath(exec.cwd, grant.fs.blockedPaths)) {
      return reject(`cwd ${exec.cwd} is a blocked sensitive path`);
    }

    const env: Record<string, string> = { ...exec.env, ...ctx.envInject };
    const raw = await runChild({
      argv: exec.argv,
      cwd: exec.cwd,
      env,
      timeoutMs: exec.timeoutMs,
      maxOutputBytes: exec.maxOutputBytes,
      stdin: exec.stdin,
    });

    const boundaryEvent = raw.outputTruncated || raw.timedOut || raw.spawnError !== undefined;
    if (boundaryEvent && ctx.onBoundary) {
      ctx.onBoundary(raw.spawnError ?? (raw.timedOut ? "timeout" : "output-limit"));
    }

    return {
      ok: raw.exitCode === 0 && !raw.timedOut && raw.spawnError === undefined,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: raw.timedOut,
      outputTruncated: raw.outputTruncated,
      durationMs: raw.durationMs,
      boundaryEvent,
      boundaryDetail: raw.spawnError ?? (raw.outputTruncated ? "output limit reached" : raw.timedOut ? "wall-clock timeout" : undefined),
    };
  }

  describe(): string {
    return "Confined child process: ambient env stripped, cwd path-confined to granted roots, time/output bounded, process-group killed on timeout. Filesystem/network are POLICY-CHECKED, not kernel-enforced. Not a hard boundary.";
  }
}

function reject(reason: string): EnvironmentRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `restricted-process admission refused: ${reason}`,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    boundaryEvent: true,
    boundaryDetail: reason,
  };
}
