/**
 * Test fixture — raises a durable approval and WAITS for a decision that
 * another process must make. Prints the approval id, then the final outcome
 * as JSON. Simulates a CLI task whose consent is answered by the daemon.
 * Usage: bun run test/phase2/fixtures/raise-and-wait.ts <dbPath> <ttlMs>
 */
import { Store } from "../../../src/state/workspace-store.ts";
import { ApprovalStore } from "../../../src/control/approval-store.ts";

const [dbPath, ttlStr] = process.argv.slice(2);
const ttlMs = Number(ttlStr) || 60_000;

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
process.stdout.write(`ID:${handle.id}\n`);

const guard = setTimeout(() => {
  process.stdout.write(JSON.stringify({ outcome: { approved: false, timedOut: true, decision: "timed_out" } }) + "\n");
  process.exit(0);
}, ttlMs + 5000);

handle.outcome
  .then((o) => {
    clearTimeout(guard);
    process.stdout.write(JSON.stringify({ outcome: o }) + "\n");
    store.close();
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(guard);
    process.stdout.write(JSON.stringify({ error: String(err) }) + "\n");
    process.exit(0);
  });
