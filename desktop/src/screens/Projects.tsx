import { useEffect, useMemo, useState } from "react";
import { api, asList, type SessionSummary } from "../api/client";

interface Ws { id?: string; name?: string; rootDir?: string }

/**
 * Phase 2 · Projects — real workspaces (engine-managed roots) + live run
 * activity per workspace. Create/switch go through engine routes; the shell
 * never invents a project.
 */
export function Projects({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [ws, setWs] = useState<{ active?: string; workspaces?: Ws[] } | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.workspaces().then(setWs).catch(() => setWs(null));
    api.sessions().then((s) => setSessions(asList<SessionSummary>(s, "sessions", "items"))).catch(() => {});
  };
  useEffect(load, []);

  const perWs = useMemo(() => {
    const m = new Map<string, { runs: number; last?: SessionSummary }>();
    for (const s of sessions) {
      const k = String(s.workspace ?? "default");
      const cur = m.get(k) ?? { runs: 0 };
      cur.runs += 1;
      if (!cur.last) cur.last = s;
      m.set(k, cur);
    }
    return m;
  }, [sessions]);

  async function create() {
    const id = newId.trim();
    if (!id) { setNote("workspace id required (a-z0-9_-)"); return; }
    setBusy(id); setNote(null);
    try {
      const r = await api.workspacesCreate(id, newName.trim() || undefined);
      setNote(r.error ? `engine: ${r.error}` : `created ${r.workspace?.id ?? id} at ${r.workspace?.rootDir ?? ""}`);
      setNewId(""); setNewName("");
      load();
    } catch (e) {
      setNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function switchTo(id: string, open: boolean) {
    setBusy(id); setNote(null);
    try {
      await api.workspacesSwitch(id);
      if (open) onOpenWorkspace();
      load();
    } catch (e) {
      setNote(`switch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="proj">
      <div className="section-h">
        <h2>Projects</h2>
        <span className="faint" style={{ fontSize: 12 }}>engine-managed workspaces · roots owned by the engine, never the shell</span>
      </div>

      <div className="proj-grid">
        {(ws?.workspaces ?? []).map((w) => {
          const id = String(w.id ?? "");
          const act = perWs.get(id);
          const active = ws?.active === id;
          return (
            <div key={id} className={active ? "proj-card on" : "proj-card"}>
              <div className="proj-top">
                <b>{w.name ?? id}</b>
                {active ? <span className="chip green">active</span> : null}
              </div>
              <div className="mono faint proj-root">{w.rootDir}</div>
              <div className="proj-stats mono faint">
                {act?.runs ?? 0} run{(act?.runs ?? 0) === 1 ? "" : "s"}
                {act?.last ? ` · last: ${String(act.last.status ?? "idle")}` : ""}
              </div>
              <div className="proj-actions">
                {!active && (
                  <button className="chipbtn" disabled={busy === id} onClick={() => switchTo(id, false)}>
                    {busy === id ? "switching…" : "switch"}
                  </button>
                )}
                <button className="chipbtn" disabled={busy === id} onClick={() => switchTo(id, true)}>
                  open in workspace
                </button>
              </div>
            </div>
          );
        })}

        <div className="proj-card new">
          <div className="proj-top"><b>New project</b></div>
          <label className="ob-lab">id
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="my-project" aria-label="Workspace id" />
          </label>
          <label className="ob-lab">name (optional)
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Project" aria-label="Workspace name" />
          </label>
          <button className="btn small" disabled={busy !== null} onClick={create}>Create workspace</button>
        </div>
      </div>

      {note && <p className="ob-note mono">{note}</p>}
    </div>
  );
}
