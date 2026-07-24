import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { verifyEnvironment } from "../../src/trust/verify.ts";
import { NO_ENFORCEMENT } from "../../src/trust/resources.ts";
import type { EnvironmentBackend } from "../../src/trust/environment/backend.ts";
import type { EnvironmentExecutable, PlacementGuarantees, PlacementKind } from "../../src/trust/types.ts";
import { makeGrant } from "./_helpers.ts";

function fakeBackend(g: PlacementGuarantees, placement: PlacementKind = "namespace_sandbox"): EnvironmentBackend {
  return {
    id: "fake",
    placement,
    guarantees: g,
    enforcement: { ...NO_ENFORCEMENT },
    async detect() {
      return true;
    },
    async run() {
      return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, outputTruncated: false, durationMs: 0, boundaryEvent: false };
    },
    describe() {
      return "fake backend";
    },
  };
}

const STRONG: PlacementGuarantees = {
  kernelBoundary: true,
  enforcedFilesystem: true,
  enforcedNetwork: true,
  enforcedProcess: true,
  noAmbientAuthority: true,
};

const exec: EnvironmentExecutable = { argv: ["sh", "-c", "true"], cwd: "/tmp/ws", env: {}, timeoutMs: 1000, maxOutputBytes: 1000 };

describe("XR 4.2 isolation verification (fail closed)", () => {
  test("strong backend + contained cwd + net=none verifies for Tier 2", () => {
    const grant = makeGrant();
    const v = verifyEnvironment({ backend: fakeBackend(STRONG), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(true);
    expect(v.actualPlacement).toBe("namespace_sandbox");
  });

  test("placement mismatch fails verification", () => {
    const grant = makeGrant();
    const v = verifyEnvironment({ backend: fakeBackend(STRONG, "container"), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "placement_matches_decision")?.ok).toBe(false);
  });

  test("Tier 2 on a backend without a kernel boundary fails verification", () => {
    const weak: PlacementGuarantees = { ...STRONG, kernelBoundary: false };
    const grant = makeGrant();
    const v = verifyEnvironment({ backend: fakeBackend(weak), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "tier2_kernel_boundary")?.ok).toBe(false);
  });

  test("cwd outside the granted writable roots fails verification", () => {
    const grant = makeGrant();
    const badExec = { ...exec, cwd: "/etc" };
    const v = verifyEnvironment({ backend: fakeBackend(STRONG), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec: badExec, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "cwd_within_grant")?.ok).toBe(false);
  });

  test("a granted path hitting a blocked sensitive path fails verification", () => {
    const ssh = `${homedir()}/.ssh`;
    const grant = makeGrant({ fs: { writableRoots: [ssh], readOnlyRoots: [], blockedPaths: [ssh], ephemeralScratch: true } });
    const e = { ...exec, cwd: ssh };
    const v = verifyEnvironment({ backend: fakeBackend(STRONG), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec: e, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "no_blocked_paths")?.ok).toBe(false);
  });

  test("a Tier-2 network ALLOWLIST is not enforceable by local backends → fails closed", () => {
    const grant = makeGrant({ net: { mode: "allowlist", allowlist: ["api.example.com"], blockPrivateNetworks: true, blockOffAllowlistRedirects: true } });
    const v = verifyEnvironment({ backend: fakeBackend(STRONG), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec, grant, credentialsSatisfied: true });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "network_allowlist_enforceable")?.ok).toBe(false);
  });

  test("missing required credentials fails verification", () => {
    const grant = makeGrant({ credentials: { mode: "task_scoped", refs: [], envNames: [] } });
    const v = verifyEnvironment({ backend: fakeBackend(STRONG), expectedPlacement: "namespace_sandbox", tier: "tier2_isolated", exec, grant, credentialsSatisfied: false });
    expect(v.verified).toBe(false);
    expect(v.checks.find((c) => c.name === "credentials_satisfied")?.ok).toBe(false);
  });
});
