/** Hammer audit writes until externally SIGKILLed (WAL crash-safety probe). */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
const dbPath = process.argv[2]!;
const count = Number(process.argv[3] ?? 400);
const store = new WorkspaceStore("hammer", dbPath);
for (let i = 0; i < count; i++) {
  store.audit(`hammer.${i}`, { i });
}
store.close();
