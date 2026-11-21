/**
 * XR — Cost Governor tests. The headline guarantee: the agent CANNOT
 * exceed the ceiling, enforced in deterministic code.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CostGovernor } from "../src/cost/governor.ts";
import { priceFor, isLocal } from "../src/cost/pricing.ts";
import { Store } from "../src/state/workspace-store.ts";
import { runAgent } from "../src/core/agent.ts";
import type { Provider } from "../src/core/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-cost-"));
  process.env.XR_HOME = join(tmp, "home");
});

test("governor records usage and computes USD correctly", () => {
  const g = new CostGovernor({ maxUsd: 1 }, { inPerMTok: 1, outPerMTok: 2 });
  g.record(1_000_000, 1_000_000); // 1M in @ $1 + 1M out @ $2 = $3
  expect(g.snapshot().usd).toBeCloseTo(3, 5);
  expect(g.overBudget()).toBe(true); // $3 >= $1 ceiling
});

test("governor blocks the next step before exceeding the token ceiling", () => {
  const g = new CostGovernor({ maxTokens: 1100 }, { inPerMTok: 0, outPerMTok: 0 });
  g.record(400, 100); // 500 used. Hardening B18: the next step re-sends 400 + 100 as input and replies ~100 → ~600
  const d = g.checkBeforeStep(); // 500 + 600 = 1100: equal boundary → allow (strict >)
  expect(d.allow).toBe(true);
  g.record(500, 100); // now 1100 used
  expect(g.checkBeforeStep().allow).toBe(false); // already at ceiling
});

test("local (ollama) pricing is free", () => {
  expect(isLocal("ollama")).toBe(true);
  const p = priceFor("ollama", "qwen2.5:7b");
  expect(p.inPerMTok).toBe(0);
  expect(p.outPerMTok).toBe(0);
});

test("hosted free-tier eligibility is not assumed; unknown Groq rates are unavailable", () => {
  const p = priceFor("groq", "llama-3.3-70b");
  expect(p.known).toBe(false);
  expect(Number.isNaN(p.inPerMTok)).toBe(true);
  expect(Number.isNaN(p.outPerMTok)).toBe(true);
});

test("AGENT LOOP: a tiny token ceiling stops the run (the headline guarantee)", async () => {
  const store = new Store(join(tmp, "g.db"));
  // Provider that always wants to keep going and reports usage each turn.
  const greedy: Provider = {
    id: "mock",
    label: "Mock",
    async chat() {
      return {
        message: "thinking more…",
        toolCalls: [],
        done: false, // never finishes on its own
        usage: { inTokens: 600, outTokens: 200 },
      };
    },
    async health() {
      return { ok: true };
    },
  };

  const result = await runAgent("loop forever", "agent", {
    provider: greedy,
    store,
    cwd: tmp,
    say: () => {},
    approve: async () => true,
    onOverBudget: async () => null, // user chooses to STOP when asked
    budget: { maxTokens: 1500 },
    pricing: { inPerMTok: 0, outPerMTok: 0 },
    maxSteps: 100,
  });

  // It must stop on budget, NOT run to maxSteps.
  expect(result.stopped).toBe("budget");
  store.close();
});

test("AGENT LOOP: raising the ceiling lets it continue", async () => {
  const store = new Store(join(tmp, "h.db"));
  let turns = 0;
  const provider: Provider = {
    id: "mock",
    label: "Mock",
    async chat() {
      turns++;
      // finish on the 3rd turn
      return {
        message: turns >= 3 ? "done" : "working",
        toolCalls: [],
        done: turns >= 3,
        usage: { inTokens: 600, outTokens: 200 },
      };
    },
    async health() {
      return { ok: true };
    },
  };

  const result = await runAgent("task", "agent", {
    provider,
    store,
    cwd: tmp,
    say: () => {},
    approve: async () => true,
    onOverBudget: async () => ({ tokens: 100_000 }), // always raise
    budget: { maxTokens: 1000 },
    pricing: { inPerMTok: 0, outPerMTok: 0 },
    maxSteps: 100,
  });

  expect(result.stopped).toBe("done");
  store.close();
});

// Hardening B18 — the estimator prices input and output separately and grows with the conversation.
test("B18: a later step is estimated from last-step growth, not the running average", () => {
  const g = new CostGovernor({ maxUsd: 0.0475 }, { inPerMTok: 1, outPerMTok: 5 });
  g.record(10_000, 1_000); // $0.015
  g.record(11_000, 1_000); // $0.016 — the context grew by the last reply
  // Average would admit ($0.031 + $0.0155 ≤ $0.0475) and then overshoot; the next step re-sends
  // 11k + 1k as input and replies ~1k: $0.017 → $0.048 > $0.0475, so it is refused before sending.
  const d = g.checkBeforeStep();
  expect(d.allow).toBe(false);
  if (!d.allow) expect(d.reason).toContain("per-task spend ceiling");
});

test("B18: a first step prices input and output at their own rates (not all at the output rate)", () => {
  // 2000 tokens at the $50 output rate would be $0.10 and refuse a $0.05 task outright;
  // 1500 in at $1 + 500 out at $50 is $0.0265, so the first step is admitted.
  const d = new CostGovernor({ maxUsd: 0.05 }, { inPerMTok: 1, outPerMTok: 50 }).checkBeforeStep();
  expect(d.allow).toBe(true);
});
