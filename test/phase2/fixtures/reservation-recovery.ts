/**
 * Test fixture — verifies the STARTUP RECOVERY sweep in a fresh process.
 * Usage: bun run test/phase2/fixtures/reservation-recovery.ts <dbPath>
 *
 * The parent process must have seeded a reservation with age > the TTL given
 * via XR_RESERVATION_TTL_MS (set in this process's env BEFORE the store
 * module is imported). On open, the store constructor sweeps uncommitted
 * reservations older than the TTL; this fixture prints the active totals
 * AFTER open (post-sweep) and then attempts a fresh admission.
 */
import { writeSync } from "node:fs";
import { Store } from "../../../src/state/workspace-store.ts";
import { ReservationRepo } from "../../../src/state/repos/reservation-repo.ts";

const [dbPath] = process.argv.slice(2);
const store = new Store(dbPath);
const repo = new ReservationRepo(store);
const totalsAfterOpen = repo.activeTotals();
const admit = repo.admit("recovery-task", 1.0, 1000, {
  monthlyCapUsd: 10,
  dailyCapUsd: null,
  taskUsdCap: null,
  taskTokenCap: null,
});
writeSync(1, JSON.stringify({ totalsAfterOpen, admitOk: admit.ok }));
store.close();
