/**
 * XR Phase 8 · XR801 — capability grant artifacts.
 *
 * Mint / verify / consume; args-hash mismatch, ttl expiry, replay.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  mintGrant,
  bindGrant,
  verifyAndConsumeGrant,
  canonicalArgsHash,
  _resetGrantRegistry,
  DEFAULT_GRANT_TTL_MS,
} from "../../src/capabilities/grant.ts";
import { runAuthorized } from "../../src/capabilities/authorize.ts";
import type { Tool, ToolContext } from "../../src/core/types.ts";

beforeEach(() => _resetGrantRegistry());

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    cwd: "/tmp",
    approve: async () => true,
    audit: () => {},
    egressAllowlist: [],
    dryRun: false,
    ...overrides,
  };
}

describe("XR801 grant mint/verify", () => {
  test("mint binds a stable args hash (key order independent)", () => {
    const a = mintGrant({ capabilityId: "shell", args: { b: 2, a: 1 } });
    expect(a.argsHash).toBe(canonicalArgsHash({ a: 1, b: 2 }));
    expect(a.issuedBy).toBe("policy-engine");
    expect(a.decision).toBe("allow");
    expect(a.ttlMs).toBe(DEFAULT_GRANT_TTL_MS);
  });

  test("single-char mutation of args ⇒ mismatch deny", () => {
    const g = mintGrant({ capabilityId: "shell", args: { command: "ls" } });
    const r = bindGrant(g, { command: "lS" }, { capabilityId: "shell" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("mismatch");
  });

  test("ttl expiry ⇒ expired deny", () => {
    const g = mintGrant({ capabilityId: "shell", args: { command: "ls" }, ttlMs: 10, now: 1_000 });
    const r = bindGrant(g, { command: "ls" }, { now: 1_000 + 11 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("expired");
  });

  test("replay after consume ⇒ deny", () => {
    const g = mintGrant({ capabilityId: "read_file", args: { path: "a.txt" } });
    const first = verifyAndConsumeGrant(g, { path: "a.txt" }, { capabilityId: "read_file" });
    expect(first.ok).toBe(true);
    const second = verifyAndConsumeGrant(g, { path: "a.txt" }, { capabilityId: "read_file" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("replay");
  });

  test("missing / forged grantId ⇒ missing deny", () => {
    const r = bindGrant(undefined, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing");
    const forged = mintGrant({ capabilityId: "x", args: {} });
    _resetGrantRegistry();
    const r2 = bindGrant(forged, {});
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe("missing");
  });

  test("capabilityId scope mismatch ⇒ scope deny", () => {
    const g = mintGrant({ capabilityId: "shell", args: { command: "ls" } });
    const r = bindGrant(g, { command: "ls" }, { capabilityId: "delete" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("scope");
  });
});

describe("XR802 runAuthorized choke point", () => {
  const tool: Tool = {
    name: "shell",
    description: "t",
    parameters: {},
    requiresApproval: false,
    async run() {
      return { ok: true, output: "ran" };
    },
  };

  test("no grant ⇒ tool does not run", async () => {
    let ran = false;
    const t: Tool = { ...tool, async run() { ran = true; return { ok: true, output: "ran" }; } };
    const r = await runAuthorized(t, { command: "ls" }, ctx(), undefined);
    expect(r.ok).toBe(false);
    expect(r.output).toContain("grant missing");
    expect(ran).toBe(false);
  });

  test("matching grant ⇒ tool runs once; replay denied", async () => {
    const args = { command: "ls" };
    const g = mintGrant({ capabilityId: "shell", args });
    const r1 = await runAuthorized(tool, args, ctx(), g, { capabilityId: "shell" });
    expect(r1.ok).toBe(true);
    expect(r1.output).toBe("ran");
    const r2 = await runAuthorized(tool, args, ctx(), g, { capabilityId: "shell" });
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain("replay");
  });

  test("mutated args at exec ⇒ mismatch, no side effect", async () => {
    let ran = false;
    const t: Tool = { ...tool, async run() { ran = true; return { ok: true, output: "ran" }; } };
    const g = mintGrant({ capabilityId: "shell", args: { command: "ls" } });
    const r = await runAuthorized(t, { command: "rm -rf /" }, ctx(), g, { capabilityId: "shell" });
    expect(r.ok).toBe(false);
    expect(r.output).toContain("mismatch");
    expect(ran).toBe(false);
  });
});
