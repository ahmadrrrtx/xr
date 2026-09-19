/**
 * XR — the store's close() is real: no zombie connection, no open handles.
 *
 * Background (Windows parity lane, 2026-09-19): five segments failed on
 * `rmSync(tmp)` right after `store.close()` with EBUSY. `sqlite3_close()`
 * refuses while any statement is un-finalized and Bun leaves the connection
 * open as a zombie until GC. `Database.query()` caches only 20 statements and
 * finalizes only those on close; the store runs far more than 20 distinct
 * queries per session. Measured: 20 distinct query strings → clean close;
 * 21 → "database is locked" and db/-wal/-shm stay open. The gate now tracks
 * every statement it hands out and finalizes them before the close.
 *
 * On Linux this file proves the handle is gone via /proc/self/fd; on every OS
 * it proves the gate's own accounting and — the Windows-relevant part — that
 * the directory can be deleted immediately after close.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";

function openFdsUnder(dir: string): string[] {
  if (process.platform !== "linux") return [];
  const out: string[] = [];
  for (const fd of readdirSync("/proc/self/fd")) {
    try {
      const target = readlinkSync(`/proc/self/fd/${fd}`);
      if (target.startsWith(dir)) out.push(target);
    } catch {
      /* fd vanished between readdir and readlink */
    }
  }
  return out;
}

type GateSeam = { gate: { liveStatementCount: number } };

describe("WorkspaceStore.close() releases the file", () => {
  test("after more than 20 distinct queries (past Bun's query cache) close is still real", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-close-"));
    const dbPath = join(dir, "xr.db");
    const connectionsBefore = WorkspaceStore.connectionCount(); // other files in this process may hold stores
    const store = new WorkspaceStore("close-test", dbPath);
    try {
      // Real traffic first (audit + session + cost paths), then 40 distinct
      // read statements through the gated connection — the shape that
      // overflows Bun's 20-entry cache in any real session.
      store.audit("close.test", { n: 1 });
      for (let i = 0; i < 40; i++) {
        store.query(`SELECT id, event, ${i} AS tag FROM audit_log ORDER BY id DESC LIMIT 5`).all();
      }
      store.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get();
      const gate = (store as unknown as GateSeam).gate;
      const liveBeforeClose = gate.liveStatementCount;

      store.close();

      expect(openFdsUnder(dir)).toEqual([]); // Linux: the kernel agrees (pre-fix: db, -wal, -shm still open)
      expect(liveBeforeClose).toBeGreaterThan(20); // the scenario was real, not a no-op
      expect(gate.liveStatementCount).toBe(0);
      expect(WorkspaceStore.lastCloseError).toBeNull(); // strict sqlite3_close succeeded
      expect(WorkspaceStore.connectionCount()).toBe(connectionsBefore);
    } finally {
      // Windows: this is the assertion that used to fail with EBUSY.
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dbPath)).toBe(false);
  });

  test("a second instance on the same file keeps the connection open until the LAST close", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-close2-"));
    const dbPath = join(dir, "xr.db");
    const connectionsBefore = WorkspaceStore.connectionCount();
    const a = new WorkspaceStore("close-test", dbPath);
    const b = new WorkspaceStore("close-test", dbPath);
    try {
      for (let i = 0; i < 25; i++) a.query(`SELECT ${i} AS tag FROM audit_log LIMIT 1`).all();
      a.close();
      // b still holds the shared connection — that is the refcount contract.
      expect(WorkspaceStore.connectionCount()).toBe(connectionsBefore + 1);
      if (process.platform === "linux") expect(openFdsUnder(dir).length).toBeGreaterThan(0);
      b.audit("close.test", { still: "open" });
      b.close();
      expect(WorkspaceStore.connectionCount()).toBe(connectionsBefore);
      expect(WorkspaceStore.lastCloseError).toBeNull();
      expect(openFdsUnder(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
