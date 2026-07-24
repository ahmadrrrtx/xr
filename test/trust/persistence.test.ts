import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
let service: ExecutionService;
let repo: ExecutionRepo;
let W: string;
let destroy: () => void;
const SECRET = `RAWSECRET_${randomUUID().replace(/-/g, "")}`;

beforeAll(async () => {
  h = makeTrust([new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend()]);
  await h.trust.onInit();
  W = mkdtempSync(join(tmpdir(), "xr-trust-persist-"));
  const dir = mkdtempSync(join(tmpdir(), "xr-trust-persist-db-"));
  const db = new Database(join(dir, "test.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const wrapped = adaptWorkspaceStore({ exec: (s: string) => db.exec(s), prepare: (s: string) => db.prepare(s) });
  repo = new ExecutionRepo(wrapped);
  service = new ExecutionService({ repo, trust: h.trust });
  destroy = () => {
    try { db.close(); } catch { /* noop */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  };
});

afterAll(() => {
  destroy?.();
  try { rmSync(W, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("XR 4.2 trust metadata durability", () => {
  test("trust block (tier, decision, verification, cleanup) round-trips through the repo", async () => {
    if (!NS_AVAILABLE) return;
    const hostSecret = join(tmpdir(), `xr-persist-secret-${randomUUID().slice(0, 8)}.txt`);
    writeFileSync(hostSecret, SECRET);
    const request: TrustRequest = {
      capability: { kind: "core_tool", name: "shell" }, actorKind: "user", summary: "persist test",
      spawnsProcess: true, runsArbitraryCode: false, networkTargets: [], fsPaths: [W],
      touchesOutsideWorkspace: false, needsCredentials: false, reversible: false,
      irreversibleExternalWrite: false, untrustedContent: false, dryRun: false, workspaceRoot: W,
    };
    const rec = await service.execute({
      workspaceId: "ws",
      actor: { kind: "user", source: "cli" },
      intent: { summary: "persist", origin: { kind: "user", source: "cli" } },
      capability: { kind: "core_tool", name: "shell" },
      idempotency: "non_idempotent",
      inputSummary: "{}",
      approve: async () => true,
      trust: { request, executable: { argv: ["sh", "-c", `cat ${hostSecret} 2>/dev/null || echo NO_HOST_SECRET`], cwd: W, env: {}, timeoutMs: 30000, maxOutputBytes: 100000 } },
      run: async () => ({ summary: "n/a", transportOk: true }),
    });
    expect(rec.state).toBe("succeeded");

    // Reload from the repository (persisted JSON) and verify trust survived.
    const reloaded = repo.get(rec.id.runId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.trust).toBeDefined();
    expect(reloaded!.trust!.classification.tier).toBe("tier2_isolated");
    expect(reloaded!.trust!.decision.placement).toBe("namespace_sandbox");
    expect(reloaded!.trust!.verification?.verified).toBe(true);
    expect(reloaded!.trust!.cleanup?.state).toBe("succeeded");
    expect(reloaded!.action!.placement.kind).toBe("namespace_sandbox");
    // The host secret never made it into the persisted record.
    expect(JSON.stringify(reloaded)).not.toContain(SECRET);
    rmSync(hostSecret, { force: true });
  });
});
