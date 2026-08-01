import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shellTool } from "../../src/tools/system.ts";
import type { ToolContext, IsolatedRunResult } from "../../src/core/types.ts";
import type { TrustRequest, EnvironmentExecutable } from "../../src/runtime/trust/types.ts";

function ctxWith(over: Partial<ToolContext> = {}): ToolContext & { events: Array<{ event: string; detail: Record<string, unknown> }> } {
  const events: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const dir = mkdtempSync(join(tmpdir(), "xr-shell-tool-"));
  return {
    cwd: dir,
    approve: async () => true,
    audit: (event, detail) => events.push({ event, detail }),
    events,
    ...over,
  };
}

describe("XR 4.2 shell tool isolation wiring", () => {
  test("uses the isolated runner with a Tier-2 request when available", async () => {
    let seenReq: TrustRequest | undefined;
    let seenExec: EnvironmentExecutable | undefined;
    const isolated = async (req: TrustRequest, exec: EnvironmentExecutable): Promise<IsolatedRunResult> => {
      seenReq = req;
      seenExec = exec;
      return { ok: true, exitCode: 0, stdout: "hello-from-sandbox\n", stderr: "", timedOut: false, blocked: false, placement: "namespace_sandbox", verified: true };
    };
    const ctx = ctxWith({ runIsolated: isolated });
    const res = await shellTool.run({ cmd: "echo hi" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("hello-from-sandbox");
    expect((res.data as { isolated?: boolean })?.isolated).toBe(true);
    // The request must classify the command as arbitrary process/code execution.
    expect(seenReq?.spawnsProcess).toBe(true);
    expect(seenReq?.runsArbitraryCode).toBe(true);
    expect(seenExec?.argv[0]).toBe("bash");
    expect(ctx.events.some((e) => e.event === "shell.run_isolated")).toBe(true);
    rmSync(ctx.cwd, { recursive: true, force: true });
  });

  test("fails closed when the isolated runner reports blocked", async () => {
    const isolated = async (): Promise<IsolatedRunResult> => ({
      ok: false, exitCode: null, stdout: "", stderr: "required isolation for tier2_isolated is unavailable on this host",
      timedOut: false, blocked: true, reason: "required isolation for tier2_isolated is unavailable on this host",
    });
    const ctx = ctxWith({ runIsolated: isolated });
    const res = await shellTool.run({ cmd: "echo hi" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toStartWith("blocked:");
    expect(ctx.events.some((e) => e.event === "shell.isolated_blocked")).toBe(true);
    rmSync(ctx.cwd, { recursive: true, force: true });
  });

  test("denied approval never reaches the runner", async () => {
    let called = false;
    const ctx = ctxWith({ approve: async () => false, runIsolated: async () => { called = true; return { ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false, blocked: false }; } });
    const res = await shellTool.run({ cmd: "echo hi" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toBe("shell denied");
    expect(called).toBe(false);
    rmSync(ctx.cwd, { recursive: true, force: true });
  });

  // Phase 4 · T1 — hardened mode (the default) BLOCKS the host-authority
  // fallback: no runner wired + hardened ⇒ refused, never host bash.
  test("hardened mode: no runner wired → BLOCKED (never host-authority bash)", async () => {
    const ctx = ctxWith({ hardened: true }); // no runIsolated, hardened on
    const res = await shellTool.run({ cmd: "echo must-not-run" }, ctx);
    expect(res.ok).toBe(false);
    expect(res.output).toContain("blocked:");
    expect(res.output).toContain("hardened");
    expect(ctx.events.some((e) => e.event === "shell.hardened_blocked")).toBe(true);
    rmSync(ctx.cwd, { recursive: true, force: true });
  });

  // Phase 4 · T1 — the legacy host-authority path survives ONLY as an explicit
  // opt-out (hardened: false), audited as a degraded execution.
  test("hardened OFF: falls back to the legacy in-process path when no runner is wired", async () => {
    const ctx = ctxWith({ hardened: false }); // no runIsolated, hardened off
    const res = await shellTool.run({ cmd: "echo legacy-fallback-ok" }, ctx);
    expect(res.ok).toBe(true);
    expect(res.output).toContain("legacy-fallback-ok");
    expect(ctx.events.some((e) => e.event === "shell.run")).toBe(true);
    rmSync(ctx.cwd, { recursive: true, force: true });
  });
});
