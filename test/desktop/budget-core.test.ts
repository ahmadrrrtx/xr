/*
 * Budget governor vectors (Phase 13). The same inputs are asserted in
 * src-tauri/src/budget/governor.rs (`mod tests`) — if you change a number
 * here, change it there.
 */
import { describe, expect, test } from "bun:test";

import {
  applySpend,
  breakdown,
  checkPreCall,
  countersFrom,
  deriveState,
  emptyCounters,
  evaluateTrip,
  eventsCsv,
  filterEvents,
  overviewFrom,
  seriesFor,
  usableLimit,
} from "../../desktop/src/budget/core";
import { estimateCost, modelInfo } from "../../desktop/src/budget/models";
import {
  civilFromDays,
  daysFromCivil,
  localDayStart,
  periodFor,
  shortDate,
} from "../../desktop/src/budget/period";
import { mulberry32, seedEvents } from "../../desktop/src/budget/seed";
import {
  DEFAULT_BUDGET_SETTINGS,
  DEFAULT_SPEND_FILTER,
  type BudgetSettings,
  type SpendEvent,
} from "../../desktop/src/budget/types";

/** 2026-10-05 14:30:00 PKT (UTC+5) → getTimezoneOffset() = -300. */
const NOW = Date.UTC(2026, 9, 5, 9, 30, 0);
const TZ = -300;

const settings = (patch: Partial<BudgetSettings> = {}): BudgetSettings => ({
  ...DEFAULT_BUDGET_SETTINGS,
  ...patch,
});

const period = (s = settings()) => periodFor(NOW, TZ, s.monthStartDay, null);

function counters(s: BudgetSettings, spentMonth = 0, spentToday = 0) {
  const p = period(s);
  const c = emptyCounters(p.start, localDayStart(NOW, TZ));
  c.spentMonth = spentMonth;
  c.spentToday = spentToday;
  return c;
}

const spend = (over: Partial<SpendEvent>): SpendEvent => ({
  id: over.id ?? `e-${Math.random().toString(16).slice(2)}`,
  ts: NOW - 60_000,
  kind: "llm_call",
  agent: "main",
  workspace: "xr",
  sessionId: "chat-1",
  model: "claude-sonnet-4.5",
  tokensIn: 1000,
  tokensOut: 500,
  costUsd: 0.0105,
  category: "llm",
  detail: null,
  ...over,
});

describe("period", () => {
  test("civil date round trip", () => {
    for (const [y, m, d] of [
      [1970, 1, 1],
      [2000, 2, 29],
      [2026, 10, 5],
      [2026, 12, 31],
      [2100, 3, 1],
    ]) {
      expect(civilFromDays(daysFromCivil(y, m, d))).toEqual({ y, m, d });
    }
    expect(daysFromCivil(2026, 10, 5)).toBe(20731);
  });

  test("calendar month from day 1", () => {
    const p = periodFor(NOW, TZ, 1, null);
    expect(new Date(p.start).toISOString()).toBe("2026-09-30T19:00:00.000Z"); // Oct 1 00:00 PKT
    expect(new Date(p.end).toISOString()).toBe("2026-10-31T19:00:00.000Z");
    expect(p.resetDate).toBe("2026-10-31");
    expect(shortDate(p.resetDate)).toBe("Oct 31");
    expect(p.daysUntilReset).toBe(27);
    expect(p.daysElapsed).toBe(5);
  });

  test("custom reset day wraps the previous month", () => {
    const p = periodFor(NOW, TZ, 15, null);
    expect(new Date(p.start).toISOString()).toBe("2026-09-14T19:00:00.000Z");
    expect(p.resetDate).toBe("2026-10-14");
    expect(p.daysUntilReset).toBe(10);
  });

  test("manual reset moves the start forward", () => {
    const resetAt = NOW - 2 * 86_400_000;
    const p = periodFor(NOW, TZ, 1, resetAt);
    expect(p.start).toBe(resetAt);
    expect(p.daysElapsed).toBe(3);
  });
});

describe("pricing", () => {
  test("registry estimate and unknown fallback", () => {
    expect(estimateCost("claude-sonnet-4.5", 2000, 800)).toBe(0.018);
    expect(estimateCost("gpt-5-mini", 2000, 800)).toBe(0.00078);
    expect(estimateCost("qwen2.5:3b", 2000, 800)).toBe(0);
    expect(estimateCost("mystery-9000", 2000, 800)).toBe(0.022);
    expect(modelInfo("mystery-9000").estimate).toBe(true);
    expect(modelInfo("llama3.1:70b").local).toBe(true);
  });
});

