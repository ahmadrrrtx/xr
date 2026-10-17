/**
 * Phase 2.3 · P1-2 — the approval gate fails CLOSED when no approver is wired.
 *
 * Pre-fix, `if (needsApproval && opts.approve)` fell through to a default
 * "allowed" policy entry: any surface that forgot to wire an approver silently
 * ran privileged capabilities. These tests pin the inversion:
 *   - approval-requiring capability + no approve hook → `requires_approval` +
 *     `denied{code:"approval_unavailable"}` + `execution.approval_unavailable`
 *     audit, and the capability body NEVER runs (spy);
 *   - non-approval capabilities keep the existing default-allow behaviour;
 *   - the tool-declared `requiresApproval` property wins over the kind rules
 *     and the legacy hardcoded name list — in both directions;
 *   - the tool adapter actually passes the declared value through.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore, type ExecutionDb } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { IN_PROCESS_PLACEMENT, okObservation } from "../../src/execution/adapters/common.ts";
import { executeTool } from "../../src/execution/adapters/tool-adapter.ts";
import type { Tool, ToolResult } from "../../src/core/types.ts";

function makeService() {
  const dir = mkdtempSync(join(tmpdir(), "xr-exec-ap-gate-"));
  const db = new Database(join(dir, "test.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s),
  }) as ExecutionDb;
  const auditEvents: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const service = new ExecutionService({
    repo: new ExecutionRepo(wrapped),
    audit: (event, detail) => auditEvents.push({ event, detail }),
  });
  return {
    service,
    auditEvents,
    destroy: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

const base = {
  workspaceId: "ws",
  actor: { kind: "user", source: "cli" } as const,
  placement: IN_PROCESS_PLACEMENT,
  idempotency: "non_idempotent" as const,
  inputSummary: "{}",
};

describe("P1-2 — approval-requiring capability + no approver wired → denied, body never runs", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  const matrix: Array<{ kind: "core_tool" | "control_action" | "mcp_tool" | "plugin_operation"; name: string; owner?: string }> = [
    { kind: "core_tool", name: "shell" },          // legacy hardcoded list
    { kind: "control_action", name: "delete" },    // kind rule: always gated
    { kind: "mcp_tool", name: "fs.write" },        // kind rule: always gated
    { kind: "plugin_operation", name: "publish", owner: "plugin-x" }, // kind rule: always gated
  ];

  for (const row of matrix) {
    test(`${row.kind}:${row.name} → requires_approval + denied{approval_unavailable}, audited, not executed`, async () => {
      let executed = false;
      const capability = { kind: row.kind, name: row.name, ...(row.owner ? { owner: row.owner } : {}) };
      const rec = await h.service.execute({
        ...base,
        intent: { summary: `${row.kind} ${row.name}`, origin: base.actor },
        capability,
        run: async () => {
          executed = true;
          expect.unreachable("capability must not run without an approver");
          return okObservation("phantom success");
        },
      });
      expect(executed).toBe(false);
      expect(rec.state).toBe("denied");
      expect(rec.outcome?.kind).toBe("denied");
      expect(rec.outcome && "stoppedReason" in rec.outcome ? rec.outcome.stoppedReason : undefined).toBe("approval");
      const requested = rec.policy.find((p) => p.kind === "requires_approval");
      const denied = rec.policy.find((p) => p.kind === "denied");
      expect(requested).toBeTruthy();
      expect(denied).toBeTruthy();
      expect(denied && "code" in denied ? denied.code : undefined).toBe("approval_unavailable");
      // The phantom-success marker is gone: no silent "allowed" entry.
      expect(rec.policy.some((p) => p.kind === "allowed")).toBe(false);
      expect(h.auditEvents.some((e) => e.event === "execution.approval_unavailable")).toBe(true);
    });
  }
});

describe("P1-2 — capabilities that do not require approval are unchanged", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  test("model_call without an approver still runs and records the existing default-allow entry", async () => {
    let executed = false;
    const rec = await h.service.execute({
      ...base,
      intent: { summary: "chat", origin: base.actor },
      capability: { kind: "model_call", name: "p" },
      run: async () => { executed = true; return okObservation("ok"); },
    });
    expect(executed).toBe(true);
    expect(rec.state).toBe("succeeded");
    const allowed = rec.policy.find((p) => p.kind === "allowed");
    expect(allowed && "reason" in allowed ? allowed.reason : undefined)
      .toBe("default allow (existing policy authoritative)");
    expect(h.auditEvents.some((e) => e.event === "execution.approval_unavailable")).toBe(false);
  });
});

describe("P1-2 — declared requiresApproval takes precedence (second half of the fix)", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  test("declared true on an unlisted core_tool name IS gated: denied without an approver", async () => {
    let executed = false;
    const rec = await h.service.execute({
      ...base,
      intent: { summary: "declared", origin: base.actor },
      capability: { kind: "core_tool", name: "read_file", requiresApproval: true },
      run: async () => { executed = true; return okObservation("ran"); },
    });
    expect(executed).toBe(false);
    expect(rec.state).toBe("denied");
    const denied = rec.policy.find((p) => p.kind === "denied");
    expect(denied && "code" in denied ? denied.code : undefined).toBe("approval_unavailable");
  });

  test("declared true on an unlisted core_tool name runs normally with an approver", async () => {
    let asked = false;
    const rec = await h.service.execute({
      ...base,
      intent: { summary: "declared + approver", origin: base.actor },
      capability: { kind: "core_tool", name: "read_file", requiresApproval: true },
      approve: async () => { asked = true; return true; },
      run: async () => okObservation("written"),
    });
    expect(asked).toBe(true);
    expect(rec.state).toBe("succeeded");
    expect(rec.policy.some((p) => p.kind === "approval_granted")).toBe(true);
  });

  test("declared false on a legacy-list name is TRUSTED (declared wins over the legacy list)", async () => {
    // Precedence decision for this phase: the adapter-declared value is
    // authoritative in BOTH directions — this is what lets the control
    // adapter's safe tier run ungated while destructive stays hard-gated.
    let executed = false;
    const rec = await h.service.execute({
      ...base,
      intent: { summary: "declared false", origin: base.actor },
      capability: { kind: "core_tool", name: "shell", requiresApproval: false },
      run: async () => { executed = true; return okObservation("ran"); },
    });
    expect(executed).toBe(true);
    expect(rec.state).toBe("succeeded");
    expect(rec.policy.some((p) => p.kind === "requires_approval")).toBe(false);
  });
});

describe("P1-2 — tool adapter passes the declared property to the fabric", () => {
  let h: ReturnType<typeof makeService>;
  beforeEach(() => { h = makeService(); });
  afterEach(() => h.destroy());

  const customWriter = (ran: { v: boolean }): Tool => ({
    name: "custom_writer",
    description: "declared-gated tool whose name is NOT in the legacy list",
    parameters: {},
    requiresApproval: true,
    run: async (_a, _c): Promise<ToolResult> => { ran.v = true; return { ok: true, output: "ran" }; },
  });

  test("declared tool executed through the adapter with no approver → denied, body never runs", async () => {
    const ran = { v: false };
    const res = await executeTool(customWriter(ran), { p: 1 }, {
      service: h.service,
      workspaceId: "ws",
      cwd: "/tmp",
    });
    expect(ran.v).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.__execution!.state).toBe("denied");
    const denied = res.__execution!.policy.find((p) => p.kind === "denied");
    expect(denied && "code" in denied ? denied.code : undefined).toBe("approval_unavailable");
    expect(h.auditEvents.some((e) => e.event === "execution.approval_unavailable")).toBe(true);
  });

  test("declared tool executed through the adapter with an approver → granted + runs", async () => {
    const ran = { v: false };
    const res = await executeTool(customWriter(ran), { p: 1 }, {
      service: h.service,
      workspaceId: "ws",
      cwd: "/tmp",
      approve: async () => true,
    });
    expect(ran.v).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.__execution!.state).toBe("succeeded");
    expect(res.__execution!.policy.some((p) => p.kind === "approval_granted")).toBe(true);
  });
});
