/**
 * XR 4.2 — Environment Manager
 *
 * Owns the lifecycle of local isolation backends: capability detection,
 * selection, execute-with-verification, credential injection/revocation,
 * cleanup, quarantine, health, and shutdown.
 *
 * High-risk execution FAILS CLOSED here: if the selected backend is missing,
 * verification fails, or required credentials are unavailable, the action is
 * refused — never silently run in the host process.
 */
import { randomUUID } from "node:crypto";
import type { CredentialBroker } from "../credentials.ts";
import {
  type AuthorityGrant,
  type CleanupResult,
  type EnvironmentExecutable,
  type EnvironmentRunResult,
  type PlacementDecision,
  type PlacementKind,
  type TrustRecord,
  type VerificationResult,
} from "../types.ts";
import { verifyEnvironment } from "../verify.ts";
import type { EnvironmentBackend } from "./backend.ts";
import type { PlacementCapabilities } from "../policy.ts";
import { placementSpan, endPlacementSpan } from "../../../observability/instrument.ts";
import { xrMetrics } from "../../../observability/metrics.ts";

export interface BackendAvailability {
  id: string;
  placement: PlacementKind;
  available: boolean;
  describe: string;
}

export interface ExecuteInEnvironmentInput {
  decision: PlacementDecision;
  exec: EnvironmentExecutable;
  grant: AuthorityGrant;
}

export interface ExecuteInEnvironmentOutput {
  result: EnvironmentRunResult;
  verification: VerificationResult;
  cleanup: CleanupResult;
  environmentId: string;
  quarantined: boolean;
}

export class EnvironmentManager {
  private readonly availability = new Map<string, boolean>();
  private activeEnvironments = 0;
  private cleanupFailures = 0;
  private quarantinedCount = 0;
  private readonly quarantinedBackends = new Set<string>();
  private ready = false;

  constructor(
    private readonly backends: readonly EnvironmentBackend[],
    private readonly broker: CredentialBroker,
  ) {}

  async init(): Promise<void> {
    if (this.ready) return; // idempotent: detect backends once
    for (const b of this.backends) {
      let ok = false;
      try {
        ok = await b.detect();
      } catch {
        ok = false;
      }
      this.availability.set(b.id, ok);
    }
    this.ready = true;
  }

  capabilities(): PlacementCapabilities {
    const avail = (id: string) => !!this.availability.get(id) && !this.quarantinedBackends.has(id);
    return {
      inProcess: true,
      restrictedProcess: avail("restricted-process"),
      namespaceSandbox: avail("namespace-sandbox"),
      container: avail("container-docker"),
      browserIsolated: false, // browser isolation is integrated via control/browser, not a generic backend here
      gvisor: avail("gvisor-runsc"),
      firecracker: avail("firecracker"),
      isRoot: process.getuid?.() === 0,
    };
  }

  listBackends(): BackendAvailability[] {
    return this.backends.map((b) => ({
      id: b.id,
      placement: b.placement,
      available: !!this.availability.get(b.id) && !this.quarantinedBackends.has(b.id),
      describe: b.describe(),
    }));
  }

  backendFor(placement: PlacementKind): EnvironmentBackend | undefined {
    const b = this.backends.find((x) => x.placement === placement);
    if (!b) return undefined;
    if (!this.availability.get(b.id)) return undefined;
    if (this.quarantinedBackends.has(b.id)) return undefined;
    return b;
  }

  /**
   * Verify, execute, and clean up an action inside its environment. Throws a
   * TrustBlockedError-equivalent via the returned `blocked` field rather than
   * running in-process; the caller records the block on the execution record.
   */
  /**
   * Phase 8 · T2 — placement is observable: one span + bounded metric per
   * decision/outcome (tier, backend, blocked) — never the action payload.
   */
  async executeInEnvironment(input: ExecuteInEnvironmentInput): Promise<
    | { blocked: true; reason: string; remediation?: string; verification?: VerificationResult }
    | { blocked: false; output: ExecuteInEnvironmentOutput }
  > {
    const span = placementSpan({ tier: input.decision.placement });
    const backendId = this.backendFor(input.decision.placement)?.id ?? "none";
    try {
      const out = await this.executeInEnvironmentInner(input);
      if ("blocked" in out && out.blocked) {
        endPlacementSpan(span, { placement: input.decision.placement, backend: backendId, blocked: true, reason: out.reason });
        xrMetrics.placements.inc({ tier: input.decision.placement, backend: backendId, outcome: "blocked" });
      } else {
        endPlacementSpan(span, { placement: input.decision.placement, backend: backendId, blocked: false });
        xrMetrics.placements.inc({ tier: input.decision.placement, backend: backendId, outcome: "ran" });
      }
      return out;
    } catch (err) {
      span.setStatus("error", (err as Error)?.name ?? "Error");
      span.end();
      xrMetrics.placements.inc({ tier: input.decision.placement, backend: backendId, outcome: "error" });
      throw err;
    }
  }

