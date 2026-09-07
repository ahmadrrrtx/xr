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
    approvals.dispose(); // zero live timers at test end (see header note)
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
    approvals.dispose(); // zero live timers at test end (see header note)
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
    approvals.dispose(); // zero live timers at test end (see header note)
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
    approvals.dispose(); // zero live timers at test end (see header note)
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
    // BOTH instances: the original request's poller only settles on its own
    // next tick after the row is decided — dispose instead of relying on it.
    restarted.dispose();
    approvals.dispose();
    store.close();
  });

  test("expire / sweep / decide after store.close() do not throw", () => {
    const store = new Store(join(tmp, "closed.db"));
    const approvals = new ApprovalStore(store, { defaultTtlMs: 30_000 });
    const handle = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });
    store.close();
    expect(approvals.expire(handle.id)).toBe(false);
    expect(approvals.sweepExpired()).toBe(0);
    expect(approvals.decide(handle.id, true, { channel: "cli" })).toBe(false);
    expect(approvals.listPending()).toEqual([]);
    expect(approvals.get(handle.id)).toBeNull();
    approvals.dispose();
  });

  test("the pending list only contains undecided records", async () => {
    const store = new Store(join(tmp, "p.db"));
    const approvals = new ApprovalStore(store);
    const a = approvals.request({ tool: "shell", reason: "x", surface: "cli", ttlMs: 30_000 });
    const b = approvals.request({ tool: "shell", reason: "y", surface: "telegram", ttlMs: 30_000 });
    expect(approvals.listPending().length).toBe(2);
    approvals.decide(a.id, true, { channel: "cli" });
    expect(approvals.listPending().map((r) => r.id)).toEqual([b.id]);
    // `b` is still pending: its poller + TTL timer are LIVE. On Windows this
    // left the bun test process unable to exit (exit-124 class, 2026-09-07).
    approvals.dispose();
    store.close();
  });
});

// Windows CI history (2026-09-07, Windows full-parity lane, runs
// 34152171256 / 34156612385 / job 101865773607): this file died at the
// segment cap with zero output and zero test failures ("dies alone",
// exit 124) — the process never finished, so no results were flushed.
// Two contributing causes, in order of evidence:
//   1. Live timers at file end. This is the only file in its suite
//      segment that creates setInterval (ApprovalStore cross-process
//      pollers); a pending record left behind (e.g. the last
//      in-process test) kept a 150ms poller + 30s TTL timer live, and
//      on Windows bun 1.3.14 the process would not exit. Every test now
//      calls approvals.dispose() so the file ends with ZERO live
//      timers — do not remove those without re-running the Windows lane.
//   2. Child stdout pipes (spawn tests): unverified on Windows — the
//      runs above died before spawn-test behavior could be observed.
//      They remain skipIf(win32) until re-enabled with evidence (a
//      passing Windows run).
// Registered in docs/security/KNOWN_LIMITATIONS.md (#21).
const WIN32_CI_HANG = process.platform === "win32";

