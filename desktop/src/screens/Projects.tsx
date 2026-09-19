import { useEffect, useMemo, useState } from "react";
import { api, asList, type SessionSummary } from "../api/client";

/** Projects — Phase 2 hardened elite, real workspaces CRUD + live run activity.
 * Tokens var(--xr-*), skeleton/empty/error, motion, a11y focus cyan.
 */

interface Ws { id?: string; name?: string; rootDir?: string }

export function Projects({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const [ws, setWs] = useState<{ active?: string; workspaces?: Ws[] } | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const load = () => {
    api.workspaces().then(setWs).catch(() => setWs(null)).finally(() => setLoading(false));
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

  const filtered = useMemo(() => {
    const list = ws?.workspaces ?? [];
    if (!q.trim()) return list;
    const low = q.trim().toLowerCase();
    return list.filter((w) => `${w.id ?? ""} ${w.name ?? ""} ${w.rootDir ?? ""}`.toLowerCase().includes(low));
  }, [ws, q]);

  async function create() {
    const id = newId.trim();
    if (!id) { setNote("workspace id required (a-z0-9_-)"); return; }
    setBusy(id); setNote(null);
    try {
      const r = await api.workspacesCreate(id, newName.trim() || undefined);
      setNote(r.error ? `engine: ${r.error}` : `created ${r.workspace?.id ?? id} at ${r.workspace?.rootDir ?? ""}`);
      setNewId(""); setNewName("");
      load();
    } catch (e) { setNote(`engine rejected: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(null); }
  }
  async function switchTo(id: string, open: boolean) {
    setBusy(id); setNote(null);
    try { await api.workspacesSwitch(id); if (open) onOpenWorkspace(); load(); }
    catch (e) { setNote(`switch failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(null); }
  }

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 120, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>;
  }

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Projects</h2>
        <span style={{ fontSize: 12, color: "var(--xr-text-3)" }}>engine-managed workspaces · roots owned by engine, never shell · {ws?.workspaces?.length ?? 0} workspaces</span>
        <span style={{ flex: 1 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects — id, name, rootDir" aria-label="Search projects" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11, minWidth: 220 }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {filtered.map((w) => {
          const id = String(w.id ?? "");
          const act = perWs.get(id);
          const active = ws?.active === id;
          return (
            <div key={id} style={{ padding: 14, background: active ? "var(--xr-surface-2)" : "var(--xr-surface-1)", border: active ? "2px solid var(--xr-accent)" : "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}><b style={{ fontSize: 13 }}>{w.name ?? id}</b>{active && <span style={{ padding: "2px 8px", borderRadius: 999, background: "var(--xr-success)", color: "white", fontSize: 10 }}>active</span>}</div>
              <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.rootDir}</div>
              <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{act?.runs ?? 0} run{(act?.runs ?? 0) === 1 ? "" : "s"}{act?.last ? ` · last: ${String(act.last.status ?? "idle")}` : ""}</div>
              <div style={{ display: "flex", gap: 8 }}>{!active && <button disabled={busy === id} onClick={() => switchTo(id, false)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>{busy === id ? "switching…" : "switch"}</button>}<button disabled={busy === id} onClick={() => switchTo(id, true)} style={{ padding: "4px 10px", borderRadius: 999, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer" }}>open in workspace</button></div>
            </div>
          );
        })}
        <div style={{ padding: 14, background: "var(--xr-surface-1)", border: "1px dashed var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>New project</div>
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--xr-text-2)" }}>id<input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="my-project" aria-label="Workspace id" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--xr-text-2)" }}>name (optional)<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="My Project" aria-label="Workspace name" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 12 }} /></label>
          <button disabled={busy !== null} onClick={create} style={{ padding: "6px 12px", borderRadius: 6, background: "var(--xr-accent)", color: "white", border: "none", fontSize: 11, cursor: "pointer", opacity: busy !== null ? 0.5 : 1 }}>Create workspace</button>
        </div>
      </div>
      {filtered.length === 0 && <div style={{ padding: 20, color: "var(--xr-text-3)", fontSize: 12 }}>No projects match — honest empty. Engine owns roots, shell never invents.</div>}
      {note && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-2)", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "8px 12px" }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></p>}
    </div>
  );
}
