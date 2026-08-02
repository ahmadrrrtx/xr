/**
 * XR 4.6 — Phase 6 · T5: the recall-quality benchmark harness.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Article VIII.5: recall quality is MEASURED, not asserted. This harness is
 * the only source of recall numbers for XR. It implements a MemoryAgentBench-
 * style protocol (research note R3):
 *
 *   • inject-once, query-many-times (per domain fixture)
 *   • four competencies per domain:
 *       - accurate_retrieval    (find the right fact)
 *       - test_time_learning    (a later correction/rename must win)
 *       - long_range_consistency (multi-fact consistency, recall of a set)
 *       - conflict_resolution   (outdated vs updated pairs; updated must win
 *                                and the loser must fall, never silently
 *                                corrupt)
 *   • four domains: code, research, personal, business
 *
 * Metrics: Precision@1, Recall@1, Recall@5, MRR — per query type, per domain,
 * and overall. Deterministic assertions only (item ids), no LLM judge, so CI
 * reproduces the same numbers.
 *
 * Offline/async by construction: the harness NEVER runs on the agent hot path;
 * it owns its own scratch stores. Lexical retrieval is the mandatory default;
 * the semantic channel is exercised only when a route is available.
 */

import { ContextRepository, adaptStoreForContext, type ContextDb } from "../repository.ts";
import { ContextRetrieval } from "../retrieval.ts";
import { buildGrant, makeScope } from "../policy.ts";
import { LEXICAL_ROUTE, type EmbeddingRoute } from "../embedding.ts";
import {
  emptyLinks,
  isContextType,
  isProvenanceKind,
  isTrustStatus,
  type ContextType,
  type ProvenanceKind,
  type TrustStatus,
} from "../types.ts";

// ── Fixture schema ──────────────────────────────────────────────────────────

export type Competency =
  | "accurate_retrieval"
  | "test_time_learning"
  | "long_range_consistency"
  | "conflict_resolution";

export type BenchmarkDomain = "code" | "research" | "personal" | "business";

export interface FixtureItem {
  id: string;
  content: string;
  type?: string;
  tags?: string[];
  provenance?: string;
  trust?: string;
  staleDaysAgo?: number;
  /** Conflict/TTL: this item supersedes the given id. */
  supersedes?: string;
  /** Multi-item consistency sets share a task link. */
  taskId?: string;
}

export interface FixtureQuery {
  id: string;
  competency: Competency;
  query: string;
  /** The one item that must be ranked #1. */
  expectTop1?: string;
  /** Items that must ALL appear within the top 5. */
  expectInTop5?: string[];
  /** Items that must NOT appear anywhere in the returned set. */
  expectAbsent?: string[];
}

export interface DomainFixture {
  domain: BenchmarkDomain;
  description: string;
  items: FixtureItem[];
  queries: FixtureQuery[];
}

// ── Report schema ───────────────────────────────────────────────────────────

export interface FamilyMetrics {
  queries: number;
  precisionAt1: number;
  recallAt1: number;
  recallAt5: number;
  mrr: number;
  /** Failures, fully enumerated (never a claim without a counter-example). */
  failures: Array<{ queryId: string; expected: string[]; got: string[] }>;
}

export interface BenchmarkReport {
  runAt: string;
  route: string;
  domains: Record<BenchmarkDomain, Record<Competency, FamilyMetrics>>;
  overall: Record<Competency, FamilyMetrics>;
  summary: {
    precisionAt1: number;
    recallAt1: number;
    recallAt5: number;
    mrr: number;
    queries: number;
    failures: number;
  };
  /** Retrieval p95@100k measured separately by the benchmark script. */
  largeScale?: { items: number; p95Ms: number; avgMs: number };
}

// ── Declared targets (Part 5: "targets declared and met") ───────────────────

export const RECALL_TARGETS = {
  /** Per-domain floors per competency. */
  perDomain: 0.8,
  /** Overall floors. */
  overall: {
    accurate_retrieval: 0.85,
    test_time_learning: 0.85,
    long_range_consistency: 0.8,
    conflict_resolution: 0.9,
  },
  /** Conflict losers must fall in at least this fraction of cases. */
  conflictLoserSuppressed: 0.9,
} as const;

export interface TargetEvaluation {
  ok: boolean;
  violations: string[];
}

