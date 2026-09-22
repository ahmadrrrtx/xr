/** Phase 5 · undo toast helper.
 *
 * Any reversible action can call `undoable(kind, label, { do, undo })`. The
 * action is performed immediately and a toast is shown with an Undo button.
 * If the user clicks Undo within ~8s, `undo()` is called. If the toast
 * expires (or another toast of the same kind replaces it), the commit
 * callback fires so the caller can persist / sync the final state.
 *
 * Designed for: pin/unpin skill, pin/unpin MCP server, revert-hunk, apply
 * approval. Other actions get a normal toast. */
import { pushToast } from "./components/ToastBus";

type Opts = { do: () => void; undo: () => void; commit?: () => void; timeoutMs?: number };

const timers = new Map<string, number>();

export function undoable(kind: string, title: string, msg: string | undefined, opts: Opts): void {
  opts.do();
  // Cancel any prior undo of the same kind so two Undos don't collide.
  const prior = timers.get(kind);
  if (prior !== undefined) {
    window.clearTimeout(prior);
    timers.delete(kind);
  }
  const ttl = opts.timeoutMs ?? 8000;
  const expire = window.setTimeout(() => {
    timers.delete(kind);
    opts.commit?.();
  }, ttl);
  timers.set(kind, expire);
  pushToast(
    "ok",
    title,
    msg,
    {
      label: "Undo",
      run: () => {
        const t = timers.get(kind);
        if (t !== undefined) {
          window.clearTimeout(t);
          timers.delete(kind);
        }
        opts.undo();
        opts.commit?.();
      },
    },
  );
}

/** Manual commit: for actions that have side effects that fire after the TTL
 *  (e.g. persistence that should only happen when the user did NOT press Undo). */
export function commitUndo(kind: string) {
  const t = timers.get(kind);
  if (t !== undefined) { window.clearTimeout(t); timers.delete(kind); }
}
