import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../src/state/workspace-store.ts";
import { SessionRepo } from "../src/state/repos/session-repo.ts";
import { AuditRepo } from "../src/state/repos/audit-repo.ts";
import { CostRepo } from "../src/state/repos/cost-repo.ts";

describe("workspace storage", () => {
  test("all repositories share one connection and one file", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-storage-"));
    const path = join(dir, "workspace.db");
    const store = new WorkspaceStore("test", path);
    const sessions = new SessionRepo(store);
    const audit = new AuditRepo(store);
    const costs = new CostRepo(store);
    sessions.createSession("s1", "task", "chat");
    audit.audit("test", { ok: true }, "s1");
    costs.recordCost("s1", "test", "model", 1, 2, 0.01);
    expect(WorkspaceStore.connectionCount()).toBe(1);
    expect(store.dbPath).toBe(path);
    expect(store.recentSessions()).toHaveLength(1);
    expect(store.recentAudit()).toHaveLength(1);
    expect(store.costSummary().totalUsd).toBe(0.01);
    store.close();
    expect(WorkspaceStore.connectionCount()).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
