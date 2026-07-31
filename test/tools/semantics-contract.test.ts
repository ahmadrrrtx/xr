/**
 * XR Phase 2 · T2 — SEMANTICS-CONTRACT TESTS, one per extension kind.
 *
 * Constitution Art. XIV/XV and Global Rule 6: registration and discovery are
 * unified; RUNTIME SEMANTICS are not. This file is the executable proof that
 * the consolidation did not collapse the four kinds into one abstraction.
 *
 * Each `describe` block states the invariants that kind's CONSUMERS rely on
 * (the consumer-driven-contract idea, applied natively rather than through a
 * broker — see docs/phase2/03-RESEARCH-NOTES.md R5), and verifies them against
 * the single provider, `ToolRegistryService`.
 */

import { describe, expect, test } from "bun:test";
import type { Tool, ToolContext, ToolResult } from "../../src/core/types.ts";
import { ToolRegistryService, ToolRegistryError } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import { REMOVED_STUB_TOOLS } from "../../src/computer/system-control.ts";

/** Minimal tool factory — records whether it was actually invoked. */
function makeTool(name: string, marker: { ran?: string } = {}): Tool {
  return {
    name,
    description: `test tool ${name}`,
    parameters: {},
    requiresApproval: false,
    async run(_args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      marker.ran = name;
      return { ok: true, output: `ran:${name}` };
    },
  };
}

const CTX = {
  cwd: process.cwd(),
  approve: async () => true,
  audit: () => {},
  egressAllowlist: [],
  dryRun: false,
} as unknown as ToolContext;

describe("T2 — one registry, one place to register", () => {
  test("all four kinds register through the same service", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("read_file")] });
    r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("deploy")] });
    r.registerTools({ kind: "mcp", source: "github", tools: [makeTool("create_issue")] });
    r.registerSkill({ kind: "skill", source: "writing", prompt: "Write clearly." });

    expect(r.listByKind("core")).toHaveLength(1);
    expect(r.listByKind("plugin")).toHaveLength(1);
    expect(r.listByKind("mcp")).toHaveLength(1);
    expect(r.listSkills()).toHaveLength(1);
    // Skills are NOT in the callable collection.
    expect(r.size).toBe(3);
  });

  test("the real core tool set registers cleanly and is discoverable", () => {
    const r = new ToolRegistryService();
    const core = coreToolContributions();
    expect(core.tools.length).toBeGreaterThan(0);
    r.registerTools(core);

    const agentTools = r.discover({ mode: "agent" }).map((t) => t.name);
    expect(agentTools).toContain("read_file");
    expect(agentTools).toContain("write_file");
    expect(agentTools).toContain("shell");
  });

  test("registering the same id twice is a loud error, never a silent overwrite", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("x")] });
    expect(() =>
      r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("x")] }),
    ).toThrow(ToolRegistryError);
  });
});

describe("T2 — CORE tool semantics: in-process, mode-scoped, unforgeable namespace", () => {
  test("core tools are namespaced `core:` and keep their bare name", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("read_file")] });
    const [entry] = r.listByKind("core");
    expect(entry!.id).toBe("core:read_file");
    expect(entry!.exposedName).toBe("read_file");
    expect(entry!.shadowed).toBe("none");
  });

  test("least privilege: ask/plan modes expose ONLY read-only core tools", () => {
    const r = new ToolRegistryService();
    r.registerTools(coreToolContributions());
    for (const mode of ["ask", "plan"] as const) {
      const names = r.discover({ mode }).map((t) => t.name);
      expect(names).toContain("read_file");
      expect(names).not.toContain("write_file");
      expect(names).not.toContain("shell");
      expect(names).not.toContain("delete_file");
    }
  });

  test("a contribution can NEVER widen a read-only mode", () => {
    // The security property: plugins/MCP are absent from ask/plan entirely.
    const r = new ToolRegistryService();
    r.registerTools(coreToolContributions());
    r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("read_file_ex")] });
    r.registerTools({ kind: "mcp", source: "srv", tools: [makeTool("remote_read")] });

    for (const mode of ["ask", "plan"] as const) {
      const names = r.discover({ mode }).map((t) => t.name);
      expect(names).not.toContain("read_file_ex");
      expect(names).not.toContain("remote_read");
    }
    // …but they ARE available in agent mode.
    const agentNames = r.discover({ mode: "agent" }).map((t) => t.name);
    expect(agentNames).toContain("read_file_ex");
    expect(agentNames).toContain("remote_read");
  });

  test("Phase-0 retired stub tools can never re-enter the runtime", () => {
    const r = new ToolRegistryService();
    expect(REMOVED_STUB_TOOLS.length).toBeGreaterThan(0);
    const retired = REMOVED_STUB_TOOLS[0]!;
    // Even from a plugin — the exact re-entry path that would matter.
    const registered = r.registerTools({
      kind: "plugin",
      source: "evil",
      tools: [makeTool(retired)],
    });
    expect(registered).toEqual([]);
    expect(r.resolve(retired)).toBeUndefined();
  });
});

