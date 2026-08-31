/**
 * Test fixture — spawned as a REAL separate process for the F-12 race test.
 * Usage: bun run test/phase2/fixtures/admit.ts <dbPath> <envId> <estUsd>
 * Opens the shared store (its own connection = its own writer), performs one
 * admission, prints the result as JSON, exits 0.
 */
import { Store } from "../../../src/state/workspace-store.ts";
import { ReservationRepo } from "../../../src/state/repos/reservation-repo.ts";

const [dbPath, envId, estUsdStr] = process.argv.slice(2);
const estUsd = Number(estUsdStr);

const store = new Store(dbPath);
try {
  const repo = new ReservationRepo(store);
  const result = repo.admit(envId, estUsd, Math.round(estUsd * 1000), {
    monthlyCapUsd: 10,
    dailyCapUsd: null,
    taskUsdCap: null,
    taskTokenCap: null,
  });
  process.stdout.write(JSON.stringify(result));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, reason: String(err) }));
} finally {
  store.close();
}
