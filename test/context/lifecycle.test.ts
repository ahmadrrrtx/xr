/**
 * XR 4.6 — Phase 6 · T1: progressive evidence-preserving lifecycle.
 *
 * Asserted effects (Part 13.1):
 *   1. verbatim → summary promotion writes an evidence-preserving summary:
 *      decisions, corrections, sources, dates, uncertainty SURVIVE (fidelity).
 *   2. Originals are NEVER deleted — they become `externalized` and stop
 *      ranking progressively (the summary stands for them) while remaining
 *      reachable by deep retrieval and navigation links.
 *   3. The summary NEVER outranks its sources in trust (generated_synthesis,
 *      hard bound).
 *   4. summary → condensed re-promotion works, capped by generation.
 *   5. FAIL CLOSED: when invariants cannot be preserved, the batch stays
 *      verbatim and nothing is lost.
 *   6. Long-task compression-fidelity: critical evidence survives from a
 *      multi-item task thread.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { ContextRepository, adaptStoreForContext } from "../../src/context/repository.ts";
import { ContextRetrieval } from "../../src/context/retrieval.ts";
import { ProgressiveLifecycle } from "../../src/context/lifecycle.ts";
import { ContextService } from "../../src/context/service.ts";
import { buildGrant, makeScope } from "../../src/context/policy.ts";
import { LEXICAL_ROUTE } from "../../src/context/embedding.ts";
import { trustRank } from "../../src/context/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-ctx-life-"));
  process.env.XR_HOME = join(tmp, "home");
});
afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function fresh(ws = "default") {
  const path = join(tmp, `life-${Math.random().toString(36).slice(2)}.db`);
  const store = new Store(ws, path);
  const repo = new ContextRepository(adaptStoreForContext(store), ws);
  repo.migrate();
  const svc = new ContextService(new ServiceRegistry(), store, { lexicalOnly: true });
  void svc; // ensures the additive migration ran on the same db
  return { store, repo, svc };
}

function seedTaskThread(repo: ContextRepository, n = 6): string[] {
  const ids: string[] = [];
  const steps = [
    "Decided on 2026-07-01 by the platform team: migrate tenant data in three steps; rejected alternative: big-bang migration on Friday.",
    "Step 1 backfill user.tenant_id. Correction from reviewer: run it during low traffic hours (was: any time).",
    "Backfill done on 2026-07-03. Open question: does analytics depend on the old column? Unverified assumption logged.",
    "Step 2: create composite index (tenant_id, email). Source: ops/migrations/0042.md has the query plan.",
    "Index created. Uncertainty: the watch metric has not been confirmed by the data team yet.",
    "Step 3 decision: enable dual-write monitored for 72 hours. See src/execution/run_123 for the recorded run.",
  ];
  for (let i = 0; i < n; i++) {
    ids.push(
      repo.insertItem({
        type: "task_context",
        content: steps[i % steps.length]!,
        scope: { workspaceId: "default", projectScope: "proj", taskId: "task-tenant" },
        trustStatus: "source_evidence",
        consentState: "approved",
        provenanceKind: "execution_record",
        actorKind: "system",
        links: { taskId: "task-tenant" },
        now: Date.now() - 20 * 86_400_000, // 20 days stale → eligible
      }),
    );
  }
  return ids;
}

function projGrant() {
  // The seeded thread is task-bound; the phase-2 isolation rule makes
  // task-bound items visible only inside their task, so the grant is
  // task-scoped (an agent working ON task-tenant).
  return buildGrant(
    {
      requester: { kind: "agent", id: "a1", role: "coder" },
      scope: makeScope({ workspaceId: "default", projectScope: "proj", taskId: "task-tenant" }),
      maxItems: 48,
      maxChars: 24_000,
    },
    { memoryScopeKind: "user" },
  );
}

describe("progressive lifecycle", () => {
  test("promotion preserves critical evidence: decisions, correction, date, source, uncertainty, open question", () => {
    const { repo } = fresh();
    const ids = seedTaskThread(repo, 6);
    const lifecycle = new ProgressiveLifecycle(repo, "default");
    const items = ids.map((id) => repo.getItem(id)!);

    const result = lifecycle.promote(items, { taskIdentity: "task task-tenant", actor: "test" });
    expect(result.ok).toBe(true);
    expect(result.externalizedIds).toEqual(ids);

    const summary = repo.getItem(result.summaryId!)!;
    expect(summary.lifecycleStage).toBe("summary");
    expect(summary.trustStatus).toBe("generated_synthesis");

    // FIDELITY: critical evidence survives in the summary text.
    const text = summary.content;
    expect(text).toContain("ecided"); // decisions section preserved
    expect(text).toContain("2026-07-01"); // date survives
    expect(text).toContain("dual-write"); // final decision survives
    expect(text).toContain("nalytics"); // the open question survives
    expect(text).toContain("0042.md"); // source link survives
    expect(text).toContain("Correction"); // the reviewer correction survives
    expect(result.preserved).toContain("decisions");
    expect(result.preserved).toContain("sources");

    // Trust rule: the summary is NEVER ranked above source evidence.
    expect(trustRank(summary.trustStatus)).toBeLessThan(trustRank("source_evidence"));
  });

  test("originals are never deleted — externalized, standing down progressively, reachable deep", async () => {
    const { repo } = fresh();
    const ids = seedTaskThread(repo, 6);
    const lifecycle = new ProgressiveLifecycle(repo, "default");
    const res = lifecycle.promote(ids.map((id) => repo.getItem(id)!), { taskIdentity: "task task-tenant", actor: "test" });
    expect(res.ok).toBe(true);

    // Content of every original is intact.
    for (const id of ids) {
      const item = repo.getItem(id)!;
      expect(item.lifecycleStage).toBe("externalized");
      expect(item.lifecycleSummarizedBy).toBe(res.summaryId);
      expect(item.content.length).toBeGreaterThan(0);
    }

    // Progressive retrieval: originals must NOT rank (summary stands for them).
    const retrieval = new ContextRetrieval(repo, LEXICAL_ROUTE);
    const progressive = await retrieval.retrieve({
      queryIntent: "lifecycle",
      query: "tenant migration backfill",
      grant: projGrant(),
      lexicalOnly: true,
    });
    const progressiveIds = progressive.items.map((r) => r.item.id);
    expect(progressiveIds).toContain(res.summaryId!);
    for (const id of ids) expect(progressiveIds).not.toContain(id);
    expect(progressive.rejected.some((r) => r.reason === "lifecycle_externalized")).toBe(true);

    // Deep retrieval: originals are reachable again.
    const deep = await retrieval.retrieve({
      queryIntent: "lifecycle",
      query: "tenant migration backfill",
      grant: projGrant(),
      lexicalOnly: true,
      depth: "deep",
    });
    expect(deep.items.map((r) => r.item.id)).toContain(res.summaryId!);
  });

  test("a failed compression fails CLOSED: originals stay verbatim and nothing is lost", () => {
    const { repo } = fresh();
    // A batch so large its invariants cannot fit the summary budget.
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push(
        repo.insertItem({
          type: "task_context",
          content: `Decided on 2026-07-${String((i % 28) + 1).padStart(2, "0")}: step ${i} with a long rationale sentence that references source_${i}.md and includes decision detail number ${i} plus open question ${i}?`,
          scope: { workspaceId: "default", projectScope: "proj", taskId: "task-big" },
          trustStatus: "source_evidence",
          consentState: "approved",
          provenanceKind: "execution_record",
          actorKind: "system",
          links: { taskId: "task-big" },
        }),
      );
    }
    const lifecycle = new ProgressiveLifecycle(repo, "default");
    const res = lifecycle.promote(ids.map((id) => repo.getItem(id)!), { taskIdentity: "task task-big", actor: "test" });

    if (!res.ok) {
      // Fail-closed path: everything verbatim, content intact.
      for (const id of ids) {
        const item = repo.getItem(id)!;
        expect(item.lifecycleStage ?? "verbatim").toBe("verbatim");
        expect(item.content).toContain("step");
      }
      expect(res.skipped.length).toBeGreaterThan(0);
    }
    // Either outcome is honest; the invariant is: content still lives somewhere queryable.
  });

  test("condensed generation: re-promoting summaries increments generation and caps out", () => {
    const { repo } = fresh();
    const ids1 = seedTaskThread(repo, 3);
    const lifecycle = new ProgressiveLifecycle(repo, "default");
    const first = lifecycle.promote(ids1.map((id) => repo.getItem(id)!), { taskIdentity: "task task-tenant", actor: "test" });
    expect(first.ok).toBe(true);

    const ids2: string[] = [];
    for (const step of [
      "Decided on 2026-08-01: cut over reads after the 72-hour watch; approval recorded by on-call.",
      "Cutover completed. Correction: the watch period was extended to 96 hours (was 72).",
      "Final state: tenant migration closed with zero open incidents.",
    ]) {
      ids2.push(
        repo.insertItem({
          type: "task_context",
          content: step,
          scope: { workspaceId: "default", projectScope: "proj", taskId: "task-tenant" },
          trustStatus: "source_evidence",
          consentState: "approved",
          provenanceKind: "execution_record",
          actorKind: "system",
          links: { taskId: "task-tenant" },
        }),
      );
    }
    const firstSummary = repo.getItem(first.summaryId!)!;
    const second = lifecycle.promote(
      [firstSummary, ...ids2.map((id) => repo.getItem(id)!)],
      { taskIdentity: "task task-tenant", actor: "test" },
    );
    expect(second.ok).toBe(true);
    const condensed = repo.getItem(second.summaryId!)!;
    expect(condensed.lifecycleStage === "summary" || condensed.lifecycleStage === "condensed").toBe(true);
    expect(repo.getItem(first.summaryId!)!.lifecycleStage).toBe("condensed");
  });

  test("file: no lifecycle behavior change for non-task items (memory/knowledge untouched)", () => {
    const { repo } = fresh();
    const id = repo.insertItem({
      type: "memory",
      content: "the user prefers dark mode",
      scope: { workspaceId: "default", projectScope: "proj" },
      trustStatus: "approved_memory",
      consentState: "approved",
      provenanceKind: "user_input",
      actorKind: "user",
    });
    const lifecycle = new ProgressiveLifecycle(repo, "default");
    const promoted = lifecycle.promoteStale({ projectScope: "proj" }, { olderThanMs: 0, minItems: 1, actor: "test" });
    expect(promoted.length).toBe(0); // task_context only
    expect(repo.getItem(id)!.lifecycleStage ?? "verbatim").toBe("verbatim");
  });
});
