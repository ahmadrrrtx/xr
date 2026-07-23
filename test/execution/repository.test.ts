import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore, type ExecutionDb } from "../../src/execution/repository.ts";
import type { ExecutionRecord } from "../../src/execution/types.ts";
import { EXECUTION_ADAPTER_VERSION } from "../../src/execution/types.ts";

function makeDb(): { db: Database; exec: (s: string) => void; prepare: any; path: string; destroy: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xr-exec-repo-"));
  const path = join(dir, "test.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    db,
    path,
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    destroy: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

function baseRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  const now = Date.now();
  return {
    id: { runId: "ex_test1", workspaceId: "ws", correlationId: "c_test1", attempt: 1 },
    state: "succeeded",
    actor: { kind: "user", source: "cli" },
    intent: { summary: "test action", origin: { kind: "user", source: "cli" } },
    action: {
      capability: { kind: "core_tool", name: "read_file" },
      inputSummary: "{}",
      idempotency: "naturally_idempotent",
      dryRun: false,
      placement: { kind: "in_process" },
    },
    policy: [{ kind: "allowed", at: now }],
    observation: { summary: "ok", transportOk: true },
    evidence: [],
    artifacts: [],
    outcome: { kind: "succeeded", message: "ok", at: now },
    history: [{ from: null, to: "created", at: now }, { from: "created", to: "succeeded", at: now }],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    endedAt: now,
    durationMs: 5,
    adapterVersion: EXECUTION_ADAPTER_VERSION,
    ...overrides,
  };
}

describe("ExecutionRepo", () => {
  let raw: ReturnType<typeof makeDb>;
  let db: ExecutionDb;
  let repo: ExecutionRepo;

  beforeEach(() => {
    raw = makeDb();
    db = adaptWorkspaceStore(raw);
    repo = new ExecutionRepo(db);
    repo.migrate();
  });

  afterEach(() => raw.destroy());

  test("migrate is idempotent", () => {
    expect(() => repo.migrate()).not.toThrow();
    expect(() => repo.migrate()).not.toThrow();
  });

  test("save + get round-trips a record", () => {
    const rec = baseRecord();
    repo.save(rec);
    const got = repo.get("ex_test1");
    expect(got).not.toBeNull();
    expect(got!.id.runId).toBe("ex_test1");
    expect(got!.state).toBe("succeeded");
    expect(got!.action!.capability.name).toBe("read_file");
    expect(got!.outcome!.kind).toBe("succeeded");
  });

  test("upsert updates state and outcome", () => {
    const rec = baseRecord({ state: "running" });
    repo.save(rec);
    rec.state = "succeeded";
    rec.outcome = { kind: "succeeded", message: "final", at: Date.now() };
    repo.save(rec);
    const got = repo.get("ex_test1")!;
    expect(got.state).toBe("succeeded");
    expect(got.outcome!.message).toBe("final");
  });

  test("query filters by workspace/session/capability", () => {
    repo.save(baseRecord({ id: { runId: "ex_a", workspaceId: "ws", correlationId: "c_a", attempt: 1 } }));
    repo.save(baseRecord({
      id: { runId: "ex_b", workspaceId: "ws", sessionId: "s1", correlationId: "c_b", attempt: 1 },
      action: { ...baseRecord().action!, capability: { kind: "model_call", name: "openai" } },
      state: "running",
    }));
    repo.save(baseRecord({ id: { runId: "ex_c", workspaceId: "ws2", correlationId: "c_c", attempt: 1 } }));

    const wsAll = repo.query({ workspaceId: "ws" });
    expect(wsAll).toHaveLength(2);
    expect(wsAll.map((r) => r.runId).sort()).toEqual(["ex_a", "ex_b"]);

    const s1 = repo.query({ workspaceId: "ws", sessionId: "s1" });
    expect(s1).toHaveLength(1);
    expect(s1[0]!.runId).toBe("ex_b");

    const modelCalls = repo.query({ workspaceId: "ws", capabilityKind: "model_call" });
    expect(modelCalls).toHaveLength(1);
    expect(modelCalls[0]!.runId).toBe("ex_b");

    const ws2 = repo.query({ workspaceId: "ws2" });
    expect(ws2).toHaveLength(1);
  });

  test("findCompletedByIdempotencyKey finds a prior successful record", () => {
    const rec = baseRecord({
      id: { runId: "ex_imp", workspaceId: "ws", correlationId: "c_imp", attempt: 1 },
      action: { ...baseRecord().action!, idempotency: "idempotent_with_key", idempotencyKey: "key-123" },
    });
    repo.save(rec);
    const found = repo.findCompletedByIdempotencyKey("ws", "core_tool", "read_file", "key-123");
    expect(found).not.toBeNull();
    expect(found!.id.runId).toBe("ex_imp");
    const miss = repo.findCompletedByIdempotencyKey("ws", "core_tool", "read_file", "nope");
    expect(miss).toBeNull();
  });

  test("count reflects saved records", () => {
    expect(repo.count("ws")).toBe(0);
    repo.save(baseRecord({ id: { runId: "ex_1", workspaceId: "ws", correlationId: "c_1", attempt: 1 } }));
    repo.save(baseRecord({ id: { runId: "ex_2", workspaceId: "ws", correlationId: "c_2", attempt: 1 } }));
    expect(repo.count("ws")).toBe(2);
    expect(repo.count("other")).toBe(0);
  });
});
