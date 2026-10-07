/**
 * Phase 18 — the structured events `runResearch()` emits beside its `say()`
 * lines are what the desktop Research screen renders. This pins the sequence,
 * the LiteSource/RunResult shaping, local documents as `local` sources, and
 * cooperative cancellation through the AbortSignal — all offline (fake model,
 * fake search; nothing touches the network).
 */
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { runResearch, newSessionId, type ResearchEngineDeps } from "../../src/research/engine.ts";
import { liteSource, runResult, type EngineRunEvent } from "../../src/research/run-events.ts";
import type { ChatOptions, Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";
import type { SearchCapability } from "../../src/research/search.ts";

const PAGE = "Tokio uses a work-stealing scheduler by default. Independent benchmarks show throughput within four percent across runtimes. Ecosystem compatibility decides most migrations.";

function fakeProvider(opts: { delayMs?: number } = {}): Provider {
  return {
    id: "fake",
    label: "fake",
    modelId: "fake-1",
    async health() {
      return { ok: true };
    },
    async chat(messages: Message[], _tools: Tool[], options?: ChatOptions): Promise<ModelTurn> {
      if (opts.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs);
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
      }
      const prompt = messages[messages.length - 1]?.content ?? "";
      let payload: unknown;
      if (prompt.includes("Design the research plan now.")) {
        payload = { objective: "Compare runtimes", strategy: "docs first", sourceRequirements: ["docs"], questions: [{ text: "Which scheduler?", queries: ["tokio scheduler"] }] };
      } else if (prompt.includes("Source text:")) {
        payload = { evidence: [{ text: "Tokio uses a work-stealing scheduler by default.", quote: "work-stealing scheduler by default", kind: "fact", confidence: "high", relevance: 0.9 }] };
      } else {
        const ids = [...prompt.matchAll(/^\[(s\d+)\]/gm)].map((m) => m[1]);
        const c = (i: number) => `[${ids[i % ids.length] ?? "s1"}]`;
        payload = {
          shortAnswer: `Work-stealing is the default ${c(0)}.`,
          executiveSummary: [`Default scheduler ${c(0)}.`],
          report: `# Runtimes\n\nWork-stealing is the default ${c(0)}. Throughput is close ${c(1)}.`,
          openQuestions: ["Memory at 100k connections?"],
          overallConfidence: "medium",
          contradictions: ids.length >= 2 ? [{ topic: "latency", sourceIds: [ids[0], ids[1]], evidenceIds: [], description: "disagree on p99", severity: "medium" }] : [],
          claims: [],
        };
      }
      return { message: JSON.stringify(payload), toolCalls: [], done: true, usage: { inTokens: 100, outTokens: 50 } };
    },
  } as unknown as Provider;
}

function fakeSearch(): SearchCapability {
  return {
    available: () => true,
    async search(query) {
      return {
        hits: [
          { title: "Tokio docs", url: "https://tokio.example/docs", snippet: `about ${query}` },
          { title: "Benchmarks", url: "https://bench.example/2026", snippet: "numbers" },
          { title: "Broken page", url: "https://down.example/x", snippet: "503" },
        ],
      };
    },
    async fetch(url) {
      if (url.includes("down.example")) return { ok: false, status: 503, reason: "fetch failed (status 503)" };
      return { ok: true, text: PAGE, status: 200, contentType: "text/html", lastModified: "Mon, 02 Mar 2026 10:00:00 GMT", bytes: PAGE.length };
    },
  };
}

function deps(over: Partial<ResearchEngineDeps> = {}): { deps: ResearchEngineDeps; events: EngineRunEvent[]; lines: string[]; store: Store } {
  const tmp = mkdtempSync(join(tmpdir(), "xr-research-run-events-"));
  const store = new Store(join(tmp, "d.db"));
  const events: EngineRunEvent[] = [];
  const lines: string[] = [];
  const d: ResearchEngineDeps = {
    provider: fakeProvider(),
    store,
    search: fakeSearch(),
    budget: { allow: () => true, record: () => {}, meter: () => "local", reason: () => "" },
    say: (l) => lines.push(l),
    onEvent: (e) => events.push(e),
    ...over,
  };
  return { deps: d, events, lines, store };
}

