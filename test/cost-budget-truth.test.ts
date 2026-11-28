/**
 * Phase 3 — budget truth (B4, B5, B6, NEW-1).
 *
 *   • B4: every hosted preset default is priced from an official https source,
 *     or is a documented exception that refuses cleanly as `unpriced`; an
 *     unpriced refusal is its own stop state end to end and the task event
 *     carries the decision's real reason;
 *   • B5: past the facts' review date the last-known rates stay in force,
 *     flagged and warned once, unless the operator opts into refusal;
 *   • B6: monthlyCap 0 (block-all) needs confirmBlockAll; the $10 default is
 *     reported as the default;
 *   • NEW-1: warnings compare percentages with percentages.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRESETS } from "../src/providers/presets.ts";
import { priceFor, pricingAvailable } from "../src/cost/pricing.ts";
import { CostGovernor } from "../src/cost/governor.ts";
import { BudgetManager, type BudgetStore } from "../src/cost/manager.ts";
import { budgetTruthChecks, capLine, DEFAULT_MONTHLY_CAP_USD } from "../src/cost/budget-truth.ts";
import { MODEL_FACTS_STALE_AT, modelFact } from "../src/core/model-registry.ts";
import { Store } from "../src/state/workspace-store.ts";
import { runAgent } from "../src/core/agent.ts";
import type { Provider } from "../src/core/types.ts";
import { describeStop } from "../src/cli/coder/index.ts";
import { honestStopCheck } from "../src/services/multi-agent-task-support.ts";
import { makeHandler } from "../src/daemon/server.ts";

const KNOWN_UNPRICED: Record<string, string> = {
  huggingface: "the router bills each routed provider's own rate",
};

describe("B4 — every hosted preset default is priced, or refuses as unpriced", () => {
  const hosted = Object.values(PRESETS).filter((p) => p.kind === "hosted");
  test("there are 16 hosted presets and only the documented Hugging Face router is unpriced", () => {
    expect(hosted.length).toBe(16);
    expect(hosted.filter((p) => !pricingAvailable(priceFor(p.id, p.defaultModel))).map((p) => p.id).sort()).toEqual(Object.keys(KNOWN_UNPRICED).sort());
  });

  test("Hugging Face router per-model rates have an explicit documented declaration path", () => {
    const docs = readFileSync(new URL("../docs/budget-semantics.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(docs).toContain("providerEngine.providerCapabilities.<provider>.models.<model>.cost");
    expect(docs).toContain("Hugging Face Inference Providers route each model through a provider with its own rate");
  });

  test("Bedrock defaults to priced Nova Micro at the official Standard on-demand rate", () => {
    expect(PRESETS.bedrock.defaultModel).toBe("nova-micro");
    const price = priceFor("bedrock", PRESETS.bedrock.defaultModel);
    expect(price).toMatchObject({ inPerMTok: 0.035, outPerMTok: 0.14, known: true });
    expect(price.source).toBe("https://aws.amazon.com/bedrock/pricing/");
    expect(modelFact("bedrock", PRESETS.bedrock.defaultModel)?.lifecycle).toBe("active");
  });
  for (const p of hosted) {
    test(`${p.id} · ${p.defaultModel}`, () => {
      const price = priceFor(p.id, p.defaultModel);
      if (KNOWN_UNPRICED[p.id]) {
        const d = new CostGovernor({}, price).checkBeforeStep();
        expect(d.allow).toBe(false);
        if (!d.allow) expect(d.code).toBe("unpriced");
        return;
      }
      expect(pricingAvailable(price)).toBe(true);
      expect(price.inPerMTok).toBeGreaterThan(0);
      expect(price.outPerMTok).toBeGreaterThan(0);
      const fact = modelFact(p.id, p.defaultModel);
      expect(fact?.lifecycle).toBe("active");
      expect(fact?.price?.source).toMatch(/^https:\/\//);
    });
  }
});

describe("B4 — an unpriced refusal is its own stop state, never `budget`", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "xr-budget-truth-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  type Fired = Array<[string, Record<string, unknown> | undefined]>;
  async function run(provider: Provider, opts: { pricing: ReturnType<typeof priceFor>; maxTokens?: number }) {
    const store = new Store(join(dir, "state.db"));
    const fired: Fired = [];
    const statuses: string[] = [];
    let raiseOffered = false;
    const result = await runAgent("task", "agent", {
      provider, store, cwd: dir, say: () => {}, approve: async () => true, maxSteps: 20,
      onOverBudget: async () => { raiseOffered = true; return null; },
      budget: opts.maxTokens ? { maxTokens: opts.maxTokens } : {},
      pricing: opts.pricing,
      onStreamEvent: (e) => { if (e.type === "status") statuses.push(e.status); },
      taskLedger: { fire: (e: string, d?: Record<string, unknown>) => { fired.push([e, d]); } } as never,
    });
    store.close();
    return { result, fired, statuses, raiseOffered };
  }
  const neverCalled: Provider = { id: "groq", label: "Groq", async chat() { throw new Error("no request may be sent"); }, async health() { return { ok: true }; } };

  test("a price refusal stops as `unpriced`, offers no raise, and the task event carries the refusal's reason", async () => {
    const { result, fired, statuses, raiseOffered } = await run(neverCalled, { pricing: priceFor("groq", "no-such-model") });
    expect(result.stopped).toBe("unpriced");
    expect(raiseOffered).toBe(false);
    expect(statuses).toContain("unpriced_stopped");
    expect(statuses).not.toContain("budget_stopped");
    expect(fired.some(([e]) => e === "budget_block")).toBe(false);
    expect(String(fired.find(([e]) => e === "fail")?.[1]?.reason)).toContain("price unavailable");
  });

  test("a genuine budget stop's task event carries the decision's reason, not a hardcoded string", async () => {
    const greedy: Provider = { id: "mock", label: "Mock", async chat() { return { message: "more", toolCalls: [], done: false, usage: { inTokens: 600, outTokens: 200 } }; }, async health() { return { ok: true }; } };
    const { result, fired, raiseOffered } = await run(greedy, { pricing: { inPerMTok: 0, outPerMTok: 0 }, maxTokens: 1500 });
    expect(result.stopped).toBe("budget");
    expect(raiseOffered).toBe(true);
    const reason = String(fired.find(([e]) => e === "fail")?.[1]?.reason);
    expect(reason).not.toBe("budget ceiling reached; no raise granted");
    expect(reason).toContain("token ceiling");
  });

  test("the CLI and the multi-agent supervisor name the cause", () => {
    expect(describeStop({ sessionId: "s", steps: 0, stopped: "unpriced", finalMessage: "price unavailable: x" })).toContain("raising the budget will not help");
    expect(honestStopCheck({ sessionId: "s", steps: 0, stopped: "unpriced", finalMessage: "" })).toContain("no known price");
  });
});

describe("B5 — stale price facts warn, they do not brick", () => {
  const after = Date.parse(MODEL_FACTS_STALE_AT) + 86_400_000;
  afterEach(() => { delete process.env.XR_STALE_PRICE_FACTS; });

  test("past staleAt the last-known rates stay in force, flagged stale", () => {
    const p = priceFor("anthropic", "claude-sonnet-5-5", { now: after });
    expect(pricingAvailable(p)).toBe(true);
    expect(p.inPerMTok).toBe(2);
    expect(p.stale).toBe(true);
    expect(priceFor("anthropic", "claude-sonnet-5-5").stale).toBeUndefined();
  });

  test("XR_STALE_PRICE_FACTS=refuse is the operator's explicit opt-in to refusal", () => {
    process.env.XR_STALE_PRICE_FACTS = "refuse";
    expect(pricingAvailable(priceFor("anthropic", "claude-sonnet-5-5", { now: after }))).toBe(false);
    expect(pricingAvailable(priceFor("anthropic", "claude-sonnet-5-5"))).toBe(true);
  });

  test("admission on stale rates is allowed and the notice is shown once per process", () => {
    const stale = priceFor("anthropic", "claude-sonnet-5-5", { now: after });
    const first = new CostGovernor({}, stale).checkBeforeStep();
    const second = new CostGovernor({}, stale).checkBeforeStep();
    expect(first.allow && second.allow).toBe(true);
    expect(first.allow ? first.warning : "").toContain("past their review date");
    expect(second.allow ? second.warning : "x").toBeFalsy();
  });

  test("the desktop webview, which has no `process` global, still prices stale facts", () => {
    const saved = globalThis.process;
    let price: ReturnType<typeof priceFor> | undefined;
    Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
    try { price = priceFor("anthropic", "claude-sonnet-5-5", { now: after }); }
    finally { Object.defineProperty(globalThis, "process", { value: saved, configurable: true, writable: true }); }
    expect(price && pricingAvailable(price) && price.stale).toBe(true);
  });

  test("doctor states the freshness plainly", () => {
    expect(budgetTruthChecks(10, true, after)[1]).toMatchObject({ id: "price-facts", state: "warn" });
    expect(budgetTruthChecks(10, true)[1]).toMatchObject({ id: "price-facts", state: "ok" });
  });
});

describe("B6 — the default cap is visible and block-all must be confirmed", () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(), "xr-budget-set-")), "state.db"));
  const handler = makeHandler(store, "budget-truth-fixture");
  afterAll(() => store.close());
  const set = (body: unknown) => handler(new Request("http://127.0.0.1/api/budget/set", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer budget-truth-fixture" }, body: JSON.stringify(body),
  }));

  test("monthlyCap 0 without confirmBlockAll is refused and nothing changes", async () => {
    const res = await set({ monthlyCap: 0 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe("confirm-block-all");
    expect(store.getBudgetConfig()?.monthly_cap ?? DEFAULT_MONTHLY_CAP_USD).not.toBe(0);
  });

  test("monthlyCap 0 with confirmBlockAll is stored, and a non-zero cap needs no flag", async () => {
    expect((await set({ monthlyCap: 0, confirmBlockAll: true })).status).toBe(200);
    expect(store.getBudgetConfig()?.monthly_cap).toBe(0);
    expect((await set({ monthlyCap: 25 })).status).toBe(200);
    expect(store.getBudgetConfig()?.monthly_cap).toBe(25);
  });

  test("the $10 default is reported as XR's default, and 0 as block-all", () => {
    expect(capLine(DEFAULT_MONTHLY_CAP_USD, false)).toContain("default safety cap");
    expect(capLine(25, true)).toBe("$25.00");
    expect(capLine(0, true)).toContain("blocks ALL paid requests");
    expect(budgetTruthChecks(0, true)[0]).toMatchObject({ id: "budget-monthly-cap", state: "warn" });
  });
});

describe("NEW-1 — budget warnings use the percentage scale", () => {
  const manager = (spend: number, cap: number | null) => new BudgetManager({
    getBudgetConfig: () => (cap === null ? null : { monthly_cap: cap, daily_cap: null, warnings_enabled: true, auto_fallback: true }),
    setBudgetConfig: () => {},
    getSpendForPeriod: () => spend,
    clearCosts: () => {},
  } satisfies BudgetStore);

  test("1% of the cap spent does not claim 95% used", () => {
    expect(manager(0.1, 10).checkBudget(0.001)).toEqual({ allow: true });
  });
  test("96% spent warns at the 95% threshold", () => {
    const r = manager(9.6, 10).checkBudget(0.001);
    expect(r.allow ? r.warning : "").toContain("95% of monthly cap used");
  });
  test("a 0 cap blocks paid spend and reports 100%, not NaN", () => {
    expect(manager(0, 0).getStatus().percentUsed).toBe(100);
    expect(manager(0, 0).checkBudget(0.01).allow).toBe(false);
  });
  test("with nothing persisted the $10 default applies and is not reported as explicit", () => {
    expect(manager(0, null).getConfig().monthly_cap).toBe(DEFAULT_MONTHLY_CAP_USD);
    expect(manager(0, null).explicitCap()).toBe(false);
    expect(manager(0, 10).explicitCap()).toBe(true);
  });
});
