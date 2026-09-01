/**
 * Test fixture — raises a durable approval and DIES IMMEDIATELY without
 * deciding (simulates kill -9 mid-approval). Prints the approval id as JSON.
 * Usage: bun run test/phase2/fixtures/raise-approval.ts <dbPath> <ttlMs>
 *
 * Output is written with writeSync(1, …) so it survives process.exit on every
 * platform (async pipe writes can be truncated by exit on Windows).
 */
import { writeSync } from "node:fs";
import { Store } from "../../../src/state/workspace-store.ts";
import { ApprovalStore } from "../../../src/control/approval-store.ts";

const [dbPath, ttlStr] = process.argv.slice(2);
const ttlMs = Number(ttlStr) || 60_000;

const store = new Store(dbPath);
const approvals = new ApprovalStore(store, { defaultTtlMs: ttlMs });
const handle = approvals.request({
  tool: "shell",
  reason: "run a command",
  args: { command: "rm -rf /tmp/xr-test" },
  surface: "cli",
  taskId: "task-kill9",
  ttlMs,
});
// Print the id, then exit WITHOUT deciding and WITHOUT closing cleanly —
// the OS reclaims timers/interval, exactly like a killed process.
writeSync(1, JSON.stringify({ id: handle.id }));
process.exit(0);