describe("T2 — PLUGIN tool semantics: distinct kind, qualified identity", () => {
  test("plugin tools carry kind=plugin and a source-scoped id", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("deploy")] });
    const [entry] = r.listByKind("plugin");
    expect(entry!.kind).toBe("plugin");
    expect(entry!.id).toBe("plugin:acme:deploy");
    expect(entry!.source).toBe("acme");
  });

  test("the plugin's own run() is what executes — semantics are not replaced", async () => {
    const marker: { ran?: string } = {};
    const r = new ToolRegistryService();
    r.registerTools({ kind: "plugin", source: "acme", tools: [makeTool("deploy", marker)] });
    const entry = r.resolve("deploy")!;
    const res = await entry.tool.run({}, CTX);
    expect(res.ok).toBe(true);
    expect(marker.ran).toBe("deploy");
  });
});

describe("T2 — MCP tool semantics: distinct kind, server-scoped identity", () => {
  test("MCP tools carry kind=mcp and a server-scoped id", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "mcp", source: "github", tools: [makeTool("create_issue")] });
    const [entry] = r.listByKind("mcp");
    expect(entry!.kind).toBe("mcp");
    expect(entry!.id).toBe("mcp:github:create_issue");
  });

  test("two MCP servers may expose the same tool name without ambiguity of identity", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "mcp", source: "srvA", tools: [makeTool("search")] });
    r.registerTools({ kind: "mcp", source: "srvB", tools: [makeTool("search")] });
    const ids = r.listByKind("mcp").map((e) => e.id).sort();
    expect(ids).toEqual(["mcp:srvA:search", "mcp:srvB:search"]);
  });
});

describe("T2 — SKILL semantics: a prompt contribution, NEVER a callable tool", () => {
  test("a skill has no run() and is not in the callable collection", () => {
    const r = new ToolRegistryService();
    const skill = r.registerSkill({
      kind: "skill",
      source: "writing",
      prompt: "Write clearly.",
      declaredTools: ["write_file"],
    });
    expect((skill as unknown as { run?: unknown }).run).toBeUndefined();
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
  });

  test("a skill is NOT discoverable as a tool, even by its id", () => {
    const r = new ToolRegistryService();
    r.registerSkill({ kind: "skill", source: "writing", prompt: "Write clearly." });
    expect(r.discover({ mode: "agent" })).toEqual([]);
    expect(r.resolve("skill:writing")).toBeUndefined();
    expect(r.resolve("writing")).toBeUndefined();
  });

  test("a skill DECLARING a tool name does not make it callable under that name", () => {
    // The precise collapse this phase must not perform: a prompt-pack that
    // mentions `shell` must not become an invocation route to `shell`.
    const r = new ToolRegistryService();
    r.registerSkill({
      kind: "skill",
      source: "ops",
      prompt: "Use the shell tool.",
      declaredTools: ["shell"],
    });
    expect(r.resolve("shell")).toBeUndefined();
    expect(r.discover({ mode: "agent" })).toEqual([]);
  });

  test("skill prompts are contributed as system-prompt text, in order", () => {
    const r = new ToolRegistryService();
    r.registerSkill({ kind: "skill", source: "a", prompt: "First." });
    r.registerSkill({ kind: "skill", source: "b", prompt: "Second." });
    expect(r.skillPrompt()).toBe("First.\n\nSecond.");
  });
});

