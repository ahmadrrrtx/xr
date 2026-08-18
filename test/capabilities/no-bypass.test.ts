/**
 * XR Phase 08 — No Bypass Tests
 *
 * Prove that core, skill, plugin, MCP, computer, web capabilities all pass
 * through the same policy boundary (ToolRegistryService + evaluatePolicy).
 */

import { describe, test, expect } from "bun:test";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import { evaluatePolicy } from "../../src/capabilities/policy.ts";
import { createCapabilityRequest } from "../../src/capabilities/request.ts";
import type { CapabilityMetadata } from "../../src/tools/registry-types.ts";

function makeRegistryWithExtras() {
  const registry = new ToolRegistryService();
  // Core
  const core = coreToolContributions();
  const coreMeta: Record<string, CapabilityMetadata> = {};
  for (const t of core.tools) {
    coreMeta[t.name] = {
      lifecycle: "enabled",
      trustLevel: "official",
      scope: "workspace",
      permissions: [t.name.includes("write") ? "filesystem.write" : "filesystem.read"] as any,
      riskTier: "tier0",
      providerId: "core",
      version: "core",
    };
  }
  registry.registerTools({ ...core, metadata: coreMeta });

  // Fake plugin
  const pluginTool = {
    name: "deploy",
    description: "Deploy plugin tool",
    parameters: {},
    requiresApproval: true,
    async run() {
      return { ok: true, output: "deployed" };
    },
  } as any;
  registry.registerTools({
    kind: "plugin",
    source: "acme",
    tools: [pluginTool],
    metadata: {
      deploy: {
        lifecycle: "enabled",
        trustLevel: "community",
        scope: "shared",
        permissions: ["filesystem.write", "network.fetch"] as any,
        riskTier: "tier1",
        providerId: "plugin:acme",
        version: "1.0.0",
      },
    },
  });

  // Fake MCP
  const mcpTool = {
    name: "create_issue",
    description: "Create issue",
    parameters: {},
    requiresApproval: true,
    async run() {
      return { ok: true, output: "issue created" };
    },
  } as any;
  registry.registerTools({
    kind: "mcp",
    source: "github",
    tools: [mcpTool],
    metadata: {
      create_issue: {
        lifecycle: "enabled",
        trustLevel: "community",
        scope: "shared",
        permissions: ["mcp.execute"] as any,
        riskTier: "tier1",
        providerId: "mcp:github",
        version: "1.0.0",
      },
    },
  });

  return registry;
}

describe("Phase 08 — No bypass: all sources → policy", () => {
  test("core → policy", () => {
    const registry = makeRegistryWithExtras();
    const req = createCapabilityRequest({
      capabilityId: "read_file",
      requestedBy: "model",
      mode: "agent",
      arguments: { path: "test.txt" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(true);
    expect(decision.policyTrace.some((t) => t.includes("resolve"))).toBe(true);
    expect(decision.policyTrace.some((t) => t.includes("trust"))).toBe(true);
    expect(decision.policyTrace.some((t) => t.includes("lifecycle"))).toBe(true);
  });

  test("plugin → policy (with metadata)", () => {
    const registry = makeRegistryWithExtras();
    const req = createCapabilityRequest({
      capabilityId: "plugin:acme:deploy",
      requestedBy: "model",
      mode: "agent",
      arguments: { env: "prod" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(true);
    expect(decision.effectivePermissions).toContain("filesystem.write" as any);
  });

  test("MCP → policy (with metadata)", () => {
    const registry = makeRegistryWithExtras();
    const req = createCapabilityRequest({
      capabilityId: "mcp:github:create_issue",
      requestedBy: "model",
      mode: "agent",
      arguments: { title: "bug" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(true);
    expect(decision.effectivePermissions).toContain("mcp.execute" as any);
  });

  test("computer → policy (core computer_control)", () => {
    const registry = makeRegistryWithExtras();
    const req = createCapabilityRequest({
      capabilityId: "computer_control",
      requestedBy: "model",
      mode: "agent",
      arguments: { task: "open browser" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
  });

  test("web → policy (core fetch_url)", () => {
    const registry = makeRegistryWithExtras();
    const req = createCapabilityRequest({
      capabilityId: "fetch_url",
      requestedBy: "model",
      mode: "agent",
      arguments: { url: "https://example.com" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(true);
  });

  test("skill → policy: skills are NOT directly executable", () => {
    const registry = makeRegistryWithExtras();
    // Skills are prompt contributions, no run(), stored separately
    // So resolving a skill id should fail
    const req = createCapabilityRequest({
      capabilityId: "skill:writing",
      requestedBy: "model",
      mode: "agent",
      arguments: {},
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
  });

  test("disabled capability cannot execute even if model requests", () => {
    const registry = makeRegistryWithExtras();
    // Disable a core tool via lifecycle
    registry.setLifecycle("core:read_file", "disabled", "test");
    const req = createCapabilityRequest({
      capabilityId: "read_file",
      requestedBy: "model",
      mode: "agent",
      arguments: { path: "test.txt" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/disabled/i);
  });

  test("quarantined capability cannot execute", () => {
    const registry = makeRegistryWithExtras();
    registry.setLifecycle("core:shell", "quarantined", "security");
    const req = createCapabilityRequest({
      capabilityId: "shell",
      requestedBy: "model",
      mode: "agent",
      arguments: { cmd: "ls" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/quarantined/i);
  });

  test("discovery and execution use identical policy rules", () => {
    const registry = makeRegistryWithExtras();
    registry.setLifecycle("core:write_file", "disabled");

    // Discovery should hide disabled
    const discovered = registry.discover({ mode: "agent" as any });
    expect(discovered.some((t) => t.name === "write_file")).toBe(false);

    // Execution should also block
    const req = createCapabilityRequest({
      capabilityId: "write_file",
      requestedBy: "model",
      mode: "agent",
      arguments: { path: "a.txt", content: "hi" },
    });
    const decision = evaluatePolicy(req, { registry });
    expect(decision.allowed).toBe(false);
  });

  test("disabled provider cannot shadow enabled provider (no privilege escalation via collision)", () => {
    const registry = new ToolRegistryService();
    // First register enabled plugin with tool "sync"
    registry.registerTools({
      kind: "plugin",
      source: "a",
      tools: [
        {
          name: "sync",
          description: "sync A",
          parameters: {},
          requiresApproval: false,
          async run() {
            return { ok: true, output: "A" };
          },
        } as any,
      ],
      metadata: {
        sync: { lifecycle: "enabled", trustLevel: "community", scope: "shared", permissions: [] as any, riskTier: "tier0", providerId: "plugin:a" },
      },
    });
    // Then register disabled plugin with same bare name "sync"
    registry.registerTools({
      kind: "plugin",
      source: "b",
      tools: [
        {
          name: "sync",
          description: "sync B",
          parameters: {},
          requiresApproval: false,
          async run() {
            return { ok: true, output: "B" };
          },
        } as any,
      ],
      metadata: {
        sync: { lifecycle: "disabled", trustLevel: "community", scope: "shared", permissions: [] as any, riskTier: "tier0", providerId: "plugin:b" },
      },
    });
    // Enabled should still own bare name, disabled should be shadowed
    const offered = registry.discover({ mode: "agent" as any }).map((t) => t.name);
    expect(offered).toContain("sync");
    // Resolve bare name should give enabled A
    const resolved = registry.resolve("sync");
    expect(resolved?.source).toBe("a");
    // Resolving disabled qualified id should fail (disabled cannot execute)
    expect(registry.resolve("plugin:b:sync")).toBeUndefined();
  });
});
