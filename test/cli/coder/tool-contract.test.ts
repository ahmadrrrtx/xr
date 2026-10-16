/** Real production tool schemas cross the coder policy boundary. No shell is executed. */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoderSession, subjectOf, type AgentPort, type SessionOptions } from "../../../src/cli/coder/session.ts";
import type { ApprovalInfo, CoderUI, TurnSummary } from "../../../src/cli/coder/ui.ts";
import type { AgentRunOverrides } from "../../../src/services/agent-service.ts";
import type { ApprovalRequest, Tool, ToolContext } from "../../../src/core/types.ts";
import { shellTool } from "../../../src/tools/system.ts";
import { writeFileTool } from "../../../src/tools/files.ts";

const temporary: string[] = [];
afterEach(() => { for (const p of temporary.splice(0)) rmSync(p, { recursive: true, force: true }); });
function workspace(): string { const p = mkdtempSync(join(tmpdir(), "xr-coder-contract-")); temporary.push(p); return p; }

function probeUI() {
  const approvals: ApprovalInfo[] = [], summaries: TurnSummary[] = [], notices: string[] = [];
  const noop = () => {};
  const ui: CoderUI = {
    canPrompt: false, banner: noop, thinking: noop, token: noop, toolCall: noop,
    toolResult: noop, endTurn: noop, diff: noop,
    notice: (text) => { notices.push(text); },
    approvalRequest: (info) => { approvals.push(info); },
    promptApproval: async () => "n",
    summary: (summary) => { summaries.push(summary); },
  };
  return { ui, approvals, summaries, notices };
}

async function exercise(tool: Tool, args: Record<string, unknown>, options: Partial<SessionOptions> = {}) {
  const probe = probeUI();
  let executions = 0;
  let overrides: AgentRunOverrides | undefined;
  let approved: boolean | undefined;
  const cwd = options.cwd ?? workspace();
  const agent: AgentPort = {
    async runTask(_task, _mode, run) {
      overrides = run;
      const ctx = {
        cwd, hardened: true, dryRun: run.dryRun, egressAllowlist: [],
        audit: () => {},
        approve: async (request: ApprovalRequest) => { approved = await run.approve!(request); return approved; },
        // Stub only placement/execution. The real shell tool constructs its own approval.
        runIsolated: async () => {
          executions++;
          return { ok: true, stdout: "executor-stub", stderr: "", exitCode: 0, blocked: false, verified: true, timedOut: false };
        },
      } as unknown as ToolContext;
      run.onStreamEvent?.({ type: "tool_call", id: "tool-1", tool: tool.name, args });
      const result = await tool.run(args, ctx);
      run.onStreamEvent?.({ type: "tool_result", id: "tool-1", tool: tool.name, ok: result.ok, ...(result.ok ? { result: result.output } : { error: result.output }) });
      return { sessionId: "fixture", stopped: "done", steps: 1, finalMessage: result.output };
    },
  };
  const session = new CoderSession(agent, probe.ui, {
    cwd, systemPrompt: "offline test", tools: [tool.name], mode: "yolo",
    rules: {}, interactive: false, diffOnly: false, maxSteps: 2, ...options,
  });
  const result = await session.turn("Synthetic tool contract", new AbortController().signal);
  return { ...probe, result, executions, approved, overrides };
}

