import { describe, expect, test } from "bun:test";
import { AuthorityRegistry, createGrant, validateGrant } from "../../src/runtime/trust/authority.ts";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import type { TrustRequest } from "../../src/runtime/trust/types.ts";

const baseReq: TrustRequest = {
  capability: { kind: "core_tool", name: "shell" },
  actorKind: "user",
  summary: "s",
  spawnsProcess: true,
  runsArbitraryCode: false,
  networkTargets: [],
  fsPaths: [],
  touchesOutsideWorkspace: false,
  needsCredentials: false,
  reversible: false,
  irreversibleExternalWrite: false,
  untrustedContent: false,
  dryRun: false,
  workspaceRoot: "/tmp/ws",
};

function grant(over: Partial<Parameters<typeof createGrant>[0]> = {}) {
  return createGrant(
    { actor: "user:u", executionId: "ex_1", correlationId: "ex_1", workspaceId: "ws", capability: "core_tool:shell", ...over },
    classifyRisk(baseReq),
  );
}

describe("XR 4.2 task-scoped authority grants", () => {
  test("a grant is bounded to execution, workspace, tier, and a TTL", () => {
    const g = grant();
    expect(g.grantId).toStartWith("grant_");
    expect(g.executionId).toBe("ex_1");
    expect(g.workspaceId).toBe("ws");
    expect(g.tier).toBe("tier2_isolated");
    expect(g.expiresAt).toBeGreaterThan(g.issuedAt);
    expect(g.revoked).toBe(false);
  });

  test("valid within window for the matching execution + workspace", () => {
    const g = grant();
    expect(validateGrant(g, { executionId: "ex_1", workspaceId: "ws" }).valid).toBe(true);
  });

  test("expired grant is invalid (stale authority)", () => {
    const g = grant({ ttlMs: 1000 });
    expect(validateGrant(g, { executionId: "ex_1", workspaceId: "ws", now: g.expiresAt + 1 }).valid).toBe(false);
  });

  test("grant bound to a different execution is invalid (approval/action mismatch)", () => {
    const g = grant();
    const v = validateGrant(g, { executionId: "ex_OTHER", workspaceId: "ws" });
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("different execution");
  });

  test("grant bound to a different workspace is invalid (workspace switch)", () => {
    const g = grant();
    const v = validateGrant(g, { executionId: "ex_1", workspaceId: "ws_OTHER" });
    expect(v.valid).toBe(false);
    expect(v.reason).toContain("different workspace");
  });

  test("registry revoke invalidates a grant", () => {
    const reg = new AuthorityRegistry();
    const g = grant();
    reg.register(g);
    expect(reg.revoke(g.grantId, "cleanup")).toBe(true);
    expect(validateGrant(g, { executionId: "ex_1", workspaceId: "ws" }).valid).toBe(false);
  });

  test("revokeWorkspace revokes every grant for a workspace only", () => {
    const reg = new AuthorityRegistry();
    const a = grant();
    const b = grant({ executionId: "ex_2", correlationId: "ex_2" });
    const c = grant({ workspaceId: "ws2", executionId: "ex_3", correlationId: "ex_3" });
    reg.register(a);
    reg.register(b);
    reg.register(c);
    const n = reg.revokeWorkspace("ws", "switch");
    expect(n).toBe(2);
    expect(a.revoked).toBe(true);
    expect(b.revoked).toBe(true);
    expect(c.revoked).toBe(false);
  });

  test("prune drops expired/revoked grants", () => {
    const reg = new AuthorityRegistry();
    const g = grant({ ttlMs: 1 });
    reg.register(g);
    reg.revoke(g.grantId, "x");
    expect(reg.prune()).toBe(1);
    expect(reg.activeCount()).toBe(0);
  });
});
