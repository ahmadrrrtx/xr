import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore, truncateRecord } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { decidePlacement } from "../../src/runtime/trust/policy.ts";
import { classifyRisk } from "../../src/runtime/trust/classify.ts";
import { makeTrust } from "./_helpers.ts";
import { InProcessBackend } from "../../src/runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../src/runtime/trust/environment/restricted-process.ts";
import type { TrustRequest } from "../../src/runtime/trust/types.ts";

function highRiskReq(): TrustRequest {
  return {
    capability: { kind: "core_tool", name: "shell" }, actorKind: "user", summary: "s",
    spawnsProcess: true, runsArbitraryCode: true, networkTargets: [], fsPaths: [],
    touchesOutsideWorkspace: false, needsCredentials: false, reversible: false,
    irreversibleExternalWrite: false, untrustedContent: false, dryRun: false, workspaceRoot: "/tmp/ws",
  };
}

describe("XR 4.2 migration & rollback safety", () => {
  test("a 4.1-shaped record (no trust field) still loads (backward-compatible read)", () => {
    const now = Date.now();
    // A record exactly as XR 4.1 would have written it — NO `trust` property.
    const rec41: any = {
      id: { runId: "ex_41", workspaceId: "ws", attempt: 1, correlationId: "ex_41" },
      state: "succeeded",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "legacy", origin: { kind: "user", source: "cli" } },
      policy: [],
      action: { capability: { kind: "core_tool", name: "read_file" }, inputSummary: "{}", idempotency: "naturally_idempotent", dryRun: false, placement: { kind: "in_process" } },
      evidence: [],
      artifacts: [],
      history: [{ from: null, to: "created", at: now }],
      createdAt: now,
      updatedAt: now,
      adapterVersion: "xr-4.1.0",
    };

    // (a) Serialization contract — the actual compatibility mechanism, and
    //     platform-independent: a record without `trust` round-trips with
    //     `trust` undefined and all other fields intact.
    const roundTripped = JSON.parse(JSON.stringify(truncateRecord(rec41)));
    expect(roundTripped.trust).toBeUndefined();
    expect(roundTripped.adapterVersion).toBe("xr-4.1.0");
    expect(roundTripped.state).toBe("succeeded");
    expect(roundTripped.action.placement.kind).toBe("in_process");

    // (b) Storage round-trip through the repository. Uses the default rollback
    //     journal (NOT WAL, which is flaky under some Windows setups) and mirrors
    //     the production save → record_json → get path.
    const dir = mkdtempSync(join(tmpdir(), "xr-mig-"));
    const db = new Database(join(dir, "m.db"), { create: true });
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      const repo = new ExecutionRepo(adaptWorkspaceStore({ exec: (s: string) => db.exec(s), prepare: (s: string) => db.prepare(s) }));
      repo.migrate();
      repo.save(rec41);
      const loaded = repo.get("ex_41");
      expect(loaded).not.toBeNull();
      expect(loaded!.trust).toBeUndefined(); // 4.1 records have no trust metadata
      expect(loaded!.adapterVersion).toBe("xr-4.1.0");
    } finally {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    }
  });

  test("rollback safety: the Tier-1 fallback flag can NEVER enable an unsafe high-risk fallback", () => {
    const classification = classifyRisk(highRiskReq());
    // No Tier-2 backend available, but the explicit Tier-1 fallback is enabled.
    const caps = { inProcess: true, restrictedProcess: false, namespaceSandbox: false, container: false, browserIsolated: false, gvisor: false, firecracker: false, isRoot: false };
    const d = decidePlacement(classification, caps, { allowTier1InProcessFallback: true });
    // Tier-2 high-risk must STILL be blocked — the fallback is Tier-1 only.
    expect(d.kind).toBe("blocked");
    expect(d.placement).toBe("in_process"); // requested target, but NOT admitted
  });

  test("rollback safety: low-risk work still uses the fast in-process path", async () => {
    const h = makeTrust([new InProcessBackend(), new RestrictedProcessBackend()]);
    await h.trust.onInit();
    const lowReq: TrustRequest = { ...highRiskReq(), capability: { kind: "core_tool", name: "read_file" }, spawnsProcess: false, runsArbitraryCode: false, reversible: true };
    const ev = await h.trust.evaluate({ request: lowReq, runId: "ex_low", correlationId: "ex_low", workspaceId: "ws", actor: "user:u", capability: "core_tool:read_file" });
    expect(ev.outcome.kind).toBe("in_process_ok");
    expect(ev.trust.classification.tier).toBe("tier0_in_process");
  });

  test("high-risk work stays blocked even without any trust config (default fail-closed)", async () => {
    const h = makeTrust([new InProcessBackend(), new RestrictedProcessBackend()]); // no Tier-2 backend
    await h.trust.onInit();
    const ev = await h.trust.evaluate({
      request: highRiskReq(),
      runId: "ex_hr", correlationId: "ex_hr", workspaceId: "ws", actor: "user:u", capability: "core_tool:shell",
      executable: { argv: ["sh", "-c", "echo hi"], cwd: "/tmp/ws", env: {}, timeoutMs: 5000, maxOutputBytes: 1000 },
    });
    expect(ev.outcome.kind).toBe("blocked");
  });
});
