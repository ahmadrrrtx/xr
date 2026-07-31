/** Retry with same key: non-idempotent → must NOT re-run the effect. */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
import { appendFileSync } from "node:fs";
import { IdempotencyStore } from "../../../src/state/idempotency.ts";
const store = new WorkspaceStore("retry-idem", process.env.XR_DB!);
const idem = new IdempotencyStore(store);
const claim = idem.claim("non-idempotent-effect-1", "external_effect");
if (claim.crashedPending) {
  // effect is non-idempotent → at-most-once: never re-run; require reconciliation
  idem.requireReconciliation("non-idempotent-effect-1", "interrupted; non-idempotent");
  console.log("[retry] refused re-run (reconciliation required)");
} else if (claim.proceed) {
  appendFileSync(process.env.XR_EFFECT_LOG!, "effect\n");
  idem.complete("non-idempotent-effect-1", "done");
  console.log("[retry] re-ran effect");
} else if (claim.requiresReconciliation) {
  console.log("[retry] already requires reconciliation");
}
store.close();
