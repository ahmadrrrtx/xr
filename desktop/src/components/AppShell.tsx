import { useEffect, useRef, useState, type ReactNode } from "react";
import { XrLogo, XrAvatar } from "./Brand";
import { api, asList, type ProviderInfo, type SessionSummary, type SkillInfo } from "../api/client";

export type Area = "home" | "projects" | "work" | "workspace" | "research" | "memory" | "agents" | "library" | "trust" | "runs" | "settings" | "voice";

/* Phase 6 · mock-accurate icon rail. Left: work areas. Bottom: settings + presence. */
const NAV: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" /> },
  { id: "projects", label: "Projects", icon: <path d="M3 6h6l2 2h10v4H3zM3 14h18v5H3z" /> },
  { id: "work", label: "Work (chat)", icon: <path d="M4 5h16v10H9l-5 4z" /> },
  { id: "workspace", label: "Workspace (files)", icon: <path d="M3 6h6l2 2h10v11H3zM10 12v4M8 14h4" /> },
  { id: "research", label: "Research", icon: <path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5M10 7v6M7 10h6" /> },
  { id: "memory", label: "Memory", icon: <path d="M12 4a4 4 0 0 0-4 4c-2 0-3 2-3 3.5S6.5 15 8 15c0 2.5 2 4 4 4s4-1.5 4-4c1.5 0 3-2 3-3.5S18 8 16 8a4 4 0 0 0-4-4zM12 8v11" /> },
  { id: "agents", label: "Multi-agent", icon: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 6a3 3 0 0 1 0 6M18 20a5.5 5.5 0 0 0-2-4M16 11h5M18.5 8.5V13.5" /> },
  { id: "runs", label: "Team runs", icon: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4" /> },
  { id: "library", label: "Library", icon: <path d="M6 4h3v16H6zM11 4h3v16h-3zM16.5 5.2l2.9.8-3.6 13.6-2.9-.8z" /> },
  { id: "trust", label: "Trust Center", icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /> },
  { id: "voice", label: "Voice mode", icon: <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /> },
];

const BOTTOM: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4.5 12l-1.8 1 1 1.8-.5 2 2 .5 1 1.8 1.8-1 2 .5.5-2 1.8-1-1-1.8.5-2-2-.5-1-1.8-1.8 1-2-.5-.5 2-1.8 1zM21.3 13l-1.8-1 .5-2-2-.5-1-1.8" /> },
];

export function AppShell({
  area,
  onArea,
  engineVersion,
  onSearch,
  onOpenRun,
  voiceState,
  onVoiceOpen,
  onPalette,
  children,
}: {
  area: Area;
  onArea: (a: Area) => void;
  engineVersion: string | null;
  onSearch: (q: string) => void;
  onOpenRun: (id: string) => void;
  voiceState?: string;
  onVoiceOpen?: () => void;
  /** Phase 1 · ⌘K opens the command palette. */
  onPalette?: () => void;
  children: ReactNode;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [up, setUp] = useState(true);
  const [voiceCap, setVoiceCap] = useState<boolean>(false);
  useEffect(() => {
    api.voiceStatus().then((v) => setVoiceCap(Boolean((v?.stt as { available?: boolean } | undefined)?.available || (v?.tts as { available?: boolean } | undefined)?.available))).catch(() => setVoiceCap(false));
  }, []);
  const [q, setQ] = useState("");
  const [pop, setPop] = useState<{ skills: SkillInfo[]; runs: SessionSummary[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced universal search: skills via the engine index, runs via live sessions.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setPop(null); return; }
    let live = true;
    const t = setTimeout(() => {
      Promise.allSettled([api.skills(term), api.sessions()]).then(([s, r]) => {
        if (!live) return;
        const skills = (s.status === "fulfilled" ? (s.value.skills ?? []) : []).slice(0, 5);
        const all = r.status === "fulfilled" ? asList<SessionSummary>(r.value, "sessions") : [];
        const low = term.toLowerCase();
        const runs = all.filter((x) => `${x.title ?? ""} ${x.prompt ?? ""}`.toLowerCase().includes(low)).slice(0, 5);
        setPop({ skills, runs });
      });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  // ⌘K / Ctrl+K focuses the global search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onPalette?.(); }
      if (e.key === "Escape") setPop(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.health().then(() => { if (live) setUp(true); }).catch(() => { if (live) setUp(false); });
      api.providers().then((p) => { if (live) setProviders(asList<ProviderInfo>(p, "providers", "items")); }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const active = providers.find((p) => p.available !== false);
  const NavBtn = ({ n }: { n: { id: Area; label: string; icon: ReactNode } }) => (
    <button
      className={n.id === area ? "rbtn on" : "rbtn"}
      title={n.label}
      aria-label={n.label}
      aria-current={n.id === area ? "page" : undefined}
      onClick={() => onArea(n.id)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {n.icon}
      </svg>
    </button>
  );

  return (
    <div className="shell">
      <header className="titlebar">
        <XrLogo height={22} radius={5} />
        <span className="appname">XR Desktop</span>
        <span className="tb-sep" />
        <span className="crumb mono faint">{NAV.find((n) => n.id === area)?.label ?? ""}</span>
        <div className="gsearch-wrap">
          <form
            className="gsearch"
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onSearch(q.trim()); setPop(null); } }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills, runs… · ⌘K palette"
              aria-label="Global search"
            />
          </form>
          {pop && (pop.skills.length > 0 || pop.runs.length > 0) && (
            <div className="gpop" role="listbox" aria-label="Search results">
              {pop.skills.length > 0 && <div className="gpop-h">Skills · engine index</div>}
              {pop.skills.map((s) => (
                <button key={s.id} className="gpop-item" role="option" aria-selected={false} onClick={() => { onSearch(s.name ?? s.id); setPop(null); setQ(""); }}>
                  <span className="chip tiny">skill</span> {s.name ?? s.id}
                </button>
              ))}
              {pop.runs.length > 0 && <div className="gpop-h">Runs · live sessions</div>}
              {pop.runs.map((r) => (
                <button key={r.id} className="gpop-item" role="option" aria-selected={false} onClick={() => { onOpenRun(r.id); setPop(null); setQ(""); }}>
                  <span className="chip tiny">run</span> {r.title || r.prompt?.slice(0, 48) || r.id}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="mono faint tb-right">engine {engineVersion ?? "—"}</span>
      </header>
      <nav className="rail" aria-label="Primary">
        {NAV.map((n) => <NavBtn key={n.id} n={n} />)}
        <div className="spacer" />
        {BOTTOM.map((n) => <NavBtn key={n.id} n={n} />)}
        <span className="rail-presence" title="XR presence" aria-label="XR presence">
          <XrAvatar size={26} />
        </span>
      </nav>
      <main className="main">{children}</main>
      <footer className="statusbar" aria-label="Status">
        <span className={up ? "sb-item ok" : "sb-item bad"} title={up ? "Engine connected" : "Engine offline"}>
          Engine <i className="dot" aria-hidden="true" />
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item sb-prov" title="Active provider (engine-reported)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9.5 9.5h5v5h-5z" />
          </svg>
          {active?.id ?? "no provider"}{active?.local ? " · local" : ""}
        </span>
        <span className="sb-spacer" />
        <span
          className={voiceState && voiceState !== "idle" ? "sb-item ok" : "sb-item off"}
          title={voiceState && voiceState !== "idle" ? `Voice session ${voiceState} — click to open` : `Voice idle — click to open (offline on-device pipeline ${voiceCap ? "available" : "unavailable"})`}
          onClick={onVoiceOpen}
          role="button"
          style={{ cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12M8 11a4 4 0 0 0 8 0M5 21h14" /></svg>
          <span className="sb-voice-cap">
            {voiceState && voiceState !== "idle" ? `VOICE ${voiceState.toUpperCase()}` : "OFFLINE VOICE"}
          </span>
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item mono">{engineVersion ?? "v—"}</span>
      </footer>
    </div>
  );
}
