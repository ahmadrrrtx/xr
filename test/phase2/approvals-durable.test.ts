/**
 * XR Phase 2 · F-11/M-10 — DURABLE APPROVALS tests.
 *
 *   [Unit]   TTL default-deny on every surface (never stuck)
 *   [Unit]   in-process fast path (decide resolves the waiter)
 *   [Unit]   first-writer-wins (a second decide cannot flip a decision)
 *   [Kill-9] process raises an approval and DIES; after "restart" the record
 *            is resolvable within TTL, else default-denied — never stuck
 *   [Cross]  process A raises + waits; process B decides; A resolves
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ApprovalStore, resetApprovalStores, getApprovalStore } from "../../src/control/approval-store.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p2-ap-"));
  resetApprovalStores();
});

describe("durable approval lifecycle", () => {
  test("TTL default-deny: an unanswered request times out and is DENIED, never stuck", async () => {
    const store = new Store(join(tmp, "t.db"));
    const approvals = new ApprovalStore(store, { defaultTtlMs: 150 });
    const handle = approvals.request({
      tool: "shell",
      reason: "run rm",
      args: { command: "rm -rf x" },
      surface: "cli",
      ttlMs: 150,
    });

    const outcome = await handle.outcome;
    expect(outcome.timedOut).toBe(true);
    expect(outcome.approved).toBe(false);
    expect(outcome.decision).toBe("timed_out");

    const record = approvals.get(handle.id);
    expect(record?.decision).toBe("timed_out");

    const events = store.recentAudit(20).map((e) => e.event);
    expect(events).toContain("approval.requested");
    expect(events).toContain("approval.timed_out");
    store.close();
  });

  test("in-process fast path: decide() resolves the waiter with the decided outcome", async () => {
    const store = new Store(join(tmp, "d.db"));
    const approvals = new ApprovalStore(store, { defaultTtlMs: 30_000 });
    const handle = approvals.request({
      tool: "shell",
      reason: "run npm install",
      surface: "cli",
      ttlMs: 30_000,
    });

    const ok = approvals.decide(handle.id, true, { channel: "cli", userId: "u1" });
    expect(ok).toBe(true);
    const outcome = await handle.outcome;
    expect(outcome.approved).toBe(true);
    expect(outcome.decision).toBe("approved");
    expect(outcome.decidedBy?.channel).toBe("cli");
    expect(approvals.get(handle.id)?.decidedBy?.userId).toBe("u1");
    const events = store.recentAudit(20).map((e) => e.event);
    expect(events).toContain("approval.decided");
    store.close();
  });

  test("deny decision resolves approved:false with decision 'denied'", async () => {
    const store = new Store(join(tmp, "n.db"));
    const approvals = new ApprovalStore(store);
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });
    approvals.decide(handle.id, false, { channel: "cli" });
    const outcome = await handle.outcome;
    expect(outcome.approved).toBe(false);
    expect(outcome.decision).toBe("denied");
    store.close();
  });

  test("first-writer-wins: a second decide on a settled record returns false", async () => {
    const store = new Store(join(tmp, "w.db"));
    const approvals = new ApprovalStore(store);
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });
    expect(approvals.decide(handle.id, true, { channel: "cli" })).toBe(true);
    expect(approvals.decide(handle.id, false, { channel: "daemon" })).toBe(false);
    const outcome = await handle.outcome;
    expect(outcome.approved).toBe(true);
    expect(approvals.get(handle.id)?.decision).toBe("approved");
    store.close();
  });

  test("waitFor re-attaches to a durable pending record (restart re-attach)", async () => {
    const store = new Store(join(tmp, "r.db"));
    const approvals = new ApprovalStore(store, { defaultTtlMs: 30_000 });
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });

    // A "restarted" process: fresh ApprovalStore over the same store, no
    // waiter knowledge — only the durable row.
    const restarted = new ApprovalStore(store, { defaultTtlMs: 30_000 });
    expect(restarted.listPending().map((r) => r.id)).toContain(handle.id);

    const outcomePromise = restarted.waitFor(handle.id);
    expect(restarted.decide(handle.id, true, { channel: "daemon", userId: "d1" })).toBe(true);
    const outcome = await outcomePromise;
    expect(outcome.approved).toBe(true);
    expect(outcome.decidedBy?.channel).toBe("daemon");
    store.close();
  });

  test("the pending list only contains undecided records", async () => {
    const store = new Store(join(tmp, "p.db"));
    const approvals = new ApprovalStore(store);
    const a = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });
    const b = approvals.request({ tool: "shell", reason: "y", surface: "telegram", ttlMs: 30_000 });
    expect(approvals.listPending().length).toBe(2);
    approvals.decide(a.id, true, { channel: "cli" });
    expect(approvals.listPending().map((r) => r.id)).toEqual([b.id]);
    store.close();
  });
});

describe("kill -9 mid-approval (real process death)", () => {
  test("a record raised by a killed process is resolvable after restart", async () => {
    const dbPath = join(tmp, "kill.db");
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", "raise-approval.ts"), dbPath, "60000"],
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });
    const raw = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    const { id } = JSON.parse(raw) as { id: string };

    // "Restart": a fresh process's view of the same durable store.
    const store = new Store(dbPath);
    const approvals = new ApprovalStore(store, { defaultTtlMs: 60_000 });
    const pending = approvals.listPending();
    expect(pending.map((r) => r.id)).toContain(id);

    // Resolvable within TTL…
    const outcomePromise = approvals.waitFor(id);
    expect(approvals.decide(id, true, { channel: "daemon", userId: "operator" })).toBe(true);
    const outcome = await outcomePromise;
    expect(outcome.approved).toBe(true);
    expect(approvals.get(id)?.decidedBy?.channel).toBe("daemon");
    store.close();
  }, 30_000);

  test("an unanswered record past TTL default-denies after restart — never stuck", async () => {
    const dbPath = join(tmp, "kill2.db");
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", "raise-approval.ts"), dbPath, "300"],
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });
    const raw = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    const { id } = JSON.parse(raw) as { id: string };

    await new Promise((r) => setTimeout(r, 500)); // age past the 300ms TTL

    const store = new Store(dbPath);
    const approvals = new ApprovalStore(store);
    // Re-attaching to an expired record resolves DENIED immediately.
    const outcome = await approvals.waitFor(id);
    expect(outcome.approved).toBe(false);
    expect(outcome.timedOut).toBe(true);
    // And the sweep closes the durable record.
    approvals.sweepExpired();
    expect(approvals.get(id)?.decision).toBe("timed_out");
    expect(approvals.listPending()).toHaveLength(0);
    store.close();
  }, 30_000);
});

describe("cross-process approval (CLI task decided by another process)", () => {
  test("process A raises + waits; process B decides; A resolves approved", async () => {
    const dbPath = join(tmp, "cross.db");
    const proc = Bun.spawn({
      // process.execPath (not a bare "bun") so the child spawn resolves the
      // exact same binary on every platform (Windows-safe).
      cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", "raise-and-wait.ts"), dbPath, "30000"],
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });

    // Consume the child's stdout once: the id JSON line first, decide, then
    // the outcome JSON line at the end.
    const decoder = new TextDecoder();
    let id: string | null = null;
    let buf = "";
    let outcomeJson: string | null = null;
    for await (const chunk of proc.stdout as any) {
      buf += decoder.decode(chunk);
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(line) as { id?: string; outcome?: unknown };
          if (parsed.id && id === null) {
            id = parsed.id;
          } else if (parsed.outcome && outcomeJson === null) {
            outcomeJson = line;
          }
        } catch {
          /* ignore partial lines */
        }
      }
      if (id && !outcomeJson) {
        // Decide from THIS process as soon as the id is known.
        const store = new Store(dbPath);
        const approvals = new ApprovalStore(store);
        expect(approvals.decide(id, true, { channel: "daemon", userId: "op-7" })).toBe(true);
        store.close();
      }
    }
    await proc.exited;
    expect(id).toBeTruthy();
    expect(outcomeJson).toBeTruthy();
    const { outcome } = JSON.parse(outcomeJson!) as {
      outcome: { approved: boolean; decision: string; decidedBy?: { channel: string } };
    };
    expect(outcome.approved).toBe(true);
    expect(outcome.decidedBy?.channel).toBe("daemon");
  }, 45_000);
});
