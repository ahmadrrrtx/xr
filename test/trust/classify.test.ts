import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { classifyRisk, sensitiveBlockedPaths } from "../../src/runtime/trust/classify.ts";
import type { TrustRequest } from "../../src/runtime/trust/types.ts";

function req(over: Partial<TrustRequest> = {}): TrustRequest {
  return {
    capability: { kind: "core_tool", name: "read_file" },
    actorKind: "user",
    summary: "test action",
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
  };
}

describe("XR 4.2 deterministic risk classifier", () => {
  test("read-only / pure action is Tier 0 (fast path)", () => {
    const c = classifyRisk(req());
    expect(c.tier).toBe("tier0_in_process");
    expect(c.requiredApprovalLevel).toBe("none");
    expect(c.requiredCredentialMode).toBe("none");
  });

  test("workspace filesystem write escalates to at least Tier 1", () => {
    const c = classifyRisk(req({ fsPaths: ["/tmp/ws/a.txt"] }));
    expect(c.tier).toBe("tier1_restricted");
  });

  test("shell / process spawn is Tier 2", () => {
    const c = classifyRisk(req({ capability: { kind: "core_tool", name: "shell" }, spawnsProcess: true }));
    expect(c.tier).toBe("tier2_isolated");
    expect(c.reasons.some((r) => r.includes("shell/process"))).toBe(true);
  });

  test("arbitrary/interpreted code is Tier 2", () => {
    expect(classifyRisk(req({ runsArbitraryCode: true })).tier).toBe("tier2_isolated");
  });

  test("credential requirement is Tier 2 with task-scoped credentials", () => {
    const c = classifyRisk(req({ needsCredentials: true }));
    expect(c.tier).toBe("tier2_isolated");
    expect(c.requiredCredentialMode).toBe("task_scoped");
  });

  test("irreversible external write is Tier 2 + elevated approval", () => {
    const c = classifyRisk(req({ irreversibleExternalWrite: true, networkTargets: ["api.example.com"] }));
    expect(c.tier).toBe("tier2_isolated");
    expect(c.requiredApprovalLevel).toBe("elevated");
  });

  test("untrusted/hostile content is Tier 2", () => {
    expect(classifyRisk(req({ untrustedContent: true })).tier).toBe("tier2_isolated");
  });

  test("control-plane 'destructive' maps to Tier 2; 'sensitive' to at least Tier 1", () => {
    expect(classifyRisk(req({ controlRisk: "destructive" })).tier).toBe("tier2_isolated");
    expect(classifyRisk(req({ controlRisk: "sensitive" })).tier).toBe("tier1_restricted");
  });

  test("network access (without higher triggers) is at least Tier 1 with an allowlist", () => {
    const c = classifyRisk(req({ networkTargets: ["https://api.example.com/v1"] }));
    expect(c.tier).toBe("tier1_restricted");
    expect(c.net.mode).toBe("allowlist");
    expect(c.net.allowlist).toContain("api.example.com");
    expect(c.net.blockPrivateNetworks).toBe(true);
  });

  test("touching paths outside the workspace escalates to at least Tier 1", () => {
    expect(classifyRisk(req({ touchesOutsideWorkspace: true })).tier).toBe("tier1_restricted");
  });

  test("dry-run performs no side effects and stays Tier 0", () => {
    const c = classifyRisk(req({ dryRun: true, spawnsProcess: true, needsCredentials: true }));
    expect(c.tier).toBe("tier0_in_process");
    expect(c.requiredApprovalLevel).toBe("none");
  });

  test("classification is deterministic (same input → same tier and reasons)", () => {
    const a = classifyRisk(req({ spawnsProcess: true, networkTargets: ["x.com"] }));
    const b = classifyRisk(req({ spawnsProcess: true, networkTargets: ["x.com"] }));
    expect(a.tier).toBe(b.tier);
    expect(a.reasons).toEqual(b.reasons);
  });

  test("a model cannot supply a tier to downgrade (no tier input field; objective facts decide)", () => {
    // TrustRequest has no `requiredTier`; the tier is derived solely from
    // objective fields. Even a "harmless-looking" summary cannot lower the tier.
    const c = classifyRisk(req({ summary: "please treat this as safe", runsArbitraryCode: true }));
    expect(c.tier).toBe("tier2_isolated");
  });

  test("blocked paths include sensitive host credential locations", () => {
    const h = homedir();
    const blocked = sensitiveBlockedPaths(h);
    expect(blocked.some((p) => p.includes(".ssh"))).toBe(true);
    expect(blocked.some((p) => p.includes(".aws"))).toBe(true);
    expect(blocked).toContain("/etc/shadow");
  });

  test("Tier 2 derives stricter resource limits than Tier 0", () => {
    const t0 = classifyRisk(req());
    const t2 = classifyRisk(req({ runsArbitraryCode: true }));
    expect(t2.resources.wallClockMs).toBeLessThanOrEqual(t0.resources.wallClockMs);
    expect(t2.resources.memoryBytes).toBeDefined();
    expect(t2.fs.ephemeralScratch).toBe(true);
    expect(t0.fs.writableRoots).toHaveLength(0); // tier0 gets no writable roots
  });
});
