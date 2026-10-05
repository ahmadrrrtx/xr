/**
 * Phase 11 · Control Room pure logic (desktop/src/runs/core.ts + seed.ts).
 *
 * Filters, sort, aggregates, formatting, CSV/JSON export and the chart
 * reducers are pure functions over `RunSummary[]`; the store, the
 * virtualized table and the Tauri bridge are covered by the Playwright
 * pass. Negative branches included per house rule.
 */
import { describe, expect, test } from "bun:test";

// Relative import — same convention as the other desktop tests (no path alias).
import * as core from "../../desktop/src/runs/core.ts";
import { seedMockHistory, seedStress } from "../../desktop/src/runs/seed.ts";
import type { RunSummary } from "../../desktop/src/brain/types.ts";

const NOW = new Date(2026, 9, 5, 12, 0, 0).getTime(); // local noon, Oct 5 2026
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run-0001-medium",
    shortId: "#1",
    title: "Summarize Q3 reports",
    agent: "Main",
    agentKind: "chat",
    workspace: "acme",
    model: "gpt-4o",
    status: "completed",
    startedAt: NOW - 10 * MIN,
    endedAt: NOW - 9 * MIN,
    durationMs: MIN,
    tokensIn: 1200,
    tokensOut: 300,
    costUsd: 0.012,
    surface: "chat",
    ...over,
  };
}

const RUNS: RunSummary[] = [
  run(),
  run({ id: "r2", shortId: "#2", status: "running", endedAt: null, durationMs: null, startedAt: NOW - 30_000, costUsd: 0, tokensIn: 0, tokensOut: 0, agent: "Coder", agentKind: "builder", surface: "builder", workspace: "xr-desktop" }),
  run({ id: "r3", shortId: "#3", status: "failed", errorSummary: "ShellError: exit 127", startedAt: NOW - 3 * HOUR, model: "claude-3.5-sonnet", agent: "Research", agentKind: "research", surface: "research", costUsd: 0.2 }),
  run({ id: "r4", shortId: "#4", status: "killed", startedAt: NOW - 2 * DAY, model: "ollama/qwen2.5:7b", costUsd: 0, workspace: undefined }),
  run({ id: "r5", shortId: "#5", status: "waiting", endedAt: null, durationMs: null, startedAt: NOW - 2 * MIN, agent: "Planner", agentKind: "background", surface: "background" }),
  run({ id: "r6", shortId: "#6", status: "completed", startedAt: NOW - 20 * DAY, model: "gemini-pro", costUsd: 0.05, archived: true }),
];

describe("status + search + range filters", () => {
  test("inProgress covers running and waiting only", () => {
    expect(core.inProgress("running")).toBe(true);
    expect(core.inProgress("waiting")).toBe(true);
    expect(core.inProgress("completed")).toBe(false);
    expect(core.inProgress("killed")).toBe(false);
  });

  test("'running' tab includes waiting runs; 'all' includes everything", () => {
    const running = RUNS.filter((r) => core.matchesStatus(r, "running")).map((r) => r.id);
    expect(running).toEqual(["r2", "r5"]);
    expect(RUNS.filter((r) => core.matchesStatus(r, "all"))).toHaveLength(RUNS.length);
    expect(RUNS.filter((r) => core.matchesStatus(r, "killed")).map((r) => r.id)).toEqual(["r4"]);
  });

  test("search is case-insensitive, multi-term AND, matches id/shortId/title/agent/workspace/model", () => {
    expect(core.matchesSearch(RUNS[0], "ACME")).toBe(true);
    expect(core.matchesSearch(RUNS[0], "#1")).toBe(true);
    expect(core.matchesSearch(RUNS[0], "run-0001")).toBe(true);
    expect(core.matchesSearch(RUNS[0], "q3 main")).toBe(true); // both terms hit
    expect(core.matchesSearch(RUNS[0], "q3 coder")).toBe(false); // one term misses
    expect(core.matchesSearch(RUNS[2], "claude")).toBe(true);
    expect(core.matchesSearch(RUNS[0], "")).toBe(true);
    expect(core.matchesSearch(RUNS[0], "   ")).toBe(true);
  });

  test("date ranges are inclusive windows ending now; 'all' never excludes", () => {
    expect(core.inRange(RUNS[0], "1h", NOW)).toBe(true);
    expect(core.inRange(RUNS[2], "1h", NOW)).toBe(false);
    expect(core.inRange(RUNS[2], "24h", NOW)).toBe(true);
    expect(core.inRange(RUNS[3], "24h", NOW)).toBe(false);
    expect(core.inRange(RUNS[3], "7d", NOW)).toBe(true);
    expect(core.inRange(RUNS[5], "7d", NOW)).toBe(false);
    expect(core.inRange(RUNS[5], "30d", NOW)).toBe(true);
    expect(core.inRange(run({ startedAt: NOW - 400 * DAY }), "all", NOW)).toBe(true);
  });

  test("filterBase drops archived rows and applies search+range; filterRuns adds status", () => {
    const base = core.filterBase(RUNS, { search: "", range: "all", now: NOW });
    expect(base.map((r) => r.id)).not.toContain("r6");
    const failed = core.filterRuns(RUNS, { status: "failed", search: "", range: "all", now: NOW });
    expect(failed.map((r) => r.id)).toEqual(["r3"]);
    const none = core.filterRuns(RUNS, { status: "failed", search: "zzz", range: "all", now: NOW });
    expect(none).toEqual([]);
  });

  test("statusCounts sums per tab over the given rows", () => {
    const counts = core.statusCounts(core.filterBase(RUNS, { search: "", range: "all", now: NOW }));
    expect(counts).toEqual({ all: 5, running: 2, completed: 1, failed: 1, killed: 1 });
  });
});

