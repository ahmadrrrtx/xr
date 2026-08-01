/**
 * Phase 4 · T1/T3 — CANONICAL-PATH isolation enforcement.
 *
 * Proves, end to end through the real agent loop (`runAgentLoop` — the ACTION
 * phase of the execution envelope):
 *
 *   1. ENFORCEMENT: with a Trust service wired and a namespace sandbox
 *      available, the `shell` tool executes INSIDE the sandbox (audit
 *      `shell.run_isolated`, placement `namespace_sandbox`), and the trust
 *      service records that placement for the run (escalate-only lattice).
 *   2. FAIL-CLOSED: with the sandbox backend absent and hardened mode on, the
 *      same command is BLOCKED — and provably never executed (no marker file).
 *   3. The legacy host-authority fallback is unreachable on the canonical
 *      path when hardened is on.
 *
 * These are EFFECT tests: they assert the real world changed (or provably did
 * not), not state-machine transitions.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../../src/state/workspace-store.ts";
import { AuditRepo } from "../../src/state/repos/audit-repo.ts";
import { runAgentLoop } from "../../src/core/agent.ts";
import type { Message, ModelTurn, Provider, Tool } from "../../src/core/types.ts";
import { shellTool } from "../../src/tools/system.ts";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { TrustService } from "../../src/runtime/trust/service.ts";
import { CredentialBroker } from "../../src/runtime/trust/credentials.ts";
import { AuthorityRegistry } from "../../src/runtime/trust/authority.ts";
import { EnvironmentManager } from "../../src/runtime/trust/environment/manager.ts";
import { InProcessBackend } from "../../src/runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../../src/runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../../src/runtime/trust/environment/namespace.ts";

let tmp: string;
let NS_AVAILABLE = false;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "xr-canonical-isolation-"));
  const ns = new NamespaceSandboxBackend();
  NS_AVAILABLE = await ns.detect();
});

afterAll(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

function scriptedProvider(turns: ModelTurn[]): Provider {
  let i = 0;
  return {
    id: "mock",
    label: "Mock",
    async chat(_m: Message[], _t: Tool[]) {
      return turns[Math.min(i++, turns.length - 1)];
    },
    async health() {
      return { ok: true, latencyMs: 1 };
    },
  };
}

function makeRegistry(): ToolRegistryService {
  const r = new ToolRegistryService();
  r.registerTools({ kind: "core", source: "test", tools: [shellTool] });
  return r;
}

function makeTrust(backends: ConstructorParameters<typeof EnvironmentManager>[0]): TrustService {
  const broker = new CredentialBroker();
  return new TrustService({
    manager: new EnvironmentManager(backends, broker),
    registry: new AuthorityRegistry(),
    broker,
  });
}

/** A command that creates a marker file when executed — the test asserts its
 *  absence to prove a blocked command truly never ran. */
function markerCommand(marker: string): string {
  return `echo isolated > ${JSON.stringify(marker)}; cat ${JSON.stringify(marker)}`;
}

describe("Phase 4 · T1/T3 — canonical-path shell isolation", () => {
  test("a shell call through the real agent loop runs inside the namespace sandbox", async () => {
      if (!NS_AVAILABLE) {
        // Honest skip: this host cannot provide a namespace sandbox (no
        // bubblewrap, no user namespaces). The fail-closed test below still
        // runs everywhere.
        return;
      }
      const cwd = join(tmp, "ws1");
      mkdirSync(cwd, { recursive: true });
      const marker = join(cwd, `marker-${randomUUID().slice(0, 8)}.txt`);
      const store = new Store(join(tmp, "ws1.db"));
      const trust = makeTrust([new InProcessBackend(), new RestrictedProcessBackend(), new NamespaceSandboxBackend()]);
      await trust.ensureReady();

      const turn1: ModelTurn = {
        message: "running shell",
        toolCalls: [{ tool: "shell", args: { cmd: markerCommand(marker) } }],
        done: false,
      };
      const turn2: ModelTurn = { message: "done", toolCalls: [], done: true };
      const deps = {
        provider: scriptedProvider([turn1, turn2]),
        store,
        cwd,
        approve: async () => true,
        say: () => {},
        maxSteps: 4,
        egressAllowlist: [],
        trust,
        hardened: true,
        runId: "canonical-run-1",
        toolRegistry: makeRegistry(),
      };
      const res = await runAgentLoop("write a marker", "agent", deps);

      expect(existsSync(marker)).toBe(true); // the effect happened…
      // …through the SANDBOX, recorded honestly:
      expect(trust.runPlacement("canonical-run-1")).toBe("namespace_sandbox");
      const audit = new AuditRepo(store).recent(50);
      const isolated = audit.find((a) => a.event === "shell.run_isolated");
      expect(isolated).toBeDefined();
      expect((JSON.parse(String(isolated?.detail ?? "{}")) as { placement?: string }).placement).toBe("namespace_sandbox");
    },
  );

  test("hardened mode: no enforceable backend → the command is BLOCKED and provably never runs", async () => {
      const cwd = join(tmp, "ws2");
      mkdirSync(cwd, { recursive: true });
      const marker = join(cwd, `must-not-exist-${randomUUID().slice(0, 8)}.txt`);
      const store = new Store(join(tmp, "ws2.db"));
      // Only in-process + restricted (path-check) backends — NO kernel boundary.
      const trust = makeTrust([new InProcessBackend(), new RestrictedProcessBackend()]);
      await trust.ensureReady();

      const turn1: ModelTurn = {
        message: "running shell",
        toolCalls: [{ tool: "shell", args: { cmd: markerCommand(marker) } }],
        done: false,
      };
      const turn2: ModelTurn = { message: "done", toolCalls: [], done: true };
      const deps = {
        provider: scriptedProvider([turn1, turn2]),
        store,
        cwd,
        approve: async () => true,
        say: () => {},
        maxSteps: 4,
        egressAllowlist: [],
        trust,
        hardened: true,
        runId: "canonical-run-2",
        toolRegistry: makeRegistry(),
      };
      const res = await runAgentLoop("write a marker", "agent", deps);

      expect(existsSync(marker)).toBe(false); // NEVER executed — fail closed
      const audit = new AuditRepo(store).recent(50);
      expect(audit.some((a) => a.event === "shell.isolated_blocked")).toBe(true);
      expect(audit.some((a) => a.event === "shell.run" || a.event === "shell.run_isolated")).toBe(false);
      expect(res.steps).toBeGreaterThanOrEqual(2);
    },
  );

  test("hardened OFF remains the explicit, audited legacy path (compat)", async () => {
      const cwd = join(tmp, "ws3");
      mkdirSync(cwd, { recursive: true });
      const marker = join(cwd, `legacy-${randomUUID().slice(0, 8)}.txt`);
      const store = new Store(join(tmp, "ws3.db"));
      const turn1: ModelTurn = {
        message: "running shell",
        toolCalls: [{ tool: "shell", args: { cmd: markerCommand(marker) } }],
        done: false,
      };
      const turn2: ModelTurn = { message: "done", toolCalls: [], done: true };
      const deps = {
        provider: scriptedProvider([turn1, turn2]),
        store,
        cwd,
        approve: async () => true,
        say: () => {},
        maxSteps: 4,
        egressAllowlist: [],
        // NO trust service wired AND hardened explicitly off → legacy path.
        hardened: false,
        runId: "canonical-run-3",
        toolRegistry: makeRegistry(),
      };
      await runAgentLoop("write a marker", "agent", deps);
      // Legacy path still works but is explicitly opted out of the boundary.
      expect(existsSync(marker)).toBe(true);
    },
  );
});
