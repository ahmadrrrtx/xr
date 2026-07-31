/**
 * Worker: open the DB at `argv[2]`, write `argv[3]` audit entries, and emit a
 * JSON line { written, errors[] } on stdout. Any "database is locked"/busy
 * error is captured, not fatal.
 */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";

const dbPath = process.argv[2]!;
const count = Number(process.argv[3] ?? 50);
const tag = process.argv[4] ?? "w";

let store: WorkspaceStore | null = null;
const errors: string[] = [];
let written = 0;

for (let i = 0; i < count; i++) {
  try {
    store ??= new WorkspaceStore(`repro-${tag}`, dbPath);
    store.audit(`repro.write.${tag}`, { i, writer: tag });
    written++;
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
    // After a lock failure, drop the connection so the next attempt is clean.
    try {
      store?.close();
    } catch {
      /* ignore */
    }
    store = null;
  }
}

try {
  store?.close();
} catch {
  /* ignore */
}

console.log(JSON.stringify({ written, errors }));