describe("sorting", () => {
  test("default sort is Started desc and nextSort toggles / switches columns", () => {
    expect(core.DEFAULT_SORT).toEqual({ col: "startedAt", dir: "desc" });
    expect(core.nextSort(core.DEFAULT_SORT, "startedAt")).toEqual({ col: "startedAt", dir: "asc" });
    const cost = core.nextSort(core.DEFAULT_SORT, "cost");
    expect(cost.col).toBe("cost");
    expect(cost.dir).toBe("desc"); // numeric columns start descending
    const title = core.nextSort(core.DEFAULT_SORT, "title");
    expect(title.dir).toBe("asc"); // textual columns start ascending
  });

  test("sortRuns is stable, uses live duration for in-flight rows, and never mutates", () => {
    const input = [...RUNS];
    const byStart = core.sortRuns(input, { col: "startedAt", dir: "desc" }, NOW);
    expect(byStart[0].id).toBe("r2");
    expect(byStart.at(-1)?.id).toBe("r6");
    expect(input.map((r) => r.id)).toEqual(RUNS.map((r) => r.id));

    const byDuration = core.sortRuns(RUNS, { col: "duration", dir: "desc" }, NOW);
    // r5 has been "running" for 2 minutes — longer than the finished 1-minute rows.
    expect(byDuration[0].id).toBe("r5");
    expect(core.runDuration(RUNS[1], NOW)).toBe(30_000);
    expect(core.runDuration(RUNS[0], NOW)).toBe(MIN);

    const byCost = core.sortRuns(RUNS, { col: "cost", dir: "asc" }, NOW);
    expect(byCost[0].costUsd).toBe(0);
    expect(byCost.at(-1)?.id).toBe("r3");

    const byWorkspace = core.sortRuns(RUNS, { col: "workspace", dir: "asc" }, NOW);
    expect(byWorkspace.at(-1)?.id).toBe("r4"); // missing workspace sorts last
  });

  test("LIVE_SORT_COLUMNS are exactly the columns that move while running", () => {
    expect([...core.LIVE_SORT_COLUMNS].sort()).toEqual(["cost", "duration", "tokens"]);
  });
});

describe("aggregates", () => {
  test("aggregate counts today's runs/tokens/cost, in-progress and failures in 24h", () => {
    const s = core.aggregate(RUNS, NOW);
    expect(s.runsToday).toBe(4); // r1, r2, r3, r5 (r4 two days ago, r6 20 days ago)
    expect(s.tokensToday).toBe(1500 * 3); // r1, r3, r5 (r2 has none yet)
    expect(s.costToday).toBeCloseTo(0.012 + 0.2 + 0.012, 6);
    expect(s.runningCount).toBe(2);
    expect(s.failed24h).toBe(1);
  });

  test("surfaceCounts tallies every surface with zeros", () => {
    const c = core.surfaceCounts(RUNS.filter((r) => core.inProgress(r.status)));
    expect(c).toEqual({ chat: 0, builder: 1, research: 0, voice: 0, background: 1, cli: 0 });
  });

  test("totals rounds the success rate and only counts finished runs", () => {
    const t = core.totals(RUNS);
    expect(t.runs).toBe(6);
    expect(t.failed).toBe(1);
    // completed r1, r6 + failed r3 → 2/3 → 67%
    expect(t.successRate).toBe(67);
    expect(Number.isInteger(t.successRate)).toBe(true);
    expect(core.totals([]).successRate).toBe(100);
  });
});