describe("governor", () => {
  const req = {
    model: "claude-sonnet-4.5",
    estimatedTokensIn: 2000,
    estimatedTokensOut: 800,
    agent: "main",
    workspace: "xr",
    sessionId: "chat-1",
    surface: "chat" as const,
  };

  test("fresh install: allowed, reserve held back", () => {
    const s = settings();
    const r = checkPreCall(s, counters(s), req, { now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("ok");
    expect(r.estimatedCost).toBe(0.018);
    expect(usableLimit(s)).toBe(4.5);
    expect(r.remaining).toBe(0.982); // daily $1 is the tightest cap
    expect(r.hardRemaining).toBe(1);
    expect(r.state).toBe("ok");
  });

  test("$0.01 cap blocks before the call starts", () => {
    const s = settings({ monthlyLimit: 0.01 });
    const r = checkPreCall(s, counters(s), req, {
      now: NOW,
      resetDate: "2026-10-31",
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("month");
    expect(r.reason).toBe(
      "Budget limit reached — you've spent $0.00 of your $0.01 limit. Raise the limit, switch to a local model, or wait for your reset on Oct 31.",
    );
  });

  test("$0.10 cap with $0.25 already spent blocks; raising the limit resumes", () => {
    const s = settings({ monthlyLimit: 0.1 });
    const c = counters(s, 0.25, 0.05);
    expect(checkPreCall(s, c, req, { now: NOW }).allowed).toBe(false);
    expect(deriveState(s, c)).toBe("capped");
    const raised = settings({ monthlyLimit: 5 });
    expect(checkPreCall(raised, c, req, { now: NOW }).allowed).toBe(true);
  });

  test("epsilon: $4.49996 of a $5 limit with 10% reserve is capped, $4.4998 is not", () => {
    const s = settings();
    expect(deriveState(s, counters(s, 4.49996))).toBe("capped");
    expect(deriveState(s, counters(s, 4.4998))).toBe("danger");
  });

  test("per-request: downshift first, deny when downshifting is off", () => {
    const big = {
      ...req,
      model: "gpt-5",
      estimatedTokensIn: 100_000,
      estimatedTokensOut: 20_000,
    };
    const s = settings();
    const r = checkPreCall(s, counters(s), big, { now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("downshifted");
    expect(r.downgradedToModel).toBe("gemini-2.5-flash"); // priciest cheaper model that fits $0.25
    expect(r.estimatedCost).toBe(0.08);
    const off = settings({ modelDownshifting: false });
    const d = checkPreCall(off, counters(off), big, { now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe("per-request");
    expect(d.reason).toContain("per-request limit of $0.25");
  });

  test("per-request $1 blocks a $1.20 call even with downshifting (nothing cheaper fits)", () => {
    const s = settings({
      perRequestLimit: 1,
      configuredModels: ["claude-opus-4-6"],
      installedLocal: [],
    });
    const r = checkPreCall(
      s,
      counters(s),
      {
        ...req,
        model: "claude-opus-4-6",
        estimatedTokensIn: 40_000,
        estimatedTokensOut: 8_000,
      },
      { now: NOW },
    );
    expect(r.estimatedCost).toBe(1.2);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("per-request");
  });

  test("approach downshift: Sonnet → Haiku at 80 %, → local at 85 %", () => {
    const s = settings();
    const warn = checkPreCall(s, counters(s, 4.0, 0), req, { now: NOW });
    expect(warn.code).toBe("downshifted");
    expect(warn.downgradedToModel).toBe("claude-haiku-4-6");
    expect(warn.downshiftWhy).toBe("80% of the monthly budget is used.");
    const danger = checkPreCall(s, counters(s, 4.3, 0), req, { now: NOW });
    expect(danger.downgradedToModel).toBe("qwen2.5-coder:3b");
    const noLocal = settings({ installedLocal: [] });
    expect(
      checkPreCall(noLocal, counters(noLocal, 4.3, 0), req, { now: NOW })
        .downgradedToModel,
    ).toBe("claude-haiku-4-6");
    const off = settings({ modelDownshifting: false });
    expect(
      checkPreCall(off, counters(off, 4.0, 0), req, { now: NOW }).code,
    ).toBe("ok");
  });

  test("reserve: a normal call is capped at 90 %, a finalization call may use the last 10 %", () => {
    const s = settings({ modelDownshifting: false });
    const c = counters(s, 4.49, 0);
    const normal = checkPreCall(s, c, req, { now: NOW });
    expect(normal.allowed).toBe(false);
    expect(normal.code).toBe("month");
    const final = checkPreCall(
      s,
      c,
      { ...req, finalization: true },
      { now: NOW },
    );
    expect(final.allowed).toBe(true);
    expect(final.remaining).toBe(0.492);
  });

  test("daily, agent and workspace caps are enforced in that order", () => {
    const s = settings({
      modelDownshifting: false,
      perAgentCaps: { main: 0.5 },
      perWorkspaceCaps: { xr: 0.4 },
    });
    const day = counters(s, 1.2, 0.99);
    expect(checkPreCall(s, day, req, { now: NOW }).code).toBe("day");
    const agent = counters(s, 1.2, 0.1);
    agent.agentMonth.main = 0.49;
    expect(checkPreCall(s, agent, req, { now: NOW }).code).toBe("agent");
    const ws = counters(s, 1.2, 0.1);
    ws.workspaceMonth.xr = 0.39;
    const r = checkPreCall(s, ws, req, { now: NOW });
    expect(r.code).toBe("workspace");
    expect(r.reason).toBe(
      "Workspace xr has reached its $0.40 cap this month. Raise it under Budget → Workspaces.",
    );
  });

  test("hard cap off: over the limit is allowed with a warning; state is over", () => {
    const s = settings({ hardCap: false, modelDownshifting: false });
    const c = counters(s, 5.2, 0.1);
    const r = checkPreCall(s, c, req, { now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("over-soft");
    expect(r.hardRemaining).toBeNull();
    expect(r.warning).toBe(
      "Over budget — $5.20 of $5.00 spent. Hard cap is off, so this call was allowed.",
    );
    expect(deriveState(s, c)).toBe("over");
    expect(evaluateTrip(s, c, NOW)).toBeNull(); // threshold breaker needs the hard cap
  });

  test("paused denies everything, including local models", () => {
    const s = settings({ paused: true, pauseReason: "manual" });
    const r = checkPreCall(
      s,
      counters(s),
      { ...req, model: "qwen2.5:3b" },
      { now: NOW },
    );
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("paused");
    expect(r.reason).toBe(
      "Spending is paused. Resume under Budget to continue.",
    );
  });

  test("$0 limit = local only: cloud requests downshift to local or are denied", () => {
    const s = settings({ monthlyLimit: 0 });
    const r = checkPreCall(s, counters(s), req, { now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.downgradedToModel).toBe("qwen2.5:3b");
    expect(deriveState(s, counters(s))).toBe("local");
    const bare = settings({ monthlyLimit: 0, installedLocal: [] });
    expect(checkPreCall(bare, counters(bare), req, { now: NOW }).code).toBe(
      "local-only",
    );
  });

  test("spike breaker: > $0.50 in 5 minutes trips, and the next call is denied", () => {
    const s = settings();
    const c = counters(s);
    for (let i = 0; i < 18; i++) {
      applySpend(
        c,
        spend({ id: `s${i}`, ts: NOW - i * 10_000, costUsd: 0.03 }),
        NOW,
      );
    }
    expect(c.spentMonth).toBe(0.54);
    expect(evaluateTrip(s, c, NOW)).toBe("spike");
    const r = checkPreCall(s, c, req, { now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("spike");
    expect(r.reason).toBe(
      "Unusual spending spike — $0.54 in the last 5 minutes. Spending is paused until you resume it under Budget.",
    );
    // Old spend falls out of the window.
    expect(evaluateTrip(s, c, NOW + 6 * 60_000)).toBeNull();
  });

  test("threshold breaker trips at 95 % with the hard cap on", () => {
    const s = settings();
    expect(evaluateTrip(s, counters(s, 4.74), NOW)).toBeNull();
    expect(evaluateTrip(s, counters(s, 4.75), NOW)).toBe("threshold");
    expect(
      evaluateTrip(settings({ circuitBreakerPct: 1 }), counters(s, 4.9), NOW),
    ).toBeNull();
  });

  test("counters fold events; blocked / downshifted do not add cost", () => {
    const s = settings();
    const c = counters(s);
    applySpend(
      c,
      spend({
        id: "a",
        costUsd: 0.1,
        agent: "coder",
        workspace: "client-acme",
      }),
      NOW,
    );
    applySpend(c, spend({ id: "b", kind: "blocked", costUsd: 0 }), NOW);
    applySpend(c, spend({ id: "c", kind: "downshifted", costUsd: 0 }), NOW);
    applySpend(
      c,
      spend({ id: "d", ts: NOW - 40 * 86_400_000, costUsd: 9 }),
      NOW,
    ); // last month
    expect(c.spentMonth).toBe(0.1);
    expect(c.spentToday).toBe(0.1);
    expect(c.agentMonth.coder).toBe(0.1);
    expect(c.workspaceMonth["client-acme"]).toBe(0.1);
    expect(c.blockedMonth).toBe(1);
    expect(c.downshiftedMonth).toBe(1);
    expect(c.eventsTotal).toBe(4);
    expect(c.biggest?.costUsd).toBe(0.1);
  });
});

describe("seed", () => {
  test("mulberry32 vector", () => {
    const r = mulberry32(0x1317b0d6);
    const first = [r(), r(), r(), r()].map((x) => Math.round(x * 1e9) / 1e9);
    expect(first).toEqual([0.847121331, 0.601883391, 0.856674884, 0.055983332]);
  });

  test("deterministic, ~220 events, none today", () => {
    const a = seedEvents(NOW, TZ);
    const b = seedEvents(NOW, TZ);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(200);
    const today = localDayStart(NOW, TZ);
    expect(a.every((e) => e.ts < today)).toBe(true);
    expect(a.filter((e) => e.kind === "blocked")).toHaveLength(3);
    expect(a.filter((e) => e.kind === "downshifted")).toHaveLength(3);
    const p = period();
    const c = countersFrom(a, p, NOW, TZ);
    // Vector pinned in governor.rs tests.
    console.log(
      JSON.stringify({
        n: a.length,
        first: a[0],
        last: a[a.length - 1],
        spentMonth: c.spentMonth,
        tokensIn: c.tokensInMonth,
        tokensOut: c.tokensOutMonth,
        total: Math.round(a.reduce((t, e) => t + e.costUsd, 0) * 1e6) / 1e6,
      }),
    );
    expect(c.spentToday).toBe(0);
    expect(c.spentMonth).toBeGreaterThan(0);
    expect(c.spentMonth).toBeLessThan(1);
  });
});

describe("aggregations", () => {
  const events = seedEvents(NOW, TZ);

  test("filters narrow by range, category, model and search", () => {
    const all = filterEvents(
      events,
      { ...DEFAULT_SPEND_FILTER, range: "all" },
      NOW,
    );
    expect(all.length).toBe(events.length);
    const week = filterEvents(
      events,
      { ...DEFAULT_SPEND_FILTER, range: "7d" },
      NOW,
    );
    expect(week.length).toBeLessThan(all.length);
    const voice = filterEvents(
      events,
      { ...DEFAULT_SPEND_FILTER, range: "all", category: "voice" },
      NOW,
    );
    expect(voice.every((e) => e.category === "voice")).toBe(true);
    const q = filterEvents(
      events,
      { ...DEFAULT_SPEND_FILTER, range: "all", search: "coder" },
      NOW,
    );
    expect(
      q.every(
        (e) => e.agent === "coder" || JSON.stringify(e).includes("coder"),
      ),
    ).toBe(true);
    const blocked = filterEvents(
      events,
      { ...DEFAULT_SPEND_FILTER, range: "all", kind: "blocked" },
      NOW,
    );
    expect(blocked).toHaveLength(3);
  });

  test("series buckets are local-aligned and sum to the range total", () => {
    const s30 = seriesFor(events, "30d", NOW, TZ);
    expect(s30).toHaveLength(30);
    expect(s30[s30.length - 1].label).toBe("Oct 5");
    expect(s30[s30.length - 1].total).toBe(0);
    const sum = Math.round(s30.reduce((t, b) => t + b.total, 0) * 1e6) / 1e6;
    const inRange = events.filter((e) => e.ts >= s30[0].at && e.costUsd > 0);
    const expected =
      Math.round(inRange.reduce((t, e) => t + e.costUsd, 0) * 1e6) / 1e6;
    expect(Math.abs(sum - expected)).toBeLessThan(0.0001);
    const h = seriesFor(events, "24h", NOW, TZ);
    expect(h).toHaveLength(24);
    expect(h[h.length - 1].label).toBe("14:00");
  });

  test("breakdown by model is sorted by cost", () => {
    const rows = breakdown(events, "model", "all", NOW);
    expect(rows.length).toBeGreaterThan(3);
    for (let i = 1; i < rows.length; i++)
      expect(rows[i - 1].cost >= rows[i].cost).toBe(true);
    const cats = breakdown(events, "category", "all", NOW);
    expect(cats.map((r) => r.key)).toContain("llm");
  });

  test("overview math", () => {
    const s = settings();
    const p = period(s);
    const c = countersFrom(events, p, NOW, TZ);
    const o = overviewFrom(s, c, p, NOW);
    expect(o.resetDate).toBe("2026-10-31");
    expect(o.daysUntilReset).toBe(27);
    expect(o.avgPerDay).toBe(Math.round((c.spentMonth / 5) * 1e6) / 1e6);
    expect(o.projectedMonthEnd).toBeGreaterThan(o.spentMonth);
    expect(o.remaining).toBe(Math.round((4.5 - c.spentMonth) * 1e6) / 1e6);
    expect(o.state).toBe("ok");
  });

  test("csv escapes and neutralises formulas", () => {
    const csv = eventsCsv([
      spend({ id: "x", ts: NOW, agent: "=cmd()", detail: { note: 'a,b "q"' } }),
    ]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "time,kind,category,agent,workspace,session,model,tokens_in,tokens_out,cost_usd,detail",
    );
    expect(lines[1]).toContain("'=cmd()");
    expect(lines[1]).toContain('"{""note"":""a,b \\""q\\""""}"');
  });
});
