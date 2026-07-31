/**
 * Container backend (Tier 2) — used when a container runtime is present.
 *
 * Provides a hard kernel boundary via a disposable container with no network,
 * a read-only rootfs, tmpfs scratch, resource limits, and stripped env.
 *
 * Phase 3 ships this as a DETECTED optional backend: if no container runtime
 * is installed it reports unavailable and the policy layer selects another
 * backend or fails closed. It is never a silent fallback to host execution.
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
  kernelBoundary: true,
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

export class ContainerBackend implements EnvironmentBackend {
  readonly id = "container-docker";
  readonly placement = "container" as const;
  readonly guarantees = GUARANTEES;
  readonly enforcement = ENFORCEMENT;

  private runtime: "docker" | "podman" | null = null;
  private readonly image: string;

  constructor(opts?: { image?: string }) {
    this.image = opts?.image ?? process.env.XR_TRUST_DOCKER_IMAGE ?? "debian:stable-slim";
  }

  async detect(): Promise<boolean> {
    for (const rt of ["docker", "podman"] as const) {
      const info = await runChild({
        argv: [rt, "info"],
        cwd: "/",
        env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
        timeoutMs: 8000,
        maxOutputBytes: 8192,
      });
      if (info.exitCode === 0) {
        this.runtime = rt;
        return true;
      }
    }
    this.runtime = null;
    return false;
  }

  async run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    if (!this.runtime) return refused("no container runtime available");
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
      "--network", "none",
      "--read-only",
      "--tmpfs", "/tmp",
      "--workdir", exec.cwd,
      "--pids-limit", String((exec as { maxProcesses?: number }).maxProcesses ?? 64),
    ];
    const mem = (exec as { memoryBytes?: number }).memoryBytes;
    if (typeof mem === "number") args.push("--memory", String(mem));
    const cpu = (exec as { cpuSeconds?: number }).cpuSeconds;
    if (typeof cpu === "number") args.push("--cpus", String(Math.max(1, Math.ceil(cpu / 60))));
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
    return `Container runtime (${this.runtime ?? "none detected"}): disposable container, network=none, read-only rootfs + tmpfs, mem/cpu/pids limits, stripped env, granted volumes only. Hard kernel boundary when the runtime is present and healthy.`;
  }
}

function refused(reason: string): EnvironmentRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `container backend refused: ${reason}`,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    boundaryEvent: true,
    boundaryDetail: reason,
  };
}
