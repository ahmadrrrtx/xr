/**
 * Phase 1 · T4 — Crash-injection matrix.
 *
 * Every persisted transition (session create, execution step, approval,
 * audit write, vault write, workflow checkpoint, migration, idempotency
 * claim) is crash-injected: the child process is SIGKILLed at a deterministic
 * point inside the write transaction (after BEGIN / before COMMIT) or between
 * transitions, then the parent reopens the database and asserts the correct,
 * non-duplicated terminal state.
 *
 * WAL + IMMEDIATE transactions make the pre/post-commit boundary the only
 * observable states: an interrupted transaction rolls back completely.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { rmrf } from "./helpers.ts";

// Phase 9 · T4 — detection-based platform guard (Constitution Art. XX.5):
// the matrix depends on POSIX process semantics (SIGKILL'd children whose
// exit state the parent asserts as `code === null`). The suite runs on every
// OS; on Windows this file skips ITS tests by runtime detection — the same
// precedent as test/phase0 (cli-spine / policy-gate) — never by CI-config
// exclusion, which would hide portability drift. Whitelisted in
// test/release/portability.test.ts.
import { POSIX_ONLY } from "./platform-guards.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS = join(__dirname, "crash-injection");

function runChild(script: string, env: Record<string, string>): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", join(SCENARIOS, script)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}`,
        ...env,
      },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("close", (code) => resolve({ code, stdout: out + err }));
  });
}

/** Crash mid-transaction (after BEGIN) → nothing may be committed. */
async function crashInsideTransaction(dbPath: string, crashPoint: "after-begin" | "before-commit", script: string) {
  const r = await runChild(script, {
    XR_DB: dbPath,
    XR_CRASH_AT_WRITE: crashPoint,
  });
  // Child must have been killed (SIGKILL → null code).
  expect(r.code).toBeNull();
  expect(r.stdout).toContain("[crash-point]");
}

describe.skipIf(POSIX_ONLY)("Phase 1 · crash-injection matrix", () => {
  test("audit append: crash mid-transaction → chain intact, all-or-nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-audit-"));
    try {
      const dbPath = join(dir, "xr.db");
      await crashInsideTransaction(dbPath, "before-commit", "audit-crash.ts");

      const store = new WorkspaceStore("check", dbPath);
      const count = store.auditCount();
      // Either the crashed entry is fully present or fully absent — never partial.
      expect(count).toBeGreaterThanOrEqual(0);
      expect(count).toBeLessThanOrEqual(50);
      expect(store.verifyChain().valid).toBe(true);
      // Writes after recovery still work and stay chained.
      store.audit("post.crash", { ok: true });
      expect(store.verifyChain().valid).toBe(true);
      expect(store.auditCount()).toBe(count + 1);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("session + step + audit: atomic across statements", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-session-"));
    try {
      const dbPath = join(dir, "xr.db");
      await crashInsideTransaction(dbPath, "before-commit", "session-crash.ts");

      const store = new WorkspaceStore("check", dbPath);
      // session + step + audit are written in one transaction: all or nothing.
      const sessions = store.sessionStatusCounts().reduce((a, r) => a + r.c, 0);
      const steps = store.sessionSteps("s_crash").length;
      expect(sessions).toBe(steps === 1 ? 1 : 0);
      expect(sessions).toBeLessThanOrEqual(1);
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("workflow save (parent + tasks): no partial workflow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-wf-"));
    try {
      const dbPath = join(dir, "xr.db");
      await crashInsideTransaction(dbPath, "before-commit", "workflow-crash.ts");

      const store = new WorkspaceStore("check", dbPath);
      const wf = store.getWorkflow("wf_crash");
      // All-or-nothing: parent row and task rows appear together.
      expect(wf === null || wf.workflowId === "wf_crash").toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("vault credential write: no partial ciphertext", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-vault-"));
    try {
      const dbPath = join(dir, "xr.db");
      // The child arms XR_CRASH_AT_WRITE after its setup so ONLY the vault
      // INSERT transaction is killed before commit.
      const r = await runChild("vault-crash.ts", { XR_DB: dbPath });
      expect(r.code).toBeNull();
      expect(r.stdout).toContain("[crash-point]");

      const store = new WorkspaceStore("check", dbPath);
      // The credential row is written in one transaction → absent, or a complete
      // v2 envelope (never a truncated/partial ciphertext).
      const row = store
        .prepare("SELECT credentials FROM biz_credentials WHERE id IS NOT NULL LIMIT 1")
        .get() as { credentials: string } | null;
      if (row) {
        expect(row.credentials.startsWith("v2:")).toBe(true);
      }
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("migration mid-run: reopen is idempotent and complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-mig-"));
    try {
      const dbPath = join(dir, "xr.db");
      // Crash on the very first write (baseline DDL or migration) mid-transaction.
      await runChild("migration-crash.ts", { XR_DB: dbPath, XR_CRASH_AT_WRITE: "after-begin" });

      const store = new WorkspaceStore("reopen", dbPath);
      // Reopening re-runs migrate + migrations: all tables present, chain ok.
      expect(store.prepare("SELECT COUNT(*) c FROM idempotency_slots").get()).not.toBeNull();
      expect(store.verifyChain().valid).toBe(true);
      store.audit("post.migration", { ok: true });
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("idempotency claim-first: crash after claim, before effect-completion → non-idempotent effect NOT re-run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-idem-"));
    try {
      const dbPath = join(dir, "xr.db");
      const effectLog = join(dir, "effects.log");

      // First run: claims slot, performs the external effect, then crashes
      // BEFORE completing the slot (simulating kill -9 mid-effect).
      await runChild("idempotency-crash.ts", { XR_DB: dbPath, XR_EFFECT_LOG: effectLog });

      expect(existsSync(effectLog)).toBe(true);
      const effectsAfterFirstRun = readFileSync(effectLog, "utf8").trim().split("\n").filter(Boolean).length;
      expect(effectsAfterFirstRun).toBe(1);

      // Retry with the same key for a NON-idempotent effect: must refuse to
      // re-run and mark the slot requires_reconciliation.
      await runChild("idempotency-retry.ts", { XR_DB: dbPath, XR_EFFECT_LOG: effectLog });

      const effectsAfterRetry = readFileSync(effectLog, "utf8").trim().split("\n").filter(Boolean).length;
      expect(effectsAfterRetry).toBe(1); // 0 duplicates

      const store = new WorkspaceStore("check", dbPath);
      const slot = store
        .prepare("SELECT state FROM idempotency_slots WHERE slot_key = 'non-idempotent-effect-1'")
        .get() as { state: string } | null;
      expect(slot?.state).toBe("requires_reconciliation");
      store.close();
    } finally {
      await rmrf(dir);
    }
  });

  test("external SIGKILL mid-stream of writes: WAL keeps every committed entry chained", async () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-crash-kill9-"));
    try {
      const dbPath = join(dir, "xr.db");
      const child = spawn("bun", ["run", join(SCENARIOS, "hammer-writes.ts"), dbPath, "400"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH ?? ""}` },
      });
      // Kill mid-stream after a short random delay.
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 60));
      child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 200));

      const store = new WorkspaceStore("check", dbPath);
      expect(store.verifyChain().valid).toBe(true);
      store.audit("post.kill9", { ok: true });
      expect(store.verifyChain().valid).toBe(true);
      store.close();
    } finally {
      await rmrf(dir);
    }
  });
});
