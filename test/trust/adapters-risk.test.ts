import { describe, expect, test } from "bun:test";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import {
  mcpTrustRequest,
  controlTrustRequest,
  pluginTrustRequest,
  skillTrustRequest,
} from "../../src/runtime/trust/tool-support.ts";
import { makeTrust } from "./_helpers.ts";

describe("XR 4.2 adapter risk classification", () => {
  test("MCP tool → Tier 1; MCP resource/prompt → Tier 0", () => {
    expect(classifyRisk(mcpTrustRequest("mcp_tool", "search", "srv", "stdio", "/tmp/ws")).tier).toBe("tier1_restricted");
    expect(classifyRisk(mcpTrustRequest("mcp_resource", "doc", "srv", "stdio", "/tmp/ws")).tier).toBe("tier0_in_process");
    expect(classifyRisk(mcpTrustRequest("mcp_prompt", "p", "srv", "http", "/tmp/ws")).tier).toBe("tier1_restricted"); // network
  });

  test("control safe → Tier 0; sensitive → Tier 1; destructive → Tier 2 (host authority)", () => {
    expect(classifyRisk(controlTrustRequest("screenshot", "safe", "/tmp/ws")).tier).toBe("tier0_in_process");
    expect(classifyRisk(controlTrustRequest("click", "sensitive", "/tmp/ws")).tier).toBe("tier1_restricted");
    const c = classifyRisk(controlTrustRequest("computer_use", "destructive", "/tmp/ws"));
    expect(c.tier).toBe("tier2_isolated");
    expect(c.inputs.requiresHostAuthority).toBe(true);
  });

  test("plugin & skill operations → Tier 1 (VM/worker is not a hard boundary)", () => {
    expect(classifyRisk(pluginTrustRequest("plug", "invoke", "/tmp/ws")).tier).toBe("tier1_restricted");
    expect(classifyRisk(skillTrustRequest("skill", "run", "/tmp/ws")).tier).toBe("tier1_restricted");
  });

  test("a destructive control action is admitted in-process (host-authority gate), NOT blocked", async () => {
    const h = makeTrust();
    await h.trust.onInit();
    const ev = await h.trust.evaluate({
      request: controlTrustRequest("computer_use", "destructive", "/tmp/ws"),
      runId: "ex_ctrl", correlationId: "ex_ctrl", workspaceId: "ws", actor: "user:u", capability: "control_action:computer_use",
    });
    expect(ev.outcome.kind).toBe("in_process_ok");
    expect(ev.trust.classification.tier).toBe("tier2_isolated");
    expect(ev.trust.decision.reason).toContain("host-authority");
  });
});
