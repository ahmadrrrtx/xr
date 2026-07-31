/** Session + step + audit in one write transaction; crash before commit. */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
const store = new WorkspaceStore("crash-session", process.env.XR_DB!);
store.write(() => {
  store.createSession("s_crash", "crash session", "chat");
  store.addStep("st_crash", "s_crash", 0, "tool", "x", { ok: true });
  store.audit("session.crash", { ok: true }, "s_crash");
});
store.close();
