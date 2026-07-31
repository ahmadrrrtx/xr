/** Crash inside an audit write transaction (before-commit). */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
const store = new WorkspaceStore("crash-audit", process.env.XR_DB!);
for (let i = 0; i < 50; i++) store.audit(`crash.event.${i}`, { i });
store.close();
