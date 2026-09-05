/**
 * Phase 6 · Step 5 — supervised fragment editing: role-set-locked,
 * structurally strict, fail-closed. The deterministic template stays the
 * default of record; this suite proves the EDIT can only reshape within the
 * declared shape, and any violation leaves the plan untouched.
 */

import { describe, expect, test } from "bun:test";
import { planningService, extractFirstJsonObject } from "../../src/services/planning-service.ts";
import { templateRoleSetFor } from "../../src/agents/planner.ts";
import { compileWorkflowPlan } from "../../src/agents/planner.ts";

function rec(kind: "research" | "build") {
  return compileWorkflowPlan({ goal: "g", cwd: ".", kind, withVerifier: kind === "build" });
}

function apply(record: ReturnType<typeof rec>, fragment: string, opts: Parameters<typeof planningService.applyPlanFragment>[2] = { maxEdits: 3 }) {
  return planningService.applyPlanFragment(record, fragment, opts);
}

describe("structural strictness", () => {
  test("prose is not a plan: no JSON object ⇒ denied", () => {
    const r = apply(rec("research"), "we should add a task to check pricing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/not a JSON object/);
  });

  test("unknown fields are DENIED, not dropped (strict schema)", () => {
    const r = apply(rec("research"), '{"skip":[], "add":[{"role":"researcher","name":"x","description":"y","tools":["shell"]}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/tools|unrecognized/i);
  });

  test("empty fragment denied; oversized denied; malformed JSON denied", () => {
    expect(apply(rec("research"), "{}").ok).toBe(false);
    expect(apply(rec("research"), '{"add":[{"role":"researcher","name":"n","description":"d".}]}').ok).toBe(false);
    const many = Array.from({ length: 5 }, (_, i) => `{"role":"researcher","name":"task ${i}","description":"an added investigation lane ${i} for gap closure"}`).join(",");
    expect(apply(rec("research"), `{"add":[${many}]}`).ok).toBe(false);
  });

  test("a JSON object embedded in surrounding text still parses (supervisor prose)", () => {
    const r = apply(rec("research"), 'Analysis: there is a gap.\n{"rename":[{"taskId":"' + rec("research").tasks[0]!.taskId + '","name":"Renamed intake"}]}\nDone.');
    expect(r.ok || (r.ok === false && r.errors.some((e) => /unknown task/.test(e)))).toBe(true);
  });

  test("extractFirstJsonObject is balance-aware", () => {
    expect(extractFirstJsonObject('x { "a": { "b": 1 } } y')).toEqual({ a: { b: 1 } });
    expect(extractFirstJsonObject('{"unterminated": ')).toBeNull();
    expect(extractFirstJsonObject('{"a":"{not json"}')).toEqual({ a: "{not json" });
  });
});

describe("role-set lock", () => {
  test("add of a role OUTSIDE the kind's template is denied", () => {
    const r = apply(rec("research"), '{"add":[{"role":"builder","name":"Build it","description":"Add an implementation lane to a research mission"}]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/not in the .* template's declared role set/);
  });

  test("add of an IN-set role is allowed and copies the registry profile", () => {
    const record = rec("research");
    const r = apply(record, '{"add":[{"role":"researcher","name":"Pricing counterpoint","description":"Investigate competitor pricing to close the synthesis gap"}]}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = r.record.tasks[r.record.tasks.length - 1]!;
    expect(added.role).toBe("researcher");
    expect(added.toolScope.tools).toContain("read_file");
    expect(added.toolScope.tools).not.toContain("write_file"); // researcher profile unchanged — the edit inherits, never widens
    expect(added.inputs.addedBy).toBe("supervisor-fragment-edit");
    expect(r.record.planVersion).toBe(1);
  });

  test("the declared role set is derived from the template, not hand-listed", () => {
    const research = new Set(templateRoleSetFor("research", true));
    expect(research.has("researcher")).toBe(true);
    expect(research.has("verifier")).toBe(true);
    expect(research.has("builder")).toBe(false);
    const build = new Set(templateRoleSetFor("build", true));
    expect(build.has("builder")).toBe(true);
  });
});

describe("gate integrity — skip rules", () => {
  test("review / security / verification / planner gates may NEVER be skipped", () => {
    for (const kind of ["research", "build"] as const) {
      const record = rec(kind);
      const gates = record.tasks.filter((t) => ["reviewer", "security_checker", "planner", "verifier"].includes(t.role));
      for (const g of gates) {
        const r = apply(record, `{"skip":["${g.taskId}"]}`);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.errors.join(" ")).toMatch(/gates are not removable/);
      }
    }
  });

  test("completed tasks are immutable to skip; pending non-gates may be skipped", () => {
    const record = rec("research");
    const memo = record.tasks.find((t) => t.role === "memory_manager")!;
    memo.status = "completed";
    let r = apply(record, `{"skip":["${memo.taskId}"]}`);
    expect(r.ok).toBe(false); // completed is untouchable
    const worker = record.tasks.find((t) => t.role === "researcher")!;
    r = apply(record, `{"skip":["${worker.taskId}"]}`);
    // ok=false here would only be due to OTHER tasks being completed (they aren't)
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The applied record carries the skip (r.record is the plan of record).
      expect(r.record.tasks.find((t) => t.taskId === worker.taskId)?.status).toBe("cancelled");
      expect(r.changes.some((c) => c.startsWith(`skip:${worker.taskId}`))).toBe(true);
    }
  });

  test("unknown task ids are denied", () => {
    const r = apply(rec("research"), '{"skip":["t_nope"],"rename":[{"taskId":"t_nope","name":"x"}]}');
    expect(r.ok).toBe(false);
  });
});

describe("budget lock — edits cannot mint money", () => {
  test("adds beyond the funding headroom are DENIED wholesale (partial plans are fiction)", () => {
    const r = apply(
      rec("research"),
      '{"add":[{"role":"researcher","name":"Extra lane one","description":"Extra investigation lane to probe a gap"},{"role":"researcher","name":"Extra lane two","description":"Another extra investigation lane probing another gap"}]}',
      { maxEdits: 3, budgetCheck: (added) => (added <= 1 ? { ok: true } : { ok: false, reason: "headroom funds 1, not 2" }) },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/headroom funds 1, not 2/);
  });

  test("rename-only edits never consult the money check", () => {
    let consulted = 0;
    const record = rec("research");
    const r = apply(record, `{"rename":[{"taskId":"${record.tasks[0]!.taskId}","name":"Scoped intake memo"}]}`, {
      maxEdits: 3,
      budgetCheck: (added) => {
        consulted += 1;
        return { ok: added === 0 };
      },
    });
    expect(r.ok).toBe(true);
    expect(consulted).toBe(0);
  });
});

describe("edit budget + versions", () => {
  test("the per-workflow edit cap applies (maxPlanEdits)", () => {
    const record = rec("research");
    record.planVersion = 3;
    const r = apply(record, '{"skip":["' + record.tasks.find((t) => t.role === "researcher")!.taskId + '"]}', { maxEdits: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/plan-edit budget exhausted/);
  });

  test("a denied edit leaves the record UNTOUCHED (no partial application)", () => {
    const record = rec("research");
    const before = JSON.stringify(record);
    const r = apply(record, '{"skip":["t_ghost"]}');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(record)).toBe(before);
  });
});
