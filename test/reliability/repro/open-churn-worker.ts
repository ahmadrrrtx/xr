/**
 * Open-churn worker (CF-1 regression): opens the DB, writes ONE audit entry,
 * and closes — in a loop. This stresses the connection-OPEN path (where the
 * raw `database is locked` escape occurred: `openDatabase`'s WAL PRAGMA under
 * a contended writer), which the 50-writes-per-connection stress test does not
 * isolate. Emits { written, errors[] } on stdout.
 */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";

const dbPath = process.argv[2]!;
const cycles = Number(process.argv[3] ?? 30);
const tag = process.argv[4] ?? "c";

const errors: string[] = [];
let written = 0;

for (let i = 0; i < cycles; i++) {
  let store: WorkspaceStore | null = null;
  try {
    store = new WorkspaceStore(`churn-${tag}`, dbPath);
    store.audit(`churn.write.${tag}`, { i, writer: tag });
    written++;
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
  } finally {
    try {
      store?.close();
    } catch {
      /* ignore */
    }
  }
}

console.log(JSON.stringify({ written, errors }));
