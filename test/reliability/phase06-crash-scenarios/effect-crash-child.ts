/**
 * XR Phase 06 · Steps 20/26/52 — crash-injection CHILD process.
 *
 * Runs a real ExecutionService execution against a real SQLite workspace DB
 * and SIGKILLs itself at a deterministic crash point:
 *
 *   XR_CRASH=before_effect  → die BEFORE the side effect runs
 *   XR_CRASH=after_effect   → die AFTER the side effect, before slot
 *                             settlement / record finalization
 *   XR_CRASH=none           → complete normally (control case)
 *
 * The effect is controlled by XR_EFFECT_KIND:
 *   append → append a marker line to XR_EFFECT_FILE (NON-idempotent shape)
 *   write  → overwrite XR_EFFECT_FILE with fixed content (keyed-idempotent)
 *
 * Env: XR_DB, XR_EFFECT_FILE, XR_EFFECT_KIND, XR_CRASH, XR_KEY,
 *      XR_IDEMPOTENCY (non_idempotent | idempotent_with_key), XR_WORKSPACE.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
import { IdempotencyStore } from "../../../src/state/idempotency.ts";
import { ExecutionRepo, adaptWorkspaceStore } from "../../../src/execution/repository.ts";
import { ExecutionService } from "../../../src/execution/service.ts";
import type { ExecuteOptions, IdempotencyClass } from "../../../src/execution/types.ts";

const dbPath = process.env.XR_DB!;
const effectFile = process.env.XR_EFFECT_FILE!;
const effectKind = process.env.XR_EFFECT_KIND ?? "append";
const crashPoint = process.env.XR_CRASH ?? "none";
const key = process.env.XR_KEY ?? "ck_crash_key";
const idempotency = (process.env.XR_IDEMPOTENCY ?? "non_idempotent") as IdempotencyClass;
const workspaceId = process.env.XR_WORKSPACE ?? "ws-crash";

const store = new WorkspaceStore("crash-child", dbPath);
const repo = new ExecutionRepo(adaptWorkspaceStore(store));
const idem = new IdempotencyStore(store);
const service = new ExecutionService({ repo, idempotency: idem });

function performEffect(): void {
  if (effectKind === "append") {
    appendFileSync(effectFile, `effect-at-${Date.now()}\n`);
  } else {
    writeFileSync(effectFile, "convergent-content-v1");
  }
}

const opts: ExecuteOptions = {
  workspaceId,
  runId: "ex_crash_child",
  actor: { kind: "user", source: "cli" },
  intent: { summary: "crash-injected effect", origin: { kind: "user", source: "cli" } },
  capability: { kind: "core_tool", name: effectKind === "append" ? "external_append" : "write_file" },
  placement: { kind: "in_process" },
  idempotency,
  idempotencyKey: key,
  inputSummary: "crash test",
  run: async () => {
    if (crashPoint === "before_effect") {
      console.log("[crash-point]");
      process.kill(process.pid, "SIGKILL"); // die BEFORE the side effect
    }
    performEffect(); // the side effect
    if (crashPoint === "after_effect") {
      console.log("[crash-point]");
      process.kill(process.pid, "SIGKILL"); // die AFTER effect, before settlement
    }
    return { summary: "effect done", transportOk: true };
  },
} as ExecuteOptions;

console.log("[ready]");
service
  .execute(opts)
  .then((rec) => {
    console.log(`[done] state=${rec.state} outcome=${rec.outcome?.kind}`);
    store.close();
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[error] ${(e as Error).message}`);
    try {
      store.close();
    } catch {
      /* noop */
    }
    process.exit(1);
  });
