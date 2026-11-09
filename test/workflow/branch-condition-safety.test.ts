/**
 * Preview 1 / D1 — branch conditions never evaluate author-supplied source.
 *
 * Before this change `src/execution/workflow/engine.ts` ran
 * `new Function("ctx", "use strict"; return (<expression>);")` on the `expression`
 * field of a branch condition. A workflow is data: it can be authored in the
 * desktop inspector, imported from a file, or produced by a model. Compiling
 * that string in the engine's own realm is remote code execution.
 *
 * These tests are the regression net. They assert:
 *   1. hostile expressions never execute (a global sentinel stays untouched)
 *   2. the node fails loudly instead of silently taking a branch
 *   3. lint rejects a stored `expression` condition before it can run
 *   4. the canvas compiler cannot produce an expression condition any more
 *   5. the typed conditions still route correctly (no functional regression)
 *   6. no evaluator primitive survives anywhere in the workflow subsystem
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { WorkflowRepository } from "../../src/execution/workflow/repository.ts";
import { WorkflowEngine } from "../../src/execution/workflow/engine.ts";
import * as n from "../../src/execution/workflow/nodes.ts";
import { createDraft, publishDraft } from "../../src/execution/workflow/versioning.ts";
import { lintDefinition } from "../../src/execution/workflow/lint.ts";
import { decompileDefinition } from "../../src/execution/workflow/canvas.ts";
import type { BranchCondition, WorkflowDefinition } from "../../src/execution/workflow/types.ts";

const WF_SRC = join(import.meta.dir, "..", "..", "src", "execution", "workflow");

/** Payloads that must never reach an evaluator. Each would prove RCE if it ran. */
const HOSTILE: string[] = [
  `constructor.constructor("return process")()`,
  `this.constructor.constructor("return globalThis")()`,
  `(()=>{globalThis.__XR_PWNED__=1;return true})()`,
  `process.mainModule.require("node:child_process").execSync("id")`,
  `ctx["__proto__"]["polluted"] = true`,
  `Object.setPrototypeOf({}, null) && true`,
  `require("node:fs").writeFileSync("/tmp/xr-pwned","x")`,
  `globalThis.__XR_PWNED__ = 1`,
];

function setup() {
  const home = mkdtempSync(join(tmpdir(), "xr-wf-sec-"));
  const store = new WorkspaceStore(join(home, "workflows.db"));
  const repo = new WorkflowRepository(store);
  const engine = new WorkflowEngine({
    agentRunner: { runAgentTask: async () => ({ summary: "ok", structured: {}, artifacts: [] }) } as any,
    executionRecorder: { recordExecution: async () => `ex_${Date.now()}` } as any,
    contextProvider: { buildContextPackage: async () => ({ packageId: "ctx" }) } as any,
    runStore: repo,
  });
  return { home, store, engine };
}

/** A definition carrying a condition the type system no longer allows. */
function definitionWith(condition: unknown): { published: WorkflowDefinition; branchId: string } {
  const trigger = n.trigger("Start", { type: "manual" });
  const yes = n.deterministic("Yes", "builtin:transform_json", {}, { dependencies: [] });
  const no = n.deterministic("No", "builtin:transform_json", {}, { dependencies: [] });
  const br = n.branch("Decide", { type: "field_compare", field: "x", operator: "eq", value: 1 }, [yes.id], [no.id], {
    dependencies: [trigger.id],
  });
  // The point of the test: an attacker-controlled (or legacy) condition object.
  (br as { condition: unknown }).condition = condition;
  const draft = createDraft({
    name: "Hostile",
    nodes: [trigger, br, yes, no],
    entryNodeIds: [trigger.id],
    authoredBy: { kind: "user", id: "test" },
  });
  return { published: publishDraft(draft), branchId: br.id };
}

