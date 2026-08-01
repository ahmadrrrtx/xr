/**
 * XR Phase 4 · T1 — Firecracker backend (detection hook; documented gap).
 *
 * Firecracker is a KVM-based microVM: each workload gets its own guest kernel,
 * so a kernel exploit inside the workload cannot reach the host kernel (the
 * strongest rung of the restrictiveness lattice).
 *
 * PHASE 4 POSTURE (honest): wiring full microVM orchestration (rootfs images,
 * jailer invocation, snapshot pools) is explicitly deferred to Phase 5+.
 * This backend is a detection hook so that:
 *   · the lattice can ORDER firecracker as the strongest placement;
 *   · a host that has jailer + KVM + an operator-provided rootfs can escalate;
 *   · everywhere else it reports unavailable and the policy layer fails closed.
 * It is NEVER claimed as available without the runtime actually present.
 */
import {
  type BackendRunContext,
  type EnvironmentBackend,
  runChild,
} from "./backend.ts";
import { NO_ENFORCEMENT, type ResourceEnforcement } from "../resources.ts";
import type { EnvironmentExecutable, EnvironmentRunResult, PlacementGuarantees } from "../types.ts";

const GUARANTEES: PlacementGuarantees = {
  kernelBoundary: true,       // dedicated guest kernel (KVM)
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

export class FirecrackerBackend implements EnvironmentBackend {
  readonly id = "firecracker";
  readonly placement = "firecracker" as const;
  readonly guarantees = GUARANTEES;
  readonly enforcement = ENFORCEMENT;

  private available = false;

  async detect(): Promise<boolean> {
    // jailer + /dev/kvm + an operator-provided rootfs/kernel are all required.
    const jailer = await runChild({
      argv: ["jailer", "--version"],
      cwd: "/",
      env: { PATH: "/usr/bin:/bin:/usr/local/bin" },
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    if (jailer.exitCode !== 0) {
      this.available = false;
      return false;
    }
    const kvm = await runChild({
      argv: ["test", "-r", "/dev/kvm"],
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    if (kvm.exitCode !== 0) {
      this.available = false;
      return false;
    }
    const image = process.env.XR_TRUST_FIRECRACKER_IMAGE;
    if (!image) {
      // Runtime binaries exist but no operator-provided rootfs → still
      // unavailable; never auto-claim.
      this.available = false;
      return false;
    }
    this.available = true;
    return true;
  }

  async run(_exec: EnvironmentExecutable, _ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    // Phase 4 does not implement microVM orchestration. Fail closed with a
    // precise remediation rather than pretending to run.
    return refused(
      "Firecracker microVM orchestration is not implemented in Phase 4 (deferred to Phase 5+); select a different backend or block the action",
    );
  }

  describe(): string {
    return "Firecracker microVM (jailer + KVM): dedicated guest kernel, strongest lattice rung. Phase 4 = detection hook only; execution deferred to Phase 5+. Never claimed available without jailer + /dev/kvm + XR_TRUST_FIRECRACKER_IMAGE.";
  }
}

function refused(reason: string): EnvironmentRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `firecracker backend refused: ${reason}`,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    boundaryEvent: true,
    boundaryDetail: reason,
  };
}
