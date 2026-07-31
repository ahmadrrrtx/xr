/**
 * XR Phase 2 · T1 — execution-envelope behaviour (EFFECT tests).
 *
 * `no-bypass.test.ts` proves nothing bypasses the envelope. This file proves
 * the envelope actually WORKS: that a run assembled through it produces real
 * effects — a session row, audit entries, tool execution through the single
 * registry — and that the outcome record is faithful.
 *
 * Art. III.4: "Effects, not transitions. Tests and workflows assert real
 * outcomes, not state-machine transitions alone."
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import {
  ENVELOPE_PHASES,
  assembleEnvelope,
  newEvidence,
  toOutcome,
  type ExecutionEnvelope,
} from "../../src/core/execution/envelope.ts";
import { runEnvelope } from "../../src/core/execution/runner.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";

let dir = "";
let store: WorkspaceStore;

/** A provider that replays a fixed script of turns. Deterministic, no network. */
function scriptProvider(turns: ModelTurn[]): Provider & { seenTools: Tool[][] } {
  let i = 0;
  const seenTools: Tool[][] = [];
  return {
    id: "script",
    label: "Script Provider",
    seenTools,
    async chat(_m: Message[], tools: Tool[]): Promise<ModelTurn> {
      seenTools.push(tools);
      return turns[Math.min(i++, turns.length - 1)]!;
    },
    async health() {
      return { ok: true };
    },
  };
}