describe("model + agent classification", () => {
  test("modelFamily routes vendors and local runtimes", () => {
    expect(core.modelFamily("gpt-4o-mini")).toBe("openai");
    expect(core.modelFamily("claude-3.5-sonnet")).toBe("anthropic");
    expect(core.modelFamily("gemini-pro")).toBe("google");
    expect(core.modelFamily("ollama/qwen2.5:7b")).toBe("local");
    expect(core.modelFamily("llama3.1:8b")).toBe("local");
    expect(core.modelFamily("mystery-9000")).toBe("other");
    expect(core.isLocalModel("ollama/llama3.1:8b")).toBe(true);
    expect(core.modelColorVar("gemini-pro")).toBe("var(--chart-google)");
    expect(core.modelColorVar("mystery")).toBe("var(--chart-other)");
  });

  test("agentKindFor + agentColorVar map names to themed tokens", () => {
    expect(core.agentKindFor("Coder")).toBe("builder");
    expect(core.agentKindFor("Research")).toBe("research");
    expect(core.agentKindFor("Main")).toBe("chat");
    expect(core.agentColorVar("Coder", "builder")).toBe("var(--agent-coder)");
    expect(core.agentColorVar("Main", "chat")).toBe("var(--agent-main)");
    expect(core.agentColorVar("Research", "research")).toBe("var(--agent-research)");
  });
});

describe("formatting", () => {
  test("fmtStarted is relative within the hour, clock today, date before", () => {
    expect(core.fmtStarted(NOW - 5_000, NOW)).toBe("just now");
    expect(core.fmtStarted(NOW - 45_000, NOW)).toBe("45s ago");
    expect(core.fmtStarted(NOW - 14 * MIN, NOW)).toBe("14m ago");
    expect(core.fmtStarted(NOW - 3 * HOUR, NOW)).toMatch(/^\d{2}:\d{2}$/);
    expect(core.fmtStarted(NOW - 26 * HOUR, NOW)).toMatch(/^Yesterday \d{2}:\d{2}$/);
    expect(core.fmtStarted(NOW - 10 * DAY, NOW)).toBe("Sep 25");
    expect(core.fmtStartedFull(NOW)).toMatch(/^Oct 5, 2026 12:00:00$/);
  });

  test("duration / tokens / cost cells", () => {
    expect(core.fmtLiveDuration(450)).toBe("450ms");
    expect(core.fmtLiveDuration(12_400)).toBe("12.4s");
    expect(core.fmtLiveDuration(134_000)).toBe("2:14");
    expect(core.fmtLiveDuration(3_725_000)).toBe("1:02:05");
    expect(core.fmtTokenPair(120, 1234)).toBe("120 / 1.2k");
    expect(core.fmtCostCell(0)).toBe("$0");
    expect(core.fmtCostCell(0.0423)).toBe("$0.042");
  });

  test("niceMax snaps up to 1/2/5 × 10^n and never truncates", () => {
    expect(core.niceMax(0)).toBeGreaterThan(0);
    expect(core.niceMax(3)).toBe(5);
    expect(core.niceMax(5)).toBe(5);
    expect(core.niceMax(7)).toBe(10);
    expect(core.niceMax(0.013)).toBeCloseTo(0.02, 9);
    expect(core.niceMax(1234)).toBe(2000);
  });
});

