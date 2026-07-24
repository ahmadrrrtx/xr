import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { ExecutionRepo, adaptWorkspaceStore } from "../../src/execution/repository.ts";
import { ExecutionService } from "../../src/execution/service.ts";
import { NamespaceSandboxBackend } from "../../src/trust/environment/namespace.ts";
import { RestrictedProcessBackend } from "../../src/trust/environment/restricted-process.ts";
import { InProcessBackend } from "../../src/trust/environment/in-process.ts";
import { makeTrust, type TrustHarness } from "./_helpers.ts";
import type { TrustRequest } from "../../src/trust/types.ts";

const probe = new NamespaceSandboxBackend();
const NS_AVAILABLE = await probe.detect();

let h: TrustHarness;
let W: string;
let hostSecret: string;
const HOST_SECRET_VALUE = `TOPSECRET_${randomUUID().replace(/-/g, "")}`;

function makeExecService(trust?: TrustHarness["trust"]): { service: ExecutionService; destroy: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xr-trust-exec-"));
  const path = join(dir, "test.db");
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({
    exec: (s: string) => db.exec(s),
    prepare: (s: string) => db.prepare(s),
  });
  const service = new ExecutionService({ repo: new ExecutionRepo(wrapped), trust });
  return {
    service,
    destroy: () => {
      try { db.close(); } catch { /* noop */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
    },
  };
}

function shellRequest(over: Partial<TrustRequest> = {}): TrustRequest {
  return {
    capability: { kind: "core_tool", name: "shell" },
    actorKind: "user",
    summary: "isolated shell",
    spawnsProcess: true,
    runsArbitraryCode: false,
    networkTargets: [],
    fsPaths: [W],
    touchesOutsideWorkspace: false,
    needsCredentials: false,
    reversible: false,
    irreversibleExternalWrite: false,
    untrustedContent: false,
    dryRun: false,
    workspaceRoot: W,
    ...over,
  };
}

beforeAll(async () => {
  h = makeTrust([new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend()]);
  await h.trust.onInit();
  W = mkdtempSync(join(tmpdir(), "xr-trust-int-ws-"));
  hostSecret = join(tmpdir(), `xr-trust-int-hostsecret-${randomUUID().slice(0, 8)}.txt`);
  writeFileSync(hostSecret, HOST_SECRET_VALUE);
});

afterAll(() => {
  try { rmSync(W, { recursive: true, force: true }); } catch { /* noop */ }
  try { rmSync(hostSecret, { force: true }); } catch { /* noop */ }
});

describe("XR 4.2 execution-fabric trust integration", () => {
  test("without opts.trust, behavior is unchanged (XR 4.1 fast path)", async () => {
    const svc = makeExecService(h.trust);
    let ran = false;
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "legacy", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      run: async () => { ran = true; return { summary: "ok", transportOk: true }; },
    });
    expect(rec.state).toBe("succeeded");
    expect(ran).toBe(true);
    expect(rec.trust).toBeUndefined(); // no trust metadata when not requested
    svc.destroy();
  });

  test("Tier 0 trusted action stays on the fast in-process path", async () => {
    const svc = makeExecService(h.trust);
    let ran = false;
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "read", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "read_file" },
      idempotency: "naturally_idempotent",
      inputSummary: "{}",
      trust: {
        request: { ...shellRequest(), capability: { kind: "core_tool", name: "read_file" }, spawnsProcess: false, fsPaths: [], reversible: true },
      },
      run: async () => { ran = true; return { summary: "fast", transportOk: true }; },
    });
    expect(rec.state).toBe("succeeded");
    expect(ran).toBe(true);
    expect(rec.trust).toBeDefined();
    expect(rec.trust!.classification.tier).toBe("tier0_in_process");
    expect(rec.trust!.decision.kind).toBe("in_process_ok");
    svc.destroy();
  });

  test("Tier 2 shell runs INSIDE the namespace sandbox with a verified boundary", async () => {
    if (!NS_AVAILABLE) return;
    const svc = makeExecService(h.trust);
    let ranInProcess = false;
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "isolated shell", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell" },
      idempotency: "non_idempotent",
      inputSummary: "{cmd:write+read}",
      approve: async () => true,
      trust: {
        request: shellRequest(),
        executable: {
          argv: ["sh", "-c", `echo built > out.txt; cat ${hostSecret} 2>/dev/null || echo NO_HOST_SECRET`],
          cwd: W,
          env: {},
          timeoutMs: 30000,
          maxOutputBytes: 100000,
        },
      },
      // This in-process callback must NOT be used for a Tier-2 action.
      run: async () => { ranInProcess = true; return { summary: "should not run in-process", transportOk: true }; },
    });

    expect(rec.state).toBe("succeeded");
    expect(ranInProcess).toBe(false); // executed in the sandbox, not the host process
    expect(rec.action!.placement.kind).toBe("namespace_sandbox");
    expect(rec.trust!.classification.tier).toBe("tier2_isolated");
    expect(rec.trust!.verification?.verified).toBe(true);
    expect(rec.trust!.cleanup?.state).toBe("succeeded");
    // The sandbox could not read the host secret; the workspace write persisted.
    expect(String(rec.observation?.meta?.stdout ?? "")).toContain("NO_HOST_SECRET");
    expect(JSON.stringify(rec)).not.toContain(HOST_SECRET_VALUE);
    expect(existsSync(join(W, "out.txt"))).toBe(true);
    // Approval was granted but is bound to the action; it did not bypass placement.
    expect(rec.policy.some((p) => p.kind === "approval_granted")).toBe(true);
    svc.destroy();
  });

  test("a high-risk action with NO isolated path is BLOCKED (fail closed, run not called)", async () => {
    const svc = makeExecService(h.trust);
    let ran = false;
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "code exec", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell" },
      idempotency: "non_idempotent",
      inputSummary: "{}",
      approve: async () => true,
      trust: { request: shellRequest({ runsArbitraryCode: true }) }, // no executable provided
      run: async () => { ran = true; return { summary: "must not run", transportOk: true }; },
    });
    expect(rec.state).toBe("denied");
    expect(rec.outcome!.kind).toBe("denied");
    expect(rec.outcome!.error?.code).toBe("TRUST_BLOCKED");
    expect(ran).toBe(false);
    expect(rec.trust!.decision.kind).toBe("blocked");
    svc.destroy();
  });

  test("credentials are scoped, injected, redacted from the record, and revoked", async () => {
    if (!NS_AVAILABLE) return;
    const svc = makeExecService(h.trust);
    const RAW = `RAWSECRET_${randomUUID().replace(/-/g, "")}`;
    const ref = h.broker.register("token", RAW, "core_tool:shell");
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "cred exec", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell" },
      idempotency: "non_idempotent",
      inputSummary: "{}",
      approve: async () => true,
      trust: {
        request: shellRequest({ needsCredentials: true }),
        executable: { argv: ["sh", "-c", "echo GOT=${XR_CRED_TOKEN:+yes}"], cwd: W, env: {}, timeoutMs: 30000, maxOutputBytes: 100000 },
        credentialRefs: [ref],
      },
      run: async () => ({ summary: "n/a", transportOk: true }),
    });
    expect(rec.state).toBe("succeeded");
    // The sandbox saw the credential (presence marker) but the record never holds the raw value.
    expect(String(rec.observation?.meta?.stdout ?? "")).toContain("GOT=yes");
    expect(JSON.stringify(rec)).not.toContain(RAW);
    expect(rec.trust!.credentialScope?.envNames).toContain("XR_CRED_TOKEN");
    // Revoked after the action.
    expect(h.broker.has(ref.refId)).toBe(false);
    svc.destroy();
  });

  test("high-risk action is BLOCKED when no Tier-2 backend is available (no silent in-process)", async () => {
    const noSandbox = makeTrust([new InProcessBackend(), new RestrictedProcessBackend()]);
    await noSandbox.trust.onInit();
    const svc = makeExecService(noSandbox.trust);
    let ran = false;
    const rec = await svc.service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "code exec", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell" },
      idempotency: "non_idempotent",
      inputSummary: "{}",
      approve: async () => true,
      trust: {
        request: shellRequest({ runsArbitraryCode: true }),
        executable: { argv: ["sh", "-c", "echo hi"], cwd: W, env: {}, timeoutMs: 5000, maxOutputBytes: 1000 },
      },
      run: async () => { ran = true; return { summary: "must not run", transportOk: true }; },
    });
    expect(rec.state).toBe("denied");
    expect(rec.outcome!.error?.code).toBe("TRUST_BLOCKED");
    expect(rec.trust!.decision.kind).toBe("blocked");
    expect(rec.trust!.decision.remediation).toContain("bubblewrap");
    expect(ran).toBe(false);
    svc.destroy();
  });
});
