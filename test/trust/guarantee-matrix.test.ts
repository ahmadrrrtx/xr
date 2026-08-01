/**
 * Phase 4 · T2 — guarantee-matrix generator tests.
 *
 * The matrix must be a MACHINE OUTPUT of live host probes — never prose.
 * These tests assert:
 *   · the generated rows match the live EnvironmentManager capabilities;
 *   · the matrix never claims a kernel boundary for a backend that does not
 *     provide one (no unsupported claim);
 *   · tier2 action classes with no backend report fail-closed=true;
 *   · the committed docs/security/GUARANTEE_MATRIX.md matches the generator
 *     output (drift guard).
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

describe("Phase 4 · T2 — guarantee matrix from live probes", () => {
  test("rows reflect the live backend detection (not prose)", async () => {
    const m = await buildMatrix();
    // Cross-check against a directly probed manager.
    const manager = new EnvironmentManager(
      [new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend(),
       new ContainerBackend(), new GVisorBackend(), new FirecrackerBackend()],
      new CredentialBroker(),
    );
    await manager.init();
    const caps = manager.capabilities();

    const shellRow = m.rows.find((r) => r.actionClass === "shell / arbitrary code")!;
    if (caps.namespaceSandbox) {
      expect(shellRow.placement).toBe("namespace_sandbox");
      expect(shellRow.kernelBoundary).toBe(true);
      expect(shellRow.failClosed).toBe(false);
    } else {
      expect(shellRow.failClosed).toBe(true);
      expect(shellRow.placement).toBe("BLOCKED (fail-closed)");
    }
    const readRow = m.rows.find((r) => r.actionClass === "read / list in-workspace")!;
    expect(readRow.placement).toBe("in_process");
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
      if (row.placement === "namespace_sandbox") {
        expect(row.kernelBoundary).toBe(true);
      }
    }
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

  test("committed matrix doc is not stale (drift guard)", async () => {
    const path = join(import.meta.dir, "..", "..", "docs", "security", "GUARANTEE_MATRIX.md");
    if (!existsSync(path)) return; // not yet committed — regenerated in CI
    const committed = readFileSync(path, "utf8");
    // Re-run the generator and compare the data rows embedded in the doc.
    const m = await buildMatrix();
    for (const r of m.rows) {
      expect(committed).toContain(`| ${r.actionClass} | ${r.riskTier} | \`${r.placement}\``);
    }
  });
});
