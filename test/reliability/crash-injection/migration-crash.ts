/** Crash during the first write of store construction (migrate path). */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
const store = new WorkspaceStore("crash-mig", process.env.XR_DB!);
store.audit("mig.ok", { ok: true });
store.close();
