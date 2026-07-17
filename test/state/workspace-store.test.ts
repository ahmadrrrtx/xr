/**
 * XR — WorkspaceStore Suite (0.2 Storage Unification regression guard)
 *
 * Invariants under test:
 *  - exactly ONE connection per store instance; repos are views over it
 *  - legacy constructor path compatibility (pre-0.2 call-sites)
 *  - tamper-evident audit chain detects ANY modification
 *  - secrets are redacted before hitting the audit log
 *  - memory retention: expiry, pruning, exclusion rules, access tracking
 *  - budget config is a true singleton upsert
 *  - workflow persistence is transactional (parent + tasks atomic)
 *  - the 0.5 Business OS adapter surface (prepare/transaction) works
 *
 * Note on connection accounting: bun runs every test file in one process, so
 * WorkspaceStore.connectionCount() is asserted via DELTAS, never absolutes.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceStore, Store } from "../../src/state/workspace-store.ts";
import { SessionRepo } from "../../src/state/repos/session-repo.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { CostRepo } from "../../src/state/repos/cost-repo.ts";
import { UserMemoryRepo } from "../../src/state/repos/user-memory-repo.ts";
import { ProjectMemoryRepo } from "../../src/state/repos/project-memory-repo.ts";
import { SkillRepo } from "../../src/state/repos/skill-repo.ts";
import { WorkflowRepo } from "../../src/state/repos/workflow-repo.ts";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-wstore-"));
  dbPath = join(dir, "workspace.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ── 0.2 unification ─────────────────────────────────────────────────────────

describe("0.2 Storage Unification", () => {
  test("all repositories share exactly one connection and one file", () => {
    const baseline = WorkspaceStore.connectionCount();
    const store = new WorkspaceStore("test", dbPath);
    const sessions = new SessionRepo(store);
    const audit = new AuditRepo(store);
    const costs = new CostRepo(store);

    sessions.createSession("s1", "task", "chat");
    audit.audit("test", { ok: true }, "s1");
    costs.recordCost("s1", "test", "model", 1, 2, 0.01);

    expect(WorkspaceStore.connectionCount()).toBe(baseline + 1);
    expect(store.dbPath).toBe(dbPath);
    // Data written through three repos is visible through the SAME store.
    expect(store.recentSessions()).toHaveLength(1);
    expect(store.recentAudit()).toHaveLength(1);
    expect(store.costSummary().totalUsd).toBe(0.01);

    store.close();
    expect(WorkspaceStore.connectionCount()).toBe(baseline);
  });

  test("legacy single-path constructor still works (backward compat)", () => {
    // Pre-0.2 call-sites did `new Store(path)` with no workspace id.
    const legacyPath = join(dir, "legacy.db");
    const store = new Store(legacyPath);
    expect(store.workspaceId).toBe("default");
    expect(store.dbPath).toBe(legacyPath);
    store.createSession("s1", "t", "chat");
    expect(store.recentSessions()).toHaveLength(1);
    store.close();
  });

  test("lastOpened() tracks the newest store and clears when it closes", () => {
    const a = new WorkspaceStore("a", join(dir, "a.db"));
    expect(WorkspaceStore.lastOpened()).toBe(a);
    const b = new WorkspaceStore("b", join(dir, "b.db"));
    expect(WorkspaceStore.lastOpened()).toBe(b);
    // Contract: closing the current last-opened store clears the pointer —
    // lastOpened() never silently re-activates a stale instance.
    b.close();
    expect(WorkspaceStore.lastOpened()).toBeNull();
    a.close();
    expect(WorkspaceStore.lastOpened()).toBeNull();
  });

  test("creates database parent directories when missing", () => {
    const nested = join(dir, "deep", "nested", "ws.db");
    const store = new WorkspaceStore("deep", nested);
    expect(existsSync(nested)).toBe(true);
    store.close();
  });

  test("every repo family operates over the unified store", () => {
    const store = new WorkspaceStore("all", dbPath);
    const sessions = new SessionRepo(store);
    const audit = new AuditRepo(store);
    const costs = new CostRepo(store);
    const userMem = new UserMemoryRepo(store);
    const projectMem = new ProjectMemoryRepo(store);
    const skills = new SkillRepo(store);
    const workflows = new WorkflowRepo(store);

    sessions.createSession("s1", "t", "chat");
    expect(sessions.recentSessions()).toHaveLength(1);

    audit.audit("e", { x: 1 });
    expect(audit.count()).toBe(1);
    expect(audit.verifyChain().valid).toBe(true);

    costs.recordCost("s1", "p", "m", 10, 20, 0.005);
    expect(store.costSummary().totalUsd).toBeCloseTo(0.005, 6);

    userMem.insertMemory({
      id: "m1", category: "fact", content: "uses bun",
      scope: "global", source: "user", tags: "", importance: 3,
    });
    expect(userMem.count()).toBe(1);

    projectMem.remember("p1", "proj", "fact", "deploys on fridays");
    expect(projectMem.recall("proj")).toHaveLength(1);

    skills.insertSkill("skill-1", 1, "learned", "because");
    expect(store.skillCount()).toBe(1);

    workflows.saveWorkflow({
      workflowId: "w1", kind: "build", goal: "g", status: "planned",
      reviewState: "none", approvalState: "none", cancellationState: "none",
      planSummary: "p", tasks: [], createdAt: Date.now(), updatedAt: Date.now(),
    });
    expect(workflows.getWorkflow("w1")?.workflowId).toBe("w1");

    store.close();
  });
});

// ── tamper evidence & redaction ─────────────────────────────────────────────

describe("tamper-evident audit chain", () => {
  test("chain verifies intact after many entries", () => {
    const store = new WorkspaceStore("chain", dbPath);
    for (let i = 0; i < 25; i++) store.audit(`event.${i}`, { i });
    expect(store.auditCount()).toBe(25);
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });

  test("direct tampering with a stored row is detected", () => {
    const store = new WorkspaceStore("tamper", dbPath);
    store.audit("a", { v: 1 });
    store.audit("b", { v: 2 });
    store.audit("c", { v: 3 });
    expect(store.verifyChain().valid).toBe(true);

    // Simulate an attacker editing history via a raw connection.
    store.close();
    const raw = new Database(dbPath);
    raw.query(`UPDATE audit_log SET detail='{"v":999}' WHERE id=2`).run();
    raw.close();

    const reopened = new WorkspaceStore("tamper", dbPath);
    const result = reopened.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
    reopened.close();
  });

  test("API keys and bearer tokens are redacted before persistence", () => {
    const store = new WorkspaceStore("redact", dbPath);
    store.audit("leak-test", {
      apiKey: "sk-abcdef1234567890XYZ",
      header: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
    });
    const row = store.recentAudit(1)[0];
    expect(row.detail).not.toContain("sk-abcdef1234567890XYZ");
    expect(row.detail).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(row.detail).toContain("«redacted»");
    // Chain still verifies (redaction happens BEFORE hashing).
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });
});

// ── durable user memory: retention, exclusion, access tracking ──────────────

describe("durable user memory (Stage 6 retention)", () => {
  function seed(store: WorkspaceStore): void {
    store.insertMemory({
      id: "keep-1", category: "fact", content: "user likes typescript",
      scope: "global", source: "user", tags: "lang", importance: 4,
    });
    store.insertMemory({
      id: "proj-1", category: "project", content: "xr uses sqlite",
      scope: "proj-x", source: "chat", tags: "", importance: 3,
    });
    store.insertMemory({
      id: "excl-1", category: "exclusion", content: "do not remember salary",
      scope: "global", source: "user", tags: "", importance: 5,
    });
  }

  test("listMemory hides exclusions unless explicitly requested", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    const def = store.listMemory();
    expect(def.some((m) => m.id === "excl-1")).toBe(false);
    const withEx = store.listMemory({ category: "exclusion" });
    expect(withEx.some((m) => m.id === "excl-1")).toBe(true);
    store.close();
  });

  test("scope filter returns global + the scope, never another scope", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    const rows = store.listMemory({ scope: "proj-x" });
    expect(rows.some((m) => m.id === "proj-1")).toBe(true);
    expect(rows.some((m) => m.id === "keep-1")).toBe(true);
    store.insertMemory({
      id: "other-1", category: "project", content: "unrelated",
      scope: "proj-y", source: "chat", tags: "", importance: 1,
    });
    expect(store.listMemory({ scope: "proj-x" }).some((m) => m.id === "other-1")).toBe(false);
    store.close();
  });

  test("expired entries vanish from recall and are pruned permanently", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    const past = Date.now() - 60_000;
    const future = Date.now() + 60_000;
    store.insertMemory({
      id: "old-1", category: "fact", content: "stale note",
      scope: "global", source: "user", tags: "", importance: 3, expiresAt: past,
    });
    store.insertMemory({
      id: "fresh-1", category: "fact", content: "fresh note",
      scope: "global", source: "user", tags: "", importance: 3, expiresAt: future,
    });

    expect(store.expiredMemoryCount()).toBe(1);
    expect(store.listMemory().some((m) => m.id === "old-1")).toBe(false);
    expect(store.listMemory().some((m) => m.id === "fresh-1")).toBe(true);
    expect(store.listMemory({ includeExpired: true }).some((m) => m.id === "old-1")).toBe(true);

    expect(store.pruneExpiredMemory()).toBe(1);
    expect(store.expiredMemoryCount()).toBe(0);
    expect(store.getMemory("old-1")).toBeNull();
    expect(store.getMemory("fresh-1")).not.toBeNull();
    store.close();
  });

  test("touchMemoryAccess bumps access_count and last_accessed_at", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    const before = store.getMemory("keep-1")!;
    expect(before.access_count).toBe(0);
    expect(before.last_accessed_at).toBeNull();
    store.touchMemoryAccess(["keep-1"], 111);
    store.touchMemoryAccess(["keep-1"], 222);
    const after = store.getMemory("keep-1")!;
    expect(after.access_count).toBe(2);
    expect(after.last_accessed_at).toBe(222);
    store.close();
  });

  test("editing content/tags invalidates the cached embedding", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    store.setMemoryEmbedding("keep-1", [0.1, 0.2, 0.3]);
    expect(store.getMemory("keep-1")!.embedding).toBe("[0.1,0.2,0.3]");
    // Unrelated patch keeps the embedding…
    store.updateMemory("keep-1", { importance: 5 });
    expect(store.getMemory("keep-1")!.embedding).toBe("[0.1,0.2,0.3]");
    // …but a content change clears it so recall re-embeds lazily.
    store.updateMemory("keep-1", { content: "user loves typescript" });
    expect(store.getMemory("keep-1")!.embedding).toBeNull();
    store.close();
  });

  test("session summaries stay separate from long-term memory", () => {
    const store = new WorkspaceStore("mem", dbPath);
    seed(store);
    store.insertSessionSummary("sum-1", "global", "talked about tests");
    expect(store.listSessionSummaries().some((s) => s.id === "sum-1")).toBe(true);
    // Summaries must not leak into durable memory listings.
    expect(store.listMemory().some((m) => m.content.includes("talked about tests"))).toBe(false);
    expect(store.deleteSessionSummary("sum-1")).toBe(true);
    store.close();
  });
});

// ── budget + cost integrity ─────────────────────────────────────────────────

describe("budget configuration singleton", () => {
  test("upsert keeps exactly one row and preserves unset fields", () => {
    const store = new WorkspaceStore("budget", dbPath);
    store.setBudgetConfig({ monthly_cap: 25 });
    const first = store.getBudgetConfig()!;
    expect(first.monthly_cap).toBe(25);
    expect(first.warnings_enabled).toBe(true);

    store.setBudgetConfig({ monthly_cap: 50, daily_cap: 2 });
    const second = store.getBudgetConfig()!;
    expect(second.monthly_cap).toBe(50);
    expect(second.daily_cap).toBe(2);
    expect(second.warnings_enabled).toBe(true); // preserved, not reset

    // Still a single config row (id = 1 enforced by CHECK constraint).
    const raw = store.prepare(`SELECT COUNT(*) c FROM budget_config`).get() as { c: number };
    expect(raw.c).toBe(1);
    store.close();
  });

  test("getSpendForPeriod only aggregates costs inside the window", () => {
    const store = new WorkspaceStore("budget", dbPath);
    store.recordCost("s1", "p", "m", 1, 1, 1.5);
    expect(store.getSpendForPeriod(Date.now() - 60_000)).toBeCloseTo(1.5, 6);
    expect(store.getSpendForPeriod(Date.now() + 60_000)).toBe(0);
    store.close();
  });
});

// ── workflow + research + schedules persistence ─────────────────────────────

describe("workflow persistence", () => {
  test("saveWorkflow persists parent + tasks and upserts idempotently", () => {
    const store = new WorkspaceStore("wf", dbPath);
    const record = {
      workflowId: "w1", kind: "build", goal: "ship tests", status: "planned",
      reviewState: "none", approvalState: "none", cancellationState: "none",
      planSummary: "plan", tasks: [
        {
          taskId: "t1", workflowId: "w1", agentId: "planner", role: "planner",
          name: "plan", status: "pending", reviewState: "none", approvalState: "none",
          dependencies: [], createdAt: Date.now(), updatedAt: Date.now(),
        },
      ],
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    store.saveWorkflow(record);
    expect(store.getWorkflow("w1")?.tasks).toHaveLength(1);

    // Upsert with different tasks — old tasks are replaced (transactional).
    store.saveWorkflow({ ...record, status: "running", tasks: [] });
    const after = store.getWorkflow("w1");
    expect(after?.status).toBe("running");
    expect(after?.tasks ?? []).toHaveLength(0);
    expect(store.listWorkflowSummaries(10)).toHaveLength(1);
    store.close();
  });

  test("research sessions insert then update without duplicating", () => {
    const store = new WorkspaceStore("research", dbPath);
    store.saveResearch("r1", "topic", "deep", "running", "{\"a\":1}");
    store.saveResearch("r1", "topic", "deep", "done", "{\"a\":2}");
    expect(store.researchCount()).toBe(1);
    expect(store.getResearch("r1")?.data).toBe("{\"a\":2}");
    expect(store.latestResearch()?.id).toBe("r1");
    store.close();
  });

  test("schedules CRUD round-trips", () => {
    const store = new WorkspaceStore("cron", dbPath);
    store.saveSchedule("sched-1", "{\"cron\":\"* * * * *\"}");
    expect(store.listSchedules()).toHaveLength(1);
    store.deleteSchedule("sched-1");
    expect(store.listSchedules()).toHaveLength(0);
    store.close();
  });
});

// ── 0.5 Business OS adapter surface ─────────────────────────────────────────

describe("0.5 Business OS adapter surface", () => {
  test("prepare() + transaction() expose the raw statement surface", () => {
    const store = new WorkspaceStore("adapter", dbPath);
    // BusinessDatabase migrates + queries through exactly this surface.
    store.transaction(() => {
      store.prepare(`CREATE TABLE IF NOT EXISTS adapter_probe (id TEXT)`).run();
      store.prepare(`INSERT INTO adapter_probe (id) VALUES (?)`).run("x1");
    })();
    const got = store.prepare(`SELECT id FROM adapter_probe`).get() as { id: string };
    expect(got.id).toBe("x1");
    store.close();
  });

  test("project memory is deduped by (project, kind, content)", () => {
    const store = new WorkspaceStore("pm", dbPath);
    store.remember("r1", "proj", "fact", "same fact");
    store.remember("r2", "proj", "fact", "same fact");
    expect(store.memoryCount("proj")).toBe(1);
    store.forget("r1");
    expect(store.memoryCount("proj")).toBe(0);
    store.close();
  });
});