function envelopeFor(
  provider: Provider,
  registry: ToolRegistryService,
  over: Partial<{ approve: ExecutionEnvelope["policy"]["approve"]; dryRun: boolean }> = {},
): ExecutionEnvelope {
  return assembleEnvelope({
    intent: { task: "do the thing", mode: "agent", surface: "test", cwd: dir },
    plan: { provider, providerId: provider.id, modelId: "m", maxSteps: 4 },
    policy: {
      budget: {},
      pricing: { inPerMTok: 0, outPerMTok: 0 },
      egressAllowlist: [],
      dryRun: over.dryRun ?? false,
      approve: over.approve ?? (async () => true),
    },
    placement: {
      placement: "in_process",
      registry,
      tools: registry.discover({ mode: "agent" }),
      collisions: registry.listCollisions(),
    },
    observation: { say: () => {} },
    evidence: newEvidence(),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-env-"));
  store = new WorkspaceStore("default", join(dir, "xr.db"));
});

afterEach(() => {
  try { store.close(); } catch { /* already closed */ }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("T1 — the envelope shape", () => {
  test("the eight phases are declared in canonical order", () => {
    expect([...ENVELOPE_PHASES]).toEqual([
      "intent", "plan", "policy", "placement", "action",
      "observation", "evidence", "outcome",
    ]);
  });

  test("every assembled envelope carries all phases and a unique id", () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const a = envelopeFor(scriptProvider([{ message: "", toolCalls: [], done: true }]), registry);
    const b = envelopeFor(scriptProvider([{ message: "", toolCalls: [], done: true }]), registry);

    for (const phase of ["intent", "plan", "policy", "placement", "observation", "evidence"] as const) {
      expect(a[phase]).toBeDefined();
    }
    expect(a.evidence.envelopeId).toMatch(/^env_/);
    expect(a.evidence.envelopeId).not.toBe(b.evidence.envelopeId);
  });

  test("toOutcome carries envelope identity, surface and placement into the record", () => {
    const registry = new ToolRegistryService();
    const env = envelopeFor(scriptProvider([{ message: "", toolCalls: [], done: true }]), registry);
    const outcome = toOutcome(env, {
      sessionId: "s1", finalMessage: "done", steps: 1, stopped: "done",
    });
    expect(outcome.envelopeId).toBe(env.evidence.envelopeId);
    expect(outcome.surface).toBe("test");
    expect(outcome.placement).toBe("in_process");
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("T1 — EFFECTS: a run through the envelope really happens", () => {
  test("a completed run creates a session and audits it", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const provider = scriptProvider([{ message: "all done", toolCalls: [], done: true }]);

    const outcome = await runEnvelope(envelopeFor(provider, registry), { store });

    expect(outcome.stopped).toBe("done");
    expect(outcome.finalMessage).toContain("all done");

    // EFFECT: a real session row exists.
    const sessions = store.prepare(`SELECT id FROM sessions`).all() as Array<{ id: string }>;
    expect(sessions.some((s) => s.id === outcome.sessionId)).toBe(true);

    // EFFECT: the audit chain recorded it and is intact.
    const audit = store.prepare(`SELECT event FROM audit_log`).all() as Array<{ event: string }>;
    expect(audit.some((a) => a.event === "session.start")).toBe(true);
    expect(store.verifyChain().valid).toBe(true);
  });

  test("a tool call through the envelope produces a real side effect", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const target = join(dir, "envelope-wrote-this.txt");
    const provider = scriptProvider([
      {
        message: "",
        toolCalls: [{ tool: "write_file", args: { path: target, content: "hello from the envelope" } }],
        done: false,
      },
      { message: "written", toolCalls: [], done: true },
    ]);

    const outcome = await runEnvelope(envelopeFor(provider, registry), { store });

    // EFFECT: the file is actually on disk with the right content.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("hello from the envelope");
    expect(outcome.stopped).toBe("done");
  });

  test("the model is offered EXACTLY the registry's arbitrated tool set", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    registry.registerTools({
      kind: "plugin",
      source: "acme",
      tools: [
        {
          name: "shell", // collides with a core tool on purpose
          description: "plugin shell",
          parameters: {},
          requiresApproval: false,
          async run() { return { ok: true, output: "plugin" }; },
        },
      ],
    });
    const provider = scriptProvider([{ message: "done", toolCalls: [], done: true }]);

    await runEnvelope(envelopeFor(provider, registry), { store });

    const offered = provider.seenTools[0]!.map((t) => t.name);
    // Core keeps the bare name; the plugin is offered only qualified.
    expect(offered.filter((n) => n === "shell")).toHaveLength(1);
    expect(offered).toContain("plugin:acme:shell");
  });

  test("a denied approval prevents the side effect (fail closed)", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const target = join(dir, "must-not-exist.txt");
    const provider = scriptProvider([
      { message: "", toolCalls: [{ tool: "write_file", args: { path: target, content: "nope" } }], done: false },
      { message: "stopped", toolCalls: [], done: true },
    ]);

    await runEnvelope(
      envelopeFor(provider, registry, { approve: async () => false }),
      { store },
    );

    // EFFECT: nothing was written.
    expect(existsSync(target)).toBe(false);
  });

  test("mode scoping is enforced at the envelope boundary: ask mode gets no writer", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const provider = scriptProvider([{ message: "done", toolCalls: [], done: true }]);

    const env = assembleEnvelope({
      intent: { task: "read only please", mode: "ask", surface: "test", cwd: dir },
      plan: { provider, providerId: provider.id, modelId: "m", maxSteps: 2 },
      policy: {
        budget: {}, pricing: { inPerMTok: 0, outPerMTok: 0 },
        egressAllowlist: [], dryRun: false, approve: async () => true,
      },
      placement: {
        placement: "in_process",
        registry,
        tools: registry.discover({ mode: "ask" }),
        collisions: [],
      },
      observation: { say: () => {} },
      evidence: newEvidence(),
    });

    await runEnvelope(env, { store });

    const offered = provider.seenTools[0]!.map((t) => t.name);
    expect(offered).toContain("read_file");
    expect(offered).not.toContain("write_file");
    expect(offered).not.toContain("shell");
  });

  test("an unknown tool name is refused, not guessed", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    const provider = scriptProvider([
      { message: "", toolCalls: [{ tool: "definitely_not_a_tool", args: {} }], done: false },
      { message: "done", toolCalls: [], done: true },
    ]);

    await runEnvelope(envelopeFor(provider, registry), { store });

    const audit = store.prepare(`SELECT event FROM audit_log`).all() as Array<{ event: string }>;
    expect(audit.some((a) => a.event === "tool.blocked")).toBe(true);
  });

  test("the step budget is honoured (no runaway)", async () => {
    const registry = new ToolRegistryService();
    registry.registerTools(coreToolContributions());
    // A provider that never says done.
    const provider = scriptProvider([
      { message: "thinking", toolCalls: [{ tool: "list_dir", args: { path: "." } }], done: false },
    ]);

    const outcome = await runEnvelope(envelopeFor(provider, registry), { store });

    expect(outcome.stopped).toBe("max_steps");
    expect(outcome.steps).toBeLessThanOrEqual(4);
  });
});

describe("T1 — diagnostics are surfaced, never swallowed", () => {
  test("assembly diagnostics ride along on the evidence phase", () => {
    const evidence = newEvidence(["plugins unavailable: boom"]);
    expect(evidence.diagnostics).toEqual(["plugins unavailable: boom"]);
  });
});
