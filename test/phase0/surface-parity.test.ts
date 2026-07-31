/**
 * Phase 0 · T8 — interactive-surface parity with the one-shot CLI.
 *
 * Acceptance criterion: "shell tool-set equals one-shot CLI tool-set after a
 * plugin install".
 *
 * This is an effect test, not a wiring test: it performs a REAL plugin install
 * into a temporary workspace, then asserts that the tool list the interactive
 * surfaces receive contains the tool that plugin contributes. Before Phase 0
 * the interactive surfaces passed no `extraTools` at all, so the plugin's tool
 * was reachable from `xr run` and invisible in the Shell, Telegram and Voice.
 *
 * Scope guard: this validates the T8 *bridge*. Full execution-envelope
 * unification is Phase 2 and is deliberately NOT asserted here.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { PluginManager } from "../../src/plugins/manager.ts";
import { resolveExtensibility } from "../../src/services/extensibility-bridge.ts";

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
 * The tool-set the one-shot CLI exposes: core tools plus plugin and MCP tools.
 * `AgentService.runScopedTask` composes exactly this via
 * `extraTools: [...pluginService.getPluginTools(), ...mcpService.getMcpTools()]`.
 */
async function cliToolNames(): Promise<string[]> {
  const manager = new PluginManager(store, workDir);
  await manager.loadEnabled();
  const { McpManager } = await import("../../src/mcp/manager.ts");
  const mcp = new McpManager(store, workDir);
  await mcp.loadEnabled();
  return [...manager.pluginTools(), ...mcp.mcpTools()].map((t) => t.name).sort();
}

/** The tool-set an interactive surface now receives through the T8 bridge. */
async function surfaceToolNames(task: string): Promise<string[]> {
  const ctx = await resolveExtensibility(store, task);
  return ctx.extraTools.map((t) => t.name).sort();
}

describe("Phase 0 · T8 — extensibility parity across surfaces", () => {
  test("the installed plugin really contributes a tool to the CLI tool-set", async () => {
    const names = await cliToolNames();
    // The `hello` plugin declares a tool capability named `echo`.
    expect(names.some((n) => n.includes("echo"))).toBe(true);
  });

  test("PARITY: the interactive-surface tool-set equals the one-shot CLI tool-set", async () => {
    const cli = await cliToolNames();
    const surface = await surfaceToolNames("say hello to the user");

    expect(surface).toEqual(cli);
    // Guard against a vacuous pass: the sets must be non-empty.
    expect(surface.length).toBeGreaterThan(0);
  });

  test("the plugin tool is reachable from the surface by name", async () => {
    const surface = await surfaceToolNames("echo something");
    expect(surface.some((n) => n.includes("echo"))).toBe(true);
  });

  test("resolveExtensibility is best-effort and never throws", async () => {
    // Even with a nonsense task the bridge must return a usable context.
    const ctx = await resolveExtensibility(store, "");
    expect(Array.isArray(ctx.extraTools)).toBe(true);
    expect(typeof ctx.skillPrompt).toBe("string");
    expect(Array.isArray(ctx.diagnostics)).toBe(true);
  });

  test("all three interactive surfaces pass extraTools into the agent", async () => {
    // Source-level assertion: the three call-sites named in the audit must now
    // forward extraTools. This is the regression guard for the exact defect.
    const surfaces = [
      "src/interfaces/shell/app.ts",
      "src/telegram/bot.ts",
      "src/voice/pipeline.ts",
    ];
    for (const rel of surfaces) {
      const source = await Bun.file(join(REPO_ROOT, rel)).text();
      expect(source).toContain("resolveExtensibility");
      expect(source).toContain("extraTools: extensibility.extraTools");
    }
  });
});
