/** XR 5.1 — Environment classifier unit tests (risk/reversibility/approval). */
import { describe, test, expect } from "bun:test";
import {
  assessEnvironmentAction,
  environmentForAction,
  interactionFor,
  reversibilityFor,
} from "../../src/environment/classify.ts";
import type { EnvironmentActionRequest } from "../../src/environment/types.ts";
import type { Action } from "../../src/control/types.ts";

function req(over: Partial<EnvironmentActionRequest> & { action: Action }): EnvironmentActionRequest {
  return {
    environment: "desktop",
    target: { kind: "none" },
    sourceActor: "cli",
    confidence: "unknown",
    dryRun: false,
    ...over,
  } as EnvironmentActionRequest;
}

describe("environmentForAction mapping", () => {
  test("maps every action type to exactly one environment", () => {
    expect(environmentForAction({ type: "browser", op: "goto", value: "https://x.com" })).toBe("browser");
    expect(environmentForAction({ type: "file", op: "read", path: "/tmp/a" })).toBe("filesystem");
    expect(environmentForAction({ type: "app", name: "Safari" })).toBe("application");
    expect(environmentForAction({ type: "open", target: "https://x.com" })).toBe("application");
    expect(environmentForAction({ type: "editor", op: "open", editor: "code" })).toBe("application");
    expect(environmentForAction({ type: "click", x: 1, y: 2, button: "left" })).toBe("desktop");
    expect(environmentForAction({ type: "screenshot", target: "screen" })).toBe("desktop");
    expect(environmentForAction({ type: "computer_use", task: "x" })).toBe("desktop");
  });
});

describe("environment compatibility (fail closed)", () => {
  test("a browser action is not valid for the desktop environment", () => {
    const a = assessEnvironmentAction(
      req({ environment: "desktop", action: { type: "browser", op: "goto", value: "https://x.com" } }),
    );
    expect(a.blockedReason).toContain("not valid for the 'desktop' environment");
  });

  test("a file action is not valid for the browser environment", () => {
    const a = assessEnvironmentAction(
      req({ environment: "browser", action: { type: "file", op: "read", path: "/tmp/a" } }),
    );
    expect(a.blockedReason).toBeTruthy();
  });

  test("vision can never execute — observation only", () => {
    const a = assessEnvironmentAction(req({ environment: "vision", action: { type: "click", x: 1, y: 2, button: "left" } }));
    expect(a.blockedReason).toContain("observation");
  });

  test("the right action in the right environment is not blocked", () => {
    const a = assessEnvironmentAction(
      req({ environment: "browser", action: { type: "browser", op: "goto", value: "https://x.com" }, target: { kind: "resource", path: "https://x.com" } }),
    );
    expect(a.blockedReason).toBeUndefined();
  });
});

describe("interaction kinds", () => {
  test("browser ops are semantic; pointer ops are coordinate; file ops structural", () => {
    expect(interactionFor({ type: "browser", op: "click", selector: "#a" }, { kind: "semantic", selector: "#a", evidence: "dom" })).toBe("semantic");
    expect(interactionFor({ type: "click", x: 1, y: 2, button: "left" }, { kind: "coordinate", x: 1, y: 2, evidence: "obs" })).toBe("coordinate");
    expect(interactionFor({ type: "file", op: "write", path: "/tmp/a", content: "x" }, { kind: "resource", path: "/tmp/a" })).toBe("structural");
    expect(interactionFor({ type: "screenshot", target: "screen" }, { kind: "none" })).toBe("stream");
  });
});

