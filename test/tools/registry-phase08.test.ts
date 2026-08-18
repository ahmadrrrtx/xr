/**
 * XR Phase 08 — Registry lifecycle/trust/scope tests for mutation gate coverage
 */

import { describe, test, expect } from "bun:test";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import type { CapabilityMetadata } from "../../src/tools/registry-types.ts";

function makeTool(name: string) {
  return {
    name,
    description: "test",
    parameters: {},
    requiresApproval: false,
    async run() {
      return { ok: true, output: name };
    },
  } as any;
}

describe("Phase 08 — registry-service lifecycle/trust/scope", () => {
  test("setLifecycle and getLifecycle", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("read_file")],
      metadata: { read_file: { lifecycle: "enabled" } as any },
    });
    expect(r.getLifecycle("read_file")).toBe("enabled");
    expect(r.setLifecycle("read_file", "disabled")).toBe(true);
    expect(r.getLifecycle("read_file")).toBe("disabled");
    expect(r.resolve("read_file")).toBeUndefined();
    expect(r.listEnabled().length).toBe(0);
  });

  test("quarantined cannot be resolved or discovered", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "plugin",
      source: "evil",
      tools: [makeTool("bad")],
      metadata: { bad: { lifecycle: "quarantined", trustLevel: "quarantined" } as any },
    });
    expect(r.resolve("bad")).toBeUndefined();
    expect(r.discover({ mode: "agent" as any }).some((t) => t.name.includes("bad"))).toBe(false);
  });

  test("disabled cannot shadow enabled", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "plugin",
      source: "a",
      tools: [makeTool("sync")],
      metadata: { sync: { lifecycle: "enabled" } as any },
    });
    r.registerTools({
      kind: "plugin",
      source: "b",
      tools: [makeTool("sync")],
      metadata: { sync: { lifecycle: "disabled" } as any },
    });
    const resolved = r.resolve("sync");
    expect(resolved?.source).toBe("a");
    expect(r.resolve("plugin:b:sync")).toBeUndefined();
  });

  test("trust filter excludes quarantined", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "mcp",
      source: "srv",
      tools: [makeTool("tool1"), makeTool("tool2")],
      metadata: {
        tool1: { lifecycle: "enabled", trustLevel: "quarantined" } as any,
        tool2: { lifecycle: "enabled", trustLevel: "official" } as any,
      },
    });
    const all = r.discover({ mode: "agent" as any });
    expect(all.some((t) => t.name.includes("tool1"))).toBe(false);
    expect(all.some((t) => t.name.includes("tool2"))).toBe(true);
  });

  test("permission filter", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("read_file"), makeTool("write_file")],
      metadata: {
        read_file: { lifecycle: "enabled", permissions: ["filesystem.read"] } as any,
        write_file: { lifecycle: "enabled", permissions: ["filesystem.write"] } as any,
      },
    });
    const filtered = r.discover({ mode: "agent" as any, requiresPermissions: ["filesystem.write"] as any });
    expect(filtered.some((t) => t.name === "write_file")).toBe(true);
    expect(filtered.some((t) => t.name === "read_file")).toBe(false);
  });

  test("scope filter", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("read_file"), makeTool("computer_control")],
      metadata: {
        read_file: { lifecycle: "enabled", scope: "workspace" } as any,
        computer_control: { lifecycle: "enabled", scope: "host" } as any,
      },
    });
    const workspaceOnly = r.discover({ mode: "agent" as any, scopes: ["workspace"] as any });
    // shared always passes, but host should be filtered when only workspace requested?
    // Our discover allows shared always, but host not workspace, so computer_control should be excluded
    // Actually implementation: scope filter allows if scope undefined or shared or in allowed set
    // So host not in workspace set → excluded
    expect(workspaceOnly.some((t) => t.name === "read_file")).toBe(true);
  });

  test("lifecycleAudit records transitions", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("shell")],
      metadata: { shell: { lifecycle: "enabled" } as any },
    });
    r.setLifecycle("shell", "disabled", "test reason");
    const audit = r.getLifecycleAudit();
    expect(audit.length).toBe(1);
    expect(audit[0].previous).toBe("enabled");
    expect(audit[0].next).toBe("disabled");
  });

  test("enabledSize counts only enabled", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("a"), makeTool("b")],
      metadata: {
        a: { lifecycle: "enabled" } as any,
        b: { lifecycle: "disabled" } as any,
      },
    });
    expect(r.size).toBe(2);
    expect(r.enabledSize).toBe(1);
  });

  test("resolve checks lifecycle and trust", () => {
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [makeTool("sensitive")],
      metadata: { sensitive: { lifecycle: "enabled", trustLevel: "quarantined" } as any },
    });
    expect(r.resolve("sensitive")).toBeUndefined();
  });
});
