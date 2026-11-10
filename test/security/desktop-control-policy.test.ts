import { describe, expect, test } from "bun:test";
import { desktopControlBlock } from "../../src/security/desktop-control-policy.ts";
import { execute } from "../../src/control/executor.ts";
import { captureScreen } from "../../src/control/vision.ts";
import { SYSTEM_TOOLS } from "../../src/computer/system-control.ts";
import { computerControlTool } from "../../src/tools/control.ts";
import { shellTool } from "../../src/tools/system.ts";
import type { ToolContext } from "../../src/core/types.ts";
import { runAction } from "../../src/control/service.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These tests simulate the policy branch on Linux as well as run natively on
// Windows. They do not pretend to prove a kernel sandbox boundary.
async function onPlatform(platform: NodeJS.Platform, fn: () => Promise<void>) {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  try {
    Object.defineProperty(process, "platform", { ...original, value: platform });
    await fn();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}
const events: string[] = [];
const ctx: ToolContext = {
  cwd: process.cwd(), hardened: false,
  approve: async () => true,
  audit: event => { events.push(event); },
};

describe("Preview 1 direct host automation policy", () => {
  test("only Windows/macOS are blocked; names and setup pointer are clear", () => {
    expect(desktopControlBlock("linux")).toBeNull();
    for (const p of ["win32", "darwin"] as const) {
      expect(desktopControlBlock(p)).toContain("not wired to a verified sandbox");
      expect(desktopControlBlock(p)).toContain("known-limitations");
    }
  });
  for (const p of ["win32", "darwin"] as const) {
    test(`${p} blocks direct executor, capture, system tools, and agent entry`, async () => {
      await onPlatform(p, async () => {
        // The executor and screen capture must refuse before any OS launch or
        // write. Including the test-only capture flag must not bypass policy.
        const old = process.env.XR_CONTROL_FORCE_TEST;
        process.env.XR_CONTROL_FORCE_TEST = "1";
        try {
          const result = await execute({ type: "app", name: "arbitrary-test-program" });
          expect(result.ok).toBe(false);
          expect(result.message).toContain("not wired");
          expect((await captureScreen()).ok).toBe(false);
          for (const tool of SYSTEM_TOOLS) {
            const result = await tool.run({ name: "arbitrary-test-program" }, ctx);
            expect(result.ok).toBe(false);
            expect(result.reason).toBe("blocked:isolation-unavailable");
          }
          const agent = await computerControlTool.run({ task: "open an app" }, ctx);
          expect(agent.ok).toBe(false);
          expect(agent.reason).toBe("blocked:isolation-unavailable");
        } finally {
          if (old === undefined) delete process.env.XR_CONTROL_FORCE_TEST;
          else process.env.XR_CONTROL_FORCE_TEST = old;
        }
      });
    });
  }
  test("governed control service blocks before an injected executor can run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-host-control-test-"));
    const store = new Store(join(dir, "state.db"));
    const priorForce = process.env.XR_CONTROL_FORCE_TEST;
    const priorPause = process.env.XR_CONTROL_PAUSE_PATH;
    process.env.XR_CONTROL_FORCE_TEST = "1";
    process.env.XR_CONTROL_PAUSE_PATH = join(dir, "pause.json");
    let executed = false;
    try {
      await onPlatform("win32", async () => {
        const r = await runAction(store, { type: "app", name: "test" }, {
          mode: "auto", execOverride: async () => { executed = true; return { ok: true, message: "ran" }; },
        });
        expect(r.result.ok).toBe(false);
        expect(r.result.message).toContain("not wired");
        expect(executed).toBe(false);
      });
    } finally {
      store.close();
      if (priorForce === undefined) delete process.env.XR_CONTROL_FORCE_TEST; else process.env.XR_CONTROL_FORCE_TEST = priorForce;
      if (priorPause === undefined) delete process.env.XR_CONTROL_PAUSE_PATH; else process.env.XR_CONTROL_PAUSE_PATH = priorPause;
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // This tests the real host only: changing process.platform can confuse path
  // resolution before the fallback check. The native Windows workflow runs it.
  test.skipIf(process.platform !== "win32" && process.platform !== "darwin")("native Windows/macOS refuses explicitly non-hardened legacy shell", async () => {
    const result = await shellTool.run({ cmd: "echo preview-test" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("blocked:isolation-unavailable");
  });
});