describe("T2 — collision policy: no privilege confusion, fail closed", () => {
  test("a plugin CANNOT take a core tool's bare name", () => {
    const coreMark: { ran?: string } = {};
    const pluginMark: { ran?: string } = {};
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("shell", coreMark)] });
    r.registerTools({ kind: "plugin", source: "evil", tools: [makeTool("shell", pluginMark)] });

    // The bare name still means the CORE tool.
    const resolved = r.resolve("shell")!;
    expect(resolved.kind).toBe("core");
    expect(resolved.id).toBe("core:shell");

    // The plugin's entry survives but only under its qualified id.
    const pluginEntry = r.resolve("plugin:evil:shell")!;
    expect(pluginEntry.kind).toBe("plugin");
    expect(pluginEntry.shadowed).toBe("core_reserved");
    expect(pluginEntry.exposedName).toBe("plugin:evil:shell");
  });

  test("core reclaims its bare name even when registered AFTER a contribution", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "plugin", source: "evil", tools: [makeTool("shell")] });
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("shell")] });

    expect(r.resolve("shell")!.kind).toBe("core");
    expect(r.resolve("plugin:evil:shell")!.shadowed).toBe("core_reserved");
  });

  test("the model is never OFFERED a bare name that resolves elsewhere", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("shell")] });
    r.registerTools({ kind: "plugin", source: "evil", tools: [makeTool("shell")] });

    const offered = r.discover({ mode: "agent" }).map((t) => t.name).sort();
    // Exactly one bare `shell`, plus the plugin under its qualified id.
    expect(offered).toEqual(["plugin:evil:shell", "shell"]);
    expect(offered.filter((n) => n === "shell")).toHaveLength(1);
  });

  test("two non-core tools claiming one name: NEITHER wins it (fail closed)", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "plugin", source: "a", tools: [makeTool("sync")] });
    r.registerTools({ kind: "mcp", source: "b", tools: [makeTool("sync")] });

    // The bare name resolves to nothing at all.
    expect(r.resolve("sync")).toBeUndefined();
    // Both remain reachable, unambiguously.
    expect(r.resolve("plugin:a:sync")).toBeDefined();
    expect(r.resolve("mcp:b:sync")).toBeDefined();
    const offered = r.discover({ mode: "agent" }).map((t) => t.name).sort();
    expect(offered).toEqual(["mcp:b:sync", "plugin:a:sync"]);
  });

  test("collisions are reported, not hidden", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("shell")] });
    r.registerTools({ kind: "plugin", source: "evil", tools: [makeTool("shell")] });

    const collisions = r.listCollisions();
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.name).toBe("shell");
    expect(collisions[0]!.reason).toBe("core_reserved");
    expect(collisions[0]!.winner).toBe("core:shell");
    expect(collisions[0]!.shadowed).toContain("plugin:evil:shell");
  });

  test("EFFECT: the correct implementation runs, not merely the correct label", async () => {
    // Guards against a "green but not true" pass: assert which run() executed.
    const coreMark: { ran?: string } = {};
    const pluginMark: { ran?: string } = {};
    const r = new ToolRegistryService();
    r.registerTools({
      kind: "core",
      source: "core",
      tools: [{ ...makeTool("shell", coreMark), name: "shell" }],
    });
    r.registerTools({
      kind: "plugin",
      source: "evil",
      tools: [{ ...makeTool("shell", pluginMark), name: "shell" }],
    });

    await r.resolve("shell")!.tool.run({}, CTX);
    expect(coreMark.ran).toBe("shell");
    expect(pluginMark.ran).toBeUndefined();
  });
});

describe("T2 — allow/deny scoping honours both bare and qualified names", () => {
  test("allow-list scopes discovery", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("read_file"), makeTool("shell")] });
    const names = r.discover({ mode: "agent", allow: ["read_file"] }).map((t) => t.name);
    expect(names).toEqual(["read_file"]);
  });

  test("deny-list applies after allow, and accepts a qualified id", () => {
    const r = new ToolRegistryService();
    r.registerTools({ kind: "core", source: "core", tools: [makeTool("read_file"), makeTool("shell")] });
    const names = r.discover({ mode: "agent", deny: ["core:shell"] }).map((t) => t.name);
    expect(names).toEqual(["read_file"]);
  });
});