  private async executeInEnvironmentInner(input: ExecuteInEnvironmentInput): Promise<
    | { blocked: true; reason: string; remediation?: string; verification?: VerificationResult }
    | { blocked: false; output: ExecuteInEnvironmentOutput }
  > {
    const { decision, exec, grant } = input;

    if (decision.kind !== "admitted") {
      return { blocked: true, reason: decision.reason, remediation: decision.remediation };
    }

    const backend = this.backendFor(decision.placement);
    if (!backend) {
      return {
        blocked: true,
        reason: `selected placement "${decision.placement}" is not available (fail closed)`,
        remediation: "Install/enable the required isolation backend.",
      };
    }

    // Credential satisfaction check (required refs must resolve).
    const needsCreds = grant.credentials.mode === "task_scoped" || grant.credentials.mode === "workspace";
    const credentialsSatisfied = !needsCreds || grant.credentials.refs.every((r) => this.broker.has(r.refId));

    const verification = verifyEnvironment({
      backend,
      expectedPlacement: decision.placement,
      tier: grant.tier,
      exec,
      grant,
      credentialsSatisfied,
    });
    if (!verification.verified) {
      const failed = verification.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ""}`);
      return {
        blocked: true,
        reason: `isolation verification failed (${failed.join("; ")})`,
        remediation: "Adjust action scope/credentials or provide a backend that satisfies the required guarantees.",
        verification,
      };
    }

    // Inject credentials transiently, run, then ALWAYS revoke.
    const environmentId = `env_${randomUUID().slice(0, 10)}`;
    this.activeEnvironments++;
    const injection = this.broker.prepareInjection(grant.credentials.refs);
    const augmentedExec: EnvironmentExecutable = {
      ...exec,
      // Carry grant limits for backends that enforce them (ulimit/--memory).
      ...({
        cpuSeconds: grant.resources.cpuSeconds,
        memoryBytes: grant.resources.memoryBytes,
        maxProcesses: grant.proc.maxProcesses,
      } as Record<string, unknown>),
    } as EnvironmentExecutable;

    let result: EnvironmentRunResult;
    let quarantined = false;
    try {
      result = await backend.run(augmentedExec, {
        grant,
        envInject: injection.env,
        onBoundary: () => {
          /* boundary events are surfaced via result.boundaryEvent */
        },
      });
    } catch (err) {
      result = {
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `environment execution error: ${err instanceof Error ? err.message : String(err)}`,
        timedOut: false,
        outputTruncated: false,
        durationMs: 0,
        boundaryEvent: true,
        boundaryDetail: "environment threw",
      };
      quarantined = true;
    } finally {
      this.activeEnvironments = Math.max(0, this.activeEnvironments - 1);
    }

    // Cleanup: revoke credentials (ephemeral backends tear themselves down).
    const revoked = this.broker.revoke(grant.credentials.refs);
    // Quarantine on uncertain/boundary states to prevent unsafe reuse.
    if (result.boundaryEvent && backend.placement !== "in_process") {
      // Ephemeral backends are per-run, so we record quarantine of this run and
      // (for repeated failures) could quarantine the backend. We increment a
      // counter; sustained failures can quarantine the backend via quarantine().
      quarantined = true;
      this.quarantinedCount++;
    }

    const cleanup: CleanupResult = {
      state: revoked >= grant.credentials.refs.length ? "succeeded" : "partial",
      processesKilled: result.boundaryEvent ? 1 : 0,
      credentialsRevoked: revoked,
      tempRemoved: true, // ephemeral tmpfs is destroyed with the sandbox
      detail: quarantined ? result.boundaryDetail : undefined,
      finishedAt: Date.now(),
    };
    if (cleanup.state !== "succeeded") this.cleanupFailures++;

    return {
      blocked: false,
      output: { result, verification, cleanup, environmentId, quarantined },
    };
  }

  /** Quarantine a backend (refuse future use) after sustained/serious failure. */
  quarantineBackend(backendId: string, reason: string): void {
    this.quarantinedBackends.add(backendId);
    this.quarantinedCount++;
    void reason;
  }

  health(): {
    ready: boolean;
    backends: BackendAvailability[];
    activeEnvironments: number;
    cleanupFailures: number;
    quarantined: number;
    activeCredentials: number;
  } {
    return {
      ready: this.ready,
      backends: this.listBackends(),
      activeEnvironments: this.activeEnvironments,
      cleanupFailures: this.cleanupFailures,
      quarantined: this.quarantinedCount,
      activeCredentials: this.broker.activeCount(),
    };
  }

  async shutdown(): Promise<void> {
    // Ephemeral backends have no persistent state; revoke any lingering creds.
    this.broker.revokeAll();
    this.activeEnvironments = 0;
  }
}
