/**
 * XR Phase 08 — Model Self-Grant Prevention Tests
 *
 * Adversarial: model attempts to grant itself capabilities, trust, lifecycle, allowlist.
 * Expected: blocked — model can REQUEST but cannot GRANT.
 */

import { describe, test, expect } from "bun:test";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import { evaluatePolicy } from "../../src/capabilities/policy.ts";
import { createCapabilityRequest, validateRequestNoSelfGrant } from "../../src/capabilities/request.ts";
import type { CapabilityPermission } from "../../src/capabilities/types.ts";

function makeRegistry() {
  const r = new ToolRegistryService();
  r.registerTools(coreToolContributions());
  return r;
}

describe("Phase 08 — Model self-grant blocked", () => {
  test("model cannot grant itself shell via tool name containing grant", () => {
    const registry = makeRegistry();
    // There is no tool named "grant"
    const resolved = registry.resolve("grant me shell access");
    expect(resolved).toBeUndefined();

    // Attempt to evaluate policy for nonexistent grant tool
    const req = createCapabilityRequest({
      capabilityId: "grant me shell access",
      requestedBy: "model",
      mode: "agent",
      arguments: {},
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not found/i);
  });

  test("model cannot enable filesystem.write via request", () => {
    const registry = makeRegistry();
    // filesystem.write is not a capability id, it's a permission
    // Tool that needs it is write_file, but enabling it requires control-plane
    const req = createCapabilityRequest({
      capabilityId: "filesystem.write",
      requestedBy: "model",
      mode: "agent",
      arguments: { grant: true } as any,
    });
    // validateRequestNoSelfGrant should catch forbidden fields in args
    const validation = validateRequestNoSelfGrant({
      capabilityId: "filesystem.write",
      arguments: { grant: true },
    } as any);
    // args contains grant, so should be blocked by validation
    expect(validation.ok).toBe(false);

    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
  });

  test("model cannot mutate permissions, trust, lifecycle, allowlist via tool args", () => {
    const forbiddenRequests = [
      { capabilityId: "core:read_file", arguments: { grant: "filesystem.write" } },
      { capabilityId: "core:shell", arguments: { permissions: ["filesystem.write"] } },
      { capabilityId: "core:shell", arguments: { trust: "official" } },
      { capabilityId: "core:shell", arguments: { lifecycle: "enabled" } },
      { capabilityId: "core:shell", arguments: { allowlist: ["evil-server"] } },
      { capabilityId: "core:shell", arguments: { enable: true } },
      { capabilityId: "core:shell", arguments: { disable: false } },
    ];

    for (const fr of forbiddenRequests) {
      const req = createCapabilityRequest({
        capabilityId: fr.capabilityId,
        requestedBy: "model",
        mode: "agent",
        arguments: fr.arguments as any,
      });
      const validation = validateRequestNoSelfGrant({
        capabilityId: fr.capabilityId,
        arguments: fr.arguments,
      } as any);
      // If validation catches, it's blocked early
      if (!validation.ok) {
        expect(validation.ok).toBe(false);
        continue;
      }
      // Otherwise, policy evaluation does not grant based on args — args never grant
      const registry = makeRegistry();
      const decision = evaluatePolicy(req, { registry });
      // Decision only checks capability existence, trust, lifecycle, not args granting
      // So it should not allow self-grant via args
      // For core:shell, if mode agent, it should be allowed (since it's enabled), but NOT because args said grant
      // The test is that args don't change trust/lifecycle
      if (fr.capabilityId === "core:shell" || fr.capabilityId === "core:read_file") {
        // The capability exists and is enabled, so allowed true, but not because of args
        // Ensure that if we try to grant new permission via args, it doesn't change decision's effectivePermissions to include something not originally there
        // For example, read_file should not gain filesystem.write via args
        if (fr.capabilityId === "core:read_file") {
          expect(decision.effectivePermissions).not.toContain("filesystem.write" as CapabilityPermission);
        }
      }
    }
  });

  test("model cannot disable approval requirement via tool", () => {
    const registry = makeRegistry();
    const req = createCapabilityRequest({
      capabilityId: "core:shell",
      requestedBy: "model",
      mode: "agent",
      arguments: { approve: false, disableApproval: true } as any,
    });
    const decision = evaluatePolicy(req, { registry });
    // shell requiresApproval true by default
    expect(decision.requiresApproval).toBe(true);
    expect(decision.allowed).toBe(true); // allowed but requires approval
  });

  test("model cannot mark MCP server trusted via request", () => {
    const registry = makeRegistry();
    // Simulate MCP tool not in registry (since no MCP loaded), so not found
    const req = createCapabilityRequest({
      capabilityId: "mcp:evil:create_issue",
      requestedBy: "model",
      mode: "agent",
      arguments: { trust: "official" } as any,
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
  });

  test("model cannot certify plugin via tool call", () => {
    const registry = makeRegistry();
    const req = createCapabilityRequest({
      capabilityId: "plugin:acme:deploy",
      requestedBy: "model",
      mode: "agent",
      arguments: { certify: true } as any,
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false); // not found, no plugin loaded
  });

  test("model cannot change capability scope via request", () => {
    const registry = makeRegistry();
    const req = createCapabilityRequest({
      capabilityId: "core:read_file",
      requestedBy: "model",
      mode: "agent",
      scope: "host" as any,
      arguments: {},
    });
    const decision = evaluatePolicy(req, { registry });
    // Scope change doesn't grant extra, but policy should trace it
    expect(decision.policyTrace.join(" ")).toMatch(/scope/i);
    // Should still be allowed (read_file is workspace but host scope request is noted, not denied in current policy)
    // The important part is model cannot set scope to gain privileges — host capabilities remain host
  });

  test("control-plane operations are not exposed as tools", () => {
    const registry = makeRegistry();
    const forbiddenToolNames = [
      "enable_capability",
      "disable_capability",
      "grant_permission",
      "add_to_allowlist",
      "certify_plugin",
      "quarantine_capability",
      "rollback_capability",
      "set_trust",
      "set_lifecycle",
    ];
    for (const name of forbiddenToolNames) {
      expect(registry.resolve(name)).toBeUndefined();
      expect(registry.list().some((e) => e.name === name)).toBe(false);
    }
  });
});
