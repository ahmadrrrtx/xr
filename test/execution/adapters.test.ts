import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { executeTool } from "../../src/execution/adapters/tool-adapter.ts";
import { executeControlAction } from "../../src/execution/adapters/control-adapter.ts";
import type { Tool, ToolContext, ToolResult } from "../../src/core/types.ts";
import type { Action, RiskAssessment } from "../../src/control/types.ts";

function makeService(): {
  destroy: () => void;
  service: ExecutionService;
} {
  const dir = mkdtempSync(join(tmpdir(), "xr-exec-adapters-"));
  const path = join(dir, "test.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s),
  });
  const service = new ExecutionService({ repo: new ExecutionRepo(wrapped) });
  return {
    service,
    destroy: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

describe("tool adapter", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  test("read-only tool runs to success", async () => {
    const echo: Tool = {
      name: "echo",
      description: "echo input",
      parameters: {},
      requiresApproval: false,
      run: async (args, _ctx): Promise<ToolResult> => ({ ok: true, output: `echo:${args.text}` }),
    };
    const res = await executeTool(echo, { text: "hi" }, {
      service: h.service,
      workspaceId: "ws",
      cwd: "/tmp",
    });
    expect(res.ok).toBe(true);
    expect(res.output).toBe("echo:hi");
    expect(res.__execution).toBeDefined();
    expect(res.__execution!.state).toBe("succeeded");
    expect(res.__execution!.action!.capability.name).toBe("echo");
  });

  test("tool that throws yields failure outcome", async () => {
    const bad: Tool = {
      name: "bad",
      description: "always fails",
      parameters: {},
      requiresApproval: false,
      run: async (): Promise<ToolResult> => { throw new Error("nope"); },
    };
    const res = await executeTool(bad, {}, { service: h.service, workspaceId: "ws", cwd: "/tmp" });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("nope");
    expect(res.__execution!.state).toBe("failed");
  });

  test("denied approval returns ok=false and does not invoke tool.run", async () => {
    let ran = false;
    const guarded: Tool = {
      name: "shell",
      description: "run shell",
      parameters: {},
      requiresApproval: true,
      run: async (_a, _c): Promise<ToolResult> => { ran = true; return { ok: true, output: "ran" }; },
    };
    const res = await executeTool(guarded, { cmd: "ls" }, {
      service: h.service,
      workspaceId: "ws",
      cwd: "/tmp",
      approve: async () => false,
    });
    expect(ran).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("denied");
    expect(res.__execution!.state).toBe("denied");
  });
});

describe("control adapter", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  test("safe action executes without approval", async () => {
    const action: Action = { type: "wait_ms", ms: 50 };
    const res = await executeControlAction(action, {
      service: h.service,
      workspaceId: "ws",
      execute: async (a) => ({ ok: true, message: `waited ${(a as any).ms}ms` }),
      classify: () => ({ level: "safe", reason: "wait", reversible: true } as RiskAssessment),
    });
    expect(res.ok).toBe(true);
    expect(res.__execution!.state).toBe("succeeded");
    expect(res.__execution!.plan?.risk).toBe("safe");
  });

  test("destructive action with approval denied returns skipped/denied", async () => {
    const action: Action = { type: "file", op: "delete", path: "/tmp/foo" };
    let executed = false;
    const res = await executeControlAction(action, {
      service: h.service,
      workspaceId: "ws",
      execute: async () => { executed = true; return { ok: true, message: "deleted" }; },
      classify: () => ({ level: "destructive", reason: "delete", reversible: false } as RiskAssessment),
      approve: async () => false,
    });
    expect(executed).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.skipped).toBe(true);
    expect(res.__execution!.state).toBe("denied");
  });
});