describe("export", () => {
  test("CSV has the fixed header, RFC-4180 quoting, CRLF, and one row per run in order", () => {
    const rows = [run({ title: 'Deploy "staging", please' }), RUNS[1]];
    const csv = core.toCsv(rows, NOW);
    expect(csv.endsWith("\r\n")).toBe(true); // every record terminated, incl. the last
    const lines = csv.slice(0, -2).split("\r\n");
    expect(lines[0]).toBe(core.CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(csv).not.toContain("\n\n");
    expect(lines[1]).toContain('"Deploy ""staging"", please"');
    // machine-readable numbers, not locale strings
    expect(lines[1]).toContain(",1200,300,");
    expect(lines[1]).not.toContain("1.2k");
    // in-flight row: empty ended/duration cells, cost 0
    expect(lines[2]).toContain("running");
  });

  test("CSV of nothing is just the header record", () => {
    expect(core.toCsv([], NOW)).toBe(core.CSV_COLUMNS.join(",") + "\r\n");
  });

  test("JSON export carries schema, exportedAt and the rows verbatim", () => {
    const parsed = JSON.parse(core.toJson(RUNS.slice(0, 2), NOW));
    expect(parsed.schema).toBe("xr.runs.v1");
    expect(parsed.exportedAt).toBe(new Date(NOW).toISOString());
    expect(parsed.count).toBe(2);
    expect(parsed.runs[1].id).toBe("r2");
  });

  test("exportFilename is xr-runs-YYYY-MM-DD-HHmm.ext", () => {
    expect(core.exportFilename("csv", NOW)).toBe("xr-runs-2026-10-05-1200.csv");
    expect(core.exportFilename("json", new Date(2026, 0, 9, 7, 5).getTime())).toBe(
      "xr-runs-2026-01-09-0705.json"
    );
  });
});

describe("chart reducers", () => {
  test("runsPerHour yields 24 buckets ending with the current hour", () => {
    const b = core.runsPerHour(RUNS, NOW);
    expect(b).toHaveLength(24);
    expect(b.at(-1)?.isCurrent).toBe(true);
    expect(b.filter((x) => x.isCurrent)).toHaveLength(1);
    const total = b.reduce((a, x) => a + x.count, 0);
    expect(total).toBe(4); // r1, r2, r3, r5 within 24 h
    expect(core.hourLabel(0)).toBe("12a");
    expect(core.hourLabel(13)).toBe("1p");
  });

  test("costPerDay stacks by family, 30 buckets oldest→newest, local stays $0", () => {
    const d = core.costPerDay(RUNS, NOW);
    expect(d).toHaveLength(30);
    expect(d[0].at).toBeLessThan(d[29].at);
    const today = d[29];
    expect(today.total).toBeCloseTo(0.012 + 0.2 + 0.012, 6);
    expect(today.byFamily.openai).toBeCloseTo(0.024, 6);
    expect(today.byFamily.anthropic).toBeCloseTo(0.2, 6);
    expect(today.byFamily.local).toBe(0);
    expect(d.reduce((a, x) => a + x.local, 0)).toBe(0);
    expect(core.COST_STACK).toContain("local");
  });

  test("tokensByModel keeps the top 5, folds the rest into Other, shares sum to 1", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      run({ id: `m${i}`, model: `model-${i}`, tokensIn: 1000 * (8 - i), tokensOut: 0 })
    );
    const slices = core.tokensByModel(many);
    expect(slices).toHaveLength(6);
    expect(slices[0].model).toBe("model-0");
    expect(slices.at(-1)?.model).toBe("Other");
    expect(slices.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9);
    expect(core.tokensByModel([])).toEqual([]);
    // same-family models get distinct colours
    const dup = core.tokensByModel([
      run({ id: "a", model: "gpt-4o" }),
      run({ id: "b", model: "gpt-4o-mini", tokensIn: 10 }),
    ]);
    expect(dup[0].color).not.toBe(dup[1].color);
  });
});

describe("seed", () => {
  test("seedMockHistory is deterministic, ~60 runs, finished only, inside 30 days", () => {
    const a = seedMockHistory(NOW);
    const b = seedMockHistory(NOW);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(55);
    expect(a.length).toBeLessThanOrEqual(70);
    for (const r of a) {
      expect(core.inProgress(r.status)).toBe(false);
      expect(r.startedAt).toBeLessThanOrEqual(NOW);
      expect(NOW - r.startedAt).toBeLessThan(30 * DAY);
      expect(r.durationMs).toBeGreaterThanOrEqual(500);
      expect(r.durationMs).toBeLessThanOrEqual(120_000);
      expect(r.tokensIn + r.tokensOut).toBeGreaterThan(0);
      if (core.isLocalModel(r.model)) expect(r.costUsd).toBe(0);
      else expect(r.costUsd).toBeGreaterThan(0);
      if (r.status === "failed") expect(r.errorSummary).toBeTruthy();
    }
    const ids = new Set(a.map((r) => r.id));
    expect(ids.size).toBe(a.length);
    // canned Phase 9 runs keep their placeholder short ids
    expect(a.find((r) => r.id === "mock-medium")?.shortId).toBe("#847");
    expect(a.find((r) => r.id === "mock-error")?.status).toBe("failed");
    const models = new Set(a.map((r) => r.model));
    expect(models.has("gpt-4o")).toBe(true);
    expect(models.has("claude-3.5-sonnet")).toBe(true);
    expect(models.has("gemini-pro")).toBe(true);
    expect([...models].some((m) => m.startsWith("ollama/"))).toBe(true);
  });

  test("seedStress produces the requested count inside the default window", () => {
    const s = seedStress(NOW, 500);
    expect(s).toHaveLength(500);
    expect(new Set(s.map((r) => r.id)).size).toBe(500);
    expect(s.every((r) => NOW - r.startedAt < 30 * DAY)).toBe(true);
  });
});
