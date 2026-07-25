import { describe, expect, test } from "bun:test";
import { classifyRisk } from "../../src/trust/classify.ts";
import { decidePlacement, type PlacementCapabilities } from "../../src/trust/policy.ts";
import type { TrustRequest } from "../../src/trust/types.ts";

function caps(over: Partial<PlacementCapabilities> = {}): PlacementCapabilities {
  return {
    inProcess: true,
    restrictedProcess: true,
    namespaceSandbox: true,
    container: false,
    browserIsolated: false,
    isRoot: false,
    ...over,
  };
}

function classify(over: Partial<TrustRequest>) {
  return classifyRisk({
    capability: { kind: "core_tool", name: "x" },
    actorKind: "user",
    summary: "s",
    spawnsProcess: false,
    runsArbitraryCode: false,
    networkTargets: [],
    fsPaths: [],
    touchesOutsideWorkspace: false,
    needsCredentials: false,
    reversible: true,
    irreversibleExternalWrite: false,
    untrustedContent: false,
    dryRun: false,
    workspaceRoot: "/tmp/ws",
    ...over,
  });
}

describe("XR 4.2 policy-to-placement (fail closed)", () => {
  test("Tier 0 always uses the fast in-process path", () => {
    const d = decidePlacement(classify({}), caps());
    expect(d.kind).toBe("in_process_ok");
    expect(d.placement).toBe("in_process");
  });

  test("Tier 2 selects the namespace sandbox when available", () => {
    const d = decidePlacement(classify({ runsArbitraryCode: true }), caps());
    expect(d.kind).toBe("admitted");
    expect(d.placement).toBe("namespace_sandbox");
  });

  test("Tier 2 selects a container when only a container is available", () => {
    const d = decidePlacement(classify({ runsArbitraryCode: true }), caps({ namespaceSandbox: false, container: true }));
    expect(d.kind).toBe("admitted");
    expect(d.placement).toBe("container");
  });

  test("preferContainer chooses container when both are available", () => {
    const d = decidePlacement(classify({ runsArbitraryCode: true }), caps({ container: true }), { preferContainer: true });
    expect(d.placement).toBe("container");
  });

  test("Tier 2 with NO enforceable backend is BLOCKED (never silently in-process)", () => {
    const d = decidePlacement(classify({ runsArbitraryCode: true }), caps({ namespaceSandbox: false, container: false }));
    expect(d.kind).toBe("blocked");
    expect(d.placement).toBe("in_process"); // requested fallback target, but NOT admitted
    expect(d.remediation).toContain("bubblewrap");
  });

  test("Tier 1 uses the restricted process when available", () => {
    const d = decidePlacement(classify({ fsPaths: ["/tmp/ws/a"] }), caps());
    expect(d.kind).toBe("admitted");
    expect(d.placement).toBe("restricted_process");
  });

  test("Tier 1 without a process sandbox fails closed by default", () => {
    const d = decidePlacement(classify({ fsPaths: ["/tmp/ws/a"] }), caps({ restrictedProcess: false, namespaceSandbox: false, container: false }));
    expect(d.kind).toBe("blocked");
  });

  test("Tier 1 may use an explicit, logged in-process fallback only when enabled", () => {
    const d = decidePlacement(classify({ fsPaths: ["/tmp/ws/a"] }), caps({ restrictedProcess: false, namespaceSandbox: false, container: false }), {
      allowTier1InProcessFallback: true,
    });
    expect(d.kind).toBe("admitted");
    expect(d.placement).toBe("in_process");
    expect(d.reason).toContain("DEGRADED");
  });

  test("running as root voids restricted/isolated placement (refused)", () => {
    const d = decidePlacement(classify({ runsArbitraryCode: true }), caps({ isRoot: true }));
    expect(d.kind).toBe("blocked");
    expect(d.reason).toContain("root");
  });

  test("the decision for Tier 2 is NEVER an admitted in_process placement", () => {
    for (const ns of [true, false]) {
      for (const ct of [true, false]) {
        const d = decidePlacement(classify({ spawnsProcess: true }), caps({ namespaceSandbox: ns, container: ct }));
        if (d.kind === "admitted") {
          expect(d.placement).not.toBe("in_process");
        } else {
          expect(d.kind).toBe("blocked");
        }
      }
    }
  });
});
