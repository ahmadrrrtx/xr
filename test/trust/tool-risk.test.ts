import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { executeTool } from "../../src/execution/adapters/tool-adapter.ts";
import { readFileTool, writeFileTool } from "../../src/tools/files.ts";
import { fetchUrlTool } from "../../src/tools/web.ts";
import { gitStatusTool, gitCommitTool } from "../../src/tools/git.ts";
import { classifyRisk } from "../../src/trust/classify.ts";
import { InProcessBackend } from "../../src/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../src/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../../src/trust/environment/namespace.ts";
import { makeTrust, makeTrustNoSandbox, type TrustHarness } from "./_helpers.ts";
import type { ToolContext } from "../../src/core/types.ts";
import type { TrustRequest } from "../../src/trust/types.ts";

let h: TrustHarness;
let service: ExecutionService;
let W: string;
let destroy: () => void;

const fakeCtx: ToolContext = {
  cwd: "/tmp/ws",
  approve: async () => true,
  audit: () => {},
};

beforeAll(async () => {
  h = makeTrust([new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend()]);
  await h.trust.onInit();
  W = mkdtempSync(join(tmpdir(), "xr-tool-risk-"));
  const dir = mkdtempSync(join(tmpdir(), "xr-tool-risk-db-"));
  const db = new Database(join(dir, "test.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({ exec: (s: string) => db.exec(s), prepare: (s: string) => db.prepare(s) });
  service = new ExecutionService({ repo: new ExecutionRepo(wrapped), trust: h.trust });
  destroy = () => {
    try { db.close(); } catch { /* noop */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  };
});

afterAll(() => {
  destroy?.();
  try { rmSync(W, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("XR 4.2 requiresHostAuthority refinement", () => {
  function req(over: Partial<TrustRequest>): TrustRequest {
    return {
      capability: { kind: "core_tool", name: "x" }, actorKind: "user", summary: "s",
      spawnsProcess: false, runsArbitraryCode: true, networkTargets: [], fsPaths: [],
      touchesOutsideWorkspace: false, needsCredentials: false, reversible: false,
      irreversibleExternalWrite: false, untrustedContent: false, dryRun: false, workspaceRoot: "/tmp/ws",
      ...over,
    };
  }

  test("sandboxable Tier-2 with no executable is BLOCKED", async () => {
    const ev = await h.trust.evaluate({ request: req({}), runId: "ex_a", correlationId: "ex_a", workspaceId: "ws", actor: "user:u", capability: "core_tool:x" });
    expect(ev.outcome.kind).toBe("blocked");
  });

  test("Tier-2 that requires host authority is admitted in-process (elevated gate), NOT blocked", async () => {
    const ev = await h.trust.evaluate({
      request: req({ requiresHostAuthority: true, controlRisk: "destructive" }),
      runId: "ex_b", correlationId: "ex_b", workspaceId: "ws", actor: "user:u", capability: "core_tool:computer_control",
    });
    expect(ev.outcome.kind).toBe("in_process_ok");
    expect(ev.trust.classification.tier).toBe("tier2_isolated");
    expect(ev.trust.decision.placement).toBe("in_process");
    expect(ev.trust.decision.reason).toContain("host-authority");
  });

  test("requiresHostAuthority is admitted in-process EVEN WITH NO sandbox backend (Windows scenario)", async () => {
    // Simulates a host with no namespace/container backend (e.g. Windows): the
    // host-authority action must still be admitted in-process, NOT blocked.
    const noSandbox = makeTrustNoSandbox();
    await noSandbox.trust.onInit();
    expect(noSandbox.trust.capabilities().namespaceSandbox).toBe(false);
    expect(noSandbox.trust.capabilities().container).toBe(false);
    const ev = await noSandbox.trust.evaluate({
      request: req({ requiresHostAuthority: true, controlRisk: "destructive" }),
      runId: "ex_win", correlationId: "ex_win", workspaceId: "ws", actor: "user:u", capability: "control_action:computer_use",
    });
    expect(ev.outcome.kind).toBe("in_process_ok"); // NOT blocked despite no sandbox
    expect(ev.trust.classification.tier).toBe("tier2_isolated");
    expect(ev.trust.decision.reason).toContain("host-authority");
  });
});

describe("XR 4.2 per-tool risk declarations", () => {
  test("read_file → Tier 0", () => {
    const r = readFileTool.trustRequest!({ path: "a.txt" }, fakeCtx)!;
    expect(classifyRisk(r).tier).toBe("tier0_in_process");
  });
  test("write_file → Tier 1", () => {
    const r = writeFileTool.trustRequest!({ path: "a.txt", content: "x" }, fakeCtx)!;
    expect(classifyRisk(r).tier).toBe("tier1_restricted");
  });
  test("fetch_url → Tier 1 with a network allowlist", () => {
    const r = fetchUrlTool.trustRequest!({ url: "https://example.com/x" }, fakeCtx)!;
    const c = classifyRisk(r);
    expect(c.tier).toBe("tier1_restricted");
    expect(c.net.allowlist).toContain("example.com");
  });
  test("git_status → Tier 0; git_commit → Tier 1", () => {
    expect(classifyRisk(gitStatusTool.trustRequest!({}, fakeCtx)!).tier).toBe("tier0_in_process");
    expect(classifyRisk(gitCommitTool.trustRequest!({ message: "m" }, fakeCtx)!).tier).toBe("tier1_restricted");
  });
});

describe("XR 4.2 tools execute through the trust gate (end-to-end, non-blocking)", () => {
  test("read_file runs and is recorded as Tier 0 / in_process_ok", async () => {
    writeFileSync(join(W, "in.txt"), "hello-world");
    const res = await executeTool(readFileTool, { path: "in.txt" }, { service, workspaceId: "ws", cwd: W, approve: async () => true, audit: () => {} });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("hello-world");
    const rec = (res as { __execution?: { trust?: { classification: { tier: string }; decision: { kind: string } } } }).__execution;
    expect(rec?.trust?.classification.tier).toBe("tier0_in_process");
    expect(rec?.trust?.decision.kind).toBe("in_process_ok");
  });

  test("write_file runs and is recorded as Tier 1 policy-only (admitted, not blocked)", async () => {
    const res = await executeTool(writeFileTool, { path: "out.txt", content: "written-by-trust" }, { service, workspaceId: "ws", cwd: W, approve: async () => true, audit: () => {} });
    expect(res.ok).toBe(true);
    expect(existsSync(join(W, "out.txt"))).toBe(true);
    expect(readFileSync(join(W, "out.txt"), "utf8")).toBe("written-by-trust");
    const rec = (res as { __execution?: { trust?: { classification: { tier: string }; decision: { kind: string; placement: string; reason: string } } } }).__execution;
    expect(rec?.trust?.classification.tier).toBe("tier1_restricted");
    expect(rec?.trust?.decision.kind).toBe("admitted");
    expect(rec?.trust?.decision.placement).toBe("in_process");
    expect(rec?.trust?.decision.reason).toContain("policy-only");
  });
});
