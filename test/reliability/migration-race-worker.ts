/**
 * Migration-race worker: opens a brand-new DB (running the constructor +
 * migration path) and writes audit entries, mirroring a CLI process booting
 * against a fresh XR_HOME while other processes do the same.
 */
import { WorkspaceStore } from "../../src/state/workspace-store.ts";

const dbPath = process.argv[2]!;
const count = Number(process.argv[3] ?? 20);
const tag = process.argv[4] ?? "m";

let store: WorkspaceStore | null = null;
const errors: string[] = [];
let written = 0;

for (let i = 0; i < count; i++) {
  try {
    if (!store) store = new WorkspaceStore(`migrace-${tag}`, dbPath);
    store.audit(`migrace.write.${tag}`, { i, writer: tag });
    written++;
  } catch (e) {
    errors.push(String((e as Error)?.message ?? e));
    const s = store;
    if (s) {
      try {
        s.close();
      } catch {
        /* ignore */
      }
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
