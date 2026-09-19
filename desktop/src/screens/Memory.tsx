import { useCallback, useEffect, useState, useMemo } from "react";
import { api } from "../api/client";

/** Memory — Phase 2 hardened elite, what XR remembers, why, where, scope, expiration, search+forget.
 * Tokens var(--xr-*), skeleton/empty/error, motion, a11y, real wiring only.
 */

type Entry = { id: string; category?: string; content?: string; scope?: string; source?: string; tags?: string[]; importance?: number; expiresAt?: number | null; updatedAt?: number; };

export function Memory() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<{ enabled?: boolean; count?: number; health?: Record<string, unknown> } | null>(null);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState("all");

  const load = useCallback(() => {
    api.memoryFull().then((m) => { setEntries(m.entries ?? []); setMeta({ enabled: m.enabled, count: m.count, health: m.health }); }).catch(() => setEntries([])).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  async function search() {
    const term = q.trim(); if (!term) { load(); return; }
    setSearching(true);
    try { const r = await api.memorySearch(term); setEntries((r.results ?? []) as Entry[]); setNote(`search: ${r.results?.length ?? 0} match(es) for "${term}"`); }
    catch (e) { setNote(`search failed: ${e instanceof Error ? e.message : String(e)}`); } finally { setSearching(false); }
  }
  async function forget(id: string) {
    try { const r = await api.memoryDelete(id); setNote(r.removed ? `forgot ${id}` : `engine: not found (${id})`); setQ(""); load(); }
    catch (e) { setNote(`forget failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
  async function clearAll() {
    try { const r = await api.memoryClear(); setNote(`forgot everything (${r.removed ?? 0} entries) — audited by engine`); setConfirmClear(false); setQ(""); load(); }
    catch (e) { setNote(`clear failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const fmt = (ts?: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : "never");
  const categories = useMemo(() => [...new Set(entries.map((e) => e.category).filter(Boolean) as string[])].sort(), [entries]);
  const filtered = filterCat === "all" ? entries : entries.filter((e) => e.category === filterCat);

  if (loading) {
    return <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: 12 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 60, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)" }} />)}</div>;
  }

  return (
    <div style={{ padding: "var(--xr-space-4)", display: "grid", gap: "var(--xr-space-3)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Memory</h2>
        <span style={{ fontSize: 12, color: "var(--xr-text-3)" }}>{meta?.enabled === false ? "memory is disabled in engine config" : `${meta?.count ?? entries.length} entries · engine-owned`}</span>
        <span style={{ flex: 1 }} />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} aria-label="Filter category" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11 }}>
          <option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 10 }}>
        <form role="search" onSubmit={(e) => { e.preventDefault(); void search(); }} style={{ display: "flex", gap: 8, flex: 1 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search what XR remembers… (engine index)" aria-label="Search memory" style={{ flex: 1, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontFamily: "var(--xr-font-mono)", fontSize: 11 }} />
          <button disabled={searching} type="submit" style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }}>{searching ? "…" : "search"}</button>
          <button type="button" onClick={() => { setQ(""); setNote(null); load(); }} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }}>all</button>
        </form>
        <span style={{ flex: 1 }} />
        {confirmClear ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--xr-text-3)" }}>forget ALL memories?</span>
            <button style={{ padding: "4px 10px", borderRadius: 6, background: "var(--xr-danger)", color: "white", border: "none", fontSize: 11, cursor: "pointer" }} onClick={() => void clearAll()}>yes, forget all</button>
            <button style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer" }} onClick={() => setConfirmClear(false)}>cancel</button>
          </span>
        ) : <button onClick={() => setConfirmClear(true)} disabled={entries.length === 0} style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-1)", fontSize: 11, cursor: "pointer", opacity: entries.length === 0 ? 0.5 : 1 }}>forget all…</button>}
      </div>

      {note && <p style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: 6, padding: "8px 12px", margin: 0 }}>{note} <button onClick={() => setNote(null)} style={{ marginLeft: 8, background: "transparent", border: "none", cursor: "pointer" }}>✕</button></p>}

      {filtered.length === 0 && (
        <div style={{ padding: 20, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--xr-text-3)" }}>{q.trim() ? "no memories match that search." : "XR remembers nothing yet."}</div>
          <div style={{ fontSize: 11, color: "var(--xr-text-3)", maxWidth: "62ch", lineHeight: 1.6 }}>Memories written by ENGINE during runs (facts, preferences, project context) — never by shell. Ask XR to remember something in Work, e.g. "remember: I prefer concise diffs".</div>
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map((e) => (
          <div key={e.id} style={{ padding: 12, background: "var(--xr-surface-1)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 13 }}>{e.content ?? ""}</div>
            <div style={{ fontFamily: "var(--xr-font-mono)", fontSize: 11, color: "var(--xr-text-3)" }}>{e.category ? `category ${e.category} · ` : ""}scope {e.scope ?? "global"} · source {String(e.source ?? "engine")} · updated {fmt(e.updatedAt)} · expires {fmt(e.expiresAt)}{Array.isArray(e.tags) && e.tags.length > 0 ? ` · ${e.tags.join(", ")}` : ""}</div>
            <div><button onClick={() => void forget(e.id)} style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--xr-border)", background: "var(--xr-surface-2)", fontSize: 11, cursor: "pointer" }}>forget</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
