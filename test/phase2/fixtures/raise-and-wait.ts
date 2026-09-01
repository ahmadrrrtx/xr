/**
 * Test fixture — raises a durable approval and WAITS for a decision that
 * another process must make. Prints the approval id, then the final outcome
 * as JSON. Simulates a CLI task whose consent is answered by the daemon.
 * Usage: bun run test/phase2/fixtures/raise-and-wait.ts <dbPath> <ttlMs>
 *
 * Output is written with writeSync(1, …) so it survives process.exit on every
 * platform (async pipe writes can be truncated by exit on Windows).
 */
import { writeSync } from "node:fs";
import { Store } from "../../../src/state/workspace-store.ts";
import { ApprovalStore } from "../../../src/control/approval-store.ts";

const [dbPath, ttlStr] = process.argv.slice(2);
const ttlMs = Number(ttlStr) || 60_000;

function emitLine(payload: unknown): void {
  writeSync(1, JSON.stringify(payload) + "\n");
}

const store = new Store(dbPath);
const approvals = new ApprovalStore(store, { defaultTtlMs: ttlMs });
const handle = approvals.request({
  tool: "shell",
  reason: "install a package",
  args: { command: "npm i -g xr-test" },
  surface: "cli",
  taskId: "task-cross",
  ttlMs,
});
emitLine({ id: handle.id });

const guard = setTimeout(() => {
  emitLine({ outcome: { approved: false, timedOut: true, decision: "timed_out" } });
  process.exit(0);
}, ttlMs + 5000);

handle.outcome
  .then((o) => {
    clearTimeout(guard);
    emitLine({ outcome: o });
    store.close();
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(guard);
    emitLine({ error: String(err) });
    process.exit(0);
  });
