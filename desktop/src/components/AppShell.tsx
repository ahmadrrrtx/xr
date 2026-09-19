import { useEffect, useRef, useState, type ReactNode } from "react";
import { XrLogo, XrAvatar } from "./Brand";
import { api, asList, type ProviderInfo, type SessionSummary, type SkillInfo } from "../api/client";
import { notify, notificationsEnabled } from "../notify";
import { applyTheme, applyDensity, type Theme, type Density } from "../styles/tokens";

export type Area = "home" | "projects" | "work" | "workspace" | "research" | "memory" | "models" | "control" | "agents" | "library" | "trust" | "runs" | "settings" | "voice";

/* Phase 1 hardened · mock-accurate icon rail with design system v1 tokens.json source */
const NAV: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" /> },
  { id: "projects", label: "Projects", icon: <path d="M3 6h6l2 2h10v4H3zM3 14h18v5H3z" /> },
  { id: "work", label: "Work (chat)", icon: <path d="M4 5h16v10H9l-5 4z" /> },
  { id: "workspace", label: "Workspace (files)", icon: <path d="M3 6h6l2 2h10v11H3zM10 12v4M8 14h4" /> },
  { id: "research", label: "Research", icon: <path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5M10 7v6M7 10h6" /> },
  { id: "memory", label: "Memory", icon: <path d="M12 4a4 4 0 0 0-4 4c-2 0-3 2-3 3.5S6.5 15 8 15c0 2.5 2 4 4 4s4-1.5 4-4c1.5 0 3-2 3-3.5S18 8 16 8a4 4 0 0 0-4-4zM12 8v11" /> },
  { id: "models", label: "Model Center", icon: <path d="M12 3l8 4.5-8 4.5-8-4.5zM4 12.5l8 4.5 8-4.5M4 17l8 4.5 8-4.5" /> },
  { id: "control", label: "Control Room", icon: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /> },
  { id: "agents", label: "Multi-agent", icon: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 6a3 3 0 0 1 0 6M18 20a5.5 5.5 0 0 0-2-4M16 11h5M18.5 8.5V13.5" /> },
  { id: "runs", label: "Team runs", icon: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4" /> },
  { id: "library", label: "Library", icon: <path d="M6 4h3v16H6zM11 4h3v16h-3zM16.5 5.2l2.9.8-3.6 13.6-2.9-.8z" /> },
  { id: "trust", label: "Trust Center", icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /> },
  { id: "voice", label: "Voice mode", icon: <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /> },
];

const BOTTOM: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4.5 12l-1.8 1 1 1.8-.5 2 2 .5 1 1.8 1.8-1 2 .5.5-2 1.8-1-1-1.8.5-2-2-.5-1-1.8-1.8 1-2-.5-.5 2-1.8 1zM21.3 13l-1.8-1 .5-2-2-.5-1-1.8" /> },
];

function useWindowBounds() {
  useEffect(() => {
    // Phase 1 · window state persistence (size/position/monitor) where safe
    const save = () => {
      try {
        const bounds = { w: window.innerWidth, h: window.innerHeight, x: window.screenX, y: window.screenY };
        localStorage.setItem("xr-window-bounds", JSON.stringify(bounds));
      } catch { /* ignore */ }
    };
    window.addEventListener("resize", save);
    window.addEventListener("beforeunload", save);
    return () => {
      window.removeEventListener("resize", save);
      window.removeEventListener("beforeunload", save);
    };
  }, []);
}

function useThemeSync() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("xr-theme") as Theme) || "dark");
  const [density, setDensity] = useState<Density>(() => (localStorage.getItem("xr-density") as Density) || "comfortable");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  useEffect(() => {
    // OS theme sync when theme is system
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if ((localStorage.getItem("xr-theme") as Theme) === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return { theme, setTheme, density, setDensity };
}

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
  onPalette?: () => void;
  children: ReactNode;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [up, setUp] = useState(true);
  const [voiceCap, setVoiceCap] = useState<boolean>(false);
  const [q, setQ] = useState("");
  const [pop, setPop] = useState<{ skills: SkillInfo[]; runs: SessionSummary[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme, density, setDensity } = useThemeSync();
  useWindowBounds();

  /* Phase 5 · opt-in OS notifications: approval due + run done, engine-polled. Display-only. */
  useEffect(() => {
    let prevPending = -1;
    const seenRuns = new Map<string, string>();
    const t = setInterval(() => {
      if (!notificationsEnabled()) return;
      api.controlPending().then((r) => {
        const n = (r.pending ?? []).length;
        if (prevPending >= 0 && n > prevPending) void notify("XR — approval due", `${n} request(s) waiting in the Trust Center`);
        prevPending = n;
      }).catch(() => undefined);
      api.agents().then((a) => {
        for (const w of a.workflows ?? []) {
          const id = String((w as { id?: unknown }).id ?? "");
          const st = String((w as { state?: unknown; status?: unknown }).state ?? (w as { status?: unknown }).status ?? "");
          const prev = seenRuns.get(id);
          if (prev && prev !== st && /completed|failed|done/.test(st)) {
            void notify(`XR — run ${st}`, String((w as { goal?: unknown; name?: unknown }).goal ?? (w as { name?: unknown }).name ?? id).slice(0, 80));
          }
          if (id) seenRuns.set(id, st);
        }
      }).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api.voiceStatus().then((v) => setVoiceCap(Boolean((v?.stt as { available?: boolean } | undefined)?.available || (v?.tts as { available?: boolean } | undefined)?.available))).catch(() => setVoiceCap(false));
  }, []);

  // Debounced universal search: skills via engine index, runs via live sessions.
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

  // Keyboard: ⌘K / Ctrl+K palette, Escape close pop, ? cheat sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); onPalette?.(); }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        // Dispatch custom event for cheat sheet
        window.dispatchEvent(new CustomEvent("xr:shortcuts"));
      }
      if (e.key === "Escape") setPop(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPalette]);

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

  // Tauri window controls — display-only, invoke via __TAURI_INTERNALS__ if present
  const tauriInternals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
  const tauriControls = tauriInternals;

  return (
    <div className="shell" data-theme={theme} data-density={density}>
      <header className="titlebar" data-tauri-drag-region={tauriControls ? true : undefined}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }} data-tauri-drag-region={tauriControls ? true : undefined}>
          <XrLogo height={22} radius={5} />
          <span className="appname">XR Desktop</span>
          <span className="tb-sep" />
          <span className="crumb mono faint">{NAV.find((n) => n.id === area)?.label ?? ""}</span>
        </div>
        <div className="gsearch-wrap" style={{ flex: 1, maxWidth: 480, margin: "0 12px" }}>
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
              placeholder="Search skills, runs… · ⌘K palette · ? shortcuts"
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
        <div className="window-controls" style={{ display: "flex", gap: 4, marginLeft: 8 }}>
          <select
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="mono"
            style={{ background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 6, color: "var(--xr-text-muted)", padding: "2px 6px", fontSize: 11 }}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="system">System</option>
            <option value="high-contrast">High Contrast</option>
          </select>
          <select
            aria-label="Density"
            value={density}
            onChange={(e) => setDensity(e.target.value as Density)}
            className="mono"
            style={{ background: "var(--xr-surface-2)", border: "1px solid var(--xr-border-strong)", borderRadius: 6, color: "var(--xr-text-muted)", padding: "2px 6px", fontSize: 11 }}
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
        {tauriControls && (
          <div className="window-controls" style={{ display: "flex", gap: 2, marginLeft: 8 }}>
            <button className="wc-btn" aria-label="Minimize" onClick={() =>  (tauriControls?.invoke as any)?.("plugin:window|minimize")}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14" /></svg>
            </button>
            <button className="wc-btn" aria-label="Maximize" onClick={() =>  (tauriControls?.invoke as any)?.("plugin:window|maximize")}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
            </button>
            <button className="wc-btn close" aria-label="Close" onClick={() =>  (tauriControls?.invoke as any)?.("plugin:window|close")}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        )}
      </header>
      <nav className="rail" aria-label="Primary">
        {NAV.map((n) => <NavBtn key={n.id} n={n} />)}
        <div className="spacer" />
        {BOTTOM.map((n) => <NavBtn key={n.id} n={n} />)}
        <span className="rail-presence" title="XR presence — Waking up / Ready / Working / Approval / Success / Error / Offline" aria-label="XR presence">
          <XrAvatar size={26} />
          <span className="presence-pulse" aria-hidden="true" style={{ marginTop: 6 }} />
        </span>
      </nav>
      <main className="main" id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="statusbar" aria-label="Status">
        <span className={up ? "sb-item ok" : "sb-item bad"} title={up ? "Engine connected — honest, re-runnable, audited by engine" : "Engine offline — start xr serve or wait for packaged sidecar, interrupted work resumes from checkpoints"}>
          Engine <i className="dot" aria-hidden="true" />
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item sb-prov" title="Active provider (engine-reported, never computed in shell — SEC-07)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9.5 9.5h5v5h-5z" />
          </svg>
          {active?.id ?? "no provider"}{active?.local ? " · local" : ""} · {theme} · {density}
        </span>
        <span className="sb-spacer" />
        <span
          className={voiceState && voiceState !== "idle" ? "sb-item ok" : "sb-item off"}
          title={voiceState && voiceState !== "idle" ? `Voice session ${voiceState} — click to open` : `Voice idle — click to open (offline on-device pipeline ${voiceCap ? "available" : "unavailable"})`}
          onClick={onVoiceOpen}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onVoiceOpen?.(); } }}
          style={{ cursor: "pointer" }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12M8 11a4 4 0 0 0 8 0M5 21h14" /></svg>
          <span className="sb-voice-cap">
            {voiceState && voiceState !== "idle" ? `VOICE ${voiceState.toUpperCase()}` : "OFFLINE VOICE"}
          </span>
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item mono" title="Engine version — audited by engine truth">{engineVersion ?? "v—"}</span>
      </footer>
    </div>
  );
}