describe("real shell cmd contract", () => {
  const cmd = "printf '%s' XR_SAFE_CONTRACT_FIXTURE";

  test("a configured deny wins under auto-approval using the actual tool's args", async () => {
    const r = await exercise(shellTool, { cmd }, { rules: { deny: ["shell:printf*"] } });
    expect(r.approved).toBe(false);
    expect(r.executions).toBe(0);
    expect(r.approvals[0]?.subject).toBe(cmd);
    expect(r.approvals[0]?.preview).toBe(cmd);
    expect(r.approvals[0]?.decision.action).toBe("deny");
  });

  test("dangerous review cannot be bypassed by yolo or a broad allow", async () => {
    const r = await exercise(shellTool, { cmd: "git push --force" }, { rules: { allow: ["shell:*"] } });
    expect(r.approved).toBe(false);
    expect(r.executions).toBe(0);
    expect(r.approvals[0]?.decision.dangerous).toBeDefined();
  });

  test("policy, preview and summary agree with the canonical executable command", async () => {
    const r = await exercise(shellTool, { cmd, command: "decoy that must not be approved or summarized" });
    expect(r.approved).toBe(true);
    expect(r.executions).toBe(1);
    expect(r.approvals[0]?.subject).toBe(cmd);
    expect(r.approvals[0]?.preview).toBe(cmd);
    expect(r.summaries[0]?.commands).toEqual([cmd]);
  });

  test("subject extraction never substitutes the obsolete command field for cmd", () => {
    expect(subjectOf({ tool: "shell", reason: "test", args: { cmd, command: "decoy" } })).toBe(cmd);
    expect(subjectOf({ tool: "shell", reason: "test", args: { command: "legacy-only" } })).toBe("");
  });

  for (const args of [{}, { command: "printf legacy" }, { cmd: 42 }, { cmd: "  " }]) {
    test(`malformed approval fails closed: ${JSON.stringify(args)}`, async () => {
      let answer: boolean | undefined;
      const probe = probeUI();
      const session = new CoderSession({
        async runTask(_t, _m, run) {
          answer = await run.approve!({ tool: "shell", reason: "malformed", args });
          return { sessionId: "fixture", stopped: "done", steps: 1, finalMessage: "test" };
        },
      }, probe.ui, { cwd: workspace(), systemPrompt: "test", tools: ["shell"], mode: "yolo", rules: {}, interactive: false, diffOnly: false, maxSteps: 1 });
      await session.turn("test", new AbortController().signal);
      expect(answer).toBe(false);
      expect(probe.approvals[0]?.decision.action).toBe("deny");
    });
  }
});

describe("dry-run reaches real mutations and truthful summaries", () => {
  test("write_file simulates creation after approval; it does not touch the file", async () => {
    const cwd = workspace();
    const r = await exercise(writeFileTool, { path: "marker.txt", content: "synthetic" }, { cwd, dryRun: true });
    expect(r.overrides?.dryRun).toBe(true);
    expect(r.approved).toBe(true);
    expect(r.result.finalMessage).toContain("dry-run");
    expect(existsSync(join(cwd, "marker.txt"))).toBe(false);
    expect(r.summaries[0]?.filesChanged).toEqual([]);
  });

  test("write_file does not truncate/overwrite an existing file under dry-run", async () => {
    const cwd = workspace();
    writeFileSync(join(cwd, "marker.txt"), "original");
    await exercise(writeFileTool, { path: "marker.txt", content: "replacement" }, { cwd, dryRun: true });
    expect(readFileSync(join(cwd, "marker.txt"), "utf8")).toBe("original");
  });

  test("dry-run does not bypass an explicit edit deny", async () => {
    const cwd = workspace();
    const r = await exercise(writeFileTool, { path: "marker.txt", content: "synthetic" }, { cwd, dryRun: true, rules: { deny: ["edit:*"] } });
    expect(r.approved).toBe(false);
    expect(existsSync(join(cwd, "marker.txt"))).toBe(false);
  });

  test("shell dry-run never calls the executor and never claims a command ran", async () => {
    const r = await exercise(shellTool, { cmd: "printf '%s' XR_SAFE_DRY_RUN" }, { dryRun: true });
    expect(r.result.finalMessage).toContain("dry-run");
    expect(r.executions).toBe(0);
    expect(r.summaries[0]?.commands).toEqual([]);
  });

  test("ordinary approved writes still work (not a disable-everything fix)", async () => {
    const cwd = workspace();
    const r = await exercise(writeFileTool, { path: "marker.txt", content: "synthetic" }, { cwd });
    expect(readFileSync(join(cwd, "marker.txt"), "utf8")).toBe("synthetic");
    expect(r.summaries[0]?.filesChanged).toEqual(["marker.txt"]);
  });

  test("the exact USD override and token ceiling reach AgentService", async () => {
    const r = await exercise(shellTool, { cmd: "printf safe" }, { dryRun: true, budget: 0.000001, maxTokens: 1234 });
    expect(r.overrides?.budget).toBe(0.000001);
    expect(r.overrides?.maxTokens).toBe(1234);
  });
});
