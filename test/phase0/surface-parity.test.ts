/**
 * Phase 0 · T8 — interactive-surface parity with the one-shot CLI.
 * Phase 2 · T1 — re-based onto the canonical execution envelope.
 *
 * ── The guarantee (unchanged since Phase 0) ─────────────────────────────────
 *
 * "What works in one surface works in all": the tool-set an interactive
 * surface receives must equal the tool-set the one-shot CLI receives, after a
 * REAL plugin install. Before Phase 0 the interactive surfaces passed no
 * `extraTools` at all, so a plugin's tool was reachable from `xr run` and
 * invisible in the Shell, Telegram and Voice.
 *
 * ── What Phase 2 changed (mechanism, not guarantee) ─────────────────────────
 *
 * Phase 0 delivered the guarantee with a tools-only bridge
 * (`services/extensibility-bridge.ts`) while each surface still called
 * `runAgent` itself. Phase 2 · T1 replaced that with the execution envelope:
 * every surface now goes through `executeOnSurface` → `runEnvelope`, and the
 * tool-set comes from the single `ToolRegistryService` (T2).
 *
 * So the assertions below are STRONGER than Phase 0's: they check parity of the
 * arbitrated registry contents AND that no surface constructs its own execution
 * path. The Phase-0 effect is preserved; the Phase-0 wiring is gone by design.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { buildToolRegistry } from "../../src/tools/registry-builder.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const HELLO_PLUGIN = join(REPO_ROOT, "plugins/hello");

let workDir = "";
let store: WorkspaceStore;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "xr-parity-"));
  store = new WorkspaceStore("default", join(workDir, "xr.db"));

  // A REAL install of a REAL bundled plugin — no mocks.
  const manager = new PluginManager(store, workDir);
  const prepared = manager.prepareInstall(HELLO_PLUGIN);
  expect(prepared.ok).toBe(true);
  const installed = manager.commitInstall(HELLO_PLUGIN, prepared.requestedPermissions ?? [], { enable: true });
  expect(installed.ok).toBe(true);
});

afterAll(() => {
  try { store.close(); } catch { /* already closed */ }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

/**
 * The raw contribution set the one-shot CLI composes: plugin tools plus MCP
 * tools, exactly as the plugin/MCP managers report them.
 */
async function cliContributionNames(): Promise<string[]> {
  const manager = new PluginManager(store, workDir);
  await manager.loadEnabled();
  const { McpManager } = await import("../../src/mcp/manager.ts");
  const mcp = new McpManager(store, workDir);
  await mcp.loadEnabled();
  return [...manager.pluginTools(), ...mcp.mcpTools()].map((t) => t.name).sort();
}

/** The non-core tool-set a surface receives through the Phase-2 registry. */
async function surfaceContributionNames(task: string): Promise<string[]> {
  const { registry } = await buildToolRegistry({ store, task });
  return [...registry.listByKind("plugin"), ...registry.listByKind("mcp")]
    .map((e) => e.name)
    .sort();
}

describe("Phase 0 · T8 / Phase 2 · T1 — extensibility parity across surfaces", () => {
  test("the installed plugin really contributes a tool to the CLI tool-set", async () => {
    const names = await cliContributionNames();
    // The `hello` plugin declares a tool capability named `echo`.
    expect(names.some((n) => n.includes("echo"))).toBe(true);
  });

  test("PARITY: the interactive-surface tool-set equals the one-shot CLI tool-set", async () => {
    const cli = await cliContributionNames();
    const surface = await surfaceContributionNames("say hello to the user");

    expect(surface).toEqual(cli);
    // Guard against a vacuous pass: the sets must be non-empty.
    expect(surface.length).toBeGreaterThan(0);
  });

  test("the plugin tool is reachable from the surface by name", async () => {
    const surface = await surfaceContributionNames("echo something");
    expect(surface.some((n) => n.includes("echo"))).toBe(true);
  });

  test("registry assembly is best-effort and never throws", async () => {
    // Even with a nonsense task the builder must return a usable registry.
    const { registry, diagnostics } = await buildToolRegistry({ store, task: "" });
    expect(registry.size).toBeGreaterThan(0);
    expect(typeof registry.skillPrompt()).toBe("string");
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  test("the plugin tool is actually DISCOVERABLE to the model in agent mode", async () => {
    // Effect assertion, not a wiring assertion: the tool must appear in the
    // set handed to the provider, which is what the surface actually runs with.
    const { registry } = await buildToolRegistry({ store, task: "echo something" });
    const offered = registry.discover({ mode: "agent" }).map((t) => t.name);
    expect(offered.some((n) => n.includes("echo"))).toBe(true);
  });

  test("PHASE 2: all three interactive surfaces execute through the envelope", async () => {
    // Regression guard for the exact Phase-0 defect, restated in Phase-2 terms:
    // the three surfaces must reach execution through the shared envelope entry
    // and must NOT construct an agent run themselves.
    const surfaces = [
      "src/interfaces/shell/app.ts",
      "src/telegram/bot.ts",
      "src/voice/pipeline.ts",
    ];
    for (const rel of surfaces) {
      const source = await Bun.file(join(REPO_ROOT, rel)).text();
      expect(source).toContain("executeOnSurface");
      // The Phase-0 bridge and the direct loop call are both gone.
      expect(source).not.toContain("resolveExtensibility");
      expect(source).not.toContain("runAgent(");
    }
  });
});
