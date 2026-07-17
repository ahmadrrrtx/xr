/**
 * XR — Kernel bootstrap fixture (executed as a CHILD PROCESS by
 * test/core/kernel.test.ts).
 *
 * Why a subprocess? config.ts/workspace.ts bind XR_HOME at module load. A
 * dedicated process with XR_HOME pre-set gives a fully hermetic kernel boot
 * — no shared module cache, no writes to the developer's real ~/.xr.
 *
 * Protocol: prints "CHECK <name>" per passed assertion; exits non-zero with
 * "FAIL <name>: <err>" on the first failure; finishes with "ALL CHECKS PASSED".
 */

import { existsSync } from "node:fs";

// Type-only aliases: `import type` is fully erased at compile time, so these
// carry no module-load side effects (XR_HOME binding stays hermetic). The
// runtime VALUES below come from dynamic `await import()` — destructured
// dynamic imports lose the class's type meaning, hence the aliases.
import type { WorkspaceStore as WorkspaceStoreT } from "../../../src/state/workspace-store.ts";
import type { AuditRepo as AuditRepoT } from "../../../src/state/repos/audit-repo.ts";

if (!process.env.XR_HOME) {
  console.error("FAIL env: XR_HOME must be set by the parent test");
  process.exit(1);
}

function check(name: string, condition: boolean, detail = ""): void {
  if (!condition) {
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
    process.exit(1);
  }
  console.log(`CHECK ${name}`);
}

// Static imports are safe: the parent already pinned XR_HOME for this process.
const { XRKernel } = await import("../../../src/core/kernel.ts");
const { WorkspaceStore } = await import("../../../src/state/workspace-store.ts");
const { CORE_VERSION, PKG } = await import("../../../src/core/version.ts");
const { SessionRepo } = await import("../../../src/state/repos/session-repo.ts");
const { AuditRepo } = await import("../../../src/state/repos/audit-repo.ts");
const { XRShieldService } = await import("../../../src/security/shield.ts");

const events: string[] = [];
const kernel = new XRKernel();
kernel.events.on("kernel.bootstrapped", () => { events.push("kernel.bootstrapped"); });
kernel.events.on("workspace.switching", () => { events.push("workspace.switching"); });
kernel.events.on("workspace.switched", () => { events.push("workspace.switched"); });
kernel.events.on("kernel.stopped", () => { events.push("kernel.stopped"); });

// ── Identity (0.1): single source of truth ──────────────────────────────────
check("kernel-version-unified", XRKernel.CORE_VERSION === CORE_VERSION && CORE_VERSION === PKG.version);
check("kernel-db-under-xr-home", (process.env.XR_HOME ?? "").length > 0);

// ── Bootstrap (0.2 + 0.6) ───────────────────────────────────────────────────
await kernel.bootstrap();

check("bootstrap-event-emitted", events.includes("kernel.bootstrapped"));

const store = kernel.container.resolve<WorkspaceStoreT>("store");
check("store-is-workspace-store", store instanceof WorkspaceStore);
check("store-path-inside-xr-home", store.dbPath.startsWith(process.env.XR_HOME!));
check("legacy-alias-is-same-instance", kernel.container.resolve<WorkspaceStoreT>("legacyStore") === store);

// Core service wiring (0.6 DI): every id the kernel promises.
for (const id of [
  "kernel", "container", "events", "commands", "lifecycle", "workspaces", "services",
  "config", "providers", "budget", "plugins", "mcp", "skills", "agent", "multiAgents",
  "shield", "business",
  "sessionStore", "auditStore", "costStore", "userMemoryStore", "skillStore", "workflowStore",
]) {
  let ok = true;
  try {
    kernel.container.resolve(id);
  } catch {
    ok = false;
  }
  check(`service-registered:${id}`, ok);
}

check("shield-rides-unified-store", kernel.container.resolve("shield") instanceof XRShieldService);
check("repos-are-views-over-one-store", kernel.container.resolve("sessionStore") instanceof SessionRepo
  && kernel.container.resolve("auditStore") instanceof AuditRepo);
check("single-connection", WorkspaceStore.connectionCount() === 1);

// Repos write through the SAME unified connection.
store.createSession("k1", "kernel-test", "chat");
kernel.container.resolve<AuditRepoT>("auditStore").audit("kernel.test", { ok: true }, "k1");
check("repo-writes-share-connection", store.recentSessions().some((s) => s.id === "k1")
  && store.recentAudit().some((a) => a.event === "kernel.test"));
check("audit-chain-intact", store.verifyChain().valid);

// ── Workspace switch (0.2): clean hand-off to a fresh single store ──────────
const oldStore = store;
await kernel.switchWorkspace("qa");

const newStore = kernel.container.resolve<WorkspaceStoreT>("store");
check("switch-emits-events", events.includes("workspace.switching") && events.includes("workspace.switched"));
check("switch-installs-new-store", newStore !== oldStore);
check("switch-keeps-legacy-alias", kernel.container.resolve<WorkspaceStoreT>("legacyStore") === newStore);
check("switch-fresh-db-is-empty", newStore.recentSessions().length === 0 && newStore.auditCount() === 0);
check("switch-db-path-scoped", newStore.dbPath.includes("workspaces") && newStore.dbPath.includes("qa"));
check("old-store-closed-single-connection", WorkspaceStore.connectionCount() === 1);
check("repos-rebound-after-switch", kernel.container.resolve("auditStore") instanceof AuditRepo);

// New workspace is isolated: the write lands in the fresh store (the old
// store is closed by design; touching it would throw — that IS the contract).
newStore.createSession("q1", "switched", "chat");
const sessions = newStore.recentSessions();
check("switched-writes-isolated", sessions.length === 1 && sessions[0]?.id === "q1");
check("switch-db-on-disk", existsSync(newStore.dbPath));

// ── Shutdown ────────────────────────────────────────────────────────────────
await kernel.shutdown();
check("stopped-event-emitted", events.includes("kernel.stopped"));
check("shutdown-closes-store", WorkspaceStore.connectionCount() === 0);

console.log("ALL CHECKS PASSED");
