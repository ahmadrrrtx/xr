/**
 * XR Phase 2 · F-06 — POLICY BOUNDARY TESTS (deny-on-throw + real deny-lists).
 *
 * Acceptance criteria:
 *   1. Forced policy throw ⇒ execution refused + capability.deny_error.
 *   2. Workspace-denied permission ⇒ denied at the loop boundary.
 *   3. evaluatePolicy itself never throws to its caller (returns a deny
 *      decision with reason:"policy_error").
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { runAgent } from "../../src/core/agent.ts";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { evaluatePolicy } from "../../src/capabilities/policy.ts";
import { createCapabilityRequest } from "../../src/capabilities/request.ts";
import type { Provider } from "../../src/core/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p2-policy-"));
});

/** A provider that emits exactly one tool call, then finishes. */
function toolCallingProvider(tool: string, args: Record<string, unknown>): Provider {
  let calls = 0;
  return {
    id: "mock",
    label: "Mock",
    async chat() {
      calls++;
      return calls === 1
        ? { message: "planning", toolCalls: [{ tool, args }], done: false }
        : { message: "done", toolCalls: [], done: true };
    },
    async health() {
      return { ok: true };
    },
  };
}

describe("F-06 · deny-on-throw at the loop boundary", () => {
  test("a policy evaluation throw REFUSES execution and audits capability.deny_error", async () => {
    const store = new Store(join(tmp, "d.db"));
    let executed = 0;
    // discover() works (returns one tool); resolve() throws — forcing
    // evaluatePolicy to throw exactly like an unexpected policy-engine fault.
    const throwingRegistry: any = {
      discover: () => [
        {
          name: "write_file",
          description: "x",
          parameters: { path: "string", content: "string" },
          requiresApproval: true,
          async run() {
            executed++;
            return { ok: true, output: "should never run" };
          },
        },
      ],
      resolve: () => {
        throw new Error("injected policy engine fault");
      },
    };

    const result = await runAgent("write something", "agent", {
      provider: toolCallingProvider("write_file", { path: "a.txt", content: "hi" }),
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => true,
      toolRegistry: throwingRegistry,
      maxSteps: 4,
    });

    expect(executed).toBe(0); // the tool NEVER ran — fail closed
    expect(result.stopped).toBe("done"); // the run itself completes honestly
    const events = store.recentAudit(50).map((e) => e.event);
    expect(events).toContain("capability.deny_error");
    const denied = store
      .recentAudit(50)
      .filter((e) => e.event === "capability.denied")
      .map((e) => JSON.parse(e.detail).reason);
    expect(denied).toContain("policy_error");
    store.close();
  });

  test("evaluatePolicy never throws: internal faults become a policy_error deny decision", () => {
    const registry: any = {
      resolve: () => {
        throw new Error("boom");
      },
    };
    const decision = evaluatePolicy(createCapabilityRequest({ capabilityId: "shell", mode: "agent", cwd: tmp }), {
      registry,
      deniedPermissions: [],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("policy_error");
    expect(decision.policyTrace.join(" ")).toContain("fail closed");
  });
});

describe("F-06 · real deny-lists at the loop boundary", () => {
  function registryWithCounterTool(): { registry: ToolRegistryService; executed: () => number } {
    let executed = 0;
    const registry = new ToolRegistryService();
    const tool = {
      name: "deploy",
      description: "test tool",
      parameters: { target: "string" },
      requiresApproval: true,
      async run() {
        executed++;
        return { ok: true, output: "deployed" };
      },
    } as any;
    registry.registerTools({
      kind: "plugin",
      source: "test",
      tools: [tool],
      metadata: {
        deploy: {
          lifecycle: "enabled",
          trustLevel: "community",
          scope: "shared",
          permissions: ["filesystem.write", "network.fetch"] as any,
          riskTier: "tier1",
          providerId: "plugin:test",
          version: "1.0.0",
        },
      },
    });
    return { registry, executed: () => executed };
  }

  test("a workspace-denied permission is denied before execution", async () => {
    const store = new Store(join(tmp, "e.db"));
    const { registry, executed } = registryWithCounterTool();

    const result = await runAgent("deploy it", "agent", {
      provider: toolCallingProvider("deploy", { target: "prod" }),
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => true,
      toolRegistry: registry,
      deniedPermissions: ["filesystem.write"],
      maxSteps: 4,
    });

    expect(executed()).toBe(0);
    const events = store.recentAudit(50).map((e) => e.event);
    expect(events).toContain("capability.denied");
    const deniedDetail = store
      .recentAudit(50)
      .filter((e) => e.event === "capability.denied")
      .map((e) => JSON.parse(e.detail));
    expect(deniedDetail.some((d) => String(d.reason).includes("denied by policy"))).toBe(true);
    store.close();
  });

  test("without a deny-list the same call is allowed (the list is what denies)", async () => {
    const store = new Store(join(tmp, "f.db"));
    const { registry, executed } = registryWithCounterTool();

    await runAgent("deploy it", "agent", {
      provider: toolCallingProvider("deploy", { target: "prod" }),
      store,
      cwd: tmp,
      say: () => {},
      approve: async () => true,
      toolRegistry: registry,
      deniedPermissions: [],
      maxSteps: 4,
    });
    expect(executed()).toBe(1);
    store.close();
  });
});