describe("reversibility classes (honest)", () => {
  test("reads and ephemeral UI are reversible", () => {
    expect(reversibilityFor({ type: "wait_ms", ms: 100 }, "structural")).toBe("reversible");
    expect(reversibilityFor({ type: "file", op: "read", path: "/tmp/a" }, "structural")).toBe("reversible");
    expect(reversibilityFor({ type: "browser", op: "extract" }, "semantic")).toBe("reversible");
  });

  test("file mutations are compensatable except delete", () => {
    expect(reversibilityFor({ type: "file", op: "write", path: "/tmp/a", content: "x" }, "structural")).toBe("compensatable");
    expect(reversibilityFor({ type: "file", op: "move", path: "/tmp/a", targetPath: "/tmp/b" }, "structural")).toBe("compensatable");
    expect(reversibilityFor({ type: "file", op: "mkdir", path: "/tmp/a" }, "structural")).toBe("compensatable");
    expect(reversibilityFor({ type: "file", op: "delete", path: "/tmp/a" }, "structural")).toBe("irreversible");
  });

  test("coordinate clicks are unknown — effect depends on unverifiable target", () => {
    expect(reversibilityFor({ type: "click", x: 1, y: 2, button: "left" }, "coordinate")).toBe("unknown");
  });

  test("form submission and destructive keys are irreversible", () => {
    expect(reversibilityFor({ type: "browser", op: "submit", selector: "form" }, "semantic")).toBe("irreversible");
    expect(reversibilityFor({ type: "key", keys: ["enter"] }, "structural")).toBe("irreversible");
  });

  test("computer_use loops are unknown reversibility", () => {
    expect(reversibilityFor({ type: "computer_use", task: "x" }, "stream")).toBe("unknown");
  });
});

describe("approval strength", () => {
  test("safe + reversible + non-coordinate → no approval", () => {
    const a = assessEnvironmentAction(req({ action: { type: "wait_ms", ms: 100 } }));
    expect(a.approval).toBe("none");
  });

  test("sensitive reversible → standard approval", () => {
    const a = assessEnvironmentAction(req({ environment: "application", action: { type: "app", name: "Safari" } }));
    expect(a.approval).toBe("standard");
  });

  test("irreversible → strong, reason disclosed", () => {
    const a = assessEnvironmentAction(req({ environment: "filesystem", action: { type: "file", op: "delete", path: "/tmp/a" } }));
    expect(a.approval).toBe("strong");
    expect(a.approvalReason).toContain("irreversible");
  });

  test("unknown reversibility → strong (treated as irreversible)", () => {
    const a = assessEnvironmentAction(
      req({
        action: { type: "click", x: 1, y: 2, button: "left" },
        target: { kind: "coordinate", x: 1, y: 2, evidence: "obs_9" },
        observationRef: "obs_9",
        confidence: "high",
      }),
    );
    expect(a.approval).toBe("strong");
  });

  test("sensitive values → strong", () => {
    const a = assessEnvironmentAction(req({ action: { type: "type", text: "hunter2", sensitive: true } }));
    expect(a.approval).toBe("strong");
    expect(a.approvalReason).toContain("sensitive");
  });
});

describe("coordinate proof requirements", () => {
  const click: Action = { type: "click", x: 10, y: 20, button: "left" };

  test("coordinate action without a coordinate target is blocked", () => {
    const a = assessEnvironmentAction(req({ action: click }));
    expect(a.blockedReason).toContain("coordinate");
  });

  test("coordinate action without observationRef is blocked", () => {
    const a = assessEnvironmentAction(
      req({ action: click, target: { kind: "coordinate", x: 10, y: 20, evidence: "obs_1" }, confidence: "high" }),
    );
    expect(a.blockedReason).toContain("observationRef");
  });

  test("coordinate action with sub-medium confidence is blocked", () => {
    const a = assessEnvironmentAction(
      req({
        action: click,
        target: { kind: "coordinate", x: 10, y: 20, evidence: "obs_1" },
        observationRef: "obs_1",
        confidence: "unknown",
      }),
    );
    expect(a.blockedReason).toContain("confidence");
  });

  test("fully-evidenced high-confidence coordinate action passes the gate", () => {
    const a = assessEnvironmentAction(
      req({
        action: click,
        target: { kind: "coordinate", x: 10, y: 20, evidence: "obs_1" },
        observationRef: "obs_1",
        confidence: "high",
      }),
    );
    expect(a.blockedReason).toBeUndefined();
  });

  test("low-confidence perception is surfaced as user-visible uncertainty", () => {
    const a = assessEnvironmentAction(
      req({ action: { type: "computer_use", task: "clean desktop" }, confidence: "unknown" }),
    );
    expect(a.uncertainty).toBeTruthy();
  });
});
