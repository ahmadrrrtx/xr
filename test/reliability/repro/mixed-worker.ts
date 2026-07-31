/**
 * Mixed-workload stress worker: opens its own connection to the shared DB and
 * performs a sequence of trust-critical writes (audit + session + step +
 * workflow + memory + cost), mirroring what parallel `xr` invocations do.
 * Emits { written, errors[] } on stdout.
 */
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";

const dbPath = process.argv[2]!;
const count = Number(process.argv[3] ?? 30);
const tag = process.argv[4] ?? "m";

let store: WorkspaceStore | null = null;
const errors: string[] = [];
let written = 0;

function open(): WorkspaceStore {
  if (!store) store = new WorkspaceStore(`mixed-${tag}`, dbPath);
  return store;
}

function closeStore(): void {
  const s = store;
  if (s) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
    store = null;
  }
}

for (let i = 0; i < count; i++) {
  try {
    const s = open();
    const sessionId = `s_${tag}_${i}`;
    s.createSession(sessionId, `stress ${tag} ${i}`, "chat");
    s.audit("stress.session", { i, tag }, sessionId);
    s.addStep(`st_${tag}_${i}`, sessionId, 0, "tool", "test", { i });
    s.saveWorkflow({
      workflowId: `wf_${tag}_${i}`,
      kind: "single",
      goal: `stress ${i}`,
      status: "completed",
      reviewState: "not_required",
      approvalState: "not_required",
      cancellationState: "none",
      planSummary: "stress",
      tasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    s.remember(`m_${tag}_${i}`, "stress", "fact", `content ${i}`);
    s.recordCost(sessionId, "stress", "model", 1, 2, 0.001);
    written += 5;
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
    closeStore();
  }
}

closeStore();

console.log(JSON.stringify({ written, errors }));
