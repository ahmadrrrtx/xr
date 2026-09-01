/**
 * Test fixture — spawned as a REAL separate process for the F-12 race test.
 * Usage: bun run test/phase2/fixtures/admit.ts <dbPath> <envId> <estUsd>
 * Opens the shared store (its own connection = its own writer), performs one
 * admission, prints the result as JSON, exits 0.
 *
 * Output is written with writeSync(1, …) so it survives process.exit on every
 * platform (async pipe writes can be truncated by exit on Windows).
 */
import { writeSync } from "node:fs";
import { Store } from "../../../src/state/workspace-store.ts";
import { ReservationRepo } from "../../../src/state/repos/reservation-repo.ts";

const [dbPath, envId, estUsdStr] = process.argv.slice(2);
const estUsd = Number(estUsdStr);

function emit(payload: unknown): void {
  writeSync(1, JSON.stringify(payload));
}

const store = new Store(dbPath);
try {
  const repo = new ReservationRepo(store);
  const result = repo.admit(envId, estUsd, Math.round(estUsd * 1000), {
    monthlyCapUsd: 10,
    dailyCapUsd: null,
    taskUsdCap: null,
    taskTokenCap: null,
  });
  emit(result);
} catch (err) {
  emit({ ok: false, reason: String(err) });
} finally {
  store.close();
}
