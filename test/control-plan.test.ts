/**
 * XR v0.8.1 — tests for the planner, browser-action classification,
 * and the approval queue. No real OS / network / browser calls.
 */

import { describe, it, expect } from "bun:test";
import { ActionSchema } from "../src/control/types.ts";
import { classify } from "../src/control/classify.ts";
import { _internal_parsePlan } from "../src/control/planner.ts";
import { approvals } from "../src/control/approvals.ts";

// ── browser action schema ──────────────────────────────────────────────────

describe("ActionSchema — browser variant", () => {
  it("accepts well-formed browser actions", () => {
    const cases = [
      { type: "browser", op: "goto", value: "https://example.com" },
      { type: "browser", op: "click", selector: "text=Login" },
      { type: "browser", op: "fill", selector: "#email", value: "a@b.c" },
      { type: "browser", op: "fill", selector: "#pw", value: "x", sensitive: true },
      { type: "browser", op: "wait", selector: ".dash", timeoutMs: 2000 },
      { type: "browser", op: "close" },
    ];
    for (const c of cases) expect(ActionSchema.safeParse(c).success).toBe(true);
  });

  it("rejects malformed browser actions", () => {
    expect(ActionSchema.safeParse({ type: "browser" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "browser", op: "invalid" }).success).toBe(false);
    expect(ActionSchema.safeParse({ type: "browser", op: "fill", selector: "x", value: "y", timeoutMs: 999999 }).success).toBe(false);
  });
});

// ── browser classification ─────────────────────────────────────────────────

describe("classify() — browser ops", () => {
  it("treats submit / sensitive-fill / dangerous goto as destructive", () => {
    expect(classify({ type: "browser", op: "submit", selector: "form" }).level).toBe("destructive");
    expect(classify({ type: "browser", op: "fill", selector: "#x", value: "p", sensitive: true }).level).toBe("destructive");
    expect(classify({ type: "browser", op: "goto", value: "javascript:alert(1)" }).level).toBe("destructive");
    expect(classify({ type: "browser", op: "press", value: "Enter" }).level).toBe("destructive");
  });
  it("treats fill / click / type / normal goto as sensitive", () => {
    expect(classify({ type: "browser", op: "fill", selector: "#x", value: "y" }).level).toBe("sensitive");
    expect(classify({ type: "browser", op: "click", selector: "a" }).level).toBe("sensitive");
    expect(classify({ type: "browser", op: "goto", value: "https://example.com" }).level).toBe("sensitive");
  });
  it("treats wait / screenshot / extract / close as safe", () => {
    expect(classify({ type: "browser", op: "wait", selector: ".x" }).level).toBe("safe");
    expect(classify({ type: "browser", op: "screenshot" }).level).toBe("safe");
    expect(classify({ type: "browser", op: "extract", selector: "h1" }).level).toBe("safe");
    expect(classify({ type: "browser", op: "close" }).level).toBe("safe");
  });
});

// ── planner parsing ────────────────────────────────────────────────────────

describe("planner — JSON parsing & validation", () => {
  it("parses a valid JSON plan", () => {
    const raw = JSON.stringify({
      rationale: "open GitHub and search",
      actions: [
        { type: "browser", op: "goto", value: "https://github.com" },
        { type: "browser", op: "fill", selector: "input[name=q]", value: "xr" },
        { type: "browser", op: "press", value: "Enter" },
      ],
    });
    const result = _internal_parsePlan(raw, "open github and search xr");
    expect("plan" in result).toBe(true);
    if ("plan" in result) {
      expect(result.plan.actions.length).toBe(3);
      expect(result.plan.rationale).toContain("GitHub");
    }
  });

  it("tolerates markdown code fences", () => {
    const raw = "```json\n" + JSON.stringify({
      rationale: "x",
      actions: [{ type: "open", target: "https://example.com" }],
    }) + "\n```";
    const result = _internal_parsePlan(raw, "open example");
    expect("plan" in result).toBe(true);
  });

  it("rejects garbage", () => {
    expect("error" in _internal_parsePlan("not json", "x")).toBe(true);
    expect("error" in _internal_parsePlan("{not json", "x")).toBe(true);
  });

  it("rejects plans with invalid actions", () => {
    const raw = JSON.stringify({
      rationale: "x",
      actions: [{ type: "evil", payload: "rm -rf /" }],
    });
    const result = _internal_parsePlan(raw, "x");
    expect("error" in result).toBe(true);
  });

  it("trims plans longer than the limit", () => {
    const actions = Array.from({ length: 50 }, (_, i) => ({ type: "scroll", direction: "down", amount: 1 }));
    const raw = JSON.stringify({ rationale: "x", actions });
    const result = _internal_parsePlan(raw, "x", 5);
    expect("plan" in result).toBe(true);
    if ("plan" in result) expect(result.plan.actions.length).toBe(5);
  });
});

// ── approvals queue ────────────────────────────────────────────────────────

describe("approvals queue", () => {
  it("resolves when answered", async () => {
    const p = approvals.request(
      { type: "focus", name: "Safari" },
      { level: "safe", reason: "test", reversible: true },
      "focus Safari",
    );
    expect(approvals.list().some((x) => x.id === p.id)).toBe(true);
    setTimeout(() => approvals.answer(p.id, true), 10);
    const answered = await p.promise;
    expect(answered).toBe(true);
    expect(approvals.list().some((x) => x.id === p.id)).toBe(false);
  });

  it("returns false for unknown ids", () => {
    expect(approvals.answer("nope", true)).toBe(false);
  });

  it("resolve() is idempotent", async () => {
    const p = approvals.request(
      { type: "focus", name: "X" },
      { level: "safe", reason: "t", reversible: true },
      "x",
    );
    p.resolve(true);
    p.resolve(false); // should not throw, should not change anything
    expect(await p.promise).toBe(true);
  });
});
