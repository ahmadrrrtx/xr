import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

type Entry = {
  id: string; category?: string; content?: string; scope?: string; source?: string;
  tags?: string[]; importance?: number; expiresAt?: number | null; updatedAt?: number;
};

/**
 * Phase 3 · Memory — what XR remembers, why, where it came from, scope and
 * expiration; search + forget. Every row is engine data from /memory; the
 * shell never synthesizes memories.
 */
export function Memory() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<{ enabled?: boolean; count?: number; health?: Record<string, unknown> } | null>(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(() => {
    api.memoryFull().then((m) => {
      setEntries(m.entries ?? []);
      setMeta({ enabled: m.enabled, count: m.count, health: m.health });
    }).catch(() => setEntries([]));
  }, []);
  useEffect(load, [load]);

  async function search() {
    const term = q.trim();
    if (!term) { load(); return; }
    setSearching(true);
    try {
      const r = await api.memorySearch(term);
      setEntries((r.results ?? []) as Entry[]);
      setNote(`search: ${r.results?.length ?? 0} match(es) for "${term}"`);
    } catch (e) {
      setNote(`search failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearching(false);
    }
  }

  async function forget(id: string) {
    try {
      const r = await api.memoryDelete(id);
      setNote(r.removed ? `forgot ${id}` : `engine: not found (${id})`);
      setQ(""); load();
    } catch (e) {
      setNote(`forget failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function clearAll() {
    try {
      const r = await api.memoryClear();
      setNote(`forgot everything (${r.removed ?? 0} entries) — audited by the engine`);
      setConfirmClear(false); setQ(""); load();
    } catch (e) {
      setNote(`clear failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const fmt = (ts?: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : "never");

  return (
    <div className="mem-screen">
      <div className="section-h">
        <h2>Memory</h2>
        <span className="faint" style={{ fontSize: 12 }}>
          {meta?.enabled === false ? "memory is disabled in engine config" : `${meta?.count ?? entries.length} entries · engine-owned`}
        </span>
      </div>

      <div className="mem-bar">
        <form className="gsearch" role="search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search what XR remembers…" aria-label="Search memory" />
          <button className="chipbtn" disabled={searching} type="submit">{searching ? "…" : "search"}</button>
          <button className="chipbtn" type="button" onClick={() => { setQ(""); setNote(null); load(); }}>all</button>
        </form>
        <span className="spacer" />
        {confirmClear ? (
          <span className="row-gap">
            <span className="faint" style={{ fontSize: 11 }}>forget ALL memories?</span>
            <button className="chipbtn" style={{ color: "var(--xr-red)" }} onClick={() => void clearAll()}>yes, forget all</button>
            <button className="chipbtn" onClick={() => setConfirmClear(false)}>cancel</button>
          </span>
        ) : (
          <button className="chipbtn" onClick={() => setConfirmClear(true)} disabled={entries.length === 0}>forget all…</button>
        )}
      </div>

      {note && <p className="ob-note mono">{note}</p>}

      {entries.length === 0 && (
        <div className="mem-empty">
          <div className="faint">
            {q.trim() ? "no memories match that search." : "XR remembers nothing yet."}
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 6, maxWidth: "62ch", lineHeight: 1.6 }}>
            Memories are written by the ENGINE during runs (facts, preferences, project context) —
            never by the shell. Ask XR to remember something in Work, e.g. "remember: I prefer concise diffs".
          </div>
        </div>
      )}

      <div className="mem-list">
        {entries.map((e) => (
          <div key={e.id} className="mem-row">
            <div className="mem-content">{e.content ?? ""}</div>
            <div className="mem-meta mono faint">
              {e.category ? `category ${e.category} · ` : ""}scope {e.scope ?? "global"} · source {String(e.source ?? "engine")} ·
              updated {fmt(e.updatedAt)} · expires {fmt(e.expiresAt)}
              {Array.isArray(e.tags) && e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}
            </div>
            <button className="chipbtn" onClick={() => void forget(e.id)}>forget</button>
          </div>
        ))}
      </div>
    </div>
  );
}
