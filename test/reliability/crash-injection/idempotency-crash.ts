/** Claim-first: claim slot, run the external effect, crash before complete. */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
import { appendFileSync } from "node:fs";
import { IdempotencyStore } from "../../../src/state/idempotency.ts";
const store = new WorkspaceStore("crash-idem", process.env.XR_DB!);
const idem = new IdempotencyStore(store);
const claim = idem.claim("non-idempotent-effect-1", "external_effect");
if (claim.proceed) {
  // the external effect (e.g. an API call) — non-idempotent
  appendFileSync(process.env.XR_EFFECT_LOG!, "effect\n");
  // crash before idem.complete(...) — simulates kill -9 mid-effect
  process.kill(process.pid, "SIGKILL");
}
store.close();
