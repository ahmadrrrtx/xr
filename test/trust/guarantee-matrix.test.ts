/**
 * Phase 4 · T2 — guarantee-matrix generator tests.
 *
 * The matrix must be a MACHINE OUTPUT of live host probes — never prose.
 * These tests assert:
 *   · the generated rows are CONSISTENT with the live EnvironmentManager
 *     capabilities and the policy decision on THIS host (the matrix is
 *     per-host by design: a host with Docker selects `container`, a host
 *     without one selects `namespace_sandbox` or fails closed — the test
 *     never assumes which);
 *   · the matrix never claims a kernel boundary for a backend that does not
 *     provide one (no unsupported claim);
 *   · tier2 action classes with no backend report fail-closed=true;
 *   · the committed docs/security/GUARANTEE_MATRIX.md is machine-generated
 *     and structurally complete (cross-host rows legitimately differ, so the
 *     drift guard checks structure + provenance markers, not row equality).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildMatrix } from "../../scripts/guarantee-matrix.ts";
import { EnvironmentManager } from "../../src/runtime/trust/environment/manager.ts";
import { InProcessBackend } from "../../src/runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../src/runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../../src/runtime/trust/environment/namespace.ts";
import { ContainerBackend } from "../../src/runtime/trust/environment/container.ts";
import { GVisorBackend } from "../../src/runtime/trust/environment/gvisor.ts";
import { FirecrackerBackend } from "../../src/runtime/trust/environment/firecracker.ts";
import { CredentialBroker } from "../../src/runtime/trust/credentials.ts";
import { decidePlacementForTier } from "../../src/runtime/trust/policy.ts";

describe("Phase 4 · T2 — guarantee matrix from live probes", () => {
  test("rows are consistent with the live policy decision on THIS host", async () => {
    const m = await buildMatrix();
    // Cross-check against a directly probed manager + the policy decision.
    const manager = new EnvironmentManager(
      [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(),
       new ContainerBackend(), new GVisorBackend(), new FirecrackerBackend()],
      new CredentialBroker(),
    );
    await manager.init();
    const caps = manager.capabilities();

    for (const row of m.rows) {
      const decision = decidePlacementForTier(row.riskTier, caps, { hardened: true });
      const expectedPlacement =
        decision.kind === "admitted" ? decision.placement :
        decision.kind === "in_process_ok" ? "in_process" :
        "BLOCKED (fail-closed)";
      expect(row.placement).toBe(expectedPlacement);
      expect(row.failClosed).toBe(decision.kind === "blocked");
    }

    // Spot-check: shell (tier2) is never in-process and never blocked when a
    // kernel boundary exists.
    const shellRow = m.rows.find((r) => r.actionClass === "shell / arbitrary code")!;
    expect(["namespace_sandbox", "container", "gvisor", "firecracker", "BLOCKED (fail-closed)"]).toContain(
      shellRow.placement,
    );
    if (shellRow.placement === "BLOCKED (fail-closed)") {
      expect(caps.namespaceSandbox || caps.container || caps.gvisor || caps.firecracker).toBe(false);
    } else {
      expect(shellRow.kernelBoundary).toBe(true);
    }
  });

  test("no unsupported claim: a backend that reports no kernel boundary never shows one", async () => {
    const m = await buildMatrix();
    for (const row of m.rows) {
      if (row.placement === "in_process" || row.placement === "restricted_process") {
        expect(row.kernelBoundary).toBe(false);
        expect(row.enforcedFilesystem).toBe(false);
        expect(row.enforcedNetwork).toBe(false);
        expect(row.enforcedProcess).toBe(false);
      }
      if (row.placement === "namespace_sandbox" || row.placement === "container") {
        expect(row.kernelBoundary).toBe(true);
      }
    }
  });

  test("tier2 with NO enforceable backend reports fail-closed=true", async () => {
    const manager = new EnvironmentManager(
      [new InProcessBackend(), new RestrictedProcessBackend()], // no kernel boundary
      new CredentialBroker(),
    );
    await manager.init();
    // Simulate what the matrix would report: policy with only in-process +
    // restricted available must BLOCK tier2.
    const decision = decidePlacementForTier("tier2_isolated", manager.capabilities(), { hardened: true });
    expect(decision.kind).toBe("blocked");
  });

  test("backends list matches the manager's live availability", async () => {
    const m = await buildMatrix();
    const manager = new EnvironmentManager(
      [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(),
       new ContainerBackend(), new GVisorBackend(), new FirecrackerBackend()],
      new CredentialBroker(),
    );
    await manager.init();
    for (const b of m.backends) {
      const live = manager.listBackends().find((x) => x.id === b.id);
      expect(live).toBeDefined();
      expect(b.available).toBe(live!.available);
    }
  });

  test("committed matrix doc is machine-generated and structurally complete (drift guard)", async () => {
    const path = join(import.meta.dir, "..", "..", "docs", "security", "GUARANTEE_MATRIX.md");
    if (!existsSync(path)) return; // not yet committed — regenerated in CI
    const committed = readFileSync(path, "utf8");

    // Provenance markers: machine-generated, per-host, honest-limitations.
    expect(committed).toContain("Generated from live host probes");
    expect(committed).toContain("machine output, not prose");
    expect(committed).toContain("Honest limitations");

    // Structural completeness: every action class the generator emits appears
    // as a well-formed row; every column header is present.
    const headers = [
      "Action class", "Risk tier", "Placement", "Kernel boundary",
      "FS enforced", "Network enforced", "Process enforced",
      "No ambient authority", "Fail-closed",
    ];
    for (const h of headers) expect(committed).toContain(h);

    const m = await buildMatrix();
    for (const r of m.rows) {
      // Row exists with the action class and tier (placement differs per
      // host by design, so it is NOT compared).
      expect(committed).toContain(`| ${r.actionClass} | ${r.riskTier} |`);
    }
  });
});