test("a quick run emits status → plan → search → sources → fetch → extract → contradictions in order, with truthful counts", async () => {
  const { deps: d, events, lines, store } = deps();
  const sessionId = newSessionId();
  expect(sessionId).toMatch(/^r_[a-z0-9]{8}$/);
  const session = await runResearch(d, { topic: "tokio vs smol", depth: "quick", mode: "quick", sessionId });
  expect(session.id).toBe(sessionId);
  expect(session.status).toBe("done");

  const types: string[] = events.map((e) => e.type);
  const first = (t: string) => types.indexOf(t);
  expect(first("status")).toBe(0);
  expect(first("plan")).toBeGreaterThan(-1);
  expect(first("plan")).toBeLessThan(first("search"));
  expect(first("search")).toBeLessThan(first("sources"));
  expect(first("sources")).toBeLessThan(first("fetch"));
  expect(first("fetch")).toBeLessThan(first("extract"));
  expect(first("extract")).toBeLessThan(first("contradictions"));
  const statuses = events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status);
  expect(statuses[0]).toBe("planning");
  expect(statuses.at(-1)).toBe("done");
  expect(statuses).toContain("synthesizing");

  const sources = events.find((e) => e.type === "sources") as { sources: { id: string; domain: string }[] };
  expect(sources.sources.map((s) => s.domain).sort()).toEqual(["bench.example", "down.example", "tokio.example"]);
  const fetches = events.filter((e) => e.type === "fetch") as { sourceId: string; phase: string; error?: string }[];
  expect(fetches.filter((f) => f.phase === "ok").length).toBe(2);
  const failed = fetches.find((f) => f.phase === "fail");
  expect(failed?.error).toContain("503");
  const contradictions = events.find((e) => e.type === "contradictions") as { count: number };
  expect(contradictions.count).toBe(session.contradictions.length);
  expect(session.contradictions.length).toBeGreaterThan(0);
  expect(lines.some((l) => l.startsWith("▸ searching"))).toBe(true);

  const result = runResult(session, { usage: { inTokens: 1, outTokens: 2, usd: 0, local: true }, provider: "fake", model: "fake-1", startedAt: 1 });
  expect(result.sources.map((s) => s.id)).toEqual(session.sources.map((s) => s.id));
  expect(result.report).toContain("[s");
  expect(Object.keys(result.evidence).length).toBeGreaterThan(0);
  expect(result.openQuestions).toEqual(["Memory at 100k connections?"]);
  expect(result.usage.local).toBe(true);
  expect(JSON.parse(store.getResearch(session.id)?.data ?? "{}").status).toBe("done");
  store.close();
});

test("user documents join the run as `local` sources (s1…) and are never fetched over the network", async () => {
  const { deps: d, events, lines, store } = deps({ search: { available: () => false, search: async () => ({ hits: [], unavailableReason: "off" }), fetch: async () => ({ ok: false, reason: "no network in this test" }) } });
  const session = await runResearch(d, {
    topic: "team notes",
    depth: "quick",
    mode: "quick",
    documents: [
      { name: "notes.md", text: "Our storage service saw p99 regressions after moving to work-stealing. Pinning worker threads per core fixed it.", kind: "local" },
      { name: "paper.pdf", text: "The paper measures a 30 percent p99 latency advantage for thread-per-core designs under contention.", kind: "pdf" },
    ],
  });
  expect(session.status).toBe("done");
  const local = session.sources.filter((s) => s.type === "local");
  expect(local.map((s) => s.id)).toEqual(["s1", "s2"]);
  expect(local.map((s) => s.domain)).toEqual(["local-file", "local-pdf"]);
  expect(local.every((s) => s.fetched)).toBe(true);
  expect(local.every((s) => s.url.startsWith("local://"))).toBe(true);
  // With search unavailable the engine skips discovery entirely (the `say()` line is the only trace)…
  expect(events.some((e) => e.type === "search")).toBe(false);
  expect(lines.some((l) => l.includes("Web search is unavailable"))).toBe(true);
  // …and the local sources still carry the run to a cited report.
  expect(session.finalReport ?? session.synthesis?.report ?? "").toContain("[s1]");
  const lite = liteSource(local[0]);
  expect(lite.contentChars).toBeGreaterThan(0);
  expect(lite.freshness).toBeTruthy();
  store.close();
});

test("cancel through the AbortSignal stops at the next checkpoint and persists a stopped/cancelled session", async () => {
  const controller = new AbortController();
  const { deps: d, events, lines, store } = deps({ provider: fakeProvider({ delayMs: 150 }), signal: controller.signal });
  const run = runResearch(d, { topic: "cancel me", depth: "deep", mode: "deep" });
  setTimeout(() => controller.abort(), 60);
  const session = await run;
  expect(session.status).toBe("stopped");
  expect(session.stopReason).toBe("cancelled");
  expect(lines.some((l) => l.includes("cancelled"))).toBe(true);
  expect(events.some((e) => e.type === "fetch")).toBe(false);
  expect(JSON.parse(store.getResearch(session.id)?.data ?? "{}").status).toBe("stopped");
  store.close();
});