describe.skipIf(WIN32_CI_HANG)("kill -9 mid-approval (real process death)", () => {
  /**
   * Windows hang guard (same failure class as the cross-process test below):
   * `new Response(proc.stdout).text()` only settles when the child CLOSES
   * its stdout; on Windows a pipe lingering past process.exit (or a wedged
   * child) hangs the await forever — Bun's per-test timeout cannot
   * interrupt a pending stream await, so this file rides to the runner cap
   * and dies as exit 124 naming no assertion. Bound the child's lifetime
   * independently so a wedge fails fast with a readable error.
   */
  async function readChildStdoutWithWatchdog(proc: Bun.Subprocess, ms: number): Promise<string> {
    const watchdog = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, ms);
    // Callers always spawn with stdout: "pipe" — the base Subprocess type
    // cannot express that, so narrow to the stream.
    const stream = proc.stdout as ReadableStream<Uint8Array>;
    try {
      return (await new Response(stream).text()).trim();
    } finally {
      clearTimeout(watchdog);
    }
  }

  test("a record raised by a killed process is resolvable after restart", async () => {
    const dbPath = join(tmp, "kill.db");
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", join(import.meta.dir, "fixtures", "raise-approval.ts"), dbPath, "60000"],
      stdout: "pipe",
      stderr: "inherit",
      env: { ...process.env },
    });
    const raw = await readChildStdoutWithWatchdog(proc, 20_000);
    await proc.exited;
    let id: string | undefined;
    try {
      id = (JSON.parse(raw) as { id?: string }).id;
    } catch {
      /* asserted below */
    }
    expect(
      id,
      `child stdout was not a single approval-id JSON line (wedge?): ${JSON.stringify(raw.slice(0, 80))}`,
    ).toBeTruthy();
    const approvalId: string = id!; // expect above guarantees truthiness

    // "Restart": a fresh process's view of the same durable store.
    const store = new Store(dbPath);
    const approvals = new ApprovalStore(store, { defaultTtlMs: 60_000 });
    const pending = approvals.listPending();
    expect(pending.map((r) => r.id)).toContain(approvalId);

    // Resolvable within TTL…
    const outcomePromise = approvals.waitFor(approvalId);
    expect(approvals.decide(approvalId, true, { channel: "daemon", userId: "operator" })).toBe(true);
    const outcome = await outcomePromise;
    expect(outcome.approved).toBe(true);
    expect(approvals.get(approvalId)?.decidedBy?.channel).toBe("daemon");
    approvals.dispose(); // zero live timers at test end (see header note)
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
    const raw = await readChildStdoutWithWatchdog(proc, 20_000);
    await proc.exited;
    let id: string | undefined;
    try {
      id = (JSON.parse(raw) as { id?: string }).id;
    } catch {
      /* asserted below */
    }
    expect(
      id,
      `child stdout was not a single approval-id JSON line (wedge?): ${JSON.stringify(raw.slice(0, 80))}`,
    ).toBeTruthy();

    const approvalId: string = id!; // expect above guarantees truthiness

    await new Promise((r) => setTimeout(r, 500)); // age past the 300ms TTL

    const store = new Store(dbPath);
    const approvals = new ApprovalStore(store);
    // Re-attaching to an expired record resolves DENIED immediately.
    const outcome = await approvals.waitFor(approvalId);
    expect(outcome.approved).toBe(false);
    expect(outcome.timedOut).toBe(true);
    // And the sweep closes the durable record.
    approvals.sweepExpired();
    expect(approvals.get(approvalId)?.decision).toBe("timed_out");
    expect(approvals.listPending()).toHaveLength(0);
    approvals.dispose(); // zero live timers at test end (see header note)
    store.close();
  }, 30_000);
});

describe.skipIf(WIN32_CI_HANG)("cross-process approval (CLI task decided by another process)", () => {
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
    // Windows hang guard: `for await (… of proc.stdout)` only ends when the
    // child closes its stdout. If the child wedges, the iterator never settles,
    // and Bun's per-test timeout cannot interrupt a pending await — the whole
    // segment rides to the 420s runner cap and dies as exit 124 ("crash
    // class"), naming no assertion. That is exactly how this file took down the
    // Windows lane. Bound the child's lifetime independently so a wedge fails
    // this test in seconds with a readable message.
    const watchdog = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
    }, 40_000);
    const decoder = new TextDecoder();
    let id: string | null = null;
    let buf = "";
    let outcomeJson: string | null = null;
    try {
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
    } finally {
      clearTimeout(watchdog);
    }
    await proc.exited;
    expect(id, "child never emitted an approval id (killed by watchdog?)").toBeTruthy();
    expect(outcomeJson, "child never emitted an outcome line — killed by the 40s watchdog").toBeTruthy();
    const { outcome } = JSON.parse(outcomeJson!) as {
      outcome: { approved: boolean; decision: string; decidedBy?: { channel: string } };
    };
    expect(outcome.approved).toBe(true);
    expect(outcome.decidedBy?.channel).toBe("daemon");
  }, 45_000);
});
