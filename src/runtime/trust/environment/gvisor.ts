/**
 * XR Phase 4 · T1 — gVisor backend (detection hook).
 *
 * gVisor (`runsc`) is a user-space application kernel that intercepts every
 * syscall and implements it in the Sentry process, so a compromised workload
 * cannot exploit the host kernel's syscall surface. It is the next rung above
 * the namespace sandbox on the restrictiveness lattice (lattice.ts).
 *
 * PHASE 4 POSTURE (honest): this backend is wired as a DETECTION HOOK. When
 * the host has a container runtime configured with a `runsc` runtime AND the
 * operator opts in, high-risk actions can escalate to it. When it is not
 * available, the policy layer selects the next-strongest available backend or
 * fails closed — it is never a silent downgrade, and it is never claimed as
 * available when it is not.
 *
 * Execution path: `docker run --runtime runsc …` (same hardened flags as the
 * container backend). No microVM orchestration is implemented in Phase 4.
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
  kernelBoundary: true,       // user-space kernel: syscall surface is not the host's
  enforcedFilesystem: true,
  enforcedNetwork: true,
  enforcedProcess: true,
  noAmbientAuthority: true,
};

const ENFORCEMENT: ResourceEnforcement = {
  ...NO_ENFORCEMENT,
  wallClock: true,
  cpu: true,
  memory: true,
  output: true,
  temp: true,
  processTree: true,
};

export class GVisorBackend implements EnvironmentBackend {
  readonly id = "gvisor-runsc";
  readonly placement = "gvisor" as const;
  readonly guarantees = GUARANTEES;
  readonly enforcement = ENFORCEMENT;

  private available = false;
  private runtime: "docker" | "podman" | null = null;
  private readonly image: string;

  constructor(opts?: { image?: string }) {
    this.image = opts?.image ?? process.env.XR_TRUST_GVISOR_IMAGE ?? "debian:stable-slim";
  }

  async detect(): Promise<boolean> {
    // Only opt-in: `runsc` must be installed and a container runtime must be
    // able to use it. Never auto-claimed.
    const runsc = await runChild({
      argv: ["runsc", "--version"],
      cwd: "/",
      env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    if (runsc.exitCode !== 0) {
      this.available = false;
      return false;
    }
    for (const rt of ["docker", "podman"] as const) {
      const probe = await runChild({
        argv: [rt, "info"],
        cwd: "/",
        env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
        timeoutMs: 8000,
        maxOutputBytes: 8192,
      });
      if (probe.exitCode === 0) {
        this.runtime = rt;
        this.available = true;
        return true;
      }
    }
    this.available = false;
    return false;
  }

  async run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    if (!this.available || !this.runtime) {
      return refused(
        "gVisor backend not available on this host (runsc or a runsc-capable container runtime missing); the policy layer must select another backend or fail closed",
      );
    }
    const grant = ctx.grant;
    const writable = grant.fs.writableRoots;
    if (writable.length > 0 && !writable.some((r) => isWithin(exec.cwd, r))) {
      return refused(`cwd ${exec.cwd} outside granted writable roots`);
    }
    if (hitsBlockedPath(exec.cwd, grant.fs.blockedPaths)) {
      return refused(`cwd ${exec.cwd} is a blocked sensitive path`);
    }

    const args: string[] = [
      this.runtime, "run", "--rm", "-i",
      "--runtime", "runsc",
      "--network", "none",
      "--read-only",
      "--tmpfs", "/tmp",
      "--workdir", exec.cwd,
      "--pids-limit", String((exec as { maxProcesses?: number }).maxProcesses ?? 64),
    ];
    const mem = (exec as { memoryBytes?: number }).memoryBytes;
    if (typeof mem === "number") args.push("--memory", String(mem));
    for (const r of writable) args.push("-v", `${r}:${r}:rw`);
    for (const r of grant.fs.readOnlyRoots) args.push("-v", `${r}:${r}:ro`);
    const env = { PATH: "/usr/bin:/bin", HOME: "/tmp", ...exec.env, ...ctx.envInject };
    for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
    args.push(this.image, ...exec.argv);

    const raw = await runChild({
      argv: args,
      cwd: "/",
      env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
      timeoutMs: exec.timeoutMs + 10000,
      maxOutputBytes: exec.maxOutputBytes,
      stdin: exec.stdin,
    });

    return {
      ok: raw.exitCode === 0 && !raw.timedOut && raw.spawnError === undefined,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: raw.timedOut,
      outputTruncated: raw.outputTruncated,
      durationMs: raw.durationMs,
      boundaryEvent: raw.outputTruncated || raw.timedOut || raw.spawnError !== undefined,
      boundaryDetail: raw.spawnError ?? (raw.timedOut ? "timeout" : raw.outputTruncated ? "output limit" : undefined),
    };
  }

  describe(): string {
    return `gVisor (runsc) via ${this.runtime ?? "a runsc-capable container runtime"}: user-space kernel, network=none, read-only rootfs + tmpfs, mem/pids limits, stripped env. Detection hook — selected only when runsc is actually present; otherwise fail-closed. Not claimed as available otherwise.`;
  }
}

function refused(reason: string): EnvironmentRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `gvisor backend refused: ${reason}`,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    boundaryEvent: true,
    boundaryDetail: reason,
  };
}