describe("D1 — branch conditions never execute author-supplied source", () => {
  beforeEach(() => {
    delete (globalThis as any).__XR_PWNED__;
  });
  afterEach(() => {
    delete (globalThis as any).__XR_PWNED__;
  });

  for (const payload of HOSTILE) {
    test(`expression condition is not evaluated: ${payload.slice(0, 46)}`, async () => {
      const { store, engine } = setup();
      try {
        const { published, branchId } = definitionWith({ type: "expression", expression: payload, description: "p" });
        engine.publishDefinition(published);
        const run = await engine.startRun(published.definitionId, published.version, {
          initiatedBy: { type: "manual" },
        });
        const executed = await engine.executeRun(run.runId);

        // 1. nothing ran
        expect((globalThis as any).__XR_PWNED__).toBeUndefined();
        // 2. the branch node did not complete as if it had an answer
        const state = executed.nodeStates.get(branchId);
        expect(state).toBeDefined();
        expect(state!.state).not.toBe("completed");
        expect(String(state!.error ?? "")).toMatch(/unsupported condition type/i);
        // 3. the run itself is not reported as a clean success
        expect(executed.state).not.toBe("completed");
      } finally {
        store.close();
      }
    });
  }

  test("a well-formed typed condition still routes correctly (no regression)", async () => {
    const { store, engine } = setup();
    try {
      const trigger = n.trigger("Start", { type: "manual" });
      const yes = n.deterministic("Yes", "builtin:transform_json", {}, {});
      const no = n.deterministic("No", "builtin:transform_json", {}, {});
      const br = n.branch("Decide", { type: "field_exists", field: "anything" }, [yes.id], [no.id], {
        dependencies: [trigger.id],
      });
      const draft = createDraft({
        name: "Typed",
        nodes: [trigger, br, yes, no],
        entryNodeIds: [trigger.id],
        authoredBy: { kind: "user", id: "test" },
      });
      const published = publishDraft(draft);
      engine.publishDefinition(published);
      const run = await engine.startRun(published.definitionId, published.version, { initiatedBy: { type: "manual" } });
      const executed = await engine.executeRun(run.runId);
      const branchState = executed.nodeStates.get(br.id);
      expect(branchState?.state).toBe("completed");
      expect(branchState?.outputs).toMatchObject({ conditionResult: false });
    } finally {
      store.close();
    }
  });

  test("lint rejects a stored expression condition with an actionable code", () => {
    const trigger = n.trigger("Start", { type: "manual" });
    const yes = n.deterministic("Yes", "builtin:transform_json", {}, {});
    const no = n.deterministic("No", "builtin:transform_json", {}, {});
    const br = n.branch("Decide", { type: "field_exists", field: "x" }, [yes.id], [no.id], {
      dependencies: [trigger.id],
    });
    (br as { condition: unknown }).condition = { type: "expression", expression: "process.exit(1)", description: "" };
    const report = lintDefinition([trigger, br, yes, no]);
    const codes = report.problems.map((i: { code: string }) => i.code);
    expect(codes).toContain("branch_unsupported_condition");
    expect(report.ok).toBe(false);
  });

  test("the canvas compiler cannot produce an expression condition", () => {
    const trigger = n.trigger("Start", { type: "manual" });
    const br = n.branch("Decide", { type: "field_exists", field: "x" }, [], []);
    const canvas = decompileDefinition({ nodes: [trigger, br] } as any);
    const branchNode = canvas.nodes.find((x) => x.kind === "branch");
    expect(branchNode).toBeDefined();
    expect(branchNode!.config.conditionType).not.toBe("expression");
    expect(branchNode!.config.expression).toBeUndefined();
  });

  test("no evaluator primitive exists anywhere in src/execution/workflow", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(WF_SRC)) {
      if (!file.endsWith(".ts")) continue;
      const text = readFileSync(join(WF_SRC, file), "utf8");
      for (const prim of ["new Function(", "eval(", "vm.runInNewContext", "vm.runInThisContext", "runInNewContext"]) {
        if (text.includes(prim)) offenders.push(`${file}: ${prim}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the type surface itself no longer admits an expression condition", () => {
    // Compile-time proof plus a runtime assertion on the exported allow-list.
    const types = readFileSync(join(WF_SRC, "types.ts"), "utf8");
    expect(types).not.toMatch(/type:\s*"expression"/);
    const allowed: string[] = [...(require("../../src/execution/workflow/types.ts").BRANCH_CONDITION_TYPES as string[])];
    expect(allowed).not.toContain("expression");
    const typed: BranchCondition = { type: "field_compare", field: "a", operator: "eq", value: 1 };
    expect(typed.type).toBe("field_compare");
  });
});