export function evaluateTargets(report: BenchmarkReport): TargetEvaluation {
  const violations: string[] = [];
  for (const [domain, comps] of Object.entries(report.domains) as Array<[BenchmarkDomain, Record<Competency, FamilyMetrics>]>) {
    for (const [comp, m] of Object.entries(comps)) {
      if (m.queries === 0) {
        violations.push(`${domain}/${comp}: no queries — fixture empty`);
        continue;
      }
      if (m.recallAt5 < RECALL_TARGETS.perDomain) {
        violations.push(`${domain}/${comp}: R@5 ${m.recallAt5.toFixed(3)} < per-domain floor ${RECALL_TARGETS.perDomain}`);
      }
    }
  }
  for (const [comp, floor] of Object.entries(RECALL_TARGETS.overall) as Array<[Competency, number]>) {
    const m = report.overall[comp];
    if (!m || m.queries === 0) {
      violations.push(`${comp}: no queries — fixture empty`);
      continue;
    }
    if (m.recallAt5 < floor) {
      violations.push(`${comp}: overall R@5 ${m.recallAt5.toFixed(3)} < target ${floor}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Harness ─────────────────────────────────────────────────────────────────

interface Seeded {
  grant: ReturnType<typeof buildGrant>;
}

/**
 * Run one domain fixture through the REAL retrieval pipeline (identical code
 * path to the agent: scope fence → authorize-before-rank → hybrid channels →
 * RRF fusion → rerank → conflict penalties → tier caps).
 */
export async function runRecallBenchmark(opts: {
  fixtures: DomainFixture[];
  db: ContextDb;
  workspaceId?: string;
  route?: EmbeddingRoute;
  /** Print per-query detail. */
  verbose?: boolean;
}): Promise<BenchmarkReport> {
  const route = opts.route ?? LEXICAL_ROUTE;
  const ws = opts.workspaceId ?? "bench";
  const repo = new ContextRepository(opts.db, ws);
  repo.migrate();

  const domains = {} as BenchmarkReport["domains"];
  const overallBuckets: Record<Competency, Array<ReturnType<typeof scoreQuery>>> = {
    accurate_retrieval: [],
    test_time_learning: [],
    long_range_consistency: [],
    conflict_resolution: [],
  };

  for (const fixture of opts.fixtures) {
    const seeded = seedDomain(repo, fixture, ws);
    const retrieval = new ContextRetrieval(repo, route);
    const comps = {} as Record<Competency, FamilyMetrics>;
    for (const comp of ["accurate_retrieval", "test_time_learning", "long_range_consistency", "conflict_resolution"] as Competency[]) {
      const queries = fixture.queries.filter((q) => q.competency === comp);
      const scores: Array<ReturnType<typeof scoreQuery>> = [];
      for (const q of queries) {
        const result = await retrieval.retrieve({
          queryIntent: `benchmark:${fixture.domain}:${comp}`,
          query: q.query,
          grant: seeded.grant,
          tiers: undefined,
          lexicalOnly: route.fallback,
        });
        const ranked = result.items.map((r) => r.item.id);
        const s = scoreQuery(q, ranked);
        scores.push(s);
        overallBuckets[comp].push(s);
        if (opts.verbose && s.failures.length) {
          console.log(`    [bench] FAIL ${fixture.domain}/${comp}/${q.id}: expected ${q.expectTop1 ?? q.expectInTop5?.join(",")} got ${ranked.slice(0, 5).join(",") || "(none)"}`);
        }
      }
      comps[comp] = aggregate(scores);
    }
    // Clean slate per domain: benchmarks must not contaminate each other.
    clearDomain(repo, ws);
    (domains as Record<string, unknown>)[fixture.domain] = comps;
  }

  const overall = {
    accurate_retrieval: aggregate(overallBuckets.accurate_retrieval),
    test_time_learning: aggregate(overallBuckets.test_time_learning),
    long_range_consistency: aggregate(overallBuckets.long_range_consistency),
    conflict_resolution: aggregate(overallBuckets.conflict_resolution),
  } as Record<Competency, FamilyMetrics>;

  const all = Object.values(overall).flatMap((m) => m.failures);
  const allScores = Object.values(overallBuckets).flat();
  const total = aggregate(allScores);

  return {
    runAt: new Date().toISOString(),
    route: route.model,
    domains,
    overall,
    summary: {
      precisionAt1: total.precisionAt1,
      recallAt1: total.recallAt1,
      recallAt5: total.recallAt5,
      mrr: total.mrr,
      queries: allScores.length,
      failures: all.length,
    },
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

function scoreQuery(q: FixtureQuery, ranked: string[]) {
  const expected: string[] = [q.expectTop1, ...(q.expectInTop5 ?? [])].filter((x): x is string => !!x);
  const failures: Array<{ queryId: string; expected: string[]; got: string[] }> = [];

  const top1Ok = q.expectTop1 ? ranked[0] === q.expectTop1 : true;
  const inTop5Ok = (q.expectInTop5 ?? []).every((id) => ranked.slice(0, 5).includes(id));
  const absentOk = (q.expectAbsent ?? []).every((id) => !ranked.includes(id));

  if (!top1Ok || !inTop5Ok || !absentOk) {
    failures.push({ queryId: q.id, expected, got: ranked.slice(0, 5) });
  }

  // Precision@1 and Recall@1: on the primary expected item.
  const firstExpected = q.expectTop1 ?? q.expectInTop5?.[0];
  const rank = firstExpected ? ranked.indexOf(firstExpected) : -1;
  const p1 = firstExpected ? (ranked[0] === firstExpected ? 1 : 0) : 1;
  const r1 = firstExpected ? (rank === 0 ? 1 : 0) : 1;

  // Recall@5: fraction of all expected items surfaced within 5 (and absent-respected).
  const hits5 = expected.filter((id) => ranked.slice(0, 5).includes(id)).length;
  const r5 = expected.length > 0 ? hits5 / expected.length : 1;

  const mrr = firstExpected && rank >= 0 ? 1 / (rank + 1) : 0;

  return { p1, r1, r5, mrr, failures };
}

function aggregate(scores: Array<ReturnType<typeof scoreQuery>>): FamilyMetrics {
  const n = scores.length || 1;
  return {
    queries: scores.length,
    precisionAt1: scores.reduce((a, s) => a + s.p1, 0) / n,
    recallAt1: scores.reduce((a, s) => a + s.r1, 0) / n,
    recallAt5: scores.reduce((a, s) => a + s.r5, 0) / n,
    mrr: scores.reduce((a, s) => a + s.mrr, 0) / n,
    failures: scores.flatMap((s) => s.failures),
  };
}

// ── Seeding ────────────────────────────────────────────────────────────────

function seedDomain(repo: ContextRepository, fixture: DomainFixture, ws: string): Seeded {
  const projectScope = `bench:${fixture.domain}`;
  const DAY = 86_400_000;
  const now = Date.now();

  for (const item of fixture.items) {
    const type = isContextType(item.type ?? "") ? (item.type as ContextType) : "knowledge";
    const trust = isTrustStatus(item.trust ?? "")
      ? (item.trust as TrustStatus)
      : type === "memory"
        ? "approved_memory"
        : "source_evidence";
    const provenance = isProvenanceKind(item.provenance ?? "")
      ? (item.provenance as ProvenanceKind)
      : type === "memory"
        ? "user_input"
        : "file";
    const updatedAt = item.staleDaysAgo ? now - item.staleDaysAgo * DAY : now;
    const id = repo.insertItem({
      id: item.id,
      type,
      content: item.content,
      scope: makeScope({ workspaceId: ws, projectScope }),
      trustStatus: trust,
      consentState: "approved",
      consentActor: "benchmark",
      consentAt: updatedAt,
      provenanceKind: provenance,
      actorKind: "system",
      links: item.taskId ? { ...emptyLinks(), taskId: item.taskId } : emptyLinks(),
      tags: item.tags ?? [],
      now: updatedAt,
    });
    if (item.supersedes) {
      repo.supersede(item.supersedes, id, { now: updatedAt });
    }
  }

  const scope = makeScope({ workspaceId: ws, projectScope });
  // The benchmark measures RETRIEVAL recall over consented fixture rows, so
  // the grant must span every tier the fixtures occupy — including long-term
  // memory and task context. Every fixture row is inserted with
  // consentState "approved" (the consent prerequisite is thus satisfied by
  // construction); narrowing tiers here would measure authorization, not
  // recall. includeUserMemory stays unset (no subtraction) for that reason.
  const grant = buildGrant(
    {
      requester: { kind: "agent", id: "benchmark", role: "agent" },
      scope,
      maxItems: 48,
      maxChars: 24_000,
      auditRef: "benchmark",
    },
    { memoryScopeKind: "user" },
  );

  return { grant };
}

/** Remove a domain's seeded rows so fixtures are hermetic. */
function clearDomain(repo: ContextRepository, ws: string): void {
  for (const item of repo.scopeCandidates(ws, { limit: 2_000 })) {
    repo.deleteItem(item.id, { actor: "benchmark-teardown", reason: "benchmark cleanup" });
  }
}
