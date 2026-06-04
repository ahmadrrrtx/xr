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
import { Store } from "../src/state/db.ts";
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
  const g = new CostGovernor({ maxTokens: 1000 }, { inPerMTok: 0, outPerMTok: 0 });
  g.record(400, 100); // 500 used, avg 500/step
  const d = g.checkBeforeStep(); // est next ~500 → 1000, not over yet
  // 500 + 500 = 1000 which is > 1000? no, equal boundary → allow (strict >)
  expect(d.allow).toBe(true);
  g.record(400, 100); // now 1000 used
  expect(g.checkBeforeStep().allow).toBe(false); // already at ceiling
});

test("local (ollama) pricing is free", () => {
  expect(isLocal("ollama")).toBe(true);
  const p = priceFor("ollama", "qwen2.5:7b");
  expect(p.inPerMTok).toBe(0);
  expect(p.outPerMTok).toBe(0);
});

test("groq 70b is free tier", () => {
  const p = priceFor("groq", "llama-3.3-70b");
  expect(p.inPerMTok).toBe(0);
  expect(p.outPerMTok).toBe(0);
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
