/** XR 5.1 — Workflow binding tests (environment actions as canonical nodes). */
import { describe, test, expect } from "bun:test";
import {
  buildEnvironmentActionNode,
  idempotencyFor,
  riskTierFor,
} from "../../src/environment/workflow-binding.ts";
import { assessEnvironmentAction } from "../../src/environment/classify.ts";
import type { EnvironmentActionRequest } from "../../src/environment/types.ts";

function req(over: Partial<EnvironmentActionRequest> & { action: EnvironmentActionRequest["action"] }): EnvironmentActionRequest {
  return {
    environment: "browser",
    target: { kind: "none" },
    sourceActor: "workflow",
    confidence: "unknown",
    dryRun: false,
    ...over,
  } as EnvironmentActionRequest;
}

describe("idempotency + risk tier mapping", () => {
  test("reversibility drives idempotency class", () => {
    expect(idempotencyFor("reversible")).toBe("naturally_idempotent");
    expect(idempotencyFor("compensatable")).toBe("idempotent_with_key");
    expect(idempotencyFor("irreversible")).toBe("non_idempotent");
    expect(idempotencyFor("unknown")).toBe("non_idempotent");
  });

  test("risk tier follows risk level + approval strength", () => {
    const destructive = assessEnvironmentAction(req({ action: { type: "browser", op: "submit", selector: "form" } }));
    expect(riskTierFor(destructive)).toBe("high");
    const safe = assessEnvironmentAction(req({ action: { type: "browser", op: "extract", selector: "h1" } }));
    expect(riskTierFor(safe)).toBe("low");
  });
});

describe("buildEnvironmentActionNode", () => {
  test("a governed extract becomes a canonical tool_action node", () => {
    const res = buildEnvironmentActionNode({
      id: "read_price",
      label: "Read price from catalog page",
      request: req({ action: { type: "browser", op: "extract", selector: ".price" } }),
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.node.kind).toBe("tool_action");
    expect(res.node.capability.family).toBe("control_action");
    expect(res.node.capability.name).toBe("environment.browser.browser.extract");
    expect(res.node.riskTier).toBe("low");
    expect(res.node.requiresApproval).toBe(false);
    expect(res.node.idempotency).toBe("naturally_idempotent");
  });

  test("sensitive-value actions never leak secrets into node inputs", () => {
    const res = buildEnvironmentActionNode({
      id: "fill_login",
      label: "Fill the login form",
      request: req({
        action: { type: "browser", op: "fill", selector: "#pw", value: "hunter2", sensitive: true },
      }),
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.node.riskTier).toBe("high"); // strong approval on sensitive values
    expect(res.node.requiresApproval).toBe(true);
    expect(JSON.stringify(res.node.inputs)).not.toContain("hunter2");
    expect(res.node.inputSummary).toContain("«redacted»");
  });

  test("compensatable actions get compensation metadata and one bounded retry", () => {
    const res = buildEnvironmentActionNode({
      id: "write_tmp",
      label: "Write a scratch file",
      request: req({ environment: "filesystem", action: { type: "file", op: "write", path: "/tmp/x.txt", content: "hi" } }),
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.node.compensation?.supported).toBe(true);
    expect(res.node.compensation?.scope).toBe("compensating_transaction");
    expect(res.node.retry.maxRetries).toBe(1);
    expect(res.node.onFailure.action).toBe("compensate");
    expect(res.node.idempotencyKeyTemplate).toBeTruthy();
  });

  test("irreversible actions never retry and never claim compensation", () => {
    const res = buildEnvironmentActionNode({
      id: "submit_form",
      label: "Submit the form",
      request: req({ action: { type: "browser", op: "submit", selector: "form" } }),
    });
    if (!res.ok) throw new Error(res.error);
    expect(res.node.retry.maxRetries).toBe(0);
    expect(res.node.retry.retryableErrors).toEqual(["none"]);
    expect(res.node.compensation?.supported).toBe(false);
    expect(res.node.compensation?.description).toContain("no rollback");
    expect(res.node.riskTier).toBe("high");
    expect(res.node.requiresApproval).toBe(true);
    expect(res.node.idempotency).toBe("non_idempotent");
  });

  test("blocked actions must never enter a workflow definition", () => {
    const res = buildEnvironmentActionNode({
      id: "nope",
      label: "Coordinate click without evidence",
      request: req({ environment: "desktop", action: { type: "click", x: 1, y: 2, button: "left" } }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("coordinate");
  });
});
